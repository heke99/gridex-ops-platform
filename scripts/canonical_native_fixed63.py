"""Source-bound native58-63 continuation; private fixture, not a hosted upgrade.

Five historical sources execute byte-for-byte, including D2/F2 COMMITs. The
restoration X receives an explicit three-site native environment admission
transfer; its row/FK restoration algorithm remains byte-for-byte. Constructor
SQL has its own genuine CLI ledger entry. The group is NOT called atomic:
unexpected errors are terminal and the parent disposes the entire owned DB.
"""
import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import time
from types import SimpleNamespace
import uuid

import canonical_native_dedupe57 as previous
import canonical_native_provider_events as provider
import canonical_native_repair_envelope as repair

ROOT=Path(__file__).resolve().parents[1]
CORE_SHA='1efa1241dff622d84e904c7f577ab9b11d5b0712f8ff764211624f4ef62d369d'
OWNER=r'gridex-sb-[a-f0-9]{12}-[a-f0-9]{16}'
NAME=r'gridex_native_(?:f00(?:58|59|60|61|62|63)|fixed_constructor)_[a-f0-9]{12}'
EXTERNAL_FKS="SELECT count(*) FROM pg_constraint f JOIN pg_class p ON p.oid=f.confrelid JOIN pg_namespace pn ON pn.oid=p.relnamespace JOIN pg_class c ON c.oid=f.conrelid JOIN pg_namespace cn ON cn.oid=c.relnamespace WHERE f.contype='f' AND pn.nspname IN ('public','auth','storage') AND cn.nspname NOT IN ('public','auth','storage');"
AUTH_EMPTY_TEXT=frozenset(('confirmation_token','recovery_token','email_change_token_new',
    'email_change','phone_change','phone_change_token','email_change_token_current','reauthentication_token'))
DROP_GUARD='''BEGIN;
DROP TRIGGER gridex_native_fixed63_guard ON supabase_migrations.schema_migrations;
DROP FUNCTION gridex_native_fixed63_probe.reject_ledger();
DROP SCHEMA gridex_native_fixed63_probe;
SELECT pg_catalog.to_json(true); COMMIT;
'''


def load_sources(prefix):
    try:
        path=ROOT/'scripts/canonical-user-rbac-fixed-target-batch.py'
        if path.resolve()!=path or prefix.sha(path.read_bytes())!=CORE_SHA:
            raise ValueError('source')
        # This module provides pure source/oracle/graph functions. Its separate
        # portable target lifecycle is never instantiated or impersonated.
        spec=importlib.util.spec_from_file_location('native_fixed63_source_authority',path)
        core=importlib.util.module_from_spec(spec);sys.modules[spec.name]=core
        spec.loader.exec_module(core)
        sources=core.validate_sources(core.reviewed_paths())
        order=json.loads((ROOT/'scripts/gridex-aud-003-foundation-order.json').read_text())['foundation']
        if (prefix.sha(json.dumps(order,separators=(',',':')).encode())!=prefix.ORDER_SHA
            or ['migrations/'+s.path.name for s in sources]!=order[57:63]):
            raise ValueError('order')
        return core,sources
    except Exception:
        raise prefix.PrefixError('NATIVE_FIXED63_SOURCE_REQUIRED') from None


def cleanup_source(prefix,source,owner):
    if (source.key!='X' or prefix.sha(source.data)!='f6fbfd30b62e9529539c27c00722c89446e6ed5dd7cbed9217594f7202025ee7'
            or type(owner) is not str or not re.fullmatch(OWNER,owner)):
        raise prefix.PrefixError('NATIVE_FIXED63_SOURCE_REQUIRED')
    text=source.data.decode()
    sites={"current_database()<>'gridex_auth_legacy_replay'":"current_database()<>'postgres'",
           'inet_server_addr() IS NOT NULL OR inet_server_port() IS NOT NULL':
               'inet_server_addr() IS NULL OR inet_server_port() IS DISTINCT FROM 5432',
           "envelope->>'owner' !~ '^gridex-auth-legacy-(fixed|continuation)-[0-9]+-[0-9]+$'":
               "envelope->>'owner' IS DISTINCT FROM '"+owner+"'"}
    for old,new in sites.items():
        if text.count(old)!=1:raise prefix.PrefixError('NATIVE_FIXED63_SOURCE_REQUIRED')
        text=text.replace(old,new)
    return text.encode()


def auth_default(prefix,name,column):
    """Only inert provider defaults; never accounts, passwords or role grants."""
    default=column['default'];kind=column['type']
    if default is None or default.startswith('NULL::'):return
    if (name in ('is_anonymous','is_sso_user') and kind=='boolean' and default=='false'):return
    if name=='email_change_confirm_status' and kind in ('smallint','integer') and default=='0':return
    if (name in AUTH_EMPTY_TEXT and (kind=='text' or kind.startswith('character varying'))
            and re.fullmatch(r"''::(?:text|character varying)(?:\(\d+\))?",default)):return
    if (name=='confirmed_at' and column['generated']=='s'
            and default=='LEAST(email_confirmed_at, phone_confirmed_at)'):return
    raise prefix.PrefixError('NATIVE_FIXED63_AUTH_DEFAULT_REQUIRED')


def native_graph(prefix,core,snapshot,sources):
    catalog,rows=snapshot
    expected_events={'event_trigger/'+entry['name'] for entry in provider.expected()}
    if {k for k in catalog if k.startswith('event_trigger/')}!=expected_events:
        raise prefix.PrefixError('NATIVE_FIXED63_GRAPH_REQUIRED')
    # The independent provider.require() checks exact routine hashes/owners/ACLs
    # before this graph. Unknown events are rejected rather than disabled.
    fks=core.foreign_keys(catalog);reachable=set(core.WRITE_TABLES)
    while True:
        expanded=reachable|{child for child,_,parent,_ in fks if parent in reachable}
        if expanded==reachable:break
        reachable=expanded
    oracle=core.Oracle(core,({},[]),datetime.now(timezone.utc),datetime.now(timezone.utc))
    for key,item in catalog.items():
        table=key.split('/')[1] if '/' in key else ''
        if key.startswith(('trigger/','rule/')):
            if table in core.WRITE_TABLES:
                raise prefix.PrefixError('NATIVE_FIXED63_GRAPH_REQUIRED')
            if (item['enabled']!='D' and table in reachable and
                    (not key.startswith('trigger/') or 'FOR EACH ROW' not in item['definition']
                     or re.search(r'\bDELETE\b',item['definition'],re.I))):
                raise prefix.PrefixError('NATIVE_FIXED63_GRAPH_REQUIRED')
        if key.startswith('relation/') and table in core.WRITE_TABLES and item['kind']!='r':
            raise prefix.PrefixError('NATIVE_FIXED63_GRAPH_REQUIRED')
        if key.startswith('column/') and table in core.WRITE_TABLES:
            if item['identity']:raise prefix.PrefixError('NATIVE_FIXED63_GRAPH_REQUIRED')
            if table=='auth.users':auth_default(prefix,key.rsplit('/',1)[1],item)
            if item['generated']:
                valid=((table=='auth.users' and key.endswith('/confirmed_at')
                        and item['default']=='LEAST(email_confirmed_at, phone_confirmed_at)') or
                       (table=='public.companies' and key.endswith('/normalized_org_number')
                        and item['default']=='gridex_normalize_org_number(org_number)'))
                if not valid:raise prefix.PrefixError('NATIVE_FIXED63_GRAPH_REQUIRED')
            else:oracle.default(item)
    if any(child in core.WRITE_TABLES and parent not in core.WRITE_TABLES for child,_,parent,_ in fks):
        raise prefix.PrefixError('NATIVE_FIXED63_GRAPH_REQUIRED')
    metadata=set(repair.PROVIDER_METADATA)
    for name in metadata:
        if any(repair.previous.source_mentions_identifier(prefix,s.data.decode(),name.split('.')[1]) for s in sources):
            raise prefix.PrefixError('NATIVE_FIXED63_GRAPH_REQUIRED')
    for table,row in rows:
        if table in metadata:continue  # unrelated provider rows remain in EVERY snapshot
        if (table in reachable-core.WRITE_TABLES or (table.startswith('auth.') and not table.endswith('_seq'))):
            if table not in core.SEEDS:raise prefix.PrefixError('NATIVE_FIXED63_GRAPH_REQUIRED')
        if table in core.WRITE_TABLES-core.SEEDS and table!='public.companies':
            raise prefix.PrefixError('NATIVE_FIXED63_EMPTY_PREIMAGE_REQUIRED')
    seed=core.single_seed(rows)
    for child,columns,parent,parents in fks:
        if parent=='public.companies' and any(table==child and all(
            row[column] is not None and row[column]==seed[key] for column,key in zip(columns,parents))
            for table,row in rows):
            raise prefix.PrefixError('NATIVE_FIXED63_GRAPH_REQUIRED')


def constructor(prefix,core,before,sources):
    """Original deterministic fixture construction, with inert native Auth defaults."""
    o=core.Oracle(core,before);boot,shared=sources[1:3]
    reservation=core.company_reservation(before,sources)
    seed=o.one('public.companies',id=reservation['before']['id'])
    o.update('public.companies',seed,{'slug':reservation['after']['slug']})
    statements=["DO $fixed_seed$ DECLARE affected bigint; BEGIN UPDATE public.companies t SET slug="+
        core.value_sql(reservation['after']['slug'])+" WHERE t.id="+core.value_sql(seed['id'])+"::uuid AND to_jsonb(t)="+
        core.value_sql(reservation['before'])+"; GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN "
        "RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FIXED_PREFIX_PREIMAGE_MISMATCH'; END IF; END $fixed_seed$;"]
    values=[('auth.users',dict(id=boot.slots['U_boot'],email='fixed-bootstrap@example.invalid')),
            ('auth.users',dict(id=shared.slots['U_target'],email=shared.slots['email'])),
            ('auth.users',dict(id=shared.slots['U_actor'],email='fixed-actor@example.invalid')),
            ('public.companies',dict(id=shared.slots['C_target'],name='Synthetic fixed target',
                 slug=boot.literal(209),status='active',created_by=None,updated_by=None))]
    for table,overrides in values:
        columns=o.columns(table);row={}
        for name,column in columns.items():
            if table=='auth.users':auth_default(prefix,name,column)
            if column['generated']:continue
            if column['default'] in ('now()','CURRENT_TIMESTAMP'):row[name]='2020-01-01T00:00:00+00:00'
            elif column['default'] in ('gen_random_uuid()','extensions.gen_random_uuid()'):
                if name!='id' or name not in overrides:raise prefix.PrefixError('NATIVE_FIXED63_CONSTRUCTOR_REQUIRED')
                row[name]=overrides[name]
            else:row[name]=o.default(column)
        row.update(overrides)
        if any(row[k] is None and v['notnull'] for k,v in columns.items() if not v['generated']):
            raise prefix.PrefixError('NATIVE_FIXED63_CONSTRUCTOR_REQUIRED')
        statements.append('INSERT INTO '+core.qualified(table)+' ('+','.join(core.ident(k) for k in row)+') VALUES ('+
                          ','.join(core.value_sql(v) for v in row.values())+');')
        o.generated_columns(table,row);o.table(table).append(row)
    companies=o.table('public.companies')
    if (len(companies)!=2 or [r['id'] for r in companies if core.company_matches(r,boot)]!=[shared.slots['C_target']]
            or o.one('public.companies',id=seed['id'])!=reservation['after']):
        raise prefix.PrefixError('NATIVE_FIXED63_CONSTRUCTOR_REQUIRED')
    return '\n'.join(statements).encode(),o


def require_prefix(prefix,sql,work,first43,legacy52,repair56,dedupe57):
    if (first43.get('historicalPrefixLedgerVerified') is not True or first43.get('foundationInputsExecuted')!=43
            or first43.get('transactionBoundary27',{}).get('verified') is not True
            or len(first43.get('canonicalExecutionUnits',[]))!=43):
        raise prefix.PrefixError('NATIVE_FIXED63_PREFIX_REQUIRED')
    groups=((legacy52,52,9,'transactionBoundary44_52',repair.previous.load_sources,44),
            (repair56,56,4,'transactionBoundary53_56',repair.load_sources,53),
            (dedupe57,57,1,'transactionBoundary57',lambda p:(None,(previous.load_source(p)[1],)),57))
    for receipt,limit,count,boundary,loader,start in groups:
        if (receipt.get('verified') is not True or receipt.get('cumulativeFoundationInputsExecuted')!=limit
                or receipt.get('foundationInputsExecuted')!=count or receipt.get('timestampInputsExecuted')!=0
                or receipt.get('canonicalExecutionUnitCount')!=1 or receipt.get('noOpRepeatVerified') is not True
                or receipt.get(boundary,{}).get('verified') is not True):
            raise prefix.PrefixError('NATIVE_FIXED63_PREFIX_REQUIRED')
        _,sources=loader(prefix)
        expected=[{'ordinal':i,'source':'migrations/'+s.path.name,'sourceSha256':prefix.sha(s.data)}
                  for i,s in enumerate(sources,start)]
        if list(receipt['sources'])!=expected:raise prefix.PrefixError('NATIVE_FIXED63_PREFIX_REQUIRED')
    if (legacy52.get('supportSha256')!=repair.previous.PINS or repair56.get('supportSha256')!=repair.PINS
            or dedupe57.get('supportSha256')!={'canonical-user-rbac-dedupe-batch.py':previous.BATCH_SHA}
            or dedupe57.get('sourceAndLedgerAtomic') is not False
            or dedupe57.get('wholeSourceRetained') is not True or dedupe57.get('trailingVerificationRetained') is not True):
        raise prefix.PrefixError('NATIVE_FIXED63_PREFIX_REQUIRED')
    directory=work/'supabase/migrations'
    found=re.fullmatch('('+OWNER+r')-.+',work.name)
    if (not found or work.resolve()!=work or work.stat().st_mode&0o077
            or directory.resolve()!=directory or directory.stat().st_mode&0o077):
        raise prefix.PrefixError('NATIVE_PRIVATE_SOURCE_REQUIRED')
    owner=found[1];entries=sql(prefix.LEDGER_SQL)
    if type(entries) is not list or len(entries)!=47:raise prefix.PrefixError('NATIVE_FIXED63_PREFIX_REQUIRED')
    names={e['version']+'_'+e['name']+'.sql' for e in entries}
    if len(names)!=47 or {p.name for p in directory.iterdir()}!=names:
        raise prefix.PrefixError('NATIVE_UNEXPECTED_MIGRATION_INPUT')
    receipts=[*first43['canonicalExecutionUnits'],legacy52,repair56,dedupe57];retained=[]
    for index,entry in enumerate(entries):
        name=entry['version']+'_'+entry['name']+'.sql';path=directory/name
        if path.is_symlink() or not path.is_file():raise prefix.PrefixError('NATIVE_PRIVATE_SOURCE_REQUIRED')
        meta=path.lstat();raw=path.read_bytes();physical=(meta.st_dev,meta.st_ino)
        prefix.verify_private(path,raw,physical)
        prefix.verify_entry(entry,name,SimpleNamespace(name=entry['name'],sql=raw))
        if index==0:
            if entry['name']!='native_lifecycle_proof' or prefix.sha(raw)!='579837c5a2c89fbf538f2bd61f8337ef8995b1d35b780665ebac93b9ca717ec0':
                raise prefix.PrefixError('NATIVE_SYNTHETIC_PREFLIGHT_LEDGER_REQUIRED')
        else:
            receipt=receipts[index-1]
            if (receipt['cliFile']!=name or receipt['programSha256']!=prefix.sha(raw) or
                receipt['ledgerStatementsSha256']!=prefix.sha(json.dumps(entry['statements'],separators=(',',':')).encode())):
                raise prefix.PrefixError('NATIVE_FIXED63_PREFIX_REQUIRED')
        retained.append((path,raw,physical))
    for index,program in enumerate(prefix.prepare(),1):
        receipt=first43['canonicalExecutionUnits'][index-1]
        if (retained[index][1]!=program.sql or receipt['sourceSha256']!=program.source_sha256
                or receipt['source']!=program.source or receipt['ordinal']!=index):
            raise prefix.PrefixError('NATIVE_FIXED63_PREFIX_REQUIRED')
    if retained[-1][1]!=previous.load_source(prefix)[1].data:
        raise prefix.PrefixError('NATIVE_FIXED63_PREFIX_REQUIRED')
    return directory,copy.deepcopy(entries),retained,owner


class Lane:
    def __init__(self,prefix,native,sql,directory,entries,retained):
        self.p,self.native,self.sql,self.directory=prefix,native,sql,directory
        self.entries,self.retained=entries,retained

    def create(self,tag,raw):
        name='gridex_native_'+tag+'_'+self.p.sha(raw)[:12]
        if not re.fullmatch(NAME,name):raise self.p.PrefixError('NATIVE_FIXED63_SOURCE_REQUIRED')
        files={p.name for p in self.directory.iterdir()}
        if files!={item[0].name for item in self.retained}:
            raise self.p.PrefixError('NATIVE_UNEXPECTED_MIGRATION_INPUT')
        time.sleep(1.05)
        self.native('migration','new',name)
        current={p.name for p in self.directory.iterdir()};added=current-files
        if len(added)!=1 or not files<=current:raise self.p.PrefixError('NATIVE_CLI_CREATED_FILE_REQUIRED')
        path=self.directory/next(iter(added))
        if not re.fullmatch(r'\d{14}_'+re.escape(name)+r'\.sql',path.name) or path.name[:14]<=self.entries[-1]['version']:
            raise self.p.PrefixError('NATIVE_CLI_CREATED_FILE_REQUIRED')
        physical=self.p.private_write(path,raw);self.p.verify_private(path,raw,physical)
        return path,physical,name

    def run(self,tag,raw,report):
        path,physical,name=self.create(tag,raw);self.retained.append((path,raw,physical))
        lower=datetime.now(timezone.utc)
        result=self.native('migration','up','--local',allow_failure=True)
        upper=datetime.now(timezone.utc)
        for item in self.retained:self.p.verify_private(*item)
        actual=self.sql(self.p.LEDGER_SQL)
        if result.returncode:
            report['terminalOwnedDatabaseDisposalRequired']=True
            report['sourceMayHaveCommittedBeforeFailure']=tag in ('f0061','f0062')
            match=re.search(rb'SQLSTATE[ :]+([A-Z0-9]{5})\b',result.stderr)
            if match:report['failedSqlstate']=match[1].decode()
            if actual!=self.entries:raise self.p.PrefixError('NATIVE_FAILED_LEDGER_CHANGED')
            raise self.p.PrefixError('NATIVE_HISTORICAL_SQL_FAILED')
        if type(actual) is not list or len(actual)!=len(self.entries)+1 or actual[:-1]!=self.entries:
            raise self.p.PrefixError('NATIVE_UNEXPECTED_LEDGER_DELTA')
        self.p.verify_entry(actual[-1],path.name,SimpleNamespace(name=name,sql=raw))
        self.entries=copy.deepcopy(actual)
        report.setdefault('canonicalExecutionUnits',[]).append({'stage':tag,'cliFile':path.name,
             'sourceCommitsBeforeLedger':tag in ('f0061','f0062'),
             'programSha256':self.p.sha(raw),'ledgerStatementsSha256':self.p.sha(
               json.dumps(actual[-1]['statements'],separators=(',',':')).encode())})
        return lower,upper

    def fault(self,tag,raw,state,snapshot,expected,report,guard=None):
        path,physical,name=self.create(tag,raw);installed=False
        try:
            if guard:
                if self.sql(guard(name)) is not True:raise self.p.PrefixError('NATIVE_FIXED63_PROOF_REQUIRED')
                installed=True
            result=self.native('migration','up','--local',allow_failure=True)
            self.p.verify_private(path,raw,physical)
            for item in self.retained:self.p.verify_private(*item)
            match=re.search(rb'SQLSTATE[ :]+([A-Z0-9]{5})\b',result.stderr)
            observed=match[1].decode() if match else None
            if result.returncode==0 or observed!=state:
                report['unexpectedSqlstate']=observed
                raise self.p.PrefixError('NATIVE_FIXED63_PROOF_REQUIRED')
            if self.sql(self.p.LEDGER_SQL)!=self.entries:raise self.p.PrefixError('NATIVE_FAILED_LEDGER_CHANGED')
        finally:
            if installed and self.sql(DROP_GUARD) is not True:raise self.p.PrefixError('NATIVE_FIXED63_PROOF_REQUIRED')
            self.p.verify_private(path,raw,physical);path.unlink()
        if snapshot()!=expected:raise self.p.PrefixError('NATIVE_FIXED63_ROLLBACK_REQUIRED')
        report.setdefault('negativeControls',[]).append({'stage':tag,'expectedSqlstate':state,
             'programSha256':self.p.sha(raw),'ledgerUnchanged':True,'scopedRollbackVerified':True})


def cleanup_program(prefix,core,sources,owner,before,post,*,old=False,wrong_post=False):
    company=core.company_reservation(before,sources)
    deletions,restorations=core.cleanup_plan(before,post,company)
    if [r for r in restorations if r['table']=='public.companies']!=[company]:
        raise prefix.PrefixError('NATIVE_FIXED63_RESTORATION_REQUIRED')
    token=uuid.uuid4().hex
    hashes=[prefix.sha(s.data) for s in sources]
    envelope=dict(database='postgres',owner=owner,stage='F2_COMPLETE',reservation=token,
       hashes=hashes,post_catalog=post[0],post_rows=[] if wrong_post else post[1],deletions=deletions,
       restorations=restorations,company=company,membership_check=before[0][core.CHECK_KEY])
    context="CREATE TEMP TABLE fixed_restoration_reservation(owner text NOT NULL,reservation text NOT NULL,hashes jsonb NOT NULL,database_name text NOT NULL,backend integer NOT NULL,transaction_id bigint NOT NULL,stage text NOT NULL,company jsonb NOT NULL) ON COMMIT DROP;\n"
    context+="INSERT INTO fixed_restoration_reservation SELECT "+core.value_sql(owner)+","+core.value_sql(token)+","+core.value_sql(hashes)+",current_database(),pg_backend_pid(),txid_current(),'F2_COMPLETE',"+core.value_sql(company)+";\n"
    context+="CREATE TEMP TABLE fixed_restoration_context(value jsonb NOT NULL) ON COMMIT DROP;\n"
    context+="INSERT INTO fixed_restoration_context SELECT "+core.value_sql(envelope)+" || jsonb_build_object('backend',pg_backend_pid()::text,'transaction',txid_current()::text);\n"
    context+=core.repair.catalog_capture('fixed_post_catalog')+'\n'
    site="SELECT coalesce(jsonb_agg(jsonb_build_array(name,value) ORDER BY name,value),'[]') FROM fixed_rows;"
    if core.ROWS_SQL.count(site)!=1:raise prefix.PrefixError('NATIVE_FIXED63_SOURCE_REQUIRED')
    context+=core.ROWS_SQL.replace(site,"CREATE TEMP TABLE fixed_post_rows ON COMMIT DROP AS SELECT coalesce(jsonb_agg(jsonb_build_array(name,value) ORDER BY name,value),'[]') AS rows FROM fixed_rows;")
    # Native CLI supplies this transaction. Original X keeps row/FK checks and
    # context consumption; only its exact old fixture target is transferred.
    return context.encode()+b'\n'+(sources[-1].data if old else cleanup_source(prefix,sources[-1],owner))


def ledger_guard(name):
    if not re.fullmatch(r'gridex_native_f0063_[a-f0-9]{12}',name):
        raise ValueError('EXACT_FIXED63_PROBE_NAME_REQUIRED')
    return ("BEGIN; CREATE SCHEMA gridex_native_fixed63_probe;\n"
       "REVOKE ALL ON SCHEMA gridex_native_fixed63_probe FROM PUBLIC,anon,authenticated,service_role;\n"
       "CREATE FUNCTION gridex_native_fixed63_probe.reject_ledger() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $guard$ BEGIN\n"
       "IF NEW.name IS DISTINCT FROM '"+name+"' OR EXISTS(SELECT FROM pg_temp.fixed_restoration_context) "
       "OR EXISTS(SELECT FROM pg_temp.fixed_restoration_reservation) "
       "THEN RAISE EXCEPTION 'NATIVE_FIXED63_CONTEXT_REQUIRED' USING ERRCODE='P6300'; END IF;\n"
       "RAISE EXCEPTION 'NATIVE_FIXED63_LEDGER_FAULT' USING ERRCODE='P6363'; END $guard$;\n"
       "REVOKE ALL ON FUNCTION gridex_native_fixed63_probe.reject_ledger() FROM PUBLIC,anon,authenticated,service_role;\n"
       "CREATE TRIGGER gridex_native_fixed63_guard BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION gridex_native_fixed63_probe.reject_ledger();\n"
       "SELECT pg_catalog.to_json(true); COMMIT;")


def execute(prefix,native,sql,work,first43,legacy52,repair56,dedupe57,report,*,provider_bootstrap):
    directory,entries,retained,owner=require_prefix(prefix,sql,work,first43,legacy52,repair56,dedupe57)
    if report:raise prefix.PrefixError('NATIVE_FRESH_PROGRESS_REQUIRED')
    report.update(scope='SOURCE_BOUND_NATIVE58_63_PRIVATE_FIXED_TARGET_NOT_FULL_REPLAY',verified=False,
       phase='SOURCE_ADMISSION',foundationInputsExecuted=0,cumulativeFoundationInputsExecuted=57,
       timestampInputsExecuted=0,completeReplayVerified=False,generatedTypesVerified=False,
       groupAtomic=False,originalHistoricalVersionsMarkedApplied=False)
    core,sources=load_sources(prefix);lane=Lane(prefix,native,sql,directory,entries,retained)
    provider.require(sql,provider_bootstrap)
    incoming=sql(EXTERNAL_FKS)
    if type(incoming) is not int or incoming!=0:
        raise prefix.PrefixError('NATIVE_FIXED63_GRAPH_REQUIRED')
    keys=','.join("'"+k+"'" for k in prefix.SETTINGS)
    if sql("SELECT jsonb_build_object('role',current_user,'database',current_database(),'settings',"
          "(SELECT jsonb_object_agg(name,setting) FROM pg_settings WHERE name IN ("+keys+")));")!={
          'role':'postgres','database':'postgres','settings':prefix.SETTINGS}:
        raise prefix.PrefixError('NATIVE_PRIVATE_LOGGING_REQUIRED')
    rows_query='BEGIN; SET LOCAL search_path=public,extensions,pg_temp;\n'+core.ROWS_SQL+'\nCOMMIT;'
    def snapshot():
        return {'catalog':sql(repair.catalog_sql(core.repair)),'rows':sql(rows_query),
          'providerCatalog':sql(provider.static_catalog_sql(core.repair)),
          'providerSequenceShape':sql(provider.SEQUENCE_SHAPE),'providerEvents':sql(provider.QUERY)}
    def domain(value):return value['catalog'],value['rows']
    def require_provider(value,before):
        if any(value[k]!=before[k] for k in ('providerCatalog','providerSequenceShape','providerEvents')):
            raise prefix.PrefixError('NATIVE_FIXED63_PROVIDER_DRIFT')
    before=snapshot();report['phase']='FIXED_GRAPH_ADMISSION'
    try:
        native_graph(prefix,core,(core.prerequisite_catalog(before['catalog']),before['rows']),sources)
        core.seed_expectation(before['catalog'],before['rows'],sources)
        expected_domain=core.prerequisite_state(domain(before))
        expected={**before,'catalog':expected_domain[0],'rows':expected_domain[1]}
        report['phase']='PREREQUISITES_58'
        lane.fault('f0058',sources[0].data+b"\nDO $$ BEGIN RAISE EXCEPTION 'P58' USING ERRCODE='P6358'; END $$;",'P6358',snapshot,before,report)
        lane.run('f0058',sources[0].data,report)
        if snapshot()!=expected:raise prefix.PrefixError('NATIVE_FIXED63_PREREQUISITES_REQUIRED')
        report['foundationInputsExecuted']=1
        report['phase']='SYNTHETIC_CONSTRUCTION'
        raw,oracle=constructor(prefix,core,expected_domain,sources)
        lane.fault('fixed_constructor',raw+b"\nDO $$ BEGIN RAISE EXCEPTION 'CONSTRUCTOR' USING ERRCODE='P6359'; END $$;",'P6359',snapshot,expected,report)
        lane.run('fixed_constructor',raw,report)
        post=snapshot();oracle.assert_snapshot(domain(post));require_provider(post,before)
        for ordinal,source in enumerate(sources[1:-1],59):
            report['phase']='WHOLE_SOURCE_'+str(ordinal)
            if source.refresh()!=source.data:raise prefix.PrefixError('NATIVE_FIXED63_SOURCE_REQUIRED')
            lower,upper=lane.run('f'+str(ordinal).zfill(4),source.data,report)
            report['foundationInputsExecuted']+=1
            oracle=core.Oracle(core,domain(post),lower,upper)
            if source.key=='B0':core.bootstrap(oracle,source)
            elif source.key in ('C2','D2'):core.activate(oracle,source)
            else:core.normalize(oracle,source)
            post=snapshot();oracle.assert_snapshot(domain(post));require_provider(post,before)
            members=[r for table,r in post['rows'] if table=='public.company_memberships'
                     and r['user_id']==sources[2].slots['U_target']]
            if (source.key=='C2' and members) or (source.key in ('D2','F2') and len(members)!=1):
                raise prefix.PrefixError('NATIVE_FIXED63_BRANCH_EFFECT_REQUIRED')
        report['phase']='RESTORATION_63_QUALIFICATION'
        for options in ({'old':True},{'wrong_post':True}):
            raw=cleanup_program(prefix,core,sources,owner,expected_domain,domain(post),**options)
            lane.fault('f0063',raw,'55000',snapshot,post,report)
        raw=cleanup_program(prefix,core,sources,owner,expected_domain,domain(post))
        lane.fault('f0063',raw,'P6363',snapshot,post,report,ledger_guard)
        _,again=load_sources(prefix)
        if any(a.data!=b.data for a,b in zip(again,sources)):
            raise prefix.PrefixError('NATIVE_FIXED63_SOURCE_REQUIRED')
        report['phase']='RESTORATION_63_EXECUTION'
        lane.run('f0063',raw,report)
        if snapshot()!=expected:raise prefix.PrefixError('NATIVE_FIXED63_RESTORATION_REQUIRED')
        native('migration','up','--local')
        for item in retained:prefix.verify_private(*item)
        if sql(prefix.LEDGER_SQL)!=lane.entries or snapshot()!=expected:
            raise prefix.PrefixError('NATIVE_HISTORICAL_LEDGER_REPEAT_CHANGED')
    except core.BoundaryError as error:
        # Only fixed, source-reviewed oracle codes, never SQL stderr or rows.
        allowed={'FULL_ROW_MULTISET_MISMATCH','FULL_PK_FIELD_ORACLE_MISMATCH','RELATED_GENERATED_VALUE_MISMATCH',
          'FULL_CATALOG_ORACLE_MISMATCH','EXACT_PREFIX_COMPANY_REQUIRED','PINNED_PREFIX_SEED_REQUIRED',
          'COMPLETE_PREFIX_SEED_REQUIRED','DEFAULT_ORACLE_REVIEW_REQUIRED','PREFIX_SEED_GENERATED_SHAPE_REQUIRED',
          'PREFIX_COMPANY_RESERVATION_REQUIRED','CAPTURED_GRAPH_NOT_CHILD_FIRST','UNREVIEWED_FK_TARGET'}
        if len(error.args)==1 and error.args[0] in allowed:report['oracleErrorCode']=error.args[0]
        report['terminalOwnedDatabaseDisposalRequired']=True
        raise prefix.PrefixError('NATIVE_FIXED63_ORACLE_REQUIRED') from None
    report.update(verified=True,phase='VERIFIED',foundationInputsExecuted=6,cumulativeFoundationInputsExecuted=63,
        canonicalExecutionUnitCount=7,noOpRepeatVerified=True,unchangedEarlierLedger=True,
        sourceEffectsIndependentlyVerified=True,restorationSourceAdmissionTransferred=True,
        originalRestorationAlgorithmPreserved=True,originalDomainRowsAndSequencesPreserved=True,
        providerCacheSequenceRollbackClaimed=False,supportSha256={'canonical-user-rbac-fixed-target-batch.py':CORE_SHA},
        sources=[{'ordinal':i,'source':'migrations/'+s.path.name,'sourceSha256':prefix.sha(s.data),
                  'nativeEnvironmentAdmissionTransferred':s.key=='X'} for i,s in enumerate(sources,58)])
    return report
