-- BRP SOURCE: final post-wait calendar-month notice guard at ordinary admission.
-- PUBLIC main573 schema bc35de2cd5b48ab1016ac9df5d4de3dcf0e3b4ed; unchanged on main6ce6.
-- Preserve target identity/catalog metadata and all prior guards; runtime verification is separate.
DO $brp_post_wait$
DECLARE
 target regprocedure:='gridex_ediel_transport.mutate_v1(jsonb)'::regprocedure;
 target_oid oid:=target::oid;
 before_metadata jsonb;
 before_protected jsonb;
 actual_source text;
 actual_definition text;
 expected_source text:=$brp_expected$DECLARE r jsonb;BEGIN PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();r:=gridex_ediel_transport.mutate_before_duplicate_protocol_v1(p_input);IF p_input->>'action' IN('prepare','enter') AND r->>'proceed'='true' THEN PERFORM gridex_ediel_duplicate_responses.require_transport_v1((p_input->>'companyId')::uuid,(p_input->>'messageId')::uuid,(p_input->>'actorUserId')::uuid);END IF;RETURN r;END$brp_expected$;
 proposed_source text:=$brp_proposed$DECLARE r jsonb;brp_cutoff timestamptz;brp_observed_at timestamptz;BEGIN PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();r:=gridex_ediel_transport.mutate_before_duplicate_protocol_v1(p_input);IF p_input->>'action' IN('prepare','enter') AND r->>'proceed'='true' THEN PERFORM gridex_ediel_duplicate_responses.require_transport_v1((p_input->>'companyId')::uuid,(p_input->>'messageId')::uuid,(p_input->>'actorUserId')::uuid);
-- Only an actual origin-backed supplier BRP change reaches this extra check.
-- All existing source/binding/duplicate guards above have finished. Acquire
-- this last event read lock BEFORE sampling the clock; no further reads/locks
-- or external provider entry follow the clock inside this admission function.
SELECT (e.effective_at AT TIME ZONE 'Etc/GMT-1'-interval '1 month') AT TIME ZONE 'Etc/GMT-1'
  INTO brp_cutoff
  FROM gridex_brp_changes.origins o
  JOIN gridex_brp_changes.events e ON e.id=o.event_id AND e.company_id=o.company_id
  JOIN public.ediel_messages m ON m.id=o.message_id AND m.company_id=o.company_id
 WHERE o.company_id=(p_input->>'companyId')::uuid
   AND o.message_id=(p_input->>'messageId')::uuid
   AND m.environment=p_input->>'environment' AND e.environment=m.environment
   AND m.direction='outbound' AND m.message_family='PRODAT' AND m.message_code='Z09'
 FOR SHARE OF e;
IF FOUND THEN
 brp_observed_at:=pg_catalog.clock_timestamp();
 IF brp_observed_at>brp_cutoff THEN
  RAISE EXCEPTION 'brp_change_current_source_held'
    USING DETAIL='one_calendar_month_notice_boundary';
 END IF;
END IF;
END IF;RETURN r;END$brp_proposed$;
 changed_definition text;
BEGIN
 SELECT to_jsonb(p)-'prosrc',p.prosrc,pg_get_functiondef(p.oid)
   INTO STRICT before_metadata,actual_source,actual_definition FROM pg_catalog.pg_proc p WHERE p.oid=target_oid;
 IF actual_source IS DISTINCT FROM expected_source
    OR encode(sha256(convert_to(actual_source,'UTF8')),'hex')<>'ab45d6af1a9f6bbc1aa520adf1bfbdfd3c4bd2c4dd90cd4f647f9d75dff14f22'
    OR (length(actual_source)-length(replace(actual_source,'DECLARE r jsonb;BEGIN','')))/length('DECLARE r jsonb;BEGIN')<>1
    OR (length(actual_source)-length(replace(actual_source,'END IF;RETURN r;END','')))/length('END IF;RETURN r;END')<>1
 THEN RAISE EXCEPTION 'brp_post_wait_predecessor_or_anchor_mismatch';END IF;
 -- Snapshot complete catalog rows for unrelated entry/dispatch/source owners.
 SELECT jsonb_object_agg(p.oid::text,to_jsonb(p)) INTO before_protected
   FROM pg_catalog.pg_proc p WHERE p.oid IN('gridex_outbound_dispatch.mutate_v1(jsonb)'::regprocedure,'public.gridex_ediel_transport_attempt_v1(jsonb)'::regprocedure,'public.ediel_require_brp_change_source_current_v1(uuid,uuid)'::regprocedure,'gridex_brp_changes.require_current_before_positive_test_v1(uuid,uuid)'::regprocedure,'gridex_brp_changes.context_v1(uuid,uuid,uuid,boolean)'::regprocedure);
 IF (length(actual_definition)-length(replace(actual_definition,actual_source,'')))/length(actual_source)<>1
 THEN RAISE EXCEPTION 'brp_post_wait_definition_anchor_mismatch';END IF;
 changed_definition:=replace(actual_definition,actual_source,proposed_source);
 EXECUTE changed_definition;
 -- CREATE OR REPLACE, identical signature: preserve actual OID, owner, grants,
 -- security-definer, volatility, strictness, search_path, defaults and ALL other
 -- pg_proc fields (including ACL/config/arg/type/dependency-bearing metadata).
 IF 'gridex_ediel_transport.mutate_v1(jsonb)'::regprocedure::oid<>target_oid
    OR (SELECT to_jsonb(p)-'prosrc' FROM pg_catalog.pg_proc p WHERE p.oid=target_oid) IS DISTINCT FROM before_metadata
    OR (SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid=target_oid) IS DISTINCT FROM proposed_source
    OR (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_catalog.pg_proc p WHERE p.oid=target_oid)<>'fc00f90f28b4206dece8a4fde60d5af460d7f22e8da5d11b4ccf4acb2e3c5ad9'
    OR (SELECT jsonb_object_agg(p.oid::text,to_jsonb(p)) FROM pg_catalog.pg_proc p WHERE p.oid IN('gridex_outbound_dispatch.mutate_v1(jsonb)'::regprocedure,'public.gridex_ediel_transport_attempt_v1(jsonb)'::regprocedure,'public.ediel_require_brp_change_source_current_v1(uuid,uuid)'::regprocedure,'gridex_brp_changes.require_current_before_positive_test_v1(uuid,uuid)'::regprocedure,'gridex_brp_changes.context_v1(uuid,uuid,uuid,boolean)'::regprocedure)) IS DISTINCT FROM before_protected
 THEN RAISE EXCEPTION 'brp_post_wait_metadata_or_body_preservation_failed';END IF;
END
$brp_post_wait$;
