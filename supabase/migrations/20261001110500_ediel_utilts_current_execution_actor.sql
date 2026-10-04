-- Current operator authority is separate from immutable UTILTS source evidence.
-- Preserve the complete existing storage/replay owner; new public invocation
-- adds only current tenant/RBAC authority, before any graph or source effect.
BEGIN;
CREATE FUNCTION gridex_utilts_binding.require_execution_actor_v1(p_company_id uuid,p_actor_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF p_company_id IS NULL OR p_actor_user_id IS NULL
  OR NOT EXISTS(SELECT FROM auth.users u WHERE u.id=p_actor_user_id AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp()))
  OR NOT EXISTS(SELECT FROM public.companies c WHERE c.id=p_company_id AND coalesce(c.is_active,true)
    AND coalesce(c.status,'active') NOT IN('archived','suspended','pending_deletion','deleted'))
  OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=p_company_id AND m.user_id=p_actor_user_id
    AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL)
  OR gridex_bilateral_customer_sources.classified_scoped_permission_wallclock_v1(p_company_id,p_actor_user_id,'metering.write') IS NOT TRUE THEN
  RAISE EXCEPTION 'utilts_execution_actor_forbidden' USING ERRCODE='42501';END IF;
END $$;
ALTER FUNCTION public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb)
 RENAME TO persist_consumption_before_actor_v1;
ALTER FUNCTION public.persist_consumption_before_actor_v1(uuid,text,uuid,text,text,jsonb)
 SET SCHEMA gridex_utilts_binding;
CREATE FUNCTION public.gridex_persist_utilts_consumption_v1(
 p_company_id uuid,p_environment text,p_source_message_id uuid,p_message_code text,
 p_raw_payload text,p_transactions jsonb,p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;result jsonb;
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' AND current_user<>'service_role' AND session_user<>'service_role' THEN
  RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;
 -- Match the existing owner lock prefix. Concurrent deny/revocation commits
 -- are observed before invocation; later revocations wait for this transaction.
 PERFORM gridex_utilts_binding.lock_storage_graph_v1();
 SELECT * INTO source FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF source.id IS NULL OR source.environment IS DISTINCT FROM p_environment OR source.direction IS DISTINCT FROM 'inbound'
  OR source.message_family IS DISTINCT FROM 'UTILTS' OR source.message_code IS DISTINCT FROM p_message_code
  OR source.raw_payload IS DISTINCT FROM p_raw_payload THEN
  RAISE EXCEPTION 'utilts_source_binding_conflict' USING ERRCODE='P0U01';END IF;
 PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company_id,p_actor_user_id);
 -- Same check applies to immutable replay: history cannot be disclosed or used
 -- for new sink/ACK effects after this operator's current grant was revoked.
 result:=gridex_utilts_binding.persist_consumption_before_actor_v1(p_company_id,p_environment,p_source_message_id,p_message_code,p_raw_payload,p_transactions);
 -- The preserved owner may wait on its source/advisory locks. Expiry during
 -- that wait rejects the result and rolls back every mutation in this call.
 PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company_id,p_actor_user_id);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION gridex_utilts_binding.require_execution_actor_v1(uuid,uuid),gridex_utilts_binding.persist_consumption_before_actor_v1(uuid,text,uuid,text,text,jsonb),
 public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb,uuid) TO service_role;
COMMIT;
