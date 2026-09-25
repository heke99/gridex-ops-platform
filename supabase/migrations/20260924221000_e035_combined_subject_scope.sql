-- Bound prospective owner sets to a known inbound subject before applying the
-- per-owner budget. Unknown links remain wildcards; they cannot prove absence.
BEGIN;

CREATE FUNCTION gridex_correction_process.combined_process_body_v2(
 p_company_id uuid,p_cutoff timestamptz,p_customer_id uuid,p_point_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH scoped AS MATERIALIZED (
  SELECT f.id,g.fact_id IS NOT NULL AS has_gap,w.fact_id IS NOT NULL AS has_witness
  FROM gridex_correction_process.facts f
  LEFT JOIN gridex_correction_process.gaps g ON g.fact_id=f.id
  LEFT JOIN gridex_correction_process.witnesses w ON w.fact_id=f.id AND w.observed_at<=p_cutoff
  WHERE f.captured_at<=p_cutoff
   AND (f.company_id=p_company_id OR f.old_fact->>'company_id'=p_company_id::text
    OR f.new_fact->>'company_id'=p_company_id::text)
   AND (p_customer_id IS NULL OR EXISTS (
    SELECT FROM (VALUES (f.old_fact),(f.new_fact)) side(v) WHERE side.v IS NOT NULL
     AND (nullif(side.v->>'customer_id','') IS NULL OR side.v->>'customer_id'=p_customer_id::text)))
   AND (p_point_id IS NULL OR EXISTS (
    SELECT FROM (VALUES (f.old_fact),(f.new_fact)) side(v) WHERE side.v IS NOT NULL
     AND (coalesce(nullif(side.v->>'metering_point_id',''),nullif(side.v->>'meter_point_id',''),
       nullif(side.v->>'normalized_metering_point_id',''),nullif(side.v->>'ediel_metering_point_id',''),nullif(side.v->>'facility_id',''),
       nullif(side.v->>'normalized_facility_id',''),nullif(side.v->>'site_facility_id','')) IS NULL
      OR p_point_id IN (side.v->>'metering_point_id',side.v->>'meter_point_id',
       side.v->>'normalized_metering_point_id',side.v->>'ediel_metering_point_id',
       side.v->>'facility_id',side.v->>'normalized_facility_id',side.v->>'site_facility_id')
      -- These producers can retain a point row UUID after the current graph is
      -- deleted. Resolve against immutable point history as of the transition.
      -- Missing history is unknown and must stay in the subject's budget.
      OR (f.table_name IN ('customer_supply_periods','customer_contracts',
        'customer_cases','customer_operation_jobs','customer_operation_events',
        'supplier_switch_requests')
       AND side.v->>'metering_point_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND coalesce((SELECT CASE
        WHEN coalesce(nullif(coalesce(pf.new_fact,pf.old_fact)->>'normalized_metering_point_id',''),
         nullif(coalesce(pf.new_fact,pf.old_fact)->>'metering_point_id',''),
         nullif(coalesce(pf.new_fact,pf.old_fact)->>'meter_point_id','')) IS NULL THEN true
        ELSE coalesce(p_point_id IN (coalesce(pf.new_fact,pf.old_fact)->>'normalized_metering_point_id',
         coalesce(pf.new_fact,pf.old_fact)->>'metering_point_id',
         coalesce(pf.new_fact,pf.old_fact)->>'meter_point_id',
         coalesce(pf.new_fact,pf.old_fact)->>'site_facility_id'),false) END
        FROM gridex_correction_process.facts pf
        WHERE pf.table_name='metering_points' AND pf.row_id=(side.v->>'metering_point_id')::uuid
         AND pf.captured_at<=f.captured_at AND pf.company_id=p_company_id
        ORDER BY pf.id DESC LIMIT 1),true)))))
 ), totals AS (
  SELECT count(*) AS n,count(*) FILTER (WHERE has_gap) AS gaps,
   count(*) FILTER (WHERE has_witness) AS witnesses FROM scoped
 )
 SELECT jsonb_build_object('complete',false,'authority','none',
  'historyCoverage','before_epoch_unknown','factCount',t.n,'gapCount',t.gaps,
  'witnessCount',t.witnesses,'reason',CASE WHEN t.n>1000 THEN 'scoped_process_count_overflow'
   ELSE 'before_epoch_unknown' END,
  'facts',CASE WHEN t.n<=1000 THEN (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',f.id,'table',f.table_name,'rowId',f.row_id,'operation',f.operation,
    'old',f.old_fact,'new',f.new_fact,'factsHash',f.facts_hash,'capturedAt',f.captured_at,
    'gapReason',g.reason,'witnessId',w.id,'witnessAt',w.observed_at) ORDER BY f.id),'[]'::jsonb)
    FROM scoped s JOIN gridex_correction_process.facts f ON f.id=s.id
    LEFT JOIN gridex_correction_process.gaps g ON g.fact_id=f.id
    LEFT JOIN gridex_correction_process.witnesses w ON w.fact_id=f.id AND w.observed_at<=p_cutoff
    WHERE g.fact_id IS NULL
     AND (f.old_fact->>'company_id' IS NULL OR f.old_fact->>'company_id'=p_company_id::text)
     AND (f.new_fact->>'company_id' IS NULL OR f.new_fact->>'company_id'=p_company_id::text))
   ELSE '[]'::jsonb END,
  'epochs',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.table_name),'[]'::jsonb)
    FROM gridex_correction_process.epochs e)) FROM totals t;
$$;
REVOKE ALL ON FUNCTION gridex_correction_process.combined_process_body_v2(uuid,timestamptz,uuid,text)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_correction_process.combined_outbound_body_v2(
 p_company_id uuid,p_environment text,p_cutoff timestamptz,p_point_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH concerns AS MATERIALIZED (
  SELECT c.facts->'scope' AS scope FROM gridex_received_sources.correction_concerns c
  WHERE c.company_id=p_company_id AND c.environment=p_environment
   AND c.captured_at<=p_cutoff AND c.source_received_at<=p_cutoff
   AND (p_point_id IS NULL OR c.facts->'scope'->>'objectId' IS NULL
    OR c.facts->'scope'->>'objectId'=p_point_id)
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
REVOKE ALL ON FUNCTION gridex_correction_process.combined_outbound_body_v2(uuid,text,timestamptz,text)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_correction_process.combined_document_body_v2(
 p_company_id uuid,p_environment text,p_cutoff timestamptz,p_point_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH scoped AS MATERIALIZED (
  SELECT a.* FROM gridex_received_sources.document_reference_attempts a
  WHERE a.company_id=p_company_id AND a.environment=p_environment AND a.recorded_at<=p_cutoff
   AND EXISTS(SELECT FROM gridex_received_sources.correction_concerns c
    WHERE c.source_message_id=a.source_message_id AND c.company_id=a.company_id
      AND c.environment=a.environment AND c.captured_at<=p_cutoff
      AND c.source_received_at<=p_cutoff
      AND (p_point_id IS NULL OR c.facts->'scope'->>'objectId' IS NULL
       OR c.facts->'scope'->>'objectId'=p_point_id))
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
REVOKE ALL ON FUNCTION gridex_correction_process.combined_document_body_v2(uuid,text,timestamptz,text)
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

 -- The subject linkage and all five STABLE owners use this SELECT's MVCC
 -- visibility. No second read can silently change the selected population.
 SELECT gridex_received_sources.selection_body_v2(p_company_id,p_environment,p_cutoff,observed),
  gridex_correction_process.combined_process_body_v2(p_company_id,p_cutoff,m.customer_id,mp.metering_point_id),
  gridex_received_sources.combined_concern_body_v1(p_company_id,p_environment,p_cutoff),
  gridex_correction_process.combined_outbound_body_v2(p_company_id,p_environment,p_cutoff,mp.metering_point_id),
  gridex_correction_process.combined_document_body_v2(p_company_id,p_environment,p_cutoff,mp.metering_point_id),
  pg_current_snapshot()::text
 INTO source_body,process_body,concern_body,outbound_body,document_body,snap
 FROM public.ediel_messages m LEFT JOIN public.metering_points mp
  ON mp.id=m.metering_point_id AND mp.company_id=m.company_id
 WHERE m.id=p_message_id AND m.company_id=p_company_id AND m.environment=p_environment
  AND m.direction='inbound';
 IF snap IS NULL THEN RAISE EXCEPTION 'combined_snapshot_scope_unavailable' USING ERRCODE='42501'; END IF;
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
