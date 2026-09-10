#!/usr/bin/env python3
"""Whole G/R proof on four fixed disposable PostgreSQL17 databases only.

ACTUAL_PREFIX uses all first41 files; REDUCED lanes deliberately omit input
FK/pair constraints. SQL, provider-shaped bootstrap rows and psql errors stay in
private temporary files. Receipts contain only source hashes, lanes and outcomes.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
G = 'migrations/20260528_auth_provisioning_runtime_guard.sql'
R = 'migrations/20260910121054_canonical_auth_provisioning_diagnostics_boundary.sql'
G_SHA = '0c2455cbc31553f4be1f1a3fa2800f516295c972bcead8fbbd77c448d3f98026'
R_SHA = '018d81e763e6134ddb3d886ef7e219d6247584a9dad14b871e2ef98014db6333'
BOOTSTRAP = 'scripts/sql/gridex-supabase-compatible-bootstrap.sql'
BOOTSTRAP_SHA = '209b0c391bcfa957ec8b30cfc338622b4bda776e6976d3624fdd2d04779b8914'
PREFIX_SHA = '38fbbe9f2d21feab39285d249cad99f17d929687cee3fbfa0b56ebe0d91330dd'
SUFFIX_SHA = '0f502cdd0f15911dc6ff87589969f2ccf2d94bf361ccd76cfc73131efc304ef4'
RUNNER_SHA = '7e2f9439a4ce76c654f58c6469355e62dd694ad4e01d7b741013dd5eb7e16517'
DATABASES = tuple('gridex_auth_provisioning_' + name for name in ('reduced','prefix','failure','lock'))
ADMIN = 'gridex_auth_test'
EVENTS = 'public.auth_provisioning_events'
VIEW = 'public.gridex_user_auth_integrity_v'
POLICY = 'canonical_auth_provisioning_service_boundary'
SHAPE = 'AUTH_PROVISIONING_TARGET_SHAPE_MISMATCH'
ROLES = 'AUTH_PROVISIONING_ROLE_BOUNDARY_MISMATCH'
POLICIES = 'AUTH_PROVISIONING_POLICY_DEFINITION_MISMATCH'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def path_digest(paths):
    return digest(('\n'.join(paths) + '\n').encode())


def read(path):
    return (ROOT / path).read_text()


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def validate_sources(overrides=None, sequence=(G,R), manifest_override=None):
    """Same loading path for execution and negative controls; no edited G body."""
    assert tuple(sequence) == (G,R), 'whole source order requires G then R'
    manifest = manifest_override or json.loads(read('scripts/migration-history-manifest.json'))['files']
    values = {}
    for path, expected in ((G,G_SHA),(R,R_SHA)):
        data = (overrides or {}).get(path, (ROOT / 'supabase' / path).read_bytes())
        assert digest(data) == expected == manifest[Path(path).name], 'source checksum mismatch: ' + path
        values[path] = data.decode()
    assert len(values[G].splitlines()) == 51, 'G must contain all51 source lines'
    transaction_body(values[R])
    return values


def transaction_body(sql):
    """Only the labelled composite lane uses this exact verified byte span."""
    beginnings = list(re.finditer(r'^BEGIN;\n', sql, re.M))
    ends = list(re.finditer(r'^COMMIT;\n?$', sql, re.M))
    assert len(beginnings) == len(ends) == 1 and ends[0].end() == len(sql)
    begin, end = beginnings[0].end(), ends[0].start()
    assert begin < end and sql[begin:end].startswith("SET LOCAL lock_timeout = '10s';\n")
    return sql[begin:end]


def prefix_paths(order=None):
    if order is None:
        order = json.loads(read('scripts/gridex-aud-003-foundation-order.json'))['foundation']
    assert len(order) == 82, 'standalone stage preserves foundation82'
    assert path_digest(order[:41]) == PREFIX_SHA and path_digest(order[41:]) == SUFFIX_SHA
    rbac = module('diagnostics_rbac_prefix', 'canonical-rbac-prefix-selftest.py')
    assert order[37] == rbac.BOUNDARY and tuple(order[38:41]) == rbac.SOURCES
    assert G not in order and R not in order, 'selection is a subsequent reviewed task'
    return order[:41]


def verified_prefix_sources(overrides=None):
    manifest = json.loads(read('scripts/migration-history-manifest.json'))['files']
    derived = {}
    for filename in ('scripts/gridex-aud-003-legacy-foundation.json',
                     'scripts/gridex-aud-003-legacy-foundation.additions.json'):
        derived.update(json.loads(read(filename))['derivedBootstrap'])
    sources = []
    for path in prefix_paths():
        data = (overrides or {}).get(path, (ROOT / 'supabase' / path).read_bytes())
        if path.startswith('bootstrap/'):
            meta = derived[path]
            expected = meta['artifactSha256']
            original = ROOT / 'supabase' / meta['source']
            assert digest(original.read_bytes()) == manifest[original.name], 'derived source checksum'
        else:
            expected = manifest[Path(path).name]
        assert digest(data) == expected, 'prefix checksum mismatch: ' + path
        sources.append((path, data.decode()))
    assert digest((ROOT / BOOTSTRAP).read_bytes()) == BOOTSTRAP_SHA
    return sources


def constructor_checks():
    source = validate_sources()
    prefix = verified_prefix_sources()
    assert len(prefix) == 41
    order = json.loads(read('scripts/gridex-aud-003-foundation-order.json'))['foundation']
    changed = list(order)
    changed[38],changed[39] = changed[39],changed[38]
    try:
        prefix_paths(changed)
    except AssertionError:
        pass
    else:
        raise AssertionError('reordered actual prefix accepted')
    try:
        verified_prefix_sources({prefix[0][0]:prefix[0][1].encode()[:-1]})
    except AssertionError:
        pass
    else:
        raise AssertionError('truncated actual prefix accepted')
    proposed = order[:41]+[G,R]+order[41:]
    assert len(proposed)==84 and proposed[41:43]==[G,R]
    assert path_digest(proposed[:41])==PREFIX_SHA and path_digest(proposed[43:])==SUFFIX_SHA
    # Every rejection uses the constructor that the executing fixture consumes.
    for change in ({G:source[G].encode()[:-1]},
                   {G:source[G].replace('full join','left join',1).encode()},
                   {R:source[R].encode()[:-1]}):
        try:
            validate_sources(overrides=change)
        except AssertionError:
            pass
        else:
            raise AssertionError('altered or truncated source accepted')
    for order in ((R,G),(G,), (R,), (G,R,R)):
        try:
            validate_sources(sequence=order)
        except AssertionError:
            pass
        else:
            raise AssertionError('wrong order/missing repair accepted')
    tampered = json.loads(read('scripts/migration-history-manifest.json'))['files']
    tampered[Path(G).name] = '0'*64
    try:
        validate_sources(manifest_override=tampered)
    except AssertionError:
        pass
    else:
        raise AssertionError('checksum tampering accepted')
    assert digest((ROOT / 'scripts/canonical-auth-membership-group.py').read_bytes()) == RUNNER_SHA
    group = module('diagnostics_group', 'canonical-auth-membership-group.py')
    assert len(group.COMMANDS) == 15
    assert all(key not in clean_environment() for key in os.environ if key.startswith('PG'))
    for target in ('postgres', 'production', 'postgresql://localhost/customer'):
        try:
            command(target)
        except AssertionError:
            pass
        else:
            raise AssertionError('arbitrary target accepted')
    # Classification and global equality are checked by the existing focused
    # guards as well; no fixture SQL or table fragments select G implicitly.
    additions = json.loads(read('scripts/gridex-aud-003-legacy-foundation.additions.json'))
    assert G not in additions['foundation'] and R not in additions['foundation']
    workflow = read('.github/workflows/ops-hardening.yml')
    assert 'Create diagnostics migration skeleton' not in workflow
    assert workflow.count('run: python3 scripts/canonical-auth-provisioning-diagnostics-selftest.py') == 1
    assert workflow.index('run: python3 scripts/canonical-auth-membership-group.py') < workflow.index(
        'run: python3 scripts/canonical-auth-provisioning-diagnostics-selftest.py')
    account_run = subprocess.run(['python3','scripts/gridex-replay-input-accounting.py'],cwd=ROOT,text=True,capture_output=True)
    assert account_run.returncode == 1, 'source completeness remains blocking'
    account = json.loads(account_run.stdout)
    assert not account['errors'] and account['totalMigrations']==594
    assert account['counts']=={'FULL_FILE_SELECTED':523,'SUBSTITUTED':24,'UNCLASSIFIED':43,'EXPLICITLY_EXCLUDED':4}
    by_path = {item['path']:item['classification'] for item in account['migrations']}
    assert by_path[G]=='UNCLASSIFIED' and by_path[R]=='FULL_FILE_SELECTED'
    grouped = subprocess.run(['python3','scripts/gridex-replay-review-groups.py','--group','auth_membership_tenant'],cwd=ROOT,text=True,capture_output=True)
    group = json.loads(grouped.stdout)
    assert grouped.returncode==1 and not group['errors'] and len(group['inputs'])==340
    assert {key:sum(item['classification']==key for item in group['inputs']) for key in account['counts']} == {'FULL_FILE_SELECTED':280,'SUBSTITUTED':21,'UNCLASSIFIED':35,'EXPLICITLY_EXCLUDED':4}
    # Construct the actual SQL without emitting historical input or provider rows.
    sql = actual_prefix_sql(source)
    observed = re.findall(r'^-- DIAGNOSTICS_PREFIX_FILE (.+)$',sql,re.M)
    assert observed == prefix_paths()
    for path in (G,R):
        assert sql.count('-- DIAGNOSTICS_WHOLE_FILE ' + path + '\n') == 2
    assert source[G] in sql and source[R] in sql


def clean_environment():
    return {key:value for key,value in os.environ.items() if not key.startswith('PG')}


def command(database):
    assert database in (*DATABASES, ADMIN), 'target is not a fixed disposable database'
    # The published service's disposable password is not a production credential.
    url = 'postgresql://postgres:postgres@127.0.0.1:55440/' + database
    return ['psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose',url]


class Harness:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.serial = 0

    def start(self, database, sql, label):
        self.serial += 1
        stem = self.directory / str(self.serial)
        stem.with_suffix('.sql').write_text(sql)
        out = stem.with_suffix('.out').open('w')
        err = stem.with_suffix('.err').open('w')
        process = subprocess.Popen(command(database), stdin=subprocess.PIPE, stdout=out,
                                   stderr=err, text=True, env=clean_environment())
        try:
            process.stdin.write(sql + '\n')
            process.stdin.flush()
        except BrokenPipeError:
            pass  # finish reads only sanitized SQLSTATE/named-error diagnostics.
        return process, stem, out, err, label

    def finish(self, handle, state=None, error=None, timeout=120):
        process, stem, out, err, label = handle
        try:
            process.stdin.close()
        except BrokenPipeError:
            pass
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            raise AssertionError(label + ': bounded process deadline exceeded') from None
        finally:
            out.close()
            err.close()
        errors = stem.with_suffix('.err').read_text()
        states = re.findall(r'(?:ERROR|FATAL):\s+([A-Z0-9]{5}):', errors)
        if state:
            allowed = (state,) if isinstance(state,str) else state
            assert process.returncode != 0 and any(s in allowed for s in states), label + ': expected SQLSTATE ' + str(allowed) + ', got ' + str(states)
            assert error is None or error in errors, label + ': expected named rejection absent'
        else:
            assert process.returncode == 0, label + ': SQL failure ' + str(states) + ' (SQL and provider rows are not logged)'
        return stem.with_suffix('.out').read_text()

    def run(self, database, sql, label, state=None, error=None):
        return self.finish(self.start(database,sql,label),state,error)

    def reset(self, database):
        assert database in DATABASES
        self.run(ADMIN, f'DROP DATABASE IF EXISTS {database} WITH (FORCE);\nCREATE DATABASE {database};', 'reset fixed database')

    def wait_marker(self, handle, marker, timeout=15):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if marker in handle[1].with_suffix('.out').read_text():
                return
            if handle[0].poll() is not None:
                break
            time.sleep(.05)
        raise AssertionError(handle[4] + ': synchronization marker missing')


ASSERT = """CREATE SCHEMA diag_fixture;
CREATE FUNCTION public.test_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
SELECT test_assert(current_setting('server_version_num')::int/10000=17,'PostgreSQL17');
"""

REDUCED = """-- REDUCED: input FK/pair/NOT NULL constraints intentionally absent.
CREATE SCHEMA auth;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,updated_at timestamptz,created_at timestamptz);
CREATE TABLE public.companies(id uuid PRIMARY KEY);
CREATE TABLE public.roles(id uuid PRIMARY KEY);
CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,email text,updated_at timestamptz);
CREATE TABLE public.company_memberships(id uuid PRIMARY KEY,company_id uuid,user_id uuid,invited_email text,status text,updated_at timestamptz);
CREATE TABLE public.user_roles(id uuid PRIMARY KEY,company_id uuid,user_id uuid,status text,is_active boolean,updated_at timestamptz);
SELECT test_assert(NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid IN
 ('company_memberships'::regclass,'user_roles'::regclass) AND contype IN ('u','f')),'REDUCED looser constraints explicit');
"""


def uuid(prefix,n):
    return f'{prefix}0000000-0000-0000-0000-00000000000{n}'


def literal(value):
    if value is None:
        return 'NULL'
    if isinstance(value,bool):
        return 'true' if value else 'false'
    return "'" + str(value).replace("'","''") + "'"


def values(rows):
    return ',\n'.join('(' + ','.join(literal(v) for v in row) + ')' for row in rows)


def reduced_case(case):
    """Independent exact11-column expected rows; no derived view-result oracle."""
    jan1,jan3='2026-01-01T00:00:00Z','2026-01-03T00:00:00Z'
    auth,profiles,members,roles,expected=[],[],[],[],[]
    def identity(n,profile=True):
        auth.append((uuid(1,n),f'USER{n}@EXAMPLE.INVALID',jan3,jan1))
        if profile:
            profiles.append((uuid(1,n),f'profile{n}@example.invalid',jan3))
    def membership(i,n,c=1,status='active'):
        members.append((uuid(3,i),uuid(2,c) if c else None,uuid(1,n) if n else None,
                        f'member{n}@example.invalid',status,jan1))
    def role(i,n,c=1,status='active',active=True):
        roles.append((uuid(4,i),uuid(2,c) if c else None,uuid(1,n),status,active,jan3))
    def expect(n,c=1,a=True,p=True,m=True,r=True,ms='active',rs='active',active=True,stamp=jan1,email=None):
        expected.append((uuid(2,c) if c else None,uuid(1,n),email or f'user{n}@example.invalid',
                         a,p,m,r,ms if m else None,rs if r else None,active if r else None,stamp))
    if case=='two_tenant':
        identity(1)
        for c in (1,2):
            membership(c,1,c); role(c,1,c); expect(1,c)
    elif case=='multiple_roles':
        identity(2); membership(1,2); role(1,2); role(2,2); expect(2); expect(2)
    elif case=='membership_only':
        identity(3); membership(1,3); expect(3,r=False)
    elif case=='role_only':
        identity(4); role(1,4,2); expect(4,2,m=False,stamp=jan3)
    elif case=='profile_only':
        identity(5); expect(5,None,m=False,r=False,stamp=jan3)
    elif case=='auth_only':
        identity(6,False)
    elif case=='orphan':
        membership(1,7); expect(7,a=False,p=False,r=False,email='member7@example.invalid')
    elif case=='null_links':
        membership(1,8,None); role(1,8,None); membership(2,None,None)
        expect(8,None,a=False,p=False,r=False,email='member8@example.invalid')
        expect(8,None,a=False,p=False,m=False,stamp=jan3)
        expected[-1]=(*expected[-1][:2],None,*expected[-1][3:])
    elif case=='duplicates':
        for i in (1,2): membership(i,9); role(i,9)
        for _ in range(4): expect(9,a=False,p=False,email='member9@example.invalid')
    elif case=='conflicts':
        identity(1); membership(1,1,status='suspended'); role(1,1,status='disabled',active=False)
        expect(1,ms='suspended',rs='disabled',active=False)
    else:
        assert case=='empty'
    company_ids=sorted({row[1] for row in members+roles if row[1] is not None})
    sql=('INSERT INTO companies VALUES '+values([(c,) for c in company_ids])+';\n') if company_ids else ''
    for table,rows in (("auth.users",auth),("user_profiles",profiles),("company_memberships",members),("user_roles",roles)):
        if rows: sql += f'INSERT INTO {table} VALUES {values(rows)};\n'
    sql += f'CREATE TABLE diag_fixture.expected_view AS SELECT * FROM {VIEW} WITH NO DATA;\n'
    if expected: sql += 'INSERT INTO diag_fixture.expected_view VALUES '+values(expected)+';\n'
    return sql


def multiset(actual, expected, label):
    return f"SELECT test_assert(NOT EXISTS((({actual}) EXCEPT ALL ({expected})) UNION ALL (({expected}) EXCEPT ALL ({actual}))),'{label}');\n"


EVENT_SEED = """INSERT INTO public.auth_provisioning_events(id,created_at,event_type,status,email,user_id,company_id,actor_user_id,supabase_project_ref,message,details) VALUES
('50000000-0000-0000-0000-000000000001','2026-01-01T00:00:00Z','fixture.created','info','user1@example.invalid','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','fixture-project','synthetic event','{"fixture":1}'),
('50000000-0000-0000-0000-000000000002','2026-01-02T00:00:00Z','fixture.pending','arbitrary-status',NULL,NULL,'20000000-0000-0000-0000-000000000002',NULL,NULL,NULL,'{"fixture":[2,null]}'),
('50000000-0000-0000-0000-000000000003','2026-01-03T00:00:00Z','fixture.orphan','unmapped',NULL,'10000000-0000-0000-0000-000000000009',NULL,'10000000-0000-0000-0000-000000000009',NULL,'diagnostic anomaly','{"preserve":true}');
"""


def rows_snapshot():
    return """CREATE TABLE diag_fixture.rows_before(relation text,row_data jsonb);
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('public','auth') AND c.relkind='r' AND c.relname<>'auth_provisioning_events'
 LOOP EXECUTE format('INSERT INTO diag_fixture.rows_before SELECT %L,to_jsonb(t) FROM %I.%I t',
  t.nspname||'.'||t.relname,t.nspname,t.relname); END LOOP;
END $$;
CREATE TABLE diag_fixture.base_catalog AS SELECT c.oid,c.relowner,c.relacl,c.reloptions,c.relrowsecurity,c.relforcerowsecurity
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth')
 AND c.relname NOT IN ('auth_provisioning_events','gridex_user_auth_integrity_v');
CREATE TABLE diag_fixture.base_columns AS SELECT a.attrelid,a.attnum,a.attacl FROM pg_attribute a JOIN diag_fixture.base_catalog c ON c.oid=a.attrelid;
CREATE TABLE diag_fixture.defaults_before AS SELECT * FROM pg_default_acl;
CREATE TABLE diag_fixture.roles_before AS SELECT oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconfig FROM pg_roles;
CREATE TABLE diag_fixture.memberships_before AS SELECT * FROM pg_auth_members;
CREATE TABLE diag_fixture.policies_before AS SELECT oid,polrelid,polname,polcmd,polpermissive,polroles,polqual::text,polwithcheck::text FROM pg_policy;
"""


def rows_preserved():
    return """CREATE TEMP TABLE diagnostics_rows_after (LIKE diag_fixture.rows_before);
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('public','auth') AND c.relkind='r' AND c.relname<>'auth_provisioning_events'
 LOOP EXECUTE format('INSERT INTO diagnostics_rows_after SELECT %L,to_jsonb(t) FROM %I.%I t',
  t.nspname||'.'||t.relname,t.nspname,t.relname); END LOOP;
END $$;
""" + multiset('SELECT * FROM diagnostics_rows_after','SELECT * FROM diag_fixture.rows_before','all prior app Auth rows unchanged') + """DROP TABLE diagnostics_rows_after;
""" + multiset('SELECT c.oid,c.relowner,c.relacl,c.reloptions,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN diag_fixture.base_catalog b ON b.oid=c.oid',
'SELECT * FROM diag_fixture.base_catalog','non-target catalog unchanged') + multiset(
'SELECT a.attrelid,a.attnum,a.attacl FROM pg_attribute a JOIN diag_fixture.base_catalog c ON c.oid=a.attrelid',
'SELECT * FROM diag_fixture.base_columns','non-target column ACLs unchanged') + multiset(
'SELECT * FROM pg_default_acl','SELECT * FROM diag_fixture.defaults_before','default privileges unchanged') + multiset(
'SELECT oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconfig FROM pg_roles',
'SELECT * FROM diag_fixture.roles_before','roles unchanged') + multiset(
'SELECT * FROM pg_auth_members','SELECT * FROM diag_fixture.memberships_before','role memberships unchanged') + """SELECT test_assert(NOT EXISTS(SELECT * FROM diag_fixture.policies_before EXCEPT ALL SELECT oid,polrelid,polname,polcmd,polpermissive,polroles,polqual::text,polwithcheck::text FROM pg_policy),'preexisting policy OIDs and definitions retained');
"""


def retained_acl_catalog():
    # Expanded owner defaults compare equally before/after explicit GRANTs.
    # Only service event SELECT is a permitted addition; all other reviewed
    # owner/service relation and column privilege/grant-option tuples persist.
    return f"""SELECT c.oid relation,0::smallint attnum,a.grantor,a.grantee,a.privilege_type,a.is_grantable
 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
 WHERE c.oid IN ('{EVENTS}'::regclass,'{VIEW}'::regclass)
 AND a.grantee IN(c.relowner,(SELECT oid FROM pg_roles WHERE rolname='service_role'))
 AND NOT(c.oid='{EVENTS}'::regclass AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname='service_role') AND a.privilege_type='SELECT')
 UNION ALL SELECT c.oid,col.attnum,a.grantor,a.grantee,a.privilege_type,a.is_grantable
 FROM pg_class c JOIN pg_attribute col ON col.attrelid=c.oid CROSS JOIN LATERAL aclexplode(col.attacl) a
 WHERE c.oid IN ('{EVENTS}'::regclass,'{VIEW}'::regclass)
 AND a.grantee IN(c.relowner,(SELECT oid FROM pg_roles WHERE rolname='service_role'))"""


def target_snapshot():
    return 'CREATE TABLE diag_fixture.retained_acls AS '+retained_acl_catalog()+';\n'+f"""CREATE TABLE diag_fixture.event_rows AS SELECT to_jsonb(e) row_data FROM {EVENTS} e;
CREATE TABLE diag_fixture.view_rows AS SELECT to_jsonb(v) row_data FROM {VIEW} v;
CREATE TABLE diag_fixture.target_identity AS SELECT c.oid,c.relname,c.relowner,c.relkind FROM pg_class c
 WHERE c.oid IN ('{EVENTS}'::regclass,'{VIEW}'::regclass) OR c.oid IN (SELECT indexrelid FROM pg_index WHERE indrelid='{EVENTS}'::regclass);
CREATE TABLE diag_fixture.view_definition AS SELECT pg_get_viewdef('{VIEW}'::regclass,false) projection,obj_description('{VIEW}'::regclass,'pg_class') comment;
"""


def target_preserved():
    return multiset(retained_acl_catalog(),'SELECT * FROM diag_fixture.retained_acls','owner service ACLs retained without new view access') + multiset(f'SELECT to_jsonb(e) FROM {EVENTS} e','SELECT row_data FROM diag_fixture.event_rows','exact event history retained') + multiset(
        f'SELECT to_jsonb(v) FROM {VIEW} v','SELECT row_data FROM diag_fixture.view_rows','exact projection multiset retained') + multiset(
        "SELECT c.oid,c.relname,c.relowner,c.relkind FROM pg_class c JOIN diag_fixture.target_identity b ON b.oid=c.oid",
        'SELECT * FROM diag_fixture.target_identity','table index view OIDs owners retained') + multiset(
        f"SELECT pg_get_viewdef('{VIEW}'::regclass,false),obj_description('{VIEW}'::regclass,'pg_class')",
        'SELECT * FROM diag_fixture.view_definition','source projection and comment retained')


def secured(require_invoker=True):
    invoker = f"SELECT test_assert((SELECT reloptions @> ARRAY['security_invoker=true'] FROM pg_class WHERE oid='{VIEW}'::regclass),'invoker boundary');" if require_invoker else f"SELECT json_build_object('diagnosticsGAfterR',true,'reloptions',reloptions,'invoker',coalesce(reloptions @> ARRAY['security_invoker=true'],false),'runtimeReady',false) FROM pg_class WHERE oid='{VIEW}'::regclass;"
    return f"""SELECT test_assert((SELECT relrowsecurity AND NOT relforcerowsecurity FROM pg_class WHERE oid='{EVENTS}'::regclass),'event RLS boundary');
{invoker}
SELECT test_assert((SELECT count(*)=1 FROM pg_policy WHERE polrelid='{EVENTS}'::regclass AND polname='{POLICY}' AND NOT polpermissive AND polcmd='*'
 AND ARRAY(SELECT unnest(polroles) ORDER BY 1)=ARRAY(SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY oid)
 AND pg_get_expr(polqual,polrelid)='false' AND pg_get_expr(polwithcheck,polrelid)='false'),'exact restrictive policy');
SELECT test_assert(NOT EXISTS(SELECT FROM unnest(ARRAY['anon','authenticated','authenticator']) role_name
 CROSS JOIN unnest(ARRAY['{EVENTS}'::regclass,'{VIEW}'::regclass]) relation
 WHERE has_table_privilege(role_name,relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
 OR has_any_column_privilege(role_name,relation,'SELECT,INSERT,UPDATE,REFERENCES')),'effective client ACL denial');
SELECT test_assert(NOT EXISTS(SELECT FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
 WHERE c.oid IN ('{EVENTS}'::regclass,'{VIEW}'::regclass) AND a.grantee=0),'no PUBLIC relation grants');
SELECT test_assert(NOT EXISTS(SELECT FROM pg_attribute c CROSS JOIN LATERAL aclexplode(c.attacl) a
 WHERE c.attrelid IN ('{EVENTS}'::regclass,'{VIEW}'::regclass) AND a.grantee=0),'no PUBLIC column grants');
SELECT test_assert(has_table_privilege('service_role','{EVENTS}','SELECT'),'service event count retained');
SELECT test_assert(to_regclass('pg_temp.canonical_auth_provisioning_expected') IS NULL AND to_regclass('pg_temp.canonical_auth_provisioning_expected_v') IS NULL,'no reference objects survive R transaction');
"""


def hostile_grants():
    return f"""-- REDUCED explicit hostile relation/column grants, not managed-default evidence.
GRANT ALL ON {EVENTS},{VIEW} TO public,anon,authenticated,authenticator;
GRANT SELECT(email),INSERT(email),UPDATE(email),REFERENCES(user_id) ON {EVENTS},{VIEW} TO public,anon,authenticated,authenticator;
CREATE POLICY fixture_permissive ON {EVENTS} FOR ALL TO authenticated USING(true) WITH CHECK(true);
"""


def whole(path,text):
    return '-- DIAGNOSTICS_WHOLE_FILE '+path+'\n'+text+'\n'


def actual_prefix_sql(source):
    """Preserved38 seeding/oracle, full three6E files, exact41 snapshot, whole G/R."""
    rbac=module('diagnostics_actual_rbac','canonical-rbac-prefix-selftest.py')
    chunks=[read(BOOTSTRAP),'SET search_path = "$user",public,extensions;']
    files=verified_prefix_sources()
    chunks.extend('-- DIAGNOSTICS_PREFIX_FILE '+p+'\n'+sql for p,sql in files[:38])
    chunks += [rbac.catalog_prerequisites(),rbac.prefix_baseline(),rbac.reduced_seed(),"""
CREATE TEMP TABLE role_permissions_expected_after_cleanup AS
SELECT rp.* FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id
WHERE NOT (r.key NOT IN ('super_admin','superadmin','platform_admin') AND p.key IN ('tenants.write','permissions.manage','roles.manage'));
"""]
    for index,(p,sql) in enumerate(files[38:]):
        chunks.append('-- DIAGNOSTICS_PREFIX_FILE '+p+'\n'+sql)
        if index==0:
            chunks.append("UPDATE companies SET status='onboarding',country_code='',operating_environment='test' WHERE id='20000000-0000-0000-0000-000000000002';")
    chunks += [rbac.first_checks(), 'CREATE SCHEMA diag_fixture;', rows_snapshot(),
               whole(G,source[G]),EVENT_SEED,target_snapshot(),whole(R,source[R]),secured(),
               rows_preserved(),target_preserved(),
               f"CREATE TEMP TABLE diagnostics_policy_oid AS SELECT oid FROM pg_policy WHERE polrelid='{EVENTS}'::regclass AND polname='{POLICY}';",
               whole(G,source[G]),secured(require_invoker=False),target_preserved(),whole(R,source[R]),secured(),rows_preserved(),target_preserved(),
               f"SELECT test_assert((SELECT oid FROM diagnostics_policy_oid)=(SELECT oid FROM pg_policy WHERE polrelid='{EVENTS}'::regclass AND polname='{POLICY}'),'repeat retains policy OID');"]
    final=(ROOT/'supabase'/rbac.FINAL).read_bytes()
    manifest=json.loads(read('scripts/migration-history-manifest.json'))['files']
    assert digest(final)==manifest[Path(rbac.FINAL).name]
    chunks += ['-- DIAGNOSTICS_FINAL_HELPER '+rbac.FINAL+'\n'+final.decode(),rbac.final_checks(),rbac.governance_trigger_checks(),rbac.journal_checks(),rows_preserved(),target_preserved()]
    return '\n'.join(chunks)


def expect_view():
    return multiset(f'SELECT * FROM {VIEW}','SELECT * FROM diag_fixture.expected_view','independent exact11-field view multiset')


def client_denial(h,database,actual=False):
    claims=(('authenticator',1,'authenticator'),('anon',1,'tenant1'),('authenticated',1,'tenant1'),
            ('authenticated',3 if actual else 1,'tenant2'),('authenticated',2,'inactive'),
            ('authenticated',6,'anonymous-auth'),('authenticated',7,'platform-admin'))
    statements=(f'SELECT * FROM {EVENTS}',
                f"INSERT INTO {EVENTS}(event_type) VALUES('fixture.denied')",
                f"UPDATE {EVENTS} SET message='fixture.denied'",
                f'DELETE FROM {EVENTS}',f'SELECT * FROM {VIEW}')
    for role,n,kind in claims:
        claim=json.dumps({'sub':uuid(1,n),'role':role,'is_anonymous':kind=='anonymous-auth',
                          'app_metadata':{'company_id':uuid(2,2 if kind=='tenant2' else 1),
                                          'roles':['platform_admin'] if kind=='platform-admin' else []}},separators=(',',':'))
        for statement in statements:
            h.run(database,f"SET ROLE {role}; SET request.jwt.claim.sub={literal(uuid(1,n))}; SET request.jwt.claims={literal(claim)}; {statement};",
                  'client direct denial '+kind,'42501')
    h.run(database,f"SET ROLE service_role; SELECT public.test_assert((SELECT count(*)=3 FROM {EVENTS}),'service count3');",'service count3')


def event_constraints(h,database):
    for column in ('event_type','status','details','created_at'):
        columns='event_type' if column=='event_type' else 'event_type,'+column
        vals='NULL' if column=='event_type' else "'fixture.native',NULL"
        h.run(database,f'INSERT INTO {EVENTS}({columns}) VALUES({vals});','native NOT NULL '+column,'23502')
    h.run(database,f"INSERT INTO {EVENTS}(id,event_type) VALUES('50000000-0000-0000-0000-000000000001','fixture.duplicate');",'native duplicate event id','23505')
    h.run(database,target_preserved(),'native rejected event writes preserve history')


def policy_interaction(h,database,source):
    # Exact predicate from the named June11 policy, explicitly a REDUCED excerpt.
    later='supabase/migrations/20260611203000_launch_rls_suggestion_policy_completion.sql'
    raw=(ROOT/later).read_bytes()
    manifest=json.loads(read('scripts/migration-history-manifest.json'))['files']
    assert digest(raw)==manifest[Path(later).name]
    expected="create policy gridex_launch_platform_only on public.%I for all to authenticated using (public.gridex_user_is_platform_admin()) with check (public.gridex_user_is_platform_admin())"
    assert expected in raw.decode()
    sql=f"""-- REDUCED policy interaction; not whole June source execution.
CREATE FUNCTION public.gridex_user_is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT current_setting('request.jwt.claim.sub',true)='10000000-0000-0000-0000-000000000007' $$;
{expected.replace('public.%I',EVENTS)};
GRANT SELECT,INSERT,UPDATE,DELETE ON {EVENTS} TO authenticated;
SET ROLE authenticated;
SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000007';
SELECT public.test_assert(public.gridex_user_is_platform_admin(),'REDUCED platform helper true');
SELECT public.test_assert((SELECT count(*)=0 FROM {EVENTS}),'restrictive false dominates permissive true and platform policies');
WITH affected AS (UPDATE {EVENTS} SET message='fixture.denied' RETURNING *) SELECT public.test_assert((SELECT count(*)=0 FROM affected),'restrictive policy UPDATE0');
WITH affected AS (DELETE FROM {EVENTS} RETURNING *) SELECT public.test_assert((SELECT count(*)=0 FROM affected),'restrictive policy DELETE0');
RESET ROLE;
"""
    h.run(database,sql,'REDUCED permissive platform interaction')
    h.run(database,f"SET ROLE authenticated; SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000007'; INSERT INTO {EVENTS}(event_type) VALUES('fixture.denied');",'restrictive INSERT denied','42501')
    h.run(database,source[R]+secured()+target_preserved(),'revoke later synthetic grants and preserve history')


def reduced_lanes(h,source):
    database=DATABASES[0]
    cases=('empty','two_tenant','multiple_roles','membership_only','role_only','profile_only',
           'auth_only','orphan','null_links','duplicates','conflicts')
    for case in cases:
        h.reset(database)
        # Hostile defaults are seeded only after the four reduced inputs exist.
        setup=ASSERT+REDUCED+"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO authenticated;\n"
        h.run(database,setup+source[G]+reduced_case(case),'REDUCED '+case+' source G')
        seed=(f'GRANT SELECT(email) ON {VIEW} TO service_role;\n' if case=='empty' else EVENT_SEED)
        h.run(database,seed+hostile_grants()+rows_snapshot()+target_snapshot()+expect_view(), 'REDUCED '+case+' independent oracle')
        count=0 if case=='empty' else 3
        view_count={'empty':0,'two_tenant':2,'multiple_roles':2,'membership_only':1,'role_only':1,'profile_only':1,'auth_only':0,'orphan':1,'null_links':2,'duplicates':4,'conflicts':1}[case]
        h.run(database,f"""SELECT test_assert((SELECT NOT relrowsecurity FROM pg_class WHERE oid='{EVENTS}'::regclass),'G-only no RLS');
SELECT test_assert((SELECT NOT coalesce(reloptions @> ARRAY['security_invoker=true'],false) FROM pg_class WHERE oid='{VIEW}'::regclass),'G-only owner view');
SET ROLE authenticated;
SELECT public.test_assert((SELECT count(*)={count} FROM {EVENTS}),'hostile grant exposes synthetic events before R');
SELECT public.test_assert((SELECT count(*)={view_count} FROM {VIEW}),'hostile owner view exposes exact synthetic projection');
RESET ROLE;
""",'REDUCED '+case+' negative-first exposure')
        h.run(database,secured(),'REDUCED '+case+' negative-first security assertion','P0001','event RLS boundary')
        for cycle in range(2):
            h.run(database,source[R]+secured()+rows_preserved()+target_preserved()+expect_view(), 'REDUCED '+case+' R '+str(cycle))
            if cycle==0:
                h.run(database,f"CREATE TABLE diag_fixture.policy_oid AS SELECT oid FROM pg_policy WHERE polrelid='{EVENTS}'::regclass AND polname='{POLICY}';",'capture policy OID')
                # Whole G after R separately proves option/ACL retention at commit.
                observation=h.run(database,source[G]+secured(require_invoker=False)+target_preserved()+expect_view(),'REDUCED '+case+' G after R characterization')
                report_g_observation(observation,'REDUCED '+case)
        h.run(database,f"SELECT test_assert((SELECT oid FROM diag_fixture.policy_oid)=(SELECT oid FROM pg_policy WHERE polrelid='{EVENTS}'::regclass AND polname='{POLICY}'),'policy OID retained');",'repeat policy identity')
        if case=='empty':
            h.run(database,f'SET ROLE service_role; SELECT email FROM {VIEW};','existing service view grant cannot bypass base ACLs','42501')
        if case=='two_tenant':
            client_denial(h,database)
            event_constraints(h,database)
            policy_interaction(h,database,source)
        if case=='conflicts':
            # Independently exercise the other two COALESCE branches.
            h.run(database,"UPDATE auth.users SET email=NULL; UPDATE diag_fixture.expected_view SET email='profile1@example.invalid';"+expect_view(), 'profile email precedence')
            h.run(database,"UPDATE user_profiles SET email=NULL; UPDATE diag_fixture.expected_view SET email='member1@example.invalid';"+expect_view(), 'membership email precedence')
        print('PASS: REDUCED '+case+' exact values, G/R repeats and preservation',flush=True)


def catalog_state():
    """Observable target security and definitions, deliberately excluding stats."""
    return f"""SELECT 'relation' kind,jsonb_build_array(c.oid,c.relname,c.relowner,c.relkind,c.relacl,c.reloptions,c.relrowsecurity,c.relforcerowsecurity) data
 FROM pg_class c WHERE c.oid IN ('{EVENTS}'::regclass,'{VIEW}'::regclass)
 UNION ALL SELECT 'column',jsonb_build_array(a.attrelid,a.attnum,a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attacl,pg_get_expr(d.adbin,d.adrelid))
 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid IN ('{EVENTS}'::regclass,'{VIEW}'::regclass) AND a.attnum>0
 UNION ALL SELECT 'policy',jsonb_build_array(oid,polrelid,polname,polcmd,polroles,polpermissive,polqual::text,polwithcheck::text)
 FROM pg_policy WHERE polrelid='{EVENTS}'::regclass
 UNION ALL SELECT 'index',jsonb_build_array(indexrelid,pg_get_indexdef(indexrelid),indisvalid,indisready,indislive)
 FROM pg_index WHERE indrelid='{EVENTS}'::regclass
 UNION ALL SELECT 'inheritance',to_jsonb(i) FROM pg_inherits i WHERE inhrelid='{EVENTS}'::regclass OR inhparent='{EVENTS}'::regclass
 UNION ALL SELECT 'view',jsonb_build_array(pg_get_viewdef('{VIEW}'::regclass,false),obj_description('{VIEW}'::regclass,'pg_class'))"""


def dirty_lanes(h,source):
    database=DATABASES[2]
    # Each case starts at a fresh source-created target. No shared dirty state.
    cases=(
      ('index-key',f'DROP INDEX auth_provisioning_events_company_created_idx; CREATE INDEX auth_provisioning_events_company_created_idx ON {EVENTS}(user_id,created_at DESC);',SHAPE),
      ('index-order',f'DROP INDEX auth_provisioning_events_company_created_idx; CREATE INDEX auth_provisioning_events_company_created_idx ON {EVENTS}(company_id,created_at);',SHAPE),
      ('index-predicate',f'DROP INDEX auth_provisioning_events_email_created_idx; CREATE INDEX auth_provisioning_events_email_created_idx ON {EVENTS}(lower(email),created_at DESC) WHERE email IS NULL;',SHAPE),
      ('index-unique',f'DROP INDEX auth_provisioning_events_company_created_idx; CREATE UNIQUE INDEX auth_provisioning_events_company_created_idx ON {EVENTS}(company_id,created_at DESC);',SHAPE),
      ('index-invalid',"UPDATE pg_index SET indisvalid=false WHERE indexrelid='auth_provisioning_events_company_created_idx'::regclass;",SHAPE),
      ('column-default',f"ALTER TABLE {EVENTS} ALTER status SET DEFAULT 'wrong';",SHAPE),
      ('column-type',f'ALTER TABLE {EVENTS} ALTER message TYPE varchar(30);',SHAPE),
      ('column-nullability',f'ALTER TABLE {EVENTS} ALTER event_type DROP NOT NULL;',SHAPE),
      ('table-inheritance',f'CREATE TABLE diag_fixture.inherited_parent (LIKE {EVENTS} INCLUDING DEFAULTS); ALTER TABLE {EVENTS} INHERIT diag_fixture.inherited_parent;',SHAPE),
      ('column-extra',f'ALTER TABLE {EVENTS} ADD unexpected text;',SHAPE),
      ('primary-key',f'ALTER TABLE {EVENTS} DROP CONSTRAINT auth_provisioning_events_pkey; ALTER TABLE {EVENTS} ADD PRIMARY KEY(id,created_at);',SHAPE),
      ('constraint-extra',f'ALTER TABLE {EVENTS} ADD CONSTRAINT fixture_extra CHECK(event_type<>\'wrong\');',SHAPE),
      ('trigger-extra',f"CREATE FUNCTION diag_fixture.noop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; CREATE TRIGGER fixture_extra BEFORE INSERT ON {EVENTS} FOR EACH ROW EXECUTE FUNCTION diag_fixture.noop();",SHAPE),
      ('view-projection',f'CREATE OR REPLACE VIEW {VIEW} AS SELECT * FROM {VIEW} WHERE false;',SHAPE),
      ('view-comment',f"COMMENT ON VIEW {VIEW} IS 'fixture wrong';",SHAPE),
      ('view-options',f'ALTER VIEW {VIEW} SET(security_barrier=true);',SHAPE),
      ('unclassified-grant',f'GRANT SELECT ON {EVENTS} TO diagnostics_unclassified;',SHAPE),
      ('unclassified-column',f'GRANT SELECT(email) ON {EVENTS} TO diagnostics_unclassified;',SHAPE),
      ('wrong-policy-true',f'CREATE POLICY {POLICY} ON {EVENTS} AS RESTRICTIVE FOR ALL TO anon,authenticated USING(true) WITH CHECK(false);',POLICIES),
      ('wrong-policy-roles',f'CREATE POLICY {POLICY} ON {EVENTS} AS RESTRICTIVE FOR ALL TO authenticated USING(false) WITH CHECK(false);',POLICIES),
      ('wrong-policy-command',f'CREATE POLICY {POLICY} ON {EVENTS} AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(false);',POLICIES),
      ('wrong-policy-permissive',f'CREATE POLICY {POLICY} ON {EVENTS} FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);',POLICIES),
      ('wrong-owner',f'ALTER TABLE {EVENTS} OWNER TO diagnostics_unclassified;',ROLES),
    )
    for label,mutation,error in cases:
        h.reset(database)
        # Self-referencing view would fail natively instead of testing R's exact
        # projection comparison: use a source-literal altered SELECT instead.
        if label=='view-projection':
            start=source[G].index('create or replace view ')
            end=source[G].index('\n\ncomment on view ',start)
            mutation=source[G][start:end].replace('full join public.user_roles','left join public.user_roles')
        h.run(database,ASSERT+REDUCED+source[G]+EVENT_SEED+mutation,'dirty seed '+label)
        h.run(database,'CREATE TABLE diag_fixture.failure_catalog AS '+catalog_state()+';'+target_snapshot(), 'dirty snapshot '+label)
        h.run(database,source[R],'named dirty rejection '+label,'P0001',error)
        h.run(database,multiset(catalog_state(),'SELECT * FROM diag_fixture.failure_catalog','failed R leaves exact dirty catalog')+target_preserved(), 'dirty atomic rollback '+label)
        # Recover by correcting only the synthetic incompatible target definition;
        # all other cases prove rollback, and the default case proves a retry.
        if label=='column-default':
            h.run(database,f"ALTER TABLE {EVENTS} ALTER status SET DEFAULT 'info';"+source[R]+secured()+target_preserved(),'dirty corrected retry')
        print('PASS: REDUCED dirty '+label+' named rejection and rollback',flush=True)


def inherited_lanes(h,source):
    database=DATABASES[2]
    # Reviewed service grants are retained, so inherited service privileges must
    # be rejected by effective checks even when no unknown ACL grantee exists.
    for label,change,undo in (
      ('missing-role', 'ALTER ROLE authenticator RENAME TO diagnostics_authenticator_missing;', 'ALTER ROLE diagnostics_authenticator_missing RENAME TO authenticator;'),
      ('service-bypass', 'ALTER ROLE service_role NOBYPASSRLS;', 'ALTER ROLE service_role BYPASSRLS;'),
      ('client-bypass', 'ALTER ROLE authenticated BYPASSRLS;', 'ALTER ROLE authenticated NOBYPASSRLS;'),
      ('inherited-table',f'GRANT SELECT ON {EVENTS} TO service_role; GRANT service_role TO authenticated WITH INHERIT TRUE;', 'REVOKE service_role FROM authenticated;'),
      ('inherited-column',f'GRANT SELECT(email) ON {VIEW} TO service_role; GRANT service_role TO authenticated WITH INHERIT TRUE;', 'REVOKE service_role FROM authenticated;'),
    ):
        h.reset(database)
        h.run(database,ASSERT+REDUCED+source[G]+EVENT_SEED,'role boundary fresh source')
        try:
            h.run(database,change+'CREATE TABLE diag_fixture.failure_catalog AS '+catalog_state()+';'+target_snapshot(),'role synthetic incompatibility')
            h.run(database,source[R],'role boundary '+label,'P0001',ROLES)
            h.run(database,multiset(catalog_state(),'SELECT * FROM diag_fixture.failure_catalog','role failure has no partial security commit')+target_preserved(),'role rollback '+label)
        finally:
            h.run(database,undo,'restore synthetic shared role shape')
        h.run(database,source[R]+secured()+target_preserved(),'role corrected retry '+label)
        print('PASS: REDUCED '+label+' effective role rejection and corrected retry',flush=True)


def native_failures(h,source):
    database=DATABASES[2]
    for label,mutation,state in (
        ('auth-timestamp','ALTER TABLE auth.users DROP COLUMN updated_at;','42703'),
        ('role-relation','DROP TABLE public.user_roles;','42P01'),
        ('view-type',f'CREATE VIEW {VIEW} AS SELECT 1::integer AS company_id;','42P16'),
        ('view-order',f'CREATE VIEW {VIEW} AS SELECT NULL::uuid AS user_id,NULL::uuid AS company_id;','42P16'),
    ):
        h.reset(database)
        h.run(database,ASSERT+REDUCED+mutation,'native prerequisite seed '+label)
        h.run(database,source[G],'native whole G '+label,state)
        h.run(database,f"SELECT test_assert(to_regclass('{EVENTS}') IS NOT NULL AND to_regclass('auth_provisioning_events_company_created_idx') IS NOT NULL AND to_regclass('auth_provisioning_events_email_created_idx') IS NOT NULL,'native G earlier table indexes committed');",'native G autocommit effects '+label)
        h.reset(database)
        h.run(database,ASSERT+REDUCED+mutation,'composite prerequisite seed '+label)
        composite='BEGIN;\n'+source[G]+transaction_body(source[R])+'COMMIT;\n'
        h.run(database,composite,'LABELLED composite exact G plus R body '+label,state)
        h.run(database,f"SELECT test_assert(to_regclass('{EVENTS}') IS NULL AND to_regclass('auth_provisioning_events_company_created_idx') IS NULL,'composite G effects all rolled back');",'composite rollback '+label)
        print('PASS: native '+state+' '+label+'; G autocommit vs labelled composite rollback',flush=True)
    # R-only intermediate registration must reject missing G, never create it.
    h.reset(database)
    h.run(database,ASSERT+REDUCED,'R-only seed')
    h.run(database,source[R],'R-only admission fails','P0001',SHAPE)
    h.run(database,f"SELECT test_assert(to_regclass('{EVENTS}') IS NULL,'R never manufactures missing G');",'R-only absent G unchanged')
    # Successful G and a deliberately incompatible index: failure occurs in R
    # body, proving composite rollback also covers post-G preflight failures.
    h.reset(database)
    h.run(database,ASSERT+REDUCED,'composite dirty seed')
    dirty=f"ALTER TABLE {EVENTS} ALTER status SET DEFAULT 'wrong';"
    h.run(database,'BEGIN;\n'+source[G]+dirty+transaction_body(source[R])+'COMMIT;\n','LABELLED composite R-body rejection','P0001',SHAPE)
    h.run(database,f"SELECT test_assert(to_regclass('{EVENTS}') IS NULL,'composite R rejection rolls back whole G');",'composite R rollback')


def concurrency(h,source):
    database=DATABASES[3]
    h.reset(database)
    h.run(database,ASSERT+REDUCED+source[G]+EVENT_SEED+source[R]+secured()+target_snapshot(), 'real lock protected baseline')
    h.run(database,'CREATE TABLE diag_fixture.lock_catalog AS '+catalog_state()+';', 'real lock snapshot')
    holder=h.start(database,f'BEGIN; LOCK TABLE {EVENTS} IN ACCESS EXCLUSIVE MODE;\n\\echo DIAGNOSTICS_LOCK_HELD\n','real lock holder')
    try:
        h.wait_marker(holder,'DIAGNOSTICS_LOCK_HELD')
        started=time.monotonic()
        h.run(database,source[R],'real whole R contender finite lock timeout','55P03')
        assert 8 <= time.monotonic()-started < 35, 'real lock_timeout10s bound'
    finally:
        if holder[0].poll() is None:
            holder[0].stdin.write('COMMIT;\n'); holder[0].stdin.flush()
        h.finish(holder)
    h.run(database,multiset(catalog_state(),'SELECT * FROM diag_fixture.lock_catalog','lock timeout leaves exact security catalog')+target_preserved(),'real lock failed R preservation')
    retry=h.start(database,source[R],'real serialized retry')
    reader=h.start(database,f'SET ROLE authenticated; SELECT * FROM {EVENTS};','concurrent protected reader')
    h.finish(retry)
    h.finish(reader,'42501')
    h.run(database,secured()+target_preserved(),'real retry boundary remains protected')
    print('PASS: real two-connection55P03, unchanged committed boundary, serialized retry and concurrent reader denial',flush=True)
    # Deterministic catalog contention: holder executes whole G in an explicitly
    # labelled transaction; native G contender has already observed absence.
    h.reset(database)
    h.run(database,ASSERT+REDUCED,'concurrent whole G empty target')
    holder=h.start(database,'BEGIN;\n'+source[G]+'\n\\echo DIAGNOSTICS_G_HELD\n','whole G creation holder transaction')
    contender=None
    try:
        h.wait_marker(holder,'DIAGNOSTICS_G_HELD')
        contender=h.start(database,"SET application_name='diagnostics_g_contender'; SET statement_timeout='20s';\n"+source[G],'native whole G concurrent creation')
        deadline=time.monotonic()+10
        blocked=False
        while time.monotonic()<deadline:
            output=h.run(ADMIN,"SELECT count(*) FROM pg_stat_activity WHERE application_name='diagnostics_g_contender' AND wait_event_type='Lock';",'observe real whole G catalog wait')
            if output.strip()=='1': blocked=True; break
            time.sleep(.05)
        assert blocked,'whole G contender did not reach observed catalog lock'
    finally:
        if holder[0].poll() is None:
            holder[0].stdin.write('COMMIT;\n'); holder[0].stdin.flush()
        h.finish(holder)
    assert contender is not None
    h.finish(contender,('23505','42P07','42710'))
    h.run(database,secured(),'failed concurrent creation forbids application admission','P0001','event RLS boundary')
    h.run(database,source[G]+source[R]+secured(),'serialize whole G/R after catalog creation error')
    print('PASS: real whole G catalog contention rejects admission; serialized G/R retry',flush=True)


def report_g_observation(output,lane):
    # Select only the known synthetic option observation from private psql output.
    # No historical output lines or provider-shaped rows are printed.
    observations=[json.loads(line) for line in output.splitlines() if line.startswith('{"diagnosticsGAfterR"')]
    assert len(observations)==1
    item=observations[0]
    assert set(item)=={'diagnosticsGAfterR','reloptions','invoker','runtimeReady'}
    assert item['diagnosticsGAfterR'] is True and item['runtimeReady'] is False and isinstance(item['invoker'],bool)
    print(json.dumps({'lane':lane,'wholeGAfterRInvoker':item['invoker'],'wholeGAfterRReloptions':item['reloptions'],'runtimeReady':False}),flush=True)


def actual_prefix_lane(h,source):
    database=DATABASES[1]
    h.reset(database)
    observation=h.run(database,actual_prefix_sql(source),'ACTUAL_PREFIX41 complete files G/R repeat final selected helper')
    report_g_observation(observation,'ACTUAL_PREFIX41')
    # Pair uniqueness is tested without removing the actual canonical constraint.
    # These existing synthetic memberships were introduced at the preserved38 seed.
    h.run(database,"""INSERT INTO public.company_memberships(id,company_id,user_id,status,role,membership_role)
VALUES('30000000-0000-0000-0000-000000000009','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','active','member','member');""",
          'ACTUAL_PREFIX native duplicate membership pair','23505')
    h.run(database,rows_preserved()+target_preserved()+secured(),'ACTUAL_PREFIX native failure preservation')
    h.run(database,"SELECT test_assert((SELECT user_status='disabled' FROM user_profiles WHERE id='10000000-0000-0000-0000-000000000002'),'actual inactive profile identity'); SELECT test_assert(EXISTS(SELECT FROM company_memberships WHERE company_id='20000000-0000-0000-0000-000000000002' AND user_id='10000000-0000-0000-0000-000000000003' AND status='active'),'actual ordinary tenant2 identity');",'actual client identity prerequisites')
    client_denial(h,database,actual=True)
    print('PASS: ACTUAL_PREFIX41 complete sources, preserved38 RBAC oracle, whole G/R twice, final helper, native pair uniqueness and zero G/R row deltas',flush=True)


def main():
    assert len(sys.argv)==1, 'no arbitrary targets or SQL-emitting CLI accepted'
    constructor_checks()
    source=validate_sources()
    for path in (G,R):
        print(json.dumps({'path':'supabase/'+path,'sha256':digest(source[path].encode()),
                          'lines':len(source[path].splitlines()),'lane':'source receipt','sql':'pending execution'}),flush=True)
    with tempfile.TemporaryDirectory(prefix='gridex-diagnostics-private-') as directory:
        h=Harness(directory)
        # Roles already exist after the fixed15 group; managed-compatible full
        # bootstrap is reused on a disposable DB so standalone execution also works.
        h.reset(DATABASES[1])
        h.run(DATABASES[1],read(BOOTSTRAP),'managed-compatible platform role bootstrap')
        h.run(ADMIN,"DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='diagnostics_unclassified') THEN CREATE ROLE diagnostics_unclassified NOLOGIN; END IF; END $$;",'synthetic unclassified fixture role')
        try:
            reduced_lanes(h,source)
            dirty_lanes(h,source)
            inherited_lanes(h,source)
            native_failures(h,source)
            concurrency(h,source)
            actual_prefix_lane(h,source)
        finally:
            # Shared fixed cluster roles are restored by inherited_lanes finally;
            # drop these four disposable databases before removing our fixture role.
            for database in DATABASES:
                h.run(ADMIN,f'DROP DATABASE IF EXISTS {database} WITH(FORCE);','cleanup fixed disposable database')
            h.run(ADMIN,'DROP ROLE diagnostics_unclassified;','cleanup synthetic fixture role')
    print('PASS: standalone auth provisioning diagnostics PostgreSQL17; G remains UNCLASSIFIED; later chain and production gates OPEN',flush=True)


if __name__=='__main__':
    main()
