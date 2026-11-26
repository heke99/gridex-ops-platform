DO $migration$
BEGIN
  CREATE OR REPLACE FUNCTION public.gridex_update_outbound_request_business_v1(
    p_outbound_request_id uuid, p_company_id uuid, p_customer_id uuid, p_actor_id uuid,
    p_original_status text, p_changes jsonb
  )
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO pg_catalog
  AS $function$
  DECLARE
    next_status text := p_changes->>'status';
    changed_at timestamptz := clock_timestamp();
    response_changes jsonb;
    manual_delivery_ref text;
    manual_attestation jsonb;
    prior_request public.outbound_requests;
    updated_request public.outbound_requests;
  BEGIN
    IF p_outbound_request_id IS NULL OR p_company_id IS NULL OR p_customer_id IS NULL OR p_actor_id IS NULL
      OR nullif(btrim(p_original_status), '') IS NULL
      OR jsonb_typeof(p_changes) IS DISTINCT FROM 'object'
      OR p_changes = '{}'::jsonb
      OR p_changes - ARRAY['status','external_reference','failure_reason','admin_note','dispatch_step','manual_delivery_reference'] <> '{}'::jsonb
      OR (p_changes ? 'status' AND
        (next_status IN ('queued','prepared','sent','acknowledged','failed','cancelled')
          AND next_status <> p_original_status) IS NOT TRUE)
      OR EXISTS (
        SELECT FROM jsonb_each(p_changes - 'status') AS field(key,value)
        WHERE jsonb_typeof(field.value) NOT IN ('string','null')
      ) THEN
      RAISE EXCEPTION 'Ogiltig ändring av utskick.' USING ERRCODE = '22023';
    END IF;

    response_changes := p_changes - ARRAY['status','external_reference','failure_reason','manual_delivery_reference'];
    IF next_status IN ('sent','acknowledged') THEN
      SELECT * INTO prior_request FROM public.outbound_requests
        WHERE id = p_outbound_request_id AND company_id = p_company_id AND customer_id = p_customer_id
          AND status = p_original_status FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Utskicket har ändrats eller är inte tillgängligt. Ladda om sidan.' USING ERRCODE = 'P0002';
      END IF;

      IF (
        public.canonical_actor_is_platform_admin(p_actor_id)
        OR public.gridex_actor_has_company_permission(p_actor_id, p_company_id, 'switching.write')
        OR public.gridex_actor_has_company_permission(p_actor_id, p_company_id, 'metering.write')
        OR public.gridex_actor_has_company_permission(p_actor_id, p_company_id, 'billing_underlay.write')
      ) IS NOT TRUE THEN
        RAISE EXCEPTION 'Manuell leveransregistrering kräver ändringsbehörighet för bolaget.' USING ERRCODE = '42501';
      END IF;

      IF prior_request.channel_type NOT IN ('email_manual','file_export')
        OR prior_request.request_type NOT IN (
          'supplier_switch','meter_values','customer_masterdata','metering_access',
          'grid_owner_metering_access_agreement','switch_information_request',
          'current_supplier_contract_information_request','customer_masterdata_request',
          'supplier_switch_cancellation','metering_access_request','metering_access_termination','meter_values_request'
        )
        OR prior_request.ediel_route_profile_id IS NOT NULL
        OR nullif(prior_request.response_payload->>'edielMessageId', '') IS NOT NULL THEN
        RAISE EXCEPTION 'Utskickets transportägare registrerar sändning och kvittens.' USING ERRCODE = '42501';
      END IF;

      -- A rendered original can exist before the canonical bind locks its request.
      -- Take the same non-waiting exclusion fence as the route retry owner.
      BEGIN
        LOCK TABLE public.ediel_messages IN SHARE MODE NOWAIT;
      EXCEPTION WHEN lock_not_available THEN
        RAISE EXCEPTION 'Kontrollera utskickets transporthistorik och försök igen.' USING ERRCODE = 'PT409';
      END;

      IF EXISTS (
        SELECT FROM public.ediel_messages m WHERE m.company_id = p_company_id
          AND m.direction = 'outbound' AND (m.outbound_request_id = prior_request.id
            OR (prior_request.source_type = 'supplier_switch_request' AND m.switch_request_id = prior_request.source_id
              AND m.message_family = 'PRODAT' AND m.message_code = 'Z03'))
      ) OR EXISTS (
        SELECT FROM public.ediel_message_intents i
        WHERE i.company_id = p_company_id AND i.outbound_request_id = prior_request.id
      ) THEN
        RAISE EXCEPTION 'Utskickets transportägare registrerar sändning och kvittens.' USING ERRCODE = '42501';
      END IF;

      IF (next_status = 'sent' AND prior_request.status NOT IN ('queued','prepared','failed'))
        OR (next_status = 'acknowledged' AND (prior_request.status <> 'sent' OR prior_request.sent_at IS NULL)) THEN
        RAISE EXCEPTION 'Aktuell status tillåter inte den manuella registreringen.' USING ERRCODE = '22023';
      END IF;

      manual_delivery_ref := nullif(btrim(p_changes->>'manual_delivery_reference'), '');
      IF manual_delivery_ref IS NULL OR length(manual_delivery_ref) > 240 THEN
        RAISE EXCEPTION 'Ange referensen till det manuella kvittot.' USING ERRCODE = '22023';
      END IF;
      manual_attestation := jsonb_build_object(
        'source', 'operator_attestation', 'phase', next_status, 'reference', manual_delivery_ref,
        'recordedAt', changed_at, 'actorUserId', p_actor_id
      );
      response_changes := response_changes || jsonb_build_object(
        CASE next_status WHEN 'sent' THEN 'manualSendAttestation' ELSE 'manualAckAttestation' END,
        manual_attestation
      );
    ELSIF p_changes ? 'manual_delivery_reference' THEN
      RAISE EXCEPTION 'Ett manuellt kvitto kräver en ny sändnings- eller kvittensstatus.' USING ERRCODE = '22023';
    END IF;

    -- Evaluate the selected changes against the current row after PostgreSQL
    -- locks it. A note can survive an intervening provider acknowledgement.
    UPDATE public.outbound_requests AS request
    SET status = coalesce(next_status, request.status),
        external_reference = CASE WHEN p_changes ? 'external_reference' THEN p_changes->>'external_reference' ELSE request.external_reference END,
        failure_reason = CASE WHEN p_changes ? 'failure_reason' THEN p_changes->>'failure_reason' ELSE request.failure_reason END,
        response_payload = CASE WHEN response_changes <> '{}'::jsonb
          THEN request.response_payload || response_changes ELSE request.response_payload END,
        prepared_at = CASE WHEN next_status = 'prepared' THEN changed_at ELSE request.prepared_at END,
        sent_at = CASE WHEN next_status = 'sent' THEN coalesce(request.sent_at, changed_at) ELSE request.sent_at END,
        acknowledged_at = CASE WHEN next_status = 'acknowledged' THEN changed_at ELSE request.acknowledged_at END,
        failed_at = CASE WHEN next_status = 'failed' THEN changed_at ELSE request.failed_at END,
        attempts_count = CASE WHEN next_status = 'sent' THEN request.attempts_count + 1 ELSE request.attempts_count END,
        updated_by = p_actor_id
    WHERE request.id = p_outbound_request_id AND request.company_id = p_company_id AND request.customer_id = p_customer_id
      AND (next_status IS NULL OR request.status = p_original_status)
      AND (response_changes = '{}'::jsonb OR jsonb_typeof(request.response_payload) = 'object')
    RETURNING request.* INTO updated_request;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Utskicket har ändrats eller är inte tillgängligt. Ladda om sidan.' USING ERRCODE = 'P0002';
    END IF;

    IF next_status IS NOT NULL THEN
      INSERT INTO public.outbound_dispatch_events (
        company_id, outbound_request_id, event_type, event_status, message, payload, created_by
      ) VALUES (
        p_company_id, updated_request.id, next_status, next_status,
        CASE WHEN next_status = 'failed'
          THEN coalesce(updated_request.failure_reason, 'Outbound request markerad som failed.')
          WHEN manual_attestation IS NOT NULL THEN
            CASE next_status WHEN 'sent' THEN 'Manuell sändning registrerades.' ELSE 'Manuell kvittens registrerades.' END
          ELSE format('Outbound request uppdaterad till %s.', next_status) END,
        jsonb_build_object('externalReference', updated_request.external_reference)
          || CASE WHEN manual_attestation IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('manualDeliveryAttestation', manual_attestation) END,
        p_actor_id
      );
    END IF;

    RETURN to_jsonb(updated_request);
  END;
  $function$;

  REVOKE ALL ON FUNCTION public.gridex_update_outbound_request_business_v1(uuid,uuid,uuid,uuid,text,jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.gridex_update_outbound_request_business_v1(uuid,uuid,uuid,uuid,text,jsonb)
    TO service_role;
END
$migration$;
