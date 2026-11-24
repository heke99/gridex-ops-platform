-- Close an E73 request only once protected current E66 slices fill its accepted wire period.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $e66_coverage_migration$
DECLARE
  expected record;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('public.gridex_sync_current_e66_request_v1(uuid,uuid,uuid,uuid,uuid[],jsonb)','866855a2e4a51412f89a898a37d628c1d565a4224e5195d29cedacf0ecc5839c'),
    ('gridex_e66_request_retry.attempt(gridex_e66_request_retry.commands,boolean)','8f16c3bd9d7b4326aa621ea3abfac0c87c1eb47908159b442efeb1a3b6bbe8c9'),
    ('public.gridex_discover_e66_terminal_handoff_v1(uuid,text,uuid,uuid)','51732e78ab79ed39b3e02bbed05b9b68608a82794718663a3d95e4057248cd4e'),
    ('public.gridex_claim_e66_terminal_handoff_v1(uuid,text,uuid,uuid)','4c085598c4b699dbc81d04cb9ec506bceef404a93a084b4fabed5d17e71504b7'),
    ('gridex_e66_request_retry.require_terminal_lease(uuid,text,uuid,uuid,uuid,uuid)','fdb85bcdb255d31a1230dec0c553cd0372aa22b33a34cafae9445f4e8d170895'),
    ('public.gridex_drain_sealed_e66_request_v1(uuid,text,uuid,uuid)','cca39cd886d534316bfe55f8ab98d64f9db18b9f61c7dfce6b7ea9b9de4895ef'),
    ('gridex_e66_intake.matched_request_ack_eligible_v1(uuid)','49fa240ce81ecb44b1f600c2b65c8ed3dbde0642e24a78c87bcb041ce76de4c4'),
    ('public.gridex_read_e66_request_response_history_v1(uuid,uuid,text,integer)','f5019c2bcaa1e4f290f8fbf705865b77acf8701c7f3e01b459dabc763ccf085b')
  ) AS pins(signature, sha256)
  LOOP
    IF (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p
        WHERE p.oid=to_regprocedure(expected.signature)) IS DISTINCT FROM expected.sha256
    THEN RAISE EXCEPTION 'e66_coverage_predecessor_changed: %',expected.signature USING ERRCODE='55000'; END IF;
  END LOOP;

CREATE FUNCTION gridex_utilts_binding.e66_protected_request_coverage_v1(
  p_company_id uuid,p_request_id uuid,p_environment text,p_sent_range tstzrange
) RETURNS tstzmultirange
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog
AS $protection$
  SELECT coalesce(range_agg(p_sent_range * tstzrange(v.period_start,v.period_end,'[)')),'{}'::tstzmultirange)
  FROM public.grid_owner_data_requests q
  JOIN public.metering_values v ON (v.company_id,v.source_request_id,v.metering_point_id)=(q.company_id,q.id,q.metering_point_id)
    AND v.customer_id IS NOT DISTINCT FROM q.customer_id
  JOIN public.ediel_messages s ON (s.company_id,s.id,s.environment,s.grid_owner_data_request_id)=(v.company_id,v.source_ediel_message_id,p_environment,q.id)
    AND s.direction='inbound' AND s.message_standard='edifact' AND s.message_family='UTILTS' AND s.message_code='E66'
    AND s.metering_point_id=q.metering_point_id AND s.customer_id IS NOT DISTINCT FROM q.customer_id
    AND s.site_id IS NOT DISTINCT FROM q.site_id
  JOIN gridex_utilts_binding.metering_application_receipts r
    ON (r.company_id,r.environment,r.source_message_id,r.value_id,r.transaction_id)=(v.company_id,p_environment,s.id,v.id,v.source_transaction_reference)
  JOIN public.metering_value_sources l
    ON (l.id,l.company_id,l.source_ediel_message_id,l.metering_value_id,l.normalized_metering_value_id,l.source_transaction_reference)
      =(r.source_link_id,r.company_id,s.id,v.id,r.normalized_id,r.transaction_id) AND l.source_type='ediel_utilts'
  JOIN public.normalized_metering_values n ON (n.company_id,n.id,n.source_metering_value_id)=(v.company_id,r.normalized_id,v.id)
    AND n.revision_status='current'
    AND r.value_hash=gridex_utilts_binding.application_value_hash_v1(v)
    AND r.normalized_hash=gridex_utilts_binding.application_normalized_hash_v1(n)
  JOIN public.ediel_ack_transaction_results a ON (a.company_id,a.source_message_id,a.environment,a.source_transaction_id)
      =(r.company_id,s.id,p_environment,r.transaction_id)
    AND a.disposition='accepted' AND a.persistence_status='persisted'
    AND a.planned_response_type='positive_aperak' AND (a.final_response_type IS NULL OR a.final_response_type='positive_aperak')
  JOIN public.meter_reading_series h ON (h.company_id,h.id,h.source_ediel_message_id)=(a.company_id,a.persisted_series_id,s.id)
    AND h.is_current
  JOIN gridex_utilts_binding.contracts c ON (c.company_id,c.series_id,c.environment,c.source_message_id,c.transaction_id)
      =(h.company_id,h.id,p_environment,s.id,r.transaction_id)
    AND decode(c.contract_hash,'hex')=r.contract_hash
    AND c.contract#>>'{metering,capability}'='write'
    AND c.contract#>>'{metering,sourceRequestId}'=q.id::text
    AND c.contract#>>'{metering,customerId}'=q.customer_id::text
    AND (c.contract#>>'{metering,siteId}') IS NOT DISTINCT FROM q.site_id::text
    AND c.contract#>>'{metering,meteringPointId}'=q.metering_point_id::text
  WHERE (q.company_id,q.id)=(p_company_id,p_request_id) AND q.request_scope IN ('meter_values','billing_underlay')
    AND v.is_current AND v.revision_status='current' AND v.source_system='ediel_utilts'
    AND v.reading_type='consumption' AND v.direction='consumption'
    AND isfinite(v.period_start) AND isfinite(v.period_end) AND v.period_start<v.period_end
    AND v.period_end>lower(p_sent_range) AND v.period_start<upper(p_sent_range)
$protection$;
REVOKE ALL ON FUNCTION gridex_utilts_binding.e66_protected_request_coverage_v1(uuid,uuid,text,tstzrange)
FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.gridex_sync_current_e66_request_v1(
  p_company_id uuid,
  p_request_id uuid,
  p_actor_id uuid,
  p_source_message_id uuid,
  p_meter_value_ids uuid[],
  p_response_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  source public.ediel_messages%ROWTYPE;
  owner_request public.grid_owner_data_requests%ROWTYPE;
  outbound public.outbound_requests%ROWTYPE;
  billing_id uuid;
  outbound_context jsonb := jsonb_build_object('outboundRequestId',NULL);
  presented uuid;
  bound_rows integer;
  current_rows integer;
  qualified_current_rows integer;
  history jsonb;
  sent_range tstzrange;
  covered tstzmultirange;
  remaining tstzmultirange;
  protected_coverage jsonb;
  complete boolean := false;
  partner_first timestamptz;
  partner_latest timestamptz;
  latest_source uuid;
  previous_lock_timeout text;
  next_request_status text;
  request_received_at timestamptz;
  next_partner_response_at timestamptz;
  latest_response jsonb;
  request_reference text;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' OR p_company_id IS NULL OR p_request_id IS NULL
    OR p_actor_id IS NULL OR p_source_message_id IS NULL THEN
    RAISE EXCEPTION 'e66_current_request_service_scope_required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_response_patch) IS DISTINCT FROM 'object'
    OR p_response_patch->>'edielMessageId' IS DISTINCT FROM p_source_message_id::text
    OR NOT coalesce(cardinality(p_meter_value_ids) > 0, false)
    OR EXISTS (SELECT FROM unnest(p_meter_value_ids) AS input(id) WHERE id IS NULL)
    OR cardinality(p_meter_value_ids) <> (SELECT count(DISTINCT id) FROM unnest(p_meter_value_ids) AS input(id)) THEN
    RAISE EXCEPTION 'e66_current_request_input_invalid' USING ERRCODE = '22023';
  END IF;
  presented := (p_response_patch->>'ingestedMeterValueId')::uuid;
  IF NOT coalesce(presented = ANY(p_meter_value_ids), false)
    OR jsonb_typeof(p_response_patch->'ingestedMeterValueIds') IS DISTINCT FROM 'array'
    OR p_response_patch->'ingestedMeterValueIds' IS DISTINCT FROM to_jsonb(p_meter_value_ids) THEN
    RAISE EXCEPTION 'e66_current_request_observation_payload_mismatch' USING ERRCODE = '22023';
  END IF;

  -- The original writer takes the storage graph before source and attribution.
  PERFORM gridex_utilts_binding.lock_storage_graph_v1();
  SELECT * INTO source FROM public.ediel_messages e
  WHERE e.company_id = p_company_id AND e.id = p_source_message_id
    AND e.direction = 'inbound' AND e.message_family = 'UTILTS' AND e.message_code = 'E66'
    AND e.grid_owner_data_request_id = p_request_id
  FOR SHARE NOWAIT;
  IF NOT FOUND OR public.gridex_actor_has_company_permission(p_actor_id,p_company_id,'communication.send') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'e66_current_request_bound_actor_required' USING ERRCODE = '42501';
  END IF;
  PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company_id,p_actor_id);
  IF gridex_e66_intake.request_upgrade_state_v1(p_source_message_id) NOT IN ('outside','matched_basis','unmatched')
  THEN RAISE EXCEPTION 'e66_existing_work_held_for_qualified_reply' USING ERRCODE='55000'; END IF;
  -- Keep the ordinary outbound-before-request order when both exist.
  SELECT * INTO outbound FROM public.outbound_requests o
  WHERE o.company_id = p_company_id AND o.source_type = 'grid_owner_data_request'
    AND o.source_id = p_request_id AND o.request_type IN ('meter_values','billing_underlay')
    AND o.customer_id = source.customer_id AND o.site_id IS NOT DISTINCT FROM source.site_id
    AND o.metering_point_id IS NOT DISTINCT FROM source.metering_point_id
    AND o.status IN ('queued','prepared','sent','acknowledged')
    AND (o.payload->>'environment' = source.environment
      OR (o.payload->>'environment' IS NULL AND o.id = source.outbound_request_id))
  ORDER BY (o.id = source.outbound_request_id) DESC NULLS LAST,
    (o.request_type = 'meter_values') DESC, o.created_at DESC, o.id DESC
  LIMIT 1 FOR UPDATE NOWAIT;
  SELECT * INTO owner_request FROM public.grid_owner_data_requests r
  WHERE r.id = p_request_id AND r.company_id = p_company_id
    AND r.customer_id = source.customer_id
    AND r.site_id IS NOT DISTINCT FROM source.site_id
    AND r.metering_point_id IS NOT DISTINCT FROM source.metering_point_id
  FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'e66_current_request_source_ownership_required' USING ERRCODE = '42501';
  END IF;
  IF owner_request.status = 'cancelled' THEN RETURN jsonb_build_object('status','cancelled'); END IF;

  PERFORM m.id FROM public.metering_values m
    WHERE m.company_id = p_company_id AND m.id = ANY(p_meter_value_ids)
    ORDER BY m.id FOR SHARE NOWAIT;

  PERFORM n.id FROM public.normalized_metering_values n
    JOIN gridex_utilts_binding.metering_application_receipts r ON r.normalized_id = n.id
    WHERE n.company_id = p_company_id AND r.company_id = n.company_id
      AND r.source_message_id = source.id AND r.value_id = ANY(p_meter_value_ids)
    ORDER BY n.id FOR SHARE OF n NOWAIT;

  SELECT count(DISTINCT m.id) FILTER (WHERE m.id = ANY(p_meter_value_ids)),
    count(DISTINCT m.id) FILTER (WHERE m.id = ANY(p_meter_value_ids)
      AND m.is_current AND m.revision_status = 'current'
      AND n.revision_status = 'current' AND h.is_current),
    count(DISTINCT m.id) FILTER (WHERE m.is_current AND m.revision_status = 'current'
      AND n.revision_status = 'current' AND h.is_current)
  INTO bound_rows,current_rows,qualified_current_rows
  FROM public.metering_values m
  JOIN gridex_utilts_binding.metering_application_receipts r ON r.value_id = m.id
   AND r.company_id = m.company_id AND r.source_message_id = source.id AND r.environment = source.environment
  JOIN public.metering_value_sources x ON x.id = r.source_link_id AND x.company_id = r.company_id
   AND x.metering_value_id = m.id AND x.source_ediel_message_id = source.id
   AND x.normalized_metering_value_id = r.normalized_id AND x.source_transaction_reference = r.transaction_id
  JOIN public.normalized_metering_values n ON n.company_id = m.company_id AND n.id = r.normalized_id
   AND n.source_metering_value_id = m.id
  JOIN public.ediel_ack_transaction_results a ON a.company_id = m.company_id
   AND a.source_message_id = source.id AND a.source_transaction_id = r.transaction_id AND a.environment = source.environment
  JOIN public.meter_reading_series h ON h.id = a.persisted_series_id AND h.company_id = m.company_id
  JOIN gridex_utilts_binding.contracts c ON c.series_id = h.id AND c.company_id = m.company_id
    AND c.source_message_id = source.id AND c.transaction_id = r.transaction_id AND c.environment = source.environment
    AND decode(c.contract_hash,'hex') = r.contract_hash
  WHERE m.company_id = p_company_id
    AND m.source_request_id = p_request_id AND m.metering_point_id = owner_request.metering_point_id
    AND a.disposition = 'accepted' AND a.persistence_status = 'persisted';
  IF bound_rows <> cardinality(p_meter_value_ids) THEN
    RAISE EXCEPTION 'e66_current_request_exact_receipt_required' USING ERRCODE = '23514';
  END IF;
  IF current_rows <> bound_rows THEN RETURN jsonb_build_object('status','replaced'); END IF;
  IF qualified_current_rows <> current_rows THEN
    RAISE EXCEPTION 'e66_current_request_receipt_set_changed' USING ERRCODE = '23514';
  END IF;

  -- Under the storage-graph lock, the persisted canonical contract is the
  -- producer's expected ordinal set; application receipts are its completion.
  IF EXISTS (
    SELECT
    FROM public.ediel_ack_transaction_results a
    JOIN public.meter_reading_series h ON h.id=a.persisted_series_id AND h.company_id=a.company_id
      AND h.source_ediel_message_id=source.id AND h.is_current
    JOIN gridex_utilts_binding.contracts c ON c.series_id=h.id AND c.company_id=a.company_id
      AND c.environment=a.environment AND c.source_message_id=a.source_message_id
      AND c.transaction_id=a.source_transaction_id
    CROSS JOIN LATERAL jsonb_array_elements(c.contract->'observations') WITH ORDINALITY AS expected(obs,slot)
    WHERE a.company_id=p_company_id AND a.source_message_id=source.id AND a.environment=source.environment
      AND a.disposition='accepted' AND a.persistence_status='persisted'
      AND a.planned_response_type='positive_aperak'
      AND (a.final_response_type IS NULL OR a.final_response_type='positive_aperak')
      AND c.contract#>>'{metering,capability}'='write'
      AND c.contract#>>'{metering,sourceRequestId}'=p_request_id::text
      AND c.contract#>>'{metering,customerId}'=owner_request.customer_id::text
      AND (c.contract#>>'{metering,siteId}') IS NOT DISTINCT FROM owner_request.site_id::text
      AND c.contract#>>'{metering,meteringPointId}'=owner_request.metering_point_id::text
      AND NOT EXISTS (
        SELECT FROM gridex_utilts_binding.metering_application_receipts r
        WHERE r.company_id=c.company_id AND r.environment=c.environment AND r.source_message_id=c.source_message_id
          AND r.transaction_id=c.transaction_id AND r.observation_ordinal=expected.slot-1
          AND r.contract_hash=decode(c.contract_hash,'hex') AND r.value_id=ANY(p_meter_value_ids)
      )
  ) THEN
    RAISE EXCEPTION 'e66_current_request_complete_receipt_set_required' USING ERRCODE = '23514';
  END IF;

  billing_id := (p_response_patch->>'billingUnderlayId')::uuid;
  IF billing_id IS NOT NULL THEN
    PERFORM 1 FROM public.billing_underlays b
    WHERE b.id = billing_id AND b.company_id = p_company_id AND b.source_request_id = p_request_id
      AND b.customer_id = owner_request.customer_id AND b.metering_point_id = owner_request.metering_point_id
      AND b.source_system = 'ediel_utilts' AND b.payload->>'edielMessageId' = source.id::text
    FOR SHARE NOWAIT;
    IF NOT FOUND THEN RAISE EXCEPTION 'e66_current_request_underlay_scope_invalid' USING ERRCODE = '23514'; END IF;
  END IF;

  PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company_id,p_actor_id);
  IF public.gridex_actor_has_company_permission(p_actor_id,p_company_id,'communication.send') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'e66_current_request_bound_actor_required' USING ERRCODE = '42501';
  END IF;
  previous_lock_timeout := current_setting('lock_timeout');
  PERFORM set_config('lock_timeout','250ms',true);
  BEGIN
    history := public.gridex_read_e66_request_response_history_v1(p_company_id,p_request_id,source.environment,500);
  EXCEPTION WHEN SQLSTATE '54000' THEN
    IF SQLERRM IS DISTINCT FROM 'e66_request_history_capacity' THEN RAISE; END IF;
    -- The response-list cap must not prevent complete metering coverage.
    sent_range := gridex_utilts_binding.e73_sent_request_range_v1(p_company_id,p_request_id,source.environment);
    IF sent_range IS NOT NULL THEN
      covered := gridex_utilts_binding.e66_protected_request_coverage_v1(
        p_company_id,p_request_id,source.environment,sent_range);
      remaining := tstzmultirange(sent_range)-covered;
      protected_coverage := jsonb_build_object(
        'requestedFrom',lower(sent_range),'requestedUntil',upper(sent_range),
        'coveredSeconds',(SELECT coalesce(sum(extract(epoch FROM upper(period)-lower(period))),0) FROM unnest(covered) period),
        'remainingSeconds',(SELECT coalesce(sum(extract(epoch FROM upper(period)-lower(period))),0) FROM unnest(remaining) period),
        'remainingGapCount',(SELECT count(*) FROM unnest(remaining))
      );
    END IF;
  END;
  PERFORM set_config('lock_timeout',previous_lock_timeout,true);
  IF jsonb_typeof(history->'coverage')='object' THEN
    protected_coverage := history->'coverage';
  END IF;
  complete := coalesce((protected_coverage->>'remainingSeconds')::numeric=0,false);
  partner_first := (history->>'firstObservedAt')::timestamptz;
  partner_latest := (history->>'latestObservedAt')::timestamptz;
  IF history IS NULL THEN
    partner_first := (owner_request.response_payload->>'firstVerifiedResponseAt')::timestamptz;
    partner_latest := (owner_request.response_payload->>'lastVerifiedResponseAt')::timestamptz;
  ELSE
    SELECT (reply.value->>'sourceMessageId')::uuid INTO latest_source
    FROM jsonb_array_elements(history->'responses') AS reply(value)
    WHERE reply.value->>'observedAt' IS NOT NULL
    ORDER BY (reply.value->>'observedAt')::timestamptz DESC, reply.value->>'sourceMessageId' DESC
    LIMIT 1;
  END IF;
  request_reference := coalesce(owner_request.external_reference,outbound.external_reference);

  IF outbound.id IS NOT NULL THEN
    IF outbound.status <> 'acknowledged' THEN
      UPDATE public.outbound_requests SET
        status = 'acknowledged', failure_reason = NULL,
        response_payload = coalesce(outbound.response_payload,'{}'::jsonb) || jsonb_build_object(
          'edielMessageId',source.id,'acknowledgedVia','inbound_utilts',
          'normalizedMeteringPayload',p_response_patch->'normalizedMeteringPayload'),
        acknowledged_at = coalesce(outbound.acknowledged_at,partner_first), updated_by = p_actor_id
      WHERE id = outbound.id RETURNING * INTO outbound;
      INSERT INTO public.outbound_dispatch_events
        (company_id,outbound_request_id,event_type,event_status,message,payload,created_by)
      VALUES (p_company_id,outbound.id,'acknowledged','acknowledged','Outbound request uppdaterad till acknowledged.',
        jsonb_build_object('externalReference',outbound.external_reference),p_actor_id);
    END IF;
    outbound_context := jsonb_build_object(
      'outboundRequestId',outbound.id,'outboundStatus',outbound.status,'outboundChannelType',outbound.channel_type,
      'communicationRouteId',outbound.communication_route_id,'acknowledgedVia','inbound_utilts','failureReason',NULL);
  END IF;

  latest_response := coalesce(owner_request.response_payload,'{}'::jsonb);
  -- Processing order must not replace the chronologically newer source.
  IF latest_source = source.id OR NOT latest_response ? 'edielMessageId' THEN
    latest_response := latest_response || p_response_patch;
  END IF;
  next_request_status := CASE WHEN complete THEN 'received' ELSE owner_request.status END;
  request_received_at := CASE WHEN complete THEN coalesce(partner_first,owner_request.received_at)
                              ELSE owner_request.received_at END;
  next_partner_response_at := coalesce(partner_latest,owner_request.last_partner_response_at);
  latest_response := latest_response || outbound_context || jsonb_build_object(
    'externalReference',request_reference,'firstVerifiedResponseAt',partner_first,'lastVerifiedResponseAt',partner_latest,
    'verifiedCoverage',protected_coverage,'e66CoverageState',
      CASE WHEN complete THEN 'complete' WHEN protected_coverage IS NULL THEN 'unverified' ELSE 'partial' END);
  IF complete AND owner_request.status IS DISTINCT FROM 'received' THEN
    latest_response := latest_response || jsonb_build_object('completedBySourceId',source.id);
  END IF;
  IF owner_request.status IS DISTINCT FROM next_request_status
    OR owner_request.response_payload IS DISTINCT FROM latest_response
    OR owner_request.external_reference IS DISTINCT FROM request_reference
    OR owner_request.received_at IS DISTINCT FROM request_received_at
    OR owner_request.last_partner_response_at IS DISTINCT FROM next_partner_response_at THEN
    UPDATE public.grid_owner_data_requests SET
      status = next_request_status, external_reference = request_reference,
      response_payload = latest_response, received_at = request_received_at,
      last_partner_response_at = next_partner_response_at,
      failure_reason = CASE WHEN complete THEN NULL ELSE owner_request.failure_reason END,
      updated_by = p_actor_id
    WHERE id = owner_request.id AND company_id = owner_request.company_id;
  END IF;
  RETURN jsonb_build_object('status',CASE WHEN complete THEN 'received' ELSE 'partial' END,
    'outboundRequestId',outbound.id,'e66SourceScopeVersion',1);
END
$function$;


CREATE OR REPLACE FUNCTION gridex_e66_request_retry.attempt(
  cmd gridex_e66_request_retry.commands, resumed boolean
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE result jsonb; body jsonb; scope_held boolean := false;
BEGIN
  -- Match the direct writer's storage-graph-before-source order. Lock both
  -- inputs before recomputing the body; do not wait behind a writer that
  -- already owns either row. Keep these row locks until CAS commit.
  BEGIN
    PERFORM gridex_utilts_binding.lock_storage_graph_v1();
    PERFORM s.id FROM public.ediel_messages s
      WHERE s.id=cmd.source_id AND s.company_id=cmd.company_id AND s.environment=cmd.environment
      FOR SHARE NOWAIT;
    PERFORM p.id
      FROM gridex_ediel_inbound_receptions.receptions r
      JOIN public.inbound_ediel_parse_results p ON p.id=r.parse_result_id
      WHERE r.id=cmd.reception_id AND r.company_id=cmd.company_id AND r.source_message_id=cmd.source_id
      FOR SHARE OF p NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    UPDATE gridex_e66_request_retry.commands
    SET attempts=attempts+1,last_attempt_at=clock_timestamp()
    WHERE source_id=cmd.source_id;
    RETURN jsonb_build_object('status','deferred','sourceId',cmd.source_id);
  END;

  SELECT cmd.response_patch || jsonb_build_object('parsedPayload',s.parsed_payload) INTO body
  FROM public.ediel_messages s WHERE s.id = cmd.source_id AND s.company_id = cmd.company_id;
  IF cmd.reception_id IS DISTINCT FROM gridex_e66_request_retry.bound_reception(
    cmd.company_id,cmd.environment,cmd.mailbox_id,cmd.source_id,cmd.request_id
  ) OR cmd.response_digest IS DISTINCT FROM sha256(convert_to(body::text,'UTF8')) THEN
    IF NOT resumed THEN
      RAISE EXCEPTION 'e66_request_retry_reception_required' USING ERRCODE = '23514';
    END IF;
    result := jsonb_build_object('status','held','reason','reception_changed');
  ELSE
    BEGIN
      result := public.gridex_sync_current_e66_request_v1(
        cmd.company_id,cmd.request_id,cmd.actor_id,cmd.source_id,cmd.meter_ids,body
      );
    EXCEPTION WHEN lock_not_available THEN
      UPDATE gridex_e66_request_retry.commands
      SET attempts = attempts + 1, last_attempt_at = clock_timestamp()
      WHERE source_id = cmd.source_id;
      RETURN jsonb_build_object('status','deferred','sourceId',cmd.source_id);
    WHEN check_violation THEN
      -- A deferred command can outlive the bound underlay's retained scope.
      -- Retain the small disposition, rather than starving later due work.
      IF NOT resumed THEN RAISE; END IF;
      IF SQLERRM IN ('e66_current_request_exact_receipt_required','e66_current_request_complete_receipt_set_required') THEN
        UPDATE gridex_e66_request_retry.commands
        SET attempts=attempts+1,last_attempt_at=clock_timestamp()
        WHERE source_id=cmd.source_id;
        RETURN jsonb_build_object('status','deferred','sourceId',cmd.source_id);
      END IF;
      IF SQLERRM NOT IN ('e66_current_request_underlay_scope_invalid','e66_current_request_receipt_set_changed') THEN RAISE; END IF;
      scope_held := true;
      result := jsonb_build_object('status','held','reason',CASE SQLERRM
        WHEN 'e66_current_request_underlay_scope_invalid' THEN 'underlay_scope_changed'
        ELSE 'receipt_set_changed' END);
    END;
    IF NOT scope_held AND (result->>'status' IN ('received','partial','replaced','cancelled')) IS NOT TRUE THEN
      RAISE EXCEPTION 'e66_request_retry_unknown_outcome';
    END IF;
  END IF;

  UPDATE gridex_e66_request_retry.commands
  SET outcome = result, response_patch = NULL, attempts = attempts + 1,
      last_attempt_at = clock_timestamp()
  WHERE source_id = cmd.source_id;
  IF resumed AND result->>'status' IN ('received','partial') THEN
    INSERT INTO gridex_e66_request_retry.terminal_handoffs(source_id) VALUES(cmd.source_id);
  END IF;
  RETURN result || jsonb_build_object('sourceId',cmd.source_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.gridex_discover_e66_terminal_handoff_v1(
 p_company uuid,p_environment text,p_mailbox uuid,p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE found_source uuid;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role'
   OR public.gridex_actor_has_company_permission(p_actor,p_company,'communication.send') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'e66_terminal_scope_required' USING ERRCODE='42501'; END IF;
 PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company,p_actor);
 SELECT c.source_id INTO found_source FROM gridex_e66_request_retry.terminal_handoffs h
 JOIN gridex_e66_request_retry.commands c ON c.source_id=h.source_id
 JOIN public.grid_owner_data_requests r ON r.company_id=c.company_id AND r.id=c.request_id
 WHERE c.company_id=p_company AND c.environment=p_environment AND c.mailbox_id=p_mailbox AND c.actor_id=p_actor
   AND c.outcome->>'status' IN ('received','partial') AND c.response_patch IS NULL
   AND ((c.outcome->>'e66SourceScopeVersion'='1' AND r.status IS DISTINCT FROM 'cancelled')
        OR (c.outcome->>'status'='received' AND r.status='received' AND r.response_payload->>'edielMessageId'=c.source_id::text))
   AND c.reception_id=gridex_e66_request_retry.bound_reception(c.company_id,c.environment,c.mailbox_id,c.source_id,c.request_id)
 ORDER BY h.created_at,c.source_id LIMIT 1;
 RETURN found_source;
END $$;

CREATE OR REPLACE FUNCTION public.gridex_claim_e66_terminal_handoff_v1(
 p_company uuid,p_environment text,p_mailbox uuid,p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h gridex_e66_request_retry.terminal_handoffs%rowtype;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role'
   OR public.gridex_actor_has_company_permission(p_actor,p_company,'communication.send') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'e66_terminal_scope_required' USING ERRCODE='42501'; END IF;
 PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company,p_actor);
 SELECT work.* INTO h FROM gridex_e66_request_retry.terminal_handoffs work
 JOIN gridex_e66_request_retry.commands c ON c.source_id=work.source_id
 JOIN public.grid_owner_data_requests r ON r.company_id=c.company_id AND r.id=c.request_id
 WHERE c.company_id=p_company AND c.environment=p_environment AND c.mailbox_id=p_mailbox AND c.actor_id=p_actor
   AND c.outcome->>'status' IN ('received','partial') AND c.response_patch IS NULL
   AND ((c.outcome->>'e66SourceScopeVersion'='1' AND r.status IS DISTINCT FROM 'cancelled')
        OR (c.outcome->>'status'='received' AND r.status='received' AND r.response_payload->>'edielMessageId'=c.source_id::text))
   AND c.reception_id=gridex_e66_request_retry.bound_reception(c.company_id,c.environment,c.mailbox_id,c.source_id,c.request_id)
   AND work.ready_at<=clock_timestamp() AND (work.lease_until IS NULL OR work.lease_until<=clock_timestamp())
 ORDER BY work.ready_at,c.source_id LIMIT 1 FOR UPDATE OF work SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE gridex_e66_request_retry.terminal_handoffs SET
   lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',ready_at=clock_timestamp()
 WHERE source_id=h.source_id RETURNING * INTO h;
 RETURN jsonb_build_object('sourceId',h.source_id,'leaseToken',h.lease_token,'leaseUntil',h.lease_until);
END $$;

CREATE OR REPLACE FUNCTION gridex_e66_request_retry.require_terminal_lease(
 p_company uuid,p_environment text,p_mailbox uuid,p_actor uuid,p_source uuid,p_lease uuid
) RETURNS uuid LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE h gridex_e66_request_retry.terminal_handoffs%rowtype; c gridex_e66_request_retry.commands%rowtype;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' OR p_lease IS NULL
   OR public.gridex_actor_has_company_permission(p_actor,p_company,'communication.send') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'e66_terminal_scope_required' USING ERRCODE='42501'; END IF;
 PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company,p_actor);
 SELECT * INTO c FROM gridex_e66_request_retry.commands WHERE source_id=p_source AND company_id=p_company
   AND environment=p_environment AND mailbox_id=p_mailbox AND actor_id=p_actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'e66_terminal_lease_unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO h FROM gridex_e66_request_retry.terminal_handoffs WHERE source_id=p_source FOR UPDATE;
 IF h.lease_token IS DISTINCT FROM p_lease OR h.lease_until<=clock_timestamp()
   OR (c.outcome->>'status' IN ('received','partial')) IS NOT TRUE
   OR c.reception_id IS DISTINCT FROM gridex_e66_request_retry.bound_reception(p_company,p_environment,p_mailbox,p_source,c.request_id)
   OR NOT EXISTS(SELECT FROM public.grid_owner_data_requests r WHERE r.company_id=p_company
     AND r.id=c.request_id AND (
       (c.outcome->>'e66SourceScopeVersion'='1' AND r.status IS DISTINCT FROM 'cancelled')
       OR (c.outcome->>'status'='received' AND r.status='received' AND r.response_payload->>'edielMessageId'=p_source::text)
     ))
 THEN RAISE EXCEPTION 'e66_terminal_lease_unavailable' USING ERRCODE='42501'; END IF;
 RETURN c.source_id;
END $$;

CREATE OR REPLACE FUNCTION public.gridex_drain_sealed_e66_request_v1(
 p_company uuid,p_environment text,p_mailbox uuid,p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 cmd gridex_e66_request_retry.commands%ROWTYPE;
 sealed_billing uuid;
 sealed_hash text;
 result jsonb;

BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role'
   OR public.gridex_actor_has_company_permission(p_actor,p_company,'communication.send') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'e66_request_retry_scope_required' USING ERRCODE='42501'; END IF;
 PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
 SELECT c.* INTO cmd FROM gridex_e66_request_retry.commands c
 JOIN gridex_e66_intake.matched_request_basis b ON b.source_id=c.source_id AND b.response_base IS NULL
   AND (b.company_id,b.environment,b.request_id,b.actor_id)=(c.company_id,c.environment,c.request_id,c.actor_id)
 JOIN gridex_e66_intake.work w ON w.source_id=c.source_id AND w.reception_id=c.reception_id
   AND w.company_id=c.company_id AND w.environment=c.environment AND w.mailbox_id=c.mailbox_id
   AND w.phase='complete' AND w.payload_sha256=b.source_sha256
 JOIN gridex_e66_intake.completions d ON d.source_id=w.source_id AND d.source_sha256=w.payload_sha256
   AND d.company_id=c.company_id AND d.environment=c.environment
   AND (d.transaction_id,d.contract_hash)=(b.transaction_id,b.contract_hash)
 WHERE c.company_id=p_company AND c.environment=p_environment AND c.mailbox_id=p_mailbox
   AND c.actor_id=p_actor AND c.outcome IS NULL
 ORDER BY c.last_attempt_at,c.source_id LIMIT 1 FOR UPDATE OF c SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT d.billing_underlay_id,d.billing_underlay_fingerprint INTO STRICT sealed_billing,sealed_hash
  FROM gridex_e66_intake.completions d WHERE d.source_id=cmd.source_id;
 BEGIN
  -- The canonical CAS obtains its own domain locks first. Its effect and the
  -- terminal marker remain provisional until the sealed underlay proof agrees.
  result:=gridex_e66_request_retry.attempt(cmd,true);
  IF result->>'status' IN ('received','partial') AND (
    cmd.response_patch->>'billingUnderlayId' IS DISTINCT FROM sealed_billing::text
    OR (sealed_billing IS NOT NULL AND
      gridex_e66_intake.bound_underlay_fingerprint_v1(cmd.company_id,cmd.source_id,sealed_billing) IS DISTINCT FROM sealed_hash)
  ) THEN RAISE EXCEPTION 'e66_sealed_request_underlay_proof_changed' USING ERRCODE='P0U01'; END IF;
 EXCEPTION WHEN SQLSTATE 'P0U01' THEN
  IF SQLERRM IS DISTINCT FROM 'e66_sealed_request_underlay_proof_changed' THEN RAISE; END IF;
  result:=jsonb_build_object('status','held','reason','underlay_scope_changed');
  UPDATE gridex_e66_request_retry.commands
   SET outcome=result, response_patch=NULL, attempts=attempts+1,last_attempt_at=clock_timestamp()
   WHERE source_id=cmd.source_id;
  RETURN result||jsonb_build_object('sourceId',cmd.source_id);
 END;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION gridex_e66_intake.matched_request_ack_eligible_v1(p_source uuid) RETURNS boolean
 LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT gridex_e66_intake.request_upgrade_state_v1(p_source) IN ('matched_basis','unmatched') AND NOT EXISTS(
   SELECT FROM gridex_e66_intake.matched_request_basis b LEFT JOIN gridex_e66_request_retry.commands c ON c.source_id=b.source_id AND
     (c.company_id,c.environment,c.request_id,c.actor_id)=(b.company_id,b.environment,b.request_id,b.actor_id)
   WHERE b.source_id=p_source AND (b.response_base IS NOT NULL
     OR coalesce(c.outcome->>'status','') NOT IN ('received','partial','replaced')))
 $$;

CREATE OR REPLACE FUNCTION public.gridex_read_e66_request_response_history_v1(
  p_company_id uuid,p_request_id uuid,p_environment text,p_limit integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO pg_catalog SET TimeZone TO 'UTC'
AS $history$
DECLARE result jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='e66_request_history_service_required';
 END IF;
 IF p_company_id IS NULL OR p_request_id IS NULL OR p_environment IS NULL
   OR p_environment NOT IN ('test','production') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='e66_request_history_invalid_scope';
 END IF;

 WITH request AS MATERIALIZED (
   SELECT q.id,q.company_id,q.customer_id,q.metering_point_id,q.external_reference,
      gridex_utilts_binding.e73_sent_request_range_v1(p_company_id,p_request_id,p_environment) AS requested_range
   FROM public.grid_owner_data_requests q
   WHERE (q.company_id,q.id)=(p_company_id,p_request_id) AND q.metering_point_id IS NOT NULL
     AND q.request_scope IN ('meter_values','billing_underlay')
 ), observed_sources AS MATERIALIZED (
   SELECT m.id,m.external_reference,
      (SELECT public.gridex_read_ediel_inbound_receipt_clock_v1(m.company_id,m.id)) AS receipt,
      links.value_count,links.current_count
   FROM request q JOIN public.ediel_messages m
       ON (m.company_id,m.grid_owner_data_request_id,m.environment)=(q.company_id,q.id,p_environment)
   CROSS JOIN LATERAL (
      SELECT count(DISTINCT v.id) AS value_count,count(DISTINCT v.id) FILTER(WHERE v.is_current) AS current_count
      FROM public.metering_value_sources l JOIN public.metering_values v
        ON (v.company_id,v.id)=(l.company_id,l.metering_value_id)
      WHERE (l.company_id,l.source_ediel_message_id,l.source_type)=(m.company_id,m.id,'ediel_utilts')
        AND (v.source_request_id,v.metering_point_id)=(q.id,q.metering_point_id)
        AND v.customer_id IS NOT DISTINCT FROM q.customer_id
   ) links
   WHERE m.direction='inbound' AND m.message_standard='edifact'
      AND m.message_family='UTILTS' AND m.message_code='E66'
      AND m.metering_point_id=q.metering_point_id AND m.customer_id IS NOT DISTINCT FROM q.customer_id
      AND links.value_count>0
   LIMIT p_limit+1
 ), coverage AS (
   SELECT q.requested_range,
     gridex_utilts_binding.e66_protected_request_coverage_v1(
       p_company_id,p_request_id,p_environment,q.requested_range) AS covered
   FROM request q
   WHERE q.requested_range IS NOT NULL
     AND (SELECT count(*) FROM observed_sources)<=p_limit
 ), gaps AS (
   SELECT c.requested_range,c.covered,tstzmultirange(c.requested_range)-c.covered AS remaining
   FROM coverage c
 ), facts AS (
   SELECT id,external_reference,value_count,current_count,
       CASE WHEN receipt->>'source'='imap_internal_date' THEN (receipt->>'receivedAt')::timestamptz END AS observed_at
   FROM observed_sources
 )
 SELECT jsonb_build_object('requestId',q.id,'requestReference',q.external_reference,
   'responseCount',(SELECT count(*) FROM facts),
   'coverage',(SELECT jsonb_build_object('requestedFrom',lower(g.requested_range),
     'requestedUntil',upper(g.requested_range),
     'coveredSeconds',(SELECT coalesce(sum(extract(epoch FROM upper(r)-lower(r))),0) FROM unnest(g.covered) r),
     'remainingSeconds',(SELECT coalesce(sum(extract(epoch FROM upper(r)-lower(r))),0) FROM unnest(g.remaining) r),
     'remainingGapCount',(SELECT count(*) FROM unnest(g.remaining)),
     'remainingGaps',(SELECT coalesce(jsonb_agg(jsonb_build_object('from',lower(r),'until',upper(r))
                                ORDER BY lower(r)),'[]'::jsonb) FROM unnest(g.remaining) r)) FROM gaps g),
   'firstObservedAt',(SELECT min(f.observed_at) FROM facts f),
   'latestObservedAt',(SELECT max(f.observed_at) FROM facts f),
   'responses',(SELECT coalesce(jsonb_agg(jsonb_build_object('sourceMessageId',f.id,
       'responseReference',f.external_reference,'observedAt',f.observed_at,
       'storedValueCount',f.value_count,'currentValueCount',f.current_count)
       ORDER BY f.observed_at NULLS LAST,f.id),'[]'::jsonb) FROM facts f))
 INTO result FROM request q;
 IF coalesce((result->>'responseCount')::integer,0)>p_limit THEN
   RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='e66_request_history_capacity';
 END IF;
 RETURN result;
END
$history$;

END
$e66_coverage_migration$;
RESET statement_timeout;
RESET lock_timeout;
