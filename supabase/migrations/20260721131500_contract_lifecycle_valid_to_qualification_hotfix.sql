-- Gridex OPS: qualify lifecycle valid_to references in UPDATE ... FROM statements.
-- PostgreSQL raises 42702 when both the update target and joined relation expose
-- valid_to and the expression uses an unqualified column reference.

begin;

create or replace function pg_temp.gridex_replace_function_fragment(
  p_signature text,
  p_old_fragment text,
  p_new_fragment text
) returns void
language plpgsql
as $$
declare
  v_oid oid;
  v_definition text;
  v_updated_definition text;
begin
  v_oid:=to_regprocedure(p_signature);
  if v_oid is null then
    raise exception using
      errcode='42883',
      message='required_contract_lifecycle_function_missing',
      detail=p_signature;
  end if;

  select pg_get_functiondef(v_oid) into v_definition;
  if position(p_old_fragment in v_definition)=0 then
    raise exception using
      errcode='P0001',
      message='contract_lifecycle_hotfix_fragment_not_found',
      detail=p_signature||' :: '||p_old_fragment;
  end if;

  v_updated_definition:=replace(v_definition,p_old_fragment,p_new_fragment);
  if v_updated_definition=v_definition then
    raise exception using
      errcode='P0001',
      message='contract_lifecycle_hotfix_no_change',
      detail=p_signature;
  end if;

  execute v_updated_definition;
end $$;

-- Canonical synchronization: tenant_contract_channels and
-- tenant_contract_assignments both expose valid_to.
select pg_temp.gridex_replace_function_fragment(
  'public.gridex_sync_internal_offer_to_canonical(uuid)',
  'set status=''ended'',valid_to=coalesce(valid_to,now()),updated_at=now()',
  'set status=''ended'',valid_to=coalesce(ch.valid_to,now()),updated_at=now()'
);

-- Channel publication: qualify both the old channel and its immutable
-- publication-version target.
select pg_temp.gridex_replace_function_fragment(
  'public.gridex_publish_contract_channel(uuid,uuid,text,uuid)',
  'set status=''ended'',valid_to=coalesce(valid_to,now()),updated_at=now()',
  'set status=''ended'',valid_to=coalesce(old_channel.valid_to,now()),updated_at=now()'
);
select pg_temp.gridex_replace_function_fragment(
  'public.gridex_publish_contract_channel(uuid,uuid,text,uuid)',
  'set status=''ended'',valid_to=coalesce(valid_to,now())',
  'set status=''ended'',valid_to=coalesce(old_publication_version.valid_to,now())'
);

-- Channel unpublish and pause: contract_publications and assignments are joined
-- while the target publication version also has valid_to.
select pg_temp.gridex_replace_function_fragment(
  'public.gridex_unpublish_contract_channel(uuid,uuid,text,uuid)',
  'set status=''ended'',valid_to=coalesce(valid_to,now())',
  'set status=''ended'',valid_to=coalesce(pv.valid_to,now())'
);
select pg_temp.gridex_replace_function_fragment(
  'public.gridex_pause_contract_channels(uuid,uuid,uuid)',
  'set status=''ended'',valid_to=coalesce(valid_to,now())',
  'set status=''ended'',valid_to=coalesce(pv.valid_to,now())'
);

-- Archive: qualify channel, publication-version and assignment targets.
select pg_temp.gridex_replace_function_fragment(
  'public.gridex_archive_contract_product(uuid,uuid,uuid)',
  'set status=''ended'',valid_to=coalesce(valid_to,now()),updated_by=p_actor_user_id,updated_at=now()',
  'set status=''ended'',valid_to=coalesce(ch.valid_to,now()),updated_by=p_actor_user_id,updated_at=now()'
);
select pg_temp.gridex_replace_function_fragment(
  'public.gridex_archive_contract_product(uuid,uuid,uuid)',
  'valid_to=coalesce(valid_to,now())',
  'valid_to=coalesce(pv.valid_to,now())'
);
select pg_temp.gridex_replace_function_fragment(
  'public.gridex_archive_contract_product(uuid,uuid,uuid)',
  'set status=''ended'',valid_to=coalesce(valid_to,current_date),updated_at=now()',
  'set status=''ended'',valid_to=coalesce(ta.valid_to,current_date),updated_at=now()'
);

-- Verify the exact repaired function sources before committing.
do $$
declare
  v_sync text:=pg_get_functiondef('public.gridex_sync_internal_offer_to_canonical(uuid)'::regprocedure);
  v_publish text:=pg_get_functiondef('public.gridex_publish_contract_channel(uuid,uuid,text,uuid)'::regprocedure);
  v_unpublish text:=pg_get_functiondef('public.gridex_unpublish_contract_channel(uuid,uuid,text,uuid)'::regprocedure);
  v_pause text:=pg_get_functiondef('public.gridex_pause_contract_channels(uuid,uuid,uuid)'::regprocedure);
  v_archive text:=pg_get_functiondef('public.gridex_archive_contract_product(uuid,uuid,uuid)'::regprocedure);
begin
  if position('coalesce(ch.valid_to,now())' in v_sync)=0 then
    raise exception 'canonical_sync_valid_to_hotfix_not_installed';
  end if;
  if position('coalesce(old_channel.valid_to,now())' in v_publish)=0
     or position('coalesce(old_publication_version.valid_to,now())' in v_publish)=0 then
    raise exception 'publish_valid_to_hotfix_not_installed';
  end if;
  if position('coalesce(pv.valid_to,now())' in v_unpublish)=0 then
    raise exception 'unpublish_valid_to_hotfix_not_installed';
  end if;
  if position('coalesce(pv.valid_to,now())' in v_pause)=0 then
    raise exception 'pause_valid_to_hotfix_not_installed';
  end if;
  if position('coalesce(ch.valid_to,now())' in v_archive)=0
     or position('coalesce(pv.valid_to,now())' in v_archive)=0
     or position('coalesce(ta.valid_to,current_date)' in v_archive)=0 then
    raise exception 'archive_valid_to_hotfix_not_installed';
  end if;
end $$;

commit;

-- Retry the idempotent backfill after function replacement. Previously open
-- CANONICAL_SYNC_FAILED rows are marked resolved at the start and reopened only
-- if a real error remains.
do $$
declare
  v_result jsonb;
begin
  v_result:=public.gridex_backfill_contract_lifecycle(null);
  raise notice 'gridex_backfill_contract_lifecycle after valid_to hotfix: %',v_result;
end $$;
