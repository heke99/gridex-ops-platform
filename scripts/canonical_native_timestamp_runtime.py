"""Execute retained timestamp units with the official CLI's real statement ledger.

This module has no external connection string and never synthesizes historical
applied versions. Its caller owns the private native lifecycle. Execution is not
schema, readiness, generated-types, or whole-PR acceptance.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
import re
from types import SimpleNamespace

import canonical_native_historical_prefix as p
import canonical_native_foundation144 as foundation
import canonical_native_provider_events as provider

NAME = r'gridex_native_t(?:000[1-9]|00[1-9][0-9]|0[1-4][0-9]{2}|050[0-9]|051[0-4])_(?:p0[12]|prerequisite|cleanup)_[a-f0-9]{12}'
POST = b"\nDO $native_timestamp_fault$ BEGIN RAISE EXCEPTION 'NATIVE_TIMESTAMP_POST_BODY' USING ERRCODE='PT001'; END $native_timestamp_fault$;\n"
DROP_GUARD = """BEGIN;
DROP TRIGGER gridex_native_timestamp_guard ON supabase_migrations.schema_migrations;
DROP FUNCTION gridex_native_timestamp_probe.reject_ledger();
DROP SCHEMA gridex_native_timestamp_probe;
SELECT pg_catalog.to_json(true); COMMIT;
"""


def native_snapshot(target, database='postgres'):
    return target.snapshot(database), json.loads(target.sql(database, provider.QUERY,
                                                            'timestamp_provider_events', transaction=False))


def require_settings(sql):
    keys = ','.join("'" + key + "'" for key in p.SETTINGS)
    actual = sql("SELECT jsonb_build_object('role',current_user,'database',current_database(),'settings',"
                 "(SELECT jsonb_object_agg(name,setting) FROM pg_settings WHERE name IN (" + keys + ")));")
    if actual != {'role': 'postgres', 'database': 'postgres', 'settings': p.SETTINGS}:
        raise ValueError('NATIVE_TIMESTAMP_SETTINGS_REQUIRED')


def failure_state(stderr):
    lines = [line for line in stderr.splitlines() if line.startswith(b'ERROR:')]
    if len(lines) != 1:
        return None
    match = re.fullmatch(rb'ERROR: NATIVE_TIMESTAMP_(POST_BODY|LEDGER_FAULT) \(SQLSTATE (PT001|PT002)\)', lines[0].rstrip(b' '))
    if not match or {b'POST_BODY': b'PT001', b'LEDGER_FAULT': b'PT002'}[match[1]] != match[2]:
        return None
    return match[2].decode()


def probe_program(unit, suffix):
    if re.fullmatch(NAME, unit.name) is None or type(suffix) is not bytes:
        raise ValueError('NATIVE_TIMESTAMP_PROGRAM_REQUIRED')
    raw = unit.sql + suffix
    return SimpleNamespace(name=unit.name[:-12] + p.sha(raw)[:12], sql=raw)


def ledger_guard(name, assertion):
    if re.fullmatch(NAME, name) is None:
        raise ValueError('NATIVE_TIMESTAMP_PROGRAM_REQUIRED')
    return ("BEGIN; CREATE SCHEMA gridex_native_timestamp_probe;\n"
            "REVOKE ALL ON SCHEMA gridex_native_timestamp_probe FROM PUBLIC,anon,authenticated,service_role;\n"
            "CREATE FUNCTION gridex_native_timestamp_probe.reject_ledger() RETURNS trigger "
            "LANGUAGE plpgsql SECURITY INVOKER AS $guard$ BEGIN\n"
            "IF NEW.name IS DISTINCT FROM '" + name + "' OR (" + assertion + ") IS DISTINCT FROM true THEN "
            "RAISE EXCEPTION 'NATIVE_TIMESTAMP_BOUNDARY_MISMATCH' USING ERRCODE='PT009'; END IF;\n"
            "RAISE EXCEPTION 'NATIVE_TIMESTAMP_LEDGER_FAULT' USING ERRCODE='PT002'; END $guard$;\n"
            "REVOKE ALL ON FUNCTION gridex_native_timestamp_probe.reject_ledger() FROM PUBLIC,anon,authenticated,service_role;\n"
            "CREATE TRIGGER gridex_native_timestamp_guard BEFORE INSERT ON supabase_migrations.schema_migrations "
            "FOR EACH ROW EXECUTE FUNCTION gridex_native_timestamp_probe.reject_ledger();\n"
            "SELECT pg_catalog.to_json(true); COMMIT;")


def predecessor(sql, work, parent):
    last = parent.get('historicalFoundation144', {})
    required = {'historicalLegacy52': 52, 'historicalRepair56': 56, 'historicalDedupe57': 57,
                'historicalFixed63': 63, 'historicalAlignment68': 68, 'historicalOperations77': 77}
    if (parent.get('foundationInputsExecuted') != 144 or last.get('executed') is not True
            or last.get('cumulativeFoundationInputsExecuted') != 144
            or last.get('residualInputsExecuted') != 7 or len(last.get('groups', [])) != 7
            or any(g.get('executed') is not True or g.get('transactionControlsVerified') is not True
                   or g.get('noOpRepeatVerified') is not True for g in last['groups'])
            or parent.get('historicalPrefix', {}).get('historicalPrefixLedgerVerified') is not True
            or any(parent.get(key, {}).get('verified') is not True
                   or parent[key].get('cumulativeFoundationInputsExecuted') != count
                   for key, count in required.items())):
        raise ValueError('NATIVE_TIMESTAMP_FOUNDATION_REQUIRED')
    first = parent['historicalPrefix']['canonicalExecutionUnits']
    order, pins = foundation.source_inventory()
    sources = [*first, *parent['historicalLegacy52']['sources'], *parent['historicalRepair56']['sources'],
               *parent['historicalDedupe57']['sources'], *parent['historicalFixed63']['sources'],
               *parent['historicalAlignment68']['sources'],
               *(source for group in parent['historicalOperations77']['groups'] for source in group['sources'])]
    if (len(sources) != 77 or [source['ordinal'] for source in sources] != list(range(1, 78))
            or [source['source'] for source in sources] != order[:77]
            or any(source['sourceSha256'] != pins[source['source']] for source in sources)):
        raise ValueError('NATIVE_TIMESTAMP_FOUNDATION_REQUIRED')
    units = [{'cliFile': parent['successfulMigration'], 'programSha256': parent['executedSqlSha256']},
             *first, parent['historicalLegacy52'], parent['historicalRepair56'],
             parent['historicalDedupe57'], *parent['historicalFixed63']['canonicalExecutionUnits'],
             parent['historicalAlignment68'], *parent['historicalOperations77']['groups'], *last['groups']]
    if len(first) != 43 or len(units) != 65:
        raise ValueError('NATIVE_TIMESTAMP_FOUNDATION_REQUIRED')
    for group, receipt in zip(foundation.prepare(), last['groups']):
        if receipt['programSha256'] != p.sha(foundation.render(group).sql):
            raise ValueError('NATIVE_TIMESTAMP_FOUNDATION_REQUIRED')
    directory = work / 'supabase/migrations'
    if (directory.resolve() != directory or not directory.is_dir() or directory.stat().st_mode & 0o077
            or {path.name for path in directory.iterdir()} != {u['cliFile'] for u in units}):
        raise ValueError('NATIVE_TIMESTAMP_FOUNDATION_REQUIRED')
    actual = sql(p.LEDGER_SQL)
    if type(actual) is not list or len(actual) != len(units):
        raise ValueError('NATIVE_TIMESTAMP_FOUNDATION_REQUIRED')
    retained = []
    for entry, unit in zip(actual, units):
        path = directory / unit['cliFile']
        if path.is_symlink() or not path.is_file():
            raise ValueError('NATIVE_TIMESTAMP_FOUNDATION_REQUIRED')
        raw = path.read_bytes(); meta = path.stat(); physical = (meta.st_dev, meta.st_ino)
        p.verify_private(path, raw, physical)
        if p.sha(raw) != unit['programSha256']:
            raise ValueError('NATIVE_TIMESTAMP_FOUNDATION_REQUIRED')
        p.verify_entry(entry, path.name, SimpleNamespace(name=entry['name'], sql=raw))
        if ('ledgerStatementsSha256' in unit and p.sha(json.dumps(entry['statements'], separators=(',', ':')).encode())
                != unit['ledgerStatementsSha256']):
            raise ValueError('NATIVE_TIMESTAMP_FOUNDATION_REQUIRED')
        retained.append((path, raw, physical))
    return directory, copy.deepcopy(actual), retained


class Runner:
    def __init__(self, native, sql, target, work, parent):
        target.assert_native_owned()
        provider.require(sql, parent['providerEventBootstrap'])
        require_settings(sql)
        self.native, self.sql, self.target = native, sql, target
        self.directory, self.entries, self.retained = predecessor(sql, work, parent)

    def unchanged(self):
        for item in self.retained:
            p.verify_private(*item)
        if self.sql(p.LEDGER_SQL) != self.entries:
            raise ValueError('NATIVE_TIMESTAMP_EARLIER_LEDGER_CHANGED')

    def create(self, program):
        self.unchanged()
        return foundation.create_unit(p, self.native, self.directory, program, self.entries,
                                      {path.name for path in self.directory.iterdir()})

    def qualify_failure(self, unit, *, ledger=False, assertion='true'):
        program = probe_program(unit, b'' if ledger else POST)
        before = native_snapshot(self.target)
        original_files = {path.name for path in self.directory.iterdir()}
        path, physical = self.create(program)
        installed = False
        try:
            if ledger:
                if self.sql(ledger_guard(program.name, assertion)) is not True:
                    raise ValueError('NATIVE_TIMESTAMP_LEDGER_PROOF_REQUIRED')
                installed = True
            result = self.native('migration', 'up', '--local', timeout=420, allow_failure=True)
            p.verify_private(path, program.sql, physical)
            if result.returncode == 0 or failure_state(result.stderr) != ('PT002' if ledger else 'PT001'):
                raise ValueError('NATIVE_TIMESTAMP_FAILURE_PROOF_REQUIRED')
            self.unchanged()
        finally:
            if installed and self.sql(DROP_GUARD) is not True:
                raise ValueError('NATIVE_TIMESTAMP_GUARD_CLEANUP_REQUIRED')
            p.verify_private(path, program.sql, physical)
            path.unlink()
        if (native_snapshot(self.target) != before
                or {path.name for path in self.directory.iterdir()} != original_files):
            raise ValueError('NATIVE_TIMESTAMP_ROLLBACK_REQUIRED')
        return {'expectedSqlstate': 'PT002' if ledger else 'PT001', 'programSha256': p.sha(program.sql),
                'catalogAndRowsRestored': True, 'ledgerUnchanged': True}

    def apply(self, unit):
        before = native_snapshot(self.target)
        path, physical = self.create(unit)
        result = self.native('migration', 'up', '--local', timeout=420, allow_failure=True)
        p.verify_private(path, unit.sql, physical)
        for item in self.retained:
            p.verify_private(*item)
        actual = self.sql(p.LEDGER_SQL)
        if result.returncode:
            if actual != self.entries or native_snapshot(self.target) != before:
                raise ValueError('NATIVE_TIMESTAMP_FAILED_UNIT_ROLLBACK_REQUIRED')
            raise ValueError('NATIVE_TIMESTAMP_SOURCE_EXECUTION_REQUIRED')
        if type(actual) is not list or len(actual) != len(self.entries) + 1 or actual[:-1] != self.entries:
            raise ValueError('NATIVE_TIMESTAMP_LEDGER_REQUIRED')
        p.verify_entry(actual[-1], path.name, unit)
        self.retained.append((path, unit.sql, physical))
        self.entries = actual
        return {'cliFile': path.name, 'programSha256': p.sha(unit.sql),
                'ledgerStatementsSha256': p.sha(json.dumps(actual[-1]['statements'], separators=(',', ':')).encode()),
                'unchangedEarlierLedger': True, 'originalHistoricalVersionMarkedApplied': False}

    def repeat(self):
        before = native_snapshot(self.target)
        self.native('migration', 'up', '--local', timeout=420)
        self.unchanged()
        if native_snapshot(self.target) != before:
            raise ValueError('NATIVE_TIMESTAMP_REPEAT_REQUIRED')


def verify_restoration(driver, target, unit, progress):
    """Use the unchanged source-specific positive and mutation SQL on native clones."""
    source = (unit.source, unit.source_sha256)
    restoration, residual = driver.load_restoration(), driver.load_residual_restoration()
    if unit.source in restoration.SOURCES:
        if restoration.SOURCES[unit.source] != (unit.source_sha256, unit.ordinal):
            raise ValueError('NATIVE_TIMESTAMP_RESTORATION_SOURCE_REQUIRED')
        expressions = restoration.checks(unit.source)
        check = ''.join(restoration.assert_sql(e) for e in expressions)
        index = restoration.INDEXES[list(restoration.SOURCES).index(unit.source)]
        mutation = ('DROP INDEX public.' + index + ';' if index else
                    'ALTER VIEW public.canonical_migration_readiness_v SET (security_invoker=false);')
    elif unit.source in residual.TIMESTAMP_SOURCES:
        if residual.SOURCES[unit.source] != (unit.source_sha256, unit.ordinal):
            raise ValueError('NATIVE_TIMESTAMP_RESTORATION_SOURCE_REQUIRED')
        check = ''.join(residual.assertion(e) for e in residual.checks(unit.source))
        mutation = residual.negative_sql(unit.source)
    else:
        return
    target.sql('postgres', check, 'timestamp_restoration_positive')
    clone = 'gridex_auth_legacy_atomic'
    target.clone('postgres', clone)
    try:
        target.sql(clone, mutation, 'timestamp_restoration_negative_setup')
        target.sql(clone, check, 'timestamp_restoration_negative', expect='23514')
    finally:
        target.drop_clone(clone)
    target.sql('postgres', check, 'timestamp_restoration_parent_preserved')
    progress.setdefault('restoredSourceControls', []).append({'source': source[0], 'sourceSha256': source[1],
        'ordinal': unit.ordinal, 'positiveAndNegativeVerified': True, 'fullSourceEffectsAccepted': False})


def boundary_assertion(unit):
    """Exact source-specific lock and local-setting observations at ledger INSERT."""
    import canonical_native_timestamp_sources as compiler
    if 'LOCK_LIFETIME' not in unit.qualifications:
        return 'true'
    pin = compiler.LOCK_PINS.get(unit.ordinal)
    if pin is None or pin[0] != unit.source_sha256:
        raise ValueError('NATIVE_TIMESTAMP_LOCK_SOURCE_REQUIRED')
    relation = 'contract_product_versions' if unit.ordinal == 224 else 'contract_offers'
    mode = 'AccessExclusiveLock' if unit.ordinal == 224 else 'ShareRowExclusiveLock'
    assertion = ("EXISTS(SELECT FROM pg_catalog.pg_locks WHERE pid=pg_catalog.pg_backend_pid() "
                 "AND relation='public." + relation + "'::pg_catalog.regclass AND mode='" + mode + "' AND granted)")
    if unit.ordinal == 225:
        assertion += " AND pg_catalog.current_setting('search_path')='public, extensions, pg_catalog, pg_temp'"
    return assertion


def qualify_equivalence(target, unit):
    """Compare original and derived SQL on two clones of this exact predecessor.

    For committed sources this is called for each phase: phase two's predecessor
    already includes phase one's committed CLI effects and actual ledger row.
    No timestamp, random-value, ACL, or row normalization hides differences.
    """
    original, candidate = 'gridex_native_timestamp_original', 'gridex_native_timestamp_candidate'
    target.clone('postgres', original)
    target.clone('postgres', candidate)
    try:
        target.sql(original, unit.source_sql.decode(), 'timestamp_original_phase', transaction=False)
        target.sql(candidate, unit.sql.decode(), 'timestamp_derived_phase', transaction=True)
        expected = native_snapshot(target, original)
        if native_snapshot(target, candidate) != expected:
            raise ValueError('NATIVE_TIMESTAMP_SOURCE_EQUIVALENCE_REQUIRED')
        return expected
    finally:
        target.drop_clone(candidate)
        target.drop_clone(original)


def execute(command, native, sql, work, project, parent, plan):
    import canonical_native_timestamp_sources as compiler
    from canonical_native_timestamp_proof import NativeTimestampTarget, execute_live_sync
    if ('historicalTimestampTail' in parent
            or type(plan) is not compiler.Plan
            or compiler.compile_retained(plan.selected, plan.prerequisites, plan.retained) != plan):
        raise ValueError('NATIVE_TIMESTAMP_RETAINED_PLAN_REQUIRED')
    target = NativeTimestampTarget(command, project)
    progress = {'scope': 'NATIVE_TIMESTAMP_EXECUTION_NOT_FULL_SCHEMA_ACCEPTANCE',
                'executed': False, 'timestampInputsExecuted': 0, 'prerequisitesExecuted': 0,
                'executionUnits': [], 'completeReplayVerified': False, 'generatedTypesVerified': False,
                'originalHistoricalVersionsMarkedApplied': False, 'sequenceValuesRollbackClaimed': False,
                'fullSourceEffectsAccepted': False}
    parent['historicalTimestampTail'] = progress
    driver = compiler.load_tail()
    shim = None
    try:
        runner = Runner(native, sql, target, work, parent)
        # This is capability evidence from the actual native server, not a
        # substitute portable image or a claim that extension creation succeeded.
        capability = sql("SELECT jsonb_build_object('version',current_setting('server_version_num'),"
                         "'postgis',(SELECT default_version FROM pg_available_extensions WHERE name='postgis'));")
        if (not re.fullmatch(r'17[0-9]{4}', capability.get('version', ''))
                or not isinstance(capability.get('postgis'), str)):
            raise ValueError('NATIVE_TIMESTAMP_POSTGIS_REQUIRED')
        progress['nativeSpatialCapability'] = capability
        for unit in plan.units:
            state = unit.receipt()
            progress.update(currentOrdinal=unit.ordinal, currentKind=unit.kind, currentPhase=unit.phase)
            if unit.ordinal == 490 and unit.kind == 'prerequisite':
                answer = target.sql('postgres', plan.white_label_probe, 'timestamp_shim_probe', transaction=False).strip()
                if answer not in ('yes', 'no'):
                    raise ValueError('NATIVE_TIMESTAMP_SHIM_PROBE_REQUIRED')
                shim = answer == 'yes'
                progress['whiteLabelShimCreated'] = shim
            if unit.condition == 'white_label_shim_created' and not shim:
                state.update(executed=False, skippedByVerifiedCondition=True)
                progress['executionUnits'].append(state)
                continue
            progress['executionUnits'].append(state)
            special = any(label in unit.qualifications for label in ('COMMITTED_PHASES', 'LOCK_LIFETIME', 'LIVE_SYNC'))
            expected = None
            if special and 'LIVE_SYNC' not in unit.qualifications:
                state['stage'] = 'ORIGINAL_DERIVED_EQUIVALENCE'
                expected = qualify_equivalence(target, unit)
                state['originalDerivedCatalogAndRowsEqual'] = True
            if special:
                state['stage'] = 'CLI_FAILURE_CONTROLS'
                state['cases'] = [runner.qualify_failure(unit),
                                  runner.qualify_failure(unit, ledger=True, assertion=boundary_assertion(unit))]
            state['stage'] = 'CANONICAL_CLI_EXECUTION'
            if 'LIVE_SYNC' in unit.qualifications:
                def apply_reconstruction(rendered):
                    body, _ = compiler.transfer_outer(rendered.encode())
                    if body != unit.sql:
                        raise ValueError('NATIVE_TIMESTAMP_RECONSTRUCTION_BYTES_REQUIRED')
                    state.update(runner.apply(unit))
                    return {'ledgerVerified': True, 'renderedSha256': p.sha(rendered.encode())}
                execute_live_sync(target, unit.source_sql.decode(), progress, retained=plan.retained,
                                  apply_reconstruction=apply_reconstruction)
            else:
                state.update(runner.apply(unit))
            if expected is not None and native_snapshot(target) != expected:
                raise ValueError('NATIVE_TIMESTAMP_CLI_POSTIMAGE_EQUIVALENCE_REQUIRED')
            if special:
                runner.repeat()
                state['noOpRepeatVerified'] = True
            if unit.kind == 'timestamp' and unit.phase == unit.phase_count:
                if unit.ordinal != progress['timestampInputsExecuted'] + 1:
                    raise ValueError('NATIVE_TIMESTAMP_SOURCE_ORDER_REQUIRED')
                verify_restoration(driver, target, unit, progress)
                progress['timestampInputsExecuted'] = unit.ordinal
                parent['timestampInputsExecuted'] = unit.ordinal
            elif unit.kind == 'prerequisite':
                progress['prerequisitesExecuted'] += 1
            state.update(executed=True, nativeVerified=True, stage='EXECUTED_AND_LEDGER_VERIFIED')
            print(json.dumps({'scope': progress['scope'], 'ordinal': unit.ordinal, 'kind': unit.kind,
                              'sourcePhase': unit.phase, 'programSha256': unit.digest,
                              'ledgerVerified': True, 'completeReplayVerified': False}), flush=True)
        runner.repeat()
        if (progress['timestampInputsExecuted'] != 514 or shim is None
                or progress['prerequisitesExecuted'] != (5 if shim else 4)):
            raise ValueError('NATIVE_TIMESTAMP_COMPLETION_REQUIRED')
        progress.update(executed=True, phase='ALL_SELECTED_TIMESTAMP_INPUTS_EXECUTED',
                        noOpRepeatVerified=True, actualLedgerRows=len(runner.entries))
        return progress
    finally:
        target.close()
