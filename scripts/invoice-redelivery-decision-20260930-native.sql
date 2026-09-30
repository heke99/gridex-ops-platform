\set ON_ERROR_STOP on
-- Disposable replay fixture; all synthetic identities, faults and rows roll back.
begin;
-- Same compact sorted-key bytes as the TypeScript billing serializer for
-- these ASCII-key synthetic fixtures. PostgreSQL's spaced JSON text is not
-- substituted for the application's snapshot hash.
create function pg_temp.billing_compact_sorted_json(p_value jsonb)
returns text language plpgsql immutable as $serialize$
declare v_result text;
begin
  if jsonb_typeof(p_value)='object' then
    select '{'||coalesce(string_agg(to_jsonb(e.key)::text||':'||pg_temp.billing_compact_sorted_json(e.value),
      ',' order by e.key collate "C"),'')||'}' into v_result from jsonb_each(p_value) e;
    return v_result;
  elsif jsonb_typeof(p_value)='array' then
    select '['||coalesce(string_agg(pg_temp.billing_compact_sorted_json(e.value),',' order by e.ordinality),'')||']'
      into v_result from jsonb_array_elements(p_value) with ordinality e(value,ordinality);
    return v_result;
  end if;
  return p_value::text;
end;
$serialize$;
select gen_random_uuid() as ca,gen_random_uuid() as cb,gen_random_uuid() as staff,
  gen_random_uuid() as reader,gen_random_uuid() as session_staff,gen_random_uuid() as session_reader,
  gen_random_uuid() as customer,gen_random_uuid() as other,gen_random_uuid() as foreign_customer,
  gen_random_uuid() as client,gen_random_uuid() as contract_inherit,gen_random_uuid() as contract_override,
  gen_random_uuid() as underlay,gen_random_uuid() as underlay_legacy \gset
insert into public.companies(id,name,status) values(:'ca','Synthetic billing A','active'),(:'cb','Synthetic billing B','active');
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
select id,'authenticated','authenticated',id::text||'@example.invalid',now(),'{}','{}',now(),now(),false,false
from unnest(array[:'staff'::uuid,:'reader'::uuid]) id;
insert into auth.sessions(id,user_id,created_at,updated_at) values(:'session_staff',:'staff',now(),now()),(:'session_reader',:'reader',now(),now());
insert into public.user_profiles(id,email,full_name,user_status)
select id,id::text||'@example.invalid','Synthetic billing actor','active' from unnest(array[:'staff'::uuid,:'reader'::uuid]) id;
insert into public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key)
values(:'ca',:'staff','company_admin','active',now(),'company_admin',true,now(),'company_admin'),
  (:'ca',:'reader','viewer','active',now(),'viewer',true,now(),'finance_readonly');
insert into public.permissions(key,name) values('masterdata.write','Synthetic billing write') on conflict(key) do nothing;
insert into public.user_permissions(user_id,company_id,permission_id,permission_key)
select :'staff',:'ca',id,key from public.permissions where key='masterdata.write';
insert into public.customers(id,company_id,customer_number,name,customer_type,first_name,last_name,email,phone,invoice_email,billing_profile)
values(:'customer',:'ca',:'customer','Synthetic billing customer','private','Synthetic','Billing','contact@example.invalid','+4600000000','before@example.invalid',
  '{"recipient":"Billing Customer","distributionMethod":"email","email":"before@example.invalid","country":"SE"}'),
  (:'other',:'ca',:'other','Other billing customer','private','Other','Billing','other@example.invalid','+4600000001',null,'{}'),
  (:'foreign_customer',:'cb',:'foreign_customer','Foreign billing customer','private','Foreign','Billing','foreign@example.invalid','+4600000002',null,'{}');
insert into public.customer_contracts(id,company_id,customer_id,status,invoice_email)
values(:'contract_inherit',:'ca',:'customer','draft',null),(:'contract_override',:'ca',:'customer','draft','agency@example.invalid');
insert into public.billing_underlays(id,company_id,customer_id,contract_id,customer_contract_id,underlay_year,underlay_month,status)
values(:'underlay',:'ca',:'customer',:'contract_inherit',:'contract_inherit',2026,9,'pending'),
  (:'underlay_legacy',:'ca',:'customer',:'contract_inherit',:'contract_inherit',2026,8,'pending');
update public.billing_underlays set billing_configuration_snapshot='{"schema":"billing_configuration_v1","invoice_email":"historical@example.invalid"}',
  billing_configuration_snapshot_sha256=encode(extensions.digest(pg_temp.billing_compact_sorted_json(
    '{"schema":"billing_configuration_v1","invoice_email":"historical@example.invalid"}'::jsonb),'sha256'),'hex')
where id=:'underlay_legacy';
insert into public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,status,scopes)
values(:'client',:'ca','Synthetic billing API','billing-'||left(:'client',8),repeat('a',64),'active',array['customer_billing.write']);
insert into public.customer_portal_accounts(company_id,customer_id,user_id,portal_user_id,status,is_active,role,email)
values(:'ca',:'customer',:'staff',:'staff','active',true,'owner',:'staff'||'@example.invalid');
select set_config('gridex.billingtest.ca',:'ca',true),set_config('gridex.billingtest.cb',:'cb',true),
  set_config('gridex.billingtest.staff',:'staff',true),set_config('gridex.billingtest.reader',:'reader',true),
  set_config('gridex.billingtest.session',:'session_staff',true),set_config('gridex.billingtest.reader_session',:'session_reader',true),
  set_config('gridex.billingtest.customer',:'customer',true),set_config('gridex.billingtest.other',:'other',true),
  set_config('gridex.billingtest.client',:'client',true),set_config('gridex.billingtest.inherit',:'contract_inherit',true),
  set_config('gridex.billingtest.override',:'contract_override',true),set_config('gridex.billingtest.underlay',:'underlay',true),
  set_config('gridex.billingtest.underlay_legacy',:'underlay_legacy',true);
set local role service_role;

-- Full native history only; this file never fetches storage or provider data.
-- Existing command ownership/clock/grants/graph guards are used unchanged.
reset role;
insert into public.permissions(key,name) values('billing_underlay.export','Synthetic redelivery decision') on conflict(key) do nothing;
insert into public.user_permissions(user_id,company_id,permission_id,permission_key)
select current_setting('gridex.billingtest.staff')::uuid,current_setting('gridex.billingtest.ca')::uuid,id,key
from public.permissions where key='billing_underlay.export';
set local role service_role;
do $proof$
declare ca uuid:=current_setting('gridex.billingtest.ca')::uuid; cu uuid:=current_setting('gridex.billingtest.customer')::uuid;
  actor uuid:=current_setting('gridex.billingtest.staff')::uuid; session uuid:=current_setting('gridex.billingtest.session')::uuid;
  agreement uuid:=current_setting('gridex.billingtest.inherit')::uuid; underlay uuid:=current_setting('gridex.billingtest.underlay')::uuid;
  pricing uuid:=gen_random_uuid(); run uuid:=gen_random_uuid(); item uuid:=gen_random_uuid(); invoice uuid:=gen_random_uuid();
  document uuid:=gen_random_uuid(); account uuid; profile jsonb; snapshot jsonb; compact text; snapshot_hash text;
  original jsonb; current_graph jsonb; command jsonb; decision jsonb; replay jsonb; patch jsonb; denied boolean;
  payload jsonb; provider_guid text:='synthetic-redelivery-'||item::text; request_key text:='synthetic-redelivery-request-'||item::text;
  baseline integer; saved_command jsonb;
begin
  profile:=jsonb_build_object('companyId',ca,'customerId',cu,'contractId',agreement,
    'recipient','Billing Customer','distributionMethod','email','email','before@example.invalid','reference',null,
    'address',jsonb_build_object('street',null,'postalCode',null,'city',null,'country','SE'),
    'profileRevision',0,'contractOverrideRevision',0,
    'sources',jsonb_build_object('recipient','customer_default','distributionMethod','customer_default','email','customer_default',
      'reference','missing','street','missing','postalCode','missing','city','missing','country','customer_default'),'blockers','[]'::jsonb);
  snapshot:=jsonb_build_object('schema','billing_configuration_v2','company_id',ca,'customer_id',cu,'contract_id',agreement,
    'effective_billing_profile',profile,'invoice_email','before@example.invalid');
  compact:=pg_temp.billing_compact_sorted_json(snapshot);snapshot_hash:=encode(extensions.digest(compact,'sha256'),'hex');
  perform public.gridex_lock_billing_configuration_v2(ca,underlay,0,0,snapshot,snapshot_hash,compact);
  insert into public.pricing_runs(id,company_id,billing_underlay_id,customer_id,status,locked_at,total_ex_vat,vat_amount,total_inc_vat)
    values(pricing,ca,underlay,cu,'locked',clock_timestamp(),100,25,125);
  insert into public.invoice_export_runs(id,company_id,billing_month,environment,financing_mode)
    values(run,ca,'2026-09','test','invoice_service');
  insert into public.invoice_export_items(id,company_id,export_run_id,customer_id,customer_contract_id,billing_underlay_id,
    pricing_run_id,environment,financing_mode,status,idempotency_key,amount_ex_vat,vat_amount,amount_inc_vat,total_kwh)
    values(item,ca,run,cu,agreement,underlay,pricing,'test','invoice_service','pending',request_key,100,25,125,1);
  payload:=jsonb_build_object('externalReferenceCode',pricing,'invoiceDate','2026-09-01T10:00:00Z',
    'customer',jsonb_build_object('email','before@example.invalid'),
    'debts',jsonb_build_array(jsonb_build_object('invoiceDate','2026-09-01T10:00:00Z','dueDate','2026-09-21T10:00:00Z','originalPrincipal',100,'originalVat',25)));
  update public.invoice_export_items set request_payload=payload,provider_request_id=request_key,provider_idempotency_key=request_key
    where id=item and company_id=ca;
  update public.invoice_export_items set provider_invoice_guid=provider_guid,provider_invoice_id=provider_guid,
    status='sent',sent_at=clock_timestamp() where id=item and company_id=ca;
  insert into public.customer_invoices(id,company_id,customer_id,customer_contract_id,contract_id,billing_underlay_id,
    invoice_export_item_id,canonical_export_item_id,partner_export_id,partner_invoice_reference,status,
    issued_at,due_date,amount_ex_vat,vat_amount,amount_inc_vat,total_kwh,source_system,raw_payload,calculation_snapshot,calculation_snapshot_sha256)
    values(invoice,ca,cu,agreement,agreement,underlay,item,item,item,provider_guid,'sent','2026-09-01','2026-09-21',
      100,25,125,1,'canonical_invoice_export',jsonb_build_object('create_invoice',jsonb_build_object('invoiceGuids',jsonb_build_array(provider_guid))),
      jsonb_build_object('synthetic_financial_snapshot','original','billing_configuration_snapshot_sha256',snapshot_hash),
      public.canonical_json_sha256(jsonb_build_object('synthetic_financial_snapshot','original','billing_configuration_snapshot_sha256',snapshot_hash)));
  insert into public.customer_invoice_lines(company_id,customer_id,invoice_id,description,amount_ex_vat,vat_amount,amount_inc_vat)
    values(ca,cu,invoice,'Synthetic original energy',100,25,125);
  insert into public.customer_invoice_documents(id,company_id,customer_id,invoice_id,file_path,file_name,mime_type,metadata)
    values(document,ca,cu,invoice,'synthetic/original-invoice.pdf','original-invoice.pdf','application/pdf',
      jsonb_build_object('fixture_only_pdf_bytes','synthetic-original-PDF-bytes'));
  original:=jsonb_build_object('invoice',(select to_jsonb(i) from public.customer_invoices i where id=invoice),
    'item',(select to_jsonb(i) from public.invoice_export_items i where id=item),
    'underlay',(select to_jsonb(i) from public.billing_underlays i where id=underlay),
    'pricing',(select to_jsonb(i) from public.pricing_runs i where id=pricing),
    'lines',(select jsonb_agg(to_jsonb(i) order by id) from public.customer_invoice_lines i where invoice_id=invoice),
    'documents',(select jsonb_agg(to_jsonb(i) order by id) from public.customer_invoice_documents i where invoice_id=invoice));
  perform public.gridex_change_customer_billing_profile_v1(jsonb_build_object('companyId',ca,'customerId',cu,'mode','ops',
    'actorUserId',actor,'sessionId',session,'reason','Synthetic verified redelivery profile','expectedRevision',0,
    'idempotencyKey','native-redelivery-profile-'||cu::text,'changes',jsonb_build_object('email',actor::text||'@example.invalid')));
  select id into strict account from public.customer_portal_accounts where company_id=ca and customer_id=cu and user_id=actor and role='owner';
  command:=jsonb_build_object('companyId',ca,'customerId',cu,'invoiceId',invoice,'accountId',account,'actorUserId',actor,
    'sessionId',session,'expectedRevision',1,'expectedOverrideRevision',0,'idempotencyKey','native-redelivery-decision-'||invoice::text,
    'reason','Explicit verified copy of original invoice');
  decision:=public.gridex_record_invoice_redelivery_decision_v1(command);replay:=public.gridex_record_invoice_redelivery_decision_v1(command);
  if decision->>'destinationEmail' is distinct from actor::text||'@example.invalid'
    or decision->>'status'<>'verified_delivery_decision' or decision->>'deliveryStatus'<>'blocked_provider_adapter'
    or decision->>'financialSnapshotSha256' !~ '^[a-f0-9]{64}$' or decision->>'documentReferencesSha256' !~ '^[a-f0-9]{64}$'
    or replay->>'decisionId' is distinct from decision->>'decisionId' or replay->>'replayed'<>'true' then
    raise exception 'native_redelivery_decision_or_replay_invalid'; end if;
  current_graph:=jsonb_build_object('invoice',(select to_jsonb(i) from public.customer_invoices i where id=invoice),
    'item',(select to_jsonb(i) from public.invoice_export_items i where id=item),
    'underlay',(select to_jsonb(i) from public.billing_underlays i where id=underlay),
    'pricing',(select to_jsonb(i) from public.pricing_runs i where id=pricing),
    'lines',(select jsonb_agg(to_jsonb(i) order by id) from public.customer_invoice_lines i where invoice_id=invoice),
    'documents',(select jsonb_agg(to_jsonb(i) order by id) from public.customer_invoice_documents i where invoice_id=invoice));
  if current_graph is distinct from original then raise exception 'native_redelivery_changed_original_issued_graph'; end if;
  select count(*) into baseline from public.invoice_redelivery_decisions where company_id=ca;
  for patch in select value from jsonb_array_elements(jsonb_build_array(jsonb_build_object('verified',true),
    jsonb_build_object('expectedRevision',0),jsonb_build_object('expectedOverrideRevision',1),jsonb_build_object('companyId',current_setting('gridex.billingtest.cb')),
    jsonb_build_object('customerId',current_setting('gridex.billingtest.other')),
    jsonb_build_object('actorUserId',current_setting('gridex.billingtest.reader'),'sessionId',current_setting('gridex.billingtest.reader_session')),
    jsonb_build_object('reason','Changed request intent with reused key')))
  loop
    denied:=false;begin perform public.gridex_record_invoice_redelivery_decision_v1(command||patch);
      exception when sqlstate '22023' or sqlstate '42501' or sqlstate '40001' or unique_violation then denied:=true;end;
    if not denied or (select count(*) from public.invoice_redelivery_decisions where company_id=ca)<>baseline then
      raise exception 'native_redelivery_invalid_command_mutated_decision'; end if;
  end loop;
  denied:=false;begin update public.invoice_redelivery_decisions set reason='changed' where id=(decision->>'decisionId')::uuid;
    exception when insufficient_privilege or sqlstate '55000' then denied:=true;end;
  if not denied then raise exception 'native_redelivery_decision_not_immutable'; end if;
  if has_function_privilege('anon','public.gridex_record_invoice_redelivery_decision_v1(jsonb)','execute')
    or has_function_privilege('authenticated','public.gridex_record_invoice_redelivery_decision_v1(jsonb)','execute')
    or has_function_privilege('authenticated','private.gridex_invoice_redelivery_auth_email_v1(uuid)','execute')
    or has_table_privilege('authenticated','public.invoice_redelivery_decisions','select') then
    raise exception 'native_redelivery_low_privilege_grant'; end if;
  perform set_config('gridex.redelivery.native_command',command::text,true);
end;
$proof$;
\echo INVOICE_REDELIVERY_NATIVE_SEPARATE_DECISION_ORIGINAL_GRAPH_REPLAY_ACL_PASS
-- An actual delay after the decision write crosses the current session clock.
reset role;
create temporary sequence redelivery_late_marker;
grant usage,select on sequence redelivery_late_marker to service_role;
create function pg_temp.redelivery_delay() returns trigger language plpgsql as $delay$
begin perform nextval('pg_temp.redelivery_late_marker');perform pg_sleep(0.6);return new;end;$delay$;
create trigger synthetic_redelivery_delay after insert on public.invoice_redelivery_decisions
  for each row execute function pg_temp.redelivery_delay();
update auth.sessions set not_after=clock_timestamp()+interval '0.4 seconds' where id=current_setting('gridex.billingtest.session')::uuid;
set local role service_role;
do $late$
declare command jsonb:=current_setting('gridex.redelivery.native_command')::jsonb;
  before_decisions bigint; before_events bigint; denied boolean:=false;
begin
  select count(*) into before_decisions from public.invoice_redelivery_decisions where company_id=(command->>'companyId')::uuid;
  select count(*) into before_events from public.domain_events where company_id=(command->>'companyId')::uuid;
  begin perform public.gridex_record_invoice_redelivery_decision_v1(command||jsonb_build_object('idempotencyKey','native-late-redelivery-'||gen_random_uuid()::text));
    exception when insufficient_privilege then denied:=true;end;
  if not denied or not (select is_called from pg_temp.redelivery_late_marker)
    or (select count(*) from public.invoice_redelivery_decisions where company_id=(command->>'companyId')::uuid)<>before_decisions
    or (select count(*) from public.domain_events where company_id=(command->>'companyId')::uuid)<>before_events then
    raise exception 'native_redelivery_late_clock_partial_commit'; end if;
end;$late$;
\echo INVOICE_REDELIVERY_NATIVE_LATE_SESSION_ATOMIC_ROLLBACK_PASS
reset role;
drop trigger synthetic_redelivery_delay on public.invoice_redelivery_decisions;
update auth.sessions set not_after=null where id=current_setting('gridex.billingtest.session')::uuid;
create function pg_temp.redelivery_fault() returns trigger language plpgsql as $fault$
begin raise exception 'synthetic_native_redelivery_late_fault' using errcode='XX000';end;$fault$;
create trigger synthetic_redelivery_fault after insert on public.invoice_redelivery_decisions
  for each row execute function pg_temp.redelivery_fault();
set local role service_role;
do $fault$
declare command jsonb:=current_setting('gridex.redelivery.native_command')::jsonb;
  before_decisions bigint; before_events bigint; denied boolean:=false;
begin
  select count(*) into before_decisions from public.invoice_redelivery_decisions where company_id=(command->>'companyId')::uuid;
  select count(*) into before_events from public.domain_events where company_id=(command->>'companyId')::uuid;
  begin perform public.gridex_record_invoice_redelivery_decision_v1(command||jsonb_build_object('idempotencyKey','native-fault-redelivery-'||gen_random_uuid()::text));
    exception when sqlstate 'XX000' then denied:=sqlerrm='synthetic_native_redelivery_late_fault';end;
  if not denied or (select count(*) from public.invoice_redelivery_decisions where company_id=(command->>'companyId')::uuid)<>before_decisions
    or (select count(*) from public.domain_events where company_id=(command->>'companyId')::uuid)<>before_events then
    raise exception 'native_redelivery_late_fault_partial_commit';end if;
end;$fault$;
\echo INVOICE_REDELIVERY_NATIVE_LATE_PERSISTENCE_ATOMIC_ROLLBACK_PASS
rollback;
