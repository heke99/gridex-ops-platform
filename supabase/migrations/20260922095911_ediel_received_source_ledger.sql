-- SOURCE CANDIDATE: adopt only through genuine CLI generation and native verification.
-- No historical backfill, PR310 import, production operation or implicit source approval.
BEGIN;

-- Wait for existing writers, then atomically install the forward capture
-- boundary. A timestamp without this locking/transaction boundary is NOT a
-- completeness claim. Existing rows are intentionally not reconstructed.
LOCK TABLE public.ediel_messages IN SHARE ROW EXCLUSIVE MODE;

CREATE SCHEMA gridex_received_sources;
REVOKE ALL ON SCHEMA gridex_received_sources FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE gridex_received_sources.epoch (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO gridex_received_sources.epoch(singleton) VALUES (true);

CREATE TABLE gridex_received_sources.sources (
  source_message_id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test', 'production')),
  origin text NOT NULL CHECK (origin = 'database_insert'),
  message_code text,
  source_received_at timestamptz,
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  raw_payload text,
  payload_hash text,
  received_context jsonb,
  CONSTRAINT received_source_hash_check CHECK (
    (raw_payload IS NULL AND payload_hash IS NULL)
    OR (raw_payload IS NOT NULL AND payload_hash IS NOT NULL
        AND payload_hash ~ '^[a-f0-9]{64}$'
        AND payload_hash = encode(sha256(convert_to(raw_payload, 'UTF8')), 'hex'))
  )
);
-- Deliberately NO FK to ediel_messages and NO cascade from its mutable links.
-- Deleting/reassigning a live operational row cannot remove/relabel its source.
-- This does not decide the lawful retention period or authorize company exports.
CREATE INDEX received_sources_original_scope_cutoff_idx
  ON gridex_received_sources.sources(company_id, environment, captured_at, source_message_id);

ALTER TABLE gridex_received_sources.epoch ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_sources.epoch FORCE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_sources.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_sources.sources FORCE ROW LEVEL SECURITY;

CREATE POLICY received_sources_original_company_read
  ON gridex_received_sources.sources FOR SELECT TO authenticated
  USING (public.gridex_can_read_company(company_id));
CREATE POLICY received_sources_service_read
  ON gridex_received_sources.sources FOR SELECT TO service_role USING (true);
CREATE POLICY received_sources_epoch_read
  ON gridex_received_sources.epoch FOR SELECT TO authenticated, service_role USING (true);

-- No caller INSERT/UPDATE/DELETE/TRUNCATE privileges, including service_role.
-- The internal capture trigger writes as the trusted migration/function owner.
REVOKE ALL ON ALL TABLES IN SCHEMA gridex_received_sources FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA gridex_received_sources TO authenticated, service_role;
GRANT SELECT ON gridex_received_sources.epoch, gridex_received_sources.sources TO authenticated, service_role;

CREATE FUNCTION gridex_received_sources.reject_mutation() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'received_source_evidence_is_append_only' USING ERRCODE = '23514';
END
$$;
REVOKE ALL ON FUNCTION gridex_received_sources.reject_mutation() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER received_sources_no_update_delete
  BEFORE UPDATE OR DELETE ON gridex_received_sources.sources
  FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER received_sources_no_truncate
  BEFORE TRUNCATE ON gridex_received_sources.sources
  FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER received_sources_epoch_no_update_delete
  BEFORE UPDATE OR DELETE ON gridex_received_sources.epoch
  FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER received_sources_epoch_no_truncate
  BEFORE TRUNCATE ON gridex_received_sources.epoch
  FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();

CREATE FUNCTION gridex_received_sources.capture_insert() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP <> 'INSERT' OR TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'ediel_messages' THEN
    RAISE EXCEPTION 'received_source_capture_invalid_owner' USING ERRCODE = '23514';
  END IF;
  IF NEW.direction = 'inbound' AND upper(coalesce(NEW.message_family, '')) = 'PRODAT'
     AND NEW.message_standard = 'edifact' THEN
    -- AFTER INSERT observes the final row after PR369's BEFORE trigger sealed
    -- the source. Only database-owned original columns are copied; no status,
    -- mutable metering link, parsed_payload or validation_report is authority.
    INSERT INTO gridex_received_sources.sources (
      source_message_id, company_id, environment, origin, message_code,
      source_received_at, captured_at, raw_payload, payload_hash, received_context
    ) VALUES (
      NEW.id, NEW.company_id, NEW.environment, 'database_insert', NEW.message_code,
      NEW.message_received_at, clock_timestamp(), NEW.raw_payload,
      NEW.immutable_payload_hash,
      NEW.execution_context_snapshot -> 'receivedProdatContext'
    );
    -- No ON CONFLICT DO NOTHING. Reusing a deleted source ID must not silently
    -- attach a different receipt to old history. Normal retries are UPDATEs.
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION gridex_received_sources.capture_insert() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER gridex_capture_received_prodat_source
  AFTER INSERT ON public.ediel_messages
  FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.capture_insert();


CREATE TABLE gridex_received_sources.snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  manifest_hash text NOT NULL CHECK (manifest_hash = encode(sha256(convert_to(manifest::text,'UTF8')),'hex')),
  visibility_snapshot text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE gridex_received_sources.discovery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES gridex_received_sources.snapshots(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  engine_version text NOT NULL CHECK (engine_version = 'physical-lin-inventory-v1'),
  observation_kind text NOT NULL DEFAULT 'unapproved_physical_discovery' CHECK (observation_kind = 'unapproved_physical_discovery'),
  inventory_text text NOT NULL CHECK (octet_length(inventory_text) <= 8388608),
  inventory_hash text NOT NULL CHECK (inventory_hash = encode(sha256(convert_to(inventory_text,'UTF8')),'hex')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX received_discovery_snapshot_idx ON gridex_received_sources.discovery_attempts(snapshot_id);
CREATE INDEX received_discovery_scope_idx ON gridex_received_sources.discovery_attempts(company_id,environment,created_at,id);
CREATE INDEX received_snapshot_scope_idx ON gridex_received_sources.snapshots(company_id,environment,created_at,id);
CREATE TABLE gridex_received_sources.validation_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_message_id uuid NOT NULL REFERENCES gridex_received_sources.sources(source_message_id) ON DELETE RESTRICT,
  company_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  source_payload_hash text NOT NULL,
  previous_assessment_id uuid REFERENCES gridex_received_sources.validation_assessments(id) ON DELETE RESTRICT,
  owner text NOT NULL DEFAULT 'canonical-runtime-with-registry-v1' CHECK (owner = 'canonical-runtime-with-registry-v1'),
  facts_text text NOT NULL CHECK (octet_length(facts_text) <= 65536),
  facts_hash text NOT NULL CHECK (facts_hash = encode(sha256(convert_to(facts_text,'UTF8')),'hex')),
  assessed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX received_assessment_first_idx ON gridex_received_sources.validation_assessments(source_message_id) WHERE previous_assessment_id IS NULL;
CREATE UNIQUE INDEX received_assessment_previous_idx ON gridex_received_sources.validation_assessments(previous_assessment_id) WHERE previous_assessment_id IS NOT NULL;
CREATE INDEX received_assessment_source_idx ON gridex_received_sources.validation_assessments(source_message_id,assessed_at,id);
CREATE INDEX received_assessment_scope_idx ON gridex_received_sources.validation_assessments(company_id,environment,assessed_at,id);

DO $security$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['snapshots','discovery_attempts','validation_assessments'] LOOP
    EXECUTE format('ALTER TABLE gridex_received_sources.%I ENABLE ROW LEVEL SECURITY', tab);
    EXECUTE format('ALTER TABLE gridex_received_sources.%I FORCE ROW LEVEL SECURITY', tab);
    EXECUTE format('REVOKE ALL ON gridex_received_sources.%I FROM PUBLIC, anon, authenticated, service_role', tab);
    EXECUTE format('GRANT SELECT ON gridex_received_sources.%I TO authenticated, service_role', tab);
    EXECUTE format('CREATE POLICY original_company_read ON gridex_received_sources.%I FOR SELECT TO authenticated USING (public.gridex_can_read_company(company_id))', tab);
    EXECUTE format('CREATE POLICY service_read ON gridex_received_sources.%I FOR SELECT TO service_role USING (true)', tab);
    EXECUTE format('CREATE TRIGGER no_evidence_update_delete BEFORE UPDATE OR DELETE ON gridex_received_sources.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()', tab);
    EXECUTE format('CREATE TRIGGER no_evidence_truncate BEFORE TRUNCATE ON gridex_received_sources.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()', tab);
  END LOOP;
END $security$;

-- The service-only writer is private, never an exposed SECURITY DEFINER RPC.
-- Its public facade is SECURITY INVOKER with an explicit service_role gate.
CREATE FUNCTION gridex_received_sources.open_snapshot(p_company_id uuid, p_environment text, p_cutoff timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'
AS $$
DECLARE v_now timestamptz := clock_timestamp(); v_opened timestamptz;
  v_result jsonb; v_manifest jsonb; v_id uuid; v_hash text;
BEGIN
  IF p_company_id IS NULL OR p_environment IS NULL OR p_environment NOT IN ('test','production')
    OR p_cutoff IS NULL OR NOT isfinite(p_cutoff) OR p_cutoff > v_now THEN
    RAISE EXCEPTION 'received_source_scope_unavailable' USING ERRCODE = '22023';
  END IF;
  SELECT opened_at INTO STRICT v_opened FROM gridex_received_sources.epoch WHERE singleton;
  -- Count, byte budgets and ALL returned rows share one MVCC statement snapshot.
  -- A 1001 count is an overflow sentinel, not an asserted universe size. No
  -- physical-object link or mutable message state participates in discovery.
  WITH candidates AS MATERIALIZED (
    SELECT source_message_id, octet_length(raw_payload) AS payload_bytes
    FROM gridex_received_sources.sources
    WHERE company_id=p_company_id AND environment=p_environment
      AND captured_at<=p_cutoff AND (source_received_at IS NULL OR source_received_at<=p_cutoff)
    LIMIT 1001
  ), totals AS (
    SELECT count(*) AS n, coalesce(sum(payload_bytes),0) AS total_bytes, coalesce(max(payload_bytes),0) AS max_bytes FROM candidates
  )
  SELECT jsonb_build_object('version',1,'companyId',p_company_id,'environment',p_environment,
    'cutoffAt',p_cutoff,'openedAt',v_opened,'readAt',v_now,'sourceCount',totals.n,
    'exhaustive',totals.n<=1000 AND totals.total_bytes<=4194304 AND totals.max_bytes<=262144,
    'sources', CASE WHEN totals.n<=1000 AND totals.total_bytes<=4194304 AND totals.max_bytes<=262144 THEN
      (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'sourceMessageId',source.source_message_id,'companyId',source.company_id,'environment',source.environment,
        'origin',source.origin,'messageCode',source.message_code,'sourceReceivedAt',source.source_received_at,
        'capturedAt',source.captured_at,'rawPayload',source.raw_payload,'payloadHash',source.payload_hash,
        'receivedContext',source.received_context) ORDER BY source.source_message_id),'[]'::jsonb)
      FROM candidates JOIN gridex_received_sources.sources AS source USING(source_message_id)) ELSE '[]'::jsonb END,
    'visibilitySnapshot',pg_current_snapshot()::text) INTO v_result FROM totals;
  -- The exact read set is fixed NOW, not reconstructed in a later client query.
  -- No raw payload copy in the manifest; immutable source identity/hash binds it.
  SELECT (v_result-'sources'-'visibilitySnapshot') || jsonb_build_object('sources',coalesce(jsonb_agg(
    (value - ARRAY['rawPayload','receivedContext','origin','messageCode','companyId','environment']) || jsonb_build_object('receiptContextRecorded',coalesce(jsonb_typeof(value->'receivedContext')='object',false))
    ORDER BY value->>'sourceMessageId'),'[]'::jsonb))
    INTO v_manifest FROM jsonb_array_elements(v_result->'sources');
  v_hash := encode(sha256(convert_to(v_manifest::text,'UTF8')),'hex');
  INSERT INTO gridex_received_sources.snapshots(company_id,environment,manifest,manifest_hash,visibility_snapshot)
    VALUES(p_company_id,p_environment,v_manifest,v_hash,v_result->>'visibilitySnapshot') RETURNING id INTO v_id;
  RETURN (v_result-'visibilitySnapshot') || jsonb_build_object('snapshotId',v_id,'snapshotHash',v_hash);
END $$;

CREATE FUNCTION gridex_received_sources.append_discovery(p_company_id uuid,p_environment text,
 p_snapshot_id uuid,p_snapshot_hash text,p_engine_version text,p_inventory_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE snap gridex_received_sources.snapshots%rowtype; inv jsonb; src jsonb; expected jsonb; item jsonb;
  v_id uuid; v_hash text; n bigint; distinct_n bigint;
BEGIN
  SELECT * INTO snap FROM gridex_received_sources.snapshots WHERE id=p_snapshot_id AND company_id=p_company_id AND environment=p_environment;
  IF NOT FOUND OR p_snapshot_hash IS DISTINCT FROM snap.manifest_hash
     OR p_engine_version IS DISTINCT FROM 'physical-lin-inventory-v1' OR p_inventory_text IS NULL
     OR octet_length(p_inventory_text)>8388608 THEN
    RAISE EXCEPTION 'received_discovery_binding_unavailable' USING ERRCODE='23514';
  END IF;
  inv := p_inventory_text::jsonb;
  IF jsonb_typeof(inv) IS DISTINCT FROM 'object'
    OR inv - ARRAY['version','universe','historyCoverage','authorityStatus','selection','status','sources','issues'] <> '{}'::jsonb
    OR inv->'version' IS DISTINCT FROM '1'::jsonb OR inv->>'universe' IS DISTINCT FROM 'durable_received_sources'
    OR inv->>'historyCoverage' IS DISTINCT FROM 'before_ledger_unknown' OR inv->>'authorityStatus' IS DISTINCT FROM 'not_established'
    OR inv->>'selection' IS DISTINCT FROM 'not_performed' OR coalesce(inv->>'status','') NOT IN ('enumerated','incomplete')
    OR jsonb_typeof(inv->'sources') IS DISTINCT FROM 'array' OR jsonb_typeof(inv->'issues') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'received_discovery_not_an_approval' USING ERRCODE='23514';
  END IF;
  SELECT count(*),count(DISTINCT value->>'sourceMessageId') INTO n,distinct_n FROM jsonb_array_elements(inv->'sources');
  IF n<>distinct_n OR n>1000 OR (inv->>'status'='enumerated' AND
      (snap.manifest->'exhaustive' IS DISTINCT FROM 'true'::jsonb OR n<>(snap.manifest->>'sourceCount')::bigint OR inv->'issues'<>'[]'::jsonb))
    OR (n<>0 AND n<>(snap.manifest->>'sourceCount')::bigint) THEN
    RAISE EXCEPTION 'received_discovery_incomplete_set' USING ERRCODE='23514';
  END IF;
  FOR src IN SELECT value FROM jsonb_array_elements(inv->'sources') LOOP
    SELECT value INTO expected FROM jsonb_array_elements(snap.manifest->'sources') WHERE value->>'sourceMessageId'=src->>'sourceMessageId';
    IF NOT FOUND OR jsonb_typeof(src) IS DISTINCT FROM 'object'
      OR src - ARRAY['sourceMessageId','sourcePayloadHash','sourceReceivedAt','capturedAt','receiptStatus','disposition','status','occurrences','objects','issues'] <> '{}'::jsonb
      OR src->'sourcePayloadHash' IS DISTINCT FROM expected->'payloadHash'
      OR src->'sourceReceivedAt' IS DISTINCT FROM expected->'sourceReceivedAt' OR src->'capturedAt' IS DISTINCT FROM expected->'capturedAt'
      OR src->>'disposition' IS DISTINCT FROM 'not_checked' OR coalesce(src->>'status','') NOT IN ('enumerated','incomplete')
      OR coalesce(src->>'receiptStatus','') NOT IN ('recorded','unavailable')
      OR (src->>'receiptStatus'='recorded' AND expected->'receiptContextRecorded' IS DISTINCT FROM 'true'::jsonb)
      OR jsonb_typeof(src->'occurrences') IS DISTINCT FROM 'array' OR jsonb_typeof(src->'objects') IS DISTINCT FROM 'array'
      OR jsonb_typeof(src->'issues') IS DISTINCT FROM 'array'
      OR (inv->>'status'='enumerated' AND (src->>'status'<>'enumerated' OR src->>'receiptStatus'<>'recorded' OR src->'issues'<>'[]'::jsonb))
      OR (src->>'status'='enumerated' AND (jsonb_array_length(src->'occurrences')=0 OR jsonb_array_length(src->'objects')=0 OR src->>'receiptStatus'<>'recorded' OR src->'issues'<>'[]'::jsonb)) THEN
      RAISE EXCEPTION 'received_discovery_source_mismatch' USING ERRCODE='23514';
    END IF;
    -- Shape allowlists stop accidental raw bodies or approval fields entering
    -- engine evidence. SQL records an observation; it does not duplicate the
    -- tokenizer/register/party validators or certify their semantic result.
    FOR item IN SELECT value FROM jsonb_array_elements(src->'occurrences') LOOP
      IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item - ARRAY['ordinal','segmentIndex','messageIndex','lineNumber','objectId','identityAgency','identityStatus'] <> '{}'::jsonb
        OR coalesce(item->>'identityStatus','') NOT IN ('observed','unresolved') THEN
        RAISE EXCEPTION 'received_discovery_observation_shape' USING ERRCODE='23514';
      END IF;
    END LOOP;
    FOR item IN SELECT value FROM jsonb_array_elements(src->'objects') LOOP
      IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item - ARRAY['messageIndex','objectId','identityAgency','occurrenceOrdinals'] <> '{}'::jsonb THEN
        RAISE EXCEPTION 'received_discovery_observation_shape' USING ERRCODE='23514';
      END IF;
    END LOOP;
    IF EXISTS (SELECT FROM jsonb_array_elements(src->'issues') AS value WHERE jsonb_typeof(value) IS DISTINCT FROM 'string' OR value#>>'{}' !~ '^[a-z0-9_]{1,128}$') THEN
      RAISE EXCEPTION 'received_discovery_observation_shape' USING ERRCODE='23514';
    END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(inv->'issues') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item - ARRAY['code','sourceMessageId'] <> '{}'::jsonb
      OR coalesce(item->>'code','') !~ '^[a-z0-9_]{1,128}$'
      OR (item ? 'sourceMessageId' AND NOT EXISTS(SELECT FROM jsonb_array_elements(inv->'sources') s WHERE s->>'sourceMessageId'=item->>'sourceMessageId')) THEN
      RAISE EXCEPTION 'received_discovery_observation_shape' USING ERRCODE='23514';
    END IF;
  END LOOP;
  v_hash:=encode(sha256(convert_to(p_inventory_text,'UTF8')),'hex');
  INSERT INTO gridex_received_sources.discovery_attempts(snapshot_id,company_id,environment,engine_version,inventory_text,inventory_hash)
    VALUES(snap.id,p_company_id,p_environment,p_engine_version,p_inventory_text,v_hash) RETURNING id INTO v_id;
  RETURN jsonb_build_object('version',1,'companyId',p_company_id,'environment',p_environment,'snapshotId',snap.id,
    'snapshotHash',snap.manifest_hash,'engineVersion',p_engine_version,'attemptId',v_id,'inventoryHash',v_hash);
END $$;

CREATE FUNCTION gridex_received_sources.append_validation(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE src gridex_received_sources.sources%rowtype; facts jsonb; pack jsonb; v_previous uuid; v_id uuid; v_hash text;
BEGIN
  -- Lock per source before selecting a predecessor. Concurrent assessments
  -- append a single linked sequence; no UPDATE of historic decisions occurs.
  SELECT * INTO src FROM gridex_received_sources.sources WHERE source_message_id=p_source_message_id
    AND company_id=p_company_id AND environment=p_environment FOR UPDATE;
  IF NOT FOUND OR src.payload_hash IS NULL OR src.received_context IS NULL
    OR p_source_payload_hash IS DISTINCT FROM src.payload_hash OR p_facts_text IS NULL OR octet_length(p_facts_text)>65536 THEN
    RAISE EXCEPTION 'received_validation_source_unavailable' USING ERRCODE='23514';
  END IF;
  facts:=p_facts_text::jsonb;
  IF jsonb_typeof(facts) IS DISTINCT FROM 'object'
    OR facts - ARRAY['version','owner','sourceDisposition','objectDisposition','partyDisposition','coverage','originalTenantMatch','syntaxDecision','applicationDecision','functionalDecision','messageReference','reasonCodes','rulePackEvidence'] <> '{}'::jsonb
    OR facts->'version' IS DISTINCT FROM '1'::jsonb OR facts->>'owner' IS DISTINCT FROM 'canonical-runtime-with-registry-v1'
    OR facts->>'sourceDisposition' IS DISTINCT FROM 'not_established' OR facts->>'objectDisposition' IS DISTINCT FROM 'not_checked'
    OR facts->>'partyDisposition' IS DISTINCT FROM 'not_checked' OR facts->>'coverage' IS DISTINCT FROM 'canonical_runtime_only'
    OR facts->>'originalTenantMatch' IS DISTINCT FROM 'matched'
    OR coalesce(facts->>'syntaxDecision','') NOT IN ('accepted','rejected','not_applicable','manual_review')
    OR coalesce(facts->>'applicationDecision','') NOT IN ('accepted','rejected','not_applicable','manual_review')
    OR coalesce(facts->>'functionalDecision','') NOT IN ('accepted','rejected','not_applicable','manual_review')
    OR jsonb_typeof(facts->'reasonCodes') IS DISTINCT FROM 'array' OR jsonb_array_length(facts->'reasonCodes')>128
    OR coalesce(jsonb_typeof(facts->'messageReference'),'missing') NOT IN ('string','null')
    OR length(coalesce(facts->>'messageReference',''))>128 THEN
    RAISE EXCEPTION 'received_validation_not_source_approval' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT FROM jsonb_array_elements(facts->'reasonCodes') AS value WHERE jsonb_typeof(value) IS DISTINCT FROM 'string' OR value#>>'{}' !~ '^[A-Za-z0-9_.:-]{1,128}$') THEN
    RAISE EXCEPTION 'received_validation_reason_unavailable' USING ERRCODE='23514';
  END IF;
  pack:=facts->'rulePackEvidence';
  IF facts->>'applicationDecision'='accepted' AND (pack IS NULL OR pack='null'::jsonb) THEN
    RAISE EXCEPTION 'received_validation_rule_evidence_unavailable' USING ERRCODE='23514';
  END IF;
  IF pack IS DISTINCT FROM 'null'::jsonb THEN
    IF jsonb_typeof(pack) IS DISTINCT FROM 'object' OR pack - ARRAY['profileKey','messageProfileId','rulePackId','sourceHash'] <> '{}'::jsonb
      OR NOT EXISTS(SELECT FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs rulepack ON rulepack.id=profile.rule_pack_id
        WHERE profile.id::text=pack->>'messageProfileId' AND profile.profile_key=pack->>'profileKey'
          AND rulepack.id::text=pack->>'rulePackId' AND rulepack.source_hash=pack->>'sourceHash') THEN
      RAISE EXCEPTION 'received_validation_rule_evidence_unavailable' USING ERRCODE='23514';
    END IF;
  END IF;
  SELECT prior.id INTO v_previous FROM gridex_received_sources.validation_assessments prior WHERE prior.source_message_id=src.source_message_id
    AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=prior.id);
  v_hash:=encode(sha256(convert_to(p_facts_text,'UTF8')),'hex');
  INSERT INTO gridex_received_sources.validation_assessments(source_message_id,company_id,environment,source_payload_hash,previous_assessment_id,facts_text,facts_hash)
    VALUES(src.source_message_id,p_company_id,p_environment,src.payload_hash,v_previous,p_facts_text,v_hash) RETURNING id INTO v_id;
  RETURN jsonb_build_object('version',1,'assessmentId',v_id,'companyId',p_company_id,'environment',p_environment,
    'sourceMessageId',src.source_message_id,'sourcePayloadHash',src.payload_hash,'factsHash',v_hash,'sourceDisposition','not_established');
END $$;

-- Facades retain caller identity. Revokes below remove default PUBLIC EXECUTE.
CREATE FUNCTION public.gridex_received_source_snapshot_v1(p_company_id uuid,p_environment text,p_cutoff timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'received_evidence_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_received_sources.open_snapshot(p_company_id,p_environment,p_cutoff);
END $$;
CREATE FUNCTION public.gridex_record_source_discovery_v1(p_company_id uuid,p_environment text,p_snapshot_id uuid,p_snapshot_hash text,p_engine_version text,p_inventory_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'received_evidence_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_received_sources.append_discovery(p_company_id,p_environment,p_snapshot_id,p_snapshot_hash,p_engine_version,p_inventory_text);
END $$;
CREATE FUNCTION public.gridex_record_source_validation_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'received_evidence_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_received_sources.append_validation(p_company_id,p_environment,p_source_message_id,p_source_payload_hash,p_facts_text);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_received_sources FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_received_sources.open_snapshot(uuid,text,timestamptz),
 gridex_received_sources.append_discovery(uuid,text,uuid,text,text,text),gridex_received_sources.append_validation(uuid,text,uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.gridex_received_source_snapshot_v1(uuid,text,timestamptz),
 public.gridex_record_source_discovery_v1(uuid,text,uuid,text,text,text),public.gridex_record_source_validation_v1(uuid,text,uuid,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_received_source_snapshot_v1(uuid,text,timestamptz),
 public.gridex_record_source_discovery_v1(uuid,text,uuid,text,text,text),public.gridex_record_source_validation_v1(uuid,text,uuid,text,text) TO service_role;

COMMENT ON TABLE gridex_received_sources.sources IS 'Forward-only original insertion evidence. No operational cascade. Receipt is not source approval; history before activation remains unknown.';
COMMENT ON TABLE gridex_received_sources.snapshots IS 'Immutable exact read-set manifest and MVCC descriptor. Not reconstruction of historical transaction commit visibility.';
COMMENT ON TABLE gridex_received_sources.discovery_attempts IS 'Immutable unapproved engine observations bound to an exact persisted snapshot. Physical LIN enumeration is not canonical register, object/party disposition or E61/E62 authority.';
COMMENT ON TABLE gridex_received_sources.validation_assessments IS 'Actual canonical-runtime facet evidence. Source/object/party approval remains unestablished. Previous links preserve observations, not automatic supersession or temporal selection.';
COMMIT;
