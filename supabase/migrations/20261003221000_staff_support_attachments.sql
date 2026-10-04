-- Durable staff attachments: metadata reservation precedes Storage, and release follows verified readback.
-- Files and receipts stay private; only service-role commands can mutate them. No production activation.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS staff_api_attachment_company_id_key
  ON public.customer_case_attachments(company_id,id);

CREATE TABLE public.staff_api_attachment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  api_client_id uuid NOT NULL REFERENCES public.integration_api_clients(id),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  resource_reference text NOT NULL CHECK(resource_reference ~ '^support_case_[A-Za-z0-9_-]{20,64}$'),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 200),
  request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  attachment_id uuid NOT NULL,
  lease_id uuid NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE(company_id,api_client_id,actor_user_id,resource_reference,idempotency_key),
  UNIQUE(company_id,attachment_id),
  FOREIGN KEY(company_id,attachment_id) REFERENCES public.customer_case_attachments(company_id,id)
);
ALTER TABLE public.staff_api_attachment_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.staff_api_attachment_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.staff_api_attachment_receipts TO service_role;
INSERT INTO public.platform_table_classification(table_name,kind,rationale,null_company_meaning,classified_by)
VALUES('staff_api_attachment_receipts','tenant','Private actor/client-bound staff attachment reservations and replay receipts.',NULL,'migration:staff_support_attachments')
ON CONFLICT(table_name) DO UPDATE SET kind=EXCLUDED.kind,rationale=EXCLUDED.rationale,
  null_company_meaning=EXCLUDED.null_company_meaning,classified_by=EXCLUDED.classified_by,classified_at=now();

-- The intended existing 20/rolling-24h/customer quota now holds across concurrent staff/native/customer inserts.
CREATE OR REPLACE FUNCTION public.staff_api_attachment_quota_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    concat_ws(':','support-attachment-quota',NEW.company_id,NEW.customer_id),0));
  IF (SELECT count(*) FROM public.customer_case_attachments a WHERE a.company_id=NEW.company_id
    AND a.customer_id=NEW.customer_id AND a.created_at>=clock_timestamp()-interval '24 hours')>=20 THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='attachment_quota_exceeded';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.staff_api_attachment_quota_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_api_attachment_quota_guard() TO service_role;
CREATE TRIGGER staff_api_attachment_quota_guard BEFORE INSERT ON public.customer_case_attachments
  FOR EACH ROW EXECUTE FUNCTION public.staff_api_attachment_quota_guard();

CREATE OR REPLACE FUNCTION public.staff_api_attachment_reserve(
  p_session_id uuid,p_revision bigint,p_user_id uuid,p_native_session_id uuid,p_client_id uuid,p_company_id uuid,
  p_case_reference text,p_idempotency_key text,p_request_hash text,p_file_name text,p_declared_mime text,
  p_byte_size integer,p_sha256 text,p_visibility text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_case public.customer_cases%ROWTYPE;
  v_receipt public.staff_api_attachment_receipts%ROWTYPE;
  v_attachment public.customer_case_attachments%ROWTYPE;
  v_now timestamptz;
  v_lease uuid;
  v_reference text;
BEGIN
  IF coalesce(p_case_reference,'')!~'^support_case_[A-Za-z0-9_-]{20,64}$'
    OR length(coalesce(p_idempotency_key,'')) NOT BETWEEN 8 AND 200
    OR coalesce(p_request_hash,'')!~'^[0-9a-f]{64}$' OR coalesce(p_sha256,'')!~'^[0-9a-f]{64}$'
    OR length(coalesce(p_file_name,'')) NOT BETWEEN 1 AND 124
    OR coalesce(p_declared_mime,'') NOT IN ('application/pdf','image/png','image/jpeg')
    OR coalesce(p_byte_size,0) NOT BETWEEN 1 AND 4194304
    OR coalesce(p_visibility,'') NOT IN ('internal','customer') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_request';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    concat_ws(':','staff-attachment',p_company_id,p_client_id,p_user_id,p_case_reference,p_idempotency_key),0));
  SELECT * INTO v_case FROM public.customer_cases c WHERE c.company_id=p_company_id
    AND ('support_case_' || substr(translate(encode(extensions.digest('gridex-public-reference:v1:' || c.company_id::text || ':support_case:' || c.id::text,'sha256'),'base64'),'+/=','-_'),1,32))=p_case_reference
    AND (c.metadata->>'support_case'='true' OR left(c.source,15)='tenant_support_') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='support_case_not_found'; END IF;
  SELECT * INTO v_receipt FROM public.staff_api_attachment_receipts r WHERE r.company_id=p_company_id
    AND r.api_client_id=p_client_id AND r.actor_user_id=p_user_id AND r.resource_reference=p_case_reference
    AND r.idempotency_key=p_idempotency_key FOR UPDATE;
  IF v_receipt.id IS NOT NULL THEN
    SELECT * INTO v_attachment FROM public.customer_case_attachments a WHERE a.company_id=p_company_id
      AND a.id=v_receipt.attachment_id AND a.customer_case_id=v_case.id AND a.customer_id=v_case.customer_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='attachment_not_found'; END IF;
  END IF;
  -- Acquire every potentially blocking content lock before the final live authorization check.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    concat_ws(':','support-attachment-quota',p_company_id,v_case.customer_id),0));
  PERFORM public.staff_api_assert_command_actor(p_session_id,p_revision,p_user_id,p_native_session_id,p_client_id,p_company_id,'cases.write');
  v_now:=clock_timestamp();
  IF v_receipt.id IS NOT NULL THEN
    IF v_receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='idempotency_conflict'; END IF;
    IF v_attachment.sha256<>p_sha256 OR v_attachment.byte_size<>p_byte_size THEN
      RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='idempotency_conflict';
    END IF;
    IF v_receipt.completed_at IS NOT NULL THEN
      IF v_attachment.scan_status NOT IN ('released','rejected') THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='attachment_unavailable'; END IF;
      RETURN jsonb_build_object('state','replay','row',to_jsonb(v_attachment));
    END IF;
    IF v_case.status IN ('resolved','closed','cancelled') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='support_case_closed'; END IF;
    IF v_receipt.lease_expires_at>v_now THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='idempotency_in_progress'; END IF;
    v_lease:=gen_random_uuid();
    UPDATE public.staff_api_attachment_receipts SET lease_id=v_lease,lease_expires_at=v_now+interval '2 minutes'
      WHERE id=v_receipt.id AND company_id=p_company_id;
    RETURN jsonb_build_object('state','acquired','lease_id',v_lease,'row',to_jsonb(v_attachment));
  END IF;
  IF v_case.status IN ('resolved','closed','cancelled') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='support_case_closed'; END IF;
  IF NOT public.staff_api_consume_auth_budget(encode(extensions.digest(
    concat_ws(':','staff-mutation',p_company_id,p_client_id,p_user_id),'sha256'),'hex'),20,60) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='staff_rate_limited';
  END IF;
  -- The shared budget can wait on another writer; reauthorize again after that wait.
  PERFORM public.staff_api_assert_command_actor(p_session_id,p_revision,p_user_id,p_native_session_id,p_client_id,p_company_id,'cases.write');
  v_now:=clock_timestamp();
  v_reference:='support_attachment_'||replace(gen_random_uuid()::text,'-','');
  v_lease:=gen_random_uuid();
  INSERT INTO public.customer_case_attachments(company_id,customer_id,customer_case_id,public_reference,file_name,
    declared_mime_type,byte_size,sha256,storage_path,visibility,uploaded_by_kind,uploaded_by_user_id,api_client_id,scan_status,created_at)
  VALUES(p_company_id,v_case.customer_id,v_case.id,v_reference,p_file_name,p_declared_mime,p_byte_size,p_sha256,
    p_company_id::text||'/'||v_case.id::text||'/'||v_reference,p_visibility,'staff',p_user_id,p_client_id,'quarantined',v_now)
  RETURNING * INTO v_attachment;
  INSERT INTO public.staff_api_attachment_receipts(company_id,api_client_id,actor_user_id,resource_reference,idempotency_key,
    request_hash,attachment_id,lease_id,lease_expires_at)
  VALUES(p_company_id,p_client_id,p_user_id,p_case_reference,p_idempotency_key,p_request_hash,v_attachment.id,v_lease,v_now+interval '2 minutes');
  INSERT INTO public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
  VALUES(p_company_id,p_user_id,'customer_case_attachment',v_attachment.id::text,'staff_support_attachment_reserved','{}'::jsonb,
    jsonb_build_object('scan_status','quarantined','visibility',p_visibility,'byte_size',p_byte_size,'sha256',p_sha256),
    jsonb_build_object('customer_case_id',v_case.id,'customer_id',v_case.customer_id,'api_client_id',p_client_id,'staff_session_id',p_session_id));
  RETURN jsonb_build_object('state','acquired','lease_id',v_lease,'row',to_jsonb(v_attachment));
END $$;
REVOKE ALL ON FUNCTION public.staff_api_attachment_reserve(uuid,bigint,uuid,uuid,uuid,uuid,text,text,text,text,text,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_api_attachment_reserve(uuid,bigint,uuid,uuid,uuid,uuid,text,text,text,text,text,integer,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.staff_api_attachment_finalize(
  p_session_id uuid,p_revision bigint,p_user_id uuid,p_native_session_id uuid,p_client_id uuid,p_company_id uuid,
  p_case_reference text,p_idempotency_key text,p_request_hash text,p_attachment_reference text,p_lease_id uuid,
  p_verified_sha256 text,p_verified_byte_size integer,p_scan_status text,p_detected_mime text,p_scan_reason text,p_file_name text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_case public.customer_cases%ROWTYPE;
  v_receipt public.staff_api_attachment_receipts%ROWTYPE;
  v_attachment public.customer_case_attachments%ROWTYPE;
  v_now timestamptz;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    concat_ws(':','staff-attachment',p_company_id,p_client_id,p_user_id,p_case_reference,p_idempotency_key),0));
  SELECT * INTO v_case FROM public.customer_cases c WHERE c.company_id=p_company_id
    AND ('support_case_' || substr(translate(encode(extensions.digest('gridex-public-reference:v1:' || c.company_id::text || ':support_case:' || c.id::text,'sha256'),'base64'),'+/=','-_'),1,32))=p_case_reference
    AND (c.metadata->>'support_case'='true' OR left(c.source,15)='tenant_support_') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='support_case_not_found'; END IF;
  SELECT * INTO v_receipt FROM public.staff_api_attachment_receipts r WHERE r.company_id=p_company_id
    AND r.api_client_id=p_client_id AND r.actor_user_id=p_user_id AND r.resource_reference=p_case_reference
    AND r.idempotency_key=p_idempotency_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='attachment_not_found'; END IF;
  SELECT * INTO v_attachment FROM public.customer_case_attachments a WHERE a.company_id=p_company_id
    AND a.id=v_receipt.attachment_id AND a.customer_case_id=v_case.id AND a.customer_id=v_case.customer_id
    AND a.public_reference=p_attachment_reference FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='attachment_not_found'; END IF;
  PERFORM public.staff_api_assert_command_actor(p_session_id,p_revision,p_user_id,p_native_session_id,p_client_id,p_company_id,'cases.write');
  v_now:=clock_timestamp();
  IF v_receipt.request_hash IS DISTINCT FROM p_request_hash OR v_attachment.sha256 IS DISTINCT FROM p_verified_sha256
    OR v_attachment.byte_size IS DISTINCT FROM p_verified_byte_size THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='idempotency_conflict';
  END IF;
  IF v_receipt.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('row',to_jsonb(v_attachment),'replayed',true);
  END IF;
  IF v_case.status IN ('resolved','closed','cancelled') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='support_case_closed'; END IF;
  IF v_receipt.lease_id IS DISTINCT FROM p_lease_id OR v_receipt.lease_expires_at<=v_now THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='idempotency_in_progress';
  END IF;
  IF coalesce(p_scan_status,'') NOT IN ('released','rejected') OR length(coalesce(p_file_name,'')) NOT BETWEEN 1 AND 124
    OR (p_scan_status='released' AND (coalesce(p_detected_mime,'') NOT IN ('application/pdf','image/png','image/jpeg') OR p_scan_reason IS NOT NULL))
    OR (p_scan_status='rejected' AND (p_detected_mime IS NOT NULL OR coalesce(p_scan_reason,'') NOT IN ('empty','too_large','type_not_allowed','pdf_active_content','pdf_truncated','pdf_encoded_content'))) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_request';
  END IF;
  UPDATE public.customer_case_attachments SET scan_status=p_scan_status,detected_mime_type=p_detected_mime,
    scan_reason=p_scan_reason,file_name=p_file_name,scanned_at=v_now WHERE id=v_attachment.id AND company_id=p_company_id
    AND customer_case_id=v_case.id AND customer_id=v_case.customer_id RETURNING * INTO v_attachment;
  INSERT INTO public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
  VALUES(p_company_id,p_user_id,'customer_case_attachment',v_attachment.id::text,'staff_support_attachment_'||p_scan_status,
    jsonb_build_object('scan_status','quarantined'),jsonb_build_object('scan_status',p_scan_status,'mime_type',p_detected_mime,'scan_reason',p_scan_reason,'sha256',p_verified_sha256),
    jsonb_build_object('customer_case_id',v_case.id,'customer_id',v_case.customer_id,'api_client_id',p_client_id,'staff_session_id',p_session_id));
  UPDATE public.staff_api_attachment_receipts SET completed_at=v_now WHERE id=v_receipt.id AND company_id=p_company_id;
  RETURN jsonb_build_object('row',to_jsonb(v_attachment),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.staff_api_attachment_finalize(uuid,bigint,uuid,uuid,uuid,uuid,text,text,text,text,uuid,text,integer,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_api_attachment_finalize(uuid,bigint,uuid,uuid,uuid,uuid,text,text,text,text,uuid,text,integer,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.staff_api_attachment_release(
  p_session_id uuid,p_revision bigint,p_user_id uuid,p_native_session_id uuid,p_client_id uuid,p_company_id uuid,
  p_case_reference text,p_idempotency_key text,p_request_hash text,p_attachment_reference text,p_lease_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_case public.customer_cases%ROWTYPE; v_receipt public.staff_api_attachment_receipts%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    concat_ws(':','staff-attachment',p_company_id,p_client_id,p_user_id,p_case_reference,p_idempotency_key),0));
  SELECT * INTO v_case FROM public.customer_cases c WHERE c.company_id=p_company_id
    AND ('support_case_' || substr(translate(encode(extensions.digest('gridex-public-reference:v1:' || c.company_id::text || ':support_case:' || c.id::text,'sha256'),'base64'),'+/=','-_'),1,32))=p_case_reference
    AND (c.metadata->>'support_case'='true' OR left(c.source,15)='tenant_support_') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='support_case_not_found'; END IF;
  SELECT r.* INTO v_receipt FROM public.staff_api_attachment_receipts r
    JOIN public.customer_case_attachments a ON a.company_id=r.company_id AND a.id=r.attachment_id
    WHERE r.company_id=p_company_id AND r.api_client_id=p_client_id AND r.actor_user_id=p_user_id
    AND r.resource_reference=p_case_reference AND r.idempotency_key=p_idempotency_key
    AND a.public_reference=p_attachment_reference AND a.customer_case_id=v_case.id AND a.customer_id=v_case.customer_id FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='attachment_not_found'; END IF;
  PERFORM public.staff_api_assert_command_actor(p_session_id,p_revision,p_user_id,p_native_session_id,p_client_id,p_company_id,'cases.write');
  IF v_receipt.request_hash IS DISTINCT FROM p_request_hash THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='idempotency_conflict'; END IF;
  IF v_receipt.completed_at IS NULL AND v_receipt.lease_id=p_lease_id THEN
    UPDATE public.staff_api_attachment_receipts SET lease_expires_at=clock_timestamp() WHERE id=v_receipt.id AND company_id=p_company_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.staff_api_attachment_release(uuid,bigint,uuid,uuid,uuid,uuid,text,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_api_attachment_release(uuid,bigint,uuid,uuid,uuid,uuid,text,text,text,text,uuid) TO service_role;

COMMIT;
