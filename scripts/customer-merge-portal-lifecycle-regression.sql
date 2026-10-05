-- Clean replay only: real ownership FKs, indexes and triggers; synthetic rows; rolled back.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  tenant uuid := gen_random_uuid();
  other_tenant uuid := gen_random_uuid();
  actor uuid := gen_random_uuid();
  primary_c uuid := gen_random_uuid();
  source_c uuid := gen_random_uuid();
  foreign_c uuid := gen_random_uuid();
  legacy_c uuid := gen_random_uuid();
  locked_c uuid := gen_random_uuid();
  ambiguous_c uuid := gen_random_uuid();
  api_client uuid := gen_random_uuid();
  locked_contract uuid := gen_random_uuid();
  user_a uuid := gen_random_uuid();
  user_b uuid := gen_random_uuid();
  blocked_user uuid := gen_random_uuid();
  case_id uuid := gen_random_uuid();
  attachment_id uuid := gen_random_uuid();
  account_id uuid := gen_random_uuid();
  identity_id uuid := gen_random_uuid();
  fixture_site uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id,email) VALUES(actor,'portal-merge-actor@example.invalid');
  INSERT INTO public.companies(id,name,status) VALUES(tenant,'Portal merge A','active'),(other_tenant,'Portal merge B','active');
  INSERT INTO public.customers(id,company_id,customer_number,name,customer_type,status)
  VALUES(primary_c,tenant,'PM-1','Primary','private','active'),(source_c,tenant,'PM-2','Source','private','active'),
        (foreign_c,other_tenant,'PM-3','Foreign','private','active'),(legacy_c,tenant,'PM-4','Legacy','private','active'),
        (locked_c,tenant,'PM-5','Locked contract source','private','active'),
        (ambiguous_c,tenant,'PM-6','Ambiguous source','private','active');
  INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country)
  VALUES(fixture_site,tenant,source_c,'Source site','consumption','active','SE');
  INSERT INTO public.metering_points(company_id,customer_id,site_id) VALUES(tenant,source_c,fixture_site);
  INSERT INTO public.grid_owner_information_requests(company_id,customer_id,customer_site_id) VALUES(tenant,source_c,fixture_site);
  INSERT INTO public.customer_cases(id,company_id,customer_id,title) VALUES(case_id,tenant,source_c,'Existing support');
  INSERT INTO public.customer_case_events(company_id,customer_id,customer_case_id,event_type,message,payload)
  VALUES(tenant,source_c,case_id,'support_customer_message','Prior message','{"visibility":"customer"}');
  INSERT INTO public.customer_case_attachments(id,company_id,customer_id,customer_case_id,public_reference,file_name,detected_mime_type,byte_size,sha256,storage_path,visibility,uploaded_by_kind,scan_status)
  VALUES(attachment_id,tenant,source_c,case_id,'support_attachment_mergefixture0001','previous.pdf','application/pdf',20,repeat('a',64),'unchanged/source/previous.pdf','customer','customer','released');
  INSERT INTO public.customer_portal_accounts(id,company_id,customer_id,portal_user_id,role,status,is_active,verified_identity_snapshot)
  VALUES(account_id,tenant,source_c,user_a,'viewer',' active ',true,'{"original_customer":"source"}'),
        (gen_random_uuid(),tenant,primary_c,user_b,'billing','active',true,'{}'),
        (gen_random_uuid(),tenant,source_c,blocked_user,'owner','disabled',false,'{}');
  INSERT INTO public.customer_portal_identities(id,company_id,customer_id,provider,external_customer_id,auth_user_id,customer_portal_user_id,status,match_strength)
  VALUES(identity_id,tenant,source_c,'gridex_website','web-source',user_a,user_a,'active','strong'),
        (gen_random_uuid(),tenant,primary_c,'gridex_website','web-primary',user_b,user_b,'active','strong'),
        (gen_random_uuid(),tenant,source_c,'gridex_website','web-blocked',blocked_user,blocked_user,'disabled','strong');
  INSERT INTO public.tenant_portal_customer_links(company_id,customer_id,provider,external_customer_id,status)
  VALUES(tenant,source_c,'third_party_portal','provider-source','revoked');
  INSERT INTO public.customer_portal_events(company_id,customer_id,event_type) VALUES(tenant,source_c,'history');
  INSERT INTO public.customer_portal_requests(company_id,customer_id,request_type) VALUES(tenant,source_c,'profile_update');
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  PERFORM set_config('request.jwt.claim.role','service_role',true);

  -- Equal raw external UUIDs under distinct providers are not equivalent issuers.
  INSERT INTO public.customer_portal_identities(company_id,customer_id,provider,external_customer_id,auth_user_id,customer_portal_user_id,status,match_strength)
  VALUES(tenant,ambiguous_c,'other_provider','another-provider',user_b,user_b,'active','strong');
  BEGIN
    PERFORM public.gridex_merge_customers_v1(tenant,primary_c,array[ambiguous_c],actor,'duplicates');
    RAISE EXCEPTION 'ambiguous cross-provider subject accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'customer_merge_ambiguous_portal_subject' THEN RAISE; END IF;
  END;
  IF (SELECT merged_into_customer_id FROM public.customers WHERE id=ambiguous_c) IS NOT NULL THEN
    RAISE EXCEPTION 'ambiguous subject partially merged customer';
  END IF;
  DELETE FROM public.customer_portal_identities WHERE company_id=tenant AND customer_id=ambiguous_c;
  INSERT INTO public.customer_portal_identities(company_id,customer_id,provider,external_customer_id,external_account_id,status,match_strength)
  VALUES(tenant,ambiguous_c,'provider-one','external-source','duplicate-external-subject','active','manual'),
        (tenant,primary_c,'provider-two','external-primary','duplicate-external-subject','active','manual');
  BEGIN
    PERFORM public.gridex_merge_customers_v1(tenant,primary_c,array[ambiguous_c],actor,'duplicates');
    RAISE EXCEPTION 'ambiguous external-only provider subject accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'customer_merge_ambiguous_portal_subject' THEN RAISE; END IF;
  END;
  DELETE FROM public.customer_portal_identities WHERE company_id=tenant AND external_account_id='duplicate-external-subject';
  INSERT INTO public.tenant_portal_customer_links(company_id,customer_id,provider,external_customer_id,status)
  VALUES(tenant,ambiguous_c,'provider-one','duplicate-customer-alias','active'),
        (tenant,primary_c,'provider-two','duplicate-customer-alias','active');
  BEGIN
    PERFORM public.gridex_merge_customers_v1(tenant,primary_c,array[ambiguous_c],actor,'duplicates');
    RAISE EXCEPTION 'ambiguous cross-provider customer alias accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'customer_merge_ambiguous_portal_subject' THEN RAISE; END IF;
  END;
  DELETE FROM public.tenant_portal_customer_links WHERE company_id=tenant AND external_customer_id='duplicate-customer-alias';

  -- An incomplete signature cannot be fabricated for this fixture. The valid
  -- locked draft below exercises the same immutable-owner branch used by
  -- signed, active, and terminal contracts, without fake version references.
  BEGIN
    INSERT INTO public.customer_contracts(id,company_id,customer_id,contract_number,customer_number,contract_name,status,signed_at)
    VALUES(locked_contract,tenant,locked_c,'PM-'||locked_contract::text,'PM-5','Invalid signature fixture','signed',now());
    RAISE EXCEPTION 'incomplete signed contract accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'customer_contract_signed_insert_requires_import_command' THEN RAISE; END IF;
  END;
  INSERT INTO public.customer_contracts(id,company_id,customer_id,contract_number,customer_number,contract_name,status,locked_at)
  VALUES(locked_contract,tenant,locked_c,'PM-'||locked_contract::text,'PM-5','Immutable locked draft','draft',now());
  BEGIN
    PERFORM public.gridex_merge_customers_v1(tenant,primary_c,array[locked_c],actor,'duplicates');
    RAISE EXCEPTION 'locked customer contract reassigned';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM NOT LIKE 'signed_customer_contract_immutable:%' THEN RAISE; END IF;
  END;
  IF (SELECT customer_id FROM public.customer_contracts WHERE id=locked_contract) <> locked_c THEN
    RAISE EXCEPTION 'locked ownership mutated';
  END IF;

  -- Cross-company sources abort all moves, including access mappings and support history.
  BEGIN
    PERFORM public.gridex_merge_customers_v1(tenant,primary_c,array[source_c,foreign_c],actor,'duplicates');
    RAISE EXCEPTION 'cross-company merge allowed';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  IF (SELECT customer_id FROM public.customer_portal_accounts WHERE id=account_id) <> source_c THEN
    RAISE EXCEPTION 'failed merge changed access';
  END IF;

  -- Legacy OPS subjects remain a different namespace. A real unique collision aborts;
  -- no delete, role promotion or selecting an active row over a blocked row is allowed.
  INSERT INTO public.customer_portal_accounts(company_id,customer_id,user_id,role,status,is_active)
  VALUES(tenant,primary_c,actor,'viewer','disabled',false),(tenant,legacy_c,actor,'owner','active',true);
  BEGIN
    PERFORM public.gridex_merge_customers_v1(tenant,primary_c,array[legacy_c],actor,'duplicates');
    RAISE EXCEPTION 'legacy binding collision allowed';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  IF (SELECT merged_into_customer_id FROM public.customers WHERE id=legacy_c) IS NOT NULL THEN
    RAISE EXCEPTION 'binding collision partially merged customer';
  END IF;

  -- Completed writes keep their keys and result evidence; colliding histories abort.
  INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash)
  VALUES(api_client,tenant,'Synthetic merge fixture','fixture','synthetic-not-an-api-key');
  INSERT INTO public.customer_portal_write_idempotency(company_id,api_client_id,customer_id,route,idempotency_key,request_hash,status)
  VALUES(tenant,api_client,primary_c,'/support','same-key','same-hash','completed'),
        (tenant,api_client,source_c,'/support','same-key','same-hash','completed');
  BEGIN
    PERFORM public.gridex_merge_customers_v1(tenant,primary_c,array[source_c],actor,'duplicates');
    RAISE EXCEPTION 'idempotency collision allowed';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  IF (SELECT customer_id FROM public.customer_cases WHERE id=case_id) <> source_c
     OR (SELECT customer_id FROM public.customer_portal_accounts WHERE id=account_id) <> source_c THEN
    RAISE EXCEPTION 'idempotency collision partially moved graph';
  END IF;
  DELETE FROM public.customer_portal_write_idempotency WHERE company_id=tenant AND customer_id=primary_c;

  PERFORM public.gridex_merge_customers_v1(tenant,primary_c,array[source_c],actor,'verified duplicates');
  IF (SELECT customer_id FROM public.customer_portal_accounts WHERE id=account_id) <> primary_c
     OR (SELECT customer_id FROM public.customer_portal_identities WHERE id=identity_id) <> primary_c
     OR (SELECT customer_id FROM public.customer_cases WHERE id=case_id) <> primary_c
     OR (SELECT customer_id FROM public.customer_case_attachments WHERE id=attachment_id) <> primary_c
     OR EXISTS(SELECT 1 FROM public.customer_case_events WHERE customer_case_id=case_id AND customer_id<>primary_c) THEN
    RAISE EXCEPTION 'portal/support graph not moved';
  END IF;
  IF EXISTS(SELECT 1 FROM public.metering_points WHERE site_id=fixture_site AND company_id=tenant AND customer_id<>primary_c)
     OR EXISTS(SELECT 1 FROM public.grid_owner_information_requests WHERE customer_site_id=fixture_site AND company_id=tenant AND customer_id<>primary_c)
     OR EXISTS(SELECT 1 FROM public.customer_portal_write_idempotency WHERE company_id=tenant AND customer_id=source_c) THEN
    RAISE EXCEPTION 'site-owner or completed write history not moved';
  END IF;
  IF (SELECT role FROM public.customer_portal_accounts WHERE id=account_id) <> 'viewer'
     OR (SELECT status FROM public.customer_portal_accounts WHERE id=account_id) <> ' active '
     OR (SELECT verified_identity_snapshot FROM public.customer_portal_accounts WHERE id=account_id) <> '{"original_customer":"source"}'::jsonb
     OR (SELECT status FROM public.customer_portal_identities WHERE external_customer_id='web-blocked' AND company_id=tenant) <> 'disabled'
     OR (SELECT is_active FROM public.customer_portal_accounts WHERE portal_user_id=blocked_user AND company_id=tenant)
     OR (SELECT status FROM public.tenant_portal_customer_links WHERE external_customer_id='provider-source' AND company_id=tenant) <> 'revoked'
     OR (SELECT storage_path FROM public.customer_case_attachments WHERE id=attachment_id) <> 'unchanged/source/previous.pdf' THEN
    RAISE EXCEPTION 'merge changed access state, evidence, provider alias or binary storage';
  END IF;
  IF EXISTS(SELECT 1 FROM public.customer_portal_events WHERE customer_id=source_c)
     OR EXISTS(SELECT 1 FROM public.customer_portal_requests WHERE customer_id=source_c)
     OR (SELECT merged_into_customer_id FROM public.customers WHERE id=source_c) <> primary_c THEN
    RAISE EXCEPTION 'portal history or canonical source marker missing';
  END IF;

  BEGIN
    INSERT INTO public.customer_portal_identities(company_id,customer_id,external_customer_id,auth_user_id,customer_portal_user_id,status,match_strength)
    VALUES(tenant,source_c,'late-source',gen_random_uuid(),gen_random_uuid(),'active','strong');
    RAISE EXCEPTION 'stale source link accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'customer_merged_write_conflict' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.customer_cases(company_id,customer_id,title) VALUES(tenant,source_c,'Late source support');
    RAISE EXCEPTION 'stale support customer accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'customer_merged_write_conflict' THEN RAISE; END IF;
  END;
  -- Profile context can be stale even when its expected version was fetched after merge.
  BEGIN
    PERFORM public.gridex_customer_contact_change_v1(tenant,source_c,'customer_portal',NULL,api_client,identity_id::text,'customer_api',
      (SELECT updated_at FROM public.customers WHERE id=source_c),'{"phone":"0100000000"}','{"phone":"0100000000"}',NULL);
    RAISE EXCEPTION 'stale profile changed merged source';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'customer_merged_write_conflict' THEN RAISE; END IF;
  END;
  IF (SELECT phone FROM public.customers WHERE id=source_c) IS NOT NULL
     OR EXISTS(SELECT 1 FROM public.customer_contacts WHERE company_id=tenant AND customer_id=source_c)
     OR EXISTS(SELECT 1 FROM public.domain_events WHERE company_id=tenant AND subject_customer_id=source_c) THEN
    RAISE EXCEPTION 'failed stale profile wrote source state';
  END IF;
  BEGIN
    INSERT INTO public.customer_portal_accounts(company_id,customer_id,portal_user_id) VALUES(tenant,foreign_c,gen_random_uuid());
    RAISE EXCEPTION 'foreign company mapping accepted';
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN NULL; END;

  -- Deferral is scoped to the merge; invalid owner tuples still fail immediately afterwards.
  BEGIN
    INSERT INTO public.customer_case_events(company_id,customer_id,customer_case_id,event_type,message)
    VALUES(tenant,legacy_c,case_id,'support_customer_message','Wrong owner');
    RAISE EXCEPTION 'merge left case FK deferred';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  IF (SELECT count(*) FROM public.customer_merge_events WHERE company_id=tenant AND merged_customer_id=source_c) <> 1 THEN
    RAISE EXCEPTION 'audited merge event missing';
  END IF;
  RAISE NOTICE 'customer merge portal lifecycle regression: ok';
END $$;
ROLLBACK;
