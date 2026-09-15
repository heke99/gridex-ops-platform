"""Existing post-replay SQL gates on the still-live owned native database.

Preserves the original SQL regressions and tenant invariant gate. This is not
schema parity or type-generation acceptance, and accepts no target override.
"""
import hashlib
import json
import re
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


def invariant_failure_diagnostic(stage, sql, expect, errors, result):
    """Project only the pinned invariant assertion into closed rule IDs/hashes.

    This explains a rejected command; it never accepts SQL or changes a gate.
    Object tokens are hashed exactly as rendered by PostgreSQL, including any
    identifier quoting. No names, signatures, row values or stderr escape.
    Unknown/truncated message shapes produce no partial breach inventory.
    """
    if (stage != 'final_sql_5' or expect != '00000' or errors != [b'P0001']
            or result.returncode != 3
            or hashlib.sha256(sql.encode()).hexdigest() != PINS['scripts/sql/tenant-isolation-invariants.sql']):
        return None
    unknown = dict(status='UNRECOGNIZED')
    if len(result.stderr) > 1_000_000:
        return unknown
    header = re.fullmatch(
        rb'(?:psql:[^\r\n]*?:\d+:\s*)?ERROR: +P0001: Tenant isolation invariants failed \(([1-9][0-9]{0,4}) breach\(es\)\):\n'
        rb'(?P<body>(?:  - [^\r\n]+\n)+)(?:CONTEXT: [^\r\n]*\n)?(?:LOCATION: [^\r\n]*\n)?',
        result.stderr)
    if header is None:
        return unknown
    lines = header['body'].splitlines()
    if len(lines) != int(header[1]) or len(lines) > 10_000:
        return unknown
    # Exact pinned message templates, finite commands/roles, bounded integers.
    token = rb'([^\r\n]{1,512})'
    count = rb'([1-9][0-9]{0,9})'
    patterns = (
        ('F6_UNCLASSIFIED', rb'F-6: table '+token+rb' is not classified in platform_table_classification', (0,), None, None),
        ('F6_COMPANY_GUARD', rb'F-6: '+token+rb' is reachable by a client role but has no restrictive company guard for command ([rawd])', (0,), 'command', 1),
        ('F6_RLS_DISABLED', rb'F-6: table '+token+rb' has row level security disabled', (0,), None, None),
        ('F3_TENANT_NULL', rb'F-3: tenant table '+token+rb' holds '+count+rb' row\(s\) with no company_id', (0,), 'affectedCount', 1),
        ('F8_F10_UNSCOPED_UNIQUE', rb'F-8/F-10: unique index '+token+rb' on tenant table '+token+rb' is not scoped by company_id', (0,1), None, None),
        ('F13_VIEW_INVOKER', rb'F-13: view '+token+rb' does not set security_invoker', (0,), None, None),
        ('F14_INERT_POLICY', rb'F-14: '+count+rb' policy/policies target roles with no privileges on their table and are inert', (), 'affectedCount', 0),
        ('F16_CLIENT_RESOLVER', rb'F-16: '+token+rb' is executable by (anon|authenticated) and is reachable as REST RPC', (0,), 'role', 1),
        ('F16_ANON_DEFINER', rb'F-16: SECURITY DEFINER function '+token+rb' is executable by anon', (0,), None, None),
        ('F7_ROLE_SCOPE', rb'F-7: '+count+rb' user_role row\(s\) have an inconsistent platform/company scope', (), 'affectedCount', 0),
    )
    breaches = []
    for line in lines:
        for rule, pattern, objects, field, field_index in patterns:
            match = re.fullmatch(pattern, line[4:])
            if match is None:
                continue
            values = match.groups()
            item = dict(rule=rule)
            if objects:
                item['objectSha256'] = [hashlib.sha256(values[i]).hexdigest() for i in objects]
            if field:
                item[field] = int(values[field_index]) if field == 'affectedCount' else values[field_index].decode('ascii')
            breaches.append(item)
            break
        else:
            return unknown
    return dict(status='RECOGNIZED', breachCount=len(breaches), breaches=breaches)


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
        runner.target._recent_sql_failure = None
        try:
            runner.target.sql('postgres',raw.decode(), 'final_sql_'+str(len(report['checks'])),
                              transaction=path not in TRANSACTIONAL)
        except ValueError:
            if runner.target._recent_sql_failure is not None:
                item['nativeSqlFailure'] = dict(runner.target._recent_sql_failure)
            raise
        runner.unchanged()
        if timestamp.native_snapshot(runner.target)!=before:
            raise ValueError('NATIVE_FINAL_SQL_STATE_PRESERVATION_REQUIRED')
        item.update(verified=True,catalogAndRowsPreserved=True,ledgerUnchanged=True)
    report['verified']=True
    return report
