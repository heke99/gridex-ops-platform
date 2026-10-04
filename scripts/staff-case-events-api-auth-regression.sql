-- Synthetic addressable staff case history machine authentication. Rolled back.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  company uuid := gen_random_uuid();
  client uuid := gen_random_uuid();
  prefix text := 'staff-events-'||client::text;
  secret text := repeat('a',64);
  route text := '/api/v1/staff/cases/support_case_'||repeat('A',32)||'/events';
  result record;
  bad_route text;
BEGIN
  INSERT INTO public.companies(id,name,status) VALUES(company,'Synthetic staff case events API','active');
  INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,profile_key,scopes,launch_ready,launch_blockers)
  VALUES(client,company,'Synthetic event read key',prefix,secret,'custom',ARRAY['staff_cases.read'],false,'[]');
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,route,ARRAY['staff_cases.read']);
  IF result.auth_outcome IS DISTINCT FROM 'allowed' OR result.company_id IS DISTINCT FROM company THEN RAISE EXCEPTION 'staff case events route denied: %',result.error_code; END IF;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,route,ARRAY['staff_cases.write']);
  IF result.auth_outcome IS DISTINCT FROM 'denied' OR result.error_code IS DISTINCT FROM 'api_scope_missing' THEN RAISE EXCEPTION 'staff case events write scope unexpectedly allowed'; END IF;
  FOREACH bad_route IN ARRAY ARRAY[
    '/api/v1/staff/cases/support_case_'||repeat('A',31)||'/events',
    '/api/v1/staff/cases/support_case_'||repeat('A',33)||'/events',
    route||'/extra',route||'/',replace(route,'/events','/events-unknown')
  ] LOOP
    SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,bad_route,ARRAY['staff_cases.read']);
    IF result.auth_outcome IS DISTINCT FROM 'denied' OR result.error_code IS DISTINCT FROM 'api_scope_missing' THEN RAISE EXCEPTION 'malformed staff event route allowed: %',bad_route; END IF;
  END LOOP;
  UPDATE public.integration_api_clients SET scopes=ARRAY['*'] WHERE id=client;
  SELECT * INTO result FROM public.authenticate_integration_request_v1(prefix,secret,route,ARRAY['staff_cases.read']);
  IF result.auth_outcome IS DISTINCT FROM 'denied' OR result.error_code IS DISTINCT FROM 'api_scope_missing' THEN RAISE EXCEPTION 'wildcard granted staff events'; END IF;
END;
$$;
ROLLBACK;
