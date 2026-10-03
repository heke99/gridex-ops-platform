-- Atomic customer archive native regression (clean replay only; synthetic data; rolled back).
-- gridex_archive_customer_v1 closes the whole customer graph in one transaction,
-- is idempotent, is tenant-bound and service-role only; archived customers
-- cannot get new sites, metering points, switch requests or contracts.
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  c uuid := gen_random_uuid();
  other_c uuid := gen_random_uuid();
  customer uuid := gen_random_uuid();
  actor uuid := gen_random_uuid();
  site uuid := gen_random_uuid();
  mp uuid := gen_random_uuid();
  sw uuid;
  res jsonb;
  v text;
BEGIN
  INSERT INTO public.companies(id,name,status) VALUES(c,'Archive synthetic A','active'),(other_c,'Archive synthetic B','active');
  INSERT INTO public.customers(id,company_id,customer_number,name,customer_type)
  VALUES(customer,c,'ARCH-A','Synthetic archive customer','private');
  INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country)
  VALUES(site,c,customer,'Site','consumption','active','SE');
  INSERT INTO public.metering_points(id,company_id,customer_id,site_id,metering_point_id,reading_frequency,measurement_type,is_settlement_relevant,status)
  VALUES(mp,c,customer,site,'735999999999999990','monthly','consumption',true,'active');
  INSERT INTO public.supplier_switch_requests(company_id,customer_id,site_id,metering_point_id,request_type,status)
  VALUES(c,customer,site,mp,'switch','draft') RETURNING id INTO sw;

  -- Only service_role may call the command.
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  BEGIN
    PERFORM public.gridex_archive_customer_v1(c, customer, actor, 'x');
    RAISE EXCEPTION 'archive allowed for authenticated role';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- Wrong tenant never resolves the customer.
  BEGIN
    PERFORM public.gridex_archive_customer_v1(other_c, customer, actor, 'x');
    RAISE EXCEPTION 'cross-tenant archive was allowed';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  IF (SELECT status FROM public.customers WHERE id = customer) = 'archived' THEN
    RAISE EXCEPTION 'cross-tenant attempt changed the customer';
  END IF;

  res := public.gridex_archive_customer_v1(c, customer, actor, 'Flyttat');
  IF (res->>'already_archived')::boolean THEN RAISE EXCEPTION 'first archive reported already archived'; END IF;

  SELECT status INTO v FROM public.customers WHERE id = customer AND archived_by = actor AND archive_reason = 'Flyttat' AND archived_at IS NOT NULL;
  IF v IS DISTINCT FROM 'archived' THEN RAISE EXCEPTION 'customer archive fields missing'; END IF;
  IF (SELECT status FROM public.customer_sites WHERE id = site) <> 'closed' THEN RAISE EXCEPTION 'site not closed'; END IF;
  IF (SELECT status FROM public.metering_points WHERE id = mp) <> 'closed' THEN RAISE EXCEPTION 'metering point not closed'; END IF;
  IF (SELECT status FROM public.supplier_switch_requests WHERE id = sw) <> 'failed' THEN RAISE EXCEPTION 'switch request not stopped'; END IF;
  IF (SELECT count(*) FROM public.audit_logs WHERE entity_id = customer::text AND action = 'customer.archived' AND company_id = c) <> 1 THEN
    RAISE EXCEPTION 'archive audit row missing';
  END IF;

  -- Idempotent: a second call changes nothing and writes no second audit row.
  res := public.gridex_archive_customer_v1(c, customer, actor, 'Igen');
  IF NOT (res->>'already_archived')::boolean THEN RAISE EXCEPTION 'second archive not idempotent'; END IF;
  IF (SELECT count(*) FROM public.audit_logs WHERE entity_id = customer::text AND action = 'customer.archived') <> 1 THEN
    RAISE EXCEPTION 'second archive wrote another audit row';
  END IF;

  -- Archived customers cannot get new operational rows from any path.
  BEGIN
    INSERT INTO public.customer_sites(company_id,customer_id,site_name,site_type,status,country)
    VALUES(c,customer,'New','consumption','active','SE');
    RAISE EXCEPTION 'site insert allowed for archived customer';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%is archived%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.supplier_switch_requests(company_id,customer_id,site_id,metering_point_id,request_type,status)
    VALUES(c,customer,site,mp,'switch','draft');
    RAISE EXCEPTION 'switch insert allowed for archived customer';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%is archived%' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.customer_contracts'::regclass
                  AND tgname = 'customer_contracts_customer_archived_guard_trg') THEN
    RAISE EXCEPTION 'contract archive guard missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.metering_points'::regclass
                  AND tgname = 'metering_points_customer_archived_guard_trg') THEN
    RAISE EXCEPTION 'metering point archive guard missing';
  END IF;

  IF has_function_privilege('authenticated', 'public.gridex_archive_customer_v1(uuid,uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute archive command';
  END IF;

  RAISE NOTICE 'customer archive atomic regression: ok';
END $$;

ROLLBACK;
