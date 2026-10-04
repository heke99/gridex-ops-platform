-- 20260930162005 made gridex_service_permission.context_v1 executable by
-- service_role only, for the public port ediel_service_permission_origin_v1
-- (SECURITY INVOKER, itself refusing every role but service_role). The later
-- recreations (20260930231633, 20260930235816, 20261001062832) revoked
-- service_role again and never restored the grant, so the port has failed
-- with "permission denied for function context_v1" on every call since —
-- including the production read path in lib/ediel/services/permissionOrigin.ts.
--
-- Restore exactly the original service-only grant. PUBLIC, anon and
-- authenticated stay revoked; the function body is unchanged.
BEGIN;
DO $grant$BEGIN
 IF to_regprocedure('gridex_service_permission.context_v1(uuid,uuid,uuid,bigint,text,uuid)') IS NULL
  OR to_regprocedure('public.ediel_service_permission_origin_v1(uuid,uuid,uuid,bigint,text,uuid)') IS NULL
 THEN RAISE EXCEPTION 'service_permission_context_grant_predecessor_required';END IF;
END$grant$;
REVOKE ALL ON FUNCTION gridex_service_permission.context_v1(uuid,uuid,uuid,bigint,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION gridex_service_permission.context_v1(uuid,uuid,uuid,bigint,text,uuid) TO service_role;
COMMIT;
