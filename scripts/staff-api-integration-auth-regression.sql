-- Staff API machine policy: actual credential core, tenant lifecycle, explicit
-- isolated scopes and atomic rate budgets; existing website gates stay intact.
-- Synthetic, rolled back. Run against the clean replay database as its owner.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  company uuid := gen_random_uuid();
  client uuid := gen_random_uuid();
  prefix text := 'staff-native-' || client::text;
  secret text := repeat('a',64);
  result record;
  receipt uuid := gen_random_uuid();
  scope text;
  path text;
  cases_ref text := 'support_case_' || repeat('A',32);
  customer_ref text := 'customer_' || repeat('B',32);
BEGIN
  INSERT INTO public.companies(id,name,status) VALUES(company,'Synthetic staff API guard','active');
  INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,profile_key,scopes,launch_ready,launch_blockers)
  VALUES(client,company,'Synthetic staff-only key',prefix,secret,'custom',ARRAY['staff_users.read','staff_users.write','staff_customers.read','staff_customers.write','staff_cases.read','staff_cases.write'],false,'[]');
  UPDATE public.company_capabilities SET enabled=false,readiness_status='not_configured' WHERE company_id=company AND capability_code='api_sales';

  -- Each mounted route family uses its exact own staff scope without sales provisioning.
  FOR path,scope IN SELECT * FROM (VALUES
    ('/api/v1/staff/users','staff_users.read'),
    ('/api/v1/staff/users','staff_users.write'),
    ('/api/v1/staff/users/' || client::text,'staff_users.write'),
    ('/api/v1/staff/users/' || client::text || '/disable','staff_users.write'),
    ('/api/v1/staff/users/' || client::text || '/enable','staff_users.write'),
    ('/api/v1/staff/roles','staff_users.read'),
    ('/api/v1/staff/customers','staff_customers.read'),
    ('/api/v1/staff/customers/' || customer_ref,'staff_customers.read'),
    ('/api/v1/staff/customers/' || customer_ref || '/contact','staff_customers.write'),
    ('/api/v1/staff/customers/' || customer_ref || '/identity-change','staff_customers.write'),
    ('/api/v1/staff/cases','staff_cases.read'),
    ('/api/v1/staff/cases','staff_cases.write'),
    ('/api/v1/staff/cases/' || cases_ref,'staff_cases.read'),
    ('/api/v1/staff/cases/' || cases_ref || '/messages','staff_cases.write'),
    ('/api/v1/staff/cases/' || cases_ref || '/notes','staff_cases.write'),
    ('/api/v1/staff/cases/' || cases_ref || '/phone-interactions','staff_cases.write'),
    ('/api/v1/staff/cases/' || cases_ref || '/status','staff_cases.write'),
    ('/api/v1/staff/cases/' || cases_ref || '/assignee','staff_cases.write'),
    ('/api/v1/staff/cases/' || cases_ref || '/attachments','staff_cases.read'),
    ('/api/v1/staff/cases/' || cases_ref || '/attachments','staff_cases.write'),
    ('/api/v1/staff/cases/' || cases_ref || '/attachments/support_attachment_' || repeat('C',24) || '/file','staff_cases.read')
  ) routes(path,scope) LOOP
    SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,path,ARRAY[scope]);
    IF result.auth_outcome IS DISTINCT FROM 'allowed' OR result.company_id IS DISTINCT FROM company THEN
      RAISE EXCEPTION 'staff route % with % denied: %',path,scope,result.error_code;
    END IF;
  END LOOP;
  FOREACH path IN ARRAY ARRAY[
    '/api/v1/staff/cases/' || cases_ref || '/attachments/support_attachment_' || repeat('C',24),
    '/api/v1/staff/cases/' || cases_ref || '/attachments/support_attachment_' || repeat('C',23) || '/file',
    '/api/v1/staff/cases/' || cases_ref || '/attachments/support_attachment_' || repeat('C',25) || '/file',
    '/api/v1/staff/cases/' || cases_ref || '/attachments/support_attachment_' || repeat('C',32) || '/file'
  ] LOOP
    SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,path,ARRAY['staff_cases.read']);
    IF result.auth_outcome<>'denied' OR result.error_code IS DISTINCT FROM 'api_scope_missing' THEN RAISE EXCEPTION 'invalid attachment file route allowed: %',path; END IF;
  END LOOP;

  -- Wildcard is a legacy capability, never opt-in to staff scopes.
  UPDATE public.integration_api_clients SET scopes=ARRAY['*'] WHERE id=client;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'/api/v1/staff/users',ARRAY['staff_users.read']);
  IF result.error_code IS DISTINCT FROM 'api_scope_missing' OR result.auth_outcome<>'denied' THEN RAISE EXCEPTION 'wildcard granted staff'; END IF;
  UPDATE public.integration_api_clients SET scopes=ARRAY['staff_users.read','staff_customers.read','staff_cases.read','*'] WHERE id=client;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'/api/v1/staff/users',ARRAY['staff_users.write']);
  IF result.error_code IS DISTINCT FROM 'api_scope_missing' THEN RAISE EXCEPTION 'wildcard escalated staff read to write'; END IF;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'/api/v1/staff/users',ARRAY['staff_users.read']);
  IF result.auth_outcome<>'allowed' THEN RAISE EXCEPTION 'explicit scope with wildcard denied'; END IF;

  -- Empty, wildcard, wrong-family, OR and invalid-route requests do not skip readiness.
  FOREACH path IN ARRAY ARRAY['/api/v1/staff','/api/v1/staff/','/api/v1/staff/users/unknown','/api/v1/staff/users/' || client::text || '/delete','/api/v1/staff/cases/' || cases_ref || '/unknown','/api/v1/staff/customers/' || customer_ref || '/contact/extra'] LOOP
    SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,path,ARRAY['staff_users.read']);
    IF result.auth_outcome<>'denied' OR result.error_code IS DISTINCT FROM 'api_scope_missing' THEN RAISE EXCEPTION 'unknown staff route allowed: %',path; END IF;
  END LOOP;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'/api/v1/staff/users',ARRAY[]::text[]);
  IF result.error_code IS DISTINCT FROM 'api_scope_missing' THEN RAISE EXCEPTION 'scope-free staff route allowed'; END IF;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'/api/v1/staff/users',ARRAY['*']);
  IF result.error_code IS DISTINCT FROM 'api_scope_missing' THEN RAISE EXCEPTION 'wildcard scope request allowed'; END IF;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'/api/v1/staff/users',ARRAY['staff_cases.read']);
  IF result.error_code IS DISTINCT FROM 'api_scope_missing' THEN RAISE EXCEPTION 'wrong staff family allowed'; END IF;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'/api/v1/staff/users',ARRAY[]::text[],ARRAY['staff_users.read']);
  IF result.error_code IS DISTINCT FROM 'api_scope_missing' THEN RAISE EXCEPTION 'OR-only staff request allowed'; END IF;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'/api/v1/staff/users',ARRAY['staff_users.read','customer_profile.read']);
  IF result.error_code IS DISTINCT FROM 'api_scope_missing' THEN RAISE EXCEPTION 'mixed staff/customer scope request allowed'; END IF;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'/api/v1/staff/users',ARRAY[NULL]::text[]);
  IF result.error_code IS DISTINCT FROM 'api_scope_missing' THEN RAISE EXCEPTION 'null scope request allowed'; END IF;

  -- Core credential/lifecycle/network checks are never bypassed.
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,'wrong-secret','/api/v1/staff/users',ARRAY['staff_users.read']);
  IF result.error_code IS DISTINCT FROM 'invalid_api_token' THEN RAISE EXCEPTION 'wrong secret accepted'; END IF;
  UPDATE public.integration_api_clients SET revoked_at=now() WHERE id=client;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'/api/v1/staff/users',ARRAY['staff_users.read']);
  IF result.error_code IS DISTINCT FROM 'api_client_inactive' THEN RAISE EXCEPTION 'revoked key accepted'; END IF;
  UPDATE public.integration_api_clients SET revoked_at=null,expires_at=now()-interval '1 second' WHERE id=client;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'/api/v1/staff/users',ARRAY['staff_users.read']);
  IF result.error_code IS DISTINCT FROM 'api_token_expired' THEN RAISE EXCEPTION 'expired key accepted'; END IF;
  UPDATE public.integration_api_clients SET expires_at=null WHERE id=client;
  UPDATE public.companies SET status='paused' WHERE id=company;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'/api/v1/staff/users',ARRAY['staff_users.read']);
  IF result.error_code IS DISTINCT FROM 'tenant_paused' THEN RAISE EXCEPTION 'paused company accepted'; END IF;
  UPDATE public.companies SET status='active' WHERE id=company;
  UPDATE public.companies SET is_active=false WHERE id=company;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'/api/v1/staff/users',ARRAY['staff_users.read']);
  IF result.error_code IS DISTINCT FROM 'tenant_inactive' THEN RAISE EXCEPTION 'inactive company accepted'; END IF;
  UPDATE public.companies SET is_active=true WHERE id=company;
  UPDATE public.integration_api_clients SET allowed_ips=ARRAY['192.0.2.0/24'],allowed_origins=ARRAY['https://staff.example.test'] WHERE id=client;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'/api/v1/staff/users',ARRAY['staff_users.read'],ARRAY[]::text[],'198.51.100.1','https://staff.example.test');
  IF result.error_code IS DISTINCT FROM 'api_ip_not_allowed' THEN RAISE EXCEPTION 'wrong staff IP accepted'; END IF;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'/api/v1/staff/users',ARRAY['staff_users.read'],ARRAY[]::text[],'192.0.2.1','https://evil.example.test');
  IF result.error_code IS DISTINCT FROM 'api_origin_not_allowed' THEN RAISE EXCEPTION 'wrong staff origin accepted'; END IF;
  UPDATE public.integration_api_clients SET allowed_ips='{}',allowed_origins='{}' WHERE id=client;

  -- Website/own-customer traffic preserves each original readiness barrier.
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'/api/v1/customer/profile',ARRAY['customer_profile.read']);
  IF result.error_code IS DISTINCT FROM 'api_client_not_launch_ready' THEN RAISE EXCEPTION 'customer readiness bypassed'; END IF;
  UPDATE public.integration_api_clients SET launch_ready=true WHERE id=client;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'/api/v1/customer/profile',ARRAY['customer_profile.read']);
  IF result.error_code IS DISTINCT FROM 'integration_receipt_not_verified' THEN RAISE EXCEPTION 'customer receipt bypassed'; END IF;
  INSERT INTO public.tenant_website_installation_receipts(id,company_id,api_client_id,idempotency_key,state,receipt_sha256,completed_at)
  VALUES(receipt,company,client,'synthetic-' || receipt::text,'completed',repeat('b',64),now());
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'/api/v1/customer/profile',ARRAY['customer_profile.read']);
  IF result.error_code IS DISTINCT FROM 'integration_capability_not_ready' THEN RAISE EXCEPTION 'api_sales gate bypassed'; END IF;
  INSERT INTO public.company_capabilities(company_id,capability_code,enabled,readiness_status) VALUES(company,'api_sales',true,'ready')
    ON CONFLICT(company_id,capability_code) DO UPDATE SET enabled=true,readiness_status='ready';
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'/api/v1/customer/profile',ARRAY['customer_profile.read']);
  IF result.auth_outcome<>'allowed' THEN RAISE EXCEPTION 'qualified existing customer key denied'; END IF;
  UPDATE public.integration_api_clients SET metadata=jsonb_build_object('provisioning_receipt_id',gen_random_uuid()) WHERE id=client;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'/api/v1/customer/profile',ARRAY['customer_profile.read']);
  IF result.error_code IS DISTINCT FROM 'integration_receipt_not_verified' THEN RAISE EXCEPTION 'stale metadata receipt accepted'; END IF;
  UPDATE public.integration_api_clients SET metadata=jsonb_build_object('provisioning_receipt_id',receipt) WHERE id=client;
  UPDATE public.tenant_website_installation_receipts SET state='client_ready',completed_at=null WHERE id=receipt;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'provisioning-smoke:native',ARRAY['customer_profile.read']);
  IF result.auth_outcome<>'allowed' THEN RAISE EXCEPTION 'existing exact provisioning smoke denied'; END IF;
  UPDATE public.integration_api_clients SET metadata=jsonb_build_object('provisioning_receipt_id',gen_random_uuid()) WHERE id=client;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'provisioning-smoke:native',ARRAY['customer_profile.read']);
  IF result.error_code IS DISTINCT FROM 'provisioning_smoke_receipt_invalid' THEN RAISE EXCEPTION 'wrong provisioning smoke receipt allowed'; END IF;

  -- Native rate-budget failure survives the new staff branch.
  UPDATE public.integration_api_clients SET rate_limit_per_minute=1 WHERE id=client;
  DELETE FROM public.integration_api_rate_limit_buckets WHERE api_client_id=client;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'/api/v1/staff/users',ARRAY['staff_users.read']);
  IF result.auth_outcome<>'allowed' THEN RAISE EXCEPTION 'first rate slot refused'; END IF;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,'/api/v1/staff/users',ARRAY['staff_users.read']);
  IF result.auth_outcome<>'rate_limited' OR result.error_code IS DISTINCT FROM 'rate_limited' THEN RAISE EXCEPTION 'staff limiter bypassed'; END IF;
  IF has_function_privilege('anon','public.authenticate_integration_request_v1(text,text,text,text[],text[],text,text,integer,integer)','EXECUTE')
    OR has_function_privilege('authenticated','public.authenticate_integration_request_v1(text,text,text,text[],text[],text,text,integer,integer)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.authenticate_integration_request_v1(text,text,text,text[],text[],text,text,integer,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'integration machine RPC grants changed';
  END IF;
END $$;
-- Exercise the grants as the actual API caller roles, beyond catalog checks.
SET LOCAL ROLE service_role;
DO $$ BEGIN
  IF (SELECT error_code FROM public.authenticate_integration_request_v1('synthetic-unknown',repeat('d',64),'/api/v1/staff/users',ARRAY['staff_users.read'])) IS DISTINCT FROM 'invalid_api_token' THEN
    RAISE EXCEPTION 'service_role guard execution changed';
  END IF;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.authenticate_integration_request_v1('synthetic-unknown',repeat('d',64),'/api/v1/staff/users',ARRAY['staff_users.read']);
    RAISE EXCEPTION 'anon could call integration machine RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.authenticate_integration_request_v1('synthetic-unknown',repeat('d',64),'/api/v1/staff/users',ARRAY['staff_users.read']);
    RAISE EXCEPTION 'authenticated could call integration machine RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
