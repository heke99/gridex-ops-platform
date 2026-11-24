DO $gridex_invoice_migration$
BEGIN

CREATE SCHEMA gridex_invoice_groups;
REVOKE ALL ON SCHEMA gridex_invoice_groups FROM PUBLIC;

CREATE TABLE gridex_invoice_groups.drafts (
  company_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  billing_month text NOT NULL,
  provider text NOT NULL,
  environment text NOT NULL,
  invoice_id uuid NOT NULL REFERENCES public.customer_invoices(id),
  intent jsonb NOT NULL,
  PRIMARY KEY (company_id,customer_id,billing_month),
  UNIQUE (company_id,invoice_id)
);
CREATE TABLE gridex_invoice_groups.sources (
  company_id uuid NOT NULL,
  billing_underlay_id uuid NOT NULL REFERENCES public.billing_underlays(id),
  invoice_id uuid NOT NULL REFERENCES public.customer_invoices(id),
  snapshot jsonb NOT NULL,
  PRIMARY KEY (company_id,billing_underlay_id)
);
CREATE INDEX invoice_group_sources_invoice_idx ON gridex_invoice_groups.sources(company_id,invoice_id);
ALTER TABLE gridex_invoice_groups.drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_invoice_groups.sources ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION gridex_invoice_groups.lock_source(p_company uuid,p_underlay uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_company::text || ':invoice-basis:' || p_underlay::text,0)) THEN
    RAISE EXCEPTION 'invoice_group_source_busy' USING ERRCODE='55P03';
  END IF;
END
$$;

-- Existing canonical and compatibility writers must also honor grouped reservations.
-- A legacy blocked row does not reserve a source until it becomes ready or is sent.
CREATE FUNCTION gridex_invoice_groups.fence_single()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
BEGIN
  IF NEW.billing_underlay_id IS NULL OR
    (TG_TABLE_NAME IN ('invoice_export_items','customer_invoices') AND NEW.status='cancelled') OR
    (TG_TABLE_NAME='billing_export_run_items' AND NEW.status='blocked') THEN
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND NEW.billing_underlay_id IS NOT DISTINCT FROM OLD.billing_underlay_id
    AND NEW.company_id=OLD.company_id AND NEW.status=OLD.status THEN
    RETURN NEW;
  END IF;
  PERFORM gridex_invoice_groups.lock_source(NEW.company_id,NEW.billing_underlay_id);
  IF EXISTS(SELECT FROM gridex_invoice_groups.sources s WHERE s.company_id=NEW.company_id
            AND s.billing_underlay_id=NEW.billing_underlay_id) THEN
    RAISE EXCEPTION 'invoice_group_source_already_reserved' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER invoice_group_canonical_source_guard BEFORE INSERT OR UPDATE OF company_id,billing_underlay_id,status
ON public.invoice_export_items FOR EACH ROW EXECUTE FUNCTION gridex_invoice_groups.fence_single();
CREATE TRIGGER invoice_group_legacy_source_guard BEFORE INSERT OR UPDATE OF company_id,billing_underlay_id,status
ON public.billing_export_run_items FOR EACH ROW EXECUTE FUNCTION gridex_invoice_groups.fence_single();
CREATE TRIGGER invoice_group_customer_invoice_source_guard BEFORE INSERT OR UPDATE OF company_id,billing_underlay_id,status
ON public.customer_invoices FOR EACH ROW EXECUTE FUNCTION gridex_invoice_groups.fence_single();

-- A grouped draft must be issued by the grouped approval/issue writer, not by an older client.
CREATE FUNCTION gridex_invoice_groups.protect_draft()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
BEGIN
  IF EXISTS(SELECT FROM gridex_invoice_groups.drafts WHERE company_id=OLD.company_id AND invoice_id=OLD.id) THEN
    RAISE EXCEPTION 'invoice_group_draft_requires_group_workflow' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER invoice_group_draft_write_guard BEFORE UPDATE OR DELETE ON public.customer_invoices
FOR EACH ROW EXECUTE FUNCTION gridex_invoice_groups.protect_draft();

CREATE FUNCTION public.gridex_prepare_consolidated_invoice_v1(
  p_company_id uuid, p_customer_id uuid, p_billing_month text, p_provider text, p_environment text,
  p_actor_user_id uuid, p_sources jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE
  company public.companies%ROWTYPE;
  customer public.customers%ROWTYPE;
  source jsonb;
  underlay public.billing_underlays%ROWTYPE;
  contract public.customer_contracts%ROWTYPE;
  site public.customer_sites%ROWTYPE;
  point public.metering_points%ROWTYPE;
  price public.pricing_runs%ROWTYPE;
  terms numeric;
  source_terms numeric;
  billing_configuration jsonb;
  price_snapshot public.contract_price_snapshots%ROWTYPE;
  series_key text;
  delivery jsonb;
  agreed_delivery jsonb;
  agreed_currency text;
  agreed_channel text;
  month_start date;
  selected_ids uuid[];
  current_ids uuid[];
  site_ids uuid[] := '{}';
  previous gridex_invoice_groups.drafts%ROWTYPE;
  invoice_id uuid := gen_random_uuid();
  document_snapshot jsonb;
  calculation jsonb;
  sources jsonb := '[]';
  intent jsonb;
  first_period date;
  last_period date;
  quantity numeric := 0;
  subtotal numeric := 0;
  vat numeric := 0;
  total numeric := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'invoice_group_service_role_required' USING ERRCODE='42501';
  END IF;
  IF p_company_id IS NULL OR p_customer_id IS NULL OR p_actor_user_id IS NULL OR
    coalesce(p_billing_month,'') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR
    nullif(p_provider,'') IS NULL OR coalesce(p_environment,'') NOT IN ('test','production') OR
    jsonb_typeof(p_sources) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invoice_group_input_invalid' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_sources) NOT BETWEEN 2 AND 100 THEN
    RAISE EXCEPTION 'invoice_group_source_count_invalid' USING ERRCODE='22023';
  END IF;
  month_start := (p_billing_month || '-01')::date;
  SELECT array_agg((value->>'underlayId')::uuid ORDER BY (value->>'underlayId')::uuid),
    jsonb_agg(value ORDER BY (value->>'underlayId')::uuid)
  INTO selected_ids,intent FROM jsonb_array_elements(p_sources);
  IF array_position(selected_ids,NULL) IS NOT NULL OR
    cardinality(selected_ids)<>(SELECT count(DISTINCT id) FROM unnest(selected_ids) id) THEN
    RAISE EXCEPTION 'invoice_group_source_count_invalid' USING ERRCODE='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':invoice-group:' ||
    p_customer_id::text || ':' || p_billing_month,0));
  SELECT * INTO previous FROM gridex_invoice_groups.drafts d WHERE d.company_id=p_company_id AND
    d.customer_id=p_customer_id AND d.billing_month=p_billing_month;
  IF FOUND AND (previous.intent IS DISTINCT FROM intent OR previous.provider IS DISTINCT FROM p_provider OR
      previous.environment IS DISTINCT FROM p_environment) THEN
    RAISE EXCEPTION 'invoice_group_changed_replay' USING ERRCODE='23505';
  END IF;

  SELECT * INTO company FROM public.companies WHERE id=p_company_id FOR SHARE;
  SELECT * INTO customer FROM public.customers WHERE id=p_customer_id AND company_id=p_company_id FOR SHARE;
  IF NOT FOUND OR company.invoice_export_target_system IS DISTINCT FROM p_provider OR
     company.billing_provider_environment IS DISTINCT FROM p_environment THEN
    RAISE EXCEPTION 'invoice_group_company_scope_mismatch' USING ERRCODE='23514';
  END IF;
  -- Rollout uses an explicit seller and existing series. Never auto-create an invoice series.
  IF company.billing_settings #>> '{invoice_profile,consolidation,issuer_company_id}' IS DISTINCT FROM p_company_id::text OR
     company.billing_settings #>> '{invoice_profile,consolidation,environment}' IS DISTINCT FROM p_environment THEN
    RAISE EXCEPTION 'invoice_group_issuer_series_missing' USING ERRCODE='23514';
  END IF;
  series_key := nullif(company.billing_settings #>> '{invoice_profile,consolidation,issuer_series_key}','');
  IF series_key IS NULL OR series_key IN ('application','contract') THEN
    RAISE EXCEPTION 'invoice_group_issuer_series_missing' USING ERRCODE='23514';
  END IF;

  SELECT array_agg(u.id ORDER BY u.id) INTO current_ids
  FROM public.billing_underlays u
  JOIN public.customer_contracts c ON c.company_id=u.company_id AND c.customer_id=u.customer_id
    AND c.id=coalesce(u.customer_contract_id,u.contract_id)
  WHERE u.company_id=p_company_id AND u.customer_id=p_customer_id
    AND u.underlay_year=extract(year from month_start) AND u.underlay_month=extract(month from month_start)
    AND c.consolidated_invoice IS TRUE AND u.energy_direction='consumption' AND u.settlement_type='invoice';
  IF current_ids IS DISTINCT FROM selected_ids THEN
    RAISE EXCEPTION 'invoice_group_selection_changed' USING ERRCODE='23514';
  END IF;

  FOR source IN SELECT value FROM jsonb_array_elements(intent) LOOP
    PERFORM gridex_invoice_groups.lock_source(p_company_id,(source->>'underlayId')::uuid);
    SELECT * INTO underlay FROM public.billing_underlays u WHERE u.company_id=p_company_id AND
      u.customer_id=p_customer_id AND u.id=(source->>'underlayId')::uuid FOR SHARE;
    IF NOT FOUND OR underlay.status<>'validated' OR underlay.readiness_status IS DISTINCT FROM 'ready' OR
       coalesce(underlay.missing_values_count,0)<>0 OR underlay.total_kwh IS NULL OR
       underlay.billing_period_start IS NULL OR underlay.billing_period_end IS NULL OR
       underlay.energy_direction<>'consumption' OR underlay.settlement_type<>'invoice' OR
       underlay.underlay_year IS DISTINCT FROM extract(year from month_start)::int OR
       underlay.underlay_month IS DISTINCT FROM extract(month from month_start)::int THEN
      RAISE EXCEPTION 'invoice_group_source_not_ready' USING ERRCODE='23514';
    END IF;
    SELECT * INTO contract FROM public.customer_contracts c WHERE c.company_id=p_company_id AND c.customer_id=p_customer_id
      AND c.id=coalesce(underlay.customer_contract_id,underlay.contract_id) FOR SHARE;
    IF NOT FOUND OR contract.consolidated_invoice IS NOT TRUE OR contract.export_blocked OR
      (underlay.contract_id IS NOT NULL AND underlay.contract_id<>contract.id) OR
      (source->>'contractUpdatedAt')::timestamptz IS DISTINCT FROM contract.updated_at OR
      (source->>'customerBillingProfileRevision')::bigint IS DISTINCT FROM customer.billing_profile_revision THEN
      RAISE EXCEPTION 'invoice_group_customer_choice_changed' USING ERRCODE='23514';
    END IF;
    SELECT * INTO site FROM public.customer_sites s WHERE s.company_id=p_company_id AND s.customer_id=p_customer_id
      AND s.id=coalesce(underlay.customer_site_id,underlay.site_id) FOR SHARE;
    IF NOT FOUND OR (underlay.site_id IS NOT NULL AND underlay.site_id<>site.id) OR
      (contract.site_id IS NOT NULL AND contract.site_id<>site.id) OR
      (contract.customer_site_id IS NOT NULL AND contract.customer_site_id<>site.id) OR
      (source->>'siteUpdatedAt')::timestamptz IS DISTINCT FROM site.updated_at THEN
      RAISE EXCEPTION 'invoice_group_site_mismatch' USING ERRCODE='23514';
    END IF;
    SELECT * INTO point FROM public.metering_points m WHERE m.company_id=p_company_id AND m.customer_id=p_customer_id
      AND m.id=underlay.metering_point_id AND coalesce(m.customer_site_id,m.site_id)=site.id FOR SHARE;
    IF NOT FOUND OR (point.site_id IS NOT NULL AND point.site_id<>site.id) OR
      (contract.metering_point_id IS NOT NULL AND contract.metering_point_id<>point.id) THEN
      RAISE EXCEPTION 'invoice_group_site_mismatch' USING ERRCODE='23514';
    END IF;
    SELECT * INTO price FROM public.pricing_runs r WHERE r.company_id=p_company_id AND r.billing_underlay_id=underlay.id
      AND r.id=(source->>'pricingRunId')::uuid AND r.status='locked' AND r.locked_at IS NOT NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invoice_group_price_not_locked' USING ERRCODE='23514'; END IF;
    SELECT * INTO price_snapshot FROM public.contract_price_snapshots s WHERE s.company_id=p_company_id AND s.contract_id=contract.id AND
      s.id=coalesce(underlay.contract_price_snapshot_id,underlay.pricing_snapshot_id,contract.contract_price_snapshot_id) FOR SHARE;
    IF NOT FOUND OR price_snapshot.invoice_delivery_method IS NULL OR coalesce(price_snapshot.snapshot_hash,'')='' THEN
      RAISE EXCEPTION 'invoice_group_delivery_missing' USING ERRCODE='23514';
    END IF;
    billing_configuration := underlay.billing_configuration_snapshot;
    source_terms := nullif(billing_configuration #>> '{payment_terms,dueDays}','')::numeric;
    IF billing_configuration->>'schema' IS DISTINCT FROM 'billing_configuration_v1' OR
      billing_configuration->>'company_id' IS DISTINCT FROM p_company_id::text OR
      billing_configuration->>'customer_id' IS DISTINCT FROM p_customer_id::text OR
      billing_configuration->>'contract_id' IS DISTINCT FROM contract.id::text OR
      billing_configuration #>> '{provider,provider}' IS DISTINCT FROM p_provider OR
      billing_configuration #>> '{provider,environment}' IS DISTINCT FROM p_environment OR
      billing_configuration #>> '{payment_terms,defaulted}' IS DISTINCT FROM 'false' OR
      source_terms IS NULL OR source_terms<0 OR trunc(source_terms)<>source_terms OR
      underlay.billing_configuration_snapshot_sha256 IS NULL THEN
      RAISE EXCEPTION 'invoice_group_issuer_terms_missing' USING ERRCODE='23514';
    END IF;
    IF terms IS NOT NULL AND terms IS DISTINCT FROM source_terms THEN
      RAISE EXCEPTION 'invoice_group_terms_conflict' USING ERRCODE='23514';
    END IF;
    terms := source_terms;
    delivery := source->'delivery';
    IF delivery IS NULL OR nullif(delivery->>'recipient','') IS NULL OR
       delivery->>'recipient' IS DISTINCT FROM coalesce(nullif(btrim(contract.invoice_recipient),''),
         nullif(btrim(customer.full_name),''),nullif(btrim(customer.company_name),'')) OR
       (price_snapshot.invoice_delivery_method='email' AND (nullif(delivery->>'email','') IS NULL OR
         delivery->>'email' IS DISTINCT FROM coalesce(nullif(btrim(contract.invoice_email),''),nullif(btrim(customer.invoice_email),'')))) OR
       (price_snapshot.invoice_delivery_method='paper' AND (delivery->'postalAddress' IS NULL OR delivery->'postalAddress'='null')) OR
       price_snapshot.invoice_delivery_method NOT IN ('email','paper') THEN
      RAISE EXCEPTION 'invoice_group_delivery_missing' USING ERRCODE='23514';
    END IF;
    IF agreed_delivery IS NULL THEN
      agreed_delivery := delivery;
      agreed_currency := underlay.currency;
      agreed_channel := price_snapshot.invoice_delivery_method;
    ELSIF (agreed_delivery->>'recipient') IS DISTINCT FROM (delivery->>'recipient') THEN
      RAISE EXCEPTION 'invoice_group_recipient_conflict' USING ERRCODE='23514';
    ELSIF agreed_currency IS DISTINCT FROM underlay.currency THEN
      RAISE EXCEPTION 'invoice_group_currency_conflict' USING ERRCODE='23514';
    ELSIF agreed_channel IS DISTINCT FROM price_snapshot.invoice_delivery_method OR agreed_delivery IS DISTINCT FROM delivery THEN
      RAISE EXCEPTION 'invoice_group_channel_conflict' USING ERRCODE='23514';
    END IF;

    calculation := source->'calculation';
    IF jsonb_typeof(calculation) IS DISTINCT FROM 'object' OR
      calculation->>'billing_month' IS DISTINCT FROM p_billing_month OR
      calculation->>'billing_underlay_id' IS DISTINCT FROM underlay.id::text OR
      calculation->>'customer_contract_id' IS DISTINCT FROM contract.id::text OR
      calculation->>'pricing_run_id' IS DISTINCT FROM price.id::text OR
      calculation->>'period_start' IS DISTINCT FROM underlay.billing_period_start::text OR
      calculation->>'period_end' IS DISTINCT FROM underlay.billing_period_end::text OR
      calculation->>'billing_configuration_snapshot_sha256' IS DISTINCT FROM underlay.billing_configuration_snapshot_sha256 OR
      (calculation->>'contract_price_snapshot_hash') IS DISTINCT FROM price_snapshot.snapshot_hash OR
      (calculation->>'contract_price_snapshot_id') IS DISTINCT FROM price_snapshot.id::text OR
      (calculation->>'price_area') IS DISTINCT FROM coalesce(underlay.price_area,contract.price_area_used) OR
      coalesce(calculation->>'price_area','') NOT IN ('SE1','SE2','SE3','SE4') OR
      (calculation->>'total_kwh')::numeric IS DISTINCT FROM underlay.total_kwh OR
      (calculation->>'subtotal_sek_ex_vat')::numeric IS DISTINCT FROM price.total_ex_vat OR
      (calculation->>'vat_sek')::numeric IS DISTINCT FROM price.vat_amount OR
      (calculation->>'total_sek_inc_vat')::numeric IS DISTINCT FROM price.total_inc_vat THEN
      RAISE EXCEPTION 'invoice_group_calculation_changed' USING ERRCODE='23514';
    END IF;
    -- Persisted pricing-core amounts are SEK. A display currency on the
    -- underlay is no authority to relabel those locked numbers.
    IF underlay.currency IS DISTINCT FROM 'SEK' OR
      jsonb_typeof(calculation->'pricing_lines') IS DISTINCT FROM 'array' OR
      jsonb_array_length(calculation->'pricing_lines')=0 OR
      EXISTS(SELECT FROM jsonb_array_elements(calculation->'pricing_lines') l
             WHERE l->>'currency' IS DISTINCT FROM underlay.currency) THEN
      RAISE EXCEPTION 'invoice_group_locked_currency_mismatch' USING ERRCODE='23514';
    END IF;
    PERFORM gridex_billing_source.require_underlay_v1(p_company_id,underlay.id);
    PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company_id,underlay.id);
    IF EXISTS(SELECT FROM public.invoice_export_items e WHERE e.company_id=p_company_id AND
        e.billing_underlay_id=underlay.id AND e.status<>'cancelled') OR
      EXISTS(SELECT FROM public.billing_export_run_items e WHERE e.company_id=p_company_id AND
        e.billing_underlay_id=underlay.id AND e.status<>'blocked') OR
      EXISTS(SELECT FROM public.customer_invoices i WHERE i.company_id=p_company_id AND
        i.billing_underlay_id=underlay.id AND i.status<>'cancelled') OR
      EXISTS(SELECT FROM gridex_invoice_groups.sources s WHERE s.company_id=p_company_id AND s.billing_underlay_id=underlay.id AND s.invoice_id IS DISTINCT FROM previous.invoice_id) THEN
      RAISE EXCEPTION 'invoice_group_source_already_reserved' USING ERRCODE='23505';
    END IF;
    site_ids := array_append(site_ids,site.id);
    first_period := least(first_period,underlay.billing_period_start);
    last_period := greatest(last_period,underlay.billing_period_end);
    quantity := quantity+underlay.total_kwh;
    subtotal := subtotal+price.total_ex_vat;
    vat := vat+price.vat_amount;
    total := total+price.total_inc_vat;
    sources := sources || jsonb_build_array(jsonb_build_object(
      'underlayId',underlay.id,'siteId',site.id,'meteringPointId',point.id,'pricingRunId',price.id,
      'contractId',contract.id,'periodStart',underlay.billing_period_start,'periodEnd',underlay.billing_period_end,
      'currency',underlay.currency,'calculation',calculation));
  END LOOP;
  IF (SELECT count(DISTINCT id) FROM unnest(site_ids) id)<2 THEN
    RAISE EXCEPTION 'invoice_group_distinct_sites_required' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public.company_number_sequences s
    WHERE s.company_id=p_company_id AND s.sequence_key=series_key FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_group_issuer_series_missing' USING ERRCODE='23514'; END IF;
  IF previous.invoice_id IS NOT NULL THEN
    RETURN jsonb_build_object('invoice_id',previous.invoice_id,'existing',true);
  END IF;

  document_snapshot := jsonb_build_object('schema','gridex_consolidated_invoice_calculation_v1',
    'billingMonth',p_billing_month,'paymentTermsDueDays',terms,'deliveryChannel',agreed_channel,
    'sources',sources);
  INSERT INTO public.customer_invoices(id,company_id,customer_id,invoice_reference,
    period_start,period_end,total_kwh,consumption_kwh,amount_ex_vat,vat_amount,amount_inc_vat,currency,status,
    source_system,created_by,calculation_snapshot,calculation_snapshot_sha256,metadata)
  VALUES(invoice_id,p_company_id,p_customer_id,public.gridex_new_public_resource_reference('invoice'),
    first_period,last_period,quantity,quantity,subtotal,vat,total,agreed_currency,'draft',
    'invoice_group_v1',p_actor_user_id,document_snapshot,encode(extensions.digest(document_snapshot::text,'sha256'),'hex'),
    jsonb_build_object('approval',jsonb_build_object('status','pending_review'),'consolidated',true));
  INSERT INTO gridex_invoice_groups.drafts VALUES
    (p_company_id,p_customer_id,p_billing_month,p_provider,p_environment,invoice_id,intent);
  INSERT INTO gridex_invoice_groups.sources
    SELECT p_company_id,(value->>'underlayId')::uuid,invoice_id,value FROM jsonb_array_elements(sources);
  RETURN jsonb_build_object('invoice_id',invoice_id,'existing',false);
END
$$;

REVOKE ALL ON FUNCTION public.gridex_prepare_consolidated_invoice_v1(uuid,uuid,text,text,text,uuid,jsonb)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_prepare_consolidated_invoice_v1(uuid,uuid,text,text,text,uuid,jsonb) TO service_role;

CREATE TABLE gridex_invoice_groups.approvals (
  company_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  review_hash text NOT NULL,
  approved_by uuid NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (company_id,invoice_id),
  FOREIGN KEY (company_id,invoice_id) REFERENCES gridex_invoice_groups.drafts(company_id,invoice_id)
);
ALTER TABLE gridex_invoice_groups.approvals ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION gridex_invoice_groups.review_hash(
  p_company uuid,p_invoice uuid,p_month text,p_provider text,p_environment text,p_snapshot jsonb,p_intent jsonb
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog AS $$
 SELECT encode(extensions.digest(jsonb_build_object(
   'schema','gridex_consolidated_invoice_review_v1','companyId',p_company,'invoiceId',p_invoice,
   'billingMonth',p_month,'provider',p_provider,'environment',p_environment,
   'snapshot',p_snapshot,'selectedSources',p_intent)::text,'sha256'),'hex')
$$;

CREATE FUNCTION public.gridex_read_consolidated_invoice_review_v1(p_company_id uuid,p_invoice_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION 'invoice_group_service_role_required' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object('invoiceId',i.id,'billingMonth',g.billing_month,'customerId',i.customer_id,
   'reviewHash',gridex_invoice_groups.review_hash(g.company_id,g.invoice_id,g.billing_month,g.provider,g.environment,i.calculation_snapshot,g.intent),
   'status',CASE WHEN a.invoice_id IS NULL THEN 'pending_review' ELSE 'approved' END,
   'approvedAt',a.approved_at,'approvedBy',a.approved_by,'currency',i.currency,'totalAmount',i.amount_inc_vat,
   'sources',i.calculation_snapshot->'sources')
 INTO result
 FROM gridex_invoice_groups.drafts g JOIN public.customer_invoices i ON i.company_id=g.company_id AND i.id=g.invoice_id
 LEFT JOIN gridex_invoice_groups.approvals a ON a.company_id=g.company_id AND a.invoice_id=g.invoice_id
 WHERE g.company_id=p_company_id AND g.invoice_id=p_invoice_id AND i.status='draft';
 RETURN result;
END
$$;

CREATE FUNCTION public.gridex_approve_consolidated_invoice_draft_v1(
  p_company_id uuid,p_invoice_id uuid,p_actor_user_id uuid,p_review_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE
  grouped gridex_invoice_groups.drafts%ROWTYPE;
  invoice public.customer_invoices%ROWTYPE;
  receipt gridex_invoice_groups.approvals%ROWTYPE;
  digest text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION 'invoice_group_service_role_required' USING ERRCODE='42501';
 END IF;
 IF p_actor_user_id IS NULL OR coalesce(p_review_hash,'') !~ '^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'invoice_group_approval_input_invalid' USING ERRCODE='22023';
 END IF;
 SELECT * INTO grouped FROM gridex_invoice_groups.drafts g
 WHERE g.company_id=p_company_id AND g.invoice_id=p_invoice_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invoice_group_review_missing' USING ERRCODE='P0002'; END IF;
 SELECT * INTO invoice FROM public.customer_invoices i WHERE i.company_id=p_company_id AND i.id=p_invoice_id FOR SHARE;
 IF NOT FOUND OR invoice.status<>'draft' OR invoice.invoice_number IS NOT NULL THEN
   RAISE EXCEPTION 'invoice_group_not_reviewable' USING ERRCODE='23514';
 END IF;
 digest := gridex_invoice_groups.review_hash(grouped.company_id,grouped.invoice_id,grouped.billing_month,
   grouped.provider,grouped.environment,invoice.calculation_snapshot,grouped.intent);
 IF digest IS DISTINCT FROM p_review_hash THEN
   RAISE EXCEPTION 'invoice_group_review_changed' USING ERRCODE='40001';
 END IF;
 SELECT * INTO receipt FROM gridex_invoice_groups.approvals a WHERE a.company_id=p_company_id AND a.invoice_id=p_invoice_id;
 IF FOUND THEN
   IF receipt.review_hash IS DISTINCT FROM digest THEN RAISE EXCEPTION 'invoice_group_review_changed' USING ERRCODE='40001'; END IF;
   RETURN jsonb_build_object('invoiceId',p_invoice_id,'reviewHash',digest,'approvedAt',receipt.approved_at,'approvedBy',receipt.approved_by,'existing',true);
 END IF;

 -- The same authority and source reads used in preparation must still agree.
 -- Existing draft revalidation makes no writes and allocates no number.
 PERFORM public.gridex_prepare_consolidated_invoice_v1(p_company_id,grouped.customer_id,grouped.billing_month,
   grouped.provider,grouped.environment,p_actor_user_id,grouped.intent);
 INSERT INTO gridex_invoice_groups.approvals(company_id,invoice_id,review_hash,approved_by)
 VALUES(p_company_id,p_invoice_id,digest,p_actor_user_id) RETURNING * INTO receipt;
 RETURN jsonb_build_object('invoiceId',p_invoice_id,'reviewHash',digest,'approvedAt',receipt.approved_at,'approvedBy',receipt.approved_by,'existing',false);
END
$$;

REVOKE ALL ON FUNCTION public.gridex_read_consolidated_invoice_review_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_read_consolidated_invoice_review_v1(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.gridex_approve_consolidated_invoice_draft_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_approve_consolidated_invoice_draft_v1(uuid,uuid,uuid,text) TO service_role;

-- One terminal outcome for one durable grouped draft. No number is assigned to a cancellation.
CREATE TABLE gridex_invoice_groups.issue_outcomes (
  company_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  review_hash text NOT NULL CHECK (review_hash ~ '^[0-9a-f]{64}$'),
  outcome text NOT NULL CHECK (outcome IN ('issued','cancelled')),
  number text,
  series_key text,
  actor_user_id uuid NOT NULL,
  effective_at timestamptz NOT NULL,
  due_date date,
  reason text,
  result jsonb NOT NULL,
  PRIMARY KEY (company_id,invoice_id),
  FOREIGN KEY (company_id,invoice_id) REFERENCES gridex_invoice_groups.drafts(company_id,invoice_id),
  CHECK (
    (outcome='issued' AND number IS NOT NULL AND series_key IS NOT NULL AND due_date IS NOT NULL AND reason IS NULL) OR
    (outcome='cancelled' AND number IS NULL AND series_key IS NULL AND due_date IS NULL AND reason IS NOT NULL)
  )
);
CREATE UNIQUE INDEX invoice_group_issuer_number_idx ON gridex_invoice_groups.issue_outcomes(company_id,number)
  WHERE number IS NOT NULL;
ALTER TABLE gridex_invoice_groups.issue_outcomes ENABLE ROW LEVEL SECURITY;

-- Never make an unnumbered cancelled draft customer-visible through the
-- historical 'cancelled' invoice status, which is published for old invoices.
CREATE FUNCTION gridex_invoice_groups.fence_terminal_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
BEGIN
 IF EXISTS (SELECT FROM gridex_invoice_groups.issue_outcomes o
            WHERE o.company_id=NEW.company_id AND o.invoice_id=NEW.invoice_id) THEN
   RAISE EXCEPTION 'invoice_group_terminal_conflict' USING ERRCODE='23505';
 END IF;
 RETURN NEW;
END
$$;
CREATE TRIGGER invoice_group_terminal_approval_fence BEFORE INSERT ON gridex_invoice_groups.approvals
FOR EACH ROW EXECUTE FUNCTION gridex_invoice_groups.fence_terminal_approval();

CREATE FUNCTION gridex_invoice_groups.lock_period(p_company uuid,p_month text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_company::text || ':invoice-group-period:' || p_month,0)) THEN
    RAISE EXCEPTION 'invoice_group_period_busy' USING ERRCODE='55P03';
  END IF;
END
$$;

CREATE FUNCTION gridex_invoice_groups.fence_period()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE scope_row jsonb;
BEGIN
  scope_row := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  PERFORM gridex_invoice_groups.lock_period((scope_row->>'company_id')::uuid,
    CASE WHEN TG_TABLE_NAME='billing_period_locks'
      THEN scope_row->>'billing_year' || '-' || lpad(scope_row->>'billing_month',2,'0')
      ELSE scope_row->>'billing_month' END);
  IF TG_OP='UPDATE' THEN
    scope_row := to_jsonb(OLD);
    PERFORM gridex_invoice_groups.lock_period((scope_row->>'company_id')::uuid,
      CASE WHEN TG_TABLE_NAME='billing_period_locks'
        THEN scope_row->>'billing_year' || '-' || lpad(scope_row->>'billing_month',2,'0')
        ELSE scope_row->>'billing_month' END);
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER invoice_group_period_fence BEFORE INSERT OR UPDATE OR DELETE ON public.billing_period_locks
FOR EACH ROW EXECUTE FUNCTION gridex_invoice_groups.fence_period();
CREATE TRIGGER invoice_group_price_period_fence BEFORE INSERT OR UPDATE OR DELETE ON public.price_period_locks
FOR EACH ROW EXECUTE FUNCTION gridex_invoice_groups.fence_period();

CREATE FUNCTION gridex_invoice_groups.fence_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
BEGIN
  IF NEW.invoice_number IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.company_id=OLD.company_id AND NEW.invoice_number IS NOT DISTINCT FROM OLD.invoice_number THEN
    RETURN NEW;
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(NEW.company_id::text || ':issued-invoice-number:' || NEW.invoice_number,0)) THEN
    RAISE EXCEPTION 'invoice_group_number_busy' USING ERRCODE='55P03';
  END IF;
  IF EXISTS(SELECT FROM gridex_invoice_groups.issue_outcomes o WHERE o.company_id=NEW.company_id
      AND o.number=NEW.invoice_number AND o.invoice_id<>NEW.id) THEN
    RAISE EXCEPTION 'invoice_group_number_collision' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER invoice_group_number_fence BEFORE INSERT OR UPDATE OF company_id,invoice_number ON public.customer_invoices
FOR EACH ROW EXECUTE FUNCTION gridex_invoice_groups.fence_number();

CREATE OR REPLACE FUNCTION gridex_invoice_groups.protect_draft()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
BEGIN
  IF EXISTS(SELECT FROM gridex_invoice_groups.drafts g WHERE g.company_id=OLD.company_id AND g.invoice_id=OLD.id) THEN
    IF TG_OP='UPDATE' AND OLD.status='draft' AND OLD.invoice_number IS NULL AND EXISTS(
      SELECT FROM gridex_invoice_groups.issue_outcomes o
      WHERE o.company_id=OLD.company_id AND o.invoice_id=OLD.id
        AND NEW.status=(CASE WHEN o.outcome='issued' THEN 'issued' ELSE 'draft' END)
        AND NEW.invoice_number IS NOT DISTINCT FROM o.number
        AND NEW.issued_at IS NOT DISTINCT FROM CASE WHEN o.outcome='issued' THEN o.effective_at ELSE NULL END
        AND NEW.due_date IS NOT DISTINCT FROM o.due_date
        AND NEW.updated_by=o.actor_user_id AND NEW.updated_at=o.effective_at
        AND (to_jsonb(NEW)-ARRAY['status','invoice_number','issued_at','due_date','updated_at','updated_by']) =
            (to_jsonb(OLD)-ARRAY['status','invoice_number','issued_at','due_date','updated_at','updated_by'])
    ) THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'invoice_group_draft_requires_group_workflow' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION gridex_invoice_groups.qualified_internal_series(p_company_id uuid,p_environment text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog AS $$
 SELECT n.sequence_key
 FROM public.companies c
 JOIN public.company_number_sequences n ON n.company_id=c.id
  AND n.sequence_key=c.billing_settings #>> '{invoice_profile,consolidation,issuer_series_key}'
 WHERE c.id=p_company_id AND c.is_active
  AND to_regclass('gridex_invoice_groups.customer_documents') IS NOT NULL
  AND c.status NOT IN ('paused','suspended','inactive','closed','archived','pending_deletion','deleted_test_only','deleted')
  AND c.billing_provider_environment=p_environment AND n.sequence_key NOT IN ('application','contract')
  AND c.billing_settings #>> '{invoice_profile,consolidation,issuer_company_id}'=c.id::text
  AND c.billing_settings #>> '{invoice_profile,consolidation,environment}'=p_environment
  AND c.billing_settings #>> '{invoice_profile,consolidation,issue_authority}'='internal_issuer'
  AND n.metadata #>> '{invoice_issuer,company_id}'=c.id::text
  AND n.metadata #>> '{invoice_issuer,environment}'=p_environment
$$;

CREATE FUNCTION public.gridex_finish_consolidated_invoice_v1(
  p_company_id uuid,p_invoice_id uuid,p_actor_user_id uuid,p_review_hash text,p_outcome text,p_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE
  draft gridex_invoice_groups.drafts%ROWTYPE;
  invoice public.customer_invoices%ROWTYPE;
  prior gridex_invoice_groups.issue_outcomes%ROWTYPE;
  approved gridex_invoice_groups.approvals%ROWTYPE;
  company public.companies%ROWTYPE;
  series text;
  number_value text;
  due_value date;
  clock timestamptz := transaction_timestamp();
  reason_value text := nullif(btrim(p_reason),'');
  review_value text;
  response jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR
    public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'billing_underlay.export') IS NOT TRUE THEN
    RAISE EXCEPTION 'invoice_group_issue_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('issued','cancelled') OR
    coalesce(p_review_hash,'') !~ '^[0-9a-f]{64}$' OR (p_outcome='issued' AND reason_value IS NOT NULL) OR
    (p_outcome='cancelled' AND (reason_value IS NULL OR char_length(reason_value)>1000)) THEN
    RAISE EXCEPTION 'invoice_group_issue_input_invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO draft FROM gridex_invoice_groups.drafts g
    WHERE g.company_id=p_company_id AND g.invoice_id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_group_review_missing' USING ERRCODE='P0002'; END IF;
  SELECT * INTO prior FROM gridex_invoice_groups.issue_outcomes o WHERE o.company_id=p_company_id AND o.invoice_id=p_invoice_id;
  IF FOUND THEN
    IF prior.outcome='issued' AND p_outcome='cancelled' THEN
      RAISE EXCEPTION 'invoice_group_issued_credit_required' USING ERRCODE='55000';
    END IF;
    IF prior.outcome IS DISTINCT FROM p_outcome OR prior.review_hash IS DISTINCT FROM p_review_hash OR
      prior.reason IS DISTINCT FROM reason_value THEN
      RAISE EXCEPTION 'invoice_group_terminal_conflict' USING ERRCODE='23505';
    END IF;
    RETURN prior.result || jsonb_build_object('existing',true);
  END IF;

  SELECT * INTO invoice FROM public.customer_invoices i WHERE i.company_id=p_company_id AND i.id=p_invoice_id FOR UPDATE;
  IF NOT FOUND OR invoice.status<>'draft' OR invoice.invoice_number IS NOT NULL THEN
    RAISE EXCEPTION 'invoice_group_not_reviewable' USING ERRCODE='23514';
  END IF;
  review_value := gridex_invoice_groups.review_hash(draft.company_id,draft.invoice_id,draft.billing_month,
    draft.provider,draft.environment,invoice.calculation_snapshot,draft.intent);
  IF review_value IS DISTINCT FROM p_review_hash THEN
    RAISE EXCEPTION 'invoice_group_review_changed' USING ERRCODE='40001';
  END IF;

  IF p_outcome='issued' THEN
    SELECT * INTO approved FROM gridex_invoice_groups.approvals a WHERE a.company_id=p_company_id AND a.invoice_id=p_invoice_id;
    IF NOT FOUND OR approved.review_hash IS DISTINCT FROM review_value THEN
      RAISE EXCEPTION 'invoice_group_issue_approval_required' USING ERRCODE='23514';
    END IF;
    PERFORM gridex_invoice_groups.lock_period(p_company_id,draft.billing_month);
    IF EXISTS(SELECT FROM public.billing_period_locks l WHERE l.company_id=p_company_id
         AND l.billing_year=split_part(draft.billing_month,'-',1)::int
         AND l.billing_month=split_part(draft.billing_month,'-',2)::int AND l.status IN ('locked','exported','closed'))
      OR EXISTS(SELECT FROM public.price_period_locks l WHERE l.company_id=p_company_id
         AND l.billing_month=draft.billing_month AND l.lock_scope IN ('billing_period','invoice_export') AND l.status='locked') THEN
      RAISE EXCEPTION 'invoice_group_issue_period_locked' USING ERRCODE='55000';
    END IF;
    SELECT * INTO company FROM public.companies c WHERE c.id=p_company_id FOR SHARE;
    IF NOT FOUND OR company.is_active IS NOT TRUE OR company.status IN (
      'paused','suspended','inactive','closed','archived','pending_deletion','deleted_test_only','deleted'
    ) THEN RAISE EXCEPTION 'invoice_group_issue_company_unavailable' USING ERRCODE='55000'; END IF;
    series := gridex_invoice_groups.qualified_internal_series(p_company_id,draft.environment);
    IF series IS NULL THEN RAISE EXCEPTION 'invoice_group_issue_issuer_required' USING ERRCODE='23514'; END IF;
    -- Existing locked source and retention authority is re-checked at issue, regardless of prior approval.
    PERFORM public.gridex_prepare_consolidated_invoice_v1(p_company_id,draft.customer_id,draft.billing_month,
      draft.provider,draft.environment,p_actor_user_id,draft.intent);
    PERFORM 1 FROM public.company_number_sequences s WHERE s.company_id=p_company_id AND s.sequence_key=series
      AND s.metadata #>> '{invoice_issuer,company_id}'=p_company_id::text
      AND s.metadata #>> '{invoice_issuer,environment}'=draft.environment FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invoice_group_issue_issuer_required' USING ERRCODE='23514'; END IF;
    number_value := public.gridex_next_document_number(p_company_id,series,NULL);
    IF NOT pg_try_advisory_xact_lock(hashtextextended(p_company_id::text || ':issued-invoice-number:' || number_value,0)) THEN
      RAISE EXCEPTION 'invoice_group_number_busy' USING ERRCODE='55P03';
    END IF;
    IF EXISTS(SELECT FROM public.customer_invoices i WHERE i.company_id=p_company_id AND i.invoice_number=number_value) THEN
      RAISE EXCEPTION 'invoice_group_number_collision' USING ERRCODE='23505';
    END IF;
    due_value := (clock AT TIME ZONE 'Europe/Stockholm')::date + (invoice.calculation_snapshot->>'paymentTermsDueDays')::int;
  END IF;

  response := jsonb_build_object('invoiceId',p_invoice_id,'reviewHash',review_value,'outcome',p_outcome,
    'invoiceNumber',number_value,'dueDate',due_value,'actorUserId',p_actor_user_id,'effectiveAt',clock,'existing',false);
  INSERT INTO gridex_invoice_groups.issue_outcomes(company_id,invoice_id,review_hash,outcome,number,series_key,
    actor_user_id,effective_at,due_date,reason,result)
  VALUES(p_company_id,p_invoice_id,review_value,p_outcome,number_value,series,
    p_actor_user_id,clock,due_value,reason_value,response);
  UPDATE public.customer_invoices SET status=CASE WHEN p_outcome='issued' THEN 'issued' ELSE 'draft' END,invoice_number=number_value,
    issued_at=CASE WHEN p_outcome='issued' THEN clock ELSE NULL END,
    due_date=due_value,updated_by=p_actor_user_id,updated_at=clock
  WHERE company_id=p_company_id AND id=p_invoice_id;
  IF p_outcome='issued' AND NOT EXISTS (
    SELECT FROM gridex_invoice_groups.customer_documents d WHERE d.company_id=p_company_id AND d.invoice_id=p_invoice_id
  ) THEN RAISE EXCEPTION 'invoice_group_issue_document_receipt_missing' USING ERRCODE='23514'; END IF;
  RETURN response;
END
$$;

REVOKE ALL ON FUNCTION public.gridex_finish_consolidated_invoice_v1(uuid,uuid,uuid,text,text,text)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_finish_consolidated_invoice_v1(uuid,uuid,uuid,text,text,text) TO service_role;

CREATE TABLE gridex_invoice_groups.customer_documents (
  company_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  body bytea NOT NULL,
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (company_id,invoice_id),
  FOREIGN KEY (company_id,invoice_id) REFERENCES gridex_invoice_groups.issue_outcomes(company_id,invoice_id),
  CHECK (body_sha256=encode(sha256(body),'hex'))
);
ALTER TABLE gridex_invoice_groups.customer_documents ENABLE ROW LEVEL SECURITY;

-- Same versioned organization-scoped reference derivation as publicReference().
CREATE FUNCTION gridex_invoice_groups.public_source_reference(p_company uuid,p_source uuid)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path TO pg_catalog AS $$
 SELECT 'invoice_source_' || left(translate(encode(extensions.digest(
  'gridex-public-reference:v1:' || p_company::text || ':invoice_source:' || p_source::text,'sha256'),'base64'),'+/','-_'),32)
$$;

CREATE FUNCTION gridex_invoice_groups.freeze_customer_document()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE
  scoped_issue gridex_invoice_groups.issue_outcomes%ROWTYPE;
  source_row gridex_invoice_groups.sources%ROWTYPE;
  facility text;
  calculation jsonb;
  price_lines jsonb;
  sites jsonb := '[]';
  frozen bytea;
  projected integer;
BEGIN
 IF NEW.source_system IS DISTINCT FROM 'invoice_group_v1' OR OLD.status<>'draft' OR NEW.status<>'issued' THEN RETURN NEW; END IF;
 SELECT * INTO scoped_issue FROM gridex_invoice_groups.issue_outcomes o
 WHERE o.company_id=NEW.company_id AND o.invoice_id=NEW.id AND o.outcome='issued' AND o.number=NEW.invoice_number;
 IF NOT FOUND THEN RAISE EXCEPTION 'invoice_group_issue_document_receipt_missing' USING ERRCODE='23514'; END IF;

 FOR source_row IN SELECT * FROM gridex_invoice_groups.sources s
   WHERE s.company_id=NEW.company_id AND s.invoice_id=NEW.id ORDER BY s.billing_underlay_id LOOP
   SELECT site.facility_reference INTO facility FROM public.customer_sites site
   WHERE site.company_id=NEW.company_id AND site.customer_id=NEW.customer_id
     AND site.id=(source_row.snapshot->>'siteId')::uuid FOR SHARE;
   calculation := source_row.snapshot->'calculation';
   IF NULLIF(facility,'') IS NULL OR jsonb_typeof(calculation->'pricing_lines') IS DISTINCT FROM 'array' OR
     jsonb_array_length(calculation->'pricing_lines')=0 THEN
     RAISE EXCEPTION 'invoice_group_issue_document_source_missing' USING ERRCODE='23514';
   END IF;
   SELECT jsonb_agg(jsonb_build_object(
       'description',line.value->>'componentLabel','quantity',line.value->>'quantity',
       'unit',line.value->>'calculationUnit','unitPriceExVat',line.value->>'valueAmount',
       'exVat',line.value->>'amountSekExVat','vat',line.value->>'vatAmount','total',line.value->>'amountIncVat')
       ORDER BY line.ordinality)
   INTO price_lines FROM jsonb_array_elements(calculation->'pricing_lines') WITH ORDINALITY line(value,ordinality)
   WHERE nullif(line.value->>'componentLabel','') IS NOT NULL AND jsonb_typeof(line.value->'amountIncVat')='number'
     AND jsonb_typeof(line.value->'vatAmount')='number' AND jsonb_typeof(line.value->'amountSekExVat')='number';
   IF price_lines IS NULL OR jsonb_array_length(price_lines)<>jsonb_array_length(calculation->'pricing_lines') THEN
     RAISE EXCEPTION 'invoice_group_issue_document_price_invalid' USING ERRCODE='23514';
   END IF;
   sites := sites || jsonb_build_array(jsonb_build_object(
      'facilityReference',facility,'sourceReference',gridex_invoice_groups.public_source_reference(NEW.company_id,source_row.billing_underlay_id),
      'periodStart',source_row.snapshot->>'periodStart','periodEnd',source_row.snapshot->>'periodEnd',
      'priceArea',calculation->>'price_area','quantityKwh',calculation->>'total_kwh',
      'amountExVat',calculation->>'subtotal_sek_ex_vat','vatAmount',calculation->>'vat_sek',
      'amountIncVat',calculation->>'total_sek_inc_vat','pricing',price_lines));
 END LOOP;
 IF jsonb_array_length(sites)<2 THEN RAISE EXCEPTION 'invoice_group_issue_document_source_missing' USING ERRCODE='23514'; END IF;
 frozen := convert_to(jsonb_build_object(
   'format','gridex_customer_group_invoice_v1','invoiceReference',NEW.invoice_reference,'invoiceNumber',NEW.invoice_number,
   'issuedDate',(scoped_issue.effective_at AT TIME ZONE 'Europe/Stockholm')::date,'dueDate',NEW.due_date,
   'currency',NEW.currency,'quantityKwh',NEW.total_kwh::text,'amountExVat',NEW.amount_ex_vat::text,
   'vatAmount',NEW.vat_amount::text,'amountIncVat',NEW.amount_inc_vat::text,'sites',sites)::text,'UTF8');
 INSERT INTO gridex_invoice_groups.customer_documents(company_id,invoice_id,customer_id,body,body_sha256)
 VALUES(NEW.company_id,NEW.id,NEW.customer_id,frozen,encode(sha256(frozen),'hex'));
 -- Project genuine issuance to every reserved underlay using the existing
 -- customer invoice status semantics, without inventing a singleton run.
 UPDATE public.billing_underlays u SET invoice_readiness_status='invoiced',
   invoice_export_locked_at=coalesce(u.invoice_export_locked_at,scoped_issue.effective_at),
   updated_at=scoped_issue.effective_at
 FROM gridex_invoice_groups.sources s
 WHERE s.company_id=NEW.company_id AND s.invoice_id=NEW.id AND u.id=s.billing_underlay_id
   AND u.company_id=NEW.company_id AND u.customer_id=NEW.customer_id;
 GET DIAGNOSTICS projected=ROW_COUNT;
 IF projected<>jsonb_array_length(sites) THEN RAISE EXCEPTION 'invoice_group_issue_source_projection_missing' USING ERRCODE='23514'; END IF;

 RETURN NEW;
END
$$;

CREATE TRIGGER invoice_group_freeze_customer_document AFTER UPDATE OF status ON public.customer_invoices
FOR EACH ROW EXECUTE FUNCTION gridex_invoice_groups.freeze_customer_document();

CREATE FUNCTION public.gridex_read_consolidated_invoice_customer_document_v1(
  p_company_id uuid,p_customer_ids uuid[],p_invoice_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE document gridex_invoice_groups.customer_documents%ROWTYPE; source uuid; error_text text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION 'invoice_group_service_role_required' USING ERRCODE='42501';
 END IF;
 SELECT d.* INTO document FROM gridex_invoice_groups.customer_documents d
 JOIN public.customer_invoices i ON i.company_id=d.company_id AND i.customer_id=d.customer_id AND i.id=d.invoice_id
 JOIN gridex_invoice_groups.issue_outcomes o ON o.company_id=d.company_id AND o.invoice_id=d.invoice_id
 WHERE d.company_id=p_company_id AND d.customer_id=ANY(p_customer_ids) AND d.invoice_id=p_invoice_id
   AND i.status IN ('issued','sent','paid','overdue','credited') AND o.outcome='issued' AND o.number=i.invoice_number;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM public.ediel_require_portal_retention_access_v1(p_company_id,document.customer_id);
 BEGIN
   PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company_id,NULL,p_invoice_id);
   FOR source IN SELECT s.billing_underlay_id FROM gridex_invoice_groups.sources s
      WHERE s.company_id=p_company_id AND s.invoice_id=p_invoice_id ORDER BY s.billing_underlay_id LOOP
     PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company_id,source);
   END LOOP;
 EXCEPTION WHEN check_violation THEN
   GET STACKED DIAGNOSTICS error_text=MESSAGE_TEXT;
   IF error_text='finance_copy_retention_tombstoned' THEN RETURN jsonb_build_object('kind','retired'); END IF;
   RAISE;
 END;
 RETURN jsonb_build_object('kind','ready','bodyBase64',encode(document.body,'base64'),'sha256',document.body_sha256);
END
$$;

REVOKE ALL ON FUNCTION public.gridex_read_consolidated_invoice_customer_document_v1(uuid,uuid[],uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_read_consolidated_invoice_customer_document_v1(uuid,uuid[],uuid) TO service_role;

CREATE INDEX invoice_group_review_window_idx
  ON gridex_invoice_groups.drafts(company_id,billing_month,invoice_id);

CREATE FUNCTION public.gridex_list_consolidated_invoice_reviews_v1(
  p_company_id uuid,p_billing_month text,p_customer_id uuid DEFAULT NULL,p_after_invoice_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE items jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'invoice_group_service_role_required' USING ERRCODE='42501';
  END IF;
  IF p_company_id IS NULL OR coalesce(p_billing_month,'') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'invoice_group_review_scope_invalid' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
       'companyId',g.company_id,'invoiceId',g.invoice_id,'customerId',g.customer_id,'billingMonth',g.billing_month,
       'customerName',coalesce(nullif(c.full_name,''),nullif(c.company_name,''),nullif(c.name,''),c.customer_number),
       'reviewHash',gridex_invoice_groups.review_hash(g.company_id,g.invoice_id,g.billing_month,
           g.provider,g.environment,i.calculation_snapshot,g.intent),
       'status',CASE WHEN o.outcome='cancelled' THEN 'cancelled' WHEN i.status='draft' THEN CASE WHEN a.invoice_id IS NULL THEN 'pending_review' ELSE 'approved' END ELSE i.status END,
       'canIssue',i.status='draft' AND a.invoice_id IS NOT NULL AND o.invoice_id IS NULL
         AND gridex_invoice_groups.qualified_internal_series(g.company_id,g.environment) IS NOT NULL,
       'invoiceNumber',i.invoice_number,'currency',i.currency,'totalAmount',i.amount_inc_vat,
       'sources',(SELECT jsonb_agg(jsonb_build_object(
           'underlayId',s.billing_underlay_id,'siteId',s.snapshot->>'siteId','facilityReference',site.facility_reference,
           'priceArea',s.snapshot#>>'{calculation,price_area}','periodStart',s.snapshot->>'periodStart',
           'periodEnd',s.snapshot->>'periodEnd','quantityKwh',s.snapshot#>'{calculation,total_kwh}',
           'totalAmount',s.snapshot#>'{calculation,total_sek_inc_vat}'
         ) ORDER BY s.billing_underlay_id)
         FROM gridex_invoice_groups.sources s LEFT JOIN public.customer_sites site
           ON site.company_id=s.company_id AND site.customer_id=g.customer_id AND site.id=(s.snapshot->>'siteId')::uuid
         WHERE s.company_id=g.company_id AND s.invoice_id=g.invoice_id))
    ORDER BY g.invoice_id),'[]')
  INTO items
  FROM (
    SELECT * FROM gridex_invoice_groups.drafts d WHERE d.company_id=p_company_id AND d.billing_month=p_billing_month
      AND (p_customer_id IS NULL OR d.customer_id=p_customer_id)
      AND (p_after_invoice_id IS NULL OR d.invoice_id>p_after_invoice_id)
    ORDER BY d.invoice_id LIMIT 21
  ) g
  JOIN public.customer_invoices i ON i.company_id=g.company_id AND i.id=g.invoice_id AND i.customer_id=g.customer_id
  JOIN public.customers c ON c.company_id=g.company_id AND c.id=g.customer_id
  LEFT JOIN gridex_invoice_groups.approvals a ON a.company_id=g.company_id AND a.invoice_id=g.invoice_id
  LEFT JOIN gridex_invoice_groups.issue_outcomes o ON o.company_id=g.company_id AND o.invoice_id=g.invoice_id;
  RETURN items;
END
$$;
REVOKE ALL ON FUNCTION public.gridex_list_consolidated_invoice_reviews_v1(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_list_consolidated_invoice_reviews_v1(uuid,text,uuid,uuid) TO service_role;
END
$gridex_invoice_migration$;
