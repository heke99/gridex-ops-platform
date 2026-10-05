-- Created by actual Supabase CLI 2.101.0; no historical backfill.
BEGIN;
CREATE TABLE gridex_received_sources.object_availability_witnesses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 assessment_id uuid NOT NULL UNIQUE REFERENCES gridex_received_sources.object_assessments(id) ON DELETE RESTRICT,
 company_id uuid NOT NULL, environment text NOT NULL CHECK(environment IN ('test','production')),
 source_message_id uuid NOT NULL REFERENCES gridex_received_sources.sources(source_message_id) ON DELETE RESTRICT,
 facts_hash text NOT NULL, visibility_snapshot text NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE gridex_received_sources.object_selection_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
 environment text NOT NULL CHECK(environment IN ('test','production')),
 cutoff_at timestamptz NOT NULL, captured_at timestamptz NOT NULL,
 readset_text text NOT NULL CHECK(octet_length(readset_text)<=8388608),
 readset_hash text NOT NULL CHECK(readset_hash=encode(sha256(convert_to(readset_text,'UTF8')),'hex')),
 visibility_snapshot text NOT NULL
);
DO $security$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['object_availability_witnesses','object_selection_snapshots'] LOOP
  EXECUTE format('ALTER TABLE gridex_received_sources.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE gridex_received_sources.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON gridex_received_sources.%I FROM PUBLIC,anon,authenticated,service_role',tab);
  EXECUTE format('CREATE TRIGGER immutable_update_delete BEFORE UPDATE OR DELETE ON gridex_received_sources.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()',tab);
  EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_received_sources.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()',tab);
 END LOOP;
END $security$;
CREATE FUNCTION gridex_received_sources.witness_object_availability(p_company_id uuid,p_environment text,p_assessment_id uuid,p_facts_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE found_id uuid; source_id uuid; snap text; witness gridex_received_sources.object_availability_witnesses%rowtype;
BEGIN
 -- A result from the current transaction is expressly insufficient. The owner
 -- append must have committed before this separate service RPC can observe it.
 SELECT a.id,a.source_message_id,pg_current_snapshot()::text INTO found_id,source_id,snap
 FROM gridex_received_sources.object_assessments a
 WHERE a.id=p_assessment_id AND a.company_id=p_company_id AND a.environment=p_environment
 AND a.facts_hash=p_facts_hash AND a.created_xid<>pg_current_xact_id();
 IF found_id IS NULL THEN RAISE EXCEPTION 'source_object_availability_unproven' USING ERRCODE='23514'; END IF;
 INSERT INTO gridex_received_sources.object_availability_witnesses(assessment_id,company_id,environment,source_message_id,facts_hash,visibility_snapshot)
 VALUES(found_id,p_company_id,p_environment,source_id,p_facts_hash,snap) ON CONFLICT(assessment_id) DO NOTHING;
 SELECT * INTO STRICT witness FROM gridex_received_sources.object_availability_witnesses WHERE assessment_id=found_id;
 RETURN jsonb_build_object('version',1,'witnessId',witness.id,'assessmentId',found_id,'companyId',p_company_id,'environment',p_environment,'factsHash',p_facts_hash,'availableAt',witness.observed_at);
END $$;
CREATE FUNCTION public.gridex_witness_source_objects_v1(p_company_id uuid,p_environment text,p_assessment_id uuid,p_facts_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'received_evidence_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_received_sources.witness_object_availability(p_company_id,p_environment,p_assessment_id,p_facts_hash);
END $$;

CREATE FUNCTION gridex_received_sources.open_object_selection_snapshot(p_company_id uuid,p_environment text,p_cutoff timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE observed timestamptz:=clock_timestamp(); body jsonb; snap text; bytes text; digest text; result_id uuid;
BEGIN
 IF p_company_id IS NULL OR p_environment IS NULL OR p_environment NOT IN ('test','production')
 OR p_cutoff IS NULL OR NOT isfinite(p_cutoff) OR p_cutoff>observed THEN RAISE EXCEPTION 'source_selection_scope_unavailable' USING ERRCODE='22023'; END IF;
 -- Count, limits, payloads, all immutable decisions and witnesses are read in
 -- ONE MVCC statement. Overflows return an explicit incomplete empty readset.
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
  'capturedAt',observed,'complete',b.complete,'sourceCount',b.n,'historyCoverage','before_ledger_unknown',
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
   FROM candidates c JOIN gridex_received_sources.sources s USING(source_message_id)) ELSE '[]'::jsonb END),pg_current_snapshot()::text
 INTO body,snap FROM bounded b;
 bytes:=body::text;
 -- JSON escaping/metadata may expand beyond the summed input budget.
 IF octet_length(bytes)>8388608 THEN body:=jsonb_set(jsonb_set(body,'{complete}','false'),'{sources}','[]');bytes:=body::text; END IF;
 digest:=encode(sha256(convert_to(bytes,'UTF8')),'hex');
 INSERT INTO gridex_received_sources.object_selection_snapshots(company_id,environment,cutoff_at,captured_at,readset_text,readset_hash,visibility_snapshot)
 VALUES(p_company_id,p_environment,p_cutoff,observed,bytes,digest,snap) RETURNING id INTO result_id;
 RETURN jsonb_build_object('snapshotId',result_id,'readsetText',bytes,'readsetHash',digest);
END $$;
CREATE FUNCTION public.gridex_source_object_snapshot_v1(p_company_id uuid,p_environment text,p_cutoff timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'received_evidence_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_received_sources.open_object_selection_snapshot(p_company_id,p_environment,p_cutoff);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.witness_object_availability(uuid,text,uuid,text),public.gridex_witness_source_objects_v1(uuid,text,uuid,text),gridex_received_sources.open_object_selection_snapshot(uuid,text,timestamptz),public.gridex_source_object_snapshot_v1(uuid,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_received_sources.witness_object_availability(uuid,text,uuid,text),public.gridex_witness_source_objects_v1(uuid,text,uuid,text),gridex_received_sources.open_object_selection_snapshot(uuid,text,timestamptz),public.gridex_source_object_snapshot_v1(uuid,text,timestamptz) TO service_role;
COMMENT ON TABLE gridex_received_sources.object_availability_witnesses IS 'Actual visibility observation of an already committed owner assessment. Neither receipt nor assessment timestamp proves availability. No pre-ledger reconstruction.';
COMMENT ON TABLE gridex_received_sources.object_selection_snapshots IS 'Exact bounded immutable comparison readset. Current capture time is distinct from each approval availability witness and market effective time.';
COMMIT;
