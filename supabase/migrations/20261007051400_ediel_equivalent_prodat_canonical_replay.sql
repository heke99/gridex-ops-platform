-- AT-Z14V-ESCO: preserve canonical identity for fully validated identical replay.
-- Existing applied migrations, validators, source/leaf guards and committed rows stay intact.
BEGIN;
DO $replay_guard$
DECLARE
 signature CONSTANT text:='gridex_received_sources.append_prodat_validation_v6(uuid,text,uuid,text,text,text,text,text,text,text)';
 wrapper_signature CONSTANT text:='public.gridex_record_prodat_source_validation_v6(uuid,text,uuid,text,text,text,text,text,text,text)';
 old_hash CONSTANT text:='00c135366cc901cc4dc2ceb14d7a98f7eac34450c30e9dd83154ad96b2bd8cc9';
 new_hash CONSTANT text:='a3ba4c02f451d6f0753f5f3ac77de768c3386090bba49e18bc87d272b82520cf';
 f record;body text;body_hash text;wrapper_before jsonb;
BEGIN
 IF to_regprocedure(signature) IS NULL OR to_regprocedure(wrapper_signature) IS NULL THEN RAISE EXCEPTION 'equivalent_prodat_replay_predecessor_unrecognized';END IF;
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid=to_regprocedure(signature);
 SELECT to_jsonb(p) INTO STRICT wrapper_before FROM pg_proc p WHERE oid=to_regprocedure(wrapper_signature);
 body_hash:=encode(sha256(convert_to(f.prosrc,'UTF8')),'hex');
 IF body_hash=new_hash THEN RETURN;END IF;
 IF body_hash<>old_hash OR (length(f.definition)-length(replace(f.definition,f.prosrc,'')))/length(f.prosrc)<>1 THEN RAISE EXCEPTION 'equivalent_prodat_replay_predecessor_unrecognized';END IF;
 body:=f.prosrc;
 IF (length(body)-length(replace(body,$needle0$;assessment uuid;$needle0$,'')))/length($needle0$;assessment uuid;$needle0$)<>1 THEN RAISE EXCEPTION 'equivalent_prodat_replay_predecessor_unrecognized';END IF;
 body:=replace(body,$needle0$;assessment uuid;$needle0$,$replacement0$;assessment uuid;replay_candidate uuid;replay_rule_pack uuid;replay_rollback boolean:=false;$replacement0$);
 IF (length(body)-length(replace(body,$needle1$ -- This is the sole primary append.$needle1$,'')))/length($needle1$ -- This is the sole primary append.$needle1$)<>1 THEN RAISE EXCEPTION 'equivalent_prodat_replay_predecessor_unrecognized';END IF;
 body:=replace(body,$needle1$ -- This is the sole primary append.$needle1$,$replacement1$ -- Retain registry authority locks through an equivalent-append rollback.
 -- The inherited validator below still verifies every locked snapshot byte.
 IF facts->>'applicationDecision'='accepted' THEN
  LOCK TABLE public.ediel_rule_pack_sources IN SHARE MODE;
  SELECT id INTO replay_rule_pack FROM public.ediel_rule_packs
   WHERE id::text=facts#>>'{rulePackEvidence,rulePackId}'
    AND source_hash=facts#>>'{rulePackEvidence,sourceHash}' FOR SHARE;
  PERFORM 1 FROM public.ediel_message_profiles
   WHERE id::text=facts#>>'{rulePackEvidence,messageProfileId}'
    AND rule_pack_id=replay_rule_pack
    AND profile_key=facts#>>'{rulePackEvidence,profileKey}' FOR SHARE;
 END IF;
 -- Count every leaf before matching: no ancestor, ambiguous branch or ABA reuse.
 WITH leaves AS (
  SELECT v.id FROM gridex_received_sources.validation_assessments v
   WHERE v.source_message_id=p_source_message_id
    AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)
 ) SELECT id INTO replay_candidate FROM leaves WHERE (SELECT count(*) FROM leaves)=1;
 BEGIN
 -- This is the sole primary append.$replacement1$);
 IF (length(body)-length(replace(body,$needle2$ RETURN receipt||jsonb_build_object('version',6,'responseFactsHash',response_hash,'applicationFactsHash',application_hash,'sourceFunctionFactsHash',function_hash);$needle2$,'')))/length($needle2$ RETURN receipt||jsonb_build_object('version',6,'responseFactsHash',response_hash,'applicationFactsHash',application_hash,'sourceFunctionFactsHash',function_hash);$needle2$)<>1 THEN RAISE EXCEPTION 'equivalent_prodat_replay_predecessor_unrecognized';END IF;
 body:=replace(body,$needle2$ RETURN receipt||jsonb_build_object('version',6,'responseFactsHash',response_hash,'applicationFactsHash',application_hash,'sourceFunctionFactsHash',function_hash);$needle2$,$replacement2$ -- Only a fully validated identical positive leaf can retain its identity.
 -- The redundant child and its facets have not committed; rollback does not
 -- delete or rewrite any existing history, receipt, ACK or market effect.
 IF replay_candidate IS NOT NULL AND assessment IS DISTINCT FROM replay_candidate
  AND facts->>'syntaxDecision'='accepted' AND facts->>'applicationDecision'='accepted'
  AND facts->>'functionalDecision'='accepted'
  AND EXISTS(SELECT FROM gridex_received_sources.validation_assessments v
   LEFT JOIN gridex_received_sources.prodat_ignored_field_facets ignored ON ignored.canonical_assessment_id=v.id
   LEFT JOIN gridex_received_sources.prodat_object_validation_facets object ON object.assessment_id=v.id
   LEFT JOIN gridex_received_sources.prodat_response_facets response_facet ON response_facet.assessment_id=v.id
   LEFT JOIN gridex_received_sources.prodat_application_facets application_facet ON application_facet.assessment_id=v.id
   LEFT JOIN gridex_received_sources.prodat_source_function_facets function_facet ON function_facet.assessment_id=v.id
   WHERE v.id=replay_candidate
    AND v.owner='canonical-runtime-with-registry-v1'
    AND v.company_id=p_company_id
    AND v.environment=p_environment
    AND v.source_message_id=p_source_message_id
    AND v.source_payload_hash=p_source_payload_hash
    AND v.facts_text IS NOT DISTINCT FROM p_facts_text
    AND v.facts_hash=encode(sha256(convert_to(p_facts_text,'UTF8')),'hex')
    AND EXISTS(SELECT FROM gridex_received_sources.validation_assessments attempted WHERE attempted.id=assessment AND attempted.previous_assessment_id=v.id AND attempted.source_message_id=v.source_message_id)
    AND ((p_ignored_fields_text IS NULL AND ignored.canonical_assessment_id IS NULL) OR
     (p_ignored_fields_text IS NOT NULL AND ignored.canonical_assessment_id IS NOT NULL
      AND ignored.company_id=p_company_id AND ignored.environment=p_environment
      AND ignored.source_message_id=p_source_message_id AND ignored.source_payload_hash=p_source_payload_hash
      AND ignored.fields_text IS NOT DISTINCT FROM p_ignored_fields_text
      AND ignored.fields_hash=encode(sha256(convert_to(p_ignored_fields_text,'UTF8')),'hex')))
    AND ((p_object_facts_text IS NULL AND object.assessment_id IS NULL) OR
     (p_object_facts_text IS NOT NULL AND object.assessment_id IS NOT NULL
      AND object.company_id=p_company_id AND object.environment=p_environment
      AND object.source_message_id=p_source_message_id AND object.source_payload_hash=p_source_payload_hash
      AND object.facts_text IS NOT DISTINCT FROM p_object_facts_text
      AND object.facts_hash=encode(sha256(convert_to(p_object_facts_text,'UTF8')),'hex')))
    AND ((p_response_facts_text IS NULL AND response_facet.assessment_id IS NULL) OR
     (p_response_facts_text IS NOT NULL AND response_facet.assessment_id IS NOT NULL
      AND response_facet.company_id=p_company_id AND response_facet.environment=p_environment
      AND response_facet.source_message_id=p_source_message_id AND response_facet.source_payload_hash=p_source_payload_hash
      AND response_facet.response_facts_text IS NOT DISTINCT FROM p_response_facts_text
      AND response_facet.response_facts_hash=encode(sha256(convert_to(p_response_facts_text,'UTF8')),'hex')))
    AND ((p_application_facts_text IS NULL AND application_facet.assessment_id IS NULL) OR
     (p_application_facts_text IS NOT NULL AND application_facet.assessment_id IS NOT NULL
      AND application_facet.company_id=p_company_id AND application_facet.environment=p_environment
      AND application_facet.source_message_id=p_source_message_id AND application_facet.source_payload_hash=p_source_payload_hash
      AND application_facet.application_facts_text IS NOT DISTINCT FROM p_application_facts_text
      AND application_facet.application_facts_hash=encode(sha256(convert_to(p_application_facts_text,'UTF8')),'hex')))
    AND ((p_source_function_facts_text IS NULL AND function_facet.assessment_id IS NULL) OR
     (p_source_function_facts_text IS NOT NULL AND function_facet.assessment_id IS NOT NULL
      AND function_facet.company_id=p_company_id AND function_facet.environment=p_environment
      AND function_facet.source_message_id=p_source_message_id AND function_facet.source_payload_hash=p_source_payload_hash
      AND function_facet.function_facts_text IS NOT DISTINCT FROM p_source_function_facts_text
      AND function_facet.function_facts_hash=encode(sha256(convert_to(p_source_function_facts_text,'UTF8')),'hex')))) THEN
  replay_rollback:=true;
  RAISE EXCEPTION 'ediel_equivalent_prodat_canonical_replay_rollback' USING ERRCODE='GX001';
 END IF;
 EXCEPTION WHEN SQLSTATE 'GX001' THEN
  IF replay_rollback IS NOT TRUE OR SQLERRM IS DISTINCT FROM 'ediel_equivalent_prodat_canonical_replay_rollback' THEN RAISE;END IF;
  RETURN jsonb_build_object('version',6,'assessmentId',replay_candidate,'companyId',p_company_id,'environment',p_environment,
   'sourceMessageId',p_source_message_id,'sourcePayloadHash',p_source_payload_hash,
   'factsHash',encode(sha256(convert_to(p_facts_text,'UTF8')),'hex'),'sourceDisposition','not_established',
   'ignoredFieldsHash',CASE WHEN p_ignored_fields_text IS NULL THEN NULL ELSE encode(sha256(convert_to(p_ignored_fields_text,'UTF8')),'hex') END,
   'objectFactsHash',CASE WHEN p_object_facts_text IS NULL THEN NULL ELSE encode(sha256(convert_to(p_object_facts_text,'UTF8')),'hex') END,
   'responseFactsHash',response_hash,'applicationFactsHash',application_hash,'sourceFunctionFactsHash',function_hash);
 END;
 RETURN receipt||jsonb_build_object('version',6,'responseFactsHash',response_hash,'applicationFactsHash',application_hash,'sourceFunctionFactsHash',function_hash);$replacement2$);
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>new_hash THEN RAISE EXCEPTION 'equivalent_prodat_replay_body_unrecognized';END IF;
 EXECUTE replace(f.definition,f.prosrc,body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=f.oid) IS DISTINCT FROM new_hash
 OR (SELECT to_jsonb(p) FROM pg_proc p WHERE oid=to_regprocedure(wrapper_signature)) IS DISTINCT FROM wrapper_before THEN RAISE EXCEPTION 'equivalent_prodat_replay_metadata_changed';END IF;
END
$replay_guard$;
COMMIT;
