#!/usr/bin/env python3
"""Plan exact absent branch-union inputs; this is not a deployment-ledger claim."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

sys.dont_write_bytecode = True
_spec = importlib.util.spec_from_file_location(
    'strict_upgrade_inputs', Path(__file__).with_name('gridex-ediel-upgrade-inputs.py'))
_strict = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_strict)
git, manifest = _strict.git, _strict.manifest
FORMAT = 'gridex_ediel_history_union_upgrade_v1'
NEW_NAME = re.compile(r'\d{14}_[A-Za-z0-9_]+\.sql')
SHA = re.compile(r'[a-f0-9]{40}')
DIGEST = re.compile(r'[a-f0-9]{64}')


def ancestor(root, before, after, reason):
    if subprocess.run(['git', 'merge-base', '--is-ancestor', before, after],
                      cwd=root, check=False).returncode:
        raise ValueError(reason + ':' + before)


def commit(root, revision):
    value = git(root, 'rev-parse', '--verify', '--end-of-options', revision + '^{commit}').decode().strip()
    if not SHA.fullmatch(value):
        raise ValueError('invalid_commit:' + value)
    return value


def migration_bytes(root, revision, name):
    return git(root, 'show', f'{revision}:supabase/migrations/{name}')


def noncanonical(root, head, committed, current):
    try:
        contract = json.loads(git(root, 'show', f'{head}:scripts/gridex-aud-003-noncanonical-artifacts.json'))
    except subprocess.CalledProcessError:
        return []
    excluded = []
    for item in contract.get('artifacts') or []:
        name = Path(item.get('path', '')).name
        if name in committed:
            if item.get('status') != 'merged_repository_artifact_not_deployed' or not item.get('reason') or not item.get('evidence'):
                raise ValueError('incomplete_noncanonical_union_classification:' + name)
            if hashlib.sha256(committed[name]).hexdigest() != item.get('sha256') or current[name] != item.get('sha256'):
                raise ValueError('noncanonical_union_checksum_mismatch:' + name)
            excluded.append({'name': name, 'sha256': item['sha256'], 'finding': item.get('finding')})
    return excluded


def prepare(root, out, contract_path, candidate='HEAD'):
    root, out = Path(root).resolve(), Path(out).resolve()
    contract_bytes = Path(contract_path).read_bytes()
    contract = json.loads(contract_bytes)
    if contract.get('format') != FORMAT:
        raise ValueError('history_union_contract_format_required')
    for key in ['baseSha', 'integratedParentSha', 'generatedFromSha']:
        if not isinstance(contract.get(key), str) or not SHA.fullmatch(contract[key]):
            raise ValueError('invalid_contract_commit:' + key)
    head = commit(root, candidate)
    base = commit(root, contract['baseSha'])
    other = commit(root, contract['integratedParentSha'])
    snapshot = commit(root, contract['generatedFromSha'])
    for ref, reason in [(base, 'base_not_candidate_ancestor'),
                        (other, 'integrated_parent_not_candidate_ancestor'),
                        (snapshot, 'contract_snapshot_not_candidate_ancestor')]:
        ancestor(root, ref, head, reason)
    if git(root, 'rev-parse', snapshot + '^{tree}').decode().strip() != contract['generatedFromTree']:
        raise ValueError('contract_snapshot_tree_mismatch')
    previous, current = manifest(root, base), manifest(root, head)
    for name, digest in previous.items():
        if current.get(name) != digest:
            raise ValueError('historical_migration_removed_or_changed:' + name)
    tail = max(name[:14] for name in previous if re.match(r'^\d{14}_', name))
    if contract['baseTail'] != tail:
        raise ValueError('contract_base_tail_mismatch')
    additions = sorted(set(current) - set(previous))
    if not additions:
        raise ValueError('no_absent_union_inputs')
    for name in additions:
        if not NEW_NAME.fullmatch(name):
            raise ValueError('unsafe_union_input_name:' + name)
        siblings = [other for other in current if other != name and other[:14] == name[:14]]
        if siblings:
            raise ValueError('new_migration_version_collision:' + name)
    earlier = {name for name in additions if name[:14] <= tail}
    classified = {}
    for row in contract['earlierAbsentInputs']:
        name = row['name']
        if not NEW_NAME.fullmatch(name) or not DIGEST.fullmatch(row['sha256']) or not SHA.fullmatch(row['sourceCommit']):
            raise ValueError('invalid_earlier_input_contract:' + name)
        if name in classified:
            raise ValueError('duplicate_earlier_input_contract:' + name)
        classified[name] = row
    if earlier != set(classified):
        raise ValueError('history_union_earlier_input_drift:unlisted=' +
                         ','.join(sorted(earlier - set(classified))) + ';missing=' +
                         ','.join(sorted(set(classified) - earlier)))
    applied = contract['alreadyAppliedTxtSource']
    if applied['name'] not in previous or previous[applied['name']] != applied['sha256']:
        raise ValueError('already_applied_txt_source_not_in_base')
    if applied['name'] in additions:
        raise ValueError('already_applied_txt_source_would_replay')
    required = contract['requiredPendingOrder']
    if len(required) != len(set(required)) or any(name not in additions for name in required):
        raise ValueError('required_union_pending_input_missing')
    if [name for name in additions if name in required] != required:
        raise ValueError('required_union_pending_order_mismatch')
    committed = {}
    for name, digest in current.items():
        data = migration_bytes(root, head, name)
        if hashlib.sha256(data).hexdigest() != digest:
            raise ValueError('committed_migration_checksum_mismatch:' + name)
        if name in previous:
            if migration_bytes(root, base, name) != data:
                raise ValueError('historical_migration_bytes_changed:' + name)
        else:
            if subprocess.run(['git', 'cat-file', '-e', f'{base}:supabase/migrations/{name}'],
                              cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                raise ValueError('unclassified_existing_base_file:' + name)
            committed[name] = data
    for name, row in classified.items():
        if current[name] != row['sha256']:
            raise ValueError('earlier_input_checksum_drift:' + name)
        source = commit(root, row['sourceCommit'])
        ancestor(root, source, head, 'earlier_source_not_candidate_ancestor')
        if migration_bytes(root, source, name) != committed[name]:
            raise ValueError('earlier_source_bytes_mismatch:' + name)
    # Checksum-bound artifacts the canonical clean replay also excludes are not
    # union inputs either; same contract file and exact-byte binding as upgrade.
    excluded = noncanonical(root, head, committed, current)
    excluded_names = {row['name'] for row in excluded}
    # No source SQL runs here; outputs contain exact committed input bytes.
    out.mkdir(parents=True, exist_ok=False)
    inputs = out / 'inputs'
    inputs.mkdir()
    rows = []
    for name in [name for name in additions if name not in excluded_names]:
        target = inputs / name
        target.write_bytes(committed[name])
        rows.append({'name': name, 'sha256': current[name], 'path': str(target),
                     'earlierAbsentInput': name in earlier,
                     'sourceCommit': classified[name]['sourceCommit'] if name in earlier else head})
    result = {
        'format': FORMAT, 'baseSha': base, 'integratedParentSha': other,
        'candidateSha': head, 'candidateTree': git(root, 'rev-parse', head + '^{tree}').decode().strip(),
        'contractSha256': hashlib.sha256(contract_bytes).hexdigest(),
        'contractGeneratedFromSha': snapshot, 'historicalMigrationsPreserved': len(previous),
        'earlierAbsentInputs': len(earlier), 'pendingMigrations': rows,
        'excludedNoncanonical': excluded,
        'alreadyAppliedTxtSource': applied,
        'provenance': 'actual committed branch ancestor and exact absent checksummed inputs; old source bytes preserved',
        'ledgerClaim': 'NONE: already-applied source execution is not an externally observed40446 deployment ledger',
    }
    (out / 'history-union-inputs.json').write_text(json.dumps(result, indent=2) + '\n')
    (out / 'history-union-inputs.list').write_text(''.join(row['path'] + '\n' for row in rows))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument('--contract', default=str(Path(__file__).with_name('gridex-ediel-history-union-upgrade-contract.json')))
    parser.add_argument('--candidate', default='HEAD')
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    try:
        result = prepare(args.root, args.out, args.contract, args.candidate)
    except (ValueError, KeyError, subprocess.CalledProcessError) as error:
        raise SystemExit('HISTORY_UNION_INPUTS: FAIL: ' + str(error)) from error
    print(f"HISTORY_UNION_INPUTS: {result['historicalMigrationsPreserved']} immutable inputs; "
          f"{len(result['pendingMigrations'])} exact absent inputs including {result['earlierAbsentInputs']} explicitly classified earlier versions; "
          f"base={result['baseSha']}; candidate={result['candidateSha']}; no deployment-ledger claim")
