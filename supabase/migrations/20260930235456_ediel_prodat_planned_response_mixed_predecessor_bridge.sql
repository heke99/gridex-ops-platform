-- Supabase CLI-created additive prerequisite, ordered immediately before the
-- independently published 235457 derivation. Neither published migration changes.
-- The original guide checker and the mixed execution-receipt wrapper retain
-- their actual OIDs, owners, ACLs, security and configuration. Existing entry
-- require_v1 still executes BOTH checks throughout this namespace bridge.
BEGIN;
DO $bridge$
DECLARE guide_definition text;mixed_definition text;entry_definition text;
 guide_needle text:='gridex_ediel_ack_guide.validate_v1(m.raw_payload,source.raw_payload,projection)';
 mixed_needle text:='PERFORM gridex_ediel_ack_guide.require_before_mixed_object_results_v1(m);';
 entry_needle text:='PERFORM gridex_ediel_ack_guide.require_before_prodat_scope_v1(m);';
BEGIN
 guide_definition:=pg_get_functiondef('gridex_ediel_ack_guide.require_before_mixed_object_results_v1(public.ediel_messages)'::regprocedure);
 mixed_definition:=pg_get_functiondef('gridex_ediel_ack_guide.require_before_prodat_scope_v1(public.ediel_messages)'::regprocedure);
 entry_definition:=pg_get_functiondef('gridex_ediel_ack_guide.require_v1(public.ediel_messages)'::regprocedure);
 IF position(guide_needle IN guide_definition)=0 OR position(mixed_needle IN mixed_definition)=0
  OR position('prodat_mixed_ack_committed_own_results_required' IN mixed_definition)=0
  OR position('prodat_mixed_ack_own_commit_mismatch' IN mixed_definition)=0
  OR position(entry_needle IN entry_definition)=0
  OR position('PERFORM gridex_ediel_ack_guide.require_prodat_scope_v1(m);' IN entry_definition)=0
  OR to_regprocedure('gridex_ediel_ack_guide.require_before_prodat_scope_mixed_owner_v1(public.ediel_messages)') IS NOT NULL
 THEN RAISE EXCEPTION 'prodat_planned_response_mixed_predecessor_contract_changed';END IF;
 ALTER FUNCTION gridex_ediel_ack_guide.require_before_prodat_scope_v1(public.ediel_messages) RENAME TO require_before_prodat_scope_mixed_owner_v1;
 ALTER FUNCTION gridex_ediel_ack_guide.require_before_mixed_object_results_v1(public.ediel_messages) RENAME TO require_before_prodat_scope_v1;
 -- PL/pgSQL calls resolve their named target at execution, so bind the actual
 -- mixed wrapper and entry explicitly. No copied checker or inert needle is added.
 mixed_definition:=pg_get_functiondef('gridex_ediel_ack_guide.require_before_prodat_scope_mixed_owner_v1(public.ediel_messages)'::regprocedure);
 EXECUTE replace(mixed_definition,mixed_needle,entry_needle);
 EXECUTE replace(entry_definition,entry_needle,'PERFORM gridex_ediel_ack_guide.require_before_prodat_scope_mixed_owner_v1(m);');
END $bridge$;
COMMIT;
