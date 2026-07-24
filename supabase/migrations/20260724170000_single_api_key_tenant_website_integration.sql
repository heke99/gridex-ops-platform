-- Canonical one-secret tenant website integration.
-- A tenant configures only GRIDEX_API_KEY. Company identity, scopes, API base
-- URL and request-field placement are owned by OPS.

begin;

set local lock_timeout = '15s';
set local statement_timeout = '10min';

select pg_advisory_xact_lock(
  hashtextextended('gridex:single-api-key-tenant-website:20260724170000', 0)
);

insert into public.integration_api_client_profiles(
  key,
  label,
  default_scopes,
  require_allowed_origins,
  updated_at
)
values
  (
    'website_signup',
    'Hemsida (canonical teckning)',
    array[
      'integration_context.read',
      'website_contracts.read',
      'website_energy_area.resolve',
      'website_quotes.write',
      'website_quotes.validate',
      'website_legal.read',
      'website_applications.write',
      'website_switch_status.read',
      'website_events.write',
      'events.read'
    ]::text[],
    true,
    now()
  ),
  (
    'tenant_website',
    'Tenanthemsida + Mina sidor (en API-nyckel)',
    array[
      'integration_context.read',
      'website_contracts.read',
      'website_energy_area.resolve',
      'website_quotes.write',
      'website_quotes.validate',
      'website_legal.read',
      'website_applications.write',
      'website_switch_status.read',
      'customer_portal.read',
      'customer_portal.write',
      'website_events.write',
      'events.read',
      'customer_documents.read',
      'customer_documents.write',
      'customer_notifications.read',
      'customer_notifications.write',
      'customer_contact.write',
      'customer_facility_data.write',
      'customer_power_of_attorney.write'
    ]::text[],
    true,
    now()
  )
on conflict (key) do update set
  label = excluded.label,
  default_scopes = excluded.default_scopes,
  require_allowed_origins = excluded.require_allowed_origins,
  updated_at = excluded.updated_at;

-- Existing active website-application clients are safely completed with the
-- scopes required by the same canonical website checkout flow. No portal or
-- unrelated partner permissions are added by this backfill.
with canonical_website_scopes(scope) as (
  values
    ('integration_context.read'::text),
    ('website_contracts.read'::text),
    ('website_energy_area.resolve'::text),
    ('website_quotes.write'::text),
    ('website_quotes.validate'::text),
    ('website_legal.read'::text),
    ('website_applications.write'::text),
    ('website_switch_status.read'::text)
), candidates as (
  select c.id,
         array(
           select distinct value
           from unnest(coalesce(c.scopes, '{}'::text[]) || array(
             select scope from canonical_website_scopes
           )) as value
           order by value
         ) as completed_scopes
  from public.integration_api_clients c
  where c.status = 'active'
    and not ('*' = any(coalesce(c.scopes, '{}'::text[])))
    and (
      'website_applications.write' = any(coalesce(c.scopes, '{}'::text[]))
      or c.profile_key = 'website_signup'
    )
)
update public.integration_api_clients c
set scopes = candidates.completed_scopes,
    profile_key = coalesce(c.profile_key, 'website_signup'),
    updated_at = now(),
    metadata = coalesce(c.metadata, '{}'::jsonb) || jsonb_build_object(
      'required_environment_variables', jsonb_build_array('GRIDEX_API_KEY'),
      'api_base_url', 'https://app.gridex.se/api/v1',
      'openapi_url', 'https://app.gridex.se/api/v1/openapi/website-integration-v1.json',
      'application_reference_location', 'top_level',
      'tenant_identity_source', 'api_key',
      'single_api_key_profile_backfilled_at', now()
    )
from candidates
where c.id = candidates.id;

-- A client explicitly using the complete tenant_website profile receives the
-- complete same-key website + Mina sidor permission set.
with complete_profile as (
  select default_scopes
  from public.integration_api_client_profiles
  where key = 'tenant_website'
), candidates as (
  select c.id,
         array(
           select distinct value
           from unnest(coalesce(c.scopes, '{}'::text[]) || p.default_scopes) as value
           order by value
         ) as completed_scopes
  from public.integration_api_clients c
  cross join complete_profile p
  where c.status = 'active'
    and c.profile_key = 'tenant_website'
    and not ('*' = any(coalesce(c.scopes, '{}'::text[])))
)
update public.integration_api_clients c
set scopes = candidates.completed_scopes,
    launch_ready = true,
    launch_blockers = '[]'::jsonb,
    updated_at = now(),
    metadata = coalesce(c.metadata, '{}'::jsonb) || jsonb_build_object(
      'required_environment_variables', jsonb_build_array('GRIDEX_API_KEY'),
      'api_base_url', 'https://app.gridex.se/api/v1',
      'openapi_url', 'https://app.gridex.se/api/v1/openapi/website-integration-v1.json',
      'application_reference_location', 'top_level',
      'tenant_identity_source', 'api_key',
      'single_api_key_profile_completed_at', now()
    )
from candidates
where c.id = candidates.id;

comment on table public.integration_api_client_profiles is
  'OPS-owned API client profiles. Tenant runtime configuration is a single server-side GRIDEX_API_KEY; profile scopes are provisioned in OPS.';

commit;
