begin;
set local search_path = public, pg_catalog;

with granular(scope) as (
  values
    ('integration_context.read'::text),('website_contracts.read'),('website_energy_area.resolve'),
    ('website_market_prices.read'),('website_quotes.write'),('website_quotes.validate'),
    ('website_legal.read'),('website_applications.write'),('website_switch_status.read'),
    ('website_events.write'),('events.read'),('customer_profile.read'),('customer_sites.read'),
    ('customer_contracts.read'),('customer_invoices.read'),('customer_metering.read'),
    ('customer_legal.read'),('customer_events.read'),('customer_documents.read'),
    ('customer_documents.write'),('customer_notifications.read'),('customer_notifications.write'),
    ('customer_power_of_attorney.read'),('customer_contact.write'),('customer_facility_data.write'),
    ('customer_power_of_attorney.write'),('customer_sync.write')
), scope_set as (
  select array_agg(scope order by scope)::text[] as scopes from granular
)
update public.integration_api_client_profiles p
set default_scopes = s.scopes,
    updated_at = clock_timestamp()
from scope_set s
where p.key = 'tenant_website';

with granular(scope) as (
  values
    ('integration_context.read'::text),('website_contracts.read'),('website_energy_area.resolve'),
    ('website_market_prices.read'),('website_quotes.write'),('website_quotes.validate'),
    ('website_legal.read'),('website_applications.write'),('website_switch_status.read'),
    ('website_events.write'),('events.read'),('customer_profile.read'),('customer_sites.read'),
    ('customer_contracts.read'),('customer_invoices.read'),('customer_metering.read'),
    ('customer_legal.read'),('customer_events.read'),('customer_documents.read'),
    ('customer_documents.write'),('customer_notifications.read'),('customer_notifications.write'),
    ('customer_power_of_attorney.read'),('customer_contact.write'),('customer_facility_data.write'),
    ('customer_power_of_attorney.write'),('customer_sync.write')
), scope_set as (
  select array_agg(scope order by scope)::text[] as scopes from granular
)
update public.integration_api_clients c
set scopes = case
      when '*' = any(coalesce(c.scopes, '{}'::text[])) then c.scopes
      else array(
        select distinct scope
        from unnest(coalesce(c.scopes, '{}'::text[]) || s.scopes) as existing(scope)
        where scope not in ('customer_portal.read', 'customer_portal.write')
        order by scope
      )
    end,
    updated_at = clock_timestamp(),
    metadata = coalesce(c.metadata, '{}'::jsonb) || jsonb_build_object(
      'granular_tenant_website_scopes_at', clock_timestamp(),
      'legacy_portal_scope_aliases_removed', true
    )
from scope_set s
where c.profile_key = 'tenant_website'
  and c.deleted_at is null;

do $$
begin
  if exists (
    select 1
    from public.integration_api_client_profiles
    where key = 'tenant_website'
      and default_scopes && array['customer_portal.read','customer_portal.write']::text[]
  ) then
    raise exception 'tenant_website_legacy_portal_scopes_remain';
  end if;
  if exists (
    select 1
    from public.integration_api_clients
    where profile_key = 'tenant_website'
      and deleted_at is null
      and scopes && array['customer_portal.read','customer_portal.write']::text[]
  ) then
    raise exception 'tenant_website_client_legacy_portal_scopes_remain';
  end if;
end;
$$;

commit;
