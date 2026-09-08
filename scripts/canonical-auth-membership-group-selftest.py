#!/usr/bin/env python3
"""Verify the fixed auth/membership group runner and consolidated memory."""
import hashlib
import json
import os
import re
from collections import Counter
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / 'scripts/canonical-auth-membership-group.py'
RBAC_FIXTURE = ROOT / 'scripts/canonical-rbac-tenant-selftest.py'
COMMANDS = [
    ['python3', 'scripts/canonical-auth-email-selftest.py'],
    ['python3', 'scripts/canonical-poa-request-selftest.py', '--selection-only'],
    ['python3', 'scripts/canonical-poa-request-selftest.py'],
    ['python3', 'scripts/canonical-auth-invitation-chain-selftest.py', '--selection-only'],
    ['python3', 'scripts/canonical-auth-invitation-chain-selftest.py'],
    ['python3', 'scripts/canonical-membership-actor-fk-selftest.py'],
    ['python3', 'scripts/canonical-rbac-tenant-selftest.py'],
]
HASHES = {
    'current-state.md': '404a2ee5d21f476e108c0efa17a3f45f9b2501db9f27fe3659378373dac08bf8',
    'current-task.md': 'c84e34eb0e8dfdc0a5e4d038d1c27a895e87c943c4c0ead78268e87a08afed7c',
    'handover.md': '3ac3c52211232f2647503faef5bc9ef78d19bd2bcd8e47be54927ecd5367c477',
    'open-blockers.md': 'e3250c981fc6a118b83072d8ae1e67c73b42dd3230a043adcadd38eab4d4cc55',
    'work-plan.md': 'cf5cc2137e7c6340abff3e434c8ba8d3313602c1cd038bdc4356dc55b1fa433a',
    'checkpoint.json': 'c486b10af659577c73b8ab42edd7591590be200126ef445022b84c8e69fcc19c',
}


def run(*args, cwd=ROOT, env=None):
    return subprocess.run(args, cwd=cwd, env=env, text=True, capture_output=True, check=False)


def main():
    emitted = run('python3', str(RBAC_FIXTURE), '--emit')
    assert emitted.returncode == 0, emitted.stderr
    for source in [
        '20260520_batch_6e_rbac_tenant_stats_whitelabel.sql',
        '20260520_batch_6e_fix_rbac_backfill_security.sql',
        '20260520_batch_6e_hard_platform_roles_only.sql',
    ]:
        body = (ROOT / 'supabase/migrations' / source).read_text()
        assert emitted.stdout.count(body) == 2, source
    assert "select test_assert(current_setting('server_version_num')::int / 10000=17" in emitted.stdout
    assert 'FIXTURE_POLICY_TARGETS_PRESENT=8' in emitted.stdout
    assert 'FIXTURE_POLICY_TARGETS_ABSENT=21' in emitted.stdout
    user_status = "alter table public.user_profiles add column if not exists user_status text not null default 'active';"
    profile_seed = 'insert into user_profiles(id,email,full_name,user_status,active_company_id) values'
    assert emitted.stdout.count(user_status) == 1
    assert emitted.stdout.index(user_status) < emitted.stdout.index(profile_seed)

    dry = run('python3', str(RUNNER), '--dry-run')
    assert dry.returncode == 0, dry.stderr
    assert dry.stdout.splitlines() == [' '.join(command) for command in COMMANDS], dry.stdout
    rejected = run('python3', str(RUNNER), '--command', 'echo unsafe')
    assert rejected.returncode != 0, 'arbitrary command option accepted'

    with tempfile.TemporaryDirectory() as directory:
        fixture = Path(directory)
        (fixture / 'scripts').mkdir()
        shutil.copy2(RUNNER, fixture / 'scripts' / RUNNER.name)
        for child_name in dict.fromkeys(command[1] for command in COMMANDS):
            child = fixture / child_name
            child.write_text("#!/usr/bin/env python3\nimport json,os,sys\n"
                             "assert not any(k.startswith('PG') for k in os.environ)\n"
                             "with open(os.environ['GROUP_LOG'], 'a') as log:\n"
                             "    log.write(json.dumps([sys.argv[0], *sys.argv[1:]]) + '\\n')\n"
                             "if json.loads(os.environ.get('FAIL_COMMAND', 'null')) == "
                             "[sys.argv[0], *sys.argv[1:]]:\n"
                             "    raise SystemExit(23)\n")
        log = fixture / 'commands.jsonl'
        environment = dict(os.environ, PGHOSTADDR='production.invalid', PGSERVICE='production', GROUP_LOG=str(log))
        passed = run('python3', str(fixture / 'scripts' / RUNNER.name), cwd=fixture, env=environment)
        assert passed.returncode == 0, (passed.returncode, passed.stderr)
        observed = [json.loads(line) for line in log.read_text().splitlines()]
        expected = [[command[1], *command[2:]] for command in COMMANDS]
        assert len(observed) == len(COMMANDS) == 7, observed
        assert observed == expected, observed
        assert passed.stdout.splitlines() == [' '.join(command) for command in COMMANDS], passed.stdout

        log.write_text('')
        environment['FAIL_COMMAND'] = json.dumps(expected[2])
        failed = run('python3', str(fixture / 'scripts' / RUNNER.name), cwd=fixture, env=environment)
        assert failed.returncode == 23, (failed.returncode, failed.stderr)
        observed = [json.loads(line) for line in log.read_text().splitlines()]
        assert observed == expected[:3], observed
        assert failed.stdout.splitlines() == [' '.join(command) for command in COMMANDS[:3]], failed.stdout

    archive = ROOT / '.agent-memory/archive/pre-batch-20260907'
    for name, expected in HASHES.items():
        actual = hashlib.sha256((archive / name).read_bytes()).hexdigest()
        assert actual == expected, (name, actual)

    accounting = run('python3', 'scripts/gridex-replay-input-accounting.py')
    account = json.loads(accounting.stdout)
    assert account['status'] != 'INVALID_INPUT_CONTRACT' and not account['errors'], account
    assert accounting.returncode == int(account['counts']['UNCLASSIFIED'] > 0), (
        accounting.returncode, account['counts'])
    grouped = run('python3', 'scripts/gridex-replay-review-groups.py', '--group', 'auth_membership_tenant')
    group = json.loads(grouped.stdout)
    assert group['status'] != 'INVALID_INPUT_CONTRACT' and not group['errors'], group
    assert grouped.returncode == int(group['global']['unresolvedCounts']['total'] > 0), (
        grouped.returncode, group['global']['unresolvedCounts'])
    state = (ROOT / '.agent-memory/current-state.md').read_text()
    state_flat = ' '.join(state.split())
    counts = account['counts']
    group_counts = Counter(item['classification'] for item in group['inputs'])
    accounting_summary = (f"Current accounting is {account['totalMigrations']} inputs: "
        f"{counts['FULL_FILE_SELECTED']} `FULL_FILE_SELECTED`, {counts['SUBSTITUTED']} `SUBSTITUTED`, "
        f"{counts['UNCLASSIFIED']} `UNCLASSIFIED`, and {counts['EXPLICITLY_EXCLUDED']} `EXPLICITLY_EXCLUDED`.")
    group_summary = (f"The focused group contains {len(group['inputs'])} inputs: "
        f"{group_counts['FULL_FILE_SELECTED']} selected, {group_counts['SUBSTITUTED']} substituted, "
        f"{group_counts['UNCLASSIFIED']} unclassified, and {group_counts['EXPLICITLY_EXCLUDED']} excluded.")
    for marker in [accounting_summary, group_summary,
                   'For this workflow-tooling batch, no production mutation is authorized or performed.',
                   'Do not publish per file or subtask']:
        assert ' '.join(marker.split()) in state_flat, marker
    for name in ['current-task.md', 'handover.md', 'open-blockers.md', 'work-plan.md']:
        pointer = (ROOT / '.agent-memory' / name).read_text()
        assert 'current-state.md' in pointer and f'archive/pre-batch-20260907/{name}' in pointer
    checkpoint = json.loads((ROOT / '.agent-memory/checkpoint.json').read_text())
    state_status = re.search(r'^Status: ([A-Z_]+)$', state, re.MULTILINE)
    assert state_status, 'current-state status is missing'
    assert checkpoint['status'] == state_status.group(1)
    assert checkpoint['current_state'] == '.agent-memory/current-state.md'
    print('PASS: fixed runner, failure stop, environment isolation, archive hashes and status pointers')


if __name__ == '__main__':
    main()
