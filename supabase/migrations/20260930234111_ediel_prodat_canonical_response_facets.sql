-- Actual Supabase CLI forward. A prospective sidecar retains the SAME canonical
-- P owner's planned responses and register grouping. No historical verdict mint.
BEGIN;
CREATE TABLE gridex_received_sources.prodat_response_facets(
 assessment_id uuid PRIMARY KEY REFERENCES gridex_received_sources.validation_assessments(id),source_message_id uuid NOT NULL REFERENCES gridex_received_sources.sources(source_message_id),
 company_id uuid NOT NULL,environment text NOT NULL CHECK(environment IN('test','production')),source_payload_hash text NOT NULL,
 response_facts_text text NOT NULL CHECK(octet_length(response_facts_text)<=524288),response_facts_hash text NOT NULL,
 CHECK(response_facts_hash=encode(sha256(convert_to(response_facts_text,'UTF8')),'hex')));
ALTER TABLE gridex_received_sources.prodat_response_facets ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_received_sources.prodat_response_facets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.prodat_response_facets FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_received_sources.prodat_response_facets FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_received_sources.prodat_response_facets FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE FUNCTION gridex_received_sources.validate_prodat_responses_v1(raw text,facts jsonb,facet jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_utilts_binding.wire_tokens_v1(raw);object jsonb;response jsonb;register_object jsonb;first_line jsonb;line jsonb;indices jsonb;seen integer[]:='{}';idx integer;own_li text;first_end integer;n integer;
BEGIN
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH' AND t#>>'{elements,2,0}'='PRODAT')<>1
  OR jsonb_typeof(facet) IS DISTINCT FROM 'object' OR(SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(facet)k) IS DISTINCT FROM ARRAY['objects','responses','sourcePayloadHash','version']::text[]
  OR facet->'version' IS DISTINCT FROM '1'::jsonb OR facet->>'sourcePayloadHash' IS DISTINCT FROM encode(sha256(convert_to(raw,'UTF8')),'hex')
  OR facts->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR jsonb_typeof(facts->'rulePackEvidence') IS DISTINCT FROM 'object'
  OR facts#>>'{registerValidation,owner}' IS DISTINCT FROM 'validateProdatRegisterPolicy' OR facts#>>'{registerValidation,coverage}' IS DISTINCT FROM 'canonical_register_only'
  OR jsonb_typeof(facet->'objects') IS DISTINCT FROM 'array' OR jsonb_typeof(facet->'responses') IS DISTINCT FROM 'array'
  OR jsonb_array_length(facet->'objects')>8192 OR jsonb_array_length(facet->'responses')>8192 THEN RETURN false;END IF;
 FOR object IN SELECT x FROM jsonb_array_elements(facet->'objects')x LOOP
  IF jsonb_typeof(object) IS DISTINCT FROM 'object' OR(SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(object)k) IS DISTINCT FROM ARRAY['id','li','lineIndex','outcome','registerLineIndices']::text[]
   OR (object->>'outcome' IN('positive','negative','held')) IS NOT TRUE OR jsonb_typeof(object->'lineIndex') IS DISTINCT FROM 'number'
   OR jsonb_typeof(object->'registerLineIndices') IS DISTINCT FROM 'array' OR jsonb_array_length(object->'registerLineIndices')=0 OR object->'lineIndex' IS DISTINCT FROM object#>'{registerLineIndices,0}' THEN RETURN false;END IF;
  idx:=(object->>'lineIndex')::integer;SELECT t INTO first_line FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN' AND(t->>'index')::integer=idx;
  IF first_line IS NULL OR to_jsonb(nullif(first_line#>>'{elements,3,0}','')) IS DISTINCT FROM nullif(object->'id','null'::jsonb) THEN RETURN false;END IF;
  SELECT min((t->>'index')::integer) INTO first_end FROM jsonb_array_elements(tokens)t WHERE(t->>'index')::integer>idx AND t->>'tag' IN('NAD','LIN','UNT');
  SELECT count(*),min(t#>>'{elements,1,1}') INTO n,own_li FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='LI' AND(t->>'index')::integer>idx AND(t->>'index')::integer<first_end;
  IF n>1 OR to_jsonb(nullif(own_li,'')) IS DISTINCT FROM nullif(object->'li','null'::jsonb) THEN RETURN false;END IF;
  SELECT x INTO register_object FROM jsonb_array_elements(facts#>'{registerValidation,objects}')x WHERE x#>'{registers,0,segmentIndex}'=object->'lineIndex';
  SELECT jsonb_agg(x->'segmentIndex' ORDER BY ord) INTO indices FROM jsonb_array_elements(register_object->'registers') WITH ORDINALITY v(x,ord);
  IF register_object IS NULL OR indices IS DISTINCT FROM object->'registerLineIndices' OR register_object->'objectId' IS DISTINCT FROM object->'id' THEN RETURN false;END IF;
  FOR idx IN SELECT value::text::integer FROM jsonb_array_elements(object->'registerLineIndices') LOOP
   IF idx=ANY(seen) THEN RETURN false;END IF;seen:=array_append(seen,idx);
   SELECT t INTO line FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN' AND(t->>'index')::integer=idx;
   IF line IS NULL OR line#>'{elements,3,0}' IS DISTINCT FROM first_line#>'{elements,3,0}' OR line#>'{elements,3,3}' IS DISTINCT FROM first_line#>'{elements,3,3}' THEN RETURN false;END IF;
  END LOOP;
  IF object->>'outcome'='positive' AND(facts->>'applicationDecision' IS DISTINCT FROM 'accepted' OR register_object->>'disposition' IS DISTINCT FROM 'accepted') THEN RETURN false;END IF;
 END LOOP;
 IF EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN' AND NOT((t->>'index')::integer=ANY(seen))) THEN RETURN false;END IF;
 FOR response IN SELECT x FROM jsonb_array_elements(facet->'responses')x LOOP
  IF jsonb_typeof(response) IS DISTINCT FROM 'object' OR(SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(response)k) IS DISTINCT FROM ARRAY['ercCode','fieldCode','id','li','lineIndex','scope','text']::text[]
   OR (response->>'scope' IN('message','object')) IS NOT TRUE OR jsonb_typeof(response->'ercCode') IS DISTINCT FROM 'string' OR response->>'ercCode'!~'^[0-9]{1,3}$'
   OR jsonb_typeof(response->'text') IS DISTINCT FROM 'string' OR length(response->>'text') NOT BETWEEN 1 AND 512 OR response->>'text'~'[[:cntrl:]]'
   OR (jsonb_typeof(response->'fieldCode') IN('string','null')) IS NOT TRUE THEN RETURN false;END IF;
  IF response->>'scope'='message' THEN IF response->'lineIndex' IS DISTINCT FROM 'null'::jsonb OR response->>'ercCode'='100' THEN RETURN false;END IF;
  ELSE SELECT x INTO object FROM jsonb_array_elements(facet->'objects')x WHERE x->'lineIndex'=response->'lineIndex';
   IF object IS NULL OR object->>'outcome' IS DISTINCT FROM (CASE WHEN response->>'ercCode'='100' THEN 'positive' ELSE 'negative' END) OR object->'id' IS DISTINCT FROM response->'id' OR object->'li' IS DISTINCT FROM response->'li' THEN RETURN false;END IF;
  END IF;
  IF response->>'ercCode'<>'100' AND(facts->>'applicationDecision' IN('rejected','manual_review')) IS NOT TRUE THEN RETURN false;END IF;
 END LOOP;
 IF EXISTS(SELECT FROM jsonb_array_elements(facet->'objects')o WHERE o->>'outcome'<>'held' AND NOT EXISTS(SELECT FROM jsonb_array_elements(facet->'responses')r WHERE r->>'scope'='object' AND r->'lineIndex'=o->'lineIndex'))
  OR(EXISTS(SELECT FROM jsonb_array_elements(facet->'responses')r WHERE r->>'scope'='message') AND EXISTS(SELECT FROM jsonb_array_elements(facet->'responses')r WHERE r->>'scope'='object')) THEN RETURN false;END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION gridex_received_sources.append_prodat_validation_v3(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text,p_ignored_fields_text text,p_response_facts_text text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt jsonb;s gridex_received_sources.sources%rowtype;facet jsonb;digest text;
BEGIN
 IF p_response_facts_text IS NOT NULL THEN
  SELECT * INTO s FROM gridex_received_sources.sources WHERE source_message_id=p_source_message_id AND company_id=p_company_id AND environment=p_environment FOR UPDATE;
  IF s.source_message_id IS NULL OR s.payload_hash IS DISTINCT FROM p_source_payload_hash OR octet_length(p_response_facts_text)>524288 THEN RAISE EXCEPTION 'prodat_response_same_owner_required';END IF;
  facet:=p_response_facts_text::jsonb;
  IF NOT coalesce(gridex_received_sources.validate_prodat_responses_v1(s.raw_payload,p_facts_text::jsonb,facet),false) THEN RAISE EXCEPTION 'prodat_response_same_owner_required';END IF;
  digest:=encode(sha256(convert_to(p_response_facts_text,'UTF8')),'hex');
 END IF;
 receipt:=gridex_received_sources.append_prodat_validation_v2(p_company_id,p_environment,p_source_message_id,p_source_payload_hash,p_facts_text,p_ignored_fields_text);
 IF facet IS NOT NULL THEN INSERT INTO gridex_received_sources.prodat_response_facets VALUES((receipt->>'assessmentId')::uuid,p_source_message_id,p_company_id,p_environment,p_source_payload_hash,p_response_facts_text,digest);END IF;
 RETURN receipt||jsonb_build_object('version',3,'responseFactsHash',digest);
END $$;
CREATE FUNCTION public.gridex_record_prodat_source_validation_v3(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text,p_ignored_fields_text text,p_response_facts_text text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'received_evidence_service_required' USING ERRCODE='42501';END IF;
 RETURN gridex_received_sources.append_prodat_validation_v3(p_company_id,p_environment,p_source_message_id,p_source_payload_hash,p_facts_text,p_ignored_fields_text,p_response_facts_text);
END $$;
CREATE FUNCTION gridex_received_sources.require_prodat_responses_v1(p_company uuid,p_source uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE s public.ediel_messages%rowtype;a gridex_received_sources.validation_assessments%rowtype;f gridex_received_sources.prodat_response_facets%rowtype;basis jsonb;facts jsonb;facet jsonb;
BEGIN
 SELECT * INTO s FROM public.ediel_messages WHERE id=p_source AND company_id=p_company FOR SHARE;
 IF s.id IS NULL OR s.direction IS DISTINCT FROM 'inbound' OR s.message_family IS DISTINCT FROM 'PRODAT' THEN RAISE EXCEPTION 'prodat_response_original_owner_unavailable';END IF;
 SELECT v.* INTO a FROM gridex_received_sources.validation_assessments v WHERE v.company_id=p_company AND v.source_message_id=p_source AND v.environment=s.environment AND v.source_payload_hash=encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex')
  AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id) AND v.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296) FOR SHARE;
 SELECT * INTO f FROM gridex_received_sources.prodat_response_facets WHERE assessment_id=a.id AND company_id=p_company AND source_message_id=p_source AND environment=s.environment AND source_payload_hash=a.source_payload_hash;
 IF a.id IS NULL OR f.assessment_id IS NULL OR a.owner IS DISTINCT FROM 'canonical-runtime-with-registry-v1' OR a.facts_hash IS DISTINCT FROM encode(sha256(convert_to(a.facts_text,'UTF8')),'hex') OR f.response_facts_hash IS DISTINCT FROM encode(sha256(convert_to(f.response_facts_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_response_original_owner_unavailable';END IF;
 facts:=a.facts_text::jsonb;facet:=f.response_facts_text::jsonb;
 IF NOT coalesce(gridex_received_sources.validate_prodat_responses_v1(s.raw_payload,facts,facet),false) THEN RAISE EXCEPTION 'prodat_response_original_owner_unavailable';END IF;
 basis:=gridex_ediel_source_rules.require_v1(p_company,p_source);
 IF facts->'rulePackEvidence' IS DISTINCT FROM jsonb_build_object('profileKey',basis->'profileKey','messageProfileId',basis->'messageProfileId','rulePackId',basis->'rulePackId','sourceHash',basis->'sourceHash','version',basis->'version','snapshot',jsonb_build_object('rulePack',basis#>'{snapshot,rulePack}','messageProfile',basis#>'{snapshot,messageProfile}','guideSources',basis#>'{snapshot,guideSources}')) THEN RAISE EXCEPTION 'prodat_response_original_rule_witness_mismatch';END IF;
 RETURN facet||jsonb_build_object('assessmentId',a.id);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.validate_prodat_responses_v1(text,jsonb,jsonb),gridex_received_sources.append_prodat_validation_v3(uuid,text,uuid,text,text,text,text),gridex_received_sources.require_prodat_responses_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_received_sources.append_prodat_validation_v3(uuid,text,uuid,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.gridex_record_prodat_source_validation_v3(uuid,text,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_record_prodat_source_validation_v3(uuid,text,uuid,text,text,text,text) TO service_role;
COMMIT;
