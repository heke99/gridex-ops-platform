#!/usr/bin/env python3
"""Additive code-phase inventory. Never mutates the frozen spec or formal ledger."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import subprocess

BASE = Path(__file__).resolve().parent
SPEC = Path('docs/ediel/masterplan-v2')
AUDIT = Path('quality/audits/ediel-masterplan-v2')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def package(ids):
    prefixes = {i.removeprefix('AT-').split('-')[0] for i in ids}
    if prefixes & {'TEN', 'IMP', 'DB'}:
        return 'actors_routing_grants_persistence'
    if prefixes & {'U', 'ACK'}:
        return 'utilts_validation_dispositions_ack'
    if prefixes & {'P'}:
        return 'prodat_fields_functions_consumers'
    if prefixes & {'ESCO', 'TR'}:
        return 'processes_expectations_retry_transport'
    if prefixes & {'GOV', 'ENV'}:
        return 'authority_versions_grammar_envelope'
    return 'api_ui_manual_readiness'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo-root', type=Path, default=BASE.parents[3])
    parser.add_argument('--output-dir', type=Path, default=BASE)
    args = parser.parse_args()
    root = args.repo_root.resolve()
    rules = json.loads((root / SPEC / 'registers/rules.json').read_text())
    contracts = json.loads((root / SPEC / 'registers/acceptance_tests.json').read_text())
    inherited_path = AUDIT / 'masterplan-v2-reconciliation-20260930.json'
    inherited = json.loads((root / inherited_path).read_text())
    previous = {row['id']: row for row in inherited['assessments']}
    calls = json.loads((root / SPEC / 'registers/callsite_contracts.json').read_text())
    overlays = []
    for path in sorted(BASE.glob('assessment-*.json')):
        data = json.loads(path.read_text())
        overlays.extend(data if isinstance(data, list) else [data])
    by_id = {}
    by_call = {}
    owner_rules = {}
    for assessment in overlays:
        owner = assessment['owner'].split(';')[0].removeprefix('/root/')
        owner_rules.setdefault(owner, set()).update(i for i in assessment['ids'] if not i.startswith(('AT-', 'SC-')))
        for own_id in assessment['ids']:
            if own_id not in previous:
                if own_id in {c['id'] for c in calls}:
                    by_call.setdefault(own_id, []).append(assessment)
                    continue
                raise ValueError(f'Unknown assessment ID: {own_id}')
            by_id.setdefault(own_id, []).append(assessment)
    head = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    git_state = subprocess.check_output(['git', '-C', str(root), 'status', '--porcelain=v1'], text=True)
    git_diff = subprocess.check_output(['git', '-C', str(root), 'diff', 'HEAD', '--binary'])
    rows = []
    for kind, registry, records in [('rule_card', 'rules.json', rules), ('acceptance_contract', 'acceptance_tests.json', contracts)]:
        for number, literal in enumerate(records):
            own_id = literal['id']; old = previous[own_id]
            linked = [own_id] if kind == 'rule_card' else literal['rule_ids']
            assessments = by_id.get(own_id, [])
            # Implementation assessment never implies that an acceptance's full
            # expected/prohibited oracle was executed or formally passed.
            # No later optimistic component may erase a different owner's
            # remaining consumer gap. Each literal multi-owner contract retains
            # its own reviewed normative parts; a rule link alone is no review.
            priority = {'REMAINING_CODE_WORK': 6, 'COORDINATION_BLOCKED': 5,
                'SEMANTIC_REVIEW_PENDING': 4, 'EXTERNAL_EVIDENCE_OR_DECISION_BLOCKED': 3,
                'CODE_READY_NOT_VERIFIED': 2, 'ALREADY_IMPLEMENTED_VERIFICATION_ONLY': 1}
            covered_rules = set()
            for a in assessments:
                owner = a['owner'].split(';')[0].removeprefix('/root/')
                covered_rules.update(a.get('covered_rule_ids', owner_rules.get(owner, set()) & set(linked)))
            unreviewed_parts = sorted(set(linked) - covered_rules)
            # The compact AT-Z links omit their actual business/grant clauses.
            # Require fresh literal consumer assessments rather than pretending
            # field/role/header coverage proves a whole command lifecycle.
            required_consumers = ['processes'] if own_id.startswith('AT-Z') else []
            if own_id.startswith('AT-Z') and own_id.endswith('-ESCO'):
                required_consumers.append('actors_history')
            assessed_owners = [a['owner'].removeprefix('/root/') for a in assessments]
            missing_consumers = [owner for owner in required_consumers if not any(a.startswith(owner) for a in assessed_owners)]
            status = max((a['code_status'] for a in assessments), key=lambda s: priority[s]) if assessments else 'SEMANTIC_REVIEW_PENDING'
            if (unreviewed_parts or missing_consumers) and priority[status] < priority['SEMANTIC_REVIEW_PENDING']:
                status = 'SEMANTIC_REVIEW_PENDING'
            paths = sorted({p for a in assessments for p in a.get('code_paths', [])})
            paths_state = [{'path': p, 'exists': (root / p).is_file(), 'sha256': digest(root / p) if (root / p).is_file() else None} for p in paths]
            rows.append({
                'id': own_id, 'kind': kind,
                'normative_requirement': {'registry': str(SPEC / 'registers' / registry), 'json_pointer': f'/{number}',
                    'registry_sha256': digest(root / SPEC / 'registers' / registry), 'literal_frozen_record': literal,
                    'source_references': literal.get('source') or [r['source'] for r in rules if r['id'] in linked],
                    'amendments': [str(p.relative_to(root)) for p in sorted((root / SPEC).glob('amendment-*.md'))]},
                'actual_implementation': {'referenced_paths': paths_state, 'callsite_contracts': [c for c in calls if set(c['rule_ids']) & set(linked)],
                    'fresh_assessments': assessments,
                    'inherited_implementation_lead': {'as_of': '2026-09-27', 'verdict': old.get('inherited_code_verdict_20260927'),
                        'description': old.get('inherited_assessment_20260927'), 'gap': old.get('inherited_gap_20260927'),
                        'referenced_paths_not_current_authority': old.get('code_paths', []),
                        'status': 'INHERITED_NOT_FRESHLY_REVIEWED' if not assessments else 'INHERITED_LEAD_RECHECKED_ONLY_TO_EXPLICIT_FRESH_SCOPE'},
                    'previous_bounded_semantic_review': old.get('fresh_semantic_review')},
                'confirmed_code_gaps': [a['confirmed_code_gap'] for a in assessments if a.get('confirmed_code_gap')],
                'remaining_code_gaps': [a['confirmed_code_gap'] for a in assessments if a.get('confirmed_code_gap') and a['code_status'] in ('REMAINING_CODE_WORK','COORDINATION_BLOCKED')],
                'resolved_or_reviewed_implementation_findings': [a['confirmed_code_gap'] for a in assessments if a.get('confirmed_code_gap') and a['code_status'] in ('CODE_READY_NOT_VERIFIED','ALREADY_IMPLEMENTED_VERIFICATION_ONLY')],
                'verification_gap': {'formal_status_unchanged': old['formal_status'],
                    'existing_own_evidence': old.get('formal_evidence_paths', []),
                    'remaining': old['remaining_gap'].get('formal'),
                    'broad_final_tests': 'NOT_RUN_IN_THIS_CODE_PHASE; exact immutable candidate SHA required'},
                'code_package': package(linked), 'integration_owner': '/root',
                'dependencies': sorted({c['id'] for c in calls if set(c['rule_ids']) & set(linked)}),
                'code_status': status,
                'fresh_normative_component_coverage': {'reviewed_rule_components': sorted(covered_rules),
                    'unreviewed_rule_components': unreviewed_parts,
                    'required_actual_consumer_owners': required_consumers,
                    'missing_actual_consumer_assessments': missing_consumers,
                    'meaning': 'Explicit literal-contract owner assessments required; linked-rule existence never implies whole contract coverage.'},
                'semantic_review_scope': 'Only explicit fresh assessment scope is current; referenced-file existence/hash is not semantic conformance',
                'blockers': [b for a in assessments for b in a.get('blockers', [])],
                'planned_own_final_proof': {'expected': literal.get('expected', literal.get('on_pass')),
                    'prohibited': literal.get('prohibited', literal.get('on_failure')),
                    'trigger': literal.get('when', literal.get('trigger')),
                    'source_context': literal.get('given', literal.get('condition')),
                    'criterion_gate': old['approval_gate'],
                    'tests': sorted(set(old.get('test_paths', []) + [p for a in assessments for p in a.get('planned_tests', [])]))},
            })
    expected = {r['id'] for r in rules + contracts}
    if len(rules) != 121 or len(contracts) != 231 or len(rows) != 352 or {r['id'] for r in rows} != expected:
        raise ValueError('Frozen 121/231 exact-ID coverage changed')
    catalog = {}
    for p in sorted((root / SPEC / 'registers').glob('*.json')):
        data = json.loads(p.read_text())
        catalog[str(p.relative_to(root))] = {'sha256': digest(p), 'row_count': len(data), 'records': data}
    result = {'title': 'Ediel v2 additive code-phase work matrix', 'inventory_head': head, 'integration_owner': '/root',
        'inventory_worktree': str(root),
        'inventory_git': {'head': head, 'working_tree_status': git_state.splitlines(),
            'uncommitted_diff_sha256': hashlib.sha256(git_diff).hexdigest(),
            'is_fixed_candidate': False,
            'meaning': 'Current named HEAD plus explicit working-tree state/path hashes; code-phase inventory is not a fixed, verified test candidate.'}, 'inherited_reconciliation': {'path': str(inherited_path), 'sha256': digest(root / inherited_path), 'review_head': inherited['review_head']},
        'status_meaning': {'CODE_READY_NOT_VERIFIED': 'Fresh scoped code implementation integrated; own final tests still pending.',
            'ALREADY_IMPLEMENTED_VERIFICATION_ONLY': 'Fresh source/code review found own scoped requirement implemented; not formal approval.',
            'REMAINING_CODE_WORK': 'A fresh confirmed implementation gap remains.',
            'EXTERNAL_EVIDENCE_OR_DECISION_BLOCKED': 'Independent support may exist; activation held pending authentic stated evidence.',
            'COORDINATION_BLOCKED': 'Concrete implementation awaits allocated contract/file owner.',
            'SEMANTIC_REVIEW_PENDING': 'Dated lead retained; neither current defect nor current code completeness is asserted.'},
        'source_file_hashes': {str(p.relative_to(root)): digest(p) for p in sorted((root / SPEC).rglob('*')) if p.is_file()},
        'counts': {'rule_cards': len(rules), 'acceptance_contracts': len(contracts), 'exact_ids': len(rows),
            'code_statuses': dict(Counter(r['code_status'] for r in rows))},
        'frozen_related_catalogs': catalog, 'rows': rows, 'fresh_callsite_assessments': by_call,
        'formal_acceptance': 'No frozen requirement or formal acceptance status changed by this matrix',
        'final_candidate_status': 'NOT_ESTABLISHED_BY_MATRIX_GENERATION',
        'test_phase': {'run_status': 'NOT_RUN', 'criteria': [
            'Full unit suite: own guide/syntax/function/ACK criteria, independent source oracles and changed-consumer regressions.',
            'Native: persisted accepted/held/rejected data, per-IDE outcomes, exact final ACK binding, rollback, retry and concurrency with real tenant roles.',
            'Clean migration replay: every forward migration applies in order; no frozen applied migration replacement.',
            'Authentic type/schema parity: generated from replay database at exact candidate; checksums/manifest record actual provenance.',
            'Security: RLS, explicit tenant/legal/transport roles, per-beneficiary scopes, revoked grant and no unauthorized side effects.',
            'Browser/E2E: manual/API/job/retry/adapter real consumers and accurate transport/ACK/business/readiness projections.',
            'Later manual: authorized synthetic fixture/operator workflows; production/counterparty/market activation excluded.']}}
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / 'work-matrix.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    lines = ['# Ediel v2 code-phase work matrix', '', f'Inventory code head: `{head}`. Root is integration owner.', '',
        '352 exact frozen IDs are retained. Literal normative records, CALL/data/timer/state/field catalogs, inherited assessment provenance and individual final expected/prohibited criteria are in `work-matrix.json`.', '',
        'Code status is separate from formal evidence. Unreviewed inherited rows remain SEMANTIC_REVIEW_PENDING; file existence, test counts and this generator cannot establish whole-plan code completeness.', '',
        '| ID | Code package | Code status | Fresh assessment owners |', '| --- | --- | --- | --- |']
    for r in rows:
        owners = ', '.join(sorted({a['owner'] for a in r['actual_implementation']['fresh_assessments']})) or 'Inherited lead; fresh review pending'
        lines.append(f"| {r['id']} | {r['code_package']} | {r['code_status']} | {owners} |")
    (args.output_dir / 'work-matrix.md').write_text('\n'.join(lines) + '\n')
    print(json.dumps(result['counts'], ensure_ascii=False))


if __name__ == '__main__':
    main()
