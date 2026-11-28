DO $preimage$
BEGIN
  IF (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p
      WHERE p.oid='gridex_e66_intake.read_mixed_e73_evidence_v1(uuid,text,uuid,uuid,text)'::regprocedure)
     IS DISTINCT FROM '29ec094f4130c4bad168be45cbde5b8692da596c798e5f3b7188e615cd488051'
  THEN RAISE EXCEPTION 'mixed_e73_ide_evidence_preimage_changed'; END IF;
END
$preimage$;

-- The single original E73 header reference remains required. Compute evidence for the selected IDE only.
CREATE OR REPLACE FUNCTION gridex_e66_intake.read_mixed_e73_evidence_v1(
  p_company uuid, p_environment text, p_source uuid, p_actor uuid, p_transaction text
) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO pg_catalog SET TimeZone TO 'UTC' AS $$
DECLARE
  source_payload text;
  source_sender text;
  source_receiver text;
  child_contract jsonb;
  child_effects jsonb;
  reference text;
  candidates uuid[];
  sent_sources uuid[];
  child_contract_hash text;
  request public.grid_owner_data_requests;
  sent_range tstzrange;
  overlap tstzmultirange;
  validated_effects jsonb;
  inbound_hash text;
  inbound_assessment uuid;
  qualification_hash text;
  outbound public.ediel_messages;
  outbound_owner jsonb;
  outbound_acceptance jsonb;
  transaction_index integer;
BEGIN
  WITH child AS (
    SELECT assessment_id, actor_id, command_hash FROM gridex_e66_intake.mixed_qualification_receipts
    WHERE source_id=p_source AND actor_id=p_actor
  )
  SELECT m.raw_payload,m.sender_ediel_id,m.receiver_ediel_id,c.contract,n.ordered_effects,c.contract_hash,
         w.payload_sha256,child.assessment_id,child.command_hash,t.transaction_index
    INTO source_payload,source_sender,source_receiver,child_contract,child_effects,child_contract_hash,
         inbound_hash,inbound_assessment,qualification_hash,transaction_index
  FROM gridex_e66_intake.work w
  JOIN child ON true
  JOIN gridex_e66_intake.mixed_accepted_transactions t ON t.source_id=w.source_id
  JOIN gridex_e66_metering_stage.mixed_normalization_receipts n
    ON (n.source_id,n.transaction_id,n.contract_hash,n.actor_id)
      =(t.source_id,t.transaction_id,t.contract_hash,child.actor_id)
  JOIN gridex_utilts_binding.contracts c
    ON (c.source_message_id,c.company_id,c.environment,c.transaction_id,c.series_id,c.contract_hash)
      =(t.source_id,w.company_id,w.environment,t.transaction_id,t.series_id,t.contract_hash)
  JOIN public.ediel_messages m ON (m.id,m.company_id,m.environment)=(w.source_id,w.company_id,w.environment)
  JOIN gridex_utilts_binding.receipts b
    ON (b.source_message_id,b.company_id,b.environment,b.raw_hash)
      =(w.source_id,w.company_id,w.environment,w.payload_sha256)
    AND b.message_code='E66' AND b.membership->>t.transaction_index=t.transaction_id
  JOIN public.ediel_ack_transaction_results a
    ON (a.source_message_id,a.company_id,a.environment,a.source_transaction_id,a.persisted_series_id)
      =(w.source_id,w.company_id,w.environment,t.transaction_id,t.series_id)
    AND a.disposition='accepted' AND a.persistence_status='persisted'
    AND a.planned_response_type='positive_aperak'
    AND (a.final_response_type IS NULL OR a.final_response_type='positive_aperak')
  JOIN public.meter_reading_series series
    ON (series.company_id,series.id,series.source_ediel_message_id)
      =(w.company_id,t.series_id,w.source_id) AND series.is_current
  WHERE (w.source_id,w.company_id,w.environment,t.transaction_id)=(p_source,p_company,p_environment,p_transaction)
    AND w.phase='mixed_qualified' AND m.grid_owner_data_request_id IS NULL
    AND w.payload_sha256=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
    AND c.contract_hash=encode(sha256(convert_to(c.contract::text,'UTF8')),'hex')
    AND c.contract#>>'{metering,sourceRequestId}' IS NULL
    AND NOT EXISTS (SELECT FROM gridex_received_sources.validation_assessments a
                    WHERE a.previous_assessment_id=child.assessment_id)
  FOR SHARE OF m;
  IF NOT FOUND THEN RETURN NULL; END IF;

  WITH segments AS MATERIALIZED (
    SELECT segment,ordinal FROM jsonb_array_elements(gridex_utilts_binding.wire_tokens_v1(source_payload))
      WITH ORDINALITY AS wire(segment,ordinal)
  )
  SELECT min(segment#>>'{elements,1,1}') INTO reference
  FROM segments WHERE segment->>'tag'='RFF' AND segment#>>'{elements,1,0}'='ACW'
    AND ordinal<(SELECT min(ordinal) FROM segments WHERE segment->>'tag'='IDE')
  HAVING count(*)=1 AND EXISTS (
    SELECT FROM segments h WHERE h.segment->>'tag'='UNB'
      AND (h.segment#>>'{elements,2,0}',h.segment#>>'{elements,3,0}')=(source_sender,source_receiver)
  );
  IF nullif(reference,'') IS NULL THEN RETURN NULL; END IF;

  candidates:=public.gridex_match_e66_to_sent_e73_reference_v1(p_company,p_environment,p_actor,reference);
  IF cardinality(candidates) IS DISTINCT FROM 1 THEN RETURN NULL; END IF;
  sent_sources:=gridex_utilts_binding.e73_request_candidate_ids_v1(p_company,candidates[1],p_environment);
  sent_range:=gridex_utilts_binding.e73_sent_request_range_v1(p_company,candidates[1],p_environment);
  IF sent_range IS NULL OR cardinality(sent_sources) IS DISTINCT FROM 1
    OR sent_sources IS DISTINCT FROM gridex_utilts_binding.e73_request_candidate_ids_v1(p_company,candidates[1],p_environment)
    OR candidates IS DISTINCT FROM public.gridex_match_e66_to_sent_e73_reference_v1(
      p_company,p_environment,p_actor,reference)
  THEN RETURN NULL; END IF;
  SELECT q.* INTO request FROM public.grid_owner_data_requests q
  WHERE (q.company_id,q.id)=(p_company,candidates[1]) AND q.status IN ('sent','received')
    AND q.metering_point_id::text=child_contract#>>'{metering,meteringPointId}'
    AND q.customer_id::text IS NOT DISTINCT FROM child_contract#>>'{metering,customerId}'
    AND q.site_id::text IS NOT DISTINCT FROM child_contract#>>'{metering,siteId}'
    AND q.grid_owner_id::text=child_contract#>>'{metering,gridOwnerId}'
  FOR SHARE OF q;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT m.* INTO outbound FROM public.ediel_messages m WHERE m.id=sent_sources[1]
    AND (m.sender_ediel_id,m.receiver_ediel_id)=(source_receiver,source_sender);
  IF NOT FOUND THEN RETURN NULL; END IF;
  outbound_owner:=gridex_ediel_outbound_owner.require_v1(p_company,outbound.id);
  outbound_acceptance:=gridex_ediel_transport.accepted_source_basis_v1(outbound);
  IF outbound_owner IS NULL OR outbound_acceptance IS NULL THEN RETURN NULL; END IF;

  WITH effects AS MATERIALIZED (
    SELECT e || jsonb_build_object('meteringHash',encode(r.value_hash,'hex'),
      'normalizedHash',encode(r.normalized_hash,'hex'),'sourceLinkId',r.source_link_id,
      'normalizedOriginSourceId',nv.source_message_id,'linkedSourceId',l.source_ediel_message_id) AS effect,
      tstzrange(v.period_start,v.period_end,'[)') AS period
  FROM jsonb_array_elements(child_effects) WITH ORDINALITY AS sealed(e, ordinality)
  JOIN gridex_utilts_binding.metering_application_receipts r
    ON (r.source_message_id,r.company_id,r.environment,r.transaction_id,r.observation_ordinal,r.value_id::text,r.normalized_id::text)
      =(p_source,p_company,p_environment,p_transaction,(e->>'ordinal')::integer,e->>'meteringId',e->>'normalizedId')
  JOIN public.metering_values v ON (v.company_id,v.id)=(r.company_id,r.value_id)
  JOIN public.metering_value_sources l
    ON (l.company_id,l.id,l.source_ediel_message_id,l.source_transaction_reference,l.metering_value_id,l.normalized_metering_value_id)
      =(r.company_id,r.source_link_id,p_source,p_transaction,r.value_id,r.normalized_id)
    AND l.source_type='ediel_utilts'
  JOIN public.normalized_metering_values nv
    ON (nv.company_id,nv.id,nv.source_metering_value_id)=(r.company_id,r.normalized_id,r.value_id)
  WHERE ordinality=(e->>'ordinal')::integer+1
    AND gridex_e66_metering_stage.current_mixed_application_v1(
      p_company,p_environment,p_source,p_transaction,r.observation_ordinal,r.value_id,child_contract
    )=r.normalized_id
    AND v.source_request_id IS NULL AND v.metering_point_id=request.metering_point_id
    AND v.customer_id IS NOT DISTINCT FROM request.customer_id
    AND v.source_system='ediel_utilts' AND v.reading_type='consumption' AND v.direction='consumption'
    AND isfinite(v.period_start) AND isfinite(v.period_end) AND v.period_start<v.period_end
  ORDER BY (e->>'ordinal')::integer
  FOR SHARE OF v, nv, l, r
  )
  SELECT range_agg(sent_range * period),jsonb_agg(effect ORDER BY (effect->>'ordinal')::integer)
    INTO overlap,validated_effects FROM effects
  HAVING count(*)=jsonb_array_length(child_effects);
  IF overlap IS NULL OR isempty(overlap) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('status','correlated_unattributed','transactionId',p_transaction,
    'requestId',request.id,'requestScope',request.request_scope,'requestedFrom',lower(sent_range),'requestedUntil',upper(sent_range),
    'observedOverlap',overlap,'transactionIndex',transaction_index,
    'assessmentId',inbound_assessment,'sourceHash',inbound_hash,'qualificationHash',qualification_hash,
    'contractHash',child_contract_hash,'reference',reference,'sentSourceId',outbound.id,
    'sentHash',outbound.immutable_payload_hash,'sentRulePackId',outbound_owner->>'rulePackId',
    'sentMessageProfileId',outbound_owner->>'messageProfileId','sentGuideVersion',outbound_owner->>'version',
    'sentRuleSourceHash',outbound_owner->>'sourceHash','sentAttemptId',outbound_acceptance->>'attemptId',
    'sentAttemptLane',outbound_acceptance->>'lane','childEffects',validated_effects);
END
$$;
