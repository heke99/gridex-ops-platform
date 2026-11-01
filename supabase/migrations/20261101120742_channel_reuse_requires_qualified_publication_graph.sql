-- T2 / TERM01.05: a reused immutable publication must pass the same graph
-- gate as a newly finalized publication. Depends on the exact PR972 body.
-- No snapshot repair, alternate graph acceptance, or GEN output is performed.
BEGIN;
DO $reuse_graph_gate$
DECLARE
  f pg_catalog.pg_proc%ROWTYPE;
  before_metadata jsonb;
  body_hash text;
  definition text;
  new_body text;
  predecessor constant text := '75f75427fb307446b46ab34c8de5dc84f4fa552ba8f50ed8ba780e5d9c8cfb77';
  successor constant text := '07d53d270bceab612c0acf5b3b722e85302b660703a843143b8ce6687c7ea049';
  declaration_anchor constant text := $decl$  v_ended_version_id uuid;$decl$;
  declaration_patch constant text := $decl$  v_ended_version_id uuid;
  v_reuse_blockers text[];$decl$;
  gate_anchor constant text := $gate$  if not v_reused then
    perform public.gridex_finalize_contract_publication_v1(
      v_publication_version_id,p_actor_user_id,true
    );
  end if;$gate$;
  gate_patch constant text := $gate$  if v_reused then
    -- Reuse preserves frozen terms but must retain the ordinary graph gate.
    v_reuse_blockers:=public.gridex_validate_publication_graph_v1(v_publication_version_id);
    if cardinality(v_reuse_blockers)>0 then
      raise exception using errcode='23514',
        message=coalesce(v_reuse_blockers[1],'PUBLICATION_SNAPSHOT_INVALID'),
        detail=to_jsonb(v_reuse_blockers)::text;
    end if;
  else
    perform public.gridex_finalize_contract_publication_v1(
      v_publication_version_id,p_actor_user_id,true
    );
  end if;$gate$;
BEGIN
  SELECT p.* INTO f FROM pg_catalog.pg_proc p
  WHERE p.oid=pg_catalog.to_regprocedure('public.gridex_publish_contract_channel(uuid,uuid,text,uuid)');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'channel_reuse_graph_gate_function_missing' USING ERRCODE='55000';
  END IF;
  body_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(f.prosrc,'UTF8')),'hex');
  IF body_hash NOT IN (predecessor,successor) THEN
    RAISE EXCEPTION 'channel_reuse_graph_gate_predecessor_required:%',body_hash USING ERRCODE='55000';
  END IF;
  IF NOT f.prosecdef
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=public, extensions, pg_temp']
    OR f.prorettype<>'jsonb'::regtype OR f.prokind<>'f' OR f.proretset
    OR f.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') THEN
    RAISE EXCEPTION 'channel_reuse_graph_gate_metadata_changed' USING ERRCODE='55000';
  END IF;
  before_metadata:=pg_catalog.to_jsonb(f)-'prosrc';
  IF body_hash=predecessor THEN
    IF (length(f.prosrc)-length(replace(f.prosrc,declaration_anchor,'')))<>length(declaration_anchor)
      OR (length(f.prosrc)-length(replace(f.prosrc,gate_anchor,'')))<>length(gate_anchor) THEN
      RAISE EXCEPTION 'channel_reuse_graph_gate_anchor_changed' USING ERRCODE='55000';
    END IF;
    new_body:=replace(replace(f.prosrc,declaration_anchor,declaration_patch),gate_anchor,gate_patch);
    definition:=pg_catalog.pg_get_functiondef(f.oid);
    IF (length(definition)-length(replace(definition,f.prosrc,'')))<>length(f.prosrc) THEN
      RAISE EXCEPTION 'channel_reuse_graph_gate_definition_changed' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(definition,f.prosrc,new_body);
  END IF;
  SELECT p.* INTO STRICT f FROM pg_catalog.pg_proc p WHERE p.oid=f.oid;
  IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(f.prosrc,'UTF8')),'hex')<>successor
    OR pg_catalog.to_jsonb(f)-'prosrc' IS DISTINCT FROM before_metadata THEN
    RAISE EXCEPTION 'channel_reuse_graph_gate_postcheck_failed' USING ERRCODE='55000';
  END IF;
END
$reuse_graph_gate$;
COMMIT;
