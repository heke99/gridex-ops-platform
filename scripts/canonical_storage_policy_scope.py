"""Qualify a two-policy role narrowing on an owned full clone, not production.

The original S21 body must fail on a named access-table dependency first and
pass unchanged afterward. Full catalog, row and ledger snapshots must differ
only at the two policy role lists. No grants or expectation changes are allowed.
"""
import copy
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
CANDIDATE = 'scripts/sql/forward-candidates/restrict_grid_owner_storage_policy_roles.sql'
CANDIDATE_SHA = '626642f7466567003c4e3d800aa288748c7b0f973553ac4d91630cf71b863272'
SOURCE = 'supabase/migrations/20260528_batch_7a1_inbound_hardening.sql'
SOURCE_SHA = '4653d576effa13161ef8bdd713cb928ba9f57e8f2a16084d0f5dff2bc3d83959'
POLICIES = ('grid_owner_agreements_platform_read', 'grid_owner_agreements_platform_write')
KEYS = tuple('policy/storage.objects/' + name for name in POLICIES)
FAILURE_CODES = frozenset(('STORAGE_POLICY_SCOPE_ACCESS_TABLE_ERROR_REQUIRED', 'STORAGE_POLICY_SCOPE_BASELINE_CHANGED', 'STORAGE_POLICY_SCOPE_NEGATIVE_DELTA_REQUIRED', 'STORAGE_POLICY_SCOPE_NEGATIVE_ERROR_REQUIRED', 'STORAGE_POLICY_SCOPE_NEGATIVE_ROLLBACK_REQUIRED', 'STORAGE_POLICY_SCOPE_OWNED_TARGET_REQUIRED', 'STORAGE_POLICY_SCOPE_PREIMAGE_REQUIRED', 'STORAGE_POLICY_SCOPE_RECOVERY_REQUIRED', 'STORAGE_POLICY_SCOPE_REPEAT_REQUIRED', 'STORAGE_POLICY_SCOPE_ROLE_REQUIRED', 'STORAGE_POLICY_SCOPE_ROLLBACK_REQUIRED', 'STORAGE_POLICY_SCOPE_SNAPSHOT_REQUIRED', 'STORAGE_POLICY_SCOPE_SOURCE_REQUIRED', 'STORAGE_POLICY_SCOPE_SQL_REQUIRED', 'STORAGE_POLICY_SCOPE_UNEXPECTED_DELTA'))
STAGES = frozenset(('scope_identity', 'scope_original_s21', 'scope_first',
                   'scope_fixed_s21', 'scope_repeat', 'scope_negative_setup',
                   'scope_negative_s21', 'scope_recovery'))


def candidate():
    for name, expected in ((SOURCE, SOURCE_SHA), (CANDIDATE, CANDIDATE_SHA)):
        path = ROOT / name
        if path.resolve() != path or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError('STORAGE_POLICY_SCOPE_SOURCE_REQUIRED')
    return (ROOT / CANDIDATE).read_bytes()


def error_header(raw):
    """Never return free-form SQL/error text; admit one exact access-table error."""
    if type(raw) is not bytes or len(raw) > 65536 or b'\x00' in raw:
        return None
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError:
        return None
    headers = [line.rstrip('\r') for line in text.split('\n')
               if re.match(r'^(?:psql:[^\r\n]+:[0-9]+: )?(?:ERROR|FATAL|PANIC):', line)]
    if len(headers) != 1:
        return None
    match = re.fullmatch(r'(?:psql:<stdin>:[0-9]+: )?ERROR: +42501: permission denied for table (roles|user_roles)', headers[0])
    return 'table:' + match[1] if match else None


def sql(target, legacy, database, statement, stage, expected='00000'):
    if (stage not in STAGES or database != 'gridex_auth_legacy_atomic'
            or type(target) is not legacy.OwnedPostgres
            or getattr(target.command, '__func__', None) is not legacy.OwnedPostgres.command
            or getattr(target.verify_logging, '__func__', None) is not legacy.OwnedPostgres.verify_logging
            or expected not in ('00000', '42501')):
        raise ValueError('STORAGE_POLICY_SCOPE_OWNED_TARGET_REQUIRED')
    target.verify_logging()
    result = subprocess.run(target.command(database, transaction=False) + ['-f', '-'],
        input=statement.encode() if type(statement) is str else statement,
        capture_output=True, timeout=180, env=legacy.clean_environment())
    target.verify_logging()
    safe = legacy.safe_receipt(result.stderr.decode(errors='replace'), result.returncode, stage)
    if safe['sqlstate'] != expected or (result.returncode == 0) != (expected == '00000'):
        print(json.dumps({'stage': stage, 'result': 'UNEXPECTED_SQL_RESULT'}), flush=True)
        raise ValueError('STORAGE_POLICY_SCOPE_SQL_REQUIRED')
    if expected == '42501':
        label = error_header(result.stderr)
        if label is None:
            raise ValueError('STORAGE_POLICY_SCOPE_ACCESS_TABLE_ERROR_REQUIRED')
        print(json.dumps({'stage': stage, 'sqlstate': expected, 'deniedObject': label}), flush=True)
        return label
    return result.stdout.decode()


def verify_delta(before, after, role):
    if type(role) is not int or role <= 0:
        raise ValueError('STORAGE_POLICY_SCOPE_ROLE_REQUIRED')
    if set(before) != {'catalog', 'rows', 'ledger'} or set(after) != set(before):
        raise ValueError('STORAGE_POLICY_SCOPE_SNAPSHOT_REQUIRED')
    expected = copy.deepcopy(before)
    for key, command in zip(KEYS, ('r', 'a')):
        policy = expected['catalog'].get(key)
        if (type(policy) is not dict or set(policy) != {'command','permissive','roles','using','check'}
                or policy['command'] != command or policy['permissive'] is not True
                or policy['roles'] != ['0']
                or (command == 'r' and (not policy['using'] or policy['check'] is not None))
                or (command == 'a' and (policy['using'] is not None or not policy['check']))):
            raise ValueError('STORAGE_POLICY_SCOPE_PREIMAGE_REQUIRED')
        # pg_policy.polroles is oid[]: PostgreSQL JSON encodes OIDs as strings.
        policy['roles'] = [str(role)]
    if expected != after:
        raise ValueError('STORAGE_POLICY_SCOPE_UNEXPECTED_DELTA')


def complete_s21(output):
    lines = [line for line in output.splitlines() if line.strip()]
    if not lines or lines[-1] != 'PERMISSION_CASE_COMPLETE' or lines.count('PERMISSION_CASE_COMPLETE') != 1:
        raise ValueError('STORAGE_POLICY_SCOPE_S21_INCOMPLETE')


def qualify(target, legacy, database, capture, s21):
    raw = candidate()
    before = capture()
    role = json.loads(sql(target, legacy, database,
        "SELECT to_json(('authenticated'::regrole::oid)::bigint);", 'scope_identity'))
    denied = sql(target, legacy, database, s21, 'scope_original_s21', '42501')
    if capture() != before:
        raise ValueError('STORAGE_POLICY_SCOPE_BASELINE_CHANGED')
    sql(target, legacy, database, raw, 'scope_first')
    after = capture()
    verify_delta(before, after, role)
    complete_s21(sql(target, legacy, database, s21, 'scope_fixed_s21'))
    if capture() != after:
        raise ValueError('STORAGE_POLICY_SCOPE_ROLLBACK_REQUIRED')
    sql(target, legacy, database, raw, 'scope_repeat')
    if capture() != after:
        raise ValueError('STORAGE_POLICY_SCOPE_REPEAT_REQUIRED')
    # Reintroduce just the original SELECT role scope on this disposable clone.
    # The unchanged S21 must reproduce the same access-table error, then recover.
    sql(target, legacy, database,
        'ALTER POLICY grid_owner_agreements_platform_read ON storage.objects TO PUBLIC;',
        'scope_negative_setup')
    negative = copy.deepcopy(after)
    negative['catalog'][KEYS[0]]['roles'] = ['0']
    if capture() != negative:
        raise ValueError('STORAGE_POLICY_SCOPE_NEGATIVE_DELTA_REQUIRED')
    if sql(target, legacy, database, s21, 'scope_negative_s21', '42501') != denied:
        raise ValueError('STORAGE_POLICY_SCOPE_NEGATIVE_ERROR_REQUIRED')
    if capture() != negative:
        raise ValueError('STORAGE_POLICY_SCOPE_NEGATIVE_ROLLBACK_REQUIRED')
    sql(target, legacy, database, raw, 'scope_recovery')
    if capture() != after or candidate() != raw:
        raise ValueError('STORAGE_POLICY_SCOPE_RECOVERY_REQUIRED')
    complete_s21(sql(target, legacy, database, s21, 'scope_fixed_s21'))
    if capture() != after:
        raise ValueError('STORAGE_POLICY_SCOPE_ROLLBACK_REQUIRED')
    return dict(candidateSha256=CANDIDATE_SHA, originalSqlstate='42501',
        deniedObject=denied, unchangedS21Verified=True, changedPolicyRoleLists=2,
        allOtherCatalogRowsAndLedgerPreserved=True, repeatVerified=True,
        negativeAndRecoveryVerified=True, promoted=False, productionModified=False)
