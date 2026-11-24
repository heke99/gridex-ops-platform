DO $migration$
BEGIN
  CREATE FUNCTION public.gridex_apply_grid_owner_provider_status_v1(
    p_request_id uuid, p_company_id uuid, p_actor_id uuid, p_source_id uuid,
    p_kind text, p_failure_reason text, p_response_patch jsonb
  )
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO pg_catalog
  AS $function$
  DECLARE
    owner_request public.grid_owner_data_requests;
    outbound public.outbound_requests;
    message public.ediel_messages;
    next_status text;
    source_reference text;
    next_failure_reason text;
    response_patch jsonb;
    changed_at timestamptz;
    coverage_state text;
    retain_e66_state boolean;
  BEGIN
    IF p_request_id IS NULL OR p_company_id IS NULL OR p_actor_id IS NULL OR p_source_id IS NULL
      OR (p_kind IN ('outbound','ediel_received','ediel_ack_positive','ediel_ack_negative')) IS NOT TRUE
      OR jsonb_typeof(p_response_patch) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Ogiltigt transportbesked för nätägarbegäran.' USING ERRCODE = '22023';
    END IF;

    -- Keep the storage order used by the canonical E66 path, with any
    -- outbound row locked before its grid-owner request.
    IF p_kind = 'outbound' THEN
      SELECT request.* INTO outbound FROM public.outbound_requests AS request
      WHERE request.id = p_source_id AND request.company_id = p_company_id
        AND request.source_type = 'grid_owner_data_request' AND request.source_id = p_request_id
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Utskicket matchar inte nätägarbegäran.' USING ERRCODE = 'P0002';
      END IF;
    ELSE
      SELECT received.* INTO message FROM public.ediel_messages AS received
      WHERE received.id = p_source_id AND received.company_id = p_company_id AND received.direction = 'inbound'
        AND (received.grid_owner_data_request_id IS NULL OR received.grid_owner_data_request_id = p_request_id)
      FOR SHARE;
      IF NOT FOUND OR (p_kind = 'ediel_received' AND
        (message.message_family <> 'UTILTS' OR message.message_code = 'E66')) THEN
        RAISE EXCEPTION 'Ediel-källan matchar inte nätägarbegäran.' USING ERRCODE = 'P0002';
      END IF;
      IF p_kind IN ('ediel_ack_positive','ediel_ack_negative') AND (
        message.message_family NOT IN ('CONTRL','APERAK','UTILTS_ERR') OR NOT EXISTS (
          SELECT FROM public.ediel_messages AS sent
          WHERE sent.id = message.related_message_id AND sent.company_id = message.company_id
            AND sent.environment = message.environment AND sent.direction = 'outbound'
            AND (sent.grid_owner_data_request_id = p_request_id OR (
              sent.grid_owner_data_request_id IS NULL AND EXISTS (
                SELECT FROM public.outbound_requests AS request
                WHERE request.id = sent.outbound_request_id AND request.company_id = message.company_id
                  AND request.source_type = 'grid_owner_data_request' AND request.source_id = p_request_id
              )
            ))
        )
      ) THEN
        RAISE EXCEPTION 'Ediel-kvittensen matchar inte nätägarbegärans skickade källa.' USING ERRCODE = 'P0002';
      END IF;
    END IF;

    SELECT request.* INTO owner_request FROM public.grid_owner_data_requests AS request
    WHERE request.id = p_request_id AND request.company_id = p_company_id
      AND (p_kind <> 'outbound' OR request.customer_id = outbound.customer_id)
      AND (message.customer_id IS NULL OR request.customer_id = message.customer_id)
      AND (message.site_id IS NULL OR request.site_id IS NULL OR request.site_id = message.site_id)
      AND (message.metering_point_id IS NULL OR request.metering_point_id IS NULL OR request.metering_point_id = message.metering_point_id)
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Transportkällans bolag eller kund matchar inte nätägarbegäran.' USING ERRCODE = 'P0002';
    END IF;
    IF jsonb_typeof(owner_request.response_payload) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Nätägarbegärans tidigare transportsvar måste kontrolleras.' USING ERRCODE = '22023';
    END IF;

    IF p_kind = 'outbound' THEN
      next_status := CASE outbound.status
        WHEN 'queued' THEN 'pending' WHEN 'prepared' THEN 'pending' WHEN 'sent' THEN 'sent'
        WHEN 'acknowledged' THEN 'received' WHEN 'failed' THEN 'failed' WHEN 'cancelled' THEN 'failed'
        ELSE NULL END;
      IF next_status IS NULL THEN RETURN to_jsonb(owner_request); END IF;
      source_reference := outbound.external_reference;
      next_failure_reason := CASE WHEN next_status = 'failed' THEN coalesce(outbound.failure_reason,
        CASE WHEN outbound.status = 'cancelled' THEN 'Outbound dispatch avbröts manuellt.'
          ELSE 'Outbound dispatch misslyckades.' END) ELSE NULL END;
      response_patch := jsonb_build_object('outboundRequestId',outbound.id,'outboundStatus',outbound.status,
        'outboundChannelType',outbound.channel_type,'communicationRouteId',outbound.communication_route_id,
        'externalReference',outbound.external_reference,'failureReason',outbound.failure_reason);
    ELSE
      source_reference := message.external_reference;
      IF p_kind = 'ediel_ack_positive' THEN
        IF owner_request.status = 'received' THEN RETURN to_jsonb(owner_request); END IF;
        next_status := CASE WHEN owner_request.status = 'pending' THEN 'sent' ELSE owner_request.status END;
      ELSIF p_kind = 'ediel_ack_negative' THEN
        next_status := 'failed';
        next_failure_reason := p_failure_reason;
      ELSE
        next_status := 'received';
        response_patch := jsonb_build_object('externalReference',coalesce(source_reference,owner_request.external_reference));
      END IF;
    END IF;

    response_patch := coalesce(response_patch,'{}'::jsonb) || (p_response_patch - 'admin_note');
    coverage_state := owner_request.response_payload->>'e66CoverageState';
    retain_e66_state := coalesce(coverage_state = 'complete'
      OR (coverage_state IN ('partial','unverified') AND next_status = 'received'), false);
    IF coverage_state IN ('complete','partial','unverified') THEN
      -- The native, source-bound E66 writer owns qualified coverage and its
      -- source provenance. An ordinary transport update can only add its facts.
      response_patch := response_patch - ARRAY[
        'edielMessageId','externalReference','normalizedMeteringPayload','parsedPayload',
        'firstVerifiedResponseAt','lastVerifiedResponseAt','verifiedCoverage','e66CoverageState',
        'completedBySourceId','outboundRequestId','communicationRouteId'
      ];
    END IF;
    IF retain_e66_state THEN
      next_status := owner_request.status;
      source_reference := NULL;
      next_failure_reason := owner_request.failure_reason;
    END IF;

    changed_at := clock_timestamp();
    UPDATE public.grid_owner_data_requests AS request
    SET status = next_status,
        external_reference = coalesce(source_reference, request.external_reference),
        failure_reason = next_failure_reason,
        response_payload = request.response_payload || response_patch,
        sent_at = CASE WHEN NOT retain_e66_state AND next_status = 'sent' THEN changed_at ELSE request.sent_at END,
        received_at = CASE WHEN NOT retain_e66_state AND next_status = 'received' THEN changed_at ELSE request.received_at END,
        failed_at = CASE WHEN NOT retain_e66_state AND next_status = 'failed' THEN changed_at ELSE request.failed_at END,
        last_partner_response_at = CASE WHEN coverage_state IN ('complete','partial','unverified')
          THEN request.last_partner_response_at ELSE changed_at END,
        updated_by = p_actor_id
    WHERE request.id = owner_request.id
    RETURNING request.* INTO owner_request;
    RETURN to_jsonb(owner_request);
  END;
  $function$;

  REVOKE ALL ON FUNCTION public.gridex_apply_grid_owner_provider_status_v1(uuid,uuid,uuid,uuid,text,text,jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.gridex_apply_grid_owner_provider_status_v1(uuid,uuid,uuid,uuid,text,text,jsonb)
    TO service_role;
END
$migration$;
