begin;

-- Canonical Ediel tenant identity backfill.
-- Source precedence: verified platform actor identifier + active tenant actor setting.
-- This does not infer representation and does not make legacy route rows normative.
with verified_source as (
  select distinct
    eas.company_id,
    eas.environment,
    pma.id as actor_id,
    pai.identifier_value as ediel_id,
    coalesce(
      nullif(btrim(eas.sender_subaddress_prodat), ''),
      nullif(btrim(eas.sender_subaddress_utilts), ''),
      nullif(btrim(eas.sender_subaddress), ''),
      nullif(btrim(eas.sender_sub_address), '')
    ) as transport_subaddress
  from public.ediel_actor_settings eas
  join public.platform_actor_identifiers pai
    on pai.identifier_type = 'EdielId'
   and pai.identifier_value = coalesce(nullif(btrim(eas.ediel_id), ''), nullif(btrim(eas.actor_ediel_id), ''))
   and pai.is_verified = true
   and (pai.valid_to is null or pai.valid_to >= current_date)
  join public.platform_market_actors pma
    on pma.id = pai.actor_id
   and pma.status = 'active'
  where eas.company_id is not null
    and eas.is_active = true
    and eas.environment in ('test', 'production')
)
insert into public.tenant_ediel_profiles (
  company_id,
  environment,
  market,
  is_enabled,
  valid_from,
  metadata
)
select
  source.company_id,
  source.environment,
  'electricity',
  true,
  timestamptz '2026-08-27 19:30:00+00',
  jsonb_build_object(
    'source', 'canonical_ediel_tenant_identity_backfill_20260827',
    'actorId', source.actor_id,
    'edielId', source.ediel_id,
    'evidence', 'verified_platform_actor_identifier_plus_active_tenant_actor_setting'
  )
from verified_source source
where not exists (
  select 1
  from public.tenant_ediel_profiles existing
  where existing.company_id = source.company_id
    and existing.environment = source.environment
    and existing.market = 'electricity'
    and existing.is_enabled = true
    and existing.valid_to is null
);

with verified_source as (
  select distinct
    eas.company_id,
    eas.environment,
    pma.id as actor_id,
    pai.identifier_value as ediel_id,
    coalesce(
      nullif(btrim(eas.sender_subaddress_prodat), ''),
      nullif(btrim(eas.sender_subaddress_utilts), ''),
      nullif(btrim(eas.sender_subaddress), ''),
      nullif(btrim(eas.sender_sub_address), '')
    ) as transport_subaddress
  from public.ediel_actor_settings eas
  join public.platform_actor_identifiers pai
    on pai.identifier_type = 'EdielId'
   and pai.identifier_value = coalesce(nullif(btrim(eas.ediel_id), ''), nullif(btrim(eas.actor_ediel_id), ''))
   and pai.is_verified = true
   and (pai.valid_to is null or pai.valid_to >= current_date)
  join public.platform_market_actors pma
    on pma.id = pai.actor_id
   and pma.status = 'active'
  where eas.company_id is not null
    and eas.is_active = true
    and eas.environment in ('test', 'production')
)
insert into public.tenant_actor_identifiers (
  company_id,
  environment,
  actor_id,
  identifier_type,
  identifier_value,
  qualifier,
  subaddress,
  valid_from
)
select
  source.company_id,
  source.environment,
  source.actor_id,
  'EdielId',
  source.ediel_id,
  null,
  source.transport_subaddress,
  timestamptz '2026-08-27 19:30:00+00'
from verified_source source
where not exists (
  select 1
  from public.tenant_actor_identifiers existing
  where existing.company_id = source.company_id
    and existing.environment = source.environment
    and existing.actor_id = source.actor_id
    and existing.identifier_type = 'EdielId'
    and existing.identifier_value = source.ediel_id
    and existing.valid_to is null
);

with verified_source as (
  select distinct
    eas.company_id,
    eas.environment,
    pai.actor_id
  from public.ediel_actor_settings eas
  join public.platform_actor_identifiers pai
    on pai.identifier_type = 'EdielId'
   and pai.identifier_value = coalesce(nullif(btrim(eas.ediel_id), ''), nullif(btrim(eas.actor_ediel_id), ''))
   and pai.is_verified = true
   and (pai.valid_to is null or pai.valid_to >= current_date)
  where eas.company_id is not null
    and eas.is_active = true
    and eas.environment in ('test', 'production')
), canonical_roles as (
  select distinct
    source.company_id,
    source.environment,
    source.actor_id,
    roles.actor_role as role_code
  from verified_source source
  join public.platform_actor_roles roles
    on roles.actor_id = source.actor_id
   and roles.is_active = true
  where roles.actor_role in ('electricity_supplier', 'energy_service_company')
)
insert into public.tenant_actor_roles (
  company_id,
  environment,
  actor_id,
  role_code,
  valid_from
)
select
  source.company_id,
  source.environment,
  source.actor_id,
  source.role_code,
  timestamptz '2026-08-27 19:30:00+00'
from canonical_roles source
where not exists (
  select 1
  from public.tenant_actor_roles existing
  where existing.company_id = source.company_id
    and existing.environment = source.environment
    and existing.actor_id = source.actor_id
    and existing.role_code = source.role_code
    and existing.valid_to is null
);

-- Z01 is unambiguously the supplier/DDQ PRODAT profile in 26.A.
update public.ediel_route_profiles
set
  application_reference = '23-DDQ-PRODAT',
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'canonicalRemediation', '20260827193000',
    'previousApplicationReference', application_reference,
    'canonicalApplicationReference', '23-DDQ-PRODAT'
  ),
  updated_at = now()
where coalesce(message_code, business_code) = 'Z01'
  and upper(coalesce(application_reference, '')) = '23-DGI-PRODAT';

-- A generic UTILTS route cannot be repaired safely from a PRODAT application
-- reference because S/T and role are message-context dependent. Quarantine it
-- and force runtime to resolve an exact canonical UTILTS application reference.
update public.ediel_route_profiles
set
  is_enabled = false,
  is_production_ready = false,
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'canonicalRemediation', '20260827193000',
    'quarantineReason', 'legacy_utilts_route_contains_prodat_application_reference',
    'previousApplicationReference', application_reference
  ),
  updated_at = now()
where upper(coalesce(message_family, '')) = 'UTILTS'
  and upper(coalesce(application_reference, '')) like '%PRODAT%';

commit;
