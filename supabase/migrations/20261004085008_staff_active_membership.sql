-- Staff reads and writes share native account eligibility. External provider
-- authentication never overrides global account suspension, deletion or bans.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='120s';

CREATE FUNCTION public.gridex_staff_active_membership_v1(p_company_id uuid,p_user_id uuid)
RETURNS TABLE(user_id uuid,role_key text,membership_role text,status text,is_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT membership.user_id,membership.role_key,membership.membership_role,
    membership.status,membership.is_active
  FROM public.company_memberships membership
  JOIN public.user_profiles profile ON profile.id=membership.user_id AND profile.user_status='active'
  JOIN auth.users account ON account.id=membership.user_id
  WHERE membership.company_id=p_company_id AND membership.user_id=p_user_id
    AND membership.status='active' AND membership.is_active
    AND membership.accepted_at IS NOT NULL
    AND account.deleted_at IS NULL
    AND (account.banned_until IS NULL OR account.banned_until<=clock_timestamp())
$$;
REVOKE ALL ON FUNCTION public.gridex_staff_active_membership_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_staff_active_membership_v1(uuid,uuid) TO service_role;
COMMENT ON FUNCTION public.gridex_staff_active_membership_v1(uuid,uuid) IS
  'Service-only exact-company staff membership lookup with accepted membership, active global profile and nondeleted/nonbanned Auth account; no OPS session is required.';
COMMIT;
