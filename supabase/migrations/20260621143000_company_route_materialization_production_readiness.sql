-- Gridex company route materialization + production send guard hardening.
-- Safe/idempotent: no deletes; old coarse unique index is replaced by a route-specific one.

alter table if exists public.company_market_party_routes
  add column if not exists environment text,
  add column if not exists message_code text,
  add column if not exists platform_actor_route_id uuid,
  add column if not exists communication_route_id uuid;

update public.company_market_party_routes
set
  environment = coalesce(environment, metadata->>'environment'),
  message_code = coalesce(message_code, metadata->>'message_code'),
  platform_actor_route_id = coalesce(platform_actor_route_id, nullif(metadata->>'platform_actor_route_id', '')::uuid),
  communication_route_id = coalesce(communication_route_id, nullif(metadata->>'communication_route_id', '')::uuid)
where metadata is not null;

drop index if exists public.company_market_party_routes_active_uidx;
drop index if exists company_market_party_routes_active_uidx;

create unique index if not exists company_market_party_routes_active_route_uidx
  on public.company_market_party_routes(
    company_id,
    market_party_id,
    message_family,
    coalesce(environment, 'test'),
    coalesce(message_code, ''),
    coalesce(platform_actor_route_id::text, '')
  )
  where active = true;

create index if not exists company_market_party_routes_company_grid_lookup_idx
  on public.company_market_party_routes(company_id, market_party_id, message_family, environment, message_code)
  where active = true;

alter table if exists public.ediel_actor_settings
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table if exists public.ediel_route_profiles
  add column if not exists receiver_certificate_id uuid,
  add column if not exists security_policy_status text,
  add column if not exists is_production_ready boolean not null default false;

alter table if exists public.ediel_outbox
  add column if not exists route_contract_fingerprint text,
  add column if not exists route_contract_snapshot jsonb,
  add column if not exists receiver_ediel_id text,
  add column if not exists receiver_subaddress text,
  add column if not exists certificate_fingerprint text,
  add column if not exists current_send_attempt_id uuid,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text;

create table if not exists public.ediel_production_send_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  actor_setting_id uuid null,
  environment text not null default 'production',
  status text not null default 'approved',
  approved_by uuid null,
  approved_at timestamptz not null default now(),
  reason text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ediel_production_send_approvals_company_idx
  on public.ediel_production_send_approvals(company_id, environment, approved_at desc);

create or replace function public.gridex_approve_first_production_send(
  p_company_id uuid,
  p_actor_setting_id uuid default null,
  p_actor_user_id uuid default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ediel_actor_settings
  set
    first_production_send_approved = true,
    production_send_lock_enabled = false,
    updated_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'production_send_approved_by', p_actor_user_id,
      'production_send_approved_at', now(),
      'production_send_approval_reason', coalesce(p_reason, 'Första produktionssändningen godkänd av platform admin.')
    )
  where company_id = p_company_id
    and environment = 'production'
    and is_active = true
    and (p_actor_setting_id is null or id = p_actor_setting_id);

  insert into public.ediel_production_send_approvals(
    company_id,
    actor_setting_id,
    environment,
    status,
    approved_by,
    reason,
    metadata
  ) values (
    p_company_id,
    p_actor_setting_id,
    'production',
    'approved',
    p_actor_user_id,
    p_reason,
    jsonb_build_object('source', 'gridex_approve_first_production_send')
  );
end;
$$;

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
   and coalesce(cmpr.message_code, cmpr.metadata->>'message_code', case when pr.message_family = 'PRODAT' then 'Z01' else null end) = pr.message_code
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

create table if not exists public.platform_grid_areas (
  id uuid primary key default gen_random_uuid(),
  code text null,
  name text null,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_grid_area_geometries (
  id uuid primary key default gen_random_uuid(),
  grid_area_id uuid null,
  grid_area_code text null,
  geometry_geojson jsonb null,
  source text null,
  imported_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists platform_grid_area_geometries_area_idx
  on public.platform_grid_area_geometries(grid_area_id, grid_area_code);

create or replace view public.gridex_energy_geodata_health_v as
select
  (select count(*) from public.platform_grid_areas) as grid_areas_total,
  (select count(*) from public.platform_grid_area_geometries) as grid_area_geometries_total,
  greatest(
    (select count(*) from public.platform_grid_areas) - (select count(*) from public.platform_grid_area_geometries),
    0
  ) as grid_areas_without_geometry,
  case
    when to_regclass('public.platform_grid_area_geometries') is null then 'missing_geometry_table'
    when (select count(*) from public.platform_grid_area_geometries) = 0 then 'geometry_import_required'
    when greatest((select count(*) from public.platform_grid_areas) - (select count(*) from public.platform_grid_area_geometries), 0) > 0 then 'partial_geometry_coverage'
    else 'ready'
  end as status,
  'Postnummer/adressfallback får endast vara förslag tills polygongeometrier är importerade och verifierade.' as policy;
