#!/usr/bin/env python3
"""Characterize the 37 unresolved sources on owned checkpoint clones only.

A successful SQL file is NOT source-effect acceptance. Failed probes discard
only their clone and do not change the selected replay, manifests, or ledger.
No external URL, target, arbitrary source, or acceptance flag is supported.
"""
from __future__ import annotations
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import shutil
import signal
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
RESIDUAL_PIN = 'f646322e447fedd33a17cbc373a13229f4e5ff736ec9015fd8fc129fa4987ede'
CLONE = 'gridex_auth_legacy_atomic'
CHECKPOINTS = ('foundation118', 'selected626')


def load(name):
    path = ROOT / 'scripts' / (name + '.py')
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def bound_sources(report):
    if report['errors'] or report['totalMigrations'] != 600:
        raise ValueError('RESIDUAL_INVENTORY_MISMATCH')
    sources = [(r['path'], r['sha256']) for r in report['migrations']
               if r['classification'] in ('UNCLASSIFIED', 'SUBSTITUTED')]
    encoded = json.dumps(sources, separators=(',', ':')).encode()
    if len(sources) != 37 or hashlib.sha256(encoded).hexdigest() != RESIDUAL_PIN:
        raise ValueError('RESIDUAL_SOURCE_SET_MISMATCH')
    return sources


def native_result(text, stage, success):
    """Parse only the existing SQL runner's fixed metadata, never SQL stdout."""
    receipts = []
    for line in text.splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            raise ValueError('RESIDUAL_RECEIPT_MISMATCH') from None
        if not isinstance(value, dict) or value.get('stage') != stage:
            raise ValueError('RESIDUAL_RECEIPT_MISMATCH')
        receipts.append(value)
    if len(receipts) != 1:
        raise ValueError('RESIDUAL_RECEIPT_MISMATCH')
    receipt = receipts[0]
    state, code = receipt.get('sqlstate'), receipt.get('exit_code')
    if (not isinstance(state, str) or not re.fullmatch(r'[A-Z0-9]{5}', state)
            or type(code) is not int or (code == 0) != success
            or (state == '00000') != success):
        raise ValueError('RESIDUAL_RECEIPT_MISMATCH')
    return {'sqlstate': state, 'exitCode': code}


def catalog_delta(before, after):
    groups = {'added': sorted(after.keys() - before.keys()),
              'removed': sorted(before.keys() - after.keys()),
              'changed': sorted(k for k in before.keys() & after.keys() if before[k] != after[k])}
    # Names are schema metadata, never definitions, rows, argument values or ACL
    # contents. Unexpected identifier shapes are not copied into public output.
    result = {}
    for kind, keys in groups.items():
        if any(not re.fullmatch(r'[a-z_]+/[A-Za-z0-9_ .,()\[\]/]*', k) for k in keys):
            raise ValueError('RESIDUAL_CATALOG_KEY_MISMATCH')
        result[kind] = {'count': len(keys), 'keys': keys}
    return result


def probe_sources(controller, timestamp, target, report, checkpoint):
    legacy = controller.load_batch()
    if (checkpoint not in CHECKPOINTS or type(target) is not legacy.OwnedPostgres
            or not target.active or target.name != target._created_name):
        raise ValueError('RESIDUAL_OWNED_CHECKPOINT_REQUIRED')
    target.command(controller.DATABASE)
    before = target.catalog(controller.DATABASE)
    results = []
    for ordinal, source in enumerate(bound_sources(report), 1):
        raw = timestamp.read_source(ROOT, source)  # Revalidate immediately before effects.
        target.docker(['exec', target.name, 'dropdb', '-U', 'postgres', '--if-exists', '--force', CLONE])
        target.docker(['exec', target.name, 'createdb', '-U', 'postgres', '-T', controller.DATABASE, CLONE])
        stage = 'residual_' + str(ordinal)
        capture, success = io.StringIO(), True
        try:
            with contextlib.redirect_stdout(capture):
                try:
                    target.sql(CLONE, raw, stage, transaction=False)
                except legacy.BoundaryError as error:
                    if error.args != ('UNEXPECTED_SQL_RESULT',):
                        raise
                    success = False
            row = {'source': source[0], 'sourceSha256': source[1],
                   'checkpoint': checkpoint, 'sqlSucceeded': success,
                   'sourceEffectsAccepted': False, **native_result(capture.getvalue(), stage, success)}
            if success:
                row['catalogDelta'] = catalog_delta(before, target.catalog(CLONE))
            results.append(row)
            print(json.dumps({'scope': 'RESIDUAL_SOURCE_PROBE', **row}, sort_keys=True), flush=True)
        finally:
            capture.close()
            target.docker(['exec', target.name, 'dropdb', '-U', 'postgres', '--if-exists', '--force', CLONE])
    if target.catalog(controller.DATABASE) != before:
        raise ValueError('RESIDUAL_PARENT_PRESERVATION_FAILED')
    return results


def run():
    if len(sys.argv) != 1:
        raise ValueError('RESIDUAL_NO_TARGET_ARGUMENTS_ALLOWED')
    frontier = load('canonical-foundation-frontier-diagnostic')
    controller, timestamp = frontier.load_controller(), frontier.load_timestamp()
    order, report = frontier.verify_selection(controller)
    selected, prerequisites = timestamp.load_inputs(ROOT, report, order)
    bound_sources(report)
    before_sources = controller.originals_snapshot()
    legacy = controller.load_batch()
    def interrupted(_signum, _frame):
        raise legacy.BoundaryError('INTERRUPTED')
    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    results, progress = [], {}
    with legacy.OwnedPostgres(postgis=True) as target:
        runtime = timestamp.verify_spatial_runtime(target)
        with controller.load_private().AcceptedInputs(target):
            controller.load_dedupe().prepare_reference(target, 'full')
            controller.load_dedupe().fresh_target(target)
            hold = Path(target.directory.name) / 'residual-hold'
            hold.mkdir(mode=0o700)
            for source in (ROOT / 'supabase/migrations').iterdir():
                if source.is_symlink():
                    raise ValueError('RESIDUAL_SOURCE_SYMLINK')
                if source.is_file() and source.suffix == '.sql':
                    shutil.copy2(source, hold / source.name)
            paths = [str(hold / Path(p).name if p.startswith('migrations/') else ROOT / 'supabase' / p) for p in order]
            loop = controller.FoundationLoop(legacy, target, 'full')
            loop.validate(str(hold), paths)
            target.sql(controller.DATABASE, (ROOT / 'scripts/sql/gridex-supabase-compatible-bootstrap.sql').read_text(),
                       'residual_bootstrap', transaction=False)
            loop.run(str(hold), paths)
            results += probe_sources(controller, timestamp, target, report, 'foundation118')
            timestamp.execute_tail(ROOT, target, controller.DATABASE, selected, prerequisites, progress)
            results += probe_sources(controller, timestamp, target, report, 'selected626')
        if controller.originals_snapshot() != before_sources:
            raise ValueError('RESIDUAL_SOURCE_PRESERVATION_FAILED')
    if target.active:
        raise ValueError('RESIDUAL_CLEANUP_REQUIRED')
    print(json.dumps({'scope': 'RESIDUAL_DIAGNOSTIC_ONLY', 'probes': len(results),
                      'sqlSucceeded': sum(r['sqlSucceeded'] for r in results),
                      'completeReplayVerified': False, 'sourceEffectsAccepted': False,
                      'generatedTypesVerified': False, 'productionModified': False,
                      'runtime': runtime, 'cleanup': 'PASS'}, sort_keys=True), flush=True)
    return 1 if any(not r['sqlSucceeded'] for r in results) else 0


if __name__ == '__main__':
    try:
        raise SystemExit(run())
    except Exception:
        print(json.dumps({'scope': 'RESIDUAL_DIAGNOSTIC_ONLY', 'outcome': 'HARNESS_ERROR',
                          'completeReplayVerified': False}), flush=True)
        raise SystemExit(2) from None
