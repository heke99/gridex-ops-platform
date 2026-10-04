-- S4: atomic staff support work and auditable channel attribution. Depends on S3 actor guard.
BEGIN;

UPDATE public.customer_cases c SET metadata=c.metadata || jsonb_build_object('support_public_reference',
  'support_case_' || substr(translate(rtrim(encode(extensions.digest(
    'gridex-public-reference:v1:'||c.company_id::text||':support_case:'||c.id::text,'sha256'),'base64'),'='),'+/','-_'),1,32))
WHERE c.metadata->>'support_case'='true' AND c.case_type='other' AND strpos(c.source,'tenant_support_')=1 AND NOT c.billing_blocked AND NOT c.billing_manual_review AND NOT c.cancellation_required AND NOT c.metadata ? 'support_public_reference';
CREATE UNIQUE INDEX customer_cases_support_public_reference_uidx
  ON public.customer_cases(company_id,(metadata->>'support_public_reference')) WHERE metadata->>'support_case'='true';

CREATE FUNCTION public.gridex_staff_support_event(p_company_id uuid,p_case_id uuid,p_customer_id uuid,
  p_actor_user_id uuid,p_api_client_id uuid,p_event_type text,p_message text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_case public.customer_cases%ROWTYPE; v_event public.customer_case_events%ROWTYPE; v_payload jsonb;
BEGIN
  PERFORM public.gridex_staff_assert_write_actor_v1(p_company_id,p_actor_user_id,p_api_client_id,'cases.write');
  SELECT * INTO v_case FROM public.customer_cases WHERE company_id=p_company_id AND id=p_case_id
    AND customer_id=p_customer_id AND metadata->>'support_case'='true' AND case_type='other' AND strpos(source,'tenant_support_')=1 AND NOT billing_blocked AND NOT billing_manual_review AND NOT cancellation_required FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'support_case_not_found' USING ERRCODE='P0002'; END IF;
  IF p_event_type NOT IN ('support_staff_reply','support_internal_note','support_phone_interaction') OR p_event_type IS NULL
    OR p_message IS NULL OR length(btrim(p_message)) NOT BETWEEN 1 AND 20000 THEN
    RAISE EXCEPTION 'support_event_invalid' USING ERRCODE='22023';
  END IF;
  v_payload:=coalesce(p_payload,'{}'::jsonb)||jsonb_build_object('channel','staff_api','api_client_id',p_api_client_id,
    'actor_user_id',p_actor_user_id,'author_type','staff',
    'visibility',CASE WHEN p_event_type='support_staff_reply' THEN 'customer' ELSE 'internal' END);
  INSERT INTO public.customer_case_events(company_id,customer_case_id,customer_id,event_type,event_status,message,payload,created_by)
    VALUES(p_company_id,p_case_id,p_customer_id,p_event_type,'info',p_message,v_payload,p_actor_user_id)
    RETURNING * INTO v_event;
  INSERT INTO public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,metadata)
    VALUES(p_company_id,p_actor_user_id,'customer_case',p_case_id::text,'support_'||p_event_type,
      jsonb_build_object('channel','staff_api','api_client_id',p_api_client_id,'customer_id',p_customer_id,'event_id',v_event.id));
  RETURN to_jsonb(v_event);
END$$;
REVOKE ALL ON FUNCTION public.gridex_staff_support_event(uuid,uuid,uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_staff_support_event(uuid,uuid,uuid,uuid,uuid,text,text,jsonb) TO service_role;

CREATE FUNCTION public.gridex_assign_customer_case(p_company_id uuid,p_case_id uuid,p_actor_user_id uuid,
  p_assignee_user_id uuid,p_api_client_id uuid,p_expected_source text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_case public.customer_cases%ROWTYPE; v_old_assignee uuid; v_now timestamptz:=clock_timestamp();
BEGIN
  PERFORM public.gridex_staff_assert_write_actor_v1(p_company_id,p_actor_user_id,p_api_client_id,'cases.write');
  -- Lock memberships in deterministic user order so two opposing assignments do not deadlock.
  PERFORM 1 FROM public.company_memberships WHERE company_id=p_company_id
    AND user_id IN(p_actor_user_id,p_assignee_user_id) ORDER BY user_id FOR SHARE;
  IF p_assignee_user_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.company_memberships cm JOIN public.user_profiles up ON up.id=cm.user_id
    WHERE cm.company_id=p_company_id AND cm.user_id=p_assignee_user_id AND cm.status='active' AND cm.is_active
      AND up.user_status='active'
  ) THEN RAISE EXCEPTION 'support_assignee_not_active_in_company' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_case FROM public.customer_cases WHERE company_id=p_company_id AND id=p_case_id
    AND metadata->>'support_case'='true' AND case_type='other' AND strpos(source,'tenant_support_')=1 AND NOT billing_blocked AND NOT billing_manual_review AND NOT cancellation_required AND (p_expected_source IS NULL OR source=p_expected_source) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'support_case_not_found' USING ERRCODE='P0002'; END IF;
  v_old_assignee:=v_case.assigned_to;
  UPDATE public.customer_cases SET assigned_to=p_assignee_user_id,updated_by=p_actor_user_id,updated_at=v_now
    WHERE company_id=p_company_id AND id=p_case_id RETURNING * INTO v_case;
  INSERT INTO public.customer_case_events(company_id,customer_case_id,customer_id,event_type,event_status,message,payload,created_by)
    VALUES(p_company_id,p_case_id,v_case.customer_id,'assigned','info','Ärendets tilldelning uppdaterades.',
      jsonb_build_object('channel','staff_api','api_client_id',p_api_client_id,'actor_user_id',p_actor_user_id,
        'from',v_old_assignee,'to',p_assignee_user_id,'visibility','internal'),p_actor_user_id);
  INSERT INTO public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
    VALUES(p_company_id,p_actor_user_id,'customer_case',p_case_id::text,'customer_case_assignee_changed',
      jsonb_build_object('assigned_to',v_old_assignee),jsonb_build_object('assigned_to',p_assignee_user_id),
      jsonb_build_object('channel','staff_api','api_client_id',p_api_client_id,'customer_id',v_case.customer_id));
  RETURN to_jsonb(v_case);
END$$;
REVOKE ALL ON FUNCTION public.gridex_assign_customer_case(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_assign_customer_case(uuid,uuid,uuid,uuid,uuid,text) TO service_role;

CREATE FUNCTION public.gridex_update_customer_case_status_with_actor_v1(
  p_case_id uuid,
  p_company_id uuid,
  p_status text,
  p_actor_user_id uuid,
  p_expected_source text,
  p_message text,
  p_channel text,
  p_api_client_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_case public.customer_cases%ROWTYPE;
  v_old_status text;
  v_is_platform boolean;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_case FROM public.customer_cases
    WHERE id=p_case_id AND company_id=p_company_id
      AND (p_expected_source IS NULL OR source=p_expected_source)
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='customer_case_not_found_in_scope';
  END IF;

  v_is_platform := public.canonical_actor_is_platform_admin(p_actor_user_id);
  -- Ediel's operational view is tenant-write only, even when the optional
  -- expected-source argument is omitted. Support retains its platform actor
  -- behavior, still subject to real selected-company membership below.
  IF v_case.source='ediel_inbound_state_machine' AND v_is_platform THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='ediel_case_status_requires_tenant_actor';
  END IF;

  -- The existing scoped permission resolver checks the auth user for deletion
  -- and bans inside its established definer boundary; do not grant this
  -- invoker direct access to auth.users.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles up
    JOIN public.company_memberships cm ON cm.user_id=up.id AND cm.company_id=v_case.company_id
    JOIN public.companies c ON c.id=cm.company_id
    WHERE up.id=p_actor_user_id AND up.user_status='active'
      AND cm.status='active' AND coalesce(cm.is_active,true)
      AND c.status IN ('active','onboarding') AND coalesce(c.is_active,true)
  ) OR NOT (coalesce(v_is_platform,false) OR coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,v_case.company_id,'cases.write'),false))
  THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='customer_case_status_actor_not_authorized';
  END IF;

  v_old_status := v_case.status;
  UPDATE public.customer_cases SET status=p_status, updated_by=p_actor_user_id, updated_at=v_now,
    resolved_at=CASE WHEN p_status='resolved' THEN v_now ELSE resolved_at END,
    closed_at=CASE WHEN p_status='closed' THEN v_now ELSE closed_at END
    WHERE id=v_case.id AND company_id=v_case.company_id
    RETURNING * INTO v_case;

  INSERT INTO public.customer_case_events(
    company_id,customer_case_id,customer_id,event_type,event_status,message,payload,created_by
  ) VALUES (
    v_case.company_id,v_case.id,v_case.customer_id,'status_changed',
    CASE WHEN p_status IN ('closed','resolved') THEN 'success' ELSE 'info' END,
    coalesce(nullif(btrim(p_message),''),'Ärendet uppdaterades till '||p_status||'.'),
    jsonb_build_object('status',p_status,'channel',p_channel,'api_client_id',p_api_client_id,'actor_user_id',p_actor_user_id),p_actor_user_id
  );
  -- The canonical audit trigger fills required actor/request/resource context.
  -- Neither an event error nor an audit error is swallowed: all three writes
  -- belong to this one database transaction and roll back together.
  INSERT INTO public.audit_logs(
    company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata
  ) VALUES (
    v_case.company_id,p_actor_user_id,'customer_case',v_case.id::text,'customer_case_status_changed',
    jsonb_build_object('status',v_old_status),
    jsonb_build_object('status',p_status,'message',p_message),
    jsonb_build_object('customer_id',v_case.customer_id,'channel',p_channel,'api_client_id',p_api_client_id)
  );
  RETURN to_jsonb(v_case);
END
$$;
REVOKE ALL ON FUNCTION public.gridex_update_customer_case_status_with_actor_v1(uuid,uuid,text,uuid,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_update_customer_case_status_with_actor_v1(uuid,uuid,text,uuid,text,text,text,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.gridex_update_customer_case_status(p_case_id uuid,p_company_id uuid,p_status text,
  p_actor_user_id uuid,p_expected_source text DEFAULT NULL,p_message text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT public.gridex_update_customer_case_status_with_actor_v1(p_case_id,p_company_id,p_status,p_actor_user_id,p_expected_source,p_message,'ops',NULL)
$$;

CREATE FUNCTION public.gridex_staff_update_customer_case_status(p_company_id uuid,p_case_id uuid,p_actor_user_id uuid,
  p_api_client_id uuid,p_status text,p_expected_source text DEFAULT NULL,p_message text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM public.gridex_staff_assert_write_actor_v1(p_company_id,p_actor_user_id,p_api_client_id,'cases.write');
  PERFORM 1 FROM public.customer_cases WHERE company_id=p_company_id AND id=p_case_id
    AND metadata->>'support_case'='true' AND case_type='other' AND strpos(source,'tenant_support_')=1 AND NOT billing_blocked AND NOT billing_manual_review AND NOT cancellation_required AND (p_expected_source IS NULL OR source=p_expected_source) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'support_case_not_found' USING ERRCODE='P0002'; END IF;
  RETURN public.gridex_update_customer_case_status_with_actor_v1(p_case_id,p_company_id,p_status,p_actor_user_id,
    p_expected_source,p_message,'staff_api',p_api_client_id);
END$$;
REVOKE ALL ON FUNCTION public.gridex_staff_update_customer_case_status(uuid,uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_staff_update_customer_case_status(uuid,uuid,uuid,uuid,text,text,text) TO service_role;

CREATE FUNCTION public.gridex_audit_staff_support_attachment_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF (NEW.uploaded_by_kind='staff' AND NEW.api_client_id IS NOT NULL)
    OR (TG_OP='UPDATE' AND OLD.uploaded_by_kind='staff' AND OLD.api_client_id IS NOT NULL) THEN
    PERFORM public.gridex_staff_assert_write_actor_v1(NEW.company_id,NEW.uploaded_by_user_id,NEW.api_client_id,'cases.write');
    IF TG_OP='UPDATE' AND (NEW.uploaded_by_kind IS DISTINCT FROM OLD.uploaded_by_kind OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.customer_case_id IS DISTINCT FROM OLD.customer_case_id
      OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.api_client_id IS DISTINCT FROM OLD.api_client_id
      OR NEW.uploaded_by_user_id IS DISTINCT FROM OLD.uploaded_by_user_id) THEN
      RAISE EXCEPTION 'staff_attachment_origin_immutable' USING ERRCODE='42501';
    END IF;
    INSERT INTO public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,metadata)
      VALUES(NEW.company_id,NEW.uploaded_by_user_id,'customer_case_attachment',NEW.id::text,
        CASE WHEN TG_OP='INSERT' THEN 'support_attachment_uploaded' ELSE 'support_attachment_updated' END,
        jsonb_build_object('channel','staff_api','api_client_id',NEW.api_client_id,'customer_case_id',NEW.customer_case_id,'scan_status',NEW.scan_status));
  END IF;
  RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION public.gridex_audit_staff_support_attachment_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_audit_staff_support_attachment_v1() TO service_role;
CREATE TRIGGER customer_case_attachments_staff_audit AFTER INSERT OR UPDATE ON public.customer_case_attachments
  FOR EACH ROW EXECUTE FUNCTION public.gridex_audit_staff_support_attachment_v1();
COMMIT;
