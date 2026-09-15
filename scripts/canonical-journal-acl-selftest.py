#!/usr/bin/env python3
"""Fixed isolated PostgreSQL17 journal ACL controls; no hosted connection input."""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import canonical_journal_acl as acl

ADMIN = 'postgresql://postgres:postgres@127.0.0.1:55440/gridex_auth_test'
TARGET = 'postgresql://postgres:postgres@127.0.0.1:55440/gridex_journal_acl_fixture'


def sql(text, target=TARGET):
    env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
    result = subprocess.run(['psql', '-X', '-qAt', '--set=ON_ERROR_STOP=1', target, '-f', '-'],
                            input=text, text=True, capture_output=True, env=env, cwd=ROOT, timeout=60)
    assert result.returncode == 0, 'JOURNAL_ACL_FIXTURE_SQL_FAILED'
    return result.stdout.strip()


def selected():
    import canonical_full_governance_contract as contract
    name, _lines, expected = contract.WHOLE_SOURCES['6D2']
    raw = (ROOT / 'supabase/migrations' / name).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == expected
    text = raw.decode()
    start = text.index('create table if not exists public.platform_session_revocations (')
    end = text.index('\n);', start) + 3
    return text[start:end]


def static():
    import canonical_full_governance_sql as oracle
    assert len(acl.EXPECTED) == len(set(acl.EXPECTED)) == 32
    assert all(not grantable and grantor == 'postgres' for _, _, grantable, grantor in acl.EXPECTED)
    assert {r for r, _, _, _ in acl.EXPECTED} == set(acl.ROLES)
    assert all(r != 'PUBLIC' for r, _, _, _ in acl.EXPECTED)
    assert acl.matches_sql() in oracle.completion_shape_sql()
    assert 'relacl is null' not in oracle.completion_shape_sql()
    selected()
    print('PASS exact32 ACL source controls; not SQL execution')


def execute():
    bootstrap = (ROOT / 'scripts/sql/gridex-supabase-compatible-bootstrap.sql').read_text()
    assert sql('select current_database()', ADMIN) == 'gridex_auth_test'
    assert sql("select current_user='postgres' and current_setting('server_version_num')::int/10000=17", ADMIN) == 't'
    assert sql("select count(*) from pg_database where datname='gridex_journal_acl_fixture'", ADMIN) == '0'
    sql('create database gridex_journal_acl_fixture', ADMIN)
    try:
        sql(bootstrap + '\n' + selected())
        query = "select " + acl.matches_sql() + " from pg_class c where c.oid='public.platform_session_revocations'::regclass"
        assert sql(query) == 't', 'INITIAL_EXACT_MANAGED_ACL_REQUIRED'
        changes = (
            ('revoke select on public.platform_session_revocations from anon',
             'grant select on public.platform_session_revocations to anon'),
            ('grant select on public.platform_session_revocations to public',
             'revoke select on public.platform_session_revocations from public'),
            ('grant update on public.platform_session_revocations to authenticated with grant option',
             'revoke grant option for update on public.platform_session_revocations from authenticated'),
        )
        for mutation, restore in changes:
            sql(mutation)
            assert sql(query) == 'f', 'ACL_MUTATION_MUST_BE_REJECTED'
            sql(restore)
            assert sql(query) == 't', 'RESTORED_ACL_MUST_MATCH'
        sql('create schema journal_private; create table journal_private.no_defaults(id integer)')
        null_query = query.replace('public.platform_session_revocations', 'journal_private.no_defaults')
        assert sql(null_query) == 'f', 'NULL_ACL_IS_NOT_MANAGED_DEFAULTS'
        print('PASS actual PostgreSQL17: exact managed ACL; missing grant, PUBLIC grant, grant option and NULL ACL rejected; restoration verified')
    finally:
        sql('drop database gridex_journal_acl_fixture with (force)', ADMIN)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--selection-only', action='store_true')
    args = parser.parse_args()
    static()
    if not args.selection_only:
        execute()
