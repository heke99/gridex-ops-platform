-- Staff support assignments require an accepted, recognized staff account in
-- the same company. Effective permission overrides do not determine staff type.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='120s';

CREATE OR REPLACE FUNCTION public.gridex_assign_customer_case(p_company_id uuid,p_case_id uuid,p_actor_user_id uuid,
  p_assignee_user_id uuid,p_api_client_id uuid,p_expected_source text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_case public.customer_cases%ROWTYPE; v_old_assignee uuid; v_now timestamptz:=clock_timestamp();
BEGIN
  PERFORM public.gridex_staff_assert_write_actor_v1(p_company_id,p_actor_user_id,p_api_client_id,'cases.write');
  -- The shared actor guard holds company SHARE, actor and client locks. Target
  -- SHARE locks permit opposing assignments while preventing membership/Auth
  -- changes from committing between this check and the assignment/audit write.
  IF p_assignee_user_id IS NOT NULL THEN
    PERFORM 1 FROM public.company_memberships cm
      JOIN public.user_profiles profile ON profile.id=cm.user_id
      JOIN auth.users account ON account.id=cm.user_id
      WHERE cm.company_id=p_company_id AND cm.user_id=p_assignee_user_id
      FOR SHARE OF cm,profile,account;
    IF NOT FOUND OR NOT EXISTS (
      SELECT FROM public.company_memberships cm
        JOIN public.user_profiles profile ON profile.id=cm.user_id
        JOIN auth.users account ON account.id=cm.user_id
      WHERE cm.company_id=p_company_id AND cm.user_id=p_assignee_user_id
        AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL
        AND profile.user_status='active' AND account.deleted_at IS NULL
        AND (account.banned_until IS NULL OR account.banned_until<=clock_timestamp())
        AND public.gridex_staff_normalize_role_v1(cm.role_key) NOT IN ('super_admin','platform_admin','white_label_platform_admin','customer')
        AND cardinality(public.gridex_staff_role_profile_v1(public.gridex_staff_normalize_role_v1(cm.role_key)))>0
    ) THEN RAISE EXCEPTION 'support_assignee_not_active_in_company' USING ERRCODE='42501'; END IF;
  END IF;
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
COMMIT;
