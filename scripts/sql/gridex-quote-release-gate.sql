\set ON_ERROR_STOP on

begin;
select txid_current()::text as gate_txid \gset

with ranked_targets as (
  select
    o.company_id,
    o.canonical_offer_reference as offer_reference,
    o.contract_product_id,
    o.contract_product_version_id,
    o.contract_publication_version_id,
    o.price_plan_id,
    o.price_plan_version_id,
    o.price_book_id,
    o.legal_bundle_version_id,
    o.energy_direction,
    o.contract_type,
    o.canonical_pricing_snapshot,
    p.id as price_option_id,
    p.option_reference as price_option_reference,
    coalesce(a.price_area, (o.price_areas)[1], 'SE3') as price_area,
    case when o.contract_type='fixed' then a.price_row_reference else null end as area_price_reference,
    row_number() over (
      partition by o.contract_type
      order by o.sort_order, o.public_name
    ) as family_rank
  from public.canonical_visible_public_contracts_v o
  join public.contract_price_options p
    on p.contract_publication_version_id=o.contract_publication_version_id
   and p.company_id=o.company_id
   and p.status='active'
   and p.is_default=true
  left join lateral (
    select ap.price_area, ap.price_row_reference
    from public.contract_price_option_area_prices ap
    where ap.contract_price_option_id=p.id
      and ap.company_id=o.company_id
      and ap.status='active'
    order by ap.price_area
    limit 1
  ) a on true
  where o.website_available_now=true
    and o.is_archived=false
    and o.contract_type in ('variable_monthly','fixed')
    and (
      (
        o.contract_type='variable_monthly'
        and coalesce(o.canonical_pricing_snapshot->>'snapshot_schema','')
            <> 'gridex_contract_pricing_v6_selection'
      )
      or
      (
        o.contract_type='fixed'
        and o.canonical_pricing_snapshot->>'snapshot_schema'
            = 'gridex_contract_pricing_v6_selection'
      )
    )
), targets as (
  select * from ranked_targets where family_rank=1
), inserted as (
  insert into public.website_contract_quotes (
    company_id,
    quote_reference,
    offer_reference,
    contract_product_id,
    contract_product_version_id,
    contract_publication_version_id,
    price_plan_id,
    price_plan_version_id,
    price_book_id,
    legal_bundle_version_id,
    energy_direction,
    customer_type,
    price_area,
    resolution_binding_status,
    annual_consumption_kwh,
    start_date,
    market_sources,
    assumptions,
    pricing_snapshot_schema_version,
    price_option_reference,
    area_price_reference,
    invoice_delivery_method,
    selected_component_references,
    mandatory_component_references,
    conditional_component_references,
    site_count,
    resolved_base_components,
    resolved_price_components,
    quote_snapshot,
    valid_until,
    status,
    quote_hash,
    quote_hash_version
  )
  select
    company_id,
    'quote_release_gate_' || :'gate_txid' || '_' || contract_type,
    offer_reference,
    contract_product_id,
    contract_product_version_id,
    contract_publication_version_id,
    price_plan_id,
    price_plan_version_id,
    price_book_id,
    legal_bundle_version_id,
    energy_direction,
    'private',
    price_area,
    'legacy_unverified',
    1000,
    current_date,
    '[]'::jsonb,
    '[]'::jsonb,
    'gridex_contract_pricing_v6_selection',
    price_option_reference,
    area_price_reference,
    'email',
    '{}'::text[],
    '{}'::text[],
    '{}'::text[],
    1,
    '[]'::jsonb,
    '[]'::jsonb,
    jsonb_build_object(
      'snapshot_schema','gridex_contract_pricing_v6_selection',
      'pricing_snapshot_schema_version','gridex_contract_pricing_v6_selection',
      'contract_type',contract_type,
      'source_publication_schema',coalesce(
        canonical_pricing_snapshot->>'snapshot_schema',
        canonical_pricing_snapshot->>'schema_version'
      ),
      'price_option_reference',price_option_reference,
      'area_price_reference',area_price_reference,
      'invoice_delivery_method','email'
    ),
    now() + interval '5 minutes',
    'active',
    repeat('a',64),
    'v3_commercial_selection'
  from targets
  returning *
)
select
  1 / case
    when count(*) = 2
     and count(*) filter (
       where quote_snapshot->>'contract_type'='variable_monthly'
     ) = 1
     and count(*) filter (
       where quote_snapshot->>'contract_type'='fixed'
     ) = 1
     and bool_and(
       pricing_snapshot_schema_version='gridex_contract_pricing_v6_selection'
     )
     and bool_and(price_option_reference is not null)
     and bool_and(invoice_delivery_method is not null)
     and bool_and(jsonb_typeof(resolved_base_components)='array')
     and bool_and(jsonb_typeof(resolved_price_components)='array')
    then 1 else 0 end as release_gate_invariants
from inserted;

select
  quote_reference,
  offer_reference,
  quote_snapshot->>'contract_type' as contract_type,
  quote_snapshot->>'source_publication_schema' as source_publication_schema,
  pricing_snapshot_schema_version,
  price_option_reference,
  area_price_reference,
  invoice_delivery_method
from public.website_contract_quotes
where quote_reference like 'quote_release_gate_' || :'gate_txid' || '%'
order by quote_reference;

rollback;

select
  1 / case when count(*)=0 then 1 else 0 end as rollback_verified
from public.website_contract_quotes
where quote_reference like 'quote_release_gate_' || :'gate_txid' || '%';
