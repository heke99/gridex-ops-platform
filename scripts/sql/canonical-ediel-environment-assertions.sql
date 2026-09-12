select test_assert(current_setting('server_version_num')::int / 10000 = 17, 'PostgreSQL 17');
select test_assert((select count(*)=5 from ediel_route_history), 'second application does not duplicate route history');
select test_assert((select environment_type='tgt_test' from ediel_route_profiles where route_name='explicit'), 'existing environment preserved');
select test_assert((select count(*)=4 from ediel_business_deadline_rules), 'four idempotent reference rules');
select test_assert((select count(*)=8 from pg_policies where schemaname='public' and policyname like '%_service_role_all'), 'eight successor policies');
select test_assert((select count(*)=8 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity), 'eight successor RLS flags');
select test_assert((select count(*)=2 from pg_constraint where conname in ('ediel_agt_readiness_company_fkey','ediel_test_run_locks_company_fkey') and confdeltype='c'), 'readiness and locks company cascade FKs');
select test_assert((select count(*)=10 from information_schema.columns where table_schema='public' and ((table_name='ediel_agt_readiness' and column_name in ('invalidated_at','invalidated_by','invalidation_source','last_checked_at','last_checked_by','blocking_issues','readiness_snapshot')) or (table_name='ediel_unlinked_test_messages' and column_name in ('ediel_message_id','inbound_mail_item_id','resolution_notes')))), 'successor extends restored tables');
insert into ediel_outbound_queue(company_id,idempotency_key) select id,'same-key' from companies;
insert into ediel_test_run_locks(company_id,actor_role,message_family,environment_type,expires_at) select id,'supplier','PRODAT','agt_test',now()+interval '1 hour' from companies;
do $$ begin
  begin
    insert into ediel_outbound_queue(company_id,idempotency_key) values ('00000000-0000-0000-0000-000000000001','same-key');
    raise exception 'FAIL: duplicate queue key accepted';
  exception when unique_violation then null; end;
  begin
    insert into ediel_test_run_locks(company_id,actor_role,message_family,environment_type,expires_at) values ('00000000-0000-0000-0000-000000000001','supplier','PRODAT','agt_test',now());
    raise exception 'FAIL: duplicate active lock accepted';
  exception when unique_violation then null; end;
end $$;
update ediel_test_run_locks set released_at=now();
insert into ediel_test_run_locks(company_id,actor_role,message_family,environment_type,expires_at) select id,'supplier','PRODAT','agt_test',now() from companies;
select test_assert((select count(*)=4 from ediel_test_run_locks), 'released lock allows new lock per company');
-- Non-owner role exercises the real auth.role() policy expression, without BYPASSRLS.
create role ediel_fixture_reader nologin;
grant usage on schema public,auth to ediel_fixture_reader;
grant select on ediel_test_run_locks to ediel_fixture_reader;
set role ediel_fixture_reader;
set request.jwt.claim.role='authenticated';
select test_assert((select count(*)=0 from ediel_test_run_locks), 'authenticated has no service-policy access');
set request.jwt.claim.role='anon';
select test_assert((select count(*)=0 from ediel_test_run_locks), 'anon has no service-policy access');
set request.jwt.claim.role='service_role';
select test_assert((select count(*)=4 from ediel_test_run_locks), 'service claim satisfies actual policy');
reset role;
