-- Prospective same-decision P119 exclusion projection. Existing canonical facts
-- and historical assessments remain unchanged; missing past facets are UNKNOWN.
BEGIN;
CREATE TABLE gridex_received_sources.prodat_ignored_field_facets (
 canonical_assessment_id uuid PRIMARY KEY REFERENCES gridex_received_sources.validation_assessments(id) ON DELETE RESTRICT,
 company_id uuid NOT NULL,environment text NOT NULL CHECK(environment IN('test','production')),
 source_message_id uuid NOT NULL REFERENCES gridex_received_sources.sources(source_message_id) ON DELETE RESTRICT,
 source_payload_hash text NOT NULL,fields_text text NOT NULL,fields_hash text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(octet_length(fields_text)<=262144),CHECK(fields_hash=encode(sha256(convert_to(fields_text,'UTF8')),'hex'))
);
ALTER TABLE gridex_received_sources.prodat_ignored_field_facets ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_sources.prodat_ignored_field_facets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.prodat_ignored_field_facets FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER prodat_ignored_no_mutation BEFORE UPDATE OR DELETE ON gridex_received_sources.prodat_ignored_field_facets FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER prodat_ignored_no_truncate BEFORE TRUNCATE ON gridex_received_sources.prodat_ignored_field_facets FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE FUNCTION gridex_received_sources.append_prodat_validation_v2(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text,p_ignored_fields_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt jsonb;fields jsonb;field jsonb;occ jsonb;s gridex_received_sources.sources%rowtype;a gridex_received_sources.validation_assessments%rowtype;tokens jsonb;line jsonb;digest text;
BEGIN
 -- Canonical source admission/whole register scope remain their prior owner.
 -- This transaction adds only the exclusion list from that same invocation.
 receipt:=gridex_received_sources.append_validation(p_company_id,p_environment,p_source_message_id,p_source_payload_hash,p_facts_text);
 SELECT * INTO STRICT a FROM gridex_received_sources.validation_assessments WHERE id=(receipt->>'assessmentId')::uuid AND company_id=p_company_id AND environment=p_environment;
 SELECT * INTO STRICT s FROM gridex_received_sources.sources WHERE source_message_id=p_source_message_id AND company_id=p_company_id AND environment=p_environment;
 IF s.payload_hash IS DISTINCT FROM p_source_payload_hash OR a.source_message_id IS DISTINCT FROM s.source_message_id
  OR a.facts_text IS DISTINCT FROM p_facts_text OR a.facts_hash IS DISTINCT FROM receipt->>'factsHash' THEN RAISE EXCEPTION 'prodat_ignored_same_original_required';END IF;
 IF p_ignored_fields_text IS NOT NULL THEN
  tokens:=gridex_received_sources.closure_wire_tokens_v2(s.raw_payload);
  IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNH' AND t#>>'{elements,2,0}'='PRODAT')<>1 THEN RAISE EXCEPTION 'prodat_ignored_same_original_required';END IF;
  IF octet_length(p_ignored_fields_text)>262144 THEN RAISE EXCEPTION 'prodat_ignored_field_budget_exceeded';END IF;fields:=p_ignored_fields_text::jsonb;
  IF jsonb_typeof(fields) IS DISTINCT FROM 'array' OR jsonb_array_length(fields)>8192 OR a.facts_text::jsonb->'registerValidation' IS NULL THEN RAISE EXCEPTION 'prodat_ignored_canonical_scope_required';END IF;
  FOR field IN SELECT value FROM jsonb_array_elements(fields) LOOP
   occ:=field->'occurrence';
   IF jsonb_typeof(field) IS DISTINCT FROM 'object' OR field-ARRAY['fieldNumber','sourceRule','occurrence']<>'{}'::jsonb
    OR field->>'sourceRule' IS DISTINCT FROM 'PRODAT26A:P119' OR nullif(field->>'fieldNumber','') IS NULL
    OR jsonb_typeof(occ) IS DISTINCT FROM 'object' OR (occ->>'scope' IN('header','object','register')) IS NOT TRUE
    OR occ->>'messageReference' IS DISTINCT FROM a.facts_text::jsonb->>'messageReference' THEN RAISE EXCEPTION 'prodat_ignored_field_scope_invalid';END IF;
   IF occ->>'scope'<>'header' THEN
    SELECT t INTO line FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN' AND (SELECT count(*) FROM jsonb_array_elements(tokens) prior WHERE prior->>'tag'='LIN' AND (prior->>'index')::integer<(t->>'index')::integer)=(occ->>'lineIndex')::integer;
    IF line IS NULL OR line#>>'{elements,1,0}' IS DISTINCT FROM occ->>'lineNumber' OR line#>>'{elements,3,0}' IS DISTINCT FROM occ->>'objectId'
     OR line#>>'{elements,3,3}' IS DISTINCT FROM occ->>'identityAgency' THEN RAISE EXCEPTION 'prodat_ignored_field_physical_scope_invalid';END IF;
   END IF;
  END LOOP;
  digest:=encode(sha256(convert_to(p_ignored_fields_text,'UTF8')),'hex');
  INSERT INTO gridex_received_sources.prodat_ignored_field_facets(canonical_assessment_id,company_id,environment,source_message_id,source_payload_hash,fields_text,fields_hash)
   VALUES(a.id,p_company_id,p_environment,s.source_message_id,s.payload_hash,p_ignored_fields_text,digest);
 END IF;
 RETURN receipt||jsonb_build_object('version',2,'ignoredFieldsHash',digest);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.append_prodat_validation_v2(uuid,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_received_sources.append_prodat_validation_v2(uuid,text,uuid,text,text,text) TO service_role;
CREATE FUNCTION public.gridex_record_prodat_source_validation_v2(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text,p_ignored_fields_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'received_evidence_service_required' USING ERRCODE='42501';END IF;
 RETURN gridex_received_sources.append_prodat_validation_v2(p_company_id,p_environment,p_source_message_id,p_source_payload_hash,p_facts_text,p_ignored_fields_text);
END $$;
REVOKE ALL ON FUNCTION public.gridex_record_prodat_source_validation_v2(uuid,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_record_prodat_source_validation_v2(uuid,text,uuid,text,text,text) TO service_role;
-- The immutable object snapshot supplies canonical IDs; callers cannot choose
-- a convenient canonical revision outside that exact prospective readset.
CREATE FUNCTION public.gridex_read_prodat_ignored_fields_v1(p_company_id uuid,p_environment text,p_actor_user_id uuid,p_snapshot_id uuid,p_readset_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE snap gridex_received_sources.object_selection_snapshots%rowtype;result jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'prodat_ignored_service_required' USING ERRCODE='42501';END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR NOT(coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.write'),false) OR coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'ediel_testing.write'),false)) THEN RAISE EXCEPTION 'ediel_tenant_actor_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO snap FROM gridex_received_sources.object_selection_snapshots WHERE id=p_snapshot_id AND company_id=p_company_id AND environment=p_environment AND readset_hash=p_readset_hash;
 IF NOT FOUND OR snap.readset_hash IS DISTINCT FROM encode(sha256(convert_to(snap.readset_text,'UTF8')),'hex') OR snap.readset_text::jsonb->>'complete' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'prodat_ignored_owned_snapshot_required';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('sourceMessageId',source->>'sourceMessageId','canonicalAssessmentId',assessment->>'canonicalAssessmentId','fieldsText',f.fields_text,'fieldsHash',f.fields_hash) ORDER BY source->>'sourceMessageId',assessment->>'canonicalAssessmentId'),'[]') INTO result
 FROM jsonb_array_elements(snap.readset_text::jsonb->'sources') source CROSS JOIN LATERAL jsonb_array_elements(source->'assessments') assessment
 LEFT JOIN gridex_received_sources.prodat_ignored_field_facets f ON f.canonical_assessment_id=(assessment->>'canonicalAssessmentId')::uuid AND f.company_id=p_company_id AND f.environment=p_environment AND f.source_message_id::text=source->>'sourceMessageId' AND f.source_payload_hash=source->>'payloadHash'
 WHERE (assessment->>'assessedAt')::timestamptz<=snap.cutoff_at AND NOT EXISTS(SELECT FROM jsonb_array_elements(source->'assessments') child WHERE child->>'previousAssessmentId'=assessment->>'id' AND (child->>'assessedAt')::timestamptz<=snap.cutoff_at);
 RETURN jsonb_build_object('version',1,'companyId',p_company_id,'environment',p_environment,'snapshotId',snap.id,'readsetHash',snap.readset_hash,'facets',result);
END $$;
REVOKE ALL ON FUNCTION public.gridex_read_prodat_ignored_fields_v1(uuid,text,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_read_prodat_ignored_fields_v1(uuid,text,uuid,uuid,text) TO service_role;
COMMIT;
