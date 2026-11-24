DO $migration$
BEGIN
DO $replace_body$
DECLARE p record; updated text;
 old_1 constant text := $old_1$ INSERT INTO gridex_invoice_file_archive.period_reconciliations(company_id,file_id,billing_month,actor_id,expected_period)
 VALUES(NEW.company_id,NEW.id,NEW.billing_month,NEW.created_by,v_expected);$old_1$;
 new_1 constant text := $new_1$ INSERT INTO gridex_invoice_file_archive.period_reconciliations(company_id,file_id,billing_month,actor_id,expected_period,reason)
 VALUES(NEW.company_id,NEW.id,NEW.billing_month,NEW.created_by,v_expected,
   CASE WHEN NEW.handoff_phase='created' THEN 'awaiting_verified_handoff' ELSE NULL END);$new_1$;
BEGIN
 SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
 INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('gridex_invoice_file_archive.queue_period_reconciliation()');
 IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
  OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>'7005abd968aa5c382f2919437f3ca5aa10e6b143a3b83a35cb5b9f8238d3a65f'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_predecessor_changed'; END IF;
 updated:=replace(p.prosrc,old_1,new_1);
 EXECUTE replace(p.definition,p.prosrc,updated);
 IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid)<>'dfa5274c2d8af00def4e5c648ba2a29c3a8d664188efa221d56d3d37156adf92'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_metadata_changed'; END IF;
END
$replace_body$;
DO $replace_body$
DECLARE p record; updated text;
 old_1 constant text := $old_1$ IF NOT FOUND THEN RETURN NULL; END IF;
 IF v_job.status$old_1$;
 new_1 constant text := $new_1$ IF NOT FOUND THEN RETURN NULL; END IF;
 IF EXISTS (SELECT FROM public.invoice_export_files f WHERE f.company_id=p_company_id AND f.id=p_file_id AND f.handoff_phase='created') THEN
  RETURN public.gridex_read_invoice_export_period_reconciliation_v1(p_company_id,p_file_id);
 END IF;
 IF v_job.status$new_1$;
BEGIN
 SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
 INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('public.gridex_reconcile_invoice_export_period_v1(uuid,uuid)');
 IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
  OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>'7c70f393655466acea565ae8c970fec50ca1cb72eab1b08bf65ed37dd9a81160'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_predecessor_changed'; END IF;
 updated:=replace(p.prosrc,old_1,new_1);
 EXECUTE replace(p.definition,p.prosrc,updated);
 IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid)<>'ae85886806847669dc8841def101bbfd63c1251012af34668d38a5ae46f12dc7'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_metadata_changed'; END IF;
END
$replace_body$;
DO $replace_body$
DECLARE p record; updated text;
 old_1 constant text := $old_1$ WHERE j.status IN ('pending','incomplete')$old_1$;
 new_1 constant text := $new_1$ JOIN public.invoice_export_files f ON f.company_id=j.company_id AND f.id=j.file_id
 WHERE f.handoff_phase='legacy_unverified' AND j.status IN ('pending','incomplete')$new_1$;
BEGIN
 SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
 INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('public.gridex_list_due_invoice_export_period_reconciliations_v1(integer)');
 IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
  OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>'146ce2ed6e25c9e28c1011927ec34c9c2ca03a19d343bf8b82c4e1f768bf0a73'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_predecessor_changed'; END IF;
 updated:=replace(p.prosrc,old_1,new_1);
 EXECUTE replace(p.definition,p.prosrc,updated);
 IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid)<>'60f05c4b77dbda9a7ec2847719abc3b3b8fbfa7aade735553aebfa97be3a1626'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_metadata_changed'; END IF;
END
$replace_body$;
DO $replace_body$
DECLARE p record; updated text;
 old_1 constant text := $old_1$ INSERT INTO gridex_invoice_file_archive.legacy_projection_jobs(company_id,file_id) VALUES(NEW.company_id,NEW.file_id);$old_1$;
 new_1 constant text := $new_1$ IF v_file.handoff_phase='created' THEN RETURN NEW; END IF;
 INSERT INTO gridex_invoice_file_archive.legacy_projection_jobs(company_id,file_id) VALUES(NEW.company_id,NEW.file_id);$new_1$;
BEGIN
 SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
 INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('gridex_invoice_file_archive.queue_file_effects()');
 IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
  OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>'c336a3c1c9d57a019290c72fa3087134b3f66ff9ff99493a75b04af63985b195'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_predecessor_changed'; END IF;
 updated:=replace(p.prosrc,old_1,new_1);
 EXECUTE replace(p.definition,p.prosrc,updated);
 IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid)<>'b10423923074c42f9df69d2c15a5e067f099e792b746cc1acc3eca336f1273e7'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_metadata_changed'; END IF;
END
$replace_body$;
END
$migration$;
