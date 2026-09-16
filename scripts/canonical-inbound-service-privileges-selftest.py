#!/usr/bin/env python3
"""Fixed owned PG17 ACL fixture for three source-authored service-only tables.

Synthetic rows and deny-all policies prove ACL behavior and preservation only;
actual application helpers, parent graph, role memberships and actor access are
not reproduced. No externally supplied SQL, connection or target is accepted.
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
SPEC = importlib.util.spec_from_file_location('inbound_fixture_owner', ROOT / 'scripts/canonical-composite-customer-fk-selftest.py')
fixture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fixture)
TABLES = ('inbound_ediel_match_attempts', 'inbound_ediel_parse_results', 'inbound_email_attachments')
PRIVILEGES = ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
CANDIDATE = ROOT / 'scripts/sql/forward-candidates/restrict-inbound-service-table-privileges.sql'
CANDIDATE_SHA = '0ee026c41d180768b23e20826d522387cc1c65e9c689304472f62cda39b19033'
SOURCE_SHA = '3e40f894ec109a45e4dd7842edd819509caadac1e8d5e89a45d244224d0c77e1'


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
    source = fixture.read_pinned(ROOT / 'supabase/migrations/20260904120000_canonical_tenant_invariant_convergence.sql', SOURCE_SHA)
    selected = re.findall(r"\(\s*'([a-z_]+)',\s*'system',\s*'Service-role only: no client role holds any privilege, so the table is closed by grants rather than by policy\.',\s*'migration'\s*\)", source)
    if tuple(selected) != TABLES:
        raise ValueError('EXACT_SERVICE_ONLY_SOURCE_REQUIRED')
    return candidate


def verify_delta(before, after):
    expected = copy.deepcopy(before)
    expected['acl'] = [row for row in expected['acl'] if not (
        row[0] == 'public' and row[1] in TABLES and row[3] == 'authenticated')]
    if after != expected:
        raise ValueError('EXACT_INBOUND_ACL_DELTA_REQUIRED')


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


def setup():
    fixture.sql('create schema control; grant usage on schema public,control to authenticated,service_role,anon;')
    for schema, table in [('public', t) for t in (*TABLES, 'outside_inbound')] + [('control', TABLES[0])]:
        fixture.sql(f"""create table {schema}.{table}(id integer primary key,company_id uuid,marker text);
          insert into {schema}.{table} values
            (1,'00000000-0000-0000-0000-000000000001','tenant_a'),
            (2,'00000000-0000-0000-0000-000000000002','tenant_b'),(3,null,'unattributed');
          alter table {schema}.{table} enable row level security;
          create policy synthetic_deny on {schema}.{table} to authenticated using(false) with check(false);
          create policy synthetic_service on {schema}.{table} to service_role using(true) with check(true);
          grant all on {schema}.{table} to authenticated,service_role;
          grant select on {schema}.{table} to anon;
          grant select(marker) on {schema}.{table} to service_role;
          comment on table {schema}.{table} is 'bounded synthetic fixture';""")
    fixture.sql('grant select on public.outside_inbound to public;')


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
    candidate = selection()
    if sys.argv[1:]:
        print(json.dumps(dict(scope='SELECTION_ONLY_NOT_SQL', candidateSha256=CANDIDATE_SHA,
                              sourceSha256=SOURCE_SHA, tables=3)))
        return
    if fixture.sql("select current_user='postgres' and current_setting('server_version_num')::int between 170000 and 179999", admin=True) != 't':
        raise ValueError('FIXED_PG17_REQUIRED')
    if fixture.sql(f"select count(*) from pg_database where datname='{fixture.DATABASE}'", admin=True) != '0':
        raise ValueError('PREEXISTING_DATABASE_REFUSED')
    if fixture.sql("select count(*)=3 and bool_and(not rolsuper and not rolbypassrls and not rolcanlogin) "
                   "from pg_roles where rolname in ('authenticated','service_role','anon')", admin=True) != 't':
        raise ValueError('FIXED_NONBYPASS_ROLES_REQUIRED')
    with fixture.owned_database():
        setup()
        before = state()
        for table in TABLES:
            answer = fixture.sql(f'begin; set local role authenticated; select count(*)=0 from public.{table}; '
                                 f'truncate only public.{table}; reset role; select count(*)=0 from public.{table}; rollback;')
            if answer != 't\nt' or state() != before:
                raise ValueError('ORIGINAL_TRUNCATE_BYPASS_AND_ROLLBACK_REQUIRED')
        last = TABLES[-1]
        rejected_shape(candidate, f'alter table public.{last} rename to missing_last;',
                       f'alter table public.missing_last rename to {last};')
        rejected_shape(candidate, f'alter table public.{last} rename to original_last; create view public.{last} as select * from public.original_last;',
                       f'drop view public.{last}; alter table public.original_last rename to {last};')
        rejected_shape(candidate, f'alter table public.{last} disable row level security;',
                       f'alter table public.{last} enable row level security;')
        # PUBLIC is inherited by authenticated. Never silently revoke another role.
        rejected_shape(candidate, f'grant select on public.{last} to public;',
                       f'revoke select on public.{last} from public;')
        # PG table REVOKE also changes matching column grants; reject this shape.
        rejected_shape(candidate, f'grant select(marker) on public.{last} to authenticated;',
                       f'revoke select(marker) on public.{last} from authenticated;')
        before = state()
        fixture.sql(candidate)
        after = state()
        verify_delta(before, after)
        for table in TABLES:
            rights = json.loads(fixture.sql('select jsonb_build_array(' + ','.join(
                f"has_table_privilege('{role}','public.{table}','{p}')"
                for role in ('authenticated','service_role') for p in PRIVILEGES) + ');'))
            if rights != [False]*8 + [True]*8:
                raise ValueError('EXACT_EFFECTIVE_PRIVILEGES_REQUIRED')
            for statement in (f'select * from public.{table}', f'insert into public.{table}(id) values(4)',
                              f"update public.{table} set marker='changed'", f'delete from public.{table}',
                              f'truncate only public.{table}'):
                fixture.sql('begin; set local role authenticated; ' + statement + '; rollback;', expected='42501')
                if state() != after:
                    raise ValueError('DENIED_OPERATION_MUST_PRESERVE_STATE')
            answer = fixture.sql(f"begin; set local role service_role; select count(*)=3 from public.{table}; "
                                 f"insert into public.{table}(id,marker) values(4,'service'); "
                                 f"update public.{table} set marker='updated' where id=4; "
                                 f"select marker='updated' from public.{table} where id=4; "
                                 f"delete from public.{table} where id=4; select count(*)=3 from public.{table}; rollback;")
            if answer != 't\nt\nt' or state() != after:
                raise ValueError('SERVICE_DML_AND_ROLLBACK_REQUIRED')
        fixture.sql(candidate)
        if state() != after:
            raise ValueError('REPEAT_MUST_PRESERVE_STATE')
    print(json.dumps(dict(scope='LIMITED_PG17_INBOUND_ACL_FIXTURE', candidateSha256=CANDIDATE_SHA,
        sourceSha256=SOURCE_SHA, tables=3, originalTruncateBypassesRls=True, fixedSqlstate='42501',
        exactAclDeltaVerified=True, serviceDmlVerified=True, rowsAndCatalogPreserved=True,
        shapeRejectionsVerified=True, atomicityVerified=True, repeatVerified=True, cleanupVerified=True,
        actualAuthHelpersVerified=False, applicationGraphVerified=False, schemaAccepted=False, productionModified=False)))


if __name__ == '__main__':
    try:
        run()
    except Exception:
        print('FAIL bounded inbound service privilege qualification; no raw SQL or data published', file=sys.stderr)
        raise SystemExit(1) from None
