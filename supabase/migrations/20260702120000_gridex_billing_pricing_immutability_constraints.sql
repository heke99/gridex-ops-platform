-- Migration B: billing/pricing production guardrails.
--
-- 1) Immutability trigger on contract_price_snapshots (app code only inserts/selects).
-- 2) Locked pricing_runs protection: block UPDATE/DELETE on locked runs except an
--    explicit maintenance path (session setting app.gridex_pricing_maintenance = 'on').
-- 3) pricing_runs uniqueness per billing underlay for statuses success/locked, with a
--    backfill that marks older duplicate runs as 'superseded' before the index is built.
-- 4) Check constraints (period ordering, non-negative VAT, valid price areas) added as
--    NOT VALID and validated only when existing data permits.
-- 5) Missing lookup indexes for metering/pricing/billing hot paths.
--
-- Every statement is guarded so the migration is safe to run on databases where some
-- tables do not exist yet, and re-runnable (idempotent).

-- -----------------------------------------------------------------------------
-- 1) contract_price_snapshots immutability
-- -----------------------------------------------------------------------------

create or replace function public.gridex_block_contract_price_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  -- Escape hatch for explicit DBA maintenance (GDPR erasure, data repair):
  --   set local app.gridex_pricing_maintenance = 'on';
  if coalesce(current_setting('app.gridex_pricing_maintenance', true), '') = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  raise exception 'contract_price_snapshots are immutable (%). Create a new snapshot instead of mutating an existing one.', tg_op
    using errcode = 'P0001';
end;
$$;

do $$
begin
  if to_regclass('public.contract_price_snapshots') is not null then
    drop trigger if exists gridex_contract_price_snapshots_immutable_tg on public.contract_price_snapshots;
    create trigger gridex_contract_price_snapshots_immutable_tg
      before update or delete on public.contract_price_snapshots
      for each row execute function public.gridex_block_contract_price_snapshot_mutation();
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2) Locked pricing_runs protection (backfill duplicates first, see section 3,
--    so the ordering here is: backfill -> trigger -> unique index)
-- -----------------------------------------------------------------------------

create or replace function public.gridex_protect_locked_pricing_runs()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.gridex_pricing_maintenance', true), '') = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'locked' then
      raise exception 'Locked pricing runs cannot be deleted. Unlock the billing period and use the explicit maintenance path.'
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  if old.status = 'locked' then
    raise exception 'Locked pricing runs are immutable. Unlock the billing period via the explicit maintenance path before changing run %.', old.id
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- Explicit, audited unlock path for locked pricing runs. This is the only
-- supported way to make a locked run mutable again (used by unlockBillingPeriod).
create or replace function public.gridex_unlock_pricing_runs_for_month(
  p_company_id uuid,
  p_billing_month text,
  p_actor_user_id uuid default null,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month_start date;
  v_month_end date;
  v_count integer;
begin
  if p_billing_month !~ '^\d{4}-\d{2}$' then
    raise exception 'billing_month must be formatted as YYYY-MM';
  end if;
  v_month_start := to_date(p_billing_month || '-01', 'YYYY-MM-DD');
  v_month_end := v_month_start + interval '1 month';

  perform set_config('app.gridex_pricing_maintenance', 'on', true);

  update public.pricing_runs
  set
    status = 'success',
    locked_at = null,
    metadata = metadata || jsonb_build_object(
      'unlocked_at', now(),
      'unlocked_by', p_actor_user_id,
      'unlock_reason', coalesce(p_reason, 'billing_period_unlocked')
    )
  where company_id = p_company_id
    and status = 'locked'
    and billing_period_start >= v_month_start
    and billing_period_start < v_month_end;

  get diagnostics v_count = row_count;

  perform set_config('app.gridex_pricing_maintenance', '', true);

  return v_count;
end;
$$;

revoke all on function public.gridex_unlock_pricing_runs_for_month(uuid, text, uuid, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.gridex_unlock_pricing_runs_for_month(uuid, text, uuid, text) to service_role;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3) pricing_runs: supersede duplicate success/locked runs per underlay, then
--    enforce one active (success/locked) run per (company_id, billing_underlay_id)
-- -----------------------------------------------------------------------------

do $$
declare
  duplicate_groups integer;
begin
  if to_regclass('public.pricing_runs') is null then
    return;
  end if;

  -- Backfill BEFORE the immutability trigger exists so historical locked
  -- duplicates can still be superseded. Keep, per underlay, the locked run if
  -- one exists, otherwise the most recent run.
  with ranked as (
    select
      id,
      status,
      row_number() over (
        partition by company_id, billing_underlay_id
        order by (status = 'locked') desc, created_at desc, id desc
      ) as rn
    from public.pricing_runs
    where billing_underlay_id is not null
      and status in ('success', 'locked')
  )
  update public.pricing_runs pr
  set
    status = 'superseded',
    metadata = pr.metadata || jsonb_build_object(
      'superseded_reason', 'duplicate_active_run_backfill',
      'superseded_previous_status', ranked.status,
      'superseded_at', now()
    )
  from ranked
  where pr.id = ranked.id
    and ranked.rn > 1;

  -- Now attach the locked-run protection trigger.
  drop trigger if exists gridex_pricing_runs_locked_guard_tg on public.pricing_runs;
  create trigger gridex_pricing_runs_locked_guard_tg
    before update or delete on public.pricing_runs
    for each row execute function public.gridex_protect_locked_pricing_runs();

  -- Unique active run per underlay. Pre-check for any remaining duplicates so a
  -- failed index build cannot abort the migration on legacy data.
  select count(*) into duplicate_groups
  from (
    select company_id, billing_underlay_id
    from public.pricing_runs
    where billing_underlay_id is not null
      and status in ('success', 'locked')
    group by company_id, billing_underlay_id
    having count(*) > 1
  ) dup;

  if duplicate_groups > 0 then
    raise notice 'pricing_runs_active_per_underlay_uidx NOT created: % duplicate group(s) remain. Supersede duplicates manually and re-run.', duplicate_groups;
  else
    create unique index if not exists pricing_runs_active_per_underlay_uidx
      on public.pricing_runs(company_id, billing_underlay_id)
      where billing_underlay_id is not null and status in ('success', 'locked');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4) Check constraints (NOT VALID first, validated only when data permits)
-- -----------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.pricing_runs') is not null then
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.pricing_runs'::regclass
        and conname = 'pricing_runs_period_order_check'
    ) then
      alter table public.pricing_runs
        add constraint pricing_runs_period_order_check
        check (
          billing_period_start is null
          or billing_period_end is null
          or billing_period_end > billing_period_start
        ) not valid;
      begin
        alter table public.pricing_runs validate constraint pricing_runs_period_order_check;
      exception when others then
        raise notice 'pricing_runs_period_order_check left NOT VALID: %', sqlerrm;
      end;
    end if;

    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.pricing_runs'::regclass
        and conname = 'pricing_runs_status_check'
    ) then
      alter table public.pricing_runs
        add constraint pricing_runs_status_check
        check (status in ('success', 'failed', 'needs_review', 'locked', 'superseded')) not valid;
      begin
        alter table public.pricing_runs validate constraint pricing_runs_status_check;
      exception when others then
        raise notice 'pricing_runs_status_check left NOT VALID: %', sqlerrm;
      end;
    end if;
  end if;

  if to_regclass('public.pricing_preview_lines') is not null then
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.pricing_preview_lines'::regclass
        and conname = 'pricing_preview_lines_vat_rate_check'
    ) then
      alter table public.pricing_preview_lines
        add constraint pricing_preview_lines_vat_rate_check
        check (vat_rate >= 0) not valid;
      begin
        alter table public.pricing_preview_lines validate constraint pricing_preview_lines_vat_rate_check;
      exception when others then
        raise notice 'pricing_preview_lines_vat_rate_check left NOT VALID: %', sqlerrm;
      end;
    end if;
  end if;

  if to_regclass('public.billing_underlays') is not null then
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.billing_underlays'::regclass
        and conname = 'billing_underlays_period_order_check'
    ) then
      alter table public.billing_underlays
        add constraint billing_underlays_period_order_check
        check (
          billing_period_start is null
          or billing_period_end is null
          or billing_period_end > billing_period_start
        ) not valid;
      begin
        alter table public.billing_underlays validate constraint billing_underlays_period_order_check;
      exception when others then
        raise notice 'billing_underlays_period_order_check left NOT VALID: %', sqlerrm;
      end;
    end if;

    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.billing_underlays'::regclass
        and conname = 'billing_underlays_price_area_check'
    ) then
      alter table public.billing_underlays
        add constraint billing_underlays_price_area_check
        check (price_area is null or price_area in ('SE1', 'SE2', 'SE3', 'SE4')) not valid;
      begin
        alter table public.billing_underlays validate constraint billing_underlays_price_area_check;
      exception when others then
        raise notice 'billing_underlays_price_area_check left NOT VALID: %', sqlerrm;
      end;
    end if;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 5) Missing hot-path indexes
-- -----------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.normalized_metering_values') is not null then
    create index if not exists idx_normalized_metering_values_company_point_period
      on public.normalized_metering_values(company_id, metering_point_id, period_start, period_end);
  end if;

  if to_regclass('public.pricing_preview_lines') is not null then
    create index if not exists idx_pricing_preview_lines_company_underlay
      on public.pricing_preview_lines(company_id, billing_underlay_id)
      where billing_underlay_id is not null;
  end if;

  if to_regclass('public.pricing_runs') is not null then
    create index if not exists idx_pricing_runs_company_customer_created
      on public.pricing_runs(company_id, customer_id, created_at desc);
  end if;

  if to_regclass('public.billing_underlays') is not null then
    create index if not exists idx_billing_underlays_company_contract
      on public.billing_underlays(company_id, contract_id)
      where contract_id is not null;
  end if;
end $$;
