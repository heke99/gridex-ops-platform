"""Source-bound LOCK contexts and native failure controls for the first43 CLI lane.

No explicit COMMIT can precede Supabase's own ledger insertion. A plain atomic
DO gives LOCK its non-top-level transaction context while keeping the acquired
lock in the surrounding CLI batch transaction. No exception handler releases it.
The four source identities below are the only admitted programs with top-level
LOCK. Native ordinal27 probes must prove lock lifetime, local settings and
SQL-plus-ledger rollback before any such program is accepted as executed.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
import re
import time

SOURCE_PINS = {
    'b86f056fb868a3642eb6663068bc1cb4b86d03d430e6a1f339687868ec2773a6': 1,
    '1ab9a6bf09953d87a898235e4425b85739286e2c3bcb15987a0d75770c6c3705': 1,
    '03bec0a08fb0852bf7cdad8c96f01fe509bd6a7c970793a6db2fd4230c49dca1': 2,
    '018d81e763e6134ddb3d886ef7e219d6247584a9dad14b871e2ef98014db6333': 2,
}
SOURCE27 = 'migrations/20260909120000_canonical_role_permission_uniqueness_reconstruction.sql'
SHA27 = 'b86f056fb868a3642eb6663068bc1cb4b86d03d430e6a1f339687868ec2773a6'
TAG = '$gridex_native_lock$'
OPEN = 'DO '+TAG+'\nBEGIN\n'
CLOSE = '\nEND\n'+TAG+';'


def adapt(raw: bytes, program: bytes, statements, error) -> bytes:
    text = program.decode()
    locks = [s for s in statements(text) if s[0][0].upper() == 'LOCK']
    if not locks:
        return program
    if SOURCE_PINS.get(hashlib.sha256(raw).hexdigest()) != len(locks) or TAG in text:
        raise error('NATIVE_LOCK_SOURCE_REQUIRED')
    source = raw.decode()
    parsed_source = statements(source)
    if program != (source[parsed_source[1][0][1]:parsed_source[-2][-1][2]]+';\n').encode():
        raise error('NATIVE_LOCK_SOURCE_REQUIRED')
    # Reverse edits preserve offsets. Each original LOCK, including the final
    # semicolon, remains byte-identical and in the same place in the sequence.
    for statement in reversed(locks):
        start, end = statement[0][1], statement[-1][2]
        if text[end:end+1] != ';':
            raise error('NATIVE_LOCK_SOURCE_REQUIRED')
        end += 1
        text = text[:start]+OPEN+text[start:end]+CLOSE+text[end:]
    if text.replace(OPEN, '').replace(CLOSE, '') != program.decode():
        raise error('NATIVE_LOCK_SOURCE_REQUIRED')
    return text.encode()


SNAPSHOT = """SELECT jsonb_build_object(
 'roleRows',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM public.role_permissions t),
 'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_array(c.conname,pg_get_constraintdef(c.oid),c.convalidated,c.condeferrable,c.condeferred) ORDER BY c.conname),'[]') FROM pg_constraint c WHERE c.conrelid='public.role_permissions'::regclass),
 'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_array(c.relname,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready) ORDER BY c.relname),'[]') FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='public.role_permissions'::regclass),
 'probeRows',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM public.gridex_native_lifecycle_probe t),
 'probeColumns',(SELECT coalesce(jsonb_agg(jsonb_build_array(attname,atttypid,attnotnull) ORDER BY attnum),'[]') FROM pg_attribute WHERE attrelid='public.gridex_native_lifecycle_probe'::regclass AND attnum>0 AND NOT attisdropped),
 'temporarySchema',to_regnamespace('gridex_native_tx27') IS NOT NULL,
 'temporaryTrigger',EXISTS(SELECT FROM pg_trigger WHERE tgrelid='supabase_migrations.schema_migrations'::regclass AND tgname='gridex_native_tx27_guard'));
"""
MARKER = b"\nALTER TABLE public.gridex_native_lifecycle_probe ADD COLUMN lock27_rollback_marker integer;\nINSERT INTO public.gridex_native_lifecycle_probe(id) VALUES (2700001);\n"
ASSERTIONS = """
  IF current_setting('lock_timeout') <> '5s' OR current_setting('statement_timeout') <> '30s'
     OR NOT EXISTS (SELECT FROM pg_locks WHERE pid=pg_backend_pid()
       AND relation='public.role_permissions'::regclass AND mode='AccessExclusiveLock' AND granted)
     OR NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='public.role_permissions'::regclass
       AND conname='role_permissions_role_id_permission_id_key' AND contype='u'
       AND convalidated AND NOT condeferrable AND NOT condeferred
       AND pg_get_constraintdef(oid)='UNIQUE (role_id, permission_id)')
     OR NOT EXISTS (SELECT FROM public.gridex_native_lifecycle_probe WHERE id=2700001) THEN
    RAISE EXCEPTION 'NATIVE_LOCK27_ASSERTION_FAILED' USING ERRCODE='P2700';
  END IF;
"""
POST_BODY = ("DO $gridex_tx27_probe$ BEGIN\n"+ASSERTIONS+
             "RAISE EXCEPTION 'NATIVE_LOCK27_POST_BODY_PROBE' USING ERRCODE='P2727';\n"
             "END $gridex_tx27_probe$;\n").encode()


def ledger_trigger(name: str) -> str:
    if not re.fullmatch(r'gridex_native_f0027_[a-f0-9]{12}', name):
        raise ValueError('EXACT_LOCK27_PROBE_NAME_REQUIRED')
    return ("BEGIN; CREATE SCHEMA gridex_native_tx27;\n"
            "REVOKE ALL ON SCHEMA gridex_native_tx27 FROM PUBLIC, anon, authenticated, service_role;\n"
            "CREATE FUNCTION gridex_native_tx27.reject_ledger() RETURNS trigger\n"
            "LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $guard$ BEGIN\n"
            "IF NEW.name IS DISTINCT FROM '"+name+"' THEN RAISE EXCEPTION 'WRONG_PROBE' USING ERRCODE='P2700'; END IF;\n"
            +ASSERTIONS+
            "RAISE EXCEPTION 'NATIVE_LOCK27_LEDGER_PROBE' USING ERRCODE='P2728';\nEND $guard$;\n"
            "REVOKE ALL ON FUNCTION gridex_native_tx27.reject_ledger() FROM PUBLIC, anon, authenticated, service_role;\n"
            "CREATE TRIGGER gridex_native_tx27_guard BEFORE INSERT ON supabase_migrations.schema_migrations\n"
            "FOR EACH ROW EXECUTE FUNCTION gridex_native_tx27.reject_ledger();\nSELECT pg_catalog.to_json(true); COMMIT;")


DROP_TRIGGER = """BEGIN;
DROP TRIGGER gridex_native_tx27_guard ON supabase_migrations.schema_migrations;
DROP FUNCTION gridex_native_tx27.reject_ledger();
DROP SCHEMA gridex_native_tx27;
SELECT pg_catalog.to_json(true); COMMIT;
"""


def qualify(prefix, native, sql, work: Path, program, expected: list, retained: list, report: dict) -> None:
    """Fail three real CLI migrations on the owned first26, leaving no applied row.

    The first is the exact old derived source (required 25P01 red regression).
    The others execute the corrected source plus synthetic DDL/DML then fail
    after its body and during the CLI's own ledger INSERT, respectively. A
    ledger trigger checks the actual lock, constraint and timeouts in that very
    transaction. Raw rows/statements remain private and never enter the report.
    """
    if (program.ordinal != 27 or program.source != SOURCE27 or program.source_sha256 != SHA27
            or program != prefix.prepare()[26]):
        raise prefix.PrefixError('NATIVE_LOCK_SOURCE_REQUIRED')
    before = sql(SNAPSHOT)
    if (type(before) is not dict or before.get('temporarySchema') is not False
            or before.get('temporaryTrigger') is not False or sql(prefix.LEDGER_SQL) != expected):
        raise prefix.PrefixError('NATIVE_LOCK27_PROOF_REQUIRED')
    unwrapped = program.sql.decode().replace(OPEN, '').replace(CLOSE, '').encode()
    # Pin the exact failed execution program independently of the new adapter.
    if prefix.sha(unwrapped) != 'cb2e411c8c4ade0a82503f678e96913ae139655f277297d7eef688818ae6b9f4':
        raise prefix.PrefixError('NATIVE_LOCK_SOURCE_REQUIRED')
    directory = work/'supabase/migrations'
    original_files = {p.name for p in directory.iterdir()}
    cases = ((unwrapped, '25P01', False),
             (program.sql+MARKER+POST_BODY, 'P2727', False),
             (program.sql+MARKER, 'P2728', True))
    report.update(verified=False, cases=[])
    for payload, state, trigger in cases:
        report.update(currentProbe=state, phase='CLI_FILE_CREATION')
        name = 'gridex_native_f0027_'+prefix.sha(payload)[:12]
        time.sleep(1.05)
        native('migration', 'new', name)
        created = {p.name for p in directory.iterdir()} - original_files
        if len(created) != 1 or {p.name for p in directory.iterdir()} != original_files | created:
            raise prefix.PrefixError('NATIVE_CLI_CREATED_FILE_REQUIRED')
        filename = next(iter(created)); path = directory/filename
        if (not re.fullmatch(r'\d{14}_'+re.escape(name)+r'\.sql', filename)
                or filename[:14] <= expected[-1]['version']):
            raise prefix.PrefixError('NATIVE_CLI_CREATED_FILE_REQUIRED')
        physical = prefix.private_write(path, payload)
        prefix.verify_private(path, payload, physical)
        installed = False
        try:
            if trigger:
                report['phase'] = 'LEDGER_GUARD_INSTALL'
                if sql(ledger_trigger(name)) is not True:
                    raise prefix.PrefixError('NATIVE_LOCK27_PROOF_REQUIRED')
                installed = True
            for item in retained: prefix.verify_private(*item)
            report['phase'] = 'EXPECTED_MIGRATION_FAILURE'
            outcome = native('migration', 'up', '--local', allow_failure=True)
            prefix.verify_private(path, payload, physical)
            for item in retained: prefix.verify_private(*item)
            match = re.search(rb'SQLSTATE[ :]+([A-Z0-9]{5})\b', outcome.stderr)
            actual_state = match[1].decode() if match else None
            if outcome.returncode == 0 or actual_state != state:
                report['unexpectedSqlstate'] = actual_state
                raise prefix.PrefixError('NATIVE_LOCK27_PROOF_REQUIRED')
            report['phase'] = 'FAILED_LEDGER_VERIFICATION'
            if sql(prefix.LEDGER_SQL) != expected:
                raise prefix.PrefixError('NATIVE_FAILED_LEDGER_CHANGED')
        finally:
            if installed:
                report['phase'] = 'LEDGER_GUARD_DISPOSAL'
                if sql(DROP_TRIGGER) is not True:
                    raise prefix.PrefixError('NATIVE_LOCK27_PROOF_REQUIRED')
            prefix.verify_private(path, payload, physical)
            path.unlink()
        report['phase'] = 'ROLLBACK_SNAPSHOT_VERIFICATION'
        if sql(SNAPSHOT) != before or {p.name for p in directory.iterdir()} != original_files:
            raise prefix.PrefixError('NATIVE_LOCK27_ROLLBACK_REQUIRED')
        report['cases'].append({'expectedSqlstate':state, 'programSha256':prefix.sha(payload),
                                'ledgerUnchanged':True, 'schemaAndRowsRestored':True})
    report.update(verified=True, phase='VERIFIED', original25P01Reproduced=True, lockHeldAtLedgerInsert=True,
                  localTimeoutsPreserved=True, sourceAndMarkerRollbackVerified=True,
                  noAppliedProbeRows=True, helpersDisposed=True)
