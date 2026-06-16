-- Company card/go-live separation readiness polish
-- Keeps internal OPS contracts, website/API publication and Ediel production as separate readiness tracks.

create or replace view public.tenant_contract_offer_readiness_v as
select
  c.id as company_id,
  c.name as company_name,
  count(o.id) as total_contract_offers,
  count(o.id) filter (where lower(coalesce(o.status,'')) = 'draft') as draft_contracts,
  count(o.id) filter (where lower(coalesce(o.status,'')) = 'active' and coalesce(o.is_active,false) = true) as internal_active_contracts,
  count(o.id) filter (where lower(coalesce(o.status,'')) = 'active' and coalesce(o.is_active,false) = false) as active_but_hidden_contracts,
  count(o.id) filter (where coalesce(o.price_version,'') <> '') as contracts_with_price_version,
  count(o.id) filter (where coalesce(o.terms_version,'') <> '') as contracts_with_terms_version,
  count(pco.id) filter (
    where lower(coalesce(pco.publication_status,'')) = 'published'
      and coalesce(pco.website_enabled,false) = true
      and coalesce(pco.is_public,false) = true
      and coalesce(pco.is_archived,false) = false
  ) as website_published_contracts,
  case
    when count(o.id) filter (
      where lower(coalesce(o.status,'')) = 'active'
        and coalesce(o.is_active,false) = true
        and coalesce(o.price_version,'') <> ''
        and coalesce(o.terms_version,'') <> ''
    ) > 0 then true
    else false
  end as can_use_internal_customer_intake,
  case
    when count(pco.id) filter (
      where lower(coalesce(pco.publication_status,'')) = 'published'
        and coalesce(pco.website_enabled,false) = true
        and coalesce(pco.is_public,false) = true
        and coalesce(pco.is_archived,false) = false
    ) > 0 then true
    else false
  end as can_show_contracts_on_website,
  array_remove(array[
    case when count(o.id) = 0 then 'contract_missing' end,
    case when count(o.id) filter (where lower(coalesce(o.status,'')) = 'active' and coalesce(o.is_active,false) = true) = 0 then 'internal_active_contract_missing' end,
    case when count(o.id) filter (where lower(coalesce(o.status,'')) = 'active' and coalesce(o.is_active,false) = true and coalesce(o.price_version,'') <> '') = 0 then 'price_version_missing' end,
    case when count(o.id) filter (where lower(coalesce(o.status,'')) = 'active' and coalesce(o.is_active,false) = true and coalesce(o.terms_version,'') <> '') = 0 then 'terms_version_missing' end
  ], null) as internal_blockers,
  array_remove(array[
    case when count(pco.id) filter (
      where lower(coalesce(pco.publication_status,'')) = 'published'
        and coalesce(pco.website_enabled,false) = true
        and coalesce(pco.is_public,false) = true
        and coalesce(pco.is_archived,false) = false
    ) = 0 then 'website_contract_publication_missing' end
  ], null) as website_blockers
from public.companies c
left join public.contract_offers o on o.company_id = c.id
left join public.public_contract_offers pco on pco.company_id = c.id
group by c.id, c.name;

comment on view public.tenant_contract_offer_readiness_v is
  'Plain-language tenant contract readiness. Internal OPS contracts require active status, price version and terms version. Website/API publication is a separate track and must not block internal customer handling or Ediel production.';

comment on column public.tenant_contract_offer_readiness_v.can_use_internal_customer_intake is
  'True when the tenant has at least one internally active OPS contract with price/version and terms snapshot inputs. Does not require API or website publication.';
comment on column public.tenant_contract_offer_readiness_v.can_show_contracts_on_website is
  'True when the tenant has at least one published public contract offer. This is a website/API readiness signal only.';
