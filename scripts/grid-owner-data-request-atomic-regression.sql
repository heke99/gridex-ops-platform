-- Grid-owner data requests carry the tenant of their customer (clean replay only; synthetic data; rolled back).
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  cust_a uuid := gen_random_uuid();
  cust_b uuid := gen_random_uuid();
  site_a uuid := gen_random_uuid();
  mp_a uuid := gen_random_uuid();
  res jsonb;
  req uuid;
BEGIN
  INSERT INTO public.companies(id,name,status) VALUES(a,'Data A','active'),(b,'Data B','active');
  INSERT INTO public.customers(id,company_id,customer_number,name,customer_type)
  VALUES(cust_a,a,'GD-1','Customer A','private'),(cust_b,b,'GD-2','Customer B','private');
  INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country)
  VALUES(site_a,a,cust_a,'Site','consumption','active','SE');
  INSERT INTO public.metering_points(id,company_id,customer_id,site_id,metering_point_id,reading_frequency,measurement_type,is_settlement_relevant,status)
  VALUES(mp_a,a,cust_a,site_a,'735999999999999993','monthly','consumption',true,'active');

  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  BEGIN
    PERFORM public.gridex_create_grid_owner_data_request_v1(a, jsonb_build_object('customer_id',cust_a));
    RAISE EXCEPTION 'non-service caller created a request';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- The tenant comes from the parameter even when the payload names another one.
  res := public.gridex_create_grid_owner_data_request_v1(a, jsonb_build_object(
    'company_id',b,'customer_id',cust_a,'site_id',site_a,'metering_point_id',mp_a,
    'request_scope','meter_values','automation_key','monthly:2026-09','status','received'));
  req := (res->'request'->>'id')::uuid;
  IF (SELECT company_id FROM public.grid_owner_data_requests WHERE id = req) <> a
     OR (SELECT status FROM public.grid_owner_data_requests WHERE id = req) <> 'pending' THEN
    RAISE EXCEPTION 'tenant or status taken from payload';
  END IF;

  -- The same automation key returns the open request instead of a duplicate.
  res := public.gridex_create_grid_owner_data_request_v1(a, jsonb_build_object(
    'customer_id',cust_a,'site_id',site_a,'metering_point_id',mp_a,'request_scope','meter_values','automation_key','monthly:2026-09'));
  IF NOT (res->>'existing')::boolean OR (res->'request'->>'id')::uuid <> req
     OR (SELECT count(*) FROM public.grid_owner_data_requests WHERE company_id = a) <> 1 THEN
    RAISE EXCEPTION 'automation key not idempotent';
  END IF;

  -- Another tenant's customer, site or metering point is refused.
  BEGIN
    PERFORM public.gridex_create_grid_owner_data_request_v1(a, jsonb_build_object('customer_id',cust_b));
    RAISE EXCEPTION 'foreign customer accepted';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN
    PERFORM public.gridex_create_grid_owner_data_request_v1(b, jsonb_build_object('customer_id',cust_b,'metering_point_id',mp_a));
    RAISE EXCEPTION 'foreign metering point accepted';
  EXCEPTION WHEN no_data_found THEN NULL; END;

  -- A request without a tenant can no longer be stored.
  BEGIN
    INSERT INTO public.grid_owner_data_requests(customer_id, request_scope) VALUES(cust_a,'meter_values');
    RAISE EXCEPTION 'tenantless request stored';
  EXCEPTION WHEN not_null_violation THEN NULL; END;

  RAISE NOTICE 'grid owner data request atomic regression: ok';
END $$;

ROLLBACK;
