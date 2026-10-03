-- Customer lifecycle decision effects (clean replay only; synthetic data; rolled back).
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  c uuid := gen_random_uuid();
  other_c uuid := gen_random_uuid();
  actor uuid := gen_random_uuid();
  cust_site uuid := gen_random_uuid();
  cust_all uuid := gen_random_uuid();
  site uuid := gen_random_uuid();
  mp uuid := gen_random_uuid();
  site2 uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.companies(id,name,status) VALUES(c,'Decision A','active'),(other_c,'Decision B','active');
  INSERT INTO public.customers(id,company_id,customer_number,name,customer_type,status)
  VALUES(cust_site,c,'LD-1','Site scope','private','active'),(cust_all,c,'LD-2','Customer scope','private','active');
  INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country)
  VALUES(site,c,cust_site,'Site','consumption','active','SE'),(site2,c,cust_all,'Site 2','consumption','active','SE');
  INSERT INTO public.metering_points(id,company_id,customer_id,site_id,metering_point_id,reading_frequency,measurement_type,is_settlement_relevant,status)
  VALUES(mp,c,cust_site,site,'735999999999999995','monthly','consumption',true,'active');

  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  BEGIN
    PERFORM public.gridex_register_customer_lifecycle_decision_v1(other_c, cust_site, actor, 'withdrawal', 'site', site, now(), 'x');
    RAISE EXCEPTION 'cross-tenant decision allowed';
  EXCEPTION WHEN no_data_found THEN NULL; END;

  -- Site scope closes the site and its metering points.
  PERFORM public.gridex_register_customer_lifecycle_decision_v1(c, cust_site, actor, 'withdrawal', 'site', site, now(), 'Ånger');
  IF (SELECT status FROM public.customer_sites WHERE id = site) <> 'closed'
     OR (SELECT status FROM public.metering_points WHERE id = mp) <> 'closed' THEN
    RAISE EXCEPTION 'site decision did not close site and metering point';
  END IF;

  -- Another customer's site cannot be closed through this customer.
  BEGIN
    PERFORM public.gridex_register_customer_lifecycle_decision_v1(c, cust_site, actor, 'rejected', 'site', site2, now(), 'x');
    RAISE EXCEPTION 'foreign site closed';
  EXCEPTION WHEN no_data_found THEN NULL; END;

  -- Customer scope runs the canonical archive.
  PERFORM public.gridex_register_customer_lifecycle_decision_v1(c, cust_all, actor, 'cancelled', 'customer', null, now(), 'Avbrutet');
  IF (SELECT status FROM public.customers WHERE id = cust_all) <> 'archived'
     OR (SELECT status FROM public.customer_sites WHERE id = site2) <> 'closed' THEN
    RAISE EXCEPTION 'customer decision did not archive the graph';
  END IF;

  RAISE NOTICE 'customer lifecycle decision regression: ok';
END $$;

ROLLBACK;
