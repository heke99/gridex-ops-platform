DO $migration$
BEGIN
DO $replace_body$
DECLARE p record; updated text;
 old_1 constant text := $old_1$  ELSE
    INSERT INTO gridex_invoice_groups.neutral_files$old_1$;
 new_1 constant text := $new_1$  ELSE
    PERFORM FROM public.companies WHERE id=p_company_id FOR SHARE NOWAIT;
    PERFORM gridex_case_confirmation.require_group_invoice_open_v1(p_company_id,p_invoice_id);
    INSERT INTO gridex_invoice_groups.neutral_files$new_1$;
BEGIN
 SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
 INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('public.gridex_create_consolidated_invoice_neutral_file_v1(uuid,uuid,uuid,text)');
 IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
  OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>'f6065eb0af4a97b4837db4f62330dbee350f3f78c8609fb9fe623fee38d1cae1'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_predecessor_changed'; END IF;
 updated:=replace(p.prosrc,old_1,new_1);
 EXECUTE replace(p.definition,p.prosrc,updated);
 IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid)<>'96075633444adb021b9d45eb90bd1ad460ca939cd564b531c5228fc037acbad1'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_metadata_changed'; END IF;
END
$replace_body$;
DO $replace_body$
DECLARE p record; updated text;
 old_1 constant text := $old_1$    IF previous.invoice_id IS NULL THEN
      SELECT s.evidence_count$old_1$;
 new_1 constant text := $new_1$    IF previous.invoice_id IS NULL THEN
      PERFORM gridex_case_confirmation.require_underlay_invoice_open_v1(p_company_id,underlay.id);
      SELECT s.evidence_count$new_1$;
BEGIN
 SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
 INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('public.gridex_prepare_consolidated_invoice_v1(uuid,uuid,text,text,text,uuid,jsonb)');
 IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
  OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>'dd48559eac347297aabed57fe40449758429bdcd1cb095c3e6253c4c48d6ce24'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_predecessor_changed'; END IF;
 updated:=replace(p.prosrc,old_1,new_1);
 EXECUTE replace(p.definition,p.prosrc,updated);
 IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid)<>'5fda96620db8d6e7588c0614e4d21183609d9581c32de91a3efc61a7f5b3c24c'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_metadata_changed'; END IF;
END
$replace_body$;
DO $replace_body$
DECLARE p record; updated text;
 old_1 constant text := $old_1$ INSERT INTO gridex_invoice_groups.approvals(company_id,invoice_id,review_hash,approved_by)$old_1$;
 new_1 constant text := $new_1$ PERFORM gridex_case_confirmation.require_group_invoice_open_v1(p_company_id,p_invoice_id);
 INSERT INTO gridex_invoice_groups.approvals(company_id,invoice_id,review_hash,approved_by)$new_1$;
BEGIN
 SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
 INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('public.gridex_approve_consolidated_invoice_draft_v1(uuid,uuid,uuid,text)');
 IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
  OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>'7df2845dbd89e880947ce17668d00744964fc8f8267939fe0d814f58eac8288b'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_predecessor_changed'; END IF;
 updated:=replace(p.prosrc,old_1,new_1);
 EXECUTE replace(p.definition,p.prosrc,updated);
 IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid)<>'0817d9028cf8d8239cbdb50aa13ec7508eb21ed66b510e64a5fe5fab9791c730'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_metadata_changed'; END IF;
END
$replace_body$;
DO $replace_body$
DECLARE p record; updated text;
 old_1 constant text := $old_1$    PERFORM 1 FROM public.company_number_sequences s WHERE s.company_id=p_company_id AND s.sequence_key=series$old_1$;
 new_1 constant text := $new_1$    PERFORM gridex_case_confirmation.require_group_invoice_open_v1(p_company_id,p_invoice_id);
    PERFORM 1 FROM public.company_number_sequences s WHERE s.company_id=p_company_id AND s.sequence_key=series$new_1$;
BEGIN
 SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
 INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('public.gridex_finish_consolidated_invoice_v1(uuid,uuid,uuid,text,text,text)');
 IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
  OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>'9a36c316da75aecb5f459bb3b953fc75dcf81e59d033f1db5779ee2146c2c94e'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_predecessor_changed'; END IF;
 updated:=replace(p.prosrc,old_1,new_1);
 EXECUTE replace(p.definition,p.prosrc,updated);
 IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid)<>'0cc41d5e737876e59a74eed2d58d6a736d1a77e29c7ba65e205c74b539d26011'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_metadata_changed'; END IF;
END
$replace_body$;
END
$migration$;
