DO $migration$
BEGIN
CREATE SCHEMA gridex_invoice_dispatch_period;
REVOKE ALL ON SCHEMA gridex_invoice_dispatch_period FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE gridex_invoice_dispatch_period.jobs (
  company_id uuid NOT NULL,
  billing_month text NOT NULL CHECK (billing_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  actor_id uuid NOT NULL,
  first_export_item_id uuid NOT NULL,
  expected_period jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'locked', 'already_locked', 'superseded')),
  reason text NOT NULL DEFAULT 'waiting_for_qualified_evidence',
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, billing_month)
);
ALTER TABLE gridex_invoice_dispatch_period.jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gridex_invoice_dispatch_period.jobs FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX invoice_dispatch_period_jobs_due_idx ON gridex_invoice_dispatch_period.jobs (next_attempt_at, company_id, billing_month)
  WHERE status = 'pending';

CREATE FUNCTION gridex_invoice_dispatch_period.period_snapshot(p_company uuid, p_month text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = pg_catalog AS $period$
  SELECT jsonb_build_object('id', l.id, 'status', l.status, 'unlockedAt', l.unlocked_at,
    'updatedAt', l.updated_at, 'version', l.xmin::text)
  FROM public.billing_period_locks l
  WHERE l.company_id = p_company AND l.billing_year = left(p_month, 4)::int AND l.billing_month = right(p_month, 2)::int
$period$;
REVOKE ALL ON FUNCTION gridex_invoice_dispatch_period.period_snapshot(uuid,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION gridex_invoice_dispatch_period.has_verified_attempt(p_company uuid, p_underlay uuid, p_month text)
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
      AND i.provider_confirmed_at IS NOT NULL AND i.sent_at IS NOT NULL
      AND nullif(btrim(i.provider_invoice_guid), '') IS NOT NULL
      AND c.partner_invoice_reference = i.provider_invoice_guid
      AND a.outcome = 'sent' AND a.finished_at IS NOT NULL AND a.http_status BETWEEN 200 AND 299
      AND a.idempotency_key = i.provider_idempotency_key AND a.request_hash ~ '^[a-f0-9]{64}$'
  )
$evidence$;
REVOKE ALL ON FUNCTION gridex_invoice_dispatch_period.has_verified_attempt(uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.gridex_queue_invoice_dispatch_period_v1(p_company uuid, p_item uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $queue$
DECLARE
  scope record;
  job gridex_invoice_dispatch_period.jobs%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'invoice_dispatch_period_service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN RETURN NULL; END IF;
  SELECT i.id, r.billing_month INTO scope
  FROM public.invoice_export_items i
  JOIN public.invoice_export_runs r ON r.company_id = i.company_id AND r.id = i.export_run_id
  JOIN public.customer_invoices c ON c.company_id = i.company_id AND c.invoice_export_item_id = i.id
  WHERE i.company_id = p_company AND i.id = p_item AND i.status = 'sent'
    AND r.environment = 'production' AND i.environment = r.environment
    AND i.provider = 'capway_aptic' AND i.provider_confirmed_at IS NOT NULL AND i.sent_at IS NOT NULL
    AND nullif(btrim(i.provider_invoice_guid), '') IS NOT NULL AND c.partner_invoice_reference = i.provider_invoice_guid
    AND c.status IN ('sent', 'paid', 'overdue') AND r.billing_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$';
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO gridex_invoice_dispatch_period.jobs(company_id, billing_month, actor_id, first_export_item_id, expected_period)
  VALUES (p_company, scope.billing_month, p_actor, scope.id, gridex_invoice_dispatch_period.period_snapshot(p_company, scope.billing_month))
  ON CONFLICT (company_id, billing_month) DO NOTHING;
  SELECT * INTO job FROM gridex_invoice_dispatch_period.jobs j WHERE j.company_id = p_company AND j.billing_month = scope.billing_month;
  RETURN jsonb_build_object('billingMonth', job.billing_month, 'status', job.status, 'reason', job.reason);
END;
$queue$;
REVOKE ALL ON FUNCTION public.gridex_queue_invoice_dispatch_period_v1(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_queue_invoice_dispatch_period_v1(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION gridex_invoice_dispatch_period.enqueue_from_attempt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $attempt$
DECLARE
  actor text;
BEGIN
  IF NEW.idempotency_key IS NULL OR NEW.finished_at IS NULL OR NEW.http_status IS NULL OR NEW.http_status NOT BETWEEN 200 AND 299
    OR auth.role() IS DISTINCT FROM 'service_role' THEN RETURN NEW; END IF;
  SELECT i.metadata #>> '{approval,approved_by}' INTO actor FROM public.invoice_export_items i
  WHERE i.company_id = NEW.company_id AND i.id = NEW.invoice_export_item_id AND i.export_run_id = NEW.export_run_id
    AND i.status = 'sent' AND i.provider = 'capway_aptic' AND i.environment = 'production'
    AND i.attempt_count = NEW.attempt_no AND i.provider_idempotency_key = NEW.idempotency_key;
  IF actor ~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN
    PERFORM public.gridex_queue_invoice_dispatch_period_v1(NEW.company_id, NEW.invoice_export_item_id, actor::uuid);
  END IF;
  RETURN NEW;
END;
$attempt$;
REVOKE ALL ON FUNCTION gridex_invoice_dispatch_period.enqueue_from_attempt() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER gridex_queue_invoice_dispatch_period_after_attempt
AFTER INSERT ON public.invoice_export_attempts FOR EACH ROW WHEN (NEW.outcome = 'sent')
EXECUTE FUNCTION gridex_invoice_dispatch_period.enqueue_from_attempt();

CREATE FUNCTION public.gridex_read_invoice_dispatch_period_v1(p_company uuid, p_month text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $read$
DECLARE result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'invoice_dispatch_period_service_role_required' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object('billingMonth', j.billing_month, 'status', j.status, 'reason', j.reason,
    'currentPeriodStatus', gridex_invoice_dispatch_period.period_snapshot(p_company, p_month)->>'status')
  INTO result FROM gridex_invoice_dispatch_period.jobs j
  WHERE j.company_id = p_company AND j.billing_month = p_month;
  RETURN result;
END;
$read$;
REVOKE ALL ON FUNCTION public.gridex_read_invoice_dispatch_period_v1(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_read_invoice_dispatch_period_v1(uuid,text) TO service_role;

CREATE FUNCTION public.gridex_list_due_invoice_dispatch_periods_v1(p_limit integer DEFAULT 10)
RETURNS TABLE (company_id uuid, billing_month text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $due$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'invoice_dispatch_period_service_role_required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT j.company_id, j.billing_month FROM gridex_invoice_dispatch_period.jobs j
    WHERE j.status = 'pending' AND j.next_attempt_at <= now()
    ORDER BY j.next_attempt_at, j.company_id, j.billing_month LIMIT greatest(1, least(coalesce(p_limit, 10), 20));
END;
$due$;
REVOKE ALL ON FUNCTION public.gridex_list_due_invoice_dispatch_periods_v1(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_list_due_invoice_dispatch_periods_v1(integer) TO service_role;

CREATE FUNCTION public.gridex_reconcile_invoice_dispatch_period_v1(p_company uuid, p_month text)
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
      public.customer_invoices, public.invoice_export_attempts IN SHARE MODE NOWAIT;
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
REVOKE ALL ON FUNCTION public.gridex_reconcile_invoice_dispatch_period_v1(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_reconcile_invoice_dispatch_period_v1(uuid,text) TO service_role;
END;
$migration$;
