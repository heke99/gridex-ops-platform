DO $migration$
BEGIN

CREATE TABLE gridex_case_confirmation.withdrawal_impact_key (
  singleton boolean PRIMARY KEY CHECK (singleton),
  secret bytea NOT NULL CHECK (octet_length(secret)=32)
);
REVOKE ALL ON TABLE gridex_case_confirmation.withdrawal_impact_key FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO gridex_case_confirmation.withdrawal_impact_key VALUES (true,extensions.gen_random_bytes(32));

CREATE FUNCTION gridex_case_confirmation.withdrawal_impact_actor_v1(p_company uuid,p_actor uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $function$
  SELECT public.gridex_actor_has_company_permission(p_actor,p_company,'masterdata.write')
    AND EXISTS (
      SELECT FROM auth.users u JOIN public.user_profiles profile ON profile.id=u.id
      WHERE u.id=p_actor AND u.deleted_at IS NULL AND u.email_confirmed_at IS NOT NULL
        AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp())
        AND profile.user_status='active'
    );
$function$;

CREATE FUNCTION gridex_case_confirmation.withdrawal_impact_v1(p_company uuid,p_customer uuid,p_contract uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $function$
  SELECT jsonb_build_object(
    'contract',jsonb_build_object('id',c.id,'name',c.contract_name,'status',c.status,'revision',extract(epoch FROM c.updated_at)),
    'site',jsonb_build_object('id',s.id,'name',s.site_name,'facility',s.facility_id),
    'meter',jsonb_build_object('id',m.id,'reference',coalesce(m.meter_point_id,m.metering_point_id)),
    'requiresFollowUp',c.status NOT IN ('draft','pending_signature','signature_failed','signed')
      OR c.actual_start_at IS NOT NULL OR c.actual_start_date IS NOT NULL
      OR EXISTS (
        SELECT FROM public.supplier_switch_requests request
        WHERE request.company_id=p_company AND request.customer_id=p_customer
          AND (request.contract_id=p_contract OR request.customer_contract_id=p_contract
            OR (request.contract_id IS NULL AND request.customer_contract_id IS NULL
                AND request.metering_point_id=m.id AND (request.site_id=s.id OR request.customer_site_id=s.id)))
      ),
    'underlays',coalesce(rows.result,'[]'::jsonb)
  )
  FROM public.customer_contracts c
  JOIN public.customer_sites s ON s.company_id=c.company_id AND s.customer_id=c.customer_id
    AND s.id=coalesce(c.site_id,c.customer_site_id)
  JOIN public.metering_points m ON m.company_id=c.company_id AND m.customer_id=c.customer_id
    AND m.id=c.metering_point_id AND coalesce(m.site_id,m.customer_site_id)=s.id
    AND (m.site_id IS NULL OR m.customer_site_id IS NULL OR m.site_id=m.customer_site_id)
  CROSS JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('id',u.id,'year',u.underlay_year,'month',u.underlay_month,
      'start',u.billing_period_start,'end',u.billing_period_end,'status',u.status,'readiness',u.readiness_status,
      'exportRunId',u.invoice_export_run_id,'exportLockedAt',extract(epoch FROM u.invoice_export_locked_at),
      'hasInvoiceDraftDependency',EXISTS (
        SELECT FROM gridex_invoice_groups.sources source
        JOIN public.customer_invoices invoice ON invoice.id=source.invoice_id AND invoice.company_id=source.company_id
        WHERE source.company_id=u.company_id AND source.billing_underlay_id=u.id
          AND invoice.customer_id=u.customer_id AND invoice.status='draft' AND invoice.source_system='invoice_group_v1'
      ),
      'effect',CASE
        WHEN u.contract_id IS NOT NULL AND u.customer_contract_id IS NOT NULL AND u.contract_id<>u.customer_contract_id
          THEN 'review'
        WHEN u.invoice_export_run_id IS NOT NULL OR u.invoice_export_locked_at IS NOT NULL THEN 'existing_invoice'
        WHEN u.status='validated' AND u.readiness_status='ready' THEN 'hold'
        ELSE 'no_update'
      END) ORDER BY u.id) AS result
    FROM public.billing_underlays u
    WHERE u.company_id=c.company_id AND u.customer_id=c.customer_id AND c.id IN (u.contract_id,u.customer_contract_id)
  ) rows
  WHERE c.company_id=p_company AND c.customer_id=p_customer AND c.id=p_contract
    AND (c.site_id IS NULL OR c.customer_site_id IS NULL OR c.site_id=c.customer_site_id);
$function$;

CREATE FUNCTION gridex_case_confirmation.withdrawal_impact_receipt_v1(
  p_company uuid,p_customer uuid,p_actor uuid,p_intent uuid,p_impact jsonb
) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $function$
  SELECT encode(extensions.hmac(convert_to(jsonb_build_array(
    'contract_withdrawal_impact_v1',p_company,p_customer,p_actor,p_intent,p_impact
  )::text,'UTF8'),secret,'sha256'),'hex')
  FROM gridex_case_confirmation.withdrawal_impact_key WHERE singleton;
$function$;

REVOKE ALL ON FUNCTION gridex_case_confirmation.withdrawal_impact_actor_v1(uuid,uuid),
  gridex_case_confirmation.withdrawal_impact_v1(uuid,uuid,uuid),
  gridex_case_confirmation.withdrawal_impact_receipt_v1(uuid,uuid,uuid,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.gridex_preview_contract_withdrawal_v1(
  p_company_id uuid,p_customer_id uuid,p_contract_id uuid,p_actor_id uuid,p_intent_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s'
AS $function$
DECLARE impact jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_intent_id IS NULL
    OR gridex_case_confirmation.withdrawal_impact_actor_v1(p_company_id,p_actor_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'contract_withdrawal_actor_required' USING ERRCODE='42501';
  END IF;
  PERFORM FROM public.companies WHERE id=p_company_id AND coalesce(is_active,true)
    AND coalesce(status,'active') NOT IN ('paused','suspended','closed','archived','pending_deletion','deleted_test_only') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_withdrawal_company_unavailable' USING ERRCODE='42501'; END IF;
  impact:=gridex_case_confirmation.withdrawal_impact_v1(p_company_id,p_customer_id,p_contract_id);
  IF impact IS NULL THEN RAISE EXCEPTION 'contract_withdrawal_scope_changed' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('impact',impact,'receipt',CASE WHEN impact->'requiresFollowUp'='false'::jsonb THEN
    gridex_case_confirmation.withdrawal_impact_receipt_v1(p_company_id,p_customer_id,p_actor_id,p_intent_id,impact) END);
END
$function$;

REVOKE ALL ON FUNCTION public.gridex_preview_contract_withdrawal_v1(uuid,uuid,uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_preview_contract_withdrawal_v1(uuid,uuid,uuid,uuid,uuid) TO service_role;

DO $patch$
DECLARE
  prior record;
  revision text;
  old_1 constant text := $fragment$  affected integer;$fragment$;
  new_1 constant text := $fragment$  affected integer;
  reviewed_impact jsonb;
  expected_receipt text;
  received_receipt text := p_assessment->>'impactReceipt';$fragment$;
  old_2 constant text := $fragment$IF public.gridex_actor_has_company_permission(p_actor_id,p_company_id,'masterdata.write') IS NOT TRUE THEN$fragment$;
  new_2 constant text := $fragment$IF gridex_case_confirmation.withdrawal_impact_actor_v1(p_company_id,p_actor_id) IS NOT TRUE THEN$fragment$;
  old_3 constant text := $fragment$    'receivedEpoch',extract(epoch FROM p_received_at),'channel',p_channel,'reason',p_reason,'notes',p_notes);
  SELECT * INTO previous$fragment$;
  new_3 constant text := $fragment$    'receivedEpoch',extract(epoch FROM p_received_at),'channel',p_channel,'reason',p_reason,'notes',p_notes);
  IF received_receipt IS NOT NULL THEN
    request_scope:=request_scope||jsonb_build_object('impactReceipt',received_receipt);
  END IF;
  SELECT * INTO previous$fragment$;
  old_4 constant text := $fragment$  -- This candidate only owns the pre-switch branch. A known or ambiguous
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
  END IF;$fragment$;
  new_4 constant text := $fragment$  PERFORM FROM public.billing_underlays u
    WHERE u.company_id=p_company_id AND u.customer_id=p_customer_id AND p_contract_id IN (u.contract_id,u.customer_contract_id)
    ORDER BY u.id FOR UPDATE;
  reviewed_impact:=gridex_case_confirmation.withdrawal_impact_v1(p_company_id,p_customer_id,p_contract_id);
  IF reviewed_impact IS NULL THEN
    RAISE EXCEPTION 'contract_withdrawal_scope_changed' USING ERRCODE='23514';
  END IF;
  IF reviewed_impact->'requiresFollowUp' IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'contract_withdrawal_followup_required' USING ERRCODE='23514';
  END IF;
  expected_receipt:=gridex_case_confirmation.withdrawal_impact_receipt_v1(
    p_company_id,p_customer_id,p_actor_id,p_intent_id,reviewed_impact);
  IF received_receipt IS NULL OR expected_receipt IS NULL OR received_receipt<>expected_receipt THEN
    RAISE EXCEPTION 'contract_withdrawal_impact_changed' USING ERRCODE='23514';
  END IF;$fragment$;
  old_5 constant text := $fragment$'assessment',p_assessment-ARRAY['contractUpdatedAt','agreementChannel','agreementCreatedAt','isDistanceAgreement'])$fragment$;
  new_5 constant text := $fragment$'assessment',p_assessment-ARRAY['contractUpdatedAt','agreementChannel','agreementCreatedAt','isDistanceAgreement','impactReceipt'])$fragment$;
  old_6 constant text := $fragment$    AND underlay.status='validated' AND underlay.readiness_status='ready'
    AND underlay.invoice_export_run_id IS NULL AND underlay.invoice_export_locked_at IS NULL;
  GET DIAGNOSTICS affected=ROW_COUNT;$fragment$;
  new_6 constant text := $fragment$    AND underlay.status='validated' AND underlay.readiness_status='ready'
    AND underlay.invoice_export_run_id IS NULL AND underlay.invoice_export_locked_at IS NULL
    AND underlay.id IN (SELECT (u->>'id')::uuid FROM jsonb_array_elements(reviewed_impact->'underlays') u WHERE u->>'effect'='hold');
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>(SELECT count(*) FROM jsonb_array_elements(reviewed_impact->'underlays') u WHERE u->>'effect'='hold') THEN
    RAISE EXCEPTION 'contract_withdrawal_impact_changed' USING ERRCODE='23514';
  END IF;$fragment$;
BEGIN
  SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata
    INTO STRICT prior FROM pg_proc proc
    WHERE oid=to_regprocedure('public.gridex_register_contract_withdrawal_case_v1(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,text,jsonb)');
  IF encode(sha256(convert_to(prior.prosrc,'UTF8')),'hex') <> '1ab33f9a90bbe0d9366f0f3933c2a9e07128b04f506eda71939702de7bd6eb22' THEN
    RAISE EXCEPTION 'contract_withdrawal_impact_predecessor_changed';
  END IF;
  revision:=prior.prosrc;
  revision:=replace(revision,old_1,new_1);
  revision:=replace(revision,old_2,new_2);
  revision:=replace(revision,old_3,new_3);
  revision:=replace(revision,old_4,new_4);
  revision:=replace(revision,old_5,new_5);
  revision:=replace(revision,old_6,new_6);
  EXECUTE replace(prior.definition,prior.prosrc,revision);
  IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=prior.oid) IS DISTINCT FROM prior.metadata
    OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=prior.oid) <> 'eaa6f90a214608051d4aa7335c9fea2f71e3dc2cdc19489c1f316a6134222c01' THEN
    RAISE EXCEPTION 'contract_withdrawal_impact_metadata_changed';
  END IF;
END
$patch$;

NOTIFY pgrst,'reload schema';

END
$migration$;
