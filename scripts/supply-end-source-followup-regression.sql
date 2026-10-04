-- Supply-end follow-up for source-owned ends (clean replay only; synthetic data; rolled back).
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
  mp_c uuid := gen_random_uuid();
  period_a uuid := gen_random_uuid();
  period_b uuid := gen_random_uuid();
  period_c uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.companies(id,name,status) VALUES(a,'Source end A','active'),(b,'Source end B','active');
  INSERT INTO public.customers(id,company_id,customer_number,name,customer_type,status)
  VALUES(cust_a,a,'SRC-A','Customer at A','private','active'),(cust_b,b,'SRC-B','Customer at B','private','active');
  INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country)
  VALUES(site_a,a,cust_a,'Site','consumption','active','SE'),(site_b,b,cust_b,'Site','consumption','active','SE');
  INSERT INTO public.metering_points(id,company_id,customer_id,site_id,metering_point_id,reading_frequency,measurement_type,is_settlement_relevant,status)
  VALUES(mp_a,a,cust_a,site_a,'735999999999999981','monthly','consumption',true,'active'),
        (mp_c,a,cust_a,site_a,'735999999999999982','monthly','consumption',true,'active'),
        (mp_b,b,cust_b,site_b,'735999999999999981','monthly','consumption',true,'active');
  INSERT INTO public.customer_supply_periods(id,company_id,customer_id,metering_point_id,start_date,status,source)
  VALUES(period_a,a,cust_a,mp_a,DATE '2026-01-01','active','manual'),
        (period_c,a,cust_a,mp_c,DATE '2026-01-01','active','manual'),
        (period_b,b,cust_b,mp_b,DATE '2026-01-01','active','manual');

  -- A source-owned end (no end_key) opens exactly one final-invoice task.
  UPDATE public.customer_supply_periods SET end_date = DATE '2026-10-15', status = 'ending' WHERE id = period_a;
  IF (SELECT count(*) FROM public.customer_operation_tasks WHERE company_id = a AND customer_id = cust_a AND task_type = 'final_invoice_pending') <> 1 THEN
    RAISE EXCEPTION 'source-owned end opened no final invoice task';
  END IF;
  -- Advancing ending -> ended on the same date adds nothing.
  UPDATE public.customer_supply_periods SET status = 'ended', actual_end_date = DATE '2026-10-15' WHERE id = period_a;
  IF (SELECT count(*) FROM public.customer_operation_tasks WHERE company_id = a AND task_type = 'final_invoice_pending') <> 1 THEN
    RAISE EXCEPTION 'source-owned end follow-up not idempotent';
  END IF;

  -- The legacy owner's own end (end_key) is not doubled by the trigger.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM public.gridex_end_customer_supply_v1(a, cust_a, mp_c, DATE '2026-10-15', 'supplier_switch', null, null);
  IF (SELECT count(*) FROM public.customer_operation_tasks WHERE company_id = a AND task_type = 'final_invoice_pending') <> 2 THEN
    RAISE EXCEPTION 'legacy end and trigger follow-up double counted';
  END IF;

  -- The other tenant is untouched.
  IF EXISTS (SELECT 1 FROM public.customer_operation_tasks WHERE company_id = b)
     OR (SELECT status FROM public.customer_supply_periods WHERE id = period_b) <> 'active' THEN
    RAISE EXCEPTION 'other tenant changed by supply end follow-up';
  END IF;

  IF has_function_privilege('authenticated', 'public.gridex_supply_end_followup_v1()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.gridex_supply_end_followup_v1()', 'EXECUTE') THEN
    RAISE EXCEPTION 'supply end follow-up callable by clients';
  END IF;
END
$$;

ROLLBACK;
