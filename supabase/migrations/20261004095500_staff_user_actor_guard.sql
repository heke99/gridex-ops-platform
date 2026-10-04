-- S2 forward repair: hold staff actor eligibility rows through every account
-- write and cached replay, in company -> actor -> client lock order.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='120s';

CREATE OR REPLACE FUNCTION public.gridex_assert_staff_command_v1(p_command jsonb, p_replay boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $guard$
DECLARE
  v_company_id uuid := nullif(p_command->>'company_id','')::uuid;
  v_actor_user_id uuid := nullif(p_command->>'actor_user_id','')::uuid;
  v_client_id uuid := nullif(p_command->>'api_client_id','')::uuid;
  v_channel text := p_command->>'channel';
  v_operation text := p_command->>'staff_operation';
  v_role_key text := p_command->>'role_key';
  v_permissions text[];
  v_membership public.company_memberships%rowtype;
  v_company_status text;
  v_company_active boolean;
  v_target_user_id uuid := nullif(p_command->>'user_id','')::uuid;
BEGIN
  IF v_company_id IS NULL OR v_actor_user_id IS NULL OR v_channel IS NULL OR v_channel NOT IN ('ops','staff_api') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='staff_permission_denied';
  END IF;
  SELECT status,is_active INTO v_company_status,v_company_active FROM public.companies WHERE id=v_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='staff_permission_denied'; END IF;
  IF v_company_status NOT IN ('active','onboarding') OR v_company_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='staff_company_not_operational';
  END IF;
  v_permissions := public.gridex_staff_actor_permissions_v1(v_company_id,v_actor_user_id,v_channel='ops');
  IF NOT ('users.write'=ANY(v_permissions)) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='staff_permission_denied';
  END IF;
  IF v_channel='staff_api' THEN
    -- Lock the exact actor rows before the client; global OPS administrators
    -- retain their existing separate authority path. No broad Auth grant is used.
    PERFORM 1 FROM public.company_memberships cm
      JOIN public.user_profiles profile ON profile.id=cm.user_id
      JOIN auth.users account ON account.id=cm.user_id
      WHERE cm.company_id=v_company_id AND cm.user_id=v_actor_user_id
      FOR SHARE OF cm,profile,account;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='staff_permission_denied'; END IF;
    PERFORM 1 FROM public.integration_api_clients client
      WHERE client.id=v_client_id AND client.company_id=v_company_id FOR SHARE;
    IF NOT FOUND OR NOT EXISTS (
      SELECT FROM public.integration_api_clients client
      WHERE client.id=v_client_id AND client.company_id=v_company_id AND client.status='active'
        AND client.deleted_at IS NULL AND client.revoked_at IS NULL
        AND (client.expires_at IS NULL OR client.expires_at>clock_timestamp())
        AND 'staff_users.write'=ANY(client.scopes)
    ) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='staff_permission_denied'; END IF;
    -- Check eligibility after all potentially blocking row locks, before any
    -- replay return or target mutation. Use wall-clock time for current bans.
    IF NOT EXISTS (
      SELECT FROM public.company_memberships cm
        JOIN public.user_profiles profile ON profile.id=cm.user_id
        JOIN auth.users account ON account.id=cm.user_id
        JOIN public.companies company ON company.id=cm.company_id
      WHERE cm.company_id=v_company_id AND cm.user_id=v_actor_user_id
        AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL
        AND profile.user_status='active' AND account.deleted_at IS NULL
        AND (account.banned_until IS NULL OR account.banned_until<=clock_timestamp())
        AND company.status IN ('active','onboarding') AND company.is_active
    ) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='staff_permission_denied'; END IF;
    v_permissions := public.gridex_staff_actor_permissions_v1(v_company_id,v_actor_user_id,false);
    IF NOT ('users.write'=ANY(v_permissions)) THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='staff_permission_denied';
    END IF;
  END IF;
  IF p_replay THEN RETURN; END IF;
  IF v_operation='invite' THEN
    NULL;
  ELSIF v_operation IN ('change_role','disable','enable') THEN
    SELECT * INTO v_membership FROM public.company_memberships
    WHERE company_id=v_company_id AND user_id=v_target_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='staff_user_not_found'; END IF;
    IF v_operation='enable' THEN
      IF v_membership.status<>'disabled' THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='staff_invalid_user_state'; END IF;
      v_role_key := v_membership.role_key;
    ELSIF v_membership.status<>'active' OR NOT v_membership.is_active THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='staff_invalid_user_state';
    END IF;
    IF v_operation='disable' AND v_target_user_id=v_actor_user_id THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='staff_self_disable_forbidden';
    END IF;
    IF v_operation='change_role' AND v_target_user_id=v_actor_user_id
       AND NOT (v_channel='ops' AND public.canonical_actor_is_platform_admin(v_actor_user_id)) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='staff_self_role_change_forbidden';
    END IF;
    IF v_membership.status='active' AND v_membership.is_active
       AND v_membership.membership_role IN ('owner','admin','company_admin')
       AND (v_operation='disable' OR (v_operation='change_role' AND v_role_key NOT IN ('company_admin','admin')))
       AND NOT EXISTS (SELECT FROM public.company_memberships other
         WHERE other.company_id=v_company_id AND other.user_id<>v_target_user_id
           AND other.status='active' AND other.is_active
           AND other.membership_role IN ('owner','admin','company_admin')) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='staff_last_admin_required';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='staff_invalid_operation';
  END IF;
  IF v_operation<>'disable' THEN
    IF v_role_key IS NULL OR NOT EXISTS (
      SELECT FROM public.canonical_tenant_access_role_mapping mapping
      WHERE mapping.role_key=v_role_key AND mapping.is_assignable AND mapping.role_key<>'owner'
    ) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='staff_role_not_assignable'; END IF;
    IF NOT (public.gridex_staff_role_profile_v1(v_role_key)<@v_permissions) THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='staff_role_ceiling_exceeded';
    END IF;
  END IF;
END;
$guard$;
-- This guard remains private to the canonical SECURITY DEFINER commands.
REVOKE ALL ON FUNCTION public.gridex_assert_staff_command_v1(jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
