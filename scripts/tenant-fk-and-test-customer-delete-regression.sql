-- Tenant company foreign keys + atomic test-customer delete (clean replay only; synthetic data; rolled back).
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  c uuid := gen_random_uuid();
  other_c uuid := gen_random_uuid();
  actor uuid := gen_random_uuid();
  test_customer uuid := gen_random_uuid();
  real_customer uuid := gen_random_uuid();
  history_customer uuid := gen_random_uuid();
  site uuid := gen_random_uuid();
  mp uuid := gen_random_uuid();
  t text;
BEGIN
  -- Every listed tenant table now references companies.
  FOREACH t IN ARRAY ARRAY[
    'communication_routes','company_market_party_routes','customer_communication_templates',
    'integration_provider_accounts','ediel_actor_settings','ediel_route_profiles',
    'ediel_it_system_profiles','user_permissions','ediel_certificates','customer_invoice_documents',
    'ediel_outbound_queue','ediel_production_send_approvals','ediel_message_payloads',
    'ediel_message_splits','ediel_message_correlations','ediel_inbound_business_decisions',
    'metering_value_batches','metering_value_errors','tenant_customer_sync_requests',
    'duplicate_groups','ediel_tgt_test_data','customer_portal_write_idempotency'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint con
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
      WHERE con.contype = 'f' AND con.convalidated
        AND con.conrelid = format('public.%I', t)::regclass
        AND con.confrelid = 'public.companies'::regclass
        AND att.attname = 'company_id'
    ) THEN
      RAISE EXCEPTION 'validated company foreign key missing on %', t;
    END IF;
  END LOOP;

  INSERT INTO public.companies(id,name,status) VALUES(c,'Delete synthetic A','active'),(other_c,'Delete synthetic B','active');
  INSERT INTO public.customers(id,company_id,customer_number,name,customer_type,is_test_data)
  VALUES (test_customer,c,'DEL-T','Test customer','private',true),
         (real_customer,c,'DEL-R','Real customer','private',false),
         (history_customer,c,'DEL-H','Test with history','private',true);
  INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country)
  VALUES(site,c,test_customer,'Site','consumption','active','SE');
  INSERT INTO public.metering_points(id,company_id,customer_id,site_id,metering_point_id,reading_frequency,measurement_type,is_settlement_relevant,status)
  VALUES(mp,c,test_customer,site,'735999999999999991','monthly','consumption',true,'active');
  INSERT INTO public.customer_internal_notes(company_id,customer_id,body)
  VALUES(c,test_customer,'note');
  INSERT INTO public.customer_blockers(company_id,customer_id,blocker_type,title)
  VALUES(c,history_customer,'synthetic','Blocker');

  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  BEGIN
    PERFORM public.gridex_delete_test_customer_v1(c, test_customer, actor);
    RAISE EXCEPTION 'delete allowed for authenticated role';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  BEGIN
    PERFORM public.gridex_delete_test_customer_v1(other_c, test_customer, actor);
    RAISE EXCEPTION 'cross-tenant delete allowed';
  EXCEPTION WHEN no_data_found THEN NULL; END;

  BEGIN
    PERFORM public.gridex_delete_test_customer_v1(c, real_customer, actor);
    RAISE EXCEPTION 'real customer deleted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'customer_delete_requires_test_data' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.gridex_delete_test_customer_v1(c, history_customer, actor);
    RAISE EXCEPTION 'customer with protected history deleted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'customer_delete_protected_history' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = history_customer) THEN
    RAISE EXCEPTION 'rejected delete removed the customer';
  END IF;

  PERFORM public.gridex_delete_test_customer_v1(c, test_customer, actor);
  IF EXISTS (SELECT 1 FROM public.customers WHERE id = test_customer)
     OR EXISTS (SELECT 1 FROM public.customer_sites WHERE id = site)
     OR EXISTS (SELECT 1 FROM public.metering_points WHERE id = mp)
     OR EXISTS (SELECT 1 FROM public.customer_internal_notes WHERE customer_id = test_customer) THEN
    RAISE EXCEPTION 'test customer graph not fully deleted';
  END IF;
  IF (SELECT count(*) FROM public.audit_logs WHERE entity_id = test_customer::text AND action = 'customer.deleted_test' AND company_id = c) <> 1 THEN
    RAISE EXCEPTION 'delete audit row missing';
  END IF;

  IF has_function_privilege('authenticated', 'public.gridex_delete_test_customer_v1(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute delete command';
  END IF;

  RAISE NOTICE 'tenant fk and test customer delete regression: ok';
END $$;

ROLLBACK;
