#!/usr/bin/env python3
"""Database-free provenance/constructor rejection tests; never claims SQL execution."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
G = 'migrations/20260528_auth_provisioning_runtime_guard.sql'
R = 'migrations/20260910121054_canonical_auth_provisioning_diagnostics_boundary.sql'


def main():
    path = ROOT / 'scripts/canonical-auth-provisioning-diagnostics-selftest.py'
    assert path.is_file(), 'diagnostics whole-source fixture missing'
    spec = importlib.util.spec_from_file_location('diagnostics_fixture', path)
    fixture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixture)
    order = json.loads((ROOT / 'scripts/gridex-aud-003-foundation-order.json').read_text())['foundation']
    assert len(order) == 97 and order[41:43] == [G, R], 'reviewed G42/R43 selection missing'
    class SyntheticFailure:
        returncode = 1

        def __init__(self):
            self.stdin = io.StringIO()

        def wait(self, timeout=None):
            return self.returncode

        def kill(self):
            return None

    forbidden = 'synthetic-forbidden-provider-secret'
    stage = 'ACTUAL_PREFIX41 complete files G/R repeat final selected helper'
    permitted = fixture.assertion_labels(
        "SELECT test_assert(false,'event RLS boundary');\n"
        "SELECT test_assert(false,'invoker boundary');\n")

    def finish_receipt(harness, serial, label, location):
        stem = Path(harness.directory) / str(serial)
        stem.with_suffix('.out').write_text('')
        other = 'invoker boundary' if label == 'event RLS boundary' else 'event RLS boundary'
        stderr = (f'ERROR:  P0001: FAIL: {label}\nDETAIL: {forbidden} {other}\n'
                  f'LOCATION: exec_stmt_raise, pl_exec.c:{location}\n')
        stem.with_suffix('.err').write_text(stderr)
        out = stem.with_suffix('.out').open('a')
        err = stem.with_suffix('.err').open('a')
        try:
            harness.finish((SyntheticFailure(), stem, out, err, stage, permitted))
        except AssertionError as failure:
            message = str(failure)
            assert message.startswith('unexpected SQL failure '), message
            assert forbidden not in message, 'provider-shaped payload escaped Harness.finish'
            return json.loads(message.removeprefix('unexpected SQL failure '))
        raise AssertionError('synthetic unexpected failure was accepted')

    with tempfile.TemporaryDirectory(prefix='gridex-diagnostics-receipt-') as directory:
        harness = fixture.Harness(directory)
        first = finish_receipt(harness, 1, 'event RLS boundary', 3905)
        second = finish_receipt(harness, 2, 'invoker boundary', 3911)
    assert first == {
        'stage': stage,
        'sqlstate': 'P0001',
        'assertion': 'event RLS boundary',
        'location': 3905,
    }
    assert second == {
        'stage': stage,
        'sqlstate': 'P0001',
        'assertion': 'invoker boundary',
        'location': 3911,
    }
    assert first != second, 'same-state failures lost their actionable identity'
    assert forbidden not in json.dumps((first, second)), 'provider-shaped payload escaped sanitization'
    fixture.constructor_checks()
    print('PASS: diagnostics constructor/provenance/selection negative controls; SQL NOT EXECUTED')


if __name__ == '__main__':
    main()
