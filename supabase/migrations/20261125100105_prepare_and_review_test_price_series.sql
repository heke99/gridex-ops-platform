-- Private TEST candidate downstream of 100104. Production numbering and export stay separate.
CREATE TABLE gridex_billing_source.price_series_invoice_drafts (
  company_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  invoice_id uuid NOT NULL UNIQUE REFERENCES public.customer_invoices(id),
  review_hash text NOT NULL CHECK (review_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (company_id, reservation_id),
  FOREIGN KEY (company_id, reservation_id)
    REFERENCES gridex_billing_source.price_series_reservations(company_id, id)
);

CREATE TABLE gridex_billing_source.price_series_invoice_approvals (
  company_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  review_hash text NOT NULL CHECK (review_hash ~ '^[0-9a-f]{64}$'),
  approved_by uuid NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (company_id, reservation_id),
  FOREIGN KEY (company_id, reservation_id)
    REFERENCES gridex_billing_source.price_series_invoice_drafts(company_id, reservation_id)
);

REVOKE ALL ON TABLE gridex_billing_source.price_series_invoice_drafts, gridex_billing_source.price_series_invoice_approvals
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION gridex_billing_source.require_test_price_series_actor_v1(p_company uuid,p_actor uuid) RETURNS void
LANGUAGE plpgsql SET search_path TO pg_catalog AS $function$
BEGIN
  IF public.gridex_actor_has_company_permission(p_actor,p_company,'billing_underlay.export') IS NOT TRUE THEN
    RAISE EXCEPTION 'invoice_price_series_review_forbidden' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.companies c WHERE c.id=p_company AND c.is_active
    AND c.status='active' AND c.invoice_export_target_system='file_export'
    AND c.billing_provider_environment='test' AND c.invoice_export_enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_price_series_test_provider_required' USING ERRCODE='23514'; END IF;
END
$function$;

CREATE FUNCTION gridex_billing_source.prepare_test_price_series_invoice_v1(
  p_company uuid,p_actor uuid,p_customer uuid,p_contract uuid,p_site uuid,p_point uuid,p_month text,p_expected jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog AS $function$
DECLARE
  token jsonb;
  reservation gridex_billing_source.price_series_reservations%ROWTYPE;
  draft gridex_billing_source.price_series_invoice_drafts%ROWTYPE;
  new_invoice uuid:=gen_random_uuid();
  snapshot jsonb;
  snapshot_hash text;
  tax numeric;
  gross numeric;
  rates integer;
  exact_tax boolean;
BEGIN
  PERFORM gridex_billing_source.require_test_price_series_actor_v1(p_company,p_actor);
  token:=gridex_billing_source.reserve_price_series_v1(p_company,p_customer,p_contract,p_site,p_point,p_month,p_expected);
  IF EXISTS(SELECT 1 FROM public.customer_contracts c WHERE c.company_id=p_company AND c.id=p_contract
    AND (c.consolidated_invoice IS TRUE OR c.export_blocked IS TRUE)) THEN
    RAISE EXCEPTION 'invoice_price_series_separate_billing_required' USING ERRCODE='23514';
  END IF;
  SELECT * INTO STRICT reservation FROM gridex_billing_source.price_series_reservations r
    WHERE r.company_id=p_company AND r.id=(token->>'id')::uuid FOR UPDATE;
  SELECT * INTO draft FROM gridex_billing_source.price_series_invoice_drafts d
    WHERE d.company_id=p_company AND d.reservation_id=reservation.id;
  IF FOUND THEN
    RETURN jsonb_build_object('invoiceId',draft.invoice_id,'reservationId',reservation.id,'reviewHash',draft.review_hash,'existing',true);
  END IF;

  PERFORM gridex_billing_source.assert_invoice_sources_uncorrected_v1(p_company,ARRAY(
    SELECT m.billing_underlay_id FROM gridex_billing_source.price_series_reservation_members m
    WHERE m.company_id=p_company AND m.reservation_id=reservation.id ORDER BY m.ordinal));
  PERFORM gridex_case_confirmation.require_underlay_invoice_open_v1(p_company,m.billing_underlay_id)
    FROM gridex_billing_source.price_series_reservation_members m WHERE m.company_id=p_company AND m.reservation_id=reservation.id;

  -- Restrict this TEST draft to existing locked totals for which aggregation introduces no rounding choice.
  SELECT count(DISTINCT u.vat_rate),sum(p.vat_amount),sum(p.total_inc_vat),
    bool_and(coalesce(u.vat_rate BETWEEN 0 AND 1 AND p.total_ex_vat>=0 AND trunc(p.total_ex_vat,2)=p.total_ex_vat
      AND trunc(p.vat_amount,2)=p.vat_amount AND p.total_ex_vat*u.vat_rate=p.vat_amount
      AND p.total_ex_vat+p.vat_amount=p.total_inc_vat,false))
  INTO rates,tax,gross,exact_tax
  FROM gridex_billing_source.price_series_reservation_members m
  JOIN public.billing_underlays u ON u.id=m.billing_underlay_id AND u.company_id=m.company_id
  JOIN public.pricing_runs p ON p.id=m.pricing_run_id AND p.billing_underlay_id=u.id AND p.company_id=m.company_id
  WHERE m.company_id=p_company AND m.reservation_id=reservation.id;
  IF rates<>1 OR exact_tax IS NOT TRUE THEN RAISE EXCEPTION 'invoice_price_series_accounting_review_required' USING ERRCODE='23514'; END IF;

  snapshot:=jsonb_build_object('schema','gridex_same_meter_price_series_invoice_test_v1',
    'reservationId',reservation.id,'basisSha256',reservation.basis_sha256,'basis',reservation.basis,
    'vatAmount',tax,'amountIncVat',gross);
  snapshot_hash:=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');
  INSERT INTO public.customer_invoices(id,company_id,customer_id,contract_id,customer_contract_id,invoice_reference,
    period_start,period_end,total_kwh,consumption_kwh,amount_ex_vat,vat_amount,amount_inc_vat,currency,status,
    source_system,created_by,calculation_snapshot,calculation_snapshot_sha256)
  VALUES(new_invoice,p_company,p_customer,p_contract,p_contract,public.gridex_new_public_resource_reference('invoice'),
    ((reservation.basis#>>'{members,0,from}')::timestamptz AT TIME ZONE 'Europe/Stockholm')::date,
    ((reservation.basis#>>'{members,-1,until}')::timestamptz AT TIME ZONE 'Europe/Stockholm')::date,
    (reservation.basis->>'quantityKwh')::numeric,(reservation.basis->>'quantityKwh')::numeric,
    (reservation.basis->>'amountExVat')::numeric,tax,gross,'SEK','draft','invoice_price_series_test_v1',p_actor,snapshot,snapshot_hash);
  INSERT INTO gridex_billing_source.price_series_invoice_drafts(company_id,reservation_id,invoice_id,review_hash)
  VALUES(p_company,reservation.id,new_invoice,encode(sha256(convert_to(jsonb_build_array(
    p_company,reservation.id,new_invoice,snapshot_hash)::text,'UTF8')),'hex')) RETURNING * INTO draft;
  RETURN jsonb_build_object('invoiceId',draft.invoice_id,'reservationId',reservation.id,'reviewHash',draft.review_hash,'existing',false);
END
$function$;

CREATE FUNCTION gridex_billing_source.approve_test_price_series_invoice_v1(
  p_company uuid,p_actor uuid,p_invoice uuid,p_review_hash text
) RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog AS $function$
DECLARE
  reservation gridex_billing_source.price_series_reservations%ROWTYPE;
  draft gridex_billing_source.price_series_invoice_drafts%ROWTYPE;
  invoice public.customer_invoices%ROWTYPE;
  receipt gridex_billing_source.price_series_invoice_approvals%ROWTYPE;
  expected jsonb;
  member_ids uuid[];
  existing boolean;
BEGIN
  PERFORM gridex_billing_source.require_test_price_series_actor_v1(p_company,p_actor);
  SELECT * INTO draft FROM gridex_billing_source.price_series_invoice_drafts d
    WHERE d.company_id=p_company AND d.invoice_id=p_invoice;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_price_series_draft_missing' USING ERRCODE='P0002'; END IF;
  SELECT * INTO STRICT reservation FROM gridex_billing_source.price_series_reservations r
    WHERE r.company_id=p_company AND r.id=draft.reservation_id;
  SELECT * INTO invoice FROM public.customer_invoices i
    WHERE i.company_id=p_company AND i.customer_id=reservation.customer_id AND i.id=p_invoice;
  IF NOT FOUND OR invoice.status<>'draft' OR invoice.invoice_number IS NOT NULL OR invoice.source_system<>'invoice_price_series_test_v1'
    OR invoice.amount_ex_vat IS DISTINCT FROM (reservation.basis->>'amountExVat')::numeric
    OR invoice.vat_amount IS DISTINCT FROM (invoice.calculation_snapshot->>'vatAmount')::numeric
    OR invoice.amount_inc_vat IS DISTINCT FROM (invoice.calculation_snapshot->>'amountIncVat')::numeric
    OR invoice.total_kwh IS DISTINCT FROM (reservation.basis->>'quantityKwh')::numeric
    OR invoice.calculation_snapshot->>'basisSha256' IS DISTINCT FROM reservation.basis_sha256
    OR invoice.calculation_snapshot->'basis' IS DISTINCT FROM reservation.basis
    OR invoice.calculation_snapshot_sha256 IS DISTINCT FROM encode(sha256(convert_to(invoice.calculation_snapshot::text,'UTF8')),'hex')
    OR draft.review_hash IS DISTINCT FROM encode(sha256(convert_to(jsonb_build_array(
      p_company,reservation.id,p_invoice,invoice.calculation_snapshot_sha256)::text,'UTF8')),'hex')
    OR p_review_hash IS DISTINCT FROM draft.review_hash
  THEN RAISE EXCEPTION 'invoice_price_series_review_changed' USING ERRCODE='23514'; END IF;

  SELECT * INTO receipt FROM gridex_billing_source.price_series_invoice_approvals a
    WHERE a.company_id=p_company AND a.reservation_id=reservation.id;
  existing:=FOUND;
  IF NOT existing THEN
    SELECT jsonb_agg(jsonb_build_object('underlayId',m.billing_underlay_id,'pricingRunId',m.pricing_run_id) ORDER BY m.ordinal),
      array_agg(m.billing_underlay_id ORDER BY m.ordinal)
    INTO expected,member_ids FROM gridex_billing_source.price_series_reservation_members m
    WHERE m.company_id=p_company AND m.reservation_id=reservation.id;
    BEGIN
      PERFORM gridex_billing_source.reserve_price_series_v1(p_company,reservation.customer_id,reservation.contract_id,
        reservation.site_id,reservation.metering_point_id,reservation.billing_month,expected);
    EXCEPTION WHEN SQLSTATE 'PT409' THEN
      RAISE EXCEPTION 'price_timeline_invoice_review_required' USING ERRCODE='23514';
    END;
  IF EXISTS(SELECT 1 FROM public.customer_contracts c WHERE c.company_id=p_company AND c.id=reservation.contract_id
    AND (c.consolidated_invoice IS TRUE OR c.export_blocked IS TRUE)) THEN
    RAISE EXCEPTION 'invoice_price_series_separate_billing_required' USING ERRCODE='23514';
  END IF;
    PERFORM gridex_billing_source.assert_invoice_sources_uncorrected_v1(p_company,member_ids);
    PERFORM gridex_case_confirmation.require_underlay_invoice_open_v1(p_company,member) FROM unnest(member_ids) member;
    SELECT * INTO receipt FROM gridex_billing_source.price_series_invoice_approvals a
      WHERE a.company_id=p_company AND a.reservation_id=reservation.id;
    existing:=FOUND;
    IF NOT existing THEN
      INSERT INTO gridex_billing_source.price_series_invoice_approvals(company_id,reservation_id,review_hash,approved_by)
      VALUES(p_company,reservation.id,p_review_hash,p_actor) RETURNING * INTO receipt;
    END IF;
  END IF;
  IF receipt.review_hash IS DISTINCT FROM draft.review_hash THEN
    RAISE EXCEPTION 'invoice_price_series_review_changed' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('invoiceId',p_invoice,'reviewHash',receipt.review_hash,'approvedBy',receipt.approved_by,
    'approvedAt',receipt.approved_at,'existing',existing);
END
$function$;

REVOKE ALL ON FUNCTION gridex_billing_source.require_test_price_series_actor_v1(uuid,uuid),
  gridex_billing_source.prepare_test_price_series_invoice_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb),
  gridex_billing_source.approve_test_price_series_invoice_v1(uuid,uuid,uuid,text)
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION gridex_billing_source.protect_test_price_series_draft_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $function$
BEGIN
  IF EXISTS(SELECT FROM gridex_billing_source.price_series_invoice_drafts d
    WHERE d.company_id=OLD.company_id AND d.invoice_id=OLD.id) THEN
    RAISE EXCEPTION 'invoice_price_series_draft_requires_series_workflow' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION gridex_billing_source.protect_test_price_series_draft_v1()
FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER price_series_draft_write_guard
BEFORE UPDATE OR DELETE ON public.customer_invoices FOR EACH ROW
EXECUTE FUNCTION gridex_billing_source.protect_test_price_series_draft_v1();
CREATE FUNCTION public.gridex_prepare_test_price_series_by_underlays_v1(
  p_company_id uuid,p_actor_user_id uuid,p_billing_month text,p_underlay_ids uuid[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $function$
DECLARE
  scope public.billing_underlays%ROWTYPE;
  expected jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'invoice_price_series_service_role_required' USING ERRCODE='42501';
  END IF;
  IF coalesce(cardinality(p_underlay_ids),0) NOT BETWEEN 2 AND 32 OR array_position(p_underlay_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invoice_price_series_scope_required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO scope FROM public.billing_underlays WHERE company_id=p_company_id AND id=p_underlay_ids[1];
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_price_series_source_changed' USING ERRCODE='23514'; END IF;
  SELECT jsonb_agg(jsonb_build_object('underlayId',u.id,'pricingRunId',r.id) ORDER BY u.billing_period_start,u.billing_period_end,u.id)
    INTO expected FROM public.billing_underlays u
    JOIN public.pricing_runs r ON r.company_id=u.company_id AND r.billing_underlay_id=u.id AND r.status='locked' AND r.locked_at IS NOT NULL
    WHERE u.company_id=p_company_id AND u.id=ANY(p_underlay_ids) AND u.customer_id=scope.customer_id
      AND coalesce(u.customer_contract_id,u.contract_id)=coalesce(scope.customer_contract_id,scope.contract_id)
      AND coalesce(u.customer_site_id,u.site_id)=coalesce(scope.customer_site_id,scope.site_id)
      AND u.metering_point_id=scope.metering_point_id;
  IF jsonb_array_length(expected) IS DISTINCT FROM cardinality(p_underlay_ids) THEN
    RAISE EXCEPTION 'invoice_price_series_source_changed' USING ERRCODE='23514';
  END IF;
  BEGIN
    RETURN gridex_billing_source.prepare_test_price_series_invoice_v1(p_company_id,p_actor_user_id,scope.customer_id,
      coalesce(scope.customer_contract_id,scope.contract_id),coalesce(scope.customer_site_id,scope.site_id),scope.metering_point_id,
      p_billing_month,expected);
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    RAISE EXCEPTION 'price_timeline_invoice_review_required' USING ERRCODE='23514';
  END;
END
$function$;
REVOKE ALL ON FUNCTION public.gridex_prepare_test_price_series_by_underlays_v1(uuid,uuid,text,uuid[])
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_prepare_test_price_series_by_underlays_v1(uuid,uuid,text,uuid[]) TO service_role;

CREATE FUNCTION gridex_billing_source.list_test_price_series_reviews_v1(p_company uuid,p_month text,p_customer uuid,p_after uuid)
RETURNS jsonb LANGUAGE sql SET search_path TO pg_catalog AS $function$
  SELECT coalesce(jsonb_agg(result ORDER BY result->>'invoiceId'),'[]'::jsonb) FROM (
    SELECT jsonb_build_object('companyId',d.company_id,'customerId',r.customer_id,'billingMonth',r.billing_month,
      'invoiceId',i.id,'invoiceNumber',NULL,'reviewHash',d.review_hash,'canIssue',false,'reviewType','test_price_series',
      'status',CASE WHEN a.reservation_id IS NULL THEN 'pending_review' ELSE 'approved' END,
      'currency',i.currency,'totalAmount',i.amount_inc_vat,
      'customerName',coalesce(nullif(c.full_name,''),nullif(c.company_name,''),c.customer_number),
      'sources',(SELECT jsonb_agg(jsonb_build_object('underlayId',u.id,'siteId',r.site_id,'facilityReference',NULL,
        'priceArea',u.price_area,'periodStart',u.billing_period_start,'periodEnd',u.billing_period_end,
        'quantityKwh',u.total_kwh,'totalAmount',pr.total_inc_vat) ORDER BY m.ordinal)
      FROM gridex_billing_source.price_series_reservation_members m
      JOIN public.billing_underlays u ON u.company_id=m.company_id AND u.id=m.billing_underlay_id
      JOIN public.pricing_runs pr ON pr.company_id=m.company_id AND pr.id=m.pricing_run_id
      WHERE m.company_id=d.company_id AND m.reservation_id=d.reservation_id)) AS result
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
REVOKE ALL ON FUNCTION gridex_billing_source.list_test_price_series_reviews_v1(uuid,text,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

DO $patch_existing_review_rpc$
DECLARE
  approve constant regprocedure := 'public.gridex_approve_consolidated_invoice_draft_v1(uuid,uuid,uuid,text)'::regprocedure;
  list_reviews constant regprocedure := 'public.gridex_list_consolidated_invoice_reviews_v1(uuid,text,uuid,uuid)'::regprocedure;
  approve_at constant text := ' SELECT * INTO grouped FROM gridex_invoice_groups.drafts g';
  approve_test constant text := $approve$ IF EXISTS(SELECT FROM gridex_billing_source.price_series_invoice_drafts d
   WHERE d.company_id=p_company_id AND d.invoice_id=p_invoice_id) THEN
   RETURN gridex_billing_source.approve_test_price_series_invoice_v1(p_company_id,p_actor_user_id,p_invoice_id,p_review_hash);
 END IF;
$approve$;
  list_at constant text := '  RETURN items;';
  list_test constant text := $list$  SELECT coalesce(jsonb_agg(row ORDER BY row->>'invoiceId'),'[]'::jsonb) INTO items FROM (
    SELECT row FROM jsonb_array_elements(items || gridex_billing_source.list_test_price_series_reviews_v1(
      p_company_id,p_billing_month,p_customer_id,p_after_invoice_id)) row ORDER BY row->>'invoiceId' LIMIT 21
  ) combined;
  RETURN items;$list$;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=approve) IS DISTINCT FROM '340694132b12f705ef9085fc6d487f5d'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=list_reviews) IS DISTINCT FROM '7b16eced7588f7d58e7d027bb1157638'
  THEN RAISE EXCEPTION 'invoice_price_series_review_predecessor_changed'; END IF;
  EXECUTE replace(pg_get_functiondef(approve),approve_at,approve_test||approve_at);
  EXECUTE replace(pg_get_functiondef(list_reviews),list_at,list_test);
END
$patch_existing_review_rpc$;
