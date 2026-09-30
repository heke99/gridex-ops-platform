-- A new correction has a new intent. It may reuse current original legal
-- service authority only through the immutable, qualified recovery operation.
BEGIN;
ALTER FUNCTION public.ediel_require_service_permission_origin_current_v1(uuid,uuid) SET SCHEMA gridex_service_permission;
ALTER FUNCTION gridex_service_permission.ediel_require_service_permission_origin_current_v1(uuid,uuid) RENAME TO require_original_current_v1;
REVOKE ALL ON FUNCTION gridex_service_permission.require_original_current_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION public.ediel_prodat_recovery_operation_basis_v1(uuid,uuid,uuid) SET SCHEMA gridex_service_permission;
ALTER FUNCTION gridex_service_permission.ediel_prodat_recovery_operation_basis_v1(uuid,uuid,uuid) RENAME TO recovery_operation_before_current_service_v1;
REVOKE ALL ON FUNCTION gridex_service_permission.recovery_operation_before_current_service_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_prodat_recovery_operation_basis_v1(p_company_id uuid,p_operation_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE basis jsonb;
BEGIN
 basis:=gridex_service_permission.recovery_operation_before_current_service_v1(p_company_id,p_operation_id,p_actor_user_id);
 IF basis IS NULL THEN RETURN NULL;END IF;
 -- The existing private operation authority has already checked the original,
 -- new correction bytes, negative ACK, tenant, actor and failed-object scope.
 IF nullif(basis->>'originalMessageId','') IS NULL OR basis->>'operationId' IS DISTINCT FROM p_operation_id::text THEN RAISE EXCEPTION 'ediel_service_recovery_basis_unqualified';END IF;
 PERFORM gridex_service_permission.require_original_current_v1(p_company_id,(basis->>'originalMessageId')::uuid);
 RETURN basis;
END $$;
REVOKE ALL ON FUNCTION public.ediel_prodat_recovery_operation_basis_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_prodat_recovery_operation_basis_v1(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.ediel_require_service_permission_origin_current_v1(p_company_id uuid,p_message_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE operation_actor uuid;qualified jsonb;
BEGIN
 IF p_company_id IS NULL OR p_message_id IS NULL THEN RAISE EXCEPTION 'ediel_service_permission_scope_required';END IF;
 -- Preserve original service-message authorization. Ordinary messages without
 -- service origins remain under their own authorities.
 PERFORM gridex_service_permission.require_original_current_v1(p_company_id,p_message_id);
 SELECT operation.actor_user_id INTO operation_actor
 FROM gridex_received_sources.prodat_recovery_messages link
 JOIN gridex_received_sources.prodat_recovery_operations operation ON operation.id=link.operation_id
 WHERE link.message_id=p_message_id AND operation.company_id=p_company_id;
 IF NOT FOUND THEN RETURN;END IF;
 qualified:=public.ediel_prodat_recovery_original_basis_v1(p_company_id,p_message_id,operation_actor);
 IF qualified IS NULL OR nullif(qualified->>'originalMessageId','') IS NULL OR qualified->>'originalMessageId'=p_message_id::text THEN RAISE EXCEPTION 'ediel_service_recovery_original_unqualified';END IF;
 -- The operation reader above independently checks this same original; no
 -- recursion through a new intent, editable source-id or metadata is used.
 PERFORM gridex_service_permission.require_original_current_v1(p_company_id,(qualified->>'originalMessageId')::uuid);
END $$;
REVOKE ALL ON FUNCTION public.ediel_require_service_permission_origin_current_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_require_service_permission_origin_current_v1(uuid,uuid) TO service_role;
COMMIT;
