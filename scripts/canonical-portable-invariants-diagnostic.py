#!/usr/bin/env python3
"""Owned portable post-replay diagnostics; never native/schema/types acceptance."""
import importlib.util
import json
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
import canonical_forward_sources as forward_sources
import canonical_forward_portable as forward_portable
import canonical_native_final_sql as final_sql

spec = importlib.util.spec_from_file_location('portable_frontier', ROOT / 'scripts/canonical-foundation-frontier-diagnostic.py')
frontier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(frontier)


def receipt(outcome, phase, progress):
    return dict(scope='PORTABLE_FINAL_SQL_DIAGNOSTIC_ONLY', outcome=outcome, phase=phase,
                details=progress, completeReplayVerified=False, schemaAccepted=False,
                ledgerProvenanceVerified=False, generatedTypesVerified=False, productionModified=False)


# Identical F-14 predicate from the pinned gate; only one-way object identifiers
# leave the owned database. No policy definition, role, row or object name exits.
INERT_POLICY_HASH_SQL = """
select coalesce(jsonb_agg(jsonb_build_object(
  'tableSha256', encode(sha256(convert_to(c.relname::text, 'UTF8')), 'hex'),
  'policySha256', encode(sha256(convert_to(pol.polname::text, 'UTF8')), 'hex')
  ) order by c.relname, pol.polname), '[]'::jsonb)
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where pol.polroles <> '{0}'::oid[]
  and not exists (
    select 1 from unnest(pol.polroles) as role_oid
    join pg_roles r on r.oid = role_oid
    where has_table_privilege(r.rolname, c.oid, 'SELECT, INSERT, UPDATE, DELETE')
  );
"""


def inert_policy_hashes(target, diagnostic):
    failures = [row for row in diagnostic.get('breaches', []) if row.get('rule') == 'F14_INERT_POLICY']
    if diagnostic.get('status') != 'RECOGNIZED' or len(failures) != 1:
        return None
    expected = failures[0].get('affectedCount')
    if type(expected) is not int or not 1 <= expected <= 10000:
        raise ValueError('INERT_POLICY_DIAGNOSTIC_COUNT_REQUIRED')
    before = forward_portable.snapshot(target)
    rows = json.loads(target.sql(forward_portable.DATABASE, INERT_POLICY_HASH_SQL, 'inert_policy_hashes'))
    if forward_portable.snapshot(target) != before:
        raise ValueError('INERT_POLICY_DIAGNOSTIC_STATE_CHANGED')
    if (type(rows) is not list or len(rows) != expected
            or any(type(row) is not dict or set(row) != {'tableSha256', 'policySha256'}
                   or any(type(value) is not str or re.fullmatch('[0-9a-f]{64}', value) is None
                          for value in row.values()) for row in rows)
            or len({(row['tableSha256'], row['policySha256']) for row in rows}) != expected):
        raise ValueError('INERT_POLICY_DIAGNOSTIC_PROJECTION_REQUIRED')
    return dict(count=expected, objects=rows)


def execute_final(target, legacy, retained, progress):
    final_sql.validate(retained)
    if (progress.get('foundationApplied') != 144 or progress.get('timestampApplied') != 514
            or progress.get('forwardSources', {}).get('executed') is not True
            or progress['forwardSources'].get('inputsExecuted') != len(forward_sources.FORWARD_SOURCES)):
        raise ValueError('PORTABLE_FINAL_PREFIX_REQUIRED')
    progress['finalChecks'] = []
    for ordinal, (path, raw) in enumerate(retained, 1):
        before = forward_portable.snapshot(target)
        item = dict(source=path, sourceSha256=final_sql.PINS[path], verified=False)
        progress['finalChecks'].append(item)
        # command() admits only this active owned target. stdin stays in memory;
        # subprocess output is never printed or copied into published artifacts.
        result = subprocess.run(target.command(forward_portable.DATABASE,
                                transaction=path not in final_sql.TRANSACTIONAL) + ['-f', '-'],
                                input=raw, capture_output=True, timeout=420,
                                env=legacy.clean_environment())
        errors = re.findall(rb'^(?:psql:[^\r\n]*?:\d+:\s*)?(?:ERROR|FATAL|PANIC):\s+([A-Z0-9]{5}):', result.stderr, re.M)
        if result.returncode != 0 or errors:
            diagnostic = final_sql.invariant_failure_diagnostic('final_sql_'+str(ordinal), raw.decode(), '00000', errors, result)
            if diagnostic is not None:
                item['tenantInvariants'] = diagnostic
                hashes = inert_policy_hashes(target, diagnostic)
                if hashes is not None:
                    item['inertPolicyHashes'] = hashes
            raise ValueError('PORTABLE_FINAL_SQL_REJECTED')
        if forward_portable.snapshot(target) != before:
            raise ValueError('PORTABLE_FINAL_STATE_CHANGED')
        item.update(verified=True, catalogAndRowsPreserved=True)


def run():
    if len(sys.argv) != 1:
        raise ValueError('NO_TARGET_OR_SCOPE_ARGUMENTS_ACCEPTED')
    controller = frontier.load_controller()
    order, report = frontier.verify_selection(controller)
    timestamp = frontier.load_timestamp()
    selected, prerequisites = timestamp.load_inputs(ROOT, report, order)
    legacy = controller.load_batch()
    retained = timestamp.retain_sources(ROOT, selected, prerequisites)
    forwards = forward_sources.retain(ROOT)
    final = final_sql.retain(ROOT)

    def interrupted(_signum, _frame):
        raise legacy.BoundaryError('INTERRUPTED')

    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    before = controller.originals_snapshot()
    result = None
    phase = 'OWNED_TARGET'
    progress = {'foundationApplied': 0, 'timestampApplied': 0}
    with legacy.OwnedPostgres(postgis=True) as target:
        private_directory = Path(target.directory.name)
        try:
            phase = 'SPATIAL_RUNTIME_ADMISSION'
            progress['runtime'] = timestamp.verify_spatial_runtime(target)
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
                progress['foundationApplied'] = 144
                phase = 'SELECTED_TIMESTAMP_EXECUTION'
                timestamp.execute_tail(ROOT, target, controller.DATABASE, selected, prerequisites, progress, retained=retained)
                phase = 'FORWARD_EXECUTION'
                forward_portable.execute(target, forwards, progress)
                phase = 'PINNED_FINAL_SQL'
                execute_final(target, legacy, final, progress)
                result = receipt('PORTABLE_FINAL_SQL_PASSED_NOT_CERTIFIED', phase, progress)
        except Exception:
            result = receipt('BLOCKED', phase, progress)
        # Preserve the exact original source tree: there is no checkout staging,
        # restoration, source/manifest rewrite or schema baseline publication.
        if controller.originals_snapshot() != before:
            raise legacy.BoundaryError('SOURCE_PRESERVATION_FAILED')
    if target.active:
        raise legacy.BoundaryError('OWNED_CLEANUP_REQUIRED')
    result.update(ownedCleanupVerified=True, privateWorkspaceRemoved=target.directory is None and not private_directory.exists(), sourcePreserved=True)
    if result['privateWorkspaceRemoved'] is not True:
        raise ValueError('PRIVATE_DISPOSAL_REQUIRED')
    print(json.dumps(result, sort_keys=True), flush=True)
    return 0 if result['outcome'] == 'PORTABLE_FINAL_SQL_PASSED_NOT_CERTIFIED' else 1


if __name__ == '__main__':
    try:
        raise SystemExit(run())
    except Exception:
        print(json.dumps(receipt('HARNESS_ERROR', 'DISPOSAL_OR_ADMISSION', {})), flush=True)
        raise SystemExit(2) from None
