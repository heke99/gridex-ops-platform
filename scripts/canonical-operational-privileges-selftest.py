#!/usr/bin/env python3
"""Fixed PG17 privilege fixture; never a release/schema acceptance override."""
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('operational_fixture_owner', ROOT / 'scripts/canonical-composite-customer-fk-selftest.py')
fixture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fixture)
TABLES = ('batch4c_security_checks', 'customer_duplicate_resolution_events',
          'customer_lifecycle_decisions', 'customer_merge_events',
          'customer_readiness_snapshots', 'document_ai_extractions')
CANDIDATE = ROOT / 'scripts/sql/forward-candidates/restrict-retained-operational-table-privileges.sql'
HASH = 'c8928d29f3cf5ad527513a7448b4819c4f7a80f07d9fe3b78c764e30759e134e'


def source():
    original = fixture.read_pinned(ROOT / 'supabase/migrations/20260809143000_gridex_ops_bl_001_write_permission_hardening.sql',
                                   'fb44170d175071caebd377d90daf3ab80a383bd9a9bce3a96196121c5616c93b')
    grant = fixture.exactly_one(r'(grant select, insert, update, delete on table\s+public\.batch4c_security_checks,.*?to authenticated, service_role;)', original)
    return fixture.read_pinned(CANDIDATE, HASH), grant


def state():
    return json.loads(fixture.sql("""select jsonb_build_object(
      'acl',(select jsonb_agg(jsonb_build_array(relname,relacl) order by relname) from pg_class
        where relnamespace='public'::regnamespace and relkind='r'),
      'policies',(select jsonb_agg(jsonb_build_array(oid,polname,polqual,polwithcheck) order by oid) from pg_policy),
      'rows',(select jsonb_agg(jsonb_build_array(table_name,n) order by table_name) from (
    """ + ' union all '.join("select '" + table + "' as table_name,count(*) as n from public." + table for table in TABLES)
      + ') q));'))


def run():
    if len(sys.argv) != 1:
        raise ValueError('NO_EXTERNAL_TARGET_OR_ACCEPTANCE_OPTIONS')
    candidate, grant = source()
    with fixture.owned_database():
        if fixture.sql("select current_user='postgres' and current_setting('server_version_num')::int between 170000 and 179999") != 't':
            raise ValueError('FIXED_PG17_REQUIRED')
        # Roles are already owned by the CI service. Policies deliberately deny
        # every row to demonstrate PostgreSQL's TRUNCATE/RLS distinction without
        # claiming these synthetic policies reproduce application authorization.
        fixture.sql("do $$begin if not exists(select from pg_roles where rolname='authenticated') "
                    "or not exists(select from pg_roles where rolname='service_role') then raise exception 'FIXTURE_ROLES_REQUIRED'; end if; end$$;")
        fixture.sql('grant usage on schema public to authenticated,service_role;')
        for table in (*TABLES, 'power_of_attorney_scopes'):
            fixture.sql(f'create table public.{table}(id integer primary key); '
                        f'insert into public.{table} values(1),(2); '
                        f'alter table public.{table} enable row level security; '
                        f'create policy deny_rows on public.{table} to authenticated using(false) with check(false); '
                        f'grant all on public.{table} to authenticated,service_role;')
        fixture.sql(grant)
        before = state()
        for table in TABLES:
            answer = fixture.sql(f'begin; set local role authenticated; select count(*)=0 from public.{table}; '
                                 f'truncate public.{table}; reset role; select count(*)=0 from public.{table}; rollback;')
            if answer != 't\nt' or state() != before:
                raise ValueError('ORIGINAL_TRUNCATE_BYPASS_AND_ROLLBACK_REQUIRED')
        # Missing last relation must roll back revocation on all earlier tables.
        fixture.sql('alter table public.document_ai_extractions rename to missing_fixture_relation;')
        partial_before = fixture.sql("select jsonb_agg(jsonb_build_array(relname,relacl) order by relname) from pg_class where relnamespace='public'::regnamespace and relkind='r'")
        fixture.sql(candidate, expected='55000')
        if partial_before != fixture.sql("select jsonb_agg(jsonb_build_array(relname,relacl) order by relname) from pg_class where relnamespace='public'::regnamespace and relkind='r'"):
            raise ValueError('REVOCATION_ATOMICITY_REQUIRED')
        fixture.sql('alter table public.missing_fixture_relation rename to document_ai_extractions;')
        fixture.sql(candidate)
        after = state()
        if after['policies'] != before['policies'] or after['rows'] != before['rows']:
            raise ValueError('POLICIES_AND_ROWS_MUST_BE_PRESERVED')
        for table in TABLES:
            actual = fixture.sql("select jsonb_build_array(" + ','.join(
                f"has_table_privilege('{role}','public.{table}','{privilege}')"
                for role, privilege in [('authenticated', p) for p in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')]
                + [('service_role', p) for p in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')]) + ');')
            if json.loads(actual) != [True]*4+[False]*4+[True]*8:
                raise ValueError('EXACT_PRIVILEGE_DELTA_REQUIRED')
            fixture.sql(f'begin; set local role authenticated; truncate public.{table}; rollback;', expected='42501')
            if state() != after:
                raise ValueError('REJECTED_TRUNCATE_MUST_PRESERVE_STATE')
        fixture.sql(candidate)
        if state() != after:
            raise ValueError('REPAIR_IDEMPOTENCE_REQUIRED')
    print(json.dumps(dict(scope='LIMITED_PG17_PRIVILEGE_FIXTURE', tables=len(TABLES),
          originalTruncateBypassesRls=True, fixedTruncateRejected=True, exactDmlAndServiceRolePreserved=True,
          policiesAndRowsPreserved=True, atomicityVerified=True, repeatVerified=True, cleanupVerified=True,
          candidateSha256=HASH, schemaAccepted=False, productionModified=False)))


if __name__ == '__main__':
    try:
        run()
    except Exception:
        print('FAIL operational privilege qualification; no raw SQL or data published', file=sys.stderr)
        raise SystemExit(1) from None
