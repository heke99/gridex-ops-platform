-- FINDINGS F85: a new supplier could never send Z03 to a grid owner in production.
--
-- The route engine sends Z03 on route_scope 'supplier_switch' and prefers the
-- grid owner's own route. A grid owner's registry PRODAT route (one
-- platform_actor_routes row per family, no metadata.message_code) only ever
-- yielded the Z01 readiness row, so only a 'customer_masterdata' operational
-- route was materialized, and Z03 fell back to the go-live wizard's route
-- without grid owner, receiver or confirmed subaddress, which can never become
-- production ready.
--
-- A registry PRODAT route now yields one readiness row per PRODAT scope the
-- supplier sends to the grid owner:
--   Z01 -> customer_masterdata (unchanged; also carries Z08)
--   Z03 -> supplier_switch     (new; also carries Z09)
-- The engine selects a route by scope only, so one code per scope keeps one
-- operational route and one profile per scope. Z13/Z18 are ESCO messages on
-- 23-DGI-PRODAT and are not a supplier scope. Z03 is offered only when the route
-- declares no Application Reference or Z03's own (23-DDQ-PRODAT). A route with
-- an explicit metadata.message_code keeps exactly that one row.
--
-- 1. The registry-route profile key gains message_code, so the Z01 and the Z03
--    profile of the same registry route can coexist. The new key is strictly
--    finer than the old one; like the original it is created only when no
--    existing rows collide.
-- 2. gridex_company_route_readiness_v: only the platform_routes CTE changes.
--    The column list, security_invoker and grants stay identical, so the
--    dependent views and gridex_materialize_company_operational_routes (which
--    already maps Z03 to supplier_switch) keep working unchanged.
-- No data is written; materialization stays an explicit platform-admin action.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP INDEX IF EXISTS public.ediel_route_profiles_platform_actor_route_uidx;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.ediel_route_profiles
    WHERE metadata ? 'platform_actor_route_id'
    GROUP BY company_id, metadata->>'platform_actor_route_id', environment, coalesce(message_family, ''), coalesce(message_code, '')
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX ediel_route_profiles_platform_actor_route_uidx
      ON public.ediel_route_profiles(
        company_id,
        ((metadata->>'platform_actor_route_id')),
        environment,
        coalesce(message_family, ''),
        coalesce(message_code, '')
      )
      WHERE metadata ? 'platform_actor_route_id';
  ELSE
    RAISE NOTICE 'ediel_route_profiles_platform_actor_route_uidx not created: existing registry-route profiles collide';
  END IF;
END $$;

CREATE OR REPLACE VIEW public.gridex_company_route_readiness_v
WITH (security_invoker = true)
AS
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
    scope_code.message_code,
    par.environment,
    par.communication_address,
    par.party_id,
    par.interchange_party_id,
    par.status,
    par.is_verified,
    par.auto_send_allowed
  from public.platform_actor_routes par
  cross join lateral (
    select coalesce(par.metadata->>'message_code', case when par.message_family = 'PRODAT' then 'Z01' else null end) as message_code
    union all
    select 'Z03'::text
    where par.message_family = 'PRODAT'
      and par.metadata->>'message_code' is null
      and upper(coalesce(nullif(btrim(par.application_reference), ''), '23-DDQ-PRODAT')) = '23-DDQ-PRODAT'
  ) scope_code
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

COMMIT;
