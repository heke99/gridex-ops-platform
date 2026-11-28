DO $migration$
BEGIN
ALTER TABLE public.invoice_export_files
 ADD COLUMN handoff_phase text NOT NULL DEFAULT 'legacy_unverified' CHECK(handoff_phase IN ('legacy_unverified','created')),
 ADD COLUMN handoff_recipient text CHECK(handoff_recipient ~ '^[A-Za-z0-9_-]{1,40}$');
DO $replace_body$
DECLARE p record; updated text;
 old_1 constant text := $old_1$  v_mirrors_ready boolean;$old_1$;
 new_1 constant text := $new_1$  v_mirrors_ready boolean;
  v_recipient text;$new_1$;
 old_2 constant text := $old_2$  INSERT INTO public.invoice_export_files (id, company_id, billing_month, environment, provider, row_count, total_inc_vat, rows, rows_sha256, created_by, created_at, artifact_archive_version)
  VALUES (v_file_id, p_company_id, p_billing_month, p_environment, c.invoice_export_target_system, cardinality(v_ids), v_total, p_rows, p_rows_sha256, p_actor_user_id, coalesce(p_created_at,now()),CASE WHEN p_provider IS NOT NULL THEN 2 END);

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    UPDATE public.invoice_export_items
       SET status = 'sent', export_file_id = v_file_id, provider_status = 'exported_to_file',
           sent_at = now(), next_retry_at = NULL, error_code = NULL, updated_at = now()
     WHERE company_id = p_company_id AND id = (r->>'invoice_export_item_id')::uuid;
    UPDATE public.customer_invoices
       SET status = 'sent', issued_at = (r->>'invoice_date')::date, due_date = (r->>'due_date')::date,
           partner_invoice_reference = CASE
             WHEN p_provider IS NULL AND cardinality(v_ids) = 1
               THEN coalesce(partner_invoice_reference, 'file:' || v_file_id::text)
             ELSE partner_invoice_reference
           END, updated_at = now()
     WHERE company_id = p_company_id AND invoice_export_item_id = (r->>'invoice_export_item_id')::uuid
       AND status = 'draft';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invoice_file_invoice_mirror_missing' USING ERRCODE = '40001';
    END IF;
  END LOOP;

  UPDATE public.invoice_export_runs run
     SET status = 'sent', sent_items = (SELECT count(*) FROM public.invoice_export_items i
                                         WHERE i.company_id = run.company_id AND i.export_run_id = run.id AND i.status = 'sent'),
         finished_at = now(), updated_at = now()
   WHERE run.company_id = p_company_id
     AND run.id IN (SELECT export_run_id FROM public.invoice_export_items WHERE company_id = p_company_id AND id = ANY (v_ids))
     AND NOT EXISTS (SELECT 1 FROM public.invoice_export_items i
                      WHERE i.company_id = run.company_id AND i.export_run_id = run.id AND i.status <> 'sent');

$old_2$;
 new_2 constant text := $new_2$  IF c.invoice_export_target_system = 'nordfin' THEN
    SELECT btrim(connection.settings->>'client_id') INTO v_recipient
    FROM public.billing_provider_connections connection
    WHERE connection.company_id=p_company_id AND connection.provider='nordfin'
      AND connection.environment=p_environment
    FOR SHARE;
    IF v_recipient IS NULL OR v_recipient !~ '^[A-Za-z0-9_-]{1,40}$' THEN
      RAISE EXCEPTION 'nordfin_client_id_missing' USING ERRCODE='22023';
    END IF;
    IF EXISTS (SELECT FROM jsonb_array_elements(p_rows) row_value
               WHERE row_value->>'nordfin_client_id' IS DISTINCT FROM v_recipient) THEN
      RAISE EXCEPTION 'invoice_file_recipient_changed' USING ERRCODE='40001';
    END IF;
  END IF;

  INSERT INTO public.invoice_export_files (id, company_id, billing_month, environment, provider, row_count, total_inc_vat, rows, rows_sha256, created_by, created_at, artifact_archive_version,handoff_phase,handoff_recipient)
  VALUES (v_file_id, p_company_id, p_billing_month, p_environment, c.invoice_export_target_system, cardinality(v_ids), v_total, p_rows, p_rows_sha256, p_actor_user_id, coalesce(p_created_at,now()),CASE WHEN p_provider IS NOT NULL THEN 2 END,'created',v_recipient);

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    UPDATE public.invoice_export_items
       SET export_file_id = v_file_id, provider_status = 'file_created',
           next_retry_at = NULL, error_code = NULL, updated_at = now()
     WHERE company_id = p_company_id AND id = (r->>'invoice_export_item_id')::uuid;
    UPDATE public.customer_invoices
       SET due_date = (r->>'due_date')::date, updated_at = now()
     WHERE company_id = p_company_id AND invoice_export_item_id = (r->>'invoice_export_item_id')::uuid
       AND status = 'draft';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invoice_file_invoice_mirror_missing' USING ERRCODE = '40001';
    END IF;
  END LOOP;

$new_2$;
BEGIN
 SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
 INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('gridex_invoice_file_archive.create_file(uuid,text,text,uuid,jsonb,text,uuid,timestamptz,text,jsonb)');
 IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
  OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>'312eadd256ab0237d8bfd25cd74b5306c9c0adab2f32b8aba85a6e14d95c9bef'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_predecessor_changed'; END IF;
 updated:=replace(replace(p.prosrc,old_1,new_1),old_2,new_2);
 EXECUTE replace(p.definition,p.prosrc,updated);
 IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid)<>'fb477fa6a6a4005bc04efcab7ba332baf142b92fe646ba371397300341232a8e'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_metadata_changed'; END IF;
END
$replace_body$;
DO $replace_body$
DECLARE p record; updated text;
 old_1 constant text := $old_1$    rows,rows_sha256,created_by,created_at,artifact_archive_version,preparation_kind)
 VALUES(new_file_id,p_company_id,p_billing_month,p_environment,'file_export',jsonb_array_length(rows_out),total,rows_out,
    file_rows_hash,p_actor_user_id,clock_text::timestamptz,2,'mixed_neutral_v1');$old_1$;
 new_1 constant text := $new_1$    rows,rows_sha256,created_by,created_at,artifact_archive_version,preparation_kind,handoff_phase)
 VALUES(new_file_id,p_company_id,p_billing_month,p_environment,'file_export',jsonb_array_length(rows_out),total,rows_out,
    file_rows_hash,p_actor_user_id,clock_text::timestamptz,2,'mixed_neutral_v1','created');$new_1$;
 old_2 constant text := $old_2$     UPDATE public.invoice_export_items SET export_file_id=new_file_id,updated_at=now()$old_2$;
 new_2 constant text := $new_2$     UPDATE public.invoice_export_items SET export_file_id=new_file_id,provider_status='file_created',updated_at=now()$new_2$;
BEGIN
 SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
 INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('public.gridex_prepare_mixed_invoice_month_file_v1(uuid,text,text,uuid,uuid,jsonb)');
 IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
  OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>'fefeb8a1c7551b53055696c74526467d15f9fa9699a2d6d04fb0db5f93ccafaa'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_predecessor_changed'; END IF;
 updated:=replace(replace(p.prosrc,old_1,new_1),old_2,new_2);
 EXECUTE replace(p.definition,p.prosrc,updated);
 IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid)<>'1ebebb286d6df55bd8079032e9a5e5a78f2f2ab0ca24c883d34c9ac179da204e'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_metadata_changed'; END IF;
END
$replace_body$;
DO $replace_body$
DECLARE p record; updated text;
 old_1 constant text := $old_1$ RETURN gridex_invoice_file_archive.create_file(p_company_id,p_billing_month,p_environment,p_actor_user_id,p_rows,p_rows_sha256,NULL,NULL,NULL,NULL);$old_1$;
 new_1 constant text := $new_1$ RAISE EXCEPTION 'invoice_file_v1_creation_retired' USING ERRCODE='55000';$new_1$;
BEGIN
 SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
 INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('public.gridex_create_invoice_export_file_v1(uuid,text,text,uuid,jsonb,text)');
 IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
  OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>'3370a6703cd084a396a2f9df5c018bd2197cde4ac85f81462558b1542b015613'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_predecessor_changed'; END IF;
 updated:=replace(p.prosrc,old_1,new_1);
 EXECUTE replace(p.definition,p.prosrc,updated);
 IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid)<>'a0037c83ccd5d7ea82a7df666e5100e457a475fd388cf5153cb6e44195d38fb8'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_metadata_changed'; END IF;
END
$replace_body$;
END
$migration$;
