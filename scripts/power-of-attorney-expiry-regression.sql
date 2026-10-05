-- Overdue powers of attorney expire together with their audit event (clean replay only; synthetic data; rolled back).
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  c uuid := gen_random_uuid();
  cust uuid := gen_random_uuid();
  overdue uuid := gen_random_uuid();
  current_poa uuid := gen_random_uuid();
  res jsonb;
BEGIN
  INSERT INTO public.companies(id,name,status) VALUES(c,'POA A','active');
  INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(cust,c,'POA-1','POA customer','private');
  INSERT INTO public.powers_of_attorney(id,company_id,customer_id,scope,status,valid_to)
  VALUES(overdue,c,cust,'supplier_switch','draft',current_date - 1),
        (current_poa,c,cust,'supplier_switch','draft',current_date + 30);

  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  BEGIN
    PERFORM public.gridex_expire_overdue_powers_of_attorney_v1(10);
    RAISE EXCEPTION 'non-service caller expired powers of attorney';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  res := public.gridex_expire_overdue_powers_of_attorney_v1(500);
  IF (SELECT status FROM public.powers_of_attorney WHERE id = overdue) <> 'expired'
     OR (SELECT status FROM public.powers_of_attorney WHERE id = current_poa) <> 'draft' THEN
    RAISE EXCEPTION 'wrong powers of attorney expired';
  END IF;
  IF (SELECT count(*) FROM public.power_of_attorney_events
      WHERE power_of_attorney_id = overdue AND event_type = 'expired' AND company_id = c) <> 1 THEN
    RAISE EXCEPTION 'expired event missing';
  END IF;

  -- A second sweep changes nothing for this tenant.
  PERFORM public.gridex_expire_overdue_powers_of_attorney_v1(500);
  IF (SELECT count(*) FROM public.power_of_attorney_events WHERE power_of_attorney_id = overdue) <> 1 THEN
    RAISE EXCEPTION 'expiry not idempotent';
  END IF;

  RAISE NOTICE 'power of attorney expiry regression: ok';
END $$;

ROLLBACK;
