-- Atomic supplier-switch writes (clean replay only; synthetic data; rolled back).
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  c uuid := gen_random_uuid();
  other_c uuid := gen_random_uuid();
  cust uuid := gen_random_uuid();
  site uuid := gen_random_uuid();
  mp uuid := gen_random_uuid();
  res jsonb;
  req uuid;
BEGIN
  INSERT INTO public.companies(id,name,status) VALUES(c,'Switch A','active'),(other_c,'Switch B','active');
  INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(cust,c,'SW-1','Switch customer','private');
  INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country)
  VALUES(site,c,cust,'Site','consumption','active','SE');
  INSERT INTO public.metering_points(id,company_id,customer_id,site_id,metering_point_id,reading_frequency,measurement_type,is_settlement_relevant,status)
  VALUES(mp,c,cust,site,'735999999999999994','monthly','consumption',true,'active');

  -- An authenticated user without membership in the company cannot write.
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  BEGIN
    PERFORM public.gridex_create_supplier_switch_v1(c,
      jsonb_build_object('customer_id',cust,'site_id',site,'metering_point_id',mp,'request_type','switch','status','queued'),
      '{}'::jsonb);
    RAISE EXCEPTION 'non-member created a switch';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- The tenant always comes from the parameter, never from the payload.
  res := public.gridex_create_supplier_switch_v1(c,
    jsonb_build_object('company_id',other_c,'customer_id',cust,'site_id',site,'metering_point_id',mp,
      'request_type','switch','status','queued','automation_key','synthetic-key'),
    jsonb_build_object('message','created'));
  req := (res->'request'->>'id')::uuid;
  IF (SELECT company_id FROM public.supplier_switch_requests WHERE id = req) <> c THEN
    RAISE EXCEPTION 'payload moved the switch to another tenant';
  END IF;
  IF (SELECT count(*) FROM public.supplier_switch_events WHERE switch_request_id = req AND event_type = 'created') <> 1 THEN
    RAISE EXCEPTION 'created event missing';
  END IF;

  -- Same automation key returns the existing open request.
  res := public.gridex_create_supplier_switch_v1(c,
    jsonb_build_object('customer_id',cust,'site_id',site,'metering_point_id',mp,'request_type','switch','status','queued','automation_key','synthetic-key'),
    '{}'::jsonb);
  IF NOT (res->>'existing')::boolean OR (res->'request'->>'id')::uuid <> req THEN
    RAISE EXCEPTION 'automation key not idempotent';
  END IF;

  -- Transition writes status and event together and refuses identity columns.
  res := public.gridex_transition_supplier_switch_v1(c, req,
    jsonb_build_object('status','failed','failure_reason','test'),
    jsonb_build_object('event_type','status_updated','event_status','failed'));
  IF (SELECT status FROM public.supplier_switch_requests WHERE id = req) <> 'failed'
     OR (SELECT count(*) FROM public.supplier_switch_events WHERE switch_request_id = req AND event_type = 'status_updated') <> 1 THEN
    RAISE EXCEPTION 'transition not atomic';
  END IF;
  BEGIN
    PERFORM public.gridex_transition_supplier_switch_v1(c, req, jsonb_build_object('customer_id', gen_random_uuid()), null);
    RAISE EXCEPTION 'identity column patched';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.gridex_transition_supplier_switch_v1(other_c, req, jsonb_build_object('status','queued'), null);
    RAISE EXCEPTION 'cross-tenant transition allowed';
  EXCEPTION WHEN no_data_found THEN NULL; END;

  -- Finalize requires an accepted switch confirmed by Z04.
  BEGIN
    PERFORM public.gridex_finalize_supplier_switch_v1(c, req, null, '{}'::jsonb);
    RAISE EXCEPTION 'unaccepted switch finalized';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'supplier_switch_finalize_requires_accepted_z04' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'supplier switch atomic regression: ok';
END $$;

ROLLBACK;
