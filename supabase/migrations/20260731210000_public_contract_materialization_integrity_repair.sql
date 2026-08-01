-- GRIDEX: publication price-option materialization integrity repair.
--
-- Verified root cause in the active code path:
--   gridex_seed_publication_price_option_template_v2() creates a reusable
--   template row, then gridex_materialize_publication_price_options_v1()
--   copies it with a broad "ON CONFLICT DO NOTHING". Any legacy global unique
--   object spanning price_plan_version_id + stable reference is therefore
--   swallowed, leaving zero snapshot rows. The validator then reports
--   PUBLICATION_PRICE_OPTIONS_MISSING even though source resolution succeeded.
--
-- This forward-only repair:
--   * discovers obsolete uniqueness by catalog column signature, not by name;
--   * removes only global uniqueness that incorrectly spans templates and
--     publication snapshots;
--   * recreates the canonical scoped uniqueness model;
--   * replaces broad conflict swallowing with deterministic insert-if-missing;
--   * verifies source and target counts before finalize can publish;
--   * provides a rollback-only test RPC that executes the real republish path.

begin;
set local lock_timeout='15s';
set local statement_timeout='10min';
select pg_advisory_xact_lock(
  hashtextextended(
    'gridex:public-contract-materialization-integrity:20260731210000',0
  )
);

-- The database already reached the legacy-source fallback stage in the failing
-- trace. Keep this migration explicit so a partially applied environment fails
-- with a useful prerequisite error instead of creating another partial repair.
do $$
declare
  v_missing text[]:=array[]::text[];
begin
  if to_regclass('public.contract_price_options') is null then
    v_missing:=array_append(v_missing,'contract_price_options');
  end if;
  if to_regclass('public.contract_price_option_area_prices') is null then
    v_missing:=array_append(v_missing,'contract_price_option_area_prices');
  end if;
  if to_regprocedure(
    'public.gridex_seed_publication_price_option_template_v2(uuid,uuid)'
  ) is null then
    v_missing:=array_append(v_missing,
      'gridex_seed_publication_price_option_template_v2(uuid,uuid)');
  end if;
  if to_regprocedure(
    'public.gridex_republish_active_public_contract_v2(uuid,uuid,numeric)'
  ) is null then
    v_missing:=array_append(v_missing,
      'gridex_republish_active_public_contract_v2(uuid,uuid,numeric)');
  end if;
  if to_regprocedure(
    'public.gridex_validate_publication_graph_v1(uuid)'
  ) is null then
    v_missing:=array_append(v_missing,
      'gridex_validate_publication_graph_v1(uuid)');
  end if;
  if cardinality(v_missing)>0 then
    raise exception using errcode='55000',
      message='PUBLIC_CONTRACT_REPAIR_PREREQUISITES_MISSING',
      detail=to_jsonb(v_missing)::text;
  end if;
end $$;

-- Make every unique object on the two canonical tables observable. This is
-- also included in all rollback-test results and error details.
create or replace function public.gridex_price_option_unique_objects_v1()
returns jsonb
language sql
stable
security definer
set search_path=public,pg_catalog,pg_temp
as $$
with constraint_objects as (
  select
    table_rel.relname table_name,
    constraint_row.conname object_name,
    'constraint'::text object_kind,
    array_agg(attribute_row.attname::text order by key_row.ordinality) columns,
    null::text predicate
  from pg_constraint constraint_row
  join pg_class table_rel on table_rel.oid=constraint_row.conrelid
  join pg_namespace table_ns on table_ns.oid=table_rel.relnamespace
  cross join lateral unnest(constraint_row.conkey)
    with ordinality key_row(attnum,ordinality)
  join pg_attribute attribute_row
    on attribute_row.attrelid=table_rel.oid
   and attribute_row.attnum=key_row.attnum
  where table_ns.nspname='public'
    and table_rel.relname in (
      'contract_price_options','contract_price_option_area_prices'
    )
    and constraint_row.contype in ('p','u')
  group by table_rel.relname,constraint_row.conname
), standalone_indexes as (
  select
    table_rel.relname table_name,
    index_rel.relname object_name,
    'index'::text object_kind,
    array_agg(attribute_row.attname::text order by key_row.ordinality)
      filter(where key_row.ordinality<=index_row.indnkeyatts) columns,
    pg_get_expr(index_row.indpred,index_row.indrelid) predicate
  from pg_index index_row
  join pg_class table_rel on table_rel.oid=index_row.indrelid
  join pg_namespace table_ns on table_ns.oid=table_rel.relnamespace
  join pg_class index_rel on index_rel.oid=index_row.indexrelid
  cross join lateral unnest(index_row.indkey::smallint[])
    with ordinality key_row(attnum,ordinality)
  join pg_attribute attribute_row
    on attribute_row.attrelid=table_rel.oid
   and attribute_row.attnum=key_row.attnum
  where table_ns.nspname='public'
    and table_rel.relname in (
      'contract_price_options','contract_price_option_area_prices'
    )
    and index_row.indisunique
    and not index_row.indisprimary
    and index_row.indexprs is null
    and not exists(
      select 1 from pg_constraint constraint_row
      where constraint_row.conindid=index_row.indexrelid
    )
  group by table_rel.relname,index_rel.relname,index_row.indpred,
    index_row.indrelid
), all_objects as (
  select * from constraint_objects
  union all
  select * from standalone_indexes
)
select coalesce(
  jsonb_agg(
    jsonb_build_object(
      'table',table_name,
      'name',object_name,
      'kind',object_kind,
      'columns',to_jsonb(columns),
      'predicate',predicate
    ) order by table_name,object_kind,object_name
  ),
  '[]'::jsonb
)
from all_objects;
$$;

-- Refuse to recreate canonical scoped indexes over ambiguous data. No row is
-- deleted or merged by this repair.
do $$
begin
  if exists(
    select 1
    from public.contract_price_options
    where contract_publication_version_id is null
    group by contract_product_version_id,price_plan_version_id,option_reference
    having count(*)>1
  ) then
    raise exception using errcode='23505',
      message='PUBLICATION_PRICE_OPTION_TEMPLATE_REFERENCE_DUPLICATE';
  end if;
  if exists(
    select 1
    from public.contract_price_options
    where contract_publication_version_id is null
    group by contract_product_version_id,price_plan_version_id,option_code
    having count(*)>1
  ) then
    raise exception using errcode='23505',
      message='PUBLICATION_PRICE_OPTION_TEMPLATE_CODE_DUPLICATE';
  end if;
  if exists(
    select 1
    from public.contract_price_options
    where contract_publication_version_id is not null
    group by contract_publication_version_id,option_reference
    having count(*)>1
  ) then
    raise exception using errcode='23505',
      message='PUBLICATION_PRICE_OPTION_SNAPSHOT_REFERENCE_DUPLICATE';
  end if;
  if exists(
    select 1
    from public.contract_price_options
    where contract_publication_version_id is not null
    group by contract_publication_version_id,option_code
    having count(*)>1
  ) then
    raise exception using errcode='23505',
      message='PUBLICATION_PRICE_OPTION_SNAPSHOT_CODE_DUPLICATE';
  end if;
  if exists(
    select 1
    from public.contract_price_options
    where contract_publication_version_id is not null
      and status='active' and is_default is true
    group by contract_publication_version_id
    having count(*)>1
  ) then
    raise exception using errcode='23505',
      message='PUBLICATION_PRICE_OPTION_SNAPSHOT_DEFAULT_DUPLICATE';
  end if;
  if exists(
    select 1
    from public.contract_price_option_area_prices
    group by contract_price_option_id,price_row_reference
    having count(*)>1
  ) then
    raise exception using errcode='23505',
      message='PUBLICATION_AREA_PRICE_REFERENCE_DUPLICATE';
  end if;
end $$;

-- Remove obsolete UNIQUE constraints by exact ordered column signature. Names
-- are deliberately ignored because the live schema may have drifted.
do $$
declare
  r record;
  v_columns text[];
begin
  for r in
    select constraint_row.conname,constraint_row.conkey
    from pg_constraint constraint_row
    where constraint_row.conrelid='public.contract_price_options'::regclass
      and constraint_row.contype='u'
  loop
    select array_agg(attribute_row.attname::text order by key_row.ordinality)
      into v_columns
    from unnest(r.conkey) with ordinality key_row(attnum,ordinality)
    join pg_attribute attribute_row
      on attribute_row.attrelid='public.contract_price_options'::regclass
     and attribute_row.attnum=key_row.attnum;

    if v_columns=array['price_plan_version_id','option_reference']::text[]
       or v_columns=array['price_plan_version_id','option_code']::text[] then
      execute format(
        'alter table public.contract_price_options drop constraint %I',
        r.conname
      );
    end if;
  end loop;

  for r in
    select constraint_row.conname,constraint_row.conkey
    from pg_constraint constraint_row
    where constraint_row.conrelid=
        'public.contract_price_option_area_prices'::regclass
      and constraint_row.contype='u'
  loop
    select array_agg(attribute_row.attname::text order by key_row.ordinality)
      into v_columns
    from unnest(r.conkey) with ordinality key_row(attnum,ordinality)
    join pg_attribute attribute_row
      on attribute_row.attrelid=
        'public.contract_price_option_area_prices'::regclass
     and attribute_row.attnum=key_row.attnum;

    if v_columns=
      array['price_plan_version_id','price_row_reference']::text[] then
      execute format(
        'alter table public.contract_price_option_area_prices drop constraint %I',
        r.conname
      );
    end if;
  end loop;
end $$;

-- Remove standalone global UNIQUE indexes with the same signatures. Partial
-- scoped indexes are never selected by this block.
do $$
declare
  r record;
begin
  for r in
    select
      table_rel.relname table_name,
      index_rel.relname index_name,
      array_agg(attribute_row.attname::text order by key_row.ordinality)
        filter(where key_row.ordinality<=index_row.indnkeyatts) columns
    from pg_index index_row
    join pg_class table_rel on table_rel.oid=index_row.indrelid
    join pg_namespace table_ns on table_ns.oid=table_rel.relnamespace
    join pg_class index_rel on index_rel.oid=index_row.indexrelid
    cross join lateral unnest(index_row.indkey::smallint[])
      with ordinality key_row(attnum,ordinality)
    join pg_attribute attribute_row
      on attribute_row.attrelid=table_rel.oid
     and attribute_row.attnum=key_row.attnum
    where table_ns.nspname='public'
      and table_rel.relname in (
        'contract_price_options','contract_price_option_area_prices'
      )
      and index_row.indisunique
      and not index_row.indisprimary
      and index_row.indpred is null
      and index_row.indexprs is null
      and not exists(
        select 1 from pg_constraint constraint_row
        where constraint_row.conindid=index_row.indexrelid
      )
    group by table_rel.relname,index_rel.relname
  loop
    if r.table_name='contract_price_options' and (
      r.columns=array['price_plan_version_id','option_reference']::text[]
      or r.columns=array['price_plan_version_id','option_code']::text[]
    ) then
      execute format('drop index public.%I',r.index_name);
    elsif r.table_name='contract_price_option_area_prices'
      and r.columns=
        array['price_plan_version_id','price_row_reference']::text[] then
      execute format('drop index public.%I',r.index_name);
    end if;
  end loop;
end $$;

-- Recreate every canonical uniqueness object from its intended scope.
drop index if exists public.contract_price_options_template_reference_uidx;
drop index if exists public.contract_price_options_template_code_uidx;
drop index if exists public.contract_price_options_publication_reference_uidx;
drop index if exists public.contract_price_options_publication_code_uidx;
drop index if exists public.contract_price_options_publication_default_uidx;
drop index if exists public.contract_price_option_area_option_reference_uidx;

create unique index contract_price_options_template_reference_uidx
  on public.contract_price_options(
    contract_product_version_id,price_plan_version_id,option_reference
  ) where contract_publication_version_id is null;
create unique index contract_price_options_template_code_uidx
  on public.contract_price_options(
    contract_product_version_id,price_plan_version_id,option_code
  ) where contract_publication_version_id is null;
create unique index contract_price_options_publication_reference_uidx
  on public.contract_price_options(
    contract_publication_version_id,option_reference
  ) where contract_publication_version_id is not null;
create unique index contract_price_options_publication_code_uidx
  on public.contract_price_options(
    contract_publication_version_id,option_code
  ) where contract_publication_version_id is not null;
create unique index contract_price_options_publication_default_uidx
  on public.contract_price_options(contract_publication_version_id)
  where contract_publication_version_id is not null
    and status='active' and is_default is true;
create unique index contract_price_option_area_option_reference_uidx
  on public.contract_price_option_area_prices(
    contract_price_option_id,price_row_reference
  );

-- Strict materializer. It never uses an unqualified ON CONFLICT clause. A
-- source/target count mismatch is a hard error with catalog diagnostics.
create or replace function public.gridex_materialize_publication_price_options_v1(
  p_publication_version_id uuid,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_catalog,pg_temp
as $$
declare
  v public.contract_publication_versions%rowtype;
  v_company_id uuid;
  v_source_publication_version_id uuid;
  v_source_kind text;
  v_prior_candidate_count integer:=0;
  v_prior_graph_count integer:=0;
  v_source_option_count integer:=0;
  v_source_default_count integer:=0;
  v_inserted integer:=0;
  v_target_option_count integer:=0;
begin
  select publication_version.* into v
  from public.contract_publication_versions publication_version
  where publication_version.id=p_publication_version_id
  for update;

  if not found then
    raise exception using errcode='P0002',
      message='PUBLICATION_VERSION_NOT_FOUND';
  end if;

  select assignment.company_id into v_company_id
  from public.contract_publications publication
  join public.tenant_contract_assignments assignment
    on assignment.id=publication.assignment_id
  where publication.id=v.contract_publication_id;

  if not found then
    raise exception using errcode='23514',
      message='PUBLICATION_TENANT_NOT_READY';
  end if;

  if exists(
    select 1 from public.contract_price_options target
    where target.contract_publication_version_id=v.id
      and target.status='active'
  ) then
    v_source_kind:='existing_snapshot';
  elsif exists(
    select 1 from public.contract_price_options template
    where template.company_id=v_company_id
      and template.contract_product_version_id=v.contract_product_version_id
      and template.price_plan_version_id=v.price_plan_version_id
      and template.contract_publication_version_id is null
      and template.status='active'
  ) then
    v_source_kind:='template';
  else
    with candidate_versions as (
      select distinct source.contract_publication_version_id id
      from public.contract_price_options source
      join public.contract_publication_versions source_version
        on source_version.id=source.contract_publication_version_id
      join public.contract_publications source_publication
        on source_publication.id=source_version.contract_publication_id
      join public.tenant_contract_assignments source_assignment
        on source_assignment.id=source_publication.assignment_id
      where source_assignment.company_id=v_company_id
        and source.contract_product_version_id=v.contract_product_version_id
        and source.price_plan_version_id=v.price_plan_version_id
        and source.contract_publication_version_id<>v.id
        and source.status='active'
    )
    select count(*),count(distinct
      public.gridex_publication_price_options_json_v1(candidate.id)::text)
      into v_prior_candidate_count,v_prior_graph_count
    from candidate_versions candidate;

    if v_prior_candidate_count=0 then
      raise exception using errcode='23514',
        message='PUBLICATION_PRICE_OPTIONS_MISSING';
    elsif v_prior_graph_count<>1 then
      raise exception using errcode='23514',
        message='PUBLICATION_PRICE_SOURCE_AMBIGUOUS';
    end if;

    select source.contract_publication_version_id
      into v_source_publication_version_id
    from public.contract_price_options source
    join public.contract_publication_versions source_version
      on source_version.id=source.contract_publication_version_id
    join public.contract_publications source_publication
      on source_publication.id=source_version.contract_publication_id
    join public.tenant_contract_assignments source_assignment
      on source_assignment.id=source_publication.assignment_id
    where source_assignment.company_id=v_company_id
      and source.contract_product_version_id=v.contract_product_version_id
      and source.price_plan_version_id=v.price_plan_version_id
      and source.contract_publication_version_id<>v.id
      and source.status='active'
    group by source.contract_publication_version_id,
      source_version.version_number,source_version.created_at
    order by source_version.version_number desc,source_version.created_at desc
    limit 1;
    v_source_kind:='prior_snapshot';
  end if;

  if v_source_kind<>'existing_snapshot' then
    select count(*),count(*) filter(where source.is_default is true)
      into v_source_option_count,v_source_default_count
    from public.contract_price_options source
    where source.company_id=v_company_id
      and source.contract_product_version_id=v.contract_product_version_id
      and source.price_plan_version_id=v.price_plan_version_id
      and source.status='active'
      and (
        (v_source_kind='template'
          and source.contract_publication_version_id is null)
        or (v_source_kind='prior_snapshot'
          and source.contract_publication_version_id=
            v_source_publication_version_id)
      );

    if v_source_option_count=0 then
      raise exception using errcode='23514',
        message='PUBLICATION_PRICE_OPTIONS_MISSING';
    elsif v_source_default_count>1 then
      raise exception using errcode='23514',
        message='PUBLICATION_PRICE_OPTION_DEFAULT_INVALID';
    end if;

    with source_options as (
      select source.*
      from public.contract_price_options source
      where source.company_id=v_company_id
        and source.contract_product_version_id=v.contract_product_version_id
        and source.price_plan_version_id=v.price_plan_version_id
        and source.status='active'
        and (
          (v_source_kind='template'
            and source.contract_publication_version_id is null)
          or (v_source_kind='prior_snapshot'
            and source.contract_publication_version_id=
              v_source_publication_version_id)
        )
    ), source_stats as (
      select count(*) option_count from source_options
    ), inserted as (
      insert into public.contract_price_options(
        company_id,contract_product_version_id,price_plan_version_id,
        contract_publication_version_id,option_reference,option_code,
        customer_name,internal_description,contract_type,binding_months,
        notice_months,auto_renew_enabled,renewal_term_months,valid_from,
        valid_to,earliest_start_date,latest_start_date,status,sort_order,
        version_number,metadata,created_by,customer_type,is_default,
        selection_required
      )
      select source.company_id,source.contract_product_version_id,
        source.price_plan_version_id,v.id,source.option_reference,
        source.option_code,source.customer_name,source.internal_description,
        source.contract_type,source.binding_months,source.notice_months,
        source.auto_renew_enabled,source.renewal_term_months,
        source.valid_from,source.valid_to,source.earliest_start_date,
        source.latest_start_date,source.status,source.sort_order,
        source.version_number,
        coalesce(source.metadata,'{}'::jsonb)||jsonb_build_object(
          'materialized_from_price_option_id',source.id,
          'materialized_source_kind',v_source_kind
        ),coalesce(p_actor_user_id,source.created_by),
        coalesce(source.customer_type,v.customer_type),
        coalesce(source.is_default,source_stats.option_count=1),
        coalesce(source.selection_required,source_stats.option_count>1)
      from source_options source
      cross join source_stats
      where not exists(
        select 1 from public.contract_price_options target
        where target.contract_publication_version_id=v.id
          and (
            target.option_reference=source.option_reference
            or target.option_code=source.option_code
          )
      )
      returning id
    )
    select count(*) into v_inserted from inserted;
  end if;

  select count(*) into v_target_option_count
  from public.contract_price_options target
  where target.contract_publication_version_id=v.id
    and target.status='active';

  if v_target_option_count=0 then
    raise exception using errcode='23514',
      message='PUBLICATION_PRICE_OPTION_SNAPSHOT_INSERT_FAILED',
      detail=jsonb_build_object(
        'publication_version_id',v.id,
        'source_kind',v_source_kind,
        'source_publication_version_id',v_source_publication_version_id,
        'source_option_count',v_source_option_count,
        'inserted_price_options',v_inserted,
        'target_price_option_count',v_target_option_count,
        'unique_objects',public.gridex_price_option_unique_objects_v1()
      )::text;
  end if;

  if v_source_kind<>'existing_snapshot'
     and v_target_option_count<>v_source_option_count then
    raise exception using errcode='23514',
      message='PUBLICATION_PRICE_OPTION_SNAPSHOT_COUNT_MISMATCH',
      detail=jsonb_build_object(
        'publication_version_id',v.id,
        'source_kind',v_source_kind,
        'source_publication_version_id',v_source_publication_version_id,
        'source_option_count',v_source_option_count,
        'inserted_price_options',v_inserted,
        'target_price_option_count',v_target_option_count,
        'unique_objects',public.gridex_price_option_unique_objects_v1()
      )::text;
  end if;

  -- Copy area rows without a broad conflict handler. Existing rows are skipped
  -- only by their canonical option + area identity.
  insert into public.contract_price_option_area_prices(
    company_id,contract_price_option_id,price_plan_version_id,
    price_row_reference,price_area,amount,unit,vat_treatment,
    valid_from,valid_to,metadata,created_by,status
  )
  select target.company_id,target.id,target.price_plan_version_id,
    source_area.price_row_reference,source_area.price_area,
    source_area.amount,source_area.unit,source_area.vat_treatment,
    source_area.valid_from,source_area.valid_to,
    coalesce(source_area.metadata,'{}'::jsonb)||jsonb_build_object(
      'materialized_from_area_price_id',source_area.id
    ),coalesce(p_actor_user_id,source_area.created_by),source_area.status
  from public.contract_price_options target
  join public.contract_price_options source
    on source.id=(target.metadata->>'materialized_from_price_option_id')::uuid
  join public.contract_price_option_area_prices source_area
    on source_area.contract_price_option_id=source.id
  where target.contract_publication_version_id=v.id
    and not exists(
      select 1 from public.contract_price_option_area_prices existing_area
      where existing_area.contract_price_option_id=target.id
        and existing_area.price_area=source_area.price_area
    );

  -- Legacy partial snapshots may lack materialization metadata. Complete only
  -- from the exact same template identity and unchanged commercial values.
  insert into public.contract_price_option_area_prices(
    company_id,contract_price_option_id,price_plan_version_id,
    price_row_reference,price_area,amount,unit,vat_treatment,
    valid_from,valid_to,metadata,created_by,status
  )
  select target.company_id,target.id,target.price_plan_version_id,
    source_area.price_row_reference,source_area.price_area,
    source_area.amount,source_area.unit,source_area.vat_treatment,
    source_area.valid_from,source_area.valid_to,
    coalesce(source_area.metadata,'{}'::jsonb)||jsonb_build_object(
      'materialized_from_area_price_id',source_area.id,
      'materialized_source_kind','template_reference_match'
    ),coalesce(p_actor_user_id,source_area.created_by),source_area.status
  from public.contract_price_options target
  join public.contract_price_options source
    on source.company_id=target.company_id
   and source.contract_product_version_id=target.contract_product_version_id
   and source.price_plan_version_id=target.price_plan_version_id
   and source.contract_publication_version_id is null
   and source.status='active'
   and source.option_reference=target.option_reference
   and source.option_code=target.option_code
   and source.contract_type=target.contract_type
   and source.binding_months is not distinct from target.binding_months
   and source.notice_months is not distinct from target.notice_months
   and source.auto_renew_enabled is not distinct from target.auto_renew_enabled
   and source.renewal_term_months is not distinct from target.renewal_term_months
   and source.valid_from is not distinct from target.valid_from
   and source.valid_to is not distinct from target.valid_to
   and source.earliest_start_date is not distinct from target.earliest_start_date
   and source.latest_start_date is not distinct from target.latest_start_date
   and coalesce(source.metadata->>'fixed_price','')=
     coalesce(target.metadata->>'fixed_price','')
   and coalesce(source.metadata->>'markup','')=
     coalesce(target.metadata->>'markup','')
   and coalesce(source.metadata->>'monthly_fee','')=
     coalesce(target.metadata->>'monthly_fee','')
  join public.contract_price_option_area_prices source_area
    on source_area.contract_price_option_id=source.id
  where target.contract_publication_version_id=v.id
    and not exists(
      select 1 from public.contract_price_option_area_prices existing_area
      where existing_area.contract_price_option_id=target.id
        and existing_area.price_area=source_area.price_area
    );

  -- Complete only relation-policy metadata; commercial values remain unchanged.
  perform set_config('gridex.publication_graph_repair','on',true);
  update public.contract_price_options target
  set is_default=true,selection_required=false
  where target.contract_publication_version_id=v.id
    and (target.is_default is null or target.selection_required is null)
    and 1=(
      select count(*) from public.contract_price_options all_options
      where all_options.contract_publication_version_id=v.id
        and all_options.status='active'
    );
  perform set_config('gridex.publication_graph_repair','off',true);

  return jsonb_build_object(
    'publication_version_id',v.id,
    'source_kind',v_source_kind,
    'source_publication_version_id',v_source_publication_version_id,
    'source_price_option_count',v_source_option_count,
    'inserted_price_options',v_inserted,
    'target_price_option_count',v_target_option_count,
    'price_options',public.gridex_publication_price_options_json_v1(v.id)
  );
end $$;

comment on function
  public.gridex_materialize_publication_price_options_v1(uuid,uuid)
is 'Strictly copies active template/prior-snapshot rows into one publication version. No broad conflict is swallowed; source/target counts must match before publication can finalize.';

-- Executes the exact production republish path inside a PL/pgSQL subtransaction
-- and deliberately rolls it back after success. It is a real data-path test,
-- not a separate simulation.
create or replace function
  public.gridex_test_republish_active_public_contract_v2(
    p_publication_version_id uuid,
    p_actor_user_id uuid default null,
    p_explicit_invoice_fee_sek numeric default null
  ) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_catalog,pg_temp
as $$
declare
  v_result jsonb;
  v_state text;
  v_message text;
  v_detail text;
  v_constraint text;
  v_table text;
begin
  begin
    v_result:=public.gridex_republish_active_public_contract_v2(
      p_publication_version_id,
      p_actor_user_id,
      p_explicit_invoice_fee_sek
    );

    raise exception using
      errcode='P0001',
      message='GRIDEX_REPUBLISH_ROLLBACK_TEST_SUCCESS',
      detail=v_result::text;
  exception
    when sqlstate 'P0001' then
      get stacked diagnostics
        v_state=returned_sqlstate,
        v_message=message_text,
        v_detail=pg_exception_detail,
        v_constraint=constraint_name,
        v_table=table_name;

      if v_message='GRIDEX_REPUBLISH_ROLLBACK_TEST_SUCCESS' then
        return jsonb_build_object(
          'ok',true,
          'rolled_back',true,
          'result',coalesce(nullif(v_detail,''),'{}')::jsonb,
          'unique_objects',public.gridex_price_option_unique_objects_v1()
        );
      end if;

      return jsonb_build_object(
        'ok',false,
        'rolled_back',true,
        'sqlstate',v_state,
        'message',v_message,
        'detail',v_detail,
        'constraint',nullif(v_constraint,''),
        'table',nullif(v_table,''),
        'unique_objects',public.gridex_price_option_unique_objects_v1()
      );
    when others then
      get stacked diagnostics
        v_state=returned_sqlstate,
        v_message=message_text,
        v_detail=pg_exception_detail,
        v_constraint=constraint_name,
        v_table=table_name;

      return jsonb_build_object(
        'ok',false,
        'rolled_back',true,
        'sqlstate',v_state,
        'message',v_message,
        'detail',v_detail,
        'constraint',nullif(v_constraint,''),
        'table',nullif(v_table,''),
        'unique_objects',public.gridex_price_option_unique_objects_v1()
      );
  end;
end $$;

revoke all on function public.gridex_price_option_unique_objects_v1()
  from public,anon,authenticated;
grant execute on function public.gridex_price_option_unique_objects_v1()
  to service_role;

revoke all on function
  public.gridex_materialize_publication_price_options_v1(uuid,uuid)
  from public,anon,authenticated;
grant execute on function
  public.gridex_materialize_publication_price_options_v1(uuid,uuid)
  to service_role;

revoke all on function
  public.gridex_test_republish_active_public_contract_v2(uuid,uuid,numeric)
  from public,anon,authenticated;
grant execute on function
  public.gridex_test_republish_active_public_contract_v2(uuid,uuid,numeric)
  to service_role;

commit;