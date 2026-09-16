"""Finite native69–77 continuation using the independent pinned source oracles.

Three separate atomic CLI units extend the verified68 ledger. Historical bytes
and portable authorities are unchanged. Only their generated environment guard
and the known, read-only provider/catalog locks are transferred to this parent's
private db-only Supabase fixture. This is not a production-concurrency claim.
"""
from collections import Counter
from dataclasses import dataclass, field
import copy
import hashlib
import json
from pathlib import Path
import re
import time
from types import SimpleNamespace
import uuid

import canonical_native_alignment68 as previous
import canonical_native_repair_envelope as repair
import canonical_native_provider_events as provider

ROOT = Path(__file__).resolve().parents[1]
PINS = {
 'canonical-customer-operations-batch.py':'204301175320dc171cc14bd603aeaf1fbd56aa71c9ac18404441d59f6910db95',
 'canonical-customer-operations-runtime.py':'496a27dc291a12758859cc7db31e8d338895e45509200622e98ac224fbc3d99d',
 'canonical-readiness-operations-batch.py':'464858f764397ec3711b094ff4f5971f61a32ad5c98e381eed9409a9d032c3c7',
 'canonical-readiness-operations-runtime.py':'ccd552c9016ccd73f22ddf78bb31d6454ad15a5eb0ab449b5e9f7e2da60e5629',
 'canonical-intake-governance-batch.py':'c898980885b56c166ca30967a825f34cf93b4b63db818d330f76a76a69f6db1e',
 'canonical-intake-governance-runtime.py':'cee4bf7ddcecca148e0a81a0bb302ea8c627b0c82c3858f8ebb1a1c30316f078',
}
SYSTEM_TABLES = (*previous.SYSTEM_TABLES, 'pg_catalog.pg_description', 'pg_catalog.pg_constraint')
SYSTEM_PROFILE = previous.SYSTEM_PROFILE.replace(
 "'pg_catalog.pg_auth_members']", "'pg_catalog.pg_auth_members','pg_catalog.pg_description','pg_catalog.pg_constraint']")
TIMEOUTS = previous.TIMEOUTS
DROP_GUARD = '''BEGIN;
DROP TRIGGER gridex_native_tail_guard ON supabase_migrations.schema_migrations;
DROP FUNCTION gridex_native_tail_probe.reject_ledger();
DROP SCHEMA gridex_native_tail_probe;
SELECT pg_catalog.to_json(true); COMMIT;
'''
BOUNDARY = """IF current_setting('transaction_isolation')<>'read committed'
 OR current_setting('lock_timeout')::interval<>interval '3 seconds'
 OR current_setting('statement_timeout')::interval<>interval '60 seconds'
 OR (SELECT count(*) FROM pg_temp.native_tail_context WHERE stage='complete'
     AND backend=pg_backend_pid() AND txid=txid_current() AND database_name=current_database())<>1
 OR NOT EXISTS(SELECT FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory'
     AND classid=20260910 AND objid=140053 AND objsubid=2 AND granted)
 OR EXISTS(SELECT FROM pg_temp.native_tail_locks l WHERE NOT EXISTS
     (SELECT FROM pg_locks WHERE pid=pg_backend_pid() AND relation=to_regclass(l.name)
      AND mode=l.mode AND granted))
 THEN RAISE EXCEPTION 'NATIVE_TAIL_BOUNDARY_REQUIRED' USING ERRCODE='P7700'; END IF;
"""

@dataclass(frozen=True)
class Group:
    start: int
    end: int
    batch: object = field(repr=False)
    admission: object = field(repr=False)
    sources: tuple = field(repr=False)

    @property
    def stem(self): return f'gridex_native_f{self.start:04d}_{self.end:04d}_'

@dataclass(frozen=True)
class Probe:
    sql: bytes = field(repr=False)
    state: str
    denied: str | None = None
    guard: bool = False

@dataclass(frozen=True)
class Program:
    group: Group = field(repr=False)
    sql: bytes = field(repr=False)
    probes: tuple = field(repr=False)

    @property
    def name(self): return self.group.stem + hashlib.sha256(self.sql).hexdigest()[:12]


def load_groups(prefix):
    try:
        for name, digest in PINS.items():
            path = ROOT/'scripts'/name
            if path.resolve()!=path or prefix.sha(path.read_bytes())!=digest: raise ValueError('source')
        alignment,_ = previous.load_sources(prefix)
        controller = alignment.replay
        admission = controller.load_operations_runtime().admission
        order = json.loads((ROOT/'scripts/gridex-aud-003-foundation-order.json').read_text())['foundation']
        if prefix.sha(json.dumps(order,separators=(',',':')).encode())!=prefix.ORDER_SHA: raise ValueError('order')
        groups=[]
        for start,end,loader in ((69,71,controller.load_operations), (72,74,controller.load_readiness),
                                 (75,77,controller.load_intake)):
            batch=loader(); sources=batch.validate_sources(batch.reviewed_paths())
            if ['migrations/'+s.path.name for s in sources]!=order[start-1:end]: raise ValueError('order')
            if any(prefix.cli_program(s.data)!=(s.data,False) for s in sources): raise ValueError('transaction')
            groups.append(Group(start,end,batch,admission,sources))
        return tuple(groups)
    except Exception:
        raise prefix.PrefixError('NATIVE_TAIL_SOURCE_REQUIRED') from None


def system_profile(prefix, rows):
    fields={'relation','owner','canSelect','canWrite','canStrongLock'}
    if (type(rows) is not list or len(rows)!=len(SYSTEM_TABLES)
        or any(type(r) is not dict or set(r)!=fields for r in rows)
        or [r['relation'] for r in rows]!=list(SYSTEM_TABLES)):
        raise prefix.PrefixError('NATIVE_TAIL_PROFILE_REQUIRED')
    for r in rows:
        if (r['owner'] not in ('supabase_admin','postgres')
            or any(type(r[k]) is not bool for k in ('canSelect','canWrite','canStrongLock'))
            or not r['canSelect'] or (not r['canStrongLock'] and r['canWrite'])):
            raise prefix.PrefixError('NATIVE_TAIL_PROFILE_REQUIRED')
    return tuple(r['relation'] for r in rows if not r['canStrongLock'])


def _sources_receipt(sources,start):
    return [{'ordinal':i,'source':'migrations/'+s.path.name,'sourceSha256':s.sha256}
            for i,s in enumerate(sources,start)]


def wrap(prefix, parts):
    commands=[]
    for i,text in enumerate(parts):
        tag=f'$native_tail_part_{i}$'
        if tag in text or '$native_tail_body$' in text: raise prefix.PrefixError('NATIVE_TAIL_SOURCE_REQUIRED')
        commands.append('EXECUTE '+tag+text+tag+';')
    raw=TIMEOUTS+('DO $native_tail_body$ BEGIN\n'+'\n'.join(commands)+'\nEND $native_tail_body$;\n').encode()
    if len(raw)>prefix.MAX_SQL: raise prefix.PrefixError('NATIVE_SQL_INPUT_REQUIRED')
    return raw


def prepare(prefix,g,before,final,rows,domain_readonly,system_readonly,*,token):
    if (not isinstance(g,Group) or (g.start,g.end) not in ((69,71),(72,74),(75,77))
        or g.sources!=g.batch.validate_sources(g.batch.reviewed_paths())
        or not isinstance(token,str) or re.fullmatch('[a-f0-9]{32}',token) is None):
        raise prefix.PrefixError('NATIVE_TAIL_SOURCE_REQUIRED')
    shape=before[0]; literal=g.batch.alignment.literal
    if (type(domain_readonly) is not tuple or tuple(sorted(set(domain_readonly)))!=domain_readonly
        or any(n not in repair.PROVIDER_METADATA for n in domain_readonly)
        or type(system_readonly) is not tuple
        or tuple(n for n in SYSTEM_TABLES if n in system_readonly)!=system_readonly):
        raise prefix.PrefixError('NATIVE_TAIL_PROFILE_REQUIRED')
    for name in domain_readonly:
        if (shape.get('relation/'+name,{}).get('owner')!=repair.PROVIDER_METADATA[name]
            or any(repair.previous.source_mentions_identifier(prefix,s.data.decode(),name.split('.')[1]) for s in g.sources)):
            raise prefix.PrefixError('NATIVE_TAIL_SOURCE_REQUIRED')
    original=g.admission(before,token)
    site="current_database()<>'gridex_auth_legacy_replay'"
    if original.count(site)!=1: raise prefix.PrefixError('NATIVE_TAIL_SOURCE_REQUIRED')
    head=original.replace(site,"current_database()<>'postgres'")
    old_domain=head
    site="EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE',substr(r.key,10)::regclass);"
    if head.count(site)!=1: raise prefix.PrefixError('NATIVE_TAIL_SOURCE_REQUIRED')
    if domain_readonly:
        head=head.replace(site,'IF substr(r.key,10) IN ('+','.join(map(literal,domain_readonly))+') THEN\n'
             "EXECUTE format('LOCK TABLE %s IN ACCESS SHARE MODE',substr(r.key,10)::regclass);\nELSE "+site+' END IF;')
    old_system=head
    site='LOCK TABLE '+','.join(SYSTEM_TABLES[:4])+',\n '+','.join(SYSTEM_TABLES[4:])+' IN SHARE ROW EXCLUSIVE MODE;'
    if head.count(site)!=1: raise prefix.PrefixError('NATIVE_TAIL_SOURCE_REQUIRED')
    head=head.replace(site,'\n'.join('LOCK TABLE '+n+' IN '+('ACCESS SHARE' if n in system_readonly else 'SHARE ROW EXCLUSIVE')+' MODE;' for n in SYSTEM_TABLES))
    locks=[(k[9:],'AccessShareLock' if k[9:] in domain_readonly else 'AccessExclusiveLock')
           for k,v in shape.items() if k.startswith('relation/') and v.get('kind') in ('r','p')]
    locks.extend((n,'AccessShareLock' if n in system_readonly else 'ShareRowExclusiveLock') for n in SYSTEM_TABLES)
    head+='''
DO $$ BEGIN IF current_setting('transaction_isolation')<>'read committed'
 THEN RAISE EXCEPTION 'NATIVE_TAIL_ISOLATION_REQUIRED' USING ERRCODE='P7700'; END IF; END $$;
SET LOCAL TIME ZONE 'UTC'; SET LOCAL DateStyle='ISO, MDY';
CREATE TEMP TABLE native_tail_context(stage text,backend integer,txid bigint,database_name text) ON COMMIT DROP;
INSERT INTO native_tail_context VALUES('admitted',pg_backend_pid(),txid_current(),current_database());
CREATE TEMP TABLE native_tail_locks(name text,mode text) ON COMMIT DROP;
'''
    head+='INSERT INTO native_tail_locks VALUES '+','.join('('+literal(n)+','+literal(mode)+')' for n,mode in locks)+';\n'
    parts=[head,*[s.data.decode() for s in g.sources],g.batch.assertions(before,final,rows,g.sources),
           "UPDATE pg_temp.native_tail_context SET stage='complete';\nDO $$ BEGIN "+BOUNDARY+' END $$;']
    raw=wrap(prefix,parts)
    stop=lambda code:"DO $$ BEGIN RAISE EXCEPTION 'NATIVE_TAIL_FAULT' USING ERRCODE='"+code+"'; END $$;"
    marker=(f'\nALTER TABLE public.gridex_native_lifecycle_probe ADD COLUMN tail{g.end}_rollback_marker integer;\n'
            f'INSERT INTO public.gridex_native_lifecycle_probe(id) VALUES({g.end}00001);\n').encode()
    probes=[Probe(wrap(prefix,[original,stop('P7700')]),'P0002')]
    if domain_readonly: probes.append(Probe(wrap(prefix,[old_domain,stop('P7700')]),'42501',domain_readonly[0]))
    if system_readonly: probes.append(Probe(wrap(prefix,[old_system,stop('P7700')]),'42501',system_readonly[0]))
    probes.extend((Probe(wrap(prefix,parts[:2]+[stop(f'P{g.end}01')]),f'P{g.end}01'),
                   Probe(wrap(prefix,parts[:2]+['DO $$ BEGIN PERFORM pg_sleep(61); END $$;']),'57014'),
                   Probe(raw+marker+('DO $$ BEGIN '+BOUNDARY+" RAISE EXCEPTION 'POST' USING ERRCODE='P"+str(g.end)+"02'; END $$;").encode(),f'P{g.end}02'),
                   Probe(raw+marker,f'P{g.end}03',guard=True)))
    return Program(g,raw,tuple(probes))


def ledger_guard(g,name):
    if re.fullmatch(re.escape(g.stem)+r'[a-f0-9]{12}',name) is None: raise ValueError('EXACT_NATIVE_TAIL_NAME_REQUIRED')
    return ("BEGIN; CREATE SCHEMA gridex_native_tail_probe;\n"
        "REVOKE ALL ON SCHEMA gridex_native_tail_probe FROM PUBLIC,anon,authenticated,service_role;\n"
        "CREATE FUNCTION gridex_native_tail_probe.reject_ledger() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $guard$ BEGIN\n"
        "IF NEW.name IS DISTINCT FROM '"+name+"' THEN RAISE EXCEPTION 'WRONG_PROBE' USING ERRCODE='P7700'; END IF;\n"+
        BOUNDARY+f"RAISE EXCEPTION 'NATIVE_TAIL_LEDGER_FAULT' USING ERRCODE='P{g.end}03'; END $guard$;\n"
        "REVOKE ALL ON FUNCTION gridex_native_tail_probe.reject_ledger() FROM PUBLIC,anon,authenticated,service_role;\n"
        "CREATE TRIGGER gridex_native_tail_guard BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION gridex_native_tail_probe.reject_ledger();\n"
        "SELECT pg_catalog.to_json(true); COMMIT;")


def create_unit(prefix,native,directory,g,raw,entries,files):
    name=g.stem+prefix.sha(raw)[:12]
    time.sleep(1.05);native('migration','new',name)
    current={p.name for p in directory.iterdir()};added=current-files
    if len(added)!=1 or not files<=current: raise prefix.PrefixError('NATIVE_CLI_CREATED_FILE_REQUIRED')
    path=directory/next(iter(added))
    if re.fullmatch(r'\d{14}_'+re.escape(name)+r'\.sql',path.name) is None or path.name[:14]<=entries[-1]['version']:
        raise prefix.PrefixError('NATIVE_CLI_CREATED_FILE_REQUIRED')
    physical=prefix.private_write(path,raw);prefix.verify_private(path,raw,physical)
    return path,physical,name


def qualify(prefix,native,sql,directory,program,entries,retained,snapshot,report):
    before=snapshot();files={p.name for p in directory.iterdir()};report.update(verified=False,cases=[])
    for probe in program.probes:
        report.update(phase='CLI_FILE_CREATION',currentProbe=probe.state,deniedIdentity=probe.denied)
        path,physical,name=create_unit(prefix,native,directory,program.group,probe.sql,entries,files);installed=False
        try:
            if probe.guard:
                if sql(ledger_guard(program.group,name)) is not True: raise prefix.PrefixError('NATIVE_TAIL_PROOF_REQUIRED')
                installed=True
            for item in retained:prefix.verify_private(*item)
            result=native('migration','up','--local',allow_failure=True)
            prefix.verify_private(path,probe.sql,physical)
            for item in retained:prefix.verify_private(*item)
            match=re.search(rb'SQLSTATE[ :]+([A-Z0-9]{5})\b',result.stderr)
            observed=match[1].decode() if match else None
            # All qualified permission probes bind to catalog identities already
            # admitted in the profile, not just a generic42501 from elsewhere.
            denied=(re.search(rb'ERROR: permission denied for (?:table|relation) ([a-z_][a-z_0-9]*) \(SQLSTATE 42501\)',result.stderr)
                    if probe.denied else None)
            if (result.returncode==0 or observed!=probe.state
                or (probe.denied and (denied is None or denied[1].decode()!=probe.denied.split('.')[1]))):
                report['unexpectedSqlstate']=observed
                raise prefix.PrefixError('NATIVE_TAIL_PROOF_REQUIRED')
            if sql(prefix.LEDGER_SQL)!=entries: raise prefix.PrefixError('NATIVE_FAILED_LEDGER_CHANGED')
        finally:
            if installed and sql(DROP_GUARD) is not True: raise prefix.PrefixError('NATIVE_TAIL_PROOF_REQUIRED')
            prefix.verify_private(path,probe.sql,physical);path.unlink()
        if snapshot()!=before or {p.name for p in directory.iterdir()}!=files:
            raise prefix.PrefixError('NATIVE_TAIL_ROLLBACK_REQUIRED')
        report['cases'].append({'expectedSqlstate':probe.state,'deniedIdentity':probe.denied,
             'programSha256':prefix.sha(probe.sql),'ledgerUnchanged':True,'catalogRowsAndDomainSequencesRestored':True})
    report.update(verified=True,phase='VERIFIED',locksHeldAtLedgerInsert=True,
                  contextHeldAtLedgerInsert=True,statementDeadlineExecuted=True,helpersDisposed=True)


def execute(prefix,native,sql,work,parent):
    accepted=parent.get('historicalAlignment68',{})
    if parent.get('foundationInputsExecuted')!=68 or accepted.get('verified') is not True:
        raise prefix.PrefixError('NATIVE_TAIL_PREFIX_REQUIRED')
    directory,entries,retained=previous.prerequisite(prefix,sql,work,parent['historicalPrefix'],parent['historicalLegacy52'],
        parent['historicalRepair56'],parent['historicalDedupe57'],parent['historicalFixed63'],through68=accepted)
    if 'historicalOperations77' in parent: raise prefix.PrefixError('NATIVE_FRESH_PROGRESS_REQUIRED')
    report={'verified':False,'scope':'NATIVE69_77_THREE_ATOMIC_UNITS_NOT_FULL_REPLAY','groups':[],
            'foundationInputsExecuted':0,'cumulativeFoundationInputsExecuted':68,'timestampInputsExecuted':0,
            'completeReplayVerified':False,'generatedTypesVerified':False,
            'productionConcurrencyEquivalenceClaimed':False,'providerCacheSequenceRollbackClaimed':False}
    parent['historicalOperations77']=report
    groups=load_groups(prefix);operations=groups[0].batch;alignment=operations.alignment
    provider.require(sql,parent['providerEventBootstrap'])
    keys=','.join("'"+k+"'" for k in prefix.SETTINGS)
    if sql("SELECT jsonb_build_object('role',current_user,'database',current_database(),'settings',"
        "(SELECT jsonb_object_agg(name,setting) FROM pg_settings WHERE name IN ("+keys+")));")!={
        'role':'postgres','database':'postgres','settings':prefix.SETTINGS}:
        raise prefix.PrefixError('NATIVE_PRIVATE_LOGGING_REQUIRED')
    shape_sql='BEGIN READ ONLY; SET LOCAL search_path=public,extensions,pg_temp;\n'+operations.catalog_sql()+'\nCOMMIT;'
    rows_sql='BEGIN; SET LOCAL search_path=public,extensions,pg_temp;\n'+alignment.rows_sql()+"\nSELECT coalesce(jsonb_agg(jsonb_build_array(name,value) ORDER BY name,value),'[]') FROM alignment_rows;\nCOMMIT;"
    def snapshot():
        return {'catalog':sql(shape_sql),'rows':sql(rows_sql),'identities':sql(alignment.identities_sql()),
                'providerCatalog':sql(provider.static_catalog_sql(alignment.repair)),
                'providerSequenceShape':sql(provider.SEQUENCE_SHAPE),'providerEvents':sql(provider.QUERY),
                'systemProfile':sql(SYSTEM_PROFILE)}
    frozen=None
    for g in groups:
        state={'start':g.start,'end':g.end,'verified':False,'phase':'SOURCE_ADMISSION',
               'foundationInputsExecuted':0,'cumulativeFoundationInputsExecuted':g.start-1,'groupAtomic':True}
        report['groups'].append(state);report['currentFoundationOrdinal']=g.start
        before=snapshot()
        if frozen is not None and before!=frozen: raise prefix.PrefixError('NATIVE_TAIL_PREIMAGE_CHANGED')
        domain=repair.provider_profile(prefix,sql,before['catalog']);system=system_profile(prefix,before['systemProfile'])
        state.update(readOnlyDomainMetadata=domain,systemCatalogProfile=before['systemProfile'])
        try:
            ddl=(g.batch.ddl(g.sources,before['catalog']) if g.start==69 else g.batch.oracle_sql(g.sources,(before['catalog'],before['rows'])))
            expected_rows=(g.batch.expected_rows(before['rows'],before['catalog']) if g.start==75 else g.batch.expected_rows(before['rows']))
            indexes=(g.batch.new_index_keys(g.sources,before['catalog']) if g.start==69 else g.batch.new_index_keys(g.sources,before['catalog'],before['rows']))
            state['phase']='INDEPENDENT_SOURCE_DDL_ORACLE'
            final=sql("BEGIN; SET LOCAL search_path=public,extensions,pg_temp; SET LOCAL TIME ZONE 'UTC'; SET LOCAL DateStyle='ISO, MDY';\n"+ddl+'\n'+operations.catalog_sql()+'\nROLLBACK;')
            if type(final) is not dict or not final or snapshot()!=before or sql(prefix.LEDGER_SQL)!=entries:
                raise prefix.PrefixError('NATIVE_TAIL_ORACLE_ROLLBACK_REQUIRED')
            state['independentDdlOracleRollbackVerified']=True;token=uuid.uuid4().hex
            program=prepare(prefix,g,(before['catalog'],before['rows']),final,expected_rows,domain,system,token=token)
            state['transactionBoundary']={};state['phase']='ATOMIC_BOUNDARY_QUALIFICATION'
            qualify(prefix,native,sql,directory,program,entries,retained,snapshot,state['transactionBoundary'])
            reloaded=next(x for x in load_groups(prefix) if x.start==g.start)
            if prepare(prefix,reloaded,(before['catalog'],before['rows']),final,expected_rows,domain,system,token=token).sql!=program.sql:
                raise prefix.PrefixError('NATIVE_TAIL_SOURCE_REQUIRED')
            state['phase']='ATOMIC_CLI_EXECUTION'
            path,physical,name=create_unit(prefix,native,directory,g,program.sql,entries,{p.name for p in directory.iterdir()})
            retained.append((path,program.sql,physical))
            result=native('migration','up','--local',allow_failure=True)
            for item in retained:prefix.verify_private(*item)
            actual=sql(prefix.LEDGER_SQL)
            if result.returncode:
                match=re.search(rb'SQLSTATE[ :]+([A-Z0-9]{5})\b',result.stderr)
                if match:state['failedSqlstate']=match[1].decode()
                if actual!=entries: raise prefix.PrefixError('NATIVE_FAILED_LEDGER_CHANGED')
                raise prefix.PrefixError('NATIVE_HISTORICAL_SQL_FAILED')
            if type(actual) is not list or len(actual)!=len(entries)+1 or actual[:-1]!=entries:
                raise prefix.PrefixError('NATIVE_UNEXPECTED_LEDGER_DELTA')
            prefix.verify_entry(actual[-1],path.name,program);after=snapshot()
            if (not alignment.catalog.final_equal(before['catalog'],after['catalog'],final,indexes)
                or Counter(map(previous.encoded,after['rows']))!=Counter(map(previous.encoded,expected_rows))
                or any(before[k]!=after[k] for k in ('providerCatalog','providerSequenceShape','providerEvents','systemProfile'))):
                raise prefix.PrefixError('NATIVE_TAIL_FINAL_REQUIRED')
            native('migration','up','--local')
            for item in retained:prefix.verify_private(*item)
            if sql(prefix.LEDGER_SQL)!=actual or snapshot()!=after: raise prefix.PrefixError('NATIVE_HISTORICAL_LEDGER_REPEAT_CHANGED')
        except g.batch.BoundaryError:
            raise prefix.PrefixError('NATIVE_TAIL_SOURCE_ORACLE_REQUIRED') from None
        state.update(verified=True,phase='VERIFIED',foundationInputsExecuted=3,cumulativeFoundationInputsExecuted=g.end,
                     cliFile=path.name,programSha256=prefix.sha(program.sql),canonicalExecutionUnitCount=1,
                     ledgerStatementsSha256=prefix.sha(json.dumps(actual[-1]['statements'],separators=(',',':')).encode()),
                     sources=_sources_receipt(g.sources,g.start),noOpRepeatVerified=True,unchangedEarlierLedger=True,
                     sourceRowsAndCatalogVerified=True)
        entries=actual;frozen=after
        report['foundationInputsExecuted']+=3;report['cumulativeFoundationInputsExecuted']=g.end
        parent['foundationInputsExecuted']=g.end
    report.update(verified=True,phase='VERIFIED',supportSha256=dict(PINS),canonicalExecutionUnitCount=3,
                  originalHistoricalVersionsMarkedApplied=False)
    return report
