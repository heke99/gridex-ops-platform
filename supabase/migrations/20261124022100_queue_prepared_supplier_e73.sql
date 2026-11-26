-- First E73 enqueue publishes an already sealed original and its own validated intent together.
DO $migration$
BEGIN
  CREATE FUNCTION public.gridex_queue_prepared_supplier_e73_v1(
    p_company_id uuid, p_actor_user_id uuid, p_request_id uuid, p_environment text, p_message_id uuid DEFAULT NULL
  ) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $body$
  DECLARE
    v_request public.grid_owner_data_requests%rowtype;
    v_message public.ediel_messages%rowtype;
    v_outbound public.outbound_requests%rowtype;
    v_intent public.ediel_message_intents%rowtype;
    v_outbox public.ediel_outbox%rowtype;
    v_message_ids uuid[];
    v_outbox_ids uuid[];
    v_operation uuid;
    v_period text[];
    v_offsets text[];
    v_previous_status text;
    v_lock_key text;
    v_now timestamptz := clock_timestamp();
  BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' OR p_company_id IS NULL OR p_actor_user_id IS NULL
      OR p_request_id IS NULL OR p_environment IS NULL OR p_environment NOT IN ('test', 'production')
    THEN RAISE EXCEPTION 'supplier_e73_queue_actor_scope_required' USING ERRCODE = '42501'; END IF;

    PERFORM 1 FROM public.company_memberships WHERE company_id = p_company_id AND user_id = p_actor_user_id
      AND status = 'active' AND is_active AND accepted_at IS NOT NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_e73_queue_actor_scope_required' USING ERRCODE = '42501'; END IF;
    PERFORM 1 FROM public.user_profiles WHERE id = p_actor_user_id AND user_status = 'active' FOR SHARE;
    IF NOT FOUND OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id, p_company_id, 'communication.write'), false)
    THEN RAISE EXCEPTION 'supplier_e73_queue_actor_scope_required' USING ERRCODE = '42501'; END IF;

    -- The request lock serializes legitimate reruns of this operation.  No provider call is owned here.
    SELECT * INTO v_request FROM public.grid_owner_data_requests
    WHERE company_id = p_company_id AND id = p_request_id AND request_scope = 'meter_values' FOR UPDATE;
    IF NOT FOUND OR v_request.customer_id IS NULL OR v_request.site_id IS NULL OR v_request.metering_point_id IS NULL
      OR (v_request.request_payload ? 'ediel_environment' AND v_request.request_payload->>'ediel_environment' IS DISTINCT FROM p_environment)
      OR (p_message_id IS NULL AND v_request.automation_origin IS DISTINCT FROM 'customer_document_e73_calendar_v1')
    THEN RAISE EXCEPTION 'supplier_e73_queue_source_mismatch' USING ERRCODE = '23514'; END IF;
    v_operation := coalesce(v_request.operation_id, v_request.id);

    SELECT ARRAY(
      SELECT id FROM public.ediel_messages
      WHERE company_id = p_company_id AND grid_owner_data_request_id = p_request_id AND direction = 'outbound'
        AND message_family = 'UTILTS' AND message_code = 'E73' AND environment = p_environment
      LIMIT 2
    ) INTO v_message_ids;
    IF cardinality(v_message_ids) <> 1 OR (p_message_id IS NOT NULL AND v_message_ids[1] IS DISTINCT FROM p_message_id)
    THEN RAISE EXCEPTION 'supplier_e73_queue_original_scope_mismatch' USING ERRCODE = '23514'; END IF;

    SELECT * INTO STRICT v_message FROM public.ediel_messages WHERE id = v_message_ids[1] FOR UPDATE;
    IF v_message.company_id IS DISTINCT FROM p_company_id OR v_message.environment IS DISTINCT FROM p_environment
      OR v_message.grid_owner_data_request_id IS DISTINCT FROM p_request_id OR v_message.direction IS DISTINCT FROM 'outbound'
      OR v_message.message_family IS DISTINCT FROM 'UTILTS' OR v_message.message_code IS DISTINCT FROM 'E73'
      OR v_message.source_operation_id IS DISTINCT FROM v_operation::text OR v_message.customer_id IS DISTINCT FROM v_request.customer_id
      OR v_message.site_id IS DISTINCT FROM v_request.site_id OR v_message.metering_point_id IS DISTINCT FROM v_request.metering_point_id
      OR v_message.grid_owner_id IS DISTINCT FROM v_request.grid_owner_id OR v_message.intent_id IS NULL
      OR v_message.outbound_request_id IS NULL OR v_message.communication_route_id IS NULL OR v_message.route_profile_id IS NULL
    THEN RAISE EXCEPTION 'supplier_e73_queue_original_scope_mismatch' USING ERRCODE = '23514'; END IF;

    SELECT * INTO v_outbound FROM public.outbound_requests
    WHERE company_id = p_company_id AND id = v_message.outbound_request_id AND request_type = 'meter_values'
      AND source_type = 'grid_owner_data_request' AND source_id = p_request_id AND operation_id = v_operation
      AND customer_id = v_request.customer_id AND site_id = v_request.site_id
      AND metering_point_id = v_request.metering_point_id AND grid_owner_id IS NOT DISTINCT FROM v_request.grid_owner_id
      AND authorization_document_id IS NOT DISTINCT FROM v_request.authorization_document_id
      AND communication_route_id = v_message.communication_route_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_e73_queue_outbound_scope_mismatch' USING ERRCODE = '23514'; END IF;

    SELECT * INTO v_intent FROM public.ediel_message_intents
    WHERE company_id = p_company_id AND id = v_message.intent_id AND environment = p_environment
      AND operation_id = v_operation AND idempotency_key = 'utilts-e73:' || p_request_id::text
      AND direction = 'outbound' AND message_family = 'UTILTS' AND message_code = 'E73'
      AND business_process = 'metering_values' AND payload->>'grid_owner_data_request_id' = p_request_id::text
      AND validation_status = 'validated' AND (ediel_message_id IS NULL OR ediel_message_id = v_message.id)
      AND (outbound_request_id IS NULL OR outbound_request_id = v_outbound.id)
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_e73_queue_intent_scope_mismatch' USING ERRCODE = '23514'; END IF;

    PERFORM gridex_ediel_outbound_owner.require_v1(p_company_id, v_message.id);
    IF v_request.automation_origin = 'customer_document_e73_calendar_v1' THEN
      IF v_intent.payload->>'periodStart' IS DISTINCT FROM v_request.request_payload->>'delivery_period_start'
        OR v_intent.payload->>'periodEnd' IS DISTINCT FROM v_request.request_payload->>'delivery_period_end'
        OR v_intent.payload->>'periodStart' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
        OR v_intent.payload->>'periodEnd' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
        OR (v_intent.payload->>'periodStart')::timestamptz >= (v_intent.payload->>'periodEnd')::timestamptz
      THEN RAISE EXCEPTION 'supplier_e73_queue_document_period_mismatch' USING ERRCODE = '23514'; END IF;
      SELECT array_agg((token#>>'{elements,1,1}') || ':' || (token#>>'{elements,1,2}')) FILTER (WHERE token#>>'{elements,1,0}' = '324'),
        array_agg((token#>>'{elements,1,1}') || ':' || (token#>>'{elements,1,2}')) FILTER (WHERE token#>>'{elements,1,0}' = '735')
      INTO v_period, v_offsets
      FROM jsonb_array_elements(gridex_received_sources.closure_wire_tokens_v2(v_message.raw_payload)) token
      WHERE token->>'tag' = 'DTM';
      IF v_period IS DISTINCT FROM ARRAY[
        to_char(((v_intent.payload->>'periodStart')::timestamptz AT TIME ZONE 'UTC') + interval '1 hour', 'YYYYMMDDHH24MI') ||
        to_char(((v_intent.payload->>'periodEnd')::timestamptz AT TIME ZONE 'UTC') + interval '1 hour', 'YYYYMMDDHH24MI') || ':719'
      ] OR v_offsets IS DISTINCT FROM ARRAY['+0100:406']
      THEN RAISE EXCEPTION 'supplier_e73_queue_document_period_mismatch' USING ERRCODE = '23514'; END IF;
    END IF;
    v_lock_key := 'outbound:' || v_outbound.id::text || ':' || v_message.id::text;

    SELECT ARRAY(SELECT id FROM public.ediel_outbox
      WHERE company_id = p_company_id AND environment = p_environment AND ediel_message_id = v_message.id
      LIMIT 2
    ) INTO v_outbox_ids;
    IF cardinality(v_outbox_ids) <> 0 THEN
      IF cardinality(v_outbox_ids) <> 1
      THEN RAISE EXCEPTION 'supplier_e73_queue_existing_scope_mismatch' USING ERRCODE = '23514'; END IF;
      SELECT * INTO STRICT v_outbox FROM public.ediel_outbox WHERE id = v_outbox_ids[1] FOR SHARE;
      IF v_outbox.lock_key IS DISTINCT FROM v_lock_key OR v_outbox.intent_id IS DISTINCT FROM v_intent.id
        OR v_outbox.route_profile_id IS DISTINCT FROM v_message.route_profile_id
        OR v_intent.ediel_message_id IS DISTINCT FROM v_message.id OR v_intent.outbound_request_id IS DISTINCT FROM v_outbound.id
      THEN RAISE EXCEPTION 'supplier_e73_queue_existing_scope_mismatch' USING ERRCODE = '23514'; END IF;
      RETURN jsonb_build_object('message', to_jsonb(v_message), 'outboxId', v_outbox.id, 'replayed', true);
    END IF;

    -- Never manufacture a replacement for an old attempt whose outbox was lost or removed.
    IF v_request.status IS DISTINCT FROM 'pending' OR v_message.message_sent_at IS NOT NULL
      OR v_message.status NOT IN ('draft','prepared','queued') OR v_outbound.status NOT IN ('draft','prepared','queued')
      OR v_outbound.sent_at IS NOT NULL OR v_outbound.acknowledged_at IS NOT NULL OR v_intent.outbox_status <> 'not_queued'
      OR EXISTS (SELECT FROM gridex_ediel_transport.attempts WHERE company_id = p_company_id AND message_id = v_message.id)
      OR EXISTS (SELECT FROM gridex_outbound_dispatch.attempts WHERE company_id = p_company_id AND message_id = v_message.id)
    THEN RAISE EXCEPTION 'supplier_e73_queue_transport_history_hold' USING ERRCODE = 'PT409'; END IF;

    PERFORM 1 FROM public.companies WHERE id = p_company_id AND status IN ('active', 'onboarding') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_e73_queue_company_not_operational' USING ERRCODE = '42501'; END IF;

    UPDATE public.ediel_message_intents SET ediel_message_id = v_message.id, outbound_request_id = v_outbound.id,
      render_status = 'rendered', outbox_status = 'queued', updated_by = p_actor_user_id, updated_at = v_now WHERE id = v_intent.id;
    PERFORM gridex_ediel_transport.require_message_intent_v1(v_message);

    v_previous_status := v_message.status;
    UPDATE public.ediel_messages SET status = 'queued', processing_status = 'queued', updated_by = p_actor_user_id,
      updated_at = v_now WHERE id = v_message.id
    RETURNING * INTO STRICT v_message;

    INSERT INTO public.ediel_outbox(company_id, ediel_message_id, intent_id, status, queued_at, priority, lock_key,
      message_family, message_code, environment, route_profile_id, payload, created_by, updated_by)
    VALUES(p_company_id, v_message.id, v_intent.id, 'queued', v_now, 50, v_lock_key,
      'UTILTS','E73',p_environment,v_message.route_profile_id,jsonb_build_object('outboundRequestId',v_outbound.id,
        'gridOwnerDataRequestId',p_request_id,'externalReference',v_message.external_reference),p_actor_user_id,p_actor_user_id)
    RETURNING * INTO STRICT v_outbox;

    PERFORM public.gridex_apply_ediel_outbound_provider_status_v1(v_outbound.id,p_company_id,p_actor_user_id,'prepared',
      v_message.external_reference,NULL,jsonb_build_object('edielMessageId',v_message.id,'edielOutboxQueued',true,
        'edielCode','E73','gridOwnerDataRequestId',p_request_id),NULL,NULL,NULL);

    INSERT INTO public.ediel_message_events(company_id, ediel_message_id, message_id, event_type, event_status, message,
      payload, event_payload, created_by)
    VALUES(p_company_id, v_message.id, v_message.id, 'queued','info','Validerad UTILTS E73 lades i rätt utgående kö.',
      jsonb_build_object('outboxItemId',v_outbox.id,'previousStatus',v_previous_status,'intentId',v_intent.id),
      jsonb_build_object('outboxItemId',v_outbox.id,'previousStatus',v_previous_status,'intentId',v_intent.id),p_actor_user_id);
    RETURN jsonb_build_object('message', to_jsonb(v_message), 'outboxId', v_outbox.id, 'replayed', false);
  END;
  $body$;
  REVOKE ALL ON FUNCTION public.gridex_queue_prepared_supplier_e73_v1(uuid,uuid,uuid,text,uuid)
    FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.gridex_queue_prepared_supplier_e73_v1(uuid,uuid,uuid,text,uuid) TO service_role;
END;
$migration$;
