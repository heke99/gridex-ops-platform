#!/usr/bin/env python3
"""Prepare and start two strictly local, privately configured Supabase demo stacks.
No linked projects, remote credentials, production data or source migration edits.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile

ROOT = Path('/workspace/elklart-runtime')
REPO = Path(__file__).resolve().parents[2]
CLI_VERSION = '2.75.0'
IMAGE_VERSION = '17.6.1.155'
ENDPOINT = 'unix:///var/run/docker.sock'
EXCLUDE = 'realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'

def need(value, message):
    if not value:
        raise ValueError(message)

def runtime():
    need(not ROOT.is_symlink(), 'Symlinked runtime refused')
    ROOT.mkdir(mode=0o700, exist_ok=True)
    info = ROOT.stat()
    need(info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o700, 'Private owned runtime required')
    return ROOT

def owned_path(path, exists=True):
    path = Path(path)
    runtime()
    need(path.is_absolute() and '..' not in path.parts, 'Unsafe runtime path')
    need(path == ROOT or ROOT in path.parents, 'Path outside runtime')
    for parent in [path, *path.parents]:
        need(not parent.is_symlink(), 'Symlinked runtime ancestor refused')
    if exists:
        need(path.exists(), 'Missing runtime path')
    return path


def write_private_json(path, value):
    """Atomically replace an owned receipt; fresh files are private before writing."""
    path = owned_path(path, exists=False)
    if path.exists():
        info = path.stat()
        need(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid(), 'Owned receipt file required')
    data = json.dumps(value, indent=2)
    descriptor, temporary = tempfile.mkstemp(prefix='.elklart-receipt-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        owned_path(path, exists=False)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


def local_docker_env():
    """Fail before side effects; CLI subprocesses must use the same owned daemon."""
    need(os.environ.get('DOCKER_HOST', ENDPOINT) in ('', ENDPOINT), 'Foreign Docker endpoint refused')
    overrides = ('DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'DOCKER_CONFIG', 'DOCKER_API_VERSION')
    need(not any(os.environ.get(name) for name in overrides), 'Docker context/TLS/config overrides refused')
    environment = os.environ.copy()
    for name in overrides: environment.pop(name, None)
    environment['DOCKER_HOST'] = ENDPOINT
    return environment


def run(args, **kwargs):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs).stdout

def docker(*args, **kwargs):
    return run(['docker', '--host', ENDPOINT, *args], env=local_docker_env(), **kwargs)

def identity(project):
    need(project in ('ops', 'portal'), 'Unknown demo project')
    return f'elklart-{project}-demo'

def db_container(project):
    return 'supabase_db_' + identity(project)

def verify_db(project):
    row = json.loads(docker('inspect', db_container(project)))[0]
    need(row['Name'] == '/' + db_container(project), 'Unexpected database name')
    need(row['Config']['Labels'].get('com.supabase.cli.project') == identity(project), 'Database ownership mismatch')
    configured = row['HostConfig']['PortBindings'].get('5432/tcp', [])
    bindings = row['NetworkSettings']['Ports'].get('5432/tcp', [])
    port = '54322' if project == 'ops' else '55322'
    need(configured and all(b['HostIp'] in ('', '127.0.0.1', '::1') and b['HostPort'] == port for b in configured), 'Unsafe configured database binding')
    need(bindings and all(b['HostIp'] in ('127.0.0.1', '::1') and b['HostPort'] == port for b in bindings), 'Database must bind exact loopback port')
    return row

def sql(project, text, admin=False, transaction=True):
    verify_db(project)
    args = ['exec', '-i', db_container(project), 'psql', '-XAt', '-U', 'supabase_admin' if admin else 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
    if transaction:
        args.append('--single-transaction')
    try:
        return docker(*args, input=text.encode()).decode()
    except subprocess.CalledProcessError as error:
        log = owned_path(ROOT / project / 'schema-operation-error.log', exists=False)
        with log.open('wb') as output:
            os.chmod(log, 0o600)
            output.write(error.stderr or b'Database operation failed')
        raise

def cli():
    environment = local_docker_env()
    file = owned_path(runtime() / 'bin/supabase')
    need(file.is_file() and not file.is_symlink(), 'Install checksum-verified Supabase CLI in runtime/bin first')
    version = run([str(file), '--version'], env=environment).decode().strip()
    need(version == CLI_VERSION, 'Unexpected Supabase CLI version')
    return str(file)

def prepare(project):
    local_docker_env()
    home = owned_path(runtime() / project, exists=False)
    home.mkdir(mode=0o700, exist_ok=True)
    config = owned_path(home / 'supabase/config.toml', exists=False)
    if config.exists():
        need(not config.is_symlink(), 'Symlinked config refused')
        import tomllib
        settings = tomllib.loads(config.read_text())
        need(settings['project_id'] == identity(project), 'Foreign project config')
        expected_port = 54321 if project == 'ops' else 55321
        need(settings['api']['port'] == expected_port and settings['db']['port'] == expected_port + 1, 'Unexpected local API/database ports')
        need(settings['db']['major_version'] == 17, 'Unexpected local PostgreSQL version')
        expected_app = 'https://localhost:3000' if project == 'ops' else 'https://localhost:3001'
        need(settings['auth']['site_url'] == expected_app, 'Unexpected local Auth site')
        pin = owned_path(home / 'supabase/.temp/postgres-version')
        need(pin.read_text().strip() == IMAGE_VERSION, 'Unexpected local PostgreSQL image')
        return
    run([cli(), '--workdir', str(home), 'init'], env=local_docker_env())
    text = config.read_text()
    text = re.sub(r'^project_id = .*$', f'project_id = "{identity(project)}"', text, flags=re.M)
    if project == 'portal':
        for port in (54321, 54322, 54323, 54324, 54327, 54329):
            text = text.replace(str(port), str(port + 1000))
    app = 'https://localhost:3000' if project == 'ops' else 'https://localhost:3001'
    text = re.sub(r'^site_url = .*$', f'site_url = "{app}"', text, flags=re.M)
    text = re.sub(r'^additional_redirect_urls = .*$', f'additional_redirect_urls = ["{app}/auth/callback", "{app}/**"]', text, flags=re.M)
    text = re.sub(r'^major_version = \d+', 'major_version = 17', text, flags=re.M)
    config.write_text(text)
    owned_path(home / 'supabase/.temp', exists=False).mkdir(exist_ok=True)
    owned_path(home / 'supabase/.temp/postgres-version', exists=False).write_text(IMAGE_VERSION)

def start(project):
    local_docker_env()
    prepare(project)
    name = identity(project)
    existing = docker('network', 'ls', '--format', '{{.Name}}').decode().splitlines()
    if name not in existing:
        docker('network', 'create', '--label', f'com.gridex.demo={name}', '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', name)
    network = json.loads(docker('network', 'inspect', name))[0]
    need(network['Options'].get('com.docker.network.bridge.host_binding_ipv4') == '127.0.0.1', 'Unsafe demo network binding')
    need(network['Labels'].get('com.gridex.demo') in (name, 'elklart-ops' if project == 'ops' else name), 'Foreign network ownership')
    log = owned_path(runtime() / project / 'start.log', exists=False)
    with log.open('a') as out:
        os.chmod(log, 0o600)
        subprocess.run([cli(), '--workdir', str(runtime() / project), '--network-id', name, 'start', '--exclude', EXCLUDE], stdout=out, stderr=out, check=True, env=local_docker_env())
    verify_db(project)
    sql(project, f"alter database postgres set elklart.runtime_project='{name}';", admin=True, transaction=False)
    content = run([cli(), '--workdir', str(runtime() / project), 'status', '-o', 'json'], env=local_docker_env())
    target = owned_path(runtime() / project / 'status.json', exists=False)
    with target.open('wb') as out:
        os.chmod(target, 0o600)
        out.write(content)
    print(f'{name}: local stack started; status and credentials saved privately')

def sha256(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()


def split_sql(text):
    """Split top-level statements without interpreting SQL or dollar-body contents."""
    statements = []
    start = index = 0
    quote = None
    dollar = None
    comment = 0
    line = False
    while index < len(text):
        char = text[index]
        pair = text[index:index + 2]
        if line:
            if char == '\n': line = False
        elif comment:
            if pair == '/*': comment += 1; index += 1
            elif pair == '*/': comment -= 1; index += 1
        elif dollar:
            if text.startswith(dollar, index): index += len(dollar) - 1; dollar = None
        elif quote:
            if char == '\\' and quote == "'": index += 1
            elif char == quote:
                if index + 1 < len(text) and text[index + 1] == quote: index += 1
                else: quote = None
        elif pair == '--': line = True; index += 1
        elif pair == '/*': comment = 1; index += 1
        elif char in ("'", '"'): quote = char
        elif char == '$':
            match = re.match(r'\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$', text[index:])
            if match: dollar = match[0]; index += len(dollar) - 1
        elif char == ';':
            statements.append(text[start:index + 1]); start = index + 1
        index += 1
    need(not quote and not dollar and not comment, 'Unterminated source SQL')
    if text[start:].strip(): statements.append(text[start:])
    result = []
    for statement in statements:
        while True:
            previous = statement
            statement = re.sub(r'^\s*(?:--[^\n]*(?:\n|$)|/\*[\s\S]*?\*/)', '', statement)
            if statement == previous: break
        if statement.strip(): result.append(statement.strip())
    return result


def repo_source(relative):
    need(isinstance(relative, str), 'Missing repository source')
    path = Path(relative)
    need(not path.is_absolute() and '..' not in path.parts, 'Foreign repository source')
    source = REPO / path
    need(source.is_file() and not source.is_symlink() and source.resolve().is_relative_to(REPO.resolve()), 'Missing owned repository source')
    return source


def reference_statement(proof):
    source = repo_source(proof['source'])
    need(sha256(source.read_bytes()) == proof.get('source_sha256', proof.get('sourceSha256')), 'Reference source hash mismatch')
    expected = proof.get('statement_sha256', proof.get('statementSha256'))
    matches = [statement for statement in split_sql(source.read_text()) if sha256(statement) == expected]
    if not matches and proof.get('sourceKind') == 'repository_program_reference' and proof.get('target') == 'public.legal_templates':
        # This one derivation copies the exact program template VALUES but omits
        # published legal versions/authority. Do not run the wider migration.
        source_text = source.read_text()
        seed = re.search(r'with template_seed\(module_key,name,description,title,body,mandatory\) as \(\s*values\s+([\s\S]*?)\n\), upsert_templates as', source_text, re.I)
        need(seed is not None, 'Legal reference source seed missing')
        derived = "WITH template_seed(module_key,name,description,title,body,mandatory) AS (VALUES \n  " + seed[1] + ")\nINSERT INTO public.legal_templates(module_key,name,description,mandatory,status)\nSELECT module_key,name,description,mandatory,'active' FROM template_seed ON CONFLICT(module_key) DO NOTHING;"
        need(sha256(derived) == expected, 'Derived legal reference hash mismatch')
        matches = [derived]
    need(len(matches) == 1, 'Reference statement hash missing or ambiguous')
    return matches[0]


def capture_rows(response):
    need(isinstance(response, dict) and not response.get('isError'), 'Failed metadata capture')
    results = []
    for content in response.get('content', []):
        if content.get('type') != 'text': continue
        wrapper = json.loads(content['text'])
        result = wrapper.get('result', '')
        for match in re.finditer(r'\n<untrusted-data-[^>]+>\s*([\s\S]*?)\s*</untrusted-data-', result):
            parsed = json.loads(match[1])
            if isinstance(parsed, list): results.append(parsed)
    need(len(results) == 1, 'Missing or ambiguous metadata capture')
    return results[0]


def sql_literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def sql_identifier(value):
    need(isinstance(value, str) and re.fullmatch(r'[a-z_][a-z_0-9]*', value), 'Unsafe metadata identifier')
    return '"' + value + '"'


def auth_role_sql(rows):
    need(len(rows) == 1, 'Missing exact Auth role function capture')
    record = rows[0]
    definition = record['definition']
    need(re.match(r'CREATE OR REPLACE FUNCTION public\.gridex_get_user_roles\(p_user_id uuid\)', definition), 'Foreign Auth function definition')
    need(len(split_sql(definition)) == 1, 'Auth definition must contain one function only')
    owner = sql_identifier(record['owner'])
    acl = record['proacl']
    need(isinstance(acl, str) and acl.startswith('{') and acl.endswith('}'), 'Missing exact Auth ACL')
    grants = []
    for entry in acl[1:-1].split(','):
        match = re.fullmatch(r'([a-z_][a-z_0-9]*)=X/([a-z_][a-z_0-9]*)', entry)
        need(match is not None and match[2] == record['owner'], 'Unexpected Auth ACL entry')
        need(match[1] in ('postgres', 'service_role', 'authenticated'), 'Unexpected Auth ACL role')
        grants.append(sql_identifier(match[1]))
    signature = 'public.gridex_get_user_roles(uuid)'
    return definition.rstrip(';\n') + ';\nALTER FUNCTION ' + signature + ' OWNER TO ' + owner + ';\n' + \
        'REVOKE ALL ON FUNCTION ' + signature + ' FROM PUBLIC, anon, authenticated, service_role, postgres;\n' + \
        '\n'.join('GRANT EXECUTE ON FUNCTION ' + signature + ' TO ' + role + ';' for role in grants)


def owner_restore_sql(owners, schema_owners):
    statements = []
    for row in schema_owners['schemas']:
        statements.append(f"ALTER SCHEMA {sql_identifier(row['name'])} OWNER TO {sql_identifier(row['owner'])};")
    for row in schema_owners['types']:
        statements.append(f"ALTER TYPE {sql_identifier(row['schema'])}.{sql_identifier(row['name'])} OWNER TO {sql_identifier(row['owner'])};")
    for row in owners['relations']:
        kind = {'r': 'TABLE', 'p': 'TABLE', 'v': 'VIEW', 'm': 'MATERIALIZED VIEW', 'S': 'SEQUENCE', 'f': 'FOREIGN TABLE'}.get(row['kind'])
        need(kind is not None, 'Unsupported source relation kind')
        statements.append(f"ALTER {kind} {sql_identifier(row['schema'])}.{sql_identifier(row['name'])} OWNER TO {sql_identifier(row['owner'])};")
    for row in owners['functions']:
        for key in ('schema', 'name', 'owner'): sql_identifier(row[key])
        # Identity arguments are compared as literal metadata, never interpolated as SQL.
        statements.append("DO $elklart_owner$ DECLARE target oid; BEGIN SELECT p.oid INTO target FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=" + sql_literal(row['schema']) + " AND p.proname=" + sql_literal(row['name']) + " AND pg_get_function_identity_arguments(p.oid)=" + sql_literal(row['arguments']) + "; IF target IS NULL THEN RAISE EXCEPTION 'replay_function_identity_missing'; END IF; EXECUTE format('ALTER FUNCTION %s OWNER TO %I',target::regprocedure," + sql_literal(row['owner']) + "); END $elklart_owner$;")
    return '\n'.join(statements)


def platform_ledger_sql(source):
    schema = re.search(r'^create schema if not exists supabase_migrations;', source, re.M)
    table = re.search(r'^create table if not exists supabase_migrations\.schema_migrations \([\s\S]*?\n\);', source, re.M)
    need(schema and table, 'Authoritative platform ledger prerequisite missing')
    # The CLI connects as postgres. On the managed local image that role is not
    # necessarily superuser: creating the ledger as supabase_admin breaks CLI
    # migration writes. Normalize only these two exact owned platform objects.
    return (schema[0] + '\n' + table[0] + '\n'
            'ALTER SCHEMA supabase_migrations OWNER TO postgres;\n'
            'ALTER TABLE supabase_migrations.schema_migrations OWNER TO postgres;')


def snapshot_acl_sql(source):
    blocks = re.findall(r'^-- Name: [^\n]*; Type: ACL; Schema: [^\n]*\n--\n\n([\s\S]*?)(?=\n--\n-- Name:|\Z)', source, re.M)
    need(blocks, 'Snapshot ACL blocks missing')
    statements = [statement for block in blocks for statement in split_sql(block)]
    need(all(re.match(r'^(?:GRANT|REVOKE)\s', statement) for statement in statements), 'Unexpected snapshot ACL statement')
    return '\n'.join(statements)


def reference_replay_sql(proof, statement):
    layouts = {
        'gridex_ediel_retention.record_class_catalog': ('retention_class', 'source_table', 'permission_key', 'operation', 'redaction'),
        'gridex_ediel_retention.process_class_catalog': ('retention_class', 'source_table', 'operation'),
    }
    target = proof['target']
    if target not in layouts: return statement
    prefix = 'INSERT INTO ' + target + ' VALUES'
    need(statement.startswith(prefix), 'Unexpected immutable reference source shape')
    values = statement[len(prefix):].strip().rstrip(';')
    columns = layouts[target]
    expected = 'WITH expected(' + ','.join(columns) + ') AS (VALUES ' + values + ')'
    verify = ' OR '.join('a.' + column + ' IS DISTINCT FROM e.' + column for column in columns[1:])
    return (expected + '\nINSERT INTO ' + target + '(' + ','.join(columns) + ') SELECT * FROM expected ON CONFLICT DO NOTHING;\n'
            'DO $elklart_reference_verify$ BEGIN IF EXISTS(' + expected + ' SELECT FROM expected e LEFT JOIN ' + target +
            ' a USING(retention_class) WHERE a.retention_class IS NULL OR ' + verify +
            ") THEN RAISE EXCEPTION 'elklart_reference_catalog_mismatch'; END IF; END $elklart_reference_verify$;")


def correction_epoch_sql(source):
    statements = [statement for statement in split_sql(source) if statement.startswith('INSERT INTO gridex_correction_process.epochs(table_name) VALUES')]
    need(len(statements) == 1, 'Exact correction producer catalogue missing')
    statement = statements[0]
    values = statement.split('VALUES', 1)[1].rstrip(';').strip()
    need(re.fullmatch(r"\('[a-z_][a-z_0-9]*'\)(?:\s*,\s*\('[a-z_][a-z_0-9]*'\))*", values), 'Unexpected correction producer seed')
    names = re.findall(r"\('([a-z_][a-z_0-9]*)'\)", values)
    need(len(names) == len(set(names)), 'Duplicate correction producer')
    allowed = 'ARRAY[' + ','.join(sql_literal(name) for name in names) + ']::text[]'
    # These are prospective registration rows, initialized by actual local time/xid.
    # Never import production epoch timestamps or claim historical completeness.
    return ("DO $elklart_epochs$ BEGIN IF NOT EXISTS(SELECT FROM gridex_correction_process.epochs) THEN " + statement +
            " END IF; IF (SELECT count(*) FROM gridex_correction_process.epochs) <> " + str(len(names)) +
            " OR EXISTS(SELECT FROM gridex_correction_process.epochs WHERE table_name <> ALL(" + allowed + ") OR complete) THEN RAISE EXCEPTION 'correction_producer_catalogue_mismatch'; END IF; END $elklart_epochs$;")


def helper_renderer():
    # Shared contract with the independently maintained offline extractor. The
    # importer must never implement its own GUC-list parser or SQL quoting.
    source = repo_source('scripts/demo/elklart-private-helpers.py')
    spec = importlib.util.spec_from_file_location('elklart_private_helper_renderer', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_v3_helper(helper, proof, rows, acl):
    need(proof.get('format') == 'elklart_private_helpers_v3'
         and proof.get('guc_encoding') == 'set_config_from_current_v1', 'Required private helper v3 encoding missing')
    need(proof.get('sql_sha256') == sha256(helper), 'Private helper v3 SQL hash mismatch')
    functions = proof.get('functions', [])
    need(len(rows) == len(functions), 'Private helper metadata inventory mismatch')
    renderer = helper_renderer()
    candidates = list(renderer.candidates(helper))
    recovered = []
    for row, item in zip(rows, functions):
        need(item.get('name') == row['proname'] and item.get('arguments') == row['arguments']
             and item.get('properties') == row and item.get('proconfig') == row.get('proconfig'), 'Private helper properties differ from captured metadata')
        matches = [candidate for candidate in candidates if candidate['name'] == row['proname'] and sha256(candidate['body']) == row['body_sha256']]
        need(len(matches) == 1, 'Private helper v3 body inventory mismatch')
        recovered.append(matches[0])
    expected = renderer.render(rows, recovered) + '\n' + renderer.render_acl(rows, acl)
    need(helper == expected, 'Private helper artifact differs from exact v3 renderer output')


def validate_helper_catalog(actual, expected, acl, check_config=True):
    key = lambda row: (row['proname'], row['arguments'])
    actual_rows = {key(row): row for row in actual}
    need(len(actual_rows) == len(actual) == len(expected) and set(actual_rows) == {key(row) for row in expected}, 'helper_actual_inventory_mismatch')
    acl_rows = {(row['name'], row['arguments']): row for row in acl['functions']}
    grant_key = lambda row: (row['grantee'], row['privilege'], row['grantable'])
    for row in expected:
        observed = actual_rows[key(row)]
        for field, value in row.items():
            if field == 'proconfig' and not check_config: continue
            need(observed.get(field) == value, 'helper_config_mismatch' if field == 'proconfig' else 'helper_actual_metadata_mismatch')
        need(sorted(map(grant_key, observed['grants'])) == sorted(map(grant_key, acl_rows[key(row)]['grants'])), 'helper_actual_acl_mismatch')


def private_helper_catalog_query(rows):
    names = sorted({row['proname'] for row in rows})
    allowed = 'ARRAY[' + ','.join(sql_literal(name) for name in names) + ']::text[]'
    return """SELECT coalesce(json_agg(json_build_object(
 'proname',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),
 'declaration_arguments',pg_get_function_arguments(p.oid),'returns',pg_get_function_result(p.oid),
 'body_sha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
 'language',l.lanname,'security_definer',p.prosecdef,'proconfig',p.proconfig,
 'owner',pg_get_userbyid(p.proowner),'provolatile',p.provolatile,'proisstrict',p.proisstrict,
 'proparallel',p.proparallel,'proleakproof',p.proleakproof,'procost',p.procost,
 'prorows',p.prorows,'proretset',p.proretset,'prokind',p.prokind,
 'grants',coalesce((SELECT json_agg(json_build_object(
   'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
   'privilege',a.privilege_type,'grantable',a.is_grantable))
   FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a),'[]'::json)
 ) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::json)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname='private' AND p.proname=ANY(""" + allowed + ');'


def verify_private_helpers(plan, check_config=True):
    actual = json.loads(sql('ops', private_helper_catalog_query(plan['helperRows'])))
    validate_helper_catalog(actual, plan['helperRows'], plan['helperAcl'], check_config=check_config)
    return actual


def verify_imported_schema_receipt():
    source = REPO / 'supabase/schema.sql'
    receipt = json.loads(owned_path(ROOT / 'ops/schema-source.json').read_text())
    need(receipt.get('project') == identity('ops') and receipt.get('sha256') == sha256(source.read_bytes()), 'Imported schema source receipt mismatch')
    return source


def repair_private_helper_config():
    """Explicit coordinated metadata-only upgrade; no function/body/ACL recreation."""
    local_docker_env()
    plan = replay_sources()
    need(sql('ops', "select current_setting('elklart.runtime_project',true)").strip() == identity('ops'), 'Database marker mismatch')
    verify_imported_schema_receipt()
    # Existing signatures, bodies, execution properties, owners and grants must
    # already match captured source. Only proconfig may differ on this path.
    before = verify_private_helpers(plan, check_config=False)
    renderer = helper_renderer()
    repair = []
    for row in plan['helperRows']:
        target = 'private.' + renderer.identifier(row['proname']) + '(' + row['arguments'] + ')'
        repair.append('ALTER FUNCTION ' + target + ' RESET ALL;')
        repair.append(renderer.render_config(row))
    sql('ops', '\n'.join(repair), admin=True)
    after = verify_private_helpers(plan)
    # Full verification above binds all source properties. Preserve a private
    # runtime receipt without modifying old extractor/v2 custody proofs.
    write_private_json(ROOT / 'ops/helper-import-source-v3.json', {
        'format': 'elklart_private_helpers_v3', 'sqlSha256': sha256(plan['helper']),
        'provenanceSha256': plan['sources']['private-repo-derived-helpers-v3.provenance.json'],
        'actualFunctionsVerified': len(after), 'repairKind': 'source-proconfig-only',
        'priorCatalogSha256': sha256(json.dumps(before, sort_keys=True)),
        'verifiedCatalogSha256': sha256(json.dumps(after, sort_keys=True)),
    })
    sql('ops', "notify pgrst, 'reload schema';")
    print('Private helper v3 configuration verified against captured source; bodies, owners and ACLs unchanged')


def replay_sources():
    """Validate the private capture chain and repository evidence before any write."""
    record = {}
    def private(name):
        path = owned_path(ROOT / 'ops' / name)
        info = path.stat()
        need(info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) & 0o077 == 0, 'Private replay source required')
        record[name] = sha256(path.read_bytes())
        return path
    def metadata(normalized, response):
        rows = capture_rows(json.loads(private(response).read_text()))
        value = json.loads(private(normalized).read_text())
        expected = rows[0]['owner_metadata'] if response in ('owners-metadata-response.json', 'schema-type-owners-response.json') else rows
        need(value == expected, 'Normalized metadata differs from original capture')
        return value
    owners = metadata('owner-metadata.json', 'owners-metadata-response.json')
    schema_owners = metadata('schema-type-owners.json', 'schema-type-owners-response.json')
    auth = metadata('auth-role-function.json', 'auth-role-function-response.json')
    helper = private('private-repo-derived-helpers-v3.sql').read_text()
    helper_proof = json.loads(private('private-repo-derived-helpers-v3.provenance.json').read_text())
    need(helper_proof['acl_source_sha256'] == sha256(private('private-acl-response.json').read_bytes()), 'Private helper ACL source changed')
    need(helper_proof['metadata_sha256'] == sha256(private('private-function-properties-response.json').read_bytes()), 'Private helper property source changed')
    helper_rows = capture_rows(json.loads(private('private-function-properties-response.json').read_text()))
    helper_acl_rows = capture_rows(json.loads(private('private-acl-response.json').read_text()))
    need(len(helper_rows) == 23 and len(helper_acl_rows) == 1, 'Exact private helper source inventory required')
    helper_acl = helper_acl_rows[0]['private_acl']
    validate_v3_helper(helper, helper_proof, helper_rows, helper_acl)
    renderer_source = repo_source('scripts/demo/elklart-private-helpers.py')
    record['privateHelperRenderer'] = {'source': str(renderer_source.relative_to(REPO)), 'sha256': sha256(renderer_source.read_bytes()), 'gucEncoding': 'set_config_from_current_v1'}
    need(helper.startswith('--') and 'CREATE SCHEMA IF NOT EXISTS private;' in helper, 'Missing helper prerequisites')
    for item in helper_proof['functions']:
        sql_identifier(item['name'])
        match = re.search(r'CREATE OR REPLACE FUNCTION private\."?' + re.escape(item['name']) + r'"?\([\s\S]*?\bAS\s+(\$[a-zA-Z_0-9]*\$)([\s\S]*?)\1', helper, re.I)
        need(match is not None and sha256(match[2]) == item['body_sha256'], 'Private helper body hash mismatch')
        source = item['source']
        if source.startswith('captured-definition:'):
            filename, name = source[len('captured-definition:'):].split('#', 1)
            need(Path(filename) == ROOT / 'ops/private-missing-definitions-response.json', 'Foreign helper capture source')
            candidates = capture_rows(json.loads(private('private-missing-definitions-response.json').read_text()))
            selected = [row for row in candidates if row['proname'] == name]
            need(len(selected) == 1 and sha256(selected[0]['definition']) == item['source_sha256'], 'Helper captured source mismatch')
        else:
            need(sha256(repo_source(source).read_bytes()) == item['source_sha256'], 'Helper repository source mismatch')
    catalogs = []
    for name in ('reference-catalog.provenance.json', 'legal-reference-catalog.provenance.json'):
        for proof in json.loads(private(name).read_text()):
            statement = reference_statement(proof)
            # Program data only; never replay unrelated migration writes/evidence.
            need(re.match(r'(?:WITH\b|INSERT\s+INTO\b|UPDATE\b)', statement, re.I), 'Unexpected reference statement')
            need(proof['target'] in statement, 'Reference target mismatch')
            catalogs.append(reference_replay_sql(proof, statement))
    mapping = json.loads(private('role-mapping-source.json').read_text())
    mapping_statement = reference_statement(mapping)
    need(re.match(r'insert into public\.canonical_tenant_access_role_mapping\b', mapping_statement, re.I), 'Foreign role mapping statement')
    bootstrap = repo_source('scripts/sql/gridex-supabase-compatible-bootstrap.sql')
    ledger_source = bootstrap.read_text()
    ledger = platform_ledger_sql(ledger_source)
    record['platformLedgerSource'] = {'source': str(bootstrap.relative_to(REPO)), 'sha256': sha256(bootstrap.read_bytes()), 'localCliOwner': 'postgres', 'historyCopied': False}
    columns_source = repo_source('supabase/migrations/01_db2_full_view_preflight_schema_and_functions.sql')
    column_statement = 'alter table public.companies add column if not exists white_label_platform_id uuid;'
    need(split_sql(columns_source.read_text()).count(column_statement) == 1, 'Missing exact UI schema prerequisite')
    record['schemaPrerequisiteSource'] = {'source': str(columns_source.relative_to(REPO)), 'sha256': sha256(columns_source.read_bytes()), 'statementSha256': sha256(column_statement)}
    invariant_source = repo_source('supabase/migrations/20261001015945_ediel_process_journal_class_retention.sql')
    owner_invariants = [statement for statement in split_sql(invariant_source.read_text()) if statement.startswith('DO $$DECLARE owner_name text;BEGIN SELECT r.rolname INTO owner_name FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner') and ('ediel_capture_customer_record_retention_origin_v1(text,jsonb,jsonb)' in statement or 'ediel_process_journal_tombstoned_v1(uuid,text,text,text)' in statement)]
    need(len(owner_invariants) == 2, 'Exact process-owner grant invariants missing')
    record['ownerInvariantSource'] = {'source': str(invariant_source.relative_to(REPO)), 'sha256': sha256(invariant_source.read_bytes()), 'statementSha256': [sha256(statement) for statement in owner_invariants]}
    epoch_source = repo_source('supabase/migrations/20260924073337_correction_process_facts_v1.sql')
    epoch_sql = correction_epoch_sql(epoch_source.read_text())
    record['correctionProducerSource'] = {'source': str(epoch_source.relative_to(REPO)), 'sha256': sha256(epoch_source.read_bytes()), 'derivationSha256': sha256(epoch_sql), 'historyCompleteness': False, 'installedClock': 'actual-local-default'}
    return {'helper': helper, 'helperRows': helper_rows, 'helperAcl': helper_acl, 'owners': owner_restore_sql(owners, schema_owners), 'auth': auth_role_sql(auth),
            'references': '\n'.join(catalogs), 'roleMapping': mapping_statement,
            'ledger': ledger, 'schemaPrerequisites': column_statement, 'sourceAcls': snapshot_acl_sql((REPO / 'supabase/schema.sql').read_text()), 'ownerInvariants': '\n'.join(owner_invariants), 'correctionEpochs': epoch_sql, 'sources': record}


def load_ops_schema():
    local_docker_env()
    runtime()
    need(sql('ops', "select current_setting('elklart.runtime_project',true)").strip() == identity('ops'), 'Database marker mismatch')
    need(sql('ops', "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m')").strip() == '0', 'Schema import requires an empty application schema')
    source = REPO / 'supabase/schema.sql'
    text = source.read_text()
    plan = replay_sources()
    verification_migration()
    custom_roles = sorted(set(re.findall(r'^GRANT .* TO (gridex_[a-z_0-9]+);$', text, re.M)))
    definitions = {}
    for file in sorted((REPO / 'supabase/migrations').glob('*.sql')):
        for role in custom_roles:
            if role in definitions:
                continue
            match = re.search(r'CREATE ROLE\s+' + re.escape(role) + r'\s+([^;]+);', file.read_text(), re.I)
            if match:
                definitions[role] = match.group(0)
    need(set(definitions) == set(custom_roles), 'Missing authoritative role prerequisite')
    prerequisite = '\n'.join(f"do $$begin if not exists(select from pg_roles where rolname='{role}') then {definitions[role]} end if; end$$;" for role in custom_roles)
    prerequisite += '\ncreate extension if not exists postgis with schema extensions;\ncreate extension if not exists pgcrypto with schema extensions;\ncreate extension if not exists "uuid-ossp" with schema extensions;\ncreate extension if not exists pg_trgm with schema extensions;\ncreate extension if not exists btree_gist with schema extensions;\ndrop schema if exists public;\n'
    log = owned_path(runtime() / 'ops/schema-import.log', exists=False)
    try:
        sql('ops', plan['ledger'], admin=True)
        sql('ops', prerequisite)
        boundary = re.search(r'^ALTER DEFAULT PRIVILEGES ', text, re.M)
        need(boundary is not None, 'Snapshot default ACL boundary missing')
        helper_sql = plan['helper']
        helper_record = {'sqlSha256': sha256(helper_sql), 'provenanceSha256': plan['sources']['private-repo-derived-helpers-v3.provenance.json']}
        trigger_boundary = re.search(r'^CREATE TRIGGER ', text, re.M)
        need(trigger_boundary is not None and trigger_boundary.start() < boundary.start(), 'Snapshot trigger boundary missing')
        restored = 'SET ROLE postgres;\n' + text[:trigger_boundary.start()] + '\nRESET ROLE;\nSET search_path TO public, extensions, pg_catalog;\n' + helper_sql + "\nSET search_path TO '';\nSET ROLE postgres;\n" + text[trigger_boundary.start():boundary.start()] + '\nRESET ROLE;\n' + text[boundary.start():]
        sql('ops', restored, admin=True)
        write_private_json(runtime() / 'ops/helper-import-source-v3.json', helper_record)
        sql('ops', "notify pgrst, 'reload schema';")
    except subprocess.CalledProcessError as error:
        log.write_bytes(error.stderr or b'Import failed')
        log.chmod(0o600)
        raise ValueError('Schema import failed; private schema-import.log retained') from None
    record = {'source': 'gridex-ops-platform/supabase/schema.sql', 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'kind': 'repository-schema-only', 'project': identity('ops')}
    write_private_json(runtime() / 'ops/schema-source.json', record)
    complete_ops_schema(plan)
    print('OPS source schema, captured metadata and source-derived references imported; no production customer data loaded')

def verification_migration():
    directory = owned_path(ROOT / 'ops/supabase/migrations')
    files = sorted(directory.glob('*.sql'))
    need(len(files) == 1, 'Only one exact runtime verification migration is allowed')
    source = owned_path(files[0])
    match = re.fullmatch(r'(\d{14})_elklart_verify_imported_runtime\.sql', source.name)
    need(match is not None, 'Unexpected local migration')
    version = match[1]
    expected = ["DO $$BEGIN IF current_setting('elklart.runtime_project',true) IS DISTINCT FROM 'elklart-ops-demo' THEN RAISE EXCEPTION 'wrong_demo_project'; END IF; END$$;",
                "SELECT public.gridex_refresh_platform_runtime_readiness_v1('20260803093300-gridex-runtime-readiness-v3','elklart-imported-source-snapshot'," + sql_literal(version) + ");"]
    need(split_sql(source.read_text()) == expected, 'Runtime migration does not match the verification-only contract')
    return source, version, [statement[:-1] for statement in expected]


def complete_ops_schema(plan=None):
    local_docker_env()
    plan = plan or replay_sources()
    migration, version, statements = verification_migration()
    prepare('ops')
    need(sql('ops', "select current_setting('elklart.runtime_project',true)").strip() == identity('ops'), 'Database marker mismatch')
    schema = verify_imported_schema_receipt()
    verify_private_helpers(plan)
    guarded = "DO $$BEGIN IF current_setting('elklart.runtime_project',true) IS DISTINCT FROM 'elklart-ops-demo' THEN RAISE EXCEPTION 'dedicated_elklart_runtime_required'; END IF; END$$;\n"
    # Metadata is replayed exactly; owners and ACLs are never broadened to get past
    # an import error. Reference SQL is extracted from hash-verified repository sources.
    sql('ops', guarded + plan['owners'] + '\n' + plan['sourceAcls'] + '\n' + plan['auth'] + '\n' + plan['ownerInvariants'] + '\n' + plan['correctionEpochs'] + '\n' + plan['schemaPrerequisites'] + '\n' + plan['references'] + '\n' + plan['roleMapping'], admin=True)
    sql('ops', plan['ledger'], admin=True)
    # The CLI writes its own actual migration history. Never copy/fabricate old rows.
    log = owned_path(ROOT / 'ops/platform-ledger.log', exists=False)
    with log.open('a') as output:
        os.chmod(log, 0o600)
        subprocess.run([cli(), '--workdir', str(ROOT / 'ops'), 'migration', 'up', '--local'], check=True, stdout=output, stderr=output, env=local_docker_env())
    history = json.loads(sql('ops', "select coalesce(json_agg(json_build_object('version',version,'name',name,'statements',statements)),'[]') from supabase_migrations.schema_migrations;"))
    need(len(history) == 1 and history[0]['version'] == version and history[0]['name'] == 'elklart_verify_imported_runtime' and history[0]['statements'] == statements, 'Actual CLI migration history mismatch')
    # Re-evaluate the same real verification after idempotent metadata completion;
    # an already-applied migration is not a fresh schema verification by itself.
    sql('ops', statements[1] + ';')
    readiness = json.loads(sql('ops', "select to_jsonb(r) from public.platform_runtime_readiness r where id=true;"))
    need(readiness.get('migration_version') == version and readiness.get('is_ready') is True and readiness.get('blocking_issues') == [], 'Imported runtime readiness is not verified')
    sql('ops', "notify pgrst, 'reload schema';")
    verify_private_helpers(plan)
    record = {'project': identity('ops'), 'helperFunctionsVerified': len(plan['helperRows']), 'helperGucEncoding': 'set_config_from_current_v1', 'schemaSha256': sha256(schema.read_bytes()), 'sources': plan['sources'],
              'verificationMigration': {'filename': migration.name, 'sha256': sha256(migration.read_bytes()), 'version': version},
              'migrationHistoryKind': 'actual-local-supabase-cli-only', 'readinessVerified': True}
    write_private_json(ROOT / 'ops/complete-replay-source.json', record)
    print('Exact private metadata and source references replayed; actual CLI history and runtime readiness verified')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'start', 'load-ops-schema', 'complete-ops-schema', 'verify-ops-sources', 'repair-ops-helper-config'])
    parser.add_argument('project', choices=['ops', 'portal'], nargs='?', default='ops')
    args = parser.parse_args()
    try:
        if args.action == 'prepare': prepare(args.project)
        elif args.action == 'start': start(args.project)
        elif args.action == 'complete-ops-schema': complete_ops_schema()
        elif args.action == 'repair-ops-helper-config': repair_private_helper_config()
        elif args.action == 'verify-ops-sources': replay_sources(); verification_migration(); print('OPS replay source preflight verified; no database writes')
        else: load_ops_schema()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Local demo operation failed: {str(error) if not isinstance(error, subprocess.CalledProcessError) else "subprocess failed; see private runtime logs"}\n')
