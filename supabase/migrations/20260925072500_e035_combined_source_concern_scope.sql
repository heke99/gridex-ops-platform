-- Scope immutable source owners before counting. An unparseable or ambiguous
-- identity is a wildcard, never evidence of absence.
BEGIN;
CREATE FUNCTION gridex_received_sources.source_wire_point_v1(p_raw text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_received_sources.closure_wire_tokens_v1(p_raw);
 n integer; valid_n integer; point text;
BEGIN
 IF tokens IS NULL THEN RETURN NULL; END IF;
 SELECT count(*),count(*) FILTER (WHERE t#>>'{elements,3,3}'='9'
  AND nullif(t#>>'{elements,3,0}','') IS NOT NULL),max(t#>>'{elements,3,0}')
 INTO n,valid_n,point FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN';
 IF n=1 AND valid_n=1 AND length(point)<=128 THEN RETURN point; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.source_wire_point_v1(text)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_correction_process.subject_wire_point_v1(p_raw text,p_hash text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb; n integer; valid_n integer; point text;
BEGIN
 IF p_raw IS NULL OR p_hash IS NULL OR p_hash<>encode(sha256(convert_to(p_raw,'UTF8')),'hex')
 THEN RETURN NULL; END IF;
 tokens:=gridex_received_sources.closure_wire_tokens_v1(p_raw);
 IF tokens IS NULL THEN RETURN NULL; END IF;
 SELECT count(*),count(*) FILTER (WHERE t#>>'{elements,2,2}'='9'
  AND nullif(t#>>'{elements,2,0}','') IS NOT NULL),max(t#>>'{elements,2,0}')
 INTO n,valid_n,point FROM jsonb_array_elements(tokens) t
 WHERE t->>'tag'='LOC' AND t#>>'{elements,1,0}'='172';
 IF n=1 AND valid_n=1 AND length(point)<=128 THEN RETURN point; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION gridex_correction_process.subject_wire_point_v1(text,text)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_received_sources.selection_body_v3(
 p_company_id uuid,p_environment text,p_cutoff timestamptz,p_observed timestamptz,p_point_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE body jsonb; bytes text;
BEGIN
 IF p_company_id IS NULL OR p_environment NOT IN ('test','production') OR p_cutoff IS NULL
 OR NOT isfinite(p_cutoff) OR p_cutoff>p_observed THEN
  RAISE EXCEPTION 'source_selection_scope_unavailable' USING ERRCODE='22023'; END IF;
 WITH candidates AS MATERIALIZED (
  SELECT s.source_message_id,octet_length(s.raw_payload) AS payload_bytes FROM gridex_received_sources.sources s
  WHERE s.company_id=p_company_id AND s.environment=p_environment AND s.captured_at<=p_cutoff
   AND (s.source_received_at IS NULL OR s.source_received_at<=p_cutoff)
   AND (p_point_id IS NULL OR gridex_received_sources.source_wire_point_v1(s.raw_payload) IS NULL
    OR gridex_received_sources.source_wire_point_v1(s.raw_payload)=p_point_id)
  ORDER BY s.source_message_id LIMIT 1001
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
REVOKE ALL ON FUNCTION gridex_received_sources.selection_body_v3(uuid,text,timestamptz,timestamptz,text)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_received_sources.combined_concern_body_v2(
 p_company_id uuid,p_environment text,p_cutoff timestamptz,p_point_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH scoped AS MATERIALIZED (
  SELECT c.id FROM gridex_received_sources.correction_concerns c
  WHERE c.company_id=p_company_id AND c.environment=p_environment
   AND c.captured_at<=p_cutoff AND c.source_received_at<=p_cutoff
   AND (p_point_id IS NULL OR c.facts->'scope'->>'objectId' IS NULL
    OR c.facts->'scope'->>'objectId'=p_point_id)
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
REVOKE ALL ON FUNCTION gridex_received_sources.combined_concern_body_v2(uuid,text,timestamptz,text)
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
 SELECT gridex_received_sources.selection_body_v3(p_company_id,p_environment,p_cutoff,observed,subject.point_id),
  gridex_correction_process.combined_process_body_v2(p_company_id,p_cutoff,m.customer_id,mp.metering_point_id),
  gridex_received_sources.combined_concern_body_v2(p_company_id,p_environment,p_cutoff,subject.point_id),
  gridex_correction_process.combined_outbound_body_v2(p_company_id,p_environment,p_cutoff,mp.metering_point_id),
  gridex_correction_process.combined_document_body_v2(p_company_id,p_environment,p_cutoff,mp.metering_point_id),
  pg_current_snapshot()::text
 INTO source_body,process_body,concern_body,outbound_body,document_body,snap
 FROM public.ediel_messages m LEFT JOIN public.metering_points mp
  ON mp.id=m.metering_point_id AND mp.company_id=m.company_id
 CROSS JOIN LATERAL (SELECT gridex_correction_process.subject_wire_point_v1(
  m.raw_payload,m.immutable_payload_hash) AS point_id) subject
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
