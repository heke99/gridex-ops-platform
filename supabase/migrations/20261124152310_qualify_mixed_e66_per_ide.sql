CREATE TABLE gridex_e66_intake.mixed_qualification_receipts (
  source_id uuid PRIMARY KEY REFERENCES gridex_e66_intake.work(source_id),
  assessment_id uuid NOT NULL REFERENCES gridex_received_sources.validation_assessments(id),
  actor_id uuid NOT NULL,
  lease_token uuid NOT NULL,
  command_hash text NOT NULL CHECK (command_hash ~ '^[0-9a-f]{64}$'),
  qualified_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE gridex_e66_intake.mixed_accepted_transactions (
  source_id uuid NOT NULL REFERENCES gridex_e66_intake.mixed_qualification_receipts(source_id),
  transaction_id text NOT NULL,
  transaction_index integer NOT NULL CHECK (transaction_index >= 0),
  series_id uuid NOT NULL REFERENCES gridex_utilts_binding.contracts(series_id),
  contract_hash text NOT NULL CHECK (contract_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (source_id, transaction_id),
  UNIQUE (source_id, transaction_index)
);

REVOKE ALL ON gridex_e66_intake.mixed_qualification_receipts,
  gridex_e66_intake.mixed_accepted_transactions FROM PUBLIC, anon, authenticated, service_role;

-- Private qualification contract. A later worker migration must own mixed_qualified
-- before a callable adapter may be installed.
CREATE FUNCTION gridex_e66_intake.commit_mixed_qualification_v1(
  p_company uuid, p_environment text, p_mailbox uuid, p_source uuid,
  p_actor uuid, p_lease uuid, p_assessment uuid, p_transactions jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $$
DECLARE
  w gridex_e66_intake.work;
  source public.ediel_messages;
  saved gridex_e66_intake.mixed_qualification_receipts;
  facet jsonb;
  basis jsonb;
  digest text;
  expected_membership jsonb;
  native_results jsonb;
  accepted_count integer;
  actual_count bigint;
BEGIN
  PERFORM gridex_utilts_binding.lock_storage_graph_v1();
  PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
  IF p_assessment IS NULL OR p_lease IS NULL OR jsonb_typeof(p_transactions) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_transactions) < 2 THEN
    RAISE EXCEPTION 'e66_mixed_qualification_input_required' USING ERRCODE='22023';
  END IF;
  digest := encode(sha256(convert_to(p_transactions::text,'UTF8')),'hex');
  SELECT * INTO w FROM gridex_e66_intake.work x
    WHERE (x.source_id,x.company_id,x.environment,x.mailbox_id)=(p_source,p_company,p_environment,p_mailbox)
    FOR UPDATE;
  IF w.source_id IS NULL THEN
    RAISE EXCEPTION 'e66_mixed_qualification_work_unavailable' USING ERRCODE='55000';
  END IF;
  SELECT * INTO saved FROM gridex_e66_intake.mixed_qualification_receipts r
    WHERE r.source_id=p_source;
  IF FOUND THEN
    IF (saved.actor_id,saved.lease_token,saved.assessment_id,saved.command_hash)
       IS DISTINCT FROM (p_actor,p_lease,p_assessment,digest)
       OR gridex_e66_intake.request_upgrade_state_v1(p_source)='hold_source_unverified' THEN
      RAISE EXCEPTION 'e66_mixed_qualification_replay_changed' USING ERRCODE='55000';
    END IF;
    RETURN jsonb_build_object('kind','mixed_qualified','sourceId',p_source,'replayed',true);
  END IF;

  w := gridex_e66_intake.require_registration_rejection_claim_v1(
    p_company,p_environment,p_mailbox,p_source,p_actor,p_lease);
  SELECT * INTO STRICT source FROM public.ediel_messages WHERE id=w.source_id;
  IF source.grid_owner_data_request_id IS NOT NULL
     OR gridex_e66_intake.request_upgrade_state_v1(p_source) IS DISTINCT FROM 'qualify_normally'
     OR EXISTS (SELECT FROM gridex_utilts_binding.receipts b WHERE b.source_message_id=p_source) THEN
    RAISE EXCEPTION 'e66_mixed_qualification_prior_or_matched_owner' USING ERRCODE='55000';
  END IF;

  basis := gridex_ediel_source_rules.require_v1(p_company,p_source);
  SELECT t.transaction_facts_text::jsonb->'transactions' INTO facet
  FROM gridex_received_sources.validation_assessments a
  JOIN gridex_received_sources.utilts_transaction_validations t ON t.assessment_id=a.id
    AND (t.source_message_id,t.company_id,t.environment,t.source_payload_hash)
      =(a.source_message_id,a.company_id,a.environment,a.source_payload_hash)
  WHERE (a.id,a.source_message_id,a.company_id,a.environment,a.source_payload_hash)
    =(p_assessment,p_source,p_company,p_environment,w.payload_sha256)
    AND a.facts_text::jsonb->>'syntaxDecision'='accepted'
    AND (a.facts_text::jsonb#>>'{rulePackEvidence,rulePackId}',
         a.facts_text::jsonb#>>'{rulePackEvidence,messageProfileId}',
         a.facts_text::jsonb#>>'{rulePackEvidence,version}',
         a.facts_text::jsonb#>>'{rulePackEvidence,sourceHash}')
      =(basis->>'rulePackId',basis->>'messageProfileId',basis->>'version',basis->>'sourceHash')
    AND NOT EXISTS (SELECT FROM gridex_received_sources.validation_assessments later
                    WHERE later.previous_assessment_id=a.id);
  IF jsonb_typeof(facet) IS DISTINCT FROM 'array'
     OR jsonb_array_length(facet) IS DISTINCT FROM jsonb_array_length(p_transactions)
     OR EXISTS (
      SELECT FROM jsonb_array_elements(p_transactions) WITH ORDINALITY AS tx(item,ord)
      CROSS JOIN LATERAL (SELECT facet->(tx.ord::integer-1) AS expected) checked
      WHERE nullif(item->>'transactionId','') IS NULL
        OR (item->>'transactionId',item->>'disposition',item->>'responseType')
          IS DISTINCT FROM (expected->>'transactionId',expected->>'disposition',expected->>'responseType')
        OR item->'issueCodes' IS DISTINCT FROM expected->'issueCodes'
        OR (expected->>'transactionIndex')::bigint IS DISTINCT FROM tx.ord-1
        OR item#>>'{consumptionContract,metering,sourceRequestId}' IS NOT NULL
        OR item#>>'{consumptionContract,billing,sourceRequestId}' IS NOT NULL
        OR item#>>'{consumptionContract,billing,capability}' IS DISTINCT FROM 'skip'
        OR (
          (item->>'disposition',item->>'responseType') IN (
              ('accepted','positive_aperak'),('guide_rejected','negative_aperak'),
              ('processability_rejected','utilts_err'))
          AND CASE WHEN item->>'disposition'='accepted' THEN
            item#>>'{consumptionContract,metering,capability}'='write'
              AND jsonb_array_length(item#>'{consumptionContract,observations}')>0
          ELSE item#>>'{consumptionContract,metering,capability}'='skip'
              AND item#>'{consumptionContract,observations}'='[]'::jsonb END
        ) IS NOT TRUE
     ) THEN
    RAISE EXCEPTION 'e66_mixed_qualification_evidence_mismatch' USING ERRCODE='55000';
  END IF;

  SELECT jsonb_agg(item->>'transactionId' ORDER BY ord),
         count(*) FILTER (WHERE item->>'disposition'='accepted')
    INTO expected_membership,accepted_count
    FROM jsonb_array_elements(p_transactions) WITH ORDINALITY AS tx(item,ord);
  IF accepted_count=0 OR (SELECT count(DISTINCT item->>'transactionId')
      FROM jsonb_array_elements(p_transactions) AS tx(item))<>jsonb_array_length(p_transactions) THEN
    RAISE EXCEPTION 'e66_mixed_qualification_membership_invalid' USING ERRCODE='22023';
  END IF;

  native_results := gridex_e66_intake.persist_owned_utilts_v1(
    p_company,p_environment,p_source,'E66',source.raw_payload,p_transactions,p_actor);
  IF jsonb_typeof(native_results) IS DISTINCT FROM 'array'
     OR jsonb_array_length(native_results) IS DISTINCT FROM jsonb_array_length(p_transactions)
     OR EXISTS (
       SELECT FROM jsonb_array_elements(p_transactions) WITH ORDINALITY AS tx(item,ord)
       CROSS JOIN LATERAL (SELECT native_results->(tx.ord::integer-1) AS result) checked
       WHERE (result->>'transactionId',result->>'disposition',result->>'responseType')
         IS DISTINCT FROM (item->>'transactionId',item->>'disposition',item->>'responseType')
         OR result->>'persistenceStatus' IS DISTINCT FROM
           CASE WHEN item->>'disposition'='accepted' THEN 'persisted' ELSE 'not_applicable' END
         OR result->>'versionState'='late_older_history')
     OR NOT EXISTS (SELECT FROM gridex_utilts_binding.receipts b
       WHERE (b.source_message_id,b.company_id,b.environment,b.raw_hash,b.membership)
         =(p_source,p_company,p_environment,w.payload_sha256,expected_membership)) THEN
    RAISE EXCEPTION 'e66_mixed_qualification_native_receipt_mismatch' USING ERRCODE='55000';
  END IF;

  SELECT count(*) INTO actual_count
  FROM jsonb_array_elements(p_transactions) AS tx(item)
  JOIN public.ediel_ack_transaction_results a
    ON (a.source_message_id,a.company_id,a.environment,a.source_transaction_id,a.disposition,a.planned_response_type)
      =(p_source,p_company,p_environment,item->>'transactionId',item->>'disposition',item->>'responseType')
  WHERE a.final_response_type IS NULL
    AND ((a.disposition='accepted' AND a.persistence_status='persisted' AND a.persisted_series_id IS NOT NULL)
      OR (a.disposition<>'accepted' AND a.persistence_status='not_applicable' AND a.persisted_series_id IS NULL));
  IF actual_count<>jsonb_array_length(p_transactions) OR w.lease_until<=clock_timestamp() THEN
    RAISE EXCEPTION 'e66_mixed_qualification_ledger_or_lease_mismatch' USING ERRCODE='55000';
  END IF;

  INSERT INTO gridex_e66_intake.mixed_qualification_receipts
    (source_id,assessment_id,actor_id,lease_token,command_hash)
  VALUES (p_source,p_assessment,p_actor,p_lease,digest);
  INSERT INTO gridex_e66_intake.mixed_accepted_transactions
    (source_id,transaction_id,transaction_index,series_id,contract_hash)
  SELECT p_source,a.source_transaction_id,tx.ord-1,c.series_id,c.contract_hash
  FROM jsonb_array_elements(p_transactions) WITH ORDINALITY AS tx(item,ord)
  JOIN public.ediel_ack_transaction_results a
    ON (a.source_message_id,a.company_id,a.environment,a.source_transaction_id)
      =(p_source,p_company,p_environment,item->>'transactionId')
  JOIN gridex_utilts_binding.contracts c ON
    (c.series_id,c.source_message_id,c.company_id,c.environment,c.transaction_id)
      =(a.persisted_series_id,p_source,p_company,p_environment,a.source_transaction_id)
  WHERE a.disposition='accepted';
  GET DIAGNOSTICS actual_count=ROW_COUNT;
  IF actual_count<>accepted_count THEN
    RAISE EXCEPTION 'e66_mixed_qualification_contract_mismatch' USING ERRCODE='55000';
  END IF;
  UPDATE gridex_e66_intake.work SET phase='mixed_qualified',lease_actor=NULL,lease_token=NULL,lease_until=NULL
    WHERE source_id=p_source;
  RETURN jsonb_build_object('kind','mixed_qualified','sourceId',p_source,'replayed',false);
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.commit_mixed_qualification_v1(
  uuid,text,uuid,uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE gridex_e66_intake.mixed_prelinked_holds (
  source_id uuid PRIMARY KEY REFERENCES gridex_e66_intake.work(source_id),
  request_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  source_sha256 text NOT NULL,
  held_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON gridex_e66_intake.mixed_prelinked_holds FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_e66_intake.hold_prelinked_mixed_v1(
  p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid,p_assessment uuid
) RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog AS $$
DECLARE
  w gridex_e66_intake.work;
  saved_request uuid;
BEGIN
  PERFORM gridex_utilts_binding.lock_storage_graph_v1();
  w:=gridex_e66_intake.require_registration_rejection_claim_v1(
    p_company,p_environment,p_mailbox,p_source,p_actor,p_lease);
  SELECT m.grid_owner_data_request_id INTO saved_request FROM public.ediel_messages m
    WHERE (m.id,m.company_id,m.environment)=(w.source_id,w.company_id,w.environment) FOR SHARE;
  IF saved_request IS NULL OR gridex_e66_intake.request_upgrade_state_v1(p_source) IS DISTINCT FROM 'qualify_normally'
    OR NOT EXISTS (
      SELECT FROM gridex_received_sources.validation_assessments a
      JOIN gridex_received_sources.utilts_transaction_validations t
        ON (t.assessment_id,t.company_id,t.environment,t.source_message_id,t.source_payload_hash)
          =(a.id,a.company_id,a.environment,a.source_message_id,a.source_payload_hash)
      WHERE (a.id,a.company_id,a.environment,a.source_message_id,a.source_payload_hash)
        =(p_assessment,p_company,p_environment,p_source,w.payload_sha256)
        AND jsonb_array_length(t.transaction_facts_text::jsonb->'transactions')>1
        AND NOT EXISTS (SELECT FROM gridex_received_sources.validation_assessments later
                        WHERE later.previous_assessment_id=a.id)
    )
  THEN RAISE EXCEPTION 'e66_prelinked_mixed_evidence_missing' USING ERRCODE='55000'; END IF;
  INSERT INTO gridex_e66_intake.mixed_prelinked_holds(source_id,request_id,assessment_id,actor_id,source_sha256)
    VALUES(p_source,saved_request,p_assessment,p_actor,w.payload_sha256);
  UPDATE gridex_e66_intake.work SET phase='mixed_prelinked_review',lease_actor=NULL,lease_token=NULL,lease_until=NULL
    WHERE source_id=p_source;
  RETURN jsonb_build_object('kind','mixed_prelinked_review','sourceId',p_source,'replayed',false);
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.hold_prelinked_mixed_v1(uuid,text,uuid,uuid,uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

-- Dedicated mixed owners preserve the original and OBS2 qualification endpoint.
CREATE FUNCTION gridex_e66_intake.require_supported_mixed_source_v1(
  p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid
) RETURNS void LANGUAGE plpgsql SET search_path TO pg_catalog AS $$
BEGIN
  IF p_environment IS DISTINCT FROM 'test' THEN
    RAISE EXCEPTION 'mixed_qualification_environment_unavailable' USING ERRCODE='22023';
  END IF;
  PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
  IF EXISTS (
    SELECT FROM public.ediel_messages m
    WHERE (m.id,m.company_id,m.environment)=(p_source,p_company,p_environment)
      AND gridex_e66_intake.sg11_forbidden_timestamp_v1(m.raw_payload) IS NOT NULL
  ) THEN RAISE EXCEPTION 'e66_mixed_worker_requires_sg11_review' USING ERRCODE='55000'; END IF;
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.require_supported_mixed_source_v1(uuid,text,uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.gridex_commit_mixed_e66_qualification_v1(
  p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid,
  p_assessment uuid,p_transactions jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
BEGIN
  PERFORM gridex_e66_intake.require_supported_mixed_source_v1(p_company,p_environment,p_mailbox,p_source,p_actor);
  RETURN gridex_e66_intake.commit_mixed_qualification_v1(
    p_company,p_environment,p_mailbox,p_source,p_actor,p_lease,p_assessment,p_transactions);
END
$$;
REVOKE ALL ON FUNCTION public.gridex_commit_mixed_e66_qualification_v1(uuid,text,uuid,uuid,uuid,uuid,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_commit_mixed_e66_qualification_v1(uuid,text,uuid,uuid,uuid,uuid,uuid,jsonb)
  TO service_role;

CREATE FUNCTION public.gridex_hold_prelinked_mixed_e66_v1(
  p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid,p_assessment uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
BEGIN
  PERFORM gridex_e66_intake.require_supported_mixed_source_v1(p_company,p_environment,p_mailbox,p_source,p_actor);
  RETURN gridex_e66_intake.hold_prelinked_mixed_v1(
    p_company,p_environment,p_mailbox,p_source,p_actor,p_lease,p_assessment);
END
$$;
REVOKE ALL ON FUNCTION public.gridex_hold_prelinked_mixed_e66_v1(uuid,text,uuid,uuid,uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_hold_prelinked_mixed_e66_v1(uuid,text,uuid,uuid,uuid,uuid,uuid)
  TO service_role;
