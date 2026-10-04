-- Explicit protected point read delegates the same private current source owner.
-- Its PostgreSQL precision bridge creates no business minute/window/timer.
BEGIN;
CREATE FUNCTION public.ediel_read_source_supply_at_v1(p_company_id uuid,p_actor_user_id uuid,p_period_id uuid,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'structural_supply_basis_service_required' USING ERRCODE='42501'; END IF;
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active')
  OR NOT(coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.write'),false) OR coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'ediel_testing.write'),false)) THEN RAISE EXCEPTION 'ediel_tenant_actor_forbidden' USING ERRCODE='42501'; END IF;
 RETURN gridex_received_sources.supply_period_source_at_v1(p_company_id,p_period_id,p_at);
END $$;
REVOKE ALL ON FUNCTION public.ediel_read_source_supply_at_v1(uuid,uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_read_source_supply_at_v1(uuid,uuid,uuid,timestamptz) TO service_role;
COMMIT;
