-- The Supabase CLI records this disposition with the schema change.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $gridex_invoice_test_approval$
BEGIN
DO $invoice_test_approval_preflight$
BEGIN
  IF (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')
        FROM pg_catalog.pg_proc p
       WHERE p.oid=to_regprocedure('public.gridex_approve_invoice_test_item_v1(uuid,uuid,jsonb)')
         AND p.prosecdef AND p.proowner=current_user::regrole)
     IS DISTINCT FROM '4283a0228506448e296ffab0da487b8a4acc658464082eb596f95a13f0ec429a' THEN
    RAISE EXCEPTION 'invoice_test_approval_predecessor_changed' USING ERRCODE='55000';
  END IF;
END
$invoice_test_approval_preflight$;

CREATE OR REPLACE FUNCTION public.gridex_approve_invoice_test_item_v1(
  p_company_id uuid, p_invoice_export_item_id uuid, p_approval jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
SET lock_timeout = '5s'
AS $$
DECLARE
  v_actor uuid;
  v_company public.companies%ROWTYPE;
  v_item public.invoice_export_items%ROWTYPE;
  v_invoice public.customer_invoices%ROWTYPE;
  v_run public.invoice_export_runs%ROWTYPE;
  v_approval jsonb;
  v_audit_id uuid;
  v_now timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'invoice_test_approval_service_role_required' USING ERRCODE='42501';
  END IF;
  IF p_company_id IS NULL OR p_invoice_export_item_id IS NULL
     OR jsonb_typeof(p_approval) IS DISTINCT FROM 'object'
     OR p_approval->>'status' IS DISTINCT FROM 'approved'
     OR p_approval->>'approval_source' IS DISTINCT FROM 'invoice_test_center'
     OR coalesce(p_approval->>'review_hash','') !~ '^[0-9a-f]{64}$'
     OR nullif(btrim(p_approval->>'calculation_snapshot_sha256'),'') IS NULL
     OR coalesce(p_approval->>'approved_by','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'invoice_test_approval_payload_invalid' USING ERRCODE='22023';
  END IF;
  v_actor := (p_approval->>'approved_by')::uuid;
  IF public.canonical_actor_is_platform_admin(v_actor) IS NOT TRUE THEN
    RAISE EXCEPTION 'invoice_test_approval_actor_forbidden' USING ERRCODE='42501';
  END IF;

  -- Same leading locks as the ordinary approval producer.
  SELECT * INTO v_company FROM public.companies WHERE id=p_company_id FOR UPDATE;
  IF NOT FOUND OR v_company.invoice_export_target_system IS DISTINCT FROM 'capway_aptic'
     OR v_company.billing_provider_environment IS DISTINCT FROM 'test'
     OR v_company.invoice_export_enabled IS NOT TRUE
     OR v_company.is_active IS FALSE
     OR coalesce(v_company.status,'active') IN ('paused','suspended','closed','archived','pending_deletion','deleted_test_only') THEN
    RAISE EXCEPTION 'invoice_test_approval_scope_changed' USING ERRCODE='40001';
  END IF;
  SELECT * INTO v_item FROM public.invoice_export_items
    WHERE company_id=p_company_id AND id=p_invoice_export_item_id FOR UPDATE;
  IF NOT FOUND OR v_item.status IS DISTINCT FROM 'pending'
     OR v_item.provider IS DISTINCT FROM 'capway_aptic'
     OR v_item.environment IS DISTINCT FROM 'test' OR v_item.export_file_id IS NOT NULL THEN
    RAISE EXCEPTION 'invoice_test_approval_item_not_pending' USING ERRCODE='23514';
  END IF;
  -- UPDATE strength also serializes new child items through the existing run FK.
  SELECT * INTO v_run FROM public.invoice_export_runs
    WHERE company_id=p_company_id AND id=v_item.export_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.provider IS DISTINCT FROM 'capway_aptic' OR v_run.environment IS DISTINCT FROM 'test'
     OR EXISTS (SELECT FROM public.invoice_export_items i
                 WHERE i.company_id=p_company_id AND i.export_run_id=v_run.id AND i.id<>v_item.id) THEN
    RAISE EXCEPTION 'invoice_test_approval_scope_changed' USING ERRCODE='40001';
  END IF;
  PERFORM 1 FROM public.customers c
    WHERE c.company_id=p_company_id AND c.id=v_item.customer_id AND c.archived_at IS NULL
      AND c.is_test_data IS TRUE AND btrim(c.source)='invoice_test_center'
      AND btrim(c.metadata#>>'{test_center,kind}')='invoice_test_customer' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice_test_approval_scope_changed' USING ERRCODE='40001';
  END IF;
  PERFORM 1 FROM public.billing_provider_connections b
    WHERE b.company_id=p_company_id AND b.provider='capway_aptic' AND b.environment='test'
      AND b.status IN ('ready','active') FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice_test_approval_scope_changed' USING ERRCODE='40001';
  END IF;
  SELECT * INTO v_invoice FROM public.customer_invoices
    WHERE company_id=p_company_id AND invoice_export_item_id=v_item.id FOR UPDATE;
  IF NOT FOUND OR v_invoice.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'invoice_test_approval_invoice_not_draft' USING ERRCODE='23514';
  END IF;
  IF v_invoice.customer_id IS DISTINCT FROM v_item.customer_id
     OR v_invoice.calculation_snapshot_sha256 IS DISTINCT FROM p_approval->>'calculation_snapshot_sha256' THEN
    RAISE EXCEPTION 'invoice_test_approval_scope_changed' USING ERRCODE='40001';
  END IF;

  -- Revalidate the human actor after waiting on the owned graph.
  IF public.canonical_actor_is_platform_admin(v_actor) IS NOT TRUE THEN
    RAISE EXCEPTION 'invoice_test_approval_actor_forbidden' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(v_item.metadata) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_invoice.metadata) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invoice_test_approval_conflict' USING ERRCODE='23514';
  END IF;
  v_approval := v_item.metadata->'approval';
  IF v_approval->>'status'='approved' OR v_invoice.metadata#>>'{approval,status}'='approved' THEN
    IF v_approval IS DISTINCT FROM v_invoice.metadata->'approval'
       OR v_approval->>'status' IS DISTINCT FROM 'approved'
       OR v_approval->>'approval_source' IS DISTINCT FROM 'invoice_test_center'
       OR v_approval->>'review_hash' IS DISTINCT FROM p_approval->>'review_hash'
       OR v_approval->>'calculation_snapshot_sha256' IS DISTINCT FROM v_invoice.calculation_snapshot_sha256
       OR coalesce(v_approval->>'approved_by','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
       OR NOT coalesce(pg_input_is_valid(v_approval->>'approved_at','timestamp with time zone'),false) THEN
      RAISE EXCEPTION 'invoice_test_approval_conflict' USING ERRCODE='23514';
    END IF;
    IF NOT isfinite((v_approval->>'approved_at')::timestamptz) THEN
      RAISE EXCEPTION 'invoice_test_approval_conflict' USING ERRCODE='23514';
    END IF;
    IF v_approval ? 'audit_event_id' THEN
      IF coalesce(v_approval->>'audit_event_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'invoice_test_approval_conflict' USING ERRCODE='23514';
      END IF;
      IF NOT EXISTS (
        SELECT FROM public.audit_logs a WHERE a.id=(v_approval->>'audit_event_id')::uuid
          AND a.company_id=p_company_id AND a.entity_type='invoice_export_item'
          AND a.entity_id=v_item.id::text AND a.action='invoice_test_item_approved' AND a.new_values=v_approval
      ) THEN
        RAISE EXCEPTION 'invoice_test_approval_conflict' USING ERRCODE='23514';
      END IF;
    END IF;
    RETURN jsonb_build_object('invoice_export_item_id',v_item.id,'invoice_id',v_invoice.id,
      'approved_now',false,'approval',v_approval);
  END IF;

  v_audit_id := gen_random_uuid();
  v_now := clock_timestamp();
  v_approval := jsonb_build_object(
    'status','approved','approval_source','invoice_test_center','approved_by',v_actor,
    'approved_at',v_now,'review_hash',p_approval->>'review_hash',
    'calculation_snapshot_sha256',v_invoice.calculation_snapshot_sha256,'audit_event_id',v_audit_id
  );
  UPDATE public.invoice_export_items SET metadata=metadata||jsonb_build_object('approval',v_approval),
    updated_at=v_now WHERE company_id=p_company_id AND id=v_item.id;
  UPDATE public.customer_invoices SET metadata=metadata||jsonb_build_object('approval',v_approval),
    updated_at=v_now WHERE company_id=p_company_id AND id=v_invoice.id;
  INSERT INTO public.audit_logs(id,company_id,actor_user_id,actor_type,entity_type,entity_id,action,new_values,
    resource_type,resource_id)
    VALUES(v_audit_id,p_company_id,v_actor,'user','invoice_export_item',v_item.id::text,
      'invoice_test_item_approved',v_approval,'invoice_export_item',v_item.id::text);
  RETURN jsonb_build_object('invoice_export_item_id',v_item.id,'invoice_id',v_invoice.id,
    'approved_now',true,'approval',v_approval);
END $$;
REVOKE ALL ON FUNCTION public.gridex_approve_invoice_test_item_v1(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_approve_invoice_test_item_v1(uuid,uuid,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';

END
$gridex_invoice_test_approval$;
RESET statement_timeout;
RESET lock_timeout;
