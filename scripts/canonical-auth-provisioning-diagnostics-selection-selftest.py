#!/usr/bin/env python3
"""Database-free provenance/constructor rejection tests; never claims SQL execution."""
import importlib.util
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def main():
    path = ROOT / 'scripts/canonical-auth-provisioning-diagnostics-selftest.py'
    assert path.is_file(), 'diagnostics whole-source fixture missing'
    spec = importlib.util.spec_from_file_location('diagnostics_fixture', path)
    fixture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixture)
    fixture.constructor_checks()
    print('PASS: diagnostics constructor/provenance/selection negative controls; SQL NOT EXECUTED')


if __name__ == '__main__':
    main()
