\set ON_ERROR_STOP on
-- Real disposable schema only. Synthetic rows and fault injection roll back.
begin;
select gen_random_uuid() as company_a,gen_random_uuid() as company_b,
  gen_random_uuid() as staff_a,gen_random_uuid() as portal_a,gen_random_uuid() as reader_a,
  gen_random_uuid() as session_a,gen_random_uuid() as session_portal,gen_random_uuid() as session_reader,
  gen_random_uuid() as customer_a,gen_random_uuid() as customer_other,gen_random_uuid() as customer_b,
  gen_random_uuid() as client_a,gen_random_uuid() as site_a,gen_random_uuid() as site_other,
  gen_random_uuid() as point_a,gen_random_uuid() as point_other \gset
insert into public.companies(id,name,status) values
  (:'company_a','Synthetic support A','active'),(:'company_b','Synthetic support B','active');
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
select u,'authenticated','authenticated',u::text||'@example.invalid',now(),'{}','{}',now(),now(),false,false
from unnest(array[:'staff_a'::uuid,:'portal_a'::uuid,:'reader_a'::uuid]) u;
insert into auth.sessions(id,user_id,created_at,updated_at) values
  (:'session_a',:'staff_a',now(),now()),(:'session_portal',:'portal_a',now(),now()),(:'session_reader',:'reader_a',now(),now());
insert into public.user_profiles(id,email,full_name,user_status)
select u,u::text||'@example.invalid','Synthetic support actor','active'
from unnest(array[:'staff_a'::uuid,:'portal_a'::uuid,:'reader_a'::uuid]) u;
insert into public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key)
values(:'company_a',:'staff_a','company_admin','active',now(),'company_admin',true,now(),'company_admin'),
  (:'company_a',:'reader_a','viewer','active',now(),'viewer',true,now(),'finance_readonly');
insert into public.permissions(key,name) values('cases.write','Synthetic support write'),('cases.read','Synthetic support read') on conflict(key) do nothing;
insert into public.user_permissions(user_id,company_id,permission_id,permission_key)
select :'staff_a',:'company_a',id,key from public.permissions where key in ('cases.read','cases.write');
insert into public.user_permissions(user_id,company_id,permission_id,permission_key)
select :'reader_a',:'company_a',id,key from public.permissions where key='cases.read';
insert into public.customers(id,company_id,customer_number,name,customer_type,first_name,last_name,email,phone) values
  (:'customer_a',:'company_a',:'customer_a','Synthetic support customer A','private','Synthetic','A','support-a@example.invalid','+4600000000'),
  (:'customer_other',:'company_a',:'customer_other','Synthetic support other','private','Synthetic','Other','support-other@example.invalid','+4600000001'),
  (:'customer_b',:'company_b',:'customer_b','Synthetic support B','private','Synthetic','B','support-b@example.invalid','+4600000002');
insert into public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,status,scopes)
values(:'client_a',:'company_a','Synthetic support API','p4native-'||left(:'client_a',8),repeat('a',64),'active',array['customer_cases.read','customer_cases.write']);
insert into public.customer_sites(id,company_id,customer_id,site_name) values
  (:'site_a',:'company_a',:'customer_a','Synthetic support site'),(:'site_other',:'company_a',:'customer_other','Synthetic other support site');
insert into public.metering_points(id,company_id,customer_id,site_id,customer_site_id,metering_point_id) values
  (:'point_a',:'company_a',:'customer_a',:'site_a',:'site_a',:'point_a'),
  (:'point_other',:'company_a',:'customer_other',:'site_other',:'site_other',:'point_other');
insert into public.customer_portal_accounts(company_id,customer_id,user_id,portal_user_id,status,is_active,role,email)
values(:'company_a',:'customer_a',:'portal_a',:'portal_a','active',true,'owner',:'portal_a'||'@example.invalid');
select set_config('gridex.support.company_a',:'company_a',true),set_config('gridex.support.company_b',:'company_b',true),
  set_config('gridex.support.staff',:'staff_a',true),set_config('gridex.support.portal',:'portal_a',true),set_config('gridex.support.reader',:'reader_a',true),
  set_config('gridex.support.session',:'session_a',true),set_config('gridex.support.session_portal',:'session_portal',true),set_config('gridex.support.session_reader',:'session_reader',true),
  set_config('gridex.support.customer',:'customer_a',true),set_config('gridex.support.other',:'customer_other',true),set_config('gridex.support.client',:'client_a',true);
select set_config('gridex.support.site',:'site_a',true),set_config('gridex.support.site_other',:'site_other',true),
  set_config('gridex.support.point',:'point_a',true),set_config('gridex.support.point_other',:'point_other',true);
set local role service_role;
do $test$
declare
  ca uuid:=current_setting('gridex.support.company_a')::uuid;
  cu uuid:=current_setting('gridex.support.customer')::uuid;
  command jsonb; result jsonb; replay jsonb; context jsonb; row_id uuid; reference text; failed boolean;
begin
  command:=jsonb_build_object('companyId',ca,'customerId',cu,'mode','api','channel','api','actorUserId',null,'sessionId',null,
    'clientId',current_setting('gridex.support.client'),'subject',current_setting('gridex.support.portal'),
    'operation','create','caseId',null,'expectedRevision',0,'idempotencyKey','support-native-create','payload',jsonb_build_object('title','Customer authored title','body','Customer authored message'));
  result:=public.gridex_support_case_command_v1(command);
  row_id:=(result->>'caseId')::uuid;
  perform set_config('gridex.support.case',row_id::text,true);
  perform set_config('gridex.support.command',command::text,true);
  reference:=(select public_reference from public.customer_support_threads where id=row_id and company_id=ca);
  context:=command-'channel'-'operation'-'caseId'-'expectedRevision'-'idempotencyKey'-'payload';
  if result->>'revision'<>'1' or result->>'status'<>'open' or
    (select description from public.customer_cases where id=row_id) is not null or
    (select count(*) from public.customer_support_messages where customer_case_id=row_id and visibility='customer')<>1 or
    (select count(*) from public.canonical_event_outbox where company_id=ca and topic='customer.support.changed')<>1 then raise exception 'support_native_atomic_create_failed'; end if;
  replay:=public.gridex_support_case_command_v1(command);
  if replay->>'replayed'<>'true' or replay->>'caseId'<>result->>'caseId' or
    (select count(*) from public.customer_cases where company_id=ca)<>1 then raise exception 'support_native_replay_failed'; end if;
  failed:=false;
  begin perform public.gridex_support_case_command_v1(jsonb_set(command,'{payload,body}','"Changed body"')); exception when unique_violation then failed:=sqlerrm='support_idempotency_conflict'; end;
  if not failed then raise exception 'support_native_payload_conflict_missing'; end if;
  if public.gridex_support_case_read_v1(context,jsonb_build_object('reference',reference,'limit',25))->'items'->0->>'body'<>'Customer authored message' then raise exception 'support_native_public_read_failed'; end if;
exception when others then raise;
end
$test$;
-- Legacy metadata keys do not establish whether the previous split write
-- completed. Preserve its history and require review after current authority.
do $test$
declare
  ca uuid:=current_setting('gridex.support.company_a')::uuid; cu uuid:=current_setting('gridex.support.customer')::uuid;
  command jsonb:=(current_setting('gridex.support.command')::jsonb)||jsonb_build_object('idempotencyKey','support-native-legacy-key');
  old_id uuid; before_row jsonb; failed boolean; context jsonb;
  before_cases bigint; before_messages bigint; before_results bigint; before_audit bigint; before_intents bigint;
begin
  insert into public.customer_cases(company_id,customer_id,case_type,status,priority,title,description,source,metadata)
  values(ca,cu,'other','open','normal','LEGACY INTERNAL TITLE','LEGACY INTERNAL BODY','tenant_support_api',
    jsonb_build_object('support_case',true,'support_idempotency_key','support-native-legacy-key')) returning id into old_id;
  insert into public.customer_support_threads(id,company_id,customer_id,public_reference)
  values(old_id,ca,cu,'case_'||substr(translate(rtrim(encode(extensions.digest(convert_to('gridex-public-reference:v1:'||ca::text||':case:'||old_id::text,'UTF8'),'sha256'),'base64'),'='),'+/','-_'),1,32));
  select to_jsonb(c) into before_row from public.customer_cases c where c.id=old_id;
  select count(*) into before_cases from public.customer_cases where company_id=ca;
  select count(*) into before_messages from public.customer_support_messages where company_id=ca;
  select count(*) into before_results from public.canonical_command_results where company_id=ca;
  select count(*) into before_audit from public.canonical_audit_events where company_id=ca;
  select count(*) into before_intents from public.canonical_event_outbox where company_id=ca;
  failed:=false;
  begin perform public.gridex_support_case_command_v1(command||jsonb_build_object('mode','ops','channel','ops','clientId',null,'subject',null,
    'actorUserId',current_setting('gridex.support.reader'),'sessionId',current_setting('gridex.support.session_reader')));
  exception when insufficient_privilege then failed:=sqlerrm='support_actor_forbidden'; end;
  if not failed then raise exception 'support_native_legacy_authorization_not_first'; end if;
  failed:=false;
  begin perform public.gridex_support_case_command_v1(command);
  exception when unique_violation then failed:=sqlerrm='support_legacy_idempotency_requires_review'; end;
  if not failed then raise exception 'support_native_legacy_key_unsafe_retry'; end if;
  if (select to_jsonb(c) from public.customer_cases c where c.id=old_id) is distinct from before_row or
    (select count(*) from public.customer_cases where company_id=ca)<>before_cases or
    (select count(*) from public.customer_support_messages where company_id=ca)<>before_messages or
    (select count(*) from public.canonical_command_results where company_id=ca)<>before_results or
    (select count(*) from public.canonical_audit_events where company_id=ca)<>before_audit or
    (select count(*) from public.canonical_event_outbox where company_id=ca)<>before_intents then
    raise exception 'support_native_legacy_conflict_had_side_effects'; end if;
  context:=command-'channel'-'operation'-'caseId'-'expectedRevision'-'idempotencyKey'-'payload';
  if public.gridex_support_case_read_v1(context,'{}')::text like '%LEGACY INTERNAL%' then raise exception 'support_native_legacy_internal_text_published'; end if;
end $test$;
-- The other customer has no account, so a read must fail before data retrieval.
-- Explicitly prove staff notes remain absent from customer projections.
do $test$
declare
  ca uuid:=current_setting('gridex.support.company_a')::uuid; cu uuid:=current_setting('gridex.support.customer')::uuid;
  cid uuid:=current_setting('gridex.support.case')::uuid;
  command jsonb; result jsonb; api_context jsonb; read_result jsonb; failed boolean;
begin
  command:=jsonb_build_object('companyId',ca,'customerId',cu,'mode','ops','channel','ops',
    'actorUserId',current_setting('gridex.support.staff'),'sessionId',current_setting('gridex.support.session'),'clientId',null,'subject',null,
    'operation','internal_note','caseId',cid,'expectedRevision',1,'idempotencyKey','support-native-private-note','payload',jsonb_build_object('body','INTERNAL SECRET STAFF TEXT'));
  result:=public.gridex_support_case_command_v1(command);
  if result->>'revision'<>'2' or (select actor_user_id::text from public.customer_support_messages where customer_case_id=cid and visibility='internal')<>current_setting('gridex.support.staff') then raise exception 'support_native_staff_attribution_failed'; end if;
  api_context:=(current_setting('gridex.support.command')::jsonb)-'channel'-'operation'-'caseId'-'expectedRevision'-'idempotencyKey'-'payload';
  read_result:=public.gridex_support_case_read_v1(api_context,jsonb_build_object('reference',(select public_reference from public.customer_support_threads where id=cid),'limit',25));
  if read_result::text like '%INTERNAL SECRET%' or jsonb_array_length(read_result->'items')<>1 then raise exception 'support_native_private_note_leaked'; end if;
  failed:=false;
  begin perform public.gridex_support_case_read_v1(api_context||jsonb_build_object('customerId',current_setting('gridex.support.other')),'{}'); exception when insufficient_privilege then failed:=sqlerrm='support_actor_forbidden'; end;
  if not failed then raise exception 'support_native_other_customer_not_denied'; end if;
  failed:=false;
  begin perform public.gridex_support_case_read_v1(api_context||jsonb_build_object('companyId',current_setting('gridex.support.company_b')),'{}'); exception when insufficient_privilege then failed:=sqlerrm='support_actor_forbidden'; end;
  if not failed then raise exception 'support_native_other_tenant_not_denied'; end if;
  failed:=false;
  begin perform public.gridex_support_case_command_v1(command||jsonb_build_object('actorUserId',current_setting('gridex.support.reader'),'sessionId',current_setting('gridex.support.session_reader'),'idempotencyKey','support-native-reader')); exception when insufficient_privilege then failed:=sqlerrm='support_actor_forbidden'; end;
  if not failed then raise exception 'support_native_readonly_write_not_denied'; end if;
  failed:=false;
  begin perform public.gridex_support_case_command_v1(command||jsonb_build_object('idempotencyKey','support-native-stale-revision')); exception when sqlstate 'PT409' then failed:=sqlerrm='support_revision_conflict'; end;
  if not failed then raise exception 'support_native_stale_revision_not_denied'; end if;
end
$test$;
-- Completed customer messages depend on the current customer-facing resource
-- policy. Revoking an OPS-authored publication blocks replay as well as reads.
do $test$
declare
  ca uuid:=current_setting('gridex.support.company_a')::uuid; cu uuid:=current_setting('gridex.support.customer')::uuid;
  ops_command jsonb; command jsonb; result jsonb; cid uuid; reference text; failed boolean;
  before_revision bigint; before_messages bigint; before_results bigint; before_audit bigint; before_intents bigint;
begin
  ops_command:=jsonb_build_object('companyId',ca,'customerId',cu,'mode','ops','channel','ops',
    'actorUserId',current_setting('gridex.support.staff'),'sessionId',current_setting('gridex.support.session'),'clientId',null,'subject',null,
    'operation','create','caseId',null,'expectedRevision',0,'idempotencyKey','support-native-publication-case',
    'payload',jsonb_build_object('title','OPS INTERNAL RESOURCE TITLE','body','OPS INTERNAL RESOURCE BODY'));
  result:=public.gridex_support_case_command_v1(ops_command); cid:=(result->>'caseId')::uuid;
  reference:=(select public_reference from public.customer_support_threads where id=cid);
  perform public.gridex_support_case_publication_v1(jsonb_build_object('companyId',ca,'customerId',cu,'mode','ops',
    'actorUserId',current_setting('gridex.support.staff'),'sessionId',current_setting('gridex.support.session'),'clientId',null,'subject',null),
    jsonb_build_object('operation','publish','caseId',cid,'title','Explicit customer title','body','Explicit customer publication','status','open','expectedRevision',0,'channel','ops'));
  command:=(current_setting('gridex.support.command')::jsonb)||jsonb_build_object('operation','customer_message',
    'caseReference',reference,'caseId',null,'expectedRevision',2,'idempotencyKey','support-native-publication-reply',
    'payload',jsonb_build_object('body','Customer reply to published OPS case'));
  -- Supply one resource selector, as required by the canonical RPC contract.
  command:=command-'caseId';
  result:=public.gridex_support_case_command_v1(command);
  if result->>'revision'<>'3' then raise exception 'support_native_published_resource_message_failed'; end if;
  perform public.gridex_support_case_publication_v1(jsonb_build_object('companyId',ca,'customerId',cu,'mode','ops',
    'actorUserId',current_setting('gridex.support.staff'),'sessionId',current_setting('gridex.support.session'),'clientId',null,'subject',null),
    jsonb_build_object('operation','revoke','caseId',cid,'expectedRevision',1));
  select support_revision into before_revision from public.customer_cases where id=cid;
  select count(*) into before_messages from public.customer_support_messages where customer_case_id=cid;
  select count(*) into before_results from public.canonical_command_results where company_id=ca;
  select count(*) into before_audit from public.canonical_audit_events where company_id=ca;
  select count(*) into before_intents from public.canonical_event_outbox where company_id=ca;
  failed:=false;
  begin perform public.gridex_support_case_command_v1(command);
  exception when no_data_found then failed:=sqlerrm='support_resource_unavailable'; end;
  if not failed then raise exception 'support_native_revoked_publication_replay_allowed'; end if;
  if (select support_revision from public.customer_cases where id=cid)<>before_revision or
    (select count(*) from public.customer_support_messages where customer_case_id=cid)<>before_messages or
    (select count(*) from public.canonical_command_results where company_id=ca)<>before_results or
    (select count(*) from public.canonical_audit_events where company_id=ca)<>before_audit or
    (select count(*) from public.canonical_event_outbox where company_id=ca)<>before_intents then
    raise exception 'support_native_revoked_publication_replay_side_effects'; end if;
end $test$;
do $test$
declare
  ca uuid:=current_setting('gridex.support.company_a')::uuid; cu uuid:=current_setting('gridex.support.customer')::uuid;
  command jsonb; result jsonb; failed boolean; before_count bigint;
begin
  command:=jsonb_build_object('companyId',ca,'customerId',cu,'mode','ops','channel','ops',
    'actorUserId',current_setting('gridex.support.staff'),'sessionId',current_setting('gridex.support.session'),'clientId',null,'subject',null,
    'operation','create','caseId',null,'expectedRevision',0,'idempotencyKey','support-native-graph','siteId',current_setting('gridex.support.site'),
    'meteringPointId',current_setting('gridex.support.point'),'payload',jsonb_build_object('title','Graph-bound OPS case','body','Internal OPS description'));
  result:=public.gridex_support_case_command_v1(command);
  perform set_config('gridex.support.status_case',result->>'caseId',true);
  if not exists(select 1 from public.customer_cases c where c.id=(result->>'caseId')::uuid
    and c.site_id=current_setting('gridex.support.site')::uuid and c.metering_point_id=current_setting('gridex.support.point')::uuid)
    then raise exception 'support_native_graph_not_preserved'; end if;
  select count(*) into before_count from public.customer_cases where company_id=ca;
  failed:=false;
  begin perform public.gridex_support_case_command_v1(command||jsonb_build_object('idempotencyKey','support-native-foreign-site','siteId',current_setting('gridex.support.site_other')));
    exception when no_data_found then failed:=sqlerrm='support_resource_unavailable'; end;
  if not failed then raise exception 'support_native_foreign_site_not_denied'; end if;
  failed:=false;
  begin perform public.gridex_support_case_command_v1(command||jsonb_build_object('idempotencyKey','support-native-foreign-point','meteringPointId',current_setting('gridex.support.point_other')));
    exception when no_data_found then failed:=sqlerrm='support_resource_unavailable'; end;
  if not failed or (select count(*) from public.customer_cases where company_id=ca)<>before_count then raise exception 'support_native_foreign_point_partial_effect'; end if;
  command:=command||jsonb_build_object('customerId',current_setting('gridex.support.other'),'siteId',null,'meteringPointId',null,
    'channel','phone','idempotencyKey','support-native-phone-no-account','payload',jsonb_build_object('title','Phone contact without portal account','body','PRIVATE PHONE DRAFT'));
  result:=public.gridex_support_case_command_v1(command);
  perform set_config('gridex.support.phone_command',command::text,true);
  if not exists(select 1 from public.customer_support_messages m where m.customer_case_id=(result->>'caseId')::uuid
    and m.actor_user_id=current_setting('gridex.support.staff')::uuid and m.channel='phone' and m.caller_verification='unverified'
    and m.author_kind='staff' and m.visibility='internal') or
    exists(select 1 from public.customer_case_publications p where p.customer_case_id=(result->>'caseId')::uuid) or
    exists(select 1 from public.customer_portal_accounts a where a.customer_id=current_setting('gridex.support.other')::uuid)
  then raise exception 'support_native_phone_no_account_boundary_failed'; end if;
  perform public.gridex_support_case_publication_v1(jsonb_build_object('companyId',ca,'customerId',current_setting('gridex.support.other'),
    'mode','ops','actorUserId',current_setting('gridex.support.staff'),'sessionId',current_setting('gridex.support.session'),'clientId',null,'subject',null),
    jsonb_build_object('operation','publish','caseId',result->>'caseId','title','Explicit phone summary','body','Staff authored phone summary',
      'status','open','expectedRevision',0,'channel','phone'));
  if not exists(select 1 from public.customer_case_publications p where p.customer_case_id=(result->>'caseId')::uuid
    and p.channel='phone' and p.author_user_id=current_setting('gridex.support.staff')::uuid and p.public_body='Staff authored phone summary')
    or exists(select 1 from public.customer_case_publications p where p.public_body='PRIVATE PHONE DRAFT') then
    raise exception 'support_native_explicit_phone_publication_attribution_failed'; end if;
  failed:=false;
  begin perform public.gridex_support_case_command_v1(command||jsonb_build_object('verified',true));
    exception when invalid_parameter_value then failed:=sqlerrm='invalid_support_command'; end;
  if not failed then raise exception 'support_native_fake_phone_verification_accepted'; end if;
end $test$;
-- Explicit status transitions and public status are separate rules.
do $test$
declare
  command jsonb; result jsonb; failed boolean;
begin
  command:=jsonb_build_object('companyId',current_setting('gridex.support.company_a'),'customerId',current_setting('gridex.support.customer'),
    'mode','ops','channel','ops','actorUserId',current_setting('gridex.support.staff'),'sessionId',current_setting('gridex.support.session'),
    'clientId',null,'subject',null,'caseId',current_setting('gridex.support.status_case'),'operation','status','expectedRevision',1,
    'idempotencyKey','support-native-illegal-close','payload',jsonb_build_object('status','closed'));
  failed:=false;
  begin perform public.gridex_support_case_command_v1(command); exception when others then failed:=sqlerrm='support_status_transition_forbidden'; end;
  if not failed then raise exception 'support_native_close_without_resolve_allowed'; end if;
  result:=public.gridex_support_case_command_v1(command||jsonb_build_object('idempotencyKey','support-native-resolve','payload',jsonb_build_object('status','resolved')));
  if result->>'revision'<>'2' or result->>'customerStatus'<>'resolved' then raise exception 'support_native_resolve_transition_failed'; end if;
  failed:=false;
  begin perform public.gridex_support_case_command_v1(command||jsonb_build_object('expectedRevision',2,'idempotencyKey','support-native-resolved-invalid','payload',jsonb_build_object('status','manual_follow_up')));
  exception when others then failed:=sqlerrm='support_status_transition_forbidden'; end;
  if not failed then raise exception 'support_native_resolved_jump_allowed'; end if;
  result:=public.gridex_support_case_command_v1(command||jsonb_build_object('expectedRevision',2,'idempotencyKey','support-native-reopen','payload',jsonb_build_object('status','open')));
  if result->>'revision'<>'3' or result->>'status'<>'open' then raise exception 'support_native_reopen_failed'; end if;
  if private.gridex_support_customer_status_v1('manual_follow_up',null)<>'open' or
    private.gridex_support_customer_status_v1('billing_blocked','waiting_for_customer')<>'waiting_for_customer' then raise exception 'support_native_internal_status_projection_failed'; end if;
end $test$;
-- SQL ownership/state proof uses synthetic Storage metadata; real file bytes
-- and HTTP transport are exercised by the separate support HTTP/browser fixture.
do $test$
declare context jsonb; intake jsonb; reserved jsonb; failed boolean;
begin
  context:=(current_setting('gridex.support.command')::jsonb)-'channel'-'operation'-'caseId'-'expectedRevision'-'idempotencyKey'-'payload';
  intake:=jsonb_build_object('stage','reserve','caseReference',(select public_reference from public.customer_support_threads where id=current_setting('gridex.support.case')::uuid),
    'expectedRevision',2,'idempotencyKey','support-native-file','visibility','customer','fileName','Synthetic.pdf','mediaType','application/pdf','byteSize',32,'sha256',repeat('a',64));
  reserved:=public.gridex_support_attachment_intake_v1(context,intake);
  perform set_config('gridex.support.attachment_context',context::text,true); perform set_config('gridex.support.attachment_intake',intake::text,true);
  perform set_config('gridex.support.attachment_reserved',reserved::text,true);
  if reserved->>'phase'<>'reserved' or jsonb_array_length(public.gridex_support_attachment_read_v1(context,jsonb_build_object('reference',intake->>'caseReference'))->'items')<>0 then raise exception 'support_native_pending_upload_public'; end if;
  failed:=false;
  begin perform public.gridex_support_attachment_intake_v1(context,intake||jsonb_build_object('stage','commit'));
  exception when others then failed:=sqlerrm='support_attachment_unavailable'; end;
  if not failed then raise exception 'support_native_missing_storage_committed'; end if;
  failed:=false;
  begin perform public.gridex_support_attachment_intake_v1(context,intake||jsonb_build_object('scanStatus','clean'));
  exception when invalid_parameter_value then failed:=sqlerrm='invalid_support_attachment'; end;
  if not failed then raise exception 'support_native_fake_clean_accepted'; end if;
end $test$;
reset role;
insert into storage.objects(bucket_id,name,metadata)
values('customer-support-quarantine',(current_setting('gridex.support.attachment_reserved')::jsonb)->>'objectKey','{"size":32,"mimetype":"application/pdf"}');
set local role service_role;
do $test$
declare context jsonb:=current_setting('gridex.support.attachment_context')::jsonb;
  intake jsonb:=current_setting('gridex.support.attachment_intake')::jsonb;
  result jsonb; replay jsonb; failed boolean;
begin
  result:=public.gridex_support_attachment_intake_v1(context,intake||jsonb_build_object('stage','commit'));
  replay:=public.gridex_support_attachment_intake_v1(context,intake);
  if result->>'phase'<>'stored' or result->>'revision'<>'3' or result->>'scanStatus'<>'quarantined' or replay->>'replayed'<>'true' or
    (select count(*) from public.canonical_event_outbox where company_id=(context->>'companyId')::uuid and topic='customer.support.attachment.scan_requested')<>1 then raise exception 'support_native_attachment_commit_graph_failed'; end if;
  if jsonb_array_length(public.gridex_support_attachment_read_v1(context,jsonb_build_object('reference',intake->>'caseReference'))->'items')<>1 then raise exception 'support_native_attachment_read_failed'; end if;
  failed:=false;
  begin perform public.gridex_support_attachment_intake_v1(context,intake||jsonb_build_object('sha256',repeat('b',64)));
  exception when unique_violation then failed:=sqlerrm='support_idempotency_conflict'; end;
  if not failed then raise exception 'support_native_attachment_payload_conflict_missing'; end if;
end $test$;
reset role;
-- Fault injection is synthetic-tenant scoped and rolled back with this script.
create function pg_temp.support_late_audit_fail() returns trigger language plpgsql as $f$
begin
  if new.company_id=current_setting('gridex.support.company_a')::uuid and new.event_type='CUSTOMER_SUPPORT_COMMAND' then raise exception 'support_synthetic_late_failure'; end if;
  return new;
end $f$;
create trigger support_synthetic_late_failure before insert on public.canonical_audit_events for each row execute function pg_temp.support_late_audit_fail();
set local role service_role;
do $test$
declare
  command jsonb:=(current_setting('gridex.support.command')::jsonb)||jsonb_build_object('idempotencyKey','support-native-late-failure');
  before_cases bigint; before_messages bigint; before_results bigint; failed boolean:=false;
begin
  select count(*) into before_cases from public.customer_cases where company_id=current_setting('gridex.support.company_a')::uuid;
  select count(*) into before_messages from public.customer_support_messages where company_id=current_setting('gridex.support.company_a')::uuid;
  select count(*) into before_results from public.canonical_command_results where company_id=current_setting('gridex.support.company_a')::uuid;
  begin perform public.gridex_support_case_command_v1(command); exception when others then failed:=sqlerrm='support_synthetic_late_failure'; end;
  if not failed or (select count(*) from public.customer_cases where company_id=current_setting('gridex.support.company_a')::uuid)<>before_cases or
    (select count(*) from public.customer_support_messages where company_id=current_setting('gridex.support.company_a')::uuid)<>before_messages or
    (select count(*) from public.canonical_command_results where company_id=current_setting('gridex.support.company_a')::uuid)<>before_results then raise exception 'support_native_late_rollback_failed'; end if;
end $test$;
reset role;
drop trigger support_synthetic_late_failure on public.canonical_audit_events;
delete from auth.sessions where id=:'session_a';
set local role service_role;
do $test$
declare failed boolean:=false;
begin
  begin perform public.gridex_support_case_command_v1(current_setting('gridex.support.phone_command')::jsonb); exception when insufficient_privilege then failed:=sqlerrm='support_actor_forbidden'; end;
  if not failed then raise exception 'support_native_revoked_staff_session_replay_allowed'; end if;
end $test$;
reset role;
-- Current revocation is checked even for an already completed command.
update public.customer_portal_accounts set role='viewer' where customer_id=:'customer_a';
set local role service_role;
do $test$
declare failed boolean:=false;
begin
  begin perform public.gridex_support_case_command_v1(current_setting('gridex.support.command')::jsonb); exception when insufficient_privilege then failed:=sqlerrm='support_actor_forbidden'; end;
  if not failed then raise exception 'support_native_revoked_mandate_replay_allowed'; end if;
end $test$;
reset role;
update public.customer_portal_accounts set role='owner',is_active=false,status='blocked' where customer_id=:'customer_a';
set local role service_role;
do $test$
declare failed boolean:=false;
begin
  begin perform public.gridex_support_case_command_v1(current_setting('gridex.support.command')::jsonb); exception when insufficient_privilege then failed:=sqlerrm='support_actor_forbidden'; end;
  if not failed then raise exception 'support_native_revoked_relation_replay_allowed'; end if;
end $test$;
reset role;
update public.customer_portal_accounts set role='owner',is_active=true,status='active' where customer_id=:'customer_a';
update public.integration_api_clients set revoked_at=now(),status='revoked' where id=:'client_a';
set local role service_role;
do $test$
declare failed boolean:=false;
begin
  begin perform public.gridex_support_case_command_v1(current_setting('gridex.support.command')::jsonb); exception when insufficient_privilege then failed:=sqlerrm='support_actor_forbidden'; end;
  if not failed then raise exception 'support_native_revoked_client_replay_allowed'; end if;
end $test$;
reset role;
set local role authenticated;
do $test$
declare failed boolean:=false;
begin
  begin perform public.gridex_support_case_command_v1(current_setting('gridex.support.command')::jsonb); exception when insufficient_privilege then failed:=true; end;
  if not failed then raise exception 'support_native_low_role_rpc_bypass'; end if;
  if has_table_privilege('authenticated','public.customer_support_messages','SELECT') or has_table_privilege('anon','public.customer_support_threads','SELECT') then raise exception 'support_native_client_table_grant'; end if;
  if has_table_privilege('authenticated','public.customer_support_attachments','SELECT') or has_function_privilege('authenticated','public.gridex_support_attachment_intake_v1(jsonb,jsonb)','EXECUTE') then raise exception 'support_native_attachment_client_grant'; end if;
end $test$;
reset role;
select 'SUPPORT_COMMAND_NATIVE_PASS atomic=true replay=true conflict=true legacy_review=true resource_replay_policy=true isolation=true notes_private=true readonly=true graph_bound=true phone_internal_unverified=true explicit_phone_attribution=true status_transitions=true attachment_quarantine=true staff_session_revocation=true rollback=true revocation=true client_grants=false';
rollback;
