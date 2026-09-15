"""Exercise genuine CLI type generation against the owned synthetic database.

Only transport, repeatability and state preservation are qualified. No historical
schema, generated application types or manifest is accepted or exported here.
"""
import hashlib
import re


def qualify(command, native, sql, project):
    from canonical_native_timestamp_proof import NativeTimestampTarget
    from canonical_native_historical_prefix import LEDGER_SQL
    target = NativeTimestampTarget(command, project)
    try:
        before = target.snapshot()
        ledger = sql(LEDGER_SQL)
        results = []
        for _ in range(2):
            target.assert_native_owned()
            result = native('--network-id', project+'-network', 'gen', 'types',
                            '--local', '--lang', 'typescript', '--schema', 'public',
                            timeout=600, allow_failure=True)
            if result.returncode != 0:
                raise ValueError('NATIVE_TYPEGEN_PREFLIGHT_COMMAND_REQUIRED')
            raw = result.stdout
            if (type(raw) is not bytes or not 100 < len(raw) < 1_000_000
                    or not raw.startswith(b'export type Json =')
                    or b'export type Database = {' not in raw
                    or not re.search(rb'gridex_native_lifecycle_probe:\s*\{\s*Row:\s*\{\s*id: number\s*\}', raw)
                    or b'never_committed:' in raw):
                raise ValueError('NATIVE_TYPEGEN_PREFLIGHT_OUTPUT_REQUIRED')
            raw.decode('utf-8')
            if target.snapshot() != before or sql(LEDGER_SQL) != ledger:
                raise ValueError('NATIVE_TYPEGEN_PREFLIGHT_PRESERVATION_REQUIRED')
            results.append(raw)
        if results[0] != results[1]:
            raise ValueError('NATIVE_TYPEGEN_PREFLIGHT_REPEAT_REQUIRED')
        return dict(scope='SYNTHETIC_NATIVE_TYPEGEN_NOT_APPLICATION_TYPES',
                    genuineCliTypegenExecuted=True, generatedBytes=len(results[0]),
                    generatedSha256=hashlib.sha256(results[0]).hexdigest(),
                    repeatEqual=True, schemaRowsAndLedgerPreserved=True,
                    schemaAccepted=False, generatedTypesVerified=False)
    finally:
        target.close()
