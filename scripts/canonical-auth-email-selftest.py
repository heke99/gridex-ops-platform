#!/usr/bin/env python3
"""Whole auth source and normalization on a fixed disposable PostgreSQL 17 target."""
from pathlib import Path
import argparse
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def sql():
    bootstrap = (ROOT / 'scripts/sql/gridex-supabase-compatible-bootstrap.sql').read_text()
    role = bootstrap[bootstrap.index('create or replace function auth.role()'):bootstrap.index('create or replace function auth.email()')]
    source = (ROOT / 'supabase/migrations/20260519_auth_callback_email_reset_sync.sql').read_text()
    normalize = (ROOT / 'supabase/migrations/20260520_user_profiles_auth_action_constraint_hardfix.sql').read_text()
    fixture = '''create schema auth;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, confirmed_at timestamptz, last_sign_in_at timestamptz);
create function public.test_assert(ok boolean, label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
'''
    fixture += role + (ROOT / 'supabase/bootstrap/20260519_user_profiles_foundation.sql').read_text()
    fixture += '''select test_assert(current_setting('server_version_num')::int / 10000=17,'PostgreSQL 17');
select test_assert(to_regclass('auth_email_events') is null,'narrow bootstrap omits event table');
insert into auth.users values
 ('10000000-0000-0000-0000-000000000001','auth1@example.invalid','2026-01-02Z','2026-01-01Z','2026-02-01Z'),
 ('10000000-0000-0000-0000-000000000002','auth2@example.invalid',null,'2026-01-03Z',null);
insert into user_profiles(id,email,full_name,user_status,last_auth_email_action)
values ('10000000-0000-0000-0000-000000000001','preserved@example.invalid','preserve','suspended','invite_sent');
select test_assert((select count(*)=0 from pg_trigger where tgrelid='user_profiles'::regclass and not tgisinternal),'reviewed boundary has no application triggers');
'''
    checks = '''select test_assert((select count(*)=2 from user_profiles),'one profile per auth user');
select test_assert((select email='preserved@example.invalid' and full_name='preserve' and user_status='suspended' and last_auth_email_action='invite_sent' and auth_email_confirmed_at='2026-01-02Z'::timestamptz and auth_last_sign_in_at='2026-02-01Z'::timestamptz and auth_last_synced_at is not null from user_profiles where id='10000000-0000-0000-0000-000000000001'),'existing identity/status preserved; auth sync applied');
select test_assert((select email='auth2@example.invalid' and auth_email_confirmed_at='2026-01-03Z'::timestamptz and user_status='active' from user_profiles where id='10000000-0000-0000-0000-000000000002'),'missing profile created with confirmed_at fallback');
select test_assert((select count(*)=3 from pg_indexes where schemaname='public' and indexname in ('auth_email_events_user_created_idx','auth_email_events_email_created_idx','auth_email_events_action_status_idx')),'three event indexes');
select test_assert((select count(*)=2 from pg_constraint where conrelid='auth_email_events'::regclass and contype='f' and confrelid='auth.users'::regclass and confdeltype='n'),'both event actor FKs set null');
select test_assert((select relrowsecurity from pg_class where oid='auth_email_events'::regclass),'event RLS enabled');
select test_assert((select count(*)=1 from pg_policies where schemaname='public' and tablename='auth_email_events' and policyname='auth_email_events_service_role_all' and cmd='ALL'),'single idempotent service policy');
'''
    fixture += source + checks
    fixture += '''insert into auth_email_events(user_id,actor_user_id,email,action,status,message)
select id,id,email,'email_confirmed','completed','preserve' from auth.users;
create temporary table event_before as select * from auth_email_events;
'''
    fixture += source + checks
    fixture += '''select test_assert(not exists((select * from auth_email_events except select * from event_before) union all (select * from event_before except select * from auth_email_events)),'existing event rows unchanged on reapply');
do $$ begin
 begin insert into auth_email_events(action) values ('unknown'); raise exception 'FAIL: invalid action accepted'; exception when check_violation then null; end;
 begin insert into auth_email_events(action,status) values ('invite_sent','unknown'); raise exception 'FAIL: invalid event status accepted'; exception when check_violation then null; end;
end $$;
create role auth_fixture_reader nologin;
grant usage on schema public,auth to auth_fixture_reader;
grant select on auth_email_events to auth_fixture_reader;
set role auth_fixture_reader;
set request.jwt.claim.role='authenticated';
select test_assert((select count(*)=0 from auth_email_events),'authenticated denied by actual event policy');
set request.jwt.claim.role='anon';
select test_assert((select count(*)=0 from auth_email_events),'anon denied by actual event policy');
set request.jwt.claim.role='service_role';
select test_assert((select count(*)=2 from auth_email_events),'service claim satisfies actual event policy');
reset role;
'''
    fixture += normalize + normalize
    fixture += '''update user_profiles set last_auth_email_action='custom.action:v2';
select test_assert((select bool_and(last_auth_email_action='custom.action:v2') from user_profiles),'normalization follows auth source, preserving final flexible metadata grammar');
select test_assert((select email='preserved@example.invalid' and user_status='suspended' from user_profiles where id='10000000-0000-0000-0000-000000000001'),'combined chain preserves existing profile identity/status');
'''
    return fixture


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emit', action='store_true')
    args = parser.parse_args()
    statement = sql()
    if args.emit:
        print(statement)
    else:
        subprocess.run(['psql', '-X', '-v', 'ON_ERROR_STOP=1',
                        'postgresql://postgres:postgres@127.0.0.1:55440/gridex_auth_test'],
                       input=statement, text=True, check=True)
        print('PASS: full auth source twice and successor normalization; backfill, event constraints/FKs/RLS, existing data and final grammar verified')
