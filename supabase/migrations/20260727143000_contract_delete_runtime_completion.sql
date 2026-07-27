-- GRIDEX OPS: canonical actor-aware contract delete preview/commit wrappers.
-- This migration is forward-only and leaves previously applied migrations immutable.

begin;

do $$
declare
  v_missing text[] := '{}'::text[];
begin
  if to_regclass('public.contract_offers') is null then
    v_missing := array_append(v_missing, 'table public.contract_offers');
  end if;
  if to_regclass('public.companies') is null then
    v_missing := array_append(v_missing, 'table public.companies');
  end if;
  if to_regclass('public.audit_logs') is null then
    v_missing := array_append(v_missing, 'table public.audit_logs');
  end if;
  if to_regprocedure('public.gridex_preview_delete_unused_contract(uuid,uuid)') is null then
    v_missing := array_append(v_missing, 'function gridex_preview_delete_unused_contract(uuid,uuid)');
  end if;
  if to_regprocedure('public.gridex_delete_unused_contract(uuid,uuid,uuid)') is null then
    v_missing := array_append(v_missing, 'function gridex_delete_unused_contract(uuid,uuid,uuid)');
  end if;
  if to_regprocedure('public.gridex_archive_contract_product(uuid,uuid,uuid)') is null then
    v_missing := array_append(v_missing, 'function gridex_archive_contract_product(uuid,uuid,uuid)');
  end if;
  if to_regprocedure('public.gridex_assert_contract_permission(uuid,text)') is null then
    v_missing := array_append(v_missing, 'function gridex_assert_contract_permission(uuid,text)');
  end if;

  if exists (
    select 1
    from (values
      ('contract_offers','id'),
      ('contract_offers','company_id'),
      ('contract_offers','name'),
      ('contract_offers','contract_product_id'),
      ('companies','id'),
      ('companies','name'),
      ('audit_logs','company_id'),
      ('audit_logs','action'),
      ('audit_logs','metadata')
    ) required(table_name,column_name)
    where not exists (
      select 1
      from information_schema.columns column_def
      where column_def.table_schema='public'
        and column_def.table_name=required.table_name
        and column_def.column_name=required.column_name
    )
  ) then
    v_missing := array_append(v_missing, 'one or more required columns');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception using
      errcode='55000',
      message='contract_delete_runtime_preflight_failed',
      detail=array_to_string(v_missing, ', ');
  end if;
end
$$;

create or replace function public.gridex_contract_delete_dependency_graph_v2(
  p_company_id uuid,
  p_offer_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_preview jsonb;
  v_blockers jsonb:='[]'::jsonb;
  v_offer public.contract_offers%rowtype;
  v_company_name text;
  v_preview_token text;
begin
  select * into v_offer
  from public.contract_offers offer
  where offer.id=p_offer_id
    and offer.company_id=p_company_id;

  if not found then
    return jsonb_build_object(
      'ok',false,
      'code','contract_not_found',
      'contract_offer_id',p_offer_id,
      'contract_product_id',null,
      'can_delete',false,
      'deletable',false,
      'recommended_action','none',
      'blockers',jsonb_build_array(jsonb_build_object(
        'resource_type','contract_offer',
        'resource_id',null,
        'count',0,
        'reason','contract_not_found',
        'classification','repairable_broken_relation',
        'recommended_action','none',
        'message','Avtalet hittades inte för valt bolag.'
      ))
    );
  end if;

  select company.name into v_company_name
  from public.companies company
  where company.id=p_company_id;

  v_preview:=public.gridex_preview_delete_unused_contract(
    p_company_id,
    p_offer_id
  );

  select coalesce(jsonb_agg(
    blocker
    || jsonb_build_object(
      'resource_id',coalesce(blocker->'resource_id','null'::jsonb),
      'classification',case
        when blocker->>'reason' in (
          'HAS_INVOICES','HAS_BILLING_HISTORY','HAS_CHARGE_LEDGER',
          'HAS_LEGAL_ACCEPTANCES'
        ) then 'regulatory_retention_blocker'
        when blocker->>'reason' in (
          'HAS_CUSTOMER_CONTRACTS','HAS_ACCEPTED_APPLICATIONS',
          'HAS_EXTERNAL_INTAKES','HAS_BINDING_PRICE_SNAPSHOTS',
          'HAS_WEBSITE_QUOTES'
        ) then 'business_history_blocker'
        when blocker->>'reason' in (
          'HAS_SUCCESSOR_VERSION','HAS_SHARED_CANONICAL_VERSION',
          'HAS_SHARED_LEGAL_VERSION','PUBLICATION_GRAPH_INCONSISTENT',
          'HAS_RESTRICTING_FOREIGN_KEYS'
        ) then 'repairable_broken_relation'
        else 'business_history_blocker'
      end,
      'recommended_action',case
        when blocker->>'reason' in (
          'HAS_SUCCESSOR_VERSION','HAS_SHARED_CANONICAL_VERSION',
          'HAS_SHARED_LEGAL_VERSION','PUBLICATION_GRAPH_INCONSISTENT',
          'HAS_RESTRICTING_FOREIGN_KEYS'
        ) then 'repair'
        else 'archive'
      end
    )
  ),'[]'::jsonb)
  into v_blockers
  from jsonb_array_elements(coalesce(v_preview->'blockers','[]'::jsonb)) blocker;

  v_preview:=v_preview
    || jsonb_build_object(
      'contract_offer_id',v_offer.id,
      'contract_product_id',v_offer.contract_product_id,
      'product_name',v_offer.name,
      'company_id',p_company_id,
      'company_name',v_company_name,
      'blockers',v_blockers,
      'dependency_classification',jsonb_build_object(
        'deletable_internal_dependency',coalesce(v_preview->'removable_system_dependencies','{}'::jsonb),
        'business_history_blocker',coalesce((select jsonb_agg(value) from jsonb_array_elements(v_blockers) value where value->>'classification'='business_history_blocker'),'[]'::jsonb),
        'regulatory_retention_blocker',coalesce((select jsonb_agg(value) from jsonb_array_elements(v_blockers) value where value->>'classification'='regulatory_retention_blocker'),'[]'::jsonb),
        'repairable_broken_relation',coalesce((select jsonb_agg(value) from jsonb_array_elements(v_blockers) value where value->>'classification'='repairable_broken_relation'),'[]'::jsonb)
      )
    );

  v_preview_token:=md5((v_preview-'preview_token')::text);
  return v_preview||jsonb_build_object('preview_token',v_preview_token);
end
$$;

create or replace function public.gridex_preview_delete_unused_contract_v2(
  p_company_id uuid,
  p_offer_id uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,auth,pg_temp
as $$
begin
  perform public.gridex_assert_contract_permission(
    p_actor_user_id,
    'contracts.delete_unused'
  );
  return public.gridex_contract_delete_dependency_graph_v2(
    p_company_id,
    p_offer_id
  );
end
$$;

create or replace function public.gridex_delete_unused_contract_v2(
  p_company_id uuid,
  p_offer_id uuid,
  p_actor_user_id uuid,
  p_expected_preview_token text default null
) returns jsonb
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $$
declare
  v_preview jsonb;
  v_result jsonb;
  v_offer_exists boolean:=false;
begin
  perform public.gridex_assert_contract_permission(
    p_actor_user_id,
    'contracts.delete_unused'
  );

  perform pg_advisory_xact_lock(
    hashtextextended(
      'gridex:contract-delete:'||p_company_id::text||':'||p_offer_id::text,
      0
    )
  );

  select true into v_offer_exists
  from public.contract_offers offer
  where offer.id=p_offer_id
    and offer.company_id=p_company_id
  for update;

  if not coalesce(v_offer_exists,false) then
    if exists(
      select 1
      from public.audit_logs audit
      where audit.company_id=p_company_id
        and audit.action='contract.delete_unused'
        and audit.metadata->>'offer_id'=p_offer_id::text
    ) then
      return jsonb_build_object(
        'ok',true,
        'changed',false,
        'deleted',true,
        'mode','deleted',
        'code','contract_already_deleted',
        'offer_id',p_offer_id
      );
    end if;
    return jsonb_build_object(
      'ok',false,
      'changed',false,
      'deleted',false,
      'mode','blocked',
      'code','contract_not_found',
      'recommended_action','none',
      'blockers',jsonb_build_array(jsonb_build_object(
        'resource_type','contract_offer',
        'resource_id',null,
        'count',0,
        'reason','contract_not_found',
        'classification','repairable_broken_relation',
        'recommended_action','none',
        'message','Avtalet hittades inte för valt bolag.'
      ))
    );
  end if;

  v_preview:=public.gridex_contract_delete_dependency_graph_v2(
    p_company_id,
    p_offer_id
  );

  if nullif(p_expected_preview_token,'') is not null
     and p_expected_preview_token is distinct from v_preview->>'preview_token' then
    return jsonb_build_object(
      'ok',false,
      'changed',false,
      'deleted',false,
      'mode','blocked',
      'code','contract_delete_preview_stale',
      'message','Avtalsberoendena ändrades efter förhandsgranskningen. Granska raderingen igen.',
      'recommended_action','refresh_preview',
      'delete_preview',v_preview,
      'blockers',jsonb_build_array(jsonb_build_object(
        'resource_type','contract_product',
        'resource_id',v_preview->>'contract_product_id',
        'count',1,
        'reason','contract_delete_preview_stale',
        'classification','repairable_broken_relation',
        'recommended_action','refresh_preview',
        'message','Avtalsberoendena ändrades efter förhandsgranskningen.'
      ))
    );
  end if;

  if not coalesce((v_preview->>'can_delete')::boolean,false) then
    return jsonb_build_object(
      'ok',false,
      'changed',false,
      'deleted',false,
      'mode','blocked',
      'code','contract_delete_blocked',
      'message','Avtalet har historik eller beroenden som måste bevaras.',
      'reason_codes',coalesce(v_preview->'reason_codes','[]'::jsonb),
      'blockers',coalesce(v_preview->'blockers','[]'::jsonb),
      'recommended_action',coalesce(v_preview->>'recommended_action','archive'),
      'delete_preview',v_preview
    );
  end if;

  -- The existing commit performs the exact same canonical preview again while
  -- the offer row remains locked, and deletes only the approved internal graph.
  v_result:=public.gridex_delete_unused_contract(
    p_company_id,
    p_offer_id,
    p_actor_user_id
  );

  return coalesce(v_result,'{}'::jsonb)||jsonb_build_object(
    'preview_token',v_preview->>'preview_token',
    'delete_preview',v_preview
  );
end
$$;

create or replace function public.gridex_remove_internal_contract_offer_v2(
  p_company_id uuid,
  p_offer_id uuid,
  p_mode text default 'archive',
  p_actor_user_id uuid default null,
  p_expected_preview_token text default null
) returns jsonb
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $$
declare
  v_mode text:=lower(nullif(btrim(coalesce(p_mode,'')),''));
begin
  if v_mode='archive' then
    perform public.gridex_assert_contract_permission(
      p_actor_user_id,
      'contracts.archive'
    );
    perform pg_advisory_xact_lock(
      hashtextextended(
        'gridex:contract-archive:'||p_company_id::text||':'||p_offer_id::text,
        0
      )
    );
    return public.gridex_archive_contract_product(
      p_company_id,
      p_offer_id,
      p_actor_user_id
    );
  elsif v_mode='safe_delete' then
    return public.gridex_delete_unused_contract_v2(
      p_company_id,
      p_offer_id,
      p_actor_user_id,
      p_expected_preview_token
    );
  end if;

  return jsonb_build_object(
    'ok',false,
    'changed',false,
    'mode','blocked',
    'code','invalid_contract_remove_mode',
    'message','Borttagningsläget måste vara archive eller safe_delete.',
    'blockers',jsonb_build_array(jsonb_build_object(
      'resource_type','contract_product',
      'resource_id',null,
      'count',1,
      'reason','invalid_contract_remove_mode',
      'classification','repairable_broken_relation',
      'recommended_action','review',
      'message','Borttagningsläget måste vara archive eller safe_delete.'
    ))
  );
end
$$;

revoke all on function public.gridex_contract_delete_dependency_graph_v2(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_contract_delete_dependency_graph_v2(uuid,uuid)
  to service_role;

revoke all on function public.gridex_preview_delete_unused_contract_v2(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_preview_delete_unused_contract_v2(uuid,uuid,uuid)
  to service_role;

revoke all on function public.gridex_delete_unused_contract_v2(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.gridex_delete_unused_contract_v2(uuid,uuid,uuid,text)
  to service_role;

revoke all on function public.gridex_remove_internal_contract_offer_v2(uuid,uuid,text,uuid,text)
  from public,anon,authenticated;
grant execute on function public.gridex_remove_internal_contract_offer_v2(uuid,uuid,text,uuid,text)
  to service_role;

comment on function public.gridex_contract_delete_dependency_graph_v2(uuid,uuid) is
  'Canonical tenant-scoped delete dependency graph shared by actor-aware preview and locked commit. Classifies removable draft dependencies, business history, regulatory retention and repairable broken relations.';
comment on function public.gridex_preview_delete_unused_contract_v2(uuid,uuid,uuid) is
  'Service-only actor-aware delete preview. The server binds actor and tenant from the authenticated session.';
comment on function public.gridex_delete_unused_contract_v2(uuid,uuid,uuid,text) is
  'Concurrency-safe, idempotent permanent delete for unused contracts. Repeats the canonical dependency graph under advisory and row locks.';
comment on function public.gridex_remove_internal_contract_offer_v2(uuid,uuid,text,uuid,text) is
  'Single canonical admin entry point for explicit archive or permanent safe delete.';

commit;
