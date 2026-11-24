DO $migration$
BEGIN
  CREATE FUNCTION public.gridex_update_outbound_request_business_v1(
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
    updated_request public.outbound_requests;
  BEGIN
    IF p_outbound_request_id IS NULL OR p_company_id IS NULL OR p_customer_id IS NULL OR p_actor_id IS NULL
      OR nullif(btrim(p_original_status), '') IS NULL
      OR jsonb_typeof(p_changes) IS DISTINCT FROM 'object'
      OR p_changes = '{}'::jsonb
      OR p_changes - ARRAY['status','external_reference','failure_reason','admin_note','dispatch_step'] <> '{}'::jsonb
      OR (p_changes ? 'status' AND
        (next_status IN ('queued','prepared','sent','acknowledged','failed','cancelled')
          AND next_status <> p_original_status) IS NOT TRUE)
      OR EXISTS (
        SELECT FROM jsonb_each(p_changes - 'status') AS field(key,value)
        WHERE jsonb_typeof(field.value) NOT IN ('string','null')
      ) THEN
      RAISE EXCEPTION 'Ogiltig ändring av utskick.' USING ERRCODE = '22023';
    END IF;

    response_changes := p_changes - ARRAY['status','external_reference','failure_reason'];

    -- Evaluate the selected changes against the current row after PostgreSQL
    -- locks it. A note can survive an intervening provider acknowledgement.
    UPDATE public.outbound_requests AS request
    SET status = coalesce(next_status, request.status),
        external_reference = CASE WHEN p_changes ? 'external_reference' THEN p_changes->>'external_reference' ELSE request.external_reference END,
        failure_reason = CASE WHEN p_changes ? 'failure_reason' THEN p_changes->>'failure_reason' ELSE request.failure_reason END,
        response_payload = CASE WHEN response_changes <> '{}'::jsonb
          THEN request.response_payload || response_changes ELSE request.response_payload END,
        prepared_at = CASE WHEN next_status = 'prepared' THEN changed_at ELSE request.prepared_at END,
        sent_at = CASE WHEN next_status = 'sent' THEN changed_at ELSE request.sent_at END,
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
          ELSE format('Outbound request uppdaterad till %s.', next_status) END,
        jsonb_build_object('externalReference', updated_request.external_reference), p_actor_id
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
