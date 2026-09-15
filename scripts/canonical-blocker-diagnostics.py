#!/usr/bin/env python3
"""Read-only, bounded diagnostics on isolated CI fixtures; never release proof."""
import argparse
import ast
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PINS = {
    'canonical-full-governance-source-selftest.py': 'c65ae806e179e992affc021062188f6c137ebd02bb98c7adf5128ea806c4ac6a',
}
REASONS = ('DB2_INVITATION_INDEX_OWNED_DATABASE_REQUIRED',
           'DB2_LEGACY_OPERATOR_RECONCILIATION_REQUIRED',
           'DB2_INVITATION_INDEX_PREIMAGE_MISMATCH')
ANSI = re.compile(rb'\x1b\[[0-?]*[ -/]*[@-~]')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def source(name):
    path = ROOT / 'scripts' / name
    if path.resolve() != path or not path.is_file():
        raise ValueError('DIAGNOSTIC_SOURCE_REQUIRED')
    raw = path.read_bytes()
    if name in PINS and sha(raw) != PINS[name]:
        raise ValueError('DIAGNOSTIC_SOURCE_CHANGED')
    return path, raw


def write(mode, data):
    directory = ROOT / 'artifacts'
    if directory.is_symlink():
        raise ValueError('DIAGNOSTIC_OUTPUT_REQUIRED')
    directory.mkdir(exist_ok=True)
    path = directory / ('blocker-' + mode + '.json')
    if path.is_symlink():
        raise ValueError('DIAGNOSTIC_OUTPUT_REQUIRED')
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + '\n')


def labels():
    path, raw = source('canonical_full_governance_sql.py')
    result = {}
    for node in ast.walk(ast.parse(raw)):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id == 'check' and len(node.args) >= 2
                and isinstance(node.args[1], ast.Constant)
                and isinstance(node.args[1].value, str)):
            result[node.args[1].value] = {'source': path.relative_to(ROOT).as_posix(),
                                        'sourceSha256': sha(raw), 'line': node.lineno}
    return result


def auth_projection(raw, allowed):
    found = []
    # Only a primary verbose PostgreSQL assertion error, not CONTEXT or SQL.
    expression = rb'^(?:AssertionError: )?psql:<stdin>:[0-9]+: ERROR:  P0001: FAIL: ([^\r\n]{1,1024})$'
    for match in re.finditer(expression, raw, re.MULTILINE):
        label = match[1].decode('utf-8', errors='replace')
        if label in allowed:
            item = {'assertion': label, **allowed[label]}
            if item not in found:
                found.append(item)
    return found[:8]


def native_projection(raw):
    clean = ANSI.sub(b'', raw)
    primary = re.findall(rb'^ERROR:[^\r\n]*', clean, re.MULTILINE)
    result = {'stderrSha256': sha(raw), 'stderrBytes': len(raw),
              'ansiPresent': clean != raw, 'primaryErrorCount': len(primary),
              'headers': [], 'diagnosticOnly': True}
    for line in primary[:8]:
        state = re.search(rb'\(SQLSTATE ([A-Z0-9]{5})\)', line)
        stage = re.search(rb'NATIVE_FOUNDATION_STAGE_(\d{4}|R0[1-7][1-3])\b', line)
        # Never export arbitrary MESSAGE/DETAIL/CONTEXT, SQL or parameter values.
        result['headers'].append({
            'sqlstate': state[1].decode() if state else None,
            'stage': stage[1].decode() if stage else None,
            'knownReasons': [reason for reason in REASONS if re.search(
                rb'(?<![A-Z0-9_])' + reason.encode() + rb'(?![A-Z0-9_])', line)],
            'bytes': len(line), 'sha256': sha(line),
        })
    return result


def auth(data):
    path, raw = source('canonical-full-governance-source-selftest.py')
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
        result = subprocess.run([sys.executable, str(path)], cwd=ROOT, env=env,
                                stdout=output, stderr=errors, timeout=550)
        errors.seek(0)
        raw_error = errors.read(2 * 1024 * 1024)
    data.update(returncode=result.returncode, fixtureSha256=sha(raw),
                firstAssertions=auth_projection(raw_error, labels()),
                stderrSha256=sha(raw_error), stderrBytes=len(raw_error))
    write('auth', data)
    return result.returncode


def native(data):
    import canonical_native_foundation144 as foundation
    path, raw = source('canonical-native-supabase-lifecycle.py')
    spec = importlib.util.spec_from_file_location('blocker_native_lifecycle', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    original = foundation.failure_diagnostic
    data.update(fixtureSha256=sha(raw), transport=[])

    def observe(stderr):
        value = original(stderr)
        if value.get('stage') == 'R071':
            data['transport'].append(native_projection(stderr))
            write('native', data)
        return value  # Identical acceptance result; never relax a gate.

    foundation.failure_diagnostic = observe
    argv = sys.argv
    sys.argv = [str(path)]
    try:
        with tempfile.TemporaryFile(mode='w+') as output:
            with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                result = module.run_guarded(historical_prefix=True)
        data['returncode'] = result
        return result
    finally:
        foundation.failure_diagnostic = original
        sys.argv = argv
        write('native', data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('auth', 'native'))
    args = parser.parse_args()
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        parser.error('isolated GitHub Actions fixture required')
    data = {'scope': 'DIAGNOSTIC_NOT_RELEASE_ACCEPTANCE', 'mode': args.mode,
            'completeReplayVerified': False, 'generatedTypesVerified': False,
            'hostedDatabaseModified': False}
    write(args.mode, data)
    try:
        return auth(data) if args.mode == 'auth' else native(data)
    except Exception as error:
        data.update(errorType=type(error).__name__, returncode=1)
        write(args.mode, data)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
