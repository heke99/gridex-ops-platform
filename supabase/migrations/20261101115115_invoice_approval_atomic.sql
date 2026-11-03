-- T4 / BILLNEG01.02: one transaction owns the approval, mirror and durable event.
-- This forward is independent of the retained ledger/webhook GEN packet.
BEGIN;

CREATE FUNCTION public.gridex_approve_invoice_export_item_v1(
  p_company_id uuid,
  p_export_item_id uuid,
  p_actor_user_id uuid,
  p_expected_context jsonb,
  p_review_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog
SET lock_timeout TO '5s'
AS $$
DECLARE
  v_company public.companies%ROWTYPE;
  v_item public.invoice_export_items%ROWTYPE;
  v_invoice public.customer_invoices%ROWTYPE;
  v_pricing public.pricing_runs%ROWTYPE;
  v_underlay public.billing_underlays%ROWTYPE;
  v_actual jsonb;
  v_expected jsonb;
  v_keys text[];
  v_approval jsonb;
  v_event_id uuid;
  v_event_key text;
  v_approved_at timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'invoice_approval_service_role_required' USING ERRCODE='42501';
  END IF;
  IF p_company_id IS NULL OR p_export_item_id IS NULL OR p_actor_user_id IS NULL
     OR p_review_hash IS NULL OR p_review_hash !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_expected_context) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_expected_context->'item') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_expected_context->'invoice') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_expected_context->'underlay') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_expected_context->'pricing_run') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invoice_approval_context_required' USING ERRCODE='22023';
  END IF;

  -- Match file creation's company -> item -> mirror lock order. A finite lock
  -- timeout aborts the whole transition on contention, including retention work.
  SELECT * INTO v_company FROM public.companies WHERE id=p_company_id FOR UPDATE;
  IF NOT FOUND OR coalesce(v_company.status,'active') IN
       ('paused','suspended','closed','archived','pending_deletion','deleted_test_only')
     OR v_company.is_active IS FALSE THEN
    RAISE EXCEPTION 'invoice_approval_company_not_operational' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT FROM auth.users u JOIN public.user_profiles profile ON profile.id=u.id
    WHERE u.id=p_actor_user_id AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp())
      AND u.email_confirmed_at IS NOT NULL AND profile.user_status='active'
  ) OR public.gridex_actor_has_company_permission(
    p_actor_user_id,p_company_id,'billing_underlay.export'
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'invoice_approval_actor_forbidden' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_item FROM public.invoice_export_items
    WHERE company_id=p_company_id AND id=p_export_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice_approval_item_not_found' USING ERRCODE='P0002';
  END IF;
  SELECT * INTO STRICT v_invoice FROM public.customer_invoices
    WHERE company_id=p_company_id AND invoice_export_item_id=v_item.id FOR UPDATE;
  SELECT * INTO STRICT v_pricing FROM public.pricing_runs
    WHERE company_id=p_company_id AND id=v_item.pricing_run_id FOR SHARE;
  SELECT * INTO STRICT v_underlay FROM public.billing_underlays
    WHERE company_id=p_company_id AND id=v_item.billing_underlay_id FOR SHARE;

  IF v_item.status IS DISTINCT FROM 'pending' OR v_invoice.status IS DISTINCT FROM 'draft'
     OR v_item.export_file_id IS NOT NULL
     OR jsonb_typeof(v_item.metadata) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_invoice.metadata) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invoice_approval_draft_required' USING ERRCODE='40001';
  END IF;
  PERFORM public.ediel_require_invoice_source_copies_available_v1(
    p_company_id,v_underlay.id,v_invoice.id,v_item.id
  );

  -- Bind the service's review hash to the exact reviewed business context.
  -- Exclude approval metadata/timestamps so a concurrent winner is an immutable
  -- replay, rather than a new approval by the waiting actor. Do not recompute the
  -- JS canonical hash with jsonb::text (which uses different serialization).
  FOR v_actual,v_expected,v_keys IN
    SELECT to_jsonb(v_item),p_expected_context->'item',ARRAY[
      'id','company_id','export_run_id','customer_id','customer_contract_id',
      'billing_underlay_id','pricing_run_id','status','export_file_id',
      'total_kwh','amount_ex_vat','vat_amount','amount_inc_vat','currency',
      'period_start','period_end','provider','environment']
    UNION ALL SELECT to_jsonb(v_invoice),p_expected_context->'invoice',ARRAY[
      'id','company_id','invoice_export_item_id','customer_id','billing_underlay_id',
      'customer_contract_id','status','total_kwh','consumption_kwh','amount_ex_vat',
      'vat_amount','amount_inc_vat','currency','price_area_code','calculation_snapshot_sha256',
      'period_start','period_end']
    UNION ALL SELECT to_jsonb(v_pricing),p_expected_context->'pricing_run',ARRAY[
      'id','company_id','billing_underlay_id','status','total_ex_vat','vat_amount','total_inc_vat']
    UNION ALL SELECT to_jsonb(v_underlay),p_expected_context->'underlay',ARRAY[
      'id','company_id','customer_id','customer_contract_id','contract_id','status',
      'readiness_status','missing_values_count','total_kwh','price_area',
      'pricing_snapshot','pricing_snapshot_id','contract_price_snapshot_id']
  LOOP
    IF (SELECT jsonb_object_agg(key,value) FROM jsonb_each(v_actual) WHERE key=ANY(v_keys))
       IS DISTINCT FROM
       (SELECT jsonb_object_agg(key,value) FROM jsonb_each(v_expected) WHERE key=ANY(v_keys)) THEN
      RAISE EXCEPTION 'invoice_approval_context_changed' USING ERRCODE='40001';
    END IF;
  END LOOP;

  IF v_underlay.status IS DISTINCT FROM 'validated'
     OR v_underlay.readiness_status IS DISTINCT FROM 'ready'
     OR coalesce(v_underlay.missing_values_count,0)>0
     OR v_pricing.status IS DISTINCT FROM 'locked' OR v_pricing.locked_at IS NULL
     OR v_pricing.billing_underlay_id IS DISTINCT FROM v_underlay.id
     OR v_item.customer_id IS NULL OR v_item.customer_id IS DISTINCT FROM v_underlay.customer_id
     OR v_invoice.customer_id IS DISTINCT FROM v_item.customer_id
     OR v_item.customer_contract_id IS DISTINCT FROM coalesce(v_underlay.customer_contract_id,v_underlay.contract_id)
     OR coalesce(v_invoice.price_area_code,v_underlay.price_area) IS NULL
     OR coalesce(v_invoice.price_area_code,v_underlay.price_area) NOT IN ('SE1','SE2','SE3','SE4')
     OR nullif(btrim(v_invoice.calculation_snapshot_sha256),'') IS NULL
     OR v_underlay.total_kwh IS NULL OR v_item.total_kwh IS NULL
     OR abs(v_underlay.total_kwh-v_item.total_kwh)>0.001
     OR (coalesce(v_invoice.total_kwh,v_invoice.consumption_kwh) IS NOT NULL
         AND abs(v_underlay.total_kwh-coalesce(v_invoice.total_kwh,v_invoice.consumption_kwh))>0.001)
     OR v_item.amount_ex_vat IS NULL OR v_pricing.total_ex_vat IS NULL
     OR abs(v_item.amount_ex_vat-v_pricing.total_ex_vat)>0.01
     OR v_item.vat_amount IS NULL OR v_pricing.vat_amount IS NULL
     OR abs(v_item.vat_amount-v_pricing.vat_amount)>0.01
     OR v_item.amount_inc_vat IS NULL OR v_pricing.total_inc_vat IS NULL
     OR abs(v_item.amount_inc_vat-v_pricing.total_inc_vat)>0.01
     OR v_invoice.amount_inc_vat IS NULL
     OR abs(v_invoice.amount_inc_vat-v_pricing.total_inc_vat)>0.01 THEN
    RAISE EXCEPTION 'invoice_approval_not_ready' USING ERRCODE='23514';
  END IF;

  IF v_item.metadata#>>'{approval,status}'='approved'
     OR v_invoice.metadata#>>'{approval,status}'='approved' THEN
    IF v_item.metadata->'approval' IS DISTINCT FROM v_invoice.metadata->'approval'
       OR v_item.metadata#>>'{approval,review_hash}' IS DISTINCT FROM p_review_hash
       OR v_item.metadata#>>'{approval,calculation_snapshot_sha256}' IS DISTINCT FROM v_invoice.calculation_snapshot_sha256
       OR nullif(v_item.metadata#>>'{approval,approved_by}','') IS NULL
       OR nullif(v_item.metadata#>>'{approval,approved_at}','') IS NULL THEN
      RAISE EXCEPTION 'invoice_approval_mirror_mismatch' USING ERRCODE='23514';
    END IF;
    RETURN jsonb_build_object('approved_now',false,'approval',v_item.metadata->'approval');
  END IF;

  v_approved_at:=clock_timestamp();
  v_approval:=jsonb_build_object('status','approved','approved_at',v_approved_at,
    'approved_by',p_actor_user_id,'review_hash',p_review_hash,
    'calculation_snapshot_sha256',v_invoice.calculation_snapshot_sha256);
  UPDATE public.invoice_export_items SET metadata=metadata||jsonb_build_object('approval',v_approval),
    updated_at=v_approved_at WHERE company_id=p_company_id AND id=v_item.id;
  UPDATE public.customer_invoices SET metadata=metadata||jsonb_build_object('approval',v_approval),
    updated_at=v_approved_at WHERE company_id=p_company_id AND id=v_invoice.id;

  v_event_key:='invoice-approved:'||v_item.id::text||':'||p_review_hash;
  INSERT INTO public.domain_events(company_id,event_type,aggregate_type,aggregate_id,
    subject_customer_id,actor_user_id,source,payload,idempotency_key)
  VALUES(p_company_id,'invoice.approved','invoice_export_item',v_item.id::text,
    v_item.customer_id,p_actor_user_id,'invoice_approved_dispatch_v1',
    jsonb_build_object('approved_at',v_approved_at,'review_hash',p_review_hash),v_event_key)
  RETURNING id INTO v_event_id;
  INSERT INTO public.event_outbox(company_id,domain_event_id,destination_type,destination_key,
    status,max_attempts,payload)
  VALUES(p_company_id,v_event_id,'webhook','webhook_fanout_v1','queued',12,
    jsonb_build_object('event_type','invoice.approved','aggregate_type','invoice_export_item',
      'aggregate_id',v_item.id::text));
  RETURN jsonb_build_object('approved_now',true,'approval',v_approval,'event_id',v_event_id);
END $$;

REVOKE ALL ON FUNCTION public.gridex_approve_invoice_export_item_v1(uuid,uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_approve_invoice_export_item_v1(uuid,uuid,uuid,jsonb,text) TO service_role;
COMMENT ON FUNCTION public.gridex_approve_invoice_export_item_v1(uuid,uuid,uuid,jsonb,text)
  IS 'Atomic invoice item/mirror approval, immutable replay and durable approval event. Trusted service caller; revalidates tenant actor and reviewed context.';
NOTIFY pgrst, 'reload schema';
COMMIT;
