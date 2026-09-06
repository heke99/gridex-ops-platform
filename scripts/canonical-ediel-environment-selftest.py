#!/usr/bin/env python3
"""Isolated source-effects test, never a canonical replay or production parity proof."""
from pathlib import Path
import argparse
import subprocess

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / 'supabase/migrations'


def read(name):
    return (MIGRATIONS / name).read_text()


def statement(name, start):
    text = read(name)
    offset = text.index(start)
    return text[offset:text.index(';', offset) + 1] + '\n'


def script():
    sql = '''create extension pgcrypto;
create schema auth;
create table auth.users(id uuid primary key);
create table public.companies(id uuid primary key);
create table public.ediel_actor_settings(id uuid primary key);
create table public.ediel_mailboxes(id uuid primary key);
create table public.communication_routes(id uuid primary key);
'''
    auth = (ROOT / 'scripts/sql/gridex-supabase-compatible-bootstrap.sql').read_text()
    sql += auth[auth.index('create or replace function auth.role()'):auth.index('create or replace function auth.email()')]
    # Actual predecessor statements, deliberately scoped; not whole-chain provenance.
    sql += statement('20260522_db1_schema_repair_backfill_foundation.sql', 'create table if not exists public.ediel_route_profiles (')
    sql += statement('20260530152700_batch_1_2_ediel_actor_configuration.sql', 'alter table if exists public.ediel_route_profiles\n')
    sql += statement('20260601093000_ediel_actor_identity_source_of_truth.sql', 'alter table if exists public.ediel_route_profiles\n')
    sql += statement('20260602101500_ediel_shared_mailbox_subaddress_security.sql', 'alter table if exists public.ediel_route_profiles\n')
    sql += (ROOT / 'supabase/bootstrap/20260521_ediel_test_runs_foundation.sql').read_text()
    sql += statement('20260602090000_ediel_operations_platform_core.sql', 'create table if not exists public.ediel_outbound_queue (')
    sql += statement('20260601093000_ediel_actor_identity_source_of_truth.sql', 'create table if not exists public.ediel_route_history (')
    sql += statement('20260601093000_ediel_actor_identity_source_of_truth.sql', 'create unique index if not exists ediel_route_history_route_version_idx')
    sql += '''insert into companies values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
insert into ediel_route_profiles(company_id,environment,route_name) select '00000000-0000-0000-0000-000000000001', e,e from unnest(array['production','bilateral','tgt','test']) e;
'''
    trigger = read('20260601184500_ediel_runtime_hardening_rls_route_history.sql')
    sql += trigger[trigger.index('create or replace function public.gridex_capture_ediel_route_profile_history()'):trigger.rindex('commit;')]
    sql += '''create function public.test_assert(ok boolean, label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %', label; end if; end $$;
select test_assert(to_regclass('public.ediel_test_run_locks') is null, 'missing baseline locks');
select test_assert(to_regclass('public.ediel_agt_readiness') is null, 'missing baseline readiness');
select test_assert(to_regclass('public.ediel_unlinked_test_messages') is null, 'missing baseline unlinked');
'''
    source = read('20260602143000_ediel_environment_business_action_locks.sql')
    successor = read('20260602152000_ediel_operations_completion_hardening.sql')
    sql += source
    sql += '''select test_assert((select count(*)=4 from ediel_route_history), 'backfill fires actual history trigger');
select test_assert((select bool_and(environment_type::text=case environment when 'production' then 'production' when 'bilateral' then 'bilateral_test' when 'tgt' then 'tgt_test' else 'agt_test' end) from ediel_route_profiles), 'four environment mappings');
select test_assert(to_regclass('public.ediel_exchange_logs') is null, 'guarded pre-successor alter is a no-op');
insert into ediel_route_profiles(company_id,environment,environment_type,route_name) values ('00000000-0000-0000-0000-000000000001','production','tgt_test','explicit');
'''
    sql += successor + source + successor
    sql += (ROOT / 'scripts/sql/canonical-ediel-environment-assertions.sql').read_text()
    return sql


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emit', action='store_true', help='Print composed SQL without executing')
    args = parser.parse_args()
    sql = script()
    if args.emit:
        print(sql)
    else:
        # Fixed disposable target: no DATABASE_URL or arbitrary destination accepted.
        subprocess.run(['psql', '-X', '-v', 'ON_ERROR_STOP=1',
                        'postgresql://postgres:postgres@127.0.0.1:55439/gridex_ediel_test'],
                       input=sql, text=True, check=True)
        print('PASS: complete Ediel source and successor executed twice on isolated PostgreSQL')
