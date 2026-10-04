-- Preserve legacy status event/audit JSON for OPS and existing nonstaff callers.
-- The staff lane uses its strict current profile/client/scope authority, including
-- direct shared-core calls, and retains staff-only actor/client/channel metadata.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='120s';

CREATE OR REPLACE FUNCTION public.gridex_update_customer_case_status_with_actor_v1(
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
  -- Staff authorization owns the entire staff lane, including direct internal
  -- calls to this shared core. Take company/actor/client locks before the case
  -- row and never fall back to the legacy OPS permission catalogue.
  IF p_channel='staff_api' THEN
    PERFORM public.gridex_staff_assert_write_actor_v1(p_company_id,p_actor_user_id,p_api_client_id,'cases.write');
  END IF;

  SELECT * INTO v_case FROM public.customer_cases
    WHERE id=p_case_id AND company_id=p_company_id
      AND (p_expected_source IS NULL OR source=p_expected_source)
      AND (p_channel IS DISTINCT FROM 'staff_api' OR (
        metadata->>'support_case'='true' AND case_type='other'
        AND strpos(source,'tenant_support_')=1
        AND NOT billing_blocked AND NOT billing_manual_review AND NOT cancellation_required
      ))
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='customer_case_not_found_in_scope';
  END IF;

  IF p_channel IS DISTINCT FROM 'staff_api' THEN
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
    CASE WHEN p_channel='staff_api' THEN
      jsonb_build_object('status',p_status,'channel',p_channel,'api_client_id',p_api_client_id,'actor_user_id',p_actor_user_id)
    ELSE jsonb_build_object('status',p_status) END,p_actor_user_id
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
    CASE WHEN p_channel='staff_api' THEN
      jsonb_build_object('customer_id',v_case.customer_id,'channel',p_channel,'api_client_id',p_api_client_id)
    ELSE jsonb_build_object('customer_id',v_case.customer_id) END
  );
  RETURN to_jsonb(v_case);
END
$$;
REVOKE ALL ON FUNCTION public.gridex_update_customer_case_status_with_actor_v1(uuid,uuid,text,uuid,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_update_customer_case_status_with_actor_v1(uuid,uuid,text,uuid,text,text,text,uuid) TO service_role;
COMMIT;
