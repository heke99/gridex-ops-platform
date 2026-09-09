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

print('PASS: emitted import-table presence comparison is grouped; all four missing/present truth cases match XOR')
