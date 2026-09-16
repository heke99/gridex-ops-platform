#!/usr/bin/env python3
"""Account the seven reviewed residual source dispositions, not a database state.

The old selector does not see FoundationLoop's residual calls. This contract
accounts their exact immutable bytes, guarded replacements and operator-only
partitions. It never claims that a historical operator program was executed,
that SQL succeeded in this invocation, or that a schema/ledger/type is accepted.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = 'scripts/gridex-replay-residual-source-dispositions.json'
MODULES = ('canonical-residual-transitions.py',
           'canonical-residual-readiness-transitions.py',
           'canonical-db2-reconstruction.py',
           'canonical-residual-index-effects.py')
EXECUTORS = ('canonical-residual-replay.py',
             'canonical-residual-readiness-native.py',
             'canonical-db2-reconstruction-native.py')
FOUNDATION_SHA256 = '11af5df0de43b4e135a2c8172a1ffc937079241826a60e5fefda9cb588363595'


def digest(value):
    return hashlib.sha256(value).hexdigest()


def exact_file(root, relative):
    if type(relative) is not str or Path(relative).is_absolute() or '..' in Path(relative).parts:
        raise ValueError('RESIDUAL_DISPOSITION_UNSAFE_PATH')
    path = root / relative
    if any(p.is_symlink() for p in (root, path, *path.parents)) or not path.is_file():
        raise ValueError('RESIDUAL_DISPOSITION_SOURCE_REQUIRED')
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('RESIDUAL_DISPOSITION_UNSAFE_PATH')
    return path.read_bytes()


def load(filename):
    spec = importlib.util.spec_from_file_location('admission_' + filename.replace('-', '_'), ROOT/'scripts'/filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def unique_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('RESIDUAL_DISPOSITION_DUPLICATE_KEY')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs)


def partition(raw, spans):
    result, offset = [], 0
    for start, end, disposition in spans:
        if type(start) is not int or type(end) is not int or start != offset or end <= start or end > len(raw):
            raise ValueError('RESIDUAL_DISPOSITION_GAP_OR_OVERLAP')
        result.append({'startByte': start, 'endByteExclusive': end,
                       'disposition': disposition, 'sha256': digest(raw[start:end])})
        offset = end
    if offset != len(raw):
        raise ValueError('RESIDUAL_DISPOSITION_INCOMPLETE')
    return result


def changed_span(raw, start, end, disposition):
    spans = []
    if start:
        spans.append((0, start, 'COPY_ORIGINAL_SQL'))
    spans.append((start, end, disposition))
    if end < len(raw):
        spans.append((end, len(raw), 'COPY_ORIGINAL_SQL'))
    return partition(raw, spans)


def byte_offset(text, index):
    return len(text[:index].encode('utf-8'))


def build(root=ROOT):
    """Build a review candidate from source, never from a live database/report."""
    root = Path(root)
    transition, readiness, db2 = (load(p) for p in MODULES[:3])
    order = unique_json(exact_file(root, 'scripts/gridex-aud-003-foundation-order.json'))['foundation']
    if (type(order) is not list or len(order) != 144 or len(set(order)) != 144 or
            digest(json.dumps(order, separators=(',', ':')).encode()) != FOUNDATION_SHA256):
        raise ValueError('RESIDUAL_DISPOSITION_BOUNDARY_MISMATCH')
    pins = {**transition.PINS, **readiness.PINS, **db2.PINS}
    raw = {p: exact_file(root, 'supabase/' + p) for p in pins}
    if any(digest(raw[p]) != sha for p, sha in pins.items()):
        raise ValueError('RESIDUAL_DISPOSITION_SOURCE_MISMATCH')
    preimage = 'migrations/20260519_saas_ui_tenant_admin.sql'
    if digest(exact_file(root, 'supabase/' + preimage)) != db2.INVITE_PREIMAGE_SHA256:
        raise ValueError('RESIDUAL_DISPOSITION_INDEX_PREIMAGE_MISMATCH')
    rows = []

    def append(source, rendered, parts, boundary, mode, authorities=()):
        # Encoding the complete emitted program binds added guards as well as
        # retained SQL. Parts account original bytes, not generated guard text.
        rows.append({'source': source, 'sourceSha256': pins[source],
                     'sourceByteCount': len(raw[source]), 'mode': mode,
                     'boundary': boundary, 'renderedSha256': digest(rendered.encode('utf-8')),
                     'parts': parts, 'authorities': [dict(source=p, sha256=sha) for p, sha in authorities]})

    for position, source in enumerate(transition.ORDER, 1):
        value = raw[source]
        text = value.decode('utf-8')
        rendered = transition.reconstruct(source, value, raw[transition.AUTHORITY])
        boundary = {'stage': 'foundation', 'afterOrdinal': 77, 'position': position}
        if source == transition.DB1:
            if rendered.encode() != value:
                raise ValueError('RESIDUAL_DISPOSITION_WHOLE_SOURCE_CHANGED')
            parts = partition(value, [(0, len(value), 'COPY_ORIGINAL_SQL')])
            append(source, rendered, parts, boundary, 'WHOLE_ORIGINAL_AT_REVIEWED_BOUNDARY')
        elif source == transition.INTAKE:
            if value.count(b'ro.role_key') != 1 or rendered.encode() != value.replace(b'ro.role_key', b'ro.key'):
                raise ValueError('RESIDUAL_DISPOSITION_ROLE_COLUMN_MISMATCH')
            start = value.index(b'ro.role_key')
            parts = changed_span(value, start, start + len(b'ro.role_key'), 'CANONICAL_ROLE_COLUMN_REFERENCE')
            append(source, rendered, parts, boundary, 'GUARDED_RECONSTRUCTION')
        else:
            old = transition.function(text)
            parts = changed_span(value, byte_offset(text, old.start()), byte_offset(text, old.end()),
                                 'SUPERSEDED_ROLE_FUNCTION_PRESERVE_CANONICAL_IDENTITY_AND_ACL')
            append(source, rendered, parts, boundary, 'GUARDED_RECONSTRUCTION',
                   [(transition.AUTHORITY, pins[transition.AUTHORITY])])

    source = readiness.LOCKS
    text = readiness.verified(source, raw[source])
    parts = partition(raw[source], [(0, len(raw[source]), 'COPY_ORIGINAL_SQL')])
    append(source, text, parts, {'stage': 'foundation', 'beforeOrdinal': order.index(readiness.BEFORE_LOCKS) + 1},
           'WHOLE_ORIGINAL_AT_REVIEWED_BOUNDARY')

    source = readiness.READINESS
    text = raw[source].decode('utf-8')
    projection = readiness.projection(text)
    parts = changed_span(raw[source], byte_offset(text, projection.start(2)), byte_offset(text, projection.end(2)),
                         'COMPATIBLE_VIEW_PROJECTION_PRESERVE_IDENTITY_ACL_AND_RANKING')
    append(source, readiness.reconstruct(raw[source], raw[transition.DB1]), parts,
           {'stage': 'foundation', 'afterOrdinal': order.index(readiness.AFTER_READINESS) + 1},
           'GUARDED_RECONSTRUCTION', [(transition.DB1, pins[transition.DB1])])

    for position, source in enumerate((db2.PREFLIGHT, db2.FINISH), 1):
        spans, offset = [], 0
        for _, _, kind, value in db2.partition(source, raw[source]):
            disposition = {'documentation': 'DOCUMENTATION', 'schema': 'COPY_ORIGINAL_SCHEMA_SQL',
                           'operator': 'EXCLUDED_HISTORICAL_OPERATOR_DDL_AND_DATA',
                           'strict_indexes': 'STRICT_ORIGINAL_INDEX_DDL_WITH_GUARDED_PREDECESSOR_TRANSITION',
                           'schema_check': 'STRICT_ORIGINAL_SCHEMA_POSTCONDITION'}[kind]
            spans.append((offset, offset + len(value), disposition))
            offset += len(value)
        append(source, db2.reconstruct(source, raw[source]), partition(raw[source], spans),
               {'stage': 'foundation', 'afterOrdinal': 144, 'position': position},
               'CANONICAL_SCHEMA_WITH_EXPLICIT_OPERATOR_SEPARATION',
               [(preimage, db2.INVITE_PREIMAGE_SHA256)] if source == db2.PREFLIGHT else [])

    return {'schemaVersion': 1, 'scope': 'CANONICAL_SOURCE_DISPOSITIONS_NOT_DATABASE_ACCEPTANCE',
            'foundationSha256': FOUNDATION_SHA256,
            'implementationSha256': {p: digest(exact_file(root, 'scripts/' + p)) for p in (*MODULES, *EXECUTORS)},
            'sources': rows, 'historicalOperatorProgramExecuted': False,
            'sqlExecutionVerified': False, 'ledgerProvenanceVerified': False,
            'completeReplayVerified': False, 'generatedTypesVerified': False}


def verify(root=ROOT):
    root = Path(root)
    candidate = build(root)
    recorded = unique_json(exact_file(root, MANIFEST))
    # JSON equality must retain scalar types: Python otherwise equates False
    # with 0, and 1 with 1.0. None/numbers are not acceptance booleans.
    canonical = lambda value: json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)
    if canonical(recorded) != canonical(candidate):
        raise ValueError('RESIDUAL_DISPOSITION_REVIEW_CONTRACT_MISMATCH')
    if len(candidate['sources']) != 7 or len({r['source'] for r in candidate['sources']}) != 7:
        raise ValueError('RESIDUAL_DISPOSITION_SOURCE_SET_MISMATCH')
    return candidate


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--emit-review-candidate', action='store_true')
    args = parser.parse_args()
    print(json.dumps(build() if args.emit_review_candidate else verify(), indent=2, sort_keys=True))
