-- Staff-only write boundary shared by customer and support mutations. Replaces
-- the broad OPS permission fallback without changing OPS/customer-default RPCs.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.gridex_staff_assert_write_actor_v1(
  p_company_id uuid,p_actor_user_id uuid,p_api_client_id uuid,p_permission text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_required_scope text;
  v_permissions text[];
BEGIN
  v_required_scope := CASE p_permission
    WHEN 'masterdata.write' THEN 'staff_customers.write'
    WHEN 'customers.write' THEN 'staff_customers.write'
    WHEN 'cases.write' THEN 'staff_cases.write'
    ELSE NULL
  END;
  IF v_required_scope IS NULL THEN
    RAISE EXCEPTION 'staff_api_actor_not_authorized' USING ERRCODE='42501';
  END IF;

  -- Match S2's company -> membership order. All locks are held until the
  -- enclosing business mutation commits; Auth row locks need this narrow
  -- service-only definer instead of granting access to the whole Auth table.
  PERFORM 1 FROM public.companies c WHERE c.id=p_company_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_api_actor_inactive' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.company_memberships cm
    JOIN public.user_profiles profile ON profile.id=cm.user_id
    JOIN auth.users account ON account.id=cm.user_id
    WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id
    FOR SHARE OF cm,profile,account;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_api_actor_inactive' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.integration_api_clients client
    WHERE client.id=p_api_client_id AND client.company_id=p_company_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_api_client_not_in_scope' USING ERRCODE='42501'; END IF;

  -- Read eligibility again only after every potentially blocking lock. In
  -- particular, scope removal/revocation while the client lock is pending must
  -- fail before the caller performs a write.
  IF NOT EXISTS (
    SELECT FROM public.company_memberships cm
      JOIN public.user_profiles profile ON profile.id=cm.user_id
      JOIN auth.users account ON account.id=cm.user_id
      JOIN public.companies c ON c.id=cm.company_id
    WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id
      AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL
      AND profile.user_status='active'
      AND account.deleted_at IS NULL
      AND (account.banned_until IS NULL OR account.banned_until<=clock_timestamp())
      AND c.status IN ('active','onboarding') AND c.is_active
  ) THEN RAISE EXCEPTION 'staff_api_actor_inactive' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (
    SELECT FROM public.integration_api_clients client
    WHERE client.id=p_api_client_id AND client.company_id=p_company_id
      AND client.status='active' AND client.deleted_at IS NULL AND client.revoked_at IS NULL
      AND (client.expires_at IS NULL OR client.expires_at>clock_timestamp())
      AND v_required_scope=ANY(client.scopes)
  ) THEN RAISE EXCEPTION 'staff_api_client_not_in_scope' USING ERRCODE='42501'; END IF;
  v_permissions := public.gridex_staff_actor_permissions_v1(p_company_id,p_actor_user_id,false);
  IF NOT coalesce(p_permission=ANY(v_permissions),false) THEN
    RAISE EXCEPTION 'staff_api_actor_not_authorized' USING ERRCODE='42501';
  END IF;
END$$;
REVOKE ALL ON FUNCTION public.gridex_staff_assert_write_actor_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_staff_assert_write_actor_v1(uuid,uuid,uuid,text) TO service_role;
COMMENT ON FUNCTION public.gridex_staff_assert_write_actor_v1(uuid,uuid,uuid,text) IS
  'Service-only staff write guard: locked exact-company accepted membership, active profile/Auth/company/client, explicit staff scope and shared role profile plus company-only permission overrides.';
COMMIT;
