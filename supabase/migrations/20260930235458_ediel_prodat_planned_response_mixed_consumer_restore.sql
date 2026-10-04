-- Additive companion after the untouched 235457 migration has upgraded the
-- actual guide checker. Restore its namespace underneath the actual mixed
-- receipt checker; later protected ACK readers retain this complete chain.
BEGIN;
DO $restore$
DECLARE guide_definition text;mixed_definition text;entry_definition text;
 mixed_needle text:='PERFORM gridex_ediel_ack_guide.require_before_prodat_scope_v1(m);';
 entry_needle text:='PERFORM gridex_ediel_ack_guide.require_before_prodat_scope_mixed_owner_v1(m);';
BEGIN
 guide_definition:=pg_get_functiondef('gridex_ediel_ack_guide.require_before_prodat_scope_v1(public.ediel_messages)'::regprocedure);
 mixed_definition:=pg_get_functiondef('gridex_ediel_ack_guide.require_before_prodat_scope_mixed_owner_v1(public.ediel_messages)'::regprocedure);
 entry_definition:=pg_get_functiondef('gridex_ediel_ack_guide.require_v1(public.ediel_messages)'::regprocedure);
 IF position('gridex_ediel_ack_guide.validate_response_for_message_v1(m,source,projection)' IN guide_definition)=0
  OR position('gridex_ediel_ack_guide.validate_v1(m.raw_payload,source.raw_payload,projection)' IN guide_definition)<>0
  OR position(mixed_needle IN mixed_definition)=0
  OR position('prodat_mixed_ack_committed_own_results_required' IN mixed_definition)=0
  OR position('prodat_mixed_ack_own_commit_mismatch' IN mixed_definition)=0
  OR position(entry_needle IN entry_definition)=0
  OR position('PERFORM gridex_ediel_ack_guide.require_prodat_scope_v1(m);' IN entry_definition)=0
  OR to_regprocedure('gridex_ediel_ack_guide.require_before_mixed_object_results_v1(public.ediel_messages)') IS NOT NULL
 THEN RAISE EXCEPTION 'prodat_planned_response_mixed_restoration_contract_changed';END IF;
 ALTER FUNCTION gridex_ediel_ack_guide.require_before_prodat_scope_v1(public.ediel_messages) RENAME TO require_before_mixed_object_results_v1;
 ALTER FUNCTION gridex_ediel_ack_guide.require_before_prodat_scope_mixed_owner_v1(public.ediel_messages) RENAME TO require_before_prodat_scope_v1;
 mixed_definition:=pg_get_functiondef('gridex_ediel_ack_guide.require_before_prodat_scope_v1(public.ediel_messages)'::regprocedure);
 EXECUTE replace(mixed_definition,mixed_needle,'PERFORM gridex_ediel_ack_guide.require_before_mixed_object_results_v1(m);');
 EXECUTE replace(entry_definition,entry_needle,'PERFORM gridex_ediel_ack_guide.require_before_prodat_scope_v1(m);');
END $restore$;
COMMIT;
