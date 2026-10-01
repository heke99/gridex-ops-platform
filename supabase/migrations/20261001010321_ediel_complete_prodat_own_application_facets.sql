-- Actual CLI forward: complete SAME canonical invocation, separate from register,
-- ACK and functional/business outcome. Original applied migrations stay intact.
BEGIN;
CREATE TABLE gridex_received_sources.prodat_application_facets(
 assessment_id uuid PRIMARY KEY REFERENCES gridex_received_sources.validation_assessments(id),
 source_message_id uuid NOT NULL REFERENCES gridex_received_sources.sources(source_message_id),company_id uuid NOT NULL,environment text NOT NULL CHECK(environment IN('test','production')),
 source_payload_hash text NOT NULL,application_facts_text text NOT NULL CHECK(octet_length(application_facts_text)<=524288),application_facts_hash text NOT NULL,
 CHECK(application_facts_hash=encode(sha256(convert_to(application_facts_text,'UTF8')),'hex')));
ALTER TABLE gridex_received_sources.prodat_application_facets ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_received_sources.prodat_application_facets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.prodat_application_facets FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_received_sources.prodat_application_facets FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_received_sources.prodat_application_facets FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE FUNCTION gridex_received_sources.validate_prodat_application_v1(raw text,facts jsonb,facet jsonb,response jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE object jsonb;reg jsonb;scope jsonb;reasons jsonb;seen jsonb:='[]';state text;
BEGIN
 IF jsonb_typeof(facet) IS DISTINCT FROM 'object' OR(SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(facet)k) IS DISTINCT FROM ARRAY['coverage','headerDecision','objects','owner','sourcePayloadHash','version']::text[]
  OR facet->'version' IS DISTINCT FROM '1'::jsonb OR facet->>'owner' IS DISTINCT FROM 'canonical-prodat-application-all-v1' OR facet->>'coverage' IS DISTINCT FROM 'canonical_own_application_only'
  OR facet->>'sourcePayloadHash' IS DISTINCT FROM encode(sha256(convert_to(raw,'UTF8')),'hex') OR(facet->>'headerDecision' IN('accepted','rejected','held')) IS NOT TRUE
  OR facts->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR jsonb_typeof(facts->'rulePackEvidence') IS DISTINCT FROM 'object'
  OR jsonb_typeof(facet->'objects') IS DISTINCT FROM 'array' OR jsonb_array_length(facet->'objects')<>jsonb_array_length(facts#>'{registerValidation,objects}')
  OR facts#>>'{registerValidation,owner}' IS DISTINCT FROM 'validateProdatRegisterPolicy' OR facts#>>'{registerValidation,coverage}' IS DISTINCT FROM 'canonical_register_only' THEN RETURN false;END IF;
 FOR object IN SELECT e FROM jsonb_array_elements(facet->'objects')e LOOP
  IF jsonb_typeof(object) IS DISTINCT FROM 'object' OR(SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(object)k) IS DISTINCT FROM ARRAY['applicationDecision','identityAgency','messageIndex','messageReference','objectId','reasonCodes','registers']::text[] THEN RETURN false;END IF;
  scope:=object-'applicationDecision'-'reasonCodes';reasons:=object->'reasonCodes';state:=object->>'applicationDecision';
  IF(state IN('accepted','rejected','held')) IS NOT TRUE OR jsonb_typeof(reasons) IS DISTINCT FROM 'array' OR jsonb_array_length(reasons)>128
   OR EXISTS(SELECT FROM jsonb_array_elements(reasons)e WHERE jsonb_typeof(e)<>'string' OR e#>>'{}'!~'^[A-Za-z0-9_.:-]{1,128}$')
   OR (SELECT count(*) FROM jsonb_array_elements(reasons)e)<>(SELECT count(DISTINCT e) FROM jsonb_array_elements(reasons)e)
   OR (state='accepted' AND jsonb_array_length(reasons)<>0) OR(state<>'accepted' AND jsonb_array_length(reasons)=0) OR seen@>jsonb_build_array(scope) THEN RETURN false;END IF;
  seen:=seen||jsonb_build_array(scope);
  SELECT e INTO reg FROM jsonb_array_elements(facts#>'{registerValidation,objects}')e WHERE e-'disposition'-'reasons'=scope;
  IF reg IS NULL OR state='accepted' AND(reg->>'disposition' IS DISTINCT FROM 'accepted' OR facet->>'headerDecision' IS DISTINCT FROM 'accepted' OR facts->>'functionalDecision' IS DISTINCT FROM 'accepted')
   OR reg->>'disposition'='rejected' AND state='accepted' OR state='accepted' AND EXISTS(SELECT FROM jsonb_array_elements(coalesce(response->'responses','[]'))e WHERE e->>'ercCode'<>'100'
     AND(e->>'scope'='message' OR e->'lineIndex'=object#>'{registers,0,segmentIndex}')) THEN RETURN false;END IF;
 END LOOP;
 -- The existing actual register binder covers all physical LIN; application
 -- grouping must be exactly that partition, never a caller-selected subset.
 IF EXISTS(SELECT FROM jsonb_array_elements(facts#>'{registerValidation,objects}')e WHERE NOT seen@>jsonb_build_array(e-'disposition'-'reasons')) THEN RETURN false;END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION gridex_received_sources.append_prodat_validation_v4(c uuid,env text,source_id uuid,source_hash text,facts_text text,ignored_text text,response_text text,application_text text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt jsonb;s gridex_received_sources.sources%rowtype;facet jsonb;digest text;
BEGIN
 IF application_text IS NOT NULL THEN
  SELECT * INTO s FROM gridex_received_sources.sources WHERE source_message_id=source_id AND company_id=c AND environment=env FOR UPDATE;
  IF s.source_message_id IS NULL OR s.payload_hash IS DISTINCT FROM source_hash OR octet_length(application_text)>524288 THEN RAISE EXCEPTION 'prodat_application_same_owner_required';END IF;
  facet:=application_text::jsonb;
  IF NOT coalesce(gridex_received_sources.validate_prodat_application_v1(s.raw_payload,facts_text::jsonb,facet,response_text::jsonb),false) THEN RAISE EXCEPTION 'prodat_application_same_owner_required';END IF;
  digest:=encode(sha256(convert_to(application_text,'UTF8')),'hex');
 END IF;
 receipt:=gridex_received_sources.append_prodat_validation_v3(c,env,source_id,source_hash,facts_text,ignored_text,response_text);
 IF facet IS NOT NULL THEN INSERT INTO gridex_received_sources.prodat_application_facets VALUES((receipt->>'assessmentId')::uuid,source_id,c,env,source_hash,application_text,digest);END IF;
 RETURN receipt||jsonb_build_object('version',4,'applicationFactsHash',digest);
END $$;
CREATE FUNCTION public.gridex_record_prodat_source_validation_v4(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text,p_ignored_fields_text text,p_response_facts_text text,p_application_facts_text text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'received_evidence_service_required' USING ERRCODE='42501';END IF;
 RETURN gridex_received_sources.append_prodat_validation_v4(p_company_id,p_environment,p_source_message_id,p_source_payload_hash,p_facts_text,p_ignored_fields_text,p_response_facts_text,p_application_facts_text);
END $$;
CREATE FUNCTION gridex_received_sources.require_prodat_application_objects_v1(c uuid,source_id uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;a gridex_received_sources.validation_assessments%rowtype;f gridex_received_sources.prodat_application_facets%rowtype;r gridex_received_sources.prodat_response_facets%rowtype;basis jsonb;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=source_id AND company_id=c FOR SHARE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' THEN RAISE EXCEPTION 'prodat_application_original_owner_unavailable';END IF;
 SELECT v.* INTO a FROM gridex_received_sources.validation_assessments v WHERE v.company_id=c AND v.source_message_id=source_id AND v.environment=m.environment
  AND v.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)
  AND v.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296) FOR SHARE;
 SELECT * INTO f FROM gridex_received_sources.prodat_application_facets WHERE assessment_id=a.id AND company_id=c AND source_message_id=source_id AND environment=m.environment AND source_payload_hash=a.source_payload_hash;
 SELECT * INTO r FROM gridex_received_sources.prodat_response_facets WHERE assessment_id=a.id;
 IF a.id IS NULL OR f.assessment_id IS NULL OR a.owner IS DISTINCT FROM 'canonical-runtime-with-registry-v1' OR a.facts_hash IS DISTINCT FROM encode(sha256(convert_to(a.facts_text,'UTF8')),'hex')
  OR f.application_facts_hash IS DISTINCT FROM encode(sha256(convert_to(f.application_facts_text,'UTF8')),'hex') OR NOT coalesce(gridex_received_sources.validate_prodat_application_v1(m.raw_payload,a.facts_text::jsonb,f.application_facts_text::jsonb,r.response_facts_text::jsonb),false) THEN RAISE EXCEPTION 'prodat_application_original_owner_unavailable';END IF;
 basis:=gridex_ediel_source_rules.require_v1(c,source_id);
 IF a.facts_text::jsonb->'rulePackEvidence' IS DISTINCT FROM jsonb_build_object('profileKey',basis->'profileKey','messageProfileId',basis->'messageProfileId','rulePackId',basis->'rulePackId','sourceHash',basis->'sourceHash','version',basis->'version',
  'snapshot',jsonb_build_object('rulePack',basis#>'{snapshot,rulePack}','messageProfile',basis#>'{snapshot,messageProfile}','guideSources',basis#>'{snapshot,guideSources}')) THEN RAISE EXCEPTION 'prodat_application_original_rule_witness_mismatch';END IF;
 RETURN f.application_facts_text::jsonb||jsonb_build_object('assessmentId',a.id);
END $$;
CREATE FUNCTION gridex_received_sources.prodat_application_object_accepted_v1(c uuid,source_id uuid,canonical_id uuid,object_scope jsonb) RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE facet jsonb;
BEGIN
 facet:=gridex_received_sources.require_prodat_application_objects_v1(c,source_id);
 RETURN facet->>'headerDecision'='accepted' AND facet->>'assessmentId'=canonical_id::text
  AND EXISTS(SELECT FROM jsonb_array_elements(facet->'objects')e WHERE e->>'applicationDecision'='accepted' AND e-'applicationDecision'-'reasonCodes'=object_scope);
END $$;
CREATE FUNCTION public.ediel_read_prodat_application_objects_v1(p_company_id uuid,p_source_message_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'received_evidence_service_required' USING ERRCODE='42501';END IF;
 RETURN gridex_received_sources.require_prodat_application_objects_v1(p_company_id,p_source_message_id);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.validate_prodat_application_v1(text,jsonb,jsonb,jsonb),gridex_received_sources.append_prodat_validation_v4(uuid,text,uuid,text,text,text,text,text),gridex_received_sources.require_prodat_application_objects_v1(uuid,uuid),gridex_received_sources.prodat_application_object_accepted_v1(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_received_sources.append_prodat_validation_v4(uuid,text,uuid,text,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.gridex_record_prodat_source_validation_v4(uuid,text,uuid,text,text,text,text,text),public.ediel_read_prodat_application_objects_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_record_prodat_source_validation_v4(uuid,text,uuid,text,text,text,text,text),public.ediel_read_prodat_application_objects_v1(uuid,uuid) TO service_role;
COMMIT;
