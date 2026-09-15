"""Source-query witnesses for exactly five changed views on an owned full replay.

No database, SQL, source-selection or expected-hash override is accepted.
The parent retains native Runner/real-ledger admission. This helper compares
source definitions and catalog settings, never actor access or business rows.
"""
import hashlib
import json
from pathlib import Path
import re
import secrets
import subprocess

import canonical_native_historical_prefix as p
import canonical_policy_actor_qualification as actors

ROOT=Path(__file__).resolve().parents[1]
SELECTION='quality/audits/PR310_CHANGED_VIEW_DISPOSITIONS_2026-09-15.json'
SELECTION_SHA='adaee88b661a56b89592ecd706f9305a2ed06cefccade188c2ea375981138bb1'
import ast
import canonical_added_view_witness as added
COMPARATOR=added.COMPARATOR
COMPARATOR_SHA=added.COMPARATOR_SHA
HARDENING=added.HARDENING
TRANSITION='scripts/canonical-residual-readiness-transitions.py'
TRANSITION_SHA='24a696b02fbe73d5ab290f03fc27802986cf6d6c388de07fca8a39a42651a39e'
ROW_KEYS=added.ROW_KEYS


def sha(value):
    raw=value if type(value) is bytes else json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()
    return hashlib.sha256(raw).hexdigest()


def selection(raw):
    if type(raw) is not bytes or sha(raw)!=SELECTION_SHA:
        raise ValueError('CHANGED_VIEW_WITNESS_SOURCE_REQUIRED')
    document=json.loads(raw)
    return tuple(dict(row, name=row['identity'][1], source=row['sourceQuery']['path'],
        sourceSha256=document['sources'][row['sourceQuery']['path']]['sha256'],
        declarationLine=row['sourceQuery']['declarationLine'],
        queryBytes=row['sourceQuery']['queryBytes'], querySha256=row['sourceQuery']['querySha256'],
        proposedReloptions=row['expectedRelationShape']['reloptions'],
        observedRelationSha256=row['replaySha256']) for row in document['records'])


def pins(views):
    return {SELECTION:SELECTION_SHA,**dict(sorted({
        COMPARATOR:COMPARATOR_SHA, HARDENING:added.AUTHORITY[HARDENING],
        TRANSITION:TRANSITION_SHA,
        **{row['source']:row['sourceSha256'] for row in views}}.items()))}


def read(root,name):
    path=Path(root)/name
    if path.resolve()!=path or not path.is_file() or path.stat().st_size>2_000_000:
        raise ValueError('CHANGED_VIEW_WITNESS_SOURCE_REQUIRED')
    return path.read_bytes()


def retain(root):
    try:
        views=selection(read(root,SELECTION))
        retained=tuple((name,read(root,name)) for name in pins(views))
        contract(retained)
        return retained
    except (OSError,UnicodeError):
        raise ValueError('CHANGED_VIEW_WITNESS_SOURCE_REQUIRED') from None


def extract(source,spec,transition):
    """Bind queries to immutable declarations, including two historical branches.

    The actor projection is exactly the existing retained transition. Historical
    inner stars are intentionally retained; a different final-schema expansion
    must fail the existing observed hash, never silently receive a new hash.
    """
    if spec['ordinal']==1:
        declaration='create view public.canonical_internal_contract_offers_v'
        if source.count(declaration)!=1:raise ValueError('CHANGED_VIEW_WITNESS_SOURCE_REQUIRED')
        source=source.replace(declaration,declaration.replace('create view','create or replace view'))
    if spec['ordinal']==3:
        assignments={node.targets[0].id:node.value for node in ast.parse(transition).body
            if isinstance(node,ast.Assign) and isinstance(node.targets[0],ast.Name)}
        columns=ast.literal_eval(assignments['COLUMNS'])
        pattern=ast.literal_eval(assignments['PROJECTION'])
        matches=list(re.finditer(pattern,source,re.S))
        if len(matches)!=1:raise ValueError('CHANGED_VIEW_WITNESS_SOURCE_REQUIRED')
        match=matches[0]
        source=source[:match.start(2)]+',\n'.join('        ranked.'+c for c in (*columns,'runtime_rank'))+source[match.end(2):]
    if spec['ordinal']==4:
        query=spec['sourceQuery']['query']
        for header in ('create view','create or replace view'):
            if source.count("execute '"+header+' public.ediel_unresolved_messages as '+query+"';")!=1:
                raise ValueError('CHANGED_VIEW_WITNESS_SOURCE_REQUIRED')
    else:
        query=added.extract(source,spec)
    if (query!=spec['sourceQuery']['query'] or len(query.encode())!=spec['queryBytes']
            or sha(query.encode())!=spec['querySha256']):
        raise ValueError('CHANGED_VIEW_WITNESS_SOURCE_REQUIRED')
    return query


def contract(retained):
    if (type(retained) is not tuple or not retained or any(type(x) is not tuple or len(x)!=2
            or type(x[0]) is not str or type(x[1]) is not bytes for x in retained)
            or retained[0][0]!=SELECTION):
        raise ValueError('CHANGED_VIEW_WITNESS_SOURCE_REQUIRED')
    views=selection(retained[0][1]);expected=pins(views)
    if (tuple(name for name,_ in retained)!=tuple(expected)
            or any(sha(raw)!=expected[name] for name,raw in retained)):
        raise ValueError('CHANGED_VIEW_WITNESS_SOURCE_REQUIRED')
    sources=dict(retained)
    # This is the actual capture source used by canonical-full-schema-reference,
    # not a guessed pg_get_viewdef formatting mode.
    comparator=sources[COMPARATOR].decode()
    if ("pg_get_viewdef(c.oid, true)" not in comparator
            or 'to_jsonb(x) - \'oid\'' not in comparator
            or 'order by option collate "C"' not in comparator):
        raise ValueError('CHANGED_VIEW_WITNESS_COMPARATOR_REQUIRED')
    hardening=sources[HARDENING].decode()
    if "alter view public.%I set (security_invoker = true)" not in hardening:
        raise ValueError('CHANGED_VIEW_WITNESS_SOURCE_REQUIRED')
    return tuple(dict(row,query=extract(sources[row['source']].decode(),row,sources[TRANSITION].decode())) for row in views)


def relation_sql(oid,*,name=None):
    # Only witness namespace/name are normalized to the fixed public identity;
    # every other field is read from the temp view's real catalog row.
    namespace="'public'" if name is not None else 'n.nspname'
    relname="'"+name+"'" if name is not None else 'c.relname'
    return f"""(SELECT jsonb_build_object('nspname',{namespace},'relname',{relname},
      'relkind',c.relkind::text,'relrowsecurity',c.relrowsecurity,
      'relforcerowsecurity',c.relforcerowsecurity,
      'reloptions',ARRAY(SELECT option FROM unnest(c.reloptions) option ORDER BY option COLLATE "C"),
      'view_definition',CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid, true) END,
      'partition_key',CASE WHEN c.relkind='p' THEN pg_get_partkeydef(c.oid) END)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=to_regclass('{oid}'))"""


def render(specs):
    token=secrets.token_hex(12)
    sql=["""BEGIN;
SET LOCAL search_path=public,extensions;
SET LOCAL check_function_bodies=on;
DO $view_guard$ BEGIN
 IF current_user<>'postgres' OR current_setting('server_version_num')::integer/10000<>17
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CHANGED_VIEW_ENVIRONMENT_REQUIRED'; END IF;
END $view_guard$;"""]
    captures=[]
    for spec in specs:
        temp=f"gridex_view_witness_{token}_{spec['ordinal']:02d}"
        # A fresh session-local name cannot shadow any original public view.
        sql.append(f"CREATE TEMP VIEW {temp} WITH (security_invoker=true) AS {spec['query']};")
        captures.append("jsonb_build_object('ordinal',"+str(spec['ordinal'])+",'actual',"+
                        relation_sql('public.'+spec['name'])+",'witness',"+
                        relation_sql('pg_temp.'+temp,name=spec['name'])+")")
    sql.append('SELECT jsonb_build_array('+','.join(captures)+');')
    sql.append('ROLLBACK;')
    return '\n'.join(sql)


def diagnose(rows,specs):
    """Only fixed ordinal and hashes leave the owned process on mismatch."""
    if type(rows) is not list or len(rows)!=5 or len(specs)!=5:return
    differences=[]
    for entry,spec in zip(rows,specs):
        if (type(entry) is not dict or type(entry.get('ordinal')) is not int
                or entry['ordinal']!=spec['ordinal']):return
        hashes={}
        for side in ('actual','witness'):
            row=entry.get(side)
            if type(row) is not dict or set(row)!=ROW_KEYS:return
            try:hashes[side+'Sha256']=sha(row)
            except (TypeError,ValueError):return
        if any(value!=spec['observedRelationSha256'] for value in hashes.values()):
            differences.append(dict(ordinal=spec['ordinal'],expectedSha256=spec['observedRelationSha256'],**hashes))
    if differences:
        print(json.dumps(dict(stage='changed_view_source_difference',selectionSha256=SELECTION_SHA,
                              differences=differences),sort_keys=True),flush=True)


def verify_rows(rows,specs):
    if type(rows) is not list or len(rows)!=5 or len(specs)!=5:
        raise ValueError('CHANGED_VIEW_WITNESS_RELATION_REQUIRED')
    for entry,spec in zip(rows,specs):
        if (type(entry) is not dict or set(entry)!={'ordinal','actual','witness'}
                or type(entry['ordinal']) is not int or entry['ordinal']!=spec['ordinal']):
            raise ValueError('CHANGED_VIEW_WITNESS_RELATION_REQUIRED')
        for key in ('actual','witness'):
            row=entry[key]
            if (type(row) is not dict or set(row)!=ROW_KEYS
                    or row.get('reloptions')!=spec['proposedReloptions']
                    or sha(row)!=spec['observedRelationSha256']):
                raise ValueError('CHANGED_VIEW_WITNESS_RELATION_REQUIRED')
        if entry['actual']!=entry['witness']:
            raise ValueError('CHANGED_VIEW_WITNESS_RELATION_REQUIRED')


def ledger(target,database):
    result=json.loads(target.sql(database,p.LEDGER_SQL,'changed_view_ledger'))
    if type(result) is not list:raise ValueError('CHANGED_VIEW_WITNESS_LEDGER_REQUIRED')
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
    return dict(scope='SOURCE_DEFINED_CHANGED_VIEWS_NOT_ACTOR_OR_SCHEMA_ACCEPTANCE',
        verified=True,viewCount=5,sourceSelectionSha256=SELECTION_SHA,
        comparatorSha256=COMPARATOR_SHA,pgGetViewdefPretty=True,nativeTarget=native,
        views=[dict(name=s['name'],source=s['source'],sourceSha256=s['sourceSha256'],
                    querySha256=s['querySha256'],relationSha256=s['observedRelationSha256'],
                    referenceRelationSha256=s['referenceSha256'],
                    sourceWitnessMatched=True,currentRelationMatched=True) for s in specs],
        catalogAndRowsPreserved=True,ledgerUnchanged=True,temporaryViewsRolledBack=True,
        schemaAccepted=False,generatedTypesVerified=False,actorAccessAccepted=False,
        ledgerProvenanceAccepted=False)


def validate_execution_receipt(receipt,*,native):
    if type(native) is not bool or type(receipt) is not dict:
        raise ValueError('CHANGED_VIEW_WITNESS_RESULT_REQUIRED')
    # Receipts may be admitted while the portable child still holds originals
    # in its private staging directory. The immutable selection supplies every
    # exact expected receipt field; execute separately validates source bytes.
    expected=expected_receipt(selection(read(ROOT,SELECTION)),native=native)
    try:valid=receipt==expected and sha(receipt)==sha(expected)
    except (TypeError,ValueError):valid=False
    if not valid:raise ValueError('CHANGED_VIEW_WITNESS_RESULT_REQUIRED')
    return receipt


def execute_query(target,retained,progress,*,native):
    """Keep derived source literals in memory on both owned transports.

    The portable owner normally retains each SQL fixture on disk. These exact
    source queries include historical fixed literals, so a derived fixture is
    inappropriate there. Its existing privacy inspection stays unchanged.
    """
    database,actual_native=actors._admit(target)
    if actual_native is not native:
        raise ValueError('CHANGED_VIEW_WITNESS_OWNED_TARGET_REQUIRED')
    actors._complete(progress,native)
    sql=render(contract(retained))
    if native:
        return target.sql(database,sql,'changed_view_source_witness',transaction=False)
    controller=actors._controller()
    legacy=controller.load_batch()
    if (type(target) is not legacy.OwnedPostgres
            or getattr(target.command,'__func__',None) is not legacy.OwnedPostgres.command
            or getattr(target.verify_logging,'__func__',None) is not legacy.OwnedPostgres.verify_logging):
        raise ValueError('CHANGED_VIEW_WITNESS_OWNED_TARGET_REQUIRED')
    target.verify_logging()
    args=target.command(database,(),transaction=False)+['-f','-']
    result=subprocess.run(args,input=sql.encode(),capture_output=True,timeout=120,
                          env=legacy.clean_environment())
    actors._admit(target)
    target.verify_logging()
    receipt=legacy.safe_receipt(result.stderr.decode(errors='replace'),result.returncode,'changed_view_source_witness')
    if receipt['sqlstate']!='00000' or result.returncode!=0:
        raise ValueError('CHANGED_VIEW_WITNESS_EXECUTION_REQUIRED')
    return result.stdout.decode()


def execute(target,retained,progress):
    """Parent supplies full Runner admission for native; this checks owned target
    and every admitted forward receipt in both modes, preserving ledger rows separately.
    """
    specs=contract(retained)
    try:database,native=actors._admit(target)
    except Exception:raise ValueError('CHANGED_VIEW_WITNESS_OWNED_TARGET_REQUIRED') from None
    actors._complete(progress,native)
    if 'changedViewSourceWitness' in progress:
        raise ValueError('CHANGED_VIEW_WITNESS_ONCE_REQUIRED')
    report=dict(scope='SOURCE_DEFINED_CHANGED_VIEWS_NOT_ACTOR_OR_SCHEMA_ACCEPTANCE',
                verified=False,schemaAccepted=False,generatedTypesVerified=False,actorAccessAccepted=False)
    progress['changedViewSourceWitness']=report
    before=actors._snapshot(target,database,native)
    prior=ledger(target,database)
    try:
        try:
            rows=json.loads(execute_query(target,retained,progress,native=native))
            diagnose(rows,specs)
            verify_rows(rows,specs)
        except Exception:
            raise ValueError('CHANGED_VIEW_WITNESS_EXECUTION_REQUIRED') from None
    finally:
        try:
            if (actors._admit(target)!=(database,native)
                    or actors._snapshot(target,database,native)!=before
                    or ledger(target,database)!=prior or not sources_preserved(retained,native=native)):
                raise ValueError('CHANGED_VIEW_WITNESS_PRESERVATION_REQUIRED')
        except Exception:
            raise ValueError('CHANGED_VIEW_WITNESS_PRESERVATION_REQUIRED') from None
    report.update(expected_receipt(specs,native=native))
    return report
