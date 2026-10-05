BEGIN;
-- Prospective header diagnostics are a separate immutable sidecar. The frozen
-- canonical facts and version1 complete own-IDE projection remain unchanged.
CREATE TABLE gridex_received_sources.utilts_header_validations(
 assessment_id uuid PRIMARY KEY REFERENCES gridex_received_sources.validation_assessments(id),
 source_message_id uuid NOT NULL,company_id uuid NOT NULL,environment text NOT NULL,
 source_payload_hash text NOT NULL,header_facts_text text NOT NULL,header_facts_hash text NOT NULL
);
ALTER TABLE gridex_received_sources.utilts_header_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_sources.utilts_header_validations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gridex_received_sources.utilts_header_validations FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_update_delete BEFORE UPDATE OR DELETE ON gridex_received_sources.utilts_header_validations FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_received_sources.utilts_header_validations FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE FUNCTION gridex_received_sources.validate_utilts_header_v1(raw text,projection jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb;item jsonb;
BEGIN
 IF jsonb_typeof(projection) IS DISTINCT FROM 'object' OR projection-ARRAY['version','sourcePayloadHash','applicationErrors']<>'{}'::jsonb
  OR projection->'version' IS DISTINCT FROM '1'::jsonb OR projection->>'sourcePayloadHash' IS DISTINCT FROM encode(sha256(convert_to(raw,'UTF8')),'hex')
  OR jsonb_typeof(projection->'applicationErrors') IS DISTINCT FROM 'array' OR jsonb_array_length(projection->'applicationErrors') NOT BETWEEN 1 AND 128 THEN RETURN false; END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(raw);IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNH')<>1
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNH' AND t#>>'{elements,2,0}'='UTILTS') THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(projection->'applicationErrors') LOOP
  -- Only shape/original binding here. The shared national guide's native
  -- checker owns ERC/text semantics; no second field or text/error table.
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['ercCode','fieldCode','text']<>'{}'::jsonb OR item->>'ercCode' NOT IN ('41','42')
   OR jsonb_typeof(item->'ercCode') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'fieldCode') IS DISTINCT FROM 'string' OR item->>'fieldCode' !~ '^[A-Za-z0-9_./-]{1,17}$'
   OR jsonb_typeof(item->'text') IS DISTINCT FROM 'string' OR length(item->>'text') NOT BETWEEN 1 AND 512 OR item->>'text' ~ '[[:cntrl:]]' THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END $$;
CREATE FUNCTION gridex_received_sources.append_utilts_validation_v2(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text,p_transaction_facts_text text,p_header_facts_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE src gridex_received_sources.sources%rowtype;projection jsonb;facts jsonb;transactions jsonb;response jsonb;projection_hash text;
BEGIN
 IF p_header_facts_text IS NOT NULL THEN
  SELECT * INTO src FROM gridex_received_sources.sources WHERE company_id=p_company_id AND environment=p_environment AND source_message_id=p_source_message_id FOR UPDATE;
  IF src.source_message_id IS NULL OR src.payload_hash IS DISTINCT FROM p_source_payload_hash OR octet_length(p_header_facts_text)>524288 THEN RAISE EXCEPTION 'received_utilts_header_facts_invalid' USING ERRCODE='23514'; END IF;
  projection:=p_header_facts_text::jsonb;facts:=p_facts_text::jsonb;transactions:=p_transaction_facts_text::jsonb;
  IF NOT coalesce(gridex_received_sources.validate_utilts_header_v1(src.raw_payload,projection),false)
   OR facts->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR coalesce(facts->>'applicationDecision','') NOT IN ('rejected','manual_review')
   OR NOT coalesce(gridex_received_sources.validate_utilts_transactions_v1(src.raw_payload,transactions),false)
   OR EXISTS(SELECT FROM jsonb_array_elements(transactions->'transactions') t WHERE t->>'disposition' IS DISTINCT FROM 'guide_rejected' OR t->>'responseType' IS DISTINCT FROM 'negative_aperak') THEN RAISE EXCEPTION 'received_utilts_header_facts_invalid' USING ERRCODE='23514'; END IF;
  projection_hash:=encode(sha256(convert_to(p_header_facts_text,'UTF8')),'hex');
 END IF;
 response:=gridex_received_sources.append_utilts_validation_v1(p_company_id,p_environment,p_source_message_id,p_source_payload_hash,p_facts_text,p_transaction_facts_text);
 IF projection IS NOT NULL THEN
  INSERT INTO gridex_received_sources.utilts_header_validations(assessment_id,source_message_id,company_id,environment,source_payload_hash,header_facts_text,header_facts_hash)
   VALUES((response->>'assessmentId')::uuid,p_source_message_id,p_company_id,p_environment,p_source_payload_hash,p_header_facts_text,projection_hash);
 END IF;
 RETURN response||jsonb_build_object('version',2,'headerFactsHash',projection_hash);
END $$;
CREATE FUNCTION public.gridex_record_utilts_source_validation_v2(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text,p_transaction_facts_text text,p_header_facts_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'received_evidence_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_received_sources.append_utilts_validation_v2(p_company_id,p_environment,p_source_message_id,p_source_payload_hash,p_facts_text,p_transaction_facts_text,p_header_facts_text);
END $$;
CREATE FUNCTION gridex_received_sources.require_utilts_header_v1(p_company uuid,p_source uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE s public.ediel_messages%rowtype;assessment gridex_received_sources.validation_assessments%rowtype;facet gridex_received_sources.utilts_header_validations%rowtype;
 transaction_facet gridex_received_sources.utilts_transaction_validations%rowtype;facts jsonb;projection jsonb;transactions jsonb;basis jsonb;
BEGIN
 SELECT * INTO s FROM public.ediel_messages WHERE company_id=p_company AND id=p_source FOR SHARE;
 IF s.id IS NULL OR s.direction IS DISTINCT FROM 'inbound' OR s.message_family IS DISTINCT FROM 'UTILTS' THEN RAISE EXCEPTION 'utilts_header_owner_evidence_required' USING ERRCODE='P0U01'; END IF;
 SELECT v.* INTO assessment FROM gridex_received_sources.validation_assessments v WHERE v.company_id=p_company AND v.source_message_id=p_source AND v.environment=s.environment
  AND v.source_payload_hash=encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)
  AND v.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296) FOR SHARE;
 IF assessment.id IS NULL OR assessment.owner IS DISTINCT FROM 'canonical-runtime-with-registry-v1' OR assessment.facts_hash IS DISTINCT FROM encode(sha256(convert_to(assessment.facts_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'utilts_header_owner_evidence_required' USING ERRCODE='P0U01'; END IF;
 SELECT * INTO facet FROM gridex_received_sources.utilts_header_validations WHERE assessment_id=assessment.id AND company_id=p_company AND source_message_id=p_source AND environment=s.environment AND source_payload_hash=assessment.source_payload_hash;
 SELECT * INTO transaction_facet FROM gridex_received_sources.utilts_transaction_validations WHERE assessment_id=assessment.id AND company_id=p_company AND source_message_id=p_source AND environment=s.environment AND source_payload_hash=assessment.source_payload_hash;
 IF facet.assessment_id IS NULL OR facet.header_facts_hash IS DISTINCT FROM encode(sha256(convert_to(facet.header_facts_text,'UTF8')),'hex')
  OR transaction_facet.assessment_id IS NULL OR transaction_facet.transaction_facts_hash IS DISTINCT FROM encode(sha256(convert_to(transaction_facet.transaction_facts_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'utilts_header_owner_evidence_required' USING ERRCODE='P0U01'; END IF;
 facts:=assessment.facts_text::jsonb;projection:=facet.header_facts_text::jsonb;transactions:=transaction_facet.transaction_facts_text::jsonb;
 IF facts->>'owner' IS DISTINCT FROM 'canonical-runtime-with-registry-v1' OR facts->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR facts->>'applicationDecision' IS DISTINCT FROM 'rejected' OR facts->>'functionalDecision' IS DISTINCT FROM 'accepted'
  OR NOT coalesce(gridex_received_sources.validate_utilts_header_v1(s.raw_payload,projection),false) OR NOT coalesce(gridex_received_sources.validate_utilts_transactions_v1(s.raw_payload,transactions),false)
  OR EXISTS(SELECT FROM jsonb_array_elements(transactions->'transactions') t WHERE t->>'disposition' IS DISTINCT FROM 'guide_rejected' OR t->>'responseType' IS DISTINCT FROM 'negative_aperak') THEN RAISE EXCEPTION 'utilts_header_owner_outcome_mismatch' USING ERRCODE='P0U01'; END IF;
 basis:=gridex_ediel_source_rules.require_v1(p_company,p_source);
 IF facts->'rulePackEvidence' IS DISTINCT FROM jsonb_build_object('profileKey',basis->'profileKey','messageProfileId',basis->'messageProfileId','rulePackId',basis->'rulePackId','sourceHash',basis->'sourceHash','version',basis->'version',
  'snapshot',jsonb_build_object('rulePack',basis#>'{snapshot,rulePack}','messageProfile',basis#>'{snapshot,messageProfile}','guideSources',basis#>'{snapshot,guideSources}')) THEN RAISE EXCEPTION 'utilts_header_original_rule_witness_mismatch' USING ERRCODE='P0U01'; END IF;
 RETURN jsonb_build_object('version',1,'assessmentId',assessment.id,'sourcePayloadHash',assessment.source_payload_hash,'applicationErrors',projection->'applicationErrors');
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.validate_utilts_header_v1(text,jsonb),gridex_received_sources.append_utilts_validation_v2(uuid,text,uuid,text,text,text,text),gridex_received_sources.require_utilts_header_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_received_sources.append_utilts_validation_v2(uuid,text,uuid,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.gridex_record_utilts_source_validation_v2(uuid,text,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_record_utilts_source_validation_v2(uuid,text,uuid,text,text,text,text) TO service_role;
COMMIT;
