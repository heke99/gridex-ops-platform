-- Actual CLI forward. SAME source/function invocation, separate from complete
-- application, national response and customer/structural mutation authority.
BEGIN;
CREATE TABLE gridex_received_sources.prodat_source_function_facets(
 assessment_id uuid PRIMARY KEY REFERENCES gridex_received_sources.validation_assessments(id),
 source_message_id uuid NOT NULL REFERENCES gridex_received_sources.sources(source_message_id),company_id uuid NOT NULL,environment text NOT NULL CHECK(environment IN('test','production')),
 source_payload_hash text NOT NULL,function_facts_text text NOT NULL CHECK(octet_length(function_facts_text)<=524288),function_facts_hash text NOT NULL,
 CHECK(function_facts_hash=encode(sha256(convert_to(function_facts_text,'UTF8')),'hex')));
ALTER TABLE gridex_received_sources.prodat_source_function_facets ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_received_sources.prodat_source_function_facets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.prodat_source_function_facets FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_received_sources.prodat_source_function_facets FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_received_sources.prodat_source_function_facets FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE FUNCTION gridex_received_sources.validate_prodat_source_function_v1(c uuid,source_id uuid,raw text,facts jsonb,facet jsonb) RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE r gridex_customer_life_events.inbound_context_receipts%rowtype;object jsonb;scope jsonb;reg jsonb;seen jsonb:='[]';state text;reasons jsonb;m public.ediel_messages%rowtype;context_xmin numeric;
BEGIN
 IF jsonb_typeof(facet) IS DISTINCT FROM 'object' OR(SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(facet)k) IS DISTINCT FROM ARRAY['coverage','objects','owner','sourceContextFactsHash','sourceContextReceiptId','sourcePayloadHash','version']::text[]
  OR facet->'version' IS DISTINCT FROM '1'::jsonb OR facet->>'owner' IS DISTINCT FROM 'canonical-prodat-source-function-v1' OR facet->>'coverage' IS DISTINCT FROM 'customer_life_event_only'
  OR facet->>'sourcePayloadHash' IS DISTINCT FROM encode(sha256(convert_to(raw,'UTF8')),'hex') OR facet->>'sourceContextFactsHash'!~'^[a-f0-9]{64}$'
  OR facts->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR jsonb_typeof(facts->'rulePackEvidence') IS DISTINCT FROM 'object'
  OR jsonb_typeof(facet->'objects') IS DISTINCT FROM 'array' OR jsonb_array_length(facet->'objects')<>jsonb_array_length(facts#>'{registerValidation,objects}')
  OR facts#>>'{registerValidation,owner}' IS DISTINCT FROM 'validateProdatRegisterPolicy' OR facts#>>'{registerValidation,coverage}' IS DISTINCT FROM 'canonical_register_only' THEN RETURN false;END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=source_id AND company_id=c FOR SHARE;
 SELECT stored.xmin::text::numeric INTO context_xmin FROM gridex_customer_life_events.inbound_context_receipts stored WHERE stored.id=(facet->>'sourceContextReceiptId')::uuid AND stored.company_id=c AND stored.source_message_id=source_id;
 SELECT * INTO r FROM gridex_customer_life_events.inbound_context_receipts WHERE id=(facet->>'sourceContextReceiptId')::uuid AND company_id=c AND source_message_id=source_id FOR SHARE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z06' OR m.raw_payload IS DISTINCT FROM raw
  OR r.id IS NULL OR r.environment IS DISTINCT FROM m.environment OR r.payload_hash IS DISTINCT FROM facet->>'sourcePayloadHash' OR r.context_facts_hash IS DISTINCT FROM facet->>'sourceContextFactsHash'
  OR r.context_facts_hash IS DISTINCT FROM encode(sha256(convert_to(r.context_facts::text,'UTF8')),'hex') OR r.context_facts->>'rawPayload' IS DISTINCT FROM raw
  OR r.context_facts->>'status' IS DISTINCT FROM 'authorized' OR context_xmin=mod(pg_current_xact_id()::text::numeric,4294967296) THEN RETURN false;END IF;
 FOR object IN SELECT e FROM jsonb_array_elements(facet->'objects')e LOOP
  IF jsonb_typeof(object) IS DISTINCT FROM 'object' OR(SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(object)k) IS DISTINCT FROM ARRAY['functionalDecision','identityAgency','messageIndex','messageReference','objectId','reasonCodes','registers']::text[] THEN RETURN false;END IF;
  scope:=object-'functionalDecision'-'reasonCodes';state:=object->>'functionalDecision';reasons:=object->'reasonCodes';
  IF(state IN('accepted','held','not_applicable')) IS NOT TRUE OR jsonb_typeof(reasons) IS DISTINCT FROM 'array' OR jsonb_array_length(reasons)>128
   OR EXISTS(SELECT FROM jsonb_array_elements(reasons)e WHERE jsonb_typeof(e)<>'string' OR e#>>'{}'!~'^[A-Za-z0-9_.:-]{1,128}$')
   OR(SELECT count(*) FROM jsonb_array_elements(reasons)e)<>(SELECT count(DISTINCT e) FROM jsonb_array_elements(reasons)e)
   OR state='accepted' AND jsonb_array_length(reasons)<>0 OR state<>'accepted' AND jsonb_array_length(reasons)=0 OR seen@>jsonb_build_array(scope) THEN RETURN false;END IF;
  seen:=seen||jsonb_build_array(scope);
  SELECT e INTO reg FROM jsonb_array_elements(facts#>'{registerValidation,objects}')e WHERE e-'disposition'-'reasons'=scope;
  IF reg IS NULL OR state='accepted' AND gridex_customer_life_events.inbound_context_object_is_qualified_v1(c,source_id,r.id,scope) IS NOT TRUE THEN RETURN false;END IF;
 END LOOP;
 IF EXISTS(SELECT FROM jsonb_array_elements(facts#>'{registerValidation,objects}')e WHERE NOT seen@>jsonb_build_array(e-'disposition'-'reasons')) THEN RETURN false;END IF;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value OR data_exception THEN RETURN false;
END $$;
CREATE FUNCTION gridex_received_sources.validate_prodat_application_v2(c uuid,source_id uuid,raw text,facts jsonb,facet jsonb,response jsonb,source_function jsonb) RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF source_function IS NULL THEN RETURN gridex_received_sources.validate_prodat_application_v1(raw,facts,facet,response);END IF;
 IF gridex_received_sources.validate_prodat_source_function_v1(c,source_id,raw,facts,source_function) IS NOT TRUE THEN RETURN false;END IF;
 -- V1's physical/full-application checks are retained. Its historical global
 -- functional prerequisite is not an application fact: V5 supplies a distinct
 -- complete genuine source/function partition. The temporary shape input is
 -- neither persisted nor returned, and grants no application-based effect.
 RETURN gridex_received_sources.validate_prodat_application_v1(raw,facts||jsonb_build_object('functionalDecision','accepted'),facet,response);
END $$;
CREATE FUNCTION gridex_received_sources.append_prodat_validation_v5(c uuid,env text,source_id uuid,source_hash text,facts_text text,ignored_text text,response_text text,application_text text,function_text text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt jsonb;s gridex_received_sources.sources%rowtype;application jsonb;functional jsonb;application_digest text;function_digest text;
BEGIN
 IF function_text IS NULL THEN RETURN gridex_received_sources.append_prodat_validation_v4(c,env,source_id,source_hash,facts_text,ignored_text,response_text,application_text)||jsonb_build_object('version',5,'sourceFunctionFactsHash',NULL);END IF;
 SELECT * INTO s FROM gridex_received_sources.sources WHERE source_message_id=source_id AND company_id=c AND environment=env FOR UPDATE;
 IF s.source_message_id IS NULL OR s.payload_hash IS DISTINCT FROM source_hash OR application_text IS NULL OR octet_length(function_text)>524288 OR octet_length(application_text)>524288 THEN RAISE EXCEPTION 'prodat_source_function_same_owner_required';END IF;
 application:=application_text::jsonb;functional:=function_text::jsonb;
 IF gridex_received_sources.validate_prodat_application_v2(c,source_id,s.raw_payload,facts_text::jsonb,application,response_text::jsonb,functional) IS NOT TRUE THEN RAISE EXCEPTION 'prodat_source_function_same_owner_required';END IF;
 application_digest:=encode(sha256(convert_to(application_text,'UTF8')),'hex');function_digest:=encode(sha256(convert_to(function_text,'UTF8')),'hex');
 receipt:=gridex_received_sources.append_prodat_validation_v3(c,env,source_id,source_hash,facts_text,ignored_text,response_text);
 INSERT INTO gridex_received_sources.prodat_application_facets VALUES((receipt->>'assessmentId')::uuid,source_id,c,env,source_hash,application_text,application_digest);
 INSERT INTO gridex_received_sources.prodat_source_function_facets VALUES((receipt->>'assessmentId')::uuid,source_id,c,env,source_hash,function_text,function_digest);
 RETURN receipt||jsonb_build_object('version',5,'applicationFactsHash',application_digest,'sourceFunctionFactsHash',function_digest);
END $$;
CREATE FUNCTION public.gridex_record_prodat_source_validation_v5(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text,p_ignored_fields_text text,p_response_facts_text text,p_application_facts_text text,p_source_function_facts_text text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'received_evidence_service_required' USING ERRCODE='42501';END IF;
 RETURN gridex_received_sources.append_prodat_validation_v5(p_company_id,p_environment,p_source_message_id,p_source_payload_hash,p_facts_text,p_ignored_fields_text,p_response_facts_text,p_application_facts_text,p_source_function_facts_text);
END $$;
-- Extend the SAME latest COMMITTED application reader, without changing the
-- old pure validator or selecting a new guide/current classification.
DO $forward$DECLARE body text;old text;new text;BEGIN
 SELECT pg_get_functiondef('gridex_received_sources.require_prodat_application_objects_v1(uuid,uuid)'::regprocedure) INTO body;
 old:=$old$gridex_received_sources.validate_prodat_application_v1(m.raw_payload,a.facts_text::jsonb,f.application_facts_text::jsonb,r.response_facts_text::jsonb)$old$;
 new:=$new$gridex_received_sources.validate_prodat_application_v2(c,source_id,m.raw_payload,a.facts_text::jsonb,f.application_facts_text::jsonb,r.response_facts_text::jsonb,(SELECT sf.function_facts_text::jsonb FROM gridex_received_sources.prodat_source_function_facets sf WHERE sf.assessment_id=a.id AND sf.company_id=c AND sf.source_message_id=source_id AND sf.environment=m.environment AND sf.source_payload_hash=a.source_payload_hash AND sf.function_facts_hash=encode(sha256(convert_to(sf.function_facts_text,'UTF8')),'hex')))$new$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'prodat_source_function_application_reader_shape_changed';END IF;EXECUTE replace(body,old,new);
END $forward$;
CREATE FUNCTION gridex_received_sources.require_prodat_source_function_objects_v1(c uuid,source_id uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE application jsonb;a gridex_received_sources.validation_assessments%rowtype;f gridex_received_sources.prodat_source_function_facets%rowtype;m public.ediel_messages%rowtype;context_xmin numeric;
BEGIN
 application:=gridex_received_sources.require_prodat_application_objects_v1(c,source_id);
 SELECT * INTO a FROM gridex_received_sources.validation_assessments WHERE id=(application->>'assessmentId')::uuid;
 SELECT * INTO f FROM gridex_received_sources.prodat_source_function_facets WHERE assessment_id=a.id AND company_id=c AND source_message_id=source_id AND environment=a.environment AND source_payload_hash=a.source_payload_hash;
 SELECT * INTO m FROM public.ediel_messages WHERE id=source_id AND company_id=c FOR SHARE;
 IF f.assessment_id IS NULL OR f.function_facts_hash IS DISTINCT FROM encode(sha256(convert_to(f.function_facts_text,'UTF8')),'hex')
  OR gridex_received_sources.validate_prodat_source_function_v1(c,source_id,m.raw_payload,a.facts_text::jsonb,f.function_facts_text::jsonb) IS NOT TRUE THEN RAISE EXCEPTION 'prodat_source_function_original_owner_unavailable';END IF;
 RETURN f.function_facts_text::jsonb||jsonb_build_object('assessmentId',a.id);
END $$;
CREATE FUNCTION gridex_received_sources.prodat_source_function_object_accepted_v1(c uuid,source_id uuid,canonical_id uuid,object_scope jsonb) RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE f jsonb;BEGIN
 f:=gridex_received_sources.require_prodat_source_function_objects_v1(c,source_id);
 RETURN f->>'assessmentId'=canonical_id::text AND EXISTS(SELECT FROM jsonb_array_elements(f->'objects')e WHERE e->>'functionalDecision'='accepted' AND e-'functionalDecision'-'reasonCodes'=object_scope);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.validate_prodat_source_function_v1(uuid,uuid,text,jsonb,jsonb),gridex_received_sources.validate_prodat_application_v2(uuid,uuid,text,jsonb,jsonb,jsonb,jsonb),gridex_received_sources.append_prodat_validation_v5(uuid,text,uuid,text,text,text,text,text,text),gridex_received_sources.require_prodat_source_function_objects_v1(uuid,uuid),gridex_received_sources.prodat_source_function_object_accepted_v1(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_received_sources.append_prodat_validation_v5(uuid,text,uuid,text,text,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.gridex_record_prodat_source_validation_v5(uuid,text,uuid,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_record_prodat_source_validation_v5(uuid,text,uuid,text,text,text,text,text,text) TO service_role;
COMMIT;
