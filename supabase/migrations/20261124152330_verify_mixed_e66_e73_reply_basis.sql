-- Private correlation observation. Overlap cannot attribute or close an E73 request.
CREATE FUNCTION gridex_e66_intake.read_mixed_e73_evidence_v1(
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
    AND NOT EXISTS (SELECT FROM gridex_e66_intake.mixed_accepted_transactions sibling
                    WHERE sibling.source_id=t.source_id AND sibling.transaction_id<>t.transaction_id)
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
REVOKE ALL ON FUNCTION gridex_e66_intake.read_mixed_e73_evidence_v1(uuid,text,uuid,uuid,text)
 FROM PUBLIC,anon,authenticated,service_role;

-- One append-only basis per accepted IDE. The row has no dispatch or request-state authority.
CREATE TABLE gridex_e66_intake.mixed_e73_request_basis (
  source_id uuid NOT NULL,
  transaction_id text NOT NULL,
  company_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  actor_id uuid NOT NULL,
  request_id uuid NOT NULL REFERENCES public.grid_owner_data_requests(id),
  sent_source_id uuid NOT NULL REFERENCES public.ediel_messages(id),
  evidence jsonb NOT NULL CHECK (
    (evidence->>'requestId'=request_id::text AND evidence->>'sentSourceId'=sent_source_id::text
    AND evidence->>'transactionId'=transaction_id AND evidence->>'status'='correlated_unattributed') IS TRUE
  ),
  evidence_sha256 text NOT NULL CHECK (evidence_sha256=encode(sha256(convert_to(evidence::text,'UTF8')),'hex')),
  PRIMARY KEY (source_id,transaction_id),
  FOREIGN KEY (source_id,transaction_id)
    REFERENCES gridex_e66_metering_stage.mixed_normalization_receipts(source_id,transaction_id)
);
REVOKE ALL ON gridex_e66_intake.mixed_e73_request_basis FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_e66_intake.reject_mixed_e73_basis_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'mixed_e73_basis_is_immutable' USING ERRCODE='55000';
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.reject_mixed_e73_basis_mutation()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER mixed_e73_basis_is_immutable
BEFORE UPDATE OR DELETE OR TRUNCATE ON gridex_e66_intake.mixed_e73_request_basis
FOR EACH STATEMENT EXECUTE FUNCTION gridex_e66_intake.reject_mixed_e73_basis_mutation();

CREATE FUNCTION gridex_e66_intake.seal_mixed_e73_request_basis_v1(
  p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_transaction text
) RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog AS $$
DECLARE
  existing gridex_e66_intake.mixed_e73_request_basis;
  evidence jsonb;
  evidence_sha256 text;
BEGIN
  PERFORM gridex_utilts_binding.lock_storage_graph_v1();
  PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
  PERFORM 1 FROM gridex_e66_intake.work w
    WHERE (w.source_id,w.company_id,w.environment,w.mailbox_id)=(p_source,p_company,p_environment,p_mailbox)
      AND w.phase='mixed_qualified' AND w.lease_token IS NULL
      AND gridex_e66_intake.request_upgrade_state_v1(p_source)='hold_qualification_unverified'
      AND NOT EXISTS (SELECT FROM gridex_e66_intake.matched_request_basis s WHERE s.source_id=w.source_id)
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mixed_e73_basis_work_unavailable' USING ERRCODE='55000'; END IF;

  evidence:=gridex_e66_intake.read_mixed_e73_evidence_v1(p_company,p_environment,p_source,p_actor,p_transaction);
  IF evidence IS NULL THEN RAISE EXCEPTION 'mixed_e73_basis_evidence_unavailable' USING ERRCODE='55000'; END IF;
  evidence_sha256:=encode(sha256(convert_to(evidence::text,'UTF8')),'hex');
  SELECT b.* INTO existing FROM gridex_e66_intake.mixed_e73_request_basis b
    WHERE (b.source_id,b.transaction_id)=(p_source,p_transaction);
  IF FOUND THEN
    IF (existing.company_id,existing.environment,existing.actor_id,existing.evidence_sha256,existing.evidence)
       IS DISTINCT FROM (p_company,p_environment,p_actor,evidence_sha256,evidence)
    THEN RAISE EXCEPTION 'mixed_e73_basis_replay_changed' USING ERRCODE='55000'; END IF;
    RETURN jsonb_build_object('status','basis_recorded','requestId',existing.request_id,
      'transactionId',p_transaction,'evidenceSha256',evidence_sha256,'replayed',true);
  END IF;

  INSERT INTO gridex_e66_intake.mixed_e73_request_basis
    (source_id,transaction_id,company_id,environment,actor_id,request_id,sent_source_id,evidence,evidence_sha256)
  VALUES (p_source,p_transaction,p_company,p_environment,p_actor,
    (evidence->>'requestId')::uuid,(evidence->>'sentSourceId')::uuid,evidence,evidence_sha256);
  RETURN jsonb_build_object('status','basis_recorded','requestId',evidence->>'requestId',
    'transactionId',p_transaction,'evidenceSha256',evidence_sha256,'replayed',false);
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.seal_mixed_e73_request_basis_v1(uuid,text,uuid,uuid,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;

-- Observes candidate coverage. It never posts coverage or advances a request.
CREATE FUNCTION gridex_e66_intake.read_mixed_e73_coverage_v1(
  p_company uuid,p_environment text,p_request uuid,p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO pg_catalog SET TimeZone TO 'UTC' AS $$
DECLARE
  sent_range tstzrange;
  protected_coverage tstzmultirange;
  mixed_coverage tstzmultirange;
  combined_coverage tstzmultirange;
  current_basis_count bigint;
  unavailable_basis_count bigint;
  gaps jsonb;
  protected_seconds numeric;
  mixed_seconds numeric;
  combined_seconds numeric;
BEGIN
  IF (p_environment IN ('test','production')) IS NOT TRUE OR p_company IS NULL OR p_request IS NULL THEN
    RAISE EXCEPTION 'mixed_e73_coverage_invalid_scope' USING ERRCODE='22023';
  END IF;
  IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'mixed_e73_coverage_forbidden' USING ERRCODE='42501';
  END IF;
  PERFORM gridex_utilts_binding.lock_storage_graph_v1();
  IF public.gridex_actor_has_company_permission(p_actor,p_company,'metering.write') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'mixed_e73_coverage_forbidden' USING ERRCODE='42501';
  END IF;
  PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company,p_actor);
  sent_range:=gridex_utilts_binding.e73_sent_request_range_v1(p_company,p_request,p_environment);
  IF sent_range IS NULL THEN RETURN NULL; END IF;
  protected_coverage:=gridex_utilts_binding.e66_protected_request_coverage_v1(
    p_company,p_request,p_environment,sent_range);

  WITH revalidated AS MATERIALIZED (
    SELECT b.evidence,b.evidence_sha256,
      gridex_e66_intake.read_mixed_e73_evidence_v1(
        b.company_id,b.environment,b.source_id,b.actor_id,b.transaction_id) AS current_evidence
    FROM gridex_e66_intake.mixed_e73_request_basis b
    WHERE (b.company_id,b.environment,b.request_id,b.actor_id)=(p_company,p_environment,p_request,p_actor)
  ), verified AS MATERIALIZED (
    SELECT evidence,coalesce(
      current_evidence=evidence AND evidence_sha256=encode(sha256(convert_to(current_evidence::text,'UTF8')),'hex')
      AND (current_evidence->>'requestedFrom')::timestamptz=lower(sent_range)
      AND (current_evidence->>'requestedUntil')::timestamptz=upper(sent_range),false) AS valid
    FROM revalidated
  )
  SELECT count(*) FILTER (WHERE valid),count(*) FILTER (WHERE NOT valid),
    coalesce((SELECT range_agg(piece * sent_range)
      FROM verified v CROSS JOIN LATERAL unnest((v.evidence->>'observedOverlap')::tstzmultirange) AS ranges(piece)
      WHERE v.valid),'{}'::tstzmultirange)
  INTO current_basis_count,unavailable_basis_count,mixed_coverage
  FROM verified;

  combined_coverage:=protected_coverage + mixed_coverage;
  SELECT coalesce(jsonb_agg(jsonb_build_object('from',lower(piece),'until',upper(piece))
    ORDER BY lower(piece)),'[]'::jsonb) INTO gaps
  FROM unnest(tstzmultirange(sent_range)-combined_coverage) AS remaining(piece);
  SELECT coalesce(sum(extract(epoch FROM upper(piece)-lower(piece))),0) INTO protected_seconds
  FROM unnest(protected_coverage) AS coverage(piece);
  SELECT coalesce(sum(extract(epoch FROM upper(piece)-lower(piece))),0) INTO mixed_seconds
  FROM unnest(mixed_coverage) AS coverage(piece);
  SELECT coalesce(sum(extract(epoch FROM upper(piece)-lower(piece))),0) INTO combined_seconds
  FROM unnest(combined_coverage) AS coverage(piece);

  RETURN jsonb_build_object('requestId',p_request,'environment',p_environment,
    'requestedFrom',lower(sent_range),'requestedUntil',upper(sent_range),
    'ordinaryProtectedCoveredSeconds',protected_seconds,'mixedObservedCoveredSeconds',mixed_seconds,
    'combinedObservedCoveredSeconds',combined_seconds,'combinedObservedRemainingGaps',gaps,
    'combinedObservedComplete',jsonb_array_length(gaps)=0,
    'currentBasisCount',current_basis_count,'unavailableBasisCount',unavailable_basis_count);
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.read_mixed_e73_coverage_v1(uuid,text,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

-- Diagnostic only: a result is never a draft claim or permission to transmit.
CREATE FUNCTION gridex_e66_intake.read_mixed_ack_evidence_v1(
  p_company uuid, p_environment text, p_source uuid
) RETURNS TABLE (
  transaction_index bigint, transaction_id text, response_type text,
  evidence_status text
)
LANGUAGE sql STABLE SET search_path TO 'pg_catalog'
AS $$
  SELECT member.ordinality - 1, member.id, row.planned_response_type::text,
    CASE
      WHEN row.response_message_id IS NOT NULL OR row.final_response_type IS NOT NULL
        OR row.finalized_at IS NOT NULL THEN 'existing_response'
      WHEN row.disposition='accepted' AND row.planned_response_type='positive_aperak'
        AND row.persistence_status='persisted' AND child.series_id IS NOT NULL
        THEN 'awaiting_child_readiness'
      WHEN row.disposition='processability_rejected' AND row.planned_response_type='utilts_err'
        AND row.persistence_status='not_applicable' AND row.persisted_series_id IS NULL
        AND EXISTS (
          SELECT FROM gridex_received_sources.utilts_functional_validations evidence
          CROSS JOIN LATERAL jsonb_array_elements(evidence.functional_facts_text::jsonb->'transactions') item
          WHERE (evidence.assessment_id,evidence.source_message_id,evidence.company_id,
                 evidence.environment,evidence.source_payload_hash)
              =(assessment.id,w.source_id,w.company_id,w.environment,w.payload_sha256)
            AND item->>'transactionId'=member.id
            AND item->>'transactionIndex'=(member.ordinality - 1)::text
            AND jsonb_array_length(item->'errors')>0
            AND NOT EXISTS (
              SELECT FROM jsonb_array_elements(item->'errors') error
              WHERE (error->>'referenceQualifier',error->>'referenceNumber')
                    IS DISTINCT FROM ('TN',member.id)
                OR nullif(error->>'code','') IS NULL)
        ) THEN 'recorded_transaction_error'
      ELSE 'review_required'
    END
  FROM gridex_e66_intake.work w
  JOIN gridex_e66_intake.mixed_qualification_receipts receipt ON receipt.source_id=w.source_id
  JOIN gridex_received_sources.validation_assessments assessment
    ON (assessment.id,assessment.source_message_id,assessment.company_id,
        assessment.environment,assessment.source_payload_hash)
      =(receipt.assessment_id,w.source_id,w.company_id,w.environment,w.payload_sha256)
  JOIN gridex_received_sources.utilts_transaction_validations facet
    ON (facet.assessment_id,facet.source_message_id,facet.company_id,
        facet.environment,facet.source_payload_hash)
      =(assessment.id,w.source_id,w.company_id,w.environment,w.payload_sha256)
  JOIN gridex_utilts_binding.receipts binding
    ON (binding.source_message_id,binding.company_id,binding.environment,binding.raw_hash)
      =(w.source_id,w.company_id,w.environment,w.payload_sha256)
    AND binding.message_code='E66'
  CROSS JOIN LATERAL jsonb_array_elements_text(binding.membership) WITH ORDINALITY AS member(id,ordinality)
  JOIN public.ediel_ack_transaction_results row
    ON (row.source_message_id,row.company_id,row.environment,row.source_transaction_id)
      =(w.source_id,w.company_id,w.environment,member.id)
  LEFT JOIN gridex_e66_intake.mixed_accepted_transactions child
    ON (child.source_id,child.transaction_id,child.transaction_index,child.series_id)
      =(w.source_id,member.id,member.ordinality-1,row.persisted_series_id)
  WHERE (w.source_id,w.company_id,w.environment)=(p_source,p_company,p_environment)
    AND w.phase='mixed_qualified'
    AND NOT EXISTS (
      SELECT FROM gridex_received_sources.validation_assessments later
      WHERE later.previous_assessment_id=assessment.id)
    AND (facet.transaction_facts_text::jsonb #>> ARRAY['transactions',(member.ordinality-1)::text,'transactionId'],
         facet.transaction_facts_text::jsonb #>> ARRAY['transactions',(member.ordinality-1)::text,'disposition'],
         facet.transaction_facts_text::jsonb #>> ARRAY['transactions',(member.ordinality-1)::text,'responseType'])
        =(member.id,row.disposition::text,row.planned_response_type::text)
  ORDER BY member.ordinality
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.read_mixed_ack_evidence_v1(uuid,text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Readiness evidence only. Creation, reservation and dispatch of a reply remain with their owners.
CREATE FUNCTION gridex_e66_intake.read_mixed_e73_ide_readiness_v1(
  p_company uuid,p_environment text,p_source uuid,p_actor uuid,p_transaction text
) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO pg_catalog AS $$
DECLARE
  response_evidence record;
  basis gridex_e66_intake.mixed_e73_request_basis;
  current_evidence jsonb;
  coverage jsonb;
  contract jsonb;
  result jsonb;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'mixed_e73_readiness_forbidden' USING ERRCODE='42501';
  END IF;
  PERFORM gridex_utilts_binding.lock_storage_graph_v1();
  PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company,p_actor);
  IF public.gridex_actor_has_company_permission(p_actor,p_company,'metering.write') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'mixed_e73_readiness_forbidden' USING ERRCODE='42501';
  END IF;

  SELECT a.* INTO response_evidence
  FROM gridex_e66_intake.read_mixed_ack_evidence_v1(p_company,p_environment,p_source) a
  JOIN gridex_e66_intake.mixed_qualification_receipts q ON q.source_id=p_source AND q.actor_id=p_actor
  WHERE a.transaction_id=p_transaction;
  IF NOT FOUND THEN RETURN NULL; END IF;
  result:=jsonb_build_object('transactionId',p_transaction,'transactionIndex',response_evidence.transaction_index,
    'responseType',response_evidence.response_type,'dispatchAuthorized',false);
  IF response_evidence.evidence_status='existing_response' THEN
    RETURN result || jsonb_build_object('status','hold_existing_response');
  ELSIF response_evidence.evidence_status IS DISTINCT FROM 'awaiting_child_readiness' THEN
    RETURN result || jsonb_build_object('status','hold_positive_reply_evidence_unavailable');
  END IF;

  SELECT b.* INTO basis FROM gridex_e66_intake.mixed_e73_request_basis b
  WHERE (b.source_id,b.transaction_id,b.company_id,b.environment,b.actor_id)
    =(p_source,p_transaction,p_company,p_environment,p_actor);
  IF NOT FOUND THEN RETURN result || jsonb_build_object('status','hold_basis_unavailable'); END IF;

  current_evidence:=gridex_e66_intake.read_mixed_e73_evidence_v1(p_company,p_environment,p_source,p_actor,p_transaction);
  IF current_evidence IS DISTINCT FROM basis.evidence
    OR basis.evidence_sha256 IS DISTINCT FROM encode(sha256(convert_to(current_evidence::text,'UTF8')),'hex')
  THEN RETURN result || jsonb_build_object('status','hold_basis_stale'); END IF;

  BEGIN
    contract:=gridex_utilts_binding.stored_contract_v1(p_company,p_source,p_transaction);
  EXCEPTION WHEN SQLSTATE 'P0U01' THEN
    RETURN result || jsonb_build_object('status','hold_positive_reply_evidence_unavailable');
  END;
  IF encode(sha256(convert_to(contract::text,'UTF8')),'hex') IS DISTINCT FROM current_evidence->>'contractHash'
  THEN RETURN result || jsonb_build_object('status','hold_positive_reply_evidence_unavailable'); END IF;

  coverage:=gridex_e66_intake.read_mixed_e73_coverage_v1(p_company,p_environment,basis.request_id,p_actor);
  result:=result || jsonb_build_object('requestId',basis.request_id,'basisSha256',basis.evidence_sha256,'sourceSha256',current_evidence->>'sourceHash');
  IF (coverage->>'combinedObservedComplete')::boolean IS DISTINCT FROM true THEN
    RETURN result || jsonb_build_object('status','hold_partial_coverage');
  END IF;
  IF (current_evidence->>'requestScope',contract#>>'{billing,capability}',contract#>>'{billing,reason}')
     IS DISTINCT FROM ('meter_values','skip','billing_not_applicable')
    OR contract#>>'{billing,sourceRequestId}' IS NOT NULL
  THEN RETURN result || jsonb_build_object('status','hold_billing_evidence'); END IF;

  RETURN result || jsonb_build_object('status','ready_for_reply_evaluation');
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.read_mixed_e73_ide_readiness_v1(uuid,text,uuid,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;

-- Isolated work lease. The canonical ACK ledger continues to own any response.
CREATE TABLE gridex_e66_intake.mixed_e73_draft_preconditions (
  source_id uuid NOT NULL,
  transaction_id text NOT NULL,
  actor_id uuid NOT NULL,
  basis_sha256 text NOT NULL CHECK (basis_sha256 ~ '^[0-9a-f]{64}$'),
  lease_token uuid NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
  PRIMARY KEY (source_id,transaction_id),
  FOREIGN KEY (source_id,transaction_id)
    REFERENCES gridex_e66_intake.mixed_e73_request_basis(source_id,transaction_id)
);
REVOKE ALL ON gridex_e66_intake.mixed_e73_draft_preconditions
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_e66_intake.mixed_e73_draft_precondition_v1(
  p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,
  p_transaction text,p_operation text,p_token uuid
) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO pg_catalog SET TimeZone TO 'UTC' AS $$
DECLARE
  ready jsonb;
  lease gridex_e66_intake.mixed_e73_draft_preconditions;
  now_at timestamptz;
  result text;
  changed boolean;
BEGIN
  IF (p_operation IN ('claim','validate')) IS NOT TRUE
    OR (p_operation='validate') IS DISTINCT FROM (p_token IS NOT NULL)
    OR nullif(p_transaction,'') IS NULL
  THEN RAISE EXCEPTION 'mixed_e73_draft_invalid_command' USING ERRCODE='22023'; END IF;
  PERFORM gridex_utilts_binding.lock_storage_graph_v1();
  PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
  PERFORM 1 FROM gridex_e66_intake.work w
    WHERE (w.source_id,w.company_id,w.environment,w.mailbox_id)
        =(p_source,p_company,p_environment,p_mailbox)
      AND w.phase='mixed_qualified' AND w.lease_token IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','held','reason','missing_mixed_work'); END IF;

  ready:=gridex_e66_intake.read_mixed_e73_ide_readiness_v1(
    p_company,p_environment,p_source,p_actor,p_transaction);
  IF ready->>'status' IS DISTINCT FROM 'ready_for_reply_evaluation'
    OR ready->>'responseType' IS DISTINCT FROM 'positive_aperak'
  THEN RETURN jsonb_build_object('status','held','reason',coalesce(ready->>'status','readiness_unavailable')); END IF;

  SELECT d.* INTO lease FROM gridex_e66_intake.mixed_e73_draft_preconditions d
    WHERE (d.source_id,d.transaction_id)=(p_source,p_transaction) FOR UPDATE;
  now_at:=clock_timestamp();
  IF p_operation='validate' THEN
    IF (lease.actor_id,lease.basis_sha256,lease.lease_token)
      IS DISTINCT FROM (p_actor,ready->>'basisSha256',p_token)
      OR (lease.expires_at>now_at) IS NOT TRUE
    THEN RETURN jsonb_build_object('status','held','reason','precondition_token_unavailable'); END IF;
    result:='valid';
    changed:=false;
  ELSIF lease.expires_at>now_at THEN
    IF (lease.actor_id,lease.basis_sha256) IS DISTINCT FROM (p_actor,ready->>'basisSha256') THEN
      RETURN jsonb_build_object('status','held','reason','precondition_basis_conflict');
    END IF;
    result:='claimed';
    changed:=false;
  ELSE
    INSERT INTO gridex_e66_intake.mixed_e73_draft_preconditions AS d
      (source_id,transaction_id,actor_id,basis_sha256,lease_token,expires_at)
    VALUES (p_source,p_transaction,p_actor,ready->>'basisSha256',gen_random_uuid(),now_at+interval '60 seconds')
    ON CONFLICT (source_id,transaction_id) DO UPDATE SET
      actor_id=excluded.actor_id,basis_sha256=excluded.basis_sha256,
      lease_token=excluded.lease_token,expires_at=excluded.expires_at
    RETURNING d.* INTO lease;
    result:='claimed';
    changed:=true;
  END IF;
  RETURN jsonb_build_object('status',result,'changed',changed,'basisSha256',lease.basis_sha256,
    'leaseToken',lease.lease_token,'expiresAt',lease.expires_at,
    'sourceId',p_source,'sourceSha256',ready->>'sourceSha256','transactionId',p_transaction,
    'transactionIndex',ready->'transactionIndex',
    'draftAuthorized',false,'dispatchAuthorized',false);
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.mixed_e73_draft_precondition_v1(uuid,text,uuid,uuid,uuid,text,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
