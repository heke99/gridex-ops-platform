-- Customer-info route/resolver/readiness hardening.
-- Safe/idempotent: only adds metadata-compatible columns and replaces diagnostic views.

do $$
begin
  if to_regclass('public.customer_info_requests') is not null then
    alter table public.customer_info_requests add column if not exists blocker_code text;
    alter table public.customer_info_requests add column if not exists blocker_details jsonb not null default '{}'::jsonb;
    alter table public.customer_info_requests add column if not exists route_resolution_status text;
    alter table public.customer_info_requests add column if not exists route_resolution_reason text;
    alter table public.customer_info_requests add column if not exists next_required_action text;
  end if;

  if to_regclass('public.company_market_party_routes') is not null then
    alter table public.company_market_party_routes add column if not exists metadata jsonb not null default '{}'::jsonb;
  end if;

  if to_regclass('public.customer_sites') is not null then
    alter table public.customer_sites add column if not exists address_quality_warnings jsonb not null default '[]'::jsonb;
    alter table public.customer_sites add column if not exists onboarding_issues jsonb not null default '[]'::jsonb;
  end if;
end $$;

drop view if exists public.gridex_energy_route_health_v;
drop view if exists public.gridex_route_materialization_readiness_v;

create or replace view public.gridex_route_materialization_readiness_v
with (security_invoker = true)
as
select
  g.company_id,
  g.id as grid_owner_id,
  g.name as grid_owner_name,
  g.platform_market_actor_id,
  r.id as platform_actor_route_id,
  upper(coalesce(r.message_family, 'PRODAT')) as message_family,
  coalesce(r.metadata->>'message_code', case when upper(coalesce(r.message_family, 'PRODAT')) = 'PRODAT' then 'Z01' else null end) as message_code,
  coalesce(r.environment::text, 'production') as environment,
  (
    g.platform_market_actor_id is not null
    and coalesce(g.verification_status, '') in ('verified','needs_route','needs_certificate','needs_contact','needs_subaddress')
  ) as actor_registry_ready,
  (
    r.id is not null
    and coalesce(r.status, '') = 'active'
    and coalesce(r.is_verified, false) = true
  ) as platform_route_ready,
  (
    cr.id is not null
    and coalesce(cr.is_active, true) = true
    and rp.id is not null
    and coalesce(rp.is_enabled, true) = true
    and coalesce(rp.is_active, true) = true
    and coalesce(cr.environment_type::text, rp.environment::text, r.environment::text) = coalesce(r.environment::text, 'production')
  ) as operational_route_ready,
  (
    cr.id is not null
    and rp.id is not null
    and nullif(btrim(coalesce(rp.sender_ediel_id, '')), '') is not null
    and nullif(btrim(coalesce(rp.receiver_ediel_id, g.ediel_id, '')), '') is not null
    and nullif(btrim(coalesce(cr.target_email, '')), '') is not null
    and not (
      coalesce(eas.production_send_lock_enabled, false) = true
      and coalesce(eas.first_production_send_approved, false) = false
      and coalesce(r.environment::text, 'production') = 'production'
    )
  ) as send_ready,
  case
    when r.id is not null and cr.id is null then 'platform_route_exists_but_not_materialized'
    when cr.id is null then 'operational_route_missing'
    when rp.id is null then 'operational_route_missing'
    when coalesce(cr.environment_type::text, rp.environment::text, r.environment::text) <> coalesce(r.environment::text, 'production') then 'environment_mismatch'
    when coalesce(eas.production_send_lock_enabled, false) = true
      and coalesce(eas.first_production_send_approved, false) = false
      and coalesce(r.environment::text, 'production') = 'production' then 'production_send_locked'
    else null
  end as blocker_code,
  case
    when r.id is not null and cr.id is null then 'Nätägaren är verifierad i aktörsregistret, men operativ route saknas.'
    when cr.id is null or rp.id is null then 'Operativ route eller route profile saknas.'
    when coalesce(cr.environment_type::text, rp.environment::text, r.environment::text) <> coalesce(r.environment::text, 'production') then 'Miljö stämmer inte mellan aktörsregister, communication route och route profile.'
    when coalesce(eas.production_send_lock_enabled, false) = true
      and coalesce(eas.first_production_send_approved, false) = false
      and coalesce(r.environment::text, 'production') = 'production' then 'Första produktionssändningen kräver plattformsadministratörens godkännande.'
    else 'Routekedjan är redo.'
  end as readiness_message,
  cr.id as communication_route_id,
  rp.id as ediel_route_profile_id,
  cmpr.id as company_market_party_route_id,
  eas.id as sender_settings_id
from public.grid_owners g
left join public.platform_actor_routes r
  on r.actor_id = g.platform_market_actor_id
 and coalesce(r.status, '') = 'active'
 and coalesce(r.is_verified, false) = true
left join public.communication_routes cr
  on cr.company_id = g.company_id
 and cr.grid_owner_id = g.id
 and cr.auth_config->>'platform_actor_route_id' = r.id::text
left join public.ediel_route_profiles rp
  on rp.company_id = g.company_id
 and rp.communication_route_id = cr.id
 and rp.metadata->>'platform_actor_route_id' = r.id::text
left join public.company_market_party_routes cmpr
  on cmpr.company_id = g.company_id
 and cmpr.market_party_id = g.platform_market_actor_id
 and upper(cmpr.message_family) = upper(coalesce(r.message_family, 'PRODAT'))
 and cmpr.active = true
 and coalesce(cmpr.metadata->>'environment', coalesce(r.environment::text, 'production')) = coalesce(r.environment::text, 'production')
 and coalesce(cmpr.metadata->>'message_code', coalesce(r.metadata->>'message_code', '')) = coalesce(r.metadata->>'message_code', coalesce(cmpr.metadata->>'message_code', ''))
left join public.ediel_actor_settings eas
  on eas.company_id = g.company_id
 and eas.environment::text = coalesce(r.environment::text, 'production')
 and coalesce(eas.is_active, true) = true
where g.platform_market_actor_id is not null;

grant select on public.gridex_route_materialization_readiness_v to authenticated, service_role;

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
where platform_route_ready = true and operational_route_ready = false;

grant select on public.gridex_energy_route_health_v to authenticated, service_role;
