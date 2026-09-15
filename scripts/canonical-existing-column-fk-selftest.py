#!/usr/bin/env python3
"""Bounded original-statement FK reproduction on an owned local PostgreSQL17.

This proves two missing inline REFERENCES effects, not full replay/schema parity.
Only the fixed CI loopback service is accepted; no hosted connection input.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
# Genuine CLI2.101.0 migration-new filename; staged outside the selected source
# set until isolated SQL acceptance and an explicit appended-source registration.
CANDIDATE = ROOT / 'scripts/sql/forward-candidates/20260915111458_restore_existing_column_foreign_keys.sql'
CANDIDATE_SHA = '5593bf9f66e2ea783ac37f23ca4f547132e70beb519a955dc5b2666a65db569c'
ADMIN = 'postgresql://postgres:postgres@127.0.0.1:55440/gridex_auth_test'
DATABASE = 'gridex_existing_column_fk_fixture'
TARGET = 'postgresql://postgres:postgres@127.0.0.1:55440/' + DATABASE
# F138 -> T64; reviewed residual before F100 -> T12. Select the complete ALTER
# statement from each pinned file, without executing unrelated historical SQL.
SOURCES = (
    ('20260526_batch_3a_3b_customer_intake_blockers_documents.sql',
     'fad2a3336c1bab86cd67d05d5f965643589864c259b500eb67bbafbcaa78cba8', 'customer_documents'),
    ('20260613090000_batch_m_ops_master_legal_readiness.sql',
     '599b707e9f979727fcf39843d88ee376c15409731a780befb01d2ed436ec842d', 'customer_documents'),
    ('20260601070000_ediel_production_readiness_hardening.sql',
     '7a73e59f559ebb5291d3e7df74545e6918011ec9764e5c512df19fbaa5bdbc12', 'ediel_route_profiles'),
    ('20260601093000_ediel_actor_identity_source_of_truth.sql',
     'f643bddd8fbaa8bedd1f55dcf57e2bb048e4409afca56ac078994e7af7fb1a67', 'ediel_route_profiles'),
)
PAIRS = (
    ('customer_documents', 'contract_id', 'customer_contracts', 'customer_documents_contract_id_fkey'),
    ('ediel_route_profiles', 'actor_setting_id', 'ediel_actor_settings', 'ediel_route_profiles_actor_setting_id_fkey'),
)
PARENT = '00000000-0000-0000-0000-000000000001'
CHILD = '00000000-0000-0000-0000-000000000002'
UNKNOWN = '00000000-0000-0000-0000-000000000003'
SETUP = '''
create table public.customer_contracts(id uuid primary key);
create table public.customer_documents(id uuid primary key, payload text default 'preserve');
create table public.ediel_actor_settings(id uuid primary key);
create table public.ediel_route_profiles(id uuid primary key, payload text default 'preserve');
alter table public.customer_documents enable row level security;
create policy fixture_documents on public.customer_documents using(true);
alter table public.ediel_route_profiles enable row level security;
create policy fixture_routes on public.ediel_route_profiles using(true);
grant select on public.customer_documents, public.ediel_route_profiles to public;
comment on table public.customer_documents is 'fixture metadata to preserve';
'''


def source_statement(name, digest, table, directory=ROOT / 'supabase/migrations'):
    path = directory / name
    if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise ValueError('IMMUTABLE_FK_SOURCE_CHANGED')
    matches = re.findall(r'(?im)^alter table (?:if exists )?public\.' + table + r'\s+[^;]+;', path.read_text())
    column = 'contract_id' if table == 'customer_documents' else 'actor_setting_id'
    matches = [statement for statement in matches if 'add column if not exists ' + column + ' uuid' in statement]
    if len(matches) != 1:
        raise ValueError('EXACT_SOURCE_STATEMENT_REQUIRED')
    return matches[0]


def check_result(result, expected=None, message=None):
    if expected is None:
        if result.returncode:
            raise ValueError('FIXTURE_SQL_FAILED')
    else:
        if not result.returncode:
            raise ValueError('EXPECTED_SQL_REJECTION')
        errors = re.findall(r'^.*?(ERROR|FATAL|PANIC):\s+([0-9A-Z]{5}): ([^\r\n]*)$', result.stderr, re.M)
        if (len(errors) != 1 or errors[0][:2] != ('ERROR', expected)
                or (message and errors[0][2].rstrip(' ') != message)):
            raise ValueError('UNQUALIFIED_SQL_FAILURE')
    return result.stdout.strip()


def read_candidate(path=CANDIDATE):
    if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != CANDIDATE_SHA:
        raise ValueError('FK_CANDIDATE_CHANGED')
    return path.read_text()


def sql(statement, *, admin=False, expected=None, message=None):
    env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
    result = subprocess.run(['psql', '-X', '-qAt', '--set=ON_ERROR_STOP=1',
                             '--set=VERBOSITY=verbose', ADMIN if admin else TARGET, '-f', '-'],
                            input=statement, capture_output=True, text=True, env=env, cwd=ROOT, timeout=90)
    return check_result(result, expected, message)


def catalog():
    # Include columns, defaults, ACL/RLS/policies, indexes and user triggers;
    # only the two intended FKs and their generated RI triggers are excluded.
    return sql('''select jsonb_build_object(
      'tables',(select jsonb_agg(jsonb_build_array(c.relname,c.relowner,c.relacl,c.reloptions,
        c.relrowsecurity,c.relforcerowsecurity,obj_description(c.oid)) order by c.relname)
        from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'),
      'columns',(select jsonb_agg(jsonb_build_array(c.relname,a.attnum,a.attname,a.atttypid,
        a.attnotnull,a.attacl,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),
        col_description(a.attrelid,a.attnum)) order by c.relname,a.attnum)
        from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
        left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped),
      'constraints',(select jsonb_agg(jsonb_build_array(conrelid::regclass::text,conname,
        pg_get_constraintdef(oid),convalidated,obj_description(oid,'pg_constraint')) order by conrelid,conname)
        from pg_constraint where connamespace='public'::regnamespace and conname not in
        ('customer_documents_contract_id_fkey','ediel_route_profiles_actor_setting_id_fkey')),
      'indexes',(select jsonb_agg(to_jsonb(i) order by tablename,indexname) from pg_indexes i where schemaname='public'),
      'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public'),
      'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by t.oid) from pg_trigger t
        join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal));''')


def rows():
    return [sql(f'select coalesce(jsonb_agg(to_jsonb(t) order by id),\'[]\'::jsonb) from public.{table} t;')
            for table in ('customer_documents', 'customer_contracts', 'ediel_route_profiles', 'ediel_actor_settings')]


def constraints():
    return sql("""select coalesce(jsonb_agg(jsonb_build_array(conrelid::regclass::text,conname,
      confrelid::regclass::text,conkey,confkey,confmatchtype,confupdtype,confdeltype,
      convalidated,condeferrable,condeferred,confdelsetcols,pg_get_constraintdef(oid),
      obj_description(oid,'pg_constraint')) order by conname),'[]'::jsonb)
      from pg_constraint where conname in
      ('customer_documents_contract_id_fkey','ediel_route_profiles_actor_setting_id_fkey');""")


def assert_repaired():
    actual = json.loads(constraints())
    expected = sorted([[child, name, parent, [3], [1], 's', 'a', 'n', True, False, False, None,
                        f'FOREIGN KEY ({column}) REFERENCES {parent}(id) ON DELETE SET NULL', None]
                       for child, column, parent, name in PAIRS], key=lambda row: row[1])
    if actual != expected:
        raise ValueError('EXACT_TWO_FOREIGN_KEYS_REQUIRED')


def reset(existing=True):
    sql('drop table if exists public.customer_documents, public.ediel_route_profiles, '
        'public.customer_contracts, public.ediel_actor_settings cascade;')
    sql(SETUP)
    for index, source in enumerate(SOURCES):
        if existing or index % 2:
            sql(source_statement(*source))


def execute(candidate):
    if sql("select current_database()='gridex_auth_test' and current_user='postgres' "
           "and current_setting('server_version_num')::int/10000=17", admin=True) != 't':
        raise ValueError('OWNED_LOCAL_PG17_REQUIRED')
    if sql(f"select count(*) from pg_database where datname='{DATABASE}'", admin=True) != '0':
        raise ValueError('PREEXISTING_DATABASE_REFUSED')
    sql(f'create database {DATABASE}', admin=True)
    try:
        reset()
        if constraints() != '[]':
            raise ValueError('HISTORICAL_MISSING_FK_NOT_REPRODUCED')
        try:
            assert_repaired()
        except ValueError as error:
            if str(error) != 'EXACT_TWO_FOREIGN_KEYS_REQUIRED':
                raise
        else:
            raise ValueError('UNCORRECTED_FIXTURE_MUST_FAIL')
        before, data = catalog(), rows()
        sql(candidate)
        assert_repaired()
        # Missing one FK on an otherwise corrected installation is repaired too.
        for child, _, _, name in PAIRS:
            sql(f'alter table public.{child} drop constraint {name};')
            sql(candidate)
            assert_repaired()
        if (catalog(), rows()) != (before, data):
            raise ValueError('UNRELATED_CATALOG_OR_ROWS_CHANGED')
        after = constraints()
        sql(candidate)
        if constraints() != after or catalog() != before:
            raise ValueError('NON_IDEMPOTENT_REPAIR')
        for child, column, parent, _ in PAIRS:
            sql(f"insert into public.{parent}(id) values('{PARENT}');")
            sql(f"insert into public.{child}(id,{column}) values('{CHILD}','{UNKNOWN}');", expected='23503')
            sql(f"insert into public.{child}(id,{column}) values('{CHILD}','{PARENT}');")
            sql(f"update public.{child} set {column}='{UNKNOWN}';", expected='23503')
            sql(f"update public.{parent} set id='{UNKNOWN}';", expected='23503')
            sql(f"delete from public.{parent} where id='{PARENT}';")
            if sql(f"select count(*)=1 and bool_and({column} is null and payload='preserve') from public.{child};") != 't':
                raise ValueError('SET_NULL_MUST_PRESERVE_CHILD')
        # Each orphan must reject the whole transaction and preserve both catalogs/rows.
        for child, column, _, _ in PAIRS:
            reset()
            sql(f"insert into public.{child}(id,{column}) values('{CHILD}','{UNKNOWN}');")
            before = (catalog(), constraints(), rows())
            sql(candidate, expected='23503', message='EXISTING_COLUMN_FK_ORPHANS')
            if (catalog(), constraints(), rows()) != before:
                raise ValueError('ORPHAN_REJECTION_NOT_ATOMIC')
        # A same-named wrong constraint cannot be treated as idempotent success.
        for child, column, parent, name in PAIRS:
            reset()
            sql(f'alter table public.{child} add constraint {name} foreign key({column}) references public.{parent}(id) on delete cascade;')
            before = (catalog(), constraints(), rows())
            sql(candidate, expected='55000', message='EXISTING_COLUMN_FK_UNKNOWN_CONSTRAINT')
            if (catalog(), constraints(), rows()) != before:
                raise ValueError('WRONG_CONSTRAINT_REJECTION_NOT_ATOMIC')
        # Existing exact NOT VALID constraints are validated without replacement.
        reset()
        for child, column, parent, name in PAIRS:
            sql(f'alter table public.{child} add constraint {name} foreign key({column}) references public.{parent}(id) on delete set null not valid;')
        sql(candidate)
        assert_repaired()
        # Original inline REFERENCES also works when the columns really are new.
        reset(existing=False)
        assert_repaired()
        before = (catalog(), constraints(), rows())
        sql(candidate)
        if (catalog(), constraints(), rows()) != before:
            raise ValueError('FRESH_COLUMN_PATH_CHANGED')
        print('PASS PostgreSQL17: original existing-column failure; exact two FKs; invalid references; delete/set-null; update/no-action; idempotence; orphan rollback; wrong definition rejection; NOT VALID validation; fresh-column path')
    finally:
        sql(f'drop database {DATABASE} with (force)', admin=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--selection-only', action='store_true')
    args = parser.parse_args()
    for source in SOURCES:
        source_statement(*source)
    candidate = read_candidate()
    print('PASS four immutable source selections; native SQL not yet implied')
    if not args.selection_only:
        execute(candidate)
