-- Standalone staff resource boundary. No browser table/function privileges.
CREATE OR REPLACE FUNCTION public.staff_api_public_reference(p_kind text, p_company_id uuid, p_id uuid)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path = '' AS $$
  SELECT p_kind || '_' || substr(translate(encode(extensions.digest(
    'gridex-public-reference:v1:' || p_company_id::text || ':' || p_kind || ':' || p_id::text,
    'sha256'), 'base64'), '+/=', '-_'), 1, 32)
$$;
REVOKE ALL ON FUNCTION public.staff_api_public_reference(text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_api_public_reference(text,uuid,uuid) TO service_role;
-- Inline the pure derivation in index expressions: existing authenticated
-- native writes must not need EXECUTE on a private staff resolver function.
-- Lookups below use the same expression so the reference indexes remain usable.
CREATE INDEX IF NOT EXISTS staff_api_customers_reference_idx ON public.customers(company_id,
  ('customer_' || substr(translate(encode(extensions.digest('gridex-public-reference:v1:' || company_id::text || ':customer:' || id::text,'sha256'),'base64'),'+/=','-_'),1,32)));
CREATE INDEX IF NOT EXISTS staff_api_cases_reference_idx ON public.customer_cases(company_id,
  ('support_case_' || substr(translate(encode(extensions.digest('gridex-public-reference:v1:' || company_id::text || ':support_case:' || id::text,'sha256'),'base64'),'+/=','-_'),1,32)));
CREATE INDEX IF NOT EXISTS staff_api_facilities_reference_idx ON public.customer_sites(company_id,
  ('facility_' || substr(translate(encode(extensions.digest('gridex-public-reference:v1:' || company_id::text || ':facility:' || id::text,'sha256'),'base64'),'+/=','-_'),1,32)));
CREATE INDEX IF NOT EXISTS staff_api_case_keyset_idx ON public.customer_cases(company_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS staff_api_entry_keyset_idx ON public.customer_case_events(company_id,customer_case_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS staff_api_attachment_keyset_idx ON public.customer_case_attachments(company_id,customer_case_id,created_at DESC,id DESC);

CREATE TABLE public.staff_api_support_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  api_client_id uuid NOT NULL REFERENCES public.integration_api_clients(id),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  operation text NOT NULL,
  resource_reference text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE(company_id,api_client_id,actor_user_id,operation,resource_reference,idempotency_key)
);
ALTER TABLE public.staff_api_support_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_api_support_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.staff_api_support_receipts TO service_role;
INSERT INTO public.platform_table_classification(table_name,kind,rationale,null_company_meaning,classified_by)
VALUES('staff_api_support_receipts','tenant','Private actor/client-bound staff support command replay receipts.',NULL,'migration:staff_support_commands')
ON CONFLICT(table_name) DO UPDATE SET kind=EXCLUDED.kind,rationale=EXCLUDED.rationale,
  null_company_meaning=EXCLUDED.null_company_meaning,classified_by=EXCLUDED.classified_by,classified_at=now();

CREATE OR REPLACE FUNCTION public.staff_api_read_resources(
  p_company_id uuid,p_operation text,p_reference text DEFAULT NULL,p_filters jsonb DEFAULT '{}'::jsonb,
  p_after jsonb DEFAULT NULL,p_limit integer DEFAULT 51
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_case public.customer_cases%ROWTYPE;
  v_rows jsonb;
  v_q text := lower(coalesce(p_filters->>'q',''));
  v_time timestamptz := (p_after->>'created_at')::timestamptz;
  v_id uuid := (p_after->>'id')::uuid;
BEGIN
  IF p_company_id IS NULL OR p_limit NOT BETWEEN 1 AND 101 OR jsonb_typeof(p_filters)<>'object' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_request';
  END IF;
  IF p_operation IN ('customer','contacts','addresses','facilities') THEN
    SELECT * INTO v_customer FROM public.customers c WHERE c.company_id=p_company_id
      AND ('customer_' || substr(translate(encode(extensions.digest('gridex-public-reference:v1:' || c.company_id::text || ':customer:' || c.id::text,'sha256'),'base64'),'+/=','-_'),1,32))=p_reference;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='customer_not_found'; END IF;
  END IF;
  IF p_operation IN ('case','entries','attachments') THEN
    SELECT * INTO v_case FROM public.customer_cases c WHERE c.company_id=p_company_id
      AND ('support_case_' || substr(translate(encode(extensions.digest('gridex-public-reference:v1:' || c.company_id::text || ':support_case:' || c.id::text,'sha256'),'base64'),'+/=','-_'),1,32))=p_reference
      AND (c.metadata->>'support_case'='true' OR left(c.source,15)='tenant_support_');
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='support_case_not_found'; END IF;
  END IF;
  IF p_operation IN ('customers','customer') THEN
    SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO v_rows FROM (
      SELECT c.id,c.customer_number,c.customer_type,c.status,c.full_name,c.first_name,c.last_name,c.company_name,
        c.email,c.phone,c.created_at,c.updated_at,c.personal_number,c.org_number,c.apartment_number,
        c.preferred_language,c.moved_out_at,c.lifecycle_closed_at
      FROM public.customers c WHERE c.company_id=p_company_id
        AND (p_operation='customers' OR c.id=v_customer.id)
        AND (p_operation='customer' OR (coalesce(c.status,'draft') NOT IN ('deleted','deleted_test_only','pending_deletion') AND (coalesce(c.status,'draft')<>'archived' OR p_filters->>'status'='archived') AND coalesce(c.is_test_data,false)=false AND coalesce(c.source,'') NOT ILIKE '%test%'))
        AND (NOT p_filters ? 'status' OR c.status=p_filters->>'status')
        AND (NOT p_filters ? 'customer_type' OR coalesce(c.customer_type,'private')=p_filters->>'customer_type')
        AND (v_q='' OR strpos(lower(concat_ws(' ',c.full_name,c.first_name,c.last_name,c.company_name,c.customer_number,c.email,c.phone)),v_q)>0)
        AND (v_time IS NULL OR (c.created_at,c.id)<(v_time,v_id))
      ORDER BY c.created_at DESC,c.id DESC LIMIT p_limit
    ) r;
  ELSIF p_operation='contacts' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO v_rows FROM (
      SELECT c.id,c.type,c.name,c.email,c.phone,c.title,c.is_primary,c.created_at FROM public.customer_contacts c
      WHERE c.company_id=p_company_id AND c.customer_id=v_customer.id
        AND (v_time IS NULL OR (c.created_at,c.id)<(v_time,v_id)) ORDER BY c.created_at DESC,c.id DESC LIMIT p_limit
    ) r;
  ELSIF p_operation='addresses' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO v_rows FROM (
      SELECT c.id,c.type,c.street_1,c.street_2,c.postal_code,c.city,c.country,c.municipality,c.moved_in_at,c.moved_out_at,c.is_active,c.created_at FROM public.customer_addresses c
      WHERE c.company_id=p_company_id AND c.customer_id=v_customer.id
        AND (v_time IS NULL OR (c.created_at,c.id)<(v_time,v_id)) ORDER BY c.created_at DESC,c.id DESC LIMIT p_limit
    ) r;
  ELSIF p_operation='facilities' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO v_rows FROM (
      SELECT c.id,c.site_name,c.facility_id,c.site_type,c.status,c.street,c.care_of,c.postal_code,c.city,c.country,c.grid_area_code,c.price_area_code,c.move_in_date,c.move_out_date,c.created_at,c.updated_at FROM public.customer_sites c
      WHERE c.company_id=p_company_id AND c.customer_id=v_customer.id
        AND (v_time IS NULL OR (c.created_at,c.id)<(v_time,v_id)) ORDER BY c.created_at DESC,c.id DESC LIMIT p_limit
    ) r;
  ELSIF p_operation IN ('cases','case') THEN
    SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO v_rows FROM (
      SELECT c.id,c.customer_id,c.site_id,c.title,c.description,c.reason_category,c.status,c.priority,c.next_action,c.next_action_due_at,
        c.created_at,c.updated_at,c.resolved_at,c.closed_at,CASE WHEN u.id IS NULL THEN NULL ELSE c.assigned_to END AS assigned_to,u.full_name AS assignee_name,
        c.metadata->>'description_visibility' AS description_visibility,c.metadata->>'support_channel' AS support_channel,
        customer.customer_number,coalesce(nullif(customer.full_name,''),nullif(customer.company_name,''),nullif(concat_ws(' ',customer.first_name,customer.last_name),'')) AS customer_display_name
      FROM public.customer_cases c JOIN public.customers customer ON customer.id=c.customer_id AND customer.company_id=c.company_id
      LEFT JOIN public.user_profiles u ON u.id=c.assigned_to AND EXISTS(SELECT 1 FROM public.company_memberships m WHERE m.user_id=u.id AND m.company_id=p_company_id)
      WHERE c.company_id=p_company_id AND (c.metadata->>'support_case'='true' OR left(c.source,15)='tenant_support_')
        AND (p_operation='cases' OR c.id=v_case.id)
        AND (NOT p_filters ? 'status' OR c.status=p_filters->>'status')
        AND (NOT p_filters ? 'priority' OR c.priority=p_filters->>'priority')
        AND (NOT p_filters ? 'customer_reference' OR public.staff_api_public_reference('customer',c.company_id,c.customer_id)=p_filters->>'customer_reference')
        AND (NOT p_filters ? 'assignee_reference' OR public.staff_api_public_reference('staff',c.company_id,c.assigned_to)=p_filters->>'assignee_reference')
        AND (v_q='' OR strpos(lower(concat_ws(' ',c.title,c.reason_category)),v_q)>0)
        AND (v_time IS NULL OR (c.created_at,c.id)<(v_time,v_id)) ORDER BY c.created_at DESC,c.id DESC LIMIT p_limit
    ) r;
  ELSIF p_operation='entries' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO v_rows FROM (
      SELECT e.id,e.customer_case_id,e.event_type,e.message,e.payload,CASE WHEN u.id IS NULL THEN NULL ELSE e.created_by END AS created_by,e.created_at,u.full_name AS author_name
      FROM public.customer_case_events e LEFT JOIN public.user_profiles u ON u.id=e.created_by AND EXISTS(SELECT 1 FROM public.company_memberships m WHERE m.user_id=u.id AND m.company_id=p_company_id)
      WHERE e.company_id=p_company_id AND e.customer_id=v_case.customer_id AND e.customer_case_id=v_case.id
        AND e.event_type IN ('support_customer_message','support_staff_reply','support_internal_note','support_phone_interaction','created','status_changed','assignment_changed')
        AND (v_time IS NULL OR (e.created_at,e.id)<(v_time,v_id)) ORDER BY e.created_at DESC,e.id DESC LIMIT p_limit
    ) r;
  ELSIF p_operation='attachments' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO v_rows FROM (
      SELECT a.id,a.public_reference,a.file_name,a.detected_mime_type,a.byte_size,a.sha256,a.visibility,a.uploaded_by_kind,a.scan_status,a.scan_reason,a.created_at
      FROM public.customer_case_attachments a WHERE a.company_id=p_company_id AND a.customer_id=v_case.customer_id AND a.customer_case_id=v_case.id
        AND (v_time IS NULL OR (a.created_at,a.id)<(v_time,v_id)) ORDER BY a.created_at DESC,a.id DESC LIMIT p_limit
    ) r;
  ELSIF p_operation='assignees' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO v_rows FROM (
      SELECT u.id,u.full_name,u.created_at FROM public.user_profiles u
      WHERE public.staff_api_actor_is_eligible_assignee(u.id,p_company_id)
        AND (v_q='' OR strpos(lower(coalesce(u.full_name,'')),v_q)>0)
        AND (v_time IS NULL OR (u.created_at,u.id)<(v_time,v_id)) ORDER BY u.created_at DESC,u.id DESC LIMIT p_limit
    ) r;
  ELSE RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_request';
  END IF;
  RETURN jsonb_build_object('rows',v_rows);
END $$;
REVOKE ALL ON FUNCTION public.staff_api_read_resources(uuid,text,text,jsonb,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_api_read_resources(uuid,text,text,jsonb,jsonb,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.staff_api_support_command(
  p_session_id uuid,p_revision bigint,p_user_id uuid,p_native_session_id uuid,p_client_id uuid,p_company_id uuid,
  p_operation text,p_reference text,p_idempotency_key text,p_request_hash text,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_receipt public.staff_api_support_receipts%ROWTYPE;
  v_case public.customer_cases%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_event public.customer_case_events%ROWTYPE;
  v_site_id uuid;
  v_assignee uuid;
  v_before jsonb;
  v_response jsonb;
  v_now timestamptz;
  v_kind text;
  v_visibility text;
  v_message text;
  v_prior_status_events uuid[];
BEGIN
  PERFORM public.staff_api_assert_command_actor(p_session_id,p_revision,p_user_id,p_native_session_id,p_client_id,p_company_id,'cases.write');
  IF coalesce(p_operation,'') NOT IN ('create','reply','note','status','assignment') OR coalesce(p_request_hash,'') !~ '^[0-9a-f]{64}$'
     OR length(coalesce(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 OR p_idempotency_key !~ '^[A-Za-z0-9._:+~-]+$'
     OR coalesce(jsonb_typeof(p_payload),'')<>'object' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_request';
  END IF;
  -- Serializes matching operations across instances; hash collisions only serialize unrelated work.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(concat_ws(':',p_company_id,p_client_id,p_user_id,p_operation,coalesce(p_reference,''),p_idempotency_key),0));
  PERFORM public.staff_api_assert_command_actor(p_session_id,p_revision,p_user_id,p_native_session_id,p_client_id,p_company_id,'cases.write');
  SELECT * INTO v_receipt FROM public.staff_api_support_receipts WHERE company_id=p_company_id AND api_client_id=p_client_id
    AND actor_user_id=p_user_id AND operation=p_operation AND resource_reference=coalesce(p_reference,'') AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='idempotency_conflict'; END IF;
    IF v_receipt.response IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='idempotency_in_progress'; END IF;
    -- Check current target after authorization and before disclosing an old receipt.
    IF NOT EXISTS(SELECT 1 FROM public.customer_cases c WHERE c.company_id=p_company_id
      AND ('support_case_' || substr(translate(encode(extensions.digest('gridex-public-reference:v1:' || c.company_id::text || ':support_case:' || c.id::text,'sha256'),'base64'),'+/=','-_'),1,32))=v_receipt.response->>'case_reference'
      AND (c.metadata->>'support_case'='true' OR left(c.source,15)='tenant_support_')) THEN
      RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='support_case_not_found';
    END IF;
    RETURN jsonb_build_object('data',v_receipt.response,'replayed',true);
  END IF;
  -- Shared across all staff mutations. An authorized exact replay does not
  -- consume another mutation; a rolled-back command does not spend a slot.
  IF NOT public.staff_api_consume_auth_budget(
    encode(extensions.digest(concat_ws(':','staff-mutation',p_company_id,p_client_id,p_user_id),'sha256'),'hex'),20,60
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='staff_rate_limited';
  END IF;
  PERFORM public.staff_api_assert_command_actor(p_session_id,p_revision,p_user_id,p_native_session_id,p_client_id,p_company_id,'cases.write');
  INSERT INTO public.staff_api_support_receipts(company_id,api_client_id,actor_user_id,operation,resource_reference,idempotency_key,request_hash)
    VALUES(p_company_id,p_client_id,p_user_id,p_operation,coalesce(p_reference,''),p_idempotency_key,p_request_hash) RETURNING * INTO v_receipt;
  IF p_operation='create' THEN
    SELECT * INTO v_customer FROM public.customers c WHERE c.company_id=p_company_id
      AND ('customer_' || substr(translate(encode(extensions.digest('gridex-public-reference:v1:' || c.company_id::text || ':customer:' || c.id::text,'sha256'),'base64'),'+/=','-_'),1,32))=p_payload->>'customer_reference' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='customer_not_found'; END IF;
    IF coalesce(v_customer.status,'') IN ('merged','deleted','pending_deletion','deleted_test_only') OR v_customer.merged_into_customer_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='customer_not_found';
    END IF;
    IF p_payload->>'facility_reference' IS NOT NULL THEN
      SELECT s.id INTO v_site_id FROM public.customer_sites s WHERE s.company_id=p_company_id AND s.customer_id=v_customer.id
        AND ('facility_' || substr(translate(encode(extensions.digest('gridex-public-reference:v1:' || s.company_id::text || ':facility:' || s.id::text,'sha256'),'base64'),'+/=','-_'),1,32))=p_payload->>'facility_reference' FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='customer_not_found'; END IF;
    END IF;
    PERFORM public.staff_api_assert_command_actor(p_session_id,p_revision,p_user_id,p_native_session_id,p_client_id,p_company_id,'cases.write');
    v_now:=clock_timestamp();
    IF length(coalesce(p_payload->>'title','')) NOT BETWEEN 1 AND 180 OR length(coalesce(p_payload->>'description',''))>8000
      OR length(coalesce(p_payload->>'category',''))>120 OR p_payload->>'priority' NOT IN ('low','normal','high','urgent') THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_request';
    END IF;
    INSERT INTO public.customer_cases(company_id,customer_id,site_id,case_type,status,priority,title,description,reason_category,source,metadata,created_by,updated_by,created_at,updated_at)
      VALUES(p_company_id,v_customer.id,v_site_id,'other','open',p_payload->>'priority',p_payload->>'title',p_payload->>'description',p_payload->>'category','tenant_support_admin',
        jsonb_build_object('support_case',true,'support_channel','admin','opened_by','staff','description_visibility','internal'),p_user_id,p_user_id,v_now,v_now) RETURNING * INTO v_case;
    UPDATE public.customer_cases SET metadata=metadata||jsonb_build_object('support_public_reference',public.staff_api_public_reference('support_case',p_company_id,id)) WHERE id=v_case.id;
    v_kind:='created'; v_visibility:='internal'; v_message:='Supportärende registrerat.';
  ELSE
    SELECT * INTO v_case FROM public.customer_cases c WHERE c.company_id=p_company_id
      AND ('support_case_' || substr(translate(encode(extensions.digest('gridex-public-reference:v1:' || c.company_id::text || ':support_case:' || c.id::text,'sha256'),'base64'),'+/=','-_'),1,32))=p_reference
      AND (c.metadata->>'support_case'='true' OR left(c.source,15)='tenant_support_') FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='support_case_not_found'; END IF;
    PERFORM public.staff_api_assert_command_actor(p_session_id,p_revision,p_user_id,p_native_session_id,p_client_id,p_company_id,'cases.write');
    v_now:=clock_timestamp();
    v_before:=jsonb_build_object('status',v_case.status,'assigned_to',v_case.assigned_to);
    IF p_operation IN ('reply','note') AND v_case.status IN ('resolved','closed','cancelled') THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='support_case_closed';
    END IF;
    IF p_operation IN ('status','assignment') AND (p_payload->>'expected_updated_at')::timestamptz IS DISTINCT FROM v_case.updated_at THEN
      RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='support_case_version_conflict';
    END IF;
    IF p_operation IN ('reply','note') THEN
      IF length(coalesce(p_payload->>'message','')) NOT BETWEEN 1 AND 8000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_request'; END IF;
      IF p_operation='reply' AND p_payload->>'kind' NOT IN ('message','phone_summary') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_request'; END IF;
      v_kind:=CASE WHEN p_operation='reply' THEN 'support_staff_reply' ELSE 'support_internal_note' END;
      v_visibility:=CASE WHEN p_operation='reply' THEN 'customer' ELSE 'internal' END; v_message:=p_payload->>'message';
    ELSIF p_operation='status' THEN
      IF p_payload->>'status' NOT IN ('open','action_required','awaiting_external_response','manual_follow_up','resolved','closed') THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_request';
      END IF;
      -- Existing native RPC preserves its own actor gate and atomic case/event/audit semantics.
      SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO v_prior_status_events FROM public.customer_case_events
        WHERE customer_case_id=v_case.id AND company_id=p_company_id AND event_type='status_changed';
      PERFORM public.gridex_update_customer_case_status(v_case.id,p_company_id,p_payload->>'status',p_user_id,NULL,p_payload->>'message');
      SELECT * INTO v_case FROM public.customer_cases WHERE id=v_case.id AND company_id=p_company_id;
      SELECT * INTO v_event FROM public.customer_case_events WHERE customer_case_id=v_case.id AND company_id=p_company_id
        AND event_type='status_changed' AND NOT(id=ANY(v_prior_status_events));
      IF NOT FOUND THEN RAISE EXCEPTION 'Staff status event missing'; END IF;
    ELSE
      IF p_payload->>'assignee_reference' IS NOT NULL THEN
        SELECT u.id INTO v_assignee FROM public.user_profiles u JOIN public.company_memberships m ON m.user_id=u.id AND m.company_id=p_company_id
          WHERE public.staff_api_public_reference('staff',p_company_id,u.id)=p_payload->>'assignee_reference'
          AND public.staff_api_actor_is_eligible_assignee(u.id,p_company_id)
          FOR SHARE OF u,m;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='support_assignee_ineligible'; END IF;
      END IF;
      PERFORM public.staff_api_assert_command_actor(p_session_id,p_revision,p_user_id,p_native_session_id,p_client_id,p_company_id,'cases.write');
      v_now:=clock_timestamp();
      UPDATE public.customer_cases SET assigned_to=v_assignee,updated_by=p_user_id,updated_at=v_now WHERE id=v_case.id AND company_id=p_company_id RETURNING * INTO v_case;
      v_kind:='assignment_changed'; v_visibility:='internal'; v_message:='Handläggare uppdaterad.';
    END IF;
  END IF;
  IF p_operation<>'status' THEN
    IF p_operation IN ('reply','note') THEN
      UPDATE public.customer_cases SET updated_by=p_user_id,updated_at=v_now WHERE id=v_case.id AND company_id=p_company_id RETURNING * INTO v_case;
    END IF;
    INSERT INTO public.customer_case_events(company_id,customer_case_id,customer_id,event_type,event_status,message,payload,created_by,created_at)
      VALUES(p_company_id,v_case.id,v_case.customer_id,v_kind,'info',v_message,
        jsonb_build_object('visibility',v_visibility,'author_type','staff','channel','ops','kind',CASE WHEN p_operation='reply' THEN p_payload->>'kind' ELSE NULL END,'assigned_to',v_case.assigned_to),p_user_id,v_now) RETURNING * INTO v_event;
  END IF;
  -- Native status keeps its own domain audit; this staff boundary audit binds every command to its client/session.
  INSERT INTO public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
    VALUES(p_company_id,p_user_id,'customer_case',v_case.id::text,'staff_support_'||p_operation,coalesce(v_before,'{}'::jsonb),
      jsonb_build_object('status',v_case.status,'assigned_to',v_case.assigned_to,'entry_id',v_event.id),
      jsonb_build_object('customer_id',v_case.customer_id,'api_client_id',p_client_id,'staff_session_id',p_session_id));
  IF p_operation IN ('reply','note') THEN
    v_response:=jsonb_build_object('entry_reference',public.staff_api_public_reference('support_message',p_company_id,v_event.id),
      'case_reference',public.staff_api_public_reference('support_case',p_company_id,v_case.id),'kind',CASE WHEN p_operation='reply' THEN 'staff_reply' ELSE 'internal_note' END,
      'visibility',v_visibility,'author_type','staff','author',jsonb_build_object('staff_reference',public.staff_api_public_reference('staff',p_company_id,p_user_id),'display_name',(SELECT coalesce(nullif(full_name,''),'Personal') FROM public.user_profiles WHERE id=p_user_id)),
      'body',v_message,'created_at',v_event.created_at);
    IF p_operation='reply' THEN v_response:=v_response||jsonb_build_object('reply_kind',p_payload->>'kind'); END IF;
  ELSE
    v_response:=jsonb_build_object('case_reference',public.staff_api_public_reference('support_case',p_company_id,v_case.id),'status',v_case.status,'updated_at',v_case.updated_at);
    IF p_operation='create' THEN v_response:=v_response||jsonb_build_object('customer_reference',public.staff_api_public_reference('customer',p_company_id,v_case.customer_id),'priority',v_case.priority,'created_at',v_case.created_at);
    ELSE v_response:=v_response||jsonb_build_object('assigned_to',public.staff_api_public_reference('staff',p_company_id,v_case.assigned_to),'entry_reference',public.staff_api_public_reference('support_message',p_company_id,v_event.id)); END IF;
  END IF;
  UPDATE public.staff_api_support_receipts SET response=v_response,completed_at=clock_timestamp() WHERE id=v_receipt.id AND company_id=p_company_id;
  RETURN jsonb_build_object('data',v_response,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.staff_api_support_command(uuid,bigint,uuid,uuid,uuid,uuid,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_api_support_command(uuid,bigint,uuid,uuid,uuid,uuid,text,text,text,text,jsonb) TO service_role;
