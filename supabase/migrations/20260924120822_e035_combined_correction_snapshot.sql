-- Hold-only combined receipt. The three STABLE readers invoked by one SELECT
-- share that SELECT's MVCC snapshot; the later INSERT only saves its bytes.
BEGIN;
CREATE FUNCTION gridex_received_sources.selection_body_v2(
 p_company_id uuid,p_environment text,p_cutoff timestamptz,p_observed timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE body jsonb; bytes text;
BEGIN
 IF p_company_id IS NULL OR p_environment NOT IN ('test','production') OR p_cutoff IS NULL
 OR NOT isfinite(p_cutoff) OR p_cutoff>p_observed THEN
  RAISE EXCEPTION 'source_selection_scope_unavailable' USING ERRCODE='22023'; END IF;
 WITH candidates AS MATERIALIZED (
  SELECT s.source_message_id,octet_length(s.raw_payload) AS payload_bytes FROM gridex_received_sources.sources s
  WHERE s.company_id=p_company_id AND s.environment=p_environment AND s.captured_at<=p_cutoff
   AND (s.source_received_at IS NULL OR s.source_received_at<=p_cutoff) ORDER BY s.source_message_id LIMIT 1001
 ), assessments AS MATERIALIZED (
  SELECT a.id,a.source_message_id,octet_length(a.facts_text) AS fact_bytes FROM candidates s
  CROSS JOIN LATERAL(SELECT a.id,a.source_message_id,a.facts_text FROM gridex_received_sources.object_assessments a WHERE a.source_message_id=s.source_message_id ORDER BY a.assessed_at,a.id LIMIT 129)a
 ), totals AS (
  SELECT (SELECT count(*) FROM candidates) AS n,
   (SELECT coalesce(sum(payload_bytes),0) FROM candidates)+(SELECT coalesce(sum(fact_bytes),0) FROM assessments) AS total_bytes,
   (SELECT coalesce(max(payload_bytes),0) FROM candidates) AS max_payload,
   (SELECT coalesce(max(n),0) FROM (SELECT count(*) AS n FROM assessments GROUP BY source_message_id)c) AS max_assessments
 ), bounded AS (SELECT *,n<=1000 AND total_bytes<=6291456 AND max_payload<=262144 AND max_assessments<=128 AS complete FROM totals)
 SELECT jsonb_build_object('version',1,'companyId',p_company_id,'environment',p_environment,'cutoffAt',p_cutoff,
  'capturedAt',p_observed,'complete',b.complete,'sourceCount',b.n,'historyCoverage','before_ledger_unknown',
  'ledgerStartedAt',(SELECT opened_at FROM gridex_received_sources.epoch WHERE singleton),
  'sources',CASE WHEN b.complete THEN (SELECT coalesce(jsonb_agg(jsonb_build_object(
   'sourceMessageId',s.source_message_id,'payloadHash',s.payload_hash,'rawPayload',s.raw_payload,
   'receivedAt',s.source_received_at,'capturedAt',s.captured_at,'messageCode',s.message_code,
   'assessments',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'previousAssessmentId',a.previous_assessment_id,
    'canonicalAssessmentId',a.canonical_assessment_id,'assessedAt',a.assessed_at,
    'availableAt',w.observed_at,'availabilityWitnessId',w.id,'factsText',a.facts_text,'factsHash',a.facts_hash) ORDER BY a.assessed_at,a.id),'[]'::jsonb)
    FROM assessments list JOIN gridex_received_sources.object_assessments a ON a.id=list.id
    LEFT JOIN gridex_received_sources.object_availability_witnesses w ON w.assessment_id=a.id AND w.company_id=a.company_id AND w.environment=a.environment AND w.facts_hash=a.facts_hash
    WHERE list.source_message_id=s.source_message_id)) ORDER BY s.source_message_id),'[]'::jsonb)
   FROM candidates c JOIN gridex_received_sources.sources s USING(source_message_id)) ELSE '[]'::jsonb END)
 INTO body FROM bounded b;

 bytes:=body::text;
 IF octet_length(bytes)>8388608 THEN
  body:=jsonb_set(jsonb_set(body,'{complete}','false'),'{sources}','[]');
 END IF;
 RETURN body;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.selection_body_v2(uuid,text,timestamptz,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_correction_process.combined_process_body_v1(
 p_company_id uuid,p_cutoff timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH scoped AS MATERIALIZED (
  SELECT f.id,g.fact_id IS NOT NULL AS has_gap,w.fact_id IS NOT NULL AS has_witness
  FROM gridex_correction_process.facts f
  LEFT JOIN gridex_correction_process.gaps g ON g.fact_id=f.id
  LEFT JOIN gridex_correction_process.witnesses w ON w.fact_id=f.id AND w.observed_at<=p_cutoff
  WHERE f.captured_at<=p_cutoff
   AND (f.company_id=p_company_id OR f.old_fact->>'company_id'=p_company_id::text
    OR f.new_fact->>'company_id'=p_company_id::text)
 ), totals AS (
  SELECT count(*) AS n,
   count(*) FILTER (WHERE has_gap) AS gaps,
   count(*) FILTER (WHERE has_witness) AS witnesses FROM scoped
 )
 SELECT jsonb_build_object('complete',false,'authority','none',
  'historyCoverage','before_epoch_unknown','factCount',t.n,'gapCount',t.gaps,
  'witnessCount',t.witnesses,'reason',CASE WHEN t.n>1000 THEN 'process_count_overflow' ELSE 'before_epoch_unknown' END,
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
REVOKE ALL ON FUNCTION gridex_correction_process.combined_process_body_v1(uuid,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_received_sources.combined_concern_body_v1(
 p_company_id uuid,p_environment text,p_cutoff timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH scoped AS MATERIALIZED (
  SELECT c.id FROM gridex_received_sources.correction_concerns c
  WHERE c.company_id=p_company_id AND c.environment=p_environment
   AND c.captured_at<=p_cutoff AND c.source_received_at<=p_cutoff
 ), totals AS (SELECT count(*) AS n FROM scoped)
 SELECT jsonb_build_object('count',t.n,'complete',t.n<=1000,
  'reason',CASE WHEN t.n>1000 THEN 'correction_count_overflow' ELSE NULL END,
  'items',CASE WHEN t.n<=1000 THEN (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'sourceMessageId',c.source_message_id,'sourcePayloadHash',c.source_payload_hash,
    'facts',c.facts,'factsHash',c.facts_hash,'capturedAt',c.captured_at,
    'witnessId',w.id,'witnessAt',w.observed_at,'witnessHash',w.facts_hash) ORDER BY c.captured_at,c.id),'[]'::jsonb)
    FROM scoped s JOIN gridex_received_sources.correction_concerns c ON c.id=s.id
    LEFT JOIN gridex_received_sources.correction_witnesses w ON w.capture_id=c.id
      AND w.company_id=c.company_id AND w.environment=c.environment
      AND w.facts_hash=c.facts_hash AND w.observed_at<=p_cutoff)
   ELSE '[]'::jsonb END) FROM totals t;
$$;
REVOKE ALL ON FUNCTION gridex_received_sources.combined_concern_body_v1(uuid,text,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE gridex_correction_process.combined_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL, environment text NOT NULL CHECK(environment IN ('test','production')),
 subject_message_id uuid NOT NULL, cutoff_at timestamptz NOT NULL,
 visibility_snapshot text NOT NULL, readset_text text NOT NULL,
 readset_hash text NOT NULL CHECK(readset_hash ~ '^[a-f0-9]{64}$'),
 saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(octet_length(readset_text)<=20971520)
);
CREATE INDEX ON gridex_correction_process.combined_snapshots(company_id,subject_message_id,cutoff_at);
ALTER TABLE gridex_correction_process.combined_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_correction_process.combined_snapshots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_correction_process.combined_snapshots FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON gridex_correction_process.combined_snapshots
 FOR EACH ROW EXECUTE FUNCTION gridex_correction_process.immutable_v1();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON gridex_correction_process.combined_snapshots
 FOR EACH STATEMENT EXECUTE FUNCTION gridex_correction_process.immutable_v1();

CREATE FUNCTION gridex_correction_process.open_combined_v1(
 p_company_id uuid,p_environment text,p_message_id uuid,p_cutoff timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE observed timestamptz:=clock_timestamp(); source_body jsonb; process_body jsonb;
 concern_body jsonb; snap text; body jsonb; bytes text; source_text text;
 saved gridex_correction_process.combined_snapshots%rowtype;
BEGIN
 IF p_company_id IS NULL OR p_environment NOT IN ('test','production') OR p_environment IS NULL
 OR p_message_id IS NULL OR p_cutoff IS NULL OR NOT isfinite(p_cutoff) OR p_cutoff>observed
 OR NOT EXISTS(SELECT FROM public.ediel_messages m WHERE m.id=p_message_id
  AND m.company_id=p_company_id AND m.environment=p_environment AND m.direction='inbound')
 THEN RAISE EXCEPTION 'combined_snapshot_scope_unavailable' USING ERRCODE='42501'; END IF;

 -- All three STABLE functions use the snapshot established by THIS SELECT.
 -- Do not split this SELECT into sequential RPCs or VOLATILE readers.
 SELECT gridex_received_sources.selection_body_v2(p_company_id,p_environment,p_cutoff,observed),
  gridex_correction_process.combined_process_body_v1(p_company_id,p_cutoff),
  gridex_received_sources.combined_concern_body_v1(p_company_id,p_environment,p_cutoff),
  pg_current_snapshot()::text
 INTO source_body,process_body,concern_body,snap;
 source_text:=source_body::text;
 body:=jsonb_build_object('version',1,'companyId',p_company_id,'environment',p_environment,
  'subjectMessageId',p_message_id,'cutoffAt',p_cutoff,'visibilitySnapshot',snap,
  'source',jsonb_build_object('readsetText',source_text,
    'readsetHash',encode(sha256(convert_to(source_text,'UTF8')),'hex'),'visibilitySnapshot',snap),
  'process',process_body||jsonb_build_object('visibilitySnapshot',snap),
  'correction',concern_body||jsonb_build_object('visibilitySnapshot',snap));
 bytes:=body::text;
 INSERT INTO gridex_correction_process.combined_snapshots(company_id,environment,subject_message_id,
  cutoff_at,visibility_snapshot,readset_text,readset_hash)
 VALUES(p_company_id,p_environment,p_message_id,p_cutoff,snap,bytes,
  encode(sha256(convert_to(bytes,'UTF8')),'hex')) RETURNING * INTO saved;
 RETURN jsonb_build_object('snapshotId',saved.id,'readsetText',saved.readset_text,
  'readsetHash',saved.readset_hash);
END $$;
CREATE FUNCTION public.gridex_correction_combined_snapshot_v1(
 p_company_id uuid,p_environment text,p_message_id uuid,p_cutoff timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user<>'service_role' THEN
  RAISE EXCEPTION 'combined_snapshot_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_correction_process.open_combined_v1(p_company_id,p_environment,p_message_id,p_cutoff);
END $$;
REVOKE ALL ON FUNCTION gridex_correction_process.open_combined_v1(uuid,text,uuid,timestamptz),
 public.gridex_correction_combined_snapshot_v1(uuid,text,uuid,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_correction_process.open_combined_v1(uuid,text,uuid,timestamptz),
 public.gridex_correction_combined_snapshot_v1(uuid,text,uuid,timestamptz) TO service_role;
COMMIT;
