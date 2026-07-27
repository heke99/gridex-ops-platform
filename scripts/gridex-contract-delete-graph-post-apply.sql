\set ON_ERROR_STOP on

-- Read-only post-apply verification. It proves that the final live function
-- bodies are the append-only completion definitions, not overwritten legacy
-- versions. Safe previews are then executed against every draft/ready row.

do $$
declare
  v_delete text;
  v_delete_v2 text;
  v_graph_v2 text;
  v_close text;
  r record;
  v_preview jsonb;
begin
  select pg_get_functiondef(
    'public.gridex_delete_unused_contract(uuid,uuid,uuid)'::regprocedure
  ) into v_delete;
  select pg_get_functiondef(
    'public.gridex_delete_unused_contract_v2(uuid,uuid,uuid,text)'::regprocedure
  ) into v_delete_v2;
  select pg_get_functiondef(
    'public.gridex_contract_delete_dependency_graph_v2(uuid,uuid)'::regprocedure
  ) into v_graph_v2;
  select pg_get_functiondef(
    'public.gridex_close_contract_product(uuid,uuid,uuid,text)'::regprocedure
  ) into v_close;

  if position('coalesce(ch.valid_to,now())' in v_delete)=0
     or position('coalesce(cpv.valid_to,now())' in v_delete)=0 then
    raise exception 'final delete function does not contain qualified valid_to references';
  end if;
  if position('coalesce(ch.valid_to,now())' in v_close)=0
     or position('coalesce(cpv.valid_to,now())' in v_close)=0
     or position('coalesce(ta.valid_to,now())' in v_close)=0 then
    raise exception 'final close function does not contain qualified valid_to references';
  end if;
  if position('contract_lifecycle_backfill_issues' in v_delete)=0 then
    raise exception 'final delete function does not clean backfill diagnostics';
  end if;
  if position('pg_advisory_xact_lock' in v_delete_v2)=0
     or position('for update' in lower(v_delete_v2))=0
     or position('gridex_contract_delete_dependency_graph_v2' in v_delete_v2)=0
     or position('contract_delete_preview_stale' in v_delete_v2)=0 then
    raise exception 'final delete v2 function is missing lock, shared graph or stale-preview protection';
  end if;
  if position('gridex_preview_delete_unused_contract' in v_graph_v2)=0
     or position('dependency_classification' in v_graph_v2)=0 then
    raise exception 'final dependency graph v2 does not wrap and classify the canonical graph';
  end if;
  if has_function_privilege('authenticated','public.gridex_delete_unused_contract_v2(uuid,uuid,uuid,text)','EXECUTE')
     or has_function_privilege('authenticated','public.gridex_preview_delete_unused_contract_v2(uuid,uuid,uuid)','EXECUTE')
     or not has_function_privilege('service_role','public.gridex_delete_unused_contract_v2(uuid,uuid,uuid,text)','EXECUTE') then
    raise exception 'delete v2 grants are not service-role-only';
  end if;

  for r in
    select co.company_id,co.id
    from public.contract_offers co
    where co.lifecycle_status in ('draft','ready')
    order by co.company_id,co.id
  loop
    v_preview:=public.gridex_contract_delete_dependency_graph_v2(r.company_id,r.id);
    if not coalesce((v_preview->>'ok')::boolean,false) then
      raise exception 'delete preview failed for offer %: %',r.id,v_preview;
    end if;
  end loop;
end $$;

select
  count(*) filter(where lifecycle_status in ('draft','ready')) as previewed_draft_ready,
  count(*) filter(where lifecycle_status in ('closed','expired','archived','superseded')) as terminal_rows
from public.contract_offers;

