-- masterplan: TEN-09 (reuse only a legally compatible permission)
-- The public coordinator (20261001043917) checks the captured DSO network-contract
-- period and the three-year bound before every request_access, but the public
-- explicit-permission resolver (20261001020640) could return reuse_permission for
-- an assignment whose requested period that check holds. Gate the resolver with
-- the same current_request_timing_v1 decision. No historic body is edited: the
-- current resolver is copied to a private predecessor and the public entry
-- keeps its OID, signature and grants.
BEGIN;
DO $$DECLARE definition text;BEGIN
 definition:=pg_get_functiondef('public.ediel_resolve_service_permission_command_v1(uuid,uuid,uuid,bigint,uuid)'::regprocedure);
 IF position('public.ediel_resolve_service_permission_command_v1(' IN definition)=0 THEN RAISE EXCEPTION 'ediel_resolve_permission_predecessor_unexpected';END IF;
 EXECUTE replace(definition,'public.ediel_resolve_service_permission_command_v1(','gridex_service_permission.resolve_before_request_timing_v1(');
END $$;
REVOKE ALL ON FUNCTION gridex_service_permission.resolve_before_request_timing_v1(uuid,uuid,uuid,bigint,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.ediel_resolve_service_permission_command_v1(p_company_id uuid,p_assignment_id uuid,p_actor_user_id uuid,p_expected_version bigint,p_permission_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$DECLARE timing jsonb;BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ediel_service_manual_service_required' USING ERRCODE='42501';END IF;
 IF p_assignment_id IS NULL OR p_permission_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1 THEN RAISE EXCEPTION 'ediel_service_permission_command_scope_required';END IF;
 PERFORM gridex_service_permission.lock_request_writer_v1();
 timing:=gridex_service_permission.current_request_timing_v1(p_company_id,p_assignment_id,p_actor_user_id,p_expected_version,false);
 IF timing->>'status' IS DISTINCT FROM 'authorized' THEN RETURN jsonb_build_object('status','held','permissionId',NULL,'missing',timing->'missing');END IF;
 -- A recorded immutable request binds this assignment scope to one permission.
 IF timing->>'permissionId' IS NOT NULL AND timing->>'permissionId' IS DISTINCT FROM p_permission_id::text THEN
  RETURN jsonb_build_object('status','held','permissionId',NULL,'missing',ARRAY['immutable_service_request_permission_mismatch']);
 END IF;
 RETURN gridex_service_permission.resolve_before_request_timing_v1(p_company_id,p_assignment_id,p_actor_user_id,p_expected_version,p_permission_id);
END $$;
COMMIT;
