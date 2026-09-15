#!/usr/bin/env python3
"""Verify the bounded added-constraint evidence register; never accepts a schema."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REGISTER = ROOT / 'quality/audits/PR310_ADDED_CONSTRAINT_INDEX_CONSTRAINTS_2026-09-15.json'
ARTIFACT_SHA256 = '0ee862d06ee0e4f33208aa33ceefe8ce5afa8c5e8ca1c9cd186f006c7364f2af'
MEMBER_SHA256 = 'aaee3685f99130f0d451ba6fe4829134873882ecf0053a38505a4b1005bf9772'
FIELDS = {'nspname', 'relname', 'conname', 'contype', 'definition', 'convalidated'}


def row_hash(row: dict) -> str:
    return hashlib.sha256(json.dumps(row, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()).hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def validate(register: dict, diff: dict, root: Path = ROOT) -> dict:
    require(register['scope'] == 'SOURCE_QUALIFIED_ADDED_CONSTRAINT_DISPOSITIONS_NOT_ACCEPTANCE_ALLOWLIST', 'scope')
    require(register['schemaAccepted'] is False and register['nativeSqlExecuted'] is False, 'acceptance_boundary')
    require(register['artifactSha256'] == ARTIFACT_SHA256 and register['artifactMemberSha256'] == MEMBER_SHA256, 'artifact_pins')
    expected = {tuple(r['identity']): r['sha256'] for r in diff['sections']['constraints']['added']}
    records = register['records']
    require(len(expected) == 211 and len(records) == register['recordCount'] == 211, 'coverage_count')
    require(len({tuple(r['identity']) for r in records}) == 211, 'duplicate_identity')
    require({tuple(r['identity']): r['sha256'] for r in records} == expected, 'exact_added_set')
    require(Counter(r['row']['contype'] for r in records) == {'c': 49, 'f': 123, 'p': 31, 'u': 8}, 'kinds')
    sources = set()
    for record in records:
        row = record['row']
        require(set(row) == FIELDS, 'row_fields')
        require([row[k] for k in ('nspname', 'relname', 'conname')] == record['identity'], 'row_identity')
        require(type(row['convalidated']) is bool and row['convalidated'], 'validated')
        require(row_hash(row) == record['sha256'], 'full_row_hash')
        sem = record['semantics']
        require(sem['catalogReconstructed'] is True and sem['schemaAccepted'] is False and sem['nativeBehaviorVerified'] is False, 'row_acceptance_boundary')
        require(bool(sem['effect']) and bool(sem['qualification']) and bool(record['sources']), 'disposition_evidence')
        for source in record['sources']:
            path = root / source['path']
            require(path.resolve().is_relative_to(root.resolve()), 'source_path')
            raw = path.read_bytes()
            require(hashlib.sha256(raw).hexdigest() == source['sourceSha256'], 'source_pin:' + source['path'])
            lines = raw.decode().splitlines()
            require(type(source['line']) is int and 1 <= source['line'] <= len(lines), 'source_line')
            require(lines[source['line'] - 1] == source['lineText'], 'source_line_text')
            sources.add(source['path'])
    for source in register['contextSources']:
        require(hashlib.sha256((root / source['path']).read_bytes()).hexdigest() == source['sourceSha256'], 'context_pin')
    require(hashlib.sha256((root / register['referenceSource']).read_bytes()).hexdigest() == register['referenceSourceSha256'], 'reference_pin')
    return {'outcome': 'SOURCE_REGISTER_VERIFIED', 'constraintRows': 211, 'authoredSourceFiles': len(sources), 'schemaAccepted': False, 'nativeSqlExecuted': False}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact', type=Path, default=ROOT.parent / 'pr310-schema-9f1ba7ae.zip')
    args = parser.parse_args()
    require(hashlib.sha256(args.artifact.read_bytes()).hexdigest() == ARTIFACT_SHA256, 'archive_pin')
    with zipfile.ZipFile(args.artifact) as archive:
        member = archive.read('full-schema-reference-diff.json')
    require(hashlib.sha256(member).hexdigest() == MEMBER_SHA256, 'member_pin')
    result = validate(json.loads(REGISTER.read_text()), json.loads(member))
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
