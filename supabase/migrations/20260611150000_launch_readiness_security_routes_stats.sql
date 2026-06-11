-- Batch 0-20 Launch Readiness hardening
-- Safe, idempotent migration: security, real schema compatibility, actor-route readiness,
-- supplier/manual contacts, normalized error summary and tenant-scoped operations stats.

create extension if not exists pgcrypto with schema extensions;

-- 1) admin_users must never be public or tenant-admin controlled.
do $$
begin
  if to_regclass('public.admin_users') is not null then
    execute 'alter table public.admin_users enable row level security';
    execute 'revoke all on table public.admin_users from anon';
    execute 'revoke insert, update, delete, truncate, references, trigger on table public.admin_users from authenticated';

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'admin_users' and policyname = 'admin_users_platform_admin_select'
    ) then
      execute 'create policy admin_users_platform_admin_select on public.admin_users for select using (auth.role() = ''service_role'' or public.gridex_user_is_platform_admin())';
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'admin_users' and policyname = 'admin_users_platform_admin_write'
    ) then
      execute 'create policy admin_users_platform_admin_write on public.admin_users for all using (auth.role() = ''service_role'' or public.gridex_user_is_platform_admin()) with check (auth.role() = ''service_role'' or public.gridex_user_is_platform_admin())';
    end if;
  end if;
end $$;

create table if not exists public.admin_users_audit_events (
  id uuid primary key default gen_random_uuid(),
  admin_user_id text,
  action text not null,
  actor_user_id uuid,
  old_row jsonb,
  new_row jsonb,
  created_at timestamptz not null default now()
);

alter table public.admin_users_audit_events enable row level security;
revoke all on table public.admin_users_audit_events from anon;
revoke insert, update, delete, truncate, references, trigger on table public.admin_users_audit_events from authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'admin_users_audit_events' and policyname = 'admin_users_audit_events_platform_read'
  ) then
    create policy admin_users_audit_events_platform_read on public.admin_users_audit_events
      for select using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'admin_users_audit_events' and policyname = 'admin_users_audit_events_service_write'
  ) then
    create policy admin_users_audit_events_service_write on public.admin_users_audit_events
      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;

create or replace function public.gridex_audit_admin_users_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_users_audit_events(admin_user_id, action, actor_user_id, old_row, new_row)
  values (
    case
      when tg_op = 'INSERT' then coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'user_id')
      when tg_op = 'UPDATE' then coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id', to_jsonb(new)->>'user_id', to_jsonb(old)->>'user_id')
      else coalesce(to_jsonb(old)->>'id', to_jsonb(old)->>'user_id')
    end,
    tg_op,
    auth.uid(),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.admin_users') is not null then
    if not exists (select 1 from pg_trigger where tgname = 'trg_admin_users_audit_events') then
      execute 'create trigger trg_admin_users_audit_events after insert or update or delete on public.admin_users for each row execute function public.gridex_audit_admin_users_change()';
    end if;
  end if;
end $$;

-- 2) Revoke unsafe function execution. Keep RLS helper functions callable by authenticated users,
-- but remove anon access and keep backfill/import/repair/admin RPCs service-only.
do $$
declare
  fn record;
begin
  for fn in
    select n.nspname, p.proname, p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname like 'backfill_%'
        or p.proname like 'gridex_db1_%'
        or p.proname like 'gridex_db3_%'
        or p.proname ilike '%import%'
        or p.proname ilike '%repair%'
        or p.proname ilike '%admin%'
        or p.proname ilike '%backfill%'
        or p.prosecdef
      )
  loop
    execute format('revoke all on function %s from anon', fn.signature);

    if fn.proname like 'backfill_%'
       or fn.proname like 'gridex_db1_%'
       or fn.proname like 'gridex_db3_%'
       or fn.proname ilike '%import%'
       or fn.proname ilike '%repair%'
       or fn.proname ilike '%backfill%'
       or fn.proname ilike '%admin%'
    then
      execute format('revoke all on function %s from authenticated', fn.signature);
    end if;

    if exists (select 1 from pg_proc p2 where p2.oid = fn.signature::regprocedure::oid and p2.prosecdef) then
      execute format('alter function %s set search_path = public', fn.signature);
    end if;
  end loop;
end $$;

-- 3) Security invoker / anon revokes on sensitive views.
do $$
declare
  view_name text;
begin
  foreach view_name in array array[
    'billing_readiness_flags',
    'ediel_active_actor_settings_v',
    'ediel_message_ack_state_v',
    'ediel_outbound_route_candidates_v',
    'ediel_retry_candidates_v',
    'ediel_route_runtime_v',
    'ediel_unresolved_messages',
    'gridex_automation_control_center_v',
    'gridex_user_auth_integrity_v'
  ] loop
    if to_regclass('public.' || view_name) is not null then
      execute format('alter view public.%I set (security_invoker = true)', view_name);
      execute format('revoke all on public.%I from anon', view_name);
    end if;
  end loop;
end $$;

-- 4) External intakes are the canonical website intake table. Extend safely.
alter table if exists public.external_contract_intakes add column if not exists external_customer_id text;
alter table if exists public.external_contract_intakes add column if not exists customer_number text;
alter table if exists public.external_contract_intakes add column if not exists source_channel text not null default 'public_contract_form';
alter table if exists public.external_contract_intakes add column if not exists created_customer_id uuid;
alter table if exists public.external_contract_intakes add column if not exists created_site_id uuid;
alter table if exists public.external_contract_intakes add column if not exists created_metering_point_id uuid;
alter table if exists public.external_contract_intakes add column if not exists created_contract_id uuid;
alter table if exists public.external_contract_intakes add column if not exists created_case_id uuid;
alter table if exists public.external_contract_intakes add column if not exists created_info_request_id uuid;
alter table if exists public.external_contract_intakes add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if to_regclass('public.external_contract_intakes') is not null then
    alter table public.external_contract_intakes drop constraint if exists external_contract_intakes_status_check;
    alter table public.external_contract_intakes
      add constraint external_contract_intakes_status_check check (status in (
        'received','processing','needs_review','created','partially_created','failed','duplicate','duplicate_ignored','cancelled'
      )) not valid;

    create index if not exists external_contract_intakes_company_status_created_idx
      on public.external_contract_intakes(company_id, status, created_at desc);
    create unique index if not exists external_contract_intakes_company_idempotency_uidx
      on public.external_contract_intakes(company_id, idempotency_key)
      where idempotency_key is not null;

    alter table public.external_contract_intakes enable row level security;
    revoke all on table public.external_contract_intakes from anon;
  end if;
end $$;

do $$
begin
  if to_regclass('public.external_contract_intakes') is not null then
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='external_contract_intakes' and policyname='external_contract_intakes_tenant_read_launch') then
      create policy external_contract_intakes_tenant_read_launch on public.external_contract_intakes
        for select using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='external_contract_intakes' and policyname='external_contract_intakes_service_write_launch') then
      create policy external_contract_intakes_service_write_launch on public.external_contract_intakes
        for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
    end if;
  end if;
end $$;

-- 5) Supplier/manual contact registry. Tenant-admins can create cases elsewhere, but masterdata is platform-controlled.
create table if not exists public.platform_actor_contacts (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.platform_market_actors(id) on delete cascade,
  contact_type text not null check (contact_type in ('general','switching','moving','customer_service','policy','complaint','poa','billing')),
  email text,
  phone text,
  contact_name text,
  channel text not null default 'email' check (channel in ('email','phone','portal','manual','other')),
  source text not null default 'manual',
  is_verified boolean not null default false,
  verified_by uuid,
  verified_at timestamptz,
  valid_from date,
  valid_to date,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_actor_contacts_email_or_phone check (email is not null or phone is not null)
);

create unique index if not exists platform_actor_contacts_uidx
  on public.platform_actor_contacts(actor_id, contact_type, coalesce(lower(email), ''), coalesce(phone, ''));
create index if not exists platform_actor_contacts_actor_idx on public.platform_actor_contacts(actor_id, contact_type, is_verified);

alter table public.platform_actor_contacts enable row level security;
revoke all on table public.platform_actor_contacts from anon;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_actor_contacts' and policyname='platform_actor_contacts_auth_read') then
    create policy platform_actor_contacts_auth_read on public.platform_actor_contacts
      for select using (auth.role() = 'service_role' or auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_actor_contacts' and policyname='platform_actor_contacts_platform_write') then
    create policy platform_actor_contacts_platform_write on public.platform_actor_contacts
      for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin())
      with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
end $$;

-- 6) Route readiness based on platform_actor_roles.actor_role and platform_actor_routes.
create or replace view public.gridex_route_readiness_v
with (security_invoker = true)
as
with required_families as (
  select * from (values
    ('grid_owner'::text, 'PRODAT'::text, 'critical'::text),
    ('grid_owner'::text, 'UTILTS'::text, 'recommended'::text),
    ('electricity_supplier'::text, 'CONTACT'::text, 'optional'::text),
    ('supplier'::text, 'CONTACT'::text, 'optional'::text),
    ('system_supplier'::text, 'NONE'::text, 'not_required'::text)
  ) as x(actor_role, message_family, requirement_level)
), actor_roles as (
  select a.id as actor_id, a.name, a.legal_name, a.org_number, a.status as actor_status,
         a.match_status, a.visible_to_tenants, r.actor_role
  from public.platform_market_actors a
  join public.platform_actor_roles r on r.actor_id = a.id and r.is_active = true
), expected as (
  select ar.*, rf.message_family, rf.requirement_level
  from actor_roles ar
  join required_families rf on rf.actor_role = ar.actor_role
), route_match as (
  select distinct on (e.actor_id, e.actor_role, e.message_family)
         e.actor_id,
         e.actor_role,
         e.message_family,
         pr.id as route_id,
         pr.application_reference,
         pr.environment,
         pr.subaddress,
         pr.communication_type,
         pr.communication_address,
         pr.edi_charset,
         pr.edi_syntax,
         pr.party_id,
         pr.interchange_party_id,
         pr.requires_poa,
         pr.is_verified,
         pr.auto_send_allowed,
         pr.status as route_status,
         pr.source as route_source,
         pr.updated_at as route_updated_at
  from expected e
  left join public.platform_actor_routes pr
    on pr.actor_id = e.actor_id
   and (
     upper(pr.message_family) = e.message_family
     or (e.message_family = 'CONTACT' and upper(coalesce(pr.message_family, '')) in ('CONTACT','MAIL','EMAIL'))
   )
  order by e.actor_id, e.actor_role, e.message_family,
           case when pr.status = 'active' then 0 else 1 end,
           case when pr.is_verified then 0 else 1 end,
           pr.updated_at desc nulls last
)
select
  coalesce(rm.route_id, e.actor_id) as id,
  e.actor_id,
  e.name as actor_name,
  e.legal_name,
  e.org_number,
  e.actor_status,
  e.match_status,
  e.visible_to_tenants,
  e.actor_role,
  e.message_family,
  e.requirement_level,
  rm.route_id,
  rm.application_reference,
  rm.environment,
  rm.subaddress,
  rm.communication_type,
  rm.communication_address,
  rm.edi_charset,
  rm.edi_syntax,
  rm.party_id,
  rm.interchange_party_id,
  rm.requires_poa,
  coalesce(rm.is_verified, false) as is_verified,
  coalesce(rm.auto_send_allowed, false) as auto_send_allowed,
  rm.route_status,
  rm.route_source,
  rm.route_updated_at,
  case
    when e.requirement_level = 'not_required' then 'not_required'
    when rm.route_id is null and e.actor_role = 'grid_owner' and e.message_family = 'PRODAT' then 'critical_missing_route'
    when rm.route_id is null and e.actor_role = 'grid_owner' and e.message_family = 'UTILTS' then 'recommended_missing_route'
    when rm.route_id is null then 'optional_missing_route'
    when nullif(trim(coalesce(rm.communication_address, '')), '') is null then 'not_sendable'
    when coalesce(rm.is_verified, false) = false or coalesce(rm.route_status, 'needs_review') <> 'active' then 'needs_review'
    when coalesce(rm.auto_send_allowed, false) then 'ready_auto_send_allowed'
    else 'ready_verified_manual_send'
  end as readiness_status,
  case
    when rm.route_id is null and e.actor_role = 'grid_owner' and e.message_family = 'PRODAT' then 'Lägg in och verifiera PRODAT-route innan leverantörsbyte/anläggningsdata skickas.'
    when rm.route_id is null and e.actor_role = 'grid_owner' and e.message_family = 'UTILTS' then 'Komplettera UTILTS-route innan automatiserade mätvärdesflöden används.'
    when rm.route_id is null then 'Skapa kontaktväg eller markera aktören som contact-only/not required.'
    when nullif(trim(coalesce(rm.communication_address, '')), '') is null then 'Komplettera kommunikationsadress innan sändning.'
    when coalesce(rm.is_verified, false) = false or coalesce(rm.route_status, 'needs_review') <> 'active' then 'Verifiera route. Auto-send slås inte på automatiskt.'
    when coalesce(rm.auto_send_allowed, false) then 'Autosändning är tillåten. Kontrollera audit/readiness.'
    else 'Verifierad för manuell sändning. Auto-send är medvetet av.'
  end as next_step
from expected e
left join route_match rm
  on rm.actor_id = e.actor_id
 and rm.actor_role = e.actor_role
 and rm.message_family = e.message_family;

revoke all on public.gridex_route_readiness_v from anon;

-- 7) Normalize error summary without assuming ediel_business_errors.severity exists.
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
union all
select
  e.company_id,
  e.id,
  'ediel_business_errors'::text as source_table,
  e.business_error::text as error_key,
  e.status::text as status,
  case
    when e.status in ('resolved','ignored') then 'info'
    when e.retry_allowed = false and e.status = 'open' then 'blocking'
    when e.business_error in ('object_not_identified','facility_rejected','negative_aperak','z02_rejected','protected_identity') then 'blocking'
    when e.status like 'waiting_%' then 'warning'
    else 'warning'
  end as severity,
  e.recommended_action::text as recommended_action,
  e.customer_id,
  e.customer_site_id,
  e.metering_point_id,
  e.created_at
from public.ediel_business_errors e
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
from public.platform_actor_import_issues i;

revoke all on public.gridex_launch_error_summary_v from anon;

-- 8) Tenant-scoped operations stats. Keep as invoker view; platform sees all through service/server code.
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
  (select count(*) from public.webhook_deliveries x where x.company_id = c.id and x.status in ('failed','dead','retrying')) as webhook_failures
from public.companies c;

revoke all on public.gridex_company_operations_statistics_v from anon;

-- 9) Hardening for other UI-read tables used by launch pages.
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'communication_logs','company_email_settings','company_email_templates','spot_price_intervals',
    'spot_price_monthly_summaries','normalized_metering_values','pricing_runs','pricing_preview_lines',
    'price_plans','price_plan_versions','price_components','contract_price_snapshots','billing_underlays',
    'billing_underlay_items','integration_api_clients','integration_api_requests','domain_events','event_outbox','webhook_deliveries','billing_provider_webhook_events'
  ] loop
    if to_regclass('public.' || tbl) is not null then
      execute format('alter table public.%I enable row level security', tbl);
      execute format('revoke all on public.%I from anon', tbl);
    end if;
  end loop;
end $$;
