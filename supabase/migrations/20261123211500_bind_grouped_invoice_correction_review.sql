DO $gridex_group_correction_migration$
BEGIN
CREATE TABLE gridex_invoice_groups.correction_origins (
  adjustment_id uuid PRIMARY KEY REFERENCES public.billing_adjustment_cases(id),
  company_id uuid NOT NULL,
  invoice_id uuid NOT NULL REFERENCES public.customer_invoices(id),
  actor_user_id uuid NOT NULL,
  review_hash text NOT NULL CHECK (review_hash ~ '^[a-f0-9]{64}$'),
  document_sha256 text NOT NULL CHECK (document_sha256 ~ '^[a-f0-9]{64}$'),
  members jsonb NOT NULL CHECK (jsonb_typeof(members)='array' AND jsonb_array_length(members)>=2)
);
ALTER TABLE gridex_invoice_groups.correction_origins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_invoice_groups.correction_origins FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_invoice_groups.protect_correction_origin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
BEGIN
  IF ROW(NEW.id,NEW.company_id,NEW.environment,NEW.original_billing_underlay_id,NEW.corrected_billing_underlay_id,
      NEW.source_normalized_metering_value_id,NEW.original_invoice_id,NEW.reason,NEW.currency)
     IS DISTINCT FROM ROW(OLD.id,OLD.company_id,OLD.environment,OLD.original_billing_underlay_id,OLD.corrected_billing_underlay_id,
      OLD.source_normalized_metering_value_id,OLD.original_invoice_id,OLD.reason,OLD.currency)
     AND EXISTS(SELECT FROM gridex_invoice_groups.correction_origins o WHERE o.adjustment_id=OLD.id) THEN
    RAISE EXCEPTION 'invoice_group_correction_origin_immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION gridex_invoice_groups.protect_correction_origin() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER invoice_group_correction_origin_guard BEFORE UPDATE OF id,company_id,environment,original_billing_underlay_id,
  corrected_billing_underlay_id,source_normalized_metering_value_id,original_invoice_id,reason,currency ON public.billing_adjustment_cases
FOR EACH ROW EXECUTE FUNCTION gridex_invoice_groups.protect_correction_origin();

CREATE FUNCTION public.gridex_register_grouped_invoice_correction_v1(
  p_company_id uuid,
  p_invoice_id uuid,
  p_actor_user_id uuid,
  p_original_underlay_id uuid,
  p_corrected_underlay_id uuid,
  p_source_value_id uuid,
  p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $group_correction$
DECLARE
  source_row gridex_invoice_groups.sources%ROWTYPE;
  copy gridex_invoice_groups.customer_documents%ROWTYPE;
  prior public.billing_adjustment_cases%ROWTYPE;
  lineage gridex_invoice_groups.correction_origins%ROWTYPE;
  target record;
  members jsonb;
  case_id uuid;
  reason_value text := nullif(btrim(p_reason),'');
  replayed boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR
     public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'billing_underlay.export') IS NOT TRUE OR
     NOT EXISTS(SELECT FROM public.companies c WHERE c.id=p_company_id AND c.status IN ('active','onboarding') AND c.is_active) THEN
    RAISE EXCEPTION 'invoice_group_correction_permission_denied' USING ERRCODE='42501';
  END IF;
  IF p_invoice_id IS NULL OR p_original_underlay_id IS NULL OR p_corrected_underlay_id IS NULL
     OR p_source_value_id IS NULL OR p_original_underlay_id=p_corrected_underlay_id
     OR reason_value IS NULL OR char_length(reason_value)>1000 THEN
    RAISE EXCEPTION 'invoice_group_correction_invalid' USING ERRCODE='22023';
  END IF;

  SELECT i.customer_id,i.currency,i.invoice_reference,g.environment,o.review_hash INTO target
    FROM public.customer_invoices i
    JOIN gridex_invoice_groups.drafts g ON g.company_id=i.company_id AND g.invoice_id=i.id AND g.customer_id=i.customer_id
    JOIN gridex_invoice_groups.issue_outcomes o ON o.company_id=i.company_id AND o.invoice_id=i.id
    WHERE i.company_id=p_company_id AND i.id=p_invoice_id AND i.source_system='invoice_group_v1'
      AND o.outcome='issued' AND o.number=i.invoice_number AND i.status IN ('issued','sent','paid','overdue');
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_group_correction_original_not_found' USING ERRCODE='P0002'; END IF;

  copy:=gridex_invoice_groups.verified_neutral_file_source(p_company_id,p_invoice_id,target.review_hash);
  SELECT * INTO source_row FROM gridex_invoice_groups.sources s
    WHERE s.company_id=p_company_id AND s.invoice_id=p_invoice_id AND s.billing_underlay_id=p_original_underlay_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_group_correction_source_unqualified' USING ERRCODE='23514'; END IF;
  SELECT jsonb_agg(jsonb_build_object('billingUnderlayId',s.billing_underlay_id,'siteId',s.snapshot->'siteId')
      ORDER BY s.billing_underlay_id) INTO members
    FROM gridex_invoice_groups.sources s
    WHERE s.company_id=p_company_id AND s.invoice_id=p_invoice_id;
  IF jsonb_array_length(members) IS DISTINCT FROM jsonb_array_length(convert_from(copy.body,'UTF8')::jsonb->'sites')
     OR EXISTS(SELECT FROM jsonb_array_elements(members) m WHERE jsonb_typeof(m->'siteId') IS DISTINCT FROM 'string') THEN
    RAISE EXCEPTION 'invoice_group_correction_source_unqualified' USING ERRCODE='23514';
  END IF;

  PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company_id,p_corrected_underlay_id);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::text||':invoice-group-correction:'||
    p_original_underlay_id::text||':'||p_source_value_id::text,0));
  SELECT * INTO prior FROM public.billing_adjustment_cases c WHERE c.company_id=p_company_id
    AND c.original_billing_underlay_id=p_original_underlay_id AND c.source_normalized_metering_value_id=p_source_value_id;
  IF FOUND THEN
    SELECT * INTO lineage FROM gridex_invoice_groups.correction_origins o WHERE o.adjustment_id=prior.id;
    IF NOT FOUND OR lineage.company_id IS DISTINCT FROM p_company_id OR lineage.invoice_id IS DISTINCT FROM p_invoice_id
       OR lineage.review_hash IS DISTINCT FROM target.review_hash OR lineage.document_sha256 IS DISTINCT FROM copy.body_sha256
       OR lineage.members IS DISTINCT FROM members OR prior.original_invoice_id IS DISTINCT FROM p_invoice_id
       OR prior.corrected_billing_underlay_id IS DISTINCT FROM p_corrected_underlay_id OR prior.reason IS DISTINCT FROM reason_value THEN
      RAISE EXCEPTION 'invoice_group_correction_conflict' USING ERRCODE='23505';
    END IF;
    case_id:=prior.id;
    replayed:=true;
  ELSE
    -- The normal reconciliation producer supplies the accepted charge_final basis.
    -- The grouped invoice and the correction's independent metered source are both required.
    PERFORM 1
    FROM public.billing_underlays u
    JOIN public.billing_underlay_items li ON li.company_id=u.company_id AND li.billing_underlay_id=u.id
    JOIN public.normalized_metering_values m ON m.company_id=u.company_id AND m.id=p_source_value_id
      AND m.id=li.source_normalized_metering_value_id
    WHERE u.company_id=p_company_id AND u.id=p_corrected_underlay_id AND u.customer_id=target.customer_id
      AND coalesce(u.customer_site_id,u.site_id)=(source_row.snapshot->>'siteId')::uuid
      AND u.metering_point_id=(source_row.snapshot->>'meteringPointId')::uuid
      AND coalesce(u.customer_contract_id,u.contract_id)=(source_row.snapshot->>'contractId')::uuid
      AND u.billing_period_start=(source_row.snapshot->>'periodStart')::date
      AND u.billing_period_end=(source_row.snapshot->>'periodEnd')::date
      AND u.currency=target.currency AND u.invoice_export_locked_at IS NULL
      AND u.status='validated' AND u.readiness_status='ready' AND u.energy_direction='consumption' AND u.settlement_type='invoice'
      AND u.source_system='consumption_estimate_reconciliation' AND u.payload->>'reconciliation_role'='charge_final'
      AND u.payload->>'reconciliation_of'=p_original_underlay_id::text
      AND li.metering_point_id=u.metering_point_id AND coalesce(li.customer_site_id,li.site_id)=coalesce(u.customer_site_id,u.site_id)
      AND li.customer_id=u.customer_id AND li.source_table='normalized_metering_values'
      AND m.customer_id=u.customer_id AND m.metering_point_id=u.metering_point_id
      AND coalesce(m.customer_site_id,m.site_id)=coalesce(u.customer_site_id,u.site_id)
      AND m.revision_status='current' AND m.billing_gate_status='eligible' AND m.billing_status='billable'
      AND lower(coalesce(m.quality_status,'')) NOT IN ('estimated','preliminary','temp','temporary','calculated')
      AND li.period_end>li.period_start
      AND li.period_start>=m.period_start AND li.period_end<=m.period_end
      AND li.period_start>=(u.billing_period_start::timestamp AT TIME ZONE 'Europe/Stockholm')
      AND li.period_end<=(u.billing_period_end::timestamp AT TIME ZONE 'Europe/Stockholm')
    FOR SHARE OF u,li,m;
    IF NOT FOUND THEN RAISE EXCEPTION 'invoice_group_correction_source_unqualified' USING ERRCODE='23514'; END IF;

    INSERT INTO public.billing_adjustment_cases(company_id,environment,original_billing_underlay_id,corrected_billing_underlay_id,
      source_normalized_metering_value_id,original_invoice_id,reason,status,currency)
    VALUES(p_company_id,target.environment,p_original_underlay_id,p_corrected_underlay_id,p_source_value_id,p_invoice_id,
      reason_value,'detected',target.currency)
    ON CONFLICT (company_id,original_billing_underlay_id,source_normalized_metering_value_id) DO NOTHING
    RETURNING id INTO case_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'invoice_group_correction_conflict' USING ERRCODE='23505'; END IF;
    INSERT INTO gridex_invoice_groups.correction_origins VALUES(case_id,p_company_id,p_invoice_id,p_actor_user_id,
      target.review_hash,copy.body_sha256,members);
  END IF;
  RETURN jsonb_build_object('caseId',case_id,'originalInvoiceId',p_invoice_id,'replayed',replayed);
END
$group_correction$;
REVOKE ALL ON FUNCTION public.gridex_register_grouped_invoice_correction_v1(uuid,uuid,uuid,uuid,uuid,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_register_grouped_invoice_correction_v1(uuid,uuid,uuid,uuid,uuid,uuid,text) TO service_role;
END
$gridex_group_correction_migration$;
