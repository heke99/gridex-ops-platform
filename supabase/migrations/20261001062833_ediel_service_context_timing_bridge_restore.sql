-- Restores the 20261001043917 Z13 timing wrapper as context_v1. It now wraps
-- 20261001062832's creation gate + private source chain (moved back under
-- context_before_source_timing_v1, the name the wrapper calls). Creation keeps
-- timing, gate and every source predicate; renames keep OIDs/ACLs/bodies.
BEGIN;
DO $bridge$BEGIN
 IF to_regprocedure('gridex_service_permission.context_timing_bridge_v1(uuid,uuid,uuid,bigint,text,uuid)') IS NULL
  OR to_regprocedure('gridex_service_permission.context_before_source_timing_v1(uuid,uuid,uuid,bigint,text,uuid)') IS NOT NULL
  OR position('gridex_service_permission.context_source_v1(' IN pg_get_functiondef('gridex_service_permission.context_v1(uuid,uuid,uuid,bigint,text,uuid)'::regprocedure))=0
 THEN RAISE EXCEPTION 'service_context_timing_bridge_restore_predecessor_required';END IF;
 ALTER FUNCTION gridex_service_permission.context_v1(uuid,uuid,uuid,bigint,text,uuid) RENAME TO context_before_source_timing_v1;
 ALTER FUNCTION gridex_service_permission.context_timing_bridge_v1(uuid,uuid,uuid,bigint,text,uuid) RENAME TO context_v1;
END$bridge$;
COMMIT;
