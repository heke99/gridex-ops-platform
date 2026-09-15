"""Exactly five changed indexes: pinned source recreation and predicate behavior.

DDL and fixture rows exist only on fresh empty temporary clones and roll back.
No reference replacement, performance assertion or schema acceptance is made.
"""
import hashlib
import json
from pathlib import Path
import re
import secrets
import subprocess
import canonical_added_view_witness as added
import canonical_native_historical_prefix as p
import canonical_policy_actor_qualification as actors

ROOT=Path(__file__).resolve().parents[1]
SELECTION='quality/audits/PR310_SCHEMA_INDEX_DISPOSITIONS_2026-09-15.md'
SELECTION_SHA='21d55f19a9c2345236934cf1d7558ce7b078d2267e07927ee572584084f126e8'
COMPARATOR=added.COMPARATOR
COMPARATOR_SHA=added.COMPARATOR_SHA
SOURCE_PINS={
 'supabase/migrations/20260519_operations_core_saas_sync.sql':'e5863b15ec8c25794912b50c36eda6a370f3fb288800339a0bcfb16f2a3bb619',
 'supabase/migrations/20260519_customer_intake_contracts_tenant_hardening.sql':'a448184e58e8777c41f8bdefb32e45a1365bd37fd9a8e316065da657e57e19f4',
 'supabase/migrations/20260521_batch_customer_intake_debug_hardening.sql':'562c2447554c43a3aef96bbbcd88a9f36ad1cc884ba97268ca96bc455ec54e80',
 'supabase/migrations/20260528_final_user_access_schema_safe_repair.sql':'4968391d74a8ff813ce1f56a8b8d9ade682692d183988917e736d0f3c5857bd2',
}
SOURCES=tuple(SOURCE_PINS)
IDENTITIES=(('customers_company_customer_number_idx','customers',0,58),
 ('customers_company_email_idx','customers',1,208),
 ('customers_company_email_lower_idx','customers',2,45),
 ('customers_company_intake_status_idx','customers',2,43),
 ('user_roles_company_user_role_active_uidx','user_roles',3,51))
# Exact source bodies bind receipts even while portable originals are staged away.
STATEMENT_SHAS=('a99d830715b88f02b55415b0fb487a1d76d6a637282e6948b0933a9e3f256772',
 '40b9d8622728baca12eb04746adf6fb99cf429519199c2c36bd0498b7f05ab17',
 '7545f79f8cab90739438d822031e5fcb5292ba57c82508efa60cf9c40aa9754a',
 'd74d4dbbf136cf37b8bdfb03946f156172f41af9f5b6688596b7cb004a1f5c7d',
 'f24a465f5e5ab3307579f7bd6bd8ca3ed9c0434a0a3fbbd400d864438ff193ea')
ROW_KEYS={'nspname','relname','indexname','definition','indisunique','indisprimary'}
sha=added.sha
read=added.read


def selection(raw):
    if type(raw) is not bytes or sha(raw)!=SELECTION_SHA:
        raise ValueError('CHANGED_INDEX_WITNESS_SOURCE_REQUIRED')
    section=raw.decode().split('## Five changed definitions\n',1)[1].split('## Changed-definition dispositions',1)[0]
    parts=re.findall(r'### ([a-z_]+)\n(.*?)(?=\n### |\Z)',section,re.S)
    if [name for name,_ in parts]!=[x[0] for x in IDENTITIES]:
        raise ValueError('CHANGED_INDEX_WITNESS_SOURCE_REQUIRED')
    specs=[]
    for ordinal,((name,text),(_,table,source_id,line)) in enumerate(zip(parts,IDENTITIES),1):
        hashes=re.findall(r'SHA256 `([0-9a-f]{64})`',text)
        definitions=re.findall(r'```sql\n([^`]+);\n```',text)
        if len(hashes)!=2 or len(definitions)!=2:
            raise ValueError('CHANGED_INDEX_WITNESS_SOURCE_REQUIRED')
        unique=ordinal==5
        rows=[dict(nspname='public',relname=table,indexname=name,definition=d,
                   indisunique=unique,indisprimary=False) for d in definitions]
        if [sha(row) for row in rows]!=hashes:
            raise ValueError('CHANGED_INDEX_WITNESS_SOURCE_REQUIRED')
        specs.append(dict(ordinal=ordinal,name=name,table=table,source=SOURCES[source_id],
            sourceSha256=SOURCE_PINS[SOURCES[source_id]],declarationLine=line,unique=unique,
            referenceSha256=hashes[0],observedSha256=hashes[1],expectedRow=rows[1],
            statementSha256=STATEMENT_SHAS[ordinal-1]))
    return tuple(specs)


def retain(root):
    pins={SELECTION:SELECTION_SHA,COMPARATOR:COMPARATOR_SHA,**SOURCE_PINS}
    retained=tuple((name,read(root,name)) for name in pins)
    contract(retained)
    return retained


def extract(source,spec):
    pattern=r'create\s+(?:unique\s+)?index\s+if\s+not\s+exists\s+'+spec['name']+r'\b'
    matches=list(re.finditer(pattern,source,re.I))
    if len(matches)!=1 or source[:matches[0].start()].count('\n')+1!=spec['declarationLine']:
        raise ValueError('CHANGED_INDEX_WITNESS_SOURCE_REQUIRED')
    start=matches[0].start()
    for end in re.finditer(';',source[start:]):
        statement=source[start:start+end.end()]
        try:tokens=p.sql_tokens(statement)
        except p.PrefixError:continue
        if tokens[-1][0]==';':break
    else:raise ValueError('CHANGED_INDEX_WITNESS_SOURCE_REQUIRED')
    if sha(statement.encode())!=spec['statementSha256']:
        raise ValueError('CHANGED_INDEX_WITNESS_SOURCE_REQUIRED')
    match=re.fullmatch(r'create\s+(unique\s+)?index\s+if\s+not\s+exists\s+'
        +spec['name']+r'\s+on\s+public\.'+spec['table']+r'\s*(\(.*);',statement,re.I|re.S)
    if not match or bool(match[1]) is not spec['unique']:
        raise ValueError('CHANGED_INDEX_WITNESS_SOURCE_REQUIRED')
    return statement,match[2]


def contract(retained):
    pins={SELECTION:SELECTION_SHA,COMPARATOR:COMPARATOR_SHA,**SOURCE_PINS}
    if (type(retained) is not tuple or len(retained)!=len(pins)
            or any(type(x) is not tuple or len(x)!=2 or type(x[0]) is not str or type(x[1]) is not bytes for x in retained)
            or tuple(n for n,_ in retained)!=tuple(pins)
            or any(sha(raw)!=pins[n] for n,raw in retained)):
        raise ValueError('CHANGED_INDEX_WITNESS_SOURCE_REQUIRED')
    sources=dict(retained)
    if 'pg_get_indexdef(i.indexrelid) as definition' not in sources[COMPARATOR].decode():
        raise ValueError('CHANGED_INDEX_WITNESS_SOURCE_REQUIRED')
    specs=selection(sources[SELECTION]);result=[]
    for spec in specs:
        statement,body=extract(sources[spec['source']].decode(),spec)
        result.append(dict(spec,statement=statement,body=body))
    return tuple(result)


def capture(spec,index_name,*,temporary=False):
    target='pg_temp.'+index_name if temporary else 'public.'+spec['name']
    # pg_get_indexdef always qualifies the indexed relation. Only its exact
    # generated identity prefix is normalized, never keys/predicates/options.
    prefix="format('CREATE %sINDEX %I ON %I.%I USING ',CASE WHEN i.indisunique THEN 'UNIQUE ' ELSE '' END,ic.relname,n.nspname,c.relname)"
    raw='pg_get_indexdef(i.indexrelid)'
    canonical='CREATE '+('UNIQUE ' if spec['unique'] else '')+'INDEX '+spec['name']+' ON public.'+spec['table']+' USING '
    definition=(f"CASE WHEN left({raw},length({prefix}))={prefix} THEN '{canonical}'||substr({raw},length({prefix})+1) END"
                if temporary else raw)
    nspname="'public'" if temporary else 'n.nspname'
    relname="'"+spec['table']+"'" if temporary else 'c.relname'
    name="'"+spec['name']+"'" if temporary else 'ic.relname'
    row=f"jsonb_build_object('nspname',{nspname},'relname',{relname},'indexname',{name},'definition',{definition},'indisunique',i.indisunique,'indisprimary',i.indisprimary)"
    state="jsonb_build_object('valid',i.indisvalid,'ready',i.indisready,'live',i.indislive)"
    source=f" FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indexrelid=to_regclass('{target}')"
    return '(SELECT '+row+source+')','(SELECT '+state+source+')'


def behavior_sql(table):
    # LIKE does not include defaults, indexes, FKs, checks or triggers here.
    # It does copy NOT NULL; remove it on this fresh clone only to exercise all
    # source predicate branches, including nullable index keys.
    return f"""DO $index_behavior$
DECLARE col record; status_value text; active_value boolean;
 company_value uuid; user_value uuid; role_value uuid; null_key integer;
 included boolean; cases integer:=0; rejected integer:=0; allowed integer:=0;
BEGIN
 FOR col IN SELECT attname FROM pg_attribute
  WHERE attrelid=to_regclass('pg_temp.{table}') AND attnum>0 AND NOT attisdropped AND attnotnull
 LOOP EXECUTE format('ALTER TABLE pg_temp.%I ALTER COLUMN %I DROP NOT NULL','{table}',col.attname); END LOOP;
 FOR status_value,active_value,null_key IN
  SELECT s,a,0 FROM unnest(ARRAY[NULL::text,'active','disabled']) s
   CROSS JOIN unnest(ARRAY[NULL::boolean,true,false]) a
  UNION ALL SELECT 'active',true,k FROM generate_series(1,3) k
 LOOP
  cases:=cases+1;
  company_value:=CASE WHEN null_key=1 THEN NULL ELSE '00000000-0000-4000-8000-000000000101'::uuid END;
  user_value:=CASE WHEN null_key=2 THEN NULL ELSE '00000000-0000-4000-8000-000000000102'::uuid END;
  role_value:=CASE WHEN null_key=3 THEN NULL ELSE '00000000-0000-4000-8000-000000000103'::uuid END;
  included:=null_key=0 AND (status_value IS NULL OR status_value='active')
   AND (active_value IS NULL OR active_value=true);
  DELETE FROM pg_temp.{table};
  INSERT INTO pg_temp.{table}(company_id,user_id,role_id,status,is_active)
   VALUES(company_value,user_value,role_value,status_value,active_value);
  BEGIN
   INSERT INTO pg_temp.{table}(company_id,user_id,role_id,status,is_active)
    VALUES(company_value,user_value,role_value,status_value,active_value);
   IF included THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CHANGED_INDEX_DUPLICATE_ADMITTED'; END IF;
   allowed:=allowed+1;
  EXCEPTION WHEN unique_violation THEN
   IF NOT included THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CHANGED_INDEX_EXCLUDED_DUPLICATE_REJECTED'; END IF;
   rejected:=rejected+1;
  END;
  IF (SELECT count(*) FROM pg_temp.{table})<>CASE WHEN included THEN 1 ELSE 2 END
   THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CHANGED_INDEX_FIXTURE_ROWS_REQUIRED'; END IF;
 END LOOP;
 IF cases<>12 OR rejected<>4 OR allowed<>8
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CHANGED_INDEX_CASES_REQUIRED'; END IF;
END $index_behavior$;"""


def render(specs):
    token=secrets.token_hex(12)
    sql=["""BEGIN;
SET LOCAL search_path=public,extensions;
SET LOCAL check_function_bodies=on;
DO $index_guard$ BEGIN
 IF current_user<>'postgres' OR current_setting('server_version_num')::integer/10000<>17
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CHANGED_INDEX_ENVIRONMENT_REQUIRED'; END IF;
END $index_guard$;"""]
    captures=[]
    for spec in specs:
        table=f"gridex_idx_table_{token}_{spec['ordinal']}"
        index=f"gridex_idx_witness_{token}_{spec['ordinal']}"
        sql.append(f"CREATE TEMP TABLE {table} (LIKE public.{spec['table']});")
        sql.append('CREATE '+('UNIQUE ' if spec['unique'] else '')+f"INDEX {index} ON pg_temp.{table} "+spec['body']+';')
        if spec['unique']:sql.append(behavior_sql(table))
        actual,actual_state=capture(spec,index)
        witness,witness_state=capture(spec,index,temporary=True)
        captures.append(f"jsonb_build_object('ordinal',{spec['ordinal']},'actual',{actual},'witness',{witness},'actualState',{actual_state},'witnessState',{witness_state},'behaviorCases',{12 if spec['unique'] else 0})")
    sql.append('SELECT jsonb_build_array('+','.join(captures)+');')
    sql.append('ROLLBACK;')
    return '\n'.join(sql)


def diagnose(rows,specs):
    if type(rows) is not list or len(rows)!=5 or len(specs)!=5:return
    differences=[]
    for row,spec in zip(rows,specs):
        if type(row) is not dict or type(row.get('ordinal')) is not int or row['ordinal']!=spec['ordinal']:return
        hashes={}
        for side in ('actual','witness'):
            value=row.get(side)
            if type(value) is not dict or set(value)!=ROW_KEYS:return
            try:hashes[side+'Sha256']=sha(value)
            except (ValueError,TypeError):return
        if any(value!=spec['observedSha256'] for value in hashes.values()):
            differences.append(dict(ordinal=spec['ordinal'],expectedSha256=spec['observedSha256'],**hashes))
    if differences:
        print(json.dumps(dict(stage='changed_index_source_difference',selectionSha256=SELECTION_SHA,
                              differences=differences),sort_keys=True),flush=True)


def verify_rows(rows,specs):
    if type(rows) is not list or len(rows)!=5 or len(specs)!=5:
        raise ValueError('CHANGED_INDEX_WITNESS_CATALOG_REQUIRED')
    for row,spec in zip(rows,specs):
        if (type(row) is not dict or set(row)!={'ordinal','actual','witness','actualState','witnessState','behaviorCases'}
                or type(row['ordinal']) is not int or row['ordinal']!=spec['ordinal']
                or type(row['behaviorCases']) is not int or row['behaviorCases']!=(12 if spec['unique'] else 0)):
            raise ValueError('CHANGED_INDEX_WITNESS_CATALOG_REQUIRED')
        for side in ('actual','witness'):
            value=row[side];state=row[side+'State']
            if (type(value) is not dict or set(value)!=ROW_KEYS or value!=spec['expectedRow']
                    or sha(value)!=spec['observedSha256'] or type(state) is not dict
                    or set(state)!={'valid','ready','live'} or any(state[k] is not True for k in state)):
                raise ValueError('CHANGED_INDEX_WITNESS_CATALOG_REQUIRED')


def ledger(target,database):
    result=json.loads(target.sql(database,p.LEDGER_SQL,'changed_index_ledger'))
    if type(result) is not list:raise ValueError('CHANGED_INDEX_WITNESS_LEDGER_REQUIRED')
    return result


def sources_preserved(retained,*,native):
    contract(retained)
    if native:
        return retain(ROOT)==retained
    # The admitted portable child has moved all originals out of this directory.
    # Its parent later verifies exact restoration. Retained migration bytes stay
    # fully pinned here; only nonmigration inputs may still be read from ROOT.
    directory=ROOT/'supabase/migrations'
    if not directory.is_dir() or list(directory.glob('*.sql')):
        return False
    return all(not (ROOT/name).exists() if name.startswith('supabase/migrations/')
               else read(ROOT,name)==raw for name,raw in retained)


def expected_receipt(specs,*,native):
    return dict(scope='SOURCE_DEFINED_CHANGED_INDEXES_NOT_SCHEMA_OR_PERFORMANCE_ACCEPTANCE',
        verified=True,indexCount=5,sourceSelectionSha256=SELECTION_SHA,comparatorSha256=COMPARATOR_SHA,
        nativeTarget=native,indexes=[dict(name=s['name'],source=s['source'],sourceSha256=s['sourceSha256'],
            sourceStatementSha256=s['statementSha256'],referenceRowSha256=s['referenceSha256'],
            currentRowSha256=s['observedSha256'],sourceWitnessMatched=True,
            currentIndexValidReadyLive=True) for s in specs],
        predicateCases=12,duplicateRejectedCases=4,duplicateAllowedCases=8,
        catalogAndRowsPreserved=True,ledgerUnchanged=True,temporaryObjectsRolledBack=True,
        schemaAccepted=False,generatedTypesVerified=False,actorAccessAccepted=False,
        performanceAccepted=False,ledgerProvenanceAccepted=False)


def validate_execution_receipt(receipt,*,native):
    if type(native) is not bool or type(receipt) is not dict:
        raise ValueError('CHANGED_INDEX_WITNESS_RESULT_REQUIRED')
    expected=expected_receipt(selection(read(ROOT,SELECTION)),native=native)
    if receipt!=expected or sha(receipt)!=sha(expected):
        raise ValueError('CHANGED_INDEX_WITNESS_RESULT_REQUIRED')
    return receipt


def execute_query(target,retained,progress,*,native):
    """Keep derived source literals in memory on both owned transports.

    The portable owner normally retains each SQL fixture on disk. These exact
    source queries include historical fixed literals, so a derived fixture is
    inappropriate there. Its existing privacy inspection stays unchanged.
    """
    database,actual_native=actors._admit(target)
    if actual_native is not native:
        raise ValueError('CHANGED_INDEX_WITNESS_OWNED_TARGET_REQUIRED')
    actors._complete(progress,native)
    sql=render(contract(retained))
    if native:
        return target.sql(database,sql,'changed_index_source_witness',transaction=False)
    controller=actors._controller()
    legacy=controller.load_batch()
    if (type(target) is not legacy.OwnedPostgres
            or getattr(target.command,'__func__',None) is not legacy.OwnedPostgres.command
            or getattr(target.verify_logging,'__func__',None) is not legacy.OwnedPostgres.verify_logging):
        raise ValueError('CHANGED_INDEX_WITNESS_OWNED_TARGET_REQUIRED')
    target.verify_logging()
    args=target.command(database,(),transaction=False)+['-f','-']
    result=subprocess.run(args,input=sql.encode(),capture_output=True,timeout=120,
                          env=legacy.clean_environment())
    actors._admit(target)
    target.verify_logging()
    receipt=legacy.safe_receipt(result.stderr.decode(errors='replace'),result.returncode,'changed_index_source_witness')
    if receipt['sqlstate']!='00000' or result.returncode!=0:
        raise ValueError('CHANGED_INDEX_WITNESS_EXECUTION_REQUIRED')
    return result.stdout.decode()


def execute(target,retained,progress):
    """Parent supplies full Runner admission for native; this checks owned target
    and every admitted forward receipt in both modes, preserving ledger rows separately.
    """
    specs=contract(retained)
    try:database,native=actors._admit(target)
    except Exception:raise ValueError('CHANGED_INDEX_WITNESS_OWNED_TARGET_REQUIRED') from None
    actors._complete(progress,native)
    if 'changedIndexSourceWitness' in progress:
        raise ValueError('CHANGED_INDEX_WITNESS_ONCE_REQUIRED')
    report=dict(scope='SOURCE_DEFINED_CHANGED_INDEXES_NOT_SCHEMA_OR_PERFORMANCE_ACCEPTANCE',
                verified=False,schemaAccepted=False,generatedTypesVerified=False,actorAccessAccepted=False)
    progress['changedIndexSourceWitness']=report
    before=actors._snapshot(target,database,native)
    prior=ledger(target,database)
    try:
        try:
            rows=json.loads(execute_query(target,retained,progress,native=native))
            diagnose(rows,specs)
            verify_rows(rows,specs)
        except Exception:
            raise ValueError('CHANGED_INDEX_WITNESS_EXECUTION_REQUIRED') from None
    finally:
        try:
            if (actors._admit(target)!=(database,native)
                    or actors._snapshot(target,database,native)!=before
                    or ledger(target,database)!=prior or not sources_preserved(retained,native=native)):
                raise ValueError('CHANGED_INDEX_WITNESS_PRESERVATION_REQUIRED')
        except Exception:
            raise ValueError('CHANGED_INDEX_WITNESS_PRESERVATION_REQUIRED') from None
    report.update(expected_receipt(specs,native=native))
    return report
