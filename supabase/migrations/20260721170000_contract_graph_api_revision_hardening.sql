-- Contract publication graph, lifecycle delete, revision and external API hardening.
-- Forward-only migration. The canonical link is
-- public_contract_offers.contract_publication_version_id -> contract_publication_versions.id.
-- contract_publication_versions.legacy_public_contract_offer_id is compatibility only.

begin;

create index if not exists contract_publication_versions_legacy_offer_idx
  on public.contract_publication_versions(legacy_public_contract_offer_id)
  where legacy_public_contract_offer_id is not null;
create index if not exists public_contract_offers_publication_version_idx
  on public.public_contract_offers(contract_publication_version_id)
  where contract_publication_version_id is not null;
create index if not exists contract_publications_assignment_idx
  on public.contract_publications(assignment_id, channel, status);
create index if not exists tenant_contract_assignments_product_version_idx
  on public.tenant_contract_assignments(company_id, contract_product_version_id, status);
-- offer_reference already has a canonical UNIQUE constraint on contract_publication_versions.


insert into public.integration_api_permission_groups(
  group_key,label,description,category,scopes,recommended_default,risk_level,sort_order
) values(
  'website_contract_diagnostics','Diagnostisera hemsidans avtal',
  'Serverintegrationer får läsa tenant-skopad avtals- och publiceringsdiagnostik.',
  'website',array['website_contracts.diagnostics']::text[],false,'normal',12
)
on conflict(group_key) do update set
  label=excluded.label,description=excluded.description,category=excluded.category,
  scopes=excluded.scopes,recommended_default=excluded.recommended_default,
  risk_level=excluded.risk_level,sort_order=excluded.sort_order,is_active=true,updated_at=now();

create table if not exists public.company_market_price_sources (
  company_id uuid not null references public.companies(id) on delete cascade,
  source_key text not null references public.spot_price_sources(source_key) on delete restrict,
  priority integer not null default 100 check (priority >= 0),
  enabled boolean not null default true,
  max_age_minutes integer not null default 180 check (max_age_minutes > 0),
  allow_indicative_latest boolean not null default false,
  supported_resolutions text[] not null default array['monthly','hourly','quarterly']::text[],
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(company_id,source_key)
);

insert into public.company_market_price_sources(company_id,source_key,priority,enabled)
select c.id,s.source_key,100,true
from public.companies c
cross join lateral (
  select source_key from public.spot_price_sources where status='active' order by source_key limit 1
) s
on conflict(company_id,source_key) do nothing;

create or replace function public.gridex_seed_company_market_price_source()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_source_key text;
begin
  select source_key into v_source_key
  from public.spot_price_sources
  where status='active'
  order by source_key
  limit 1;
  if v_source_key is not null then
    insert into public.company_market_price_sources(company_id,source_key,priority,enabled)
    values(new.id,v_source_key,100,true)
    on conflict(company_id,source_key) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists trg_companies_seed_market_price_source on public.companies;
create trigger trg_companies_seed_market_price_source
after insert on public.companies for each row
execute function public.gridex_seed_company_market_price_source();

alter table public.company_market_price_sources enable row level security;
drop policy if exists company_market_price_sources_service_role_all on public.company_market_price_sources;
create policy company_market_price_sources_service_role_all
on public.company_market_price_sources for all to service_role
using(true) with check(true);
drop policy if exists company_market_price_sources_tenant_read on public.company_market_price_sources;
create policy company_market_price_sources_tenant_read
on public.company_market_price_sources for select to authenticated
using(public.gridex_can_read_company(company_id));
drop policy if exists company_market_price_sources_tenant_write on public.company_market_price_sources;
create policy company_market_price_sources_tenant_write
on public.company_market_price_sources for all to authenticated
using(public.gridex_can_write_company(company_id))
with check(public.gridex_can_write_company(company_id));

create table if not exists public.contract_publication_graph_issues (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  public_contract_offer_id uuid,
  contract_publication_version_id uuid,
  issue_code text not null,
  severity text not null default 'error' check (severity in ('warning','error')),
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','resolved','ignored')),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution jsonb not null default '{}'::jsonb
);
create unique index if not exists contract_publication_graph_issues_open_uidx
  on public.contract_publication_graph_issues(
    coalesce(company_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(public_contract_offer_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(contract_publication_version_id,'00000000-0000-0000-0000-000000000000'::uuid),
    issue_code
  ) where status='open';

alter table public.contract_publication_graph_issues enable row level security;
drop policy if exists contract_publication_graph_issues_service_role_all on public.contract_publication_graph_issues;
create policy contract_publication_graph_issues_service_role_all
on public.contract_publication_graph_issues for all to service_role
using(true) with check(true);
drop policy if exists contract_publication_graph_issues_platform_read on public.contract_publication_graph_issues;
create policy contract_publication_graph_issues_platform_read
on public.contract_publication_graph_issues for select to authenticated
using(public.gridex_user_is_platform_admin());

create or replace function public.gridex_resolve_contract_lifecycle_graph(
  p_company_id uuid,
  p_offer_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_product_version_ids uuid[]:='{}'::uuid[];
  v_public_offer_ids uuid[]:='{}'::uuid[];
  v_forward_publication_version_ids uuid[]:='{}'::uuid[];
  v_assignment_ids uuid[]:='{}'::uuid[];
  v_publication_ids uuid[]:='{}'::uuid[];
  v_tree_publication_version_ids uuid[]:='{}'::uuid[];
  v_reverse_publication_version_ids uuid[]:='{}'::uuid[];
  v_publication_version_ids uuid[]:='{}'::uuid[];
  v_legal_version_ids uuid[]:='{}'::uuid[];
  v_price_plan_ids uuid[]:='{}'::uuid[];
  v_price_plan_version_ids uuid[]:='{}'::uuid[];
  v_price_book_ids uuid[]:='{}'::uuid[];
  v_successor_ids uuid[]:='{}'::uuid[];
  v_shared_product_offer_ids uuid[]:='{}'::uuid[];
  v_shared_legal_offer_ids uuid[]:='{}'::uuid[];
  v_stale_reverse_ids uuid[]:='{}'::uuid[];
  v_missing_reverse_ids uuid[]:='{}'::uuid[];
  v_company_mismatch_ids uuid[]:='{}'::uuid[];
  v_channel_mismatch_ids uuid[]:='{}'::uuid[];
  v_source_mismatch_ids uuid[]:='{}'::uuid[];
  v_product_version_mismatch_ids uuid[]:='{}'::uuid[];
  v_forward_reverse_mismatch_ids uuid[]:='{}'::uuid[];
  v_unsafe_count bigint:=0;
begin
  select * into o
  from public.contract_offers
  where id=p_offer_id and company_id=p_company_id;
  if not found then
    return jsonb_build_object(
      'ok',false,
      'code','contract_offer_not_found',
      'company_id',p_company_id,
      'offer_id',p_offer_id
    );
  end if;

  v_product_version_ids:=array(
    select distinct id from (
      select o.contract_product_version_id id
      where o.contract_product_version_id is not null
      union
      select po.contract_product_version_id
      from public.public_contract_offers po
      where po.company_id=p_company_id
        and po.source_contract_offer_id=o.id
        and po.contract_product_version_id is not null
    ) q order by id
  );

  v_public_offer_ids:=array(
    select distinct po.id
    from public.public_contract_offers po
    where po.company_id=p_company_id
      and (
        po.source_contract_offer_id=o.id
        or (
          cardinality(v_product_version_ids)>0
          and po.contract_product_version_id=any(v_product_version_ids)
        )
      )
    order by po.id
  );

  v_forward_publication_version_ids:=array(
    select distinct po.contract_publication_version_id
    from public.public_contract_offers po
    where po.id=any(v_public_offer_ids)
      and po.contract_publication_version_id is not null
    order by po.contract_publication_version_id
  );

  v_assignment_ids:=array(
    select distinct ta.id
    from public.tenant_contract_assignments ta
    where ta.company_id=p_company_id
      and cardinality(v_product_version_ids)>0
      and ta.contract_product_version_id=any(v_product_version_ids)
    order by ta.id
  );

  v_publication_ids:=array(
    select distinct cp.id
    from public.contract_publications cp
    where cardinality(v_assignment_ids)>0
      and cp.assignment_id=any(v_assignment_ids)
    order by cp.id
  );

  v_tree_publication_version_ids:=array(
    select distinct cpv.id
    from public.contract_publication_versions cpv
    where cardinality(v_publication_ids)>0
      and cpv.contract_publication_id=any(v_publication_ids)
    order by cpv.id
  );

  -- Deliberately no contract_publication_id filter here. This is the production
  -- bug fix: every direct reverse FK reference must be visible to the graph.
  v_reverse_publication_version_ids:=array(
    select distinct cpv.id
    from public.contract_publication_versions cpv
    where cardinality(v_public_offer_ids)>0
      and cpv.legacy_public_contract_offer_id=any(v_public_offer_ids)
    order by cpv.id
  );

  v_publication_version_ids:=array(
    select distinct id from (
      select unnest(v_tree_publication_version_ids) id
      union select unnest(v_forward_publication_version_ids)
      union select unnest(v_reverse_publication_version_ids)
    ) q order by id
  );

  v_publication_ids:=array(
    select distinct id from (
      select unnest(v_publication_ids) id
      union
      select cpv.contract_publication_id
      from public.contract_publication_versions cpv
      where cpv.id=any(v_publication_version_ids)
    ) q order by id
  );

  v_assignment_ids:=array(
    select distinct id from (
      select unnest(v_assignment_ids) id
      union
      select cp.assignment_id
      from public.contract_publications cp
      where cp.id=any(v_publication_ids)
    ) q order by id
  );

  v_legal_version_ids:=array(
    select distinct id from (
      select o.legal_bundle_version_id id where o.legal_bundle_version_id is not null
      union
      select cpv.legal_bundle_version_id
      from public.contract_publication_versions cpv
      where cpv.id=any(v_publication_version_ids) and cpv.legal_bundle_version_id is not null
      union
      select po.legal_bundle_version_id
      from public.public_contract_offers po
      where po.id=any(v_public_offer_ids) and po.legal_bundle_version_id is not null
    ) q order by id
  );

  v_price_plan_ids:=array(
    select distinct id from (
      select o.price_plan_id id where o.price_plan_id is not null
      union select cpv.price_plan_id from public.contract_publication_versions cpv
        where cpv.id=any(v_publication_version_ids) and cpv.price_plan_id is not null
      union select po.price_plan_id from public.public_contract_offers po
        where po.id=any(v_public_offer_ids) and po.price_plan_id is not null
    ) q order by id
  );
  v_price_plan_version_ids:=array(
    select distinct id from (
      select o.price_plan_version_id id where o.price_plan_version_id is not null
      union select cpv.price_plan_version_id from public.contract_publication_versions cpv
        where cpv.id=any(v_publication_version_ids) and cpv.price_plan_version_id is not null
      union select po.price_plan_version_id from public.public_contract_offers po
        where po.id=any(v_public_offer_ids) and po.price_plan_version_id is not null
    ) q order by id
  );
  v_price_book_ids:=array(
    select distinct id from (
      select o.price_book_id id where o.price_book_id is not null
      union select cpv.price_book_id from public.contract_publication_versions cpv
        where cpv.id=any(v_publication_version_ids) and cpv.price_book_id is not null
      union select po.price_book_id from public.public_contract_offers po
        where po.id=any(v_public_offer_ids) and po.price_book_id is not null
    ) q order by id
  );

  v_successor_ids:=array(
    select id from public.contract_offers
    where company_id=p_company_id and supersedes_offer_id=o.id
    order by id
  );
  v_shared_product_offer_ids:=array(
    select other_offer.id
    from public.contract_offers other_offer
    where other_offer.company_id=p_company_id
      and other_offer.id<>o.id
      and o.contract_product_version_id is not null
      and other_offer.contract_product_version_id=o.contract_product_version_id
    order by other_offer.id
  );
  v_shared_legal_offer_ids:=array(
    select other_offer.id
    from public.contract_offers other_offer
    where other_offer.company_id=p_company_id
      and other_offer.id<>o.id
      and o.legal_bundle_version_id is not null
      and other_offer.legal_bundle_version_id=o.legal_bundle_version_id
    order by other_offer.id
  );

  -- Same-tenant stale reverse compatibility pointers are safe to clear because
  -- the public-offer forward pointer is canonical and the publication version
  -- itself remains intact unless it belongs to the target graph.
  v_stale_reverse_ids:=array(
    select distinct cpv.id
    from public.contract_publication_versions cpv
    join public.public_contract_offers po on po.id=cpv.legacy_public_contract_offer_id
    join public.contract_publications cp on cp.id=cpv.contract_publication_id
    join public.tenant_contract_assignments ta on ta.id=cp.assignment_id
    where po.id=any(v_public_offer_ids)
      and ta.company_id=p_company_id
      and po.company_id=p_company_id
      and po.contract_publication_version_id is distinct from cpv.id
    order by cpv.id
  );

  v_missing_reverse_ids:=array(
    select distinct cpv.id
    from public.public_contract_offers po
    join public.contract_publication_versions cpv on cpv.id=po.contract_publication_version_id
    join public.contract_publications cp on cp.id=cpv.contract_publication_id
    join public.tenant_contract_assignments ta on ta.id=cp.assignment_id
    where po.id=any(v_public_offer_ids)
      and po.company_id=p_company_id
      and ta.company_id=p_company_id
      and cpv.contract_product_version_id=po.contract_product_version_id
      and cpv.legacy_public_contract_offer_id is null
    order by cpv.id
  );

  v_company_mismatch_ids:=array(
    select distinct cpv.id
    from public.contract_publication_versions cpv
    join public.contract_publications cp on cp.id=cpv.contract_publication_id
    join public.tenant_contract_assignments ta on ta.id=cp.assignment_id
    where cpv.id=any(v_publication_version_ids)
      and ta.company_id<>p_company_id
    order by cpv.id
  );

  v_channel_mismatch_ids:=array(
    select distinct cpv.id
    from public.contract_publication_versions cpv
    join public.contract_publications cp on cp.id=cpv.contract_publication_id
    join public.tenant_contract_assignments ta on ta.id=cp.assignment_id
    left join public.tenant_contract_channels ch
      on ch.assignment_id=ta.id and ch.channel=cp.channel
    where cpv.id=any(v_publication_version_ids)
      and ta.company_id=p_company_id
      and ch.id is null
    order by cpv.id
  );

  v_source_mismatch_ids:=array(
    select po.id
    from public.public_contract_offers po
    where po.id=any(v_public_offer_ids)
      and po.source_contract_offer_id is not null
      and po.source_contract_offer_id<>o.id
    order by po.id
  );

  v_product_version_mismatch_ids:=array(
    select distinct id from (
      select po.id
      from public.public_contract_offers po
      where po.id=any(v_public_offer_ids)
        and o.contract_product_version_id is not null
        and po.contract_product_version_id is distinct from o.contract_product_version_id
      union
      select cpv.id
      from public.contract_publication_versions cpv
      where cpv.id=any(v_publication_version_ids)
        and o.contract_product_version_id is not null
        and cpv.contract_product_version_id is distinct from o.contract_product_version_id
    ) q order by id
  );

  v_forward_reverse_mismatch_ids:=array(
    select distinct id from (
      select po.id
      from public.public_contract_offers po
      left join public.contract_publication_versions cpv
        on cpv.id=po.contract_publication_version_id
      where po.id=any(v_public_offer_ids)
        and po.contract_publication_version_id is not null
        and cpv.legacy_public_contract_offer_id is distinct from po.id
        and not (cpv.id=any(v_stale_reverse_ids))
        and not (cpv.id=any(v_missing_reverse_ids))
      union
      select cpv.id
      from public.contract_publication_versions cpv
      join public.public_contract_offers po on po.id=cpv.legacy_public_contract_offer_id
      where cpv.id=any(v_reverse_publication_version_ids)
        and po.contract_publication_version_id is distinct from cpv.id
        and not (cpv.id=any(v_stale_reverse_ids))
        and not (cpv.id=any(v_missing_reverse_ids))
    ) q order by id
  );

  v_unsafe_count:=cardinality(v_company_mismatch_ids)
    +cardinality(v_channel_mismatch_ids)
    +cardinality(v_source_mismatch_ids)
    +cardinality(v_product_version_mismatch_ids)
    +cardinality(v_forward_reverse_mismatch_ids);

  return jsonb_build_object(
    'ok',true,
    'company_id',p_company_id,
    'offer_id',o.id,
    'contract_product_id',o.contract_product_id,
    'contract_product_version_ids',to_jsonb(v_product_version_ids),
    'public_contract_offer_ids',to_jsonb(v_public_offer_ids),
    'tenant_assignment_ids',to_jsonb(v_assignment_ids),
    'publication_ids',to_jsonb(v_publication_ids),
    'tree_publication_version_ids',to_jsonb(v_tree_publication_version_ids),
    'forward_publication_version_ids',to_jsonb(v_forward_publication_version_ids),
    'direct_reverse_legacy_publication_version_ids',to_jsonb(v_reverse_publication_version_ids),
    'publication_version_ids',to_jsonb(v_publication_version_ids),
    'legal_bundle_version_ids',to_jsonb(v_legal_version_ids),
    'price_plan_ids',to_jsonb(v_price_plan_ids),
    'price_plan_version_ids',to_jsonb(v_price_plan_version_ids),
    'price_book_ids',to_jsonb(v_price_book_ids),
    'successor_offer_ids',to_jsonb(v_successor_ids),
    'shared_product_version_offer_ids',to_jsonb(v_shared_product_offer_ids),
    'shared_legal_version_offer_ids',to_jsonb(v_shared_legal_offer_ids),
    'repairable_stale_reverse_publication_version_ids',to_jsonb(v_stale_reverse_ids),
    'repairable_missing_reverse_publication_version_ids',to_jsonb(v_missing_reverse_ids),
    'company_mismatch_ids',to_jsonb(v_company_mismatch_ids),
    'channel_mismatch_ids',to_jsonb(v_channel_mismatch_ids),
    'source_offer_mismatch_ids',to_jsonb(v_source_mismatch_ids),
    'product_version_mismatch_ids',to_jsonb(v_product_version_mismatch_ids),
    'forward_reverse_link_mismatch_ids',to_jsonb(v_forward_reverse_mismatch_ids),
    'counts',jsonb_build_object(
      'public_offers',cardinality(v_public_offer_ids),
      'tenant_assignments',cardinality(v_assignment_ids),
      'publications',cardinality(v_publication_ids),
      'publication_versions',cardinality(v_publication_version_ids),
      'direct_reverse_legacy_references',cardinality(v_reverse_publication_version_ids),
      'repairable_stale_reverse_references',cardinality(v_stale_reverse_ids),
      'repairable_missing_reverse_references',cardinality(v_missing_reverse_ids),
      'legal_bundle_versions',cardinality(v_legal_version_ids),
      'successor_offers',cardinality(v_successor_ids),
      'shared_product_version_references',cardinality(v_shared_product_offer_ids),
      'shared_legal_version_references',cardinality(v_shared_legal_offer_ids),
      'company_mismatches',cardinality(v_company_mismatch_ids),
      'channel_mismatches',cardinality(v_channel_mismatch_ids),
      'source_offer_mismatches',cardinality(v_source_mismatch_ids),
      'product_version_mismatches',cardinality(v_product_version_mismatch_ids),
      'forward_reverse_link_mismatches',cardinality(v_forward_reverse_mismatch_ids),
      'unsafe_graph_issues',v_unsafe_count
    ),
    'canonical_graph_consistent',v_unsafe_count=0
  );
end $$;

create or replace function public.gridex_contract_system_dependency_counts(
  p_company_id uuid,p_offer_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  g jsonb;
  c jsonb;
  v_offer_versions bigint:=0;
begin
  g:=public.gridex_resolve_contract_lifecycle_graph(p_company_id,p_offer_id);
  if not coalesce((g->>'ok')::boolean,false) then return g; end if;
  c:=coalesce(g->'counts','{}'::jsonb);
  select count(*) into v_offer_versions
  from public.contract_offer_versions
  where company_id=p_company_id and contract_offer_id=p_offer_id;
  return jsonb_build_object(
    'ok',true,
    'offer_versions',v_offer_versions,
    'successor_offers',coalesce((c->>'successor_offers')::bigint,0),
    'public_offers',coalesce((c->>'public_offers')::bigint,0),
    'product_versions',jsonb_array_length(coalesce(g->'contract_product_version_ids','[]'::jsonb)),
    'tenant_assignments',coalesce((c->>'tenant_assignments')::bigint,0),
    'channel_rows',(
      select count(*) from public.tenant_contract_channels
      where assignment_id=any(array(select jsonb_array_elements_text(g->'tenant_assignment_ids')::uuid))
    ),
    'active_channels',(
      select count(*) from public.tenant_contract_channels
      where assignment_id=any(array(select jsonb_array_elements_text(g->'tenant_assignment_ids')::uuid))
        and status='active'
    ),
    'publications',coalesce((c->>'publications')::bigint,0),
    'publication_versions',coalesce((c->>'publication_versions')::bigint,0),
    'direct_reverse_legacy_references',coalesce((c->>'direct_reverse_legacy_references')::bigint,0),
    'repairable_stale_reverse_references',coalesce((c->>'repairable_stale_reverse_references')::bigint,0),
    'legal_bundle_versions',coalesce((c->>'legal_bundle_versions')::bigint,0),
    'shared_product_version_references',coalesce((c->>'shared_product_version_references')::bigint,0),
    'shared_legal_version_references',coalesce((c->>'shared_legal_version_references')::bigint,0),
    'unsafe_graph_issues',coalesce((c->>'unsafe_graph_issues')::bigint,0),
    'graph',g
  );
end $$;

create or replace function public.gridex_preview_delete_unused_contract(
  p_company_id uuid,p_offer_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_business jsonb;
  v_graph jsonb;
  v_counts jsonb;
  v_reason_codes text[]:='{}'::text[];
  v_business_total bigint:=0;
  v_unsafe_total bigint:=0;
  v_can_delete boolean:=false;
  v_mapping_complete boolean:=false;
  v_requires_unpublish boolean:=false;
begin
  select * into o from public.contract_offers
  where id=p_offer_id and company_id=p_company_id;
  if not found then
    return jsonb_build_object('ok',false,'code','contract_offer_not_found','can_delete',false,'deletable',false);
  end if;

  v_business:=public.gridex_contract_business_usage_counts(p_company_id,p_offer_id);
  v_graph:=public.gridex_resolve_contract_lifecycle_graph(p_company_id,p_offer_id);
  v_counts:=coalesce(v_graph->'counts','{}'::jsonb);
  v_business_total:=coalesce((v_business->>'total')::bigint,0);
  v_unsafe_total:=coalesce((v_counts->>'successor_offers')::bigint,0)
    +coalesce((v_counts->>'shared_product_version_references')::bigint,0)
    +coalesce((v_counts->>'shared_legal_version_references')::bigint,0)
    +coalesce((v_counts->>'unsafe_graph_issues')::bigint,0);
  v_mapping_complete:=o.contract_product_id is not null and o.contract_product_version_id is not null;
  v_requires_unpublish:=exists(
    select 1 from public.tenant_contract_channels
    where assignment_id=any(array(select jsonb_array_elements_text(v_graph->'tenant_assignment_ids')::uuid))
      and status='active'
  );

  if coalesce((v_business->>'customer_contracts')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_CUSTOMER_CONTRACTS'); end if;
  if coalesce((v_business->>'customer_applications')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_ACCEPTED_APPLICATIONS'); end if;
  if coalesce((v_business->>'external_intakes')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_EXTERNAL_INTAKES'); end if;
  if coalesce((v_business->>'binding_price_snapshots')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_BINDING_PRICE_SNAPSHOTS'); end if;
  if coalesce((v_business->>'invoices')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_INVOICES'); end if;
  if coalesce((v_business->>'billing_underlays')::bigint,0)>0 or coalesce((v_business->>'billing_underlay_items')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_BILLING_HISTORY'); end if;
  if coalesce((v_business->>'charge_ledger')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_CHARGE_LEDGER'); end if;
  if coalesce((v_business->>'legal_acceptances')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_LEGAL_ACCEPTANCES'); end if;
  if coalesce((v_counts->>'successor_offers')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_SUCCESSOR_VERSION'); end if;
  if coalesce((v_counts->>'shared_product_version_references')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_SHARED_CANONICAL_VERSION'); end if;
  if coalesce((v_counts->>'shared_legal_version_references')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_SHARED_LEGAL_VERSION'); end if;
  if jsonb_array_length(coalesce(v_graph->'company_mismatch_ids','[]'::jsonb))>0 then v_reason_codes:=array_append(v_reason_codes,'PUBLICATION_COMPANY_MISMATCH'); end if;
  if jsonb_array_length(coalesce(v_graph->'channel_mismatch_ids','[]'::jsonb))>0 then v_reason_codes:=array_append(v_reason_codes,'PUBLICATION_CHANNEL_MISMATCH'); end if;
  if jsonb_array_length(coalesce(v_graph->'source_offer_mismatch_ids','[]'::jsonb))>0 then v_reason_codes:=array_append(v_reason_codes,'PUBLICATION_SOURCE_OFFER_MISMATCH'); end if;
  if jsonb_array_length(coalesce(v_graph->'product_version_mismatch_ids','[]'::jsonb))>0 then v_reason_codes:=array_append(v_reason_codes,'PUBLICATION_PRODUCT_VERSION_MISMATCH'); end if;
  if jsonb_array_length(coalesce(v_graph->'forward_reverse_link_mismatch_ids','[]'::jsonb))>0 then v_reason_codes:=array_append(v_reason_codes,'PUBLICATION_VERSION_LINK_MISMATCH'); end if;
  if not v_mapping_complete then v_reason_codes:=array_append(v_reason_codes,'INCOMPLETE_CANONICAL_MAPPING'); end if;

  v_can_delete:=v_business_total=0 and v_unsafe_total=0 and v_mapping_complete;

  return jsonb_build_object(
    'ok',true,
    'can_delete',v_can_delete,
    'deletable',v_can_delete,
    'has_business_usage',v_business_total>0,
    'requires_archive',v_business_total>0,
    'requires_unpublish',v_requires_unpublish,
    'recommended_action',case
      when v_business_total>0 then 'archive'
      when coalesce((v_counts->>'unsafe_graph_issues')::bigint,0)>0 then 'repair'
      when v_can_delete then 'delete'
      else 'repair'
    end,
    'result_mode',case when v_can_delete then 'delete' else 'archive_only' end,
    'business_blockers',v_business-'ok'-'total',
    'business_references',v_business-'ok'-'total',
    'removable_system_dependencies',jsonb_build_object(
      'public_offers',coalesce((v_counts->>'public_offers')::bigint,0),
      'tenant_assignments',coalesce((v_counts->>'tenant_assignments')::bigint,0),
      'publications',coalesce((v_counts->>'publications')::bigint,0),
      'publication_versions',coalesce((v_counts->>'publication_versions')::bigint,0),
      'direct_reverse_legacy_references',coalesce((v_counts->>'direct_reverse_legacy_references')::bigint,0),
      'repairable_stale_reverse_references',coalesce((v_counts->>'repairable_stale_reverse_references')::bigint,0),
      'legal_bundle_versions',coalesce((v_counts->>'legal_bundle_versions')::bigint,0)
    ),
    'system_references',v_counts,
    'shared_or_unsafe_dependencies',jsonb_build_object(
      'successor_offers',coalesce((v_counts->>'successor_offers')::bigint,0),
      'shared_product_version_references',coalesce((v_counts->>'shared_product_version_references')::bigint,0),
      'shared_legal_version_references',coalesce((v_counts->>'shared_legal_version_references')::bigint,0),
      'unsafe_graph_issues',coalesce((v_counts->>'unsafe_graph_issues')::bigint,0),
      'canonical_mapping_complete',v_mapping_complete
    ),
    'reason_codes',to_jsonb(v_reason_codes),
    'graph',v_graph,
    'lifecycle_status',o.lifecycle_status,
    'contract_product_id',o.contract_product_id,
    'contract_product_version_id',o.contract_product_version_id
  );
end $$;

create or replace function public.gridex_repair_contract_publication_links(
  p_company_id uuid,p_offer_id uuid,p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  g jsonb;
  v_public_offer_ids uuid[]:='{}'::uuid[];
  v_count bigint:=0;
  v_cleared bigint:=0;
  v_set bigint:=0;
begin
  g:=public.gridex_resolve_contract_lifecycle_graph(p_company_id,p_offer_id);
  if not coalesce((g->>'ok')::boolean,false) then return g; end if;
  if coalesce((g#>>'{counts,unsafe_graph_issues}')::bigint,0)>0 then
    return jsonb_build_object(
      'ok',false,'code','PUBLICATION_GRAPH_INCONSISTENT','recommended_action','manual_review',
      'graph',g
    );
  end if;

  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_public_offer_ids
  from jsonb_array_elements_text(g->'public_contract_offer_ids');

  -- The compatibility pointer is mutable only inside an explicit canonical
  -- lifecycle transition. Both flags are transaction-local and the immutable
  -- trigger still rejects changes to every non-lifecycle field.
  perform set_config('gridex.version_transition','on',true);
  perform set_config('gridex.publication_link_repair','on',true);
  update public.contract_publication_versions cpv
  set legacy_public_contract_offer_id=null
  from public.public_contract_offers po,
       public.contract_publications cp,
       public.tenant_contract_assignments ta
  where po.id=cpv.legacy_public_contract_offer_id
    and cp.id=cpv.contract_publication_id
    and ta.id=cp.assignment_id
    and po.id=any(v_public_offer_ids)
    and po.company_id=p_company_id
    and ta.company_id=p_company_id
    and po.contract_publication_version_id is distinct from cpv.id;
  get diagnostics v_cleared=row_count;

  update public.contract_publication_versions cpv
  set legacy_public_contract_offer_id=po.id
  from public.public_contract_offers po,
       public.contract_publications cp,
       public.tenant_contract_assignments ta
  where po.id=any(v_public_offer_ids)
    and cp.id=cpv.contract_publication_id
    and ta.id=cp.assignment_id
    and po.company_id=p_company_id
    and po.contract_publication_version_id=cpv.id
    and ta.company_id=p_company_id
    and cpv.legacy_public_contract_offer_id is distinct from po.id;
  get diagnostics v_set=row_count;
  v_count:=v_cleared+v_set;

  if v_count>0 then
    insert into public.audit_logs(
      company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata
    ) values(
      p_company_id,p_actor_user_id,'contract_offer',p_offer_id::text,
      'contract.publication_links.repaired',null,null,
      jsonb_build_object('cleared_stale_reverse_links',v_cleared,'set_canonical_reverse_links',v_set)
    );
  end if;

  return jsonb_build_object(
    'ok',true,'changed',v_count>0,'cleared_stale_reverse_links',v_cleared,
    'set_canonical_reverse_links',v_set,
    'graph',public.gridex_resolve_contract_lifecycle_graph(p_company_id,p_offer_id)
  );
end $$;

create or replace function public.gridex_assert_no_public_offer_fk_references(
  p_public_offer_ids uuid[]
) returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  fk record;
  v_exists boolean;
begin
  if cardinality(coalesce(p_public_offer_ids,'{}'::uuid[]))=0 then return; end if;
  for fk in
    select c.conname,c.conrelid::regclass as relation_name,a.attname as column_name
    from pg_constraint c
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.contype='f'
      and c.confrelid='public.public_contract_offers'::regclass
      and cardinality(c.conkey)=1
  loop
    execute format('select exists(select 1 from %s where %I=any($1))',fk.relation_name,fk.column_name)
      into v_exists using p_public_offer_ids;
    if v_exists then
      raise exception using
        errcode='23503',
        message='contract_public_offer_still_referenced',
        detail=format('Foreign key %s on %s.%I still references a public offer.',fk.conname,fk.relation_name,fk.column_name);
    end if;
  end loop;
end $$;

create table if not exists public.contract_publication_revisions (
  company_id uuid not null references public.companies(id) on delete cascade,
  channel text not null check (channel in ('website','api','internal','phone','partner')),
  revision bigint not null default 0,
  revision_token uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  primary key(company_id,channel)
);

alter table public.contract_publication_revisions enable row level security;
drop policy if exists contract_publication_revisions_service_role_all on public.contract_publication_revisions;
create policy contract_publication_revisions_service_role_all
on public.contract_publication_revisions for all to service_role
using(true) with check(true);
drop policy if exists contract_publication_revisions_tenant_read on public.contract_publication_revisions;
create policy contract_publication_revisions_tenant_read
on public.contract_publication_revisions for select to authenticated
using(public.gridex_can_read_company(company_id));

create or replace function public.gridex_bump_contract_publication_revision(
  p_company_id uuid,p_channel text,p_reason text,p_entity_id text default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  r public.contract_publication_revisions%rowtype;
  v_event_id uuid;
begin
  if p_company_id is null or p_channel not in ('website','api','internal','phone','partner') then
    raise exception using errcode='22023',message='publication_revision_scope_invalid';
  end if;
  insert into public.contract_publication_revisions(company_id,channel,revision,revision_token,updated_at)
  values(p_company_id,p_channel,1,gen_random_uuid(),now())
  on conflict(company_id,channel) do update set
    revision=public.contract_publication_revisions.revision+1,
    revision_token=gen_random_uuid(),
    updated_at=now()
  returning * into r;

  insert into public.domain_events(
    company_id,event_type,aggregate_type,aggregate_id,source,idempotency_key,payload
  ) values(
    p_company_id,'contracts.publication.changed','contract_publication',
    coalesce(p_entity_id,p_company_id::text),'database',
    format('contracts.publication.changed:%s:%s:%s',p_company_id,p_channel,r.revision),
    jsonb_build_object(
      'event_id',gen_random_uuid(),
      'tenant_reference',p_company_id,
      'channel',p_channel,
      'publication_revision',r.revision,
      'revision_token',r.revision_token,
      'reason',p_reason,
      'timestamp',r.updated_at
    )
  ) on conflict(idempotency_key) where idempotency_key is not null do nothing
  returning id into v_event_id;

  if v_event_id is not null then
    insert into public.event_outbox(company_id,domain_event_id,destination_type,destination_key,payload)
    values(
      p_company_id,v_event_id,'webhook','contracts.publication.changed',
      jsonb_build_object('domain_event_id',v_event_id,'event_type','contracts.publication.changed')
    ) on conflict do nothing;
  end if;

  return jsonb_build_object(
    'company_id',r.company_id,'channel',r.channel,'revision',r.revision,
    'revision_token',r.revision_token,'updated_at',r.updated_at,'event_id',v_event_id
  );
end $$;

create or replace function public.gridex_contract_publication_revision_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_company_id uuid;
  v_channel text;
  v_entity_id text;
begin
  if tg_table_name='public_contract_offers' then
    v_company_id:=coalesce(new.company_id,old.company_id);
    v_channel:='website';
    v_entity_id:=coalesce(new.id,old.id)::text;
  elsif tg_table_name='tenant_contract_channels' then
    select ta.company_id into v_company_id
    from public.tenant_contract_assignments ta
    where ta.id=coalesce(new.assignment_id,old.assignment_id);
    v_channel:=coalesce(new.channel,old.channel);
    v_entity_id:=coalesce(new.id,old.id)::text;
  elsif tg_table_name='contract_publications' then
    select ta.company_id into v_company_id
    from public.tenant_contract_assignments ta
    where ta.id=coalesce(new.assignment_id,old.assignment_id);
    v_channel:=coalesce(new.channel,old.channel);
    v_entity_id:=coalesce(new.id,old.id)::text;
  elsif tg_table_name='contract_publication_versions' then
    select ta.company_id,cp.channel into v_company_id,v_channel
    from public.contract_publications cp
    join public.tenant_contract_assignments ta on ta.id=cp.assignment_id
    where cp.id=coalesce(new.contract_publication_id,old.contract_publication_id);
    v_entity_id:=coalesce(new.id,old.id)::text;
  end if;
  if v_company_id is not null and v_channel is not null then
    perform public.gridex_bump_contract_publication_revision(
      v_company_id,v_channel,tg_table_name||'.'||lower(tg_op),v_entity_id
    );
  end if;
  if tg_op='DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists trg_public_contract_offers_publication_revision on public.public_contract_offers;
create trigger trg_public_contract_offers_publication_revision
after insert or delete or update of publication_status,is_public,is_archived,website_enabled,website_cta_enabled,contract_publication_version_id,legal_bundle_version_id,price_plan_version_id,price_book_id
on public.public_contract_offers for each row execute function public.gridex_contract_publication_revision_trigger();

drop trigger if exists trg_tenant_contract_channels_publication_revision on public.tenant_contract_channels;
create trigger trg_tenant_contract_channels_publication_revision
after insert or delete or update of status,valid_from,valid_to,marketing_content
on public.tenant_contract_channels for each row execute function public.gridex_contract_publication_revision_trigger();

drop trigger if exists trg_contract_publications_publication_revision on public.contract_publications;
create trigger trg_contract_publications_publication_revision
after insert or delete or update of status,channel
on public.contract_publications for each row execute function public.gridex_contract_publication_revision_trigger();

drop trigger if exists trg_contract_publication_versions_publication_revision on public.contract_publication_versions;
create trigger trg_contract_publication_versions_publication_revision
after insert or delete or update of status,valid_from,valid_to,content_sha256,price_plan_version_id,price_book_id,legal_bundle_version_id
on public.contract_publication_versions for each row execute function public.gridex_contract_publication_revision_trigger();

create or replace function public.gridex_publication_compatibility_link_guard()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_company_id uuid;
  v_forward_id uuid;
begin
  if new.legacy_public_contract_offer_id is null then return new; end if;
  if current_setting('gridex.publication_link_repair',true)='on' then return new; end if;
  select po.company_id,po.contract_publication_version_id
    into v_company_id,v_forward_id
  from public.public_contract_offers po
  where po.id=new.legacy_public_contract_offer_id;
  if not found then
    raise exception using errcode='23503',message='legacy_public_contract_offer_not_found';
  end if;
  if v_forward_id is distinct from new.id then
    raise exception using errcode='23514',message='publication_version_link_mismatch';
  end if;
  if not exists(
    select 1
    from public.contract_publications cp
    join public.tenant_contract_assignments ta on ta.id=cp.assignment_id
    where cp.id=new.contract_publication_id and ta.company_id=v_company_id
  ) then
    raise exception using errcode='23514',message='publication_company_mismatch';
  end if;
  return new;
end $$;

drop trigger if exists trg_publication_compatibility_link_guard on public.contract_publication_versions;
create trigger trg_publication_compatibility_link_guard
before insert or update of legacy_public_contract_offer_id
on public.contract_publication_versions for each row
execute function public.gridex_publication_compatibility_link_guard();

create or replace function public.gridex_public_contract_offer_forward_link_sync()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if current_setting('gridex.publication_link_repair',true)='on' then return new; end if;
  perform set_config('gridex.version_transition','on',true);
  perform set_config('gridex.publication_link_repair','on',true);
  if old.contract_publication_version_id is not null
     and old.contract_publication_version_id is distinct from new.contract_publication_version_id then
    update public.contract_publication_versions
    set legacy_public_contract_offer_id=null
    where id=old.contract_publication_version_id
      and legacy_public_contract_offer_id=old.id;
  end if;
  if new.contract_publication_version_id is not null then
    if not exists(
      select 1
      from public.contract_publication_versions cpv
      join public.contract_publications cp on cp.id=cpv.contract_publication_id
      join public.tenant_contract_assignments ta on ta.id=cp.assignment_id
      where cpv.id=new.contract_publication_version_id
        and ta.company_id=new.company_id
        and (new.contract_product_version_id is null or cpv.contract_product_version_id=new.contract_product_version_id)
    ) then
      raise exception using errcode='23514',message='public_offer_forward_publication_link_invalid';
    end if;
    update public.contract_publication_versions
    set legacy_public_contract_offer_id=new.id
    where id=new.contract_publication_version_id
      and legacy_public_contract_offer_id is distinct from new.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_public_contract_offer_forward_link_sync on public.public_contract_offers;
create trigger trg_public_contract_offer_forward_link_sync
after insert or update of contract_publication_version_id
on public.public_contract_offers for each row
execute function public.gridex_public_contract_offer_forward_link_sync();

-- Record all ambiguous rows before the safe repair. No UUID-specific delete or
-- detach is performed.
insert into public.contract_publication_graph_issues(
  company_id,public_contract_offer_id,contract_publication_version_id,issue_code,severity,details
)
select
  po.company_id,po.id,cpv.id,'PUBLICATION_COMPANY_MISMATCH','error',
  jsonb_build_object('publication_company_id',ta.company_id,'forward_publication_version_id',po.contract_publication_version_id)
from public.contract_publication_versions cpv
join public.public_contract_offers po on po.id=cpv.legacy_public_contract_offer_id
join public.contract_publications cp on cp.id=cpv.contract_publication_id
join public.tenant_contract_assignments ta on ta.id=cp.assignment_id
where ta.company_id<>po.company_id
on conflict do nothing;

insert into public.contract_publication_graph_issues(
  company_id,public_contract_offer_id,contract_publication_version_id,issue_code,severity,details
)
select
  po.company_id,po.id,cpv.id,'PUBLICATION_VERSION_LINK_MISMATCH','warning',
  jsonb_build_object('canonical_forward_id',po.contract_publication_version_id,'stale_reverse_id',cpv.id)
from public.contract_publication_versions cpv
join public.public_contract_offers po on po.id=cpv.legacy_public_contract_offer_id
join public.contract_publications cp on cp.id=cpv.contract_publication_id
join public.tenant_contract_assignments ta on ta.id=cp.assignment_id
where ta.company_id=po.company_id
  and po.contract_publication_version_id is not null
  and po.contract_publication_version_id<>cpv.id
on conflict do nothing;

-- Safe idempotent repair: canonical forward link exists, both rows are in the
-- same tenant, and only the compatibility reverse pointer is changed.
do $$
begin
  -- This migration runs in one transaction. The earlier version failed here
  -- with immutable_version_locked because it enabled only the link-repair
  -- guard bypass and not the immutable-version lifecycle transition.
  perform set_config('gridex.version_transition','on',true);
  perform set_config('gridex.publication_link_repair','on',true);
  update public.contract_publication_versions cpv
  set legacy_public_contract_offer_id=null
  from public.public_contract_offers po,
       public.contract_publications cp,
       public.tenant_contract_assignments ta
  where po.id=cpv.legacy_public_contract_offer_id
    and cp.id=cpv.contract_publication_id
    and ta.id=cp.assignment_id
    and ta.company_id=po.company_id
    and po.contract_publication_version_id is not null
    and po.contract_publication_version_id<>cpv.id;

  update public.contract_publication_versions cpv
  set legacy_public_contract_offer_id=po.id
  from public.public_contract_offers po,
       public.contract_publications cp,
       public.tenant_contract_assignments ta
  where cpv.id=po.contract_publication_version_id
    and cp.id=cpv.contract_publication_id
    and ta.id=cp.assignment_id
    and ta.company_id=po.company_id
    and cpv.legacy_public_contract_offer_id is distinct from po.id;
end $$;

create or replace view public.contract_publication_graph_integrity_v
with (security_invoker=true) as
select
  po.company_id,
  po.id as public_contract_offer_id,
  po.source_contract_offer_id,
  po.contract_product_version_id as public_offer_product_version_id,
  po.contract_publication_version_id as canonical_publication_version_id,
  cpv.id as publication_version_id,
  cpv.contract_product_version_id as publication_product_version_id,
  cpv.legacy_public_contract_offer_id,
  cp.channel,
  ta.company_id as publication_company_id,
  (po.contract_publication_version_id is not null and cpv.id=po.contract_publication_version_id) as forward_publication_link_valid,
  (cpv.legacy_public_contract_offer_id=po.id) as reverse_legacy_link_valid,
  (ta.company_id=po.company_id) as company_chain_valid,
  (ta.contract_product_version_id=cpv.contract_product_version_id) as tenant_assignment_valid,
  (cp.channel='website' and cpv.channel='website') as channel_valid,
  (cpv.contract_product_version_id=po.contract_product_version_id) as product_version_valid,
  (cpv.publication_snapshot->>'source_contract_offer_id'=po.source_contract_offer_id::text) as source_offer_consistent,
  (cp.status='published' and cpv.status='published') as publication_active,
  (
    po.contract_publication_version_id is not null
    and cpv.id=po.contract_publication_version_id
    and cpv.legacy_public_contract_offer_id=po.id
    and ta.company_id=po.company_id
    and ta.contract_product_version_id=cpv.contract_product_version_id
    and cp.channel='website'
    and cpv.channel='website'
    and cpv.contract_product_version_id=po.contract_product_version_id
    and cpv.publication_snapshot->>'source_contract_offer_id'=po.source_contract_offer_id::text
    and cp.status='published'
    and cpv.status='published'
  ) as canonical_graph_consistent
from public.public_contract_offers po
left join public.contract_publication_versions cpv on cpv.id=po.contract_publication_version_id
left join public.contract_publications cp on cp.id=cpv.contract_publication_id
left join public.tenant_contract_assignments ta on ta.id=cp.assignment_id;


-- New external references are opaque and stable. Existing references are never
-- rewritten; only future publication/backfill rows use this generator.
create or replace function public.gridex_new_offer_reference(p_seed text)
returns text
language sql
immutable
strict
set search_path=public,extensions,pg_temp
as $$
  select 'offer_'||encode(digest(p_seed||'|contract-offer-reference-v1','sha256'),'hex')
$$;

create or replace function public.gridex_publish_contract_channel(
  p_company_id uuid,p_offer_id uuid,p_channel text,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_readiness jsonb;
  v_assignment_id uuid;
  v_publication_id uuid;
  v_publication_version_id uuid;
  v_legal_version_id uuid;
  v_public_offer_id uuid;
  v_snapshot jsonb;
  v_hash text;
  v_offer_reference text;
  v_version integer;
  v_channel text;
begin
  v_channel:=lower(coalesce(p_channel,''));
  if v_channel not in ('internal','website','api','partner','phone') then
    raise exception using errcode='22023',message='invalid_contract_channel';
  end if;
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.publish');
  perform public.gridex_assert_contract_permission(p_actor_user_id,'pricing.publish');

  select * into o from public.contract_offers
  where id=p_offer_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='contract_offer_not_found'; end if;
  if o.lifecycle_status not in ('published','paused') then
    raise exception using errcode='23514',message='contract_version_not_published';
  end if;
  if o.contract_product_version_id is null or not exists(
    select 1 from public.contract_product_versions pv
    where pv.id=o.contract_product_version_id and pv.status='approved' and pv.locked_at is not null
  ) then
    raise exception using errcode='23514',message='contract_version_not_locked';
  end if;

  v_readiness:=public.gridex_validate_contract_readiness(p_company_id,p_offer_id);
  if not coalesce((v_readiness->>'can_publish')::boolean,false) then
    raise exception using errcode='23514',message='contract_not_ready:'||v_readiness::text;
  end if;

  perform public.gridex_sync_internal_offer_to_canonical(o.id);
  select * into o from public.contract_offers where id=o.id;

  -- Move only the selected channel from older versions in the same product
  -- series. Other channels stay active until separately switched.
  update public.tenant_contract_channels old_channel
  set status='ended',valid_to=coalesce(valid_to,now()),updated_at=now()
  from public.tenant_contract_assignments old_assignment
  join public.contract_product_versions old_version on old_version.id=old_assignment.contract_product_version_id
  where old_channel.assignment_id=old_assignment.id
    and old_assignment.company_id=p_company_id
    and old_version.contract_product_id=o.contract_product_id
    and old_assignment.contract_product_version_id<>o.contract_product_version_id
    and old_channel.channel=v_channel
    and old_channel.status in ('active','paused');

  -- Locked publication versions may only move through an explicit lifecycle transition.
  perform set_config('gridex.version_transition','on',true);
  update public.contract_publication_versions old_publication_version
  set status='ended',valid_to=coalesce(valid_to,now())
  from public.contract_publications old_publication
  join public.tenant_contract_assignments old_assignment on old_assignment.id=old_publication.assignment_id
  join public.contract_product_versions old_version on old_version.id=old_assignment.contract_product_version_id
  where old_publication_version.contract_publication_id=old_publication.id
    and old_assignment.company_id=p_company_id
    and old_version.contract_product_id=o.contract_product_id
    and old_assignment.contract_product_version_id<>o.contract_product_version_id
    and old_publication.channel=v_channel
    and old_publication_version.status='published';

  update public.contract_publications old_publication
  set status='ended',updated_at=now()
  from public.tenant_contract_assignments old_assignment
  join public.contract_product_versions old_version on old_version.id=old_assignment.contract_product_version_id
  where old_publication.assignment_id=old_assignment.id
    and old_assignment.company_id=p_company_id
    and old_version.contract_product_id=o.contract_product_id
    and old_assignment.contract_product_version_id<>o.contract_product_version_id
    and old_publication.channel=v_channel
    and old_publication.status not in ('ended','archived');

  update public.tenant_contract_assignments old_assignment
  set status=case when exists(
        select 1 from public.tenant_contract_channels remaining
        where remaining.assignment_id=old_assignment.id and remaining.status='active'
          and (remaining.valid_from is null or remaining.valid_from<=now())
          and (remaining.valid_to is null or remaining.valid_to>=now())
      ) then 'active' else 'ended' end,
      valid_to=case when exists(
        select 1 from public.tenant_contract_channels remaining
        where remaining.assignment_id=old_assignment.id and remaining.status='active'
          and (remaining.valid_from is null or remaining.valid_from<=now())
          and (remaining.valid_to is null or remaining.valid_to>=now())
      ) then old_assignment.valid_to else coalesce(old_assignment.valid_to,current_date) end,
      updated_at=now()
  from public.contract_product_versions old_version
  where old_version.id=old_assignment.contract_product_version_id
    and old_assignment.company_id=p_company_id
    and old_version.contract_product_id=o.contract_product_id
    and old_assignment.contract_product_version_id<>o.contract_product_version_id;

  update public.contract_offers old_offer
  set lifecycle_status=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=old_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
          and (ch.valid_from is null or ch.valid_from<=now())
          and (ch.valid_to is null or ch.valid_to>=now())
      ) then 'published' else 'superseded' end,
      status=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=old_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
      ) then 'active' else 'inactive' end,
      is_active=exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=old_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
      ),
      superseded_at=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=old_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
      ) then old_offer.superseded_at else coalesce(old_offer.superseded_at,now()) end,
      updated_by=p_actor_user_id,updated_at=now()
  where old_offer.company_id=p_company_id
    and old_offer.contract_product_id=o.contract_product_id
    and old_offer.id<>o.id
    and old_offer.lifecycle_status not in ('archived','expired');

  update public.contract_offers
  set lifecycle_status='published',status='active',is_active=true,
      superseded_at=null,updated_by=p_actor_user_id,updated_at=now()
  where id=o.id;
  update public.contract_products set status='active',updated_at=now()
  where id=o.contract_product_id and company_id=p_company_id;

  select id into v_assignment_id
  from public.tenant_contract_assignments
  where company_id=p_company_id and contract_product_version_id=o.contract_product_version_id
  for update;

  update public.tenant_contract_assignments
  set website_publication_allowed=website_publication_allowed or v_channel='website',
      internal_sales_allowed=internal_sales_allowed or v_channel='internal',
      status='active',valid_from=o.valid_from,valid_to=o.valid_to,updated_at=now()
  where id=v_assignment_id;

  insert into public.tenant_contract_channels(
    assignment_id,channel,status,valid_from,valid_to,marketing_content,updated_by
  ) values(
    v_assignment_id,v_channel,'active',o.valid_from::timestamptz,o.valid_to::timestamptz,
    jsonb_build_object('name',o.name,'source_contract_offer_id',o.id,'source_of_truth','contract_product_versions'),
    p_actor_user_id
  ) on conflict(assignment_id,channel) do update set
    status='active',valid_from=excluded.valid_from,valid_to=excluded.valid_to,
    marketing_content=excluded.marketing_content,updated_by=excluded.updated_by,updated_at=now();

  select legal_bundle_version_id into v_legal_version_id
  from public.contract_offers where id=o.id;

  insert into public.contract_publications(assignment_id,channel,status,created_by)
  values(v_assignment_id,v_channel,'published',p_actor_user_id)
  on conflict(assignment_id,channel) do update set status='published',updated_at=now()
  returning id into v_publication_id;

  select coalesce(max(version_number),0)+1 into v_version
  from public.contract_publication_versions where contract_publication_id=v_publication_id;
  v_offer_reference:=public.gridex_new_offer_reference(concat_ws('|',p_company_id::text,o.version_series_id::text,o.version_number::text,v_channel));
  v_snapshot:=jsonb_build_object(
    'schema','gridex_contract_publication_v5',
    'company_id',p_company_id,
    'contract_product_id',o.contract_product_id,
    'contract_product_version_id',o.contract_product_version_id,
    'source_contract_offer_id',o.id,
    'channel',v_channel,
    'offer_reference',v_offer_reference,
    'commercial_snapshot',o.commercial_snapshot,
    'legal_bundle_version_id',v_legal_version_id,
    'valid_from',o.valid_from,
    'valid_to',o.valid_to
  );
  v_hash:=encode(digest(v_snapshot::text,'sha256'),'hex');

  select id into v_publication_version_id
  from public.contract_publication_versions
  where contract_publication_id=v_publication_id and content_sha256=v_hash;
  if v_publication_version_id is null then
    insert into public.contract_publication_versions(
      contract_publication_id,version_number,contract_product_version_id,
      price_plan_id,price_plan_version_id,price_book_id,legal_bundle_version_id,
      customer_type,channel,valid_from,valid_to,publication_snapshot,offer_reference,
      content_sha256,status,published_at,locked_at,created_by
    ) values(
      v_publication_id,v_version,o.contract_product_version_id,
      o.price_plan_id,o.price_plan_version_id,o.price_book_id,v_legal_version_id,
      o.customer_type,v_channel,o.valid_from::timestamptz,o.valid_to::timestamptz,
      v_snapshot,v_offer_reference,v_hash,'published',now(),now(),p_actor_user_id
    ) returning id into v_publication_version_id;
  else
    -- Content is immutable, but a previously ended channel may be re-enabled.
    -- Reactivate the same locked publication identity instead of attempting a
    -- duplicate row with the same content hash/offer reference.
    perform set_config('gridex.version_transition','on',true);
    update public.contract_publication_versions
    set status='published',valid_from=o.valid_from::timestamptz,
        valid_to=o.valid_to::timestamptz,published_at=coalesce(published_at,now()),
        locked_at=coalesce(locked_at,now())
    where id=v_publication_version_id;
  end if;

  if v_channel='website' then
    perform set_config('gridex.public_offer_write','on',true);

    -- Only one website offer in a product series may be public. Older public
    -- compatibility rows remain for historic references but are immediately
    -- removed from all public/CTA surfaces.
    update public.public_contract_offers old_public
    set lifecycle_status='superseded',publication_status='unpublished',
        is_public=false,website_enabled=false,website_cta_enabled=false,
        updated_by=p_actor_user_id,updated_at=now()
    where old_public.company_id=p_company_id
      and old_public.contract_product_id=o.contract_product_id
      and old_public.source_contract_offer_id is distinct from o.id
      and (old_public.is_public or old_public.website_enabled or old_public.website_cta_enabled
           or old_public.publication_status='published');

    select id into v_public_offer_id
    from public.public_contract_offers
    where company_id=p_company_id and source_contract_offer_id=o.id
    order by created_at desc limit 1 for update;

    if v_public_offer_id is null then
      insert into public.public_contract_offers(
        company_id,source_contract_offer_id,version_series_id,version_number,
        contract_product_id,contract_product_version_id,contract_publication_version_id,
        legal_bundle_version_id,price_plan_id,price_plan_version_id,price_book_id,
        product_code,offer_code,public_name,public_description,contract_type,billing_model,
        customer_type,monthly_fee_sek,invoice_fee_sek,spot_markup_ore_per_kwh,
        variable_fee_ore_per_kwh,fixed_price_ore_per_kwh,green_fee_mode,green_fee_value,
        start_fee_sek,administration_fee_sek,break_fee_sek,discount_value,discount_unit,
        discount_months,vat_rate,terms_version,binding_months,notice_months,
        spot_weight_percent,portfolio_weight_percent,fixed_weight_percent,price_areas,
        automatic_renewal,power_of_attorney_required,valid_from,valid_to,
        is_public,is_archived,publication_status,lifecycle_status,website_enabled,
        website_cta_enabled,published_at,metadata,created_by,updated_by
      ) values(
        p_company_id,o.id,o.version_series_id,o.version_number,
        o.contract_product_id,o.contract_product_version_id,v_publication_version_id,
        v_legal_version_id,o.price_plan_id,o.price_plan_version_id,o.price_book_id,
        'electricity','contract-'||o.version_series_id::text,o.name,o.description,o.contract_type,
        coalesce(o.commercial_snapshot->>'pricing_model',o.contract_type),o.customer_type,
        o.monthly_fee_sek,o.invoice_fee_sek,o.spot_markup_ore_per_kwh,o.variable_fee_ore_per_kwh,
        o.fixed_price_ore_per_kwh,o.green_fee_mode,o.green_fee_value,o.start_fee_sek,o.admin_fee_sek,
        o.break_fee_sek,o.discount_value,o.discount_unit,o.discount_months,o.vat_rate,o.terms_version,
        o.default_binding_months,o.default_notice_months,
        coalesce((o.commercial_snapshot->>'spot_weight_percent')::numeric,100),
        coalesce((o.commercial_snapshot->>'portfolio_weight_percent')::numeric,0),
        coalesce((o.commercial_snapshot->>'fixed_weight_percent')::numeric,0),
        coalesce(array(select jsonb_array_elements_text(coalesce(o.commercial_snapshot->'price_areas','[]'::jsonb))),'{}'::text[]),
        o.automatic_renewal,o.power_of_attorney_required,o.valid_from,o.valid_to,
        true,false,'published','published',true,true,now(),
        jsonb_build_object('source_of_truth','contract_product_versions','offer_reference',v_offer_reference),
        p_actor_user_id,p_actor_user_id
      ) returning id into v_public_offer_id;
    else
      update public.public_contract_offers set
        contract_product_id=o.contract_product_id,
        contract_product_version_id=o.contract_product_version_id,
        contract_publication_version_id=v_publication_version_id,
        legal_bundle_version_id=v_legal_version_id,
        price_plan_id=o.price_plan_id,price_plan_version_id=o.price_plan_version_id,price_book_id=o.price_book_id,
        public_name=o.name,public_description=o.description,contract_type=o.contract_type,customer_type=o.customer_type,
        monthly_fee_sek=o.monthly_fee_sek,invoice_fee_sek=o.invoice_fee_sek,
        spot_markup_ore_per_kwh=o.spot_markup_ore_per_kwh,variable_fee_ore_per_kwh=o.variable_fee_ore_per_kwh,
        fixed_price_ore_per_kwh=o.fixed_price_ore_per_kwh,green_fee_mode=o.green_fee_mode,green_fee_value=o.green_fee_value,
        start_fee_sek=o.start_fee_sek,administration_fee_sek=o.admin_fee_sek,break_fee_sek=o.break_fee_sek,
        discount_value=o.discount_value,discount_unit=o.discount_unit,discount_months=o.discount_months,
        vat_rate=o.vat_rate,terms_version=o.terms_version,binding_months=o.default_binding_months,
        notice_months=o.default_notice_months,automatic_renewal=o.automatic_renewal,
        power_of_attorney_required=o.power_of_attorney_required,valid_from=o.valid_from,valid_to=o.valid_to,
        is_public=true,is_archived=false,publication_status='published',lifecycle_status='published',
        website_enabled=true,website_cta_enabled=true,published_at=coalesce(published_at,now()),archived_at=null,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('source_of_truth','contract_product_versions','offer_reference',v_offer_reference),
        updated_by=p_actor_user_id,updated_at=now()
      where id=v_public_offer_id;
    end if;
    update public.contract_publication_versions
    set legacy_public_contract_offer_id=v_public_offer_id
    where id=v_publication_version_id and legacy_public_contract_offer_id is null;
  end if;

  insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
  values(
    p_company_id,p_actor_user_id,'contract_publication_version',v_publication_version_id::text,
    'contract.channel.published',null,v_snapshot,
    jsonb_build_object('offer_id',o.id,'channel',v_channel,'offer_reference',v_offer_reference)
  );

  return jsonb_build_object(
    'ok',true,'changed',true,'mode','published','channel',v_channel,
    'contract_product_id',o.contract_product_id,
    'contract_product_version_id',o.contract_product_version_id,
    'contract_publication_version_id',v_publication_version_id,
    'public_contract_offer_id',v_public_offer_id,
    'offer_reference',v_offer_reference,
    'affected_channels',1,
    'affected_publication_versions',1,
    'affected_public_offers',case when v_channel='website' then 1 else 0 end
  );
end $$;;

-- Shared business-usage classifier. System-generated canonical versions are
-- intentionally excluded; only customer/legal/billing activity blocks deletion.;

create or replace function public.gridex_backfill_contract_lifecycle(
  p_company_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  po public.public_contract_offers%rowtype;
  v_match_id uuid;
  v_match_count integer;
  v_assignment_id uuid;
  v_channel_id uuid;
  v_publication_id uuid;
  v_publication_version_id uuid;
  v_version integer;
  v_offer_reference text;
  v_snapshot jsonb;
  v_hash text;
  v_active boolean;
  v_synced integer:=0;
  v_mapped integer:=0;
  v_publications integer:=0;
  v_issues integer:=0;
begin
  -- Clear only issues in this execution scope. Failed rows are reopened below.
  update public.contract_lifecycle_backfill_issues
  set status='resolved',resolved_at=now(),last_seen_at=now()
  where status='open' and (p_company_id is null or company_id=p_company_id);

  for o in
    select * from public.contract_offers
    where p_company_id is null or company_id=p_company_id
    order by company_id,created_at,id
  loop
    begin
      perform public.gridex_sync_internal_offer_to_canonical(o.id);
      v_synced:=v_synced+1;
    exception when others then
      perform public.gridex_record_contract_backfill_issue(
        o.company_id,o.id,null,'CANONICAL_SYNC_FAILED',
        jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm)
      );
      v_issues:=v_issues+1;
    end;
  end loop;

  -- Deterministically attach legacy public offers that have exactly one source.
  for po in
    select * from public.public_contract_offers
    where source_contract_offer_id is null
      and (p_company_id is null or company_id=p_company_id)
    order by company_id,created_at,id
  loop
    v_match_id:=null;
    v_match_count:=0;
    select count(*),(array_agg(o2.id order by o2.id))[1] into v_match_count,v_match_id
    from public.contract_offers o2
    where o2.company_id=po.company_id
      and (
        (po.contract_product_version_id is not null and o2.contract_product_version_id=po.contract_product_version_id)
        or (po.version_series_id is not null and o2.version_series_id=po.version_series_id and o2.version_number=po.version_number)
        or (po.price_plan_version_id is not null and o2.price_plan_version_id=po.price_plan_version_id
            and lower(o2.name)=lower(po.public_name))
      );

    if v_match_count=1 then
      perform set_config('gridex.public_offer_write','on',true);
      update public.public_contract_offers
      set source_contract_offer_id=v_match_id,updated_at=now()
      where id=po.id;
      v_mapped:=v_mapped+1;
    else
      perform public.gridex_record_contract_backfill_issue(
        po.company_id,null,po.id,
        case when v_match_count=0 then 'PUBLIC_OFFER_SOURCE_NOT_FOUND' else 'PUBLIC_OFFER_SOURCE_AMBIGUOUS' end,
        jsonb_build_object('candidate_count',v_match_count)
      );
      v_issues:=v_issues+1;
    end if;
  end loop;

  -- Build/repair the website assignment, channel and immutable publication graph.
  for po in
    select p.* from public.public_contract_offers p
    where p.source_contract_offer_id is not null
      and (p_company_id is null or p.company_id=p_company_id)
    order by p.company_id,p.created_at,p.id
  loop
    begin
      select * into o from public.contract_offers
      where id=po.source_contract_offer_id and company_id=po.company_id;
      if not found then
        perform public.gridex_record_contract_backfill_issue(
          po.company_id,po.source_contract_offer_id,po.id,'PUBLIC_OFFER_SOURCE_MISSING','{}'::jsonb
        );
        v_issues:=v_issues+1;
        continue;
      end if;

      if o.contract_product_id is null or o.contract_product_version_id is null or o.legal_bundle_version_id is null then
        perform public.gridex_sync_internal_offer_to_canonical(o.id);
        select * into o from public.contract_offers where id=o.id;
      end if;
      if o.contract_product_id is null or o.contract_product_version_id is null or o.legal_bundle_version_id is null then
        perform public.gridex_record_contract_backfill_issue(
          o.company_id,o.id,po.id,'INCOMPLETE_CANONICAL_MAPPING',
          jsonb_build_object(
            'contract_product_id',o.contract_product_id,
            'contract_product_version_id',o.contract_product_version_id,
            'legal_bundle_version_id',o.legal_bundle_version_id
          )
        );
        v_issues:=v_issues+1;
        continue;
      end if;

      select id into v_assignment_id
      from public.tenant_contract_assignments
      where company_id=o.company_id and contract_product_version_id=o.contract_product_version_id
      order by created_at,id limit 1 for update;
      if v_assignment_id is null then
        insert into public.tenant_contract_assignments(
          company_id,contract_product_version_id,internal_sales_allowed,website_publication_allowed,
          status,legal_mode,valid_from,valid_to
        ) values(
          o.company_id,o.contract_product_version_id,true,true,
          case when o.lifecycle_status='archived' then 'ended' when po.is_public and not po.is_archived then 'active' else 'paused' end,
          'ops_standard',o.valid_from,o.valid_to
        ) returning id into v_assignment_id;
      else
        update public.tenant_contract_assignments
        set website_publication_allowed=true,
            status=case when o.lifecycle_status='archived' then 'ended'
                        when po.is_public and not po.is_archived then 'active'
                        when status='ended' then status else 'paused' end,
            valid_from=o.valid_from,valid_to=o.valid_to,updated_at=now()
        where id=v_assignment_id;
      end if;

      v_active:=coalesce(po.is_public,false)
        and not coalesce(po.is_archived,false)
        and coalesce(po.publication_status,'')='published'
        and coalesce(po.lifecycle_status,'')='published'
        and o.lifecycle_status<>'archived';

      insert into public.tenant_contract_channels(
        assignment_id,channel,status,valid_from,valid_to,marketing_content
      ) values(
        v_assignment_id,'website',case when v_active then 'active' else 'paused' end,
        o.valid_from::timestamptz,o.valid_to::timestamptz,
        jsonb_build_object('name',o.name,'source_contract_offer_id',o.id,'source_of_truth','contract_product_versions')
      ) on conflict(assignment_id,channel) do update set
        status=excluded.status,valid_from=excluded.valid_from,valid_to=excluded.valid_to,
        marketing_content=excluded.marketing_content,updated_at=now()
      returning id into v_channel_id;

      insert into public.contract_publications(assignment_id,channel,status)
      values(v_assignment_id,'website',case when v_active then 'published' else 'paused' end)
      on conflict(assignment_id,channel) do update set status=excluded.status,updated_at=now()
      returning id into v_publication_id;

      v_offer_reference:=public.gridex_new_offer_reference(concat_ws('|',o.company_id::text,o.version_series_id::text,o.version_number::text,'website'));
      v_snapshot:=jsonb_build_object(
        'schema','gridex_contract_publication_v5',
        'company_id',o.company_id,
        'contract_product_id',o.contract_product_id,
        'contract_product_version_id',o.contract_product_version_id,
        'source_contract_offer_id',o.id,
        'channel','website',
        'offer_reference',v_offer_reference,
        'commercial_snapshot',o.commercial_snapshot,
        'legal_bundle_version_id',o.legal_bundle_version_id,
        'valid_from',o.valid_from,
        'valid_to',o.valid_to
      );
      v_hash:=encode(digest(v_snapshot::text,'sha256'),'hex');

      select id into v_publication_version_id
      from public.contract_publication_versions
      where contract_publication_id=v_publication_id
        and (content_sha256=v_hash or legacy_public_contract_offer_id=po.id)
      order by version_number desc limit 1 for update;

      if v_active then
        if v_publication_version_id is null then
          select coalesce(max(version_number),0)+1 into v_version
          from public.contract_publication_versions where contract_publication_id=v_publication_id;
          insert into public.contract_publication_versions(
            contract_publication_id,version_number,contract_product_version_id,
            price_plan_id,price_plan_version_id,price_book_id,legal_bundle_version_id,
            legacy_public_contract_offer_id,customer_type,channel,valid_from,valid_to,
            publication_snapshot,offer_reference,content_sha256,status,published_at,locked_at
          ) values(
            v_publication_id,v_version,o.contract_product_version_id,
            o.price_plan_id,o.price_plan_version_id,o.price_book_id,o.legal_bundle_version_id,
            po.id,o.customer_type,'website',o.valid_from::timestamptz,o.valid_to::timestamptz,
            v_snapshot,v_offer_reference,v_hash,'published',coalesce(po.published_at,now()),now()
          ) returning id into v_publication_version_id;
          v_publications:=v_publications+1;
        else
          perform set_config('gridex.version_transition','on',true);
          update public.contract_publication_versions
          set status='published',valid_to=o.valid_to::timestamptz,
              published_at=coalesce(published_at,po.published_at,now()),locked_at=coalesce(locked_at,now()),
              legacy_public_contract_offer_id=coalesce(legacy_public_contract_offer_id,po.id)
          where id=v_publication_version_id;
        end if;
      else
        if v_publication_version_id is not null then
          perform set_config('gridex.version_transition','on',true);
          update public.contract_publication_versions
          set status=case when o.lifecycle_status='archived' then 'archived' else 'ended' end,
              valid_to=coalesce(valid_to,po.archived_at,po.updated_at,now())
          where id=v_publication_version_id and status in ('draft','review','published','paused');
        end if;
      end if;

      perform set_config('gridex.public_offer_write','on',true);
      update public.public_contract_offers
      set contract_product_id=o.contract_product_id,
          contract_product_version_id=o.contract_product_version_id,
          legal_bundle_version_id=o.legal_bundle_version_id,
          contract_publication_version_id=case when v_active then v_publication_version_id else contract_publication_version_id end,
          version_series_id=o.version_series_id,version_number=o.version_number,
          lifecycle_status=case when o.lifecycle_status='archived' then 'archived' when v_active then 'published' else 'paused' end,
          updated_at=now()
      where id=po.id;

      update public.contract_lifecycle_backfill_issues
      set status='resolved',resolved_at=now(),last_seen_at=now()
      where (contract_offer_id=o.id or public_contract_offer_id=po.id) and status='open';
    exception when others then
      perform public.gridex_record_contract_backfill_issue(
        po.company_id,po.source_contract_offer_id,po.id,'PUBLICATION_BACKFILL_FAILED',
        jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm)
      );
      v_issues:=v_issues+1;
    end;
  end loop;

  -- Re-derive offer lifecycle from exact current channels. Preserve archived and drafts.
  update public.contract_offers o2
  set lifecycle_status=case
        when o2.lifecycle_status='archived' then 'archived'
        when exists(
          select 1 from public.tenant_contract_assignments ta
          join public.tenant_contract_channels ch on ch.assignment_id=ta.id
          where ta.company_id=o2.company_id
            and ta.contract_product_version_id=o2.contract_product_version_id
            and ta.status='active' and ch.status='active'
        ) then 'published'
        when o2.lifecycle_status in ('published','paused','superseded') then 'paused'
        else o2.lifecycle_status
      end,
      status=case when exists(
          select 1 from public.tenant_contract_assignments ta
          join public.tenant_contract_channels ch on ch.assignment_id=ta.id
          where ta.company_id=o2.company_id
            and ta.contract_product_version_id=o2.contract_product_version_id
            and ta.status='active' and ch.status='active'
        ) then 'active' else 'inactive' end,
      is_active=exists(
          select 1 from public.tenant_contract_assignments ta
          join public.tenant_contract_channels ch on ch.assignment_id=ta.id
          where ta.company_id=o2.company_id
            and ta.contract_product_version_id=o2.contract_product_version_id
            and ta.status='active' and ch.status='active'
        ),
      updated_at=now()
  where (p_company_id is null or o2.company_id=p_company_id)
    and o2.contract_product_version_id is not null;

  return jsonb_build_object(
    'ok',true,'synced_contract_offers',v_synced,'mapped_public_offers',v_mapped,
    'created_publication_versions',v_publications,
    'open_issue_count',(select count(*) from public.contract_lifecycle_backfill_issues i
                        where i.status='open' and (p_company_id is null or i.company_id=p_company_id)),
    'issues_seen_this_run',v_issues
  );
end $$;

create or replace function public.gridex_delete_unused_contract(
  p_company_id uuid,p_offer_id uuid,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_graph jsonb;
  v_preview jsonb;
  v_repair jsonb;
  v_product_id uuid;
  v_price_plan_id uuid;
  v_price_plan_version_id uuid;
  v_price_book_id uuid;
  v_public_offer_ids uuid[]:='{}'::uuid[];
  v_assignment_ids uuid[]:='{}'::uuid[];
  v_product_version_ids uuid[]:='{}'::uuid[];
  v_publication_ids uuid[]:='{}'::uuid[];
  v_publication_version_ids uuid[]:='{}'::uuid[];
  v_legal_version_ids uuid[]:='{}'::uuid[];
  v_counts jsonb:='{}'::jsonb;
  v_count bigint;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.delete_unused');
  select * into o
  from public.contract_offers
  where id=p_offer_id and company_id=p_company_id
  for update;
  if not found then
    raise exception using errcode='P0002',message='contract_offer_not_found';
  end if;

  v_graph:=public.gridex_resolve_contract_lifecycle_graph(p_company_id,p_offer_id);
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_public_offer_ids
    from jsonb_array_elements_text(v_graph->'public_contract_offer_ids');
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_assignment_ids
    from jsonb_array_elements_text(v_graph->'tenant_assignment_ids');
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_product_version_ids
    from jsonb_array_elements_text(v_graph->'contract_product_version_ids');
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_publication_ids
    from jsonb_array_elements_text(v_graph->'publication_ids');
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_publication_version_ids
    from jsonb_array_elements_text(v_graph->'tree_publication_version_ids');
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_legal_version_ids
    from jsonb_array_elements_text(v_graph->'legal_bundle_version_ids');

  -- Lock the complete target graph in deterministic order. Direct reverse
  -- compatibility references outside the target publication tree are locked too.
  perform 1 from public.contract_product_versions where id=any(v_product_version_ids) order by id for update;
  perform 1 from public.tenant_contract_assignments where id=any(v_assignment_ids) order by id for update;
  perform 1 from public.contract_publications where id=any(v_publication_ids) order by id for update;
  perform 1 from public.contract_publication_versions
    where id=any(array(select jsonb_array_elements_text(v_graph->'publication_version_ids')::uuid))
    order by id for update;
  perform 1 from public.public_contract_offers where id=any(v_public_offer_ids) order by id for update;

  v_repair:=public.gridex_repair_contract_publication_links(p_company_id,p_offer_id,p_actor_user_id);
  if not coalesce((v_repair->>'ok')::boolean,false) then
    return jsonb_build_object(
      'ok',false,'changed',false,'deleted',false,'mode','blocked',
      'code',coalesce(v_repair->>'code','PUBLICATION_GRAPH_INCONSISTENT'),
      'reason_codes',jsonb_build_array(coalesce(v_repair->>'code','PUBLICATION_GRAPH_INCONSISTENT')),
      'recommended_action',coalesce(v_repair->>'recommended_action','repair'),
      'repair',v_repair
    );
  end if;

  v_graph:=public.gridex_resolve_contract_lifecycle_graph(p_company_id,p_offer_id);
  v_preview:=public.gridex_preview_delete_unused_contract(p_company_id,p_offer_id);
  if not coalesce((v_preview->>'can_delete')::boolean,coalesce((v_preview->>'deletable')::boolean,false)) then
    return jsonb_build_object(
      'ok',false,'changed',false,'deleted',false,'mode','blocked',
      'code','unused_contract_delete_blocked',
      'reason_codes',coalesce(v_preview->'reason_codes','[]'::jsonb),
      'recommended_action',coalesce(v_preview->>'recommended_action','archive'),
      'delete_preview',v_preview
    );
  end if;

  v_product_id:=o.contract_product_id;
  v_price_plan_id:=o.price_plan_id;
  v_price_plan_version_id:=o.price_plan_version_id;
  v_price_book_id:=o.price_book_id;

  perform set_config('gridex.public_offer_write','on',true);
  perform set_config('gridex.version_transition','on',true);
  perform set_config('gridex.pricing_version_write','on',true);
  perform set_config('gridex.publication_link_repair','on',true);

  update public.tenant_contract_channels
  set status='ended',valid_to=coalesce(valid_to,now()),updated_by=p_actor_user_id,updated_at=now()
  where assignment_id=any(v_assignment_ids) and status<>'ended';

  update public.contract_publications
  set status='ended',updated_at=now()
  where id=any(v_publication_ids) and status not in ('ended','archived');

  update public.contract_publication_versions
  set status='ended',valid_to=coalesce(valid_to,now())
  where id=any(v_publication_version_ids) and status not in ('ended','archived');

  update public.public_contract_offers
  set lifecycle_status='paused',publication_status='unpublished',is_public=false,is_archived=false,
      website_enabled=false,website_cta_enabled=false,updated_at=now()
  where id=any(v_public_offer_ids);

  -- Unconditionally detach every direct reverse reference, including references
  -- whose publication is outside the target assignment/publication list.
  update public.contract_publication_versions
  set legacy_public_contract_offer_id=null
  where legacy_public_contract_offer_id=any(v_public_offer_ids);

  update public.public_contract_offers
  set lifecycle_status='draft',publication_status='draft',is_public=false,is_archived=false,
      website_enabled=false,website_cta_enabled=false,
      contract_publication_version_id=null,updated_at=now()
  where id=any(v_public_offer_ids);

  if exists(
    select 1 from public.contract_publication_versions
    where legacy_public_contract_offer_id=any(v_public_offer_ids)
  ) then
    raise exception using errcode='23503',message='contract_public_offer_still_referenced';
  end if;
  perform public.gridex_assert_no_public_offer_fk_references(v_public_offer_ids);

  delete from public.contract_offer_versions
  where company_id=p_company_id and contract_offer_id=o.id;
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_offer_versions',v_count);

  delete from public.public_contract_offers where id=any(v_public_offer_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('public_contract_offers',v_count);

  delete from public.contract_publication_versions where id=any(v_publication_version_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_publication_versions',v_count);

  delete from public.contract_publications where id=any(v_publication_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_publications',v_count);

  delete from public.tenant_contract_channels where assignment_id=any(v_assignment_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('tenant_contract_channels',v_count);

  delete from public.tenant_contract_assignments where id=any(v_assignment_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('tenant_contract_assignments',v_count);

  delete from public.contract_offers where id=o.id and company_id=p_company_id;
  get diagnostics v_count=row_count;
  if v_count<>1 then
    raise exception using errcode='55000',message='contract_offer_delete_count_mismatch';
  end if;
  v_counts:=v_counts||jsonb_build_object('contract_offers',v_count);

  delete from public.legal_bundle_version_documents where legal_bundle_version_id=any(v_legal_version_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('legal_bundle_version_documents',v_count);

  delete from public.legal_bundle_versions where id=any(v_legal_version_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('legal_bundle_versions',v_count);

  delete from public.contract_product_versions where id=any(v_product_version_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_product_versions',v_count);

  if v_product_id is not null
     and not exists(select 1 from public.contract_product_versions where contract_product_id=v_product_id) then
    delete from public.contract_products where id=v_product_id and company_id=p_company_id;
    get diagnostics v_count=row_count;
    v_counts:=v_counts||jsonb_build_object('contract_products',v_count);
  end if;

  if v_price_book_id is not null
     and not exists(select 1 from public.contract_offers where price_book_id=v_price_book_id)
     and not exists(select 1 from public.public_contract_offers where price_book_id=v_price_book_id)
     and not exists(select 1 from public.customer_contracts where price_book_id=v_price_book_id)
     and not exists(select 1 from public.contract_price_snapshots where price_book_id=v_price_book_id)
     and not exists(select 1 from public.billing_underlays where price_book_id=v_price_book_id)
     and not exists(select 1 from public.billing_underlay_items where price_book_id=v_price_book_id) then
    delete from public.price_books where id=v_price_book_id and company_id=p_company_id;
    get diagnostics v_count=row_count;
    v_counts:=v_counts||jsonb_build_object('price_books',v_count);
  end if;

  if v_price_plan_version_id is not null
     and not exists(select 1 from public.contract_offers where price_plan_version_id=v_price_plan_version_id)
     and not exists(select 1 from public.public_contract_offers where price_plan_version_id=v_price_plan_version_id)
     and not exists(select 1 from public.customer_contracts where price_plan_version_id=v_price_plan_version_id)
     and not exists(select 1 from public.contract_price_snapshots where price_plan_version_id=v_price_plan_version_id)
     and not exists(select 1 from public.billing_underlays where price_plan_version_id=v_price_plan_version_id)
     and not exists(select 1 from public.billing_underlay_items where price_plan_version_id=v_price_plan_version_id) then
    delete from public.price_plan_versions where id=v_price_plan_version_id and company_id=p_company_id;
    get diagnostics v_count=row_count;
    v_counts:=v_counts||jsonb_build_object('price_plan_versions',v_count);
  end if;

  if v_price_plan_id is not null
     and not exists(select 1 from public.price_plan_versions where price_plan_id=v_price_plan_id) then
    delete from public.price_plans where id=v_price_plan_id and company_id=p_company_id;
    get diagnostics v_count=row_count;
    v_counts:=v_counts||jsonb_build_object('price_plans',v_count);
  end if;

  insert into public.audit_logs(
    company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata
  ) values(
    p_company_id,p_actor_user_id,'contract_product',coalesce(v_product_id,p_offer_id)::text,
    'contract.delete_unused',to_jsonb(o),null,
    jsonb_build_object('offer_id',p_offer_id,'deleted_rows',v_counts,'preview',v_preview,'repair',v_repair)
  );

  return jsonb_build_object(
    'ok',true,'changed',true,'deleted',true,'mode','deleted','offer_id',p_offer_id,
    'contract_product_id',v_product_id,'deleted_rows',v_counts,
    'deleted_contract_offers',coalesce((v_counts->>'contract_offers')::bigint,0),
    'deleted_public_offers',coalesce((v_counts->>'public_contract_offers')::bigint,0),
    'deleted_channels',coalesce((v_counts->>'tenant_contract_channels')::bigint,0),
    'deleted_assignments',coalesce((v_counts->>'tenant_contract_assignments')::bigint,0),
    'deleted_publication_versions',coalesce((v_counts->>'contract_publication_versions')::bigint,0),
    'deleted_product_versions',coalesce((v_counts->>'contract_product_versions')::bigint,0),
    'deleted_legal_versions',coalesce((v_counts->>'legal_bundle_versions')::bigint,0),
    'deleted_products',coalesce((v_counts->>'contract_products')::bigint,0)
  );
end $$;

create or replace function public.gridex_remove_internal_contract_offer(
  p_company_id uuid,p_offer_id uuid,p_mode text default 'archive',p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_preview jsonb;
begin
  if p_mode='archive' then
    return public.gridex_archive_contract_product(p_company_id,p_offer_id,p_actor_user_id);
  elsif p_mode='safe_delete' then
    v_preview:=public.gridex_preview_delete_unused_contract(p_company_id,p_offer_id);
    if coalesce((v_preview->>'can_delete')::boolean,false) then
      return public.gridex_delete_unused_contract(p_company_id,p_offer_id,p_actor_user_id);
    end if;
    return jsonb_build_object(
      'ok',false,'changed',false,'mode','blocked','code','unused_contract_delete_blocked',
      'reason_codes',coalesce(v_preview->'reason_codes','[]'::jsonb),
      'recommended_action',coalesce(v_preview->>'recommended_action','archive'),
      'delete_preview',v_preview
    );
  end if;
  raise exception using errcode='22023',message='invalid_contract_remove_mode';
end $$;

revoke all on function public.gridex_resolve_contract_lifecycle_graph(uuid,uuid) from public,anon,authenticated;
revoke all on function public.gridex_contract_system_dependency_counts(uuid,uuid) from public,anon,authenticated;
revoke all on function public.gridex_repair_contract_publication_links(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.gridex_assert_no_public_offer_fk_references(uuid[]) from public,anon,authenticated;
revoke all on function public.gridex_bump_contract_publication_revision(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.gridex_new_offer_reference(text) from public,anon,authenticated;
revoke all on function public.gridex_seed_company_market_price_source() from public,anon,authenticated;
grant execute on function public.gridex_preview_delete_unused_contract(uuid,uuid) to authenticated,service_role;
grant execute on function public.gridex_delete_unused_contract(uuid,uuid,uuid) to authenticated,service_role;
grant execute on function public.gridex_repair_contract_publication_links(uuid,uuid,uuid) to service_role;
grant select on public.contract_publication_revisions,public.contract_publication_graph_integrity_v to authenticated,service_role;
grant select,insert,update,delete on public.company_market_price_sources to authenticated,service_role;
grant select,insert,update on public.contract_publication_graph_issues to service_role;

comment on function public.gridex_resolve_contract_lifecycle_graph(uuid,uuid) is
  'Single tenant-scoped resolver for lifecycle preview, delete, repair and diagnostics. Direct reverse legacy references are resolved without a publication-list filter.';
comment on function public.gridex_delete_unused_contract(uuid,uuid,uuid) is
  'Atomically deletes a completely unused exclusive contract graph after locking, shared resolver preview, safe compatibility repair and final dynamic FK assertions.';
comment on table public.contract_publication_revisions is
  'Tenant- and channel-scoped monotonically increasing publication revision used for ETag and external cache invalidation.';

commit;
