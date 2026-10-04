#!/usr/bin/env python3
"""Adversarial provenance tests; never represented as database replay evidence."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('upgrade_inputs', Path(__file__).with_name('gridex-ediel-upgrade-inputs.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def command(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.DEVNULL).decode().strip()


def commit(root, message):
    command(root, 'add', '.')
    command(root, '-c', 'user.name=Replay selftest', '-c', 'user.email=replay-selftest@example.invalid', 'commit', '-m', message)
    return command(root, 'rev-parse', 'HEAD')


def write(root, files):
    for path, value in files.items():
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(value)


def manifests(root, files):
    digests = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
    write(root, {name: json.dumps({'files': digests if index == 0 else {}}).encode()
                 for index, name in enumerate(module.MANIFESTS)})


with tempfile.TemporaryDirectory(prefix='gridex-upgrade-inputs-selftest-') as temp:
    root = Path(temp) / 'repo'
    root.mkdir()
    command(root, 'init')
    old = '20260901000000_old.sql'
    new = '20260902000000_forward.sql'
    original = {old: b'-- genuine historical bytes\nselect 1;\n'}
    manifests(root, original)
    write(root, {'supabase/migrations/' + old: original[old]})
    base = commit(root, 'historic base')
    candidate = {**original, new: b'-- actual forward bytes\nselect 2;\n'}
    manifests(root, candidate)
    write(root, {'supabase/migrations/' + new: candidate[new]})
    head = commit(root, 'forward addition')
    # A working-tree CLI marker must not become the migration delivered to SQL.
    (root / 'supabase/migrations' / new).write_text('select 1; -- fake marker\n')
    result = module.prepare(root, base, Path(temp) / 'positive')
    assert result['candidateSha'] == head and result['historicalMigrationsPreserved'] == 1
    assert Path(result['forwardMigrations'][0]['path']).read_bytes() == candidate[new]
    print('PASS: exact committed bytes survive a misleading workspace marker')
    command(root, 'reset', '--hard', head)
    cases = [
        ('changed-history', {old: b'select 99;\n', new: candidate[new]}, 'historical_migration_removed_or_changed'),
        ('removed-history', {new: candidate[new]}, 'historical_migration_removed_or_changed'),
        ('retroactive-addition', {**candidate, '20260801000000_backdated.sql': b'select 3;\n'}, 'non_forward_upgrade_migration'),
        ('unsafe-path', {**candidate, '../escape.sql': b'select 3;\n'}, 'invalid_manifest_entry'),
    ]
    for label, changed, expected in cases:
        command(root, 'reset', '--hard', head)
        manifests(root, changed)
        write(root, {'supabase/migrations/' + name: data for name, data in changed.items() if '/' not in name})
        commit(root, label)
        try:
            module.prepare(root, base, Path(temp) / label)
            raise AssertionError('Unsafe provenance was accepted: ' + label)
        except ValueError as error:
            assert expected in str(error), (label, str(error))
        print('PASS: refuses ' + label)
    command(root, 'reset', '--hard', head)
    # The manifest cannot bless bytes different from its declared digest.
    (root / 'supabase/migrations' / new).write_text('select 4;\n')
    commit(root, 'false-checksum')
    try:
        module.prepare(root, base, Path(temp) / 'false-checksum')
        raise AssertionError('False checksum accepted')
    except ValueError as error:
        assert 'committed_migration_checksum_mismatch' in str(error)
    print('PASS: refuses false committed checksum')
    command(root, 'reset', '--hard', base)
    try:
        module.prepare(root, base, Path(temp) / 'no-upgrade')
        raise AssertionError('Empty upgrade accepted')
    except ValueError as error:
        assert 'no_forward_upgrade_migrations' in str(error)
    print('PASS: refuses empty upgrade claim')
    write(root, {'README.md': b'code-only change\n'})
    commit(root, 'code only')
    parity = module.prepare(root, base, Path(temp) / 'parity-only')
    assert parity['forwardMigrations'] == [] and parity['parityOnly'] is True
    assert (Path(temp) / 'parity-only' / 'upgrade-inputs.list').read_text() == ''
    print('PASS: code-only candidate becomes parity-only replay')
print('UPGRADE_INPUTS_SELFTEST: 8/8 PASS; provenance/control-plane only, no SQL replay claim')
