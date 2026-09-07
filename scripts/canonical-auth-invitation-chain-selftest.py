#!/usr/bin/env python3
"""Characterize historical auth sources after auth/POA fixtures; not replay approval."""
import argparse
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
TARGET = 'postgresql://postgres:postgres@127.0.0.1:55440/gridex_auth_test'


def read(path):
    return (ROOT / path).read_text()


def source(name):
    return read('supabase/migrations/' + name + '.sql')


def table(body, name):
    start = body.index('create table if not exists public.' + name + ' (')
    return body[start:body.index('\n);', start) + 4]


def statements(wrong_order=False):
    core = source('01_db1_schema_repair_core_helpers_and_canonical_tables')
    platform = read('scripts/sql/gridex-supabase-compatible-bootstrap.sql')
    template = source('20260519_auth_email_templates_invite_reset_sync')
    invite = source('20260519_company_invite_temp_password_sync')
    direct = source('20260520_direct_temporary_password_auth_sync_fix')
    cleanup = source('20260520_company_delete_backfill_and_admin_layout')
    normalize = source('20260520_user_profiles_auth_action_constraint_hardfix')
    sql = "begin; select test_assert(current_setting('server_version_num')::int / 10000=17,'PG17');\n"
    sql += platform[platform.index('create or replace function auth.uid()'):platform.index('create or replace function auth.role()')]
    for name in ['roles', 'user_roles', 'company_memberships', 'company_invitations']:
        sql += table(core, name)
    # The preceding POA fixture supplies only companies(id). These two fields
    # model the core prerequisite, not a production schema repair.
    sql += "alter table companies add column status text default 'active', add column updated_at timestamptz default now();\n"
    sql += read('supabase/bootstrap/20260519_companies_governance_foundation.sql')
    sql += '''create temporary table profiles_identity_before as
select id,email,full_name,phone,created_at,updated_at from user_profiles;
create temporary table event_identity_before as
select id,user_id,actor_user_id,email,action,message,metadata,created_at from auth_email_events;
select test_assert((select count(*)=2 from auth_email_events where status='completed'),'completed auth predecessor fixture');
'''
    sql += template + template
    sql += '''select test_assert((select count(*)=2 from auth_email_events where status='completed'),'template preserves predecessor event status');
select test_assert((select count(*)=2 from pg_policies where schemaname='public' and tablename='auth_email_events'),'both historical policies materialized, not approved');
select test_assert((select count(*)=3 from information_schema.columns where table_schema='public' and table_name='auth_email_events' and column_name in ('company_id','event_type','source')),'template event columns');
'''
    if wrong_order:
        return sql + cleanup + '\nrollback;\n'
    sql += '''insert into company_memberships(company_id,user_id,membership_role,status)
values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','member','suspended');
insert into company_invitations(company_id,email,membership_role)
values ('20000000-0000-0000-0000-000000000001','synthetic@example.invalid','member');
'''
    sql += invite + invite
    sql += '''select test_assert((select count(*)=2 from auth_email_events where status='sent' and event_type='unknown'),'historical invite source maps completed to sent and missing event type to unknown');
select test_assert((select user_status='disabled' from user_profiles where id='10000000-0000-0000-0000-000000000001'),'historical suspended profile maps to disabled');
select test_assert((select count(*)=2 from pg_indexes where indexname in ('company_memberships_company_user_uidx','company_invitations_accept_token_hash_uidx')),'unique source indexes');
update company_invitations set invited_user_id='10000000-0000-0000-0000-000000000001', temporary_password_issued_at='2026-01-01Z', temporary_password_expires_at='2026-01-02Z';
'''
    sql += direct
    sql += '''select test_assert((select status='accepted' and accepted_at is not null and metadata->>'login_ready'='true' from company_invitations),'historical direct source accepts issued invitation, including expired metadata: REVIEW REQUIRED');
select test_assert((select count(*)=2 from user_profiles where last_auth_email_action is null),'historical direct source erases flexible tracking action: REVIEW REQUIRED');
create temporary table accepted_before as select * from company_invitations;
'''
    sql += direct + cleanup + cleanup + normalize + normalize
    sql += '''select test_assert(not exists((select * from profiles_identity_before except select id,email,full_name,phone,created_at,updated_at from user_profiles) union all (select id,email,full_name,phone,created_at,updated_at from user_profiles except select * from profiles_identity_before)),'profile identity and timestamps preserved');
select test_assert(not exists((select * from event_identity_before except select id,user_id,actor_user_id,email,action,message,metadata,created_at from auth_email_events) union all (select id,user_id,actor_user_id,email,action,message,metadata,created_at from auth_email_events except select * from event_identity_before)),'event identity and payload preserved apart from characterized status/type changes');
select test_assert(not exists((select * from accepted_before except select * from company_invitations) union all (select * from company_invitations except select * from accepted_before)),'direct reapply and cleanup preserve accepted invitation');
select test_assert((select status='suspended' and membership_role='member' from company_memberships),'suspended membership is not reactivated');
select test_assert((select count(*)=1 from companies),'cleanup preserves existing company');
select test_assert((select relrowsecurity from pg_class where oid='auth_email_events'::regclass),'event RLS retained');
select test_assert((select count(*)=2 from pg_constraint where conrelid='auth_email_events'::regclass and contype='f' and confrelid='auth.users'::regclass),'event user FKs retained');
update user_profiles set last_auth_email_action='custom.action:v2';
select test_assert((select bool_and(last_auth_email_action='custom.action:v2') from user_profiles),'flexible normalization must follow direct source');
rollback;
'''
    return sql


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emit', action='store_true')
    args = parser.parse_args()
    if args.emit:
        print(statements())
    else:
        command = ['psql', '-X', '-v', 'ON_ERROR_STOP=1', TARGET]
        wrong = subprocess.run(command, input=statements(True), text=True, capture_output=True)
        assert wrong.returncode != 0 and 'auth_email_events_status_check' in wrong.stderr and 'violated by some row' in wrong.stderr, wrong.stderr
        print('PASS: cleanup before event normalization rejected; transaction rolled back')
        subprocess.run(command, input=statements(), text=True, check=True)
        print('PASS: complete four-source characterization; not authorization or replay approval')
