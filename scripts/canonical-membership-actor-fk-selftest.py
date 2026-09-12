#!/usr/bin/env python3
"""Test actor FK reconstruction only in fixed disposable local PG17 databases."""
from pathlib import Path
import argparse
import subprocess

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = '20260907121951_canonical_membership_actor_fk_reconstruction.sql'
ADMIN = 'postgresql://postgres:postgres@127.0.0.1:55440/gridex_auth_test'


def run(url, sql, succeeds=True, error=None):
    result = subprocess.run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', url], input=sql, text=True, capture_output=True)
    if succeeds:
        assert result.returncode == 0, result.stderr
    else:
        assert result.returncode != 0 and error in result.stderr, result.stderr
    return result


def setup(mode):
    core = (ROOT / 'supabase/migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql').read_text()
    start = core.index('create table if not exists public.company_memberships (')
    membership = core[start:core.index('\n);', start) + 4]
    sql = '''create schema auth;
create table auth.users(id uuid primary key);
create table companies(id uuid primary key);
create function test_assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
select test_assert(current_setting('server_version_num')::int / 10000=17,'PG17');
insert into auth.users values ('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
insert into companies values ('20000000-0000-0000-0000-000000000001');
'''
    sql += membership
    sql += '''insert into company_memberships(company_id,user_id,status,role) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','suspended','member');
alter table company_memberships enable row level security;
create policy fixture_deny on company_memberships for all using(false) with check(false);
create table policies_before as select * from pg_policies where schemaname='public';
'''
    if mode != 'missing':
        sql += '''alter table company_memberships add column disabled_by uuid, add column removed_by uuid;
update company_memberships set disabled_by='10000000-0000-0000-0000-000000000002', removed_by='10000000-0000-0000-0000-000000000002';
'''
    if mode == 'dirty':
        sql += "update company_memberships set disabled_by='90000000-0000-0000-0000-000000000009';\n"
    if mode == 'conflict':
        sql += '''update company_memberships set disabled_by='20000000-0000-0000-0000-000000000001';
alter table company_memberships add constraint company_memberships_disabled_by_fkey foreign key(disabled_by) references companies(id);
'''
    sql += "create table rows_before as select to_jsonb(t)-array['disabled_by','removed_by'] as row from company_memberships t;\n"
    if mode != 'missing':
        sql += 'create table actors_before as select id,disabled_by,removed_by from company_memberships;\n'
    return sql


CHECK = '''select test_assert((select count(*)=2 from pg_constraint where conrelid='company_memberships'::regclass and conname in ('company_memberships_disabled_by_fkey','company_memberships_removed_by_fkey') and contype='f' and confrelid='auth.users'::regclass and confdeltype='n' and convalidated),'both validated actor FKs');
'''
PRESERVED = '''select test_assert(not exists((select row from rows_before except select to_jsonb(t)-array['disabled_by','removed_by'] from company_memberships t) union all (select to_jsonb(t)-array['disabled_by','removed_by'] from company_memberships t except select row from rows_before)),'existing membership identity/status/timestamps preserved');
select test_assert(not exists((select * from policies_before except select * from pg_policies where schemaname='public') union all (select * from pg_policies where schemaname='public' except select * from policies_before)),'policies unchanged');
select test_assert((select relrowsecurity from pg_class where oid='company_memberships'::regclass),'RLS unchanged');
'''


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emit', action='store_true')
    args = parser.parse_args()
    repair = (ROOT / 'supabase/migrations' / MIGRATION).read_text()
    if args.emit:
        print(setup('existing') + repair + CHECK + PRESERVED)
        raise SystemExit(0)
    for mode in ['existing', 'missing', 'dirty', 'conflict']:
        database = 'gridex_actor_fk_' + mode
        run(ADMIN, 'create database ' + database + ';')
        url = 'postgresql://postgres:postgres@127.0.0.1:55440/' + database
        run(url, setup(mode))
        if mode in ('existing', 'missing'):
            run(url, CHECK, False, 'both validated actor FKs')
            for _ in range(2):
                run(url, repair)
                run(url, CHECK + PRESERVED)
            if mode == 'existing':
                run(url, "select test_assert(not exists(select * from actors_before except select id,disabled_by,removed_by from company_memberships),'actor identities preserved');")
                run(url, "delete from auth.users where id='10000000-0000-0000-0000-000000000002'; select test_assert((select disabled_by is null and removed_by is null and status='suspended' from company_memberships),'actor deletion clears references without reactivating member');")
        else:
            error = 'foreign key constraint' if mode == 'dirty' else 'MEMBERSHIP_ACTOR_FK_DEFINITION_MISMATCH'
            run(url, repair, False, error)
            run(url, PRESERVED + "select test_assert(not exists((select * from actors_before except select id,disabled_by,removed_by from company_memberships) union all (select id,disabled_by,removed_by from company_memberships except select * from actors_before)),'failed repair preserves actor data'); select test_assert(not exists(select 1 from pg_constraint where conrelid='company_memberships'::regclass and conname='company_memberships_removed_by_fkey'),'failed repair does not partially add constraints');")
        print('PASS: membership actor FK scenario ' + mode)
