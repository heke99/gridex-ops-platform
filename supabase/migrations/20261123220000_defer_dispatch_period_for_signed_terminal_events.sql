DO $migration$
DECLARE
  verifier regprocedure := to_regprocedure('gridex_invoice_dispatch_period.has_verified_attempt(uuid,uuid,text)');
  period_owner regprocedure := to_regprocedure('public.gridex_reconcile_invoice_dispatch_period_v1(uuid,text)');
BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc WHERE oid = verifier)
      IS DISTINCT FROM 'f57c828ebc9601e5734f69ee08cd406bf464947e1582074387daf725ffec8892'
    OR (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc WHERE oid = period_owner)
      IS DISTINCT FROM 'd7cbab434ba7b277e5aa777a81bcdfea0baf27a41a96cc2d0bdd8bdb925cabc7' THEN
    RAISE EXCEPTION 'invoice_dispatch_period_signed_event_preimage_required' USING ERRCODE = '55000';
  END IF;

  -- A matching authenticated terminal receipt must be resolved by the canonical
  -- processor before its published invoice can qualify the period. An ignored
  -- or rejected event stops holding the period once processing finishes.
CREATE OR REPLACE FUNCTION gridex_invoice_dispatch_period.has_verified_attempt(p_company uuid, p_underlay uuid, p_month text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog AS $evidence$
  SELECT EXISTS (
    SELECT FROM public.invoice_export_items i
    JOIN public.invoice_export_runs r ON r.company_id = i.company_id AND r.id = i.export_run_id
    JOIN public.customer_invoices c ON c.company_id = i.company_id AND c.invoice_export_item_id = i.id
    JOIN public.invoice_export_attempts a ON a.company_id = i.company_id AND a.invoice_export_item_id = i.id
      AND a.export_run_id = r.id AND a.attempt_no = i.attempt_count
    WHERE i.company_id = p_company AND i.billing_underlay_id = p_underlay
      AND r.billing_month = p_month AND r.environment = 'production' AND i.environment = r.environment AND i.status = 'sent' AND c.status IN ('sent', 'paid', 'overdue')
      AND i.provider = 'capway_aptic' AND i.provider_reconciliation_status = 'confirmed'
      AND coalesce(i.provider_status, '') NOT IN ('cancelled', 'credited', 'disputed')
      AND i.provider_confirmed_at IS NOT NULL AND i.sent_at IS NOT NULL
      AND nullif(btrim(i.provider_invoice_guid), '') IS NOT NULL
      AND c.partner_invoice_reference = i.provider_invoice_guid
      AND a.outcome = 'sent' AND a.finished_at IS NOT NULL AND a.http_status BETWEEN 200 AND 299
      AND a.idempotency_key = i.provider_idempotency_key AND a.request_hash ~ '^[a-f0-9]{64}$'
      AND NOT EXISTS (
        SELECT FROM public.invoice_provider_events AS event
        JOIN public.billing_provider_webhook_events AS webhook
          ON webhook.company_id = event.company_id AND webhook.provider = event.provider
          AND webhook.environment = event.environment AND webhook.idempotency_key = event.idempotency_hash
          AND webhook.external_event_id = event.provider_event_id AND webhook.event_type = event.event_type
          AND webhook.signature_valid IS TRUE AND webhook.signature_timestamp IS NOT NULL
          AND webhook.status IN ('received', 'processed') AND webhook.payload = event.payload
        JOIN public.billing_provider_connections AS connection
          ON connection.id = webhook.billing_provider_connection_id AND connection.company_id = event.company_id
          AND connection.provider = event.provider AND connection.environment = event.environment
        CROSS JOIN LATERAL (
          SELECT regexp_replace(lower(btrim(event.event_type)), '[^a-z0-9_.]', '_', 'g') AS event_type,
            coalesce(nullif(event.payload->'invoice_status', 'null'), nullif(event.payload->'invoiceStatus', 'null'),
              event.payload->'status') AS status_value
        ) AS reported
        CROSS JOIN LATERAL (
          SELECT regexp_replace(lower(btrim(reported.status_value #>> '{}')), '[^a-z0-9_.]', '_', 'g') AS status_type,
            CASE WHEN jsonb_typeof(reported.status_value) IN ('string', 'number')
                AND btrim(reported.status_value #>> '{}') ~ '^[0-9]{1,3}([.,]0+)?$'
              THEN trunc(replace(btrim(reported.status_value #>> '{}'), ',', '.')::numeric)::integer
            END AS status_bits
        ) AS named
        CROSS JOIN LATERAL (
          SELECT CASE
            WHEN reported.event_type IN ('invoice.cancelled', 'cancelled') THEN 'cancelled'
            WHEN reported.event_type IN ('invoice.credited', 'invoice.credit', 'credited') THEN 'credited'
            WHEN reported.event_type IN ('invoice.disputed', 'disputed') THEN 'disputed'
            -- A recognized explicit event type has priority over a payload fallback.
            WHEN reported.event_type IN (
              'invoice.registered', 'invoice.created', 'invoice.paid', 'invoice.payment', 'invoice.partially_paid',
              'invoice.unpaid', 'invoice.overdue', 'invoice.reminder', 'invoice.reminder_sent', 'invoice.collection',
              'registered', 'paid', 'partially_paid', 'unpaid', 'overdue', 'reminder_sent', 'collection'
            ) THEN NULL
            WHEN named.status_type IN ('invoice.cancelled', 'cancelled') THEN 'cancelled'
            WHEN named.status_type IN ('invoice.credited', 'invoice.credit', 'credited') THEN 'credited'
            WHEN named.status_type IN ('invoice.disputed', 'disputed') THEN 'disputed'
            -- Paid and dunning flags precede the Capway credit flag.
            WHEN (named.status_bits & 29) = 0 AND (named.status_bits & 64) = 64 THEN 'credited'
          END AS terminal_state
        ) AS candidate
        WHERE event.company_id = i.company_id AND event.provider = i.provider AND event.environment = i.environment
          AND event.matched_invoice_export_item_id = i.id AND event.provider_invoice_guid = i.provider_invoice_guid
          AND event.idempotency_hash = event.provider || ':' || event.environment || ':' || event.provider_event_id
          AND event.status IN ('received', 'processing', 'failed')
          AND candidate.terminal_state IS NOT NULL
          AND NOT (coalesce(i.provider_status, '') = 'paid' AND candidate.terminal_state = 'cancelled')
      )
  )
$evidence$;

  -- The final snapshot must also serialize with the publication and progression
  -- of signed evidence, including inserts that did not yet reach the export item.
CREATE OR REPLACE FUNCTION public.gridex_reconcile_invoice_dispatch_period_v1(p_company uuid, p_month text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $reconcile$
DECLARE
  job gridex_invoice_dispatch_period.jobs%ROWTYPE;
  status_result text := 'pending';
  reason_result text;
  prior_period jsonb;
  receipt jsonb;
  year_number int;
  month_number int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'invoice_dispatch_period_service_role_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO job FROM gridex_invoice_dispatch_period.jobs j
  WHERE j.company_id = p_company AND j.billing_month = p_month FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF job.status <> 'pending' THEN RETURN jsonb_build_object('billingMonth', p_month, 'status', job.status, 'reason', job.reason); END IF;
  year_number := left(p_month, 4)::int;
  month_number := right(p_month, 2)::int;

  BEGIN
    PERFORM c.id FROM public.companies c WHERE c.id = p_company AND c.status IN ('active', 'onboarding') FOR SHARE NOWAIT;
    IF NOT FOUND THEN
      UPDATE gridex_invoice_dispatch_period.jobs SET reason = 'company_not_operational',
        next_attempt_at = now() + interval '10 minutes', updated_at = now()
      WHERE company_id = p_company AND billing_month = p_month;
      RETURN jsonb_build_object('billingMonth', p_month, 'status', 'pending', 'reason', 'company_not_operational');
    END IF;
    -- A pending provider should not contend with active billing publishers.
    -- This inexpensive precheck does not authorize a lock or a terminal result.
    IF NOT EXISTS (SELECT FROM public.invoice_export_items i
      JOIN public.invoice_export_runs r ON r.company_id = i.company_id AND r.id = i.export_run_id
      WHERE i.company_id = p_company AND r.billing_month = p_month AND r.environment = 'production'
        AND i.environment = r.environment AND i.provider = 'capway_aptic' AND i.provider_reconciliation_status = 'confirmed') THEN
      UPDATE gridex_invoice_dispatch_period.jobs SET reason = 'waiting_for_qualified_evidence',
        next_attempt_at = now() + interval '10 minutes', updated_at = now()
      WHERE company_id = p_company AND billing_month = p_month;
      RETURN jsonb_build_object('billingMonth', p_month, 'status', 'pending', 'reason', 'waiting_for_qualified_evidence');
    END IF;

    -- Preserve complete eligibility sets, including an insertion concurrent with qualification.
    LOCK TABLE public.billing_underlays, public.invoice_export_items, public.invoice_export_runs,
      public.customer_invoices, public.invoice_export_attempts, public.invoice_provider_events,
      public.billing_provider_webhook_events, public.billing_provider_connections IN SHARE MODE NOWAIT;
    PERFORM l.id FROM public.billing_period_locks l WHERE l.company_id = p_company
      AND l.billing_year = year_number AND l.billing_month = month_number FOR UPDATE;
    prior_period := gridex_invoice_dispatch_period.period_snapshot(p_company, p_month);
    IF prior_period ->> 'status' = 'reopened' OR prior_period ->> 'unlockedAt' IS NOT NULL
      OR prior_period IS DISTINCT FROM job.expected_period THEN
      status_result := 'superseded'; reason_result := 'period_revision_changed';
    ELSIF prior_period ->> 'status' IN ('locked', 'exported', 'closed')
      OR EXISTS (SELECT FROM public.price_period_locks p WHERE p.company_id = p_company AND p.billing_month = p_month
        AND p.lock_scope IN ('billing_period', 'invoice_export') AND p.status = 'locked') THEN
      status_result := 'already_locked'; reason_result := 'existing_period_lock';
    ELSIF NOT EXISTS (SELECT FROM public.billing_underlays u WHERE u.company_id = p_company
         AND u.underlay_year = year_number AND u.underlay_month = month_number)
      OR EXISTS (SELECT FROM public.billing_underlays u WHERE u.company_id = p_company
         AND u.underlay_year = year_number AND u.underlay_month = month_number
         AND (u.status IS DISTINCT FROM 'validated' OR u.readiness_status IS DISTINCT FROM 'ready'
          OR NOT gridex_invoice_dispatch_period.has_verified_attempt(p_company, u.id, p_month))) THEN
      reason_result := 'waiting_for_qualified_evidence';
    ELSE
      IF prior_period IS NULL THEN
        INSERT INTO public.billing_period_locks(company_id, billing_year, billing_month, status)
        VALUES(p_company, year_number, month_number, 'open') ON CONFLICT (company_id, billing_year, billing_month) DO NOTHING;
        IF NOT FOUND THEN RAISE EXCEPTION 'invoice_dispatch_period_concurrent_change' USING ERRCODE = '40001'; END IF;
      END IF;
      receipt := public.gridex_set_billing_period_lock_v1(p_company, p_month, true, 'exported', job.actor_id,
        'Fakturaperioden är avstämd mot verifierade leveranskvitton.',
        jsonb_build_object('locked_by_flow', 'invoice_export', 'dispatch_export_item_id', job.first_export_item_id));
      IF receipt #>> '{lock,status}' IS DISTINCT FROM 'exported' OR receipt ->> 'auto_lock_status' = 'preserved' THEN
        RAISE EXCEPTION 'invoice_dispatch_period_compare_and_set_failed' USING ERRCODE = '40001';
      END IF;
      status_result := 'locked'; reason_result := 'verified_delivery_receipts';
    END IF;
  EXCEPTION WHEN lock_not_available THEN
    reason_result := 'producer_busy';
  WHEN OTHERS THEN
    status_result := 'pending'; reason_result := 'reconcile_failed';
  END;

  UPDATE gridex_invoice_dispatch_period.jobs SET status = status_result, reason = reason_result,
    next_attempt_at = now() + interval '10 minutes', updated_at = now()
  WHERE company_id = p_company AND billing_month = p_month;
  RETURN jsonb_build_object('billingMonth', p_month, 'status', status_result, 'reason', reason_result);
END;
$reconcile$;

  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc WHERE oid = verifier)
      IS DISTINCT FROM '8f750717a85802735cb4a30ecde915c1eda16dffbfa6ba55f07b416ebffbfcff'
    OR (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc WHERE oid = period_owner)
      IS DISTINCT FROM 'a3fe69a4f978d879b9014896394869a5ca3dc7dde4dcd8cf121f6850ab0b7edf' THEN
    RAISE EXCEPTION 'invoice_dispatch_period_signed_event_install_failed' USING ERRCODE = '55000';
  END IF;
END;
$migration$;
