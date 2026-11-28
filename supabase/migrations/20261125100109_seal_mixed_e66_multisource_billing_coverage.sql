CREATE TABLE gridex_e66_intake.mixed_e73_billing_coverage (
  company_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment='test'),
  request_id uuid NOT NULL REFERENCES public.grid_owner_data_requests(id),
  evidence jsonb NOT NULL,
  evidence_sha256 text NOT NULL CHECK (evidence_sha256=encode(sha256(convert_to(evidence::text,'UTF8')),'hex')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (company_id,environment,request_id),
  CHECK ((evidence->>'requestId'=request_id::text AND evidence->>'environment'=environment) IS TRUE)
);
ALTER TABLE gridex_e66_intake.mixed_e73_billing_coverage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_e66_intake.mixed_e73_billing_coverage FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_e66_intake.guard_mixed_billing_coverage_immutable_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'mixed_billing_coverage_is_immutable' USING ERRCODE='55000';
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.guard_mixed_billing_coverage_immutable_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER mixed_e73_billing_coverage_immutable
BEFORE UPDATE OR DELETE OR TRUNCATE ON gridex_e66_intake.mixed_e73_billing_coverage
FOR EACH STATEMENT EXECUTE FUNCTION gridex_e66_intake.guard_mixed_billing_coverage_immutable_v1();

-- A receipt describes exact delivered data. The Stockholm billing owner has a
-- different source contract and remains solely responsible for underlay writes.
CREATE FUNCTION gridex_e66_intake.seal_mixed_billing_multisource_coverage_v1(
  p_company uuid,p_seed_source uuid,p_actor uuid
) RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE
  requested public.grid_owner_data_requests;
  proposed_request uuid;
  reference_basis jsonb;
  expected_range tstzrange;
  child record;
  current_basis jsonb;
  original_contract jsonb;
  child_members jsonb;
  members jsonb:='[]'::jsonb;
  verified_total numeric:=0;
  child_total numeric;
  child_count bigint;
  expected_child_count bigint;
  source_count integer;
  actual_range tstzmultirange;
  exact_seconds numeric;
  evidence jsonb;
  fingerprint text;
  prior text;
BEGIN
  PERFORM gridex_utilts_binding.lock_storage_graph_v1();
  IF current_setting('role',true) IS DISTINCT FROM 'service_role'
    OR public.gridex_actor_has_company_permission(p_actor,p_company,'metering.write') IS NOT TRUE
    OR public.gridex_actor_has_company_permission(p_actor,p_company,'billing_underlay.write') IS NOT TRUE
  THEN RETURN NULL; END IF;
  PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company,p_actor);

  SELECT (array_agg(DISTINCT b.request_id))[1] INTO proposed_request
  FROM gridex_e66_intake.mixed_e73_request_basis b
  WHERE (b.company_id,b.environment,b.source_id,b.actor_id)=(p_company,'test',p_seed_source,p_actor)
    AND b.evidence->>'requestScope'='billing_underlay'
  HAVING count(DISTINCT b.request_id)=1;
  IF proposed_request IS NULL OR EXISTS(
    SELECT FROM gridex_e66_intake.mixed_e73_request_basis b
    WHERE (b.company_id,b.environment,b.source_id,b.actor_id)=(p_company,'test',p_seed_source,p_actor)
      AND (b.request_id<>proposed_request OR b.evidence->>'requestScope' IS DISTINCT FROM 'billing_underlay')
  ) THEN RETURN NULL; END IF;
  SELECT q.* INTO requested FROM public.grid_owner_data_requests q
  WHERE (q.company_id,q.id,q.request_scope)=(p_company,proposed_request,'billing_underlay')
    AND q.status IN ('sent','received') AND q.customer_id IS NOT NULL AND q.site_id IS NOT NULL
  FOR NO KEY UPDATE;
  IF NOT FOUND OR EXISTS(SELECT FROM public.billing_underlays b
    WHERE (b.company_id,b.source_request_id)=(p_company,proposed_request))
  THEN RETURN NULL; END IF;
  expected_range:=gridex_utilts_binding.e73_sent_request_range_v1(p_company,proposed_request,'test');
  IF expected_range IS NULL THEN RETURN NULL; END IF;

  FOR child IN
    SELECT w.source_id,w.payload_sha256,t.transaction_id,t.series_id,b.evidence,b.evidence_sha256
    FROM gridex_e66_intake.work w
    JOIN gridex_e66_intake.mixed_qualification_receipts q ON q.source_id=w.source_id AND q.actor_id=p_actor
    JOIN gridex_e66_intake.mixed_accepted_transactions t ON t.source_id=w.source_id
    JOIN public.meter_reading_series series
      ON (series.company_id,series.id,series.source_ediel_message_id)=(w.company_id,t.series_id,w.source_id)
      AND series.is_current
    LEFT JOIN gridex_e66_intake.mixed_e73_request_basis b
      ON (b.source_id,b.transaction_id,b.company_id,b.environment,b.actor_id)
        =(t.source_id,t.transaction_id,w.company_id,w.environment,p_actor)
    WHERE (w.company_id,w.environment,w.phase)=(p_company,'test','mixed_qualified')
      AND EXISTS(SELECT FROM gridex_e66_intake.mixed_e73_request_basis seed
        WHERE (seed.company_id,seed.environment,seed.source_id,seed.actor_id,seed.request_id)
          =(p_company,'test',w.source_id,p_actor,proposed_request))
    ORDER BY w.source_id,t.transaction_id
  LOOP
    IF child.evidence IS NULL OR gridex_e66_intake.request_upgrade_state_v1(child.source_id)
      IS DISTINCT FROM 'hold_qualification_unverified' THEN RETURN NULL; END IF;
    current_basis:=gridex_e66_intake.read_mixed_e73_evidence_v1(
      p_company,'test',child.source_id,p_actor,child.transaction_id);
    IF current_basis IS NULL OR current_basis IS DISTINCT FROM child.evidence
      OR encode(sha256(convert_to(current_basis::text,'UTF8')),'hex') IS DISTINCT FROM child.evidence_sha256
      OR (current_basis->>'requestId',current_basis->>'requestScope',current_basis->>'sourceHash',
          (current_basis->>'requestedFrom')::timestamptz,(current_basis->>'requestedUntil')::timestamptz)
        IS DISTINCT FROM (proposed_request::text,'billing_underlay',child.payload_sha256,lower(expected_range),upper(expected_range))
    THEN RETURN NULL; END IF;
    IF reference_basis IS NULL THEN
      reference_basis:=current_basis;
    ELSIF (current_basis->>'sentSourceId',current_basis->>'sentHash',current_basis->>'sentAttemptId')
      IS DISTINCT FROM (reference_basis->>'sentSourceId',reference_basis->>'sentHash',reference_basis->>'sentAttemptId')
    THEN RETURN NULL; END IF;

    original_contract:=gridex_utilts_binding.stored_contract_v1(p_company,child.source_id,child.transaction_id);
    IF original_contract#>>'{billing,capability}' IS DISTINCT FROM 'skip'
      OR original_contract#>>'{billing,sourceRequestId}' IS NOT NULL
      OR encode(sha256(convert_to(original_contract::text,'UTF8')),'hex') IS DISTINCT FROM current_basis->>'contractHash'
    THEN RETURN NULL; END IF;

    SELECT count(*) INTO expected_child_count
    FROM jsonb_array_elements(original_contract->'observations') observation
    WHERE (observation->>'periodStart')::timestamptz>=lower(expected_range)
      AND (observation->>'periodEnd')::timestamptz<=upper(expected_range);
    SELECT jsonb_agg(jsonb_build_object(
      'sourceId',child.source_id,'sourceSha256',child.payload_sha256,'transactionId',child.transaction_id,
      'seriesId',child.series_id,'basisSha256',child.evidence_sha256,'contractSha256',current_basis->>'contractHash',
      'ordinal',(observation->>'ordinal')::int,'periodStart',(observation->>'periodStart')::timestamptz,
      'periodEnd',(observation->>'periodEnd')::timestamptz,'meteringId',effect->>'meteringId',
      'meteringHash',effect->>'meteringHash','normalizedId',effect->>'normalizedId',
      'normalizedHash',effect->>'normalizedHash','sourceLinkId',effect->>'sourceLinkId')
      ORDER BY (observation->>'ordinal')::int),
      sum((observation->>'quantity')::numeric),count(*)
    INTO child_members,child_total,child_count
    FROM jsonb_array_elements(original_contract->'observations') observation
    JOIN LATERAL jsonb_array_elements(current_basis->'childEffects') effect
      ON effect->>'ordinal'=observation->>'ordinal' AND effect->>'linkedSourceId'=child.source_id::text
    WHERE (observation->>'periodStart')::timestamptz>=lower(expected_range)
      AND (observation->>'periodEnd')::timestamptz<=upper(expected_range)
      AND (observation->>'periodStart')::timestamptz<(observation->>'periodEnd')::timestamptz
      AND (observation->>'quantity') IS NOT NULL;
    IF child_count=0 OR child_count<>expected_child_count OR child_total IS NULL THEN RETURN NULL; END IF;
    members:=members||child_members;
    verified_total:=verified_total+child_total;
  END LOOP;

  SELECT count(DISTINCT member->>'sourceId'),range_agg(tstzrange(starts_at,ends_at,'[)')),
    sum(extract(epoch FROM ends_at-starts_at))
  INTO source_count,actual_range,exact_seconds
  FROM jsonb_array_elements(members) member
  CROSS JOIN LATERAL (SELECT (member->>'periodStart')::timestamptz AS starts_at,
    (member->>'periodEnd')::timestamptz AS ends_at) period;
  IF source_count<2 OR actual_range IS DISTINCT FROM tstzmultirange(expected_range)
    OR exact_seconds IS DISTINCT FROM extract(epoch FROM upper(expected_range)-lower(expected_range))
  THEN RETURN NULL; END IF;

  evidence:=jsonb_build_object('version','mixed-e73-billing-coverage-v1','requestId',proposed_request,'environment','test',
    'sentSourceId',reference_basis->>'sentSourceId','sentSha256',reference_basis->>'sentHash',
    'sentAttemptId',reference_basis->>'sentAttemptId',
    'requestedFrom',lower(expected_range),'requestedUntil',upper(expected_range),'sourceCount',source_count,
    'contributionCount',jsonb_array_length(members),'totalKwh',verified_total,'members',members);
  fingerprint:=encode(sha256(convert_to(evidence::text,'UTF8')),'hex');
  SELECT c.evidence_sha256 INTO prior FROM gridex_e66_intake.mixed_e73_billing_coverage c
  WHERE (c.company_id,c.environment,c.request_id)=(p_company,'test',proposed_request);
  IF FOUND THEN
    RETURN CASE WHEN prior=fingerprint THEN prior END;
  END IF;
  INSERT INTO gridex_e66_intake.mixed_e73_billing_coverage(company_id,environment,request_id,evidence,evidence_sha256)
  VALUES(p_company,'test',proposed_request,evidence,fingerprint);
  RETURN fingerprint;
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.seal_mixed_billing_multisource_coverage_v1(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

DO $$
DECLARE
  owner regprocedure:='public.gridex_step_mixed_e66_worker_v1(uuid,text,uuid,uuid,text,uuid,text,uuid,uuid,jsonb)';
  definition text;
  body text;
  old_call text:=$old$    PERFORM gridex_e66_intake.consume_owned_utilts_billing_v1(p_company,p_source,p_actor,(
      SELECT jsonb_agg(gridex_utilts_binding.stored_contract_v1(p_company,p_source,t.transaction_id) ORDER BY t.transaction_id)
      FROM gridex_e66_intake.mixed_accepted_transactions t WHERE t.source_id=p_source
    ));$old$;
  new_call text:=$new$    IF (gridex_e66_intake.consume_owned_utilts_billing_v1(p_company,p_source,p_actor,(
      SELECT jsonb_agg(gridex_utilts_binding.stored_contract_v1(p_company,p_source,t.transaction_id) ORDER BY t.transaction_id)
      FROM gridex_e66_intake.mixed_accepted_transactions t WHERE t.source_id=p_source
    ))).id IS NULL THEN
      PERFORM gridex_e66_intake.seal_mixed_billing_multisource_coverage_v1(p_company,p_source,p_actor);
    END IF;$new$;
BEGIN
  SELECT pg_get_functiondef(owner),p.prosrc INTO STRICT definition,body FROM pg_proc p WHERE p.oid=owner;
  IF md5(body)<>'2f1801d2c7e6a7d4ed12a805fa928635' OR strpos(body,old_call)=0
  THEN RAISE EXCEPTION 'multisource_billing_coverage_worker_owner_changed'; END IF;
  EXECUTE replace(definition,body,replace(body,old_call,new_call));
END
$$;
