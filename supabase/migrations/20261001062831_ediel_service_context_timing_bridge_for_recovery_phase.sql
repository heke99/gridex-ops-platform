-- Composed-history bridge. 20261001043917 (network period timing) renamed the
-- requested-method context to context_before_source_timing_v1 and installed a
-- Z13 timing wrapper as context_v1. 20261001062832 (other lineage) derives its
-- private read-only source contexts from context_v1 as the requested-method
-- body and replaces context_v1 with its creation gate. Applied bytes stay
-- untouched: the timing wrapper is parked under a bridge name for 062832 only;
-- 20261001062833 restores it as context_v1 on top of 062832's gate. Renames
-- keep every OID, ACL, owner, config and body.
BEGIN;
DO $bridge$BEGIN
 IF to_regprocedure('gridex_service_permission.context_before_source_timing_v1(uuid,uuid,uuid,bigint,text,uuid)') IS NULL
  OR to_regprocedure('gridex_service_permission.context_timing_bridge_v1(uuid,uuid,uuid,bigint,text,uuid)') IS NOT NULL
  OR position('gridex_service_permission.context_before_source_timing_v1(' IN pg_get_functiondef('gridex_service_permission.context_v1(uuid,uuid,uuid,bigint,text,uuid)'::regprocedure))=0
  OR position('current_request_timing_v1' IN pg_get_functiondef('gridex_service_permission.context_v1(uuid,uuid,uuid,bigint,text,uuid)'::regprocedure))=0
  OR position('gridex_service_permission.context_before_requested_method_v1(' IN pg_get_functiondef('gridex_service_permission.context_before_source_timing_v1(uuid,uuid,uuid,bigint,text,uuid)'::regprocedure))=0
 THEN RAISE EXCEPTION 'service_context_timing_bridge_predecessor_required';END IF;
 ALTER FUNCTION gridex_service_permission.context_v1(uuid,uuid,uuid,bigint,text,uuid) RENAME TO context_timing_bridge_v1;
 ALTER FUNCTION gridex_service_permission.context_before_source_timing_v1(uuid,uuid,uuid,bigint,text,uuid) RENAME TO context_v1;
END$bridge$;
COMMIT;
