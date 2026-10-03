-- Synthetic, rollback-only SQL behavior tests. The host runner restricts this
-- file to a newly created loopback test database; never run on production.
BEGIN;
CREATE FUNCTION pg_temp.staff_assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Staff SQL assertion failed: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.staff_expect(sql text, state text, message text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual_state text; actual_message text;
BEGIN
  BEGIN EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state=RETURNED_SQLSTATE,actual_message=MESSAGE_TEXT;
    IF actual_state<>state OR (message IS NOT NULL AND actual_message<>message) THEN
      RAISE EXCEPTION 'Expected %/%, got %/%',state,message,actual_state,actual_message;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Expected SQL denial %, statement succeeded',state;
END $$;
CREATE FUNCTION pg_temp.staff_fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='synthetic_atomic_failure'; END $$;

DO $$
DECLARE
  a uuid := '11111111-1111-4111-8111-111111111111';
  b uuid := '22222222-2222-4222-8222-222222222222';
  staff uuid := '33333333-3333-4333-8333-333333333333';
  other_staff uuid := '44444444-4444-4444-8444-444444444444';
  customer_user uuid := '55555555-5555-4555-8555-555555555555';
  client uuid := '66666666-6666-4666-8666-666666666666';
  other_client uuid := '77777777-7777-4777-8777-777777777777';
  native uuid := '88888888-8888-4888-8888-888888888888';
  sid uuid := '99999999-9999-4999-8999-999999999999';
  auth_sid uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  customer uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  foreign_customer uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  role_id uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  case_ref text; customer_ref text; foreign_ref text; result jsonb; replay jsonb;
  operation jsonb; lease uuid; command_sql text; count_before bigint; items bigint; step jsonb; tuple jsonb;
  digest text := repeat('a',64); cursor_count integer:=0; case_id uuid; attachment_ref text; previous_lease uuid;
  old_updated timestamptz; counts jsonb; policy_sid uuid; policy_hash text; auth_snapshot jsonb;
BEGIN
  -- Reachability is tested against the actual forward migration ACLs.
  PERFORM pg_temp.staff_assert(NOT has_table_privilege('authenticated','public.staff_api_sessions','SELECT'),'browser cannot read vault');
  PERFORM pg_temp.staff_assert(NOT has_table_privilege('anon','public.staff_api_support_receipts','SELECT'),'anonymous cannot read receipts');
  PERFORM pg_temp.staff_assert(NOT has_function_privilege('authenticated','public.staff_api_support_command(uuid,bigint,uuid,uuid,uuid,uuid,text,text,text,text,jsonb)','EXECUTE'),'browser cannot invoke commands');
  PERFORM pg_temp.staff_assert(NOT has_function_privilege('authenticated','public.staff_api_native_account_state(uuid,uuid)','EXECUTE'),'browser cannot inspect native Auth state');
  PERFORM pg_temp.staff_assert(NOT has_function_privilege('authenticated','public.staff_api_client_policy_allowed(uuid,uuid,text)','EXECUTE'),'browser cannot invoke private staff client policy');
  PERFORM pg_temp.staff_assert(NOT has_function_privilege('anon','public.staff_api_check_session_bootstrap()','EXECUTE'),'anonymous cannot invoke vault bootstrap trigger');
  PERFORM pg_temp.staff_assert((SELECT relrowsecurity FROM pg_class WHERE oid='public.staff_api_sessions'::regclass),'vault RLS enabled');
  PERFORM pg_temp.staff_assert((SELECT relrowsecurity FROM pg_class WHERE oid='public.staff_api_support_receipts'::regclass),'receipt RLS enabled');

  INSERT INTO public.companies(id,name,status) VALUES(a,'Synthetic staff company A','active'),(b,'Synthetic staff company B','active');
  INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(staff,'staff-a@example.invalid',now()),(other_staff,'staff-b@example.invalid',now()),(customer_user,'customer@example.invalid',now());
  INSERT INTO public.user_profiles(id,full_name,user_status) VALUES(staff,'Synthetic Staff A','active'),(other_staff,'Synthetic Staff B','active'),(customer_user,'Synthetic Customer','active');
  INSERT INTO public.roles(id,key,name,scope) VALUES(role_id,'support','Synthetic Support','company');
  INSERT INTO public.permissions(key,name) VALUES('cases.read','Synthetic case read'),('cases.write','Synthetic case write'),('customers.read','Synthetic customer read');
  INSERT INTO public.role_permissions(role_id,permission_id) SELECT role_id,p.id FROM public.permissions p WHERE p.key IN ('cases.read','cases.write','customers.read');
  INSERT INTO public.company_memberships(company_id,user_id,status,role_key) VALUES(a,staff,'active','support'),(b,other_staff,'active','support'),(a,customer_user,'active','customer');
  INSERT INTO public.user_roles(user_id,company_id,role_id,role) VALUES(staff,a,role_id,'support'),(other_staff,b,role_id,'support');
  INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,scopes,profile_key,metadata)
    VALUES(client,a,'Synthetic staff client','synthetic',repeat('0',64),ARRAY['staff_sessions.write','staff_context.read','staff_customers.read','staff_support.read','staff_support.write'],'custom','{"integration_kind":"staff_support_v1"}'),
      (other_client,b,'Synthetic other client','synthetic2',repeat('1',64),ARRAY['staff_support.write'],'custom','{"integration_kind":"staff_support_v1"}');
  INSERT INTO auth.sessions(id,user_id,not_after,aal) VALUES(native,staff,now()+interval '2 hours','aal1');
  INSERT INTO public.staff_api_sessions(id,user_id,company_id,api_client_id,native_session_id,encrypted_payload,refresh_hash,stage,native_aal,expires_at)
    VALUES(sid,staff,a,client,native,'synthetic_encrypted_payload',repeat('b',64),'authenticated','aal1',now()+interval '8 hours'),
      (auth_sid,staff,a,client,native,'synthetic_encrypted_payload',repeat('c',64),'authenticated','aal1',now()+interval '8 hours');
  INSERT INTO public.customers(id,company_id,status,full_name,customer_number) VALUES(customer,a,'active','Synthetic Customer A','SYN-A'),(foreign_customer,b,'active','Synthetic Customer B','SYN-B');
  customer_ref:=public.staff_api_public_reference('customer',a,customer);
  foreign_ref:=public.staff_api_public_reference('customer',b,foreign_customer);
  -- STAFF_FIXTURE_SEED_END
  PERFORM pg_temp.staff_assert((SELECT kind='tenant' FROM public.platform_table_classification WHERE table_name='staff_api_sessions'),'staff vault classified as company-bound');
  PERFORM pg_temp.staff_assert((SELECT count(*)=3 FROM public.platform_table_classification WHERE table_name IN ('staff_api_sessions','staff_api_session_operations','staff_api_auth_budgets')),'all private Auth tables explicitly classified');
  PERFORM pg_temp.staff_expect(format('UPDATE public.staff_api_sessions SET api_client_id=%L WHERE id=%L',other_client,sid),'23503');
  SET LOCAL ROLE service_role;
  command_sql:=format('SELECT public.staff_api_assert_command_actor(%L,1,%L,%L,%L,%L,''cases.write'')',sid,staff,native,client,a);
  EXECUTE command_sql;
  PERFORM pg_temp.staff_assert(NOT public.staff_api_is_tenant_staff(customer_user,a),'customer-only membership is not staff');
  PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_assert_command_actor(%L,1,%L,%L,%L,%L,''cases.write'')',sid,staff,native,other_client,b),'42501');

  result:=public.staff_api_support_command(sid,1,staff,native,client,a,'create','', 'synthetic-create-key-001',digest,
    jsonb_build_object('customer_reference',customer_ref,'title','Synthetic API case','priority','normal','description','Private initial description'));
  case_ref:=result->'data'->>'case_reference';
  PERFORM pg_temp.staff_assert(case_ref LIKE 'support_case_%','created canonical opaque case reference');
  replay:=public.staff_api_support_command(sid,1,staff,native,client,a,'create','', 'synthetic-create-key-001',digest,
    jsonb_build_object('customer_reference',customer_ref,'title','Synthetic API case','priority','normal','description','Private initial description'));
  PERFORM pg_temp.staff_assert(replay->'data'=result->'data' AND replay->>'replayed'='true','lost-response creation replay');
  PERFORM pg_temp.staff_assert((SELECT count(*)=1 FROM public.customer_cases WHERE company_id=a),'one business case after replay');
  PERFORM pg_temp.staff_assert((SELECT NOT billing_blocked AND NOT billing_manual_review AND NOT cancellation_required AND metadata->>'description_visibility'='internal' FROM public.customer_cases WHERE company_id=a),'support create does not block operations or disclose initial notes');
  PERFORM pg_temp.staff_assert((SELECT count(*)=1 FROM public.audit_logs WHERE company_id=a AND actor_user_id=staff AND action='staff_support_create'),'atomic verified-actor creation audit');
  PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_support_command(%L,1,%L,%L,%L,%L,''create'','''',''synthetic-create-key-001'',%L,%L::jsonb)',sid,staff,native,client,a,repeat('d',64),'{}'),'23505','idempotency_conflict');
  PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_read_resources(%L,''customer'',%L)',a,foreign_ref),'P0002','customer_not_found');
  PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_read_resources(%L,''case'',%L)',b,case_ref),'P0002','support_case_not_found');
  PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_support_command(%L,1,%L,%L,%L,%L,''create'','''',''synthetic-foreign-create'',%L,%L::jsonb)',sid,staff,native,client,a,digest,jsonb_build_object('customer_reference',foreign_ref,'title','Forbidden','priority','normal')),'P0002','customer_not_found');
  PERFORM pg_temp.staff_assert((SELECT count(*)=1 FROM public.staff_api_support_receipts WHERE company_id=a),'denied write rolled back receipt');

  result:=public.staff_api_support_command(sid,1,staff,native,client,a,'reply',case_ref,'synthetic-reply-key-001',digest,jsonb_build_object('message','Customer-visible synthetic reply','kind','message'));
  replay:=public.staff_api_support_command(sid,1,staff,native,client,a,'reply',case_ref,'synthetic-reply-key-001',digest,jsonb_build_object('message','Customer-visible synthetic reply','kind','message'));
  PERFORM pg_temp.staff_assert(result->'data'=replay->'data' AND result->'data'->>'visibility'='customer','reply replay and fixed customer visibility');
  result:=public.staff_api_support_command(sid,1,staff,native,client,a,'note',case_ref,'synthetic-note-key-001',digest,jsonb_build_object('message','Internal synthetic note'));
  PERFORM pg_temp.staff_assert(result->'data'->>'visibility'='internal','fixed internal note visibility');
  RESET ROLE;

  -- Functional reference indexes must preserve existing native client DML
  -- without granting browser EXECUTE on private staff RPCs.
  GRANT INSERT,UPDATE,SELECT ON public.customers,public.customer_sites,public.customer_cases TO authenticated;
  SET LOCAL ROLE authenticated;
  INSERT INTO public.customers(company_id,status,full_name,customer_number)
    VALUES(a,'active','Synthetic native index check','SYN-INDEX');
  UPDATE public.customers SET full_name='Synthetic native index update' WHERE customer_number='SYN-INDEX';
  INSERT INTO public.customer_sites(company_id,customer_id,site_name) VALUES(a,customer,'Synthetic native index check');
  UPDATE public.customer_sites SET site_name='Synthetic native index update' WHERE site_name='Synthetic native index check';
  INSERT INTO public.customer_cases(company_id,customer_id,case_type,title) VALUES(a,customer,'other','Synthetic native index check');
  UPDATE public.customer_cases SET title='Synthetic native index update' WHERE title='Synthetic native index check';
  RESET ROLE;
  DELETE FROM public.customers WHERE customer_number='SYN-INDEX';
  DELETE FROM public.customer_sites WHERE site_name='Synthetic native index update';
  DELETE FROM public.customer_cases WHERE title='Synthetic native index update';
  PERFORM pg_temp.staff_assert(NOT has_function_privilege('authenticated','public.staff_api_public_reference(text,uuid,uuid)','EXECUTE'),'native writes preserve private reference helper ACL');

  -- Index predicates are the same expressions used by the actual resource RPC.
  PERFORM set_config('enable_seqscan','off',true);
  EXECUTE format('EXPLAIN (FORMAT JSON) SELECT id FROM public.customers WHERE company_id=%L AND (''customer_'' || substr(translate(encode(extensions.digest(''gridex-public-reference:v1:'' || company_id::text || '':customer:'' || id::text,''sha256''),''base64''),''+/='',''-_''),1,32))=%L',a,customer_ref) INTO result;
  PERFORM pg_temp.staff_assert(result::text LIKE '%staff_api_customers_reference_idx%','opaque customer lookup uses indexed derivation');
  EXECUTE format('EXPLAIN (FORMAT JSON) SELECT id FROM public.customer_cases WHERE company_id=%L AND (''support_case_'' || substr(translate(encode(extensions.digest(''gridex-public-reference:v1:'' || company_id::text || '':support_case:'' || id::text,''sha256''),''base64''),''+/='',''-_''),1,32))=%L',a,case_ref) INTO result;
  PERFORM pg_temp.staff_assert(result::text LIKE '%staff_api_cases_reference_idx%','opaque case lookup uses indexed derivation');
  EXECUTE format('EXPLAIN (FORMAT JSON) SELECT id FROM public.customer_sites WHERE company_id=%L AND (''facility_'' || substr(translate(encode(extensions.digest(''gridex-public-reference:v1:'' || company_id::text || '':facility:'' || id::text,''sha256''),''base64''),''+/='',''-_''),1,32))=%L',a,'facility_syntheticlookup') INTO result;
  PERFORM pg_temp.staff_assert(result::text LIKE '%staff_api_facilities_reference_idx%','opaque facility lookup uses indexed derivation');
  PERFORM set_config('enable_seqscan','on',true);

  SELECT id,updated_at INTO case_id,old_updated FROM public.customer_cases WHERE company_id=a;
  SET LOCAL ROLE service_role;
  result:=public.staff_api_support_command(sid,1,staff,native,client,a,'assignment',case_ref,'synthetic-assignment-001',digest,
    jsonb_build_object('expected_updated_at',old_updated,'assignee_reference',public.staff_api_public_reference('staff',a,staff)));
  PERFORM pg_temp.staff_assert(result->'data'->>'assigned_to'=public.staff_api_public_reference('staff',a,staff),'same-company eligible assignee');
  PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_support_command(%L,1,%L,%L,%L,%L,''assignment'',%L,''synthetic-stale-assignment'',%L,%L::jsonb)',sid,staff,native,client,a,case_ref,digest,jsonb_build_object('expected_updated_at',old_updated,'assignee_reference',NULL)),'40001','support_case_version_conflict');
  SELECT updated_at INTO old_updated FROM public.customer_cases WHERE id=case_id;
  PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_support_command(%L,1,%L,%L,%L,%L,''assignment'',%L,''synthetic-foreign-assignee'',%L,%L::jsonb)',sid,staff,native,client,a,case_ref,digest,jsonb_build_object('expected_updated_at',old_updated,'assignee_reference',public.staff_api_public_reference('staff',b,other_staff))),'42501','support_assignee_ineligible');
  result:=public.staff_api_support_command(sid,1,staff,native,client,a,'status',case_ref,'synthetic-close-case-001',digest,jsonb_build_object('expected_updated_at',old_updated,'status','closed','message','Synthetic closure'));
  PERFORM pg_temp.staff_assert(result->'data'->>'status'='closed','native atomic status command');
  PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_support_command(%L,1,%L,%L,%L,%L,''reply'',%L,''synthetic-closed-reply'',%L,%L::jsonb)',sid,staff,native,client,a,case_ref,digest,jsonb_build_object('message','Cannot mutate closed case','kind','message')),'23514','support_case_closed');
  SELECT updated_at INTO old_updated FROM public.customer_cases WHERE id=case_id;
  result:=public.staff_api_support_command(sid,1,staff,native,client,a,'status',case_ref,'synthetic-reopen-case-001',digest,jsonb_build_object('expected_updated_at',old_updated,'status','open'));
  RESET ROLE;

  -- An event or audit fault must roll back business state and its receipt.
  SELECT jsonb_build_object('events',(SELECT count(*) FROM public.customer_case_events),'receipts',(SELECT count(*) FROM public.staff_api_support_receipts),'updated_at',updated_at)
    INTO counts FROM public.customer_cases WHERE id=case_id;
  CREATE TRIGGER synthetic_staff_audit_failure BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.staff_fail_insert();
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_support_command(%L,1,%L,%L,%L,%L,''note'',%L,''synthetic-audit-failure'',%L,%L::jsonb)',sid,staff,native,client,a,case_ref,digest,jsonb_build_object('message','Must roll back')),'P0001','synthetic_atomic_failure');
  RESET ROLE;
  DROP TRIGGER synthetic_staff_audit_failure ON public.audit_logs;
  PERFORM pg_temp.staff_assert((SELECT count(*) FROM public.customer_case_events)=(counts->>'events')::bigint AND (SELECT count(*) FROM public.staff_api_support_receipts)=(counts->>'receipts')::bigint AND (SELECT updated_at FROM public.customer_cases WHERE id=case_id)=(counts->>'updated_at')::timestamptz,'audit fault rolls back case, event and receipt');
  CREATE TRIGGER synthetic_staff_event_failure BEFORE INSERT ON public.customer_case_events FOR EACH ROW EXECUTE FUNCTION pg_temp.staff_fail_insert();
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_support_command(%L,1,%L,%L,%L,%L,''note'',%L,''synthetic-event-failure'',%L,%L::jsonb)',sid,staff,native,client,a,case_ref,digest,jsonb_build_object('message','Must also roll back')),'P0001','synthetic_atomic_failure');
  RESET ROLE;
  DROP TRIGGER synthetic_staff_event_failure ON public.customer_case_events;
  PERFORM pg_temp.staff_assert((SELECT count(*) FROM public.staff_api_support_receipts)=(counts->>'receipts')::bigint,'event fault rolls back receipt');

  -- A reservation survives a lost upload response. Recovery uses the same
  -- attachment/path and prevents an old lease from finalizing after recovery.
  SET LOCAL ROLE service_role;
  result:=public.staff_api_attachment_reserve(sid,1,staff,native,client,a,case_ref,'synthetic-upload-key-001',digest,'synthetic.pdf','application/pdf',100,digest,'internal');
  attachment_ref:=result->'row'->>'public_reference'; lease:=(result->>'lease_id')::uuid; previous_lease:=lease;
  PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_attachment_reserve(%L,1,%L,%L,%L,%L,%L,''synthetic-upload-key-001'',%L,''synthetic.pdf'',''application/pdf'',100,%L,''internal'')',sid,staff,native,client,a,case_ref,digest,digest),'55000','idempotency_in_progress');
  PERFORM public.staff_api_attachment_release(sid,1,staff,native,client,a,case_ref,'synthetic-upload-key-001',digest,attachment_ref,lease);
  result:=public.staff_api_attachment_reserve(sid,1,staff,native,client,a,case_ref,'synthetic-upload-key-001',digest,'synthetic.pdf','application/pdf',100,digest,'internal');
  lease:=(result->>'lease_id')::uuid;
  PERFORM pg_temp.staff_assert(result->'row'->>'public_reference'=attachment_ref AND lease<>previous_lease,'same original upload recovers stable reference with new lease');
  PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_attachment_finalize(%L,1,%L,%L,%L,%L,%L,''synthetic-upload-key-001'',%L,%L,%L,%L,100,''released'',''application/pdf'',NULL,''synthetic.pdf'')',sid,staff,native,client,a,case_ref,digest,attachment_ref,previous_lease,digest),'55000','idempotency_in_progress');
  result:=public.staff_api_attachment_finalize(sid,1,staff,native,client,a,case_ref,'synthetic-upload-key-001',digest,attachment_ref,lease,digest,100,'released','application/pdf',NULL,'synthetic.pdf');
  replay:=public.staff_api_attachment_finalize(sid,1,staff,native,client,a,case_ref,'synthetic-upload-key-001',digest,attachment_ref,lease,digest,100,'released','application/pdf',NULL,'synthetic.pdf');
  PERFORM pg_temp.staff_assert(result->'row'=replay->'row' AND replay->>'replayed'='true','final upload receipt replays without duplicate mutation');
  result:=public.staff_api_attachment_reserve(sid,1,staff,native,client,a,case_ref,'synthetic-upload-key-001',digest,'synthetic.pdf','application/pdf',100,digest,'internal');
  PERFORM pg_temp.staff_assert(result->>'state'='replay','completed reservation replays');
  RESET ROLE;

  -- Revocation also denies replay of an already committed protected receipt.
  UPDATE public.company_memberships SET status='revoked' WHERE company_id=a AND user_id=staff;
  PERFORM pg_temp.staff_expect(command_sql,'42501');
  PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_support_command(%L,1,%L,%L,%L,%L,''reply'',%L,''synthetic-reply-key-001'',%L,%L::jsonb)',sid,staff,native,client,a,case_ref,digest,jsonb_build_object('message','Customer-visible synthetic reply','kind','message')),'42501');
  UPDATE public.company_memberships SET status='active' WHERE company_id=a AND user_id=staff;
  -- Native machine-profile revocation must deny both a fresh command and
  -- replay of an already committed receipt, not only the next HTTP guard.
  SELECT jsonb_build_object('events',(SELECT count(*) FROM public.customer_case_events),
    'receipts',(SELECT count(*) FROM public.staff_api_support_receipts),
    'audits',(SELECT count(*) FROM public.audit_logs),'updated_at',updated_at)
    INTO counts FROM public.customer_cases WHERE id=case_id;
  UPDATE public.integration_api_clients SET metadata='{"integration_kind":"customer_portal"}' WHERE id=client;
  PERFORM pg_temp.staff_expect(command_sql,'42501','Staff command is not authorized');
  PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_support_command(%L,1,%L,%L,%L,%L,''note'',%L,''synthetic-kind-revoked-new'',%L,%L::jsonb)',sid,staff,native,client,a,case_ref,digest,jsonb_build_object('message','Must not persist')),'42501','Staff command is not authorized');
  PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_support_command(%L,1,%L,%L,%L,%L,''reply'',%L,''synthetic-reply-key-001'',%L,%L::jsonb)',sid,staff,native,client,a,case_ref,digest,jsonb_build_object('message','Customer-visible synthetic reply','kind','message')),'42501','Staff command is not authorized');
  UPDATE public.integration_api_clients SET metadata='{"integration_kind":"staff_support_v1"}',profile_key='tenant_website' WHERE id=client;
  PERFORM pg_temp.staff_expect(command_sql,'42501','Staff command is not authorized');
  PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_support_command(%L,1,%L,%L,%L,%L,''note'',%L,''synthetic-profile-revoked-new'',%L,%L::jsonb)',sid,staff,native,client,a,case_ref,digest,jsonb_build_object('message','Must not persist')),'42501','Staff command is not authorized');
  PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_support_command(%L,1,%L,%L,%L,%L,''reply'',%L,''synthetic-reply-key-001'',%L,%L::jsonb)',sid,staff,native,client,a,case_ref,digest,jsonb_build_object('message','Customer-visible synthetic reply','kind','message')),'42501','Staff command is not authorized');
  UPDATE public.integration_api_clients SET profile_key='custom' WHERE id=client;
  PERFORM pg_temp.staff_assert((SELECT count(*) FROM public.customer_case_events)=(counts->>'events')::bigint
    AND (SELECT count(*) FROM public.staff_api_support_receipts)=(counts->>'receipts')::bigint
    AND (SELECT count(*) FROM public.audit_logs)=(counts->>'audits')::bigint
    AND (SELECT updated_at FROM public.customer_cases WHERE id=case_id)=(counts->>'updated_at')::timestamptz,
    'dedicated profile/kind revocation leaves no fresh mutation, audit or receipt and denies exact replay');
  -- An independent active read grant must not keep write privileges contributed
  -- by an individually expired role. Native single-active-tenant-role uniqueness
  -- remains intact. expires_at is a verified live OPS column.
  INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect)
    SELECT staff,a,id,key,'allow' FROM public.permissions WHERE key='cases.read';
  UPDATE public.user_roles SET expires_at=now()-interval '1 second' WHERE user_id=staff AND public.user_roles.role_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid;
  PERFORM pg_temp.staff_assert(NOT public.staff_api_is_tenant_staff(staff,a),'expired only tenant role cannot keep staff identity');
  PERFORM pg_temp.staff_assert('cases.read'=ANY(public.staff_api_current_permissions(staff,a)) AND NOT 'cases.write'=ANY(public.staff_api_current_permissions(staff,a)),'expired individual write grant is excluded');
  PERFORM pg_temp.staff_expect(command_sql,'42501');
  UPDATE public.user_roles SET expires_at=NULL WHERE user_id=staff AND public.user_roles.role_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid;
  UPDATE public.permissions SET is_active=false WHERE key='cases.write';
  PERFORM pg_temp.staff_expect(command_sql,'42501');
  PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_support_command(%L,1,%L,%L,%L,%L,''reply'',%L,''synthetic-reply-key-001'',%L,%L::jsonb)',sid,staff,native,client,a,case_ref,digest,jsonb_build_object('message','Customer-visible synthetic reply','kind','message')),'42501');
  UPDATE public.permissions SET is_active=true WHERE key='cases.write';
  UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id=native;
  PERFORM pg_temp.staff_expect(command_sql,'42501');
  UPDATE auth.sessions SET not_after=now()+interval '2 hours' WHERE id=native;
  UPDATE public.user_profiles SET must_change_password=true WHERE id=staff;
  PERFORM pg_temp.staff_expect(command_sql,'42501');
  UPDATE public.user_profiles SET must_change_password=false WHERE id=staff;
  UPDATE public.companies SET is_active=false WHERE id=a;
  PERFORM pg_temp.staff_expect(command_sql,'42501');
  UPDATE public.companies SET is_active=true WHERE id=a;

  -- Whole-row native self-update cannot disable the server password policy.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',staff)::text,true);
  GRANT SELECT,UPDATE ON public.user_profiles TO authenticated;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.staff_expect(format('UPDATE public.user_profiles SET must_change_password=true WHERE id=%L',staff),'42501','Account authentication policy is server managed');
  UPDATE public.user_profiles SET full_name='Allowed synthetic display-name update' WHERE id=staff;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims','{}',true);

  -- Serial native Auth operation lifecycle: pending denies data, a completed
  -- exact receipt replays, changed input conflicts, logout defeats old CAS.
  operation:=public.staff_api_acquire_session_operation(auth_sid,client,a,'synthetic-refresh-operation','refresh',digest,1,repeat('c',64));
  PERFORM pg_temp.staff_assert(operation->>'state'='acquired','refresh lease acquired');
  lease:=(operation->>'lease_id')::uuid;
  PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_assert_command_actor(%L,1,%L,%L,%L,%L,''cases.write'')',auth_sid,staff,native,client,a),'55P03','staff_session_busy');
  operation:=public.staff_api_acquire_session_operation(auth_sid,client,a,'synthetic-refresh-operation','refresh',repeat('d',64),1,repeat('c',64));
  PERFORM pg_temp.staff_assert(operation->>'state'='conflict','changed refresh input conflicts');
  PERFORM pg_temp.staff_assert(public.staff_api_complete_session_operation(auth_sid,lease,'new_synthetic_ciphertext',native,'authenticated','aal1',repeat('e',64),'synthetic_encrypted_receipt',true)=2,'one advanced refresh revision');
  operation:=public.staff_api_acquire_session_operation(auth_sid,client,a,'synthetic-refresh-operation','refresh',digest,1,repeat('c',64));
  PERFORM pg_temp.staff_assert(operation->>'state'='replay','exact completed refresh receipt replays');
  -- A completed Auth receipt cannot be retrieved after profile/kind revocation;
  -- no new native-consuming lease or vault bootstrap may be admitted either.
  SELECT to_jsonb(x) INTO auth_snapshot FROM public.staff_api_sessions x WHERE id=auth_sid;
  FOR step IN SELECT value FROM jsonb_array_elements('[{"profile":"tenant_website","kind":"staff_support_v1"},{"profile":"custom","kind":"customer_portal"}]'::jsonb) LOOP
    UPDATE public.integration_api_clients SET profile_key=step->>'profile',metadata=jsonb_build_object('integration_kind',step->>'kind') WHERE id=client;
    PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_acquire_session_operation(%L,%L,%L,''synthetic-refresh-operation'',''refresh'',%L,1,%L)',auth_sid,client,a,digest,repeat('c',64)),'42501','Staff integration client is not authorized');
    PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_acquire_session_operation(%L,%L,%L,''synthetic-policy-new-password'',''password'',%L,2,NULL)',auth_sid,client,a,digest),'42501','Staff integration client is not authorized');
    PERFORM pg_temp.staff_expect(format('INSERT INTO public.staff_api_sessions(id,user_id,company_id,api_client_id,native_session_id,encrypted_payload,refresh_hash,stage,native_aal,expires_at) VALUES(%L,%L,%L,%L,%L,''must_not_store'',%L,''authenticated'',''aal1'',clock_timestamp()+interval ''8 hours'')','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',staff,a,client,native,repeat('9',64)),'42501','Staff integration client is not authorized');
    PERFORM pg_temp.staff_assert((SELECT to_jsonb(x)=auth_snapshot FROM public.staff_api_sessions x WHERE id=auth_sid),'revoked Auth acquire/replay leaves stored credentials and lease unchanged');
    PERFORM pg_temp.staff_assert(NOT EXISTS(SELECT 1 FROM public.staff_api_session_operations WHERE session_id=auth_sid AND operation_key='synthetic-policy-new-password'),'revoked Auth acquire creates no pending operation');
    PERFORM pg_temp.staff_assert(NOT EXISTS(SELECT 1 FROM public.staff_api_sessions WHERE id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),'revoked bootstrap creates no vault');
    UPDATE public.integration_api_clients SET profile_key='custom',metadata=jsonb_build_object('integration_kind','staff_support_v1') WHERE id=client;
  END LOOP;
  -- The explicit Auth scope is independently required even on an existing
  -- authenticated vault; a support-only machine row cannot mutate credentials.
  UPDATE public.integration_api_clients SET scopes=ARRAY['staff_support.write'] WHERE id=client;
  PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_acquire_session_operation(%L,%L,%L,''synthetic-policy-no-session-scope'',''refresh'',%L,2,NULL)',auth_sid,client,a,digest),'42501','Staff integration client is not authorized');
  UPDATE public.integration_api_clients SET scopes=ARRAY['staff_sessions.write','staff_context.read','staff_customers.read','staff_support.read','staff_support.write'] WHERE id=client;
  UPDATE public.companies SET is_active=false WHERE id=a;
  PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_acquire_session_operation(%L,%L,%L,''synthetic-policy-inactive-company'',''password'',%L,2,NULL)',auth_sid,client,a,digest),'42501','Staff integration client is not authorized');
  UPDATE public.companies SET is_active=true WHERE id=a;

  -- Native Auth may have consumed credentials before current machine policy
  -- changes. Finalization must COMMIT a durable block, preserve old credentials,
  -- and withhold its receipt. A SQL exception here would undo the block.
  FOR step IN SELECT value FROM jsonb_array_elements('[{"profile":"tenant_website","kind":"staff_support_v1"},{"profile":"custom","kind":"customer_portal"}]'::jsonb) LOOP
    policy_sid:=gen_random_uuid(); policy_hash:=md5(policy_sid::text)||md5(policy_sid::text);
    INSERT INTO public.staff_api_sessions(id,user_id,company_id,api_client_id,native_session_id,encrypted_payload,refresh_hash,stage,native_aal,expires_at)
      VALUES(policy_sid,staff,a,client,native,'old_synthetic_credentials',policy_hash,'authenticated','aal1',clock_timestamp()+interval '8 hours');
    operation:=public.staff_api_acquire_session_operation(policy_sid,client,a,'synthetic-policy-pending-password','password',digest,1,NULL);
    PERFORM pg_temp.staff_assert(operation->>'state'='acquired','current policy admits a native-consuming password lease');
    lease:=(operation->>'lease_id')::uuid;
    UPDATE public.integration_api_clients SET profile_key=step->>'profile',metadata=jsonb_build_object('integration_kind',step->>'kind') WHERE id=client;
    PERFORM pg_temp.staff_assert(public.staff_api_complete_session_operation(policy_sid,lease,'must_not_store_new_credentials',native,'authenticated','aal1',repeat('8',64),'must_not_store_receipt',true)=0,'revoked Auth completion commits blocked sentinel');
    PERFORM pg_temp.staff_assert((SELECT status='blocked' AND revision=1 AND lease_id IS NULL AND lease_expires_at IS NULL AND encrypted_payload='old_synthetic_credentials' AND refresh_hash=policy_hash FROM public.staff_api_sessions WHERE id=policy_sid),'revoked complete durably blocks without rotating/storing native credentials');
    PERFORM pg_temp.staff_assert((SELECT status='blocked' AND encrypted_receipt IS NULL AND completed_revision IS NULL FROM public.staff_api_session_operations WHERE session_id=policy_sid AND operation_key='synthetic-policy-pending-password'),'revoked complete stores no successful Auth receipt');
    UPDATE public.integration_api_clients SET profile_key='custom',metadata=jsonb_build_object('integration_kind','staff_support_v1') WHERE id=client;
    operation:=public.staff_api_acquire_session_operation(policy_sid,client,a,'synthetic-policy-after-restore','refresh',digest,1,NULL);
    PERFORM pg_temp.staff_assert(operation->>'state'='invalid','restoring machine policy does not reactivate blocked credentials');
  END LOOP;

  -- Preserve a read already admitted by the HTTP boundary and allow logout to
  -- remove authority after a policy change; neither mints a new Auth revision.
  policy_sid:=gen_random_uuid(); policy_hash:=md5(policy_sid::text)||md5(policy_sid::text);
  INSERT INTO public.staff_api_sessions(id,user_id,company_id,api_client_id,native_session_id,encrypted_payload,refresh_hash,stage,native_aal,expires_at)
    VALUES(policy_sid,staff,a,client,native,'old_read_credentials',policy_hash,'authenticated','aal1',clock_timestamp()+interval '8 hours');
  operation:=public.staff_api_acquire_session_operation(policy_sid,client,a,'synthetic-policy-inflight-read','validate',digest,1,NULL);
  lease:=(operation->>'lease_id')::uuid;
  UPDATE public.integration_api_clients SET metadata=jsonb_build_object('integration_kind','customer_portal') WHERE id=client;
  PERFORM pg_temp.staff_assert(public.staff_api_complete_session_operation(policy_sid,lease,'validated_read_credentials',native,'authenticated','aal1',NULL,NULL,false)=1,'an admitted validate read can finish without minting a new revision');
  operation:=public.staff_api_logout_session(policy_sid,client,a,'synthetic-policy-authority-reduction',digest,'synthetic_logout_receipt');
  PERFORM pg_temp.staff_assert(operation->>'state'='revoked' AND (SELECT status='revoked' FROM public.staff_api_sessions WHERE id=policy_sid),'logout still removes authority after machine policy revocation');
  UPDATE public.integration_api_clients SET metadata=jsonb_build_object('integration_kind','staff_support_v1') WHERE id=client;

  operation:=public.staff_api_acquire_session_operation(auth_sid,client,a,'synthetic-validate-operation','validate',digest,2,NULL);
  lease:=(operation->>'lease_id')::uuid;
  PERFORM public.staff_api_logout_session(auth_sid,client,a,'synthetic-logout-operation',digest,'synthetic_logout_receipt');
  PERFORM pg_temp.staff_expect(format('SELECT public.staff_api_complete_session_operation(%L,%L,''impossible_synthetic_ciphertext'',%L,''authenticated'',''aal1'',NULL,NULL,false)',auth_sid,lease,native),'42501','Session operation no longer authorized');
  PERFORM pg_temp.staff_assert((SELECT status='revoked' FROM public.staff_api_sessions WHERE id=auth_sid),'logout wins over pending finalization');

  -- More than the historic capped list sizes, including tied timestamps.
  INSERT INTO public.customers(company_id,status,full_name,customer_number,created_at)
    SELECT a,'active','Synthetic pagination '||g,'SYN-P-'||g,'2026-01-01T00:00:00Z' FROM generate_series(1,1107) g;
  tuple:=NULL;
  LOOP
    step:=public.staff_api_read_resources(a,'customers',NULL,'{}',tuple,101);
    items:=jsonb_array_length(step->'rows');
    cursor_count:=cursor_count+least(items,100)::integer;
    EXIT WHEN items<=100;
    tuple:=jsonb_build_object('created_at',step->'rows'->99->>'created_at','id',step->'rows'->99->>'id');
  END LOOP;
  PERFORM pg_temp.staff_assert(cursor_count=1108,'complete customer DB keyset traversal beyond 1000 rows');
  step:=public.staff_api_read_resources(b,'customers',NULL,'{}',NULL,101);
  PERFORM pg_temp.staff_assert(jsonb_array_length(step->'rows')=1,'pagination stays in selected tenant');

  INSERT INTO public.customer_cases(company_id,customer_id,case_type,status,priority,title,source,metadata,created_at)
    SELECT a,customer,'other','open','normal','Synthetic case pagination '||g,
      CASE WHEN g%2=0 THEN 'tenant_support_admin' ELSE 'operations' END,
      jsonb_build_object('support_case',g%2=0),'2026-01-01T00:00:00Z' FROM generate_series(1,620) g;
  tuple:=NULL; cursor_count:=0;
  LOOP
    step:=public.staff_api_read_resources(a,'cases',NULL,'{}',tuple,101); items:=jsonb_array_length(step->'rows');
    cursor_count:=cursor_count+least(items,100)::integer; EXIT WHEN items<=100;
    tuple:=jsonb_build_object('created_at',step->'rows'->99->>'created_at','id',step->'rows'->99->>'id');
  END LOOP;
  PERFORM pg_temp.staff_assert(cursor_count=311,'complete support-only keyset traversal beyond 200 mixed native cases');
  SELECT count(*) INTO count_before FROM public.customer_case_events WHERE customer_case_id=case_id;
  INSERT INTO public.customer_case_events(company_id,customer_id,customer_case_id,event_type,event_status,message,payload,created_by,created_at)
    SELECT a,customer,case_id,'support_internal_note','info','Synthetic entry '||g,'{"visibility":"internal"}',staff,'2026-01-01T00:00:00Z' FROM generate_series(1,607) g;
  tuple:=NULL; cursor_count:=0;
  LOOP
    step:=public.staff_api_read_resources(a,'entries',case_ref,'{}',tuple,101); items:=jsonb_array_length(step->'rows');
    cursor_count:=cursor_count+least(items,100)::integer; EXIT WHEN items<=100;
    tuple:=jsonb_build_object('created_at',step->'rows'->99->>'created_at','id',step->'rows'->99->>'id');
  END LOOP;
  PERFORM pg_temp.staff_assert(cursor_count=607+count_before,'complete entry DB keyset traversal beyond 500 entries');

  -- The quota is shared by every insert path, not just the new staff route.
  INSERT INTO public.customer_case_attachments(company_id,customer_id,customer_case_id,public_reference,file_name,declared_mime_type,byte_size,sha256,storage_path,visibility,uploaded_by_kind,scan_status)
    SELECT a,customer,case_id,'support_attachment_'||replace(gen_random_uuid()::text,'-',''),'synthetic-'||g||'.pdf','application/pdf',100,digest,'synthetic/'||g,'internal','staff','quarantined' FROM generate_series(1,19) g;
  PERFORM pg_temp.staff_expect(format('INSERT INTO public.customer_case_attachments(company_id,customer_id,customer_case_id,public_reference,file_name,declared_mime_type,byte_size,sha256,storage_path,visibility,uploaded_by_kind,scan_status) VALUES(%L,%L,%L,''support_attachment_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'',''quota.pdf'',''application/pdf'',100,%L,''synthetic/quota'',''internal'',''staff'',''quarantined'')',a,customer,case_id,digest),'P0001','attachment_quota_exceeded');
  PERFORM pg_temp.staff_assert((SELECT count(*)=20 FROM public.customer_case_attachments WHERE company_id=a AND customer_id=customer),'shared rolling attachment quota denies twenty-first insert');
END $$;
ROLLBACK;
