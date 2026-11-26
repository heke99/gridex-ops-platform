DO $migration$
BEGIN
  CREATE FUNCTION public.gridex_update_grid_owner_request_business_v1(
    p_request_id uuid, p_company_id uuid, p_customer_id uuid, p_actor_id uuid,
    p_original_status text, p_changes jsonb
  )
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO pg_catalog
  AS $function$
  DECLARE
    changed_at timestamptz := clock_timestamp();
    updated_request public.grid_owner_data_requests;
  BEGIN
    IF p_request_id IS NULL OR p_company_id IS NULL OR p_customer_id IS NULL OR p_actor_id IS NULL
      OR (p_original_status IN ('pending','sent','received','failed','cancelled')) IS NOT TRUE
      OR jsonb_typeof(p_changes) IS DISTINCT FROM 'object'
      OR p_changes = '{}'::jsonb
      OR p_changes - ARRAY['status','external_reference','failure_reason','notes','admin_note'] <> '{}'::jsonb
      OR (p_changes ? 'status' AND
        (p_changes->>'status' IN ('pending','sent','received','failed','cancelled')
          AND p_changes->>'status' <> p_original_status) IS NOT TRUE)
      OR EXISTS (
        SELECT FROM jsonb_each(p_changes - 'status') AS field(key,value)
        WHERE jsonb_typeof(field.value) NOT IN ('string','null')
      ) THEN
      RAISE EXCEPTION 'Ogiltig ändring av nätägarbegäran.' USING ERRCODE = '22023';
    END IF;

    -- An unchanged status in the form expresses no status write. A deliberate
    -- transition must still match the current row once PostgreSQL locks it.
    UPDATE public.grid_owner_data_requests AS request
    SET status = CASE WHEN p_changes ? 'status' THEN p_changes->>'status' ELSE request.status END,
        external_reference = CASE WHEN p_changes ? 'external_reference' THEN p_changes->>'external_reference' ELSE request.external_reference END,
        failure_reason = CASE WHEN p_changes ? 'failure_reason' THEN p_changes->>'failure_reason' ELSE request.failure_reason END,
        notes = CASE WHEN p_changes ? 'notes' THEN p_changes->>'notes' ELSE request.notes END,
        response_payload = CASE WHEN p_changes ? 'admin_note'
          THEN jsonb_set(request.response_payload, '{admin_note}', p_changes->'admin_note', true)
          ELSE request.response_payload END,
        sent_at = CASE WHEN p_changes->>'status' = 'sent' THEN changed_at ELSE request.sent_at END,
        received_at = CASE WHEN p_changes->>'status' = 'received' THEN changed_at ELSE request.received_at END,
        failed_at = CASE WHEN p_changes->>'status' = 'failed' THEN changed_at ELSE request.failed_at END,
        last_partner_response_at = CASE WHEN p_changes ? 'status' THEN changed_at ELSE request.last_partner_response_at END,
        updated_by = p_actor_id
    WHERE request.id = p_request_id AND request.company_id = p_company_id AND request.customer_id = p_customer_id
      AND (NOT p_changes ? 'status' OR request.status = p_original_status)
      AND (NOT p_changes ? 'admin_note' OR jsonb_typeof(request.response_payload) = 'object')
    RETURNING request.* INTO updated_request;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Begäran har ändrats eller är inte tillgänglig. Ladda om sidan.' USING ERRCODE = 'P0002';
    END IF;
    RETURN to_jsonb(updated_request);
  END;
  $function$;

  REVOKE ALL ON FUNCTION public.gridex_update_grid_owner_request_business_v1(uuid,uuid,uuid,uuid,text,jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.gridex_update_grid_owner_request_business_v1(uuid,uuid,uuid,uuid,text,jsonb)
    TO service_role;
END
$migration$;
