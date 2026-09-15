#!/usr/bin/env python3
"""Combine the immutable selector with the reviewed shared residual source plan.

Input accounting is not SQL execution. All unresolved selector inputs must have
an exact reviewed residual disposition; unknown, duplicate, conflicting or
changed inputs remain blockers. This does not create a migration ledger, admit
an external target or accept schema/types from a diagnostic database.
"""
from __future__ import annotations

import argparse
from collections import Counter
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]


def load(filename):
    spec = importlib.util.spec_from_file_location('complete_' + filename.replace('-', '_'), ROOT/'scripts'/filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def combine(selected, residual):
    if selected.get('errors') or selected.get('evidenceScope') != 'INPUT_SELECTION_ONLY':
        raise ValueError('COMPLETE_ACCOUNTING_INVALID_SELECTOR')
    rows = selected['migrations']
    if (len(rows) != selected['totalMigrations'] or
            len({row['path'] for row in rows}) != len(rows)):
        raise ValueError('COMPLETE_ACCOUNTING_DUPLICATE_SOURCE')
    by_path = {row['path']: row for row in rows}
    paths = [row['source'] for row in residual['sources']]
    if len(paths) != 7 or len(set(paths)) != 7:
        raise ValueError('COMPLETE_ACCOUNTING_RESIDUAL_SET_MISMATCH')
    for entry in residual['sources']:
        source = entry['source']
        base = by_path.get(source)
        if (base is None or base['sha256'] != entry['sourceSha256'] or
                base['classification'] not in ('UNCLASSIFIED', 'SUBSTITUTED') or base['execution']):
            raise ValueError('COMPLETE_ACCOUNTING_RESIDUAL_OVERLAP_OR_SOURCE_MISMATCH')
    unresolved = [row['path'] for row in rows
                  if row['classification'] in ('UNCLASSIFIED', 'SUBSTITUTED') and row['path'] not in paths]
    counts = selected['counts']
    measured = Counter(row['classification'] for row in rows)
    if (set(counts) != {'FULL_FILE_SELECTED', 'EXPLICITLY_EXCLUDED', 'UNCLASSIFIED', 'SUBSTITUTED'} or
            any(type(counts[key]) is not int or counts[key] != measured[key] for key in counts)):
        raise ValueError('COMPLETE_ACCOUNTING_COUNT_MISMATCH')
    if any(row['classification'] not in ('FULL_FILE_SELECTED', 'EXPLICITLY_EXCLUDED', 'UNCLASSIFIED', 'SUBSTITUTED')
           for row in rows):
        raise ValueError('COMPLETE_ACCOUNTING_UNKNOWN_DISPOSITION')
    return {'schemaVersion': 1, 'scope': 'CANONICAL_SOURCE_ACCOUNTING_NOT_DATABASE_ACCEPTANCE',
            'status': 'CANONICAL_SOURCES_ACCOUNTED' if not unresolved else 'UNRESOLVED_SOURCE_EFFECTS',
            'totalMigrations': len(rows), 'baseSelectorCounts': counts,
            'canonicalCounts': {'wholeFileSelector': counts['FULL_FILE_SELECTED'],
                                'reviewedResidualSources': len(paths),
                                'explicitlyExcluded': counts['EXPLICITLY_EXCLUDED'],
                                'unresolved': len(unresolved)},
            'selector': selected['selector'], 'selectedInputCounts': selected['selectedInputCounts'],
            'residualSourceContract': residual,
            'unresolved': sorted(unresolved), 'canonicalSourceDispositionsComplete': not unresolved,
            'sqlExecutionVerified': False, 'completeReplayVerified': False,
            'ledgerProvenanceVerified': False, 'generatedTypesVerified': False, 'errors': []}


def account(root=ROOT):
    root = Path(root)
    selected = load('gridex-replay-input-accounting.py').account(root)
    residual = load('canonical-residual-source-admission.py').verify(root)
    # Preserve the original residual overlap/count checks on the actual report.
    report = combine(selected, residual)
    forward = load('canonical_forward_sources.py')
    historical, additional = forward.partition_inventory([
        (row['path'], row['sha256']) for row in selected['migrations']])
    # Accounting omits some interleaved bootstrap rows. Re-execute the same
    # pinned selector through load_inputs rather than guessing missing ordinals.
    foundation = json.loads((root/'scripts/gridex-aud-003-foundation-order.json').read_text())['foundation']
    timestamps, _ = load('canonical-timestamp-frontier.py').load_inputs(root, selected, foundation)
    forward.partition_timestamps(timestamps + list(additional))
    by_path = {row['path']: row for row in selected['migrations']}
    for ordinal, (path, digest) in enumerate(additional, 515):
        row = by_path[path]
        if (row['classification'] != 'FULL_FILE_SELECTED'
                or row['execution'] != [{'stage': 'timestamp', 'ordinal': ordinal}]
                or row.get('derivedArtifacts')):
            raise ValueError('FORWARD_TIMESTAMP_PARTITION_REQUIRED')
    historical_paths = {path for path, digest in historical}
    historical_selected = dict(selected,
        migrations=[row for row in selected['migrations'] if row['path'] in historical_paths],
        totalMigrations=len(historical),
        counts=dict(selected['counts'], FULL_FILE_SELECTED=selected['counts']['FULL_FILE_SELECTED'] - len(additional)),
        selectedInputCounts=dict(selected['selectedInputCounts'], timestamp=len(timestamps)))
    historical_report = combine(historical_selected, residual)
    proof = {'sqlExecutionVerified': False, 'completeReplayVerified': False,
             'ledgerProvenanceVerified': False, 'generatedTypesVerified': False}
    report.update(
        historicalAccounting=historical_report,
        rawSelectedInputCounts=dict(selected['selectedInputCounts']),
        additionalForwardSourceCount=len(additional),
        additionalForwardSources=[dict(source=path, sourceSha256=digest,
            disposition='ADDITIONAL_FORWARD_SOURCE', **proof) for path, digest in additional],
        canonicalCounts=dict(historical_report['canonicalCounts'], additionalForwardSources=len(additional)))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--require-canonical-sources', action='store_true',
                        help='require complete canonical source dispositions; never proves SQL execution')
    args = parser.parse_args()
    try:
        report = account(args.root)
        code = int(args.require_canonical_sources and not report['canonicalSourceDispositionsComplete'])
    except (ValueError, KeyError, TypeError, OSError) as error:
        report = {'status': 'INVALID_CANONICAL_SOURCE_ACCOUNTING', 'errors': [str(error)],
                  'canonicalSourceDispositionsComplete': False, 'sqlExecutionVerified': False,
                  'completeReplayVerified': False, 'ledgerProvenanceVerified': False,
                  'generatedTypesVerified': False}
        code = 2
    print(json.dumps(report, indent=2, sort_keys=True))
    return code


if __name__ == '__main__':
    raise SystemExit(main())
