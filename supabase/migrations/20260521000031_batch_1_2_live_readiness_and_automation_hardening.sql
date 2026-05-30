-- Batch 1 + 2: live readiness hardening, BRP in actor profile, tenant-safe actor view and automation/export guardrails.
-- Idempotent. This migration does not change approved PRODAT/UTILTS/APERAK/CONTRL generator facit.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Batch 1: Actor profile must carry BRP/eSett data directly, not only notes/company.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.ediel_actor_settings') is not null then
    alter table public.ediel_actor_settings add column if not exists brp_name text null;
    alter table public.ediel_actor_settings add column if not exists brp_ediel_id text null;
    alter table public.ediel_actor_settings add column if not exists brp_status text null default 'missing';
    alter table public.ediel_actor_settings add column if not exists esett_status text null default 'missing';
    alter table public.ediel_actor_settings add column if not exists valid_from date null;
    alter table public.ediel_actor_settings add column if not exists valid_to date null;

    create index if not exists ediel_actor_settings_company_env_role_active_idx
      on public.ediel_actor_settings(company_id, environment, actor_role, is_active, updated_at desc);

    create index if not exists ediel_actor_settings_brp_ediel_id_idx
      on public.ediel_actor_settings(brp_ediel_id)
      where brp_ediel_id is not null;

    comment on column public.ediel_actor_settings.brp_ediel_id is 'Balance responsible party Ediel ID for this tenant actor profile. Used for NAD+Z02 and live readiness. Must not be hardcoded in generators.';
  end if;
end $$;

-- Backfill actor BRP/eSett fields from companies and from legacy JSON notes.
do $$
begin
  if to_regclass('public.ediel_actor_settings') is not null and to_regclass('public.companies') is not null then
    update public.ediel_actor_settings eas
       set brp_name = coalesce(eas.brp_name, c.brp_name),
           brp_ediel_id = coalesce(
             eas.brp_ediel_id,
             nullif(eas.notes::jsonb ->> 'brpEdielId', ''),
             nullif(eas.notes::jsonb ->> 'balanceResponsibleEdielId', ''),
             c.brp_ediel_id
           ),
           brp_status = coalesce(nullif(eas.brp_status, ''), c.brp_status, 'missing'),
           esett_status = coalesce(nullif(eas.esett_status, ''), c.esett_status, 'missing'),
           updated_at = now()
      from public.companies c
     where eas.company_id = c.id;
  end if;
exception
  when invalid_text_representation then
    -- Some legacy notes are plain text. Keep migration safe and retry without JSON parsing.
    if to_regclass('public.ediel_actor_settings') is not null and to_regclass('public.companies') is not null then
      update public.ediel_actor_settings eas
         set brp_name = coalesce(eas.brp_name, c.brp_name),
             brp_ediel_id = coalesce(eas.brp_ediel_id, c.brp_ediel_id),
             brp_status = coalesce(nullif(eas.brp_status, ''), c.brp_status, 'missing'),
             esett_status = coalesce(nullif(eas.esett_status, ''), c.esett_status, 'missing'),
             updated_at = now()
        from public.companies c
       where eas.company_id = c.id;
    end if;
end $$;

-- Tenant-safe active actor view. The previous runtime shape picked one active actor per environment globally.
-- SaaS runtime must pick per company + environment + actor_role.
do $$
begin
  if to_regclass('public.ediel_actor_settings') is not null then
    execute $view$
      create or replace view public.ediel_active_actor_settings_v as
      select
        ranked.id,
        ranked.actor_name,
        ranked.actor_ediel_id,
        ranked.actor_role,
        ranked.environment,
        ranked.is_active,
        ranked.sender_name,
        ranked.sender_sub_address,
        ranked.default_application_reference,
        ranked.default_timezone,
        ranked.default_charset,
        ranked.default_test_flag,
        ranked.smtp_from_email,
        ranked.smtp_reply_to_email,
        ranked.mailbox,
        ranked.notes,
        ranked.created_at,
        ranked.updated_at,
        ranked.created_by,
        ranked.updated_by,
        ranked.runtime_rank,
        ranked.company_id,
        ranked.brp_name,
        ranked.brp_ediel_id,
        ranked.brp_status,
        ranked.esett_status,
        ranked.valid_from,
        ranked.valid_to
      from (
        select
          eas.*,
          row_number() over (
            partition by eas.company_id, eas.environment, eas.actor_role
            order by
              case when coalesce(eas.is_active, false) then 0 else 1 end,
              eas.updated_at desc nulls last,
              eas.created_at desc nulls last
          ) as runtime_rank
        from public.ediel_actor_settings eas
        where coalesce(eas.is_active, false) = true
      ) ranked
      where ranked.runtime_rank = 1
    $view$;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Batch 1: Company go-live review must have structured evidence, not only a long text blocker.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.company_go_live_reviews') is not null then
    alter table public.company_go_live_reviews add column if not exists metadata jsonb not null default '{}'::jsonb;
    alter table public.company_go_live_reviews add column if not exists approved_by uuid null references auth.users(id) on delete set null;
    alter table public.company_go_live_reviews add column if not exists approved_at timestamptz null;

    create index if not exists company_go_live_reviews_status_idx
      on public.company_go_live_reviews(company_id, status, created_at desc);
  end if;
end $$;

-- SQL-level readiness summary used by superadmin/control tower and safe manual checks.
create or replace function public.gridex_company_go_live_readiness(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c record;
  blockers text[] := array[]::text[];
  prodat_total integer := 6;
  utilts_total integer := 5;
  prodat_passed integer := 0;
  utilts_passed integer := 0;
  has_prod_actor boolean := false;
  has_prod_route boolean := false;
  has_test_route boolean := false;
begin
  select * into c from public.companies where id = p_company_id;
  if not found then
    return jsonb_build_object('status', 'missing_company', 'blockers', jsonb_build_array('Bolaget hittades inte'));
  end if;

  select exists (
    select 1 from public.ediel_actor_settings eas
    where eas.company_id = p_company_id
      and eas.environment = 'production'
      and coalesce(eas.is_active, false) = true
  ) into has_prod_actor;

  select exists (
    select 1 from public.ediel_route_profiles erp
    where erp.company_id = p_company_id
      and erp.environment = 'production'
      and coalesce(erp.is_enabled, false) = true
  ) into has_prod_route;

  select exists (
    select 1 from public.ediel_route_profiles erp
    where erp.company_id = p_company_id
      and erp.environment = 'test'
      and coalesce(erp.is_enabled, false) = true
  ) into has_test_route;

  if to_regclass('public.actor_test_results') is not null then
    select count(*) filter (where package_key = 'PRODAT_SUPPLIER' and status in ('passed', 'manual_verified')),
           count(*) filter (where package_key = 'UTILTS_METERING' and status in ('passed', 'manual_verified'))
      into prodat_passed, utilts_passed
    from public.actor_test_results
    where company_id = p_company_id;
  end if;

  if nullif(c.org_number, '') is null then blockers := array_append(blockers, 'Orgnummer saknas'); end if;
  if nullif(coalesce(c.production_ediel_id, c.ediel_id), '') is null then blockers := array_append(blockers, 'Produktions Ediel-id saknas'); end if;
  if nullif(coalesce(c.market_role, c.actor_role), '') is null then blockers := array_append(blockers, 'Marknadsroll saknas'); end if;
  if nullif(c.brp_ediel_id, '') is null then blockers := array_append(blockers, 'BRP Ediel-id saknas'); end if;
  if coalesce(c.brp_status, 'missing') <> 'active' then blockers := array_append(blockers, 'BRP är inte markerad som aktiv'); end if;
  if coalesce(c.esett_status, 'missing') <> 'ready' then blockers := array_append(blockers, 'eSett-status är inte klar'); end if;
  if not has_prod_actor then blockers := array_append(blockers, 'Aktiv produktionsaktörsprofil saknas'); end if;
  if not has_prod_route then blockers := array_append(blockers, 'Produktionsroute saknas'); end if;
  if not has_test_route then blockers := array_append(blockers, 'Test-route saknas'); end if;
  if nullif(c.production_mailbox, '') is null then blockers := array_append(blockers, 'Produktionsmailbox/SMTP saknas'); end if;
  if nullif(c.production_application_reference, '') is null then blockers := array_append(blockers, 'Produktions Application Reference saknas'); end if;
  if nullif(c.production_counterparty_ediel_id, '') is null then blockers := array_append(blockers, 'Produktionsmotpart saknas'); end if;
  if prodat_passed < prodat_total then blockers := array_append(blockers, format('PRODAT-tester ej kompletta (%s/%s)', prodat_passed, prodat_total)); end if;
  if utilts_passed < utilts_total then blockers := array_append(blockers, format('UTILTS-tester ej kompletta (%s/%s)', utilts_passed, utilts_total)); end if;

  return jsonb_build_object(
    'company_id', p_company_id,
    'status', case when array_length(blockers, 1) is null then 'ready' else 'blocked' end,
    'blockers', to_jsonb(blockers),
    'prodat_passed', prodat_passed,
    'prodat_total', prodat_total,
    'utilts_passed', utilts_passed,
    'utilts_total', utilts_total,
    'has_production_actor', has_prod_actor,
    'has_production_route', has_prod_route,
    'has_test_route', has_test_route
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Batch 2: Operational/automation views. These are read-only foundations for UI
-- and export/automation, and they avoid blocking whole billing exports when only
-- individual rows have blockers.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.billing_export_runs') is not null then
    alter table public.billing_export_runs add column if not exists metadata jsonb not null default '{}'::jsonb;
    create index if not exists billing_export_runs_company_period_idx
      on public.billing_export_runs(company_id, period_month, created_at desc);
  end if;

  if to_regclass('public.billing_export_run_items') is not null then
    create index if not exists billing_export_run_items_company_status_idx
      on public.billing_export_run_items(company_id, status, billing_export_run_id);
  end if;

  if to_regclass('public.partner_exports') is not null then
    create index if not exists partner_exports_company_status_idx
      on public.partner_exports(company_id, status, created_at desc);
    create index if not exists partner_exports_batch_key_idx
      on public.partner_exports(company_id, export_batch_key)
      where export_batch_key is not null;
  end if;
end $$;

do $$
begin
  if to_regclass('public.companies') is not null
     and to_regclass('public.customer_cases') is not null
     and to_regclass('public.outbound_requests') is not null
     and to_regclass('public.billing_export_run_items') is not null
     and to_regclass('public.partner_exports') is not null then
    execute $view$
      create or replace view public.gridex_automation_control_center_v as
      select
        c.id as company_id,
        c.name as company_name,
        coalesce(c.status, 'active') as company_status,
        coalesce(c.production_status, 'not_ready') as production_status,
        coalesce(c.live_ediel_enabled, false) as live_ediel_enabled,
        coalesce((public.gridex_company_go_live_readiness(c.id)->>'status'), 'blocked') as go_live_readiness,
        coalesce((select count(*) from public.customer_cases cc where cc.company_id = c.id and coalesce(cc.status, '') not in ('closed', 'resolved')), 0) as open_case_count,
        coalesce((select count(*) from public.outbound_requests o where o.company_id = c.id and coalesce(o.status, '') in ('draft', 'queued', 'failed', 'blocked')), 0) as unresolved_outbound_count,
        coalesce((select count(*) from public.billing_export_run_items bei where bei.company_id = c.id and bei.status = 'blocked'), 0) as blocked_billing_rows,
        coalesce((select count(*) from public.partner_exports pe where pe.company_id = c.id and coalesce(pe.status, '') in ('failed', 'blocked')), 0) as failed_partner_exports,
        c.updated_at
      from public.companies c
      where coalesce(c.status, '') <> 'deleted_test_only'
    $view$;
  end if;
end $$;

-- RLS hardening for core new operational tables. Existing policies are replaced safely.
do $$
begin
  if to_regclass('public.actor_test_results') is not null then
    alter table public.actor_test_results enable row level security;
    drop policy if exists actor_test_results_select on public.actor_test_results;
    drop policy if exists actor_test_results_write on public.actor_test_results;
    create policy actor_test_results_select on public.actor_test_results
      for select using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
    create policy actor_test_results_write on public.actor_test_results
      for all using (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id))
      with check (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id));
  end if;

  if to_regclass('public.company_go_live_reviews') is not null then
    alter table public.company_go_live_reviews enable row level security;
    drop policy if exists company_go_live_reviews_select on public.company_go_live_reviews;
    drop policy if exists company_go_live_reviews_write on public.company_go_live_reviews;
    create policy company_go_live_reviews_select on public.company_go_live_reviews
      for select using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
    create policy company_go_live_reviews_write on public.company_go_live_reviews
      for all using (public.gridex_user_is_platform_admin())
      with check (public.gridex_user_is_platform_admin());
  end if;
end $$;
