-- Gridex OPS: canonical contract deletion graph completion.
--
-- This forward-only repair supersedes every earlier delete/cleanup definition.
-- Permanent deletion is intentionally limited to unused draft/ready offers.
-- Published or historical contracts are unpublished/archived/closed, never
-- silently destroyed by the cleanup command.

begin;

create table if not exists public.contract_lifecycle_operation_errors (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  company_id uuid references public.companies(id) on delete cascade,
  actor_user_id uuid,
  action text not null,
  offer_id uuid,
  contract_product_id uuid,
  sqlstate text,
  error_message text not null,
  error_detail text,
  error_hint text,
  blocker_relation text,
  request_id text,
  correlation_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(reference)
);

create index if not exists contract_lifecycle_operation_errors_company_created_idx
  on public.contract_lifecycle_operation_errors(company_id,created_at desc);

alter table public.contract_lifecycle_operation_errors enable row level security;
alter table public.contract_lifecycle_operation_errors force row level security;
revoke all on public.contract_lifecycle_operation_errors from public,anon,authenticated;
grant select,insert on public.contract_lifecycle_operation_errors to service_role;

comment on table public.contract_lifecycle_operation_errors is
  'Durable, tenant-scoped technical evidence for contract lifecycle failures. Never contains secrets or customer identity payloads.';

-- Only RESTRICT/NO ACTION references are blockers. SET NULL and CASCADE are
-- database-owned cleanup rules and must not be rejected pre-emptively.
create or replace function public.gridex_fk_reference_blockers(
  p_target regclass,
  p_target_ids uuid[],
  p_ignored_relations text[] default '{}'::text[]
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_catalog,pg_temp
as $$
declare
  fk record;
  v_count bigint;
  v_items jsonb:='[]'::jsonb;
begin
  if cardinality(coalesce(p_target_ids,'{}'::uuid[]))=0 then
    return jsonb_build_object('count',0,'items',v_items);
  end if;

  for fk in
    select
      c.conname,
      c.conrelid::regclass as relation_name,
      a.attname as column_name,
      c.confdeltype
    from pg_constraint c
    join pg_attribute a
      on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.contype='f'
      and c.confrelid=p_target
      and cardinality(c.conkey)=1
      and cardinality(c.confkey)=1
      and c.confdeltype in ('a','r')
      and not (c.conrelid::regclass::text=any(coalesce(p_ignored_relations,'{}'::text[])))
    order by c.conrelid::regclass::text,c.conname
  loop
    execute format(
      'select count(*) from %s where %I=any($1)',
      fk.relation_name,
      fk.column_name
    ) into v_count using p_target_ids;
    if v_count>0 then
      v_items:=v_items||jsonb_build_array(jsonb_build_object(
        'constraint',fk.conname,
        'relation',fk.relation_name::text,
        'column',fk.column_name,
        'rows',v_count,
        'delete_rule',case fk.confdeltype when 'a' then 'NO ACTION' else 'RESTRICT' end
      ));
    end if;
  end loop;

  return jsonb_build_object('count',jsonb_array_length(v_items),'items',v_items);
end $$;

create or replace function public.gridex_assert_no_public_offer_fk_references(
  p_public_offer_ids uuid[]
) returns void
language plpgsql
security definer
set search_path=public,pg_catalog,pg_temp
as $$
declare
  v_blockers jsonb;
  v_first jsonb;
begin
  v_blockers:=public.gridex_fk_reference_blockers(
    'public.public_contract_offers'::regclass,
    p_public_offer_ids
  );
  if coalesce((v_blockers->>'count')::integer,0)>0 then
    v_first:=v_blockers#>'{items,0}';
    raise exception using
      errcode='23503',
      message='contract_public_offer_still_referenced',
      detail=format(
        'Foreign key %s on %s.%s still references %s public offer row(s).',
        coalesce(v_first->>'constraint','unknown'),
        coalesce(v_first->>'relation','unknown'),
        coalesce(v_first->>'column','unknown'),
        coalesce(v_first->>'rows','0')
      ),
      hint='Run gridex_preview_delete_unused_contract and inspect foreign_key_blockers.';
  end if;
end $$;

create or replace function public.gridex_preview_delete_unused_contract(
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
  v_business jsonb;
  v_graph jsonb;
  v_counts jsonb;
  v_public_offer_ids uuid[]:='{}'::uuid[];
  v_product_version_ids uuid[]:='{}'::uuid[];
  v_publication_version_ids uuid[]:='{}'::uuid[];
  v_legal_version_ids uuid[]:='{}'::uuid[];
  v_offer_references text[]:='{}'::text[];
  v_quote_count bigint:=0;
  v_backfill_issue_count bigint:=0;
  v_business_total bigint:=0;
  v_unsafe_total bigint:=0;
  v_reason_codes text[]:='{}'::text[];
  v_can_delete boolean:=false;
  v_delete_status_allowed boolean:=false;
  v_public_fk_blockers jsonb;
begin
  select * into o
  from public.contract_offers co
  where co.id=p_offer_id and co.company_id=p_company_id;
  if not found then
    return jsonb_build_object(
      'ok',false,'code','contract_offer_not_found',
      'can_delete',false,'deletable',false
    );
  end if;

  v_business:=public.gridex_contract_business_usage_counts(p_company_id,p_offer_id);
  v_graph:=public.gridex_resolve_contract_lifecycle_graph(p_company_id,p_offer_id);
  if not coalesce((v_graph->>'ok')::boolean,false) then
    return v_graph||jsonb_build_object('can_delete',false,'deletable',false);
  end if;
  v_counts:=coalesce(v_graph->'counts','{}'::jsonb);

  select coalesce(array_agg(value::uuid),'{}'::uuid[])
    into v_public_offer_ids
  from jsonb_array_elements_text(coalesce(v_graph->'public_contract_offer_ids','[]'::jsonb));
  select coalesce(array_agg(value::uuid),'{}'::uuid[])
    into v_product_version_ids
  from jsonb_array_elements_text(coalesce(v_graph->'contract_product_version_ids','[]'::jsonb));
  select coalesce(array_agg(value::uuid),'{}'::uuid[])
    into v_publication_version_ids
  from jsonb_array_elements_text(coalesce(v_graph->'publication_version_ids','[]'::jsonb));
  select coalesce(array_agg(value::uuid),'{}'::uuid[])
    into v_legal_version_ids
  from jsonb_array_elements_text(coalesce(v_graph->'legal_bundle_version_ids','[]'::jsonb));

  select coalesce(array_agg(distinct pco.canonical_offer_reference)
    filter(where pco.canonical_offer_reference is not null),'{}'::text[])
  into v_offer_references
  from public.public_contract_offers pco
  where pco.id=any(v_public_offer_ids);

  select count(*) into v_quote_count
  from public.website_contract_quotes q
  where q.company_id=p_company_id and (
    q.contract_product_version_id=any(v_product_version_ids)
    or q.contract_publication_version_id=any(v_publication_version_ids)
    or q.legal_bundle_version_id=any(v_legal_version_ids)
    or q.offer_reference=any(v_offer_references)
  );

  select count(*) into v_backfill_issue_count
  from public.contract_lifecycle_backfill_issues i
  where i.company_id=p_company_id and (
    i.contract_offer_id=p_offer_id
    or i.public_contract_offer_id=any(v_public_offer_ids)
  );

  v_business_total:=coalesce((v_business->>'total')::bigint,0)+v_quote_count;
  v_unsafe_total:=coalesce((v_counts->>'successor_offers')::bigint,0)
    +coalesce((v_counts->>'shared_product_version_references')::bigint,0)
    +coalesce((v_counts->>'shared_legal_version_references')::bigint,0)
    +coalesce((v_counts->>'unsafe_graph_issues')::bigint,0);
  v_delete_status_allowed:=o.lifecycle_status in ('draft','ready');

  if coalesce((v_business->>'customer_contracts')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_CUSTOMER_CONTRACTS'); end if;
  if coalesce((v_business->>'customer_applications')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_ACCEPTED_APPLICATIONS'); end if;
  if coalesce((v_business->>'external_intakes')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_EXTERNAL_INTAKES'); end if;
  if coalesce((v_business->>'binding_price_snapshots')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_BINDING_PRICE_SNAPSHOTS'); end if;
  if coalesce((v_business->>'invoices')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_INVOICES'); end if;
  if coalesce((v_business->>'billing_underlays')::bigint,0)>0 or coalesce((v_business->>'billing_underlay_items')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_BILLING_HISTORY'); end if;
  if coalesce((v_business->>'charge_ledger')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_CHARGE_LEDGER'); end if;
  if coalesce((v_business->>'legal_acceptances')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_LEGAL_ACCEPTANCES'); end if;
  if v_quote_count>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_WEBSITE_QUOTES'); end if;
  if coalesce((v_counts->>'successor_offers')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_SUCCESSOR_VERSION'); end if;
  if coalesce((v_counts->>'shared_product_version_references')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_SHARED_CANONICAL_VERSION'); end if;
  if coalesce((v_counts->>'shared_legal_version_references')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_SHARED_LEGAL_VERSION'); end if;
  if coalesce((v_counts->>'unsafe_graph_issues')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'PUBLICATION_GRAPH_INCONSISTENT'); end if;
  if not v_delete_status_allowed then v_reason_codes:=array_append(v_reason_codes,'PERMANENT_DELETE_REQUIRES_DRAFT'); end if;

  -- Backfill issue rows are technical diagnostics and are deleted before their
  -- referenced public offer. They are reported but never misclassified as
  -- customer/business history.
  v_public_fk_blockers:=public.gridex_fk_reference_blockers(
    'public.public_contract_offers'::regclass,
    v_public_offer_ids,
    array[
      'contract_lifecycle_backfill_issues',
      'contract_publication_versions'
    ]
  );
  if coalesce((v_public_fk_blockers->>'count')::integer,0)>0 then
    v_reason_codes:=array_append(v_reason_codes,'HAS_RESTRICTING_FOREIGN_KEYS');
  end if;

  v_can_delete:=v_delete_status_allowed
    and v_business_total=0
    and v_unsafe_total=0
    and coalesce((v_public_fk_blockers->>'count')::integer,0)=0;

  return jsonb_build_object(
    'ok',true,
    'can_delete',v_can_delete,
    'deletable',v_can_delete,
    'has_business_usage',v_business_total>0,
    'requires_archive',v_business_total>0 or not v_delete_status_allowed,
    'requires_unpublish',o.lifecycle_status in ('published','paused'),
    'recommended_action',case
      when o.lifecycle_status in ('published','paused') then 'unpublish'
      when o.lifecycle_status in ('closed','expired','archived','superseded') then 'hide_terminal'
      when v_business_total>0 then 'archive'
      when v_unsafe_total>0 then 'repair'
      when v_can_delete then 'delete'
      else 'review'
    end,
    'result_mode',case when v_can_delete then 'delete' else 'archive_only' end,
    'business_blockers',(v_business-'ok'-'total')||jsonb_build_object('website_quotes',v_quote_count),
    'business_references',(v_business-'ok'-'total')||jsonb_build_object('website_quotes',v_quote_count),
    'removable_system_dependencies',jsonb_build_object(
      'public_offers',coalesce((v_counts->>'public_offers')::bigint,0),
      'tenant_assignments',coalesce((v_counts->>'tenant_assignments')::bigint,0),
      'publications',coalesce((v_counts->>'publications')::bigint,0),
      'publication_versions',coalesce((v_counts->>'publication_versions')::bigint,0),
      'legal_bundle_versions',coalesce((v_counts->>'legal_bundle_versions')::bigint,0),
      'backfill_issues',v_backfill_issue_count
    ),
    'system_references',v_counts||jsonb_build_object(
      'website_quotes',v_quote_count,
      'contract_lifecycle_backfill_issues',v_backfill_issue_count
    ),
    'foreign_key_blockers',v_public_fk_blockers,
    'reason_codes',to_jsonb(v_reason_codes),
    'lifecycle_status',o.lifecycle_status,
    'canonical_mapping_complete',
      o.contract_product_id is not null and o.contract_product_version_id is not null,
    'legacy_cleanup_supported',true,
    'graph',v_graph
  );
end $$;

create or replace function public.gridex_delete_unused_contract(
  p_company_id uuid,
  p_offer_id uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_preview jsonb;
  v_graph jsonb;
  v_product_id uuid;
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
  from public.contract_offers co
  where co.id=p_offer_id and co.company_id=p_company_id
  for update;
  if not found then
    raise exception using errcode='P0002',message='contract_offer_not_found';
  end if;

  v_preview:=public.gridex_preview_delete_unused_contract(p_company_id,p_offer_id);
  if not coalesce((v_preview->>'can_delete')::boolean,false) then
    return jsonb_build_object(
      'ok',false,'changed',false,'deleted',false,'mode','blocked',
      'code','unused_contract_delete_blocked',
      'reason_codes',coalesce(v_preview->'reason_codes','[]'::jsonb),
      'recommended_action',coalesce(v_preview->>'recommended_action','review'),
      'delete_preview',v_preview
    );
  end if;

  v_graph:=v_preview->'graph';
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_public_offer_ids
    from jsonb_array_elements_text(coalesce(v_graph->'public_contract_offer_ids','[]'::jsonb));
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_assignment_ids
    from jsonb_array_elements_text(coalesce(v_graph->'tenant_assignment_ids','[]'::jsonb));
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_product_version_ids
    from jsonb_array_elements_text(coalesce(v_graph->'contract_product_version_ids','[]'::jsonb));
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_publication_ids
    from jsonb_array_elements_text(coalesce(v_graph->'publication_ids','[]'::jsonb));
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_publication_version_ids
    from jsonb_array_elements_text(coalesce(v_graph->'publication_version_ids','[]'::jsonb));
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_legal_version_ids
    from jsonb_array_elements_text(coalesce(v_graph->'legal_bundle_version_ids','[]'::jsonb));

  v_product_id:=o.contract_product_id;
  perform set_config('gridex.public_offer_write','on',true);
  perform set_config('gridex.version_transition','on',true);
  perform set_config('gridex.publication_link_repair','on',true);

  update public.tenant_contract_channels ch
  set status='ended',
      valid_to=coalesce(ch.valid_to,now()),
      updated_by=p_actor_user_id,
      updated_at=now()
  where ch.assignment_id=any(v_assignment_ids) and ch.status<>'ended';

  update public.contract_publications cp
  set status='ended',updated_at=now()
  where cp.id=any(v_publication_ids) and cp.status not in ('ended','archived');

  update public.contract_publication_versions cpv
  set status='ended',valid_to=coalesce(cpv.valid_to,now())
  where cpv.id=any(v_publication_version_ids)
    and cpv.status not in ('ended','archived');

  update public.contract_publication_versions cpv
  set legacy_public_contract_offer_id=null
  where cpv.legacy_public_contract_offer_id=any(v_public_offer_ids);

  -- Diagnostics belong to the removed technical graph. Delete them before the
  -- public offer regardless of historical FK action drift.
  delete from public.contract_lifecycle_backfill_issues i
  where i.company_id=p_company_id and (
    i.contract_offer_id=p_offer_id
    or i.public_contract_offer_id=any(v_public_offer_ids)
  );
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_lifecycle_backfill_issues',v_count);

  perform public.gridex_assert_no_public_offer_fk_references(v_public_offer_ids);

  delete from public.contract_offer_versions cov
  where cov.company_id=p_company_id and cov.contract_offer_id=o.id;
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_offer_versions',v_count);

  delete from public.public_contract_offers pco where pco.id=any(v_public_offer_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('public_contract_offers',v_count);

  delete from public.contract_publication_versions cpv
  where cpv.id=any(v_publication_version_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_publication_versions',v_count);

  delete from public.contract_publications cp where cp.id=any(v_publication_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_publications',v_count);

  delete from public.tenant_contract_channels ch where ch.assignment_id=any(v_assignment_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('tenant_contract_channels',v_count);

  delete from public.tenant_contract_assignments ta where ta.id=any(v_assignment_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('tenant_contract_assignments',v_count);

  delete from public.contract_offers co
  where co.id=o.id and co.company_id=p_company_id;
  get diagnostics v_count=row_count;
  if v_count<>1 then
    raise exception using errcode='55000',message='contract_offer_delete_count_mismatch';
  end if;
  v_counts:=v_counts||jsonb_build_object('contract_offers',v_count);

  delete from public.legal_bundle_version_documents d
  where d.legal_bundle_version_id=any(v_legal_version_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('legal_bundle_version_documents',v_count);

  delete from public.legal_bundle_versions lbv where lbv.id=any(v_legal_version_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('legal_bundle_versions',v_count);

  delete from public.contract_product_versions cpv
  where cpv.id=any(v_product_version_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_product_versions',v_count);

  if v_product_id is not null
     and not exists(
       select 1 from public.contract_product_versions cpv
       where cpv.contract_product_id=v_product_id
     ) then
    delete from public.contract_products cp
    where cp.id=v_product_id and cp.company_id=p_company_id;
    get diagnostics v_count=row_count;
    v_counts:=v_counts||jsonb_build_object('contract_products',v_count);
  end if;

  -- Price versions/books are immutable shared pricing evidence and have many
  -- later consumers (quotes, portfolio, invoices). Contract deletion does not
  -- own their garbage collection.
  insert into public.audit_logs(
    company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata
  ) values(
    p_company_id,p_actor_user_id,'contract_product',coalesce(v_product_id,p_offer_id)::text,
    'contract.delete_unused',to_jsonb(o),null,
    jsonb_build_object('offer_id',p_offer_id,'deleted_rows',v_counts,'preview',v_preview)
  );

  return jsonb_build_object(
    'ok',true,'changed',true,'deleted',true,'mode','deleted',
    'offer_id',p_offer_id,'contract_product_id',v_product_id,
    'deleted_rows',v_counts
  );
end $$;

-- Safe delete never canonicalizes an incomplete legacy draft. Creating product,
-- price, legal or publication versions in order to delete trash is forbidden.
create or replace function public.gridex_remove_internal_contract_offer(
  p_company_id uuid,
  p_offer_id uuid,
  p_mode text default 'archive',
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_preview jsonb;
begin
  if p_mode='archive' then
    return public.gridex_archive_contract_product(p_company_id,p_offer_id,p_actor_user_id);
  elsif p_mode='safe_delete' then
    v_preview:=public.gridex_preview_delete_unused_contract(p_company_id,p_offer_id);
    if coalesce((v_preview->>'can_delete')::boolean,false) then
      return public.gridex_delete_unused_contract(p_company_id,p_offer_id,p_actor_user_id);
    end if;
    return jsonb_build_object(
      'ok',false,'changed',false,'mode','blocked',
      'code','unused_contract_delete_blocked',
      'reason_codes',coalesce(v_preview->'reason_codes','[]'::jsonb),
      'recommended_action',coalesce(v_preview->>'recommended_action','review'),
      'delete_preview',v_preview
    );
  end if;
  raise exception using errcode='22023',message='invalid_contract_remove_mode';
end $$;

-- Each iteration runs in its own PL/pgSQL exception subtransaction. One broken
-- legacy row can no longer roll back earlier successful deletions.
create or replace function public.gridex_cleanup_unused_contract_drafts(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_apply boolean default false
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  r record;
  v_preview jsonb;
  v_item jsonb;
  v_items jsonb:='[]'::jsonb;
  v_deleted integer:=0;
  v_deletable integer:=0;
  v_blocked integer:=0;
  v_errors integer:=0;
  v_sqlstate text;
  v_message text;
  v_detail text;
  v_hint text;
  v_reference text;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.delete_unused');

  for r in
    select co.id,co.name,co.lifecycle_status,co.updated_at
    from public.contract_offers co
    where co.company_id=p_company_id
      and co.lifecycle_status in ('draft','ready')
    order by co.updated_at,co.id
    limit 100
  loop
    begin
      v_preview:=public.gridex_preview_delete_unused_contract(p_company_id,r.id);
      if coalesce((v_preview->>'can_delete')::boolean,false) then
        v_deletable:=v_deletable+1;
        if p_apply then
          v_item:=public.gridex_remove_internal_contract_offer(
            p_company_id,r.id,'safe_delete',p_actor_user_id
          );
          if coalesce((v_item->>'ok')::boolean,false)
             and v_item->>'mode'='deleted' then
            v_deleted:=v_deleted+1;
          else
            v_blocked:=v_blocked+1;
          end if;
        else
          v_item:=jsonb_build_object(
            'ok',true,'offer_id',r.id,'name',r.name,
            'action','would_delete','preview',v_preview
          );
        end if;
      else
        v_blocked:=v_blocked+1;
        v_item:=jsonb_build_object(
          'ok',false,'offer_id',r.id,'name',r.name,
          'action','blocked',
          'reason_codes',coalesce(v_preview->'reason_codes','[]'::jsonb),
          'recommended_action',coalesce(v_preview->>'recommended_action','review'),
          'preview',v_preview
        );
      end if;
    exception when others then
      get stacked diagnostics
        v_sqlstate=returned_sqlstate,
        v_message=message_text,
        v_detail=pg_exception_detail,
        v_hint=pg_exception_hint;
      v_errors:=v_errors+1;
      v_reference:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
      insert into public.contract_lifecycle_operation_errors(
        reference,company_id,actor_user_id,action,offer_id,sqlstate,
        error_message,error_detail,error_hint,metadata
      ) values(
        v_reference,p_company_id,p_actor_user_id,
        'gridex_cleanup_unused_contract_drafts',r.id,v_sqlstate,
        coalesce(v_message,'unknown_error'),v_detail,v_hint,
        jsonb_build_object('apply',p_apply,'lifecycle_status',r.lifecycle_status)
      );
      v_item:=jsonb_build_object(
        'ok',false,'offer_id',r.id,'name',r.name,'action','error',
        'reference',v_reference,'sqlstate',v_sqlstate,
        'message','Avtalet kunde inte behandlas i batchen.'
      );
    end;
    v_items:=v_items||jsonb_build_array(v_item);
  end loop;

  return jsonb_build_object(
    'ok',true,'apply',p_apply,
    'scanned_count',jsonb_array_length(v_items),
    'deletable_count',v_deletable,
    'deleted_count',v_deleted,
    'blocked_count',v_blocked,
    'error_count',v_errors,
    'batch_limit',100,
    'items',v_items
  );
end $$;

-- Recreate close with qualified target columns and a null-safe legacy scope.
create or replace function public.gridex_close_contract_product(
  p_company_id uuid,
  p_offer_id uuid,
  p_actor_user_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_before jsonb;
  v_offer_ids uuid[]:='{}'::uuid[];
  v_product_version_ids uuid[]:='{}'::uuid[];
  v_assignment_ids uuid[]:='{}'::uuid[];
  v_public_offer_ids uuid[]:='{}'::uuid[];
  v_offer_references text[]:='{}'::text[];
  v_channels bigint:=0;
  v_publications bigint:=0;
  v_versions bigint:=0;
  v_public_offers bigint:=0;
  v_quotes bigint:=0;
  v_event_id uuid;
  v_aggregate_id text;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.close');
  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    return jsonb_build_object('ok',false,'changed',false,'code','contract_close_reason_required');
  end if;

  select * into o
  from public.contract_offers co
  where co.id=p_offer_id and co.company_id=p_company_id
  for update;
  if not found then
    return jsonb_build_object('ok',false,'changed',false,'code','contract_not_found');
  end if;
  if o.lifecycle_status='closed' then
    return jsonb_build_object('ok',true,'changed',false,'mode','closed','code','contract_already_closed');
  end if;
  if o.lifecycle_status='archived' then
    return jsonb_build_object('ok',false,'changed',false,'code','contract_already_archived');
  end if;
  v_before:=to_jsonb(o);
  v_aggregate_id:=coalesce(o.contract_product_id,o.id)::text;

  v_offer_ids:=array(
    select co.id
    from public.contract_offers co
    where co.company_id=p_company_id and (
      co.id=o.id
      or (o.contract_product_id is not null and co.contract_product_id=o.contract_product_id)
    )
    order by co.id
  );
  v_product_version_ids:=array(
    select distinct co.contract_product_version_id
    from public.contract_offers co
    where co.id=any(v_offer_ids) and co.contract_product_version_id is not null
    order by co.contract_product_version_id
  );
  v_assignment_ids:=array(
    select ta.id
    from public.tenant_contract_assignments ta
    where ta.company_id=p_company_id
      and ta.contract_product_version_id=any(v_product_version_ids)
    order by ta.id
  );
  v_public_offer_ids:=array(
    select pco.id
    from public.public_contract_offers pco
    where pco.company_id=p_company_id and (
      pco.source_contract_offer_id=any(v_offer_ids)
      or pco.contract_product_version_id=any(v_product_version_ids)
    )
    order by pco.id
  );
  select coalesce(array_agg(distinct pco.canonical_offer_reference)
    filter(where pco.canonical_offer_reference is not null),'{}'::text[])
  into v_offer_references
  from public.public_contract_offers pco
  where pco.id=any(v_public_offer_ids);

  perform set_config('gridex.version_transition','on',true);
  perform set_config('gridex.public_offer_write','on',true);

  update public.tenant_contract_channels ch
  set status='ended',valid_to=coalesce(ch.valid_to,now()),
      updated_by=p_actor_user_id,updated_at=now()
  where ch.assignment_id=any(v_assignment_ids) and ch.status<>'ended';
  get diagnostics v_channels=row_count;

  update public.contract_publications cp
  set status='ended',updated_at=now()
  where cp.assignment_id=any(v_assignment_ids)
    and cp.status not in ('ended','archived');
  get diagnostics v_publications=row_count;

  update public.contract_publication_versions cpv
  set status='ended',valid_to=coalesce(cpv.valid_to,now())
  where cpv.contract_publication_id in (
    select cp.id from public.contract_publications cp
    where cp.assignment_id=any(v_assignment_ids)
  ) and cpv.status not in ('ended','archived');
  get diagnostics v_versions=row_count;

  update public.public_contract_offers pco
  set lifecycle_status='closed',publication_status='unpublished',
      is_public=false,website_enabled=false,website_cta_enabled=false,
      closed_at=coalesce(pco.closed_at,now()),closed_by=p_actor_user_id,
      close_reason=btrim(p_reason),updated_by=p_actor_user_id,updated_at=now()
  where pco.id=any(v_public_offer_ids);
  get diagnostics v_public_offers=row_count;

  update public.website_contract_quotes q
  set status='revoked',updated_at=now()
  where q.company_id=p_company_id and q.status='active' and (
    q.offer_reference=any(v_offer_references)
    or q.contract_product_version_id=any(v_product_version_ids)
  );
  get diagnostics v_quotes=row_count;

  update public.tenant_contract_assignments ta
  set status='ended',valid_to=coalesce(ta.valid_to,now()),updated_at=now()
  where ta.id=any(v_assignment_ids) and ta.status<>'ended';

  update public.contract_offers co
  set lifecycle_status='closed',status='inactive',is_active=false,
      closed_at=coalesce(co.closed_at,now()),closed_by=p_actor_user_id,
      close_reason=btrim(p_reason),updated_by=p_actor_user_id,updated_at=now()
  where co.id=any(v_offer_ids);

  if o.contract_product_id is not null then
    update public.contract_products cp
    set status='archived',updated_at=now()
    where cp.id=o.contract_product_id and cp.company_id=p_company_id;
  end if;

  insert into public.audit_logs(
    company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata
  ) values(
    p_company_id,p_actor_user_id,'contract_product',v_aggregate_id,
    'contract.closed',v_before,
    jsonb_build_object('lifecycle_status','closed','closed_at',now(),'close_reason',btrim(p_reason)),
    jsonb_build_object(
      'offer_id',o.id,'legacy_without_product_id',o.contract_product_id is null,
      'affected_channels',v_channels,'affected_publications',v_publications,
      'affected_publication_versions',v_versions,'affected_public_offers',v_public_offers,
      'revoked_unused_quotes',v_quotes
    )
  );

  insert into public.domain_events(
    company_id,event_type,aggregate_type,aggregate_id,actor_user_id,source,idempotency_key,payload
  ) values(
    p_company_id,'contract.closed','contract_product',v_aggregate_id,
    p_actor_user_id,'database',
    format('contract.closed:%s:%s',v_aggregate_id,extract(epoch from now())::bigint),
    jsonb_build_object(
      'contract_product_id',o.contract_product_id,
      'offer_id',o.id,'reason',btrim(p_reason)
    )
  ) returning id into v_event_id;

  insert into public.event_outbox(
    company_id,domain_event_id,destination_type,destination_key,payload
  ) values(
    p_company_id,v_event_id,'webhook','contract.closed',
    jsonb_build_object('domain_event_id',v_event_id,'event_type','contract.closed')
  ) on conflict do nothing;

  perform public.gridex_bump_contract_publication_revision(
    p_company_id,'website','contract_closed',v_aggregate_id
  );
  perform public.gridex_bump_contract_publication_revision(
    p_company_id,'api','contract_closed',v_aggregate_id
  );

  return jsonb_build_object(
    'ok',true,'changed',true,'mode','closed','code','contract_closed',
    'contract_product_id',o.contract_product_id,'offer_id',o.id,
    'legacy_without_product_id',o.contract_product_id is null,
    'affected_channels',v_channels,'affected_publications',v_publications,
    'affected_publication_versions',v_versions,'affected_public_offers',v_public_offers,
    'revoked_unused_quotes',v_quotes,'event_id',v_event_id
  );
end $$;

revoke all on function public.gridex_fk_reference_blockers(regclass,uuid[],text[])
  from public,anon,authenticated;
grant execute on function public.gridex_fk_reference_blockers(regclass,uuid[],text[])
  to service_role;
revoke all on function public.gridex_assert_no_public_offer_fk_references(uuid[])
  from public,anon,authenticated;
grant execute on function public.gridex_assert_no_public_offer_fk_references(uuid[])
  to service_role;
revoke all on function public.gridex_preview_delete_unused_contract(uuid,uuid)
  from public,anon;
grant execute on function public.gridex_preview_delete_unused_contract(uuid,uuid)
  to authenticated,service_role;
revoke all on function public.gridex_delete_unused_contract(uuid,uuid,uuid)
  from public,anon;
grant execute on function public.gridex_delete_unused_contract(uuid,uuid,uuid)
  to authenticated,service_role;
revoke all on function public.gridex_remove_internal_contract_offer(uuid,uuid,text,uuid)
  from public,anon;
grant execute on function public.gridex_remove_internal_contract_offer(uuid,uuid,text,uuid)
  to authenticated,service_role;
revoke all on function public.gridex_cleanup_unused_contract_drafts(uuid,uuid,boolean)
  from public,anon;
grant execute on function public.gridex_cleanup_unused_contract_drafts(uuid,uuid,boolean)
  to authenticated,service_role;
revoke all on function public.gridex_close_contract_product(uuid,uuid,uuid,text)
  from public,anon;
grant execute on function public.gridex_close_contract_product(uuid,uuid,uuid,text)
  to authenticated,service_role;

comment on function public.gridex_preview_delete_unused_contract(uuid,uuid) is
  'Canonical delete preview. Includes quotes, business evidence, graph integrity, diagnostic cleanup and real RESTRICT/NO ACTION blockers.';
comment on function public.gridex_cleanup_unused_contract_drafts(uuid,uuid,boolean) is
  'Batch-safe dry-run/apply for at most 100 draft/ready offers. Per-offer exceptions are isolated and durably referenced.';

commit;
