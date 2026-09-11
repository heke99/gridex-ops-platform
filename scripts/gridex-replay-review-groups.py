#!/usr/bin/env python3
"""Conservative lexical review hints over validated replay input accounting.

No SQL parser or effect analysis: comments and string literals can produce false
positives; unqualified, constructed and other references can be missed. Domains
and adjacency never grant replay approval or prove read/write dependencies.
Exit 1 means globally unresolved inputs, even with --group; exit 2 means invalid
accounting or unreadable inputs. JSON stdout only; no SQL execution.
"""
import argparse
from collections import defaultdict
import copy
import importlib.util
import json
from pathlib import Path
import re
import subprocess

_SPEC = importlib.util.spec_from_file_location(
    'gridex_replay_input_accounting',
    Path(__file__).with_name('gridex-replay-input-accounting.py'))
_ACCOUNTING = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_ACCOUNTING)
account = _ACCOUNTING.account

DOMAIN_WORDS = {
    'auth_membership_tenant': r'auth|membership|tenant|company|user_profile|invite|invitation|password|role|permission|canonical_user_rbac_repair_boundary|canonical_user_rbac_fixed_target_',
    'ediel': r'ediel|elhub|meter|grid_owner',
    'billing': r'billing|invoice|payment|tariff|pricing|settlement',
    'customer_lifecycle': r'customer|application|contract|onboarding|poa|power_of_attorney|request|profile',
    'integrations': r'integration|webhook|partner|api|email|provider|external',
}
DOMAINS = (*DOMAIN_WORDS, 'manual_review')
UNRESOLVED = ('SUBSTITUTED', 'UNCLASSIFIED')
OBJECT = re.compile(r'(?<![\w$])("?public"?|"?auth"?)\s*\.\s*("(?:[^"]|"")+"|[a-zA-Z_][\w$]*)', re.I)
HINTS = {
    'ddl': r'\b(?:CREATE|ALTER|DROP|TRUNCATE|COMMENT|GRANT|REVOKE)\b',
    'dml': r'\b(?:INSERT|UPDATE|DELETE|MERGE)\b',
    'policy': r'\bPOLICY\b|\bROW\s+LEVEL\s+SECURITY\b',
    'function': r'\bFUNCTION\b|\bPROCEDURE\b',
    'trigger': r'\bTRIGGER\b',
    'dynamicSql': r'\bEXECUTE\b(?!\s+(?:FUNCTION|PROCEDURE)\b)|\bFORMAT\s*\(|\bquote_ident\s*\(',
}


def domains(text):
    # Underscores separate filename/object tokens; allow simple plural forms.
    # Incidental substrings (for example api in capital) are not domain hints.
    return {domain for domain, pattern in DOMAIN_WORDS.items()
            if re.search(r'(?<![a-z0-9])(?:' + pattern + r')(?:s)?(?![a-z0-9])',
                         text, re.I)}


def qualified_objects(sql):
    def identifier(value):
        return value if value.startswith('"') else value.lower()
    return sorted({'.'.join(identifier(part) for part in match.groups())
                   for match in OBJECT.finditer(sql)})


def group_report(accounting, read_sql, focus=None):
    """Annotate the validated account(root) report without changing its evidence."""
    if focus is not None and focus not in DOMAINS:
        raise ValueError(f'unknown review group: {focus}')
    if accounting['errors'] or accounting['status'] == 'INVALID_INPUT_CONTRACT':
        raise ValueError('accounting failed validation: ' + '; '.join(accounting['errors']))
    rows = []
    by_object = defaultdict(list)
    for original in accounting['migrations']:
        row = copy.deepcopy(original)
        sql = read_sql(row['path'])
        filename_domains = domains(Path(row['path']).stem)
        objects = qualified_objects(sql)
        proposed = set(filename_domains)
        for name in objects:
            proposed.update(domains(name))
            if name.startswith(('auth.', '"auth".')):
                proposed.add('auth_membership_tenant')
        hints = {key: bool(re.search(pattern, sql, re.I)) for key, pattern in HINTS.items()}
        if not filename_domains or hints['dynamicSql'] or row['classification'] in UNRESOLVED:
            proposed.add('manual_review')
        row.update(filenameDomains=sorted(filename_domains), reviewDomains=sorted(proposed),
                   lexicalHints=hints, qualifiedObjectHints=objects,
                   provenReadWriteDependencies=False, replayApprovalGranted=False,
                   effectsVerified=False)
        rows.append(row)
        for name in objects:
            by_object[name].append(row)
    for row in rows:
        row['sharedObjectCandidates'] = [
            {'object': name,
             'reviewDomains': sorted(domains(name) | {
                 domain for other in by_object[name] for domain in other['reviewDomains']}),
             'inputPaths': sorted(other['path'] for other in by_object[name])}
            for name in row['qualifiedObjectHints']]
    priority = {'UNCLASSIFIED': 0, 'SUBSTITUTED': 1}
    rows.sort(key=lambda row: (priority.get(row['classification'], 2), row['path']))
    counts = accounting['counts']
    unresolved = {key: counts[key] for key in UNRESOLVED}
    unresolved['total'] = sum(unresolved.values())
    visible = [row for row in rows if focus is None or focus in row['reviewDomains']]
    return {
        'schemaVersion': 1, 'status': accounting['status'],
        'evidenceScope': 'LEXICAL_REVIEW_HINTS_ONLY',
        'limitations': __doc__.strip(), 'focusGroup': focus,
        'provenReadWriteDependencies': False, 'replayApprovalGranted': False,
        'effectsVerified': False,
        'accountingProvenance': {key: copy.deepcopy(value) for key, value in accounting.items()
                                 if key != 'migrations'},
        'global': {'totalMigrations': accounting['totalMigrations'],
                   'classificationCounts': copy.deepcopy(counts), 'unresolvedCounts': unresolved},
        'groups': {domain: [row['path'] for row in rows if domain in row['reviewDomains']]
                   for domain in DOMAINS if focus is None or domain == focus},
        'inputs': visible, 'errors': [],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--group', choices=DOMAINS)
    args = parser.parse_args()
    try:
        root = args.root.resolve()
        accounting = account(root)
        report = group_report(accounting,
                              lambda path: _ACCOUNTING.relative_input(root / 'supabase', path).read_text(),
                              args.group)
        code = int(report['global']['unresolvedCounts']['total'] > 0)
    except (ValueError, OSError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        report = {'schemaVersion': 1, 'status': 'INVALID_INPUT_CONTRACT',
                  'evidenceScope': 'LEXICAL_REVIEW_HINTS_ONLY', 'errors': [str(error)]}
        code = 2
    print(json.dumps(report, indent=2, sort_keys=True))
    return code


if __name__ == '__main__':
    raise SystemExit(main())
