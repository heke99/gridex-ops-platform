#!/usr/bin/env python3
"""Execute the real context migration against synthetic pre-upgrade rows.

Only the disposable local replay is allowed. Every probe uses a rollback-only
transaction; no trigger is disabled and no historical file is modified.
"""
from pathlib import Path
import hashlib
import os
import re
import selectors
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
# Do not accidentally inherit a remote PG service, host, or database override.
ENV = {key: value for key, value in os.environ.items() if not key.startswith('PG') and key != 'DATABASE_URL'}
PSQL = ['psql', URL, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']

def transaction_body(path: Path) -> str:
    text = path.read_text()
    assert len(re.findall(r'^BEGIN;\s*$', text, re.M)) == 1, path
    assert len(re.findall(r'^COMMIT;\s*$', text, re.M)) == 1, path
    # Only the migration's two outer transaction commands are omitted.
    return re.sub(r'^(?:BEGIN|COMMIT);\s*$', '', text, flags=re.M)

def execute(sql: str, timeout: float = 20) -> subprocess.CompletedProcess[str]:
    return subprocess.run(PSQL, input=sql, text=True, capture_output=True, env=ENV, timeout=timeout)

def checked(sql: str) -> str:
    result = execute(sql)
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout.strip()

paths = list((ROOT / 'supabase/migrations').glob('*_ediel_inbound_prodat_receive_context.sql'))
assert len(paths) == 1, 'Exactly one CLI-named receive-context migration required'
migration = paths[0]
new_sql = transaction_body(migration)
old_path = ROOT / 'supabase/migrations/20260921171346_ediel_inbound_prodat_source_seal.sql'
old_sql = transaction_body(old_path)
# The historic function is reinstated only inside each transaction. A disconnect
# also rolls it back. This represents an actual pre-upgrade collision, not an
# attempt to insert an impossible collision through the newly protected trigger.
setup = 'BEGIN;\nSET LOCAL statement_timeout=\'10s\';\n' + old_sql + '''
INSERT INTO public.companies(id,name) VALUES
 ('00000000-0000-4000-8000-00000000d099','Receive context upgrade probe');
'''
function_sql = "SELECT pg_get_functiondef('public.gridex_validate_ediel_message_contract()'::regprocedure);"
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
    # Use one byte at a time to avoid a buffered TextIO line hiding readiness
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
assert checked("SELECT count(*) FROM public.companies WHERE id='00000000-0000-4000-8000-00000000d099';") == '0'
print('RECEIVE_CONTEXT_UPGRADE: actual migration lock rejects competing writer; rollback verified', flush=True)
print('RECEIVE_CONTEXT_UPGRADE: 3/3 PASS; migration=' + migration.name + '; sql_sha256=' + hashlib.sha256(migration.read_bytes()).hexdigest()
      + '; restored_function_sha256=' + original_digest, flush=True)
