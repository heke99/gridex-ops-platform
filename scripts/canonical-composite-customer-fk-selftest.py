#!/usr/bin/env python3
"""Qualify seven FK alternatives on the fixed disposable CI PostgreSQL17 service.

Limited FK/immutable-trigger fixture, not the full application graph or schema
acceptance. No database URL, SQL, table name, or artifact input is accepted.
"""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ADMIN = 'postgresql://postgres:postgres@127.0.0.1:55440/gridex_auth_test'
DATABASE = 'gridex_composite_customer_fk_fixture'
TARGET = 'postgresql://postgres:postgres@127.0.0.1:55440/' + DATABASE
PARENT = '00000000-0000-0000-0000-000000000001'
COMPANY = '00000000-0000-0000-0000-000000000002'
OTHER = '00000000-0000-0000-0000-000000000003'
PINS = {
    'supabase/schema.sql': 'b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30',
    '20260801143000_canonical_multitenant_platform_hardening.sql': '4de56322077ea89f72596bd9cd2de9f2bdae67c2b74c4721779410553b3326b0',
    '20260809181153_validate_pending_public_constraints.sql': '46461e2cf41907ae66e1ccaf6e526c4e2e6f87c998d5efd50a80a8a7edcf8291',
    '20260902095000_lock_customer_chain_with_composite_keys.sql': 'bd3e79d2dab7f3332487b6259e595a258c413c288d073c63c5163555f7cd9c38',
    '20260613090000_batch_m_ops_master_legal_readiness.sql': '599b707e9f979727fcf39843d88ee376c15409731a780befb01d2ed436ec842d',
    '20260720110000_canonical_customer_onboarding_transaction.sql': 'fd681e4dc01eba0bb862caeeb65e81730f5af47f89399983fc608dae084f47e6',
}
# Added constraint row hashes from full-schema-reference-diff.json in both
# artifact10371643836 and the retained335f987f ZIP. Hashes include validation.
ROWS = {
    'customer_authorization_documents': '1301067f3e3ace5ce35c3be3149bfddc1b03939cf1969d2a4442a4052288d165',
    'customer_info_requests': '0ae085ad030182c3d379b31efdca28a59034e3fb27792e471e3de73a8c7da583',
    'customer_legal_acceptances': '991af13e8defa64edb1cefc805d5e405b4c115251ccc7489db1c5fb05270f4fe',
    'customer_onboarding_applications': '21b956731e5ed46809dfa18fc10c51a699451a6678ddb45ebda18141177455e8',
    'customer_onboarding_legal_snapshots': '5f0f7bbc824ee1f2ee1da516a2d2d528b9fd5be2870ce7ef62552f80d9ac0e3a',
    'powers_of_attorney': 'd7a75cfcd61c55ac98ce3f33f867a322fe2eef9f1037f97609c874f6268c2d9f',
    'supplier_switch_requests': '5ec1ed5e32bdb8f0465ae0e3a589b04adc2d3650d09a71d41ea1d83eecf5101d',
}
REFERENCE_ROWS = {
    'customer_authorization_documents': '7ddb5acb64a2c117e0b68e32747d4682833f169f731a058cb59237dacdab9a2d',
    'customer_info_requests': 'baf0f93f74535a618e13bccdbad40605b6f41906a844fcc7169fc7134e601d03',
    'customer_legal_acceptances': 'b6065678242fe0cd01879a3a735bd702ab3e70d5bf683c567c9a8275ae350a7a',
    'customer_onboarding_applications': '83b05adc81eb749326a5703190b5c33f1c786475a973be03137d1b78689c129f',
    'customer_onboarding_legal_snapshots': '2152efede9502a343197edb13e4806eee44225437da35f2d3e8d2e4258c27da7',
    'powers_of_attorney': '7012026a6ae39fb0c5531a40b17e6df39735882ee5f94624056aab950e8b5aca',
    'supplier_switch_requests': 'b42eba69d77f2f90da47545ce5c8321db4243fc17b181a1b83261d7820b7b224',
}
IMMUTABLE = {
    'customer_legal_acceptances': ('gridex_customer_legal_acceptances_immutable',
                                 'customer_legal_acceptances_immutable_update', 'P0001',
                                 '20260613090000_batch_m_ops_master_legal_readiness.sql'),
    'customer_onboarding_legal_snapshots': ('gridex_protect_onboarding_legal_snapshot',
                                         'customer_onboarding_legal_snapshots_immutable_tg', '55000',
                                         '20260720110000_canonical_customer_onboarding_transaction.sql'),
}


def sha(value):
    if not isinstance(value, bytes):
        value = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()
    return hashlib.sha256(value).hexdigest()


def read_pinned(path, digest):
    if path.is_symlink() or not path.is_file() or sha(path.read_bytes()) != digest:
        raise ValueError('IMMUTABLE_SOURCE_CHANGED')
    return path.read_text()


def exactly_one(pattern, text):
    matches = re.findall(pattern, text, re.M | re.S | re.I)
    if len(matches) != 1:
        raise ValueError('EXACT_STATEMENT_REQUIRED')
    return matches[0]


def selections():
    files = {name: read_pinned(ROOT / (name if '/' in name else 'supabase/migrations/' + name), digest)
             for name, digest in PINS.items()}
    reference = files['supabase/schema.sql']
    single, composite, triggers = {}, {}, {}
    for table, digest in ROWS.items():
        for suffix, destination in [('_customer_id_fkey', single), ('_customer_company_fk', composite)]:
            destination[table] = exactly_one(
                r'(ALTER TABLE ONLY public\.' + table + r'\s+ADD CONSTRAINT ' + table + suffix + r'\s+[^;]+;)', reference)
        # Independently reconstruct the entire catalog row, including convalidated.
        candidates = []
        for validated in (True, False):
            for prefix in ('', 'public.'):
                for suffix in ('', ' NOT VALID'):
                    row = dict(nspname='public', relname=table, conname='mt_' + table + '_customer_id_tenant_fk',
                               contype='f', definition='FOREIGN KEY (company_id, customer_id) REFERENCES '
                               + prefix + 'customers(company_id, id)' + suffix, convalidated=validated)
                    if sha(row) == digest:
                        candidates.append(row)
        if len(candidates) != 1 or not candidates[0]['convalidated']:
            raise ValueError('VALIDATED_ARTIFACT_ROW_REQUIRED')
        reference_row = dict(nspname='public', relname=table, conname=table + '_customer_company_fk',
                             contype='f', definition='FOREIGN KEY (customer_id, company_id) REFERENCES '
                             'customers(id, company_id) ON UPDATE CASCADE ON DELETE CASCADE', convalidated=True)
        if sha(reference_row) != REFERENCE_ROWS[table]:
            raise ValueError('REFERENCE_ARTIFACT_ROW_REQUIRED')
        if table in IMMUTABLE:
            function, trigger, _, source = IMMUTABLE[table]
            definition = exactly_one(r'(CREATE FUNCTION public\.' + function + r'\(\).*?\$\$;)', reference)
            source_definition = exactly_one(r'(create or replace function public\.' + function + r'\(\).*?\$\$;)', files[source])
            body = lambda statement: exactly_one(r'\bas\s+\$\$(.*?)\$\$;', statement).strip()
            if body(definition) != body(source_definition):
                raise ValueError('IMMUTABLE_PREDICATE_CHANGED')
            triggers[table] = definition + '\n' + exactly_one(r'(CREATE TRIGGER ' + trigger + r'\s+[^;]+;)', reference)
    add_source = files['20260801143000_canonical_multitenant_platform_hardening.sql']
    # Complete original DO blocks, including all original tuple predicates. Absent
    # relations/columns in this bounded fixture follow the original skip paths.
    install = exactly_one(r'(do \$\$\s+declare\s+r record;\s+constraint_name text;\s+child_type oid;.*?\$\$;)', add_source)
    lock = exactly_one(r'(do \$\$\s+declare\s+v_table record;\s+v_added integer := 0;.*?\$\$;)',
                       files['20260902095000_lock_customer_chain_with_composite_keys.sql'])
    return single, composite, triggers, install, files['20260809181153_validate_pending_public_constraints.sql'], lock


def sql(statement, *, admin=False, expected=None):
    env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
    result = subprocess.run(['psql', '-X', '-qAt', '--set=ON_ERROR_STOP=1', '--set=VERBOSITY=verbose',
                             ADMIN if admin else TARGET, '-f', '-'], input=statement,
                            capture_output=True, text=True, env=env, cwd=ROOT, timeout=90)
    if expected is None:
        if result.returncode:
            raise ValueError('FIXTURE_SQL_FAILED')
    else:
        errors = re.findall(r'^.*?(ERROR|FATAL|PANIC):\s+([0-9A-Z]{5}): [^\r\n]*$', result.stderr, re.M)
        if not result.returncode or errors != [('ERROR', expected)]:
            raise ValueError('UNQUALIFIED_SQL_REJECTION')
    return result.stdout.strip()


@contextmanager
def owned_database():
    # A successful CREATE receipt is not guaranteed on timeout. The database's
    # unique, nonce-marked NOLOGIN owner lets cleanup prove ownership separately.
    nonce = secrets.token_hex(16)
    owner = 'gridex_composite_fk_owner_' + nonce
    try:
        sql(f"begin; create role {owner} nologin; comment on role {owner} is '{nonce}'; commit;", admin=True)
        sql(f'create database {DATABASE} owner {owner}', admin=True)
        yield
    finally:
        if sql(f"select coalesce((select shobj_description(oid,'pg_authid')='{nonce}' "
               f"from pg_roles where rolname='{owner}'),false)", admin=True) != 't':
            raise ValueError('FIXTURE_OWNER_IDENTITY_UNPROVED')
        ownership = sql(f"select case when not exists(select 1 from pg_database where datname='{DATABASE}') "
                        f"then 'absent' when exists(select 1 from pg_database d join pg_roles r on r.oid=d.datdba "
                        f"where d.datname='{DATABASE}' and r.rolname='{owner}') then 'owned' else 'unowned' end", admin=True)
        if ownership == 'owned':
            sql(f'drop database {DATABASE} with (force)', admin=True)
        elif ownership != 'absent':
            raise ValueError('FIXTURE_DATABASE_OWNERSHIP_UNPROVED')
        if sql(f"select count(*) from pg_database where datname='{DATABASE}'", admin=True) != '0':
            raise ValueError('OWNED_DATABASE_CLEANUP_NOT_PROVED')
        sql(f'drop role {owner}', admin=True)


def state(table):
    return sql(f"""select jsonb_build_object(
      'parents',(select jsonb_agg(to_jsonb(t) order by id) from public.customers t),
      'children',(select jsonb_agg(to_jsonb(t) order by id) from public.{table} t),
      'constraints',(select jsonb_agg(jsonb_build_array(oid,conname,convalidated,
        pg_get_constraintdef(oid)) order by oid) from pg_constraint where connamespace='public'::regnamespace),
      'triggers',(select jsonb_agg(jsonb_build_array(oid,pg_get_triggerdef(oid),tgenabled) order by oid)
        from pg_trigger where tgrelid in ('public.customers'::regclass,'public.{table}'::regclass)));
    """)


def probe(table, statement, expected=None, assertion='true'):
    before = state(table)
    # The marker proves a rejected statement rolled back prior writes too.
    result = sql("begin; update public.customers set marker='must rollback';\n" + statement
                 + '\nselect (' + assertion + '); rollback;', expected=expected)
    if expected is None and result != 't':
        raise ValueError('ACTION_EFFECT_NOT_PROVED')
    if state(table) != before:
        raise ValueError('CASE_ROLLBACK_NOT_PROVED')


def reset(table, mode, selected):
    single, composite, triggers, install, validate, lock = selected
    sql('drop schema public cascade; create schema public;')
    sql(f"""create table public.customers(id uuid primary key, company_id uuid not null,
      marker text default 'preserve', unique(id,company_id), unique(company_id,id));
      create table public.{table}(id uuid primary key, customer_id uuid not null,
      company_id uuid not null, marker text default 'preserve');""")
    if mode == 'reference':
        # Preserve dump statement order; RI trigger ordering can affect RESTRICT
        # combined with a second CASCADE constraint. This is not a live OID claim.
        sql(composite[table] + '\n' + single[table])
    else:
        sql(single[table])
        sql(install)
        sql(validate)
        sql(lock)
    if table in triggers:
        sql(triggers[table])
    expected_actions = ['c', 'c'] if mode == 'reference' else ['a', 'a']
    actual = json.loads(sql(f"""select jsonb_agg(jsonb_build_array(confupdtype,confdeltype,convalidated,
        condeferrable,condeferred) order by conname) from pg_constraint
        where conrelid='public.{table}'::regclass and contype='f' and array_length(conkey,1)=2;"""))
    if actual != [[*expected_actions, True, False, False]]:
        raise ValueError('EXACT_VALIDATED_COMPOSITE_REQUIRED')
    actual_row = json.loads(sql(f"""select jsonb_build_object('nspname','public','relname','{table}',
        'conname',conname,'contype',contype,'definition',pg_get_constraintdef(oid),'convalidated',convalidated)
        from pg_constraint where conrelid='public.{table}'::regclass and contype='f' and array_length(conkey,1)=2;"""))
    if sha(actual_row) != (REFERENCE_ROWS if mode == 'reference' else ROWS)[table]:
        raise ValueError('NATIVE_CONSTRAINT_ARTIFACT_MISMATCH')
    if sql(f"select count(*) from pg_constraint where conrelid='public.{table}'::regclass and contype='f'") != '2':
        raise ValueError('EXACT_TWO_CUSTOMER_FKS_REQUIRED')
    sql(f"insert into public.customers(id,company_id) values('{PARENT}','{COMPANY}');")


def execute(selected):
    if sql("select current_database()='gridex_auth_test' and current_user='postgres' and "
           "current_setting('server_version_num')::int/10000=17", admin=True) != 't':
        raise ValueError('OWNED_LOCAL_PG17_REQUIRED')
    if sql(f"select count(*) from pg_database where datname='{DATABASE}'", admin=True) != '0':
        raise ValueError('PREEXISTING_DATABASE_REFUSED')
    receipts = []
    with owned_database():
        for table in ROWS:
            for mode in ('reference', 'replay'):
                print('RUN bounded fixture ' + table + ' ' + mode, flush=True)
                reset(table, mode, selected)
                # An unreferenced test customer is deletable in both fixtures.
                probe(table, 'delete from public.customers;', assertion='not exists(select 1 from public.customers)')
                sql(f"insert into public.{table}(id,customer_id,company_id) values('{OTHER}','{PARENT}','{COMPANY}');")
                probe(table, f"insert into public.{table}(id,customer_id,company_id) values('{COMPANY}','{OTHER}','{COMPANY}');", '23503')
                probe(table, f"insert into public.{table}(id,customer_id,company_id) values('{COMPANY}','{PARENT}','{OTHER}');", '23503')
                # Non-key profile/status writes do not engage the FK action.
                probe(table, "update public.customers set marker='profile update';",
                      assertion="(select bool_and(marker='profile update') from public.customers)")
                immutable_code = IMMUTABLE[table][2] if table in IMMUTABLE else None
                if mode == 'reference':
                    delete_code = immutable_code
                    update_code = immutable_code
                else:
                    delete_code = (immutable_code if table == 'customer_legal_acceptances' else
                                   None if table == 'customer_info_requests' else '23503')
                    update_code = '23503'
                probe(table, 'delete from public.customers;', delete_code,
                      f'not exists(select 1 from public.customers) and not exists(select 1 from public.{table})')
                for key in ('id', 'company_id'):
                    child_key = 'customer_id' if key == 'id' else 'company_id'
                    probe(table, f"update public.customers set {key}='{OTHER}';", update_code,
                          f"(select bool_and({child_key}='{OTHER}') from public.{table})")
                if table == 'customer_authorization_documents':
                    # The actual permitted test-delete path removes these child
                    # documents explicitly before deleting the parent (line749).
                    probe(table, f'delete from public.{table}; delete from public.customers;',
                          assertion=f'not exists(select 1 from public.customers) and not exists(select 1 from public.{table})')
                if immutable_code:
                    probe(table, f'delete from public.{table};', immutable_code)
                receipts.append(dict(table=table, mode=mode, rawParentDelete=delete_code or 'CASCADE',
                                     rawParentKeyUpdate=update_code or 'CASCADE', rollbackVerified=True))
    if sql(f"select count(*) from pg_database where datname='{DATABASE}'", admin=True) != '0':
        raise ValueError('OWNED_DATABASE_CLEANUP_NOT_PROVED')
    print(json.dumps(dict(scope='LIMITED_FK_AND_TWO_IMMUTABLE_TRIGGERS', cases=receipts,
                          cleanupVerified=True, applicationGraphVerified=False, schemaAccepted=False), sort_keys=True))
    print('PASS PostgreSQL17 bounded FK actions, immutable retention, tenant/orphan rejection and rollback')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--selection-only', action='store_true')
    args = parser.parse_args()
    try:
        selected = selections()
        print('PASS immutable selections; seven validated artifact row hashes; native SQL not yet implied')
        if not args.selection_only:
            execute(selected)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        # Never emit raw SQL, psql output, arbitrary exception text or URLs.
        reason = str(error) if isinstance(error, ValueError) and re.fullmatch('[A-Z_]+', str(error)) else 'FIXTURE_EXECUTION_FAILED'
        print('FAIL ' + reason)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
