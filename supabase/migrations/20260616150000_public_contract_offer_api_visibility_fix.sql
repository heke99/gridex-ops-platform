-- Public contract offer API visibility fix.
-- Makes the website endpoint use the canonical publication fields consistently,
-- backfills older rows where is_public drifted from publication_status, and gives
-- platform admins a tenant-safe diagnostic view for why an offer is or is not sent to the website API.

create extension if not exists pgcrypto;

alter table if exists public.legal_bundles
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table if exists public.price_books
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Make sure tenants with public offers have a complete default legal package available.
do $$
declare
  v_company record;
begin
  if to_regclass('public.public_contract_offers') is not null
     and to_regprocedure('public.gridex_seed_default_legal_package_for_company(uuid,uuid)') is not null then
    for v_company in
      select distinct company_id
      from public.public_contract_offers
      where company_id is not null
    loop
      begin
        perform public.gridex_seed_default_legal_package_for_company(v_company.company_id, null);
      exception when others then
        raise notice 'Could not seed default legal package for company %: %', v_company.company_id, sqlerrm;
      end;
    end loop;
  end if;
end $$;

-- If an offer points at an incomplete bundle but the tenant has a complete published bundle,
-- repoint the public offer so the website endpoint can send the correct legal versions.
with complete_bundles as (
  select
    b.id,
    b.company_id,
    row_number() over (partition by b.company_id order by b.updated_at desc nulls last, b.created_at desc nulls last) as rn
  from public.legal_bundles b
  join public.legal_bundle_items bi on bi.legal_bundle_id = b.id
  join public.legal_text_versions l on l.id = bi.legal_text_version_id and l.company_id = b.company_id and l.status = 'published'
  where b.status in ('published','active')
    and bi.type in ('terms','privacy_policy','withdrawal','power_of_attorney','price_terms')
  group by b.id, b.company_id, b.updated_at, b.created_at
  having count(distinct bi.type) = 5
), current_bundle_counts as (
  select
    o.id as offer_id,
    count(distinct bi.type) filter (where l.status = 'published' and l.company_id = o.company_id) as current_type_count
  from public.public_contract_offers o
  left join public.legal_bundle_items bi on bi.legal_bundle_id = o.legal_bundle_id
  left join public.legal_text_versions l on l.id = bi.legal_text_version_id
  group by o.id
)
update public.public_contract_offers o
set legal_bundle_id = cb.id,
    updated_at = now(),
    metadata = coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object('legal_bundle_relinked_for_api_visibility', true)
from complete_bundles cb,
     current_bundle_counts cbc
where cbc.offer_id = o.id
  and cb.company_id = o.company_id
  and cb.rn = 1
  and o.publication_status = 'published'
  and o.website_enabled is true
  and coalesce(o.is_archived, false) is false
  and (o.legal_bundle_id is null or coalesce(cbc.current_type_count, 0) < 5);

-- Keep historical booleans aligned with the newer explicit publication fields.
-- The API no longer depends only on is_public, but this keeps admin counters/readiness sane.
update public.public_contract_offers o
set is_public = true,
    published_at = coalesce(o.published_at, now()),
    readiness_status = coalesce(nullif(o.readiness_status, ''), 'ready'),
    readiness_blockers = coalesce(o.readiness_blockers, '[]'::jsonb),
    updated_at = now()
where to_regclass('public.public_contract_offers') is not null
  and o.publication_status = 'published'
  and o.website_enabled is true
  and coalesce(o.is_archived, false) is false
  and o.legal_bundle_id is not null
  and o.price_book_id is not null
  and exists (
    select 1
    from public.integration_api_clients i
    where i.company_id = o.company_id
      and i.status = 'active'
      and i.scopes @> array['website_contracts.read']::text[]
  )
  and coalesce(o.is_public, false) is false;

update public.public_contract_offers o
set is_public = false,
    updated_at = now()
where to_regclass('public.public_contract_offers') is not null
  and coalesce(o.is_public, false) is true
  and (
    coalesce(o.is_archived, false) is true
    or coalesce(o.website_enabled, false) is false
    or coalesce(o.publication_status, 'draft') <> 'published'
  );

create or replace view public.gridex_public_contract_offer_api_diagnostics_v as
with legal_bundle_status as (
  select
    b.id as legal_bundle_id,
    b.company_id,
    count(distinct bi.type) filter (
      where l.status = 'published'
        and l.company_id = b.company_id
        and bi.type in ('terms','privacy_policy','withdrawal','power_of_attorney','price_terms')
    ) as published_legal_type_count
  from public.legal_bundles b
  left join public.legal_bundle_items bi on bi.legal_bundle_id = b.id
  left join public.legal_text_versions l on l.id = bi.legal_text_version_id
  group by b.id, b.company_id
), api_clients as (
  select
    company_id,
    count(*) filter (where status = 'active' and scopes @> array['website_contracts.read']::text[]) as website_contracts_read_client_count
  from public.integration_api_clients
  group by company_id
)
select
  o.id,
  o.company_id,
  o.offer_code,
  o.public_name,
  o.publication_status,
  o.website_enabled,
  o.is_public,
  o.is_archived,
  o.customer_type,
  o.valid_from,
  o.valid_to,
  o.sort_order,
  o.legal_bundle_id,
  o.price_book_id,
  coalesce(ac.website_contracts_read_client_count, 0) as matched_api_client_count,
  coalesce(lbs.published_legal_type_count, 0) as published_legal_type_count,
  coalesce(pb.status, 'missing') as price_book_status,
  array_remove(array[
    case when coalesce(o.publication_status, 'draft') <> 'published' then 'Avtalet är inte publicerat' end,
    case when coalesce(o.website_enabled, false) is false then 'Avtalet är inte markerat för hemsidan' end,
    case when coalesce(o.is_archived, false) is true then 'Avtalet är arkiverat' end,
    case when o.valid_from is not null and o.valid_from > current_date then 'Avtalet börjar gälla i framtiden' end,
    case when o.valid_to is not null and o.valid_to < current_date then 'Avtalet har gått ut' end,
    case when o.legal_bundle_id is null then 'Juridiskt paket saknas' end,
    case when o.legal_bundle_id is not null and coalesce(lbs.published_legal_type_count, 0) < 5 then 'Juridiskt paket saknar publicerade texter' end,
    case when o.price_book_id is null then 'Prislista saknas' end,
    case when o.price_book_id is not null and coalesce(pb.status, 'missing') not in ('published','active') then 'Prislistan är inte publicerad/aktiv' end,
    case when coalesce(ac.website_contracts_read_client_count, 0) = 0 then 'Aktiv API-klient med behörigheten website_contracts.read saknas' end
  ]::text[], null) as api_blockers,
  (
    coalesce(o.publication_status, 'draft') = 'published'
    and coalesce(o.website_enabled, false) is true
    and coalesce(o.is_archived, false) is false
    and (o.valid_from is null or o.valid_from <= current_date)
    and (o.valid_to is null or o.valid_to >= current_date)
    and o.legal_bundle_id is not null
    and coalesce(lbs.published_legal_type_count, 0) >= 5
    and o.price_book_id is not null
    and coalesce(pb.status, 'missing') in ('published','active')
    and coalesce(ac.website_contracts_read_client_count, 0) > 0
  ) as api_visible,
  '/api/v1/website/public-contracts'::text as endpoint_path
from public.public_contract_offers o
left join legal_bundle_status lbs on lbs.legal_bundle_id = o.legal_bundle_id and lbs.company_id = o.company_id
left join public.price_books pb on pb.id = o.price_book_id and pb.company_id = o.company_id
left join api_clients ac on ac.company_id = o.company_id;

comment on view public.gridex_public_contract_offer_api_diagnostics_v is
  'Tenant-safe admin diagnostics for GET /api/v1/website/public-contracts. Shows exactly why a public_contract_offer is or is not returned by the website contracts API.';
