\set ON_ERROR_STOP on

-- Read-only verification of the final live schema after every migration.
begin transaction read only;

do $verification$
declare
  v_missing text[];
  v_publish text;
  v_permission text;
  v_readiness text;
  v_admin_view text;
  v_public_view text;
  v_graph_view text;
begin
  select array_agg(required.column_name order by required.column_name)
  into v_missing
  from (
    select unnest(array[
      'contract_offer_id',
      'company_id',
      'assignment_id',
      'lifecycle_status',
      'offer_status',
      'assignment_status',
      'internal_sales_allowed',
      'website_publication_allowed',
      'api_publication_allowed',
      'internal_channel_status',
      'website_channel_status',
      'api_channel_status',
      'internal_channel_valid_from',
      'internal_channel_valid_to',
      'website_channel_valid_from',
      'website_channel_valid_to',
      'api_channel_valid_from',
      'api_channel_valid_to',
      'active_publication_version_count',
      'internally_sellable_now',
      'website_available_now',
      'api_available_now'
    ]::text[]) as column_name
  ) required
  where not exists(
    select 1
    from information_schema.columns actual
    where actual.table_schema='public'
      and actual.table_name='canonical_internal_contract_offers_v'
      and actual.column_name=required.column_name
  );
  if cardinality(coalesce(v_missing,'{}'::text[]))>0 then
    raise exception
      'canonical_contract_columns_missing:%',
      array_to_string(v_missing,',');
  end if;

  select pg_get_functiondef(
    'public.gridex_publish_contract_channel(uuid,uuid,text,uuid)'::regprocedure
  ) into v_publish;
  select pg_get_functiondef(
    'public.gridex_set_contract_channel_permission(uuid,uuid,text,boolean,uuid,text)'::regprocedure
  ) into v_permission;
  select pg_get_functiondef(
    'public.gridex_validate_contract_channel_readiness(uuid,uuid,text)'::regprocedure
  ) into v_readiness;
  select pg_get_viewdef(
    'public.canonical_internal_contract_offers_v'::regclass,true
  ) into v_admin_view;
  select pg_get_viewdef(
    'public.canonical_public_contract_offers_v'::regclass,true
  ) into v_public_view;
  select pg_get_viewdef(
    'public.contract_publication_graph_integrity_v'::regclass,true
  ) into v_graph_view;

  if position('gridex_assert_contract_channel_permission' in v_publish)=0
    or position('gridex_validate_contract_channel_readiness' in v_publish)=0
    or position('contracts.publish.' in v_publish)=0
    or position('partner' in v_publish)>0
    or position('phone' in v_publish)>0
    or position(
      'website_publication_allowed=website_publication_allowedorv_channel'
      in regexp_replace(lower(v_publish),'\s','','g')
    )>0 then
    raise exception 'publish_rpc_is_not_canonical_or_still_self_grants';
  end if;
  if position('contract_channel_permission_granted' in v_permission)=0
    or position('contract_channel_permission_revoked' in v_permission)=0
    or position('for update' in lower(v_permission))=0 then
    raise exception 'permission_rpc_missing_audit_or_lock';
  end if;
  if position('api_contracts.read' in v_readiness)=0
    or position('external_access_ready' in v_readiness)=0 then
    raise exception 'api_readiness_does_not_separate_external_access';
  end if;
  if position('internally_sellable_now' in v_admin_view)=0
    or position('website_available_now' in v_admin_view)=0
    or position('api_available_now' in v_admin_view)=0 then
    raise exception 'canonical_admin_availability_columns_not_effective';
  end if;
  if position('website_publication_allowed' in v_public_view)=0
    or position('Europe/Stockholm' in v_public_view)=0 then
    raise exception 'website_view_missing_grant_or_stockholm_calendar';
  end if;
  if position('single_active_publication_version' in v_graph_view)=0
    or position('channel_permission_granted' in v_graph_view)=0
    or position('snapshot_hash_valid' in v_graph_view)=0 then
    raise exception 'publication_graph_integrity_is_incomplete';
  end if;

  if not exists(
    select 1
    from pg_indexes
    where schemaname='public'
      and indexname=
        'contract_publication_versions_one_published_per_publication_uidx'
      and indexdef ilike '%unique%'
      and indexdef ilike '%where (status = ''published''%'
  ) then
    raise exception 'one_active_publication_version_index_missing';
  end if;
  if has_function_privilege(
      'authenticated',
      'public.gridex_set_contract_channel_permission(uuid,uuid,text,boolean,uuid,text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.gridex_set_contract_channel_permission(uuid,uuid,text,boolean,uuid,text)',
      'EXECUTE'
    ) then
    raise exception 'grant_rpc_privileges_are_not_service_role_only';
  end if;
end
$verification$;

-- Scenario-state invariants. Any returned row is a production blocker.
select
  publication.contract_publication_id,
  count(*) as published_versions
from public.contract_publication_versions publication
where publication.status='published'
group by publication.contract_publication_id
having count(*)<>1;

select
  offer.company_id,
  offer.contract_offer_id,
  offer.website_channel_status,
  offer.website_available_now
from public.canonical_internal_contract_offers_v offer
where offer.website_available_now
  and (
    not offer.website_publication_allowed
    or offer.website_channel_status<>'active'
  );

select
  offer.company_id,
  offer.contract_offer_id,
  offer.api_channel_status,
  offer.api_available_now
from public.canonical_internal_contract_offers_v offer
where offer.api_available_now
  and (
    not offer.api_publication_allowed
    or offer.api_channel_status<>'active'
  );

rollback;
