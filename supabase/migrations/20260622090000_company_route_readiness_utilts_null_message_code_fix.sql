-- Gridex company route readiness — null-safe message_code matching.
-- Safe/idempotent: only `create or replace view`, no schema/data changes.
--
-- Bug: the operational-route join compared
--   coalesce(cmpr.message_code, ...) = pr.message_code
-- For UTILTS (and any family whose message_code is null), pr.message_code is
-- null, so the predicate evaluated to `... = null` => UNKNOWN and the LEFT JOIN
-- never matched. That left UTILTS rows permanently at
-- operational_route_ready = false / blocker_code =
-- platform_route_exists_but_not_materialized even after a route was
-- materialized, and made route materialization postchecks always fail with
-- route_materialization_postcheck_failed for UTILTS.
--
-- Fix: normalize null/empty message_code to '' on BOTH sides of the comparison
-- so UTILTS/— matches when both sides are empty, while PRODAT/Z01 keeps matching
-- exactly. Test and production lanes stay separated by environment.

create or replace view public.gridex_company_route_readiness_v as
with company_sender as (
  select
    eas.id as sender_settings_id,
    eas.company_id,
    eas.environment,
    eas.ediel_id,
    eas.actor_ediel_id,
    eas.role,
    eas.actor_role,
    eas.market_roles,
    eas.production_send_lock_enabled,
    eas.first_production_send_approved,
    eas.is_active
  from public.ediel_actor_settings eas
  where eas.is_active = true
), grid_owner_actor as (
  select
    go.id as grid_owner_id,
    go.name as grid_owner_name,
    go.ediel_id as grid_owner_ediel_id,
    go.platform_market_actor_id,
    pma.id as platform_market_actor_id_resolved,
    pma.name as platform_actor_name,
    pma.status as platform_actor_status,
    pma.match_status
  from public.grid_owners go
  left join public.platform_market_actors pma on pma.id = go.platform_market_actor_id
  where coalesce(go.is_active, true) = true
), platform_routes as (
  select
    par.id as platform_actor_route_id,
    par.actor_id,
    par.message_family,
    coalesce(par.metadata->>'message_code', case when par.message_family = 'PRODAT' then 'Z01' else null end) as message_code,
    par.environment,
    par.communication_address,
    par.party_id,
    par.interchange_party_id,
    par.status,
    par.is_verified,
    par.auto_send_allowed
  from public.platform_actor_routes par
  where par.status = 'active'
), matrix as (
  select
    cs.company_id,
    goa.grid_owner_id,
    goa.grid_owner_name,
    goa.grid_owner_ediel_id,
    goa.platform_market_actor_id,
    pr.platform_actor_route_id,
    pr.message_family,
    pr.message_code,
    pr.environment,
    cs.sender_settings_id,
    cs.production_send_lock_enabled,
    cs.first_production_send_approved,
    cmpr.id as company_market_party_route_id,
    cmpr.communication_route_id as cmpr_communication_route_id,
    cmpr.route_profile_id as cmpr_route_profile_id
  from company_sender cs
  join grid_owner_actor goa on goa.platform_market_actor_id is not null
  join platform_routes pr on pr.actor_id = goa.platform_market_actor_id
    and pr.environment = cs.environment
    and pr.message_family in ('PRODAT', 'UTILTS')
  left join public.company_market_party_routes cmpr
    on cmpr.company_id = cs.company_id
   and cmpr.market_party_id = pr.actor_id
   and cmpr.message_family = pr.message_family
   and coalesce(cmpr.environment, cmpr.metadata->>'environment') = pr.environment
   and coalesce(nullif(cmpr.message_code, ''), nullif(cmpr.metadata->>'message_code', ''), case when pr.message_family = 'PRODAT' then 'Z01' else '' end) = coalesce(pr.message_code, '')
   and coalesce(cmpr.platform_actor_route_id::text, cmpr.metadata->>'platform_actor_route_id') = pr.platform_actor_route_id::text
   and cmpr.active = true
  where cs.environment in ('test', 'production')
), resolved as (
  select
    m.*,
    cr.id as communication_route_id,
    erp.id as ediel_route_profile_id,
    coalesce(cr.is_active, false) as communication_route_active,
    coalesce(erp.is_active, false) as profile_active,
    coalesce(erp.is_enabled, false) as profile_enabled,
    coalesce(erp.receiver_ediel_id, cr.counterparty_ediel_id, m.grid_owner_ediel_id) as receiver_ediel_id,
    erp.receiver_certificate_id,
    erp.security_policy_status
  from matrix m
  left join public.communication_routes cr on cr.id = m.cmpr_communication_route_id
  left join public.ediel_route_profiles erp on erp.id = m.cmpr_route_profile_id
)
select
  company_id,
  grid_owner_id,
  grid_owner_name,
  grid_owner_ediel_id,
  platform_market_actor_id,
  platform_actor_route_id,
  message_family,
  message_code,
  environment,
  true as actor_registry_ready,
  true as platform_route_ready,
  (company_market_party_route_id is not null and communication_route_active and profile_active and profile_enabled) as operational_route_ready,
  (
    company_market_party_route_id is not null
    and communication_route_active
    and profile_active
    and profile_enabled
    and not (environment = 'production' and coalesce(production_send_lock_enabled, false) = true and coalesce(first_production_send_approved, false) = false)
    and receiver_ediel_id is not null
  ) as send_ready,
  case
    when company_market_party_route_id is null then 'platform_route_exists_but_not_materialized'
    when not communication_route_active then 'communication_route_inactive'
    when not (profile_active and profile_enabled) then 'ediel_route_profile_inactive'
    when environment = 'production' and coalesce(production_send_lock_enabled, false) = true and coalesce(first_production_send_approved, false) = false then 'production_send_locked'
    when receiver_ediel_id is null then 'receiver_ediel_id_missing'
    else null
  end as blocker_code,
  case
    when company_market_party_route_id is null then 'Nätägaren är verifierad i aktörsregistret, men bolagets operativa route är inte materialiserad.'
    when environment = 'production' and coalesce(production_send_lock_enabled, false) = true and coalesce(first_production_send_approved, false) = false then 'Första produktionssändningen kräver platform-admins godkännande.'
    when receiver_ediel_id is null then 'Operativ route saknar mottagande Ediel-ID.'
    when not communication_route_active then 'Communication route är inaktiv.'
    when not (profile_active and profile_enabled) then 'Ediel route profile är inaktiv.'
    else 'Route är operativ och redo enligt grundkontroller.'
  end as readiness_message,
  communication_route_id,
  ediel_route_profile_id,
  company_market_party_route_id,
  sender_settings_id,
  case
    when environment = 'production' and coalesce(production_send_lock_enabled, false) = true and coalesce(first_production_send_approved, false) = false then 'locked'
    when environment = 'production' then 'approved'
    else 'not_applicable'
  end as production_send_lock_status
from resolved;
