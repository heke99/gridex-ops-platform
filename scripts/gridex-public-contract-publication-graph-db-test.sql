\set ON_ERROR_STOP on
\if :{?company_id}
\else
\echo 'company_id is required'
\quit 2
\endif
\if :{?offer_id}
\else
\echo 'offer_id is required'
\quit 2
\endif
\if :{?actor_id}
\else
\echo 'actor_id is required'
\quit 2
\endif

begin;

create or replace function pg_temp.gridex_test_fail(p_message text)
returns boolean
language plpgsql
as $$
begin
  raise exception using errcode='P0001',message=p_message;
end $$;

create temporary table gridex_public_contract_test_before as
select
  o.company_id,
  o.id offer_id,
  o.contract_type,
  o.contract_product_version_id,
  o.price_plan_version_id,
  (select count(*) from public.contract_price_options option_row
    where option_row.contract_product_version_id=o.contract_product_version_id
      and option_row.price_plan_version_id=o.price_plan_version_id
      and option_row.contract_publication_version_id is null) template_count,
  coalesce((select revision from public.contract_publication_revisions revision_row
    where revision_row.company_id=o.company_id and revision_row.channel='website'),0) website_revision,
  coalesce((select revision from public.contract_publication_revisions revision_row
    where revision_row.company_id=o.company_id and revision_row.channel='api'),0) api_revision
from public.contract_offers o
where o.company_id=:'company_id'::uuid and o.id=:'offer_id'::uuid;

select case when count(*)=1 then true else
  pg_temp.gridex_test_fail('PUBLIC_CONTRACT_DB_TEST_OFFER_NOT_FOUND') end
from gridex_public_contract_test_before;

create temporary table gridex_public_contract_test_website_result as
select public.gridex_publish_contract_channel(
  :'company_id'::uuid,:'offer_id'::uuid,'website',:'actor_id'::uuid
) payload;

select case when coalesce((payload->>'ok')::boolean,false) then true else
  pg_temp.gridex_test_fail('PUBLIC_CONTRACT_DB_TEST_WEBSITE_PUBLISH_FAILED:'||payload::text) end
from gridex_public_contract_test_website_result;

create temporary table gridex_public_contract_test_api_result as
select public.gridex_publish_contract_channel(
  :'company_id'::uuid,:'offer_id'::uuid,'api',:'actor_id'::uuid
) payload;

select case when coalesce((payload->>'ok')::boolean,false) then true else
  pg_temp.gridex_test_fail('PUBLIC_CONTRACT_DB_TEST_API_PUBLISH_FAILED:'||payload::text) end
from gridex_public_contract_test_api_result;

create temporary table gridex_public_contract_test_versions as
select distinct on (publication.channel)
  pv.id,
  pv.contract_publication_id,
  pv.status,
  pv.locked_at,
  pv.contract_product_version_id,
  pv.price_plan_version_id,
  pv.offer_reference,
  publication.channel
from public.contract_publication_versions pv
join public.contract_publications publication
  on publication.id=pv.contract_publication_id
join public.tenant_contract_assignments assignment
  on assignment.id=publication.assignment_id
where assignment.company_id=:'company_id'::uuid
  and publication.channel in ('website','api')
  and pv.channel=publication.channel
  and pv.contract_product_version_id=(select contract_product_version_id
    from gridex_public_contract_test_before)
  and pv.publication_snapshot->>'source_contract_offer_id'=:'offer_id'
order by publication.channel,pv.version_number desc;

select case when count(*)=2 and count(distinct id)=2 then true else
  pg_temp.gridex_test_fail('PUBLIC_CONTRACT_DB_TEST_CHANNEL_VERSIONS_NOT_SEPARATE') end
from gridex_public_contract_test_versions;

select case when bool_and(
  status='published'
  and locked_at is not null
  and cardinality(public.gridex_validate_publication_graph_v1(id))=0
) then true else pg_temp.gridex_test_fail(
  'PUBLIC_CONTRACT_DB_TEST_GRAPH_INVALID:'||coalesce((
    select jsonb_agg(jsonb_build_object(
      'channel',channel,
      'publication_version_id',id,
      'blockers',public.gridex_validate_publication_graph_v1(id)
    ))::text
    from gridex_public_contract_test_versions
  ),'[]')
) end
from gridex_public_contract_test_versions;

select case when not exists(
  select 1 from gridex_public_contract_test_versions version_row
  where not exists(
    select 1 from public.contract_price_options option_row
    where option_row.contract_publication_version_id=version_row.id
  )
) then true else pg_temp.gridex_test_fail('PUBLIC_CONTRACT_DB_TEST_PRICE_OPTIONS_MISSING') end;

select case when (
  select array_agg(option_row.option_reference order by option_row.option_reference)
  from public.contract_price_options option_row
  join gridex_public_contract_test_versions version_row
    on version_row.id=option_row.contract_publication_version_id
  where version_row.channel='website'
)=(
  select array_agg(option_row.option_reference order by option_row.option_reference)
  from public.contract_price_options option_row
  join gridex_public_contract_test_versions version_row
    on version_row.id=option_row.contract_publication_version_id
  where version_row.channel='api'
) and not exists(
  select 1
  from public.contract_price_options website_option
  join gridex_public_contract_test_versions website_version
    on website_version.id=website_option.contract_publication_version_id
   and website_version.channel='website'
  join public.contract_price_options api_option
    on api_option.option_reference=website_option.option_reference
  join gridex_public_contract_test_versions api_version
    on api_version.id=api_option.contract_publication_version_id
   and api_version.channel='api'
  where api_option.id=website_option.id
) then true else pg_temp.gridex_test_fail('PUBLIC_CONTRACT_DB_TEST_CHANNEL_SNAPSHOTS_NOT_DISTINCT') end;

select case when (
  select count(*) from public.contract_price_options template
  where template.contract_product_version_id=before_row.contract_product_version_id
    and template.price_plan_version_id=before_row.price_plan_version_id
    and template.contract_publication_version_id is null
)>=before_row.template_count then true else
  pg_temp.gridex_test_fail('PUBLIC_CONTRACT_DB_TEST_TEMPLATE_ROWS_CONSUMED') end
from gridex_public_contract_test_before before_row;

select case when before_row.contract_type<>'fixed' or not exists(
  select 1
  from gridex_public_contract_test_versions version_row
  join public.contract_price_options option_row
    on option_row.contract_publication_version_id=version_row.id
  cross join unnest(public.gridex_supported_price_areas_v1(
    version_row.contract_product_version_id)) required_area
  where not exists(
    select 1 from public.contract_price_option_area_prices area_row
    where area_row.contract_price_option_id=option_row.id
      and area_row.price_area=required_area
      and area_row.status='active' and area_row.amount is not null
  )
) then true else pg_temp.gridex_test_fail('PUBLIC_CONTRACT_DB_TEST_AREA_PRICE_MISSING') end
from gridex_public_contract_test_before before_row;

select case when count(*)=2 and bool_and(
  diagnostic.visible and cardinality(diagnostic.blockers)=0
) then true else pg_temp.gridex_test_fail('PUBLIC_CONTRACT_DB_TEST_CHANNEL_NOT_VISIBLE') end
from public.canonical_public_contract_diagnostics_v diagnostic
join gridex_public_contract_test_versions version_row
  on version_row.id=diagnostic.publication_version_id
 and version_row.channel=diagnostic.channel;

create temporary table gridex_public_contract_test_version_counts_before_retry as
select channel,count(*) version_count
from public.contract_publication_versions publication_version
join public.contract_publications publication
  on publication.id=publication_version.contract_publication_id
join public.tenant_contract_assignments assignment
  on assignment.id=publication.assignment_id
where assignment.company_id=:'company_id'::uuid
  and publication.channel in ('website','api')
  and publication_version.contract_product_version_id=(select contract_product_version_id
    from gridex_public_contract_test_before)
  and publication_version.publication_snapshot->>'source_contract_offer_id'=:'offer_id'
group by channel;

create temporary table gridex_public_contract_test_retry_result as
select public.gridex_publish_contract_channel(
  :'company_id'::uuid,:'offer_id'::uuid,'website',:'actor_id'::uuid
) payload;

select case when coalesce((payload->>'ok')::boolean,false)
  and not coalesce((payload->>'changed')::boolean,true)
  then true else pg_temp.gridex_test_fail(
    'PUBLIC_CONTRACT_DB_TEST_REPEAT_PUBLISH_NOT_IDEMPOTENT:'||payload::text
  ) end
from gridex_public_contract_test_retry_result;

select case when not exists(
  select 1
  from gridex_public_contract_test_version_counts_before_retry before_count
  where before_count.version_count<>(
    select count(*)
    from public.contract_publication_versions publication_version
    join public.contract_publications publication
      on publication.id=publication_version.contract_publication_id
    join public.tenant_contract_assignments assignment
      on assignment.id=publication.assignment_id
    where assignment.company_id=:'company_id'::uuid
      and publication.channel=before_count.channel
      and publication_version.contract_product_version_id=(select contract_product_version_id
        from gridex_public_contract_test_before)
      and publication_version.publication_snapshot->>'source_contract_offer_id'=:'offer_id'
  )
) then true else pg_temp.gridex_test_fail('PUBLIC_CONTRACT_DB_TEST_REPEAT_PUBLISH_CREATED_VERSION') end;

create temporary table gridex_public_contract_test_counts_before_preview as
select
  (select count(*) from public.contract_price_options) option_count,
  (select count(*) from public.contract_price_option_area_prices) area_count;

select * from public.gridex_preview_public_contract_backfill_v1(
  :'company_id'::uuid,:'offer_id'::uuid,null,null
);

select case when option_count=(select count(*) from public.contract_price_options)
  and area_count=(select count(*) from public.contract_price_option_area_prices)
  then true else pg_temp.gridex_test_fail('PUBLIC_CONTRACT_DB_TEST_DRY_RUN_MUTATED_DATA') end
from gridex_public_contract_test_counts_before_preview;

select case when coalesce((select revision from public.contract_publication_revisions
  where company_id=before_row.company_id and channel='website'),0)
  > before_row.website_revision
  and coalesce((select revision from public.contract_publication_revisions
  where company_id=before_row.company_id and channel='api'),0)
  > before_row.api_revision
  then true else pg_temp.gridex_test_fail('PUBLIC_CONTRACT_DB_TEST_REVISION_NOT_BUMPED') end
from gridex_public_contract_test_before before_row;

rollback;
