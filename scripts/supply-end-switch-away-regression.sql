-- End of supply for the losing supplier (clean replay only; synthetic data; rolled back).
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  cust_a uuid := gen_random_uuid();
  cust_b uuid := gen_random_uuid();
  site_a uuid := gen_random_uuid();
  site_b uuid := gen_random_uuid();
  mp_a uuid := gen_random_uuid();
  mp_b uuid := gen_random_uuid();
  period_a uuid := gen_random_uuid();
  period_b uuid := gen_random_uuid();
  res jsonb;
BEGIN
  -- The same national metering point is held by tenant A (losing) and tenant B (gaining).
  INSERT INTO public.companies(id,name,status) VALUES(a,'Supply end A','active'),(b,'Supply end B','active');
  INSERT INTO public.customers(id,company_id,customer_number,name,customer_type,status)
  VALUES(cust_a,a,'SE-A','Customer at A','private','active'),(cust_b,b,'SE-B','Customer at B','private','active');
  INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country)
  VALUES(site_a,a,cust_a,'Site','consumption','active','SE'),(site_b,b,cust_b,'Site','consumption','active','SE');
  INSERT INTO public.metering_points(id,company_id,customer_id,site_id,metering_point_id,reading_frequency,measurement_type,is_settlement_relevant,status)
  VALUES(mp_a,a,cust_a,site_a,'735999999999999993','monthly','consumption',true,'active'),
        (mp_b,b,cust_b,site_b,'735999999999999993','monthly','consumption',true,'active');
  INSERT INTO public.customer_supply_periods(id,company_id,customer_id,metering_point_id,start_date,status,source)
  VALUES(period_a,a,cust_a,mp_a,DATE '2026-01-01','active','manual'),
        (period_b,b,cust_b,mp_b,DATE '2026-10-16','confirmed_by_grid_owner','manual');

  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  BEGIN
    PERFORM public.gridex_end_customer_supply_v1(a, cust_a, mp_a, DATE '2026-10-15', 'supplier_switch', null, null);
    RAISE EXCEPTION 'supply end allowed for authenticated role';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- Tenant B cannot end tenant A's customer.
  BEGIN
    PERFORM public.gridex_end_customer_supply_v1(b, cust_a, mp_a, DATE '2026-10-15', 'supplier_switch', null, null);
    RAISE EXCEPTION 'cross-tenant supply end allowed';
  EXCEPTION WHEN no_data_found THEN NULL; END;

  res := public.gridex_end_customer_supply_v1(a, cust_a, mp_a, DATE '2026-10-15', 'supplier_switch', null, null);

  -- Ended on the switch date; billing still covers it up to end_date.
  IF (SELECT end_date FROM public.customer_supply_periods WHERE id = period_a) <> DATE '2026-10-15'
     OR (SELECT actual_end_date FROM public.customer_supply_periods WHERE id = period_a) <> DATE '2026-10-15'
     OR (SELECT status FROM public.customer_supply_periods WHERE id = period_a) <> 'ended' THEN
    RAISE EXCEPTION 'losing supply period not ended';
  END IF;
  -- Replaying the same end is idempotent.
  res := public.gridex_end_customer_supply_v1(a, cust_a, mp_a, DATE '2026-10-15', 'supplier_switch', null, null);
  IF NOT coalesce((res->>'already_applied')::boolean, false) THEN
    RAISE EXCEPTION 'supply end replay not idempotent';
  END IF;
  IF (SELECT count(*) FROM public.customer_operation_tasks WHERE customer_id = cust_a AND task_type = 'final_invoice_pending') <> 1 THEN
    RAISE EXCEPTION 'final invoice task missing';
  END IF;
  IF (SELECT status FROM public.customers WHERE id = cust_a) <> 'inactive' THEN
    RAISE EXCEPTION 'customer not inactive after switch away';
  END IF;

  -- Tenant B is untouched.
  IF (SELECT status FROM public.customer_supply_periods WHERE id = period_b) <> 'confirmed_by_grid_owner'
     OR (SELECT end_date FROM public.customer_supply_periods WHERE id = period_b) IS NOT NULL
     OR (SELECT status FROM public.customers WHERE id = cust_b) <> 'active'
     OR EXISTS (SELECT 1 FROM public.customer_operation_tasks WHERE company_id = b) THEN
    RAISE EXCEPTION 'gaining tenant changed by losing tenant end';
  END IF;

  -- Replaying the same message changes nothing.
  res := public.gridex_end_customer_supply_v1(a, cust_a, mp_a, DATE '2026-10-15', 'supplier_switch', null, null);
  IF NOT (res->>'already_applied')::boolean
     OR (SELECT count(*) FROM public.customer_operation_tasks WHERE customer_id = cust_a AND task_type = 'final_invoice_pending') <> 1 THEN
    RAISE EXCEPTION 'supply end not idempotent';
  END IF;

  IF has_function_privilege('authenticated', 'public.gridex_end_customer_supply_v1(uuid,uuid,uuid,date,text,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute supply end';
  END IF;

  RAISE NOTICE 'supply end switch-away regression: ok';
END $$;

ROLLBACK;
