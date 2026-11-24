DO $gridex_invoice_migration$
BEGIN
DO $invoice_file_preflight$
BEGIN
 IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.gridex_create_invoice_export_file_v1(uuid,text,text,uuid,jsonb,text)'::regprocedure)
  IS DISTINCT FROM '533f8c25c8d918a1b6226625dd4cc73c' THEN
  RAISE EXCEPTION 'unexpected invoice file native writer body';
 END IF;
END
$invoice_file_preflight$;
ALTER TABLE public.invoice_export_files ADD COLUMN artifact_archive_version smallint CHECK(artifact_archive_version=2);
CREATE SCHEMA gridex_invoice_file_archive;
REVOKE ALL ON SCHEMA gridex_invoice_file_archive FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_invoice_file_archive.receipts (
 company_id uuid NOT NULL,
 actor_user_id uuid NOT NULL,
 intent_id uuid NOT NULL,
 file_id uuid NOT NULL,
 created_at_wire text NOT NULL,
 selection jsonb NOT NULL,
 manifest jsonb NOT NULL,
 PRIMARY KEY(company_id,actor_user_id,intent_id),
 UNIQUE(company_id,file_id),
 FOREIGN KEY(company_id,file_id) REFERENCES public.invoice_export_files(company_id,id)
);
CREATE TABLE gridex_invoice_file_archive.artifacts (
 company_id uuid NOT NULL,
 file_id uuid NOT NULL,
 format text NOT NULL CHECK(format IN ('csv','xlsx','json','nordfin_xml')),
 file_name text NOT NULL,
 content_type text NOT NULL,
 renderer_version text NOT NULL,
 byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 16777216),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 body bytea NOT NULL,
 CHECK(octet_length(body)=byte_length),
 CHECK(encode(sha256(body),'hex')=sha256),
 PRIMARY KEY(company_id,file_id,format),
 FOREIGN KEY(company_id,file_id) REFERENCES gridex_invoice_file_archive.receipts(company_id,file_id)
);
ALTER TABLE gridex_invoice_file_archive.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_invoice_file_archive.artifacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gridex_invoice_file_archive.receipts,gridex_invoice_file_archive.artifacts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_invoice_file_archive.deny_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog
AS $archive_immutable$
BEGIN
 RAISE EXCEPTION 'invoice_file_archive_append_only' USING ERRCODE='42501';
END
$archive_immutable$;
REVOKE ALL ON FUNCTION gridex_invoice_file_archive.deny_mutation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER invoice_file_receipt_append_only BEFORE UPDATE OR DELETE ON gridex_invoice_file_archive.receipts
 FOR EACH ROW EXECUTE FUNCTION gridex_invoice_file_archive.deny_mutation();
CREATE TRIGGER invoice_file_artifact_append_only BEFORE UPDATE OR DELETE ON gridex_invoice_file_archive.artifacts
 FOR EACH ROW EXECUTE FUNCTION gridex_invoice_file_archive.deny_mutation();
CREATE FUNCTION gridex_invoice_file_archive.create_file(p_company_id uuid, p_billing_month text, p_environment text, p_actor_user_id uuid, p_rows jsonb, p_rows_sha256 text, p_file_id uuid, p_created_at timestamptz, p_provider text, p_selection jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  c record;
  v_ids uuid[];
  v_locked integer;
  v_file_id uuid := coalesce(p_file_id,gen_random_uuid());
  v_selection jsonb;
  v_mirror_count integer;
  v_mirrors_ready boolean;
  v_total numeric;
  r jsonb;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'invoice_file_actor_required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'invoice_file_empty' USING ERRCODE = '22023';
  END IF;

  IF p_provider IS NOT NULL THEN
    BEGIN
      -- Reserve final relation modes first; existing retention reads SHARE
      -- before obtaining invoice/item row locks.
      LOCK TABLE public.customer_invoices,public.invoice_export_items IN ROW EXCLUSIVE MODE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN
      RAISE EXCEPTION 'invoice_file_finance_lock_busy' USING ERRCODE='55P03';
    END;
  END IF;

  SELECT invoice_export_target_system, billing_provider_environment, invoice_export_enabled
    INTO c FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'company_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF c.invoice_export_target_system IS NULL
     OR c.invoice_export_target_system NOT IN ('file_export', 'nordfin')
     OR c.billing_provider_environment IS DISTINCT FROM p_environment
     OR c.invoice_export_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'invoice_file_provider_not_active' USING ERRCODE = '55000';
  END IF;

  IF p_provider IS NOT NULL THEN
    IF c.invoice_export_target_system IS DISTINCT FROM p_provider THEN
      RAISE EXCEPTION 'invoice_file_provider_not_active' USING ERRCODE='55000';
    END IF;
    SELECT jsonb_agg(jsonb_build_object('itemId',item.id,'reviewHash',item.metadata->'approval'->>'review_hash',
       'approvedAt',item.metadata->'approval'->>'approved_at','approvedBy',item.metadata->'approval'->>'approved_by') ORDER BY item.id)
      INTO v_selection
      FROM (
       SELECT i.id,i.metadata FROM public.invoice_export_items i
       JOIN public.invoice_export_runs run ON run.id=i.export_run_id AND run.company_id=i.company_id
       WHERE i.company_id=p_company_id AND i.status='pending' AND i.export_file_id IS NULL
        AND i.metadata->'approval'->>'status'='approved'
        AND i.id IN (SELECT (x->>'itemId')::uuid FROM jsonb_array_elements(p_selection) x)
        AND i.provider=p_provider AND i.environment=p_environment
        AND run.provider=p_provider AND run.environment=p_environment AND run.billing_month=p_billing_month
       ORDER BY i.id FOR UPDATE OF i
      ) item;
    IF v_selection IS DISTINCT FROM p_selection OR
       (SELECT array_agg((x->>'invoice_export_item_id')::uuid ORDER BY (x->>'invoice_export_item_id')::uuid) FROM jsonb_array_elements(p_rows) x)
       IS DISTINCT FROM (SELECT array_agg((x->>'itemId')::uuid ORDER BY (x->>'itemId')::uuid) FROM jsonb_array_elements(p_selection) x) THEN
      RAISE EXCEPTION 'invoice_file_selection_changed' USING ERRCODE='40001';
    END IF;
    SELECT count(*),bool_and(COALESCE(
      locked.invoice_approval = locked.item_approval
      AND locked.calculation_snapshot_sha256 ~ '^[0-9a-f]{64}$'
      AND locked.invoice_approval->>'calculation_snapshot_sha256'=locked.calculation_snapshot_sha256,
      false)) INTO v_mirror_count,v_mirrors_ready
    FROM (
      SELECT m.metadata->'approval' invoice_approval,i.metadata->'approval' item_approval,m.calculation_snapshot_sha256
      FROM public.invoice_export_items i
      JOIN public.customer_invoices m ON m.company_id=i.company_id AND m.invoice_export_item_id=i.id
      WHERE i.company_id=p_company_id AND m.status='draft'
      AND i.id IN (SELECT (x->>'itemId')::uuid FROM jsonb_array_elements(p_selection) x)
      ORDER BY i.id FOR UPDATE OF m
    ) locked;
    IF v_mirror_count<>jsonb_array_length(p_selection) THEN
      RAISE EXCEPTION 'invoice_file_invoice_mirror_missing' USING ERRCODE='40001';
    END IF;
    IF v_mirrors_ready IS NOT TRUE THEN
      RAISE EXCEPTION 'invoice_file_mirror_approval_changed' USING ERRCODE='40001';
    END IF;
  END IF;

  SELECT array_agg((x->>'invoice_export_item_id')::uuid) INTO v_ids FROM jsonb_array_elements(p_rows) x;
  IF v_ids IS NULL OR cardinality(v_ids) <> (SELECT count(DISTINCT u) FROM unnest(v_ids) u) THEN
    RAISE EXCEPTION 'invoice_file_rows_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_locked FROM (
    SELECT i.id FROM public.invoice_export_items i
      JOIN public.invoice_export_runs run ON run.id = i.export_run_id AND run.company_id = i.company_id
     WHERE i.company_id = p_company_id
       AND i.id = ANY (v_ids)
       AND i.status = 'pending'
       AND i.export_file_id IS NULL
       AND i.metadata->'approval'->>'status' = 'approved'
       AND run.provider = c.invoice_export_target_system
       AND run.environment = p_environment
       AND run.billing_month = p_billing_month
     FOR UPDATE OF i
  ) locked;
  IF v_locked <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'invoice_file_items_changed' USING ERRCODE = '40001';
  END IF;

  SELECT coalesce(sum((x->>'amount_inc_vat')::numeric), 0) INTO v_total FROM jsonb_array_elements(p_rows) x;

  INSERT INTO public.invoice_export_files (id, company_id, billing_month, environment, provider, row_count, total_inc_vat, rows, rows_sha256, created_by, created_at, artifact_archive_version)
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

  INSERT INTO public.audit_logs (company_id, actor_user_id, actor_type, entity_type, entity_id, action,
                                 new_values, metadata, resource_type, resource_id)
  VALUES (p_company_id, p_actor_user_id, 'user', 'invoice_export_file', v_file_id::text, 'invoice_file_created',
          jsonb_build_object('billing_month', p_billing_month, 'row_count', cardinality(v_ids), 'total_inc_vat', v_total),
          jsonb_build_object('environment', p_environment, 'provider', c.invoice_export_target_system, 'rows_sha256', p_rows_sha256),
          'invoice_export_file', v_file_id::text);

  RETURN v_file_id;
END $$;
REVOKE ALL ON FUNCTION gridex_invoice_file_archive.create_file(uuid,text,text,uuid,jsonb,text,uuid,timestamptz,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.gridex_create_invoice_export_file_v1(p_company_id uuid, p_billing_month text, p_environment text, p_actor_user_id uuid, p_rows jsonb, p_rows_sha256 text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
BEGIN
 RETURN gridex_invoice_file_archive.create_file(p_company_id,p_billing_month,p_environment,p_actor_user_id,p_rows,p_rows_sha256,NULL,NULL,NULL,NULL);
END $$;
CREATE FUNCTION public.gridex_read_invoice_file_intent_v2(p_company_id uuid,p_actor_user_id uuid,p_billing_month text,p_intent_id uuid,
 p_provider text,p_environment text,p_selection jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $receipt_read$
DECLARE v_receipt gridex_invoice_file_archive.receipts%rowtype; v_file public.invoice_export_files%rowtype; v_selection jsonb; v_manifest jsonb;
BEGIN
 SELECT * INTO v_receipt FROM gridex_invoice_file_archive.receipts WHERE company_id=p_company_id AND actor_user_id=p_actor_user_id AND intent_id=p_intent_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO v_file FROM public.invoice_export_files WHERE company_id=p_company_id AND id=v_receipt.file_id;
 IF jsonb_typeof(p_selection)='array' THEN
  SELECT jsonb_agg(x ORDER BY x->>'itemId') INTO v_selection FROM jsonb_array_elements(p_selection) x;
 END IF;
 IF v_file.artifact_archive_version IS DISTINCT FROM 2 OR v_file.billing_month IS DISTINCT FROM p_billing_month OR v_file.provider IS DISTINCT FROM p_provider
  OR v_file.environment IS DISTINCT FROM p_environment OR v_receipt.selection IS DISTINCT FROM v_selection THEN
  RAISE EXCEPTION 'invoice_file_intent_scope_mismatch' USING ERRCODE='22023';
 END IF;
 SELECT jsonb_agg(jsonb_build_object('format',a.format,'fileName',a.file_name,'contentType',a.content_type,'rendererVersion',a.renderer_version,
   'byteLength',a.byte_length,'sha256',a.sha256) ORDER BY a.format) INTO v_manifest
 FROM gridex_invoice_file_archive.artifacts a WHERE a.company_id=p_company_id AND a.file_id=v_file.id;
 IF v_manifest IS DISTINCT FROM v_receipt.manifest THEN
  RAISE EXCEPTION 'invoice_file_frozen_artifact_invalid' USING ERRCODE='23514';
 END IF;
 RETURN jsonb_build_object('fileId',v_file.id,'createdAt',v_receipt.created_at_wire,'rowCount',v_file.row_count,'rowsSha256',v_file.rows_sha256,
  'provider',v_file.provider,'environment',v_file.environment,'artifacts',v_receipt.manifest,'replayed',true);
END
$receipt_read$;
REVOKE ALL ON FUNCTION public.gridex_read_invoice_file_intent_v2(uuid,uuid,text,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_read_invoice_file_intent_v2(uuid,uuid,text,uuid,text,text,jsonb) TO service_role;

CREATE FUNCTION public.gridex_read_invoice_file_artifact_v2(p_company_id uuid,p_file_id uuid,p_format text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $artifact_read$
DECLARE v_receipt gridex_invoice_file_archive.receipts%rowtype; v_row gridex_invoice_file_archive.artifacts%rowtype;
 v_entry jsonb; v_header jsonb; v_archive_version smallint;
BEGIN
 SELECT artifact_archive_version INTO v_archive_version FROM public.invoice_export_files WHERE company_id=p_company_id AND id=p_file_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO v_receipt FROM gridex_invoice_file_archive.receipts WHERE company_id=p_company_id AND file_id=p_file_id;
 IF NOT FOUND THEN
  IF v_archive_version IS NULL THEN RETURN '{"kind":"legacy"}'::jsonb; END IF;
  RAISE EXCEPTION 'invoice_file_frozen_artifact_invalid' USING ERRCODE='23514';
 END IF;
 IF v_archive_version IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'invoice_file_frozen_artifact_invalid' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_row FROM gridex_invoice_file_archive.artifacts WHERE company_id=p_company_id AND file_id=p_file_id AND format=p_format;
 IF NOT FOUND THEN RAISE EXCEPTION 'invoice_file_frozen_artifact_invalid' USING ERRCODE='23514'; END IF;
 SELECT value INTO v_entry FROM jsonb_array_elements(v_receipt.manifest) WHERE value->>'format'=p_format;
 v_header:=jsonb_build_object('format',v_row.format,'fileName',v_row.file_name,'contentType',v_row.content_type,'rendererVersion',v_row.renderer_version,
  'byteLength',v_row.byte_length,'sha256',v_row.sha256);
 IF v_entry IS DISTINCT FROM v_header OR octet_length(v_row.body) IS DISTINCT FROM v_row.byte_length
  OR encode(sha256(v_row.body),'hex') IS DISTINCT FROM v_row.sha256 THEN
  RAISE EXCEPTION 'invoice_file_frozen_artifact_invalid' USING ERRCODE='23514';
 END IF;
 RETURN v_header||jsonb_build_object('bodyBase64',replace(encode(v_row.body,'base64'),E'\n',''));
END
$artifact_read$;
REVOKE ALL ON FUNCTION public.gridex_read_invoice_file_artifact_v2(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_read_invoice_file_artifact_v2(uuid,uuid,text) TO service_role;

CREATE FUNCTION public.gridex_write_invoice_file_intent_v2(p_company_id uuid,p_billing_month text,p_environment text,p_actor_user_id uuid,
 p_rows jsonb,p_rows_sha256 text,p_intent_id uuid,p_provider text,p_file_id uuid,p_created_at text,p_selection jsonb,p_artifacts jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET "TimeZone" TO 'UTC'
AS $file_write$
DECLARE
 v_replay jsonb; v_selection jsonb; v_entry jsonb; v_body bytea; v_decoded jsonb; v_format text;
 v_file uuid; v_manifest jsonb:='[]'; v_seen text[]:='{}'; v_total integer:=0; v_bytes integer;
 v_base text; v_name text; v_type text; v_allowed text[];
BEGIN
 IF p_company_id IS NULL OR p_actor_user_id IS NULL OR p_intent_id IS NULL THEN
  RAISE EXCEPTION 'invoice_file_intent_required' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('invoice-file-intent:'||p_company_id::text||':'||p_actor_user_id::text||':'||p_intent_id::text,0));
 v_replay:=public.gridex_read_invoice_file_intent_v2(p_company_id,p_actor_user_id,p_billing_month,p_intent_id,p_provider,p_environment,p_selection);
 IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)=0 THEN
  RAISE EXCEPTION 'invoice_file_empty' USING ERRCODE='22023';
 END IF;
 IF p_file_id IS NULL OR p_billing_month IS NULL OR p_billing_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
 OR p_created_at IS NULL OR p_created_at !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
  RAISE EXCEPTION 'invoice_file_identity_invalid' USING ERRCODE='22023';
 END IF;
 IF to_char(p_created_at::timestamptz,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') IS DISTINCT FROM p_created_at THEN
  RAISE EXCEPTION 'invoice_file_identity_invalid' USING ERRCODE='22023';
 END IF;
 IF p_provider IS NULL OR p_provider NOT IN ('file_export','nordfin') THEN
  RAISE EXCEPTION 'invoice_file_provider_not_active' USING ERRCODE='55000';
 END IF;
 IF jsonb_typeof(p_selection) IS DISTINCT FROM 'array' OR jsonb_array_length(p_selection)=0 THEN
  RAISE EXCEPTION 'invoice_file_selection_changed' USING ERRCODE='40001';
 END IF;
 SELECT jsonb_agg(x ORDER BY x->>'itemId') INTO v_selection FROM jsonb_array_elements(p_selection) x;
 IF EXISTS(SELECT FROM jsonb_array_elements(v_selection) x WHERE
    NOT coalesce(x=(jsonb_build_object('itemId',x->'itemId','reviewHash',x->'reviewHash','approvedAt',x->'approvedAt','approvedBy',x->'approvedBy')),false)
    OR jsonb_typeof(x->'itemId') IS DISTINCT FROM 'string'
    OR coalesce(x->>'reviewHash','') !~ '^[0-9a-f]{64}$' OR coalesce(x->>'approvedAt','')=''
    OR coalesce(x->>'approvedBy','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
  RAISE EXCEPTION 'invoice_file_selection_changed' USING ERRCODE='40001';
 END IF;
 v_allowed:=CASE p_provider WHEN 'nordfin' THEN ARRAY['csv','xlsx','json','nordfin_xml'] ELSE ARRAY['csv','xlsx','json'] END;
 IF jsonb_typeof(p_artifacts) IS DISTINCT FROM 'array' OR jsonb_array_length(p_artifacts)<>cardinality(v_allowed) THEN
  RAISE EXCEPTION 'invoice_file_artifact_invalid' USING ERRCODE='22023';
 END IF;
 v_base:='fakturor-'||p_billing_month||'-'||left(p_file_id::text,8);
 FOR v_entry IN SELECT value FROM jsonb_array_elements(p_artifacts) ORDER BY value->>'format' LOOP
  v_format:=v_entry->>'format';
  IF v_format IS NULL OR NOT(v_format=ANY(v_allowed)) OR v_format=ANY(v_seen) THEN
   RAISE EXCEPTION 'invoice_file_artifact_invalid' USING ERRCODE='22023';
  END IF;
  v_seen:=array_append(v_seen,v_format);
  v_name:=CASE v_format WHEN 'nordfin_xml' THEN 'nordfin-'||v_base||'.xml' ELSE v_base||'.'||v_format END;
  v_type:=CASE v_format WHEN 'csv' THEN 'text/csv; charset=utf-8'
   WHEN 'json' THEN 'application/json; charset=utf-8'
   WHEN 'xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ELSE 'application/xml; charset=utf-8' END;
  IF v_entry->>'fileName' IS DISTINCT FROM v_name OR v_entry->>'contentType' IS DISTINCT FROM v_type
   OR coalesce(v_entry->>'rendererVersion','') !~ '^[A-Za-z0-9._-]{1,64}$'
   OR coalesce(v_entry->>'sha256','') !~ '^[0-9a-f]{64}$'
   OR jsonb_typeof(v_entry->'byteLength') IS DISTINCT FROM 'number'
   OR coalesce(v_entry->>'byteLength','') !~ '^[1-9][0-9]{0,8}$'
   OR jsonb_typeof(v_entry->'bodyBase64') IS DISTINCT FROM 'string'
   OR coalesce(v_entry->>'bodyBase64','')='' THEN
   RAISE EXCEPTION 'invoice_file_artifact_invalid' USING ERRCODE='22023';
  END IF;
  IF length(v_entry->>'bodyBase64')>22369624 OR (v_entry->>'byteLength')::integer>16777216 THEN
   RAISE EXCEPTION 'invoice_file_artifacts_too_large' USING ERRCODE='22023';
  END IF;
  BEGIN
   v_body:=decode(v_entry->>'bodyBase64','base64');
   IF v_format='json' THEN v_decoded:=convert_from(v_body,'UTF8')::jsonb; END IF;
  EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation OR character_not_in_repertoire OR untranslatable_character THEN
   RAISE EXCEPTION 'invoice_file_artifact_invalid' USING ERRCODE='22023';
  END;
  v_bytes:=octet_length(v_body);
  v_total:=v_total+v_bytes;
  IF v_bytes>16777216 OR v_total>25165824 THEN RAISE EXCEPTION 'invoice_file_artifacts_too_large' USING ERRCODE='22023'; END IF;
  IF v_bytes IS DISTINCT FROM (v_entry->>'byteLength')::integer
   OR replace(encode(v_body,'base64'),E'\n','') IS DISTINCT FROM v_entry->>'bodyBase64'
   OR encode(sha256(v_body),'hex') IS DISTINCT FROM v_entry->>'sha256'
   OR (v_format='json' AND (v_decoded->>'format' IS DISTINCT FROM 'gridex_invoice_file_v1' OR v_decoded->>'file_id' IS DISTINCT FROM p_file_id::text OR v_decoded->>'created_at' IS DISTINCT FROM p_created_at
      OR v_decoded->>'billing_month' IS DISTINCT FROM p_billing_month OR v_decoded->>'rows_sha256' IS DISTINCT FROM p_rows_sha256
      OR v_decoded->'invoices' IS DISTINCT FROM p_rows)) THEN
   RAISE EXCEPTION 'invoice_file_artifact_invalid' USING ERRCODE='22023';
  END IF;
  v_manifest:=v_manifest||jsonb_build_array(jsonb_build_object('format',v_format,'fileName',v_name,'contentType',v_type,
    'rendererVersion',v_entry->>'rendererVersion','byteLength',v_bytes,'sha256',v_entry->>'sha256'));
 END LOOP;
 v_file:=gridex_invoice_file_archive.create_file(p_company_id,p_billing_month,p_environment,p_actor_user_id,p_rows,p_rows_sha256,
   p_file_id,p_created_at::timestamptz,p_provider,v_selection);
 INSERT INTO gridex_invoice_file_archive.receipts VALUES(p_company_id,p_actor_user_id,p_intent_id,v_file,p_created_at,v_selection,v_manifest);
 INSERT INTO gridex_invoice_file_archive.artifacts(company_id,file_id,format,file_name,content_type,renderer_version,byte_length,sha256,body)
 SELECT p_company_id,v_file,x->>'format',x->>'fileName',x->>'contentType',x->>'rendererVersion',(x->>'byteLength')::integer,x->>'sha256',
   decode(x->>'bodyBase64','base64') FROM jsonb_array_elements(p_artifacts) x;
 RETURN public.gridex_read_invoice_file_intent_v2(p_company_id,p_actor_user_id,p_billing_month,p_intent_id,p_provider,p_environment,v_selection)
  || '{"replayed":false}'::jsonb;
END
$file_write$;
REVOKE ALL ON FUNCTION public.gridex_write_invoice_file_intent_v2(uuid,text,text,uuid,jsonb,text,uuid,text,uuid,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_write_invoice_file_intent_v2(uuid,text,text,uuid,jsonb,text,uuid,text,uuid,text,jsonb,jsonb) TO service_role;

-- Full ordered native snapshot before the server signs or explicitly confirms a selection.
CREATE FUNCTION public.gridex_preview_invoice_file_selection_v2(p_company_id uuid,p_billing_month text,p_provider text,p_environment text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $file_preview$
DECLARE v_selection jsonb; v_matching_scope boolean;
BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object('itemId',item.id,'reviewHash',item.metadata->'approval'->>'review_hash',
   'approvedAt',item.metadata->'approval'->>'approved_at','approvedBy',item.metadata->'approval'->>'approved_by') ORDER BY item.id),'[]'::jsonb),
 coalesce(bool_and(item.provider IS NOT DISTINCT FROM p_provider AND item.environment IS NOT DISTINCT FROM p_environment),true)
 INTO v_selection,v_matching_scope FROM (
  SELECT i.id,i.metadata,i.provider,i.environment FROM public.invoice_export_items i
  JOIN public.invoice_export_runs run ON run.id=i.export_run_id AND run.company_id=i.company_id
  WHERE i.company_id=p_company_id AND i.status='pending' AND i.export_file_id IS NULL
   AND i.metadata->'approval'->>'status'='approved'
   AND run.billing_month=p_billing_month AND run.provider=p_provider AND run.environment=p_environment
  ORDER BY i.id LIMIT 1001
 ) item;
 IF jsonb_array_length(v_selection)>1000 THEN RAISE EXCEPTION 'invoice_file_selection_too_large' USING ERRCODE='22023'; END IF;
 IF v_matching_scope IS NOT TRUE THEN RAISE EXCEPTION 'invoice_file_selection_changed' USING ERRCODE='40001'; END IF;
 RETURN v_selection;
END
$file_preview$;
REVOKE ALL ON FUNCTION public.gridex_preview_invoice_file_selection_v2(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_preview_invoice_file_selection_v2(uuid,text,text,text) TO service_role;
END
$gridex_invoice_migration$;
