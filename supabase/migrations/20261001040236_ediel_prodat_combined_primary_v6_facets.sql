-- CLI-created final primary owner: all four independent facets share ONE assessment and transaction.
BEGIN;
CREATE FUNCTION gridex_received_sources.append_prodat_validation_v6(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text,p_ignored_fields_text text,p_object_facts_text text,p_response_facts_text text,p_application_facts_text text,p_source_function_facts_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt jsonb;s gridex_received_sources.sources%rowtype;m public.ediel_messages%rowtype;facts jsonb;response jsonb;application jsonb;functional jsonb;functional_own jsonb;objects jsonb;own jsonb;reg jsonb;app jsonb;planned jsonb;response_hash text;application_hash text;function_hash text;assessment uuid;
BEGIN
 -- Current actual authorization graph comes before any ledger/source/market
 -- lock. Writer-compatible facet locks precede the common graph's SHARE ledger
 -- locks, so two primary writers cannot deadlock while upgrading SHARE locks.
 PERFORM gridex_received_sources.lock_prodat_execution_actor_graph_v1();
 LOCK TABLE gridex_received_sources.validation_assessments,gridex_received_sources.prodat_ignored_field_facets,gridex_received_sources.prodat_object_validation_facets,gridex_received_sources.prodat_response_facets,gridex_received_sources.prodat_application_facets,gridex_received_sources.prodat_source_function_facets IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE gridex_customer_life_events.inbound_context_receipts IN SHARE MODE;
 PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 LOCK TABLE public.ediel_messages IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id AND environment=p_environment FOR UPDATE;
 SELECT * INTO s FROM gridex_received_sources.sources WHERE source_message_id=p_source_message_id AND company_id=p_company_id AND environment=p_environment FOR UPDATE;
 IF m.id IS NULL OR s.source_message_id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR s.raw_payload IS NULL OR s.raw_payload IS DISTINCT FROM m.raw_payload OR s.payload_hash IS DISTINCT FROM p_source_payload_hash OR s.payload_hash IS DISTINCT FROM encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_v6_same_original_required';END IF;
 PERFORM public.ediel_require_source_bytes_available_v1(p_company_id,p_source_message_id);
 facts:=p_facts_text::jsonb;
 IF p_response_facts_text IS NOT NULL THEN
  IF octet_length(p_response_facts_text)>524288 THEN RAISE EXCEPTION 'prodat_response_same_owner_required';END IF;
  response:=p_response_facts_text::jsonb;
  IF NOT coalesce(gridex_received_sources.validate_prodat_responses_v1(s.raw_payload,facts,response),false) THEN RAISE EXCEPTION 'prodat_response_same_owner_required';END IF;
  response_hash:=encode(sha256(convert_to(p_response_facts_text,'UTF8')),'hex');
 END IF;
 IF p_source_function_facts_text IS NOT NULL THEN
  IF octet_length(p_source_function_facts_text)>524288 OR p_application_facts_text IS NULL THEN RAISE EXCEPTION 'prodat_source_function_same_owner_required';END IF;
  functional:=p_source_function_facts_text::jsonb;
  IF gridex_received_sources.validate_prodat_source_function_v1(p_company_id,p_source_message_id,s.raw_payload,facts,functional) IS NOT TRUE THEN RAISE EXCEPTION 'prodat_source_function_same_owner_required';END IF;
  function_hash:=encode(sha256(convert_to(p_source_function_facts_text,'UTF8')),'hex');
 END IF;
 IF p_application_facts_text IS NOT NULL THEN
  IF octet_length(p_application_facts_text)>524288 THEN RAISE EXCEPTION 'prodat_application_same_owner_required';END IF;
  application:=p_application_facts_text::jsonb;
  IF NOT coalesce(gridex_received_sources.validate_prodat_application_v2(p_company_id,p_source_message_id,s.raw_payload,facts,application,response,functional),false) THEN RAISE EXCEPTION 'prodat_application_same_owner_required';END IF;
  application_hash:=encode(sha256(convert_to(p_application_facts_text,'UTF8')),'hex');
 END IF;
 IF p_object_facts_text IS NOT NULL THEN
  objects:=p_object_facts_text::jsonb;
  -- The physical register partition is the common join between the full-guide
  -- lineIndex, application register scopes and response segmentIndex. Different
  -- indexes or a negative sibling cannot borrow a positive facet. A separately
  -- authenticated customer source function never promotes full-guide evidence:
  -- its exact own application may stand independently of a global function hold.
  FOR own IN SELECT e FROM jsonb_array_elements(objects->'objects')e LOOP
   SELECT e INTO reg FROM jsonb_array_elements(facts#>'{registerValidation,objects}')e WHERE e->'objectId'=own->'objectId' AND e->'identityAgency'=own->'identityAgency' AND e->'messageReference'=own->'messageReference' AND e#>'{registers,0,lineIndex}'=own->'firstLineIndex';
   IF reg IS NULL THEN RAISE EXCEPTION 'prodat_v6_same_physical_partition_required';END IF;
   functional_own:=NULL;
   IF functional IS NOT NULL THEN
    SELECT e INTO functional_own FROM jsonb_array_elements(functional->'objects')e WHERE e-'functionalDecision'-'reasonCodes'=reg-'disposition'-'reasons';
    IF functional_own IS NULL THEN RAISE EXCEPTION 'prodat_v6_same_function_partition_required';END IF;
   END IF;
   IF application IS NOT NULL THEN
    SELECT e INTO app FROM jsonb_array_elements(application->'objects')e WHERE e-'applicationDecision'-'reasonCodes'=reg-'disposition'-'reasons';
    IF app IS NULL OR own->>'disposition'='accepted' AND app->>'applicationDecision' IS DISTINCT FROM 'accepted'
      OR own->>'disposition'='rejected' AND app->>'applicationDecision' IS DISTINCT FROM 'rejected'
      OR own->>'disposition'='unavailable' AND app->>'applicationDecision'='accepted' AND (functional_own->>'functionalDecision' IS DISTINCT FROM 'accepted' OR own->'reasons' IS DISTINCT FROM '["shared_source_not_qualified"]'::jsonb) THEN RAISE EXCEPTION 'prodat_v6_conflicting_own_application';END IF;
   END IF;
   IF response IS NOT NULL THEN
    SELECT e INTO planned FROM jsonb_array_elements(response->'objects')e WHERE e->'lineIndex'=reg#>'{registers,0,segmentIndex}';
    IF planned IS NULL OR planned->'id' IS DISTINCT FROM own->'objectId' OR nullif(planned->'li','null'::jsonb) IS DISTINCT FROM to_jsonb(nullif(own->>'lineItemReference',''))
     OR planned->>'outcome'='positive' AND ((own->>'disposition' IS DISTINCT FROM 'accepted' AND (functional_own->>'functionalDecision' IS DISTINCT FROM 'accepted' OR app->>'applicationDecision' IS DISTINCT FROM 'accepted' OR own->>'disposition' IS DISTINCT FROM 'unavailable' OR own->'reasons' IS DISTINCT FROM '["shared_source_not_qualified"]'::jsonb)) OR application IS NOT NULL AND app->>'applicationDecision' IS DISTINCT FROM 'accepted') THEN RAISE EXCEPTION 'prodat_v6_conflicting_own_response';END IF;
   END IF;
  END LOOP;
 END IF;
 -- This is the sole primary append. Existing full-object v3 invokes the prior
 -- canonical/ignored owner and inserts its own facet under this assessment.
 receipt:=gridex_received_sources.append_prodat_validation_v3(p_company_id,p_environment,p_source_message_id,p_source_payload_hash,p_facts_text,p_ignored_fields_text,p_object_facts_text);
 assessment:=(receipt->>'assessmentId')::uuid;
 IF receipt->>'companyId' IS DISTINCT FROM p_company_id::text OR receipt->>'environment' IS DISTINCT FROM p_environment OR receipt->>'sourceMessageId' IS DISTINCT FROM p_source_message_id::text OR receipt->>'sourcePayloadHash' IS DISTINCT FROM p_source_payload_hash OR receipt->>'factsHash' IS DISTINCT FROM encode(sha256(convert_to(p_facts_text,'UTF8')),'hex') OR receipt->>'objectFactsHash' IS DISTINCT FROM (CASE WHEN p_object_facts_text IS NULL THEN NULL ELSE encode(sha256(convert_to(p_object_facts_text,'UTF8')),'hex') END) THEN RAISE EXCEPTION 'prodat_v6_primary_receipt_required';END IF;
 IF response IS NOT NULL THEN
  IF EXISTS(SELECT FROM gridex_received_sources.prodat_response_facets prior WHERE prior.assessment_id=assessment AND(prior.response_facts_hash IS DISTINCT FROM response_hash OR prior.company_id IS DISTINCT FROM p_company_id OR prior.environment IS DISTINCT FROM p_environment OR prior.source_message_id IS DISTINCT FROM p_source_message_id OR prior.source_payload_hash IS DISTINCT FROM p_source_payload_hash)) THEN RAISE EXCEPTION 'prodat_v6_response_replay_conflict';END IF;
  INSERT INTO gridex_received_sources.prodat_response_facets VALUES(assessment,p_source_message_id,p_company_id,p_environment,p_source_payload_hash,p_response_facts_text,response_hash) ON CONFLICT DO NOTHING;
 END IF;
 IF application IS NOT NULL THEN
  IF EXISTS(SELECT FROM gridex_received_sources.prodat_application_facets prior WHERE prior.assessment_id=assessment AND(prior.application_facts_hash IS DISTINCT FROM application_hash OR prior.company_id IS DISTINCT FROM p_company_id OR prior.environment IS DISTINCT FROM p_environment OR prior.source_message_id IS DISTINCT FROM p_source_message_id OR prior.source_payload_hash IS DISTINCT FROM p_source_payload_hash)) THEN RAISE EXCEPTION 'prodat_v6_application_replay_conflict';END IF;
  INSERT INTO gridex_received_sources.prodat_application_facets VALUES(assessment,p_source_message_id,p_company_id,p_environment,p_source_payload_hash,p_application_facts_text,application_hash) ON CONFLICT DO NOTHING;
 END IF;
 IF functional IS NOT NULL THEN
  IF EXISTS(SELECT FROM gridex_received_sources.prodat_source_function_facets prior WHERE prior.assessment_id=assessment AND(prior.function_facts_hash IS DISTINCT FROM function_hash OR prior.company_id IS DISTINCT FROM p_company_id OR prior.environment IS DISTINCT FROM p_environment OR prior.source_message_id IS DISTINCT FROM p_source_message_id OR prior.source_payload_hash IS DISTINCT FROM p_source_payload_hash)) THEN RAISE EXCEPTION 'prodat_v6_source_function_replay_conflict';END IF;
  INSERT INTO gridex_received_sources.prodat_source_function_facets VALUES(assessment,p_source_message_id,p_company_id,p_environment,p_source_payload_hash,p_source_function_facts_text,function_hash) ON CONFLICT DO NOTHING;
 END IF;
 RETURN receipt||jsonb_build_object('version',6,'responseFactsHash',response_hash,'applicationFactsHash',application_hash,'sourceFunctionFactsHash',function_hash);
END$$;
CREATE FUNCTION public.gridex_record_prodat_source_validation_v6(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text,p_ignored_fields_text text,p_object_facts_text text,p_response_facts_text text,p_application_facts_text text,p_source_function_facts_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'received_evidence_service_required' USING ERRCODE='42501';END IF;
 RETURN gridex_received_sources.append_prodat_validation_v6(p_company_id,p_environment,p_source_message_id,p_source_payload_hash,p_facts_text,p_ignored_fields_text,p_object_facts_text,p_response_facts_text,p_application_facts_text,p_source_function_facts_text);
END$$;
REVOKE ALL ON FUNCTION gridex_received_sources.append_prodat_validation_v6(uuid,text,uuid,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_received_sources.append_prodat_validation_v6(uuid,text,uuid,text,text,text,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.gridex_record_prodat_source_validation_v6(uuid,text,uuid,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_record_prodat_source_validation_v6(uuid,text,uuid,text,text,text,text,text,text,text) TO service_role;
COMMIT;
