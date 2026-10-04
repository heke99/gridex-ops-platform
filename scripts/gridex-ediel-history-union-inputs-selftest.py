#!/usr/bin/env python3
"""Adversarial Git/provenance planner tests; no SQL, database or traffic."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('union_inputs', Path(__file__).with_name('gridex-ediel-history-union-inputs.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def command(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.DEVNULL).decode().strip()


def commit(root, label):
    command(root, 'add', '.')
    command(root, '-c', 'user.name=Union planner selftest', '-c', 'user.email=union-selftest@example.invalid', 'commit', '--allow-empty', '-m', label)
    return command(root, 'rev-parse', 'HEAD')


def write(root, files):
    for name, data in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


def manifests(root, files):
    digests = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
    write(root, {name: json.dumps({'files': digests if index == 0 else {}}).encode()
                 for index, name in enumerate(module._strict.MANIFESTS)})


with tempfile.TemporaryDirectory(prefix='gridex-union-inputs-selftest-') as temporary:
    temp = Path(temporary)
    root = temp / 'repo'
    root.mkdir()
    command(root, 'init')
    txt = '20261001040446_test_applied_txt.sql'
    old = '20261001084343_test_base.sql'
    earlier = '20261001040159_test_market_union.sql'
    later = '20261001103439_test_forward.sql'
    previous = {txt: b'-- source already applied before branch union\nselect 40446;\n', old: b'select 84343;\n'}
    manifests(root, previous)
    write(root, {'supabase/migrations/' + name: data for name, data in previous.items()})
    base = commit(root, 'genuine historical branch source')
    current = {**previous, earlier: b'-- absent older version from the other history\nselect 40159;\n', later: b'select 103439;\n'}
    manifests(root, current)
    write(root, {'supabase/migrations/' + name: data for name, data in current.items()})
    head = commit(root, 'exact absent union additions')
    contract = {
        'format': module.FORMAT, 'baseSha': base, 'integratedParentSha': head,
        'generatedFromSha': head, 'generatedFromTree': command(root, 'rev-parse', head + '^{tree}'),
        'baseTail': old[:14], 'alreadyAppliedTxtSource': {'name': txt, 'sha256': hashlib.sha256(previous[txt]).hexdigest()},
        'requiredPendingOrder': [earlier, later],
        'earlierAbsentInputs': [{'name': earlier, 'sha256': hashlib.sha256(current[earlier]).hexdigest(), 'sourceCommit': head}],
    }
    contract_path = temp / 'contract.json'
    contract_path.write_text(json.dumps(contract))
    (root / 'supabase/migrations' / earlier).write_text('select 1; -- misleading workspace marker\n')
    result = module.prepare(root, temp / 'positive', contract_path)
    assert result['candidateSha'] == head and result['historicalMigrationsPreserved'] == 2
    assert result['earlierAbsentInputs'] == 1 and len(result['pendingMigrations']) == 2
    assert [row['name'] for row in result['pendingMigrations']] == [earlier, later]
    assert Path(result['pendingMigrations'][0]['path']).read_bytes() == current[earlier]
    assert txt not in [row['name'] for row in result['pendingMigrations']]
    assert result['ledgerClaim'].startswith('NONE:')
    print('PASS: exact Git bytes, preserved old40446, one explicit earlier absent input and no deployment-ledger claim')
    checks = 1
    try:
        module._strict.prepare(root, base, temp / 'ordinary-strict')
        raise AssertionError('Ordinary strictly-forward planner accepted a branch-union earlier input')
    except ValueError as error:
        assert 'non_forward_upgrade_migration' in str(error), str(error)
    checks += 1
    print('PASS: ordinary strictly-forward planner still rejects the union-only earlier input')

    def rejected(label, expected, changed_files=None, changed_contract=None, raw_files=None):
        global checks
        command(root, 'reset', '--hard', head)
        command(root, 'clean', '-fd')
        changed = changed_files if changed_files is not None else current
        manifests(root, changed)
        write(root, {'supabase/migrations/' + name: data for name, data in changed.items() if '/' not in name})
        if raw_files:
            write(root, raw_files)
        candidate = commit(root, label)
        contract_path.write_text(json.dumps(changed_contract if changed_contract is not None else contract))
        try:
            module.prepare(root, temp / label, contract_path, candidate)
            raise AssertionError('Unsafe union plan was accepted: ' + label)
        except ValueError as error:
            assert expected in str(error), (label, str(error))
        checks += 1
        print('PASS: refuses ' + label)

    rejected('unlisted-earlier-input', 'history_union_earlier_input_drift',
             {**current, '20261001040000_unreviewed.sql': b'select 40000;\n'})
    rejected('new-version-collision', 'new_migration_version_collision',
             {**current, '20261001103439_unreviewed_sibling.sql': b'select 7;\n'})
    rejected('changed-old-history', 'historical_migration_removed_or_changed',
             {**current, txt: b'select 99;\n'})
    rejected('removed-old-history', 'historical_migration_removed_or_changed',
             {name: data for name, data in current.items() if name != txt})
    rejected('changed-classified-source', 'earlier_input_checksum_drift',
             {**current, earlier: b'select 40160;\n'})
    broken = copy.deepcopy(contract)
    broken['earlierAbsentInputs'][0]['sha256'] = '0' * 64
    rejected('false-contract-hash', 'earlier_input_checksum_drift', changed_contract=broken)
    broken = copy.deepcopy(contract)
    broken['earlierAbsentInputs'].append(copy.deepcopy(broken['earlierAbsentInputs'][0]))
    rejected('duplicate-contract-entry', 'duplicate_earlier_input_contract', changed_contract=broken)
    broken = copy.deepcopy(contract)
    broken['generatedFromTree'] = '0' * 40
    rejected('false-snapshot-tree', 'contract_snapshot_tree_mismatch', changed_contract=broken)
    broken = copy.deepcopy(contract)
    broken['baseSha'] = '--git-option-is-not-a-commit'
    rejected('invalid-contract-revision', 'invalid_contract_commit', changed_contract=broken)
    broken = copy.deepcopy(contract)
    broken['requiredPendingOrder'].reverse()
    rejected('reordered-required-inputs', 'required_union_pending_order_mismatch', changed_contract=broken)
    broken = copy.deepcopy(contract)
    broken['alreadyAppliedTxtSource']['sha256'] = '0' * 64
    rejected('false-already-applied-txt', 'already_applied_txt_source_not_in_base', changed_contract=broken)
    rejected('false-committed-manifest', 'committed_migration_checksum_mismatch',
             raw_files={'supabase/migrations/' + later: b'select 2; -- undeclared bytes\n'})
    command(root, 'reset', '--hard', head)
    # A reachable candidate history cannot be replaced by an unrelated commit.
    command(root, 'checkout', '--orphan', 'unrelated-source')
    command(root, 'rm', '-rf', '.')
    write(root, {'unrelated.txt': b'unrelated\n'})
    orphan = commit(root, 'unrelated source')
    command(root, 'checkout', '--detach', head)
    broken = copy.deepcopy(contract)
    broken['earlierAbsentInputs'][0]['sourceCommit'] = orphan
    contract_path.write_text(json.dumps(broken))
    try:
        module.prepare(root, temp / 'unrelated-source', contract_path)
        raise AssertionError('Unrelated source commit was accepted')
    except ValueError as error:
        assert 'earlier_source_not_candidate_ancestor' in str(error), str(error)
    checks += 1
    print('PASS: refuses unrelated source commit')
    print(f'HISTORY_UNION_INPUTS_SELFTEST: {checks}/{checks} PASS; Git/provenance mechanics only, no database or migration execution')
