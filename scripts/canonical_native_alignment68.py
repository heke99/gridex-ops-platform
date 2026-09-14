"""One source-bound native64-68 transaction after verified native63.

The five historical SQL files remain intact. Generated portable admission is
transferred only to this owned db-only fixture and exact read-only metadata.
These read locks do NOT claim production-concurrency equivalence. No catalog
privileges are granted; the full catalog/rows/provider contract is rechecked.
"""
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import copy
import importlib.util
import json
from pathlib import Path
import re
import sys
import time
from types import SimpleNamespace
import uuid

import canonical_native_fixed63 as fixed
import canonical_native_dedupe57 as dedupe
import canonical_native_repair_envelope as repair
import canonical_native_provider_events as provider

ROOT=Path(__file__).resolve().parents[1]
PINS={
 'canonical-user-rbac-customer-alignment-batch.py':'50ca30779ac5a103eb3275cd091ecca34db206bff0fac498a351865a8171afaf',
 'canonical-user-rbac-customer-alignment-oracles.py':'ff656c85cae0e80aafccd70d553f11295540e41eb211034cf563e185c3516efb',
 'canonical-user-rbac-customer-alignment-catalog.py':'1737a0748902120acb9fafbe50beb797140ea2b2e7319edf0953cb48779ba4ab'}
SYSTEM_TABLES=('pg_catalog.pg_proc','pg_catalog.pg_rewrite','pg_catalog.pg_depend','pg_catalog.pg_auth_members')
SYSTEM_PROFILE="""SELECT jsonb_agg(jsonb_build_object('relation',v.name,
 'owner',pg_get_userbyid(c.relowner),'canSelect',has_table_privilege(c.oid,'SELECT'),
 'canWrite',has_table_privilege(c.oid,'INSERT,UPDATE,DELETE,TRUNCATE'),
 'canStrongLock',has_table_privilege(c.oid,'MAINTAIN,UPDATE,DELETE,TRUNCATE')) ORDER BY v.ordinal)
 FROM unnest(ARRAY['pg_catalog.pg_proc','pg_catalog.pg_rewrite','pg_catalog.pg_depend','pg_catalog.pg_auth_members'])
 WITH ORDINALITY v(name,ordinal) JOIN pg_class c ON c.oid=to_regclass(v.name);"""
NAME=r'gridex_native_f0064_0068_[a-f0-9]{12}'
TIMEOUTS=b"SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='60s';\n"
MARKER=b"\nALTER TABLE public.gridex_native_lifecycle_probe ADD COLUMN alignment_rollback_marker integer;\nINSERT INTO public.gridex_native_lifecycle_probe VALUES(6800001);\n"
DROP_GUARD='''BEGIN;
DROP TRIGGER gridex_native_alignment68_guard ON supabase_migrations.schema_migrations;
DROP FUNCTION gridex_native_alignment68_probe.reject_ledger();
DROP SCHEMA gridex_native_alignment68_probe;
SELECT pg_catalog.to_json(true); COMMIT;
'''
BOUNDARY="""IF current_setting('transaction_isolation')<>'read committed'
 OR current_setting('lock_timeout')::interval<>interval '3 seconds'
 OR current_setting('statement_timeout')::interval<>interval '60 seconds'
 OR (SELECT count(*) FROM pg_temp.alignment_context WHERE stage='W'
    AND backend=pg_backend_pid() AND txid=txid_current() AND database_name=current_database())<>1
 OR NOT EXISTS(SELECT FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory'
    AND classid=20260910 AND objid=140053 AND objsubid=2 AND granted)
 OR EXISTS(SELECT FROM pg_temp.alignment_native_locks l WHERE NOT EXISTS
    (SELECT FROM pg_locks WHERE pid=pg_backend_pid() AND relation=to_regclass(l.name)
     AND mode=l.mode AND granted))
 OR NOT EXISTS(SELECT FROM public.gridex_native_lifecycle_probe WHERE id=6800001)
 THEN RAISE EXCEPTION 'NATIVE_ALIGNMENT_BOUNDARY_REQUIRED' USING ERRCODE='P6800'; END IF;
"""


def load_sources(prefix):
    try:
        for name,digest in PINS.items():
            path=ROOT/'scripts'/name
            if path.resolve()!=path or prefix.sha(path.read_bytes())!=digest:raise ValueError('source')
        path=ROOT/'scripts/canonical-user-rbac-customer-alignment-batch.py'
        spec=importlib.util.spec_from_file_location('native_alignment68_authority',path)
        batch=importlib.util.module_from_spec(spec);sys.modules[spec.name]=batch
        spec.loader.exec_module(batch)
        sources=batch.validate_sources(batch.reviewed_paths())
        order=json.loads((ROOT/'scripts/gridex-aud-003-foundation-order.json').read_text())['foundation']
        if (prefix.sha(json.dumps(order,separators=(',',':')).encode())!=prefix.ORDER_SHA
                or ['migrations/'+s.path.name for s in sources]!=order[63:68]):raise ValueError('order')
        for source in sources:
            if prefix.cli_program(source.data)!=(source.data,False):raise ValueError('transaction')
        return batch,sources
    except Exception:
        raise prefix.PrefixError('NATIVE_ALIGNMENT68_SOURCE_REQUIRED') from None


def system_profile(prefix,rows):
    fields={'relation','owner','canSelect','canWrite','canStrongLock'}
    if (type(rows) is not list or len(rows)!=4 or any(type(r) is not dict or set(r)!=fields for r in rows)
            or [r['relation'] for r in rows]!=list(SYSTEM_TABLES)):
        raise prefix.PrefixError('NATIVE_ALIGNMENT68_SYSTEM_PROFILE_REQUIRED')
    for r in rows:
        if (r['owner'] not in ('supabase_admin','postgres') or
            any(type(r[k]) is not bool for k in ('canSelect','canWrite','canStrongLock'))
            or not r['canSelect'] or (not r['canStrongLock'] and r['canWrite'])):
            raise prefix.PrefixError('NATIVE_ALIGNMENT68_SYSTEM_PROFILE_REQUIRED')
    return tuple(r['relation'] for r in rows if not r['canStrongLock'])


def graph(prefix,batch,before):
    names={'event_trigger/'+e['name'] for e in provider.expected()}
    if {k for k in before if k.startswith('event_trigger/')}!=names:
        raise prefix.PrefixError('NATIVE_ALIGNMENT68_PROVIDER_REQUIRED')
    # Caller separately validates the full pristine provider execution contract,
    # not just these names. Keep every non-provider graph check in the authority.
    batch.admit_graph({k:v for k,v in before.items() if k not in names})


def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':'))


def rows_equal(batch,expected,actual,bounds):
    """Match source-modeled rows, binding NOW slots to one bounded timestamp."""
    try:
        if type(expected) is not list or type(actual) is not list:return False
        clocks=[r for r in expected if batch.CLOCK in encoded(r)]
        if not clocks:return Counter(map(encoded,expected))==Counter(map(encoded,actual))
        candidates={}
        for table,row in actual:
            if type(row) is not dict:return False
            candidates.setdefault((table,row.get('id')),[]).append(row)
        copied=copy.deepcopy(expected);observed=set()
        for table,row in copied:
            for name,value in row.items():
                if value!=batch.CLOCK:continue
                if name!='updated_at' or table not in ('public.metering_points','public.ediel_inbound_cases',
                        'public.customer_portal_accounts','public.customer_portal_claims'):return False
                matched=candidates.get((table,row.get('id')),[])
                if len(matched)!=1:return False
                timestamp=matched[0][name];dt=datetime.fromisoformat(timestamp)
                if dt.tzinfo is None or not bounds[0]<=dt<=bounds[1]:return False
                observed.add(dt);row[name]=timestamp
        return len(observed)==1 and Counter(map(encoded,copied))==Counter(map(encoded,actual))
    except (ValueError,TypeError,KeyError):return False


def prerequisite(prefix,sql,work,first43,legacy52,repair56,dedupe57,fixed63,*,through68=None):
    if (first43.get('historicalPrefixLedgerVerified') is not True or first43.get('foundationInputsExecuted')!=43
        or first43.get('transactionBoundary27',{}).get('verified') is not True
        or len(first43.get('canonicalExecutionUnits',[]))!=43):
        raise prefix.PrefixError('NATIVE_ALIGNMENT68_PREFIX_REQUIRED')
    for value,count,boundary,pins in ((legacy52,52,'transactionBoundary44_52',repair.previous.PINS),
        (repair56,56,'transactionBoundary53_56',repair.PINS),
        (dedupe57,57,'transactionBoundary57',{'canonical-user-rbac-dedupe-batch.py':dedupe.BATCH_SHA})):
        if (value.get('verified') is not True or value.get('cumulativeFoundationInputsExecuted')!=count
                or value.get(boundary,{}).get('verified') is not True or value.get('noOpRepeatVerified') is not True
                or value.get('supportSha256')!=pins or value.get('timestampInputsExecuted')!=0):
            raise prefix.PrefixError('NATIVE_ALIGNMENT68_PREFIX_REQUIRED')
    if (fixed63.get('verified') is not True or fixed63.get('cumulativeFoundationInputsExecuted')!=63
        or fixed63.get('foundationInputsExecuted')!=6 or fixed63.get('canonicalExecutionUnitCount')!=7
        or fixed63.get('groupAtomic') is not False or fixed63.get('timestampInputsExecuted')!=0
        or fixed63.get('supportSha256')!={'canonical-user-rbac-fixed-target-batch.py':fixed.CORE_SHA}
        or any(fixed63.get(k) is not True for k in ('noOpRepeatVerified','unchangedEarlierLedger',
             'sourceEffectsIndependentlyVerified','originalRestorationAlgorithmPreserved','originalDomainRowsAndSequencesPreserved'))):
        raise prefix.PrefixError('NATIVE_ALIGNMENT68_PREFIX_REQUIRED')
    controls=fixed63.get('negativeControls',[])
    if [v.get('expectedSqlstate') for v in controls]!=['P6358','P6359','55000','55000','P6363'] or any(
          v.get('ledgerUnchanged') is not True or v.get('scopedRollbackVerified') is not True for v in controls):
        raise prefix.PrefixError('NATIVE_ALIGNMENT68_PREFIX_REQUIRED')
    tail=[]
    if through68 is not None:
        if (type(through68) is not dict or through68.get('verified') is not True
            or through68.get('foundationInputsExecuted')!=5 or through68.get('cumulativeFoundationInputsExecuted')!=68
            or through68.get('canonicalExecutionUnitCount')!=1 or through68.get('timestampInputsExecuted')!=0
            or through68.get('supportSha256')!=PINS or through68.get('groupAtomic') is not True
            or any(through68.get(k) is not True for k in ('noOpRepeatVerified','unchangedEarlierLedger','sourceRowsAndCatalogVerified','existingIdentityChecksExecuted'))
            or through68.get('transactionBoundary64_68',{}).get('verified') is not True):
            raise prefix.PrefixError('NATIVE_ALIGNMENT68_PREFIX_REQUIRED')
        _,accepted_sources=load_sources(prefix)
        if through68.get('sources')!=[{'ordinal':i,'source':'migrations/'+x.path.name,'sourceSha256':x.sha256}
                                    for i,x in enumerate(accepted_sources,64)]:
            raise prefix.PrefixError('NATIVE_ALIGNMENT68_PREFIX_REQUIRED')
        tail=[through68]
    directory=work/'supabase/migrations'
    if (work.resolve()!=work or not re.fullmatch(fixed.OWNER+r'-.+',work.name) or work.stat().st_mode&0o077
            or directory.resolve()!=directory or directory.stat().st_mode&0o077):
        raise prefix.PrefixError('NATIVE_PRIVATE_SOURCE_REQUIRED')
    entries=sql(prefix.LEDGER_SQL)
    if type(entries) is not list or len(entries)!=54+len(tail):
        raise prefix.PrefixError('NATIVE_ALIGNMENT68_PREFIX_REQUIRED')
    filenames={e['version']+'_'+e['name']+'.sql' for e in entries}
    if len(filenames)!=54+len(tail) or {p.name for p in directory.iterdir()}!=filenames:
        raise prefix.PrefixError('NATIVE_UNEXPECTED_MIGRATION_INPUT')
    units=fixed63['canonicalExecutionUnits']
    if [u['stage'] for u in units]!=['f0058','fixed_constructor','f0059','f0060','f0061','f0062','f0063']:
        raise prefix.PrefixError('NATIVE_ALIGNMENT68_PREFIX_REQUIRED')
    receipts=[*first43['canonicalExecutionUnits'],legacy52,repair56,dedupe57,*units,*tail];retained=[]
    for i,entry in enumerate(entries):
        filename=entry['version']+'_'+entry['name']+'.sql';path=directory/filename
        if path.is_symlink() or not path.is_file():raise prefix.PrefixError('NATIVE_PRIVATE_SOURCE_REQUIRED')
        stat=path.lstat();raw=path.read_bytes();physical=(stat.st_dev,stat.st_ino)
        prefix.verify_private(path,raw,physical)
        prefix.verify_entry(entry,filename,SimpleNamespace(name=entry['name'],sql=raw))
        if i==0:
            if entry['name']!='native_lifecycle_proof' or prefix.sha(raw)!='579837c5a2c89fbf538f2bd61f8337ef8995b1d35b780665ebac93b9ca717ec0':
                raise prefix.PrefixError('NATIVE_SYNTHETIC_PREFLIGHT_LEDGER_REQUIRED')
        else:
            r=receipts[i-1]
            if (r['cliFile']!=filename or r['programSha256']!=prefix.sha(raw)
                or r['ledgerStatementsSha256']!=prefix.sha(json.dumps(entry['statements'],separators=(',',':')).encode())):
                raise prefix.PrefixError('NATIVE_ALIGNMENT68_PREFIX_REQUIRED')
        retained.append((path,raw,physical))
    for i,p in enumerate(prefix.prepare(),1):
        r=first43['canonicalExecutionUnits'][i-1]
        if retained[i][1]!=p.sql or r['sourceSha256']!=p.source_sha256 or r['source']!=p.source or r['ordinal']!=i:
            raise prefix.PrefixError('NATIVE_ALIGNMENT68_PREFIX_REQUIRED')
    for receipt,loader,start in ((legacy52,repair.previous.load_sources,44),(repair56,repair.load_sources,53),
          (dedupe57,lambda p:(None,(dedupe.load_source(p)[1],)),57),(fixed63,fixed.load_sources,58)):
        _,sources=loader(prefix)
        if [{k:r[k] for k in ('ordinal','source','sourceSha256')} for r in receipt['sources']]!=[
            {'ordinal':i,'source':'migrations/'+s.path.name,'sourceSha256':prefix.sha(s.data)} for i,s in enumerate(sources,start)]:
            raise prefix.PrefixError('NATIVE_ALIGNMENT68_PREFIX_REQUIRED')
    if retained[46][1]!=dedupe.load_source(prefix)[1].data:
        raise prefix.PrefixError('NATIVE_ALIGNMENT68_PREFIX_REQUIRED')
    _,sources=fixed.load_sources(prefix)
    for i,s in zip((47,49,50,51,52),sources[:-1]):
        if retained[i][1]!=s.data:raise prefix.PrefixError('NATIVE_ALIGNMENT68_PREFIX_REQUIRED')
    if through68 is not None:
        if any(retained[-1][1].count(source.data)!=1 for source in accepted_sources):
            raise prefix.PrefixError('NATIVE_ALIGNMENT68_PREFIX_REQUIRED')
    return directory,copy.deepcopy(entries),retained


@dataclass(frozen=True)
class Probe:
    sql:bytes=field(repr=False)
    state:str
    denied:str|None=None
    guard:bool=False

@dataclass(frozen=True)
class Program:
    sql:bytes=field(repr=False)
    probes:tuple=field(repr=False)
    @property
    def name(self):return 'gridex_native_f0064_0068_'+hashlib.sha256(self.sql).hexdigest()[:12]


def wrap(prefix,parts):
    commands=[]
    for i,text in enumerate(parts):
        tag='$alignment68_part_'+str(i)+'$'
        if tag in text or '$alignment68_body$' in text:
            raise prefix.PrefixError('NATIVE_ALIGNMENT68_SOURCE_REQUIRED')
        commands.append('EXECUTE '+tag+text+tag+';')
    raw=TIMEOUTS+('DO $alignment68_body$ BEGIN\n'+'\n'.join(commands)+'\nEND $alignment68_body$;\n').encode()
    if len(raw)>prefix.MAX_SQL:raise prefix.PrefixError('NATIVE_SQL_INPUT_REQUIRED')
    return raw


def prepare(prefix,batch,sources,before,rows,final,domain_readonly,system_readonly,*,token):
    if sources!=batch.validate_sources(batch.reviewed_paths()):
        raise prefix.PrefixError('NATIVE_ALIGNMENT68_SOURCE_REQUIRED')
    if (type(domain_readonly) is not tuple or tuple(sorted(set(domain_readonly)))!=domain_readonly
        or any(n not in repair.PROVIDER_METADATA for n in domain_readonly)
        or type(system_readonly) is not tuple or tuple(n for n in SYSTEM_TABLES if n in system_readonly)!=system_readonly):
        raise prefix.PrefixError('NATIVE_ALIGNMENT68_SYSTEM_PROFILE_REQUIRED')
    for name in domain_readonly:
        if before.get('relation/'+name,{}).get('owner')!=repair.PROVIDER_METADATA[name] or any(
             repair.previous.source_mentions_identifier(prefix,s.data.decode(),name.split('.')[1]) for s in sources):
            raise prefix.PrefixError('NATIVE_ALIGNMENT68_SOURCE_REQUIRED')
    original=batch.prelude(sources,(before,rows),final,token,target_database=batch.replay.DATABASE)
    site="current_database() NOT IN ('"+batch.replay.DATABASE+"')"
    if original.count(site)!=1:raise prefix.PrefixError('NATIVE_ALIGNMENT68_SOURCE_REQUIRED')
    admission=original.replace(site,"current_database() NOT IN ('postgres')")
    check="DO $$ BEGIN IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'NATIVE_ALIGNMENT_ISOLATION' USING ERRCODE='P6800'; END IF; END $$;\n"
    admission=check+admission
    old_domain=admission
    lock_site="EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE',substr(r.key,10)::regclass);"
    if admission.count(lock_site)!=1:raise prefix.PrefixError('NATIVE_ALIGNMENT68_SOURCE_REQUIRED')
    if domain_readonly:
        admission=admission.replace(lock_site,"IF substr(r.key,10) IN ("+','.join(batch.literal(n) for n in domain_readonly)+") THEN\n EXECUTE format('LOCK TABLE %s IN ACCESS SHARE MODE',substr(r.key,10)::regclass);\nELSE "+lock_site+' END IF;')
    old_system=admission
    lock_site='LOCK TABLE '+','.join(SYSTEM_TABLES)+' IN SHARE ROW EXCLUSIVE MODE;'
    if admission.count(lock_site)!=1:raise prefix.PrefixError('NATIVE_ALIGNMENT68_SOURCE_REQUIRED')
    admission=admission.replace(lock_site,'\n'.join('LOCK TABLE '+n+' IN '+(
        'ACCESS SHARE' if n in system_readonly else 'SHARE ROW EXCLUSIVE')+' MODE;' for n in SYSTEM_TABLES))
    locks=[(k[9:],'AccessShareLock' if k[9:] in domain_readonly else 'AccessExclusiveLock')
           for k,v in before.items() if k.startswith('relation/') and v.get('kind') in ('r','p')]
    locks.extend((n,'AccessShareLock' if n in system_readonly else 'ShareRowExclusiveLock') for n in SYSTEM_TABLES)
    admission+="\nCREATE TEMP TABLE alignment_native_locks(name text,mode text) ON COMMIT DROP;\nINSERT INTO alignment_native_locks VALUES "+','.join(
        '('+batch.literal(n)+','+batch.literal(mode)+')' for n,mode in locks)+';\n'
    admission+='CREATE TEMP TABLE alignment_identity_reference(value) ON COMMIT DROP AS '+batch.identities_sql()
    parts=[admission];prior='ADMITTED'
    for s in sources:
        parts.append(s.data.decode())
        if s.key!='W':parts.append(batch.stage_sql(prior,s.key))
        prior=s.key
    parts.extend((batch.identity_assertions(),batch.assertions()))
    raw=wrap(prefix,parts)
    def stop(state):return "DO $$ BEGIN RAISE EXCEPTION 'NATIVE_ALIGNMENT_FAULT' USING ERRCODE='"+state+"'; END $$;"
    probes=[]
    if domain_readonly:probes.append(Probe(wrap(prefix,[old_domain,stop('P6800')]),'42501',domain_readonly[0]))
    if system_readonly:probes.append(Probe(wrap(prefix,[old_system,stop('P6800')]),'42501',system_readonly[0]))
    probes.extend((Probe(wrap(prefix,parts[:2]+[stop('P6864')]),'P6864'),
       Probe(wrap(prefix,parts[:2]+['DO $$ BEGIN PERFORM pg_sleep(61); END $$;']),'57014'),
       Probe(raw+MARKER+('DO $$ BEGIN '+BOUNDARY+" RAISE EXCEPTION 'POST' USING ERRCODE='P6868'; END $$;").encode(),'P6868'),
       Probe(raw+MARKER,'P6869',guard=True)))
    return Program(raw,tuple(probes))


def denial(stderr,name):
    if name not in (*SYSTEM_TABLES,*repair.PROVIDER_METADATA):return False
    match=re.search(rb'(?:^|\n)ERROR: permission denied for (?:table|relation) ([a-z_][a-z_0-9]*) \(SQLSTATE 42501\)',stderr)
    return bool(match and match[1].decode()==name.split('.')[1])


def ledger_guard(name):
    if not re.fullmatch(NAME,name):raise ValueError('EXACT_ALIGNMENT68_PROBE_NAME_REQUIRED')
    return ("BEGIN; CREATE SCHEMA gridex_native_alignment68_probe;\n"
       "REVOKE ALL ON SCHEMA gridex_native_alignment68_probe FROM PUBLIC,anon,authenticated,service_role;\n"
       "CREATE FUNCTION gridex_native_alignment68_probe.reject_ledger() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $guard$ BEGIN\n"
       "IF NEW.name IS DISTINCT FROM '"+name+"' THEN RAISE EXCEPTION 'WRONG_PROBE' USING ERRCODE='P6800'; END IF;\n"+
       BOUNDARY+"RAISE EXCEPTION 'NATIVE_ALIGNMENT_LEDGER_FAULT' USING ERRCODE='P6869'; END $guard$;\n"
       "REVOKE ALL ON FUNCTION gridex_native_alignment68_probe.reject_ledger() FROM PUBLIC,anon,authenticated,service_role;\n"
       "CREATE TRIGGER gridex_native_alignment68_guard BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION gridex_native_alignment68_probe.reject_ledger();\n"
       "SELECT pg_catalog.to_json(true); COMMIT;")


def create_unit(prefix,native,directory,raw,entries,files):
    name='gridex_native_f0064_0068_'+prefix.sha(raw)[:12]
    time.sleep(1.05);native('migration','new',name)
    current={p.name for p in directory.iterdir()};added=current-files
    if len(added)!=1 or not files<=current:raise prefix.PrefixError('NATIVE_CLI_CREATED_FILE_REQUIRED')
    path=directory/next(iter(added))
    if not re.fullmatch(r'\d{14}_'+re.escape(name)+r'\.sql',path.name) or path.name[:14]<=entries[-1]['version']:
        raise prefix.PrefixError('NATIVE_CLI_CREATED_FILE_REQUIRED')
    physical=prefix.private_write(path,raw);prefix.verify_private(path,raw,physical)
    return path,physical,name


def qualify(prefix,native,sql,directory,program,entries,retained,snapshot,report):
    before=snapshot();files={p.name for p in directory.iterdir()};report.update(verified=False,cases=[])
    for probe in program.probes:
        report.update(phase='CLI_FILE_CREATION',currentProbe=probe.state,deniedIdentity=probe.denied)
        path,physical,name=create_unit(prefix,native,directory,probe.sql,entries,files);installed=False
        try:
            if probe.guard:
                if sql(ledger_guard(name)) is not True:raise prefix.PrefixError('NATIVE_ALIGNMENT68_PROOF_REQUIRED')
                installed=True
            for item in retained:prefix.verify_private(*item)
            result=native('migration','up','--local',allow_failure=True)
            prefix.verify_private(path,probe.sql,physical)
            for item in retained:prefix.verify_private(*item)
            match=re.search(rb'SQLSTATE[ :]+([A-Z0-9]{5})\b',result.stderr)
            observed=match[1].decode() if match else None
            if result.returncode==0 or observed!=probe.state or (probe.denied and not denial(result.stderr,probe.denied)):
                report['unexpectedSqlstate']=observed
                raise prefix.PrefixError('NATIVE_ALIGNMENT68_PROOF_REQUIRED')
            if sql(prefix.LEDGER_SQL)!=entries:raise prefix.PrefixError('NATIVE_FAILED_LEDGER_CHANGED')
        finally:
            if installed and sql(DROP_GUARD) is not True:raise prefix.PrefixError('NATIVE_ALIGNMENT68_PROOF_REQUIRED')
            prefix.verify_private(path,probe.sql,physical);path.unlink()
        report['phase']='ROLLBACK_VERIFICATION'
        if snapshot()!=before or {p.name for p in directory.iterdir()}!=files:
            raise prefix.PrefixError('NATIVE_ALIGNMENT68_ROLLBACK_REQUIRED')
        report['cases'].append({'expectedSqlstate':probe.state,'deniedIdentity':probe.denied,
              'programSha256':prefix.sha(probe.sql),'ledgerUnchanged':True,'fullScopedRollbackVerified':True})
    report.update(verified=True,phase='VERIFIED',locksHeldAtLedgerInsert=True,
          contextHeldAtLedgerInsert=True,deadlinesHeldAtLedgerInsert=True,helpersDisposed=True)


def execute(prefix,native,sql,work,first43,legacy52,repair56,dedupe57,fixed63,report,*,provider_bootstrap):
    directory,entries,retained=prerequisite(prefix,sql,work,first43,legacy52,repair56,dedupe57,fixed63)
    if report:raise prefix.PrefixError('NATIVE_FRESH_PROGRESS_REQUIRED')
    report.update(scope='ATOMIC_NATIVE64_68_READONLY_METADATA_FIXTURE_NOT_FULL_REPLAY',verified=False,
          phase='SOURCE_ADMISSION',foundationInputsExecuted=0,cumulativeFoundationInputsExecuted=63,
          timestampInputsExecuted=0,completeReplayVerified=False,generatedTypesVerified=False,
          originalHistoricalVersionsMarkedApplied=False,groupAtomic=True,
          productionConcurrencyEquivalenceClaimed=False,providerCacheSequenceRollbackClaimed=False)
    batch,sources=load_sources(prefix);provider.require(sql,provider_bootstrap)
    keys=','.join("'"+k+"'" for k in prefix.SETTINGS)
    if sql("SELECT jsonb_build_object('role',current_user,'database',current_database(),'settings',"
        "(SELECT jsonb_object_agg(name,setting) FROM pg_settings WHERE name IN ("+keys+")));")!={
        'role':'postgres','database':'postgres','settings':prefix.SETTINGS}:
        raise prefix.PrefixError('NATIVE_PRIVATE_LOGGING_REQUIRED')
    shape_query='BEGIN READ ONLY; SET LOCAL search_path=public,extensions,pg_temp;\n'+batch.catalog.sql(batch.repair)+'\nCOMMIT;'
    rows_query='BEGIN; SET LOCAL search_path=public,extensions,pg_temp;\n'+batch.rows_sql()+"\nSELECT coalesce(jsonb_agg(jsonb_build_array(name,value) ORDER BY name,value),'[]') FROM alignment_rows;\nCOMMIT;"
    def snapshot():
        return {'catalog':sql(shape_query),'rows':sql(rows_query),'identities':sql(batch.identities_sql()),
          'providerCatalog':sql(provider.static_catalog_sql(batch.repair)),
          'providerSequenceShape':sql(provider.SEQUENCE_SHAPE),'providerEvents':sql(provider.QUERY),
          'systemCatalogProfile':sql(SYSTEM_PROFILE)}
    before=snapshot();report['phase']='GRAPH_ADMISSION'
    try:
        graph(prefix,batch,before['catalog'])
        domain_readonly=repair.provider_profile(prefix,sql,before['catalog'])
        profile=before['systemCatalogProfile'];system_readonly=system_profile(prefix,profile)
        report['readOnlyDomainMetadata']=domain_readonly;report['systemCatalogProfile']=profile
        report['phase']='INDEPENDENT_SOURCE_DDL_ORACLE'
        final=sql('BEGIN; SET LOCAL search_path=public,extensions,pg_temp;\n'+batch.expected_ddl(sources,before['catalog'])+
                  '\n'+batch.catalog.sql(batch.repair)+'\nROLLBACK;')
        if type(final) is not dict or not final or snapshot()!=before or sql(prefix.LEDGER_SQL)!=entries:
            raise prefix.PrefixError('NATIVE_ALIGNMENT68_ORACLE_ROLLBACK_REQUIRED')
        expected_rows=batch.expected_rows(before['rows']);new_indexes=batch.new_index_keys(sources,before['catalog'])
        report['independentDdlOracleRollbackVerified']=True
        token=uuid.uuid4().hex
        program=prepare(prefix,batch,sources,before['catalog'],before['rows'],final,domain_readonly,system_readonly,token=token)
        report['transactionBoundary64_68']={};report['phase']='ATOMIC_BOUNDARY_QUALIFICATION'
        qualify(prefix,native,sql,directory,program,entries,retained,snapshot,report['transactionBoundary64_68'])
        again,new_sources=load_sources(prefix)
        if prepare(prefix,again,new_sources,before['catalog'],before['rows'],final,domain_readonly,system_readonly,token=token).sql!=program.sql:
            raise prefix.PrefixError('NATIVE_ALIGNMENT68_SOURCE_REQUIRED')
        report['phase']='ATOMIC_CLI_EXECUTION'
        path,physical,name=create_unit(prefix,native,directory,program.sql,entries,{p.name for p in directory.iterdir()})
        retained.append((path,program.sql,physical));lower=datetime.now(timezone.utc)
        result=native('migration','up','--local',allow_failure=True);upper=datetime.now(timezone.utc)
        for item in retained:prefix.verify_private(*item)
        actual=sql(prefix.LEDGER_SQL)
        if result.returncode:
            match=re.search(rb'SQLSTATE[ :]+([A-Z0-9]{5})\b',result.stderr)
            if match:report['failedSqlstate']=match[1].decode()
            if actual!=entries:raise prefix.PrefixError('NATIVE_FAILED_LEDGER_CHANGED')
            raise prefix.PrefixError('NATIVE_HISTORICAL_SQL_FAILED')
        if type(actual) is not list or len(actual)!=55 or actual[:-1]!=entries:
            raise prefix.PrefixError('NATIVE_UNEXPECTED_LEDGER_DELTA')
        prefix.verify_entry(actual[-1],path.name,program);after=snapshot()
        if (not batch.catalog.final_equal(before['catalog'],after['catalog'],final,new_indexes)
            or not rows_equal(batch,expected_rows,after['rows'],(lower,upper))
            or any(before[k]!=after[k] for k in ('providerCatalog','providerSequenceShape','providerEvents','systemCatalogProfile'))):
            raise prefix.PrefixError('NATIVE_ALIGNMENT68_FINAL_REQUIRED')
        native('migration','up','--local')
        for item in retained:prefix.verify_private(*item)
        if sql(prefix.LEDGER_SQL)!=actual or snapshot()!=after:
            raise prefix.PrefixError('NATIVE_HISTORICAL_LEDGER_REPEAT_CHANGED')
    except batch.BoundaryError:
        raise prefix.PrefixError('NATIVE_ALIGNMENT68_SOURCE_ORACLE_REQUIRED') from None
    report.update(verified=True,phase='VERIFIED',foundationInputsExecuted=5,cumulativeFoundationInputsExecuted=68,
         canonicalExecutionUnitCount=1,cliFile=path.name,programSha256=prefix.sha(program.sql),
         ledgerStatementsSha256=prefix.sha(json.dumps(actual[-1]['statements'],separators=(',',':')).encode()),
         sources=[{'ordinal':i,'source':'migrations/'+s.path.name,'sourceSha256':s.sha256} for i,s in enumerate(sources,64)],
         supportSha256=dict(PINS),unchangedEarlierLedger=True,noOpRepeatVerified=True,
         sourceRowsAndCatalogVerified=True,existingIdentityChecksExecuted=True)
    return report
