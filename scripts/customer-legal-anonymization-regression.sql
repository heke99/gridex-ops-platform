-- Customer anonymization after the legal retention period (clean replay only; synthetic data; rolled back).
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  c uuid := gen_random_uuid();
  other_c uuid := gen_random_uuid();
  actor uuid := gen_random_uuid();
  old_customer uuid := gen_random_uuid();
  recent_customer uuid := gen_random_uuid();
  held_customer uuid := gen_random_uuid();
  active_customer uuid := gen_random_uuid();
  res jsonb;
BEGIN
  INSERT INTO public.companies(id,name,status) VALUES(c,'Anonymize A','active'),(other_c,'Anonymize B','active');
  INSERT INTO public.customers(id,company_id,customer_number,name,full_name,customer_type,personal_number,email,phone,billing_street,billing_postal_code,billing_city,status,archived_at,created_at)
  VALUES
    (old_customer,c,'AN-1','Anna Andersson','Anna Andersson','private','19121212-1212','anna@example.test','0701234567','Gatan 1','11122','Stockholm','archived',TIMESTAMPTZ '2012-03-01',TIMESTAMPTZ '2010-01-01'),
    (recent_customer,c,'AN-2','Bo Berg','Bo Berg','private','19800101-0000','bo@example.test',null,null,null,null,'archived',now(),TIMESTAMPTZ '2010-01-01'),
    (held_customer,c,'AN-3','Cia Ceder','Cia Ceder','private','19900101-0000',null,null,null,null,null,'archived',TIMESTAMPTZ '2012-03-01',TIMESTAMPTZ '2010-01-01'),
    (active_customer,c,'AN-4','Dan Dahl','Dan Dahl','private','19700101-0000',null,null,null,null,null,'active',null,TIMESTAMPTZ '2010-01-01');
  UPDATE public.customers SET legal_hold = true, legal_hold_reason = 'Tvist' WHERE id = held_customer;
  INSERT INTO public.customer_contacts(company_id,customer_id,type,name,email,phone)
  VALUES(c,old_customer,'primary','Anna Andersson','anna@example.test','0701234567');
  INSERT INTO public.customer_addresses(company_id,customer_id,type,street_1,postal_code,city,country)
  VALUES(c,old_customer,'billing','Gatan 1','11122','Stockholm','SE');

  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  BEGIN
    PERFORM public.gridex_anonymize_customer_v1(c, old_customer, actor);
    RAISE EXCEPTION 'anonymize allowed for authenticated role';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  BEGIN
    PERFORM public.gridex_anonymize_customer_v1(other_c, old_customer, actor);
    RAISE EXCEPTION 'cross-tenant anonymize allowed';
  EXCEPTION WHEN no_data_found THEN NULL; END;

  BEGIN
    PERFORM public.gridex_anonymize_customer_v1(c, recent_customer, actor);
    RAISE EXCEPTION 'customer inside retention anonymized';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'customer_anonymize_retention_period_active' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.gridex_anonymize_customer_v1(c, held_customer, actor);
    RAISE EXCEPTION 'customer under legal hold anonymized';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'customer_anonymize_legal_hold' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.gridex_anonymize_customer_v1(c, active_customer, actor);
    RAISE EXCEPTION 'active customer anonymized';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'customer_anonymize_customer_still_active' THEN RAISE; END IF;
  END;

  res := public.gridex_anonymize_customer_v1(c, old_customer, actor);
  IF (SELECT personal_number FROM public.customers WHERE id = old_customer) IS NOT NULL
     OR (SELECT email FROM public.customers WHERE id = old_customer) IS NOT NULL
     OR (SELECT billing_street FROM public.customers WHERE id = old_customer) IS NOT NULL
     OR (SELECT full_name FROM public.customers WHERE id = old_customer) <> 'Anonymiserad kund'
     OR (SELECT anonymized_at FROM public.customers WHERE id = old_customer) IS NULL THEN
    RAISE EXCEPTION 'customer master data not anonymized';
  END IF;
  IF EXISTS (SELECT 1 FROM public.customer_contacts WHERE customer_id = old_customer AND (name IS NOT NULL OR email IS NOT NULL OR phone IS NOT NULL))
     OR EXISTS (SELECT 1 FROM public.customer_addresses WHERE customer_id = old_customer AND (street_1 IS NOT NULL OR city IS NOT NULL)) THEN
    RAISE EXCEPTION 'contacts or addresses not anonymized';
  END IF;
  -- The record and its customer number stay so invoices and contracts still resolve.
  IF (SELECT customer_number FROM public.customers WHERE id = old_customer) <> 'AN-1' THEN
    RAISE EXCEPTION 'customer record identity lost';
  END IF;
  -- Other customers are untouched.
  IF (SELECT personal_number FROM public.customers WHERE id = recent_customer) <> '19800101-0000' THEN
    RAISE EXCEPTION 'other customer changed';
  END IF;

  res := public.gridex_anonymize_customer_v1(c, old_customer, actor);
  IF NOT (res->>'already_anonymized')::boolean THEN RAISE EXCEPTION 'anonymize not idempotent'; END IF;

  IF has_function_privilege('authenticated', 'public.gridex_anonymize_customer_v1(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute anonymize';
  END IF;

  RAISE NOTICE 'customer legal anonymization regression: ok';
END $$;

ROLLBACK;
