-- Batch O6.4 — Role-aware readiness and grid-owner cleanup
-- Production-safe, additive and idempotent.
-- Purpose:
--   * Supplier-switch readiness must only evaluate electricity grid owners.
--   * Gas, dummy/test actors, system suppliers and other market roles are shown separately.
--   * Missing PRODAT route remains manual review; the system must not invent routes.
--   * Certificate refresh candidates are limited to blocked electricity grid owners.

create extension if not exists pgcrypto with schema extensions;

alter table public.grid_owners add column if not exists electricity_scope_status text not null default 'electricity_scope_pending';
alter table public.grid_owners add column if not exists excluded_from_electricity_scope boolean not null default false;
alter table public.grid_owners add column if not exists manual_review_required boolean not null default false;
alter table public.grid_owners add column if not exists manual_review_reason text;

create index if not exists grid_owners_electricity_scope_status_idx
  on public.grid_owners(electricity_scope_status, excluded_from_electricity_scope, supplier_switch_ready, is_active);

-- Shared classifier used by all O6.4 views. Keep this as a view so dashboards and SQL checks
-- use the same role/scope rules as the runtime readiness update.
create or replace view public.actor_electricity_scope_classification_v
with (security_invoker = true)
as
with role_summary as (
  select
    r.actor_id,
    array_agg(distinct lower(r.actor_role) order by lower(r.actor_role)) as roles,
    bool_or(lower(r.actor_role) in ('grid_owner','network_owner','netowner','dso','distribution_system_operator','nätägare','elnatsforetag','elnätsföretag')) as has_grid_owner_role,
    bool_or(lower(r.actor_role) in ('electricity_supplier','power_supplier','supplier','elhandelsbolag','elleverantor','elleverantör')) as has_electricity_supplier_role,
    bool_or(lower(r.actor_role) in ('system_supplier','systemleverantor','systemleverantör')) as has_system_supplier_role,
    bool_or(lower(r.actor_role) in ('energy_service_company','energyservicecompany','esp','asp')) as has_energy_service_role,
    bool_or(lower(r.actor_role) in ('balance_responsible','balanceresponsible','balance_responsible_party','balanceresponsibleparty','brp','bsp','balansansvarig')) as has_balance_role,
    bool_or(lower(r.actor_role) in ('gas_grid_owner','gas_owner','gas_network_owner','gas_distribution_system_operator','gasnat','gasnät')) as has_gas_role
  from public.platform_actor_roles r
  where coalesce(r.is_active, true) = true
  group by r.actor_id
), actor_ids as (
  select
    i.actor_id,
    max(i.identifier_value) filter (where lower(i.identifier_type) in ('edielid','ediel_id','ediel')) as ediel_id,
    max(i.identifier_value) filter (where lower(i.identifier_type) in ('orgno','org_number','orgnr')) as org_number,
    max(i.identifier_value) filter (where lower(i.identifier_type) in ('eic','eic_code')) as eic
  from public.platform_actor_identifiers i
  group by i.actor_id
), route_scope as (
  select
    r.actor_id,
    bool_or(upper(r.message_family) in ('PRODAT','UTILTS') and coalesce(r.status,'') = 'active') as has_electricity_route,
    bool_or(upper(coalesce(r.subaddress,'')) = 'GAS' or upper(coalesce(r.application_reference,'')) like '%GAS%' or coalesce(r.metadata->>'scope','') in ('gas','gas_grid')) as has_gas_route
  from public.platform_actor_routes r
  group by r.actor_id
), classified as (
  select
    a.id as platform_market_actor_id,
    a.name as actor_name,
    a.legal_name,
    coalesce(ai.org_number, a.org_number) as org_number,
    ai.ediel_id,
    ai.eic,
    coalesce(rs.roles, '{}'::text[]) as roles,
    coalesce(rs.has_grid_owner_role, false) as has_grid_owner_role,
    coalesce(rs.has_electricity_supplier_role, false) as has_electricity_supplier_role,
    coalesce(rs.has_system_supplier_role, false) as has_system_supplier_role,
    coalesce(rs.has_energy_service_role, false) as has_energy_service_role,
    coalesce(rs.has_balance_role, false) as has_balance_role,
    coalesce(rs.has_gas_role, false)
      or coalesce(route_scope.has_gas_route, false)
      or lower(coalesce(a.name, '') || ' ' || coalesce(a.legal_name, '')) ~ '(^|[^a-zåäö0-9])(gas|gasnät|gasnat)([^a-zåäö0-9]|$)' as is_gas_actor,
    lower(coalesce(a.name, '') || ' ' || coalesce(a.legal_name, '')) ~ '(^|[^a-zåäö0-9])(dummy|test|testaktör|testaktor|testsystem)([^a-zåäö0-9]|$)' as is_dummy_or_test_actor,
    coalesce(route_scope.has_electricity_route, false) as has_electricity_route
  from public.platform_market_actors a
  left join role_summary rs on rs.actor_id = a.id
  left join actor_ids ai on ai.actor_id = a.id
  left join route_scope on route_scope.actor_id = a.id
)
select
  c.*,
  (c.has_system_supplier_role and not c.has_grid_owner_role and not c.has_electricity_supplier_role) as is_system_supplier_only,
  (
    c.has_grid_owner_role
    and not c.is_gas_actor
    and not c.is_dummy_or_test_actor
    and not (c.has_system_supplier_role and not c.has_grid_owner_role and not c.has_electricity_supplier_role)
  ) as is_electricity_grid_owner_scope,
  case
    when c.is_dummy_or_test_actor then 'dummy_or_test_excluded'
    when c.is_gas_actor then 'gas_grid_owner'
    when c.has_grid_owner_role then 'electricity_grid_owner'
    when c.has_electricity_supplier_role then 'electricity_supplier'
    when c.has_system_supplier_role then 'system_supplier'
    when c.has_energy_service_role then 'energy_service_company'
    when c.has_balance_role then 'balance_responsible'
    else 'other'
  end as primary_role_group,
  case
    when c.is_dummy_or_test_actor then 'excluded_from_electricity_scope'
    when c.is_gas_actor then 'excluded_from_electricity_scope'
    when c.has_grid_owner_role then 'in_electricity_supplier_switch_scope'
    else 'separate_role_scope'
  end as electricity_scope_status
from classified c;

comment on view public.actor_electricity_scope_classification_v is
  'O6.4 role/scope classifier. Supplier switch uses only non-gas, non-test, electricity grid owners; other roles are dashboard scope only.';

-- Rebuild actor_readiness_status with the same original column order and append O6.4 scope columns.
create or replace view public.actor_readiness_status
with (security_invoker = true)
as
with ids as (
  select
    actor_id,
    max(identifier_value) filter (where lower(identifier_type) in ('edielid','ediel_id')) as ediel_id,
    bool_or(coalesce(is_verified, false)) filter (where lower(identifier_type) in ('edielid','ediel_id')) as ediel_id_verified,
    max(identifier_value) filter (where lower(identifier_type) in ('orgno','org_number','orgnr')) as org_number,
    max(identifier_value) filter (where lower(identifier_type) in ('eic','eic_code')) as eic
  from public.platform_actor_identifiers
  group by actor_id
), roles as (
  select actor_id,
    array_agg(distinct lower(actor_role) order by lower(actor_role)) as roles,
    bool_or(lower(actor_role) in ('grid_owner','network_owner','netowner','dso','distribution_system_operator','nätägare','elnatsforetag','elnätsföretag')) as has_grid_owner_role,
    bool_or(lower(actor_role) in ('electricity_supplier','power_supplier','supplier','elhandelsbolag','balance_responsible','balansansvarig')) as has_supplier_role
  from public.platform_actor_roles
  where coalesce(is_active, true) = true
  group by actor_id
), routes as (
  select actor_id,
    count(*) filter (where upper(message_family)='PRODAT' and coalesce(status,'')='active' and coalesce(environment,'production') = 'production')::integer as prodat_route_count,
    count(*) filter (where upper(message_family)='UTILTS' and coalesce(status,'')='active' and coalesce(environment,'production') = 'production')::integer as utilts_route_count,
    bool_or(upper(message_family)='PRODAT' and coalesce(status,'')='active' and coalesce(environment,'production') = 'production' and coalesce(is_verified,false)) as has_prodat_route,
    bool_or(upper(message_family)='UTILTS' and coalesce(status,'')='active' and coalesce(environment,'production') = 'production' and coalesce(is_verified,false)) as has_utilts_route,
    bool_or(coalesce(status,'')='active' and coalesce(environment,'production') = 'production' and (nullif(btrim(coalesce(subaddress,'')), '') is not null or coalesce((metadata->>'subaddress_status'), '') = 'not_required_confirmed')) as has_safe_subaddress,
    bool_or(upper(message_family)='PRODAT' and coalesce(status,'')='active' and coalesce(environment,'production') = 'production' and (nullif(btrim(coalesce(subaddress,'')), '') is not null or coalesce((metadata->>'subaddress_status'), '') = 'not_required_confirmed')) as has_safe_prodat_subaddress,
    bool_or(upper(message_family)='UTILTS' and coalesce(status,'')='active' and coalesce(environment,'production') = 'production' and (nullif(btrim(coalesce(subaddress,'')), '') is not null or coalesce((metadata->>'subaddress_status'), '') = 'not_required_confirmed')) as has_safe_utilts_subaddress,
    bool_or(nullif(btrim(coalesce(communication_address,'')), '') is not null) as has_contact_path,
    bool_or(upper(message_family)='PRODAT' and nullif(btrim(coalesce(communication_address,'')), '') is not null) as has_prodat_contact_path,
    bool_or(upper(coalesce(subaddress,'')) = 'GAS' or upper(coalesce(application_reference,'')) like '%GAS%' or coalesce(metadata->>'scope','') in ('gas','gas_grid')) as has_gas_route
  from public.platform_actor_routes
  group by actor_id
), certs as (
  select distinct on (actor_id, environment, purpose)
    actor_id, environment, purpose, status, fingerprint_sha256, ediel_id, valid_to, raw_certificate_pem
  from public.platform_actor_certificates
  where environment = 'production'
    and purpose in ('encryption','signing')
    and coalesce(status, '') in ('valid','expires_soon')
    and valid_to is not null
    and valid_to > now()
    and nullif(btrim(coalesce(raw_certificate_pem,'')), '') is not null
  order by actor_id, environment, purpose, valid_to desc nulls last
), conflicts as (
  select actor_id, count(*)::integer as open_blocking_conflicts
  from public.actor_registry_conflicts
  where status = 'open' and severity = 'blocking' and actor_id is not null
  group by actor_id
), base as (
  select
    a.id as platform_market_actor_id,
    a.name as actor_name,
    a.legal_name,
    coalesce(ids.org_number, a.org_number) as org_number,
    ids.ediel_id,
    ids.eic,
    coalesce(roles.roles, '{}'::text[]) as roles,
    coalesce(roles.has_grid_owner_role, false) as has_grid_owner_role,
    coalesce(roles.has_supplier_role, false) as has_supplier_role,
    coalesce(routes.has_prodat_route, false) as has_prodat_route,
    coalesce(routes.has_utilts_route, false) as has_utilts_route,
    coalesce(routes.has_safe_subaddress, false) as has_safe_subaddress,
    coalesce(routes.has_contact_path, false) as has_contact_path,
    coalesce(certs.fingerprint_sha256 is not null and (certs.ediel_id is null or certs.ediel_id = ids.ediel_id), false) as has_valid_prodat_certificate,
    coalesce(certs.fingerprint_sha256 is not null and (certs.ediel_id is null or certs.ediel_id = ids.ediel_id), false) as has_valid_utilts_certificate,
    coalesce(conflicts.open_blocking_conflicts, 0) as open_blocking_conflicts,
    coalesce(routes.has_safe_prodat_subaddress, false) as has_safe_prodat_subaddress,
    coalesce(routes.has_prodat_contact_path, false) as has_prodat_contact_path,
    scope.is_gas_actor,
    scope.is_dummy_or_test_actor,
    scope.is_system_supplier_only,
    scope.is_electricity_grid_owner_scope,
    scope.primary_role_group,
    scope.electricity_scope_status
  from public.platform_market_actors a
  left join ids on ids.actor_id = a.id
  left join roles on roles.actor_id = a.id
  left join routes on routes.actor_id = a.id
  left join certs on certs.actor_id = a.id and certs.environment = 'production' and certs.purpose = 'encryption'
  left join conflicts on conflicts.actor_id = a.id
  left join public.actor_electricity_scope_classification_v scope on scope.platform_market_actor_id = a.id
)
select
  b.platform_market_actor_id,
  b.actor_name,
  b.legal_name,
  b.org_number,
  b.ediel_id,
  b.eic,
  b.roles,
  b.has_grid_owner_role,
  b.has_supplier_role,
  b.has_prodat_route,
  b.has_utilts_route,
  b.has_safe_subaddress,
  b.has_contact_path,
  b.has_valid_prodat_certificate,
  b.has_valid_utilts_certificate,
  b.open_blocking_conflicts,
  (
    b.ediel_id is not null
    and b.has_prodat_route
    and b.has_safe_prodat_subaddress
    and b.has_prodat_contact_path
    and b.has_valid_prodat_certificate
    and b.open_blocking_conflicts = 0
  ) as can_use_for_prodat,
  (
    b.ediel_id is not null
    and b.has_utilts_route
    and b.has_safe_subaddress
    and b.has_contact_path
    and b.open_blocking_conflicts = 0
  ) as can_use_for_utilts,
  (
    b.is_electricity_grid_owner_scope
    and b.ediel_id is not null
    and b.has_prodat_route
    and b.has_safe_prodat_subaddress
    and b.has_prodat_contact_path
    and b.has_valid_prodat_certificate
    and b.open_blocking_conflicts = 0
  ) as can_start_supplier_switch,
  case
    when coalesce(b.electricity_scope_status, '') = 'excluded_from_electricity_scope' then array['excluded_from_electricity_scope']::text[]
    when not coalesce(b.is_electricity_grid_owner_scope, false) then array_remove(array[
      case when b.has_grid_owner_role then null else 'not_electricity_grid_owner' end
    ], null)
    else array_remove(array[
      case when b.ediel_id is null then 'missing_ediel_id' end,
      case when not b.has_prodat_route then 'missing_prodat_route' end,
      case when b.has_prodat_route and not b.has_safe_prodat_subaddress then 'unsafe_or_missing_subaddress' end,
      case when b.has_prodat_route and not b.has_prodat_contact_path then 'missing_contact_path' end,
      case when b.has_prodat_route and not b.has_valid_prodat_certificate then 'missing_or_invalid_certificate' end,
      case when b.open_blocking_conflicts > 0 then 'open_blocking_conflicts' end
    ], null)
  end as blocking_reasons,
  now() as checked_at,
  coalesce(b.is_gas_actor, false) as is_gas_actor,
  coalesce(b.is_dummy_or_test_actor, false) as is_dummy_or_test_actor,
  coalesce(b.is_system_supplier_only, false) as is_system_supplier_only,
  coalesce(b.is_electricity_grid_owner_scope, false) as is_electricity_grid_owner_scope,
  coalesce(b.electricity_scope_status, 'separate_role_scope') as electricity_scope_status,
  coalesce(b.primary_role_group, 'other') as primary_role_group,
  case
    when coalesce(b.electricity_scope_status, '') = 'excluded_from_electricity_scope' then 'excluded_from_electricity_scope'
    when not coalesce(b.is_electricity_grid_owner_scope, false) then 'separate_role_scope'
    when b.ediel_id is not null and b.has_prodat_route and b.has_safe_prodat_subaddress and b.has_prodat_contact_path and b.has_valid_prodat_certificate and b.open_blocking_conflicts = 0 then 'ready'
    when not b.has_prodat_route then 'manual_review_required'
    when not b.has_valid_prodat_certificate then 'missing_or_invalid_certificate'
    when not b.has_safe_prodat_subaddress then 'unsafe_or_missing_subaddress'
    when not b.has_prodat_contact_path then 'missing_contact_path'
    when b.open_blocking_conflicts > 0 then 'open_blocking_conflicts'
    else 'manual_review_required'
  end as supplier_switch_readiness_status,
  (coalesce(b.is_electricity_grid_owner_scope, false) and not b.has_prodat_route) as manual_review_required,
  case when coalesce(b.is_electricity_grid_owner_scope, false) and not b.has_prodat_route then 'missing_prodat_route' else null end as manual_review_reason
from base b;

-- Role-specific operational views.
create or replace view public.grid_owner_supplier_switch_readiness_v
with (security_invoker = true)
as
select
  r.platform_market_actor_id,
  g.id as grid_owner_id,
  g.company_id,
  coalesce(g.name, r.actor_name) as actor_name,
  r.legal_name,
  coalesce(g.org_number, r.org_number) as org_number,
  coalesce(g.ediel_id, r.ediel_id) as ediel_id,
  r.roles,
  r.has_grid_owner_role,
  r.is_electricity_grid_owner_scope,
  r.is_gas_actor,
  r.is_dummy_or_test_actor,
  r.is_system_supplier_only,
  r.electricity_scope_status,
  r.supplier_switch_readiness_status,
  r.has_prodat_route,
  r.has_safe_subaddress,
  r.has_contact_path,
  r.has_valid_prodat_certificate,
  r.open_blocking_conflicts,
  r.can_use_for_prodat,
  r.can_use_for_utilts,
  r.can_start_supplier_switch,
  r.blocking_reasons,
  r.manual_review_required,
  r.manual_review_reason,
  ('missing_or_invalid_certificate' = any(r.blocking_reasons)) as missing_or_invalid_certificate,
  ('missing_prodat_route' = any(r.blocking_reasons)) as missing_prodat_route,
  ('unsafe_or_missing_subaddress' = any(r.blocking_reasons)) as unsafe_or_missing_subaddress,
  ('missing_contact_path' = any(r.blocking_reasons)) as missing_contact_path,
  ('missing_ediel_id' = any(r.blocking_reasons)) as missing_ediel_id,
  r.checked_at
from public.actor_readiness_status r
left join public.grid_owners g on g.platform_market_actor_id = r.platform_market_actor_id
where r.has_grid_owner_role = true;

create or replace view public.electricity_supplier_readiness_v
with (security_invoker = true)
as
select *
from public.actor_readiness_status
where primary_role_group = 'electricity_supplier';

create or replace view public.system_supplier_readiness_v
with (security_invoker = true)
as
select *
from public.actor_readiness_status
where primary_role_group = 'system_supplier';

create or replace view public.non_electricity_actor_readiness_v
with (security_invoker = true)
as
select *
from public.actor_readiness_status
where electricity_scope_status <> 'in_electricity_supplier_switch_scope';

create or replace view public.actor_readiness_by_role_v
with (security_invoker = true)
as
with grouped as (
  select
    primary_role_group as role_group,
    count(*)::integer as actor_count,
    count(*) filter (where can_start_supplier_switch)::integer as supplier_switch_ready_count,
    count(*) filter (where electricity_scope_status = 'excluded_from_electricity_scope')::integer as excluded_from_electricity_scope_count,
    count(*) filter (where supplier_switch_readiness_status = 'manual_review_required')::integer as manual_review_required_count,
    count(*) filter (where 'missing_or_invalid_certificate' = any(blocking_reasons))::integer as missing_or_invalid_certificate_count,
    count(*) filter (where 'missing_prodat_route' = any(blocking_reasons))::integer as missing_prodat_route_count,
    count(*) filter (where 'unsafe_or_missing_subaddress' = any(blocking_reasons))::integer as unsafe_or_missing_subaddress_count,
    count(*) filter (where 'missing_contact_path' = any(blocking_reasons))::integer as missing_contact_path_count,
    count(*) filter (where 'missing_ediel_id' = any(blocking_reasons))::integer as missing_ediel_id_count,
    count(*) filter (where 'open_blocking_conflicts' = any(blocking_reasons))::integer as open_blocking_conflicts_count
  from public.actor_readiness_status
  group by primary_role_group
)
select * from grouped;

-- Certificate refresh candidates for O6.4A: only electricity grid owners blocked by missing/invalid PRODAT certificate.
create or replace view public.ediel_blocked_grid_owner_certificate_refresh_candidates_v
with (security_invoker = true)
as
with route_candidates as (
  select distinct on (r.actor_id)
    r.actor_id as platform_market_actor_id,
    r.id as route_id,
    g.id as grid_owner_id,
    g.company_id,
    coalesce(g.ediel_id, ar.ediel_id, ids.ediel_id) as ediel_id,
    r.communication_address as smtp_email,
    r.subaddress,
    r.environment,
    c.status as certificate_status,
    c.next_check_at as certificate_next_check_at,
    c.fingerprint_sha256 as certificate_fingerprint_sha256
  from public.platform_actor_routes r
  join public.grid_owner_supplier_switch_readiness_v ar on ar.platform_market_actor_id = r.actor_id
  left join public.grid_owners g on g.platform_market_actor_id = r.actor_id
  left join (
    select actor_id, max(identifier_value) filter (where lower(identifier_type) in ('edielid','ediel_id','ediel')) as ediel_id
    from public.platform_actor_identifiers
    group by actor_id
  ) ids on ids.actor_id = r.actor_id
  left join public.platform_actor_certificates c
    on c.actor_id = r.actor_id
   and c.environment = coalesce(r.environment, 'production')
   and c.purpose = 'encryption'
  where ar.is_electricity_grid_owner_scope = true
    and ar.missing_or_invalid_certificate = true
    and ar.has_prodat_route = true
    and ar.has_contact_path = true
    and upper(r.message_family) = 'PRODAT'
    and coalesce(r.environment, 'production') = 'production'
    and coalesce(r.status, '') = 'active'
    and nullif(btrim(coalesce(r.communication_address, '')), '') is not null
    and (nullif(btrim(coalesce(r.subaddress, '')), '') is not null or coalesce(r.metadata->>'subaddress_status','') = 'not_required_confirmed')
    and upper(coalesce(r.subaddress,'')) <> 'GAS'
  order by r.actor_id, case when c.next_check_at is null then 0 else 1 end, c.next_check_at asc nulls first, r.updated_at desc
)
select
  platform_market_actor_id,
  route_id,
  grid_owner_id,
  company_id,
  ediel_id,
  smtp_email,
  subaddress,
  'production'::text as environment,
  'PRODAT'::text as message_family,
  certificate_status,
  certificate_next_check_at,
  certificate_fingerprint_sha256
from route_candidates;

-- Keep the old candidate name but make it role-aware so existing scheduled code cannot scan system suppliers/other roles.
create or replace view public.ediel_certificate_refresh_candidates_v
with (security_invoker = true)
as
select
  platform_market_actor_id,
  grid_owner_id,
  company_id,
  ediel_id,
  smtp_email,
  subaddress,
  environment,
  max(certificate_next_check_at) as last_checked_at,
  null::timestamptz as certificate_valid_to,
  coalesce(max(certificate_status), 'missing') as certificate_status
from public.ediel_blocked_grid_owner_certificate_refresh_candidates_v
group by platform_market_actor_id, grid_owner_id, company_id, ediel_id, smtp_email, subaddress, environment;

-- Update persisted grid-owner readiness from the role-aware actor view.
create or replace function public.gridex_recalculate_actor_readiness(p_platform_market_actor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grid_updated int := 0;
  v_supplier_updated int := 0;
begin
  update public.grid_owners g
  set verified_for_customer_flow = coalesce(r.can_start_supplier_switch, false),
      supplier_switch_ready = coalesce(r.can_start_supplier_switch, false),
      prodat_ready_for_customer_flow = coalesce(r.can_use_for_prodat, false),
      utilts_ready_for_metering_flow = coalesce(r.can_use_for_utilts, false),
      excluded_from_electricity_scope = coalesce(r.electricity_scope_status = 'excluded_from_electricity_scope', false),
      electricity_scope_status = coalesce(r.electricity_scope_status, 'separate_role_scope'),
      manual_review_required = coalesce(r.manual_review_required, false),
      manual_review_reason = r.manual_review_reason,
      actor_registry_status = case
        when coalesce(r.can_start_supplier_switch, false) then 'verified'
        when r.electricity_scope_status = 'excluded_from_electricity_scope' then 'excluded_from_electricity_scope'
        else 'under_review'
      end,
      verification_status = case
        when r.electricity_scope_status = 'excluded_from_electricity_scope' then 'excluded_from_electricity_scope'
        when coalesce(r.can_start_supplier_switch, false) then 'verified'
        when 'open_blocking_conflicts' = any(r.blocking_reasons) then 'unresolved_duplicate'
        when 'missing_prodat_route' = any(r.blocking_reasons) then 'needs_route'
        when 'missing_or_invalid_certificate' = any(r.blocking_reasons) then 'needs_certificate'
        when 'unsafe_or_missing_subaddress' = any(r.blocking_reasons) then 'needs_subaddress'
        when 'missing_contact_path' = any(r.blocking_reasons) then 'needs_contact'
        when 'missing_ediel_id' = any(r.blocking_reasons) then 'needs_ediel_id'
        else 'unknown'
      end,
      verification_reasons = coalesce(r.blocking_reasons, '{}'::text[]),
      verification_checked_at = now(),
      verified_at = case when coalesce(r.can_start_supplier_switch, false) then coalesce(g.verified_at, now()) else g.verified_at end,
      verification_metadata = coalesce(g.verification_metadata, '{}'::jsonb) || jsonb_build_object(
        'o6_4_role_aware_readiness_at', now(),
        'electricity_scope_status', r.electricity_scope_status,
        'primary_role_group', r.primary_role_group,
        'manual_review_required', r.manual_review_required,
        'manual_review_reason', r.manual_review_reason
      ),
      updated_at = now()
  from public.actor_readiness_status r
  where g.platform_market_actor_id = r.platform_market_actor_id
    and (p_platform_market_actor_id is null or r.platform_market_actor_id = p_platform_market_actor_id);
  get diagnostics v_grid_updated = row_count;

  if to_regclass('public.electricity_suppliers') is not null then
    update public.electricity_suppliers s
    set verified_for_customer_flow = coalesce(r.can_use_for_prodat, false),
        can_start_supplier_switch = coalesce(r.can_use_for_prodat, false),
        actor_registry_status = case when coalesce(r.can_use_for_prodat, false) then 'verified' else 'under_review' end,
        verification_status = case when coalesce(r.can_use_for_prodat, false) then 'verified' else 'needs_review' end,
        verification_reasons = coalesce(r.blocking_reasons, '{}'::text[]),
        verification_checked_at = now(),
        verification_metadata = coalesce(s.verification_metadata, '{}'::jsonb) || jsonb_build_object('readiness_checked_at', now(), 'o6_4_scope', r.primary_role_group)
    from public.actor_readiness_status r
    where s.platform_market_actor_id = r.platform_market_actor_id
      and (p_platform_market_actor_id is null or r.platform_market_actor_id = p_platform_market_actor_id);
    get diagnostics v_supplier_updated = row_count;
  end if;

  return jsonb_build_object('ok', true, 'grid_owners_updated', v_grid_updated, 'suppliers_updated', v_supplier_updated, 'batch', 'O6.4');
end;
$$;

-- OPS-facing grid-owner view rebuilt from role-aware readiness. Keep every O2 column in the
-- same order and append O6.4 columns at the end so Postgres can CREATE OR REPLACE safely.
create or replace view public.gridex_verified_grid_owners_v
with (security_invoker = true)
as
with actor_ids as (
  select
    i.actor_id,
    max(i.identifier_value) filter (where lower(i.identifier_type) in ('edielid','ediel_id')) as ediel_id,
    bool_or(coalesce(i.is_verified, false)) filter (where lower(i.identifier_type) in ('edielid','ediel_id')) as ediel_id_verified,
    max(i.identifier_value) filter (where lower(i.identifier_type) in ('orgno','org_number','orgnr')) as registry_org_number
  from public.platform_actor_identifiers i
  group by i.actor_id
), actor_roles as (
  select
    r.actor_id,
    array_agg(distinct lower(r.actor_role) order by lower(r.actor_role)) as roles,
    bool_or(lower(r.actor_role) in ('grid_owner','network_owner','netowner','dso','distribution_system_operator','nätägare','elnatsforetag','elnätsföretag')) as is_grid_owner
  from public.platform_actor_roles r
  where coalesce(r.is_active, true) = true
  group by r.actor_id
), route_summary as (
  select
    r.actor_id,
    count(*)::integer as route_count,
    count(*) filter (where upper(r.message_family) = 'PRODAT')::integer as prodat_route_count,
    count(*) filter (where upper(r.message_family) = 'UTILTS')::integer as utilts_route_count,
    bool_or(coalesce(r.status, '') = 'active' and coalesce(r.is_verified, false)) as has_verified_route,
    bool_or(upper(r.message_family) = 'PRODAT' and coalesce(r.status, '') = 'active' and coalesce(r.is_verified, false)) as has_verified_prodat_route,
    bool_or(upper(r.message_family) = 'UTILTS' and coalesce(r.status, '') = 'active' and coalesce(r.is_verified, false)) as has_verified_utilts_route,
    bool_or(coalesce(r.status, '') = 'active' and (nullif(btrim(coalesce(r.subaddress, '')), '') is not null or coalesce(r.metadata->>'subaddress_status','') = 'not_required_confirmed')) as has_subaddress,
    count(distinct nullif(btrim(coalesce(r.subaddress, '')), '')) filter (where upper(r.message_family) = 'PRODAT' and r.environment = 'production' and nullif(btrim(coalesce(r.subaddress, '')), '') is not null)::integer as prodat_subaddress_value_count,
    count(distinct nullif(btrim(coalesce(r.subaddress, '')), '')) filter (where upper(r.message_family) = 'UTILTS' and r.environment = 'production' and nullif(btrim(coalesce(r.subaddress, '')), '') is not null)::integer as utilts_subaddress_value_count,
    min(nullif(btrim(coalesce(r.subaddress, '')), '')) filter (where upper(r.message_family) = 'PRODAT' and r.environment = 'production' and nullif(btrim(coalesce(r.subaddress, '')), '') is not null) as suggested_prodat_subaddress,
    min(nullif(btrim(coalesce(r.subaddress, '')), '')) filter (where upper(r.message_family) = 'UTILTS' and r.environment = 'production' and nullif(btrim(coalesce(r.subaddress, '')), '') is not null) as suggested_utilts_subaddress,
    array_agg(distinct nullif(btrim(coalesce(r.subaddress, '')), '')) filter (where upper(r.message_family) = 'PRODAT' and r.environment = 'production' and nullif(btrim(coalesce(r.subaddress, '')), '') is not null) as possible_prodat_subaddresses,
    array_agg(distinct nullif(btrim(coalesce(r.subaddress, '')), '')) filter (where upper(r.message_family) = 'UTILTS' and r.environment = 'production' and nullif(btrim(coalesce(r.subaddress, '')), '') is not null) as possible_utilts_subaddresses,
    bool_or(nullif(btrim(coalesce(r.communication_address, '')), '') is not null) as has_route_contact,
    bool_or(r.environment = 'production') as has_production_route,
    bool_or(r.environment = 'test') as has_test_route,
    bool_or(upper(r.message_family) = 'PRODAT' and r.environment = 'production') as requires_certificate
  from public.platform_actor_routes r
  group by r.actor_id
), latest_cert as (
  select distinct on (c.actor_id, c.environment, c.purpose)
    c.actor_id,
    c.environment,
    c.purpose,
    c.status,
    c.fingerprint_sha256,
    c.ediel_id,
    c.valid_from,
    c.valid_to,
    c.updated_at,
    c.source
  from public.platform_actor_certificates c
  where c.purpose in ('encryption','signing')
  order by c.actor_id, c.environment, c.purpose,
    case c.status when 'valid' then 0 when 'expires_soon' then 1 when 'unknown' then 2 when 'missing' then 3 else 4 end,
    c.updated_at desc nulls last
), mapped as (
  select
    g.id as grid_owner_id,
    g.company_id,
    g.name,
    g.owner_code,
    coalesce(nullif(btrim(g.ediel_id), ''), ai.ediel_id, ready.ediel_id) as ediel_id,
    coalesce(nullif(btrim(g.org_number), ''), ai.registry_org_number, a.org_number, ready.org_number) as org_number,
    g.environment,
    g.lifecycle_status,
    g.default_prodat_subaddress,
    g.default_utilts_subaddress,
    g.communication_email,
    g.email,
    g.contact_name,
    g.phone,
    g.is_active,
    coalesce(g.platform_market_actor_id, a.id) as platform_market_actor_id,
    g.platform_grid_owner_id,
    coalesce(a.name, ready.actor_name) as actor_name,
    a.status as actor_status,
    a.match_status,
    coalesce(ready.roles, ar.roles, '{}'::text[]) as actor_roles,
    coalesce(ready.has_grid_owner_role, ar.is_grid_owner, false) as actor_is_grid_owner,
    coalesce(ai.ediel_id_verified, false) as ediel_id_verified,
    coalesce(rs.route_count, 0) as route_count,
    coalesce(rs.prodat_route_count, 0) as prodat_route_count,
    coalesce(rs.utilts_route_count, 0) as utilts_route_count,
    coalesce(rs.has_verified_route, false) as has_verified_route,
    coalesce(rs.has_subaddress, false)
      or nullif(btrim(coalesce(g.default_prodat_subaddress, g.default_utilts_subaddress, '')), '') is not null
      or coalesce(g.prodat_subaddress_status, '') = 'not_required_confirmed'
      or coalesce(g.utilts_subaddress_status, '') = 'not_required_confirmed' as has_subaddress,
    coalesce(ready.has_contact_path, rs.has_route_contact, false) or nullif(btrim(coalesce(g.communication_email, g.email, '')), '') is not null as has_contact_path,
    coalesce(rs.has_production_route, false) as has_production_route,
    coalesce(rs.has_test_route, false) as has_test_route,
    coalesce(rs.requires_certificate, false) as requires_certificate,
    lc.status as raw_certificate_status,
    lc.environment as certificate_environment,
    lc.fingerprint_sha256 as certificate_fingerprint_sha256,
    lc.ediel_id as certificate_ediel_id,
    lc.valid_to as certificate_valid_to,
    d.duplicate_key,
    coalesce(d.duplicate_count, 1) as duplicate_count,
    coalesce(rs.has_verified_prodat_route, false) as has_verified_prodat_route,
    coalesce(rs.has_verified_utilts_route, false) as has_verified_utilts_route,
    coalesce(rs.prodat_subaddress_value_count, 0) as prodat_subaddress_value_count,
    coalesce(rs.utilts_subaddress_value_count, 0) as utilts_subaddress_value_count,
    rs.suggested_prodat_subaddress,
    rs.suggested_utilts_subaddress,
    coalesce(rs.possible_prodat_subaddresses, '{}'::text[]) as possible_prodat_subaddresses,
    coalesce(rs.possible_utilts_subaddresses, '{}'::text[]) as possible_utilts_subaddresses,
    coalesce(g.prodat_subaddress_status, 'missing') as stored_prodat_subaddress_status,
    coalesce(g.utilts_subaddress_status, 'missing') as stored_utilts_subaddress_status,
    coalesce(g.prodat_subaddress_source, 'missing') as stored_prodat_subaddress_source,
    coalesce(g.utilts_subaddress_source, 'missing') as stored_utilts_subaddress_source,
    lc.source as certificate_source,
    coalesce(ready.electricity_scope_status, 'separate_role_scope') as electricity_scope_status,
    coalesce(ready.primary_role_group, 'other') as primary_role_group,
    coalesce(ready.supplier_switch_readiness_status, 'separate_role_scope') as supplier_switch_readiness_status,
    coalesce(ready.is_electricity_grid_owner_scope, false) as is_electricity_grid_owner_scope,
    coalesce(ready.manual_review_required, false) as manual_review_required,
    ready.manual_review_reason,
    coalesce(ready.blocking_reasons, '{}'::text[]) as role_blocking_reasons,
    coalesce(ready.can_use_for_prodat, false) as role_can_use_for_prodat,
    coalesce(ready.can_use_for_utilts, false) as role_can_use_for_utilts,
    coalesce(ready.can_start_supplier_switch, false) as role_can_start_supplier_switch,
    coalesce(ready.has_valid_prodat_certificate, false) as role_has_valid_prodat_certificate
  from public.grid_owners g
  left join public.platform_market_actors a
    on a.id = g.platform_market_actor_id
    or (nullif(btrim(g.ediel_id), '') is not null and exists (
      select 1 from public.platform_actor_identifiers i
      where i.actor_id = a.id and lower(i.identifier_type) in ('edielid','ediel_id') and i.identifier_value = g.ediel_id
    ))
    or (nullif(btrim(g.org_number), '') is not null and regexp_replace(coalesce(a.org_number,''), '\D', '', 'g') = regexp_replace(g.org_number, '\D', '', 'g'))
    or lower(regexp_replace(coalesce(a.name, ''), '\s+', ' ', 'g')) = lower(regexp_replace(coalesce(g.name, ''), '\s+', ' ', 'g'))
  left join actor_ids ai on ai.actor_id = coalesce(g.platform_market_actor_id, a.id)
  left join actor_roles ar on ar.actor_id = coalesce(g.platform_market_actor_id, a.id)
  left join route_summary rs on rs.actor_id = coalesce(g.platform_market_actor_id, a.id)
  left join latest_cert lc on lc.actor_id = coalesce(g.platform_market_actor_id, a.id) and lc.environment = coalesce(g.environment, 'production') and lc.purpose = 'encryption'
  left join public.gridex_grid_owner_duplicate_v d on d.grid_owner_id = g.id
  left join public.actor_readiness_status ready on ready.platform_market_actor_id = coalesce(g.platform_market_actor_id, a.id)
), evaluated as (
  select
    m.*,
    case
      when m.prodat_route_count = 0 then 'missing'
      when coalesce(m.default_prodat_subaddress, '') <> '' then 'verified'
      when m.stored_prodat_subaddress_status = 'not_required_confirmed' then 'not_required_confirmed'
      when m.prodat_subaddress_value_count = 1 then 'route_available'
      when m.prodat_subaddress_value_count > 1 then 'ambiguous'
      else 'missing'
    end as prodat_subaddress_status_evaluated,
    case
      when m.utilts_route_count = 0 then 'missing'
      when coalesce(m.default_utilts_subaddress, '') <> '' then 'verified'
      when m.stored_utilts_subaddress_status = 'not_required_confirmed' then 'not_required_confirmed'
      when m.utilts_subaddress_value_count = 1 then 'route_available'
      when m.utilts_subaddress_value_count > 1 then 'ambiguous'
      else 'missing'
    end as utilts_subaddress_status_evaluated,
    case
      when m.role_has_valid_prodat_certificate then true
      when m.raw_certificate_status in ('valid','expires_soon') and (m.certificate_ediel_id is null or m.certificate_ediel_id = m.ediel_id) then true
      else false
    end as certificate_is_usable
  from mapped m
)
select
  e.grid_owner_id,
  e.company_id,
  e.name,
  e.owner_code,
  e.ediel_id,
  e.org_number,
  e.environment,
  e.lifecycle_status,
  e.default_prodat_subaddress,
  e.default_utilts_subaddress,
  e.communication_email,
  e.email,
  e.contact_name,
  e.phone,
  e.is_active,
  e.platform_market_actor_id,
  e.platform_grid_owner_id,
  e.actor_name,
  e.actor_status,
  e.match_status,
  e.actor_roles,
  e.actor_is_grid_owner,
  e.ediel_id_verified,
  e.route_count,
  e.prodat_route_count,
  e.utilts_route_count,
  e.has_verified_route,
  ((e.prodat_route_count = 0 or e.prodat_subaddress_status_evaluated in ('verified','not_required_confirmed','route_available'))
    and (e.utilts_route_count = 0 or e.utilts_subaddress_status_evaluated in ('verified','not_required_confirmed','route_available'))) as has_subaddress,
  e.has_contact_path,
  e.has_production_route,
  e.has_test_route,
  e.requires_certificate,
  e.raw_certificate_status,
  e.certificate_environment,
  e.certificate_fingerprint_sha256,
  e.certificate_ediel_id,
  e.certificate_valid_to,
  e.duplicate_key,
  e.duplicate_count,
  case
    when e.electricity_scope_status = 'excluded_from_electricity_scope' then 'excluded_from_electricity_scope'
    when coalesce(e.duplicate_count, 1) > 1 then 'unresolved_duplicate'
    when 'missing_ediel_id' = any(e.role_blocking_reasons) then 'needs_ediel_id'
    when 'missing_prodat_route' = any(e.role_blocking_reasons) then 'needs_route'
    when 'unsafe_or_missing_subaddress' = any(e.role_blocking_reasons) then 'needs_subaddress'
    when 'missing_contact_path' = any(e.role_blocking_reasons) then 'needs_contact'
    when 'missing_or_invalid_certificate' = any(e.role_blocking_reasons) then 'needs_certificate'
    when 'open_blocking_conflicts' = any(e.role_blocking_reasons) then 'unresolved_duplicate'
    when e.role_can_start_supplier_switch then 'verified'
    when nullif(btrim(coalesce(e.ediel_id, '')), '') is null then 'needs_ediel_id'
    when coalesce(e.route_count, 0) = 0 or not e.has_verified_route then 'needs_route'
    when e.prodat_subaddress_status_evaluated = 'ambiguous' or e.utilts_subaddress_status_evaluated = 'ambiguous' then 'ambiguous_subaddress'
    when (e.prodat_route_count > 0 and e.prodat_subaddress_status_evaluated = 'missing') or (e.utilts_route_count > 0 and e.utilts_subaddress_status_evaluated = 'missing') then 'needs_subaddress'
    when not e.has_contact_path then 'needs_contact'
    when e.requires_certificate and not e.certificate_is_usable then 'needs_certificate'
    else 'verified'
  end as verification_status,
  case
    when e.certificate_is_usable then 'finns'
    when e.raw_certificate_status = 'expired' then 'utgånget'
    when e.raw_certificate_status = 'mismatch' then 'fel_mottagare'
    when e.raw_certificate_status is not null and e.certificate_environment is not null and e.certificate_environment <> coalesce(e.environment, 'production') then 'fel_miljö'
    else 'saknas'
  end as certificate_status,
  case
    when e.electricity_scope_status = 'excluded_from_electricity_scope' then array['excluded_from_electricity_scope']::text[]
    when array_length(e.role_blocking_reasons, 1) is not null then e.role_blocking_reasons
    else array_remove(array[
      case when coalesce(e.duplicate_count, 1) > 1 then 'unresolved_duplicate' end,
      case when nullif(btrim(coalesce(e.ediel_id, '')), '') is null then 'needs_ediel_id' end,
      case when coalesce(e.route_count, 0) = 0 or not e.has_verified_route then 'needs_route' end,
      case when e.prodat_subaddress_status_evaluated = 'ambiguous' or e.utilts_subaddress_status_evaluated = 'ambiguous' then 'ambiguous_subaddress' end,
      case when (e.prodat_route_count > 0 and e.prodat_subaddress_status_evaluated = 'missing') or (e.utilts_route_count > 0 and e.utilts_subaddress_status_evaluated = 'missing') then 'needs_subaddress' end,
      case when not e.has_contact_path then 'needs_contact' end,
      case when e.requires_certificate and not e.certificate_is_usable then 'needs_certificate' end,
      case when e.requires_certificate and e.certificate_ediel_id is not null and nullif(btrim(coalesce(e.ediel_id, '')), '') is not null and e.certificate_ediel_id <> e.ediel_id then 'certificate_ediel_mismatch' end
    ], null)
  end as verification_reasons,
  case
    when e.electricity_scope_status = 'excluded_from_electricity_scope' then 'excluded_from_electricity_scope'
    when coalesce(e.route_count, 0) > 0 and e.has_verified_route then 'verified'
    else 'needs_route'
  end as route_status,
  e.role_can_start_supplier_switch as verified_for_customer_flow,
  case
    when e.electricity_scope_status = 'excluded_from_electricity_scope' then 'excluded_from_electricity_scope'
    when e.role_can_start_supplier_switch then 'verified'
    when coalesce(e.duplicate_count, 1) > 1 then 'duplicate_review'
    when nullif(btrim(coalesce(e.ediel_id, '')), '') is null then 'missing_ediel_id'
    when e.actor_status = 'active' and (e.match_status = 'verified' or e.ediel_id_verified) then 'under_review'
    else 'under_review'
  end as actor_registry_status,
  case
    when e.electricity_scope_status = 'excluded_from_electricity_scope' then 'Exkluderad från elhandelns leverantörsbyte. Visas separat och blockerar inte elflödet.'
    when coalesce(e.duplicate_count, 1) > 1 then 'Granska dubbletter innan nätägaren används i kundflöde.'
    when 'missing_ediel_id' = any(e.role_blocking_reasons) or nullif(btrim(coalesce(e.ediel_id, '')), '') is null then 'Komplettera Ediel-ID.'
    when 'missing_prodat_route' = any(e.role_blocking_reasons) then 'Manuell review: PRODAT-route saknas i källa. Skapa inte gissad route.'
    when 'unsafe_or_missing_subaddress' = any(e.role_blocking_reasons) then 'Komplettera eller verifiera subadress enligt säker regel.'
    when 'missing_contact_path' = any(e.role_blocking_reasons) then 'Komplettera SMTP/kontaktväg.'
    when 'missing_or_invalid_certificate' = any(e.role_blocking_reasons) then 'Kör certifikatsökning eller verifiera mottagarcertifikat.'
    else 'Verifierad för kundflöde och Ediel-readiness.'
  end as next_action,
  -- O2 appended columns. Keep this exact order for CREATE OR REPLACE compatibility.
  e.has_verified_prodat_route,
  e.has_verified_utilts_route,
  e.prodat_subaddress_value_count,
  e.utilts_subaddress_value_count,
  e.suggested_prodat_subaddress,
  e.suggested_utilts_subaddress,
  e.possible_prodat_subaddresses,
  e.possible_utilts_subaddresses,
  case
    when e.prodat_route_count = 0 then 'missing'
    when e.prodat_subaddress_status_evaluated = 'route_available' then 'verified'
    else e.prodat_subaddress_status_evaluated
  end as prodat_subaddress_status,
  case
    when e.utilts_route_count = 0 then 'missing'
    when e.utilts_subaddress_status_evaluated = 'route_available' then 'verified'
    else e.utilts_subaddress_status_evaluated
  end as utilts_subaddress_status,
  case
    when nullif(btrim(coalesce(e.default_prodat_subaddress, '')), '') is not null then coalesce(nullif(e.stored_prodat_subaddress_source, 'missing'), 'manual_verified')
    when e.stored_prodat_subaddress_status = 'not_required_confirmed' then 'not_required_confirmed'
    when e.prodat_subaddress_value_count = 1 then 'route'
    when e.prodat_subaddress_value_count > 1 then 'ambiguous'
    else 'missing'
  end as prodat_subaddress_source,
  case
    when nullif(btrim(coalesce(e.default_utilts_subaddress, '')), '') is not null then coalesce(nullif(e.stored_utilts_subaddress_source, 'missing'), 'manual_verified')
    when e.stored_utilts_subaddress_status = 'not_required_confirmed' then 'not_required_confirmed'
    when e.utilts_subaddress_value_count = 1 then 'route'
    when e.utilts_subaddress_value_count > 1 then 'ambiguous'
    else 'missing'
  end as utilts_subaddress_source,
  e.role_can_use_for_prodat as can_use_for_prodat,
  e.role_can_use_for_utilts as can_use_for_utilts,
  e.role_can_start_supplier_switch as can_start_supplier_switch,
  e.certificate_source,
  -- O6.4 appended columns.
  e.electricity_scope_status,
  (e.electricity_scope_status = 'excluded_from_electricity_scope') as excluded_from_electricity_scope,
  e.manual_review_required,
  e.manual_review_reason,
  e.supplier_switch_readiness_status,
  e.primary_role_group,
  e.is_electricity_grid_owner_scope,
  e.role_blocking_reasons as role_aware_blocking_reasons
from evaluated e;

comment on view public.gridex_verified_grid_owners_v is
  'Canonical grid-owner verification view. Batch O6.4 adds role-aware supplier-switch scope without changing O2 column order; gas/test/system actors are excluded instead of shown as electricity blockers.';

-- Backfill persisted status and open non-duplicate review rows after installing the role-aware views.
select public.gridex_recalculate_actor_readiness(null::uuid);

insert into public.grid_owner_verification_reviews(grid_owner_id, platform_market_actor_id, issue_type, severity, status, message, metadata)
select
  v.grid_owner_id,
  v.platform_market_actor_id,
  coalesce(v.manual_review_reason, v.verification_status),
  case when v.excluded_from_electricity_scope then 'info' else 'blocking' end,
  'open',
  v.next_action,
  jsonb_build_object(
    'batch', 'O6.4',
    'electricity_scope_status', v.electricity_scope_status,
    'verification_reasons', v.verification_reasons,
    'manual_review_required', v.manual_review_required,
    'manual_review_reason', v.manual_review_reason
  )
from public.gridex_verified_grid_owners_v v
where (v.manual_review_required = true or v.verification_status in ('needs_certificate','needs_contact','needs_subaddress','needs_ediel_id','unresolved_duplicate','excluded_from_electricity_scope'))
  and not exists (
    select 1
    from public.grid_owner_verification_reviews r
    where r.grid_owner_id = v.grid_owner_id
      and r.issue_type = coalesce(v.manual_review_reason, v.verification_status)
      and r.status = 'open'
  );

grant select on
  public.actor_electricity_scope_classification_v,
  public.actor_readiness_status,
  public.actor_readiness_by_role_v,
  public.grid_owner_supplier_switch_readiness_v,
  public.electricity_supplier_readiness_v,
  public.system_supplier_readiness_v,
  public.non_electricity_actor_readiness_v,
  public.ediel_blocked_grid_owner_certificate_refresh_candidates_v,
  public.ediel_certificate_refresh_candidates_v,
  public.gridex_verified_grid_owners_v
to authenticated, service_role;

grant execute on function public.gridex_recalculate_actor_readiness(uuid) to authenticated, service_role;
