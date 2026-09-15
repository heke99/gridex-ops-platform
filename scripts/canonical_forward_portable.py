"""Retained forward effects on the actual owned full portable replay target."""
import json

import canonical_forward_sources as sources
from canonical_native_forward_runtime import assertion
from canonical_native_timestamp_snapshot import queries

DATABASE = 'gridex_auth_legacy_replay'


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
        target.sql(DATABASE, source.sql.decode(), 'forward_source_'+str(ordinal), transaction=False)
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
