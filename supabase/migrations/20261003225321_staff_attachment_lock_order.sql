-- Match the shared mutation budget and attachment INSERT trigger lock order
-- across staff commands and native/customer paths. Preserve private RPC ACLs.
BEGIN;

CREATE OR REPLACE FUNCTION public.staff_api_attachment_reserve(
  p_session_id uuid,p_revision bigint,p_user_id uuid,p_native_session_id uuid,p_client_id uuid,p_company_id uuid,
  p_case_reference text,p_idempotency_key text,p_request_hash text,p_file_name text,p_declared_mime text,
  p_byte_size integer,p_sha256 text,p_visibility text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_case public.customer_cases%ROWTYPE;
  v_observed_case_id uuid;
  v_observed_customer_id uuid;
  v_receipt public.staff_api_attachment_receipts%ROWTYPE;
  v_attachment public.customer_case_attachments%ROWTYPE;
  v_now timestamptz;
  v_lease uuid;
  v_reference text;
BEGIN
  PERFORM public.staff_api_assert_command_actor(p_session_id,p_revision,p_user_id,p_native_session_id,p_client_id,p_company_id,'cases.write');
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
  -- The same idempotency lock is taken by reserve/finalize/release. Inspect
  -- whether this is genuinely new without taking a receipt/content row lock.
  -- Core support commands acquire this shared actor budget before their case
  -- lock, so new attachment reservations must do that too. Replay/resume do
  -- not spend another slot; any failed reservation rolls its budget back.
  SELECT * INTO v_receipt FROM public.staff_api_attachment_receipts r WHERE r.company_id=p_company_id
    AND r.api_client_id=p_client_id AND r.actor_user_id=p_user_id AND r.resource_reference=p_case_reference
    AND r.idempotency_key=p_idempotency_key;
  IF v_receipt.id IS NULL THEN
    IF NOT public.staff_api_consume_auth_budget(encode(extensions.digest(
      concat_ws(':','staff-mutation',p_company_id,p_client_id,p_user_id),'sha256'),'hex'),20,60) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='staff_rate_limited';
    END IF;
    PERFORM public.staff_api_assert_command_actor(p_session_id,p_revision,p_user_id,p_native_session_id,p_client_id,p_company_id,'cases.write');
  END IF;
  -- Native/customer INSERTs acquire the quota advisory lock in their BEFORE
  -- trigger, then a case KEY SHARE lock for the attachment foreign key. Acquire
  -- that same quota lock before any staff case/receipt/content row lock.
  SELECT c.id,c.customer_id INTO v_observed_case_id,v_observed_customer_id
    FROM public.customer_cases c WHERE c.company_id=p_company_id
    AND ('support_case_' || substr(translate(encode(extensions.digest('gridex-public-reference:v1:' || c.company_id::text || ':support_case:' || c.id::text,'sha256'),'base64'),'+/=','-_'),1,32))=p_case_reference
    AND (c.metadata->>'support_case'='true' OR left(c.source,15)='tenant_support_');
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='support_case_not_found'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    concat_ws(':','support-attachment-quota',p_company_id,v_observed_customer_id),0));
  -- Re-read under the row lock after the quota wait. Never reserve under the
  -- observed customer's quota if the current case now belongs to another one.
  SELECT * INTO v_case FROM public.customer_cases c WHERE c.company_id=p_company_id
    AND c.id=v_observed_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='support_case_not_found'; END IF;
  IF v_case.customer_id IS DISTINCT FROM v_observed_customer_id THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='support_case_version_conflict';
  END IF;
  IF NOT coalesce(v_case.metadata->>'support_case'='true' OR left(v_case.source,15)='tenant_support_',false) THEN
    RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='support_case_not_found';
  END IF;
  SELECT * INTO v_receipt FROM public.staff_api_attachment_receipts r WHERE r.company_id=p_company_id
    AND r.api_client_id=p_client_id AND r.actor_user_id=p_user_id AND r.resource_reference=p_case_reference
    AND r.idempotency_key=p_idempotency_key FOR UPDATE;
  IF v_receipt.id IS NOT NULL THEN
    SELECT * INTO v_attachment FROM public.customer_case_attachments a WHERE a.company_id=p_company_id
      AND a.id=v_receipt.attachment_id AND a.customer_case_id=v_case.id AND a.customer_id=v_case.customer_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='attachment_not_found'; END IF;
  END IF;
  -- Reauthorize after all quota/case/receipt/content waits before replay or mutation.
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

COMMIT;
