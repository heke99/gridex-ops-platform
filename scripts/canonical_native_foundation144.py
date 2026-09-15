"""Finish the admitted foundation selection on the parent's owned native fixture.

Seven canonical CLI execution units cover the exact 78–144 selection and all
seven already-reviewed residual dispositions at their prescribed boundaries.
Historical files and their source manifests are not rewritten or marked applied.
Each unit is atomic with its *canonical* ledger entry; the six simple outer
transactions at90/91/96/97/104/143 is transferred explicitly. Complete schema/row equivalence
still requires the independent end-to-end release gates, never this receipt.
"""
from dataclasses import dataclass, field
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import time
from types import SimpleNamespace

import canonical_native_historical_prefix as prefix
import canonical_native_repair_envelope as repair
import canonical_native_provider_events as provider

ROOT = Path(__file__).resolve().parents[1]
SUPPORT_PINS = {'gridex-replay-input-accounting.py': 'e20fbb6a9d5529e4aaf5f14f7267f15844514d9fe150c46188f0e1d0842f3311', 'canonical-residual-source-admission.py': 'dbab0875ca58b29b5e21992ac33fa7bf7497cbe33759e485a6f91560ff11517c', 'canonical-residual-transitions.py': 'aaefda1f6be936017c416120a8ba0932d9ebda0dd51731f30ab358640dff06cd', 'canonical-residual-readiness-transitions.py': '24a696b02fbe73d5ab290f03fc27802986cf6d6c388de07fca8a39a42651a39e', 'canonical-db2-reconstruction.py': 'e072f3ed0b1c10153a6f889d88ca03279e665426fcdda00469e5d39841fbe33f', 'canonical-residual-source-restoration.py': '3e153f40c20cb18a9d968dc0b1fb2d09b5a6e6aad882c4731ec54645ceafc33c', 'canonical-residual-index-effects.py': '71a26a96c7c2f47c5ecf7923bf38bf4709fe44de0e2c8d20d4bb0e66e7f9f455'}
OUTER_ORDINALS = frozenset((90,91,96,97,104,143))
KINDS = ('residual77','foundation78_99','residual99','foundation100_125',
         'residual125','foundation126_144','residual144')
NAME = r'gridex_native_foundation_0[1-7]_[a-f0-9]{12}'
TIMEOUTS = b"SET LOCAL lock_timeout='10s';\nSET LOCAL statement_timeout='5min';\n"
BOUNDARY = """IF (SELECT count(*) FROM pg_temp.native_foundation_context
 WHERE stage='complete' AND backend=pg_backend_pid() AND txid=txid_current()
 AND database_name=current_database())<>1
 OR EXISTS(SELECT FROM pg_temp.native_foundation_locks l WHERE NOT EXISTS
   (SELECT FROM pg_locks WHERE pid=pg_backend_pid() AND relation=l.relation AND mode=l.mode AND granted))
 OR current_setting('lock_timeout')::interval<>interval '10 seconds'
 OR current_setting('statement_timeout')::interval<>interval '5 minutes'
 OR NOT EXISTS(SELECT FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory'
   AND classid=20260910 AND objid=140053 AND objsubid=2 AND granted)
 THEN RAISE EXCEPTION 'NATIVE_FOUNDATION_BOUNDARY_REQUIRED' USING ERRCODE='P1489'; END IF;
"""
DROP_GUARD = """BEGIN;
DROP TRIGGER gridex_native_foundation_guard ON supabase_migrations.schema_migrations;
DROP FUNCTION gridex_native_foundation_probe.reject_ledger();
DROP SCHEMA gridex_native_foundation_probe;
SELECT pg_catalog.to_json(true); COMMIT;
"""


def load(name):
    if name not in SUPPORT_PINS:
        raise ValueError('NATIVE_FOUNDATION_SOURCE_REQUIRED')
    path=ROOT/'scripts'/name
    if path.resolve()!=path or not path.is_file() or prefix.sha(path.read_bytes())!=SUPPORT_PINS[name]:
        raise ValueError('NATIVE_FOUNDATION_SOURCE_REQUIRED')
    spec=importlib.util.spec_from_file_location('foundation144_'+name.replace('-','_'),path)
    module=importlib.util.module_from_spec(spec)
    sys.modules[spec.name]=module
    try:spec.loader.exec_module(module)
    finally:sys.modules.pop(spec.name,None)
    return module


def read_source(name,pins):
    if type(name) is not str or name not in pins:
        raise ValueError('NATIVE_FOUNDATION_SOURCE_REQUIRED')
    path=ROOT/'supabase'/name
    if (Path(name).is_absolute() or '..' in Path(name).parts or path.resolve()!=path
            or not path.is_file() or any(p.is_symlink() for p in path.parents)):
        raise ValueError('NATIVE_FOUNDATION_SOURCE_REQUIRED')
    raw=path.read_bytes()
    if prefix.sha(raw)!=pins[name]:raise ValueError('NATIVE_FOUNDATION_SOURCE_REQUIRED')
    return raw


def source_inventory():
    accounting=load('gridex-replay-input-accounting.py')
    result=accounting.account(ROOT)
    if result['errors']:raise ValueError('NATIVE_FOUNDATION_SOURCE_REQUIRED')
    order=json.loads((ROOT/'scripts/gridex-aud-003-foundation-order.json').read_text())['foundation']
    if (len(order)!=144 or len(set(order))!=144 or
        prefix.sha(json.dumps(order,separators=(',',':')).encode())!=prefix.ORDER_SHA):
        raise ValueError('NATIVE_FOUNDATION_SOURCE_REQUIRED')
    pins={m['path']:m['sha256'] for m in result['migrations']}
    for name in accounting.PLANS:
        for path,entry in accounting.read_json(ROOT/'scripts'/name).get('derivedBootstrap',{}).items():
            if path in pins and pins[path]!=entry['artifactSha256']:
                raise ValueError('NATIVE_FOUNDATION_SOURCE_REQUIRED')
            pins[path]=entry['artifactSha256']
    for path in order:read_source(path,pins)
    return order,pins


@dataclass(frozen=True)
class Step:
    source: str
    source_sha256: str
    ordinal: int | None
    rendered: bytes = field(repr=False)
    sql: bytes = field(repr=False)
    outer_transaction_transferred: bool
    postconditions: str = field(default='',repr=False)

    @property
    def rendered_sha256(self):return prefix.sha(self.rendered)

    def receipt(self):
        return {'source':self.source,'sourceSha256':self.source_sha256,'ordinal':self.ordinal,
                'renderedSha256':self.rendered_sha256,'executionBodySha256':prefix.sha(self.sql),
                'outerTransactionTransferredToCli':self.outer_transaction_transferred,
                'boundedPostconditionsIncluded':bool(self.postconditions)}


@dataclass(frozen=True)
class Group:
    kind: str
    index: int
    end: int
    steps: tuple = field(repr=False)


@dataclass(frozen=True)
class Program:
    index: int
    sql: bytes = field(repr=False)

    @property
    def name(self):return f'gridex_native_foundation_{self.index:02d}_'+prefix.sha(self.sql)[:12]



def atomic_body(raw):
    """Transfer a simple outer transaction; all LOCKs execute inside render's DO.

    This is separate from first43's four-source standalone-LOCK adapter. Only
    the finite source/derived programs admitted by prepare() reach this helper.
    Native mid/body/ledger faults must qualify this enclosing transaction.
    """
    text=raw.decode('utf-8');parsed=prefix.statements(text)
    words=[tuple(t[0].upper() for t in st) for st in parsed]
    outer=words[0] in (('BEGIN',),('BEGIN','TRANSACTION'),('BEGIN','WORK')) and words[-1] in (('COMMIT',),('END',))
    inside=parsed[1:-1] if outer else parsed
    for statement in inside:
        first=statement[0][0].upper()
        if first in ('BEGIN','START','COMMIT','END','ROLLBACK','ABORT','SAVEPOINT','RELEASE','SET','RESET'):
            raise ValueError('NATIVE_FOUNDATION_TRANSACTION_REQUIRED')
        if tuple(t[0].upper() for t in statement[:2])==('ALTER','SYSTEM'):
            raise ValueError('NATIVE_FOUNDATION_TRANSACTION_REQUIRED')
    if not inside:raise ValueError('NATIVE_FOUNDATION_TRANSACTION_REQUIRED')
    return ((text[inside[0][0][1]:inside[-1][-1][2]]+';\n').encode() if outer else raw),outer



def index_checks(module,source,raw):
    query=module.oracle(source,raw)
    final="SELECT jsonb_agg(jsonb_build_object('index',index_name,'matches',matches) ORDER BY index_name) FROM pg_temp.gridex_index_effects;"
    if query.count(final)!=1 or not query.endswith(final):
        raise ValueError('NATIVE_FOUNDATION_SOURCE_REQUIRED')
    return query[:-len(final)]+"""DO $native_index_effects$ BEGIN
 IF EXISTS(SELECT FROM pg_temp.gridex_index_effects WHERE matches IS DISTINCT FROM true)
 THEN RAISE EXCEPTION 'INDEX_SOURCE_EFFECT_MISMATCH' USING ERRCODE='23514'; END IF;
 END $native_index_effects$;
 DROP TABLE pg_temp.gridex_index_effects;
"""


def prepare():
    order,pins=source_inventory()
    admission=load('canonical-residual-source-admission.py').verify(ROOT)
    transition=load('canonical-residual-transitions.py')
    readiness=load('canonical-residual-readiness-transitions.py')
    db2=load('canonical-db2-reconstruction.py')
    restored=load('canonical-residual-source-restoration.py')
    indexes=load('canonical-residual-index-effects.py')
    restored.validate_selection(order)
    records={s['source']:s for s in admission['sources']}
    rulebook=read_source(restored.RULEBOOK_COMPLETION,pins)
    authority=read_source(transition.AUTHORITY,pins)
    db1=read_source(transition.DB1,pins)

    def step(source,ordinal=None):
        raw=read_source(source,pins)
        if ordinal is not None:
            if order[ordinal-1]!=source:raise ValueError('NATIVE_FOUNDATION_SOURCE_REQUIRED')
            rendered=raw
        elif source in transition.ORDER:
            rendered=transition.reconstruct(source,raw,authority).encode()
        elif source==readiness.LOCKS:rendered=raw
        elif source==readiness.READINESS:rendered=readiness.reconstruct(raw,db1).encode()
        elif source in (db2.PREFLIGHT,db2.FINISH):rendered=db2.reconstruct(source,raw).encode()
        else:raise ValueError('NATIVE_FOUNDATION_SOURCE_REQUIRED')
        if ordinal is None and (records[source]['sourceSha256']!=pins[source]
                or records[source]['renderedSha256']!=prefix.sha(rendered)):
            raise ValueError('NATIVE_FOUNDATION_SOURCE_REQUIRED')
        body,outer=atomic_body(rendered)
        # The reviewed foundation tail has no session-setting statements or
        # interior commits. Do not silently broaden this atomic grouping later.
        if outer!=(ordinal in OUTER_ORDINALS or source==readiness.LOCKS) or any(s[0].upper() in ('SET','RESET') for s in prefix.identity(body.decode())):
            raise ValueError('NATIVE_FOUNDATION_TRANSACTION_REQUIRED')
        checks=''
        if source in indexes.PINS:checks+=index_checks(indexes,source,raw)
        if source in restored.FOUNDATION_SOURCES:
            checks+=''.join(restored.assertion(e) for e in restored.checks(source,rulebook_bytes=rulebook))
        if ordinal==88:
            checks+=restored.assertion(restored.column('ediel_field_rules','allowed_values','text[]'))
            checks+=restored.assertion(restored.rulebook_seed_check('ediel_field_rules',True,source_bytes=rulebook))
        return Step(source,pins[source],ordinal,rendered,body,outer,checks)

    definitions=(('residual77',77,tuple(step(s) for s in transition.ORDER)),
      ('foundation78_99',99,tuple(step(order[i-1],i) for i in range(78,100))),
      ('residual99',99,(step(readiness.LOCKS),)),
      ('foundation100_125',125,tuple(step(order[i-1],i) for i in range(100,126))),
      ('residual125',125,(step(readiness.READINESS),)),
      ('foundation126_144',144,tuple(step(order[i-1],i) for i in range(126,145))),
      ('residual144',144,(step(db2.PREFLIGHT),step(db2.FINISH))))
    # Exact residual boundary admission is separate from rendered SQL equality.
    expected_boundaries=[{'stage':'foundation','afterOrdinal':77,'position':p} for p in (1,2,3)]
    expected_boundaries += [{'stage':'foundation','beforeOrdinal':100},
                           {'stage':'foundation','afterOrdinal':125}]
    expected_boundaries += [{'stage':'foundation','afterOrdinal':144,'position':p} for p in (1,2)]
    if [r['boundary'] for r in admission['sources']]!=expected_boundaries:
        raise ValueError('NATIVE_FOUNDATION_SOURCE_REQUIRED')
    return tuple(Group(k,i,end,steps) for i,(k,end,steps) in enumerate(definitions,1))


# One native-only environment transfer for the immutable portable DB2 adapter.
# The source algorithm, index preimage validation and the portable renderer stay
# unchanged. The genuine original target rejection is executed before this path.
DB2_PREFLIGHT = 'migrations/01_db2_full_view_preflight_schema_and_functions.sql'
DB2_SOURCE_SHA = '4de50050384d6892612c16484de8b198785c59cbb5d2ff03e7cea7e600d36cc9'
DB2_PORTABLE_TARGET = "IF current_database() NOT IN ('gridex_auth_legacy_replay', 'gridex_auth_legacy_atomic') THEN"
DB2_NATIVE_TARGET = """IF current_user<>'postgres' OR current_database()<>'postgres'
 OR (SELECT count(*) FROM pg_temp.native_foundation_context
     WHERE stage='started' AND backend=pg_backend_pid() AND txid=txid_current()
       AND database_name=current_database())<>1 THEN"""
DB2_TARGET_REASON = 'DB2_INVITATION_INDEX_OWNED_DATABASE_REQUIRED'


def native_body(step, *, portable=False):
    if step.source!=DB2_PREFLIGHT:
        return step.sql
    if (step.ordinal is not None or step.source_sha256!=DB2_SOURCE_SHA
            or step.sql.count(DB2_PORTABLE_TARGET.encode())!=1):
        raise ValueError('NATIVE_FOUNDATION_SOURCE_REQUIRED')
    if portable:
        return step.sql
    return step.sql.replace(DB2_PORTABLE_TARGET.encode(),DB2_NATIVE_TARGET.encode(),1)


def render(group,*,failure=None):
    if (group.kind not in KINDS or KINDS.index(group.kind)+1!=group.index
            or not group.steps or failure not in (None,'mid','post','ledger','portable')
            or (failure=='portable' and group.kind!='residual144')):
        raise ValueError('NATIVE_FOUNDATION_PROGRAM_REQUIRED')
    pieces=["""IF current_user<>'postgres' OR current_database()<>'postgres'
 OR current_setting('check_function_bodies')<>'on'
 THEN RAISE EXCEPTION 'NATIVE_FOUNDATION_ENVIRONMENT_REQUIRED' USING ERRCODE='P1489'; END IF;
 PERFORM pg_advisory_xact_lock(20260910,140053);
 CREATE TEMP TABLE native_foundation_locks(relation oid,mode text) ON COMMIT DROP;
 CREATE TEMP TABLE native_foundation_context(stage text,backend integer,txid bigint,database_name text) ON COMMIT DROP;
 INSERT INTO native_foundation_context VALUES('started',pg_backend_pid(),txid_current(),current_database());
"""]
    for i,s in enumerate(group.steps,1):
        label=f'{s.ordinal:04d}' if s.ordinal is not None else f'R{group.index:02d}{i}'
        tag=f'$native_foundation_source_{group.index}_{i}$'
        if tag in s.sql.decode() or '$native_foundation$' in s.sql.decode():
            raise ValueError('NATIVE_FOUNDATION_PROGRAM_REQUIRED')
        # Preserve SQLSTATE but return only a fixed stage identifier publicly.
        # pgconn's primary error string omits HINT. Retain only the fixed,
        # allowlisted DB2 reason in MESSAGE as well; never concatenate SQLERRM.
        # Raw diagnostics from the native CLI stay in the parent's private logs.
        text=native_body(s,portable=failure=='portable').decode()
        pieces.append('BEGIN\nEXECUTE '+tag+text+tag+';\n'
            +s.postconditions+"\nEXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE=SQLSTATE,"
            +" MESSAGE='NATIVE_FOUNDATION_STAGE_"+label+"' || CASE"
            +" WHEN SQLSTATE='55000' AND SQLERRM='DB2_INVITATION_INDEX_OWNED_DATABASE_REQUIRED'"
            +" THEN ' REASON=DB2_INVITATION_INDEX_OWNED_DATABASE_REQUIRED' ELSE '' END,"
            +" HINT=CASE WHEN SQLERRM='DB2_INVITATION_INDEX_OWNED_DATABASE_REQUIRED'"
            +" THEN 'DB2_INVITATION_INDEX_OWNED_DATABASE_REQUIRED' ELSE 'NATIVE_SOURCE_ERROR' END; END;\n")
        if failure=='mid' and i==1:
            pieces.append("RAISE EXCEPTION 'NATIVE_FOUNDATION_MID_FAULT' USING ERRCODE='P1480';")
            break
    pieces.append("INSERT INTO pg_temp.native_foundation_locks SELECT relation,mode FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='relation' AND granted;\nUPDATE pg_temp.native_foundation_context SET stage='complete';\n"+BOUNDARY)
    if failure in ('post','ledger'):
        pieces.append(f'ALTER TABLE public.gridex_native_lifecycle_probe ADD COLUMN foundation{group.index}_rollback_marker integer;\n'
                      f'INSERT INTO public.gridex_native_lifecycle_probe(id) VALUES({144000+group.index});\n')
    if failure=='post':pieces.append("RAISE EXCEPTION 'NATIVE_FOUNDATION_POST_FAULT' USING ERRCODE='P1481';")
    raw=TIMEOUTS+('DO $native_foundation$ BEGIN\n'+'\n'.join(pieces)+'\nEND $native_foundation$;\n').encode()
    if len(raw)>prefix.MAX_SQL:raise ValueError('NATIVE_FOUNDATION_PROGRAM_REQUIRED')
    return Program(group.index,raw)


def failure_diagnostic(stderr):
    # CLI error output can append the entire failing SQL statement. A token in
    # that excerpt is not evidence of an executed exception. Bind the reason,
    # stage and SQLSTATE to one complete primary pgconn error line instead.
    primary=re.findall(rb'^ERROR:[^\r\n]*',stderr,re.MULTILINE)
    diagnostic=primary[0] if primary else stderr
    state=re.search(rb'SQLSTATE[ :]+([A-Z0-9]{5})\b',diagnostic)
    stage=re.search(rb'NATIVE_FOUNDATION_STAGE_(\d{4}|R0[1-7][1-3])\b',diagnostic)
    result={'sqlstate':state[1].decode() if state else None,'stage':stage[1].decode() if stage else None}
    if len(primary)==1 and re.fullmatch(
            rb'ERROR: NATIVE_FOUNDATION_STAGE_R071 '
            rb'REASON=DB2_INVITATION_INDEX_OWNED_DATABASE_REQUIRED \(SQLSTATE 55000\)',
            primary[0]):
        result['reason']=DB2_TARGET_REASON
    return result


def ledger_guard(name):
    if re.fullmatch(NAME,name) is None:raise ValueError('NATIVE_FOUNDATION_PROGRAM_REQUIRED')
    return ("BEGIN; CREATE SCHEMA gridex_native_foundation_probe;\n"
     "REVOKE ALL ON SCHEMA gridex_native_foundation_probe FROM PUBLIC,anon,authenticated,service_role;\n"
     "CREATE FUNCTION gridex_native_foundation_probe.reject_ledger() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $guard$ BEGIN\n"
     "IF NEW.name IS DISTINCT FROM '"+name+"' THEN RAISE EXCEPTION 'WRONG_PROBE' USING ERRCODE='P1489'; END IF;\n"
     +BOUNDARY+"RAISE EXCEPTION 'NATIVE_FOUNDATION_LEDGER_FAULT' USING ERRCODE='P1482'; END $guard$;\n"
     "REVOKE ALL ON FUNCTION gridex_native_foundation_probe.reject_ledger() FROM PUBLIC,anon,authenticated,service_role;\n"
     "CREATE TRIGGER gridex_native_foundation_guard BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION gridex_native_foundation_probe.reject_ledger();\n"
     "SELECT pg_catalog.to_json(true); COMMIT;")


def predecessor(p,sql,work,parent):
    required={'historicalLegacy52':52,'historicalRepair56':56,'historicalDedupe57':57,
              'historicalFixed63':63,'historicalAlignment68':68,'historicalOperations77':77}
    if (type(parent.get('foundationInputsExecuted')) is not int or parent['foundationInputsExecuted']!=77
        or any(parent.get(k,{}).get('verified') is not True or
               parent[k].get('cumulativeFoundationInputsExecuted')!=n for k,n in required.items())
        or parent.get('historicalPrefix',{}).get('historicalPrefixLedgerVerified') is not True):
        raise ValueError('NATIVE_FOUNDATION_PREFIX_REQUIRED')
    first=parent['historicalPrefix']['canonicalExecutionUnits']
    units=[*first,parent['historicalLegacy52'],parent['historicalRepair56'],parent['historicalDedupe57'],
           *parent['historicalFixed63']['canonicalExecutionUnits'],parent['historicalAlignment68'],
           *parent['historicalOperations77']['groups']]
    if len(units)!=57 or len(first)!=43:
        raise ValueError('NATIVE_FOUNDATION_PREFIX_REQUIRED')
    directory=work/'supabase/migrations'
    if directory.resolve()!=directory or not directory.is_dir() or directory.stat().st_mode&0o077:
        raise ValueError('NATIVE_FOUNDATION_PREFIX_REQUIRED')
    actual=sql(p.LEDGER_SQL)
    if type(actual) is not list or len(actual)!=58:
        raise ValueError('NATIVE_FOUNDATION_PREFIX_REQUIRED')
    units=[{'cliFile':parent['successfulMigration'],'programSha256':parent['executedSqlSha256']},*units]
    if {f.name for f in directory.iterdir()}!={u['cliFile'] for u in units}:
        raise ValueError('NATIVE_FOUNDATION_PREFIX_REQUIRED')
    retained=[]
    for entry,u in zip(actual,units):
        path=directory/u['cliFile']
        if not path.is_file() or path.is_symlink():raise ValueError('NATIVE_FOUNDATION_PREFIX_REQUIRED')
        raw=path.read_bytes();m=path.lstat();p.verify_private(path,raw,(m.st_dev,m.st_ino))
        if p.sha(raw)!=u['programSha256']:raise ValueError('NATIVE_FOUNDATION_PREFIX_REQUIRED')
        p.verify_entry(entry,path.name,SimpleNamespace(name=entry['name'],sql=raw))
        if 'ledgerStatementsSha256' in u and p.sha(json.dumps(entry['statements'],separators=(',',':')).encode())!=u['ledgerStatementsSha256']:
            raise ValueError('NATIVE_FOUNDATION_PREFIX_REQUIRED')
        retained.append((path,raw,(m.st_dev,m.st_ino)))
    # Receipt assertions cannot replace source readback on the current checkout.
    order,pins=source_inventory()
    sources=[*first,*parent['historicalLegacy52']['sources'],*parent['historicalRepair56']['sources'],
       *parent['historicalDedupe57']['sources'],*parent['historicalFixed63']['sources'],
       *parent['historicalAlignment68']['sources'],
       *(s for g in parent['historicalOperations77']['groups'] for s in g['sources'])]
    if (len(sources)!=77 or [s['ordinal'] for s in sources]!=list(range(1,78))
        or [s['source'] for s in sources]!=order[:77]
        or any(s['sourceSha256']!=pins[s['source']] for s in sources)):
        raise ValueError('NATIVE_FOUNDATION_PREFIX_REQUIRED')
    return directory,copy.deepcopy(actual),retained


def create_unit(p,native,directory,program,entries,files):
    time.sleep(1.05)
    native('migration','new',program.name)
    current={f.name for f in directory.iterdir()};added=current-files
    if len(added)!=1 or not files<=current:raise ValueError('NATIVE_FOUNDATION_LEDGER_REQUIRED')
    path=directory/next(iter(added))
    if (re.fullmatch(r'\d{14}_'+re.escape(program.name)+r'\.sql',path.name) is None
            or path.name[:14]<=entries[-1]['version']):
        raise ValueError('NATIVE_FOUNDATION_LEDGER_REQUIRED')
    physical=p.private_write(path,program.sql);p.verify_private(path,program.sql,physical)
    return path,physical


def execute(p,native,sql,work,parent):
    directory,entries,retained=predecessor(p,sql,work,parent)
    if 'historicalFoundation144' in parent:raise ValueError('NATIVE_FOUNDATION_PREFIX_REQUIRED')
    report=dict(scope='NATIVE_FOUNDATION_RECONSTRUCTION_EXECUTION_NOT_FULL_SCHEMA_ACCEPTANCE',
      executed=False,groups=[],foundationInputsExecuted=0,cumulativeFoundationInputsExecuted=77,
      residualInputsExecuted=0,timestampInputsExecuted=0,completeReplayVerified=False,
      generatedTypesVerified=False,sequenceValuesRollbackClaimed=False,
      originalHistoricalVersionsMarkedApplied=False,fullSourceEffectsAccepted=False)
    parent['historicalFoundation144']=report
    groups=prepare();batch,_=repair.load_sources(p)
    provider.require(sql,parent['providerEventBootstrap'])
    settings=','.join("'"+k+"'" for k in p.SETTINGS)
    if sql("SELECT jsonb_build_object('role',current_user,'database',current_database(),'settings',"
      "(SELECT jsonb_object_agg(name,setting) FROM pg_settings WHERE name IN ("+settings+")));")!={
        'role':'postgres','database':'postgres','settings':p.SETTINGS}:
        raise ValueError('NATIVE_FOUNDATION_PREFIX_REQUIRED')
    def snapshot():
        def digest(value):return p.sha(json.dumps(value,sort_keys=True,separators=(',',':')).encode())
        return {'catalog':digest(sql(repair.catalog_sql(batch))),
                'rows':digest(sql(repair.previous.ROWS_SQL)),
                'sequenceValues':digest(sql(repair.SEQUENCES_SQL)),
                'providerEvents':digest(sql(provider.QUERY))}
    for group in groups:
        state=dict(kind=group.kind,index=group.index,phase='TRANSACTION_QUALIFICATION',executed=False,cases=[])
        report['groups'].append(state)
        controls=((('portable','55000'),) if group.kind=='residual144' else ()) + (('mid','P1480'),('post','P1481'),('ledger','P1482'))
        for mode,expected in controls:
            program=render(group,failure=mode);before=snapshot();files={f.name for f in directory.iterdir()}
            state.update(currentProbe=expected)
            path,physical=create_unit(p,native,directory,program,entries,files);installed=False
            try:
                if mode=='ledger':
                    if sql(ledger_guard(program.name)) is not True:raise ValueError('NATIVE_FOUNDATION_LEDGER_REQUIRED')
                    installed=True
                result=native('migration','up','--local',allow_failure=True,timeout=420)
                p.verify_private(path,program.sql,physical)
                for item in retained:p.verify_private(*item)
                observed=failure_diagnostic(result.stderr)
                if (result.returncode==0 or observed['sqlstate']!=expected
                        or (mode=='portable' and (observed.get('stage')!='R071'
                            or observed.get('reason')!=DB2_TARGET_REASON))):
                    state['failure']=observed
                    raise ValueError('NATIVE_FOUNDATION_PROOF_REQUIRED')
                if sql(p.LEDGER_SQL)!=entries:raise ValueError('NATIVE_FOUNDATION_LEDGER_REQUIRED')
            finally:
                if installed and sql(DROP_GUARD) is not True:raise ValueError('NATIVE_FOUNDATION_CLEANUP_REQUIRED')
                p.verify_private(path,program.sql,physical);path.unlink()
            after=snapshot()
            if (any(before[k]!=after[k] for k in ('catalog','rows','providerEvents'))
                    or {f.name for f in directory.iterdir()}!=files):
                raise ValueError('NATIVE_FOUNDATION_ROLLBACK_REQUIRED')
            state['cases'].append(dict(expectedSqlstate=expected,programSha256=p.sha(program.sql),
                 catalogAndRowsRestored=True,ledgerUnchanged=True,
                 sequenceValuesChanged=before['sequenceValues']!=after['sequenceValues']))
        state['phase']='CANONICAL_CLI_EXECUTION'
        # Recompile from pinned authorities, not from a prior SQL callback.
        fresh=prepare()[group.index-1];program=render(fresh)
        if fresh!=group:raise ValueError('NATIVE_FOUNDATION_SOURCE_REQUIRED')
        path,physical=create_unit(p,native,directory,program,entries,{f.name for f in directory.iterdir()})
        retained.append((path,program.sql,physical))
        result=native('migration','up','--local',allow_failure=True,timeout=420)
        for item in retained:p.verify_private(*item)
        actual=sql(p.LEDGER_SQL)
        if result.returncode:
            state['failure']=failure_diagnostic(result.stderr)
            if actual!=entries:raise ValueError('NATIVE_FOUNDATION_LEDGER_REQUIRED')
            raise ValueError('NATIVE_FOUNDATION_EXECUTION_REQUIRED')
        if type(actual) is not list or len(actual)!=len(entries)+1 or actual[:-1]!=entries:
            raise ValueError('NATIVE_FOUNDATION_LEDGER_REQUIRED')
        p.verify_entry(actual[-1],path.name,program)
        before=snapshot();native('migration','up','--local',timeout=420)
        if sql(p.LEDGER_SQL)!=actual or snapshot()!=before:
            raise ValueError('NATIVE_FOUNDATION_REPEAT_REQUIRED')
        for item in retained:p.verify_private(*item)
        n=sum(s.ordinal is not None for s in group.steps)
        report['foundationInputsExecuted']+=n;report['residualInputsExecuted']+=len(group.steps)-n
        report['cumulativeFoundationInputsExecuted']=group.end
        parent['foundationInputsExecuted']=group.end
        state.update(executed=True,phase='EXECUTED_AND_LEDGER_VERIFIED',cliFile=path.name,
             programSha256=p.sha(program.sql),sources=[{**s.receipt(),
                 'nativeExecutionBodySha256':p.sha(native_body(s)),
                 'nativeEnvironmentAdmissionTransferred':s.source==DB2_PREFLIGHT} for s in group.steps],
             ledgerStatementsSha256=p.sha(json.dumps(actual[-1]['statements'],separators=(',',':')).encode()),
             noOpRepeatVerified=True,unchangedEarlierLedger=True,canonicalUnitAtomic=True,
             transactionControlsVerified=True,fullSourceEffectsAccepted=False)
        entries=actual
    if report['foundationInputsExecuted']!=67 or report['residualInputsExecuted']!=7:
        raise ValueError('NATIVE_FOUNDATION_SOURCE_REQUIRED')
    report.update(executed=True,phase='ALL_FOUNDATION_INPUTS_EXECUTED_NOT_FULL_ACCEPTANCE',
                  canonicalExecutionUnitCount=7,supportSha256=dict(SUPPORT_PINS))
    return report
