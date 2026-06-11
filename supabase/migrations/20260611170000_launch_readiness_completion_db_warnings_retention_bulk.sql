-- Batch 0-20 Launch Readiness completion
-- Adds DB warning visibility, stricter RLS/policy coverage, API rate-limit events,
-- supplier contact import tracking, blocker-reason statistics, billing launch readiness,
-- and retention/cleanup primitives. Idempotent and non-destructive.

create extension if not exists pgcrypto with schema extensions;

-- A) API rate-limit events and cooldown metadata.
alter table if exists public.integration_api_clients add column if not exists rate_limited_until timestamptz;
alter table if exists public.integration_api_clients add column if not exists consecutive_rate_limit_count integer not null default 0;

create table if not exists public.integration_api_rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  api_client_id uuid,
  route text,
  ip_address text,
  user_agent text,
  request_count integer not null default 0,
  limit_per_minute integer not null default 0,
  cooldown_until timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists integration_api_rate_limit_events_company_created_idx
  on public.integration_api_rate_limit_events(company_id, created_at desc);
create index if not exists integration_api_rate_limit_events_client_created_idx
  on public.integration_api_rate_limit_events(api_client_id, created_at desc);

alter table public.integration_api_rate_limit_events enable row level security;
revoke all on table public.integration_api_rate_limit_events from anon;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='integration_api_rate_limit_events' and policyname='integration_api_rate_limit_events_tenant_read') then
    create policy integration_api_rate_limit_events_tenant_read on public.integration_api_rate_limit_events
      for select using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='integration_api_rate_limit_events' and policyname='integration_api_rate_limit_events_service_write') then
    create policy integration_api_rate_limit_events_service_write on public.integration_api_rate_limit_events
      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;

-- B) Supplier contact import audit table for CSV runs and conflict summaries.
create table if not exists public.platform_actor_contact_import_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'csv',
  status text not null default 'completed' check (status in ('processing','completed','completed_with_issues','failed')),
  imported_count integer not null default 0,
  conflict_count integer not null default 0,
  missing_actor_count integer not null default 0,
  total_rows integer not null default 0,
  imported_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.platform_actor_contact_import_runs enable row level security;
revoke all on table public.platform_actor_contact_import_runs from anon;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_actor_contact_import_runs' and policyname='platform_actor_contact_import_runs_platform_read') then
    create policy platform_actor_contact_import_runs_platform_read on public.platform_actor_contact_import_runs
      for select using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_actor_contact_import_runs' and policyname='platform_actor_contact_import_runs_platform_write') then
    create policy platform_actor_contact_import_runs_platform_write on public.platform_actor_contact_import_runs
      for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin())
      with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
end $$;

-- C) Broader RLS/policy hardening for launch-critical company-scoped tables.
do $$
declare
  tbl text;
  has_company_id boolean;
begin
  foreach tbl in array array[
    'communication_logs','company_email_settings','company_email_templates','spot_price_intervals',
    'spot_price_monthly_summaries','normalized_metering_values','metering_values','pricing_runs','pricing_preview_lines',
    'price_plans','price_plan_versions','price_components','base_price_components','campaigns','campaign_versions',
    'contract_price_snapshots','billing_underlays','billing_underlay_items','integration_api_clients',
    'integration_api_requests','integration_api_rate_limit_events','domain_events','event_outbox','webhook_subscriptions',
    'webhook_deliveries','billing_provider_webhook_events','facility_data_quality_issues','ediel_business_errors',
    'supplier_switch_requests','supplier_switch_events','powers_of_attorney','customer_cases','customer_info_requests'
  ] loop
    if to_regclass('public.' || tbl) is not null then
      execute format('alter table public.%I enable row level security', tbl);
      execute format('revoke all on table public.%I from anon', tbl);

      select exists (
        select 1 from information_schema.columns
        where table_schema='public' and table_name=tbl and column_name='company_id'
      ) into has_company_id;

      if has_company_id then
        if not exists (select 1 from pg_policies where schemaname='public' and tablename=tbl and policyname='gridex_launch_tenant_read') then
          execute format('create policy gridex_launch_tenant_read on public.%I for select using (auth.role() = ''service_role'' or public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id))', tbl);
        end if;
        if not exists (select 1 from pg_policies where schemaname='public' and tablename=tbl and policyname='gridex_launch_service_write') then
          execute format('create policy gridex_launch_service_write on public.%I for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')', tbl);
        end if;
      else
        if not exists (select 1 from pg_policies where schemaname='public' and tablename=tbl and policyname='gridex_launch_platform_read') then
          execute format('create policy gridex_launch_platform_read on public.%I for select using (auth.role() = ''service_role'' or public.gridex_user_is_platform_admin())', tbl);
        end if;
        if not exists (select 1 from pg_policies where schemaname='public' and tablename=tbl and policyname='gridex_launch_platform_write') then
          execute format('create policy gridex_launch_platform_write on public.%I for all using (auth.role() = ''service_role'' or public.gridex_user_is_platform_admin()) with check (auth.role() = ''service_role'' or public.gridex_user_is_platform_admin())', tbl);
        end if;
      end if;
    end if;
  end loop;
end $$;

-- D) Function and view warning reduction. Revoke anon on public functions, keep authenticated only for safe RLS helpers.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature, p.proname, p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from anon', fn.signature);

    if fn.proname like 'gridex_can_%' or fn.proname like 'gridex_user_is_%' then
      execute format('grant execute on function %s to authenticated', fn.signature);
    elsif fn.prosecdef or fn.proname ilike '%admin%' or fn.proname ilike '%backfill%' or fn.proname ilike '%repair%' or fn.proname ilike '%import%' then
      execute format('revoke all on function %s from authenticated', fn.signature);
    end if;

    if fn.prosecdef then
      execute format('alter function %s set search_path = public', fn.signature);
    end if;
  end loop;
end $$;

do $$
declare
  view_name text;
begin
  foreach view_name in array array[
    'billing_readiness_flags','ediel_active_actor_settings_v','ediel_message_ack_state_v',
    'ediel_outbound_route_candidates_v','ediel_retry_candidates_v','ediel_route_runtime_v',
    'ediel_unresolved_messages','gridex_automation_control_center_v','gridex_user_auth_integrity_v',
    'gridex_route_readiness_v','gridex_company_operations_statistics_v','gridex_launch_error_summary_v'
  ] loop
    if to_regclass('public.' || view_name) is not null then
      execute format('alter view public.%I set (security_invoker = true)', view_name);
      execute format('revoke all on public.%I from anon', view_name);
    end if;
  end loop;
end $$;

-- E) DB warning visibility for superadmin/system health. This surfaces remaining Supabase lints instead of hiding them.
create or replace view public.gridex_launch_db_security_warnings_v
with (security_invoker = true)
as
select
  md5('rls_disabled:' || c.oid::text)::uuid as id,
  'critical'::text as severity,
  'rls_disabled'::text as warning_type,
  n.nspname as schema_name,
  c.relname as object_name,
  'table'::text as object_type,
  'RLS är avstängd på en public tabell som inte är explicit publik.'::text as message,
  'Aktivera RLS och lägg rätt tenant/platform/service policy.'::text as recommended_action,
  now() as created_at
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r','p')
  and c.relrowsecurity = false
  and c.relname not like 'pg_%'
  and c.relname not in ('schema_migrations','spatial_ref_sys')
union all
select
  md5('missing_policy:' || c.oid::text)::uuid as id,
  'warning'::text as severity,
  'rls_enabled_no_policy'::text as warning_type,
  n.nspname as schema_name,
  c.relname as object_name,
  'table'::text as object_type,
  'RLS är aktiverat men tabellen saknar policy. UI kan bli tomt eller krascha.'::text as message,
  'Klassificera tabellen som tenant-readable, platform-only eller service-only och lägg policy.'::text as recommended_action,
  now() as created_at
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r','p')
  and c.relrowsecurity = true
  and not exists (select 1 from pg_policy pol where pol.polrelid = c.oid)
union all
select
  md5('anon_table:' || c.oid::text)::uuid as id,
  'critical'::text as severity,
  'anon_table_access'::text as warning_type,
  n.nspname as schema_name,
  c.relname as object_name,
  'table'::text as object_type,
  'Anon har direkt privilegium på public tabell.'::text as message,
  'Revoke all from anon eller flytta läsning bakom server/API.'::text as recommended_action,
  now() as created_at
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r','p')
  and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'))
  and c.relname not in ('spot_price_monthly_summaries_public')
union all
select
  md5('anon_func:' || p.oid::text)::uuid as id,
  'critical'::text as severity,
  'anon_security_definer_execute'::text as warning_type,
  n.nspname as schema_name,
  p.proname as object_name,
  'function'::text as object_type,
  'Anon kan köra SECURITY DEFINER-funktion.'::text as message,
  'Revoke execute från anon och exponera bara säker server action/RPC.'::text as recommended_action,
  now() as created_at
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef = true
  and has_function_privilege('anon', p.oid, 'EXECUTE')
union all
select
  md5('view_definer:' || c.oid::text)::uuid as id,
  'warning'::text as severity,
  'view_not_security_invoker'::text as warning_type,
  n.nspname as schema_name,
  c.relname as object_name,
  'view'::text as object_type,
  'View saknar security_invoker=true och kan kringgå RLS beroende på Postgres/Supabase-inställning.'::text as message,
  'Sätt security_invoker=true eller lås vyn bakom server/service-role.'::text as recommended_action,
  now() as created_at
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('v','m')
  and not ('security_invoker=true' = any(coalesce(c.reloptions, array[]::text[])))
  and c.relname in (
    'billing_readiness_flags','ediel_active_actor_settings_v','ediel_message_ack_state_v',
    'ediel_outbound_route_candidates_v','ediel_retry_candidates_v','ediel_route_runtime_v',
    'ediel_unresolved_messages','gridex_automation_control_center_v','gridex_user_auth_integrity_v',
    'gridex_route_readiness_v','gridex_company_operations_statistics_v','gridex_launch_error_summary_v'
  );

revoke all on public.gridex_launch_db_security_warnings_v from anon;

-- F) Blocker reasons per company for dashboard: not just counts, but why launch/billing/switch is blocked.
create or replace view public.gridex_company_launch_blocker_reasons_v
with (security_invoker = true)
as
select c.id as company_id, 'missing_facility_id'::text as reason_key, 'Saknar anläggnings-ID'::text as reason_label,
  (select count(*) from public.customer_sites s where s.company_id = c.id and nullif(trim(coalesce(s.facility_id, '')), '') is null)::bigint as issue_count
from public.companies c
union all
select c.id, 'missing_grid_owner', 'Saknar verifierad nätägare',
  (select count(*) from public.customer_sites s where s.company_id = c.id and s.grid_owner_id is null)::bigint
from public.companies c
union all
select c.id, 'missing_grid_area', 'Saknar nätområdeskod',
  (select count(*) from public.customer_sites s where s.company_id = c.id and nullif(trim(coalesce(s.grid_area_code, '')), '') is null)::bigint
from public.companies c
union all
select c.id, 'missing_price_area_code', 'Saknar SE-område',
  (select count(*) from public.customer_sites s where s.company_id = c.id and nullif(trim(coalesce(s.price_area_code, '')), '') is null)::bigint
from public.companies c
union all
select c.id, 'missing_metering_identifier', 'Mätpunkt saknar identifierare',
  (select count(*) from public.metering_points m where m.company_id = c.id and nullif(trim(coalesce(m.metering_point_id, m.meter_point_id, '')), '') is null)::bigint
from public.companies c
union all
select c.id, 'missing_power_of_attorney', 'Saknar aktiv fullmakt',
  (select count(*) from public.supplier_switch_requests s where s.company_id = c.id and s.power_of_attorney_id is null and coalesce(s.status, '') not in ('completed','cancelled'))::bigint
from public.companies c
union all
select c.id, 'negative_aperak_or_z02', 'Negativ APERAK/Z02 olöst',
  (select count(*) from public.ediel_business_errors e where e.company_id = c.id and e.status not in ('resolved','ignored') and e.business_error in ('negative_aperak','z02_rejected','object_not_identified','facility_rejected'))::bigint
from public.companies c
union all
select c.id, 'billing_blocked', 'Fakturering blockerad',
  (select count(*) from public.billing_underlays b where b.company_id = c.id and coalesce(b.readiness_status, b.status) in ('blocked','failed','needs_review'))::bigint
from public.companies c;

revoke all on public.gridex_company_launch_blocker_reasons_v from anon;

-- G) Extend company statistics with required launch counters and blocker reasons.
-- IMPORTANT: this view already exists from the previous launch migration. PostgreSQL does not allow
-- CREATE OR REPLACE VIEW to rename/reorder existing columns. Keep the original column order intact
-- and append new launch counters at the end so the migration is safe to re-run on live databases.
create or replace view public.gridex_company_operations_statistics_v
with (security_invoker = true)
as
select
  c.id as company_id,
  c.name as company_name,
  (select count(*) from public.customers x where x.company_id = c.id) as customers_total,
  (select count(*) from public.customers x where x.company_id = c.id and x.created_at >= date_trunc('day', now())) as customers_today,
  (select count(*) from public.customers x where x.company_id = c.id and x.created_at >= now() - interval '7 days') as customers_last_7_days,
  (select count(*) from public.customers x where x.company_id = c.id and x.created_at >= date_trunc('month', now())) as customers_this_month,
  (select count(*) from public.customers x where x.company_id = c.id and x.status = 'active') as customers_active,
  (select count(*) from public.external_contract_intakes x where x.company_id = c.id) as web_intakes_total,
  (select count(*) from public.external_contract_intakes x where x.company_id = c.id and x.status = 'received') as web_intakes_received,
  (select count(*) from public.external_contract_intakes x where x.company_id = c.id and x.status = 'needs_review') as web_intakes_needs_review,
  (select count(*) from public.external_contract_intakes x where x.company_id = c.id and x.status = 'failed') as web_intakes_failed,
  (select count(*) from public.external_contract_intakes x where x.company_id = c.id and x.created_customer_id is not null) as web_intakes_with_customer,
  (select count(*) from public.external_contract_intakes x where x.company_id = c.id and x.created_site_id is not null) as web_intakes_with_site,
  (select count(*) from public.external_contract_intakes x where x.company_id = c.id and x.created_metering_point_id is not null) as web_intakes_with_metering_point,
  (select count(*) from public.external_contract_intakes x where x.company_id = c.id and x.created_contract_id is not null) as web_intakes_with_contract,
  (select count(*) from public.customer_sites x where x.company_id = c.id) as sites_total,
  (select count(*) from public.customer_sites x where x.company_id = c.id and x.grid_area_code is null) as sites_missing_grid_area,
  (select count(*) from public.customer_sites x where x.company_id = c.id and x.grid_owner_id is null) as sites_missing_grid_owner,
  (select count(*) from public.customer_sites x where x.company_id = c.id and x.price_area_code is null) as sites_missing_price_area_code,
  (select count(*) from public.metering_points x where x.company_id = c.id) as metering_points_total,
  (select count(*) from public.metering_points x where x.company_id = c.id and coalesce(x.metering_point_id, x.meter_point_id) is not null) as metering_points_with_identifier,
  (select count(*) from public.metering_points x where x.company_id = c.id and coalesce(x.metering_point_id, x.meter_point_id) is null) as metering_points_without_identifier,
  (select count(*) from public.customer_contracts x where x.company_id = c.id) as contracts_total,
  (select count(*) from public.billing_underlays x where x.company_id = c.id) as billing_underlays_total,
  (select count(*) from public.billing_underlays x where x.company_id = c.id and coalesce(x.readiness_status, x.status) in ('blocked','failed','needs_review')) as billing_blocked_or_failed,
  (select count(*) from public.ediel_messages x where x.company_id = c.id and x.direction = 'inbound') as ediel_inbound,
  (select count(*) from public.ediel_messages x where x.company_id = c.id and x.direction = 'outbound') as ediel_outbound,
  (select count(*) from public.ediel_messages x where x.company_id = c.id and x.status in ('failed','blocked','unresolved')) as ediel_blocked_failed_unresolved,
  (select count(*) from public.integration_api_requests x where x.company_id = c.id) as api_requests,
  (select count(*) from public.integration_api_requests x where x.company_id = c.id and coalesce(x.status_code, 200) >= 400) as api_errors,
  (select count(*) from public.webhook_deliveries x where x.company_id = c.id) as webhook_deliveries,
  (select count(*) from public.webhook_deliveries x where x.company_id = c.id and x.status in ('failed','dead','dead_letter','retrying')) as webhook_failures,

  -- New launch-readiness counters appended after the original view columns.
  (select coalesce(sum(issue_count),0) from public.gridex_company_launch_blocker_reasons_v r where r.company_id = c.id and r.issue_count > 0) as customers_blocked_or_data_issues,
  (select coalesce(jsonb_object_agg(reason_key, issue_count), '{}'::jsonb) from public.gridex_company_launch_blocker_reasons_v r where r.company_id = c.id and r.issue_count > 0) as blocker_reasons,
  (select count(*) from public.external_contract_intakes x where x.company_id = c.id and jsonb_typeof(x.issues) = 'array' and jsonb_array_length(x.issues) > 0) as web_intakes_with_issues,
  (select count(*) from public.metering_points x where x.company_id = c.id and coalesce(x.status, '') in ('verified','active')) as metering_points_verified,
  (select count(*) from public.metering_points x where x.company_id = c.id and (x.grid_owner_id is null or x.grid_area_code is null or x.price_area_code is null)) as metering_points_missing_market_data,
  (select count(*) from public.supplier_switch_requests x where x.company_id = c.id) as supplier_switch_requests_total,
  (select count(*) from public.supplier_switch_requests x where x.company_id = c.id and x.status in ('ready','ready_to_execute','queued_for_outbound')) as supplier_switch_ready,
  (select count(*) from public.supplier_switch_requests x where x.company_id = c.id and (x.status in ('blocked','failed','rejected') or x.lifecycle_blocked = true)) as supplier_switch_blocked_failed,
  (select count(*) from public.supplier_switch_requests x where x.company_id = c.id and x.status in ('confirmed','completed')) as supplier_switch_confirmed,
  (select count(*) from public.powers_of_attorney x where x.company_id = c.id and x.status in ('signed','accepted','active','completed')) as active_powers_of_attorney,
  (select count(*) from public.contract_price_snapshots x where x.company_id = c.id) as contract_price_snapshots_total,
  (select count(*) from public.ediel_business_errors x where x.company_id = c.id and x.status not in ('resolved','ignored')) as business_errors_open,
  (select count(*) from public.facility_data_quality_issues x where x.company_id = c.id and x.status not in ('resolved','ignored')) as facility_data_quality_issues_open,
  (select count(*) from public.communication_logs x where x.company_id = c.id) as communication_logs_total,
  (select count(*) from public.communication_logs x where x.company_id = c.id and x.status in ('failed','bounced')) as communication_logs_failed_bounced,
  (select count(*) from public.integration_api_rate_limit_events x where x.company_id = c.id) as api_rate_limit_events,
  (select count(*) from public.platform_actor_import_issues x where x.status = 'open') as platform_import_issues_open,
  (select count(*) from public.gridex_route_readiness_v x where x.readiness_status in ('critical_missing_route','recommended_missing_route','not_sendable','needs_review')) as route_missing_or_not_ready
from public.companies c;

revoke all on public.gridex_company_operations_statistics_v from anon;

-- H) Billing launch readiness: block invoices/exports on unverified or incomplete market/facility/pricing data.
create or replace view public.gridex_billing_launch_readiness_v
with (security_invoker = true)
as
select
  cc.company_id,
  cc.id as contract_id,
  cc.customer_id,
  coalesce(cc.customer_site_id, cc.site_id) as site_id,
  cc.metering_point_id,
  case
    when cs.id is null then 'blocked'
    when nullif(trim(coalesce(cs.facility_id, '')), '') is null then 'blocked'
    when cs.grid_owner_id is null then 'blocked'
    when nullif(trim(coalesce(cs.grid_area_code, '')), '') is null then 'blocked'
    when nullif(trim(coalesce(cs.price_area_code, cc.price_area_used, '')), '') is null then 'blocked'
    when cps.id is null then 'blocked'
    when cps.price_plan_version_id is null then 'blocked'
    when exists (select 1 from public.ediel_business_errors e where e.company_id = cc.company_id and e.customer_id = cc.customer_id and e.status not in ('resolved','ignored') and e.business_error in ('negative_aperak','z02_rejected','object_not_identified','facility_rejected')) then 'blocked'
    else 'ready'
  end as readiness_status,
  array_remove(array[
    case when cs.id is null then 'site_missing' end,
    case when cs.id is not null and nullif(trim(coalesce(cs.facility_id, '')), '') is null then 'facility_missing' end,
    case when cs.id is not null and cs.grid_owner_id is null then 'grid_owner_missing' end,
    case when cs.id is not null and nullif(trim(coalesce(cs.grid_area_code, '')), '') is null then 'grid_area_missing' end,
    case when cs.id is not null and nullif(trim(coalesce(cs.price_area_code, cc.price_area_used, '')), '') is null then 'price_area_missing' end,
    case when cps.id is null then 'contract_price_snapshot_missing' end,
    case when cps.id is not null and cps.price_plan_version_id is null then 'price_plan_version_missing' end,
    case when exists (select 1 from public.ediel_business_errors e where e.company_id = cc.company_id and e.customer_id = cc.customer_id and e.status not in ('resolved','ignored') and e.business_error in ('negative_aperak','z02_rejected','object_not_identified','facility_rejected')) then 'negative_market_response_open' end
  ], null) as blockers,
  now() as checked_at
from public.customer_contracts cc
left join public.customer_sites cs on cs.id = coalesce(cc.customer_site_id, cc.site_id) and cs.company_id = cc.company_id
left join lateral (
  select cps.*
  from public.contract_price_snapshots cps
  where cps.company_id = cc.company_id and cps.contract_id = cc.id
  order by cps.valid_from desc nulls last, cps.created_at desc
  limit 1
) cps on true;

revoke all on public.gridex_billing_launch_readiness_v from anon;

-- I) Retention/masking policy foundation and service-role cleanup function.
create table if not exists public.gridex_data_retention_policies (
  id uuid primary key default gen_random_uuid(),
  data_category text not null unique,
  retention_days integer not null check (retention_days between 1 and 3650),
  action text not null check (action in ('delete','mask','archive')),
  is_enabled boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.gridex_data_retention_policies(data_category, retention_days, action, notes)
values
  ('api_logs', 395, 'delete', 'Integration API logs retained for operations and audit, then deleted.'),
  ('webhook_logs', 395, 'delete', 'Webhook delivery logs retained for replay/audit, then deleted.'),
  ('billing_provider_webhooks', 730, 'mask', 'Billing provider raw payloads retained longer but masked.'),
  ('edifact_raw_payloads', 1095, 'archive', 'Raw EDIFACT retained for market audit and dispute handling.'),
  ('mail_failure_logs', 395, 'delete', 'Mail failure logs retained for troubleshooting.'),
  ('old_test_data', 90, 'delete', 'Old test/demo artifacts can be removed after regression baseline is safe.')
on conflict (data_category) do update set
  retention_days = excluded.retention_days,
  action = excluded.action,
  notes = excluded.notes,
  updated_at = now();

alter table public.gridex_data_retention_policies enable row level security;
revoke all on table public.gridex_data_retention_policies from anon;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='gridex_data_retention_policies' and policyname='gridex_data_retention_platform_read') then
    create policy gridex_data_retention_platform_read on public.gridex_data_retention_policies
      for select using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='gridex_data_retention_policies' and policyname='gridex_data_retention_service_write') then
    create policy gridex_data_retention_service_write on public.gridex_data_retention_policies
      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;

create or replace function public.gridex_mask_sensitive_payload(payload jsonb)
returns jsonb
language sql
stable
as $$
  select case
    when payload is null then '{}'::jsonb
    else payload
      - 'personal_number'
      - 'personnummer'
      - 'secret'
      - 'api_key'
      - 'token'
      - 'password'
      || jsonb_build_object('masked_by_retention', true, 'masked_at', now())
  end;
$$;

create or replace function public.gridex_run_launch_retention_cleanup(dry_run boolean default true)
returns table(data_category text, affected_rows bigint, action_taken text)
language plpgsql
security definer
set search_path = public
as $$
declare
  api_days integer;
  webhook_days integer;
  billing_days integer;
  mail_days integer;
  affected bigint;
begin
  if auth.role() <> 'service_role' and not public.gridex_user_is_platform_admin() then
    raise exception 'Only platform admin or service role may run retention cleanup';
  end if;

  select retention_days into api_days from public.gridex_data_retention_policies where data_category='api_logs' and is_enabled;
  if api_days is not null and to_regclass('public.integration_api_requests') is not null then
    if dry_run then
      execute 'select count(*) from public.integration_api_requests where created_at < now() - ($1::int * interval ''1 day'')' into affected using api_days;
    else
      execute 'delete from public.integration_api_requests where created_at < now() - ($1::int * interval ''1 day'')' using api_days;
      get diagnostics affected = row_count;
    end if;
    data_category := 'api_logs'; affected_rows := affected; action_taken := case when dry_run then 'dry_run_delete' else 'delete' end; return next;
  end if;

  select retention_days into webhook_days from public.gridex_data_retention_policies where data_category='webhook_logs' and is_enabled;
  if webhook_days is not null and to_regclass('public.webhook_deliveries') is not null then
    if dry_run then
      execute 'select count(*) from public.webhook_deliveries where created_at < now() - ($1::int * interval ''1 day'') and status in (''sent'',''dead_letter'',''skipped'')' into affected using webhook_days;
    else
      execute 'delete from public.webhook_deliveries where created_at < now() - ($1::int * interval ''1 day'') and status in (''sent'',''dead_letter'',''skipped'')' using webhook_days;
      get diagnostics affected = row_count;
    end if;
    data_category := 'webhook_logs'; affected_rows := affected; action_taken := case when dry_run then 'dry_run_delete' else 'delete' end; return next;
  end if;

  select retention_days into billing_days from public.gridex_data_retention_policies where data_category='billing_provider_webhooks' and is_enabled;
  if billing_days is not null and to_regclass('public.billing_provider_webhook_events') is not null then
    if dry_run then
      execute 'select count(*) from public.billing_provider_webhook_events where created_at < now() - ($1::int * interval ''1 day'')' into affected using billing_days;
    else
      execute 'update public.billing_provider_webhook_events set payload = public.gridex_mask_sensitive_payload(payload), metadata = coalesce(metadata,''{}''::jsonb) || jsonb_build_object(''masked_by_retention'', true, ''masked_at'', now()) where created_at < now() - ($1::int * interval ''1 day'')' using billing_days;
      get diagnostics affected = row_count;
    end if;
    data_category := 'billing_provider_webhooks'; affected_rows := affected; action_taken := case when dry_run then 'dry_run_mask' else 'mask' end; return next;
  end if;

  select retention_days into mail_days from public.gridex_data_retention_policies where data_category='mail_failure_logs' and is_enabled;
  if mail_days is not null and to_regclass('public.communication_logs') is not null then
    if dry_run then
      execute 'select count(*) from public.communication_logs where created_at < now() - ($1::int * interval ''1 day'') and status in (''failed'',''bounced'',''cancelled'')' into affected using mail_days;
    else
      execute 'delete from public.communication_logs where created_at < now() - ($1::int * interval ''1 day'') and status in (''failed'',''bounced'',''cancelled'')' using mail_days;
      get diagnostics affected = row_count;
    end if;
    data_category := 'mail_failure_logs'; affected_rows := affected; action_taken := case when dry_run then 'dry_run_delete' else 'delete' end; return next;
  end if;
end;
$$;

revoke all on function public.gridex_run_launch_retention_cleanup(boolean) from anon, authenticated;
grant execute on function public.gridex_run_launch_retention_cleanup(boolean) to service_role;

-- J) Complete normalized error summary across facility, Ediel, actor import, API, webhook, mail, route and billing blockers.
create or replace view public.gridex_launch_error_summary_v
with (security_invoker = true)
as
select
  f.company_id,
  f.id,
  'facility_data_quality_issues'::text as source_table,
  f.issue_type::text as error_key,
  f.status::text as status,
  f.severity::text as severity,
  f.recommended_action::text as recommended_action,
  f.customer_id,
  f.customer_site_id,
  f.metering_point_id,
  f.created_at
from public.facility_data_quality_issues f
where f.status not in ('resolved','ignored')
union all
select
  e.company_id,
  e.id,
  'ediel_business_errors'::text as source_table,
  e.business_error::text as error_key,
  e.status::text as status,
  case
    when e.status in ('resolved','ignored') then 'info'
    when e.retry_allowed = false and e.status = 'open' then 'critical'
    when e.business_error in ('object_not_identified','facility_rejected','negative_aperak','z02_rejected','protected_identity') then 'critical'
    when e.status like 'waiting_%' then 'warning'
    else 'warning'
  end as severity,
  e.recommended_action::text as recommended_action,
  e.customer_id,
  e.customer_site_id,
  e.metering_point_id,
  e.created_at
from public.ediel_business_errors e
where e.status not in ('resolved','ignored')
union all
select
  nullif((i.metadata->>'company_id'), '')::uuid as company_id,
  i.id,
  'platform_actor_import_issues'::text as source_table,
  i.issue_type::text as error_key,
  i.status::text as status,
  i.severity::text as severity,
  coalesce(i.message, 'Actor registry/import behöver granskas.')::text as recommended_action,
  null::uuid as customer_id,
  null::uuid as customer_site_id,
  null::uuid as metering_point_id,
  i.created_at
from public.platform_actor_import_issues i
where i.status not in ('resolved','ignored')
union all
select
  r.company_id,
  r.id,
  'integration_api_requests'::text as source_table,
  coalesce(r.error_code, 'api_error')::text as error_key,
  r.status_code::text as status,
  case when r.status_code >= 500 then 'critical' when r.status_code = 429 then 'warning' else 'warning' end as severity,
  case when r.status_code = 429 then 'Tjänsten svarar långsamt just nu. Försök igen senare eller hantera manuellt.' else 'Externt API-anrop misslyckades och behöver granskas.' end as recommended_action,
  null::uuid as customer_id,
  null::uuid as customer_site_id,
  null::uuid as metering_point_id,
  r.created_at
from public.integration_api_requests r
where coalesce(r.status_code, 200) >= 400
union all
select
  w.company_id,
  w.id,
  'webhook_deliveries'::text as source_table,
  coalesce(w.failure_reason, w.status, 'webhook_failed')::text as error_key,
  w.status::text as status,
  case when w.status = 'dead_letter' then 'critical' else 'warning' end as severity,
  'Webhookleverans misslyckades. Kontrollera endpoint, signering och retry-logg.'::text as recommended_action,
  null::uuid as customer_id,
  null::uuid as customer_site_id,
  null::uuid as metering_point_id,
  w.created_at
from public.webhook_deliveries w
where w.status in ('failed','dead_letter')
union all
select
  m.company_id,
  m.id,
  'communication_logs'::text as source_table,
  coalesce(m.error_message, m.status, 'mail_failed')::text as error_key,
  m.status::text as status,
  'warning'::text as severity,
  'Kundkommunikation misslyckades. Kontrollera bolagets mailidentitet, mall och mottagaradress.'::text as recommended_action,
  m.customer_id,
  null::uuid as customer_site_id,
  null::uuid as metering_point_id,
  m.created_at
from public.communication_logs m
where m.status in ('failed','bounced')
union all
select
  b.company_id,
  b.contract_id as id,
  'gridex_billing_launch_readiness_v'::text as source_table,
  array_to_string(b.blockers, ',')::text as error_key,
  b.readiness_status::text as status,
  'critical'::text as severity,
  'Fakturering är blockerad tills verifierad anläggning, nätägare, SE-område, pris-snapshot och marknadssvar är klara.'::text as recommended_action,
  b.customer_id,
  b.site_id as customer_site_id,
  b.metering_point_id,
  b.checked_at as created_at
from public.gridex_billing_launch_readiness_v b
where b.readiness_status = 'blocked'
union all
select
  rl.company_id,
  rl.id,
  'integration_api_rate_limit_events'::text as source_table,
  'rate_limited'::text as error_key,
  'rate_limited'::text as status,
  'warning'::text as severity,
  'Tjänsten svarar långsamt just nu. Försök igen senare eller hantera manuellt.'::text as recommended_action,
  null::uuid as customer_id,
  null::uuid as customer_site_id,
  null::uuid as metering_point_id,
  rl.created_at
from public.integration_api_rate_limit_events rl;

revoke all on public.gridex_launch_error_summary_v from anon;
