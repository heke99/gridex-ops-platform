DO $migration$
BEGIN
DO $replace_body$
DECLARE p record; updated text;
 old_1 constant text := $old_1$    IF v_mirrors_ready IS NOT TRUE THEN
      RAISE EXCEPTION 'invoice_file_mirror_approval_changed' USING ERRCODE='40001';
    END IF;$old_1$;
 new_1 constant text := $new_1$    IF v_mirrors_ready IS NOT TRUE THEN
      RAISE EXCEPTION 'invoice_file_mirror_approval_changed' USING ERRCODE='40001';
    END IF;
    -- The mirror rows above remain locked until the frozen archive commits.
    IF p_provider='file_export' AND EXISTS (
      SELECT FROM jsonb_array_elements(p_rows) row_data
      JOIN public.customer_invoices m ON m.company_id=p_company_id
        AND m.invoice_export_item_id=(row_data->>'invoice_export_item_id')::uuid
      WHERE jsonb_typeof(row_data->'invoice_reference') IS DISTINCT FROM 'string'
        OR nullif(btrim(m.invoice_reference),'') IS NULL
        OR row_data->>'invoice_reference' IS DISTINCT FROM btrim(m.invoice_reference)
        OR jsonb_typeof(row_data->'invoice_number') IS DISTINCT FROM
          (CASE WHEN nullif(btrim(m.invoice_number),'') IS NULL THEN 'null' ELSE 'string' END)
        OR row_data->>'invoice_number' IS DISTINCT FROM nullif(btrim(m.invoice_number),'')
    ) THEN
      RAISE EXCEPTION 'invoice_file_selection_changed' USING ERRCODE='23514';
    END IF;$new_1$;
BEGIN
 SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
 INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('gridex_invoice_file_archive.create_file(uuid,text,text,uuid,jsonb,text,uuid,timestamptz,text,jsonb)');
 IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
  OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>'fb477fa6a6a4005bc04efcab7ba332baf142b92fe646ba371397300341232a8e'
 THEN RAISE EXCEPTION 'neutral_invoice_reference_preimage_required'; END IF;
 updated:=replace(p.prosrc,old_1,new_1);
 EXECUTE replace(p.definition,p.prosrc,updated);
 IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid)<>'5314681ded9ea8c8eba0aa7ead6ef0c85351f35c800d39a92c2f2313b246e658'
 THEN RAISE EXCEPTION 'neutral_invoice_reference_metadata_changed'; END IF;
END
$replace_body$;
DO $replace_body$
DECLARE p record; updated text;
 old_1 constant text := $old_1$  IF v_entry->>'fileName' IS DISTINCT FROM v_name OR v_entry->>'contentType' IS DISTINCT FROM v_type$old_1$;
 new_1 constant text := $new_1$  IF p_provider='file_export' AND v_entry->>'rendererVersion' IS DISTINCT FROM 'gridex_neutral_invoice_file_bytes_v2' THEN
   RAISE EXCEPTION 'invoice_file_selection_changed' USING ERRCODE='23514';
  END IF;
  IF v_entry->>'fileName' IS DISTINCT FROM v_name OR v_entry->>'contentType' IS DISTINCT FROM v_type$new_1$;
 old_2 constant text := $old_2$      OR v_decoded->'invoices' IS DISTINCT FROM p_rows)) THEN$old_2$;
 new_2 constant text := $new_2$      OR (p_provider='file_export' AND v_decoded->>'renderer_version' IS DISTINCT FROM v_entry->>'rendererVersion')
      OR v_decoded->'invoices' IS DISTINCT FROM p_rows)) THEN$new_2$;
BEGIN
 SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
 INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('public.gridex_write_invoice_file_intent_v2(uuid,text,text,uuid,jsonb,text,uuid,text,uuid,text,jsonb,jsonb)');
 IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
  OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>'977f2cdb9dcce4be9aa5852dd68044f6992ccc41338f379635b87cfcb7fd6a1c'
 THEN RAISE EXCEPTION 'neutral_invoice_reference_preimage_required'; END IF;
 updated:=replace(replace(p.prosrc,old_1,new_1),old_2,new_2);
 EXECUTE replace(p.definition,p.prosrc,updated);
 IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid)<>'59e049c26c1f1ddfcb4a38215eef35eed3c6039c3f4c994af700919d7f265c46'
 THEN RAISE EXCEPTION 'neutral_invoice_reference_metadata_changed'; END IF;
END
$replace_body$;
END
$migration$;
