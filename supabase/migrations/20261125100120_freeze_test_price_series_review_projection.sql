-- Keep the TEST review dates, amounts and quantities aligned with the hashed
-- reservation even when the underlying month has been reopened for repricing.
-- Display metadata and all issuance gates keep their existing owners.
DO $price_series_review$
DECLARE
  owner constant regprocedure := 'gridex_billing_source.list_test_price_series_reviews_v1(uuid,text,uuid,uuid)'::regprocedure;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=owner) NOT IN ('d9d61b8f80d7d5ec6792333f6a2c94fc','b34504060d34cde6d0c1211a5a4ed5a1') THEN
    RAISE EXCEPTION 'price_series_review_projection_predecessor_changed';
  END IF;
END
$price_series_review$;

CREATE OR REPLACE FUNCTION gridex_billing_source.list_test_price_series_reviews_v1(p_company uuid,p_month text,p_customer uuid,p_after uuid)
RETURNS jsonb LANGUAGE sql SET search_path TO pg_catalog AS $function$
  SELECT coalesce(jsonb_agg(result ORDER BY result->>'invoiceId'),'[]'::jsonb) FROM (
    SELECT jsonb_build_object('companyId',d.company_id,'customerId',r.customer_id,'billingMonth',r.billing_month,
      'invoiceId',i.id,'invoiceNumber',NULL,'reviewHash',d.review_hash,'canIssue',false,'reviewType','test_price_series',
      'status',CASE WHEN a.reservation_id IS NULL THEN 'pending_review' ELSE 'approved' END,
      'currency',i.currency,'totalAmount',i.amount_inc_vat,
      'customerName',coalesce(nullif(c.full_name,''),nullif(c.company_name,''),c.customer_number),
      'sources',(SELECT jsonb_agg(jsonb_build_object('underlayId',u.id,'siteId',r.site_id,'facilityReference',NULL,
        'priceArea',u.price_area,
        'periodStart',((frozen.member->>'from')::timestamptz AT TIME ZONE 'Europe/Stockholm')::date,
        'periodEnd',((frozen.member->>'until')::timestamptz AT TIME ZONE 'Europe/Stockholm')::date,
        'quantityKwh',(frozen.member->>'quantityKwh')::numeric,
        'totalAmount',(frozen.member->>'lockedAmountIncVat')::numeric) ORDER BY m.ordinal)
      FROM gridex_billing_source.price_series_reservation_members m
      JOIN public.billing_underlays u ON u.company_id=m.company_id AND u.id=m.billing_underlay_id
      CROSS JOIN LATERAL (SELECT r.basis->'members'->(m.ordinal-1) AS member) frozen
      WHERE m.company_id=d.company_id AND m.reservation_id=d.reservation_id
        AND frozen.member->>'underlayId'=m.billing_underlay_id::text
        AND frozen.member->>'pricingRunId'=m.pricing_run_id::text)) AS result
    FROM gridex_billing_source.price_series_invoice_drafts d
    JOIN gridex_billing_source.price_series_reservations r ON r.company_id=d.company_id AND r.id=d.reservation_id
    JOIN public.customer_invoices i ON i.company_id=d.company_id AND i.id=d.invoice_id AND i.customer_id=r.customer_id
    JOIN public.customers c ON c.company_id=r.company_id AND c.id=r.customer_id
    JOIN public.companies co ON co.id=r.company_id AND co.billing_provider_environment='test' AND co.invoice_export_target_system='file_export'
    LEFT JOIN gridex_billing_source.price_series_invoice_approvals a ON a.company_id=d.company_id AND a.reservation_id=d.reservation_id
    WHERE d.company_id=p_company AND r.billing_month=p_month AND (p_customer IS NULL OR r.customer_id=p_customer)
      AND (p_after IS NULL OR d.invoice_id>p_after)
    ORDER BY d.invoice_id LIMIT 21
  ) reviews
$function$;
