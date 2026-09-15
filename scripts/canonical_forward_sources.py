"""Pinned forward-source admission after the immutable historical replay.

Selection and retained bytes are input evidence only. This module executes no
SQL, creates no ledger records, and grants no schema or replay acceptance.
"""
from dataclasses import dataclass, field
import hashlib
import json
from pathlib import Path
import re

HISTORICAL_SELECTION_SHA = '076408eb112ebd8b153a18d4774ffd7122d92ad3c0a8a9aaf8b58faacfe71fbe'
HISTORICAL_INVENTORY_SHA = 'ed164e9b8c55194015cd5b0f62adde6b743dc31a5866f08546a78c60b5240a31'
FORWARD_SOURCES = (
    ('migrations/20260915111458_restore_existing_column_foreign_keys.sql',
     '5593bf9f66e2ea783ac37f23ca4f547132e70beb519a955dc5b2666a65db569c'),
    ('migrations/20260915121224_restrict_retained_operational_table_privileges.sql',
     'c8928d29f3cf5ad527513a7448b4819c4f7a80f07d9fe3b78c764e30759e134e'),
    ('migrations/20260915132224_restrict_inbound_service_table_privileges.sql',
     '0ee026c41d180768b23e20826d522387cc1c65e9c689304472f62cda39b19033'),
    ('migrations/20260915132227_restrict_new_tenant_table_truncate.sql',
     'c67328cde9b270efad94aa44ded06f3b435170f247af90b1ea93e01dfe08523a'),
    ('migrations/20260915140647_restrict_remaining_rls_table_truncate.sql',
     'cf85df9d7339e5368ceac7567b720dfa26cc2bf51fe2cd0f19b79b3af7eaab2b'),
    ('migrations/20260915144319_restrict_ediel_send_lock_client_writes.sql',
     '411df92fc01f8b84dd9a83600464594e76a4841d48928d52dfadfd97b3177705'),
)


def _pairs(rows):
    if type(rows) not in (list, tuple):
        raise ValueError('FORWARD_SOURCE_PAIRS_REQUIRED')
    if any(type(row) not in (list, tuple) or len(row) != 2
           or type(row[0]) is not str or type(row[1]) is not str
           or not re.fullmatch(r'(?:migrations|bootstrap)/[A-Za-z0-9_.+ -]+\.sql', row[0])
           or not re.fullmatch(r'[0-9a-f]{64}', row[1]) for row in rows):
        raise ValueError('FORWARD_SOURCE_PAIRS_REQUIRED')
    result = tuple(tuple(row) for row in rows)
    if len({path for path, _ in result}) != len(result):
        raise ValueError('FORWARD_SOURCE_DUPLICATE')
    return result


def _digest(rows):
    return hashlib.sha256(json.dumps(rows, separators=(',', ':')).encode()).hexdigest()


def partition_timestamps(selected):
    """Require the original ordered 514 pairs followed by exactly six sources."""
    rows = _pairs(selected)
    historical, forward = rows[:514], rows[514:]
    if (len(rows) != 520 or _digest(historical) != HISTORICAL_SELECTION_SHA
            or forward != FORWARD_SOURCES):
        raise ValueError('FORWARD_TIMESTAMP_PARTITION_REQUIRED')
    return historical, forward


def partition_inventory(rows):
    """Account all 607 files without changing any of the historical 601 pins."""
    pairs = _pairs(rows)
    paths = {path for path, _ in FORWARD_SOURCES}
    historical = tuple(sorted(row for row in pairs if row[0] not in paths))
    forward = tuple(sorted(row for row in pairs if row[0] in paths))
    if (len(pairs) != 607 or len(historical) != 601
            or _digest(historical) != HISTORICAL_INVENTORY_SHA or forward != FORWARD_SOURCES):
        raise ValueError('FORWARD_INVENTORY_PARTITION_REQUIRED')
    return historical, forward


@dataclass(frozen=True)
class RetainedSource:
    source: str
    source_sha256: str
    sql: bytes = field(repr=False)


def validate_retained(retained):
    """Revalidate the bounded plan after originals move, without reopening SQL."""
    if (type(retained) is not tuple or len(retained) != len(FORWARD_SOURCES)
            or any(type(source) is not RetainedSource for source in retained)
            or tuple((source.source, source.source_sha256) for source in retained) != FORWARD_SOURCES
            or any(type(source.sql) is not bytes
                   or hashlib.sha256(source.sql).hexdigest() != source.source_sha256
                   for source in retained)):
        raise ValueError('FORWARD_RETAINED_SOURCES_REQUIRED')
    return retained


def retain(root):
    """Read only the six registered canonical files before the replay's HOLD."""
    root = Path(root)
    retained = []
    try:
        for source, digest in FORWARD_SOURCES:
            path = root / 'supabase' / source
            if (path.resolve() != path or not path.is_file()
                    or any(parent.is_symlink() for parent in (path, *path.parents))):
                raise ValueError('FORWARD_CANONICAL_SOURCE_REQUIRED')
            retained.append(RetainedSource(source, digest, path.read_bytes()))
    except OSError:
        raise ValueError('FORWARD_CANONICAL_SOURCE_REQUIRED') from None
    return validate_retained(tuple(retained))


def historical_fixture_accounting(report):
    """Qualify current606 input evidence, then expose the pinned601 fixture scope.

    Historical SQL fixture constructors predate the six forward sources and
    must continue testing their original prefix, without lying about inventory.
    This is a test/source-selection adapter; it creates no execution evidence.
    """
    import copy
    from collections import Counter
    rows = report['migrations']
    partition_inventory([(row['path'], row['sha256']) for row in rows])
    expected_counts = dict(FULL_FILE_SELECTED=595,SUBSTITUTED=2,UNCLASSIFIED=5,EXPLICITLY_EXCLUDED=5)
    if (report['totalMigrations'] != 607 or report['counts'] != expected_counts
            or dict(Counter(row['classification'] for row in rows)) != expected_counts
            or report['selectedInputCounts'] != dict(foundation=144,timestamp=520)
            or report['errors']):
        raise ValueError('FORWARD_FIXTURE_ACCOUNTING_REQUIRED')
    suffix = {path for path,_ in FORWARD_SOURCES}
    for ordinal,(path,digest) in enumerate(FORWARD_SOURCES,515):
        row = next(row for row in rows if row['path']==path)
        if (row['classification'] != 'FULL_FILE_SELECTED'
                or row['execution'] != [dict(ordinal=ordinal,stage='timestamp')]):
            raise ValueError('FORWARD_FIXTURE_ACCOUNTING_REQUIRED')
    result = copy.deepcopy(report)
    result['migrations'] = [row for row in result['migrations'] if row['path'] not in suffix]
    result['totalMigrations'] = 601
    result['counts'] = dict(Counter(row['classification'] for row in result['migrations']))
    result['selectedInputCounts'] = dict(foundation=144,timestamp=514)
    result['currentInventoryTotal'] = 607
    result['fixtureScope'] = 'PINNED_HISTORICAL_601_INPUTS_NOT_CURRENT_TOTAL'
    return result


def historical_fixture_review_group(report):
    """Keep historical lexical fixture assertions after admitting a finite suffix.

    A lexical group contains only the matching subset of the six forward files.
    Retain the current global accounting; only fixture inputs are projected back.
    This is review-hint bookkeeping, never SQL or source-effect acceptance.
    """
    import copy
    expected_counts = dict(FULL_FILE_SELECTED=595, SUBSTITUTED=2, UNCLASSIFIED=5, EXPLICITLY_EXCLUDED=5)
    provenance = report['accountingProvenance']
    if (report['errors'] or report['evidenceScope'] != 'LEXICAL_REVIEW_HINTS_ONLY'
            or report['effectsVerified'] is not False
            or provenance['errors'] or provenance['totalMigrations'] != 607
            or provenance['counts'] != expected_counts
            or provenance['selectedInputCounts'] != dict(foundation=144,timestamp=520)
            or report['global']['totalMigrations'] != 607
            or report['global']['classificationCounts'] != expected_counts):
        raise ValueError('FORWARD_FIXTURE_REVIEW_GROUP_REQUIRED')
    known = {path: (digest, ordinal) for ordinal,(path,digest) in enumerate(FORWARD_SOURCES,515)}
    rows = report['inputs']
    if len({row['path'] for row in rows}) != len(rows):
        raise ValueError('FORWARD_FIXTURE_REVIEW_GROUP_REQUIRED')
    for row in rows:
        if row['path'] in known:
            digest, ordinal = known[row['path']]
            if (row['sha256'] != digest or row['classification'] != 'FULL_FILE_SELECTED'
                    or row['execution'] != [dict(ordinal=ordinal,stage='timestamp')]):
                raise ValueError('FORWARD_FIXTURE_REVIEW_GROUP_REQUIRED')
    result = copy.deepcopy(report)
    result['inputs'] = [row for row in result['inputs'] if row['path'] not in known]
    result['currentFocusedInputCount'] = len(rows)
    result['fixtureScope'] = 'PINNED_HISTORICAL_INPUTS_WITH_CURRENT_GLOBAL_REVIEW_COUNTS'
    return result
