BEGIN;
-- Additive sidecar preserves the frozen canonical/P register facts contract.
-- It records the real runtime's complete own-IDE projection in the same atomic
-- append as the canonical owner assessment, never a historical backfill.
CREATE TABLE gridex_received_sources.utilts_transaction_validations(
 assessment_id uuid PRIMARY KEY REFERENCES gridex_received_sources.validation_assessments(id),
 source_message_id uuid NOT NULL,company_id uuid NOT NULL,environment text NOT NULL,
 source_payload_hash text NOT NULL,transaction_facts_text text NOT NULL,transaction_facts_hash text NOT NULL
);
ALTER TABLE gridex_received_sources.utilts_transaction_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_sources.utilts_transaction_validations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gridex_received_sources.utilts_transaction_validations FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_update_delete BEFORE UPDATE OR DELETE ON gridex_received_sources.utilts_transaction_validations FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_received_sources.utilts_transaction_validations FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE FUNCTION gridex_received_sources.validate_utilts_transactions_v1(raw text,projection jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb;membership jsonb;item jsonb;physical jsonb;ordinal integer;expected_response text;
BEGIN
 IF jsonb_typeof(projection) IS DISTINCT FROM 'object' OR projection-ARRAY['version','sourcePayloadHash','transactions']<>'{}'::jsonb
  OR projection->'version' IS DISTINCT FROM '1'::jsonb OR projection->>'sourcePayloadHash' IS DISTINCT FROM encode(sha256(convert_to(raw,'UTF8')),'hex')
  OR jsonb_typeof(projection->'transactions') IS DISTINCT FROM 'array' OR jsonb_array_length(projection->'transactions')>999 THEN RETURN false; END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(raw);IF tokens IS NULL THEN RETURN false;END IF;
 SELECT coalesce(jsonb_agg(t ORDER BY (t->>'index')::integer),'[]') INTO membership FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='IDE';
 IF jsonb_array_length(membership)<>jsonb_array_length(projection->'transactions') THEN RETURN false; END IF;
 FOR item,ordinal IN SELECT value,(i-1)::integer FROM jsonb_array_elements(projection->'transactions') WITH ORDINALITY x(value,i) LOOP
  physical:=membership->ordinal;
  expected_response:=CASE item->>'disposition' WHEN 'accepted' THEN 'positive_aperak' WHEN 'syntax_rejected' THEN 'negative_contrl' WHEN 'guide_rejected' THEN 'negative_aperak' WHEN 'processability_rejected' THEN 'utilts_err' WHEN 'internal_review' THEN 'none' END;
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['transactionIndex','transactionId','disposition','responseType','issueCodes']<>'{}'::jsonb
   OR item->'transactionIndex' IS DISTINCT FROM to_jsonb(ordinal) OR item->'transactionId' IS DISTINCT FROM coalesce(to_jsonb(nullif(physical#>>'{elements,2,0}','')),'null'::jsonb)
   OR expected_response IS NULL OR item->>'responseType' IS DISTINCT FROM expected_response OR jsonb_typeof(item->'issueCodes') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'issueCodes')>128
   OR EXISTS(SELECT FROM jsonb_array_elements(item->'issueCodes') code WHERE jsonb_typeof(code) IS DISTINCT FROM 'string' OR code#>>'{}' !~ '^[A-Za-z0-9_.:-]{1,128}$') THEN RETURN false; END IF;
  IF item->>'disposition'='accepted' AND (physical#>>'{elements,1,0}' IS DISTINCT FROM '24' OR nullif(item->>'transactionId','') IS NULL OR length(item->>'transactionId')>35 OR jsonb_array_length(item->'issueCodes')<>0) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END $$;
CREATE FUNCTION gridex_received_sources.append_utilts_validation_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text,p_transaction_facts_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE src gridex_received_sources.sources%rowtype;m public.ediel_messages%rowtype;response jsonb;projection jsonb;projection_hash text;
BEGIN
 SELECT * INTO src FROM gridex_received_sources.sources WHERE source_message_id=p_source_message_id AND company_id=p_company_id AND environment=p_environment FOR UPDATE;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id AND environment=p_environment;
 IF src.source_message_id IS NULL OR m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'UTILTS'
  OR src.payload_hash IS DISTINCT FROM p_source_payload_hash OR m.raw_payload IS DISTINCT FROM src.raw_payload OR src.received_context->>'contextOrigin' IS DISTINCT FROM 'database_insert' THEN RAISE EXCEPTION 'received_utilts_transaction_source_unavailable' USING ERRCODE='23514'; END IF;
 IF p_transaction_facts_text IS NOT NULL THEN
  IF octet_length(p_transaction_facts_text)>524288 THEN RAISE EXCEPTION 'received_utilts_transaction_facts_invalid' USING ERRCODE='23514'; END IF;
  projection:=p_transaction_facts_text::jsonb;
  IF NOT coalesce(gridex_received_sources.validate_utilts_transactions_v1(src.raw_payload,projection),false) THEN RAISE EXCEPTION 'received_utilts_transaction_facts_invalid' USING ERRCODE='23514'; END IF;
  projection_hash:=encode(sha256(convert_to(p_transaction_facts_text,'UTF8')),'hex');
 END IF;
 response:=gridex_received_sources.append_validation(p_company_id,p_environment,p_source_message_id,p_source_payload_hash,p_facts_text);
 IF projection IS NOT NULL THEN
  INSERT INTO gridex_received_sources.utilts_transaction_validations(assessment_id,source_message_id,company_id,environment,source_payload_hash,transaction_facts_text,transaction_facts_hash)
   VALUES((response->>'assessmentId')::uuid,p_source_message_id,p_company_id,p_environment,p_source_payload_hash,p_transaction_facts_text,projection_hash);
 END IF;
 RETURN response||jsonb_build_object('transactionFactsHash',projection_hash);
END $$;
CREATE FUNCTION public.gridex_record_utilts_source_validation_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text,p_transaction_facts_text text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'received_evidence_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_received_sources.append_utilts_validation_v1(p_company_id,p_environment,p_source_message_id,p_source_payload_hash,p_facts_text,p_transaction_facts_text);
END $$;
CREATE FUNCTION gridex_received_sources.require_utilts_transaction_v1(p_company uuid,p_source uuid,p_transaction text,p_disposition text,p_response text,p_issue_codes jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE s public.ediel_messages%rowtype;assessment gridex_received_sources.validation_assessments%rowtype;facet gridex_received_sources.utilts_transaction_validations%rowtype;facts jsonb;own jsonb;projection jsonb;basis jsonb;
BEGIN
 SELECT * INTO s FROM public.ediel_messages WHERE company_id=p_company AND id=p_source FOR SHARE;
 SELECT v.* INTO assessment FROM gridex_received_sources.validation_assessments v WHERE v.company_id=p_company AND v.source_message_id=p_source AND v.environment=s.environment
  AND v.source_payload_hash=encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)
  AND v.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296) FOR SHARE;
 IF assessment.id IS NULL OR assessment.owner IS DISTINCT FROM 'canonical-runtime-with-registry-v1' OR assessment.facts_hash IS DISTINCT FROM encode(sha256(convert_to(assessment.facts_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'utilts_transaction_owner_evidence_required' USING ERRCODE='P0U01'; END IF;
 SELECT * INTO facet FROM gridex_received_sources.utilts_transaction_validations WHERE assessment_id=assessment.id AND company_id=p_company AND source_message_id=p_source AND environment=s.environment AND source_payload_hash=assessment.source_payload_hash;
 IF facet.assessment_id IS NULL OR facet.transaction_facts_hash IS DISTINCT FROM encode(sha256(convert_to(facet.transaction_facts_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'utilts_transaction_owner_evidence_required' USING ERRCODE='P0U01'; END IF;
 facts:=assessment.facts_text::jsonb;projection:=facet.transaction_facts_text::jsonb;
 IF facts->>'owner' IS DISTINCT FROM 'canonical-runtime-with-registry-v1' OR NOT coalesce(gridex_received_sources.validate_utilts_transactions_v1(s.raw_payload,projection),false) THEN RAISE EXCEPTION 'utilts_transaction_owner_evidence_required' USING ERRCODE='P0U01'; END IF;
 SELECT value INTO STRICT own FROM jsonb_array_elements(projection->'transactions') WHERE coalesce(value->>'transactionId','transaction-'||((value->>'transactionIndex')::integer+1)::text)=p_transaction;
 IF own->>'disposition' IS DISTINCT FROM p_disposition OR own->>'responseType' IS DISTINCT FROM p_response OR own->'issueCodes' IS DISTINCT FROM p_issue_codes
  OR (p_disposition='accepted' AND facts->>'syntaxDecision' IS DISTINCT FROM 'accepted') THEN RAISE EXCEPTION 'utilts_transaction_owner_outcome_mismatch' USING ERRCODE='P0U01'; END IF;
 -- Global application/functional rejection can be another own IDE. Only this
 -- exact canonical own accepted outcome authorizes a new accepted effect.
 IF p_disposition='accepted' THEN
  basis:=gridex_ediel_source_rules.require_v1(p_company,p_source);
  IF facts->'rulePackEvidence' IS DISTINCT FROM jsonb_build_object('profileKey',basis->'profileKey','messageProfileId',basis->'messageProfileId','rulePackId',basis->'rulePackId','sourceHash',basis->'sourceHash','version',basis->'version',
    'snapshot',jsonb_build_object('rulePack',basis#>'{snapshot,rulePack}','messageProfile',basis#>'{snapshot,messageProfile}','guideSources',basis#>'{snapshot,guideSources}')) THEN RAISE EXCEPTION 'utilts_transaction_original_rule_witness_mismatch' USING ERRCODE='P0U01'; END IF;
 END IF;
EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'utilts_transaction_owner_evidence_required' USING ERRCODE='P0U01';
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.validate_utilts_transactions_v1(text,jsonb),gridex_received_sources.append_utilts_validation_v1(uuid,text,uuid,text,text,text),gridex_received_sources.require_utilts_transaction_v1(uuid,uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_received_sources.append_utilts_validation_v1(uuid,text,uuid,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.gridex_record_utilts_source_validation_v1(uuid,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_record_utilts_source_validation_v1(uuid,text,uuid,text,text,text) TO service_role;
COMMIT;
