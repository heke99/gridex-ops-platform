DO $migration$
BEGIN
  CREATE TABLE gridex_private.portal_request_field_receipts (
    actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    intent_id uuid NOT NULL,
    request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    receipt_id uuid NOT NULL REFERENCES public.customer_portal_completions(id) ON DELETE CASCADE,
    PRIMARY KEY (actor_user_id, intent_id)
  );
  ALTER TABLE gridex_private.portal_request_field_receipts ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE gridex_private.portal_request_field_receipts FROM PUBLIC, anon, authenticated, service_role;

  CREATE FUNCTION public.gridex_submit_portal_request_fields_v1(
    p_actor_user_id uuid, p_session_id uuid, p_company_id uuid, p_request_id uuid,
    p_expected_site_id uuid, p_intent_id uuid, p_fields jsonb
  ) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  SET lock_timeout = '2s'
  SET statement_timeout = '6s'
  AS $writer$
  DECLARE
    v_customer_id uuid;
    v_active_company_id uuid;
    v_request public.customer_info_requests%rowtype;
    v_receipt gridex_private.portal_request_field_receipts%rowtype;
    v_fields text[];
    v_request_hash text;
    v_receipt_id uuid;
  BEGIN
    IF current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'portal_reply_scope_denied' USING ERRCODE = '42501';
    END IF;
    IF p_actor_user_id IS NULL OR p_session_id IS NULL OR p_company_id IS NULL
      OR p_request_id IS NULL OR p_intent_id IS NULL
      OR jsonb_typeof(p_fields) IS DISTINCT FROM 'object' OR octet_length(p_fields::text) > 4096
    THEN
      RAISE EXCEPTION 'portal_reply_invalid' USING ERRCODE = '22023';
    END IF;

    SELECT customer_id INTO v_customer_id FROM public.customer_info_requests
      WHERE id = p_request_id AND company_id = p_company_id AND target_party_type = 'customer'
        AND request_type = 'website_customer_onboarding' AND automation_origin = 'website_customer_application';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'portal_reply_target_unavailable' USING ERRCODE = 'PT404';
    END IF;

    -- Follow the canonical merge/portal graph lock order.
    PERFORM 1 FROM public.customers WHERE id = v_customer_id
      AND company_id = p_company_id AND merged_into_customer_id IS NULL AND status <> 'archived' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'portal_reply_target_unavailable' USING ERRCODE = 'PT404';
    END IF;
    PERFORM 1 FROM auth.users u JOIN auth.sessions s ON s.user_id = u.id
      WHERE u.id = p_actor_user_id AND s.id = p_session_id AND u.deleted_at IS NULL
        AND (u.banned_until IS NULL OR u.banned_until <= clock_timestamp())
        AND (s.not_after IS NULL OR s.not_after > clock_timestamp())
      FOR SHARE OF u, s;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'portal_reply_scope_denied' USING ERRCODE = '42501';
    END IF;

    PERFORM 1 FROM public.customer_portal_accounts a
      WHERE a.user_id = p_actor_user_id ORDER BY a.id FOR SHARE;
    SELECT coalesce(a.company_id, c.company_id) INTO v_active_company_id
      FROM public.customer_portal_accounts a JOIN public.customers c ON c.id = a.customer_id
      WHERE a.user_id = p_actor_user_id AND a.is_active
        AND coalesce(a.company_id, c.company_id) IS NOT NULL
      ORDER BY a.activated_at DESC NULLS LAST, a.id
      LIMIT 1;
    IF v_active_company_id IS DISTINCT FROM p_company_id OR NOT EXISTS (
      SELECT 1 FROM public.customer_portal_accounts a
        WHERE a.user_id = p_actor_user_id AND a.customer_id = v_customer_id
          AND a.is_active AND a.status = 'active' AND a.role = 'owner'
          AND (a.company_id IS NULL OR a.company_id = p_company_id)
    ) THEN
      RAISE EXCEPTION 'portal_reply_scope_denied' USING ERRCODE = '42501';
    END IF;

    PERFORM public.ediel_require_portal_retention_access_v1(p_company_id, v_customer_id);
    PERFORM pg_advisory_xact_lock(hashtextextended('portal-request-fields:' || p_actor_user_id || ':' || p_intent_id, 0));
    SELECT * INTO v_request FROM public.customer_info_requests
      WHERE id = p_request_id AND company_id = p_company_id
        AND customer_id = v_customer_id AND target_party_type = 'customer'
        AND request_type = 'website_customer_onboarding' AND automation_origin = 'website_customer_application'
      FOR UPDATE;
    IF NOT FOUND OR v_request.site_id IS DISTINCT FROM p_expected_site_id THEN
      RAISE EXCEPTION 'portal_reply_target_unavailable' USING ERRCODE = 'PT404';
    END IF;

    IF p_expected_site_id IS NOT NULL THEN
      PERFORM 1 FROM public.customer_sites WHERE id = p_expected_site_id
        AND company_id = p_company_id AND customer_id = v_customer_id FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'portal_reply_target_unavailable' USING ERRCODE = 'PT404';
      END IF;
    END IF;
    v_request_hash := encode(sha256(convert_to(jsonb_build_array(
      p_company_id, v_customer_id, p_request_id, p_expected_site_id, p_fields
    )::text, 'UTF8')), 'hex');
    SELECT * INTO v_receipt FROM gridex_private.portal_request_field_receipts
      WHERE actor_user_id = p_actor_user_id AND intent_id = p_intent_id;
    IF FOUND THEN
      IF v_receipt.request_hash IS DISTINCT FROM v_request_hash THEN
        RAISE EXCEPTION 'portal_reply_intent_conflict' USING ERRCODE = 'PT409';
      END IF;
      RETURN jsonb_build_object('receipt_id', v_receipt.receipt_id);
    END IF;

    IF v_request.status <> 'draft' THEN
      RAISE EXCEPTION 'portal_reply_closed' USING ERRCODE = 'PT409';
    END IF;
    IF jsonb_typeof(v_request.requested_data_categories) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'portal_reply_fields_changed' USING ERRCODE = 'PT409';
    END IF;
    SELECT array_agg(fields.name ORDER BY fields.name) INTO v_fields
      FROM (VALUES ('facility_id'), ('metering_point_id'), ('site.address'),
        ('customer.email'), ('customer.name'), ('requested_start_date')) AS fields(name)
      WHERE v_request.requested_data_categories ? fields.name
        OR (fields.name = 'facility_id'
          AND v_request.requested_data_categories ?| ARRAY['facility_data_invalid', 'duplicate_facility_id']);
    IF v_fields IS NULL OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_fields) AS keys(key))
      IS DISTINCT FROM v_fields THEN
      RAISE EXCEPTION 'portal_reply_fields_changed' USING ERRCODE = 'PT409';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_each(p_fields) AS field(key, item)
      CROSS JOIN LATERAL (SELECT item #>> '{}' AS value) AS raw
      WHERE jsonb_typeof(field.item) <> 'string'
        OR raw.value IS DISTINCT FROM btrim(raw.value)
        OR length(raw.value) NOT BETWEEN 1 AND CASE field.key
          WHEN 'facility_id' THEN 32 WHEN 'metering_point_id' THEN 32 WHEN 'site.address' THEN 240
          WHEN 'customer.email' THEN 254 WHEN 'customer.name' THEN 180 WHEN 'requested_start_date' THEN 10 END
        OR (field.key IN ('facility_id', 'metering_point_id') AND raw.value !~ '^[0-9]+$')
        OR (field.key = 'customer.email' AND raw.value !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
        OR (field.key = 'requested_start_date'
          AND (raw.value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR NOT pg_input_is_valid(raw.value, 'date')))
    ) THEN
      RAISE EXCEPTION 'portal_reply_invalid' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.customer_portal_completions(company_id, customer_id, site_id, completion_type,
      status, submitted_payload, linked_info_request_id, created_by_user_id)
    VALUES (p_company_id, v_customer_id, p_expected_site_id, 'info_request_reply',
      'submitted', p_fields, p_request_id, p_actor_user_id)
    RETURNING id INTO v_receipt_id;
    INSERT INTO gridex_private.portal_request_field_receipts(actor_user_id, intent_id, request_hash, receipt_id)
      VALUES (p_actor_user_id, p_intent_id, v_request_hash, v_receipt_id);
    RETURN jsonb_build_object('receipt_id', v_receipt_id);
  END;
  $writer$;

  REVOKE ALL ON FUNCTION public.gridex_submit_portal_request_fields_v1(uuid, uuid, uuid, uuid, uuid, uuid, jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.gridex_submit_portal_request_fields_v1(uuid, uuid, uuid, uuid, uuid, uuid, jsonb)
    TO service_role;
END
$migration$;
