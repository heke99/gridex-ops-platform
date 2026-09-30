\set ON_ERROR_STOP on
-- Actual restored roles, RLS, current session authority and command execution.
-- Every proof mutation (including successful command and revocation) rolls
-- back; the script runner compares backup data fingerprints again afterwards.
begin;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated',
 'sub','e4954930-0000-4000-8000-000000000011',
 'session_id','e4954930-0000-4000-8000-000000000021')::text,true) as jwt_claims \gset
set local role authenticated;
do $authenticated$
declare denied boolean:=false;
begin
 if auth.uid() is distinct from 'e4954930-0000-4000-8000-000000000011'::uuid
  or (select count(*) from public.customers where id='e4954930-0000-4000-8000-000000000031') <> 1
  or exists(select 1 from public.customers where company_id='e4954930-0000-4000-8000-000000000002') then
  raise exception 'restore_authenticated_own_read_or_foreign_tenant_rls_failed'; end if;
 begin update public.customers set email='bypass@example.invalid'
  where id='e4954930-0000-4000-8000-000000000031';
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'restore_authenticated_raw_writer_acl_not_restored'; end if;
 denied:=false;
 begin perform public.gridex_db4b_archive_customer_registry_row('customers',
  'e4954930-0000-4000-8000-000000000031',true,'Synthetic restore denial');
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'restore_authenticated_legacy_archive_acl_not_restored'; end if;
 denied:=false;
 begin perform public.gridex_change_customer_billing_profile_v1('{}');
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'restore_authenticated_billing_command_acl_not_restored'; end if;
end;
$authenticated$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true) as jwt_claims \gset
set local role anon;
do $anonymous$
declare denied boolean:=false;
begin
 if auth.uid() is not null then
  raise exception 'restore_anonymous_tenant_read_denial_failed'; end if;
 -- The pinned secure baseline grants no anon SELECT. Both an actual 42501
 -- and an allowed SELECT returning zero rows prove this negative read path;
 -- do not add a grant merely so the fixture can execute its SELECT.
 begin
  if exists(select 1 from public.customers where company_id in
   ('e4954930-0000-4000-8000-000000000001','e4954930-0000-4000-8000-000000000002')) then
   raise exception 'restore_anonymous_tenant_read_denial_failed'; end if;
 exception when insufficient_privilege then null; end;
 begin update public.customers set email='anonymous-bypass@example.invalid'
  where id='e4954930-0000-4000-8000-000000000031';
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'restore_anonymous_raw_writer_acl_not_restored'; end if;
 denied:=false;
 begin perform public.gridex_change_customer_billing_profile_v1('{}');
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'restore_anonymous_command_acl_not_restored'; end if;
end;
$anonymous$;
\echo TENANTSERVICE_RESTORE_AUTHENTICATED_ANON_ACL_AND_TENANT_RLS_PASS

reset role;
select set_config('request.jwt.claims','{}',true) as jwt_claims \gset
set local role service_role;
do $current_authority$
declare command jsonb:=jsonb_build_object('companyId','e4954930-0000-4000-8000-000000000001',
 'customerId','e4954930-0000-4000-8000-000000000031',
 'actorUserId','e4954930-0000-4000-8000-000000000011',
 'sessionId','e4954930-0000-4000-8000-000000000021','mode','ops',
 'reason','Synthetic independently authorized restore proof','expectedRevision',0,
 'idempotencyKey','tenantservice-restore-positive','changes',jsonb_build_object('email','restored-billing@example.invalid'));
 denied boolean:=false; result jsonb; replay jsonb;
begin
 if not has_function_privilege('service_role','public.gridex_change_customer_billing_profile_v1(jsonb)','EXECUTE')
  or has_function_privilege('authenticated','public.gridex_change_customer_billing_profile_v1(jsonb)','EXECUTE')
  or has_function_privilege('anon','public.gridex_change_customer_billing_profile_v1(jsonb)','EXECUTE') then
  raise exception 'restore_billing_rpc_effective_grant_mismatch'; end if;
 begin perform public.gridex_change_customer_billing_profile_v1(command||jsonb_build_object(
  'companyId','e4954930-0000-4000-8000-000000000002','customerId','e4954930-0000-4000-8000-000000000032',
  'idempotencyKey','tenantservice-restore-foreign'));
 exception when insufficient_privilege then denied:=sqlerrm='billing_profile_actor_forbidden'; end;
 if not denied then raise exception 'restore_service_command_foreign_tenant_not_denied'; end if;
 denied:=false;
 begin perform public.gridex_change_customer_billing_profile_v1(command||jsonb_build_object(
  'actorUserId','e4954930-0000-4000-8000-000000000012','sessionId','e4954930-0000-4000-8000-000000000022',
  'idempotencyKey','tenantservice-restore-permission-denied'));
 exception when insufficient_privilege then denied:=sqlerrm='billing_profile_actor_forbidden'; end;
 if not denied then raise exception 'restore_service_command_explicit_permission_deny_lost'; end if;
 if exists(select 1 from public.canonical_command_results
   where company_id in ('e4954930-0000-4000-8000-000000000001','e4954930-0000-4000-8000-000000000002'))
  or exists(select 1 from public.canonical_domain_events where idempotency_key in
    ('tenantservice-restore-foreign','tenantservice-restore-permission-denied'))
  or exists(select 1 from public.canonical_audit_events where idempotency_key in
    ('tenantservice-restore-foreign','tenantservice-restore-permission-denied'))
  or exists(select 1 from public.canonical_event_outbox where idempotency_key in
    ('tenantservice-restore-foreign','tenantservice-restore-permission-denied'))
  or (select billing_profile_revision from public.customers where id='e4954930-0000-4000-8000-000000000031')<>0
  or (select email from public.customers where id='e4954930-0000-4000-8000-000000000031')<>'contact-only@example.invalid' then
  raise exception 'restore_denied_command_changed_existing_rows_or_results'; end if;
 result:=public.gridex_change_customer_billing_profile_v1(command);
 replay:=public.gridex_change_customer_billing_profile_v1(command);
 if result->>'revision' is distinct from '1' or result->>'changed' is distinct from 'true'
  or replay->>'replayed' is distinct from 'true' or replay->>'revision' is distinct from '1'
  or (select billing_profile->>'email' from public.customers where id='e4954930-0000-4000-8000-000000000031')
      is distinct from 'restored-billing@example.invalid'
  or (select email from public.customers where id='e4954930-0000-4000-8000-000000000031')
      is distinct from 'contact-only@example.invalid'
  or (select count(*) from public.canonical_command_results where company_id='e4954930-0000-4000-8000-000000000001'
      and idempotency_key='tenantservice-restore-positive')<>1
  or (select count(*) from public.canonical_audit_events where company_id='e4954930-0000-4000-8000-000000000001'
      and idempotency_key='tenantservice-restore-positive')<>1
  or (select count(*) from public.canonical_domain_events where company_id='e4954930-0000-4000-8000-000000000001'
      and idempotency_key='tenantservice-restore-positive' and event_type='CUSTOMER_BILLING_PROFILE_CHANGED'
      and aggregate_id='e4954930-0000-4000-8000-000000000031' and aggregate_version=1)<>1
  or (select count(*) from public.canonical_event_outbox where company_id='e4954930-0000-4000-8000-000000000001'
      and idempotency_key='tenantservice-restore-positive' and topic='customer.billing_profile.changed')<>1
  or (select count(*) from public.canonical_event_outbox o join public.canonical_domain_events e
      on e.id=o.domain_event_id and e.company_id=o.company_id and e.idempotency_key=o.idempotency_key
      where o.company_id='e4954930-0000-4000-8000-000000000001'
      and o.idempotency_key='tenantservice-restore-positive')<>1 then
  raise exception 'restore_authorized_atomic_billing_write_or_replay_failed'; end if;
 perform set_config('gridex.restoreproof.command',command::text,true);
end;
$current_authority$;
\echo TENANTSERVICE_RESTORE_CURRENT_PERMISSION_FOREIGN_TENANT_COMMAND_DENIAL_PASS
\echo TENANTSERVICE_RESTORE_AUTHORIZED_ATOMIC_COMMAND_AND_REPLAY_PASS

reset role;
update auth.sessions set not_after=clock_timestamp()-interval '1 second'
 where id='e4954930-0000-4000-8000-000000000021';
set local role service_role;
do $expired$
declare denied boolean:=false;
begin
 begin perform public.gridex_change_customer_billing_profile_v1(current_setting('gridex.restoreproof.command')::jsonb);
 exception when insufficient_privilege then denied:=sqlerrm='billing_profile_actor_forbidden'; end;
 if not denied then raise exception 'restore_expired_session_authorized_cached_replay'; end if;
end;
$expired$;
reset role;
delete from auth.sessions where id='e4954930-0000-4000-8000-000000000021';
set local role service_role;
do $revoked$
declare denied boolean:=false; immutable boolean:=false;
begin
 begin perform public.gridex_change_customer_billing_profile_v1(current_setting('gridex.restoreproof.command')::jsonb);
 exception when insufficient_privilege then denied:=sqlerrm='billing_profile_actor_forbidden'; end;
 if not denied or (select billing_profile_revision from public.customers
  where id='e4954930-0000-4000-8000-000000000031')<>1
  or (select count(*) from public.canonical_command_results
    where company_id='e4954930-0000-4000-8000-000000000001')<>1
  or (select count(*) from public.canonical_domain_events
    where company_id='e4954930-0000-4000-8000-000000000001'
      and idempotency_key='tenantservice-restore-positive')<>1
  or (select count(*) from public.canonical_audit_events
    where company_id='e4954930-0000-4000-8000-000000000001'
      and idempotency_key='tenantservice-restore-positive')<>1
  or (select count(*) from public.canonical_event_outbox
    where company_id='e4954930-0000-4000-8000-000000000001'
      and idempotency_key='tenantservice-restore-positive')<>1 then
  raise exception 'restore_revoked_session_changed_result_or_customer'; end if;
 begin update public.customer_invoices set calculation_snapshot='{"synthetic":"forbidden-rewrite"}'
   where id='e4954930-0000-4000-8000-000000000071';
 exception when object_not_in_prerequisite_state then immutable:=sqlerrm='issued_invoice_portfolio_evidence_immutable'; end;
 if not immutable then raise exception 'restore_issued_invoice_calculation_immutability_lost'; end if;
 immutable:=false;
 begin update public.billing_underlays set billing_configuration_snapshot='{"synthetic":"forbidden-rewrite"}'
   where id='e4954930-0000-4000-8000-000000000061';
 exception when check_violation then immutable:=sqlerrm='billing_configuration_snapshot_is_immutable'; end;
 if not immutable then raise exception 'restore_locked_legacy_billing_snapshot_immutability_lost'; end if;
end;
$revoked$;
\echo TENANTSERVICE_RESTORE_EXPIRED_AND_REVOKED_SESSION_REPLAY_DENIAL_PASS
\echo TENANTSERVICE_RESTORE_ISSUED_INVOICE_LOCKED_SNAPSHOT_GUARDS_PASS
rollback;
