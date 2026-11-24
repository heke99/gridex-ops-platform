-- Only an already sealed and queued E73 can satisfy the same document operation.
DO $migration$
BEGIN
  CREATE FUNCTION public.gridex_read_customer_calendar_e73_original_v1(
    p_company_id uuid, p_actor_user_id uuid, p_request_id uuid, p_environment text, p_expected_route_id uuid
  ) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $body$
  DECLARE
    v_request public.grid_owner_data_requests%rowtype;
    v_message public.ediel_messages%rowtype;
    v_outbound public.outbound_requests%rowtype;
    v_message_ids uuid[];
  BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' OR p_company_id IS NULL OR p_actor_user_id IS NULL
      OR p_request_id IS NULL OR p_environment IS NULL OR p_environment NOT IN ('test', 'production')
    THEN RAISE EXCEPTION 'utilts_e73_original_actor_scope_required' USING ERRCODE = '42501'; END IF;

    PERFORM 1 FROM public.company_memberships
    WHERE company_id = p_company_id AND user_id = p_actor_user_id AND status = 'active'
      AND is_active AND accepted_at IS NOT NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'utilts_e73_original_actor_scope_required' USING ERRCODE = '42501'; END IF;
    PERFORM 1 FROM public.user_profiles WHERE id = p_actor_user_id AND user_status = 'active' FOR SHARE;
    IF NOT FOUND OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id, p_company_id, 'communication.write'), false) THEN
      RAISE EXCEPTION 'utilts_e73_original_actor_scope_required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_request FROM public.grid_owner_data_requests
    WHERE id = p_request_id AND company_id = p_company_id AND request_scope = 'meter_values'
      AND automation_origin = 'customer_document_e73_calendar_v1'
    FOR SHARE;
    IF NOT FOUND OR v_request.operation_id IS NULL OR v_request.authorization_document_id IS NULL
      OR v_request.customer_id IS NULL OR v_request.site_id IS NULL OR v_request.metering_point_id IS NULL OR v_request.grid_owner_id IS NULL
      OR v_request.request_payload->>'ediel_environment' IS DISTINCT FROM p_environment
    THEN RAISE EXCEPTION 'utilts_e73_original_scope_mismatch' USING ERRCODE = '42501'; END IF;

    SELECT ARRAY(
      SELECT id FROM public.ediel_messages
      WHERE company_id = p_company_id AND grid_owner_data_request_id = p_request_id
        AND direction = 'outbound' AND message_family = 'UTILTS' AND message_code = 'E73'
      LIMIT 2
    ) INTO v_message_ids;
    IF cardinality(v_message_ids) = 0 THEN RETURN NULL; END IF;
    IF cardinality(v_message_ids) <> 1
    THEN RAISE EXCEPTION 'utilts_e73_original_scope_mismatch' USING ERRCODE = '23514'; END IF;

    SELECT * INTO STRICT v_message FROM public.ediel_messages WHERE id = v_message_ids[1] FOR SHARE;
    IF v_message.company_id IS DISTINCT FROM p_company_id OR v_message.grid_owner_data_request_id IS DISTINCT FROM p_request_id
      OR v_message.direction IS DISTINCT FROM 'outbound' OR v_message.message_family IS DISTINCT FROM 'UTILTS'
      OR v_message.message_code IS DISTINCT FROM 'E73' OR v_message.environment IS DISTINCT FROM p_environment
      OR v_message.source_operation_id IS DISTINCT FROM v_request.operation_id::text
      OR v_message.customer_id IS DISTINCT FROM v_request.customer_id OR v_message.site_id IS DISTINCT FROM v_request.site_id
      OR v_message.metering_point_id IS DISTINCT FROM v_request.metering_point_id OR v_message.grid_owner_id IS DISTINCT FROM v_request.grid_owner_id
      OR v_message.communication_route_id IS NULL OR (p_expected_route_id IS NOT NULL AND v_message.communication_route_id <> p_expected_route_id)
      OR nullif(v_message.raw_payload, '') IS NULL
    THEN RAISE EXCEPTION 'utilts_e73_original_scope_mismatch' USING ERRCODE = '23514'; END IF;

    SELECT * INTO v_outbound FROM public.outbound_requests
    WHERE id = v_message.outbound_request_id AND company_id = p_company_id AND request_type = 'meter_values'
      AND source_type = 'grid_owner_data_request' AND source_id = p_request_id AND operation_id = v_request.operation_id
      AND communication_route_id = v_message.communication_route_id
      AND customer_id = v_request.customer_id AND site_id = v_request.site_id
      AND metering_point_id = v_request.metering_point_id AND grid_owner_id = v_request.grid_owner_id
      AND authorization_document_id = v_request.authorization_document_id
    FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'utilts_e73_original_scope_mismatch' USING ERRCODE = '23514'; END IF;

    PERFORM gridex_ediel_outbound_owner.require_v1(p_company_id, v_message.id);
    PERFORM 1 FROM public.ediel_outbox
    WHERE company_id = p_company_id AND environment = p_environment AND ediel_message_id = v_message.id
      AND lock_key = 'outbound:' || v_outbound.id::text || ':' || v_message.id::text
    FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'utilts_e73_original_queue_recovery_required' USING ERRCODE = 'PT409'; END IF;

    -- Return the original as stored. Replays acquire no transport claim and make no writes.
    RETURN to_jsonb(v_message);
  END;
  $body$;
  REVOKE ALL ON FUNCTION public.gridex_read_customer_calendar_e73_original_v1(uuid, uuid, uuid, text, uuid)
    FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.gridex_read_customer_calendar_e73_original_v1(uuid, uuid, uuid, text, uuid) TO service_role;
END;
$migration$;
