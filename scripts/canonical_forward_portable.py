"""Retained forward effects on the actual owned full portable replay target."""
import json
from pathlib import Path
import re

import canonical_forward_sources as sources
from canonical_native_forward_runtime import assertion
from canonical_native_timestamp_snapshot import queries

DATABASE = 'gridex_auth_legacy_replay'


def inert_failure_reason(target):
    """Project only fixed migration guard names from the owner's private error."""
    allowed={'INERT_INBOUND_RELATION_REQUIRED','INERT_INBOUND_CLIENT_MUST_BE_CLOSED',
             'INERT_INBOUND_EXACT_POLICY_REQUIRED','INERT_INBOUND_COMPLETE_POLICY_SET_REQUIRED',
             'INERT_INBOUND_UNEXPECTED_CLIENT_POLICY'}
    try:
        path=Path(target.directory.name)/'client-last.out'
        if path.is_symlink() or not path.is_file() or path.stat().st_size>65536:
            return 'UNCLASSIFIED'
        errors=re.findall(r'ERROR:\s+55000:\s+(INERT_INBOUND_[A-Z_]+)\s*$',path.read_text(),re.M)
        return errors[0] if len(errors)==1 and errors[0] in allowed else 'UNCLASSIFIED'
    except Exception:
        return 'UNCLASSIFIED'


def snapshot(target):
    catalog, rows = queries()
    return (json.loads(target.sql(DATABASE, catalog, 'forward_catalog')),
            json.loads(target.sql(DATABASE, rows, 'forward_rows')))


def execute(target, retained, progress):
    admitted = sources.validate_retained(retained)
    if (progress.get('foundationApplied') != 144 or progress.get('timestampApplied') != 514
            or 'forwardSources' in progress):
        raise ValueError('FORWARD_PORTABLE_PREFIX_REQUIRED')
    report = dict(scope='OWNED_FORWARD_SQL_NOT_NATIVE_LEDGER_ACCEPTANCE', sources=[], inputsExecuted=0,
                  executed=False, ledgerProvenanceVerified=False, generatedTypesVerified=False, schemaAccepted=False)
    progress['forwardSources'] = report
    for ordinal, source in enumerate(admitted, 1):
        before_rows = snapshot(target)[1]
        receipt = dict(source=source.source, sourceSha256=source.source_sha256, executed=False)
        report['sources'].append(receipt)
        try:
            target.sql(DATABASE, source.sql.decode(), 'forward_source_'+str(ordinal), transaction=False)
        except Exception:
            if ordinal==10:
                receipt['failureReason']=inert_failure_reason(target)
                print(json.dumps(dict(stage='forward_inert_guard_failure',reason=receipt['failureReason'])),flush=True)
            raise
        actual = json.loads(target.sql(DATABASE, 'SELECT to_json(('+assertion(ordinal)+'));', 'forward_postcondition'))
        after = snapshot(target)
        if actual is not True or after[1] != before_rows:
            raise ValueError('FORWARD_PORTABLE_POSTCONDITION_REQUIRED')
        target.sql(DATABASE, source.sql.decode(), 'forward_repeat_'+str(ordinal), transaction=False)
        if snapshot(target) != after:
            raise ValueError('FORWARD_PORTABLE_REPEAT_REQUIRED')
        receipt.update(executed=True, positiveAndRepeatVerified=True, rowsPreserved=True)
        report['inputsExecuted'] = ordinal
    report['executed'] = True
    return report
