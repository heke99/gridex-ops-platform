-- Contract and portfolio pricing consistency hardening.
-- Scope:
--  * exact tenant ownership for price plans, area rows, settlements and billing rows
--  * superadmin-only atomic entry of monthly SE1-SE4 portfolio prices
--  * support manually entered final monthly portfolio prices in the approval workflow

begin;

-- Stable composite keys used by tenant-scoped foreign keys.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'price_plans_company_id_id_key') then
    alter table public.price_plans
      add constraint price_plans_company_id_id_key unique (company_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'price_plan_versions_company_id_id_key') then
    alter table public.price_plan_versions
      add constraint price_plan_versions_company_id_id_key unique (company_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contract_price_options_company_id_id_key') then
    alter table public.contract_price_options
      add constraint contract_price_options_company_id_id_key unique (company_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'portfolio_monthly_settlements_company_id_id_key') then
    alter table public.portfolio_monthly_settlements
      add constraint portfolio_monthly_settlements_company_id_id_key unique (company_id, id);
  end if;
end $$;

-- Exact tenant ownership must hold at the database boundary, not only in RPC code.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'price_plan_versions_company_price_plan_fk') then
    alter table public.price_plan_versions
      add constraint price_plan_versions_company_price_plan_fk
      foreign key (company_id, price_plan_id)
      references public.price_plans(company_id, id)
      on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'contract_area_prices_company_option_fk') then
    alter table public.contract_price_option_area_prices
      add constraint contract_area_prices_company_option_fk
      foreign key (company_id, contract_price_option_id)
      references public.contract_price_options(company_id, id)
      on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'contract_area_prices_company_version_fk') then
    alter table public.contract_price_option_area_prices
      add constraint contract_area_prices_company_version_fk
      foreign key (company_id, price_plan_version_id)
      references public.price_plan_versions(company_id, id)
      on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'portfolio_settlements_company_version_fk') then
    alter table public.portfolio_monthly_settlements
      add constraint portfolio_settlements_company_version_fk
      foreign key (company_id, price_plan_version_id)
      references public.price_plan_versions(company_id, id)
      on delete restrict;
  end if;
end $$;

-- Explicit prices and fees cannot be negative or zero-priced final energy.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'portfolio_monthly_settlements_direct_price_check') then
    alter table public.portfolio_monthly_settlements
      add constraint portfolio_monthly_settlements_direct_price_check
      check (portfolio_price_ore_per_kwh is null or portfolio_price_ore_per_kwh > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'portfolio_monthly_settlements_management_fee_check') then
    alter table public.portfolio_monthly_settlements
      add constraint portfolio_monthly_settlements_management_fee_check
      check (management_fee_ore_per_kwh >= 0);
  end if;
end $$;

create or replace function public.gridex_save_portfolio_settlement_draft(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_portfolio_id uuid,
  p_price_area_code text,
  p_delivery_month date,
  p_price_plan_version_id uuid,
  p_gross_energy_cost_sek numeric default null,
  p_hedging_result_sek numeric default 0,
  p_balancing_cost_sek numeric default 0,
  p_other_allowed_cost_sek numeric default 0,
  p_energy_volume_kwh numeric default null,
  p_portfolio_price_ore_per_kwh numeric default null,
  p_management_fee_ore_per_kwh numeric default 0,
  p_source text default 'manual',
  p_idempotency_key text default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
  v_revision integer;
  v_permission text;
begin
  v_permission := case
    when p_source = 'import' then 'portfolio_settlement.import'
    else 'portfolio_settlement.create'
  end;
  perform public.gridex_assert_portfolio_permission(
    p_actor_user_id,
    v_permission,
    p_company_id,
    p_portfolio_id
  );

  if upper(p_price_area_code) not in ('SE1', 'SE2', 'SE3', 'SE4')
     or p_delivery_month <> date_trunc('month', p_delivery_month)::date then
    raise exception using errcode = '22023', message = 'invalid_portfolio_settlement_scope';
  end if;

  if p_portfolio_price_ore_per_kwh is not null and p_portfolio_price_ore_per_kwh <= 0 then
    raise exception using errcode = '22023', message = 'portfolio_price_must_be_positive';
  end if;
  if coalesce(p_management_fee_ore_per_kwh, 0) < 0 then
    raise exception using errcode = '22023', message = 'portfolio_management_fee_cannot_be_negative';
  end if;

  if not exists (
    select 1
    from public.portfolios p
    where p.id = p_portfolio_id
      and p.company_id = p_company_id
      and p.status = 'active'
  ) or not exists (
    select 1
    from public.price_plan_versions v
    join public.price_plans p
      on p.id = v.price_plan_id
     and p.company_id = v.company_id
    where v.id = p_price_plan_version_id
      and v.company_id = p_company_id
      and p.pricing_model in ('portfolio', 'mixed')
      and v.snapshot_json #>> '{portfolio_method,portfolio_id}' = p_portfolio_id::text
  ) then
    raise exception using errcode = '23514', message = 'portfolio_or_price_plan_version_scope_mismatch';
  end if;

  if p_idempotency_key is not null then
    select id
      into v_id
    from public.portfolio_monthly_settlements
    where company_id = p_company_id
      and idempotency_key = p_idempotency_key;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  if exists (
    select 1
    from public.portfolio_monthly_settlements
    where company_id = p_company_id
      and portfolio_id = p_portfolio_id
      and price_area_code = upper(p_price_area_code)
      and delivery_month = p_delivery_month
      and price_plan_version_id = p_price_plan_version_id
      and is_current
  ) then
    raise exception using errcode = '23505', message = 'portfolio_settlement_current_revision_exists';
  end if;

  select coalesce(max(revision_no), 0) + 1
    into v_revision
  from public.portfolio_monthly_settlements
  where company_id = p_company_id
    and portfolio_id = p_portfolio_id
    and price_area_code = upper(p_price_area_code)
    and delivery_month = p_delivery_month
    and price_plan_version_id = p_price_plan_version_id;

  insert into public.portfolio_monthly_settlements (
    company_id,
    portfolio_id,
    price_area_code,
    delivery_month,
    price_plan_version_id,
    revision_no,
    status,
    source,
    gross_energy_cost_sek,
    hedging_result_sek,
    balancing_cost_sek,
    other_allowed_cost_sek,
    energy_volume_kwh,
    portfolio_price_ore_per_kwh,
    management_fee_ore_per_kwh,
    idempotency_key,
    created_by
  ) values (
    p_company_id,
    p_portfolio_id,
    upper(p_price_area_code),
    p_delivery_month,
    p_price_plan_version_id,
    v_revision,
    'draft',
    p_source,
    p_gross_energy_cost_sek,
    coalesce(p_hedging_result_sek, 0),
    coalesce(p_balancing_cost_sek, 0),
    coalesce(p_other_allowed_cost_sek, 0),
    p_energy_volume_kwh,
    p_portfolio_price_ore_per_kwh,
    coalesce(p_management_fee_ore_per_kwh, 0),
    p_idempotency_key,
    p_actor_user_id
  ) returning id into v_id;

  return v_id;
end $$;

create or replace function public.gridex_transition_portfolio_settlement(
  p_actor_user_id uuid,
  p_settlement_id uuid,
  p_action text,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.portfolio_monthly_settlements%rowtype;
  v_price numeric;
  v_hash text;
  v_formula text;
  v_snapshot jsonb;
  v_now timestamptz := now();
begin
  select *
    into v_row
  from public.portfolio_monthly_settlements
  where id = p_settlement_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'portfolio_settlement_not_found';
  end if;

  perform set_config('gridex.portfolio_actor_user_id', p_actor_user_id::text, true);
  perform set_config('gridex.portfolio_audit_reason', coalesce(p_reason, ''), true);

  if p_action = 'calculate' then
    perform public.gridex_assert_portfolio_permission(
      p_actor_user_id,
      'portfolio_settlement.calculate',
      v_row.company_id,
      v_row.portfolio_id
    );

    if v_row.status not in ('draft', 'calculated') then
      raise exception using errcode = '23514', message = 'portfolio_settlement_must_be_draft_or_calculated';
    end if;

    if v_row.portfolio_price_ore_per_kwh is not null then
      if v_row.portfolio_price_ore_per_kwh <= 0 then
        raise exception using errcode = '23514', message = 'portfolio_settlement_direct_price_invalid';
      end if;
      v_price := v_row.portfolio_price_ore_per_kwh;
      v_formula := 'manual_portfolio_price_ore_per_kwh';
    else
      if v_row.gross_energy_cost_sek is null or coalesce(v_row.energy_volume_kwh, 0) <= 0 then
        raise exception using errcode = '23514', message = 'portfolio_settlement_calculation_inputs_missing';
      end if;
      v_price := (
        (
          v_row.gross_energy_cost_sek
          + v_row.hedging_result_sek
          + v_row.balancing_cost_sek
          + v_row.other_allowed_cost_sek
        ) / v_row.energy_volume_kwh
      ) * 100;
      v_formula := '((gross_energy_cost_sek + hedging_result_sek + balancing_cost_sek + other_allowed_cost_sek) / energy_volume_kwh) * 100';
    end if;

    v_snapshot := jsonb_build_object(
      'formula', v_formula,
      'source', v_row.source,
      'company_id', v_row.company_id,
      'portfolio_id', v_row.portfolio_id,
      'price_area_code', v_row.price_area_code,
      'delivery_month', v_row.delivery_month,
      'price_plan_version_id', v_row.price_plan_version_id,
      'revision_no', v_row.revision_no,
      'gross_energy_cost_sek', v_row.gross_energy_cost_sek,
      'hedging_result_sek', v_row.hedging_result_sek,
      'balancing_cost_sek', v_row.balancing_cost_sek,
      'other_allowed_cost_sek', v_row.other_allowed_cost_sek,
      'energy_volume_kwh', v_row.energy_volume_kwh,
      'management_fee_ore_per_kwh', v_row.management_fee_ore_per_kwh,
      'portfolio_price_ore_per_kwh', v_price,
      'vat_rate', v_row.vat_rate
    );
    v_hash := encode(
      extensions.digest(convert_to(v_snapshot::text, 'UTF8'), 'sha256'),
      'hex'
    );

    update public.portfolio_monthly_settlements
    set status = 'calculated',
        portfolio_price_ore_per_kwh = v_price,
        calculation_snapshot = v_snapshot,
        calculation_snapshot_sha256 = v_hash,
        calculated_by = p_actor_user_id,
        calculated_at = v_now,
        updated_at = v_now
    where id = v_row.id;

  elsif p_action = 'review' then
    perform public.gridex_assert_portfolio_permission(
      p_actor_user_id,
      'portfolio_settlement.review',
      v_row.company_id,
      v_row.portfolio_id
    );
    if v_row.status <> 'calculated' then
      raise exception using errcode = '23514', message = 'portfolio_settlement_must_be_calculated';
    end if;
    update public.portfolio_monthly_settlements
    set status = 'reviewed',
        reviewed_by = p_actor_user_id,
        reviewed_at = v_now,
        updated_at = v_now
    where id = v_row.id;

  elsif p_action = 'approve' then
    perform public.gridex_assert_portfolio_permission(
      p_actor_user_id,
      'portfolio_settlement.approve',
      v_row.company_id,
      v_row.portfolio_id
    );
    if v_row.status <> 'reviewed'
       or v_row.calculation_snapshot_sha256 is null
       or v_row.portfolio_price_ore_per_kwh is null then
      raise exception using errcode = '23514', message = 'portfolio_settlement_must_be_reviewed_and_calculated';
    end if;
    update public.portfolio_monthly_settlements
    set status = 'final',
        approved_by = p_actor_user_id,
        approved_at = v_now,
        updated_at = v_now
    where id = v_row.id;

  elsif p_action = 'lock' then
    perform public.gridex_assert_portfolio_permission(
      p_actor_user_id,
      'portfolio_settlement.lock',
      v_row.company_id,
      v_row.portfolio_id
    );
    if v_row.status <> 'final' then
      raise exception using errcode = '23514', message = 'portfolio_settlement_must_be_final';
    end if;
    update public.portfolio_monthly_settlements
    set status = 'locked',
        locked_by = p_actor_user_id,
        locked_at = v_now
    where id = v_row.id;

  else
    raise exception using errcode = '22023', message = 'unknown_portfolio_settlement_action';
  end if;

  return (
    select to_jsonb(s)
    from public.portfolio_monthly_settlements s
    where s.id = v_row.id
  );
end $$;

create or replace function public.gridex_save_portfolio_area_price_drafts(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_portfolio_id uuid,
  p_delivery_month date,
  p_price_plan_version_id uuid,
  p_area_prices jsonb,
  p_management_fee_ore_per_kwh numeric default 0,
  p_source text default 'manual',
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_area text;
  v_raw jsonb;
  v_price numeric;
  v_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_count integer := 0;
begin
  if not public.gridex_portfolio_actor_is_superadmin(p_actor_user_id) then
    raise exception using errcode = '42501', message = 'portfolio_superadmin_required';
  end if;
  if jsonb_typeof(coalesce(p_area_prices, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'portfolio_area_prices_object_required';
  end if;
  if p_delivery_month <> date_trunc('month', p_delivery_month)::date then
    raise exception using errcode = '22023', message = 'portfolio_delivery_month_must_be_first_day';
  end if;
  if coalesce(p_management_fee_ore_per_kwh, 0) < 0 then
    raise exception using errcode = '22023', message = 'portfolio_management_fee_cannot_be_negative';
  end if;
  if p_source not in ('manual', 'import') then
    raise exception using errcode = '22023', message = 'invalid_portfolio_settlement_source';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'portfolio_area_prices_idempotency_key_required';
  end if;

  foreach v_area in array array['SE1', 'SE2', 'SE3', 'SE4'] loop
    v_raw := p_area_prices -> v_area;
    if v_raw is null or v_raw = 'null'::jsonb then
      continue;
    end if;
    if jsonb_typeof(v_raw) <> 'number' then
      raise exception using errcode = '22023', message = 'portfolio_area_price_must_be_numeric', detail = v_area;
    end if;
    v_price := (v_raw #>> '{}')::numeric;
    if v_price <= 0 then
      raise exception using errcode = '22023', message = 'portfolio_area_price_must_be_positive', detail = v_area;
    end if;

    v_id := public.gridex_save_portfolio_settlement_draft(
      p_actor_user_id,
      p_company_id,
      p_portfolio_id,
      v_area,
      p_delivery_month,
      p_price_plan_version_id,
      null,
      0,
      0,
      0,
      null,
      v_price,
      coalesce(p_management_fee_ore_per_kwh, 0),
      p_source,
      btrim(p_idempotency_key) || ':' || lower(v_area)
    );
    v_results := v_results || jsonb_build_array(
      jsonb_build_object('price_area_code', v_area, 'settlement_id', v_id, 'price_ore_per_kwh', v_price)
    );
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception using errcode = '22023', message = 'at_least_one_portfolio_area_price_required';
  end if;

  return jsonb_build_object(
    'company_id', p_company_id,
    'portfolio_id', p_portfolio_id,
    'delivery_month', p_delivery_month,
    'price_plan_version_id', p_price_plan_version_id,
    'saved_count', v_count,
    'settlements', v_results
  );
end $$;

revoke execute on function public.gridex_save_portfolio_area_price_drafts(
  uuid, uuid, uuid, date, uuid, jsonb, numeric, text, text
) from public, anon, authenticated;
grant execute on function public.gridex_save_portfolio_area_price_drafts(
  uuid, uuid, uuid, date, uuid, jsonb, numeric, text, text
) to service_role;

comment on function public.gridex_save_portfolio_area_price_drafts(
  uuid, uuid, uuid, date, uuid, jsonb, numeric, text, text
) is 'Superadmin-only atomic save of one monthly portfolio price per supplied Swedish price area.';

commit;
