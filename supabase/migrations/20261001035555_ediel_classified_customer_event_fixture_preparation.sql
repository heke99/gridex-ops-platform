-- Prospective source-only preparation before national field310 validation.
-- Outcome comes from one actual protected registration, never diagnostics.
BEGIN;
ALTER FUNCTION gridex_customer_life_events.certification_basis_v1(jsonb,text) RENAME TO certification_basis_before_case_tuple_v1;
CREATE FUNCTION gridex_customer_life_events.certification_basis_v1(q jsonb,raw text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE b jsonb;BEGIN
 b:=gridex_customer_life_events.certification_basis_before_case_tuple_v1(q,raw);
 IF b->>'status'='authorized' THEN RETURN b||jsonb_build_object('registeredCase',jsonb_build_object('roleCode',q->>'roleCode','caseCode',q->>'caseCode','suite',q->>'suite','revision',q->>'revision','stepNo',(q->>'stepNo')::integer));END IF;RETURN b;
END$$;
REVOKE ALL ON FUNCTION gridex_customer_life_events.certification_basis_before_case_tuple_v1(jsonb,text),gridex_customer_life_events.certification_basis_v1(jsonb,text) FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_fixture_authority_owner;
CREATE FUNCTION public.ediel_customer_event_certification_preparation_basis_v1(p_company_id uuid,p_run_id uuid,p_step_no integer,p_actor_user_id uuid,p_raw_payload text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE wire jsonb;positive jsonb;negative jsonb;context jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_event_service_required' USING ERRCODE='42501';END IF;
 wire:=gridex_customer_life_events.wire_partition_v1(p_raw_payload);
 IF wire->>'code' IS DISTINCT FROM 'Z09' OR NOT EXISTS(SELECT FROM jsonb_array_elements(wire->'objects')o WHERE o->>'reason'='E34') THEN RETURN NULL;END IF;
 PERFORM gridex_negative_fixtures.assert_prepare_actor_v1(p_actor_user_id,p_company_id);
 context:=jsonb_build_object('companyId',p_company_id,'runId',p_run_id,'stepNo',p_step_no,'actorUserId',p_actor_user_id,'rawPayload',p_raw_payload);
 positive:=gridex_negative_fixtures.read_positive_v1(context);negative:=gridex_negative_fixtures.read_negative_preparation_v1(context);
 IF positive IS NOT NULL AND negative IS NOT NULL THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('unambiguous_registered_customer_event_test_original'));END IF;
 IF positive IS NULL AND negative IS NULL THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('authentic_registered_customer_event_test_original'));END IF;
 RETURN gridex_customer_life_events.certification_basis_v1(coalesce(positive,negative),p_raw_payload);
END$$;
REVOKE ALL ON FUNCTION public.ediel_customer_event_certification_preparation_basis_v1(uuid,uuid,integer,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_customer_event_certification_preparation_basis_v1(uuid,uuid,integer,uuid,text) TO service_role;
-- Before rendering, retain exact independently classified registered bytes.
-- An unrelated or absent source is not relabelled as a customer event.
CREATE FUNCTION public.ediel_customer_event_certification_original_v1(p_company_id uuid,p_run_id uuid,p_step_no integer,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidate record;wire jsonb;q jsonb;basis jsonb;selected jsonb;context jsonb;seen integer:=0;held boolean:=false;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_event_service_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_negative_fixtures.assert_prepare_actor_v1(p_actor_user_id,p_company_id);
 FOR candidate IN SELECT id,original_wire,'positive'::text outcome FROM gridex_negative_fixtures.positive_originals WHERE company_id=p_company_id AND run_id=p_run_id AND step_no=p_step_no
  UNION ALL SELECT id,original_wire,'negative'::text FROM gridex_negative_fixtures.originals WHERE company_id=p_company_id AND run_id=p_run_id AND step_no=p_step_no ORDER BY id LOOP
  seen:=seen+1;IF seen>8192 THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('bounded_unambiguous_registered_customer_event_test_original'));END IF;
  wire:=gridex_customer_life_events.wire_partition_v1(candidate.original_wire);
  IF wire->>'code' IS DISTINCT FROM 'Z09' OR NOT EXISTS(SELECT FROM jsonb_array_elements(wire->'objects')o WHERE o->>'reason'='E34') THEN CONTINUE;END IF;
  context:=jsonb_build_object('companyId',p_company_id,'runId',p_run_id,'stepNo',p_step_no,'actorUserId',p_actor_user_id,'rawPayload',candidate.original_wire);
  IF candidate.outcome='positive' THEN q:=gridex_negative_fixtures.read_positive_v1(context);ELSE q:=gridex_negative_fixtures.read_negative_preparation_v1(context);END IF;
  IF q IS NULL THEN CONTINUE;END IF;
  IF q->>'registrationId' IS DISTINCT FROM candidate.id::text THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('unambiguous_registered_customer_event_test_original'));END IF;
  basis:=gridex_customer_life_events.certification_basis_v1(q,candidate.original_wire);
  IF basis->>'status' IS DISTINCT FROM 'authorized' THEN held:=true;CONTINUE;END IF;
  IF selected IS NOT NULL THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('unambiguous_registered_customer_event_test_original'));END IF;
  selected:=basis;
 END LOOP;
 IF held THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('independent_authentic_certification_customer_event_classification'));END IF;
 RETURN selected;
END$$;
REVOKE ALL ON FUNCTION public.ediel_customer_event_certification_original_v1(uuid,uuid,integer,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_customer_event_certification_original_v1(uuid,uuid,integer,uuid) TO service_role;
COMMIT;
