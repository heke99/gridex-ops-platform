#!/usr/bin/env python3
"""Read-only derived inventory check; no runtime or conformance certification."""
import collections
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
SPEC = ROOT / 'docs/ediel/masterplan-v2'
AUDIT = Path(__file__).with_suffix('.json')

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

inventory = read(AUDIT)
cells = read(SPEC / 'registers/prodat_conditional_cells.json')
fields = {row['field']: row for row in read(SPEC / 'registers/prodat_fields.json')}
parents = read(SPEC / 'registers/prodat_parent_groups.json')
accepted_map = {
    'Z06': [508,217,306,254,242,227,228,231,232,316],
    'Z09': [216,217,227,228,231,232,316], 'Z04': [319],
    'Z14': [209,302,508,326,217,222,506,513,260,325,227,228],
    'Z01': [233,234], 'Z03': [233,234], 'Z08': [233,234],
}
accepted = {f'PC-{field}-{code}' for code, values in accepted_map.items() for field in values}
original = {cell['id']: cell for cell in cells}
remaining = inventory['remaining_cells']
remaining_ids = [cell['id'] for cell in remaining]
assert len(cells) == len(original) == 110
assert len(accepted) == 36 and set(inventory['accepted_numeric_ids']) == accepted
assert len(inventory['accepted_numeric_ids']) == 36
assert len(remaining_ids) == len(set(remaining_ids)) == 74
assert accepted.isdisjoint(remaining_ids)
assert accepted | set(remaining_ids) == set(original)
assert {(x['field'], x['message']) for x in cells} == {
    (f, m) for f, row in fields.items() for m, usage in row['usage'].items() if usage == 'D'
}
for row in remaining:
    source = original[row['id']]
    assert row['field'] == source['field'] and row['message'] == source['message']
    assert row['frozen_condition'] == {key: source[key] for key in row['frozen_condition']}
    assert set(row['frozen_condition']) == {'when','when_true','when_false','unknown','parent_rule','note','source'}
    assert row['acceptance'] == 'UNACCEPTED'
    field = fields[row['field']]
    assert row['scope'] == field['scope'] and row['parent_group'] == field['parent_group']
    assert row['partition'] == ('parent_dependent' if field['parent_group'] else 'other_context')
    assert row['field'] in inventory['groups'][row['dependency_group']]['fields']
assert collections.Counter(row['partition'] for row in remaining) == {'parent_dependent':44, 'other_context':30}
assert collections.Counter(row['dependency_group'] for row in remaining) == {
    'register_inventory':3, 'register_readings':9, 'pre_supply_change':2,
    'production_event':2, 'reporting_term':2, 'permission_customer':2,
    'meter_replacement':2, 'death_event':3, 'gas_boundary':5,
    'end_user_address':8, 'invoicee_children':30, 'invoicee_address':6,
}
assert inventory['remaining_field_sources'] == {f:fields[f] for f in {r['field'] for r in remaining}}
assert inventory['parent_sources'] == parents
assert inventory['parent_conditions'] == read(SPEC / 'registers/prodat_group_conditions.json')
expected_parents = {f"PG-{p['group_id']}-{m}" for p in parents for m,u in p['usage'].items() if u == 'D'}
actual_parents = inventory['parent_occurrences']
assert len(actual_parents) == len(expected_parents) == 10
assert {r['id'] for r in actual_parents} == expected_parents
assert {r['id'] for r in actual_parents if r['acceptance'] == 'ACCEPTED_PRIOR'} == {
    'PG-UD-Z06','PG-UD-Z09','PG-UD-Z14','PG-IT-Z14'
}
assert {r['id'] for r in actual_parents if r['acceptance'] == 'UNACCEPTED'} == {
    f'PG-IV-{m}' for m in ['Z03','Z04','Z05','Z06','Z08','Z09']
}
assert inventory['counts'] == {
    'numeric_total':110,'accepted_prior':36,'remaining':74,
    'remaining_parent_dependent':44,'remaining_other_context':30,
    'parent_occurrences':10,'parent_accepted_prior':4,'parent_remaining':6,'new_acceptance':0,
}
assert set(inventory['prior_blocked_ids']) == {'PC-321-Z13','PC-321-Z14','PC-323-Z13','PC-323-Z14'}
assert set(inventory['prior_blocked_ids']) <= set(remaining_ids)
assert set(inventory['next_unit']['ids']) == {'PC-258-Z04','PC-258-Z06','PC-258-Z10'}
assert inventory['next_unit']['acceptance_after_this_task'] == 0
assert inventory['runtime_defects_confirmed_this_task'] == []
assert inventory['original_document_manifest'] == read(SPEC / 'registers/source_manifest.json')
for path, digest in inventory['source_sha256'].items():
    assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest() == digest, path
changed = subprocess.check_output([
    'git','diff','--name-only',inventory['accepted_base'],'--','docs/ediel/masterplan-v2'
], cwd=ROOT, text=True)
assert not changed, changed
print(json.dumps({
    'result':'PASS','numeric':'110 = 36 accepted + 74 remaining',
    'remaining':'44 parent-dependent + 30 other-context',
    'parents':'10 = 4 accepted + 6 remaining','new_acceptance':0,
    'source_hashes':len(inventory['source_sha256']),
    'normative_unchanged_against':inventory['accepted_base'],
    'runtime_or_conformance_tested':False,
}, indent=2))
