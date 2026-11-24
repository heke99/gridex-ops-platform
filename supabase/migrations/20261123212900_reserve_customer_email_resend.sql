DO $migration$
BEGIN
CREATE FUNCTION public.gridex_resend_customer_email_v1(
  p_company uuid, p_customer uuid, p_requested uuid, p_actor uuid,
  p_expected_source uuid DEFAULT NULL, p_sender jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  source public.communication_logs%ROWTYPE;
  original_mail public.tenant_email_outbox%ROWTYPE;
  customer public.customers%ROWTYPE;
  ancestor text;
  visited uuid[] := '{}';
  candidate uuid := p_requested;
  prior integer;
  original_count integer;
  rendered jsonb;
  event_name text;
  outbox_id uuid;
  log_id uuid;
  sender_snapshot jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'customer_email_resend_service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN RETURN jsonb_build_object('status', 'failed'); END IF;

  -- The same lock order as the customer retention writer. It also serializes
  -- independent operator sessions, including entry through an older child log.
  SELECT * INTO customer FROM public.customers c
  WHERE c.id = p_customer AND c.company_id = p_company FOR UPDATE;
  IF NOT FOUND OR customer.anonymized_at IS NOT NULL OR customer.merged_into_customer_id IS NOT NULL
    OR gridex_correction_process.customer_retention_tombstoned_v1(p_company, p_customer) THEN
    RETURN jsonb_build_object('status', 'failed');
  END IF;

  LOOP
    IF candidate IS NULL OR candidate = ANY(visited) OR cardinality(visited) >= 20 THEN
      RETURN jsonb_build_object('status', 'requires_reconciliation');
    END IF;
    SELECT * INTO source FROM public.communication_logs l
    WHERE l.id = candidate AND l.company_id = p_company AND l.customer_id = p_customer AND l.channel = 'email';
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'failed'); END IF;
    EXIT WHEN NOT (source.metadata ? 'resend_of_communication_log_id');
    ancestor := source.metadata ->> 'resend_of_communication_log_id';
    IF ancestor IS NULL OR ancestor !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN
      RETURN jsonb_build_object('status', 'requires_reconciliation');
    END IF;
    visited := array_append(visited, candidate);
    candidate := ancestor::uuid;
  END LOOP;

  WITH RECURSIVE branch(id) AS (
    VALUES (source.id)
    UNION
    SELECT l.id FROM public.communication_logs l JOIN branch b
    ON lower(l.metadata ->> 'resend_of_communication_log_id') = b.id::text
    WHERE l.company_id = p_company AND l.customer_id = p_customer
  )
  SELECT min(CASE
    WHEN o.status = 'delivery_uncertain' THEN 1
    WHEN l.id = source.id AND o.status IN ('queued', 'processing') THEN 2
    WHEN l.id <> source.id AND (o.status IN ('queued', 'processing', 'sent')
      OR l.status IN ('sent', 'delivered', 'bounced', 'complained') OR o.provider_message_id IS NOT NULL) THEN 3
    WHEN l.id <> source.id THEN 1
    WHEN o.status IN ('failed', 'cancelled', 'blocked_tenant_state') AND coalesce(o.attempts, 0) > 0 THEN 1
  END) INTO prior
  FROM branch b JOIN public.communication_logs l ON l.id = b.id
  LEFT JOIN public.tenant_email_outbox o ON o.company_id = p_company AND o.communication_log_id = l.id;
  IF prior IS NOT NULL THEN
    RETURN jsonb_build_object('status', CASE prior WHEN 1 THEN 'requires_reconciliation'
      WHEN 2 THEN 'already_pending' ELSE 'duplicate' END);
  END IF;
  IF source.status = 'queued' THEN RETURN jsonb_build_object('status', 'requires_reconciliation'); END IF;

  event_name := coalesce(source.event_key, source.template_key);
  IF nullif(btrim(source.template_key), '') IS NULL OR nullif(btrim(source.recipient_email), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'failed');
  END IF;
  IF lower(btrim(source.recipient_email)) IS DISTINCT FROM lower(btrim(customer.email))
    OR event_name IN ('password_reset', 'company_invite', 'contract.signature_requested', 'withdrawal_received') THEN
    RETURN jsonb_build_object('status', 'requires_reconciliation');
  END IF;

  rendered := source.metadata -> 'rendered_snapshot';
  IF jsonb_typeof(rendered) IS DISTINCT FROM 'object' OR nullif(btrim(rendered ->> 'subject'), '') IS NULL
    OR nullif(btrim(rendered ->> 'html'), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'requires_reconciliation');
  END IF;
  SELECT count(*) INTO original_count FROM public.tenant_email_outbox o
  WHERE o.company_id = p_company AND o.communication_log_id = source.id;
  IF original_count <> 1 THEN RETURN jsonb_build_object('status', 'requires_reconciliation'); END IF;
  SELECT * INTO original_mail FROM public.tenant_email_outbox o
  WHERE o.company_id = p_company AND o.communication_log_id = source.id;
  IF original_mail.status NOT IN ('sent', 'failed') OR (original_mail.status = 'failed' AND coalesce(original_mail.attempts, 0) <> 0)
    OR original_mail.customer_id IS DISTINCT FROM p_customer OR original_mail.email_type IS DISTINCT FROM event_name
    OR original_mail.redirect_url IS NOT NULL OR original_mail.customer_case_id IS NOT NULL
    OR btrim(rendered ->> 'subject') IS DISTINCT FROM original_mail.subject
    OR btrim(rendered ->> 'html') IS DISTINCT FROM original_mail.html_body
    OR nullif(btrim(rendered ->> 'text'), '') IS DISTINCT FROM original_mail.text_body
    OR lower(btrim(source.recipient_email)) IS DISTINCT FROM original_mail.to_email THEN
    RETURN jsonb_build_object('status', 'requires_reconciliation');
  END IF;
  IF p_sender IS NULL THEN
    RETURN jsonb_build_object('status', 'ready', 'sourceId', source.id,
      'templateKey', source.template_key, 'eventKey', source.event_key);
  END IF;
  IF p_expected_source IS DISTINCT FROM source.id OR nullif(btrim(p_sender ->> 'from'), '') IS NULL
    OR nullif(btrim(p_sender ->> 'sender_email'), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'failed');
  END IF;

  log_id := gen_random_uuid();
  outbox_id := gen_random_uuid();
  sender_snapshot := jsonb_build_object('sender_mode', p_sender ->> 'mode', 'sender_email', p_sender ->> 'sender_email',
    'from_name', p_sender ->> 'from_name', 'domain_verified_at', p_sender ->> 'domain_verified_at');
  INSERT INTO public.communication_logs (id, company_id, customer_id, site_id, metering_point_id, channel,
    event_key, template_key, recipient_email, sender_email, reply_to_email, subject, sender_mode, from_name,
    domain_verified_at, template_version, status, provider, created_by, customer_number, external_customer_id,
    contract_id, metadata, idempotency_key)
  VALUES (log_id, p_company, p_customer, source.site_id, source.metering_point_id, 'email', source.event_key,
    source.template_key, original_mail.to_email, p_sender ->> 'sender_email', p_sender ->> 'reply_to',
    original_mail.subject, p_sender ->> 'mode', p_sender ->> 'from_name', (p_sender ->> 'domain_verified_at')::timestamptz,
    source.template_version, 'queued', 'resend', p_actor, source.customer_number, source.external_customer_id,
    source.contract_id, jsonb_build_object('resend_of_communication_log_id', source.id,
      'resend_requested_by', p_actor, 'source', 'resend_customer_email_action'), 'customer-resend:' || source.id::text);
  INSERT INTO public.tenant_email_outbox (id, company_id, customer_id, communication_log_id, email_type,
    to_email, from_email, reply_to_email, subject, html_body, text_body, status, next_attempt_at,
    branding_snapshot, attachments, provider_idempotency_key, created_by)
  VALUES (outbox_id, p_company, p_customer, log_id, event_name, original_mail.to_email,
    btrim(p_sender ->> 'from'), p_sender ->> 'reply_to', original_mail.subject, original_mail.html_body,
    original_mail.text_body, 'queued', now(), sender_snapshot || jsonb_build_object('customer_card_resend', true),
    original_mail.attachments, 'tenant-email:' || p_company::text || ':' || outbox_id::text, p_actor);
  RETURN jsonb_build_object('status', 'queued');
END;
$function$;
REVOKE ALL ON FUNCTION public.gridex_resend_customer_email_v1(uuid,uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_resend_customer_email_v1(uuid,uuid,uuid,uuid,uuid,jsonb) TO service_role;
CREATE FUNCTION public.gridex_check_customer_email_resend_transport_v1(p_company uuid, p_outbox uuid, p_lock_token uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $transport$
DECLARE
  recipient_customer uuid;
  customer public.customers%ROWTYPE;
  mail public.tenant_email_outbox%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'customer_email_resend_service_role_required' USING ERRCODE = '42501';
  END IF;
  SELECT o.customer_id INTO recipient_customer FROM public.tenant_email_outbox o
  WHERE o.id = p_outbox AND o.company_id = p_company AND o.branding_snapshot @> '{"customer_card_resend": true}';
  IF recipient_customer IS NULL OR p_lock_token IS NULL THEN RETURN 'not_current'; END IF;

  SELECT * INTO customer FROM public.customers c
  WHERE c.id = recipient_customer AND c.company_id = p_company FOR SHARE;
  IF NOT FOUND THEN RETURN 'not_current'; END IF;
  SELECT * INTO mail FROM public.tenant_email_outbox o WHERE o.id = p_outbox AND o.company_id = p_company
    AND o.customer_id = recipient_customer AND o.status = 'processing' AND o.lock_token = p_lock_token
    AND o.locked_by = 'tenant-email-outbox' AND o.locked_at IS NOT NULL
    AND o.branding_snapshot @> '{"customer_card_resend": true}' FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_current'; END IF;
  IF customer.anonymized_at IS NULL AND customer.merged_into_customer_id IS NULL
    AND lower(btrim(customer.email)) = mail.to_email
    AND NOT gridex_correction_process.customer_retention_tombstoned_v1(p_company, recipient_customer) THEN
    RETURN 'current';
  END IF;

  UPDATE public.tenant_email_outbox SET status = 'cancelled', failure_reason = 'customer_resend_recipient_not_current',
    next_attempt_at = NULL, lock_token = NULL, locked_at = NULL, locked_by = NULL, updated_at = now()
  WHERE id = mail.id AND company_id = p_company;
  UPDATE public.communication_logs SET status = 'cancelled'
  WHERE id = mail.communication_log_id AND company_id = p_company AND customer_id = recipient_customer AND status = 'queued';
  RETURN 'recipient_not_current';
END;
$transport$;
REVOKE ALL ON FUNCTION public.gridex_check_customer_email_resend_transport_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_check_customer_email_resend_transport_v1(uuid,uuid,uuid) TO service_role;
END;
$migration$;
