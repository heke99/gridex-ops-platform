DO $migration$
BEGIN

CREATE FUNCTION public.gridex_create_capway_invoice_review_draft_v1(
  p_company_id uuid,p_run jsonb,p_items jsonb,p_invoices jsonb,p_enrichment jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $function$
DECLARE
  result jsonb;
  requested_item uuid := nullif(p_enrichment->>'invoice_export_item_id','')::uuid;
  persisted_run uuid;
  persisted_invoice uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'capway_review_draft_service_role_required' USING ERRCODE='42501';
  END IF;
  IF p_company_id IS NULL OR requested_item IS NULL
    OR p_run->>'provider' IS DISTINCT FROM 'capway_aptic'
    OR p_run->>'environment' IS NULL OR (p_run->>'environment') NOT IN ('test','production')
    OR p_run->'metadata'->>'source' IS DISTINCT FROM 'invoice_review_v1'
    OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_invoices) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'capway_review_draft_context_invalid' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_items)<>1 OR jsonb_array_length(p_invoices)<>1
    OR p_items#>>'{0,id}' IS DISTINCT FROM requested_item::text
    OR p_invoices#>>'{0,invoice_export_item_id}' IS DISTINCT FROM requested_item::text THEN
    RAISE EXCEPTION 'capway_review_draft_context_invalid' USING ERRCODE='22023';
  END IF;

  result:=public.gridex_create_invoice_review_draft_v1(p_company_id,p_run,p_items,p_invoices,p_enrichment);

  -- An idempotent replay may resolve to a draft created through the legacy
  -- endpoint. It must never certify that draft as new.
  IF result->'existing'='true'::jsonb THEN
    RETURN result;
  END IF;
  IF result->'existing' IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'capway_review_draft_creation_unconfirmed' USING ERRCODE='23514';
  END IF;
  persisted_run:=(result->>'run_id')::uuid;
  persisted_invoice:=(result->>'invoice_id')::uuid;

  INSERT INTO gridex_capway_dispatch.new_items(company_id,item_id,run_id,underlay_id,pricing_run_id,producer_version,invoice_id)
  SELECT i.company_id,i.id,i.export_run_id,i.billing_underlay_id,i.pricing_run_id,1,m.id
    FROM public.invoice_export_items i
    JOIN public.invoice_export_runs r ON r.company_id=i.company_id AND r.id=i.export_run_id
    JOIN public.customer_invoices m ON m.company_id=i.company_id AND m.invoice_export_item_id=i.id
    WHERE i.company_id=p_company_id AND i.id=requested_item AND r.id=persisted_run AND m.id=persisted_invoice
      AND i.provider='capway_aptic' AND r.provider=i.provider
      AND i.environment=p_run->>'environment' AND r.environment=i.environment
      AND r.metadata->>'source'='invoice_review_v1'
      AND i.status='pending' AND i.attempt_count=0
      AND i.export_file_id IS NULL AND i.provider_invoice_guid IS NULL AND i.provider_invoice_id IS NULL
      AND i.billing_underlay_id IS NOT NULL AND i.pricing_run_id IS NOT NULL
      AND m.billing_underlay_id=i.billing_underlay_id AND m.status='draft' AND m.issued_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'capway_review_draft_receipt_missing' USING ERRCODE='23514';
  END IF;
  RETURN result;
END
$function$;
REVOKE ALL ON FUNCTION public.gridex_create_capway_invoice_review_draft_v1(uuid,jsonb,jsonb,jsonb,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_create_capway_invoice_review_draft_v1(uuid,jsonb,jsonb,jsonb,jsonb)
  TO service_role;

NOTIFY pgrst,'reload schema';

END
$migration$;
