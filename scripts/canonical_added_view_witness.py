"""Source-query witnesses for exactly31 added views on an owned full replay.

No database, SQL, source-selection or expected-hash override is accepted.
The parent retains native Runner/real-ledger admission. This helper compares
source definitions and catalog settings, never actor access or business rows.
"""
import hashlib
import json
from pathlib import Path
import re
import secrets

import canonical_native_historical_prefix as p
import canonical_policy_actor_qualification as actors

ROOT=Path(__file__).resolve().parents[1]
SELECTION='quality/audits/PR310_ADDED_VIEW_SOURCE_PROPOSAL_2026-09-15.json'
SELECTION_SHA='71b7fad5214234206853cc626036af26bf0e1e0094b45bc40f47b71c310f4aa0'
COMPARATOR='scripts/sql/gridex-db-parity-introspect.sql'
COMPARATOR_SHA='99b5c602223153dac69cf3266babfcffce80c889dc5375ad625c18e24fb255b0'
HARDENING='supabase/migrations/20260611190000_launch_linter_hardening_security_definer_rls.sql'
AUTHORITY={
    COMPARATOR:COMPARATOR_SHA,
    HARDENING:'b696379a5e1d26bde5fae150d7c51e9d40df029a9dfd605810ad9051b1fb74d1',
    'supabase/migrations/20260911114443_canonical_user_rbac_customer_alignment_boundary.sql':
        '80f58edf6d9a48baef4999202744040979cd7af1cc0e61b812e52369ad13aff1',
}
ROW_KEYS={'nspname','relname','relkind','relrowsecurity','relforcerowsecurity',
          'reloptions','view_definition','partition_key'}


def sha(value):
    raw=value if type(value) is bytes else json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()
    return hashlib.sha256(raw).hexdigest()


def selection(raw):
    if type(raw) is not bytes or sha(raw)!=SELECTION_SHA:
        raise ValueError('ADDED_VIEW_WITNESS_SOURCE_REQUIRED')
    return json.loads(raw)['views']


def pins(views):
    return {SELECTION:SELECTION_SHA,**dict(sorted({**AUTHORITY,**{
        row['source']:row['sourceSha256'] for row in views}}.items()))}


def read(root,name):
    path=Path(root)/name
    if path.resolve()!=path or not path.is_file() or path.stat().st_size>2_000_000:
        raise ValueError('ADDED_VIEW_WITNESS_SOURCE_REQUIRED')
    return path.read_bytes()


def retain(root):
    try:
        views=selection(read(root,SELECTION))
        retained=tuple((name,read(root,name)) for name in pins(views))
        contract(retained)
        return retained
    except (OSError,UnicodeError):
        raise ValueError('ADDED_VIEW_WITNESS_SOURCE_REQUIRED') from None


def extract(source,spec):
    """Extract one pinned CREATE body; semicolons in quoted text stay literal.

    Some declarations are inside EXECUTE $view$ without an inner semicolon.
    This lexer identifies boundaries only, never claims SQL equivalence.
    """
    matches=list(re.finditer(r'create\s+or\s+replace\s+view\s+public\.'+re.escape(spec['name'])+r'\b',source,re.I))
    if len(matches)!=1:
        raise ValueError('ADDED_VIEW_WITNESS_SOURCE_REQUIRED')
    start=matches[0].start()
    if source[:start].count('\n')+1!=spec['declarationLine']:
        raise ValueError('ADDED_VIEW_WITNESS_SOURCE_REQUIRED')
    statement=None
    wrapper=re.search(r'execute\s+(\$[A-Za-z_0-9]*\$)\s*$',source[:start],re.I)
    if wrapper:
        finish=source.find(wrapper[1],start)
        if finish<start:raise ValueError('ADDED_VIEW_WITNESS_SOURCE_REQUIRED')
        statement=source[start:finish].rstrip().removesuffix(';')+';'
    else:
        for match in re.finditer(';',source[start:]):
            candidate=source[start:start+match.end()]
            try: tokens=p.sql_tokens(candidate)
            except p.PrefixError: continue
            if tokens[-1][0]==';':
                statement=candidate
                break
    if statement is None:raise ValueError('ADDED_VIEW_WITNESS_SOURCE_REQUIRED')
    header=re.match(r'create\s+or\s+replace\s+view\s+public\.'+re.escape(spec['name'])+
                    r'\s+(?:with\s*\(security_invoker\s*=\s*true\)\s*)?as\s+',statement,re.I)
    if not header:raise ValueError('ADDED_VIEW_WITNESS_SOURCE_REQUIRED')
    query=statement[header.end():].removesuffix(';')
    tokens=p.sql_tokens(query)
    if (tokens[0][0].lower() not in ('select','with') or any(t[0]==';' for t in tokens)
            or len(query.encode())!=spec['queryBytes'] or sha(query.encode())!=spec['querySha256']):
        raise ValueError('ADDED_VIEW_WITNESS_SOURCE_REQUIRED')
    return query


def contract(retained):
    if (type(retained) is not tuple or not retained or any(type(x) is not tuple or len(x)!=2
            or type(x[0]) is not str or type(x[1]) is not bytes for x in retained)
            or retained[0][0]!=SELECTION):
        raise ValueError('ADDED_VIEW_WITNESS_SOURCE_REQUIRED')
    views=selection(retained[0][1]);expected=pins(views)
    if (tuple(name for name,_ in retained)!=tuple(expected)
            or any(sha(raw)!=expected[name] for name,raw in retained)):
        raise ValueError('ADDED_VIEW_WITNESS_SOURCE_REQUIRED')
    sources=dict(retained)
    # This is the actual capture source used by canonical-full-schema-reference,
    # not a guessed pg_get_viewdef formatting mode.
    comparator=sources[COMPARATOR].decode()
    if ("pg_get_viewdef(c.oid, true)" not in comparator
            or 'to_jsonb(x) - \'oid\'' not in comparator
            or 'order by option collate "C"' not in comparator):
        raise ValueError('ADDED_VIEW_WITNESS_COMPARATOR_REQUIRED')
    hardening=sources[HARDENING].decode()
    if "alter view public.%I set (security_invoker = true)" not in hardening:
        raise ValueError('ADDED_VIEW_WITNESS_SOURCE_REQUIRED')
    return tuple(dict(row,query=extract(sources[row['source']].decode(),row)) for row in views)


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
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ADDED_VIEW_ENVIRONMENT_REQUIRED'; END IF;
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


def verify_rows(rows,specs):
    if type(rows) is not list or len(rows)!=31 or len(specs)!=31:
        raise ValueError('ADDED_VIEW_WITNESS_RELATION_REQUIRED')
    for entry,spec in zip(rows,specs):
        if (type(entry) is not dict or set(entry)!={'ordinal','actual','witness'}
                or type(entry['ordinal']) is not int or entry['ordinal']!=spec['ordinal']):
            raise ValueError('ADDED_VIEW_WITNESS_RELATION_REQUIRED')
        for key in ('actual','witness'):
            row=entry[key]
            if (type(row) is not dict or set(row)!=ROW_KEYS
                    or row.get('reloptions')!=spec['proposedReloptions']
                    or sha(row)!=spec['observedRelationSha256']):
                raise ValueError('ADDED_VIEW_WITNESS_RELATION_REQUIRED')
        if entry['actual']!=entry['witness']:
            raise ValueError('ADDED_VIEW_WITNESS_RELATION_REQUIRED')


def ledger(target,database):
    result=json.loads(target.sql(database,p.LEDGER_SQL,'added_view_ledger'))
    if type(result) is not list:raise ValueError('ADDED_VIEW_WITNESS_LEDGER_REQUIRED')
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
    return dict(scope='SOURCE_DEFINED_ADDED_VIEWS_NOT_ACTOR_OR_SCHEMA_ACCEPTANCE',
        verified=True,viewCount=31,sourceSelectionSha256=SELECTION_SHA,
        comparatorSha256=COMPARATOR_SHA,pgGetViewdefPretty=True,nativeTarget=native,
        views=[dict(name=s['name'],source=s['source'],sourceSha256=s['sourceSha256'],
                    querySha256=s['querySha256'],relationSha256=s['observedRelationSha256'],
                    sourceWitnessMatched=True,currentRelationMatched=True) for s in specs],
        catalogAndRowsPreserved=True,ledgerUnchanged=True,temporaryViewsRolledBack=True,
        schemaAccepted=False,generatedTypesVerified=False,actorAccessAccepted=False,
        ledgerProvenanceAccepted=False)


def validate_execution_receipt(receipt,*,native):
    if type(native) is not bool or type(receipt) is not dict:
        raise ValueError('ADDED_VIEW_WITNESS_RESULT_REQUIRED')
    # Receipts may be admitted while the portable child still holds originals
    # in its private staging directory. The immutable selection supplies every
    # exact expected receipt field; execute separately validates source bytes.
    expected=expected_receipt(selection(read(ROOT,SELECTION)),native=native)
    try:valid=receipt==expected and sha(receipt)==sha(expected)
    except (TypeError,ValueError):valid=False
    if not valid:raise ValueError('ADDED_VIEW_WITNESS_RESULT_REQUIRED')
    return receipt


def execute(target,retained,progress):
    """Parent supplies full Runner admission for native; this checks owned target
    and every admitted forward receipt in both modes, preserving ledger rows separately.
    """
    specs=contract(retained)
    try:database,native=actors._admit(target)
    except Exception:raise ValueError('ADDED_VIEW_WITNESS_OWNED_TARGET_REQUIRED') from None
    actors._complete(progress,native)
    if 'addedViewSourceWitness' in progress:
        raise ValueError('ADDED_VIEW_WITNESS_ONCE_REQUIRED')
    report=dict(scope='SOURCE_DEFINED_ADDED_VIEWS_NOT_ACTOR_OR_SCHEMA_ACCEPTANCE',
                verified=False,schemaAccepted=False,generatedTypesVerified=False,actorAccessAccepted=False)
    progress['addedViewSourceWitness']=report
    before=actors._snapshot(target,database,native)
    prior=ledger(target,database)
    try:
        try:
            rows=json.loads(target.sql(database,render(specs),'added_view_source_witness',transaction=False))
            verify_rows(rows,specs)
        except Exception:
            raise ValueError('ADDED_VIEW_WITNESS_EXECUTION_REQUIRED') from None
    finally:
        try:
            if (actors._admit(target)!=(database,native)
                    or actors._snapshot(target,database,native)!=before
                    or ledger(target,database)!=prior or not sources_preserved(retained,native=native)):
                raise ValueError('ADDED_VIEW_WITNESS_PRESERVATION_REQUIRED')
        except Exception:
            raise ValueError('ADDED_VIEW_WITNESS_PRESERVATION_REQUIRED') from None
    report.update(expected_receipt(specs,native=native))
    return report
