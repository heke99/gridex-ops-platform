-- The rendered OPS support form supplies an observation of the case status.
-- Keep Staff API and Ediel callers on their existing commands.
CREATE FUNCTION public.gridex_update_ops_support_case_status_if_current_v1(
  p_case_id uuid,
  p_company_id uuid,
  p_customer_id uuid,
  p_status text,
  p_actor_user_id uuid,
  p_expected_source text,
  p_expected_status text,
  p_message text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_case public.customer_cases%ROWTYPE;
  v_is_platform boolean;
BEGIN
  IF nullif(p_expected_status,'') IS NULL
    OR (p_status IN ('open','action_required','awaiting_external_response','manual_follow_up','resolved','closed')) IS NOT TRUE THEN
    RAISE EXCEPTION 'ops_support_case_status_context_invalid' USING ERRCODE='22023';
  END IF;

  -- Same case-first order as the existing OPS writer. Read current status
  -- after acquiring the lock so a competing update remains visible.
  SELECT * INTO v_case FROM public.customer_cases
    WHERE id=p_case_id AND company_id=p_company_id AND customer_id=p_customer_id
      AND source IS NOT DISTINCT FROM p_expected_source
      AND source IS DISTINCT FROM 'ediel_inbound_state_machine'
      AND (metadata->'support_case'='true'::jsonb OR strpos(source,'tenant_support_')=1)
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_case_not_found_in_scope' USING ERRCODE='P0002';
  END IF;

  IF v_case.status IS DISTINCT FROM p_expected_status OR v_case.status IN ('resolved','closed','cancelled') THEN
    -- A conflict also requires the OPS writer's exact actor authority. The
    -- successful branch delegates its authority and writing to that owner.
    v_is_platform := public.canonical_actor_is_platform_admin(p_actor_user_id);
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
    RAISE EXCEPTION 'ops_support_case_status_changed' USING ERRCODE='PT409';
  END IF;

  RETURN public.gridex_update_customer_case_status(
    p_case_id,p_company_id,p_status,p_actor_user_id,p_expected_source,p_message
  );
END
$function$;

REVOKE ALL ON FUNCTION public.gridex_update_ops_support_case_status_if_current_v1(uuid,uuid,uuid,text,uuid,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_update_ops_support_case_status_if_current_v1(uuid,uuid,uuid,text,uuid,text,text,text)
  TO service_role;
