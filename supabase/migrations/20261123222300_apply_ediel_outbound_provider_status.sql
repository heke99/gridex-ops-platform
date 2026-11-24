DO $migration$
BEGIN
  CREATE FUNCTION public.gridex_apply_ediel_outbound_provider_status_v1(
    p_outbound_request_id uuid, p_company_id uuid, p_actor_id uuid, p_status text,
    p_external_reference text, p_failure_reason text, p_response_patch jsonb,
    p_grid_owner_request_id uuid, p_source_message_id uuid, p_ack_message_id uuid
  )
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO pg_catalog
  AS $function$
  DECLARE
    current_request public.outbound_requests;
    updated_request public.outbound_requests;
    response_patch jsonb;
    backfill_payload jsonb;
    changed_at timestamptz;
    verified_sent_at timestamptz;
  BEGIN
    IF p_outbound_request_id IS NULL OR p_company_id IS NULL OR p_actor_id IS NULL
      OR (p_status IN ('prepared','acknowledged','failed')) IS NOT TRUE
      OR jsonb_typeof(p_response_patch) IS DISTINCT FROM 'object'
      OR num_nonnulls(p_source_message_id,p_ack_message_id) NOT IN (0,2)
      OR (p_source_message_id IS NOT NULL AND (p_status <> 'acknowledged' OR p_source_message_id = p_ack_message_id))
      OR (p_grid_owner_request_id IS NOT NULL AND p_status <> 'acknowledged') THEN
      RAISE EXCEPTION 'Ogiltigt transportbesked för utskick.' USING ERRCODE = '22023';
    END IF;

    SELECT request.* INTO current_request
    FROM public.outbound_requests AS request
    WHERE request.id = p_outbound_request_id AND request.company_id = p_company_id
      AND (p_grid_owner_request_id IS NULL OR (request.source_type = 'grid_owner_data_request'
        AND request.source_id = p_grid_owner_request_id))
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Utskicket matchar inte transportbeskedets källärende.' USING ERRCODE = 'P0002';
    END IF;
    IF jsonb_typeof(current_request.response_payload) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Utskickets tidigare transportsvar måste kontrolleras.' USING ERRCODE = '22023';
    END IF;

    changed_at := clock_timestamp();
    response_patch := p_response_patch - 'admin_note';
    IF current_request.sent_at IS NULL AND p_source_message_id IS NOT NULL THEN
      SELECT coalesce(source_message.message_sent_at, source_message.updated_at, source_message.created_at)
        INTO verified_sent_at
        FROM public.ediel_messages AS source_message
        JOIN public.ediel_messages AS ack ON ack.id = p_ack_message_id
          AND ack.company_id = source_message.company_id AND ack.environment = source_message.environment
          AND ack.direction = 'inbound' AND ack.related_message_id = source_message.id
        WHERE source_message.id = p_source_message_id AND source_message.company_id = p_company_id
          AND source_message.direction = 'outbound' AND source_message.outbound_request_id = current_request.id;
      IF verified_sent_at IS NULL THEN
        RAISE EXCEPTION 'Utskicket matchar inte den kvittens som ligger till grund för sändningstiden.' USING ERRCODE = 'P0002';
      END IF;
      response_patch := response_patch || jsonb_build_object(
        'sentAtBackfilledFrom', 'ediel_inbound_ack_processing',
        'sentAtBackfilledViaAckMessageId', p_ack_message_id,
        'sentAtBackfilledSourceMessageId', p_source_message_id
      );
      backfill_payload := jsonb_build_object('outboundRequestId',current_request.id,
        'previousStatus',current_request.status,'nextStatus',p_status,'sentAt',verified_sent_at,'ackMessageId',p_ack_message_id);
    END IF;

    UPDATE public.outbound_requests AS request
    SET status = p_status,
        external_reference = coalesce(p_external_reference, request.external_reference),
        failure_reason = p_failure_reason,
        response_payload = request.response_payload || response_patch,
        sent_at = coalesce(request.sent_at, verified_sent_at),
        prepared_at = CASE WHEN p_status = 'prepared' THEN changed_at ELSE request.prepared_at END,
        acknowledged_at = CASE WHEN p_status = 'acknowledged' THEN changed_at ELSE request.acknowledged_at END,
        failed_at = CASE WHEN p_status = 'failed' THEN changed_at ELSE request.failed_at END,
        updated_by = p_actor_id, updated_at = changed_at
    WHERE request.id = current_request.id
    RETURNING request.* INTO updated_request;

    IF backfill_payload IS NOT NULL THEN
      INSERT INTO public.ediel_message_events (
        company_id, ediel_message_id, message_id, event_type, event_status, message,
        payload, event_payload, created_by
      ) VALUES (
        p_company_id, p_source_message_id, p_source_message_id, 'manual_note', 'warning',
        'Sändningstid återskapades från Ediel-källmeddelandet när utskicket kvitterades.',
        backfill_payload, backfill_payload, p_actor_id
      );
    END IF;

    INSERT INTO public.outbound_dispatch_events (
      company_id, outbound_request_id, event_type, event_status, message, payload, created_by
    ) VALUES (
      p_company_id, updated_request.id, p_status, p_status,
      CASE WHEN p_status = 'failed'
        THEN coalesce(updated_request.failure_reason, 'Outbound request markerad som failed.')
        ELSE format('Outbound request uppdaterad till %s.', p_status) END,
      jsonb_build_object('externalReference', updated_request.external_reference), p_actor_id
    );

    RETURN to_jsonb(updated_request);
  END;
  $function$;

  REVOKE ALL ON FUNCTION public.gridex_apply_ediel_outbound_provider_status_v1(uuid,uuid,uuid,text,text,text,jsonb,uuid,uuid,uuid)
    FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.gridex_apply_ediel_outbound_provider_status_v1(uuid,uuid,uuid,text,text,text,jsonb,uuid,uuid,uuid)
    TO service_role;
END
$migration$;
