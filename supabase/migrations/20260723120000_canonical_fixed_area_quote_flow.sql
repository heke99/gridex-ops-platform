-- API 2026-07-23.1: one canonical fixed-price product with one immutable
-- price row per SE area, canonical website quotes and OPS area resolution.
-- Additive and backwards compatible: existing application clients may omit
-- quote_reference during migration, but new quotes are tenant-bound and can be
-- consumed by only one canonical application.
begin;

update public.integration_api_permission_groups
set recommended_default = true,
    is_active = true,
    description = case group_key
      when 'website_quotes' then
        'Hemsidan kan skapa en tenantbunden canonical prisquote från exakt publicerad avtalsversion och validera den före kundansökan.'
      when 'website_energy_area' then
        'Hemsidan kan använda OPS canonical resolver för prisområde, nätområde och nätägare före quote och teckning.'
      else description
    end,
    updated_at = now()
where group_key in ('website_quotes', 'website_energy_area');

-- Restore only the already established scopes for existing website clients.
-- No unrelated permissions are changed.
update public.integration_api_clients c
set scopes = (
      select coalesce(array_agg(distinct scope order by scope), '{}'::text[])
      from unnest(
        coalesce(c.scopes, '{}'::text[]) ||
        array[
          'website_quotes.write',
          'website_quotes.validate',
          'website_energy_area.resolve'
        ]::text[]
      ) scope
    ),
    updated_at = now()
where coalesce(c.scopes, '{}'::text[]) &&
      array['website_contracts.read', 'website_applications.write']::text[];

comment on table public.website_contract_quotes is
  'Canonical tenant-bound website quotes. The quote freezes offer/version identity, customer type, SE area, consumption, start date, selected area price and calculation snapshot and may be consumed by only one website application.';

-- Operational read model for validating that one contract version contains one
-- fixed-price row per area. It does not create one product/publication per area.
create or replace view public.contract_fixed_area_prices_v
with (security_invoker = true)
as
select
  cpv.id as contract_product_version_id,
  cpv.contract_product_id,
  cpv.contract_type,
  cpv.status as contract_version_status,
  upper(component->>'price_area') as price_area,
  (component->>'fixed_price_sek_per_kwh')::numeric * 100 as fixed_price_ore_per_kwh,
  component as component_snapshot
from public.contract_product_versions cpv
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(cpv.commercial_snapshot->'base_components') = 'array'
      then cpv.commercial_snapshot->'base_components'
    when jsonb_typeof(cpv.commercial_snapshot->'pricing_snapshot'->'base_components') = 'array'
      then cpv.commercial_snapshot->'pricing_snapshot'->'base_components'
    else '[]'::jsonb
  end
) component
where coalesce(component->>'source_type', '') = 'fixed'
  and upper(coalesce(component->>'price_area', '')) in ('SE1','SE2','SE3','SE4')
  and nullif(component->>'fixed_price_sek_per_kwh', '') is not null;

comment on view public.contract_fixed_area_prices_v is
  'Canonical fixed-price rows by contract product version and SE area. Multiple rows belong to one product/version and must not be published as separate customer offers.';

grant select on public.contract_fixed_area_prices_v to authenticated, service_role;

-- Make tenant + quote lookup explicit while preserving the existing globally
-- unique opaque quote reference.
create index if not exists website_contract_quotes_company_reference_idx
  on public.website_contract_quotes(company_id, quote_reference);

commit;
