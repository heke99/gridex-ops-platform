-- TR05 / TEN01 / CALL03: the actual current executor owns phase permissions;
-- the original service editor remains immutable provenance. Source policy is
-- the same private agreement/requested-method owner factored in 062832.
BEGIN;
DO $bridge$
DECLARE signature text;definition text;old_call text:='gridex_service_permission.require_original_current_v1(';new_call text:='gridex_service_permission.require_original_source_current_v1(';
BEGIN
 IF to_regprocedure('gridex_service_permission.require_original_source_current_v1(uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'ediel_recovery_service_source_owner_required';END IF;
 FOREACH signature IN ARRAY ARRAY['public.ediel_prodat_recovery_operation_basis_v1(uuid,uuid,uuid)','public.ediel_require_service_permission_origin_current_v1(uuid,uuid)'] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  IF strpos(definition,old_call)=0 OR strpos(definition,'sourceOriginMessageId')=0 THEN RAISE EXCEPTION 'ediel_recovery_service_bridge_owner_shape_changed';END IF;
  EXECUTE replace(definition,old_call,new_call);
 END LOOP;
END $bridge$;
-- OIDs, owners, current executor guards and ACLs are preserved by replacement.
-- No operation, origin, intent, request, attempt or outbox row is rewritten.
COMMIT;
