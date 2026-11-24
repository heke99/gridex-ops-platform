DO $migration$
BEGIN
DO $replace_body$
DECLARE p record; updated text;
 old_1 constant text := $old_1$    insert into public.invoice_export_items($old_1$;
 new_1 constant text := $new_1$    BEGIN
      PERFORM gridex_case_confirmation.require_underlay_invoice_open_v1(v_company_id,v_underlay.id);
    EXCEPTION WHEN check_violation THEN
      IF SQLERRM <> 'invoice_file_contract_case_hold' THEN RAISE; END IF;
      RAISE EXCEPTION 'billing_underlay_contract_case_hold' USING ERRCODE='23514';
    END;

    insert into public.invoice_export_items($new_1$;
BEGIN
 SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
 INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('public.gridex_create_invoice_export_graph_v1_core(jsonb,jsonb,jsonb)');
 IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
  OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>'aa5e13cc4acaca36a54aaf3b77635def30afead613471fc837f817d9eaa27253'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_predecessor_changed'; END IF;
 updated:=replace(p.prosrc,old_1,new_1);
 EXECUTE replace(p.definition,p.prosrc,updated);
 IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid)<>'efd44be94cf4a0a2f3620d7de640f6ee368bb93cdd50fe4730111789f1798eda'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_metadata_changed'; END IF;
END
$replace_body$;
END
$migration$;
