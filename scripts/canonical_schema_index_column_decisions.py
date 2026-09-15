"""Exact positive dispositions for51 removed indexes and14 changed columns.

Immutable source review supplies decisions; observed inventory supplies none.
No performance, actor, type or complete-schema acceptance is emitted here.
"""
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]
INDEX='quality/audits/PR310_SCHEMA_INDEX_DISPOSITIONS_2026-09-15.md'
COLUMN='quality/audits/PR310_SCHEMA_COLUMN_REMAINDER_2026-09-15.md'
DECISION='quality/audits/PR310_SCHEMA_REMAINING_GRANT_INDEX_DECISIONS_2026-09-15.md'
BASE_PINS={
    INDEX:'21d55f19a9c2345236934cf1d7558ce7b078d2267e07927ee572584084f126e8',
    COLUMN:'afc1c52696528e1462f34b93d82f9c9adfb845e3650303ca5fedb781042affea',
    DECISION:'85b637772daa29b615158b1a6c60c6cc7631d5a43c88778533014d2dfc63d6fa',
    'supabase/schema.sql':'b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30',
}
DECISIONS={
    'E':'PRESERVE_EXACT_RENAMED_INDEX_SURVIVOR',
    'ER':'PRESERVE_UNCHANGED_EXACT_INDEX_SURVIVOR',
    'P':'PRESERVE_SOURCE_LEADING_KEY_ACCESS_PATH_NO_COST_EQUIVALENCE',
    'PN':'PRESERVE_SOURCE_NON_NULL_PARTIAL_ACCESS_PATH',
    'OPEN':'PRESERVE_SOURCE_NONUNIQUE_INDEX_ABSENCE_NO_PERFORMANCE_CLAIM',
}


def sha(value):
    raw=value if type(value) is bytes else json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()
    return hashlib.sha256(raw).hexdigest()


def read(path):
    full=ROOT/path
    if full.resolve()!=full or not full.is_file() or full.stat().st_size>8_000_000:
        raise ValueError('SCHEMA_INDEX_COLUMN_SOURCE_REQUIRED')
    return full.read_bytes()


def source_pins(base):
    result=dict(BASE_PINS)
    for name in (INDEX,COLUMN,DECISION):
        if name not in base or sha(base[name])!=BASE_PINS[name]:
            raise ValueError('SCHEMA_INDEX_COLUMN_SOURCE_REQUIRED')
        for line in base[name].decode().splitlines():
            match=re.fullmatch(r'- `([^`]+\.sql)`: `([0-9a-f]{64})`\.',line)
            if match: filename,digest=match.groups()
            elif line.startswith('| `'):
                cells=[cell.strip().strip('`') for cell in line.strip('|').split('|')]
                if not cells[0].endswith('.sql') or not re.fullmatch('[0-9a-f]{64}',cells[-1]):continue
                filename,digest=cells[0],cells[-1]
            else:continue
            if not re.fullmatch(r'[A-Za-z0-9_.+ -]+\.sql',filename):
                raise ValueError('SCHEMA_INDEX_COLUMN_SOURCE_REQUIRED')
            path='supabase/migrations/'+filename
            if path in result and result[path]!=digest:
                raise ValueError('SCHEMA_INDEX_COLUMN_SOURCE_REQUIRED')
            result[path]=digest
    return result


def retain():
    base={name:read(name) for name in BASE_PINS}
    return tuple((path,base[path] if path in base else read(path)) for path in source_pins(base))


def index_row(definition):
    match=re.fullmatch(r'CREATE (UNIQUE )?INDEX ([a-z_0-9]+) ON public\.([a-z_0-9]+) USING btree (.+)',definition)
    if match is None:raise ValueError('SCHEMA_INDEX_COLUMN_DEFINITION_REQUIRED')
    unique,name,table,_=match.groups()
    return dict(nspname='public',relname=table,indexname=name,definition=definition,
                indisunique=unique is not None,indisprimary=False)


def contract(retained):
    if (type(retained) is not tuple or any(type(r) is not tuple or len(r)!=2
            or type(r[0]) is not str or type(r[1]) is not bytes for r in retained)):
        raise ValueError('SCHEMA_INDEX_COLUMN_SOURCE_REQUIRED')
    sources=dict(retained);pins=source_pins(sources)
    if tuple(sources)!=tuple(pins) or len(sources)!=len(retained) or any(sha(sources[n])!=h for n,h in pins.items()):
        raise ValueError('SCHEMA_INDEX_COLUMN_SOURCE_REQUIRED')
    index=sources[INDEX].decode();column=sources[COLUMN].decode();schema=sources['supabase/schema.sql'].decode().splitlines()
    positive=sources[DECISION].decode()
    if ('No functional defect was established in these 56 index deltas.' not in positive
            or '**preserve the observed replay shape; no attribute correction is justified by this\nreview.**' not in column):
        raise ValueError('SCHEMA_INDEX_COLUMN_POSITIVE_DECISION_REQUIRED')
    mapping=index.split('## All removed indexes\n',1)[1].split('## Exact replacement definitions',1)[0]
    removed_hashes=dict(re.findall(r'^- `([^`]+)`: SHA256 `([0-9a-f]{64})`\.',
        index.split('## Removed definition hashes and creation provenance\n',1)[1].split('## Five changed definitions',1)[0],re.M))
    replacements={}
    for name,definition,digest in re.findall(r'^- `([^`]+)`: `(CREATE [^`]+)`; SHA256 `([0-9a-f]{64})`\.',
            index.split('## Exact replacement definitions and sources\n',1)[1].split('## Removed definition hashes',1)[0],re.M):
        row=index_row(definition)
        if row['indexname']!=name or sha(row)!=digest or name in replacements:
            raise ValueError('SCHEMA_INDEX_COLUMN_DEFINITION_REQUIRED')
        replacements[name]=dict(identity=['public',row['relname'],name],sha256=digest)
    records=[];survivors=[];classes=[]
    for name,line,kind,survivor in re.findall(r'^\| `([^`]+)` / ([0-9]+) \| [^|]+ \| (E|ER|P|PN|OPEN)(?: → `([^`]+)`)? \|$',mapping,re.M):
        definition=schema[int(line)-1]
        if not definition.endswith(';'):raise ValueError('SCHEMA_INDEX_COLUMN_DEFINITION_REQUIRED')
        row=index_row(definition[:-1]);digest=removed_hashes.get(name)
        if row['indexname']!=name or sha(row)!=digest:
            raise ValueError('SCHEMA_INDEX_COLUMN_DEFINITION_REQUIRED')
        records.append(dict(section='indexes',change='removed',identity=['public',row['relname'],name],sha256=digest,
            decision=DECISIONS[kind],decisionSourceSha256=BASE_PINS[DECISION],witness='nativeFinalSql'))
        classes.append(kind)
        if kind!='OPEN':
            if survivor not in replacements:raise ValueError('SCHEMA_INDEX_COLUMN_SURVIVOR_REQUIRED')
            survivors.append(dict(replacements[survivor],change='unchanged' if kind=='ER' else 'added'))
        elif survivor:raise ValueError('SCHEMA_INDEX_COLUMN_SURVIVOR_REQUIRED')
    if len(records)!=51 or len(removed_hashes)!=51 or Counter(classes)!=dict(E=25,ER=1,P=22,PN=1,OPEN=2):
        raise ValueError('SCHEMA_INDEX_COLUMN_SCOPE_REQUIRED')
    column_hashes={name:(before,after) for name,before,after in re.findall(
        r'^\| `([a-z_0-9]+\.[a-z_0-9]+)` \| `([0-9a-f]{64})` \| `([0-9a-f]{64})` \|$',column,re.M)}
    count=0
    for name,datatype,before,after in re.findall(
            r'^\| `([a-z_0-9]+\.[a-z_0-9]+)` \| `(text|uuid|jsonb)` \| ([^|]+) \| ([^|]+) \|$',column,re.M):
        table,attribute=name.split('.');rows=[]
        for shape in (before,after):
            ordinal,nullable,default=shape.split('; ')
            if nullable not in ('NULL','NOT NULL'):raise ValueError('SCHEMA_INDEX_COLUMN_DEFINITION_REQUIRED')
            rows.append(dict(nspname='public',relname=table,attnum=int(ordinal),attname=attribute,
                data_type=datatype,udt_name=datatype,is_nullable=nullable=='NULL',
                column_default='' if default=='—' else default.strip('`'),identity='',generated=''))
        if tuple(sha(row) for row in rows)!=column_hashes.get(name):
            raise ValueError('SCHEMA_INDEX_COLUMN_DEFINITION_REQUIRED')
        fields=sorted(key for key in rows[0] if rows[0][key]!=rows[1][key])
        if not fields or not set(fields)<= {'attnum','is_nullable','column_default'} or fields==['attnum']:
            raise ValueError('SCHEMA_INDEX_COLUMN_SCOPE_REQUIRED')
        records.append(dict(section='columns',change='changed',identity=['public',table,attribute],fields=fields,
            referenceSha256=sha(rows[0]),replaySha256=sha(rows[1]),
            decision='PRESERVE_REVIEWED_SOURCE_COLUMN_NULLABILITY_AND_DEFAULT',
            decisionSourceSha256=BASE_PINS[COLUMN],witness='nativeFinalSql'))
        count+=1
    if count!=14 or len(column_hashes)!=14 or len({(r['section'],tuple(r['identity'])) for r in records})!=65:
        raise ValueError('SCHEMA_INDEX_COLUMN_SCOPE_REQUIRED')
    return tuple(records),tuple(survivors)


def approved():
    return contract(retain())[0]


def validate_context(diff):
    """Require the specific survivor evidence on which the decisions depend."""
    _,survivors=contract(retain())
    try:
        sections=diff['sections']['indexes']
        for survivor in survivors:
            expected={k:survivor[k] for k in ('identity','sha256')}
            if survivor['change']=='added':
                if sections['added'].count(expected)!=1:
                    raise ValueError('SCHEMA_INDEX_COLUMN_SURVIVOR_REQUIRED')
            elif any(row['identity']==survivor['identity'] for change in ('added','removed','changed') for row in sections[change]):
                raise ValueError('SCHEMA_INDEX_COLUMN_SURVIVOR_REQUIRED')
    except (KeyError,TypeError):
        raise ValueError('SCHEMA_INDEX_COLUMN_SURVIVOR_REQUIRED') from None


def validate_execution_receipt(receipt,*,native):
    from canonical_native_final_sql import PINS
    expected=dict(scope='POST_REPLAY_SQL_NOT_SCHEMA_OR_TYPE_ACCEPTANCE',verified=True,
        checks=[dict(source=path,sourceSha256=digest,verified=True,catalogAndRowsPreserved=True,ledgerUnchanged=True)
                for path,digest in PINS.items()],schemaAccepted=False,generatedTypesVerified=False)
    if native is not True or type(receipt) is not dict or receipt!=expected or sha(receipt)!=sha(expected):
        raise ValueError('SCHEMA_INDEX_COLUMN_NATIVE_FINAL_SQL_REQUIRED')
    for path,digest in PINS.items():
        if sha(read(path))!=digest:raise ValueError('SCHEMA_INDEX_COLUMN_SOURCE_REQUIRED')
    return receipt
