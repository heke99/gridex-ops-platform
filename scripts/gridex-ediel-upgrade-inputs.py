#!/usr/bin/env python3
"""Materialize only authentic forward additions for an isolated upgrade replay."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

MANIFESTS = [
    'scripts/migration-history-manifest.json',
    'scripts/migration-history-manifest.additions.json',
    'scripts/migration-history-manifest.runtime.additions.json',
]


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root)


def manifest(root, ref):
    files = {}
    for name in MANIFESTS:
        data = json.loads(git(root, 'show', f'{ref}:{name}'))
        for filename, digest in data['files'].items():
            # The immutable foundation includes genuine old basenames such as
            # "Batch 1+2.sql". Reject traversal/control characters while leaving
            # those historic names intact; new forward names are stricter below.
            if Path(filename).name != filename or any(x in filename for x in ('\n', '\r', '\0')) or not filename.endswith('.sql') or not re.fullmatch(r'[a-f0-9]{64}', digest):
                raise ValueError('invalid_manifest_entry:' + filename)
            if filename in files and files[filename] != digest:
                raise ValueError('conflicting_manifest_entry:' + filename)
            files[filename] = digest
    return files


def prepare(root, base, out):
    root, out = Path(root).resolve(), Path(out).resolve()
    base_sha = git(root, 'rev-parse', base + '^{commit}').decode().strip()
    head = git(root, 'rev-parse', 'HEAD').decode().strip()
    subprocess.run(['git', 'merge-base', '--is-ancestor', base_sha, head], cwd=root, check=True)
    previous, current = manifest(root, base_sha), manifest(root, head)
    for name, digest in previous.items():
        if current.get(name) != digest:
            raise ValueError('historical_migration_removed_or_changed:' + name)
    additions = sorted(set(current) - set(previous))
    if not additions:
        raise ValueError('no_forward_upgrade_migrations')
    last = max(name[:14] for name in previous if re.match(r'^\d{14}_', name))
    for name in additions:
        if not re.fullmatch(r'\d{14}_[A-Za-z0-9_]+\.sql', name) or name[:14] <= last:
            raise ValueError('non_forward_upgrade_migration:' + name)
    # Inspect committed bytes for every old and new input. Workspace markers
    # from the clean replay are never treated as historical source material.
    committed = {}
    for name, digest in current.items():
        data = git(root, 'show', f'{head}:supabase/migrations/{name}')
        if hashlib.sha256(data).hexdigest() != digest:
            raise ValueError('committed_migration_checksum_mismatch:' + name)
        if name in previous:
            old_data = git(root, 'show', f'{base_sha}:supabase/migrations/{name}')
            if old_data != data:
                raise ValueError('historical_migration_bytes_changed:' + name)
        else:
            committed[name] = data
    out.mkdir(parents=True, exist_ok=False)
    inputs = out / 'inputs'
    inputs.mkdir()
    rows = []
    for name in additions:
        target = inputs / name
        target.write_bytes(committed[name])
        rows.append({'name': name, 'sha256': current[name], 'path': str(target)})
    result = {
        'baseSha': base_sha, 'candidateSha': head,
        'candidateTree': git(root, 'rev-parse', 'HEAD^{tree}').decode().strip(),
        'historicalMigrationsPreserved': len(previous), 'forwardMigrations': rows,
        'provenance': 'committed exact ancestor bytes and checksum-pinned manifests; no invented ledger',
    }
    (out / 'upgrade-inputs.json').write_text(json.dumps(result, indent=2) + '\n')
    (out / 'upgrade-inputs.list').write_text(''.join(row['path'] + '\n' for row in rows))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument('--base', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    result = prepare(args.root, args.base, args.out)
    print(f"UPGRADE_INPUTS: {result['historicalMigrationsPreserved']} immutable historical inputs; "
          f"{len(result['forwardMigrations'])} actual forward migrations; base={result['baseSha']}; candidate={result['candidateSha']}")
