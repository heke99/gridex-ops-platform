"""Finite preservation of 723 reviewed physical ordinal differences.

No generic ordinal normalization or external positional ABI acceptance.
The caller must validate_context on the owned native comparison, and retain
all independent relation, routine, type, constraint and permission gates.
"""
import hashlib
import json
from pathlib import Path
import canonical_changed_view_witness as views
import canonical_schema_index_column_decisions as final_sql

ROOT=Path(__file__).resolve().parents[1]
REGISTER='quality/audits/ediel-masterplan-v2/physical-column-order-register.json'
REVIEW='quality/audits/ediel-masterplan-v2/review-physical-column-order.md'
PINS={REGISTER:'d1366bcdb26c2bf04601b4742ee7a7d005be5b2c0ea394060f40923be1302b54',
      REVIEW:'e0cbe64cbd8cb04ba0c887eaa8863fccc4ffb6ede8a65c4c03011410be1ab62d',
      'scripts/canonical-full-schema-reference.py':'afbdac5ddcbc6bac0a0538d3fa4ac8f60efd6008a5966859ad43b79a7e1d9e27',
      'scripts/sql/gridex-db-parity-introspect.sql':'99b5c602223153dac69cf3266babfcffce80c889dc5375ad625c18e24fb255b0',
      'lib/performance/companySummaries.ts':'badeaf6ef524abc483e3879b93429ffbeea48db3af71061898e46abd17020bca',
      'lib/website/customerApplicationSchemas.ts':'13ace1ff2a8d35b9041ffb8a76745c91f82175659678a1e82a912ca218295267',
      'lib/customers/customerCardSnapshot.ts':'d778a1edc914d2539b935475aff1ca6361e33d25a64d4bde49c07672647a9275',
      'lib/billing/invoiceApprovedDispatch.ts':'67aeed6029e523865cf419257ac5eb8097e67d0a61b1290b2ba8ab7e278360ef',
      'supabase/migrations/20260901151000_canonical_contract_price_area_binding_schema.sql':'b75c50136292bbaef4b9f5a8d6fa0f7cf825748c77f88c01dd41c6bff1198442',
      'supabase/schema.sql':'b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30'}
ROW_KEYS={'identity','fields','referenceSha256','replaySha256'}


def sha(value):
    return hashlib.sha256(value).hexdigest()


def retain():
    result=[]
    for path in PINS:
        full=ROOT/path
        if full.resolve()!=full or not full.is_file() or full.stat().st_size>8_000_000:
            raise ValueError('PHYSICAL_ORDER_SOURCE_REQUIRED')
        result.append((path,full.read_bytes()))
    return tuple(result)


def contract(retained):
    if (type(retained) is not tuple or len(retained)!=len(PINS)
            or any(type(x) is not tuple or len(x)!=2 or type(x[0]) is not str
                   or type(x[1]) is not bytes for x in retained)
            or len(dict(retained))!=len(PINS) or set(dict(retained))!=set(PINS)):
        raise ValueError('PHYSICAL_ORDER_SOURCE_REQUIRED')
    for path,raw in retained:
        if sha(raw)!=PINS[path]:raise ValueError('PHYSICAL_ORDER_SOURCE_REQUIRED')
    document=json.loads(dict(retained)[REGISTER])
    rows=document['records']
    if (len(rows)!=723 or len({tuple(x['identity']) for x in rows})!=723
            or any(set(x)!=ROW_KEYS or x['fields']!=['attnum'] or len(x['identity'])!=3
                   or x['identity'][0]!='public' for x in rows)):
        raise ValueError('PHYSICAL_ORDER_EXACT_RECORDS_REQUIRED')
    return document


def approved():
    return tuple(dict(section='columns',change='changed',**row,
        decision='PRESERVE_EXACT_REVIEWED_PHYSICAL_ORDINAL_NO_POSITIONAL_ABI_CLAIM',
        decisionSourceSha256=PINS[REVIEW],witness='nativeFinalSql')
        for row in contract(retain())['records'])


def validate_execution_receipt(receipt,*,native):
    return final_sql.validate_execution_receipt(receipt,native=native)


def validate_context(diff):
    """Require all exact rows plus both affected view source witnesses.

    Parent central verifier must also establish owned native provenance and
    must fail every unsupported difference. This helper cannot accept a schema.
    """
    document=contract(retain())
    try:
        if (diff['scope']!='FULL_NATIVE_PUBLIC_PROJECTION_NOT_SCHEMA_ACCEPTANCE'
                or diff['syntheticLifecycleProbeStillPresent'] is not False
                or any(diff[k] is not True for k in ('cleanupVerified','privateWorkspaceRemoved',
                    'nativeSchemaRowsAndLedgerPreserved','referenceRestored','referenceDisposed'))):
            raise ValueError('PHYSICAL_ORDER_NATIVE_CONTEXT_REQUIRED')
        actual=diff['sections']['columns']['changed']
        expected={tuple(row['identity']):row for row in document['records']}
        selected=[row for row in actual if tuple(row['identity']) in expected]
        if (len(selected)!=723 or len({tuple(row['identity']) for row in selected})!=723
                or any(row!=expected[tuple(row['identity'])] for row in selected)
                or any(row['fields']==['attnum'] and tuple(row['identity']) not in expected for row in actual)):
            raise ValueError('PHYSICAL_ORDER_EXACT_RECORDS_REQUIRED')
        specs=views.contract(views.retain(views.ROOT))
        for row in document['requiredChangedViews']:
            if (diff['sections']['relations']['changed'].count(row)!=1
                    or sum({k:s[k] for k in ROW_KEYS}==row for s in specs)!=1):
                raise ValueError('PHYSICAL_ORDER_CHANGED_VIEW_CONTEXT_REQUIRED')
        views.validate_execution_receipt(diff['changedViewSourceWitness'],native=True)
        validate_execution_receipt(diff['nativeFinalSql'],native=True)
    except (KeyError,TypeError):
        raise ValueError('PHYSICAL_ORDER_NATIVE_CONTEXT_REQUIRED') from None
