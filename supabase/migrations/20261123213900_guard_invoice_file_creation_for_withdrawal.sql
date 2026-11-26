DO $migration$
BEGIN
DO $replace_body$
DECLARE p record; updated text;
 old_1 constant text := $old_1$  SELECT coalesce(sum((x->>'amount_inc_vat')::numeric), 0) INTO v_total FROM jsonb_array_elements(p_rows) x;$old_1$;
 new_1 constant text := $new_1$  PERFORM gridex_case_confirmation.require_underlay_invoice_open_v1(p_company_id,i.billing_underlay_id)
    FROM public.invoice_export_items i WHERE i.company_id=p_company_id AND i.id=ANY(v_ids);

  SELECT coalesce(sum((x->>'amount_inc_vat')::numeric), 0) INTO v_total FROM jsonb_array_elements(p_rows) x;$new_1$;
BEGIN
 SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
 INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('gridex_invoice_file_archive.create_file(uuid,text,text,uuid,jsonb,text,uuid,timestamptz,text,jsonb)');
 IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
  OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>'328516a4084e020ae1368bd5ab0a8258ce5543be590f66ba10039da3983f107e'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_predecessor_changed'; END IF;
 updated:=replace(p.prosrc,old_1,new_1);
 EXECUTE replace(p.definition,p.prosrc,updated);
 IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid)<>'312eadd256ab0237d8bfd25cd74b5306c9c0adab2f32b8aba85a6e14d95c9bef'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_metadata_changed'; END IF;
END
$replace_body$;
DO $replace_body$
DECLARE p record; updated text;
 old_1 constant text := $old_1$     group_copy:=gridex_invoice_groups.verified_neutral_file_source(p_company_id,draft.invoice_id,chosen->>'reviewHash');$old_1$;
 new_1 constant text := $new_1$     PERFORM gridex_case_confirmation.require_group_invoice_open_v1(p_company_id,draft.invoice_id);
     group_copy:=gridex_invoice_groups.verified_neutral_file_source(p_company_id,draft.invoice_id,chosen->>'reviewHash');$new_1$;
 old_2 constant text := $old_2$     PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company_id,item.billing_underlay_id,item.invoice_id);$old_2$;
 new_2 constant text := $new_2$     PERFORM gridex_case_confirmation.require_underlay_invoice_open_v1(p_company_id,item.billing_underlay_id);
     PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company_id,item.billing_underlay_id,item.invoice_id);$new_2$;
BEGIN
 SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
 INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('public.gridex_prepare_mixed_invoice_month_file_v1(uuid,text,text,uuid,uuid,jsonb)');
 IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
  OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>'ac135ab2c0d477b07be5923baa8129505b12ebdcab56ea67399a0618b612be19'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_predecessor_changed'; END IF;
 updated:=replace(replace(p.prosrc,old_1,new_1),old_2,new_2);
 EXECUTE replace(p.definition,p.prosrc,updated);
 IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid)<>'fefeb8a1c7551b53055696c74526467d15f9fa9699a2d6d04fb0db5f93ccafaa'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_metadata_changed'; END IF;
END
$replace_body$;
END
$migration$;
