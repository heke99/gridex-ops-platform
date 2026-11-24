DO $migration$
DECLARE
  verifier regprocedure := to_regprocedure('gridex_invoice_dispatch_period.has_verified_attempt(uuid,uuid,text)');
BEGIN
  IF (SELECT encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex')
      FROM pg_catalog.pg_proc AS p WHERE p.oid = verifier) IS DISTINCT FROM 'ecf91ec9146f8e083f5c95a3e3ec1d22f8c3fb747f6041eb7b41e296d106d1c4' THEN
    RAISE EXCEPTION 'invoice_dispatch_period_verifier_preimage_required' USING ERRCODE = '55000';
  END IF;

  -- The signed export item may arrive before its portal mirror. A terminal
  -- provider outcome is authoritative even while the mirror still says sent.
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
  )
$evidence$;

  IF (SELECT encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex')
      FROM pg_catalog.pg_proc AS p WHERE p.oid = verifier) IS DISTINCT FROM 'f57c828ebc9601e5734f69ee08cd406bf464947e1582074387daf725ffec8892' THEN
    RAISE EXCEPTION 'invoice_dispatch_period_verifier_install_failed' USING ERRCODE = '55000';
  END IF;
END;
$migration$;
