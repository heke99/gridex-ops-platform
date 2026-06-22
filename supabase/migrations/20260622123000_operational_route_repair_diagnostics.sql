-- Operational route repair + diagnostics.
-- Safe/idempotent. No business data is deleted. Provides:
--   1) Re-run of metadata -> real column backfill for company_market_party_routes
--      (covers rows written before the identity columns existed).
--   2) A diagnostics view of operational-route drift/orphans for repair tooling.

-- 1) Idempotent backfill of identity columns from metadata.
update public.company_market_party_routes
set
  environment = coalesce(environment, metadata->>'environment'),
  message_code = coalesce(message_code, metadata->>'message_code'),
  platform_actor_route_id = coalesce(platform_actor_route_id, nullif(metadata->>'platform_actor_route_id', '')::uuid),
  communication_route_id = coalesce(communication_route_id, nullif(metadata->>'communication_route_id', '')::uuid)
where metadata is not null
  and (
    environment is null
    or message_code is null
    or platform_actor_route_id is null
    or communication_route_id is null
  );

-- 2) Diagnostics view: surfaces repairable conditions without mutating data.
create or replace view public.gridex_operational_route_repair_v as
-- company_market_party_routes whose environment/route columns disagree with metadata.
select
  'company_market_party_route_metadata_drift' as issue_type,
  cmpr.company_id,
  cmpr.id as entity_id,
  jsonb_build_object(
    'environment_column', cmpr.environment,
    'environment_metadata', cmpr.metadata->>'environment',
    'message_code_column', cmpr.message_code,
    'message_code_metadata', cmpr.metadata->>'message_code'
  ) as details
from public.company_market_party_routes cmpr
where cmpr.active = true
  and (
    (cmpr.metadata->>'environment') is not null and cmpr.environment is distinct from (cmpr.metadata->>'environment')
    or (cmpr.metadata->>'message_code') is not null and cmpr.message_code is distinct from (cmpr.metadata->>'message_code')
  )

union all
-- active company_market_party_routes pointing at a missing route profile.
select
  'company_market_party_route_orphan_profile' as issue_type,
  cmpr.company_id,
  cmpr.id as entity_id,
  jsonb_build_object('route_profile_id', cmpr.route_profile_id) as details
from public.company_market_party_routes cmpr
left join public.ediel_route_profiles erp on erp.id = cmpr.route_profile_id
where cmpr.active = true
  and cmpr.route_profile_id is not null
  and erp.id is null

union all
-- active route profiles without a backing communication route.
select
  'ediel_route_profile_orphan_communication_route' as issue_type,
  erp.company_id,
  erp.id as entity_id,
  jsonb_build_object('communication_route_id', erp.communication_route_id) as details
from public.ediel_route_profiles erp
left join public.communication_routes cr on cr.id = erp.communication_route_id
where coalesce(erp.is_active, false) = true
  and erp.communication_route_id is not null
  and cr.id is null

union all
-- outbound requests with a null communication_route_id while an operational
-- route now exists for the same company + grid owner.
select
  'outbound_request_null_route_with_existing_route' as issue_type,
  obr.company_id,
  obr.id as entity_id,
  jsonb_build_object('grid_owner_id', obr.grid_owner_id, 'environment', obr.payload->>'environment') as details
from public.outbound_requests obr
where obr.communication_route_id is null
  and obr.grid_owner_id is not null
  and exists (
    select 1
    from public.communication_routes cr
    where cr.company_id = obr.company_id
      and cr.grid_owner_id = obr.grid_owner_id
      and cr.is_active = true
  );
