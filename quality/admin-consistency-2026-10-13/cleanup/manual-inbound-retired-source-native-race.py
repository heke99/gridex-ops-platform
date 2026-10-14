"""Two-session exact-key guard proof, only in a separate synthetic local database."""
import argparse
import json
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse

parser = argparse.ArgumentParser()
parser.add_argument('--db-url', required=True)
parser.add_argument('--psql', required=True)
args = parser.parse_args()
parsed = urlparse(args.db_url)
if parsed.hostname not in ('127.0.0.1', 'localhost') or not parsed.path.startswith('/gridex_manual_retirement_fixture_'):
    raise SystemExit('Refusing a non-fixture target')
cmd = [args.psql, args.db_url, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']

def query(sql):
    result = subprocess.run(cmd + ['-c', sql], text=True, capture_output=True, timeout=15)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()

results = []
for mode in ('insert', 'lookup'):
    provider = 'Race-' + mode
    query("insert into public.manual_inbound_messages(mailbox,provider_message_id) values('race@example.invalid','" + provider + "')")
    probe = query("set request.jwt.claim.role='service_role';select public.gridex_manual_inbound_source_retired_v1('race@example.invalid','" + provider + "')")
    assert probe == 'f', probe
    deleting = subprocess.Popen(['stdbuf', '-oL', '-eL'] + cmd + ['-f', '-'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    deleting.stdin.write("begin;\ndelete from public.manual_inbound_messages where mailbox='race@example.invalid' and provider_message_id='" + provider + "';\nselect 'retirement_ready';\nselect pg_sleep(1);\ncommit;\n")
    deleting.stdin.close()
    while True:
        line = deleting.stdout.readline()
        if line.strip() == 'retirement_ready':
            break
        if not line:
            raise RuntimeError('Retirement worker ended before ready: ' + deleting.stderr.read())
    statement = ("insert into public.manual_inbound_messages(mailbox,provider_message_id) values('race@example.invalid','" + provider + "')") if mode == 'insert' else ("set request.jwt.claim.role='service_role';select public.gridex_manual_inbound_source_retired_v1('race@example.invalid','" + provider + "')")
    started = time.perf_counter()
    waited = subprocess.run(cmd + ['-c', statement], text=True, capture_output=True, timeout=15)
    elapsed = time.perf_counter() - started
    deleting.wait(timeout=15)
    assert deleting.returncode == 0, deleting.stderr.read()
    assert elapsed >= 0.5, ('statement did not wait for retirement', elapsed)
    if mode == 'insert':
        assert waited.returncode != 0 and '23514: manual_inbound_source_retired' in waited.stderr, waited.stderr
        outcome = 'late_insert_rejected_23514'
    else:
        assert waited.returncode == 0 and waited.stdout.strip() == 't', (waited.stdout, waited.stderr)
        outcome = 'waiting_service_lookup_observed_committed_retirement'
    assert query("select count(*) from public.manual_inbound_messages where mailbox='race@example.invalid' and provider_message_id='" + provider + "'") == '0'
    results.append({'mode': mode, 'before_retired': False, 'wait_seconds': round(elapsed, 3), 'outcome': outcome, 'raw_rows_after': 0})

receipt = {'engine': query('select version()'), 'target': 'separate local synthetic fixture', 'public_migration': '20261013140502_manual_inbound_retired_source_consistency.sql', 'multi_connection_cases': results, 'no_live_mutations': True}
Path('quality/admin-consistency-2026-10-13/cleanup/manual-inbound-retired-source-native-race-proof.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt))
