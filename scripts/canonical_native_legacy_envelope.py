"""Native foundation44-52: one CLI-owned atomic unit, never nine commits.

Only the already-verified first43 lifecycle may call this module. All eight
historical sources, Q, admission, stage guards and preservation assertions run
unchanged inside one invoker DO statement. No applied historical row is invented.
Raw baseline catalogs and execution bodies live only in the owned private workdir.
"""
from dataclasses import dataclass, field
import copy
import hashlib
import importlib.util
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PINS = {
    'canonical-auth-provisioning-legacy-batch.py': 'adad170c149ddacf5d7c1f2ba9d0255518bd5c20b50def8b705ad38b54bf57b8',
    'sql/canonical-auth-provisioning-legacy-admission.sql': '164298b223d28d7fb28cb0d96189892da2dbbca04dc354ae39302ed58645afa5',
    'sql/canonical-auth-provisioning-legacy-assertions.sql': 'df55959f4205fe9c1c3caea4edbb0ee0c8e083798e40332e0b4f08adc7255caa',
    'sql/canonical-auth-provisioning-legacy-catalog.sql': '50ecb6deb8e160bc8c98fcca11bb8c976a852ad9d8f1f98aafe185dd18246fcb',
}
TAG = '$gridex_native_legacy52$'
NAME = r'gridex_native_f0044_0052_[a-f0-9]{12}'
FINISH = """DO $legacy52_finish$ BEGIN
 IF (SELECT count(*) FROM pg_temp.legacy_context WHERE txid=txid_current() AND stage='completed')<>1
 THEN RAISE EXCEPTION 'NATIVE_LEGACY52_INCOMPLETE' USING ERRCODE='P5200'; END IF;
END $legacy52_finish$;
"""
MARKER = b"\nALTER TABLE public.gridex_native_lifecycle_probe ADD COLUMN legacy52_rollback_marker integer;\nINSERT INTO public.gridex_native_lifecycle_probe(id) VALUES (5200001);\n"
BOUNDARY = """
 IF current_setting('transaction_isolation') <> 'read committed'
 OR current_setting('lock_timeout')::interval <> interval '10 seconds'
 OR current_setting('statement_timeout')::interval <> interval '60 seconds'
 OR NOT EXISTS (SELECT FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory'
   AND classid=20260910 AND objid=140053 AND objsubid=2 AND granted)
 OR EXISTS (SELECT FROM unnest(ARRAY['roles','auth_email_events','company_invitations',
   'company_memberships','user_profiles','user_roles']) t WHERE NOT EXISTS
   (SELECT FROM pg_locks WHERE pid=pg_backend_pid() AND relation=to_regclass('public.'||t)
    AND mode='AccessExclusiveLock' AND granted))
 OR (SELECT count(*) FROM pg_temp.legacy_context WHERE txid=txid_current() AND stage='completed')<>1
 OR NOT EXISTS (SELECT FROM public.gridex_native_lifecycle_probe WHERE id=5200001)
 THEN RAISE EXCEPTION 'NATIVE_LEGACY52_BOUNDARY_FAILED' USING ERRCODE='P5200'; END IF;
"""
DROP_GUARD = """BEGIN;
DROP TRIGGER gridex_native_legacy52_guard ON supabase_migrations.schema_migrations;
DROP FUNCTION gridex_native_legacy52_probe.reject_ledger();
DROP SCHEMA gridex_native_legacy52_probe;
SELECT pg_catalog.to_json(true); COMMIT;
"""
# Snapshot helper writes only a session-local temporary table. PostgreSQL
# disallows CREATE even for temporary tables inside a READ ONLY transaction.
ROWS_SQL = """BEGIN;
SET LOCAL search_path=public,extensions,pg_temp;
CREATE TEMP TABLE native_legacy52_rows(relation_name text,row_value jsonb) ON COMMIT DROP;
DO $snapshot$ DECLARE r record; BEGIN
 FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p') ORDER BY n.nspname,c.relname LOOP
 EXECUTE format('INSERT INTO pg_temp.native_legacy52_rows SELECT %L,to_jsonb(t) FROM %I.%I t',
 format('%I.%I',r.nspname,r.relname),r.nspname,r.relname);
 END LOOP;
END $snapshot$;
SELECT coalesce(jsonb_agg(jsonb_build_array(relation_name,row_value) ORDER BY relation_name,row_value::text),'[]'::jsonb)
FROM pg_temp.native_legacy52_rows;
COMMIT;
"""


def load_sources(prefix):
    """Reuse the reviewed source authority, with all its support bytes pinned."""
    try:
        for name, digest in PINS.items():
            path = ROOT/'scripts'/name
            if path.resolve() != path or not path.is_file() or prefix.sha(path.read_bytes()) != digest:
                raise ValueError('source')
        path = ROOT/'scripts/canonical-auth-provisioning-legacy-batch.py'
        spec = importlib.util.spec_from_file_location('native_legacy52_source_authority', path)
        batch = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = batch
        try:
            spec.loader.exec_module(batch)
            sources = batch.validate_sources(batch.reviewed_paths())
        finally:
            sys.modules.pop(spec.name, None)
        order = json.loads((ROOT/'scripts/gridex-aud-003-foundation-order.json').read_text())['foundation']
        if (prefix.sha(json.dumps(order, separators=(',', ':')).encode()) != prefix.ORDER_SHA
                or ['migrations/'+s.path.name for s in sources] != order[43:52]):
            raise ValueError('order')
        return batch, sources
    except Exception:
        raise prefix.PrefixError('NATIVE_LEGACY52_SOURCE_REQUIRED') from None


@dataclass(frozen=True)
class Envelope:
    sql: bytes = field(repr=False)
    sources: tuple
    parts: tuple = field(repr=False)

    @property
    def name(self):
        return 'gridex_native_f0044_0052_'+hashlib.sha256(self.sql).hexdigest()[:12]


def wrap(prefix, parts):
    statements = []
    for index, text in enumerate(parts):
        tag = '$legacy52_part_'+str(index)+'$'
        if TAG in text or tag in text:
            raise prefix.PrefixError('NATIVE_LEGACY52_SOURCE_REQUIRED')
        statements.append('EXECUTE '+tag+text+tag+';')
    raw = ('DO '+TAG+'\nBEGIN\n'+'\n'.join(statements)+'\nEND\n'+TAG+';\n').encode()
    if len(raw) > prefix.MAX_SQL:
        raise prefix.PrefixError('NATIVE_SQL_INPUT_REQUIRED')
    return raw


def prepare(prefix, batch, sources, before):
    """Bind exact first43 preimage and source-derived delta assertions to one unit.

    The existing executor's SET TRANSACTION is replaced by an exact isolation
    precondition: the CLI's DO statement has already acquired a snapshot. No
    other context, source, admission or assertion SQL is rewritten.
    """
    if (sources != batch.validate_sources(batch.reviewed_paths())
            or not isinstance(before, dict) or not before):
        raise prefix.PrefixError('NATIVE_LEGACY52_SOURCE_REQUIRED')
    context = """DO $isolation$ BEGIN
 IF current_setting('transaction_isolation') <> 'read committed'
 THEN RAISE EXCEPTION 'NATIVE_LEGACY52_ISOLATION_REQUIRED' USING ERRCODE='P5200'; END IF;
END $isolation$;
CREATE TEMP TABLE legacy_reference(base jsonb NOT NULL,final jsonb) ON COMMIT DROP;
"""
    context += 'INSERT INTO legacy_reference VALUES ('+batch.literal(json.dumps(before))+'::jsonb,NULL);\n'
    admission = (batch.SUPPORT/'canonical-auth-provisioning-legacy-admission.sql').read_text()
    batch.validate_admission(admission)
    admission = admission.replace('-- LEGACY_CATALOG_CAPTURE', batch.catalog_capture('legacy_catalog_before'))
    parts = [context, admission]
    previous = 'admitted'
    for source in sources:
        parts.append(source.data.decode())
        if source.alias != 'Q':
            parts.append(batch.stage_sql(previous, source.alias))
        previous = source.alias
    assertions = (batch.SUPPORT/'canonical-auth-provisioning-legacy-assertions.sql').read_text()
    assertions = assertions.replace('-- LEGACY_CATALOG_CAPTURE', batch.catalog_capture('legacy_catalog_after'))
    assertions = assertions.replace('-- LEGACY_DDL_ORACLES', batch.ddl_oracles(sources))
    parts.extend([assertions, FINISH])
    receipts = tuple({'ordinal': i, 'source': 'migrations/'+s.path.name,
                      'sourceSha256': s.sha256} for i, s in enumerate(sources, 44))
    return Envelope(wrap(prefix, parts), receipts, tuple(parts))


def catalog_sql(batch):
    return ('BEGIN READ ONLY; SET LOCAL search_path=public,extensions,pg_temp;\n'
            +(batch.SUPPORT/'canonical-auth-provisioning-legacy-catalog.sql').read_text()+'\nCOMMIT;')


def ledger_guard(name):
    if not re.fullmatch(NAME, name):
        raise ValueError('EXACT_LEGACY52_PROBE_NAME_REQUIRED')
    return ("BEGIN; CREATE SCHEMA gridex_native_legacy52_probe;\n"
            "REVOKE ALL ON SCHEMA gridex_native_legacy52_probe FROM PUBLIC,anon,authenticated,service_role;\n"
            "CREATE FUNCTION gridex_native_legacy52_probe.reject_ledger() RETURNS trigger\n"
            "LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $guard$ BEGIN\n"
            "IF NEW.name IS DISTINCT FROM '"+name+"' THEN RAISE EXCEPTION 'WRONG_PROBE' USING ERRCODE='P5200'; END IF;\n"
            +BOUNDARY+"RAISE EXCEPTION 'NATIVE_LEGACY52_LEDGER_PROBE' USING ERRCODE='P5253';\nEND $guard$;\n"
            "REVOKE ALL ON FUNCTION gridex_native_legacy52_probe.reject_ledger() FROM PUBLIC,anon,authenticated,service_role;\n"
            "CREATE TRIGGER gridex_native_legacy52_guard BEFORE INSERT ON supabase_migrations.schema_migrations\n"
            "FOR EACH ROW EXECUTE FUNCTION gridex_native_legacy52_probe.reject_ledger();\n"
            "SELECT pg_catalog.to_json(true); COMMIT;")


def probes(prefix, program):
    # Mid-source failure deliberately occurs after full A, before B and Q.
    mid = list(program.parts[:3])+["DO $fail$ BEGIN RAISE EXCEPTION 'MID' USING ERRCODE='P5244'; END $fail$;"]
    post = ('DO $post$ BEGIN\n'+BOUNDARY+"RAISE EXCEPTION 'POST' USING ERRCODE='P5252'; END $post$;\n").encode()
    return ((wrap(prefix, mid), 'P5244', False),
            (program.sql+MARKER+post, 'P5252', False),
            (program.sql+MARKER, 'P5253', True))


def create_unit(prefix, native, directory, raw, expected, files):
    name = 'gridex_native_f0044_0052_'+prefix.sha(raw)[:12]
    time.sleep(1.05)
    native('migration', 'new', name)
    current = {p.name for p in directory.iterdir()}
    added = current-files
    if len(added) != 1 or not files <= current:
        raise prefix.PrefixError('NATIVE_CLI_CREATED_FILE_REQUIRED')
    path = directory/next(iter(added))
    if (not re.fullmatch(r'\d{14}_'+re.escape(name)+r'\.sql', path.name)
            or path.name[:14] <= expected[-1]['version']):
        raise prefix.PrefixError('NATIVE_CLI_CREATED_FILE_REQUIRED')
    physical = prefix.private_write(path, raw)
    prefix.verify_private(path, raw, physical)
    return path, physical, name


def qualify(prefix, native, sql, directory, program, expected, retained, snapshot, report):
    before = snapshot()
    files = {p.name for p in directory.iterdir()}
    report.update(verified=False, cases=[])
    for raw, state, guarded in probes(prefix, program):
        report.update(phase='CLI_FILE_CREATION', currentProbe=state)
        path, physical, name = create_unit(prefix, native, directory, raw, expected, files)
        installed = False
        try:
            if guarded:
                report['phase'] = 'LEDGER_GUARD_INSTALL'
                if sql(ledger_guard(name)) is not True:
                    raise prefix.PrefixError('NATIVE_LEGACY52_PROOF_REQUIRED')
                installed = True
            for item in retained: prefix.verify_private(*item)
            report['phase'] = 'EXPECTED_MIGRATION_FAILURE'
            result = native('migration', 'up', '--local', allow_failure=True)
            prefix.verify_private(path, raw, physical)
            for item in retained: prefix.verify_private(*item)
            match = re.search(rb'SQLSTATE[ :]+([A-Z0-9]{5})\b', result.stderr)
            actual_state = match[1].decode() if match else None
            if result.returncode == 0 or actual_state != state:
                report['unexpectedSqlstate'] = actual_state
                raise prefix.PrefixError('NATIVE_LEGACY52_PROOF_REQUIRED')
            if sql(prefix.LEDGER_SQL) != expected:
                raise prefix.PrefixError('NATIVE_FAILED_LEDGER_CHANGED')
        finally:
            if installed and sql(DROP_GUARD) is not True:
                raise prefix.PrefixError('NATIVE_LEGACY52_PROOF_REQUIRED')
            prefix.verify_private(path, raw, physical)
            path.unlink()
        report['phase'] = 'ROLLBACK_VERIFICATION'
        if snapshot() != before or {p.name for p in directory.iterdir()} != files:
            raise prefix.PrefixError('NATIVE_LEGACY52_ROLLBACK_REQUIRED')
        report['cases'].append({'expectedSqlstate': state, 'programSha256': prefix.sha(raw),
                                'ledgerUnchanged': True, 'catalogAndRowsRestored': True})
    report.update(verified=True, phase='VERIFIED', locksHeldAtLedgerInsert=True,
                  temporaryContextHeldAtLedgerInsert=True, localTimeoutsPreserved=True,
                  noAppliedProbeRows=True, helpersDisposed=True)


def prerequisite(prefix, sql, work, previous):
    if (previous.get('historicalPrefixLedgerVerified') is not True
            or previous.get('foundationInputsExecuted') != 43
            or previous.get('timestampInputsExecuted') != 0
            or previous.get('transactionBoundary27', {}).get('verified') is not True
            or len(previous.get('canonicalExecutionUnits', [])) != 43):
        raise prefix.PrefixError('NATIVE_LEGACY52_PREFIX_REQUIRED')
    directory = work/'supabase/migrations'
    if directory.resolve() != directory or directory.stat().st_mode & 0o077:
        raise prefix.PrefixError('NATIVE_PRIVATE_SOURCE_REQUIRED')
    expected = sql(prefix.LEDGER_SQL)
    if type(expected) is not list or len(expected) != 44:
        raise prefix.PrefixError('NATIVE_LEGACY52_PREFIX_REQUIRED')
    filenames = {p.name for p in directory.iterdir()}
    if filenames != {e['version']+'_'+e['name']+'.sql' for e in expected}:
        raise prefix.PrefixError('NATIVE_UNEXPECTED_MIGRATION_INPUT')
    retained = []
    for index, (entry, program, receipt) in enumerate(zip(expected[1:], prefix.prepare(), previous['canonicalExecutionUnits']), 1):
        filename = receipt['cliFile']; path = directory/filename
        prefix.verify_entry(entry, filename, program)
        if (receipt['sourceSha256'] != program.source_sha256 or receipt['programSha256'] != program.digest
                or receipt['ordinal'] != index or receipt['source'] != program.source):
            raise prefix.PrefixError('NATIVE_LEGACY52_PREFIX_REQUIRED')
        metadata = path.lstat()
        retained.append((path, program.sql, (metadata.st_dev, metadata.st_ino)))
        prefix.verify_private(*retained[-1])
    first = expected[0]
    if first.get('name') != 'native_lifecycle_proof':
        raise prefix.PrefixError('NATIVE_SYNTHETIC_PREFLIGHT_LEDGER_REQUIRED')
    path = directory/(first['version']+'_native_lifecycle_proof.sql')
    metadata = path.lstat(); raw = path.read_bytes()
    if tuple(t for s in first['statements'] for t in prefix.identity(s)) != prefix.identity(raw.decode()):
        raise prefix.PrefixError('NATIVE_SYNTHETIC_PREFLIGHT_LEDGER_REQUIRED')
    retained.append((path, raw, (metadata.st_dev, metadata.st_ino)))
    prefix.verify_private(*retained[-1])
    return directory, copy.deepcopy(expected), retained


def execute(prefix, native, sql, work, previous, report):
    """Called only inside the existing private, owned native lifecycle."""
    directory, expected, retained = prerequisite(prefix, sql, work, previous)
    if report:
        raise prefix.PrefixError('NATIVE_FRESH_PROGRESS_REQUIRED')
    report.update(scope='FOUNDATION44_52_ATOMIC_NATIVE_NOT_FULL_REPLAY', verified=False,
                  foundationInputsExecuted=0, cumulativeFoundationInputsExecuted=43,
                  timestampInputsExecuted=0, completeReplayVerified=False, generatedTypesVerified=False,
                  originalHistoricalVersionsMarkedApplied=False, phase='SOURCE_ADMISSION')
    batch, sources = load_sources(prefix)
    keys = ','.join("'"+key+"'" for key in prefix.SETTINGS)
    environment = sql("SELECT jsonb_build_object('role',current_user,'database',current_database(),"
                      "'settings',(SELECT jsonb_object_agg(name,setting) FROM pg_settings WHERE name IN ("+keys+")));")
    if environment != {'role': 'postgres', 'database': 'postgres', 'settings': prefix.SETTINGS}:
        raise prefix.PrefixError('NATIVE_PRIVATE_LOGGING_REQUIRED')
    def snapshot():
        return {'catalog': sql(catalog_sql(batch)), 'rows': sql(ROWS_SQL)}
    before = snapshot()
    if sql("SELECT to_json(to_regnamespace('gridex_native_legacy52_probe') IS NULL);") is not True:
        raise prefix.PrefixError('NATIVE_LEGACY52_PROOF_REQUIRED')
    program = prepare(prefix, batch, sources, before['catalog'])
    report['sources'] = program.sources
    report['transactionBoundary44_52'] = {}
    qualify(prefix, native, sql, directory, program, expected, retained, snapshot,
            report['transactionBoundary44_52'])
    # Re-read all nine immutable inputs/support after probes, before real apply.
    fresh_batch, fresh_sources = load_sources(prefix)
    if prepare(prefix, fresh_batch, fresh_sources, before['catalog']).sql != program.sql:
        raise prefix.PrefixError('NATIVE_LEGACY52_SOURCE_REQUIRED')
    report['phase'] = 'ATOMIC_CLI_MIGRATION'
    path, physical, name = create_unit(prefix, native, directory, program.sql, expected,
                                      {p.name for p in directory.iterdir()})
    retained.append((path, program.sql, physical))
    for item in retained: prefix.verify_private(*item)
    result = native('migration', 'up', '--local', allow_failure=True)
    for item in retained: prefix.verify_private(*item)
    actual = sql(prefix.LEDGER_SQL)
    if result.returncode:
        match = re.search(rb'SQLSTATE[ :]+([A-Z0-9]{5})\b', result.stderr)
        if match: report['failedSqlstate'] = match[1].decode()
        if actual != expected: raise prefix.PrefixError('NATIVE_FAILED_LEDGER_CHANGED')
        raise prefix.PrefixError('NATIVE_HISTORICAL_SQL_FAILED')
    if type(actual) is not list or len(actual) != len(expected)+1 or actual[:-1] != expected:
        raise prefix.PrefixError('NATIVE_UNEXPECTED_LEDGER_DELTA')
    prefix.verify_entry(actual[-1], path.name, program)
    after = snapshot()
    native('migration', 'up', '--local')
    for item in retained: prefix.verify_private(*item)
    if sql(prefix.LEDGER_SQL) != actual or snapshot() != after:
        raise prefix.PrefixError('NATIVE_HISTORICAL_LEDGER_REPEAT_CHANGED')
    report.update(verified=True, phase='VERIFIED', foundationInputsExecuted=9,
                  cumulativeFoundationInputsExecuted=52, canonicalExecutionUnitCount=1,
                  cliFile=path.name, programSha256=prefix.sha(program.sql),
                  ledgerStatementsSha256=prefix.sha(json.dumps(actual[-1]['statements'], separators=(',', ':')).encode()),
                  unchangedEarlierLedger=True, noOpRepeatVerified=True,
                  sourcePreservationAssertionsExecuted=True, supportSha256=dict(PINS))
    return report
