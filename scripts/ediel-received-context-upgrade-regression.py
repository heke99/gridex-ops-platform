#!/usr/bin/env python3
"""Execute immutable context migrations in an owned disposable local database.

Native pg_dump pre-data and the installed guard trigger are copied read-only
from the replay. Retained real contexts cannot contaminate the clean scenario.
Every probe rolls back; no trigger is disabled or historical file modified.
"""
from pathlib import Path
import atexit
import hashlib
import json
import os
import re
import selectors
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
# Do not accidentally inherit a remote PG service, host, or database override.
ENV = {key: value for key, value in os.environ.items() if not key.startswith('PG') and key != 'DATABASE_URL'}
PSQL = ['psql', URL, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']

def transaction_body(text: str) -> str:
    assert len(re.findall(r'^BEGIN;\s*$', text, re.M)) == 1, "Migration must have exactly one outer transaction"
    assert len(re.findall(r'^COMMIT;\s*$', text, re.M)) == 1, "Migration must have exactly one outer transaction"
    # Only the migration's two outer transaction commands are omitted.
    return re.sub(r'^(?:BEGIN|COMMIT);\s*$', '', text, flags=re.M)

def execute(sql: str, timeout: float = 20) -> subprocess.CompletedProcess[str]:
    return subprocess.run(PSQL, input=sql, text=True, capture_output=True, env=ENV, timeout=timeout)

def checked(sql: str) -> str:
    result = execute(sql)
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout.strip()

# The ordinary replay temporarily replaces supabase/migrations with CLI-ledger
# markers. Read immutable HEAD bytes, not those working-tree markers. The native
# preparation may supply its not-yet-committed CLI-created migration explicitly;
# either route must match the same checksum-pinned runtime manifest.
manifest = json.loads((ROOT / 'scripts/migration-history-manifest.runtime.additions.json').read_text())['files']
paths = [name for name in manifest if name.endswith('_ediel_inbound_prodat_receive_context.sql')]
assert len(paths) == 1, 'Exactly one checksum-pinned receive-context migration required'
migration_name = paths[0]
def migration_bytes(name: str, allow_preparation: bool = False) -> bytes:
    relative = 'supabase/migrations/' + name
    committed = subprocess.run(['git', 'show', 'HEAD:' + relative], cwd=ROOT, capture_output=True)
    if committed.returncode == 0:
        data = committed.stdout
    else:
        assert allow_preparation, 'Committed source migration unavailable: ' + relative
        assert os.environ.get('GITHUB_REF') == 'refs/heads/codex/ediel-pr369-native-preparation-20260922', 'Uncommitted migration is preparation-only'
        supplied = Path(os.environ['GRIDEX_CONTEXT_UPGRADE_MIGRATION_FILE']).resolve()
        assert supplied.is_relative_to(ROOT / 'pr369-generation/delivery/supabase/migrations') and supplied.name == name
        data = supplied.read_bytes()
    assert hashlib.sha256(data).hexdigest() == manifest[name], 'Migration source checksum mismatch: ' + name
    return data
migration_data = migration_bytes(migration_name, allow_preparation=True)
new_sql = transaction_body(migration_data.decode('utf-8'))
old_sql = transaction_body(migration_bytes('20260921171346_ediel_inbound_prodat_source_seal.sql').decode('utf-8'))
function_sql = "SELECT pg_get_functiondef('public.gridex_validate_ediel_message_contract()'::regprocedure);"
source_function = checked(function_sql)
source_rows_sql = """SELECT jsonb_build_array(count(*),
 md5(coalesce(string_agg(id::text||':'||execution_context_snapshot::text,E'\n' ORDER BY id),'')))
 FROM public.ediel_messages;"""
source_rows = checked(source_rows_sql)
# Copy actual table columns/defaults only. Foreign keys and unrelated business
# triggers are post-data; the exact canonical guard is separately retained.
registry = json.loads(checked("""SELECT jsonb_build_array(to_jsonb(p),to_jsonb(r))
 FROM public.ediel_message_profiles p JOIN public.ediel_rule_packs r ON r.id=p.rule_pack_id
 WHERE p.profile_key='PRODAT:Z04:L:26.A:r3' AND p.is_enabled;"""))
trigger = checked("""SET search_path=pg_catalog;
 SELECT pg_get_triggerdef(t.oid)||';' FROM pg_trigger t
 WHERE t.tgrelid='public.ediel_messages'::regclass AND NOT t.tgisinternal
 AND t.tgfoid='public.gridex_validate_ediel_message_contract()'::regprocedure;""")
assert trigger.count('CREATE TRIGGER ') == 1, 'Exactly one actual canonical guard trigger required'
assert 'EXECUTE FUNCTION public.gridex_validate_ediel_message_contract()' in trigger, 'Native trigger function must retain its qualified identity'
# CI installs the client matching the pinned native server. Use that same
# explicit executable as the schema snapshot; PATH can still resolve v16.
pg_dump = os.environ.get('GRIDEX_PG_DUMP', 'pg_dump')
dumped = subprocess.run([pg_dump, URL, '--schema-only', '--section=pre-data',
 '--table=public.ediel_messages', '--table=public.ediel_message_profiles',
 '--table=public.ediel_rule_packs', '--no-owner', '--no-privileges'],
 text=True, capture_output=True, env=ENV, timeout=20)
assert dumped.returncode == 0, dumped.stderr
for table in ['ediel_messages', 'ediel_message_profiles', 'ediel_rule_packs']:
    assert 'CREATE TABLE public.' + table + ' (' in dumped.stdout, 'Native DDL missing: ' + table
ddl_digest = hashlib.sha256(dumped.stdout.encode()).hexdigest()
database = 'gridex_context_probe_' + uuid.uuid4().hex
assert re.fullmatch(r'gridex_context_probe_[0-9a-f]{32}', database)
checked('CREATE DATABASE "' + database + '" TEMPLATE template0;')
source_psql = PSQL
# Register cleanup immediately after this exact random owned database exists.
# Cleanup uses the original local database even after PSQL selects the probe.
def cleanup_database() -> None:
    cleanup = subprocess.run(source_psql, input='DROP DATABASE "' + database + '" WITH (FORCE);',
                             text=True, capture_output=True, env=ENV, timeout=20)
    assert cleanup.returncode == 0, cleanup.stdout + cleanup.stderr
atexit.register(cleanup_database)
PSQL = ['psql', URL.rsplit('/', 1)[0] + '/' + database, '-X', '-qAt',
        '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
checked('CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;\n'
        + dumped.stdout + '\n' + old_sql + '\n' + trigger)
for table, row in [('ediel_message_profiles', registry[0]), ('ediel_rule_packs', registry[1])]:
    value = json.dumps(row).replace("'", "''")
    checked("INSERT INTO public." + table + " SELECT * FROM jsonb_populate_record(NULL::public."
            + table + ", '" + value + "'::jsonb);")
# The historic function is reinstated only inside each rollback transaction.
setup = 'BEGIN;\nSET LOCAL statement_timeout=\'10s\';\n' + old_sql
original_function = checked(function_sql)
original_digest = hashlib.sha256(original_function.encode()).hexdigest()
for label, leaf in [('object', '{"version":1,"forged":true}'), ('json-null', 'null')]:
    collision = """
DO $fixture$
declare p public.ediel_message_profiles%%rowtype; r public.ediel_rule_packs%%rowtype;
begin
 select * into strict p from public.ediel_message_profiles where profile_key='PRODAT:Z04:L:26.A:r3' and is_enabled;
 select * into strict r from public.ediel_rule_packs where id=p.rule_pack_id;
 insert into public.ediel_messages(company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,
   message_received_at,execution_context_snapshot,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 values('00000000-0000-4000-8000-00000000d099','test','inbound','edifact','PRODAT','Z04','received','historic source',
   '2026-06-20T09:00:00Z',jsonb_build_object('receivedProdatContext','%s'::jsonb),r.id,p.profile_key,p.id,r.guide_version||':r'||r.guide_revision,r.source_hash,coalesce(p.profile,'{}'::jsonb));
end $fixture$;
""" % leaf
    result = execute(setup + collision + new_sql + '\nROLLBACK;\n')
    assert result.returncode != 0, label + ': migration incorrectly accepted historic collision'
    assert re.search(r'ERROR:\s+23514:\s+ediel_received_context_namespace_collision\b', result.stderr), result.stderr
    assert checked(function_sql) == original_function, 'Probe changed committed function'
    assert checked('SELECT count(*) FROM public.ediel_messages;') == '0', 'Collision rows survived rollback'
    print('RECEIVE_CONTEXT_UPGRADE: ' + label + ' collision rejected; rollback verified', flush=True)

# Execute a clean upgrade and inspect its actual granted lock. Then show a
# second connection cannot acquire the RowExclusiveLock required by INSERT.
proc = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                        text=True, bufsize=1, env=ENV)
assert proc.stdin and proc.stdout
log = []
try:
    proc.stdin.write(setup + new_sql + r'''
DO $lock$
begin
 if not exists(select 1 from pg_locks where pid=pg_backend_pid() and relation='public.ediel_messages'::regclass
   and mode='ShareRowExclusiveLock' and granted) then raise exception 'missing_context_migration_write_lock'; end if;
end $lock$;
\echo RECEIVE_CONTEXT_LOCK_READY
''')
    proc.stdin.flush()
    # Read the descriptor directly so TextIO buffering cannot hide readiness
    # from select(). This output is only a few status lines, never a bulk log.
    deadline = time.monotonic() + 20
    selector = selectors.DefaultSelector()
    selector.register(proc.stdout, selectors.EVENT_READ)
    data = b''
    while b'RECEIVE_CONTEXT_LOCK_READY\n' not in data:
        remaining = deadline - time.monotonic()
        assert remaining > 0, 'Timed out waiting for migration lock: ' + data.decode(errors='replace')
        assert selector.select(remaining), 'No migration lock readiness output'
        chunk = os.read(proc.stdout.fileno(), 4096)
        assert chunk, 'Migration probe exited early: ' + data.decode(errors='replace')
        data += chunk
    selector.close()
    log.append(data.decode())
    blocked = execute("BEGIN; SET LOCAL lock_timeout='250ms'; LOCK TABLE public.ediel_messages IN ROW EXCLUSIVE MODE; ROLLBACK;", timeout=5)
    assert blocked.returncode != 0 and re.search(r'ERROR:\s+55P03:', blocked.stderr), blocked.stdout + blocked.stderr
    proc.stdin.write('ROLLBACK;\n\\q\n'); proc.stdin.flush(); proc.stdin.close()
    proc.wait(timeout=10)
    assert proc.returncode == 0, ''.join(log) + proc.stdout.read()
finally:
    if proc.poll() is None:
        proc.kill(); proc.wait(timeout=5)
assert checked(function_sql) == original_function, 'Clean probe changed committed function'
assert checked('SELECT count(*) FROM public.ediel_messages;') == '0', 'Clean probe retained rows'
PSQL = source_psql
assert checked(function_sql) == source_function, 'Probe changed replay guard'
assert checked(source_rows_sql) == source_rows, 'Probe changed replay messages or received contexts'
cleanup_database()
atexit.unregister(cleanup_database)
print('RECEIVE_CONTEXT_UPGRADE: actual migration lock rejects competing writer; rollback verified', flush=True)
print('RECEIVE_CONTEXT_UPGRADE: 3/3 PASS; migration=' + migration_name + '; sql_sha256=' + hashlib.sha256(migration_data).hexdigest()
      + '; restored_function_sha256=' + original_digest + '; native_predata_sha256=' + ddl_digest
      + '; unchanged_replay_function_sha256=' + hashlib.sha256(source_function.encode()).hexdigest(), flush=True)
