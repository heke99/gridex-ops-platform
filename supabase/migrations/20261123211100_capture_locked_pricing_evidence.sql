DO $proof_migration$
DECLARE p record; next_body text;
 old_fragment constant text := $before_fragment$  if v_final_status='success' then
    update public.pricing_runs set status='superseded'$before_fragment$;
 new_fragment constant text := $after_fragment$  if v_final_status='success' then
    perform gridex_locked_pricing_evidence.capture(p_company_id,p_billing_underlay_id,v_run_id,
      CASE WHEN v_current_snapshot IS NULL THEN ARRAY[]::uuid[] ELSE
        ARRAY(SELECT (item->>'id')::uuid FROM jsonb_array_elements(v_current_snapshot->'items') item) END);
    update public.pricing_runs set status='superseded'$after_fragment$;
BEGIN
 SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
 INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)');
 IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
  OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>'bce60486b4f1c94253d9ce4a444f6277babcbfb3ed106815aff8299f6dd96c95'
  OR (length(p.prosrc)-length(replace(p.prosrc,old_fragment,'')))/length(old_fragment)<>1
 THEN RAISE EXCEPTION 'locked_pricing_evidence_predecessor_changed'; END IF;
 next_body:=replace(p.prosrc,old_fragment,new_fragment);
 EXECUTE replace(p.definition,p.prosrc,next_body);
 IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid)<>'2c865218e959eca902e7c0ad54e73915537b1845679ff432c91b4f2cfd01882a'
 THEN RAISE EXCEPTION 'locked_pricing_evidence_metadata_changed'; END IF;
END
$proof_migration$;
