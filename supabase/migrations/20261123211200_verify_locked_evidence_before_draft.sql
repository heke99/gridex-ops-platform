DO $proof_migration$
DECLARE p record; next_body text;
 old_fragment constant text := $before_fragment$  v_result := public.gridex_create_invoice_export_graph_v1(p_run, p_items, p_invoices);$before_fragment$;
 new_fragment constant text := $after_fragment$  PERFORM gridex_locked_pricing_evidence.assert_draft(p_company_id,p_items,p_enrichment);

  v_result := public.gridex_create_invoice_export_graph_v1(p_run, p_items, p_invoices);$after_fragment$;
BEGIN
 SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
 INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('public.gridex_create_invoice_review_draft_v1(uuid,jsonb,jsonb,jsonb,jsonb)');
 IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
  OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>'eb9f0c4a8ba11c1406fbb126e42222af7abe05e5773b3b07dba9799d510d5da4'
  OR (length(p.prosrc)-length(replace(p.prosrc,old_fragment,'')))/length(old_fragment)<>1
 THEN RAISE EXCEPTION 'locked_pricing_evidence_predecessor_changed'; END IF;
 next_body:=replace(p.prosrc,old_fragment,new_fragment);
 EXECUTE replace(p.definition,p.prosrc,next_body);
 IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid)<>'1ad92aae797479e032d2c56e68e25dcd1aa2f6b18e8281c6012c2588def750cd'
 THEN RAISE EXCEPTION 'locked_pricing_evidence_metadata_changed'; END IF;
END
$proof_migration$;
