#!/usr/bin/env python3
"""Verify audit evidence against one retained schema ZIP; never accept a schema."""
import collections
import hashlib
import json
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT/'quality/audits/PR310_ADDED_POLICY_DISPOSITIONS_2026-09-15.json'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def verify(path):
    audit = json.loads(AUDIT.read_bytes())
    archive = Path(path).read_bytes()
    pins = [p for p in audit['artifacts'] if p['zipSha256'] == sha(archive)]
    if len(pins) != 1:
        raise ValueError('PINNED_POLICY_ARCHIVE_REQUIRED')
    with zipfile.ZipFile(path) as z:
        if z.namelist() != [pins[0]['member']]:
            raise ValueError('EXACT_POLICY_MEMBER_REQUIRED')
        raw = z.read(pins[0]['member'])
    if sha(raw) != pins[0]['memberSha256']:
        raise ValueError('PINNED_POLICY_MEMBER_REQUIRED')
    source = json.loads(raw)['sections']['policies']
    records = audit['records']
    if ([dict(identity=r['identity'], sha256=r['sha256']) for r in records] != source['added']
            or len({tuple(r['identity']) for r in records}) != 486):
        raise ValueError('EXACT_ADDED_POLICY_INVENTORY_REQUIRED')
    for record in records:
        if not record['sourceEvidenceKeys'] or not set(record['sourceEvidenceKeys']) <= set(audit['sourceEvidence']):
            raise ValueError('POLICY_SOURCE_LINEAGE_REQUIRED')
        row = record['row']
        if row is None:
            if record['rowHashVerified'] is not False:
                raise ValueError('UNRESOLVED_ROW_MUST_REMAIN_UNVERIFIED')
        elif (record['rowHashVerified'] is not True
              or [row[k] for k in ('nspname','relname','polname')] != record['identity']
              or sha(json.dumps(row,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()) != record['sha256']):
            raise ValueError('FULL_POLICY_ROW_HASH_REQUIRED')
        generated = record.get('sourceGeneratedName')
        if generated:
            value = 'public.'+generated['table']+':'+generated['action']+':'+generated['role']
            name = 'gridex_mp_'+hashlib.md5(value.encode()).hexdigest()[:20]
            if name != record['identity'][2]:
                raise ValueError('SOURCE_GENERATED_NAME_REQUIRED')
        if record['schemaAccepted'] is not False:
            raise ValueError('AUDIT_CANNOT_ACCEPT_SCHEMA')
    counts = dict(added=len(records), fullRowHashVerified=sum(r['rowHashVerified'] for r in records),
                  fullRowUnresolved=sum(r['row'] is None for r in records),
                  delegatedOverlap=sum(r['delegatedRemovedPolicyOverlap'] for r in records),
                  families=dict(collections.Counter(r['family'] for r in records)))
    if counts != audit['counts'] or counts['fullRowHashVerified'] != 486 or audit['schemaAccepted'] is not False:
        raise ValueError('EXACT_AUDIT_COUNTS_REQUIRED')
    for source in audit['sourceEvidence'].values():
        path = ROOT/source['path']
        if path.resolve() != path or sha(path.read_bytes()) != source['sha256']:
            raise ValueError('PINNED_POLICY_SOURCE_REQUIRED')
    return dict(outcome='EVIDENCE_MATCH', **counts, schemaAccepted=False, actorQualification=False)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: canonical-added-policy-disposition-check.py retained-schema.zip')
    print(json.dumps(verify(sys.argv[1]),sort_keys=True))
