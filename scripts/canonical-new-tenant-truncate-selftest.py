#!/usr/bin/env python3
"""Owned PG17 fixture for seven TRUNCATE revocations, never app/schema acceptance.

The exact retained TRUE/restrictive policy composition is exercised with synthetic
helper outputs. Auth/session helper implementations and the application graph are
not represented. No external database, SQL, artifact or target option is accepted.
"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('truncate_fixture_owner', ROOT / 'scripts/canonical-composite-customer-fk-selftest.py')
fixture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fixture)
TABLES = ('billing_disputes', 'billing_partner_customers', 'company_go_live_reviews',
          'customer_import_batches', 'customer_import_rows', 'grid_owner_access_agreements',
          'production_route_wizard_runs')
CANDIDATE = ROOT / 'scripts/sql/forward-candidates/restrict-new-tenant-table-truncate.sql'
CANDIDATE_SHA = 'c67328cde9b270efad94aa44ded06f3b435170f247af90b1ea93e01dfe08523a'
REFERENCE_SHA = 'b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30'
GUARD_HASHES = (
    'be709d5b67709b72c26e175085909f801672addd0768346894a8a35f8f1a9ba9',
    '37bbb6196c1e0f804cf21a85ea433a96affedb046433d78d377919e01e5cc693',
    'd2f11d788f87ba5c803ae3acbab8d3374e522cce90792142d4df8f1c49f49ab0',
    'a736c6d9075aa25d88226178c7970f41a5e4e4e826665c94f52fd4d615b79e6d',
    '1bc670ee8c09ab65d13bf66833157a206a1920c8d264d132a49fbccd0ca41245',
    'ee00a98075a530f53e3b451bf0a39de1d3ac8a9a06bcfa6162fe3e4facd9c519',
    '40b84fc4f32786b64f86d67afd545f305b5099350d663b1c18e3ffee0c6810ad',
)
COMPANY_A = '00000000-0000-0000-0000-000000000001'
COMPANY_B = '00000000-0000-0000-0000-000000000002'


def read_candidate(path=CANDIDATE):
    path = Path(path).absolute()
    if path.resolve() != path or not path.is_file():
        raise ValueError('EXACT_CANDIDATE_REQUIRED')
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != CANDIDATE_SHA:
        raise ValueError('EXACT_CANDIDATE_REQUIRED')
    return data.decode('utf-8')


def selection():
    candidate = read_candidate()
    reference = fixture.read_pinned(ROOT / 'supabase/schema.sql', REFERENCE_SHA)
    expression = fixture.exactly_one(
        r'CREATE POLICY tenant_lifecycle_select_guard ON public\.company_customer_number_sequences .*?USING \((.*?)\);', reference)
    deparsed = expression.replace('public.', '')[1:-1]
    for table, digest in zip(TABLES, GUARD_HASHES, strict=True):
        row = dict(nspname='public', relname=table, polname='tenant_lifecycle_select_guard',
                   command='r', permissive=False, using_expression=deparsed, check_expression='', roles=['authenticated'])
        if fixture.sha(row) != digest:
            raise ValueError('EXACT_RETAINED_POLICY_REQUIRED')
    return candidate, expression


def verify_delta(before, after):
    expected = copy.deepcopy(before)
    expected['acl'] = [row for row in expected['acl'] if not (
        row[0] == 'public' and row[1] in TABLES and row[3] == 'authenticated' and row[4] == 'TRUNCATE')]
    if after != expected:
        raise ValueError('EXACT_TRUNCATE_DELTA_REQUIRED')


def state():
    catalog = json.loads(fixture.sql("""select jsonb_build_object(
      'relations',(select jsonb_agg(jsonb_build_array(c.oid,n.nspname,c.relname,c.relkind,c.relowner,
        c.relrowsecurity,c.relforcerowsecurity) order by c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('public','control')),
      'columns',(select jsonb_agg(to_jsonb(a) order by a.attrelid,a.attnum) from pg_attribute a join pg_class c on c.oid=a.attrelid
        where c.relnamespace in ('public'::regnamespace,'control'::regnamespace) and a.attnum>0),
      'policies',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p),
      'constraints',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_constraint c
        where c.connamespace in ('public'::regnamespace,'control'::regnamespace)),
      'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid
        where c.relnamespace in ('public'::regnamespace,'control'::regnamespace)),
      'functions',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p
        where p.pronamespace in ('public'::regnamespace,'control'::regnamespace)),
      'schemas',(select jsonb_agg(to_jsonb(n) order by n.oid) from pg_namespace n where n.nspname in ('public','control')),
      'defaults',(select jsonb_agg(to_jsonb(d) order by d.oid) from pg_default_acl d),
      'roles',(select jsonb_agg(to_jsonb(r) order by r.oid) from pg_roles r),
      'memberships',(select jsonb_agg(to_jsonb(m) order by m.roleid,m.member,m.grantor) from pg_auth_members m));"""))
    acl = json.loads(fixture.sql("""select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,
      pg_get_userbyid(a.grantor),case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
      a.privilege_type,a.is_grantable) order by n.nspname,c.relname,a.grantor,a.grantee,a.privilege_type),'[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      where n.nspname in ('public','control') and c.relkind in ('r','v');"""))
    relations = json.loads(fixture.sql("""select jsonb_agg(jsonb_build_array(n.nspname,c.relname) order by n.nspname,c.relname)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','control') and c.relkind in ('r','v');"""))
    rows = {}
    for schema, table in relations:
        if not re.fullmatch('[a-z_]+', schema) or not re.fullmatch('[a-z_]+', table):
            raise ValueError('FIXTURE_IDENTIFIER_REQUIRED')
        rows[schema + '.' + table] = json.loads(fixture.sql(
            f"select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from {schema}.{table} t;"))
    return dict(catalog=catalog, acl=acl, rows=rows)


def actor(company=COMPANY_A, allowed=True, platform=False):
    # These controller-supplied settings model helper outputs, not real Auth claims.
    return ("begin; set local role authenticated; "
            f"set local fixture.company='{company}'; "
            f"set local fixture.session_allowed='{str(allowed).lower()}'; "
            f"set local fixture.platform_admin='{str(platform).lower()}'; ")


def verify_reads():
    for table in TABLES:
        for company, allowed, platform, ids in (
            (COMPANY_A, True, False, [1]), (COMPANY_B, True, False, [2]),
            ('', True, False, []), (COMPANY_A, False, False, []),
            ('', True, True, [1, 2, 3]), ('', False, True, []),
        ):
            result = fixture.sql(actor(company, allowed, platform)
                + f"select coalesce(jsonb_agg(id order by id),'[]'::jsonb) from public.{table}; rollback;")
            if json.loads(result) != ids:
                raise ValueError('EXACT_SYNTHETIC_TENANT_SCOPE_REQUIRED')


def setup(expression):
    fixture.sql("""create schema control;
      grant usage on schema public,control to authenticated,service_role;
      create function public.gridex_is_current_session_allowed() returns boolean language sql stable
        as $$select coalesce(current_setting('fixture.session_allowed',true)::boolean,false)$$;
      create function public.gridex_user_is_platform_admin() returns boolean language sql stable
        as $$select coalesce(current_setting('fixture.platform_admin',true)::boolean,false)$$;
      create function public.gridex_user_company_ids() returns setof uuid language sql stable
        as $$select nullif(current_setting('fixture.company',true),'')::uuid$$;""")
    for schema, table in [('public', t) for t in (*TABLES, 'outside_seven')] + [('control', 'billing_disputes')]:
        fixture.sql(f"""create table {schema}.{table}(id integer primary key,company_id uuid,marker text);
          insert into {schema}.{table} values(1,'{COMPANY_A}','tenant_a'),(2,'{COMPANY_B}','tenant_b'),(3,null,'global');
          alter table {schema}.{table} enable row level security;
          create policy gridex_perf_authenticated_select_v1 on {schema}.{table} for select to authenticated using(true);
          create policy tenant_lifecycle_select_guard on {schema}.{table} as restrictive for select to authenticated using({expression});
          create policy synthetic_service_all on {schema}.{table} to service_role using(true) with check(true);
          grant all on table {schema}.{table} to authenticated,service_role;
          grant select(marker) on {schema}.{table} to authenticated;
          comment on table {schema}.{table} is 'bounded synthetic fixture';""")


def rejected_shape(candidate, before_sql, after_sql):
    fixture.sql(before_sql)
    before = state()
    fixture.sql(candidate, expected='55000')
    if state() != before:
        raise ValueError('FAILED_CANDIDATE_MUST_BE_ATOMIC')
    fixture.sql(after_sql)


def run():
    if sys.argv[1:] not in ([], ['--selection-only']):
        raise ValueError('NO_EXTERNAL_TARGET_OR_ACCEPTANCE_OPTIONS')
    candidate, expression = selection()
    if sys.argv[1:]:
        print(json.dumps(dict(scope='SELECTION_ONLY_NOT_SQL', candidateSha256=CANDIDATE_SHA, tables=7)))
        return
    if fixture.sql("select current_user='postgres' and current_setting('server_version_num')::int between 170000 and 179999", admin=True) != 't':
        raise ValueError('FIXED_PG17_REQUIRED')
    if fixture.sql(f"select count(*) from pg_database where datname='{fixture.DATABASE}'", admin=True) != '0':
        raise ValueError('PREEXISTING_DATABASE_REFUSED')
    if fixture.sql("select count(*)=2 and bool_and(not rolsuper and not rolbypassrls and not rolcanlogin) "
                   "from pg_roles where rolname in ('authenticated','service_role')", admin=True) != 't':
        raise ValueError('FIXED_NONBYPASS_ROLES_REQUIRED')
    with fixture.owned_database():
        setup(expression)
        before = state()
        verify_reads()
        for table in TABLES:
            # RED characterization: tenant SELECT returns only one row, but the
            # historical grant permits deletion of all three fixture rows.
            result = fixture.sql(actor() + f"select count(*)=1 from public.{table}; truncate only public.{table}; "
                                 f"reset role; select count(*)=0 from public.{table}; rollback;")
            if result != 't\nt' or state() != before:
                raise ValueError('ORIGINAL_TRUNCATE_BYPASS_AND_ROLLBACK_REQUIRED')
        last = TABLES[-1]
        rejected_shape(candidate, f'alter table public.{last} rename to missing_last;',
                       f'alter table public.missing_last rename to {last};')
        rejected_shape(candidate, f'alter table public.{last} rename to original_last; create view public.{last} as select * from public.original_last;',
                       f'drop view public.{last}; alter table public.original_last rename to {last};')
        rejected_shape(candidate, f'alter table public.{last} disable row level security;',
                       f'alter table public.{last} enable row level security;')
        rejected_shape(candidate, f'alter table public.{last} force row level security;',
                       f'alter table public.{last} no force row level security;')
        # This fails after earlier revocations, proving outer rollback rather than
        # just all-table preflight. Preserve PUBLIC and reject residual authority.
        rejected_shape(candidate, f'grant truncate on public.{last} to public;',
                       f'revoke truncate on public.{last} from public;')
        before = state()
        fixture.sql(candidate)
        after = state()
        verify_delta(before, after)
        verify_reads()
        for table in TABLES:
            fixture.sql(actor() + f'truncate only public.{table}; rollback;', expected='42501')
            if state() != after:
                raise ValueError('DENIED_TRUNCATE_MUST_PRESERVE_STATE')
        fixture.sql(candidate)
        if state() != after:
            raise ValueError('REPEAT_MUST_PRESERVE_STATE')
    print(json.dumps(dict(scope='LIMITED_PG17_SEVEN_TRUNCATE_FIXTURE', candidateSha256=CANDIDATE_SHA,
        originalTruncateBypassesRls=True, fixedSqlstate='42501', tables=7,
        syntheticPolicyCompositionVerified=True, exactAclDeltaVerified=True, rowsAndCatalogPreserved=True,
        shapeRejectionsVerified=True, atomicityVerified=True, repeatVerified=True, cleanupVerified=True,
        actualAuthHelpersVerified=False, applicationGraphVerified=False, schemaAccepted=False, productionModified=False)))


if __name__ == '__main__':
    try:
        run()
    except Exception:
        print('FAIL bounded tenant TRUNCATE qualification; no raw SQL or data published', file=sys.stderr)
        raise SystemExit(1) from None
