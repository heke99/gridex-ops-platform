"""Observe a bounded reader catalog on the workflow's already-running BASE56 database."""
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import subprocess
import sys


BASE = '56e58b95518ec4d5eef210ba16ba46228afb40ac'
READER_SCOPE_SHA256 = '819095ef9e903d7b57d8f1b9ef5a2b6c39f62fa332f633931774fd589aa3abac'
MIGRATION = 'supabase/migrations/20261124023900_portal_verified_supply_ends.sql'
MIGRATION_SHA256 = '1069dcccc590d76fe0ce24f47400be5d83decc079d695c058c3cbb224db9aaa3'
OBSERVER = 'scripts/helpers/ediel-db01-reader-catalog.py'
WRAPPER = 'accepted_source_basis_v1'
PROJECTION = 'accepted_source_projection_current_v1'
OLD_WRAPPER = 'e9d3df182a52ef5228ba54d96197770cb67e4e3bb91bc5cbee19103ea57adbed'
CURRENT_BODIES = {
    WRAPPER: 'a7ef48bb05809d97dcf50ff438ced36c0761e3196618238de234c517046df236',
    PROJECTION: 'fc5ea7e9513ec786c435b3dbdb95b3ed91a8553a5dafd0ca4a2c8bd1e2c8a24c',
}
TABLES = {
    'public.ediel_messages', 'gridex_ediel_transport.attempts', 'gridex_outbound_dispatch.attempts',
    'gridex_outbound_dispatch.events', 'gridex_outbound_dispatch.originals',
}
TRANSPORT_SCHEMA = 'gridex_ediel_transport'
READER_NAMESPACES = {name.split('.')[0] for name in TABLES}
SCHEMA_HEADER = re.compile(r'^-- Name: (.*?); Type: (.*?); Schema: (.*?); Owner: (.*?)\n--\n', re.M)


def reader_scope_digest(schema):
    keys = set()
    for name in CURRENT_BODIES:
        keys.add((TRANSPORT_SCHEMA, 'FUNCTION', name + '(public.ediel_messages)'))
        keys.add((TRANSPORT_SCHEMA, 'ACL', 'FUNCTION ' + name + '(p_message public.ediel_messages)'))
    for name in READER_NAMESPACES:
        keys.update({('-', 'SCHEMA', name), ('-', 'ACL', 'SCHEMA ' + name)})
    for identity in TABLES:
        namespace, table = identity.split('.')
        keys.update({(namespace, 'TABLE', table), (namespace, 'ACL', 'TABLE ' + table),
                     (namespace, 'ROW SECURITY', table)})
    objects = {key: [] for key in keys}
    headers = list(SCHEMA_HEADER.finditer(schema))
    for index, header in enumerate(headers):
        name, kind, namespace, owner = header.groups()
        key = namespace, kind, name
        is_default = kind == 'DEFAULT ACL' and namespace in READER_NAMESPACES | {'-'}
        is_policy = kind == 'POLICY' and namespace + '.' + name.split()[0] in TABLES
        if key in keys or is_default or is_policy:
            end = headers[index + 1].start() if index + 1 < len(headers) else len(schema)
            objects.setdefault(key, []).append([owner, schema[header.end():end].strip().removesuffix('--').strip()])
    scope = json.dumps(sorted(objects.items()), separators=(',', ':'))
    return sha256(scope.encode()).hexdigest()


QUERY = """
BEGIN TRANSACTION READ ONLY;
SET LOCAL search_path TO pg_catalog;
WITH scopes(schema_name, object_name) AS (VALUES
    ('public', 'ediel_messages'), ('gridex_ediel_transport', 'attempts'),
    ('gridex_outbound_dispatch', 'attempts'), ('gridex_outbound_dispatch', 'events'),
    ('gridex_outbound_dispatch', 'originals')
), principal AS (
    SELECT oid, rolname FROM pg_roles WHERE rolname IN
      ('anon', 'authenticated', 'authenticator', 'service_role', 'postgres', 'gridex_ediel_retention_owner')
), relation_scope AS (
    SELECT n.nspname||'.'||c.relname identity, c.oid, n.oid namespace_oid, pg_get_userbyid(c.relowner) owner,
      c.relkind, c.relrowsecurity rls, c.relforcerowsecurity force_rls, c.relacl::text raw_acl,
      (SELECT jsonb_object_agg(pr.rolname,
         (SELECT jsonb_object_agg(priv,has_table_privilege(pr.oid,c.oid,priv))
            FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) priv))
         FROM principal pr) effective
    FROM scopes s JOIN pg_namespace n ON n.nspname=s.schema_name
    JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=s.object_name
), functions AS (
    SELECT p.proname name, p.oid, n.oid namespace_oid, pg_get_userbyid(p.proowner) owner,
      p.proacl::text raw_acl, p.prosecdef security_definer, p.provolatile volatility, p.proconfig settings,
      encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') body_sha256,
      (SELECT jsonb_object_agg(pr.rolname,has_function_privilege(pr.oid,p.oid,'EXECUTE')) FROM principal pr) "execute"
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='gridex_ediel_transport' AND p.proname IN
      ('accepted_source_basis_v1','accepted_source_projection_current_v1')
      AND p.pronargs=1 AND p.proargtypes[0]='public.ediel_messages'::regtype
), namespaces AS (
    SELECT n.nspname name, n.oid, pg_get_userbyid(n.nspowner) owner, n.nspacl::text raw_acl,
      (SELECT jsonb_object_agg(pr.rolname,has_schema_privilege(pr.oid,n.oid,'USAGE')) FROM principal pr) usage
    FROM pg_namespace n WHERE n.nspname IN (SELECT schema_name FROM scopes)
), default_acl AS (
    SELECT coalesce(n.nspname,'') schema_name, pg_get_userbyid(d.defaclrole) owner,
      d.defaclobjtype object_type, d.defaclacl::text raw_acl
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
    WHERE d.defaclobjtype IN ('r','f') AND (d.defaclnamespace=0 OR n.nspname IN (SELECT schema_name FROM scopes))
)
SELECT jsonb_build_object(
    'database',(SELECT jsonb_build_object('oid',oid,'name',datname,'system_identifier',
         (pg_control_system()).system_identifier::text) FROM pg_database WHERE datname=current_database()),
    'functions',coalesce((SELECT jsonb_agg(f ORDER BY name) FROM functions f),'[]'),
    'tables',coalesce((SELECT jsonb_agg(t ORDER BY identity) FROM relation_scope t),'[]'),
    'namespaces',coalesce((SELECT jsonb_agg(n ORDER BY name) FROM namespaces n),'[]'),
    'default_acl',coalesce((SELECT jsonb_agg(a ORDER BY schema_name,owner,object_type) FROM default_acl a),'[]')
);
COMMIT;
"""


def function_matches(function, body, volatility):
    return (
        function['owner'] == 'postgres' and function['raw_acl'] == '{postgres=X/postgres}'
        and function['security_definer'] and function['volatility'] == volatility
        and function['settings'] == ['search_path=pg_catalog', 'TimeZone=UTC']
        and function['body_sha256'] == body
        and function['execute'] == {
            'postgres': True, 'anon': False, 'authenticated': False, 'authenticator': False,
            'service_role': False, 'gridex_ediel_retention_owner': False,
        }
    )


def findings(snapshot, before=None):
    functions = {row['name']: row for row in snapshot['functions']}
    bodies = {WRAPPER: OLD_WRAPPER} if before is None else CURRENT_BODIES
    problems = []
    if set(functions) != set(bodies) or any(
        not function_matches(functions[name], body, 'v' if name == WRAPPER else 's')
        for name, body in bodies.items() if name in functions
    ):
        problems.append('function_preimage_or_target_changed')
    if {row['identity'] for row in snapshot['tables']} != TABLES:
        problems.append('table_scope_changed')
    if {row['name'] for row in snapshot['namespaces']} != {name.split('.')[0] for name in TABLES}:
        problems.append('namespace_scope_changed')
    if before is not None:
        if before['mismatches']:
            problems.append('base_preimage_unqualified')
        for field in ('database', 'container', 'tables', 'namespaces', 'default_acl'):
            if snapshot[field] != before[field]:
                problems.append(field + '_changed_since_preimage')
        previous_functions = {row['name']: row for row in before['functions']}
        current_wrapper, old_wrapper = functions.get(WRAPPER, {}), previous_functions.get(WRAPPER, {})
        if not old_wrapper or current_wrapper.get('oid') != old_wrapper['oid']:
            problems.append('existing_wrapper_oid_changed')
    return problems


def observe():
    phase = sys.argv[1]
    if phase not in ('before', 'after'):
        raise ValueError('unknown observation phase')
    receipt_path = Path(os.environ['GRIDEX_DB01_NATIVE_RECEIPT'])
    receipt = json.loads(receipt_path.read_text())
    root = Path(receipt['root_path'])
    blobs = receipt['root_source']['blobs']
    schema = (root / 'supabase/schema.sql').read_bytes()
    schema_sha256 = sha256(schema).hexdigest()
    reader_sha256 = reader_scope_digest(schema.decode())
    if (receipt['base_sha'] != BASE or schema_sha256 != blobs['supabase/schema.sql']['sha256']
            or reader_sha256 != READER_SCOPE_SHA256
            or sha256((root / MIGRATION).read_bytes()).hexdigest() != MIGRATION_SHA256
            or blobs[MIGRATION]['sha256'] != MIGRATION_SHA256
            or blobs[OBSERVER]['sha256'] != sha256(Path(__file__).read_bytes()).hexdigest()):
        raise RuntimeError('unqualified BASE56/ROOT source for the reader observation')
    config = (Path(receipt['base_path']) / 'supabase/config.toml').read_text()
    project = re.search(r'^project_id\s*=\s*"([\w-]+)"', config, re.M)
    if not project:
        raise RuntimeError('owned BASE56 project identity is unavailable')
    container = 'supabase_db_' + project[1]
    docker_id = subprocess.check_output(
        ['docker', 'inspect', '--format', '{{.Id}} {{.Image}} {{.State.Running}}', container], text=True,
    ).strip().split()
    if len(docker_id) != 3 or docker_id[2] != 'true':
        raise RuntimeError('owned BASE56 database is unavailable')
    result = subprocess.run(
        ['docker', 'exec', '-i', docker_id[0], 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt',
         '-v', 'ON_ERROR_STOP=1'],
        input=QUERY, text=True, check=True, stdout=subprocess.PIPE,
    )
    snapshot = json.loads(result.stdout)
    runner_system = subprocess.check_output([
        'psql', 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1',
        '-c', 'SELECT (pg_control_system()).system_identifier::text',
    ], text=True).strip()
    if snapshot['database']['system_identifier'] != runner_system:
        raise RuntimeError('reader catalog is not on the owned runner database')
    snapshot['container'] = {'id': docker_id[0], 'image_id': docker_id[1]}
    before = None if phase == 'before' else json.loads(
        (receipt_path.parent / 'current-reader-catalog-before.json').read_text()
    )
    if before is not None and (before['checkout_sha'] != receipt['checkout_sha']
                               or before['source_schema_sha256'] != schema_sha256
                               or before['source_reader_scope_sha256'] != reader_sha256
                               or before['status'] != 'OBSERVED_ONLY'
                               or before['native_or_approval_credit'] is not False):
        raise RuntimeError('reader catalog preimage has different provenance')
    snapshot['mismatches'] = findings(snapshot, before)
    snapshot['source_schema_sha256'] = schema_sha256
    snapshot['source_reader_scope_sha256'] = reader_sha256
    snapshot['source_migration_sha256'] = MIGRATION_SHA256
    snapshot['status'] = 'OBSERVED_ONLY'
    snapshot['native_or_approval_credit'] = False
    snapshot['checkout_sha'] = receipt['checkout_sha']
    (receipt_path.parent / ('current-reader-catalog-' + phase + '.json')).write_text(
        json.dumps(snapshot, indent=2, sort_keys=True) + '\n'
    )


if __name__ == '__main__':
    observe()
