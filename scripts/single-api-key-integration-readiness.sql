-- Read-only readiness checks for the one-secret tenant website integration.
-- Expected after migration 20260724170000:
--   * profile rows exist;
--   * new tenant_website clients have all required scopes;
--   * legacy website checkout clients have the canonical checkout scopes;
--   * tenant configuration metadata advertises only GRIDEX_API_KEY.

with expected_profiles(key) as (
  values ('website_signup'::text), ('tenant_website'::text)
)
select
  'missing_api_client_profile'::text as check_name,
  p.key as entity_reference,
  null::text[] as missing_scopes,
  jsonb_build_object('profile_key', p.key) as details
from expected_profiles p
where not exists (
  select 1
  from public.integration_api_client_profiles actual
  where actual.key = p.key
)

union all

select
  'website_checkout_client_missing_scope',
  c.id::text,
  array(
    select required_scope
    from unnest(array[
      'integration_context.read',
      'website_contracts.read',
      'website_energy_area.resolve',
      'website_quotes.write',
      'website_quotes.validate',
      'website_legal.read',
      'website_applications.write',
      'website_switch_status.read'
    ]::text[]) required_scope
    where not (
      '*' = any(coalesce(c.scopes, '{}'::text[]))
      or required_scope = any(coalesce(c.scopes, '{}'::text[]))
    )
  ),
  jsonb_build_object(
    'name', c.name,
    'company_id', c.company_id,
    'profile_key', c.profile_key,
    'status', c.status
  )
from public.integration_api_clients c
where c.status = 'active'
  and (
    'website_applications.write' = any(coalesce(c.scopes, '{}'::text[]))
    or c.profile_key in ('website_signup', 'tenant_website')
  )
  and not (
    '*' = any(coalesce(c.scopes, '{}'::text[]))
    or array[
      'integration_context.read',
      'website_contracts.read',
      'website_energy_area.resolve',
      'website_quotes.write',
      'website_quotes.validate',
      'website_legal.read',
      'website_applications.write',
      'website_switch_status.read'
    ]::text[] <@ coalesce(c.scopes, '{}'::text[])
  )

union all

select
  'tenant_website_client_missing_portal_scope',
  c.id::text,
  array(
    select required_scope
    from unnest(array['customer_portal.read', 'customer_portal.write']::text[]) required_scope
    where not (
      '*' = any(coalesce(c.scopes, '{}'::text[]))
      or required_scope = any(coalesce(c.scopes, '{}'::text[]))
    )
  ),
  jsonb_build_object(
    'name', c.name,
    'company_id', c.company_id,
    'profile_key', c.profile_key,
    'status', c.status
  )
from public.integration_api_clients c
where c.status = 'active'
  and c.profile_key = 'tenant_website'
  and not (
    '*' = any(coalesce(c.scopes, '{}'::text[]))
    or array['customer_portal.read', 'customer_portal.write']::text[] <@ coalesce(c.scopes, '{}'::text[])
  )

union all

select
  'tenant_website_metadata_not_single_secret',
  c.id::text,
  null::text[],
  jsonb_build_object(
    'name', c.name,
    'company_id', c.company_id,
    'required_environment_variables', c.metadata -> 'required_environment_variables',
    'api_base_url', c.metadata ->> 'api_base_url',
    'application_reference_location', c.metadata ->> 'application_reference_location'
  )
from public.integration_api_clients c
where c.status = 'active'
  and c.profile_key = 'tenant_website'
  and (
    coalesce(c.metadata -> 'required_environment_variables', 'null'::jsonb) <> '["GRIDEX_API_KEY"]'::jsonb
    or coalesce(c.metadata ->> 'api_base_url', '') <> 'https://app.gridex.se/api/v1'
    or coalesce(c.metadata ->> 'application_reference_location', '') <> 'top_level'
  )
order by check_name, entity_reference;
