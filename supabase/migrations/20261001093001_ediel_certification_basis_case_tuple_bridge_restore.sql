-- Restores the 20261001035555 registered-case wrapper as certification_basis_v1
-- around the core that 20261001093000 guarded. Renames keep OIDs/ACLs/bodies.
BEGIN;
DO $bridge$BEGIN
 IF to_regprocedure('gridex_customer_life_events.certification_basis_case_tuple_bridge_v1(jsonb,text)') IS NULL
  OR to_regprocedure('gridex_customer_life_events.certification_basis_before_case_tuple_v1(jsonb,text)') IS NOT NULL
  OR position('certification_classification_revocations' IN pg_get_functiondef('gridex_customer_life_events.certification_basis_v1(jsonb,text)'::regprocedure))=0
 THEN RAISE EXCEPTION 'certification_case_tuple_bridge_restore_predecessor_required';END IF;
 ALTER FUNCTION gridex_customer_life_events.certification_basis_v1(jsonb,text) RENAME TO certification_basis_before_case_tuple_v1;
 ALTER FUNCTION gridex_customer_life_events.certification_basis_case_tuple_bridge_v1(jsonb,text) RENAME TO certification_basis_v1;
END$bridge$;
COMMIT;
