-- Composed-history bridge. 20261001035555 renamed the certification source core
-- to certification_basis_before_case_tuple_v1 and installed a registered-case
-- wrapper as certification_basis_v1. 20261001093000 (other lineage) edits the
-- core's revocation guard in place through certification_basis_v1. Applied
-- bytes stay untouched: the wrapper is parked for 093000 only and
-- 20261001093001 restores it. Renames keep OIDs, ACLs, owners and bodies, so
-- the guarded edit lands in the same core function the wrapper calls.
BEGIN;
DO $bridge$BEGIN
 IF to_regprocedure('gridex_customer_life_events.certification_basis_before_case_tuple_v1(jsonb,text)') IS NULL
  OR to_regprocedure('gridex_customer_life_events.certification_basis_case_tuple_bridge_v1(jsonb,text)') IS NOT NULL
  OR position('gridex_customer_life_events.certification_basis_before_case_tuple_v1(' IN pg_get_functiondef('gridex_customer_life_events.certification_basis_v1(jsonb,text)'::regprocedure))=0
  OR position('certification_classification_revocations' IN pg_get_functiondef('gridex_customer_life_events.certification_basis_before_case_tuple_v1(jsonb,text)'::regprocedure))=0
 THEN RAISE EXCEPTION 'certification_case_tuple_bridge_predecessor_required';END IF;
 ALTER FUNCTION gridex_customer_life_events.certification_basis_v1(jsonb,text) RENAME TO certification_basis_case_tuple_bridge_v1;
 ALTER FUNCTION gridex_customer_life_events.certification_basis_before_case_tuple_v1(jsonb,text) RENAME TO certification_basis_v1;
END$bridge$;
COMMIT;
