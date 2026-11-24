DO $gridex_c44_migration$
BEGIN
CREATE FUNCTION public.gridex_register_contract_withdrawal_case_v1(
  p_company_id uuid,
  p_customer_id uuid,
  p_contract_id uuid,
  p_site_id uuid,
  p_meter_id uuid,
  p_actor_id uuid,
  p_intent_id uuid,
  p_received_at timestamptz,
  p_channel text,
  p_reason text,
  p_notes text,
  p_assessment jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  contract public.customer_contracts%ROWTYPE;
  previous public.customer_cases%ROWTYPE;
  request_scope jsonb;
  affected integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'contract_withdrawal_actor_required' USING ERRCODE='42501';
  END IF;
  IF p_intent_id IS NULL OR p_customer_id IS NULL OR p_contract_id IS NULL OR p_site_id IS NULL OR p_meter_id IS NULL
    OR p_received_at IS NULL OR p_channel IS NULL OR p_channel NOT IN ('phone','email','web_form','letter','other')
    OR NULLIF(btrim(p_reason),'') IS NULL OR jsonb_typeof(p_assessment) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'contract_withdrawal_payload_invalid' USING ERRCODE='22023';
  END IF;

  -- Match #1006 and the file writer first, and keep canonical customer/contract ordering next.
  PERFORM 1 FROM public.companies WHERE id=p_company_id AND coalesce(is_active,true)
    AND coalesce(status,'active') NOT IN ('paused','suspended','closed','archived','pending_deletion','deleted_test_only') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_withdrawal_company_unavailable' USING ERRCODE='42501'; END IF;
  IF public.gridex_actor_has_company_permission(p_actor_id,p_company_id,'masterdata.write') IS NOT TRUE THEN
    RAISE EXCEPTION 'contract_withdrawal_actor_required' USING ERRCODE='42501';
  END IF;

  request_scope := jsonb_build_object('contractId',p_contract_id,'siteId',p_site_id,'meterId',p_meter_id,
    'receivedEpoch',extract(epoch FROM p_received_at),'channel',p_channel,'reason',p_reason,'notes',p_notes);
  SELECT * INTO previous FROM public.customer_cases WHERE id=p_intent_id;
  IF FOUND THEN
    IF previous.company_id IS DISTINCT FROM p_company_id OR previous.customer_id IS DISTINCT FROM p_customer_id
       OR previous.created_by IS DISTINCT FROM p_actor_id OR previous.source IS DISTINCT FROM 'customer_card_contract_withdrawal_v1'
       OR previous.metadata->'requestScope' IS DISTINCT FROM request_scope THEN
      RAISE EXCEPTION 'contract_withdrawal_intent_conflict' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('caseId',previous.id,'heldUnderlays',previous.metadata->'heldUnderlays','existing',true);
  END IF;

  PERFORM 1 FROM public.customers WHERE company_id=p_company_id AND id=p_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_withdrawal_customer_missing' USING ERRCODE='P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_contract_id::text,0));
  SELECT * INTO contract FROM public.customer_contracts
    WHERE id=p_contract_id AND company_id=p_company_id AND customer_id=p_customer_id FOR UPDATE;
  IF NOT FOUND
     OR COALESCE(contract.site_id,contract.customer_site_id) IS DISTINCT FROM p_site_id
     OR (contract.site_id IS NOT NULL AND contract.customer_site_id IS NOT NULL AND contract.site_id<>contract.customer_site_id)
     OR contract.metering_point_id IS DISTINCT FROM p_meter_id
     OR contract.updated_at IS DISTINCT FROM (p_assessment->>'contractUpdatedAt')::timestamptz THEN
    RAISE EXCEPTION 'contract_withdrawal_scope_changed' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public.customer_sites WHERE company_id=p_company_id AND id=p_site_id AND customer_id=p_customer_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_withdrawal_scope_changed' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.metering_points WHERE company_id=p_company_id AND id=p_meter_id
    AND customer_id=p_customer_id AND coalesce(site_id,customer_site_id)=p_site_id
    AND (site_id IS NULL OR customer_site_id IS NULL OR site_id=customer_site_id) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_withdrawal_scope_changed' USING ERRCODE='23514'; END IF;

  -- This candidate only owns the pre-switch branch. A known or ambiguous
  -- existing switch under this match requires its existing owner.
  IF contract.status NOT IN ('draft','pending_signature','signature_failed','signed')
     OR contract.actual_start_at IS NOT NULL OR contract.actual_start_date IS NOT NULL
     OR EXISTS (
       SELECT FROM public.supplier_switch_requests request
       WHERE request.company_id=p_company_id AND request.customer_id=p_customer_id
         AND (request.contract_id=p_contract_id OR request.customer_contract_id=p_contract_id
          OR (request.contract_id IS NULL AND request.customer_contract_id IS NULL
              AND request.metering_point_id=p_meter_id
              AND (request.site_id=p_site_id OR request.customer_site_id=p_site_id)))
     ) THEN
    RAISE EXCEPTION 'contract_withdrawal_followup_required' USING ERRCODE='23514';
  END IF;

  PERFORM public.gridex_register_customer_lifecycle_decision_v1(
    p_company_id,p_customer_id,p_actor_id,'withdrawal','contract',p_contract_id,p_received_at,p_reason
  );

  INSERT INTO public.customer_cases(
    id,company_id,customer_id,site_id,metering_point_id,customer_contract_id,
    case_type,status,priority,title,description,reason_category,withdrawal_requested_at,
    agreement_channel,agreement_created_at,is_distance_agreement,withdrawal_deadline_at,withdrawal_possible,switch_can_be_stopped,
    withdrawal_scenario,cancellation_status,billing_blocked,next_action,source,created_by,updated_by,metadata
  ) VALUES(
    p_intent_id,p_company_id,p_customer_id,p_site_id,p_meter_id,p_contract_id,
    'withdrawal','billing_blocked','high','Ånger registrerad',p_reason,'withdrawal',p_received_at,
    p_assessment->>'agreementChannel',(p_assessment->>'agreementCreatedAt')::timestamptz,
    COALESCE((p_assessment->>'isDistanceAgreement')::boolean,false),(p_assessment->>'withdrawalDeadlineAt')::timestamptz,
    COALESCE((p_assessment->>'withdrawalPossible')::boolean,false),true,
    'before_prodat_sent','not_required',true,
    'Bekräfta ångern och granska eventuella kvarstående utgående förfrågningar.',
    'customer_card_contract_withdrawal_v1',p_actor_id,p_actor_id,
    jsonb_build_object('scopeType','contract','scopeId',p_contract_id,'decisionType','withdrawal',
     'blockBilling',true,'receivedChannel',p_channel,'notes',p_notes,'requestScope',request_scope,
     'assessment',p_assessment-ARRAY['contractUpdatedAt','agreementChannel','agreementCreatedAt','isDistanceAgreement'])
  );

  INSERT INTO gridex_case_confirmation.withdrawal_intents(case_id,company_id,customer_id)
  VALUES(p_intent_id,p_company_id,p_customer_id);

  UPDATE public.billing_underlays underlay
  SET readiness_status='blocked',
      billing_blocked_by_case_id=p_intent_id,
      failure_reason='Manuell kontroll krävs på grund av kundärende '||p_intent_id::text||'.',
      updated_by=p_actor_id,updated_at=statement_timestamp()
  WHERE underlay.company_id=p_company_id AND underlay.customer_id=p_customer_id
    AND coalesce(underlay.customer_contract_id,underlay.contract_id)=p_contract_id
    AND (underlay.contract_id IS NULL OR underlay.customer_contract_id IS NULL OR underlay.contract_id=underlay.customer_contract_id)
    AND underlay.status='validated' AND underlay.readiness_status='ready'
    AND underlay.invoice_export_run_id IS NULL AND underlay.invoice_export_locked_at IS NULL;
  GET DIAGNOSTICS affected=ROW_COUNT;

  UPDATE public.customer_cases
  SET metadata=metadata||jsonb_build_object('heldUnderlays',affected)
  WHERE id=p_intent_id AND company_id=p_company_id AND customer_id=p_customer_id;
  INSERT INTO public.customer_case_events(
    company_id,customer_case_id,customer_id,event_type,event_status,message,payload,created_by
  ) VALUES(
    p_company_id,p_intent_id,p_customer_id,'created','warning','Avtalsstopp och faktureringsstopp sparades.',
    jsonb_build_object('contractId',p_contract_id,'heldUnderlays',affected),p_actor_id
  );
  INSERT INTO public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,new_values,metadata)
  VALUES(p_company_id,p_actor_id,'customer_lifecycle_decision',p_intent_id::text,'customer_withdrawal_registered',
    jsonb_build_object('customerCaseId',p_intent_id,'contractId',p_contract_id,'reason',p_reason,'heldUnderlays',affected),
    jsonb_build_object('customerId',p_customer_id,'scopeType','contract','scopeId',p_contract_id));

  RETURN jsonb_build_object('caseId',p_intent_id,'heldUnderlays',affected,'existing',false);
END
$$;
REVOKE ALL ON FUNCTION public.gridex_register_contract_withdrawal_case_v1(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,text,jsonb)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_register_contract_withdrawal_case_v1(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,text,jsonb)
TO service_role;
END;
$gridex_c44_migration$;
