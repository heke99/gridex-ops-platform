#!/usr/bin/env python3
"""Offline instruction probes: synthetic shell env only; no scans, uploads or hooks.

This checks executable credential-presence examples and local-override integrity.
It does not claim an agent pressure test or a complete secret/security audit.
The recorded base commit must be available locally; this tool never fetches.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

PROBES = {
    '.agents/skills/scan-secrets/SKILL.md': ('GITGUARDIAN_API_KEY', 1),
    '.agents/skills/systematic-debugging/SKILL.md': ('IDENTITY', 2),
}
CANARY = 'SKILL_SAFETY_SYNTHETIC_CANARY_NO_REAL_CREDENTIAL'


def presence_command(name):
    return (f'if [ -n "${{{name}:-}}" ]; then printf \'%s\\n\' \'{name}=SET\'; '
            f'else printf \'%s\\n\' \'{name}=UNSET\'; fi')


def commands_from_document(text, name):
    # Execute only this bounded grammar or three exact historical regression
    # commands, never arbitrary Markdown code. The environment is never inherited.
    marker = '# skill-safety-presence: ' + name
    lines = text.splitlines()
    commands = [lines[i + 1].strip() for i, line in enumerate(lines[:-1])
                if line.strip() == marker]
    if commands:
        return commands
    legacy = {
        'GITGUARDIAN_API_KEY': ['echo $GITGUARDIAN_API_KEY'],
        'IDENTITY': ['echo "IDENTITY: ${IDENTITY:+SET}${IDENTITY:-UNSET}"',
                     'env | grep IDENTITY || echo "IDENTITY not in environment"'],
    }
    return [command for command in legacy[name] if command in text]


def probe_presence(root):
    results = []
    for rel, (name, expected_count) in PROBES.items():
        commands = commands_from_document((root / rel).read_text(), name)
        if len(commands) != expected_count:
            results.append({'path': rel, 'check': 'presence-example-count', 'ok': False})
        allowed = {presence_command(name), 'echo $GITGUARDIAN_API_KEY',
                   'echo "IDENTITY: ${IDENTITY:+SET}${IDENTITY:-UNSET}"',
                   'env | grep IDENTITY || echo "IDENTITY not in environment"'}
        for index, command in enumerate(commands):
            if command not in allowed:
                results.append({'path': rel, 'example': index, 'check': 'bounded-shell-grammar', 'ok': False})
                continue
            for state, value, expected in [('set', CANARY, 'SET'), ('unset', None, 'UNSET'), ('empty', '', 'UNSET')]:
                env = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'}
                if value is not None:
                    env[name] = value
                run = subprocess.run(['/bin/bash', '--noprofile', '--norc', '-c', command],
                                     env=env, capture_output=True, text=True, timeout=5)
                raw = run.stdout + run.stderr
                results.append({'path': rel, 'example': index, 'state': state,
                                'check': 'synthetic-presence-output',
                                'canaryExposed': CANARY in raw,
                                'ok': run.returncode == 0 and run.stdout.strip() == name + '=' + expected
                                      and not run.stderr and CANARY not in raw})
    return results


def sha(data):
    return hashlib.sha256(data).hexdigest()


def check_provenance(root):
    manifest_path = root / '.agents/skill-overrides.json'
    if not manifest_path.is_file():
        return [{'check': 'local-override-manifest', 'ok': False}]
    manifest = json.loads(manifest_path.read_text())
    reviewed = set(PROBES) | {
        '.agents/skills/using-git-worktrees/SKILL.md',
        '.agents/skills/using-superpowers/references/codex-tools.md',
        'AGENTS.md', '.agents/tools/check-skill-safety.py',
    }
    entries = manifest['overrides']
    paths = [entry['path'] for entry in entries]
    checks = [{'check': 'bounded-override-inventory',
               'ok': len(paths) == len(set(paths)) and set(paths) == reviewed},
              {'check': 'base-commit-format',
               'ok': re.fullmatch(r'[0-9a-f]{40}', manifest['baseCommit']) is not None}]
    checks += [{'check': 'upstream-lock-unchanged',
               'ok': sha((root / 'skills-lock.json').read_bytes()) == manifest['upstreamLock']['sha256']}]
    if not all(check['ok'] for check in checks):
        return checks
    base = subprocess.run(['git', '-C', str(root), 'cat-file', '-e',
                           manifest['baseCommit'] + '^{commit}'],
                          env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'}, capture_output=True, timeout=10)
    checks.append({'check': 'base-commit-available-locally', 'ok': base.returncode == 0})
    if base.returncode != 0:
        return checks
    for entry in entries:
        rel = entry['path']
        path = Path(rel)
        if rel not in reviewed or path.is_absolute() or '..' in path.parts or (root / path).is_symlink():
            checks.append({'path': rel, 'check': 'relative-override-path', 'ok': False})
            continue
        new_ok = (root / path).is_file() and sha((root / path).read_bytes()) == entry['afterSha256']
        before = subprocess.run(['git', '-C', str(root), 'show', manifest['baseCommit'] + ':' + rel],
                                env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'}, capture_output=True, timeout=10)
        old_hash = sha(before.stdout) if before.returncode == 0 else None
        checks.append({'path': rel, 'check': 'exact-before-after-provenance',
                       'ok': new_ok and old_hash == entry['beforeSha256']
                             and entry['beforeSha256'] != entry['afterSha256'] and bool(entry['reason'].strip())})
    return checks


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    checks = probe_presence(args.root.resolve()) + check_provenance(args.root.resolve())
    result = {'kind': 'OFFLINE_SYNTHETIC_SKILL_SAFETY_CHECK', 'checks': checks,
              'passed': sum(c['ok'] for c in checks), 'failed': sum(not c['ok'] for c in checks),
              'hostEnvironmentInherited': False, 'networkUsed': False,
              'limits': 'Executable examples and provenance only; separate agent pressure review required.'}
    encoded = json.dumps(result, indent=2) + '\n'
    if args.report:
        args.report.write_text(encoded)
    print(encoded, end='')
    return 1 if result['failed'] else 0


if __name__ == '__main__':
    sys.exit(main())
