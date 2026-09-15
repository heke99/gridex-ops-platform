"""Existing post-replay SQL gates on the still-live owned native database.

Preserves the original SQL regressions and tenant invariant gate. This is not
schema parity or type-generation acceptance, and accepts no target override.
"""
import hashlib
import json
from pathlib import Path

from canonical_forward_sources import FORWARD_SOURCES
import canonical_native_timestamp_runtime as timestamp

PINS = {
    'scripts/sql/canonical-tenant-guard-catalog.sql': 'c8b21322ef6f1288cfe06e0b8178b82f119de7884f0ca319f414c8e0cb38f7c9',
    'scripts/manual-inbound-tenant-graph-regression.sql': '343de68bf4b980e004342deb5c6ccfdaae4c86666e873ec49d0b9c0d41b20b96',
    'scripts/gridex-canonical-provision-request-hash-regression.sql': '9c8a4d7a5c672bd599d4b0ecf139ba68e2740c068da76f7291afbeffc5b11318',
    'scripts/pr164-review-remediation-regression.sql': '6ccfb55a21e60b035fd580a0b2f8008056ee0dc0a514e341de44e79d541e832b',
    'scripts/sql/tenant-isolation-invariants.sql': '79d10e6b6ebf10b087142edeab3fe0bbebbe47bf325b27b9f42058ce6272b318',
}
TRANSACTIONAL = tuple(PINS)[1:4]


def validate(retained):
    if (type(retained) is not tuple or len(retained)!=len(PINS)
            or any(type(row) is not tuple or len(row)!=2 or type(row[1]) is not bytes for row in retained)
            or tuple(path for path,_ in retained)!=tuple(PINS)
            or any(hashlib.sha256(raw).hexdigest()!=PINS[path] for path,raw in retained)):
        raise ValueError('NATIVE_FINAL_SQL_SOURCE_REQUIRED')
    return retained


def retain(root):
    result=[]
    for name in PINS:
        path=Path(root)/name
        if path.resolve()!=path or not path.is_file():
            raise ValueError('NATIVE_FINAL_SQL_SOURCE_REQUIRED')
        result.append((name,path.read_bytes()))
    return validate(tuple(result))


def admit_forward(runner, retained_forward, parent):
    import canonical_native_forward_runtime as forward_runtime
    import canonical_native_historical_prefix as p
    programs = forward_runtime.programs(retained_forward)
    report = parent.get('forwardSources', {})
    receipts = report.get('sources', [])
    count = len(programs)
    cleanup_count = 0
    if 'syntheticProbeCleanup' in parent:
        from canonical_native_probe_cleanup import admit_completed
        admit_completed(runner, parent)
        cleanup_count = 1
    if (type(runner) is not timestamp.Runner or not hasattr(runner,'entries') or not hasattr(runner,'retained')
            or len(runner.entries) != len(runner.retained) or len(runner.entries) < 65+514+4+count+cleanup_count
            or report.get('actualLedgerRows') != len(runner.entries)-cleanup_count
            or parent.get('historicalTimestampTail',{}).get('actualLedgerRows') != len(runner.entries)-count-cleanup_count
            or len(receipts) != count):
        raise ValueError('NATIVE_FINAL_SQL_FORWARD_LEDGER_REQUIRED')
    runner.target.assert_native_owned()
    runner.unchanged()
    end = len(runner.entries)-cleanup_count
    for program,receipt,entry,retained in zip(programs,receipts,runner.entries[end-count:end],runner.retained[end-count:end]):
        path,raw,physical = retained
        expected_cases=[dict(expectedSqlstate=state,programSha256=p.sha(body),
                             catalogAndRowsRestored=True,ledgerUnchanged=True)
                        for state,body in [('PF001',program.sql+forward_runtime.POST),('PF002',program.sql)]]
        if (raw != program.sql or receipt.get('cliFile') != path.name
                or receipt.get('programSha256') != p.sha(program.sql)
                or receipt.get('ledgerStatementsSha256') != p.sha(json.dumps(entry['statements'],separators=(',',':')).encode())
                or receipt.get('cases') != expected_cases or receipt.get('stage') != 'VERIFIED'
                or receipt.get('unchangedEarlierLedger') is not True
                or receipt.get('outerTransactionTransferredToCli') is not True
                or receipt.get('originalHistoricalVersionMarkedApplied') is not False):
            raise ValueError('NATIVE_FINAL_SQL_FORWARD_LEDGER_REQUIRED')
        p.verify_private(path,raw,physical)
        p.verify_entry(entry,path.name,program)


def execute(runner, retained, parent, retained_forward):
    validated=validate(retained)
    forward=parent.get('forwardSources',{})
    if (type(runner) is not timestamp.Runner or parent.get('foundationInputsExecuted')!=144
            or parent.get('timestampInputsExecuted')!=514 or forward.get('executed') is not True
            or forward.get('inputsExecuted')!=len(FORWARD_SOURCES)
            or tuple((r.get('source'),r.get('sourceSha256')) for r in forward.get('sources',[]))!=FORWARD_SOURCES
            or any(r.get('executed') is not True or r.get('noOpRepeatVerified') is not True
                   or r.get('rowsPreserved') is not True for r in forward.get('sources',[]))
            or 'nativeFinalSql' in parent):
        raise ValueError('NATIVE_FINAL_SQL_COMPLETE_PREFIX_REQUIRED')
    admit_forward(runner, retained_forward, parent)
    report=dict(scope='POST_REPLAY_SQL_NOT_SCHEMA_OR_TYPE_ACCEPTANCE',verified=False,
                checks=[],schemaAccepted=False,generatedTypesVerified=False)
    parent['nativeFinalSql']=report
    for path,raw in validated:
        item=dict(source=path,sourceSha256=PINS[path],verified=False)
        report['checks'].append(item)
        before=timestamp.native_snapshot(runner.target)
        runner.target.sql('postgres',raw.decode(), 'final_sql_'+str(len(report['checks'])),
                          transaction=path not in TRANSACTIONAL)
        runner.unchanged()
        if timestamp.native_snapshot(runner.target)!=before:
            raise ValueError('NATIVE_FINAL_SQL_STATE_PRESERVATION_REQUIRED')
        item.update(verified=True,catalogAndRowsPreserved=True,ledgerUnchanged=True)
    report['verified']=True
    return report
