-- Disposable full native replay only. All synthetic rows, events and audits roll back.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.expect_staff_assignee_denied(company_id uuid,case_id uuid,actor_id uuid,target_id uuid,client_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM public.gridex_assign_customer_case(company_id,case_id,actor_id,target_id,client_id,NULL);
    RAISE EXCEPTION 'staff_assignee_guard_allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM<>'support_assignee_not_active_in_company' THEN RAISE; END IF;
  END;
END$$;
DO $$
DECLARE
  a uuid:=gen_random_uuid();
  b uuid:=gen_random_uuid();
  actor uuid:=gen_random_uuid();
  target uuid:=gen_random_uuid();
  foreign_staff uuid:=gen_random_uuid();
  client uuid:=gen_random_uuid();
  customer uuid:=gen_random_uuid();
  case_id uuid:=gen_random_uuid();
  patch text;
  result jsonb;
  rpc_oid oid:='public.gridex_assign_customer_case(uuid,uuid,uuid,uuid,uuid,text)'::regprocedure;
BEGIN
  INSERT INTO public.companies(id,name,status,is_active)
  VALUES(a,'Synthetic assignment A','active',true),(b,'Synthetic assignment B','active',true);
  INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_anonymous)
  VALUES(actor,'authenticated','authenticated',actor::text||'@example.invalid','{}','{}',now(),now(),false),
    (target,'authenticated','authenticated',target::text||'@example.invalid','{}','{}',now(),now(),false),
    (foreign_staff,'authenticated','authenticated',foreign_staff::text||'@example.invalid','{}','{}',now(),now(),false);
  INSERT INTO public.user_profiles(id,email,user_status)
  VALUES(actor,actor::text||'@example.invalid','active'),(target,target::text||'@example.invalid','active'),(foreign_staff,foreign_staff::text||'@example.invalid','active')
    ON CONFLICT(id) DO UPDATE SET user_status='active';
  INSERT INTO public.company_memberships(company_id,user_id,role_key,membership_role,status,is_active,accepted_at)
  VALUES(a,actor,'company_admin','company_admin','active',true,now()),(a,target,'customer_service_agent','support','active',true,now()),
    (b,foreign_staff,'customer_service_agent','support','active',true,now());
  INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,scopes,status)
  VALUES(client,a,'Synthetic assignee guard','staff-assign-'||substr(client::text,1,12),repeat('a',64),ARRAY['staff_cases.write'],'active');
  INSERT INTO public.customers(id,company_id,full_name,status) VALUES(customer,a,'Synthetic support customer','active');
  INSERT INTO public.customer_cases(id,company_id,customer_id,title,source,metadata)
  VALUES(case_id,a,customer,'Synthetic assignment support','tenant_support_staff_api','{"support_case":true}');

  FOREACH patch IN ARRAY ARRAY[
    'role_key=''customer''', 'role_key=''unknown_staff_role''', 'role_key=''super_admin''',
    'role_key=''platform_admin''', 'role_key=''white_label_platform_admin''', 'role_key=NULL',
    'accepted_at=NULL', 'status=''disabled'',is_active=false'
  ] LOOP
    EXECUTE 'UPDATE public.company_memberships SET '||patch||' WHERE company_id=$1 AND user_id=$2' USING a,target;
    PERFORM pg_temp.expect_staff_assignee_denied(a,case_id,actor,target,client);
    UPDATE public.company_memberships SET role_key='customer_service_agent',accepted_at=now(),status='active',is_active=true WHERE company_id=a AND user_id=target;
  END LOOP;
  UPDATE public.user_profiles SET user_status='disabled' WHERE id=target;
  PERFORM pg_temp.expect_staff_assignee_denied(a,case_id,actor,target,client);
  UPDATE public.user_profiles SET user_status='active' WHERE id=target;
  UPDATE auth.users SET deleted_at=clock_timestamp() WHERE id=target;
  PERFORM pg_temp.expect_staff_assignee_denied(a,case_id,actor,target,client);
  UPDATE auth.users SET deleted_at=NULL,banned_until=clock_timestamp()+interval '1 hour' WHERE id=target;
  PERFORM pg_temp.expect_staff_assignee_denied(a,case_id,actor,target,client);
  UPDATE auth.users SET banned_until=clock_timestamp()-interval '1 second' WHERE id=target;
  PERFORM pg_temp.expect_staff_assignee_denied(a,case_id,actor,foreign_staff,client);
  IF EXISTS(SELECT FROM public.customer_case_events WHERE customer_case_id=case_id AND event_type='assigned')
    OR EXISTS(SELECT FROM public.audit_logs WHERE company_id=a AND entity_id=case_id::text AND action='customer_case_assignee_changed')
    OR (SELECT assigned_to FROM public.customer_cases WHERE id=case_id) IS NOT NULL
  THEN RAISE EXCEPTION 'staff_assignee_denial_wrote'; END IF;

  -- Staff type is the recognized base profile, not its effective permission set.
  INSERT INTO public.user_permissions(company_id,user_id,permission_key,effect,status,is_active)
  SELECT a,target,permission,'deny','active',true
  FROM unnest(public.gridex_staff_role_profile_v1('customer_service_agent')) permission;
  IF cardinality(public.gridex_staff_actor_permissions_v1(a,target,false))<>0 THEN RAISE EXCEPTION 'staff_assignee_zero_permissions_fixture_invalid'; END IF;
  result:=public.gridex_assign_customer_case(a,case_id,actor,target,client,'tenant_support_staff_api');
  IF result->>'assigned_to' IS DISTINCT FROM target::text
    OR (SELECT count(*) FROM public.customer_case_events WHERE customer_case_id=case_id AND event_type='assigned' AND created_by=actor
      AND payload->>'actor_user_id'=actor::text AND payload->>'api_client_id'=client::text AND payload->>'channel'='staff_api' AND payload->>'visibility'='internal')<>1
    OR (SELECT count(*) FROM public.audit_logs WHERE company_id=a AND entity_id=case_id::text AND action='customer_case_assignee_changed' AND actor_user_id=actor
      AND metadata->>'api_client_id'=client::text AND metadata->>'channel'='staff_api')<>1
  THEN RAISE EXCEPTION 'staff_assignee_valid_assignment_or_attribution_failed'; END IF;
  -- Null unassignment remains possible after the former assignee becomes invalid.
  UPDATE public.company_memberships SET role_key='customer' WHERE company_id=a AND user_id=target;
  result:=public.gridex_assign_customer_case(a,case_id,actor,NULL,client,NULL);
  IF result->'assigned_to' IS DISTINCT FROM 'null'::jsonb
    OR (SELECT count(*) FROM public.customer_case_events WHERE customer_case_id=case_id AND event_type='assigned')<>2
    OR (SELECT count(*) FROM public.audit_logs WHERE company_id=a AND entity_id=case_id::text AND action='customer_case_assignee_changed')<>2
  THEN RAISE EXCEPTION 'staff_assignee_null_unassignment_failed'; END IF;
  IF has_function_privilege('anon',rpc_oid,'EXECUTE') OR has_function_privilege('authenticated',rpc_oid,'EXECUTE')
    OR NOT has_function_privilege('service_role',rpc_oid,'EXECUTE')
    OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid=rpc_oid)
    OR NOT (SELECT has_table_privilege(proowner,'auth.users','SELECT') AND has_table_privilege(proowner,'auth.users','UPDATE') FROM pg_proc WHERE oid=rpc_oid)
  THEN RAISE EXCEPTION 'staff_assignee_rpc_owner_acl_invalid'; END IF;
  RAISE NOTICE 'staff case assignee eligibility native regression passed';
END$$;
ROLLBACK;
