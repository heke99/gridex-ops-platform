"""Prove portable public default grants against a freshly CLI-created Supabase.

Uses only synthetic probe objects in a parent-owned, unlinked local project.
The old bootstrap is reconstructed byte-for-byte as the required negative control.
No hosted database, historical business SQL or acceptance baseline is changed.
"""
import hashlib
import json
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
BOOTSTRAP = ROOT/'scripts/sql/gridex-supabase-compatible-bootstrap.sql'
OLD_SHA = '41cc610b7cfa8a7c894c5433a5593607028ad85e885db64b1d094abb486dd391'
OLD = '''-- Supabase grants EXECUTE on newly created functions to the client roles
-- through default privileges. Without this the harness sees a NULL ACL where
-- the real stack has an explicit anon grant, so a migration that revokes only
-- from PUBLIC looks sufficient here and is not. Functions only: table default
-- privileges are deliberately NOT replicated, because a table's reachability
-- is what the tenant invariant gate measures and inventing grants here would
-- manufacture findings.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;'''
NEW = '''-- Match the initial public-object privileges observed on a fresh Supabase
-- CLI 2.101.0 / PostgreSQL 17 database. Historical migrations classify tables
-- by client reachability, so omitting table/sequence defaults changes which
-- tenant guards, RLS policies and composite foreign keys they create.
-- This is empty test-database initialization, NOT a grant to existing/live
-- tables. Later migration revocations remain authoritative and unmodified.
-- The native lifecycle job executes the old bootstrap as a negative control
-- and compares all 48 table/sequence/function privilege checks for this one.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;'''
ROLES = ('anon', 'authenticated', 'postgres', 'service_role')
PRIVILEGES = {'table': ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'),
              'sequence': ('USAGE', 'SELECT', 'UPDATE'), 'function': ('EXECUTE',)}
EXPECTED_KEYS = {(kind, role, privilege) for kind, privileges in PRIVILEGES.items()
                 for role in ROLES for privilege in privileges}
PROBES = '''BEGIN;
CREATE TABLE public.gridex_bootstrap_acl_probe(id integer PRIMARY KEY);
ALTER TABLE public.gridex_bootstrap_acl_probe ENABLE ROW LEVEL SECURITY;
CREATE SEQUENCE public.gridex_bootstrap_acl_probe_seq;
CREATE FUNCTION public.gridex_bootstrap_acl_probe_fn() RETURNS integer LANGUAGE sql
IMMUTABLE SECURITY INVOKER AS 'SELECT 1';
COMMIT;
'''
DROP = '''BEGIN;
DROP FUNCTION public.gridex_bootstrap_acl_probe_fn();
DROP SEQUENCE public.gridex_bootstrap_acl_probe_seq;
DROP TABLE public.gridex_bootstrap_acl_probe;
COMMIT;
'''
# Only fixed synthetic object metadata is returned; no production/data values.
CAPTURE = '''WITH roles AS (SELECT unnest(ARRAY['anon','authenticated','postgres','service_role']) AS role),
grants AS (
SELECT 'table' AS kind, role, privilege, has_table_privilege(role, 'public.gridex_bootstrap_acl_probe', privilege) AS allowed
FROM roles CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) AS privilege
UNION ALL
SELECT 'sequence', role, privilege, has_sequence_privilege(role, 'public.gridex_bootstrap_acl_probe_seq', privilege)
FROM roles CROSS JOIN unnest(ARRAY['USAGE','SELECT','UPDATE']) AS privilege
UNION ALL
SELECT 'function', role, 'EXECUTE', has_function_privilege(role, 'public.gridex_bootstrap_acl_probe_fn()', 'EXECUTE') FROM roles)
SELECT jsonb_build_object(
'grants',(SELECT jsonb_agg(to_jsonb(g) ORDER BY kind, role, privilege) FROM grants g),
'rlsEnabled',(SELECT relrowsecurity FROM pg_class WHERE oid='public.gridex_bootstrap_acl_probe'::regclass),
'forcedRls',(SELECT relforcerowsecurity FROM pg_class WHERE oid='public.gridex_bootstrap_acl_probe'::regclass),
'functionSecurityDefiner',(SELECT prosecdef FROM pg_proc WHERE oid='public.gridex_bootstrap_acl_probe_fn()'::regprocedure),
'publicFunctionExecute',EXISTS(SELECT FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='public.gridex_bootstrap_acl_probe_fn()'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'));
'''


def sources():
    if BOOTSTRAP.is_symlink() or not BOOTSTRAP.is_file():
        raise ValueError('BOOTSTRAP_SOURCE_REQUIRED')
    new = BOOTSTRAP.read_bytes()
    if new.count(NEW.encode()) != 1:
        raise ValueError('NATIVE_BOOTSTRAP_DEFAULTS_REQUIRED')
    old = new.replace(NEW.encode(), OLD.encode())
    if hashlib.sha256(old).hexdigest() != OLD_SHA:
        raise ValueError('EXACT_BOOTSTRAP_PREDECESSOR_REQUIRED')
    return old, new


def validate(value):
    fields = {'grants', 'rlsEnabled', 'forcedRls', 'functionSecurityDefiner', 'publicFunctionExecute'}
    if (type(value) is not dict or set(value) != fields or type(value['grants']) is not list
            or any(type(value[field]) is not bool for field in fields-{'grants'})):
        raise ValueError('COMPLETE_BOOTSTRAP_MATRIX_REQUIRED')
    found = set()
    for row in value['grants']:
        if type(row) is not dict or set(row) != {'kind', 'role', 'privilege', 'allowed'}:
            raise ValueError('COMPLETE_BOOTSTRAP_MATRIX_REQUIRED')
        key = tuple(row[field] for field in ('kind', 'role', 'privilege'))
        if any(type(part) is not str for part in key) or key not in EXPECTED_KEYS or key in found or type(row['allowed']) is not bool:
            raise ValueError('COMPLETE_BOOTSTRAP_MATRIX_REQUIRED')
        found.add(key)
    if found != EXPECTED_KEYS:
        raise ValueError('COMPLETE_BOOTSTRAP_MATRIX_REQUIRED')
    return value


def verify_difference(native, old, repaired):
    for value in (native, old, repaired):
        validate(value)
    if native != repaired or native['rlsEnabled'] is not True or native['functionSecurityDefiner'] is not False:
        raise ValueError('NATIVE_BOOTSTRAP_AUTHORIZATION_MISMATCH')
    expected_old = json.loads(json.dumps(native))
    count = 0
    for row in expected_old['grants']:
        if row['kind'] in ('table', 'sequence') and row['role'] != 'postgres':
            if row['allowed'] is not True:
                raise ValueError('NATIVE_BOOTSTRAP_STARTING_GRANTS_REQUIRED')
            row['allowed'] = False
            count += 1
    if old != expected_old or count != 33:
        raise ValueError('BOOTSTRAP_NEGATIVE_CONTROL_REQUIRED')
    return count


def verify(command, project):
    if type(project) is not str or not re.fullmatch(r'gridex-sb-[a-f0-9]{12}-[a-f0-9]{16}', project):
        raise ValueError('EXACT_NATIVE_OWNER_REQUIRED')
    old, repaired = sources()
    container = 'supabase_db_'+project
    metadata = json.loads(command(['docker','inspect',container]).stdout)
    if (type(metadata) is not list or len(metadata) != 1 or metadata[0]['Name'] != '/'+container
            or metadata[0]['Config'].get('Labels',{}).get('com.supabase.cli.project') != project
            or set(metadata[0]['NetworkSettings']['Networks']) != {project+'-network'}
            or not metadata[0]['Config']['Image'].startswith('public.ecr.aws/supabase/postgres:17.')):
        raise ValueError('OWNED_NATIVE_DATABASE_REQUIRED')
    network = json.loads(command(['docker','network','inspect',project+'-network']).stdout)
    if (type(network) is not list or len(network) != 1 or network[0].get('Internal') is not True
            or network[0].get('Labels',{}).get('gridex.native.owner') != project):
        raise ValueError('OWNED_NATIVE_NETWORK_REQUIRED')
    def sql(database, query):
        return command(['docker','exec','-i',container,'psql','-X','-qAt','-U','postgres',
                        '-d',database,'-v','ON_ERROR_STOP=1'], data=query if isinstance(query,bytes) else query.encode())
    created = []; probes_created = False
    try:
        # The parent created an empty native database; collisions fail, never DROP.
        sql('postgres', PROBES); probes_created = True
        native = validate(json.loads(sql('postgres', CAPTURE).stdout))
        results = []
        for database, bootstrap in [('gridex_bootstrap_before',old), ('gridex_bootstrap_after',repaired)]:
            command(['docker','exec',container,'createdb','-U','postgres','--template=template0',database])
            created.append(database)
            sql(database, bootstrap)
            sql(database, PROBES)
            results.append(validate(json.loads(sql(database, CAPTURE).stdout)))
        count = verify_difference(native, *results)
    finally:
        # Try all owned cleanup even when one removal fails; the parent then
        # disposes the complete temporary CLI project. Never report partial
        # cleanup as a successful comparison.
        cleanup_failed = False
        for database in reversed(created):
            try:
                command(['docker','exec',container,'dropdb','-U','postgres',database])
            except Exception:
                cleanup_failed = True
        if probes_created:
            try:
                sql('postgres', DROP)
            except Exception:
                cleanup_failed = True
        if cleanup_failed:
            raise ValueError('BOOTSTRAP_PROBE_DISPOSAL_REQUIRED')
    return {'nativeDefaultGrantsMatched': True, 'effectivePrivilegeChecks': 48,
            'oldBootstrapMissingPrivileges': count, 'negativeControlVerified': True,
            'rlsPreserved': True, 'probeCleanupVerified': True,
            'bootstrapSha256': hashlib.sha256(repaired).hexdigest(),
            'fullReplayAccepted': False, 'hostedDatabaseModified': False}
