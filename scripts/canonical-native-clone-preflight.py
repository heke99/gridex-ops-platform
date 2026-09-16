#!/usr/bin/env python3
"""Qualify same-container clones on the synthetic native lifecycle, no history."""
import importlib.util
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]


def qualify(command, sql, project):
    import json
    from canonical_native_timestamp_proof import NativeTimestampTarget
    from canonical_native_historical_prefix import LEDGER_SQL
    target = NativeTimestampTarget(command, project)
    clone = 'gridex_native_timestamp_phase'
    ledger = sql(LEDGER_SQL)
    try:
        target.clone('postgres', clone)
        if json.loads(target.sql(clone, LEDGER_SQL, 'clone_preflight_ledger')) != ledger:
            raise ValueError('NATIVE_TIMESTAMP_CLONE_PREFLIGHT_REQUIRED')
        if target.sql(clone, 'SELECT to_json(count(*)=1 AND min(id)=1) FROM public.gridex_native_lifecycle_probe;',
                      'clone_preflight_rows').strip() != 'true':
            raise ValueError('NATIVE_TIMESTAMP_CLONE_PREFLIGHT_REQUIRED')
        target.drop_clone(clone)
        if target._oid(clone) is not None or sql(LEDGER_SQL) != ledger:
            raise ValueError('NATIVE_TIMESTAMP_CLONE_PREFLIGHT_REQUIRED')
    finally:
        target.close()
    return dict(scope='SYNTHETIC_NATIVE_CLONE_NOT_HISTORICAL_REPLAY',
                clonedLedgerEqual=True, clonedProbeRowsVerified=True,
                cloneDisposed=True, parentLedgerPreserved=True,
                completeReplayVerified=False, generatedTypesVerified=False)


def main():
    path = ROOT/'scripts/canonical-native-supabase-lifecycle.py'
    spec = importlib.util.spec_from_file_location('native_clone_preflight', path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module.run_guarded(clone_preflight=True)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print('FAIL native clone preflight; no raw diagnostic disclosure',file=sys.stderr)
        raise SystemExit(1) from None
