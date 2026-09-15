#!/usr/bin/env python3
"""Reconstruct finite catalog rows only when their entire observed hash matches.

Offline hash preimage matching is evidence of catalog values, not PostgreSQL
execution, source lineage or schema acceptance. Unmatched columns stay explicit.
No arbitrary database or SQL execution is supported.
"""
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
REGISTER = ROOT/'quality/audits/PR310_SCHEMA_ACCEPTANCE_COVERAGE_2026-09-15.json'
TYPES = [('text','text'),('uuid','uuid'),('timestamp with time zone','timestamptz'),
         ('boolean','bool'),('jsonb','jsonb'),('integer','int4'),('bigint','int8'),
         ('date','date'),('numeric','numeric'),('text[]','_text'),('uuid[]','_uuid'),
         ('double precision','float8'),('smallint','int2'),('name','name'),
         ('character varying','varchar'),('timestamp without time zone','timestamp'),
         ('oid','oid'),('name[]','_name'),('numeric(5,2)','numeric'),
         ('ediel_environment_type','ediel_environment_type')]
DEFAULTS = ['', 'now()', 'gen_random_uuid()', "'{}'::jsonb", "'[]'::jsonb", "'{}'::text[]",
            'false', 'true', '0', '1', "'pending'::text", "'active'::text", "'draft'::text",
            "'open'::text", "'SE'::text", "'unknown'::text", "'not_checked'::text",
            "'gridex_billing_partner_v1'::text", "'billing_export_v4c'::text",
            "'not_queued'::text", "'missing'::text", "'invoice_pdf'::text",
            "'customer'::text", "'clear'::text", "ARRAY[]::uuid[]",
            "'agt_test'::ediel_environment_type",
            "'{\"strategy\": \"manual_retry\", \"maxAttempts\": 3}'::jsonb"]


def sha(row):
    return hashlib.sha256(json.dumps(row,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def recover(record, extra_defaults=()):
    _, table, column = record['identity']
    target = record['sha256']
    generated = 's' if column.startswith('coalesce_') else ''
    defaults = [f"COALESCE({column.removeprefix('coalesce_')}, ''::text)"] if generated else [*DEFAULTS,*extra_defaults]
    for default in dict.fromkeys(defaults):
        for dtype,udt in TYPES:
            for nullable in (True,False):
                row=dict(nspname='public',relname=table,attname=column,attnum=0,data_type=dtype,
                         udt_name=udt,is_nullable=nullable,column_default=default,identity='',generated=generated)
                raw=json.dumps(row,sort_keys=True,separators=(',',':'))
                left,right=raw.split('"attnum":0',1)
                left=(left+'"attnum":').encode();right=right.encode()
                for ordinal in range(1,241):
                    if hashlib.sha256(left+str(ordinal).encode()+right).hexdigest()==target:
                        row['attnum']=ordinal
                        assert sha(row)==target
                        return row
    return None


def reconstruct():
    register=json.loads(REGISTER.read_text())
    assert register['scope']=='REVIEW_COVERAGE_NOT_ACCEPTANCE_ALLOWLIST' and register['schemaAccepted'] is False
    records=[r for r in register['records'] if r['section']=='columns' and r['change']=='added']
    assert len(records)==937 and len({tuple(r['identity']) for r in records})==937
    columns={r['identity'][2] for r in records}
    hints={c:set() for c in columns}
    for path in (ROOT/'supabase/migrations').rglob('*.sql'):
        for line in path.read_text().splitlines():
            match=re.search(r'(?:add\s+column\s+(?:if\s+not\s+exists\s+)?)?(\w+)\s+[^,;]+?\bdefault\s+(.+)',line,re.I)
            if not match or match[1] not in hints:continue
            value=re.split(r'\s+(?:not\s+null|references|check|constraint)\b',match[2],flags=re.I)[0].rstrip(' ,;')
            if re.fullmatch(r"'[^']*'",value):value+='::text'
            if re.fullmatch(r"(?:'[^']*'(?:::[a-z\[\]]+)?)|(?:[0-9]+)|(?:[a-z_]+\(\))",value):hints[match[1]].add(value)
    results=[]
    for record in records:
        row=recover(record,sorted(hints[record['identity'][2]]))
        results.append(dict(identity=record['identity'],sha256=record['sha256'],row=row,
                            matched=row is not None,schemaAcceptance=False))
    return dict(scope='HASH_MATCHED_CATALOG_VALUES_NOT_SOURCE_OR_SCHEMA_ACCEPTANCE',
                inputRegisterSha256=hashlib.sha256(REGISTER.read_bytes()).hexdigest(),
                columns=937,matched=sum(r['matched'] for r in results),records=results,schemaAccepted=False)


if __name__=='__main__':
    if len(sys.argv)!=1:raise SystemExit('No options accepted')
    print(json.dumps(reconstruct(),sort_keys=True,indent=2))
