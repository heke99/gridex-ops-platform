DO $gridex_file_correction_migration$
BEGIN
CREATE TABLE gridex_invoice_file_archive.correction_origins (
  adjustment_id uuid PRIMARY KEY REFERENCES public.billing_adjustment_cases(id),
  company_id uuid NOT NULL,
  invoice_id uuid NOT NULL REFERENCES public.customer_invoices(id),
  file_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  invoice_number text NOT NULL CHECK (btrim(invoice_number)<>''),
  review_hash text NOT NULL CHECK (review_hash ~ '^[a-f0-9]{64}$'),
  calculation_sha256 text NOT NULL CHECK (calculation_sha256 ~ '^[a-f0-9]{64}$'),
  rows_sha256 text NOT NULL CHECK (rows_sha256 ~ '^[a-f0-9]{64}$'),
  artifact_sha256 text NOT NULL CHECK (artifact_sha256 ~ '^[a-f0-9]{64}$'),
  FOREIGN KEY(company_id,file_id) REFERENCES gridex_invoice_file_archive.receipts(company_id,file_id)
);
ALTER TABLE gridex_invoice_file_archive.correction_origins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_invoice_file_archive.correction_origins FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER invoice_file_correction_origin_append_only BEFORE UPDATE OR DELETE ON gridex_invoice_file_archive.correction_origins
FOR EACH ROW EXECUTE FUNCTION gridex_invoice_file_archive.deny_mutation();

CREATE FUNCTION gridex_invoice_file_archive.protect_correction_origin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $protect$
BEGIN
  IF ROW(NEW.id,NEW.company_id,NEW.environment,NEW.original_billing_underlay_id,NEW.corrected_billing_underlay_id,
      NEW.source_normalized_metering_value_id,NEW.original_invoice_id,NEW.reason,NEW.currency)
     IS DISTINCT FROM ROW(OLD.id,OLD.company_id,OLD.environment,OLD.original_billing_underlay_id,OLD.corrected_billing_underlay_id,
      OLD.source_normalized_metering_value_id,OLD.original_invoice_id,OLD.reason,OLD.currency)
     AND EXISTS(SELECT FROM gridex_invoice_file_archive.correction_origins o WHERE o.adjustment_id=OLD.id) THEN
    RAISE EXCEPTION 'invoice_correction_origin_immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END
$protect$;
REVOKE ALL ON FUNCTION gridex_invoice_file_archive.protect_correction_origin() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER invoice_file_correction_origin_guard BEFORE UPDATE OF id,company_id,environment,original_billing_underlay_id,
  corrected_billing_underlay_id,source_normalized_metering_value_id,original_invoice_id,reason,currency ON public.billing_adjustment_cases
FOR EACH ROW EXECUTE FUNCTION gridex_invoice_file_archive.protect_correction_origin();

CREATE FUNCTION public.gridex_register_invoice_correction_v1(
  p_company_id uuid,
  p_invoice_id uuid,
  p_actor_user_id uuid,
  p_original_underlay_id uuid,
  p_corrected_underlay_id uuid,
  p_source_value_id uuid,
  p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $register$
DECLARE
  original record;
  prior public.billing_adjustment_cases%ROWTYPE;
  origin gridex_invoice_file_archive.correction_origins%ROWTYPE;
  artifact jsonb;
  document jsonb;
  case_id uuid;
  reason_value text := nullif(btrim(p_reason),'');
  replayed boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR
     public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'billing_underlay.export') IS NOT TRUE THEN
    RAISE EXCEPTION 'invoice_correction_permission_denied' USING ERRCODE='42501';
  END IF;
  IF p_invoice_id IS NULL OR p_original_underlay_id IS NULL OR p_corrected_underlay_id IS NULL
     OR p_source_value_id IS NULL OR p_original_underlay_id=p_corrected_underlay_id
     OR reason_value IS NULL OR char_length(reason_value)>1000 THEN
    RAISE EXCEPTION 'invoice_correction_invalid' USING ERRCODE='22023';
  END IF;

  IF EXISTS(SELECT FROM public.customer_invoices i WHERE i.company_id=p_company_id
      AND i.id=p_invoice_id AND i.source_system='invoice_group_v1') THEN
    RETURN public.gridex_register_grouped_invoice_correction_v1(p_company_id,p_invoice_id,p_actor_user_id,
      p_original_underlay_id,p_corrected_underlay_id,p_source_value_id,reason_value);
  END IF;

  PERFORM 1 FROM public.companies c
    WHERE c.id=p_company_id AND c.status IN ('active','onboarding') AND c.is_active AND NOT c.is_paused
    FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_correction_permission_denied' USING ERRCODE='42501'; END IF;

  SELECT i.customer_id,i.invoice_number,i.currency,i.calculation_snapshot_sha256,i.amount_inc_vat,
    e.id AS item_id,f.id AS file_id,f.environment,f.billing_month,f.rows,f.rows_sha256,
    e.metadata->'approval' AS approval,i.metadata->'approval' AS mirror_approval,r.selection,r.created_at_wire,
    coalesce(u.customer_site_id,u.site_id) AS site_id,u.metering_point_id,
    coalesce(u.customer_contract_id,u.contract_id) AS contract_id,u.billing_period_start,u.billing_period_end
  INTO original
  FROM public.customer_invoices i
  JOIN public.invoice_export_items e ON e.company_id=i.company_id AND e.id=i.invoice_export_item_id
  JOIN public.billing_underlays u ON u.company_id=i.company_id AND u.id=i.billing_underlay_id
  JOIN public.invoice_export_files f ON f.company_id=i.company_id AND f.id=e.export_file_id
  JOIN gridex_invoice_file_archive.receipts r ON r.company_id=f.company_id AND r.file_id=f.id
  WHERE i.company_id=p_company_id AND i.id=p_invoice_id AND u.id=p_original_underlay_id
    AND i.status IN ('issued','sent','paid','overdue') AND i.issued_at IS NOT NULL AND nullif(btrim(i.invoice_number),'') IS NOT NULL
    AND i.customer_id=u.customer_id AND e.customer_id=i.customer_id AND e.billing_underlay_id=u.id
    AND i.period_start=u.billing_period_start AND i.period_end=u.billing_period_end
    AND coalesce(i.customer_contract_id,i.contract_id)=coalesce(u.customer_contract_id,u.contract_id)
    AND u.energy_direction='consumption' AND u.settlement_type='invoice' AND u.currency=i.currency
    AND (u.customer_site_id IS NULL OR u.site_id IS NULL OR u.customer_site_id=u.site_id)
    AND (u.customer_contract_id IS NULL OR u.contract_id IS NULL OR u.customer_contract_id=u.contract_id)
    AND f.artifact_archive_version=2 AND f.provider IN ('file_export','nordfin')
    AND e.provider=f.provider AND e.environment=f.environment
  FOR SHARE OF i,e,u,f;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_correction_original_not_found' USING ERRCODE='P0002'; END IF;

  PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company_id,p_original_underlay_id,p_invoice_id,original.item_id);
  IF jsonb_typeof(original.rows) IS DISTINCT FROM 'array' OR jsonb_typeof(original.selection) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invoice_correction_origin_unqualified' USING ERRCODE='23514';
  END IF;
  IF original.approval->>'status' IS DISTINCT FROM 'approved'
    OR coalesce(original.approval->>'review_hash','') !~ '^[a-f0-9]{64}$'
    OR coalesce(original.calculation_snapshot_sha256,'') !~ '^[a-f0-9]{64}$'
    OR original.approval->>'calculation_snapshot_sha256' IS DISTINCT FROM original.calculation_snapshot_sha256
    OR original.mirror_approval IS DISTINCT FROM original.approval
    OR (SELECT count(*) FROM jsonb_array_elements(original.selection) choice WHERE choice->>'itemId'=original.item_id::text)<>1
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(original.selection) choice
      WHERE choice=jsonb_build_object('itemId',original.item_id,'reviewHash',original.approval->'review_hash',
        'approvedAt',original.approval->'approved_at','approvedBy',original.approval->'approved_by'))
    OR (SELECT count(*) FROM jsonb_array_elements(original.rows) row_data
      WHERE row_data->>'invoice_export_item_id'=original.item_id::text)<>1
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(original.rows) row_data
      WHERE row_data->>'invoice_export_item_id'=original.item_id::text AND row_data->>'invoice_number'=original.invoice_number
        AND row_data->'amount_inc_vat'=to_jsonb(original.amount_inc_vat) AND row_data->>'currency'=original.currency
        AND row_data->>'period_start'=original.billing_period_start::text AND row_data->>'period_end'=original.billing_period_end::text) THEN
    RAISE EXCEPTION 'invoice_correction_origin_unqualified' USING ERRCODE='23514';
  END IF;

  artifact:=public.gridex_read_invoice_file_artifact_v2(p_company_id,original.file_id,'json');
  document:=convert_from(decode(artifact->>'bodyBase64','base64'),'UTF8')::jsonb;
  IF document->>'format' IS DISTINCT FROM 'gridex_invoice_file_v1'
    OR document->>'file_id' IS DISTINCT FROM original.file_id::text
    OR document->>'billing_month' IS DISTINCT FROM original.billing_month
    OR document->>'created_at' IS DISTINCT FROM original.created_at_wire
    OR document->>'rows_sha256' IS DISTINCT FROM original.rows_sha256
    OR coalesce(original.rows_sha256,'') !~ '^[a-f0-9]{64}$'
    OR document->'invoices' IS DISTINCT FROM original.rows THEN
    RAISE EXCEPTION 'invoice_correction_origin_unqualified' USING ERRCODE='23514';
  END IF;

  -- Protect the original linkage from the old upsert as well as concurrent new submissions.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::text||':invoice-file-correction:'||
    p_original_underlay_id::text||':'||p_source_value_id::text,0));
  PERFORM 1 FROM public.billing_underlays u WHERE u.company_id=p_company_id AND u.id=p_corrected_underlay_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_correction_source_unqualified' USING ERRCODE='23514'; END IF;
  PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company_id,p_corrected_underlay_id);

  SELECT * INTO prior FROM public.billing_adjustment_cases c WHERE c.company_id=p_company_id
    AND c.original_billing_underlay_id=p_original_underlay_id AND c.source_normalized_metering_value_id=p_source_value_id;
  IF FOUND THEN
    SELECT * INTO origin FROM gridex_invoice_file_archive.correction_origins o WHERE o.adjustment_id=prior.id;
    IF NOT FOUND OR origin.company_id IS DISTINCT FROM p_company_id OR origin.invoice_id IS DISTINCT FROM p_invoice_id
       OR origin.file_id IS DISTINCT FROM original.file_id OR origin.invoice_number IS DISTINCT FROM original.invoice_number
       OR origin.review_hash IS DISTINCT FROM original.approval->>'review_hash'
       OR origin.calculation_sha256 IS DISTINCT FROM original.calculation_snapshot_sha256
       OR origin.rows_sha256 IS DISTINCT FROM original.rows_sha256 OR origin.artifact_sha256 IS DISTINCT FROM artifact->>'sha256'
       OR prior.original_invoice_id IS DISTINCT FROM p_invoice_id
       OR prior.corrected_billing_underlay_id IS DISTINCT FROM p_corrected_underlay_id OR prior.reason IS DISTINCT FROM reason_value THEN
      RAISE EXCEPTION 'invoice_correction_conflict' USING ERRCODE='23505';
    END IF;
    case_id:=prior.id;
    replayed:=true;
  ELSE
    PERFORM 1 FROM public.billing_underlays u
    JOIN public.billing_underlay_items li ON li.company_id=u.company_id AND li.billing_underlay_id=u.id
    JOIN public.normalized_metering_values m ON m.company_id=u.company_id AND m.id=p_source_value_id
      AND m.id=li.source_normalized_metering_value_id
    WHERE u.company_id=p_company_id AND u.id=p_corrected_underlay_id AND u.customer_id=original.customer_id
      AND coalesce(u.customer_site_id,u.site_id)=original.site_id AND u.metering_point_id=original.metering_point_id
      AND coalesce(u.customer_contract_id,u.contract_id)=original.contract_id
      AND (u.customer_site_id IS NULL OR u.site_id IS NULL OR u.customer_site_id=u.site_id)
      AND (u.customer_contract_id IS NULL OR u.contract_id IS NULL OR u.customer_contract_id=u.contract_id)
      AND u.billing_period_start=original.billing_period_start AND u.billing_period_end=original.billing_period_end
      AND u.currency=original.currency AND u.invoice_export_locked_at IS NULL
      AND u.status='validated' AND u.readiness_status='ready' AND u.energy_direction='consumption' AND u.settlement_type='invoice'
      AND u.source_system='consumption_estimate_reconciliation' AND u.payload->>'reconciliation_role'='charge_final'
      AND u.payload->>'reconciliation_of'=p_original_underlay_id::text
      AND li.metering_point_id=u.metering_point_id AND coalesce(li.customer_site_id,li.site_id)=original.site_id
      AND li.customer_id=u.customer_id AND li.source_table='normalized_metering_values'
      AND m.customer_id=u.customer_id AND m.metering_point_id=u.metering_point_id
      AND coalesce(m.customer_site_id,m.site_id)=original.site_id
      AND m.direction IN ('consumption','net_consumption')
      AND m.revision_status='current' AND m.billing_gate_status='eligible' AND m.billing_status='billable'
      AND lower(coalesce(m.quality_status,'')) NOT IN ('estimated','preliminary','temp','temporary','calculated')
      AND li.period_end>li.period_start AND li.period_start>=m.period_start AND li.period_end<=m.period_end
      AND li.period_start>=(u.billing_period_start::timestamp AT TIME ZONE 'Europe/Stockholm')
      AND li.period_end<=(u.billing_period_end::timestamp AT TIME ZONE 'Europe/Stockholm')
    LIMIT 1 FOR SHARE OF li,m;
    IF NOT FOUND THEN RAISE EXCEPTION 'invoice_correction_source_unqualified' USING ERRCODE='23514'; END IF;

    INSERT INTO public.billing_adjustment_cases(company_id,environment,original_billing_underlay_id,corrected_billing_underlay_id,
      source_normalized_metering_value_id,original_invoice_id,reason,status,currency)
    VALUES(p_company_id,original.environment,p_original_underlay_id,p_corrected_underlay_id,p_source_value_id,p_invoice_id,
      reason_value,'detected',original.currency)
    ON CONFLICT (company_id,original_billing_underlay_id,source_normalized_metering_value_id) DO NOTHING
    RETURNING id INTO case_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'invoice_correction_conflict' USING ERRCODE='23505'; END IF;
    INSERT INTO gridex_invoice_file_archive.correction_origins VALUES(case_id,p_company_id,p_invoice_id,original.file_id,p_actor_user_id,
      original.invoice_number,original.approval->>'review_hash',original.calculation_snapshot_sha256,original.rows_sha256,artifact->>'sha256');
  END IF;
  RETURN jsonb_build_object('caseId',case_id,'originalInvoiceId',p_invoice_id,'replayed',replayed);
END
$register$;
REVOKE ALL ON FUNCTION public.gridex_register_invoice_correction_v1(uuid,uuid,uuid,uuid,uuid,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_register_invoice_correction_v1(uuid,uuid,uuid,uuid,uuid,uuid,text) TO service_role;
END
$gridex_file_correction_migration$;
