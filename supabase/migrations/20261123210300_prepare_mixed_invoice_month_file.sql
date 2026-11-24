DO $gridex_invoice_migration$
BEGIN

ALTER TABLE public.invoice_export_files ADD COLUMN preparation_kind text CHECK (
  preparation_kind IS NULL OR (preparation_kind='mixed_neutral_v1' AND artifact_archive_version IS NOT DISTINCT FROM 2 AND provider='file_export')
);

CREATE TABLE gridex_invoice_file_archive.mixed_members (
  company_id uuid NOT NULL,
  file_id uuid NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 1000),
  item_id uuid,
  group_invoice_id uuid,
  PRIMARY KEY (company_id,file_id,position),
  UNIQUE (company_id,item_id),
  UNIQUE (company_id,group_invoice_id),
  FOREIGN KEY (company_id,file_id) REFERENCES public.invoice_export_files(company_id,id),
  FOREIGN KEY (company_id,group_invoice_id) REFERENCES gridex_invoice_groups.customer_documents(company_id,invoice_id),
  CHECK ((item_id IS NOT NULL) <> (group_invoice_id IS NOT NULL))
);
ALTER TABLE gridex_invoice_file_archive.mixed_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gridex_invoice_file_archive.mixed_members FROM PUBLIC,anon,authenticated,service_role;

-- Existing finalization continues to queue delivery effects. A neutral file
-- preparation has no delivery evidence and must not trigger those effects.
DROP TRIGGER queue_invoice_export_period_reconciliation ON public.invoice_export_files;
CREATE TRIGGER queue_invoice_export_period_reconciliation AFTER INSERT ON public.invoice_export_files
  FOR EACH ROW WHEN (NEW.artifact_archive_version=2 AND NEW.preparation_kind IS NULL)
  EXECUTE FUNCTION gridex_invoice_file_archive.queue_period_reconciliation();
DROP TRIGGER queue_invoice_file_effects ON gridex_invoice_file_archive.receipts;
CREATE TRIGGER queue_invoice_file_effects AFTER INSERT ON gridex_invoice_file_archive.receipts
  FOR EACH ROW WHEN (NOT jsonb_path_exists(NEW.selection,'$[*] ? (@.kind == "group")'))
  EXECUTE FUNCTION gridex_invoice_file_archive.queue_file_effects();

CREATE FUNCTION gridex_invoice_file_archive.require_mixed_file_sources(p_company uuid,p_file uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE member record;
DECLARE members integer:=0;
DECLARE expected integer;
BEGIN
  SELECT row_count INTO expected FROM public.invoice_export_files
  WHERE company_id=p_company AND id=p_file AND preparation_kind='mixed_neutral_v1';
  IF NOT FOUND THEN RETURN; END IF;
  FOR member IN
    SELECT m.*, r.selection->(m.position-1) AS selected, i.billing_underlay_id, inv.id AS invoice_id
    FROM gridex_invoice_file_archive.mixed_members m
    JOIN gridex_invoice_file_archive.receipts r USING (company_id,file_id)
    LEFT JOIN public.invoice_export_items i ON i.company_id=m.company_id AND i.id=m.item_id AND i.export_file_id=m.file_id
    LEFT JOIN public.customer_invoices inv ON inv.company_id=m.company_id AND inv.invoice_export_item_id=i.id
    WHERE m.company_id=p_company AND m.file_id=p_file ORDER BY m.position
  LOOP
    IF member.group_invoice_id IS NOT NULL AND member.selected->>'invoiceId'=member.group_invoice_id::text THEN
      PERFORM gridex_invoice_groups.verified_neutral_file_source(p_company,member.group_invoice_id,member.selected->>'reviewHash');
    ELSIF member.item_id IS NOT NULL AND member.selected->>'itemId'=member.item_id::text
          AND member.invoice_id IS NOT NULL AND member.billing_underlay_id IS NOT NULL THEN
      PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company,member.billing_underlay_id,member.invoice_id);
    ELSE
      RAISE EXCEPTION 'invoice_file_frozen_artifact_invalid' USING ERRCODE='23514';
    END IF;
    members:=members+1;
  END LOOP;
  IF members<>expected THEN RAISE EXCEPTION 'invoice_file_frozen_artifact_invalid' USING ERRCODE='23514'; END IF;
END
$$;
REVOKE ALL ON FUNCTION gridex_invoice_file_archive.require_mixed_file_sources(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.gridex_prepare_mixed_invoice_month_file_v1(
  p_company_id uuid,p_billing_month text,p_environment text,p_actor_user_id uuid,p_intent_id uuid,p_selection jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog SET "TimeZone" TO 'UTC' AS $$
DECLARE chosen jsonb;
DECLARE selected jsonb;
DECLARE draft gridex_invoice_groups.drafts%ROWTYPE;
DECLARE group_copy gridex_invoice_groups.customer_documents%ROWTYPE;
DECLARE item record;
DECLARE rows_out jsonb:='[]'::jsonb;
DECLARE total numeric:=0;
DECLARE new_file_id uuid;
DECLARE clock_text text;
DECLARE file_rows_hash text;
DECLARE file_body bytea;
DECLARE file_hash text;
DECLARE artifact jsonb;
DECLARE scope jsonb;
DECLARE company public.companies%ROWTYPE;
DECLARE row_position integer:=0;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR
    public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'billing_underlay.export') IS NOT TRUE THEN
   RAISE EXCEPTION 'invoice_file_prepare_forbidden' USING ERRCODE='42501';
 END IF;
 IF p_intent_id IS NULL OR coalesce(p_billing_month,'') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    OR coalesce(p_environment,'') NOT IN ('test','production')
    OR jsonb_typeof(p_selection) IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'invoice_file_selection_invalid' USING ERRCODE='22023';
 END IF;
 IF jsonb_array_length(p_selection)=0 THEN RAISE EXCEPTION 'invoice_file_empty' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_selection)>1000 OR NOT jsonb_path_exists(p_selection,'$[*] ? (@.kind == "group")') OR EXISTS (
    SELECT FROM jsonb_array_elements(p_selection) s
    WHERE coalesce(s->>'reviewHash','') !~ '^[0-9a-f]{64}$'
      OR CASE s->>'kind'
        WHEN 'group' THEN (s-ARRAY['kind','invoiceId','reviewHash'])<>'{}'::jsonb
          OR coalesce(s->>'invoiceId','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        WHEN 'individual' THEN (s-ARRAY['kind','itemId','reviewHash','approvedAt','approvedBy'])<>'{}'::jsonb
          OR coalesce(s->>'itemId','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
          OR coalesce(s->>'approvedAt','')='' OR coalesce(s->>'approvedBy','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        ELSE true END) THEN
   RAISE EXCEPTION 'invoice_file_selection_invalid' USING ERRCODE='22023';
 END IF;
 SELECT jsonb_agg(s ORDER BY coalesce(s->>'itemId',s->>'invoiceId')) INTO selected FROM jsonb_array_elements(p_selection) s;
 IF (SELECT count(DISTINCT coalesce(s->>'itemId',s->>'invoiceId')) FROM jsonb_array_elements(selected) s)
       <>jsonb_array_length(selected) THEN
   RAISE EXCEPTION 'invoice_file_selection_invalid' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::text||'/'||p_actor_user_id::text||'/'||p_intent_id::text,0));
 scope:=public.gridex_read_invoice_file_intent_v2(p_company_id,p_actor_user_id,p_billing_month,p_intent_id,'file_export',p_environment,selected);
 IF scope IS NOT NULL THEN RETURN scope; END IF;

 -- Retention takes SHARE on the ordinary finance relations before row locks.
 LOCK TABLE public.customer_invoices,public.invoice_export_items IN ROW EXCLUSIVE MODE NOWAIT;
 BEGIN
   -- Existing grouping takes the draft lock before reading company scope.
   PERFORM d.invoice_id FROM gridex_invoice_groups.drafts d
   JOIN jsonb_array_elements(selected) s ON s->>'kind'='group' AND (s->>'invoiceId')::uuid=d.invoice_id
   WHERE d.company_id=p_company_id ORDER BY d.invoice_id FOR UPDATE OF d NOWAIT;
 EXCEPTION WHEN lock_not_available THEN
   RAISE EXCEPTION 'invoice_file_finance_lock_busy' USING ERRCODE='55P03';
 END;
 SELECT * INTO company FROM public.companies WHERE id=p_company_id FOR UPDATE;
 IF NOT FOUND OR company.invoice_export_target_system IS DISTINCT FROM 'file_export'
    OR company.billing_provider_environment IS DISTINCT FROM p_environment OR company.invoice_export_enabled IS NOT TRUE THEN
   RAISE EXCEPTION 'invoice_file_provider_not_active' USING ERRCODE='55000';
 END IF;

 FOR chosen IN SELECT value FROM jsonb_array_elements(selected) LOOP
   IF chosen->>'kind'='group' THEN
     SELECT * INTO draft FROM gridex_invoice_groups.drafts WHERE company_id=p_company_id AND invoice_id=(chosen->>'invoiceId')::uuid;
     IF NOT FOUND OR draft.billing_month IS DISTINCT FROM p_billing_month OR draft.environment IS DISTINCT FROM p_environment
       OR draft.provider IS DISTINCT FROM 'file_export' OR EXISTS (SELECT FROM gridex_invoice_file_archive.mixed_members
           WHERE company_id=p_company_id AND group_invoice_id=draft.invoice_id) THEN
       RAISE EXCEPTION 'invoice_file_group_selection_changed' USING ERRCODE='40001';
     END IF;
     group_copy:=gridex_invoice_groups.verified_neutral_file_source(p_company_id,draft.invoice_id,chosen->>'reviewHash');
     rows_out:=rows_out||jsonb_build_array(jsonb_build_object('kind','group','invoice',convert_from(group_copy.body,'UTF8')::jsonb));
     total:=total+(convert_from(group_copy.body,'UTF8')::jsonb->>'amountIncVat')::numeric;
   ELSE
     SELECT i.id,i.billing_underlay_id,m.id AS invoice_id,m.invoice_reference,m.invoice_number,m.amount_inc_vat,
       m.currency,m.period_start,m.period_end,m.total_kwh INTO item
     FROM public.invoice_export_items i
     JOIN public.invoice_export_runs r ON r.company_id=i.company_id AND r.id=i.export_run_id
     JOIN public.customer_invoices m ON m.company_id=i.company_id AND m.invoice_export_item_id=i.id
     WHERE i.company_id=p_company_id AND i.id=(chosen->>'itemId')::uuid AND i.status='pending' AND i.export_file_id IS NULL
       AND i.provider='file_export' AND i.environment=p_environment
       AND r.provider='file_export' AND r.environment=p_environment AND r.billing_month=p_billing_month
       AND i.metadata#>>'{approval,status}'='approved'
       AND i.metadata#>>'{approval,review_hash}'=chosen->>'reviewHash'
       AND i.metadata#>>'{approval,approved_at}'=chosen->>'approvedAt'
       AND i.metadata#>>'{approval,approved_by}'=chosen->>'approvedBy'
       AND m.status='draft' AND m.metadata->'approval'=i.metadata->'approval'
       AND m.calculation_snapshot_sha256=i.metadata#>>'{approval,calculation_snapshot_sha256}'
       AND m.calculation_snapshot_sha256 ~ '^[0-9a-f]{64}$' AND m.amount_inc_vat IS NOT NULL AND m.currency='SEK'
       AND i.billing_underlay_id IS NOT NULL
     FOR UPDATE OF i,m;
     IF NOT FOUND THEN RAISE EXCEPTION 'invoice_file_selection_changed' USING ERRCODE='40001'; END IF;
     PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company_id,item.billing_underlay_id,item.invoice_id);
     rows_out:=rows_out||jsonb_build_array(jsonb_build_object('kind','individual','invoice',
       jsonb_build_object('invoiceReference',item.invoice_reference,'invoiceNumber',item.invoice_number,
        'amountIncVat',item.amount_inc_vat::text,'periodStart',item.period_start,'periodEnd',item.period_end,
        'quantityKwh',item.total_kwh::text,'currency',item.currency)));
     total:=total+item.amount_inc_vat;
   END IF;
 END LOOP;

 new_file_id:=gen_random_uuid();
 clock_text:=to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 file_rows_hash:=encode(sha256(convert_to(rows_out::text,'UTF8')),'hex');
 file_body:=convert_to(jsonb_build_object('format','gridex_mixed_neutral_invoice_file_v1',
    'fileId',new_file_id,'billingMonth',p_billing_month,'createdAt',clock_text,'rowsSha256',file_rows_hash,'invoices',rows_out)::text,'UTF8');
 file_hash:=encode(sha256(file_body),'hex');
 artifact:=jsonb_build_object('format','json','fileName','fakturor-'||p_billing_month||'-'||left(new_file_id::text,8)||'.json',
   'contentType','application/json; charset=utf-8','rendererVersion','gridex_mixed_neutral_invoice_file_v1',
   'byteLength',octet_length(file_body),'sha256',file_hash);

 INSERT INTO public.invoice_export_files(id,company_id,billing_month,environment,provider,row_count,total_inc_vat,
    rows,rows_sha256,created_by,created_at,artifact_archive_version,preparation_kind)
 VALUES(new_file_id,p_company_id,p_billing_month,p_environment,'file_export',jsonb_array_length(rows_out),total,rows_out,
    file_rows_hash,p_actor_user_id,clock_text::timestamptz,2,'mixed_neutral_v1');
 INSERT INTO gridex_invoice_file_archive.receipts(company_id,actor_user_id,intent_id,file_id,created_at_wire,selection,manifest)
 VALUES(p_company_id,p_actor_user_id,p_intent_id,new_file_id,clock_text,selected,jsonb_build_array(artifact));
 INSERT INTO gridex_invoice_file_archive.artifacts(company_id,file_id,format,file_name,content_type,renderer_version,byte_length,sha256,body)
 VALUES(p_company_id,new_file_id,'json',artifact->>'fileName',artifact->>'contentType',artifact->>'rendererVersion',octet_length(file_body),file_hash,file_body);
 FOR chosen IN SELECT value FROM jsonb_array_elements(selected) LOOP
   row_position:=row_position+1;
   INSERT INTO gridex_invoice_file_archive.mixed_members(company_id,file_id,position,item_id,group_invoice_id)
   VALUES(p_company_id,new_file_id,row_position,(chosen->>'itemId')::uuid,(chosen->>'invoiceId')::uuid);
   IF chosen->>'kind'='individual' THEN
     UPDATE public.invoice_export_items SET export_file_id=new_file_id,updated_at=now()
     WHERE company_id=p_company_id AND id=(chosen->>'itemId')::uuid;
   END IF;
 END LOOP;
 INSERT INTO public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,metadata)
 VALUES(p_company_id,p_actor_user_id,'invoice_export_file',new_file_id::text,'invoice_file_created',
   jsonb_build_object('kind','mixed_neutral_v1','rowsSha256',file_rows_hash,'artifactSha256',file_hash));
 RETURN public.gridex_read_invoice_file_intent_v2(p_company_id,p_actor_user_id,p_billing_month,p_intent_id,'file_export',p_environment,selected)
   || '{"replayed":false}'::jsonb;
END
$$;
REVOKE ALL ON FUNCTION public.gridex_prepare_mixed_invoice_month_file_v1(uuid,text,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_prepare_mixed_invoice_month_file_v1(uuid,text,text,uuid,uuid,jsonb) TO service_role;

-- The two existing reader definitions with narrowly inserted mixed-format guards
-- are appended by assemble.py against the verified MAIN05.02 source.

CREATE FUNCTION public.gridex_preview_mixed_invoice_group_selection_v1(
  p_company_id uuid,p_billing_month text,p_environment text,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE selected jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR
    public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'billing_underlay.export') IS NOT TRUE THEN
   RAISE EXCEPTION 'invoice_file_prepare_forbidden' USING ERRCODE='42501';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('invoiceId',g.invoice_id,'reviewHash',g.review_hash) ORDER BY g.invoice_id),'[]'::jsonb)
 INTO selected FROM (
   SELECT d.invoice_id,o.review_hash
   FROM gridex_invoice_groups.drafts d
   JOIN gridex_invoice_groups.issue_outcomes o ON o.company_id=d.company_id AND o.invoice_id=d.invoice_id AND o.outcome='issued'
   JOIN gridex_invoice_groups.customer_documents f ON f.company_id=d.company_id AND f.invoice_id=d.invoice_id
   JOIN public.customer_invoices i ON i.company_id=d.company_id AND i.id=d.invoice_id AND i.status='issued'
   WHERE d.company_id=p_company_id AND d.billing_month=p_billing_month AND d.environment=p_environment AND d.provider='file_export'
     AND NOT EXISTS (SELECT FROM gridex_invoice_file_archive.mixed_members m WHERE m.company_id=d.company_id AND m.group_invoice_id=d.invoice_id)
   ORDER BY d.invoice_id LIMIT 1001
 ) g;
 IF jsonb_array_length(selected)>1000 THEN RAISE EXCEPTION 'invoice_file_selection_too_large' USING ERRCODE='22023'; END IF;
 RETURN selected;
END
$$;
REVOKE ALL ON FUNCTION public.gridex_preview_mixed_invoice_group_selection_v1(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_preview_mixed_invoice_group_selection_v1(uuid,text,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.gridex_read_invoice_file_intent_v2(p_company_id uuid,p_actor_user_id uuid,p_billing_month text,p_intent_id uuid,
 p_provider text,p_environment text,p_selection jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $receipt_read$
DECLARE v_receipt gridex_invoice_file_archive.receipts%rowtype; v_file public.invoice_export_files%rowtype; v_selection jsonb; v_manifest jsonb;
BEGIN
 SELECT * INTO v_receipt FROM gridex_invoice_file_archive.receipts WHERE company_id=p_company_id AND actor_user_id=p_actor_user_id AND intent_id=p_intent_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO v_file FROM public.invoice_export_files WHERE company_id=p_company_id AND id=v_receipt.file_id;
 IF jsonb_typeof(p_selection)='array' THEN
  SELECT jsonb_agg(x ORDER BY coalesce(x->>'itemId',x->>'invoiceId')) INTO v_selection FROM jsonb_array_elements(p_selection) x;
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
 IF v_file.preparation_kind='mixed_neutral_v1' THEN
  PERFORM gridex_invoice_file_archive.require_mixed_file_sources(p_company_id,v_file.id);
 END IF;
 RETURN jsonb_build_object('fileId',v_file.id,'createdAt',v_receipt.created_at_wire,'rowCount',v_file.row_count,'rowsSha256',v_file.rows_sha256,
  'provider',v_file.provider,'environment',v_file.environment,'artifacts',v_receipt.manifest,'replayed',true);
END
$receipt_read$;

CREATE OR REPLACE FUNCTION public.gridex_read_invoice_file_artifact_v2(p_company_id uuid,p_file_id uuid,p_format text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $artifact_read$
DECLARE v_receipt gridex_invoice_file_archive.receipts%rowtype; v_row gridex_invoice_file_archive.artifacts%rowtype;
 v_entry jsonb; v_header jsonb; v_archive_version smallint; v_preparation_kind text;
BEGIN
 SELECT artifact_archive_version,preparation_kind INTO v_archive_version,v_preparation_kind FROM public.invoice_export_files WHERE company_id=p_company_id AND id=p_file_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO v_receipt FROM gridex_invoice_file_archive.receipts WHERE company_id=p_company_id AND file_id=p_file_id;
 IF NOT FOUND THEN
  IF v_archive_version IS NULL THEN RETURN '{"kind":"legacy"}'::jsonb; END IF;
  RAISE EXCEPTION 'invoice_file_frozen_artifact_invalid' USING ERRCODE='23514';
 END IF;
 IF v_archive_version IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'invoice_file_frozen_artifact_invalid' USING ERRCODE='23514'; END IF;
 IF v_preparation_kind='mixed_neutral_v1' THEN
  IF p_format IS DISTINCT FROM 'json' THEN RAISE EXCEPTION 'invoice_file_format_unavailable' USING ERRCODE='22023'; END IF;
  PERFORM gridex_invoice_file_archive.require_mixed_file_sources(p_company_id,p_file_id);
 END IF;
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
END
$gridex_invoice_migration$;
