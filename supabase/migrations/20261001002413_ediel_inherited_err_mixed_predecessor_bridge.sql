-- Supabase CLI-created ordered prerequisite to the untouched 002414 owner
-- derivation. Its target is the actual national guide checker underneath the
-- actual mixed execution-receipt wrapper. All three OIDs/ACLs remain fixed.
BEGIN;
DO $bridge$
DECLARE guide_definition text;mixed_definition text;entry_definition text;
 guide_needle text:='projection:=gridex_ediel_ack_guide.projection_for_original_v1(b.source_version);';
 mixed_needle text:='PERFORM gridex_ediel_ack_guide.require_before_mixed_object_results_v1(m);';
 entry_needle text:='PERFORM gridex_ediel_ack_guide.require_before_prodat_scope_v1(m);';
BEGIN
 guide_definition:=pg_get_functiondef('gridex_ediel_ack_guide.require_before_mixed_object_results_v1(public.ediel_messages)'::regprocedure);
 mixed_definition:=pg_get_functiondef('gridex_ediel_ack_guide.require_before_prodat_scope_v1(public.ediel_messages)'::regprocedure);
 entry_definition:=pg_get_functiondef('gridex_ediel_ack_guide.require_v1(public.ediel_messages)'::regprocedure);
 IF position(guide_needle IN guide_definition)=0
  OR position('gridex_ediel_ack_guide.validate_response_for_message_v1(m,source,projection)' IN guide_definition)=0
  OR position('gridex_ediel_ack_guide.qualify_err_reason_projection_v1(projection,basis)' IN guide_definition)<>0
  OR position(mixed_needle IN mixed_definition)=0
  OR position('prodat_mixed_ack_committed_own_results_required' IN mixed_definition)=0
  OR position('prodat_mixed_ack_own_commit_mismatch' IN mixed_definition)=0
  OR position(entry_needle IN entry_definition)=0
  OR position('PERFORM gridex_ediel_ack_guide.require_prodat_scope_v1(m);' IN entry_definition)=0
  OR to_regprocedure('gridex_ediel_ack_guide.require_before_prodat_scope_err_mixed_owner_v1(public.ediel_messages)') IS NOT NULL
 THEN RAISE EXCEPTION 'ediel_err_mixed_predecessor_contract_changed';END IF;
 ALTER FUNCTION gridex_ediel_ack_guide.require_before_prodat_scope_v1(public.ediel_messages) RENAME TO require_before_prodat_scope_err_mixed_owner_v1;
 ALTER FUNCTION gridex_ediel_ack_guide.require_before_mixed_object_results_v1(public.ediel_messages) RENAME TO require_before_prodat_scope_v1;
 -- PL/pgSQL names resolve at invocation. Existing entry must still traverse
 -- the real mixed receipt checker, then the real national guide and scope.
 mixed_definition:=pg_get_functiondef('gridex_ediel_ack_guide.require_before_prodat_scope_err_mixed_owner_v1(public.ediel_messages)'::regprocedure);
 EXECUTE replace(mixed_definition,mixed_needle,entry_needle);
 EXECUTE replace(entry_definition,entry_needle,'PERFORM gridex_ediel_ack_guide.require_before_prodat_scope_err_mixed_owner_v1(m);');
END $bridge$;
COMMIT;
