-- Extend the hold-only receipt with two prospective owners in the same SELECT.
-- Neither owner can certify pre-installation dispatch or document history.
BEGIN;
CREATE FUNCTION gridex_correction_process.combined_outbound_body_v1(
 p_company_id uuid,p_environment text,p_cutoff timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH concerns AS MATERIALIZED (
  SELECT c.facts->'scope' AS scope FROM gridex_received_sources.correction_concerns c
  WHERE c.company_id=p_company_id AND c.environment=p_environment
   AND c.captured_at<=p_cutoff AND c.source_received_at<=p_cutoff
 ), candidates AS MATERIALIZED (
  SELECT m.id,o.message_id IS NOT NULL AS instrumented,
   coalesce(o.raw_payload,m.raw_payload) AS raw_payload,
   coalesce(o.payload_hash,m.immutable_payload_hash) AS payload_hash,
   gridex_outbound_dispatch.scope_v1(coalesce(o.raw_payload,m.raw_payload)) AS wire_scope
  FROM public.ediel_messages m
  LEFT JOIN gridex_outbound_dispatch.originals o ON o.message_id=m.id
   AND o.company_id=p_company_id AND o.environment=p_environment AND o.captured_at<=p_cutoff
  WHERE m.company_id=p_company_id AND m.environment=p_environment
   AND m.direction='outbound' AND m.created_at<=p_cutoff
   AND (m.message_code='Z08' OR m.rule_profile_key='PRODAT:Z08:H:26.A:r3' OR o.message_id IS NOT NULL)
 ), scoped AS MATERIALIZED (
  SELECT c.* FROM candidates c WHERE EXISTS(SELECT FROM concerns concern
    WHERE (concern.scope->>'objectId' IS NULL OR c.wire_scope->>'point' IS NULL
      OR concern.scope->>'objectId'=c.wire_scope->>'point')
     AND (concern.scope->>'legalSender' IS NULL OR c.wire_scope->>'outboundReceiver' IS NULL
      OR concern.scope->>'legalSender'=c.wire_scope->>'outboundReceiver')
     AND (concern.scope->>'legalReceiver' IS NULL OR c.wire_scope->>'outboundSender' IS NULL
      OR concern.scope->>'legalReceiver'=c.wire_scope->>'outboundSender'))
 ), totals AS (
  SELECT count(*) AS n,coalesce(sum(octet_length(raw_payload)),0) AS bytes FROM scoped
 )
 SELECT jsonb_build_object('complete',false,'authority','none',
  'historyCoverage','before_epoch_unknown','reason',
  CASE WHEN t.n>1000 THEN 'outbound_count_overflow'
   WHEN t.bytes>6291456 THEN 'outbound_bytes_overflow' ELSE 'prospective_history_only' END,
  'originalCount',t.n,'visibilitySnapshot',pg_current_snapshot()::text,
  'epoch',(SELECT to_jsonb(e) FROM gridex_outbound_dispatch.epoch e),
  'originals',CASE WHEN t.n<=1000 AND t.bytes<=6291456 THEN
   (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'messageId',s.id,'instrumented',s.instrumented,'rawPayload',s.raw_payload,
    'payloadHash',s.payload_hash,'scope',s.wire_scope,
    'attempts',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'owner',a.owner,
      'binding',a.binding,'createdAt',a.created_at) ORDER BY a.id),'[]'::jsonb)
     FROM gridex_outbound_dispatch.attempts a WHERE a.message_id=s.id AND a.created_at<=p_cutoff),
    'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'attemptId',e.attempt_id,
      'kind',e.kind,'facts',e.facts,'observedAt',e.observed_at,
      'witnessId',w.event_id,'witnessAt',w.available_at) ORDER BY e.observed_at,e.id),'[]'::jsonb)
     FROM gridex_outbound_dispatch.events e LEFT JOIN gridex_outbound_dispatch.witnesses w
       ON w.event_id=e.id AND w.company_id=p_company_id AND w.environment=p_environment
       AND w.available_at<=p_cutoff
     WHERE e.message_id=s.id AND e.company_id=p_company_id AND e.environment=p_environment
      AND e.observed_at<=p_cutoff)) ORDER BY s.id),'[]'::jsonb) FROM scoped s)
   ELSE '[]'::jsonb END) FROM totals t;
$$;
REVOKE ALL ON FUNCTION gridex_correction_process.combined_outbound_body_v1(uuid,text,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_correction_process.combined_document_body_v1(
 p_company_id uuid,p_environment text,p_cutoff timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH scoped AS MATERIALIZED (
  SELECT a.* FROM gridex_received_sources.document_reference_attempts a
  WHERE a.company_id=p_company_id AND a.environment=p_environment AND a.recorded_at<=p_cutoff
   AND EXISTS(SELECT FROM gridex_received_sources.correction_concerns c
    WHERE c.source_message_id=a.source_message_id AND c.company_id=a.company_id
      AND c.environment=a.environment AND c.captured_at<=p_cutoff
      AND c.source_received_at<=p_cutoff)
  ORDER BY a.recorded_at,a.id
 ), totals AS (SELECT count(*) AS n,coalesce(sum(octet_length(facts::text)),0) AS bytes FROM scoped)
 SELECT jsonb_build_object('complete',false,'authority','none',
  'historyCoverage','before_epoch_unknown','reason',
  CASE WHEN t.n>1000 THEN 'document_count_overflow'
   WHEN t.bytes>6291456 THEN 'document_bytes_overflow' ELSE 'prospective_history_only' END,
  'attemptCount',t.n,'visibilitySnapshot',pg_current_snapshot()::text,
  'epoch',(SELECT to_jsonb(e) FROM gridex_received_sources.document_reference_epoch e),
  'attempts',CASE WHEN t.n<=1000 AND t.bytes<=6291456 THEN
   (SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'sourceMessageId',a.source_message_id,
    'documentId',a.document_id,'predecessorId',a.predecessor_id,'facts',a.facts,
    'factsHash',a.facts_hash,'recordedAt',a.recorded_at,
    'outcome',CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object('id',o.id,
      'status',o.status,'observation',o.observation,'factsHash',o.facts_hash,
      'recordedAt',o.recorded_at,'witnessId',w.id,'witnessAt',w.observed_at) END)
    ORDER BY a.recorded_at,a.id),'[]'::jsonb)
    FROM scoped a LEFT JOIN gridex_received_sources.document_reference_outcomes o
      ON o.attempt_id=a.id AND o.company_id=p_company_id AND o.environment=p_environment
      AND o.recorded_at<=p_cutoff
    LEFT JOIN gridex_received_sources.document_reference_witnesses w
      ON w.outcome_id=o.id AND w.company_id=p_company_id AND w.environment=p_environment
      AND w.observed_at<=p_cutoff)
   ELSE '[]'::jsonb END) FROM totals t;
$$;
REVOKE ALL ON FUNCTION gridex_correction_process.combined_document_body_v1(uuid,text,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION gridex_correction_process.open_combined_v1(
 p_company_id uuid,p_environment text,p_message_id uuid,p_cutoff timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE observed timestamptz:=clock_timestamp(); source_body jsonb; process_body jsonb;
 concern_body jsonb; outbound_body jsonb; document_body jsonb;
 snap text; body jsonb; bytes text; source_text text;
 saved gridex_correction_process.combined_snapshots%rowtype;
BEGIN
 IF p_company_id IS NULL OR p_environment NOT IN ('test','production') OR p_environment IS NULL
 OR p_message_id IS NULL OR p_cutoff IS NULL OR NOT isfinite(p_cutoff) OR p_cutoff>observed
 OR NOT EXISTS(SELECT FROM public.ediel_messages m WHERE m.id=p_message_id
  AND m.company_id=p_company_id AND m.environment=p_environment AND m.direction='inbound')
 THEN RAISE EXCEPTION 'combined_snapshot_scope_unavailable' USING ERRCODE='42501'; END IF;

 -- All five STABLE readers share this one MVCC statement, including the
 -- visibility token. No later volatile read can change the saved owner sets.
 SELECT gridex_received_sources.selection_body_v2(p_company_id,p_environment,p_cutoff,observed),
  gridex_correction_process.combined_process_body_v1(p_company_id,p_cutoff),
  gridex_received_sources.combined_concern_body_v1(p_company_id,p_environment,p_cutoff),
  gridex_correction_process.combined_outbound_body_v1(p_company_id,p_environment,p_cutoff),
  gridex_correction_process.combined_document_body_v1(p_company_id,p_environment,p_cutoff),
  pg_current_snapshot()::text
 INTO source_body,process_body,concern_body,outbound_body,document_body,snap;
 source_text:=source_body::text;
 body:=jsonb_build_object('version',1,'companyId',p_company_id,'environment',p_environment,
  'subjectMessageId',p_message_id,'cutoffAt',p_cutoff,'visibilitySnapshot',snap,
  'source',jsonb_build_object('readsetText',source_text,
    'readsetHash',encode(sha256(convert_to(source_text,'UTF8')),'hex'),'visibilitySnapshot',snap),
  'process',process_body||jsonb_build_object('visibilitySnapshot',snap),
  'correction',concern_body||jsonb_build_object('visibilitySnapshot',snap),
  'outbound',outbound_body||jsonb_build_object('visibilitySnapshot',snap),
  'document',document_body||jsonb_build_object('visibilitySnapshot',snap));
 bytes:=body::text;
 INSERT INTO gridex_correction_process.combined_snapshots(company_id,environment,subject_message_id,
  cutoff_at,visibility_snapshot,readset_text,readset_hash)
 VALUES(p_company_id,p_environment,p_message_id,p_cutoff,snap,bytes,
  encode(sha256(convert_to(bytes,'UTF8')),'hex')) RETURNING * INTO saved;
 RETURN jsonb_build_object('snapshotId',saved.id,'readsetText',saved.readset_text,
  'readsetHash',saved.readset_hash);
END $$;
COMMIT;
