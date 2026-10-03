-- Synthetic rollback-only native credential tests. Only the guarded localhost
-- runner or optional diagnostic executes this file; never use production data.
BEGIN;
CREATE FUNCTION pg_temp.machine_assert(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Staff machine auth assertion failed: %',label; END IF;
END $$;
CREATE FUNCTION pg_temp.machine_auth(
  method text DEFAULT 'GET', route text DEFAULT '/api/v1/staff/me',
  prefix text DEFAULT 'stafftest0001', digest text DEFAULT repeat('f',64),
  required_all text[] DEFAULT ARRAY[]::text[], required_any text[] DEFAULT ARRAY[]::text[],
  ip text DEFAULT '10.10.5.5', origin text DEFAULT 'https://support.example.invalid',
  cost integer DEFAULT 1, window_seconds integer DEFAULT 1
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT to_jsonb(a) FROM public.authenticate_staff_integration_request_v1(
    prefix,digest,method,route,required_all,required_any,ip,origin,cost,window_seconds
  ) a
$$;

DO $$
DECLARE
  company uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
  staff_client uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
  website_client uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3';
  customer_client uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4';
  other_company uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5';
  other_client uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6';
  rpc text := 'public.authenticate_staff_integration_request_v1(text,text,text,text,text[],text[],text,text,integer,integer)';
  core text := 'private.authenticate_integration_request_v1_secret_internal(text,text,text,text[],text[],text,text,integer,integer)';
  result jsonb; route text; method text; required_scope text; pair text[];
  customer_path text := '/api/v1/staff/customers/customer_'||repeat('a',32);
  case_path text := '/api/v1/staff/support/cases/support_case_'||repeat('b',32);
  attachment_path text := '/attachments/support_attachment_'||repeat('c',32);
  count_before bigint; reset_before timestamptz;
BEGIN
  PERFORM pg_temp.machine_assert(has_function_privilege('service_role',rpc,'EXECUTE'),'service may authenticate staff machines');
  PERFORM pg_temp.machine_assert(NOT has_function_privilege('anon',rpc,'EXECUTE') AND NOT has_function_privilege('authenticated',rpc,'EXECUTE'),'browser cannot authenticate staff machines');
  PERFORM pg_temp.machine_assert(NOT has_function_privilege('service_role',core,'EXECUTE') AND NOT has_schema_privilege('service_role','private','USAGE'),'stored credential core remains private');
  PERFORM pg_temp.machine_assert(NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=rpc::regprocedure AND 'secret_hash'=ANY(proargnames[array_length(proargnames,1)-16:array_length(proargnames,1)])),'RPC never returns stored hash');

  INSERT INTO public.companies(id,name,status) VALUES(company,'Synthetic dedicated staff company','active'),(other_company,'Synthetic other staff company','active');
  INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,profile_key,metadata,scopes,allowed_ips,allowed_origins,rate_limit_per_minute,launch_ready,launch_blockers)
  VALUES
    (staff_client,company,'Synthetic dedicated staff','stafftest0001',repeat('f',64),'custom','{"integration_kind":"staff_support_v1"}',ARRAY['staff_sessions.write','staff_context.read','staff_customers.read','staff_support.read','staff_support.write'],ARRAY['10.10.0.0/16'],ARRAY['https://support.example.invalid'],5000,false,'["sales unavailable"]'),
    (website_client,company,'Synthetic Website','websitetest1',repeat('1',64),'tenant_website','{"integration_kind":"staff_support_v1"}',ARRAY['*'],ARRAY[]::text[],ARRAY[]::text[],5000,true,'[]'),
    (customer_client,company,'Synthetic Customer Portal','customertst1',repeat('2',64),'custom','{"integration_kind":"customer_portal_v1"}',ARRAY['*'],ARRAY[]::text[],ARRAY[]::text[],5000,true,'[]'),
    (other_client,other_company,'Synthetic separate staff','otherstaff01',repeat('3',64),'custom','{"integration_kind":"staff_support_v1"}',ARRAY['staff_context.read'],ARRAY[]::text[],ARRAY[]::text[],5000,false,'[]');
  INSERT INTO public.company_capabilities(company_id,capability_code,enabled,readiness_status) VALUES(company,'api_sales',false,'disabled');
  PERFORM pg_temp.machine_assert(NOT EXISTS(SELECT 1 FROM public.tenant_website_installation_receipts WHERE company_id=company),'no Website receipt or sales capability supplied');

  SET LOCAL ROLE service_role;
  PERFORM pg_temp.machine_assert(current_user='service_role','native service execution role');
  SELECT to_jsonb(a) INTO result FROM public.authenticate_integration_request_v1(
    'stafftest0001',repeat('f',64),'/api/v1/staff/me',ARRAY['staff_context.read'],ARRAY[]::text[],'10.10.5.5','https://support.example.invalid',1,60
  ) a;
  PERFORM pg_temp.machine_assert(result->>'auth_outcome'='denied' AND result->>'error_code'='api_client_not_launch_ready','generic Website policy is still enforced');
  result := pg_temp.machine_auth();
  PERFORM pg_temp.machine_assert(result->>'auth_outcome'='allowed' AND result->>'client_id'=staff_client::text AND result->>'company_id'=company::text AND NOT result ? 'secret_hash','dedicated staff allowed without Website readiness and no hash response');
  result := pg_temp.machine_auth(prefix=>'websitetest1',digest=>repeat('1',64),ip=>NULL,origin=>NULL);
  PERFORM pg_temp.machine_assert(result->>'auth_outcome'='denied' AND result->>'error_code'='api_client_inactive','Website profile cannot enter staff even with staff metadata and wildcard scope');
  result := pg_temp.machine_auth(prefix=>'customertst1',digest=>repeat('2',64),ip=>NULL,origin=>NULL);
  PERFORM pg_temp.machine_assert(result->>'auth_outcome'='denied' AND result->>'error_code'='api_client_inactive','Customer Portal kind cannot enter staff even with custom profile and wildcard scope');
  result := pg_temp.machine_auth(digest=>repeat('0',64));
  PERFORM pg_temp.machine_assert(result->>'auth_outcome'='denied' AND result->>'error_code'='invalid_api_token','native credential hash required');
  result := pg_temp.machine_auth(prefix=>'otherstaff01',digest=>repeat('3',64),ip=>NULL,origin=>NULL);
  PERFORM pg_temp.machine_assert(result->>'auth_outcome'='allowed' AND result->>'company_id'=other_company::text,'tenant derives only from the native matched credential');
  result := pg_temp.machine_auth(ip=>'10.11.5.5');
  PERFORM pg_temp.machine_assert(result->>'error_code'='api_ip_not_allowed','native CIDR IP restriction');
  result := pg_temp.machine_auth(ip=>NULL);
  PERFORM pg_temp.machine_assert(result->>'error_code'='api_ip_not_allowed','required client IP cannot be omitted');
  result := pg_temp.machine_auth(ip=>'not an ip');
  PERFORM pg_temp.machine_assert(result->>'error_code'='api_ip_not_allowed','invalid IP fails closed');
  result := pg_temp.machine_auth(origin=>'https://foreign.example.invalid');
  PERFORM pg_temp.machine_assert(result->>'error_code'='api_origin_not_allowed','native origin restriction');
  result := pg_temp.machine_auth(required_all=>ARRAY['website_contracts.read']);
  PERFORM pg_temp.machine_assert(result->>'error_code'='api_scope_missing','extra caller all-of requirement retained');
  result := pg_temp.machine_auth(required_any=>ARRAY['website_contracts.read','customer_portal.read']);
  PERFORM pg_temp.machine_assert(result->>'error_code'='api_scope_missing','extra caller any-of requirement retained');
  result := pg_temp.machine_auth('GET','/api/v1/staff/customers/customer_'||repeat('a',20));
  PERFORM pg_temp.machine_assert(result->>'auth_outcome'='allowed','minimum documented opaque reference length admitted');
  result := pg_temp.machine_auth('GET','/api/v1/staff/support/cases/support_case_'||repeat('a',64)||'/attachments/support_attachment_'||repeat('b',64));
  PERFORM pg_temp.machine_assert(result->>'auth_outcome'='allowed','maximum documented opaque reference lengths admitted');
  RESET ROLE;

  -- Each admitted route works with exactly its own scope. Empty caller arrays
  -- cannot remove that requirement; no scopes cannot authorize any route.
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['POST','/api/v1/staff/sessions','staff_sessions.write'],
    ['POST','/api/v1/staff/sessions/refresh','staff_sessions.write'],
    ['POST','/api/v1/staff/sessions/logout','staff_sessions.write'],
    ['POST','/api/v1/staff/sessions/mfa/challenge','staff_sessions.write'],
    ['POST','/api/v1/staff/sessions/mfa/verify','staff_sessions.write'],
    ['POST','/api/v1/staff/sessions/password','staff_sessions.write'],
    ['POST','/api/v1/staff/sessions/recovery','staff_sessions.write'],
    ['POST','/api/v1/staff/sessions/recovery/verify','staff_sessions.write'],
    ['GET','/api/v1/staff/me','staff_context.read'],
    ['GET','/api/v1/staff/customers','staff_customers.read'],
    ['GET',customer_path,'staff_customers.read'],
    ['GET',customer_path||'/contacts','staff_customers.read'],
    ['GET',customer_path||'/addresses','staff_customers.read'],
    ['GET',customer_path||'/facilities','staff_customers.read'],
    ['GET','/api/v1/staff/support/cases','staff_support.read'],
    ['GET','/api/v1/staff/support/assignees','staff_support.read'],
    ['GET',case_path,'staff_support.read'],
    ['GET',case_path||'/entries','staff_support.read'],
    ['GET',case_path||'/attachments','staff_support.read'],
    ['GET',case_path||attachment_path,'staff_support.read'],
    ['POST','/api/v1/staff/support/cases','staff_support.write'],
    ['POST',case_path||'/replies','staff_support.write'],
    ['POST',case_path||'/internal-notes','staff_support.write'],
    ['POST',case_path||'/status','staff_support.write'],
    ['POST',case_path||'/assignment','staff_support.write'],
    ['POST',case_path||'/attachments','staff_support.write']
  ] LOOP
    method:=pair[1]; route:=pair[2]; required_scope:=pair[3];
    UPDATE public.integration_api_clients SET scopes=ARRAY[required_scope] WHERE id=staff_client;
    SET LOCAL ROLE service_role;
    result:=pg_temp.machine_auth(method,route,cost=>0,window_seconds=>1);
    PERFORM pg_temp.machine_assert(result->>'auth_outcome'='allowed' AND (result->>'route_limit')::integer=CASE WHEN method='POST' THEN 1666 ELSE 5000 END,'exact native scope and canonical cost: '||method||' '||route);
    RESET ROLE;
    UPDATE public.integration_api_clients SET scopes=ARRAY[]::text[] WHERE id=staff_client;
    SET LOCAL ROLE service_role;
    result:=pg_temp.machine_auth(method,route,required_all=>NULL,required_any=>NULL);
    PERFORM pg_temp.machine_assert(result->>'error_code'='api_scope_missing','route scope cannot be bypassed by empty caller requirements: '||route);
    RESET ROLE;
  END LOOP;
  UPDATE public.integration_api_clients SET scopes=ARRAY['staff_sessions.write','staff_context.read','staff_customers.read','staff_support.read','staff_support.write'] WHERE id=staff_client;

  SELECT sum(request_count) INTO count_before FROM public.integration_api_rate_limit_buckets WHERE api_client_id=staff_client;
  SET LOCAL ROLE service_role;
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['DELETE','/api/v1/staff/me'],['POST','/api/v1/staff/me'],['GET','/api/v1/staff/sessions'],
    ['GET','/api/v1/staff/customers/extra'],['POST',customer_path],['GET',customer_path||'/contacts/extra'],
    ['GET',case_path||'/replies'],['POST',case_path],['GET',case_path||'/internal-notes'],
    ['POST','/api/v1/staff/support/assignees'],['GET',case_path||attachment_path||'/extra'],
    ['POST','/api/v1/staff/sessions/logout/extra'],['GET','provisioning-smoke:fake'],
    ['GET','/api/v1/website/contracts'],['GET',case_path||'/attachments/support_attachment_'||repeat('d',19)],
    ['GET','/api/v1/staff/customers/customer_'||repeat('a',65)],
    ['GET','/api/v1/staff/customers/customer_'||repeat('a',20)||'%2Fcontacts'],
    ['GET',case_path||'/entries?limit=100'],['GET',case_path||'/../entries'],
    ['GET',case_path||'/attachments/support_attachment_'||repeat('c',32)||'%0A'],
    ['GET',customer_path||chr(10)],['GET',case_path||'/entries'||chr(10)],
    ['get','/api/v1/staff/me'],['GET','/api/v1/staff/me/']
  ] LOOP
    result:=pg_temp.machine_auth(pair[1],pair[2]);
    PERFORM pg_temp.machine_assert(result->>'error_code'='api_scope_missing','unsupported method/path fails closed: '||pair[1]||' '||pair[2]);
  END LOOP;
  RESET ROLE;
  PERFORM pg_temp.machine_assert((SELECT sum(request_count)=count_before FROM public.integration_api_rate_limit_buckets WHERE api_client_id=staff_client),'unsupported paths consume no valid route budget');

  UPDATE public.integration_api_clients SET revoked_at=clock_timestamp() WHERE id=staff_client;
  SET LOCAL ROLE service_role; result:=pg_temp.machine_auth(); RESET ROLE;
  PERFORM pg_temp.machine_assert(result->>'error_code'='api_client_inactive','native revocation enforced');
  UPDATE public.integration_api_clients SET revoked_at=NULL,status='disabled' WHERE id=staff_client;
  SET LOCAL ROLE service_role; result:=pg_temp.machine_auth(); RESET ROLE;
  PERFORM pg_temp.machine_assert(result->>'error_code'='api_client_inactive','native client status enforced');
  UPDATE public.integration_api_clients SET status='active',expires_at=clock_timestamp()-interval '1 second' WHERE id=staff_client;
  SET LOCAL ROLE service_role; result:=pg_temp.machine_auth(); RESET ROLE;
  PERFORM pg_temp.machine_assert(result->>'error_code'='api_token_expired','native expiry enforced');
  UPDATE public.integration_api_clients SET expires_at=NULL,deleted_at=clock_timestamp() WHERE id=staff_client;
  SET LOCAL ROLE service_role; result:=pg_temp.machine_auth(); RESET ROLE;
  PERFORM pg_temp.machine_assert(result->>'error_code'='invalid_api_token','native soft deletion enforced');
  UPDATE public.integration_api_clients SET deleted_at=NULL WHERE id=staff_client;
  UPDATE public.companies SET status='paused' WHERE id=company;
  SET LOCAL ROLE service_role; result:=pg_temp.machine_auth(); RESET ROLE;
  PERFORM pg_temp.machine_assert(result->>'error_code'='tenant_paused','native tenant lifecycle enforced');
  UPDATE public.companies SET status='active' WHERE id=company;
  UPDATE public.integration_api_clients SET metadata='{}' WHERE id=staff_client;
  SET LOCAL ROLE service_role; result:=pg_temp.machine_auth(); RESET ROLE;
  PERFORM pg_temp.machine_assert(result->>'error_code'='api_client_inactive','missing native integration kind fails closed');
  UPDATE public.integration_api_clients SET metadata='{"integration_kind":"staff_support_v1"}',profile_key=NULL WHERE id=staff_client;
  SET LOCAL ROLE service_role; result:=pg_temp.machine_auth(); RESET ROLE;
  PERFORM pg_temp.machine_assert(result->>'error_code'='api_client_inactive','missing native custom profile fails closed');
  UPDATE public.integration_api_clients SET profile_key='custom',rate_limit_per_minute=6 WHERE id=staff_client;
  DELETE FROM public.integration_api_rate_limit_buckets WHERE api_client_id=staff_client;
  SET LOCAL ROLE service_role;
  result:=pg_temp.machine_auth('POST','/api/v1/staff/sessions',cost=>0,window_seconds=>1);
  PERFORM pg_temp.machine_assert(result->>'auth_outcome'='allowed' AND result->>'request_count'='1' AND result->>'route_limit'='2','native canonical POST budget first call');
  reset_before:=(result->>'reset_at')::timestamptz;
  PERFORM pg_temp.machine_assert(extract(epoch FROM reset_before)::bigint%60=0,'fixed canonical minute window despite caller one-second window');
  result:=pg_temp.machine_auth('POST','/api/v1/staff/sessions',cost=>1,window_seconds=>3600);
  PERFORM pg_temp.machine_assert(result->>'auth_outcome'='allowed' AND result->>'request_count'='2' AND (result->>'reset_at')::timestamptz=reset_before,'same native atomic minute bucket');
  result:=pg_temp.machine_auth('POST','/api/v1/staff/sessions',cost=>1,window_seconds=>1);
  PERFORM pg_temp.machine_assert(result->>'auth_outcome'='rate_limited' AND result->>'error_code'='rate_limited' AND result->>'request_count'='3' AND result->>'route_limit'='2','native route budget denied with canonical rate metadata');
  RESET ROLE;
END $$;
ROLLBACK;
