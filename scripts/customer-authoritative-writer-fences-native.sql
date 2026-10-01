\set ON_ERROR_STOP on
-- Disposable replay only. All rows, utility functions, claims and effects are
-- synthetic, enclosed by this transaction and rolled back at the end.
begin;
select gen_random_uuid() as company_a, gen_random_uuid() as company_b,
  gen_random_uuid() as denied_actor, gen_random_uuid() as writer_actor,
  gen_random_uuid() as denied_session, gen_random_uuid() as writer_session,
  gen_random_uuid() as revoked_session,
  gen_random_uuid() as customer_a, gen_random_uuid() as customer_other,
  gen_random_uuid() as customer_foreign \gset

insert into public.companies(id,name,status) values
  (:'company_a','Synthetic authoritative writer A','active'),
  (:'company_b','Synthetic authoritative writer B','active');
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,
  raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
select id,'authenticated','authenticated',id::text||'@example.invalid',now(),
  '{}','{}',now(),now(),false,false
from unnest(array[:'denied_actor'::uuid,:'writer_actor'::uuid]) id;
insert into public.user_profiles(id,email,full_name,user_status)
select id,id::text||'@example.invalid','Synthetic authoritative writer','active'
from unnest(array[:'denied_actor'::uuid,:'writer_actor'::uuid]) id;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values
  (:'denied_session',:'denied_actor',now(),now(),now()+interval '1 hour'),
  (:'writer_session',:'writer_actor',now(),now(),now()+interval '1 hour'),
  (:'revoked_session',:'writer_actor',now(),now(),now()+interval '1 hour');
-- An operations membership passes the former raw-table write policy even
-- when the canonical permission engine denies the actual command permission.
insert into public.company_memberships(company_id,user_id,membership_role,status,
  accepted_at,role,is_active,joined_at,role_key) values
  (:'company_a',:'denied_actor','operations','active',now(),'operations',true,now(),'operations'),
  (:'company_a',:'writer_actor','operations','active',now(),'operations',true,now(),'operations');
insert into public.permissions(key,name) values
  ('masterdata.write','Synthetic authoritative masterdata permission'),
  ('customers.write','Synthetic authoritative customer permission')
on conflict(key) do nothing;
insert into public.user_permissions(user_id,company_id,permission_id,permission_key,effect)
select actor.id,:'company_a',permission.id,permission.key,actor.effect
from (values(:'denied_actor'::uuid,'deny'),(:'writer_actor'::uuid,'allow')) actor(id,effect)
cross join public.permissions permission
where permission.key in ('masterdata.write','customers.write');

insert into public.customers(id,company_id,customer_number,name,customer_type,
  first_name,last_name,email,phone,preferred_language,metadata) values
  (:'customer_a',:'company_a',:'customer_a','Synthetic Own','private','Synthetic','Own',
   'own@example.invalid','+4600000000','sv','{}'),
  (:'customer_other',:'company_a',:'customer_other','Synthetic Other','private','Synthetic','Other',
   'other@example.invalid','+4600000001','sv','{}'),
  (:'customer_foreign',:'company_b',:'customer_foreign','Synthetic Foreign','private','Synthetic','Foreign',
   'foreign@example.invalid','+4600000002','sv','{}');
insert into public.customer_contacts(company_id,customer_id,type,is_primary,name,email,phone)
select company_id,id,'primary',true,name,email,phone from public.customers
where id in (:'customer_a',:'customer_other',:'customer_foreign');
insert into public.customer_addresses(company_id,customer_id,type,street_1,postal_code,city,country)
select company_id,id,'billing','Synthetic 1','12345','Malmö','SE' from public.customers
where id in (:'customer_a',:'customer_other',:'customer_foreign');
insert into public.customer_sites(company_id,customer_id,facility_reference,status,street,postal_code,city,country)
select company_id,id,'facility_'||id::text,'active','Synthetic 1','12345','Malmö','SE' from public.customers
where id in (:'customer_a',:'customer_other',:'customer_foreign');

select set_config('gridex.writerfence.company',:'company_a',true),
  set_config('gridex.writerfence.foreign_company',:'company_b',true),
  set_config('gridex.writerfence.actor',:'denied_actor',true),
  set_config('gridex.writerfence.session',:'denied_session',true),
  set_config('gridex.writerfence.writer',:'writer_actor',true),
  set_config('gridex.writerfence.writer_session',:'writer_session',true),
  set_config('gridex.writerfence.customer',:'customer_a',true),
  set_config('gridex.writerfence.other',:'customer_other',true),
  set_config('gridex.writerfence.targets',(
    select jsonb_agg(jsonb_build_object('companyId',c.company_id,'customerId',c.id,
      'contactId',contact.id,'addressId',address.id,'siteId',site.id) order by c.id)::text
    from public.customers c
    join public.customer_contacts contact on contact.customer_id=c.id and contact.is_primary
    join public.customer_addresses address on address.customer_id=c.id and address.type='billing'
    join public.customer_sites site on site.customer_id=c.id
    where c.id in (:'customer_a',:'customer_other',:'customer_foreign')
  ),true);

create function pg_temp.authoritative_writer_snapshot() returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $snapshot$
declare snapshot jsonb; archive jsonb;
begin
  select jsonb_build_object(
    'customers',(select jsonb_agg(to_jsonb(t) order by t.id) from public.customers t where t.company_id=any(ids.companies)),
    'contacts',(select jsonb_agg(to_jsonb(t) order by t.id) from public.customer_contacts t where t.company_id=any(ids.companies)),
    'addresses',(select jsonb_agg(to_jsonb(t) order by t.id) from public.customer_addresses t where t.company_id=any(ids.companies)),
    'sites',(select jsonb_agg(to_jsonb(t) order by t.id) from public.customer_sites t where t.company_id=any(ids.companies)),
    'audit',(select jsonb_agg(to_jsonb(t) order by t.id) from public.canonical_audit_events t where t.company_id=any(ids.companies)),
    'commands',(select jsonb_agg(to_jsonb(t) order by t.id) from public.canonical_command_results t where t.company_id=any(ids.companies)),
    'domainEvents',(select jsonb_agg(to_jsonb(t) order by t.id) from public.canonical_domain_events t where t.company_id=any(ids.companies)),
    'outbox',(select jsonb_agg(to_jsonb(t) order by t.id) from public.canonical_event_outbox t where t.company_id=any(ids.companies)),
    'claims',(select jsonb_agg(to_jsonb(t) order by t.id) from public.customer_portal_write_idempotency t where t.company_id=any(ids.companies)),
    'completions',(select jsonb_agg(to_jsonb(t) order by t.id) from public.customer_portal_completions t where t.company_id=any(ids.companies)),
    'addressHistory',(select jsonb_agg(to_jsonb(t) order by t.id) from public.customer_site_address_history t where t.company_id=any(ids.companies)),
    'jobs',(select jsonb_agg(to_jsonb(t) order by t.id) from public.customer_operation_jobs t where t.company_id=any(ids.companies)),
    'snapshots',(select jsonb_agg(to_jsonb(t) order by t.id) from public.customer_operation_request_snapshots t where t.company_id=any(ids.companies)))
  into snapshot
  from (select array[current_setting('gridex.writerfence.company')::uuid,
    current_setting('gridex.writerfence.foreign_company')::uuid] companies) ids;
  -- The obsolete archive relation is absent from some canonical dumps. Its
  -- historical key is archived_id. Do not invent the relation to pass a test.
  if to_regclass('public.gridex_archived_customer_registry_rows') is not null then
    execute 'select jsonb_agg(to_jsonb(t) order by t.archived_id)
      from public.gridex_archived_customer_registry_rows t where t.source_id in
      (select value->>''customerId'' from jsonb_array_elements($1))'
      into archive using current_setting('gridex.writerfence.targets')::jsonb;
  end if;
  return snapshot||jsonb_build_object('archive',archive);
end;
$snapshot$;
select set_config('gridex.writerfence.before',pg_temp.authoritative_writer_snapshot()::text,true);

-- Actual effective privileges, including table grants, inherited PUBLIC
-- execution and column ACL. Catalog checks cannot be satisfied by RLS alone.
do $acl$
declare table_name text; untrusted text; routine record;
begin
  foreach table_name in array array['customers','customer_contacts','customer_addresses','customer_sites'] loop
    foreach untrusted in array array['anon','authenticated'] loop
      if has_table_privilege(untrusted,'public.'||table_name,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege(untrusted,'public.'||table_name,'INSERT,UPDATE,REFERENCES') then
        raise exception 'authoritative_untrusted_writer_acl: % %',untrusted,table_name;
      end if;
    end loop;
    if not has_table_privilege('authenticated','public.'||table_name,'SELECT')
      or not has_table_privilege('service_role','public.'||table_name,'SELECT')
      or not has_table_privilege('service_role','public.'||table_name,'INSERT')
      or not has_table_privilege('service_role','public.'||table_name,'UPDATE')
      or not has_table_privilege('service_role','public.'||table_name,'DELETE') then
      raise exception 'authoritative_supported_table_acl_lost: %',table_name;
    end if;
  end loop;
  for routine in select p.oid,p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array[
      'gridex_db4b_archive_customer_registry_row','gridex_commit_customer_site_address',
      'gridex_create_customer_site_with_address','gridex_complete_facility_response','gridex_apply_exact_z02_core',
      'gridex_finalize_supplier_switch_activation','gridex_refresh_customer_process_summary',
      'canonical_onboard_customer_graph','gridex_onboard_customer_graph','gridex_onboard_customer_graph_core','gridex_onboard_customer_graph_quote_commit_v2',
      'gridex_create_partner_contract_v1'])
  loop
    if has_function_privilege('anon',routine.oid,'EXECUTE') or has_function_privilege('authenticated',routine.oid,'EXECUTE') then
      raise exception 'authoritative_untrusted_writer_rpc_acl: %',routine.signature;
    end if;
    if (select proname from pg_proc where oid=routine.oid)<>'gridex_onboard_customer_graph_core'
      and not has_function_privilege('service_role',routine.oid,'EXECUTE') then
      raise exception 'authoritative_service_writer_rpc_acl_lost: %',routine.signature;
    end if;
  end loop;
end;
$acl$;

-- This utility is an invoker, so every actual statement runs as the explicit
-- caller below. It cannot borrow the fixture owner's table permissions.
create function pg_temp.assert_authoritative_raw_writers_denied() returns void
language plpgsql security invoker set search_path=pg_catalog as $denials$
declare target jsonb; statement text; customer uuid; company uuid; routine record;
begin
  if current_user not in ('anon','authenticated') then raise exception 'fixture_wrong_untrusted_role'; end if;
  if auth.uid() is distinct from current_setting('gridex.writerfence.actor')::uuid then
    raise exception 'fixture_missing_real_actor_claim'; end if;
  if current_user='authenticated' then
    if (select count(*) from public.customers where id=current_setting('gridex.writerfence.customer')::uuid)<>1
      or (select count(*) from public.customers where company_id=current_setting('gridex.writerfence.foreign_company')::uuid)<>0 then
      raise exception 'authoritative_tenant_read_policy_changed'; end if;
  end if;
  for target in select value from jsonb_array_elements(current_setting('gridex.writerfence.targets')::jsonb) loop
    customer:=(target->>'customerId')::uuid; company:=(target->>'companyId')::uuid;
    foreach statement in array array[
      format('update public.customers set phone=%L where id=%L::uuid','+4699999999',customer),
      format('update public.customers set first_name=%L where id=%L::uuid','Forged identity',customer),
      format('update public.customers set invoice_email=%L,billing_profile=%L::jsonb where id=%L::uuid','forged@example.invalid','{"email":"forged@example.invalid"}',customer),
      format('update public.customers set status=%L where id=%L::uuid','terminated',customer),
      format('update public.customers set preferred_language=%L,metadata=%L::jsonb where id=%L::uuid','en','{"portal_timezone":"Europe/Stockholm"}',customer),
      format('update public.customers set contact_revision=0,profile_revision=0,legal_profile_revision=0,lifecycle_revision=0,billing_profile_revision=0,address_book_revision=0 where id=%L::uuid',customer),
      format('update public.customer_contacts set phone=%L where id=%L::uuid','+4699999999',target->>'contactId'),
      format('update public.customer_addresses set city=%L where id=%L::uuid','Forged city',target->>'addressId'),
      format('update public.customer_sites set city=%L,address_revision=0 where id=%L::uuid','Forged city',target->>'siteId'),
      format('delete from public.customers where id=%L::uuid',customer),
      format('delete from public.customer_contacts where id=%L::uuid',target->>'contactId'),
      format('delete from public.customer_addresses where id=%L::uuid',target->>'addressId'),
      format('delete from public.customer_sites where id=%L::uuid',target->>'siteId'),
      format('insert into public.customers(id,company_id,customer_number,name,customer_type) values(gen_random_uuid(),%L::uuid,%L,%L,%L)',company,'forged_'||customer::text,'Forged customer','private'),
      format('insert into public.customer_contacts(company_id,customer_id,type,is_primary,name) values(%L::uuid,%L::uuid,%L,false,%L)',company,customer,'other','Forged contact'),
      format('insert into public.customer_addresses(company_id,customer_id,type,street_1,city,country) values(%L::uuid,%L::uuid,%L,%L,%L,%L)',company,customer,'facility','Forged 1','Forged city','SE'),
      format('insert into public.customer_sites(company_id,customer_id,facility_reference,status) values(%L::uuid,%L::uuid,%L,%L)',company,customer,'forged_'||customer::text,'draft'),
      format('select public.gridex_db4b_archive_customer_registry_row(%L,null,true,%L)',customer::text,'Forged archive')
    ] loop
      begin
        execute statement;
        raise exception 'authoritative_raw_writer_not_denied: % %',current_user,statement;
      exception when insufficient_privilege then null;
      end;
    end loop;
  end loop;
  -- Exercise every installed overload as the real untrusted role as well as
  -- checking its ACL above. Exact typed arguments prevent default/overload
  -- resolution from silently selecting a different signature.
  for routine in select p.oid,p.proname,
    (select string_agg('null::'||format_type(arg.oid,null),',' order by arg.ordinality)
      from unnest(p.proargtypes::oid[]) with ordinality arg(oid,ordinality)) arguments
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' and p.proname=any(array[
      'gridex_db4b_archive_customer_registry_row','gridex_commit_customer_site_address',
      'gridex_create_customer_site_with_address','gridex_complete_facility_response','gridex_apply_exact_z02_core',
      'gridex_finalize_supplier_switch_activation','gridex_refresh_customer_process_summary',
      'canonical_onboard_customer_graph','gridex_onboard_customer_graph','gridex_onboard_customer_graph_core',
      'gridex_onboard_customer_graph_quote_commit_v2','gridex_create_partner_contract_v1'])
  loop
    statement:=format('select public.%I(%s)',routine.proname,coalesce(routine.arguments,''));
    begin
      execute statement;
      raise exception 'authoritative_rpc_overload_not_denied: % %',current_user,routine.oid::regprocedure;
    exception when insufficient_privilege then null;
    end;
  end loop;
end;
$denials$;
do $temporary_grants$
begin
  execute format('grant usage on schema %I to anon,authenticated',
    (select nspname from pg_namespace where oid=pg_my_temp_schema()));
end;
$temporary_grants$;
grant execute on function pg_temp.assert_authoritative_raw_writers_denied() to anon,authenticated;

select set_config('request.jwt.claim.sub',:'denied_actor',true),
  set_config('request.jwt.claim.role','authenticated',true),
  set_config('request.jwt.claims',jsonb_build_object('sub',:'denied_actor','role','authenticated','session_id',:'denied_session')::text,true);
set local role service_role;
do $command_permission$
begin
  begin
    perform public.gridex_change_customer_contact_v2(jsonb_build_object(
      'companyId',current_setting('gridex.writerfence.company'),'customerId',current_setting('gridex.writerfence.customer'),
      'actorUserId',current_setting('gridex.writerfence.actor'),'sessionId',current_setting('gridex.writerfence.session'),
      'mode','ops','reason','Synthetic denied command permission','expectedRevision',0,
      'idempotencyKey','authoritative-denied-command','changes',jsonb_build_object('phone','+4699999999')));
    raise exception 'authoritative_fixture_command_permission_not_denied';
  exception when insufficient_privilege then
    if sqlerrm<>'profile_actor_forbidden' then raise; end if;
  end;
end;
$command_permission$;
reset role;
set local role authenticated;
select pg_temp.assert_authoritative_raw_writers_denied();
reset role;

-- A separate actor has the actual command permission. Delete that actor's
-- real session but retain its prior JWT, so an unrelated permission denial
-- cannot make the revoked-session assertion pass by accident.
select set_config('gridex.writerfence.actor',:'writer_actor',true),
  set_config('gridex.writerfence.session',:'revoked_session',true),
  set_config('request.jwt.claim.sub',:'writer_actor',true),
  set_config('request.jwt.claims',jsonb_build_object('sub',:'writer_actor','role','authenticated','session_id',:'revoked_session')::text,true);
delete from auth.sessions where id=:'revoked_session';
set local role service_role;
do $revoked_command$
begin
  begin
    perform public.gridex_change_customer_contact_v2(jsonb_build_object(
      'companyId',current_setting('gridex.writerfence.company'),'customerId',current_setting('gridex.writerfence.customer'),
      'actorUserId',current_setting('gridex.writerfence.actor'),'sessionId',current_setting('gridex.writerfence.session'),
      'mode','ops','reason','Synthetic revoked session','expectedRevision',0,
      'idempotencyKey','authoritative-revoked-command','changes',jsonb_build_object('phone','+4699999999')));
    raise exception 'authoritative_fixture_revoked_session_not_denied';
  exception when insufficient_privilege then
    if sqlerrm<>'profile_actor_forbidden' then raise; end if;
  end;
end;
$revoked_command$;
reset role;
set local role authenticated;
select pg_temp.assert_authoritative_raw_writers_denied();
reset role;
select set_config('request.jwt.claim.role','anon',true),
  set_config('request.jwt.claims',jsonb_build_object('sub',:'writer_actor','role','anon','session_id',:'revoked_session')::text,true);
set local role anon;
select pg_temp.assert_authoritative_raw_writers_denied();
reset role;

do $no_effects$
begin
  if pg_temp.authoritative_writer_snapshot() is distinct from current_setting('gridex.writerfence.before')::jsonb then
    raise exception 'authoritative_denial_left_a_row_or_effect'; end if;
end;
$no_effects$;

-- Preserve existing service writers and revision triggers. The ordinary
-- guarded command still commits one contact effect using a real current session.
select set_config('request.jwt.claim.sub',:'writer_actor',true),
  set_config('request.jwt.claim.role','service_role',true),
  set_config('request.jwt.claims',jsonb_build_object('sub',:'writer_actor','role','service_role','session_id',:'writer_session')::text,true);
set local role service_role;
do $allowed_command$
declare target jsonb; result jsonb;
begin
  select value into target from jsonb_array_elements(current_setting('gridex.writerfence.targets')::jsonb)
    where value->>'customerId'=current_setting('gridex.writerfence.customer');
  result:=public.gridex_change_customer_contact_v2(jsonb_build_object(
    'companyId',current_setting('gridex.writerfence.company'),'customerId',current_setting('gridex.writerfence.customer'),
    'contactId',target->>'contactId','actorUserId',current_setting('gridex.writerfence.writer'),
    'sessionId',current_setting('gridex.writerfence.writer_session'),'mode','ops','reason','Synthetic authorized command',
    'expectedRevision',0,'idempotencyKey','authoritative-allowed-command','changes',jsonb_build_object('phone','+46123456789')));
  if result->>'revision'<>'1' or result->>'changed'<>'true'
    or (select phone from public.customer_contacts where id=(target->>'contactId')::uuid)<>'+46123456789'
    or (select email from public.customers where id=(target->>'customerId')::uuid)<>'own@example.invalid'
    or (select count(*) from public.canonical_event_outbox where company_id=(target->>'companyId')::uuid and topic='customer.contact.changed')<>1 then
    raise exception 'authoritative_guarded_service_command_changed'; end if;
end;
$allowed_command$;
update public.customers set preferred_language='en',first_name='Allowed fixture service'
  where id=current_setting('gridex.writerfence.other')::uuid;
update public.customer_contacts set title='Allowed fixture service'
  where customer_id=current_setting('gridex.writerfence.other')::uuid;
-- The address book has an additional command guard for trusted legacy
-- writers. Use the real guarded command, preserving that separate fence.
do $allowed_address_command$
declare target jsonb; revision bigint; result jsonb;
begin
  select value into target from jsonb_array_elements(current_setting('gridex.writerfence.targets')::jsonb)
    where value->>'customerId'=current_setting('gridex.writerfence.other');
  select address_book_revision into revision from public.customers where id=(target->>'customerId')::uuid;
  result:=public.gridex_change_customer_address_book_v1(jsonb_build_object(
    'companyId',target->>'companyId','customerId',target->>'customerId','addressId',target->>'addressId',
    'actorUserId',current_setting('gridex.writerfence.writer'),'sessionId',current_setting('gridex.writerfence.writer_session'),
    'reason','Synthetic authorized address command','idempotencyKey','authoritative-allowed-address-command',
    'expectedRevision',revision,'changes',jsonb_build_object('type','billing','street_1','Synthetic 1','street_2',null,
      'postal_code','12345','city','Lund','country','SE','municipality',null,'moved_in_at',null,'moved_out_at',null,'is_active',true)));
  if result->>'changed'<>'true' or (result->>'revision')::bigint<>revision+1
    or (select city from public.customer_addresses where id=(target->>'addressId')::uuid)<>'Lund' then
    raise exception 'authoritative_guarded_address_command_changed'; end if;
end;
$allowed_address_command$;
update public.customer_sites set care_of='Allowed fixture service'
  where customer_id=current_setting('gridex.writerfence.other')::uuid;
do $allowed_triggers$
declare site jsonb; original_site jsonb;
begin
  if (select profile_revision from public.customers where id=current_setting('gridex.writerfence.other')::uuid)<>1
    or (select legal_profile_revision from public.customers where id=current_setting('gridex.writerfence.other')::uuid)<>1
    or (select address_revision from public.customer_sites where customer_id=current_setting('gridex.writerfence.other')::uuid)<>1 then
    raise exception 'authoritative_existing_revision_triggers_changed'; end if;
  select to_jsonb(s) into site from public.customer_sites s
    where customer_id=current_setting('gridex.writerfence.other')::uuid;
  select value into original_site from jsonb_array_elements(current_setting('gridex.writerfence.before')::jsonb->'sites')
    where value->>'id'=site->>'id';
  if site ? 'site_revision' and (site->>'site_revision')::bigint<>(original_site->>'site_revision')::bigint+1 then
    raise exception 'authoritative_existing_site_revision_trigger_changed'; end if;
end;
$allowed_triggers$;
reset role;
select 'CUSTOMER_AUTHORITATIVE_WRITER_FENCES_NATIVE_PASS real_session_claims=true denied_permission=true revoked_jwt=true own_foreign_denied=true rpc_overloads=true column_acl=true rows_effects_unchanged=true service_commands=true triggers_preserved=true' as result;
rollback;
