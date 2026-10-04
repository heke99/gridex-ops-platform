-- S4 follow-up: the staff create path must never acknowledge a case without its event/audit.
-- OPS and customer callers retain the existing shared command; its staff adapter calls this RPC.
BEGIN;
CREATE FUNCTION public.gridex_create_staff_support_case_v1(p_company_id uuid,p_customer_id uuid,
  p_actor_user_id uuid,p_api_client_id uuid,p_title text,p_description text,p_category text,
  p_priority text,p_idempotency_key text,p_metadata jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_case public.customer_cases%ROWTYPE;
  v_case_id uuid:=gen_random_uuid();
  v_request_hash text;
  v_metadata jsonb;
  v_category text:=coalesce(nullif(btrim(p_category),''),'support');
  v_next_action text:='Supportärendet ska triageras inom tenantens ordinarie ärendeflöde.';
BEGIN
  PERFORM public.gridex_staff_assert_write_actor_v1(p_company_id,p_actor_user_id,p_api_client_id,'cases.write');
  IF NOT EXISTS(SELECT FROM public.integration_api_clients WHERE id=p_api_client_id AND company_id=p_company_id AND 'staff_cases.write'=ANY(scopes))
  THEN RAISE EXCEPTION 'staff_api_client_scope_missing' USING ERRCODE='42501'; END IF;
  IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 180
    OR (p_description IS NOT NULL AND length(p_description)>8000)
    OR length(v_category)>120 OR p_priority IS NULL OR p_priority NOT IN('low','normal','high','urgent')
    OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 200
    OR (p_metadata IS NOT NULL AND jsonb_typeof(p_metadata)<>'object')
  THEN RAISE EXCEPTION 'staff_support_create_invalid' USING ERRCODE='22023'; END IF;

  PERFORM 1 FROM public.customers WHERE id=p_customer_id AND company_id=p_company_id
    AND merged_into_customer_id IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'support_customer_not_found' USING ERRCODE='P0002'; END IF;
  -- The existing support unique key is company + customer + support key. Serialize before the
  -- lookup so a concurrent exact retry observes the committed row instead of failing midway.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_customer_id::text||':'||p_idempotency_key,0));
  v_request_hash:=encode(extensions.digest(jsonb_build_object('customer_id',p_customer_id,'actor_user_id',p_actor_user_id,
    'api_client_id',p_api_client_id,'title',btrim(p_title),'description',p_description,'category',v_category,
    'priority',p_priority,'metadata',coalesce(p_metadata,'{}'::jsonb))::text,'sha256'),'hex');
  SELECT * INTO v_case FROM public.customer_cases WHERE company_id=p_company_id AND customer_id=p_customer_id
    AND metadata->>'support_idempotency_key'=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_case.source IS DISTINCT FROM 'tenant_support_staff_api' OR v_case.case_type<>'other'
      OR v_case.metadata->>'support_case' IS DISTINCT FROM 'true'
      OR v_case.metadata->>'staff_create_request_hash' IS DISTINCT FROM v_request_hash
      OR v_case.billing_blocked OR v_case.billing_manual_review OR v_case.cancellation_required THEN
      RAISE EXCEPTION 'staff_support_idempotency_conflict' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('case',to_jsonb(v_case),'reused',true);
  END IF;
  v_metadata:=coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('support_case',true,'support_channel','staff_api',
    'support_idempotency_key',p_idempotency_key,'staff_create_request_hash',v_request_hash,'opened_by','staff',
    'actor_user_id',p_actor_user_id,'api_client_id',p_api_client_id,'description_visibility','internal',
    'support_public_reference','support_case_'||substr(translate(rtrim(encode(extensions.digest(
      'gridex-public-reference:v1:'||p_company_id::text||':support_case:'||v_case_id::text,'sha256'),'base64'),'='),'+/','-_'),1,32));
  INSERT INTO public.customer_cases(id,company_id,customer_id,case_type,status,priority,title,description,reason_category,
    source,metadata,next_action,billing_blocked,billing_manual_review,cancellation_required,cancellation_status,created_by,updated_by)
  VALUES(v_case_id,p_company_id,p_customer_id,'other','open',p_priority,btrim(p_title),p_description,v_category,
    'tenant_support_staff_api',v_metadata,v_next_action,false,false,false,'not_required',p_actor_user_id,p_actor_user_id)
  RETURNING * INTO v_case;
  INSERT INTO public.customer_case_events(company_id,customer_case_id,customer_id,event_type,event_status,message,payload,created_by)
  VALUES(p_company_id,v_case.id,p_customer_id,'created','info','Supportärende registrerat. '||v_next_action,
    jsonb_build_object('channel','staff_api','api_client_id',p_api_client_id,'actor_user_id',p_actor_user_id,
      'visibility','internal','operational_impact','none'),p_actor_user_id);
  INSERT INTO public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,new_values,metadata)
  VALUES(p_company_id,p_actor_user_id,'customer_case',v_case.id::text,'customer_case_created',
    jsonb_build_object('case_type',v_case.case_type,'status',v_case.status,'priority',v_case.priority),
    jsonb_build_object('channel','staff_api','api_client_id',p_api_client_id,'customer_id',p_customer_id,
      'support_idempotency_key',p_idempotency_key));
  RETURN jsonb_build_object('case',to_jsonb(v_case),'reused',false);
END$$;
REVOKE ALL ON FUNCTION public.gridex_create_staff_support_case_v1(uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_create_staff_support_case_v1(uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb) TO service_role;
COMMIT;
