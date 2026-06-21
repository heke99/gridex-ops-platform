-- Production customer-info route repair.
-- Idempotent hardening for Z01 customer masterdata route resolution, blocker dedupe and stale job repair.

create extension if not exists pgcrypto;

alter table if exists public.customer_info_requests
  add column if not exists blocker_code text,
  add column if not exists blocker_details jsonb not null default '{}'::jsonb,
  add column if not exists route_resolution_status text,
  add column if not exists route_resolution_reason text,
  add column if not exists next_required_action text;

alter table if exists public.company_market_party_routes
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists customer_info_requests_operation_blocker_idx
  on public.customer_info_requests(company_id, operation_id, request_type, grid_owner_id, updated_at desc)
  where operation_id is not null;

create index if not exists company_market_party_routes_materialized_route_idx
  on public.company_market_party_routes(company_id, market_party_id, message_family, active);

create or replace function public.gridex_repair_customer_info_operation_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  repaired_count integer := 0;
begin
  if to_regclass('public.customer_operation_jobs') is null then
    return 0;
  end if;

  with latest_request as (
    select distinct on (job.id)
      job.id as job_id,
      req.id as request_id,
      req.blocker_code,
      req.blocker_reason,
      req.blocker_details,
      req.next_required_action
    from public.customer_operation_jobs job
    left join public.customer_info_requests req
      on req.company_id = job.company_id
     and req.customer_id = job.customer_id
     and (job.customer_site_id is null or req.site_id = job.customer_site_id)
     and (job.operation_id is null or req.operation_id = job.operation_id)
     and req.request_type = 'z01_customer_masterdata'
    where job.job_type = 'request_customer_data'
      and job.status = 'running'
      and job.attempts >= job.max_attempts
    order by job.id, req.updated_at desc nulls last, req.created_at desc nulls last
  )
  update public.customer_operation_jobs job
     set status = 'needs_review',
         result = coalesce(nullif(job.result, '{}'::jsonb), '{}'::jsonb) || jsonb_build_object(
           'reason', coalesce(req.blocker_code, 'technical_error'),
           'blocker_code', coalesce(req.blocker_code, 'technical_error'),
           'blocker_reason', coalesce(req.blocker_reason, job.last_error, 'Automationssteget behöver granskas.'),
           'next_required_action', coalesce(req.next_required_action, req.blocker_details->>'next_required_action', 'Granska blockeraren och starta om uppgiftsbegäran när felet är åtgärdat.'),
           'customer_info_request_id', req.request_id
         ),
         locked_at = null,
         locked_by = null,
         lock_token = null,
         heartbeat_at = null,
         last_error = null,
         completed_at = coalesce(job.completed_at, now()),
         updated_at = now()
    from latest_request req
   where job.id = req.job_id;

  get diagnostics repaired_count = row_count;
  return repaired_count;
end;
$$;

revoke all on function public.gridex_repair_customer_info_operation_jobs() from public;
revoke all on function public.gridex_repair_customer_info_operation_jobs() from anon;
revoke all on function public.gridex_repair_customer_info_operation_jobs() from authenticated;
grant execute on function public.gridex_repair_customer_info_operation_jobs() to service_role;

select public.gridex_repair_customer_info_operation_jobs();

drop view if exists public.gridex_company_route_readiness_v;

create or replace view public.gridex_company_route_readiness_v
with (security_invoker = true)
as
with supplier_companies as (
  select distinct eas.company_id
  from public.ediel_actor_settings eas
  where eas.company_id is not null
    and coalesce(eas.is_active, true) = true
    and lower(coalesce(eas.environment, '')) = 'production'
    and (
      lower(coalesce(eas.role, eas.actor_role, '')) in ('supplier','electricity_supplier')
      or eas.market_roles ? 'supplier'
      or eas.market_roles ? 'electricity_supplier'
    )
), platform_routes as (
  select
    g.id as grid_owner_id,
    g.name as grid_owner_name,
    g.ediel_id as grid_owner_ediel_id,
    g.platform_market_actor_id,
    r.id as platform_actor_route_id,
    upper(coalesce(r.message_family, 'PRODAT')) as message_family,
    coalesce(r.metadata->>'message_code', case when upper(coalesce(r.message_family, 'PRODAT')) = 'PRODAT' then 'Z01' else null end) as message_code,
    coalesce(r.environment::text, 'production') as environment,
    coalesce(r.status, '') = 'active' and coalesce(r.is_verified, false) = true as platform_route_ready
  from public.grid_owners g
  left join public.platform_actor_routes r
    on r.actor_id = g.platform_market_actor_id
   and coalesce(r.status, '') = 'active'
   and coalesce(r.is_verified, false) = true
  where g.platform_market_actor_id is not null
)
select
  c.company_id,
  pr.grid_owner_id,
  pr.grid_owner_name,
  pr.grid_owner_ediel_id,
  pr.platform_market_actor_id,
  pr.platform_actor_route_id,
  pr.message_family,
  pr.message_code,
  pr.environment,
  pr.platform_market_actor_id is not null as actor_registry_ready,
  pr.platform_route_ready,
  cr.id is not null and rp.id is not null and cmpr.id is not null as operational_route_ready,
  cr.id is not null
    and rp.id is not null
    and cmpr.id is not null
    and nullif(btrim(coalesce(rp.sender_ediel_id, '')), '') is not null
    and nullif(btrim(coalesce(rp.receiver_ediel_id, pr.grid_owner_ediel_id, '')), '') is not null
    and not (
      coalesce(eas.production_send_lock_enabled, false) = true
      and coalesce(eas.first_production_send_approved, false) = false
      and pr.environment = 'production'
    ) as send_ready,
  case
    when pr.platform_actor_route_id is null then 'operational_route_missing'
    when cmpr.id is null then 'platform_route_exists_but_not_materialized'
    when cr.id is null or rp.id is null then 'operational_route_missing'
    when coalesce(eas.production_send_lock_enabled, false) = true
      and coalesce(eas.first_production_send_approved, false) = false
      and pr.environment = 'production' then 'production_send_locked'
    else null
  end as blocker_code,
  case
    when pr.platform_actor_route_id is null then 'Verifierad route saknas i aktörsregistret.'
    when cmpr.id is null then 'Nätägaren är verifierad i aktörsregistret, men bolagets operativa route är inte materialiserad.'
    when cr.id is null or rp.id is null then 'Bolagets communication route eller route profile saknas.'
    when coalesce(eas.production_send_lock_enabled, false) = true
      and coalesce(eas.first_production_send_approved, false) = false
      and pr.environment = 'production' then 'Första produktionssändningen kräver plattformsadministratörens godkännande.'
    else 'Routekedjan är redo.'
  end as readiness_message,
  cr.id as communication_route_id,
  rp.id as ediel_route_profile_id,
  cmpr.id as company_market_party_route_id,
  eas.id as sender_settings_id,
  case
    when coalesce(eas.production_send_lock_enabled, false) = true
      and coalesce(eas.first_production_send_approved, false) = false
      and pr.environment = 'production' then 'locked'
    when pr.environment = 'production' then 'approved'
    else 'not_applicable'
  end as production_send_lock_status
from supplier_companies c
join platform_routes pr on true
left join public.company_market_party_routes cmpr
  on cmpr.company_id = c.company_id
 and cmpr.market_party_id = pr.platform_market_actor_id
 and upper(cmpr.message_family) = pr.message_family
 and cmpr.active = true
 and coalesce(cmpr.metadata->>'environment', pr.environment) = pr.environment
 and coalesce(cmpr.metadata->>'message_code', pr.message_code, '') = coalesce(pr.message_code, '')
left join public.ediel_route_profiles rp
  on rp.id = cmpr.route_profile_id
 and rp.company_id = c.company_id
 and coalesce(rp.is_enabled, true) = true
 and coalesce(rp.is_active, true) = true
left join public.communication_routes cr
  on cr.id = rp.communication_route_id
 and cr.company_id = c.company_id
 and coalesce(cr.is_active, true) = true
left join public.ediel_actor_settings eas
  on eas.company_id = c.company_id
 and lower(eas.environment) = lower(pr.environment)
 and coalesce(eas.is_active, true) = true;

grant select on public.gridex_company_route_readiness_v to authenticated, service_role;

create or replace view public.gridex_energy_route_health_v
with (security_invoker = true)
as
select 'grid_areas_total' as check_key, count(*)::bigint as check_count, case when count(*) = 0 then 'critical' else 'ok' end as status from public.platform_grid_areas
union all
select 'grid_area_geometries_total', count(*)::bigint, case when count(*) = 0 then 'critical' else 'ok' end from public.platform_grid_area_geometries
union all
select 'grid_areas_without_geometry', count(*)::bigint, case when count(*) > 0 then 'warning' else 'ok' end
from public.platform_grid_areas ga
where not exists (
  select 1 from public.platform_grid_area_geometries gg
  where gg.grid_area_code = ga.grid_area_code and coalesce(gg.is_active, true) = true
)
union all
select 'verified_platform_routes_without_operational_route', count(*)::bigint, case when count(*) > 0 then 'warning' else 'ok' end
from public.gridex_route_materialization_readiness_v
where platform_route_ready = true and operational_route_ready = false
union all
select 'company_routes_without_operational_route', count(*)::bigint, case when count(*) > 0 then 'warning' else 'ok' end
from public.gridex_company_route_readiness_v
where platform_route_ready = true and operational_route_ready = false;

grant select on public.gridex_energy_route_health_v to authenticated, service_role;
