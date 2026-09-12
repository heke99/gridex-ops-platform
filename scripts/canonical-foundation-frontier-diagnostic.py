#!/usr/bin/env python3
"""Inspect the selected foundation after the accepted77 prefix, never certify it.

Runs only on a new network-disabled OwnedPostgres target, through the existing
source-pinned controller and independent prefix references. It deliberately
produces no schema/types/ledger/replay-acceptance artifact. The full-effects and
normal clean-replay gates are unchanged and continue to reject missing effects.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import signal
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SCHEMA = 1


def load_controller():
    path = ROOT / 'scripts/canonical-auth-provisioning-replay.py'
    spec = importlib.util.spec_from_file_location('foundation_frontier_loader', path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded.controller()


def verify_selection(controller):
    """The identical selector accounts every source before any target is made."""
    path = ROOT / 'scripts/gridex-replay-input-accounting.py'
    spec = importlib.util.spec_from_file_location('foundation_frontier_accounting', path)
    accounting = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(accounting)
    report = accounting.account(ROOT)
    order = json.loads((ROOT / 'scripts/gridex-aud-003-foundation-order.json').read_text())['foundation']
    digest = hashlib.sha256(json.dumps(order, separators=(',', ':')).encode()).hexdigest()
    if (len(order) != 118 or len(order) != len(set(order)) or
            digest != controller.FOUNDATION_SHA256 or
            report['selectedInputCounts']['foundation'] != len(order)):
        raise ValueError('FOUNDATION_SELECTION_CHANGED')
    return order, report


def safe_error_identifiers(raw):
    """Only schema identifiers and SQLSTATE, never SQL text/values/source rows."""
    text = raw.decode('utf-8', errors='replace')
    match = re.search(r'(?:ERROR|FATAL|PANIC):\s+([A-Z0-9]{5}):', text)
    state = match[1] if match else None
    names = []
    if match:
        # Inspect only the single error headline, not DETAIL/QUERY/CONTEXT.
        headline = text[match.end():].splitlines()[0]
        for kind, name in re.findall(
            r'\b(relation|column|function|type|constraint|operator|schema) "([a-z_][a-z0-9_.]{0,127})"',
            headline,
        ):
            names.append({'kind': kind, 'identifier': name})
    return {'sqlstate': state, 'schema_identifiers': names}


def safe_failure_category(controller, error):
    """Use only source-owned fixed labels; exception text is never serialized."""
    legacy = controller.load_batch()
    if (type(error) is legacy.BoundaryError and len(error.args) == 1
            and type(error.args[0]) is str and error.args[0] in (
                'FRESH_FIXED_PREPARATION_REQUIRED', 'UNEXPECTED_SQL_RESULT',
                'STAGED_SOURCE_REQUIRED', 'STAGED_ORDER_MISMATCH',
                'TRUSTED_ACCEPTED_WRITER_REQUIRED', 'SOURCE_HASH_MISMATCH',
            )):
        return error.args[0]
    return controller.load_dedupe()._failure_category(error)


def receipt(report, outcome, details=None):
    return {
        'schemaVersion': SCHEMA,
        'scope': 'SELECTED_FOUNDATION_DIAGNOSTIC_ONLY',
        'outcome': outcome,
        'sourceCounts': report['counts'],
        'foundationInputs': 118,
        'completeReplayVerified': False,
        'ledgerProvenanceVerified': False,
        'generatedTypesVerified': False,
        'productionModified': False,
        'details': details or {},
    }


def run():
    if len(sys.argv) != 1:
        raise ValueError('NO_TARGET_OR_SCOPE_ARGUMENTS_ACCEPTED')
    controller = load_controller()
    order, report = verify_selection(controller)
    legacy = controller.load_batch()

    def interrupted(_signum, _frame):
        raise legacy.BoundaryError('INTERRUPTED')

    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    before = controller.originals_snapshot()
    result = None
    phase = 'OWNED_TARGET'
    with legacy.OwnedPostgres() as target:
        try:
            phase = 'PRIVATE_INPUT_ADMISSION'
            with controller.load_private().AcceptedInputs(target):
                phase = 'INDEPENDENT_REFERENCES'
                controller.load_dedupe().prepare_reference(target, 'full')
                phase = 'FRESH_TARGET'
                controller.load_dedupe().fresh_target(target)
                phase = 'SOURCE_STAGING'
                hold = Path(target.directory.name) / 'frontier-hold'
                hold.mkdir(mode=0o700)
                for source in (ROOT / 'supabase/migrations').iterdir():
                    if source.is_symlink():
                        raise legacy.BoundaryError('SYMLINK_SOURCE_REJECTED')
                    if source.is_file() and source.suffix == '.sql':
                        shutil.copy2(source, hold / source.name)
                paths = [str(hold / Path(rel).name if rel.startswith('migrations/')
                             else ROOT / 'supabase' / rel) for rel in order]
                phase = 'FOUNDATION_ADMISSION'
                loop = controller.FoundationLoop(legacy, target, 'full')
                loop.validate(str(hold), paths)
                phase = 'PLATFORM_BOOTSTRAP'
                target.sql(controller.DATABASE,
                           (ROOT / 'scripts/sql/gridex-supabase-compatible-bootstrap.sql').read_text(),
                           'frontier_bootstrap', transaction=False)
                phase = 'SELECTED_FOUNDATION_EXECUTION'
                loop.run(str(hold), paths)
                result = receipt(report, 'SELECTED_FOUNDATION_EXECUTED_NOT_CERTIFIED')
        except Exception as error:
            last = Path(target.directory.name) / 'client-last.out'
            details = safe_error_identifiers(last.read_bytes()) if last.is_file() else {}
            details.update({'phase': phase, 'cause': safe_failure_category(controller, error)})
            result = receipt(report, 'BLOCKED', details)
        # Preserve the exact original source tree: there is no checkout staging,
        # restoration, source/manifest rewrite or schema baseline publication.
        if controller.originals_snapshot() != before:
            raise legacy.BoundaryError('SOURCE_PRESERVATION_FAILED')
    if target.active:
        raise legacy.BoundaryError('OWNED_CLEANUP_REQUIRED')
    print(json.dumps(result, sort_keys=True), flush=True)
    return 0 if result['outcome'] == 'SELECTED_FOUNDATION_EXECUTED_NOT_CERTIFIED' else 1


if __name__ == '__main__':
    try:
        raise SystemExit(run())
    except Exception:
        print(json.dumps({'scope': 'SELECTED_FOUNDATION_DIAGNOSTIC_ONLY', 'outcome': 'HARNESS_ERROR',
                          'completeReplayVerified': False}), flush=True)
        raise SystemExit(2) from None
