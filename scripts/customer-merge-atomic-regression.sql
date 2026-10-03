-- Customer merge moves the whole graph inside one tenant, atomically (clean replay only; synthetic data; rolled back).
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  actor uuid := gen_random_uuid();
  primary_c uuid := gen_random_uuid();
  source_c uuid := gen_random_uuid();
  foreign_c uuid := gen_random_uuid();
  site_s uuid := gen_random_uuid();
  site_f uuid := gen_random_uuid();
  res jsonb;
BEGIN
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
  VALUES(actor,'authenticated','authenticated','merge-actor@example.invalid',now(),'{}','{}',now(),now(),false,false);
  INSERT INTO public.companies(id,name,status) VALUES(a,'Merge A','active'),(b,'Merge B','active');
  INSERT INTO public.customers(id,company_id,customer_number,name,customer_type,status)
  VALUES(primary_c,a,'MG-1','Primary','private','active'),
        (source_c,a,'MG-2','Duplicate','private','active'),
        (foreign_c,b,'MG-3','Other tenant','private','active');
  INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country)
  VALUES(site_s,a,source_c,'Dup site','consumption','active','SE'),
        (site_f,b,foreign_c,'Foreign site','consumption','active','SE');

  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  BEGIN
    PERFORM public.gridex_merge_customers_v1(a, primary_c, array[source_c], actor, 'dup');
    RAISE EXCEPTION 'non-service caller merged customers';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- A source from another tenant aborts the whole merge; nothing moves.
  BEGIN
    PERFORM public.gridex_merge_customers_v1(a, primary_c, array[source_c, foreign_c], actor, 'dup');
    RAISE EXCEPTION 'cross-tenant merge allowed';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  IF (SELECT customer_id FROM public.customer_sites WHERE id = site_s) <> source_c
     OR (SELECT customer_id FROM public.customer_sites WHERE id = site_f) <> foreign_c THEN
    RAISE EXCEPTION 'failed merge left moved rows';
  END IF;

  res := public.gridex_merge_customers_v1(a, primary_c, array[source_c], actor, 'dup');
  IF (SELECT customer_id FROM public.customer_sites WHERE id = site_s) <> primary_c THEN
    RAISE EXCEPTION 'site not moved to primary';
  END IF;
  IF (SELECT merged_into_customer_id FROM public.customers WHERE id = source_c) <> primary_c
     OR (SELECT status FROM public.customers WHERE id = source_c) <> 'inactive' THEN
    RAISE EXCEPTION 'source not marked merged';
  END IF;
  IF (SELECT count(*) FROM public.customer_merge_events WHERE merged_customer_id = source_c AND company_id = a) <> 1
     OR (SELECT count(*) FROM public.audit_logs WHERE action = 'customers_merged' AND company_id = a) <> 1 THEN
    RAISE EXCEPTION 'merge event or audit missing';
  END IF;

  -- A merged customer cannot be merged again.
  BEGIN
    PERFORM public.gridex_merge_customers_v1(a, primary_c, array[source_c], actor, 'again');
    RAISE EXCEPTION 'merged customer merged twice';
  EXCEPTION WHEN check_violation THEN NULL; END;

  RAISE NOTICE 'customer merge atomic regression: ok';
END $$;

ROLLBACK;
