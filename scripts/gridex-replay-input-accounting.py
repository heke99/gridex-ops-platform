#!/usr/bin/env python3
"""Exhaustive replay *input* accounting, with no database or ledger writes.

FULL_FILE_SELECTED means selected for whole-file replay by the existing selector;
it is NOT a claim that SQL has run successfully or that all effects survive.
Exit 1: unclassified inputs (or partial substitutions in --require-full-effects).
Exit 2: invalid manifests/checksums/selection contract. JSON always goes to stdout.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

PREFIX = 'gridex-aud-003-'
HISTORY = ['migration-history-manifest.json', 'migration-history-manifest.additions.json',
           'migration-history-manifest.runtime.additions.json']
PLANS = [PREFIX + 'legacy-foundation.json', PREFIX + 'legacy-foundation.additions.json']
SELECTOR_HEADER = ('python3 - "$HISTORY" "$HISTORY_ADDITIONS" "$HISTORY_RUNTIME_ADDITIONS" '
                   '"$FOUNDATION_PLAN" "$FOUNDATION_ADDITIONS" "$FOUNDATION_ORDER" '
                   '"$NONCANONICAL" "$SUPABASE" "$HOLD" "$FOUNDATION_EXEC" "$TIMESTAMP_EXEC" <<\'PY\'\n')
CATEGORIES = ('FULL_FILE_SELECTED', 'SUBSTITUTED', 'EXPLICITLY_EXCLUDED', 'UNCLASSIFIED')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path, optional=False):
    if optional and not path.exists():
        return {}
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f'duplicate JSON key {key} in {path.name}')
            result[key] = value
        return result
    return json.loads(path.read_text(), object_pairs_hook=unique_pairs)


def merged_maps(documents, key):
    result = {}
    for document in documents:
        for name, value in (document.get(key) or {}).items():
            if name in result and result[name] != value:
                raise ValueError(f'conflicting {key} declarations: {name}')
            result[name] = value
    return result


def relative_input(supabase, rel):
    path = Path(rel)
    if path.is_absolute() or '..' in path.parts or str(path) != rel:
        raise ValueError(f'noncanonical input path: {rel}')
    resolved = (supabase / path).resolve()
    if not resolved.is_relative_to(supabase.resolve()):
        raise ValueError(f'input escapes supabase directory: {rel}')
    return resolved


def account(root):
    scripts, supabase = root / 'scripts', root / 'supabase'
    migrations = supabase / 'migrations'
    histories = [read_json(scripts / name, optional=i > 0) for i, name in enumerate(HISTORY)]
    plans = [read_json(scripts / name, optional=i > 0) for i, name in enumerate(PLANS)]
    pins = merged_maps(histories, 'files')
    # The additions document intentionally overrides preserveSourceReplay and
    # purpose metadata. Match that precedence; the selector validates effective pins.
    derived = {key: value for plan in plans
               for key, value in (plan.get('derivedBootstrap') or {}).items()}
    exclusions = read_json(scripts / (PREFIX + 'noncanonical-artifacts.json')).get('artifacts') or []
    inventory = sorted(p for p in migrations.rglob('*') if p.is_file() and p.suffix.lower() == '.sql')
    errors = []
    for path in inventory:
        relative_input(supabase, path.relative_to(supabase).as_posix())
        expected = pins.get(path.name)
        if not isinstance(expected, str) or not re.fullmatch(r'[0-9a-f]{64}', expected):
            errors.append(f'migration is not checksum-pinned: {path.relative_to(supabase)}')
        elif digest(path) != expected:
            errors.append(f'migration checksum mismatch: {path.relative_to(supabase)}')
    if errors:
        raise ValueError('; '.join(errors))

    shell = scripts / (PREFIX + 'clean-replay.sh')
    shell_text = shell.read_text()
    if shell_text.count(SELECTOR_HEADER) != 1:
        raise ValueError('replay selector header changed; review accounting integration')
    remaining = shell_text.split(SELECTOR_HEADER, 1)[1]
    if '\nPY\n' not in remaining:
        raise ValueError('replay selector terminator missing')
    selector = remaining.split('\nPY\n', 1)[0]

    # Execute the exact existing Python selector, never the shell or SQL. This
    # deliberately fails closed on a refactor until its interface is reviewed.
    with tempfile.TemporaryDirectory(prefix='gridex-input-accounting-') as temp:
        foundation_out, timestamp_out = Path(temp) / 'foundation', Path(temp) / 'timestamp'
        paths = [*(scripts / name for name in HISTORY), *(scripts / name for name in PLANS),
                 scripts / (PREFIX + 'foundation-order.json'),
                 scripts / (PREFIX + 'noncanonical-artifacts.json'),
                 supabase, migrations, foundation_out, timestamp_out]
        selected = subprocess.run([sys.executable, '-', *map(str, paths)], input=selector,
                                  capture_output=True, text=True, timeout=60)
        if selected.returncode:
            raise ValueError('replay selector rejected inputs: ' + selected.stderr.strip())
        lists = {'foundation': foundation_out.read_text().splitlines(),
                 'timestamp': timestamp_out.read_text().splitlines()}

    execution = defaultdict(list)
    substitutions = defaultdict(list)
    selected_artifacts = set()
    for stage, paths in lists.items():
        for ordinal, name in enumerate(paths, 1):
            path = Path(name)
            rel = path.relative_to(supabase).as_posix()
            relative_input(supabase, rel)
            if rel in selected_artifacts:
                raise ValueError(f'duplicate execution input: {rel}')
            selected_artifacts.add(rel)
            if rel.startswith('migrations/'):
                execution[rel].append({'stage': stage, 'ordinal': ordinal})
            if rel in derived and derived[rel].get('source'):
                meta = derived[rel]
                source = meta['source']
                relative_input(supabase, source)
                if not source.startswith('migrations/'):
                    raise ValueError(f'derived source is not a migration: {source}')
                substitutions[source].append({
                    'artifact': rel, 'artifactSha256': digest(path),
                    'preserveSourceReplay': bool(meta.get('preserveSourceReplay', False)),
                    'stage': stage, 'ordinal': ordinal})

    # Supplemental shell prerequisites are not whole source migrations and do
    # not upgrade any classification. Record and validate their existing pins.
    supplemental = []
    for variable, rel in re.findall(r'^([A-Z_]+)="\$SUPABASE/(bootstrap/[^"\n]+)"$', shell_text, re.M):
        match = re.search(r'^' + re.escape(variable) + r'_SHA256="([0-9a-f]{64})"$', shell_text, re.M)
        if not match:
            raise ValueError(f'supplemental artifact checksum pin missing: {rel}')
        path = relative_input(supabase, rel)
        if not path.is_file() or digest(path) != match.group(1):
            raise ValueError(f'supplemental artifact checksum mismatch: {rel}')
        supplemental.append({'path': rel, 'sha256': match.group(1),
                             'evidenceScope': 'PREREQUISITE_ONLY_NOT_FULL_SOURCE_EFFECTS'})

    excluded = {}
    for item in exclusions:
        rel = item['path']
        relative_input(supabase, rel)
        if rel in excluded:
            raise ValueError(f'duplicate exclusion: {rel}')
        if rel in execution or rel in substitutions:
            raise ValueError(f'exclusion overlap with execution/substitution: {rel}')
        excluded[rel] = item

    rows = []
    for path in inventory:
        rel = path.relative_to(supabase).as_posix()
        if rel in execution:
            classification = 'FULL_FILE_SELECTED'
        elif rel in substitutions:
            classification = 'SUBSTITUTED'
        elif rel in excluded:
            classification = 'EXPLICITLY_EXCLUDED'
        else:
            classification = 'UNCLASSIFIED'
        row = {'path': rel, 'sha256': digest(path), 'classification': classification,
               'execution': execution.get(rel, []), 'derivedArtifacts': substitutions.get(rel, [])}
        if classification == 'SUBSTITUTED':
            row['effectsStatus'] = 'PARTIAL_EFFECTS_UNRESOLVED'
        if classification == 'UNCLASSIFIED':
            row['reason'] = 'No whole-file execution, selected derived source, or explicit exclusion'
        if rel in excluded:
            row['exclusion'] = excluded[rel]
        rows.append(row)
    counts = Counter(row['classification'] for row in rows)
    status = ('UNCLASSIFIED_INPUTS' if counts['UNCLASSIFIED'] else
              'PARTIAL_EFFECTS_UNRESOLVED' if counts['SUBSTITUTED'] else 'INPUTS_ACCOUNTED')
    return {
        'schemaVersion': 1, 'status': status, 'evidenceScope': 'INPUT_SELECTION_ONLY',
        'ledgerProvenanceVerified': False, 'sqlExecutionVerified': False,
        'fullExecutionMeaning': 'Entire source selected; not proof of successful SQL execution or surviving effects',
        'selector': {'path': 'scripts/' + shell.name, 'sha256': digest(shell),
                     'pythonSha256': hashlib.sha256(selector.encode()).hexdigest()},
        'totalMigrations': len(rows), 'counts': {key: counts[key] for key in CATEGORIES},
        'selectedInputCounts': {key: len(value) for key, value in lists.items()},
        'supplementalPrerequisites': supplemental, 'migrations': rows, 'errors': []}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--require-full-effects', action='store_true',
                        help='also fail unresolved substitutions; this does not verify database effects')
    args = parser.parse_args()
    try:
        report = account(args.root.resolve())
        code = int(bool(report['counts']['UNCLASSIFIED'] or
                        (args.require_full_effects and report['counts']['SUBSTITUTED'])))
    except (ValueError, OSError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        report = {'schemaVersion': 1, 'status': 'INVALID_INPUT_CONTRACT',
                  'evidenceScope': 'INPUT_SELECTION_ONLY', 'ledgerProvenanceVerified': False,
                  'sqlExecutionVerified': False, 'errors': [str(error)]}
        code = 2
    print(json.dumps(report, indent=2, sort_keys=True))
    return code


if __name__ == '__main__':
    raise SystemExit(main())
