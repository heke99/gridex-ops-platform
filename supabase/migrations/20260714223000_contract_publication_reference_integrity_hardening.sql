begin;

-- Normalize legacy/UI contract type aliases before selecting mandatory legal modules.
-- A combined customer audience must include both consumer and business requirements.
create or replace function public.gridex_required_legal_modules(
  p_customer_type text,
  p_contract_type text,
  p_channel text default 'website',
  p_automatic_renewal boolean default false,
  p_requires_power_of_attorney boolean default true
) returns text[]
language plpgsql stable security definer set search_path=public
as $$
declare
  v_customer_type text := coalesce(nullif(btrim(p_customer_type),''),'private');
  v_contract_type text := case coalesce(nullif(btrim(p_contract_type),''),'variable_monthly')
    when 'spot' then 'variable_monthly'
    when 'variable' then 'variable_monthly'
    when 'variable_spot' then 'variable_monthly'
    when 'hourly_spot' then 'variable_hourly'
    else coalesce(nullif(btrim(p_contract_type),''),'variable_monthly')
  end;
  v_channel text := coalesce(nullif(btrim(p_channel),''),'website');
  v_modules text[] := '{}';
begin
  select coalesce(array_agg(distinct module_key order by module_key), '{}')
    into v_modules
  from public.legal_requirement_rules r
  cross join lateral unnest(r.required_module_keys) as module_key
  where r.status='active'
    and (
      (v_customer_type='both' and r.customer_type in ('private','business','both'))
      or (v_customer_type<>'both' and r.customer_type in (v_customer_type,'both'))
    )
    and r.contract_type=v_contract_type
    and r.channel in (v_channel,'all');

  if p_automatic_renewal and not ('automatic_renewal'=any(v_modules)) then
    v_modules:=array_append(v_modules,'automatic_renewal');
  end if;
  if not p_requires_power_of_attorney then
    v_modules:=array_remove(v_modules,'power_of_attorney');
  end if;
  return coalesce(v_modules,'{}');
end $$;

-- Mandatory modules are always unioned into a version. A caller may add modules,
-- but cannot accidentally remove a mandatory module through a partial payload.
create or replace function public.gridex_set_contract_version_legal_modules()
returns trigger language plpgsql set search_path=public as $$
declare
  v_required text[];
begin
  v_required := public.gridex_required_legal_modules(
    new.customer_type,
    new.contract_type,
    'website',
    coalesce(new.automatic_renewal,false),
    coalesce(new.power_of_attorney_required,true)
  );

  select coalesce(array_agg(distinct module_key order by module_key),'{}')
    into new.required_legal_modules
  from unnest(coalesce(new.required_legal_modules,'{}') || coalesce(v_required,'{}')) as module_key;

  return new;
end $$;

create index if not exists price_book_lines_reference_lookup_idx
  on public.price_book_lines(price_book_id, component_key);

-- Canonical publication readiness validates complete tenant/legal data, the exact
-- plan/version/book relationship, publication locks and one API client with both
-- read and application-write scopes for website/API channels.
create or replace view public.contract_publication_readiness_v as
select
  cpv.id as contract_publication_version_id,
  a.company_id,
  a.id as assignment_id,
  cpv.status,
  cpv.locked_at,
  cpv.valid_from,
  cpv.valid_to,
  cpv.price_plan_id,
  cpv.price_plan_version_id,
  cpv.price_book_id,
  cpv.legal_bundle_version_id,
  lbv.status as legal_bundle_status,
  lbv.locked_at as legal_bundle_locked_at,
  lbv.unresolved_variables,
  tlp.completeness_status as legal_profile_status,
  pv.status as contract_version_status,
  pv.required_legal_modules,
  coalesce((
    select array_agg(distinct d.module_key order by d.module_key)
    from public.legal_bundle_version_documents d
    where d.legal_bundle_version_id=lbv.id
  ),'{}') as included_legal_modules,
  array_remove(array[
    case when coalesce(tlp.completeness_status,'incomplete') not in ('complete','verified') then 'tenant_legal_profile_incomplete' end,
    case when pv.status <> 'approved' or pv.locked_at is null then 'contract_version_not_approved' end,
    case when cpv.price_plan_id is null then 'price_plan_missing' end,
    case when cpv.price_plan_id is not null and pp.id is null then 'price_plan_not_found_for_tenant' end,
    case when pp.id is not null and coalesce(pp.status,'draft') not in ('active','published','approved') then 'price_plan_not_active' end,
    case when cpv.price_plan_version_id is null then 'price_plan_version_missing' end,
    case when cpv.price_plan_version_id is not null and ppv.id is null then 'price_plan_version_mismatch' end,
    case when ppv.id is not null and coalesce(ppv.status,'draft') not in ('active','published','approved') then 'price_plan_version_not_active' end,
    case when cpv.price_book_id is null then 'price_book_missing' end,
    case when cpv.price_book_id is not null and pb.id is null then 'price_book_not_found_for_tenant' end,
    case when pb.id is not null and coalesce(pb.status,'draft') not in ('active','published') then 'price_book_not_active' end,
    case when cpv.price_book_id is not null and cpv.price_plan_id is not null and cpv.price_plan_version_id is not null and not exists (
      select 1
      from public.price_book_lines pbl
      where pbl.price_book_id=cpv.price_book_id
        and pbl.component_key='price_plan_version'
        and pbl.metadata->>'price_plan_id'=cpv.price_plan_id::text
        and pbl.metadata->>'price_plan_version_id'=cpv.price_plan_version_id::text
    ) then 'price_book_plan_version_mismatch' end,
    case when cpv.legal_bundle_version_id is null then 'legal_bundle_missing' end,
    case when lbv.id is null or lbv.status <> 'published' or lbv.locked_at is null then 'legal_bundle_not_locked' end,
    case when coalesce(array_length(lbv.unresolved_variables,1),0)>0 then 'unresolved_legal_variables' end,
    case when cpv.valid_to is not null and cpv.valid_from is not null and cpv.valid_to < cpv.valid_from then 'invalid_validity_period' end,
    case when cpv.status='published' and cpv.locked_at is null then 'publication_not_locked' end,
    case when cp.channel in ('website','api') and not exists (
      select 1
      from public.integration_api_clients i
      where i.company_id=a.company_id
        and i.status='active'
        and i.scopes @> array['website_contracts.read','website_applications.write']::text[]
    ) then 'website_api_client_scopes_missing' end
  ],null) || coalesce(array(
    select 'missing_legal_module:'||module_key
    from unnest(coalesce(pv.required_legal_modules,'{}')) as required_module(module_key)
    where not exists (
      select 1
      from public.legal_bundle_version_documents d
      where d.legal_bundle_version_id=cpv.legal_bundle_version_id
        and d.module_key=required_module.module_key
    )
  ),'{}') as blockers
from public.contract_publication_versions cpv
join public.contract_publications cp on cp.id=cpv.contract_publication_id
join public.tenant_contract_assignments a on a.id=cp.assignment_id
join public.contract_product_versions pv on pv.id=cpv.contract_product_version_id
left join public.legal_bundle_versions lbv on lbv.id=cpv.legal_bundle_version_id and lbv.company_id=a.company_id
left join public.tenant_legal_profiles tlp on tlp.company_id=a.company_id
left join public.price_plans pp on pp.id=cpv.price_plan_id and pp.company_id=a.company_id
left join public.price_plan_versions ppv on ppv.id=cpv.price_plan_version_id and ppv.company_id=a.company_id and ppv.price_plan_id=cpv.price_plan_id
left join public.price_books pb on pb.id=cpv.price_book_id and pb.company_id=a.company_id;

-- Keep the legacy admin diagnostic view aligned with the same strict runtime rules.
create or replace view public.gridex_public_contract_offer_api_diagnostics_v as
with legal_bundle_status as (
  select
    b.id as legal_bundle_id,
    b.company_id,
    count(distinct bi.type) filter (
      where l.status='published'
        and l.company_id=b.company_id
        and bi.type in ('terms','privacy_policy','withdrawal','power_of_attorney','price_terms')
    ) as published_legal_type_count
  from public.legal_bundles b
  left join public.legal_bundle_items bi on bi.legal_bundle_id=b.id
  left join public.legal_text_versions l on l.id=bi.legal_text_version_id
  group by b.id,b.company_id
), api_clients as (
  select
    company_id,
    count(*) filter (
      where status='active'
        and scopes @> array['website_contracts.read','website_applications.write']::text[]
    ) as website_client_count
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
  coalesce(ac.website_client_count,0) as matched_api_client_count,
  coalesce(lbs.published_legal_type_count,0) as published_legal_type_count,
  coalesce(pb.status,'missing') as price_book_status,
  array_remove(array[
    case when coalesce(o.publication_status,'draft')<>'published' then 'Avtalet är inte publicerat' end,
    case when coalesce(o.website_enabled,false) is false then 'Avtalet är inte markerat för hemsidan' end,
    case when coalesce(o.is_archived,false) is true then 'Avtalet är arkiverat' end,
    case when o.valid_from is not null and o.valid_from>current_date then 'Avtalet börjar gälla i framtiden' end,
    case when o.valid_to is not null and o.valid_to<current_date then 'Avtalet har gått ut' end,
    case when o.legal_bundle_id is null then 'Juridiskt paket saknas' end,
    case when o.legal_bundle_id is not null and coalesce(lbs.published_legal_type_count,0)<5 then 'Juridiskt paket saknar publicerade texter' end,
    case when o.price_plan_id is null then 'Prisplan saknas' end,
    case when o.price_plan_id is not null and pp.id is null then 'Prisplanen hittades inte för bolaget' end,
    case when pp.id is not null and coalesce(pp.status,'draft') not in ('active','published','approved') then 'Prisplanen är inte aktiv/publicerad' end,
    case when o.price_plan_version_id is null then 'Prisversion saknas' end,
    case when o.price_plan_version_id is not null and ppv.id is null then 'Prisversionen hör inte till vald prisplan/bolag' end,
    case when ppv.id is not null and coalesce(ppv.status,'draft') not in ('active','published','approved') then 'Prisversionen är inte aktiv/publicerad' end,
    case when o.price_book_id is null then 'Prislista saknas' end,
    case when o.price_book_id is not null and coalesce(pb.status,'missing') not in ('published','active') then 'Prislistan är inte publicerad/aktiv' end,
    case when o.price_book_id is not null and o.price_plan_id is not null and o.price_plan_version_id is not null and not exists (
      select 1 from public.price_book_lines pbl
      where pbl.price_book_id=o.price_book_id
        and pbl.component_key='price_plan_version'
        and pbl.metadata->>'price_plan_id'=o.price_plan_id::text
        and pbl.metadata->>'price_plan_version_id'=o.price_plan_version_id::text
    ) then 'Prislistan hör inte till vald prisplan och prisversion' end,
    case when coalesce(ac.website_client_count,0)=0 then 'Aktiv API-klient med både website_contracts.read och website_applications.write saknas' end
  ]::text[],null) as api_blockers,
  (
    coalesce(o.publication_status,'draft')='published'
    and coalesce(o.website_enabled,false) is true
    and coalesce(o.is_archived,false) is false
    and (o.valid_from is null or o.valid_from<=current_date)
    and (o.valid_to is null or o.valid_to>=current_date)
    and o.legal_bundle_id is not null
    and coalesce(lbs.published_legal_type_count,0)>=5
    and pp.id is not null
    and coalesce(pp.status,'draft') in ('active','published','approved')
    and ppv.id is not null
    and coalesce(ppv.status,'draft') in ('active','published','approved')
    and pb.id is not null
    and coalesce(pb.status,'missing') in ('published','active')
    and exists (
      select 1 from public.price_book_lines pbl
      where pbl.price_book_id=o.price_book_id
        and pbl.component_key='price_plan_version'
        and pbl.metadata->>'price_plan_id'=o.price_plan_id::text
        and pbl.metadata->>'price_plan_version_id'=o.price_plan_version_id::text
    )
    and coalesce(ac.website_client_count,0)>0
  ) as api_visible,
  '/api/v1/website/public-contracts'::text as endpoint_path
from public.public_contract_offers o
left join legal_bundle_status lbs on lbs.legal_bundle_id=o.legal_bundle_id and lbs.company_id=o.company_id
left join public.price_plans pp on pp.id=o.price_plan_id and pp.company_id=o.company_id
left join public.price_plan_versions ppv on ppv.id=o.price_plan_version_id and ppv.company_id=o.company_id and ppv.price_plan_id=o.price_plan_id
left join public.price_books pb on pb.id=o.price_book_id and pb.company_id=o.company_id
left join api_clients ac on ac.company_id=o.company_id;

comment on view public.contract_publication_readiness_v is
  'Canonical publication readiness with tenant legal profile, exact price plan/version/book mapping, immutable legal package and website API scope checks.';
comment on view public.gridex_public_contract_offer_api_diagnostics_v is
  'Tenant-safe legacy offer diagnostics aligned with canonical publication and both website API scopes.';

commit;
