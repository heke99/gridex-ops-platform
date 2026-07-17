-- Gridex OPS: align the admin/API diagnostic projection with the canonical
-- publication model. Public contract publication no longer uses
-- public_contract_offers.legal_bundle_id / legal_bundles as its legal source.
-- The immutable source is contract_publication_versions.legal_bundle_version_id
-- and legal_bundle_version_documents.

begin;

create or replace view public.gridex_public_contract_offer_api_diagnostics_v as
with api_clients as (
  select
    company_id,
    count(*) filter (
      where status = 'active'
        and scopes @> array['website_contracts.read']::text[]
    ) as website_read_client_count
  from public.integration_api_clients
  group by company_id
), canonical_state as (
  select
    o.id,
    cpv.id as contract_publication_version_id,
    cpv.status as contract_publication_status,
    cpv.locked_at as contract_publication_locked_at,
    cpv.legal_bundle_version_id,
    lbv.status as legal_bundle_version_status,
    lbv.locked_at as legal_bundle_version_locked_at,
    lbv.unresolved_variables,
    coalesce(docs.document_count, 0) as document_count,
    readiness.can_display,
    readiness.can_accept_applications,
    coalesce(readiness.display_blockers, '{}'::text[]) as display_blockers
  from public.public_contract_offers o
  left join public.contract_publication_versions cpv
    on cpv.id = o.contract_publication_version_id
   and cpv.legacy_public_contract_offer_id = o.id
  left join public.legal_bundle_versions lbv
    on lbv.id = cpv.legal_bundle_version_id
   and lbv.company_id = o.company_id
  left join public.contract_publication_readiness_v readiness
    on readiness.contract_publication_version_id = cpv.id
   and readiness.company_id = o.company_id
  left join lateral (
    select count(distinct d.module_key) as document_count
    from public.legal_bundle_version_documents d
    where d.legal_bundle_version_id = cpv.legal_bundle_version_id
      and coalesce(array_length(d.unresolved_variables, 1), 0) = 0
  ) docs on true
), canonical_blockers as (
  select
    state.id,
    coalesce(array(
      select distinct case
        when blocker = 'tenant_legal_profile_missing'
          then 'Bolagets juridikprofil saknas'
        when blocker = 'tenant_legal_profile_incomplete'
          then 'Bolagets juridikprofil är ofullständig'
        when blocker = 'tenant_legal_profile_review_required'
          then 'Bolagets juridikprofil behöver godkännas'
        when blocker = 'contract_version_not_approved'
          then 'Avtalsversionen är inte godkänd'
        when blocker = 'price_areas_missing'
          then 'Elområden saknas'
        when blocker = 'price_area_invalid'
          then 'Ett eller flera elområden är ogiltiga'
        when blocker = 'price_plan_not_active'
          then 'Prisplanen är inte aktiv'
        when blocker = 'price_plan_version_not_locked'
          then 'Prisversionen är inte publicerad och låst'
        when blocker = 'price_book_not_locked'
          then 'Prislistan är inte publicerad och låst'
        when blocker = 'legal_bundle_not_locked'
          then 'Den juridiska paketversionen är inte publicerad och låst'
        when blocker = 'unresolved_legal_variables'
          then 'Juridikpaketet innehåller olösta variabler'
        when blocker = 'invalid_validity_period'
          then 'Avtalets giltighetsperiod är ogiltig'
        when blocker = 'portfolio_price_source_missing_or_unlocked'
          then 'Portföljpriset saknas eller är inte låst'
        when blocker = 'website_contracts_read_scope_missing'
          then 'Aktiv API-klient med website_contracts.read saknas'
        when blocker like 'missing_legal_module:%'
          then 'Juridikmodul saknas: ' || replace(split_part(blocker, ':', 2), '_', ' ')
        else replace(blocker, '_', ' ')
      end
      from unnest(state.display_blockers) blocker
      order by 1
    ), '{}'::text[]) as blockers
  from canonical_state state
), diagnostic_base as (
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
    coalesce(clients.website_read_client_count, 0) as matched_api_client_count,
    coalesce(state.document_count, 0) as published_legal_type_count,
    coalesce(pb.status, 'missing') as price_book_status,
    state.contract_publication_version_id,
    state.contract_publication_status,
    state.contract_publication_locked_at,
    state.legal_bundle_version_id,
    state.legal_bundle_version_status,
    state.legal_bundle_version_locked_at,
    state.unresolved_variables,
    state.can_display,
    coalesce(blockers.blockers, '{}'::text[]) as canonical_blockers,
    array_remove(array[
      case when coalesce(o.publication_status, 'draft') <> 'published'
        then 'Avtalet är inte publicerat' end,
      case when coalesce(o.website_enabled, false) is false
        then 'Avtalet är inte markerat för hemsidan' end,
      case when coalesce(o.is_archived, false) is true
        then 'Avtalet är arkiverat' end,
      case when o.valid_from is not null and o.valid_from > current_date
        then 'Avtalet börjar gälla i framtiden' end,
      case when o.valid_to is not null and o.valid_to < current_date
        then 'Avtalet har gått ut' end,
      case when state.contract_publication_version_id is null
        then 'Kanonisk publiceringsversion saknas' end,
      case when state.contract_publication_version_id is not null
             and coalesce(state.contract_publication_status, 'draft') <> 'published'
        then 'Publiceringsversionen är inte publicerad' end,
      case when state.contract_publication_version_id is not null
             and state.contract_publication_locked_at is null
        then 'Publiceringsversionen är inte låst' end,
      case when state.legal_bundle_version_id is null
        then 'Kanonisk juridisk paketversion saknas' end,
      case when state.legal_bundle_version_id is not null
             and coalesce(state.legal_bundle_version_status, 'draft') <> 'published'
        then 'Den juridiska paketversionen är inte publicerad' end,
      case when state.legal_bundle_version_id is not null
             and state.legal_bundle_version_locked_at is null
        then 'Den juridiska paketversionen är inte låst' end,
      case when state.legal_bundle_version_id is not null
             and coalesce(state.document_count, 0) = 0
        then 'Juridikpaketet innehåller inga renderade juridikmoduler' end,
      case when coalesce(array_length(state.unresolved_variables, 1), 0) > 0
        then 'Juridikpaketet innehåller olösta variabler' end,
      case when coalesce(clients.website_read_client_count, 0) = 0
        then 'Aktiv API-klient med website_contracts.read saknas' end
    ]::text[], null) as direct_blockers
  from public.public_contract_offers o
  left join canonical_state state on state.id = o.id
  left join canonical_blockers blockers on blockers.id = o.id
  left join public.price_books pb
    on pb.id = o.price_book_id
   and pb.company_id = o.company_id
  left join api_clients clients on clients.company_id = o.company_id
), normalized as (
  select
    base.*,
    coalesce(array(
      select distinct blocker
      from unnest(coalesce(base.direct_blockers, '{}'::text[]) || base.canonical_blockers) blocker
      where nullif(btrim(blocker), '') is not null
      order by blocker
    ), '{}'::text[]) as all_blockers
  from diagnostic_base base
)
select
  id,
  company_id,
  offer_code,
  public_name,
  publication_status,
  website_enabled,
  is_public,
  is_archived,
  customer_type,
  valid_from,
  valid_to,
  sort_order,
  legal_bundle_id,
  price_book_id,
  matched_api_client_count,
  published_legal_type_count,
  price_book_status,
  nullif(all_blockers, '{}'::text[]) as api_blockers,
  (
    coalesce(publication_status, 'draft') = 'published'
    and coalesce(website_enabled, false) is true
    and coalesce(is_archived, false) is false
    and (valid_from is null or valid_from <= current_date)
    and (valid_to is null or valid_to >= current_date)
    and contract_publication_version_id is not null
    and contract_publication_status = 'published'
    and contract_publication_locked_at is not null
    and legal_bundle_version_id is not null
    and legal_bundle_version_status = 'published'
    and legal_bundle_version_locked_at is not null
    and published_legal_type_count > 0
    and coalesce(array_length(unresolved_variables, 1), 0) = 0
    and coalesce(can_display, false)
    and matched_api_client_count > 0
    and coalesce(array_length(all_blockers, 1), 0) = 0
  ) as api_visible,
  '/api/v1/website/public-contracts'::text as endpoint_path
from normalized;

comment on view public.gridex_public_contract_offer_api_diagnostics_v is
  'Admin diagnostic aligned with canonical contract_publication_versions and immutable legal_bundle_version_documents. The legacy legal_bundle_id is retained only as a compatibility column and is not a readiness source.';

-- Runtime assertion: the diagnostic must use the canonical legal bundle version,
-- never the removed legacy legal bundle as publication readiness.
do $$
declare
  v_definition text;
begin
  select pg_get_viewdef('public.gridex_public_contract_offer_api_diagnostics_v'::regclass, true)
  into v_definition;

  if v_definition not ilike '%legal_bundle_version_documents%'
     or v_definition not ilike '%contract_publication_readiness_v%'
     or v_definition ilike '%o.legal_bundle_id is null then%'
  then
    raise exception using
      errcode = '23514',
      message = 'canonical_public_contract_api_diagnostic_not_installed';
  end if;
end $$;

commit;
