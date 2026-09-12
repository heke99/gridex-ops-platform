#!/usr/bin/env python3
"""Focused regression for import-table presence comparison SQL emission."""
import importlib.util
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / 'scripts' / 'canonical-import-admission-selftest.py'


def load_checker():
    spec = importlib.util.spec_from_file_location('canonical_import_admission', MODULE_PATH)
    checker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(checker)
    return checker


checker = load_checker()
batch = checker.exists(checker.BATCH)
row = checker.exists(checker.ROW)
comparison = f'({batch}) <> ({row})'
emitted = checker.shape_sql()

assert f'if {comparison} then' in emitted, 'presence predicates must be grouped before boolean comparison'
assert f'if {batch} <> {row} then' not in emitted, 'ambiguous PostgreSQL operator precedence returned'

# Evaluate the emitted comparison after replacing only its two catalog predicates.
# These are the empty, incomplete-left, incomplete-right, and complete truth cases.
for batch_present, row_present, expected in (
    (False, False, False),
    (True, False, True),
    (False, True, True),
    (True, True, False),
):
    concrete = comparison.replace(batch, str(batch_present)).replace(row, str(row_present))
    match = re.fullmatch(r'\((True|False)\) <> \((True|False)\)', concrete)
    assert match, concrete
    actual = (match.group(1) == 'True') != (match.group(2) == 'True')
    assert actual is expected, (batch_present, row_present, actual)


def fixture_columns(sql):
    """Return columns supplied for reduced fixture tables by CREATE/ALTER."""
    result = {}
    for table, definitions in re.findall(r'create table (\w+)\((.*?)\);', sql, re.S):
        result.setdefault(table, set()).update(
            part.strip().split()[0]
            for part in definitions.split(',')
            if part.strip() and not part.strip().startswith('constraint ')
        )
    for table, column in re.findall(
        r'alter table (\w+) add column if not exists (\w+)', sql
    ):
        result.setdefault(table, set()).add(column)
    return result


# Each synthetic ownership case may create a parent that is itself the child in
# another checked join. It must supply those prerequisite FKs so the case emits
# only its hand-specified would-change category.
required_join_columns = {}
for joins in checker.JOINS.values():
    for child, foreign_key, _parent in joins:
        required_join_columns.setdefault(child, set()).add(foreign_key)

for name, (setup, _expected) in checker.dirty_cases().items():
    if not name.startswith('would_change_'):
        continue
    supplied = fixture_columns(setup)
    for table in supplied.keys() & required_join_columns.keys():
        missing = required_join_columns[table] - supplied[table]
        assert not missing, f'{name} lacks checker prerequisite {table}.{sorted(missing)}'

print('PASS: grouped presence comparison truth cases and all reduced ownership fixture join prerequisites')
