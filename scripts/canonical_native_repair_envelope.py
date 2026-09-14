"""Native foundation53-56: exact R2/E2/S2/W programs in one CLI transaction.

No hosted target, role elevation, historical rewrite or direct applied-ledger
write. The independent DDL oracle runs with ROLLBACK on the verified native52
preimage. Raw SQL/catalog/rows stay inside the existing private lifecycle.
"""
from dataclasses import dataclass, field
import copy
import hashlib
import importlib.util
import json
import re
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import canonical_native_legacy_envelope as previous
import canonical_native_trigger_diagnostics as trigger_diagnostics

ROOT = Path(__file__).resolve().parents[1]
PINS = {'canonical-user-rbac-repair-batch.py': '9b0d3d22c4826f9c8a90501b9ee9b24b0d502e1cd7e68207ea4b40c6765ce43f', 'sql/canonical-user-rbac-repair-admission.sql': '107260d28f6c22889575facda5c237a072811a158b55ff69883002b8b5c872a7', 'sql/canonical-user-rbac-repair-assertions.sql': '5afc3a8ab872d93122e38986c51da9987ae461b53d823e3e1df970a3eb99b99f', 'sql/canonical-user-rbac-repair-catalog.sql': '1d6315ea6d4d542a01e4b697f1cc2b4528a227f2be7e7052f47c8a04166103c7'}
PROVIDER_METADATA = dict(previous.PROVIDER_METADATA)
TAG = '$gridex_native_repair56$'
NAME = r'gridex_native_f0053_0056_[a-f0-9]{12}'
TIMEOUTS = previous.TIMEOUTS
FINISH = """DO $repair56_finish$ BEGIN
 IF (SELECT count(*) FROM pg_temp.repair_context WHERE txid=txid_current()
 AND backend=pg_backend_pid() AND database_name=current_database() AND stage='completed')<>1
 THEN RAISE EXCEPTION 'NATIVE_REPAIR56_INCOMPLETE' USING ERRCODE='P5600'; END IF;
END $repair56_finish$;
"""
MARKER = b"\nALTER TABLE public.gridex_native_lifecycle_probe ADD COLUMN repair56_rollback_marker integer;\nINSERT INTO public.gridex_native_lifecycle_probe(id) VALUES (5600001);\n"
BOUNDARY = """
 IF current_setting('transaction_isolation') <> 'read committed'
 OR current_setting('lock_timeout')::interval <> interval '10 seconds'
 OR current_setting('statement_timeout')::interval <> interval '60 seconds'
 OR NOT EXISTS (SELECT FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory'
   AND classid=20260910 AND objid=140053 AND objsubid=2 AND granted)
 OR EXISTS (SELECT FROM jsonb_each((SELECT base FROM pg_temp.repair_reference)) r
   WHERE r.key LIKE 'relation/%' AND r.value->>'kind' IN ('r','p') AND NOT EXISTS
   (SELECT FROM pg_locks WHERE pid=pg_backend_pid() AND relation=to_regclass(substr(r.key,10))
    AND granted AND mode=CASE WHEN substr(r.key,10) IN
      (SELECT relation_name FROM pg_temp.repair_native_readonly)
      THEN 'AccessShareLock' ELSE 'AccessExclusiveLock' END))
 OR (SELECT count(*) FROM pg_temp.repair_context WHERE txid=txid_current()
   AND backend=pg_backend_pid() AND database_name=current_database() AND stage='completed')<>1
 OR NOT EXISTS (SELECT FROM public.gridex_native_lifecycle_probe WHERE id=5600001)
 THEN RAISE EXCEPTION 'NATIVE_REPAIR56_BOUNDARY_FAILED' USING ERRCODE='P5600'; END IF;
"""
DROP_GUARD = """BEGIN;
DROP TRIGGER gridex_native_repair56_guard ON supabase_migrations.schema_migrations;
DROP FUNCTION gridex_native_repair56_probe.reject_ledger();
DROP SCHEMA gridex_native_repair56_probe;
SELECT pg_catalog.to_json(true); COMMIT;
"""
SEQUENCES_SQL = """BEGIN;
SET LOCAL search_path=public,extensions,pg_temp;
CREATE TEMP TABLE native_repair56_sequences(name text,value jsonb) ON COMMIT DROP;
DO $snapshot$ DECLARE r record; BEGIN
 FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage') AND c.relkind='S' ORDER BY n.nspname,c.relname LOOP
 EXECUTE format('INSERT INTO pg_temp.native_repair56_sequences SELECT %L,jsonb_build_object(''last_value'',last_value,''log_cnt'',log_cnt,''is_called'',is_called) FROM %I.%I',
 format('%I.%I',r.nspname,r.relname),r.nspname,r.relname);
 END LOOP;
END $snapshot$;
SELECT coalesce(jsonb_object_agg(name,value),'{}'::jsonb) FROM pg_temp.native_repair56_sequences;
COMMIT;
"""


def load_sources(prefix):
    try:
        for name, digest in PINS.items():
            path=ROOT/'scripts'/name
            if path.resolve()!=path or not path.is_file() or prefix.sha(path.read_bytes())!=digest:
                raise ValueError('source')
        path=ROOT/'scripts/canonical-user-rbac-repair-batch.py'
        spec=importlib.util.spec_from_file_location('native_repair56_authority',path)
        batch=importlib.util.module_from_spec(spec)
        sys.modules[spec.name]=batch
        try:
            spec.loader.exec_module(batch)
            sources=batch.validate_sources(batch.reviewed_paths())
        finally:
            sys.modules.pop(spec.name,None)
        order=json.loads((ROOT/'scripts/gridex-aud-003-foundation-order.json').read_text())['foundation']
        if (prefix.sha(json.dumps(order,separators=(',',':')).encode())!=prefix.ORDER_SHA
                or ['migrations/'+s.path.name for s in sources]!=order[52:56]):
            raise ValueError('order')
        return batch,sources
    except Exception:
        raise prefix.PrefixError('NATIVE_REPAIR56_SOURCE_REQUIRED') from None


def validate_preimage(prefix,batch,sources,before):
    """Same independent first52 index/helper/absence authorities as repair batch."""
    index={'definition':'CREATE INDEX user_roles_user_active_idx ON public.user_roles USING btree (user_id, status, is_active)',
           'valid':True,'ready':True,'unique':False,'primary':False,'exclusion':False,'immediate':True,'nulls_not_distinct':False}
    if before.get('index/public.user_roles_user_active_idx')!=index:
        raise prefix.PrefixError('NATIVE_REPAIR56_REFERENCE_REQUIRED')
    for key in ('function/public.gridex_get_user_roles(', 'function/public.gridex_table_has_company_id(',
                'relation/public.gridex_debug_batch2_rbac_v','relation/public.gridex_debug_batch2_tenant_policy_gaps_v'):
        if any(k.startswith(key) for k in before):
            raise prefix.PrefixError('NATIVE_REPAIR56_REFERENCE_REQUIRED')
    manifest=json.loads((ROOT/'scripts/migration-history-manifest.json').read_text())['files']
    for filename,names in (
            ('20260520_batch_6e_hard_platform_roles_only.sql',('gridex_user_is_platform_admin',)),
            ('20260520_batch_6e_rbac_tenant_stats_whitelabel.sql',('gridex_can_read_company','gridex_can_write_company'))):
        path=ROOT/'supabase/migrations'/filename
        raw=path.read_bytes()
        if path.is_symlink() or prefix.sha(raw)!=manifest[filename]:
            raise prefix.PrefixError('NATIVE_REPAIR56_SOURCE_REQUIRED')
        for name in names:
            match=re.search(r'create or replace function public\.'+name+r'\(.*?as \$\$(.*?)\$\$;',raw.decode(),re.I|re.S)
            definitions=[v['definition'] for k,v in before.items() if k.startswith('function/public.'+name+'(')]
            if not match or len(definitions)!=1 or match[1] not in definitions[0]:
                raise prefix.PrefixError('NATIVE_REPAIR56_REFERENCE_REQUIRED')
    batch.source_oracle(sources)


def oracle_sql(prefix,batch,sources):
    """Only pinned source-declared diagnostic DDL plus private ACLs; never W/DML."""
    _,declarations=batch.source_oracle(sources)
    query='SET LOCAL search_path=public,extensions,pg_temp;\n'+TIMEOUTS.decode()+declarations+'\n'
    for name in batch.FUNCTIONS:
        query+='REVOKE ALL ON FUNCTION public.'+name+' FROM PUBLIC;\n'
    for name in batch.VIEWS:
        query+='ALTER VIEW public.'+name+' SET (security_invoker=true);\n'
        query+='REVOKE ALL ON TABLE public.'+name+' FROM PUBLIC;\n'
    query+="""DO $oracle$ DECLARE r record; obj text; BEGIN
 FOR r IN SELECT rolname FROM pg_roles WHERE rolname<>current_user LOOP
 FOREACH obj IN ARRAY ARRAY['gridex_get_user_roles(uuid)','gridex_table_has_company_id(text)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM %I',obj,r.rolname); END LOOP;
 FOREACH obj IN ARRAY ARRAY['gridex_debug_batch2_rbac_v','gridex_debug_batch2_tenant_policy_gaps_v'] LOOP
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',obj,r.rolname); END LOOP;
 END LOOP; END $oracle$;
"""
    query+=batch.catalog_sql()+'\n'
    batch.legacy.check_support(query)
    return 'BEGIN;\n'+query+'ROLLBACK;\n'


@dataclass(frozen=True)
class Envelope:
    sql: bytes=field(repr=False)
    sources: tuple
    parts: tuple=field(repr=False)
    provider_relations: tuple=()
    old_permission_probe: bytes=field(default=b'',repr=False)

    @property
    def name(self):
        return 'gridex_native_f0053_0056_'+hashlib.sha256(self.sql).hexdigest()[:12]


def wrap(prefix,parts):
    commands=[]
    for i,text in enumerate(parts):
        tag='$repair56_part_'+str(i)+'$'
        if TAG in text or tag in text:
            raise prefix.PrefixError('NATIVE_REPAIR56_SOURCE_REQUIRED')
        commands.append('EXECUTE '+tag+text+tag+';')
    raw=TIMEOUTS+('DO '+TAG+'\nBEGIN\n'+'\n'.join(commands)+'\nEND\n'+TAG+';\n').encode()
    if len(raw)>prefix.MAX_SQL:raise prefix.PrefixError('NATIVE_SQL_INPUT_REQUIRED')
    return raw


def prepare(prefix,batch,sources,before,final,provider_relations=()):
    if (sources!=batch.validate_sources(batch.reviewed_paths()) or not isinstance(before,dict) or not before
            or not isinstance(final,dict) or not final or type(provider_relations) is not tuple
            or provider_relations!=tuple(sorted(set(provider_relations)))):
        raise prefix.PrefixError('NATIVE_REPAIR56_SOURCE_REQUIRED')
    for name in provider_relations:
        if (name not in PROVIDER_METADATA or before.get('relation/'+name,{}).get('owner')!=PROVIDER_METADATA[name]
                or before.get('relation/'+name,{}).get('kind') not in ('r','p')
                or any(previous.source_mentions_identifier(prefix,s.data.decode(),name.split('.')[1]) for s in sources)):
            raise prefix.PrefixError('NATIVE_REPAIR56_SOURCE_REQUIRED')
    context="""DO $isolation$ BEGIN
 IF current_setting('transaction_isolation')<>'read committed'
 THEN RAISE EXCEPTION 'NATIVE_REPAIR56_ISOLATION_REQUIRED' USING ERRCODE='P5600'; END IF;
END $isolation$;
CREATE TEMP TABLE repair_reference(base jsonb NOT NULL,final jsonb NOT NULL,hashes text[] NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE repair_native_readonly(relation_name text PRIMARY KEY) ON COMMIT DROP;
"""
    context+='INSERT INTO repair_reference VALUES ('+batch.literal(json.dumps(before))+'::jsonb,'+batch.literal(json.dumps(final))+'::jsonb,ARRAY['+','.join(batch.literal(s.sha256) for s in sources)+']);\n'
    if provider_relations:
        context+='INSERT INTO repair_native_readonly VALUES '+','.join('('+batch.literal(n)+')' for n in provider_relations)+';\n'
    admission=(batch.SUPPORT/'canonical-user-rbac-repair-admission.sql').read_text()
    admission=admission.replace('-- REPAIR_CATALOG_CAPTURE',batch.catalog_capture('repair_catalog_before'))
    admission=admission.replace('-- REPAIR_SEED_ORACLE',batch.seed_oracle_sql(sources))
    admission=admission.replace('-- REPAIR_DIAGNOSTIC_GUARD',batch.diagnostic_guard(sources))
    original=admission
    site="  EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE',rel::regclass);"
    if admission.count(site)!=1:raise prefix.PrefixError('NATIVE_REPAIR56_SOURCE_REQUIRED')
    if provider_relations:
        admission=admission.replace(site,"  IF substr(r.key,10) IN ("+','.join(batch.literal(n) for n in provider_relations)+") THEN\n   EXECUTE format('LOCK TABLE %s IN ACCESS SHARE MODE',rel::regclass);\n  ELSE\n"+site+"\n  END IF;")
    parts=[context,admission]; prior='admitted'
    for source in sources:
        parts.append(source.data.decode())
        if source.alias!='W':parts.append(batch.stage_sql(prior,source.alias))
        prior=source.alias
    assertions=(batch.SUPPORT/'canonical-user-rbac-repair-assertions.sql').read_text().replace('-- REPAIR_CATALOG_CAPTURE',batch.catalog_capture('repair_catalog_after'))
    parts.extend((assertions,FINISH))
    receipts=tuple({'ordinal':i,'source':'migrations/'+s.path.name,'sourceSha256':s.sha256} for i,s in enumerate(sources,53))
    old=(wrap(prefix,[context,original,sources[0].data.decode(),
         "DO $old$ BEGIN RAISE EXCEPTION 'OLD_PERMISSION_PROBE_DID_NOT_FAIL' USING ERRCODE='P5600'; END $old$;"]) if provider_relations else b'')
    return Envelope(wrap(prefix,parts),receipts,tuple(parts),provider_relations,old)


def catalog_sql(batch):
    return 'BEGIN READ ONLY; SET LOCAL search_path=public,extensions,pg_temp;\n'+batch.catalog_sql()+'\nCOMMIT;'


def provider_profile(prefix,sql,before):
    permissions=sql(previous.LOCK_PRIVILEGES)
    expected={k[len('relation/'):] for k,v in before.items() if k.startswith('relation/') and v.get('kind') in ('r','p')}
    if (type(permissions) is not list or any(type(p) is not dict or set(p)!=
            {'relation','owner','canShareLock','canSelect','canWrite'} or
            any(type(p[k]) is not bool for k in ('canShareLock','canSelect','canWrite')) for p in permissions)
            or {p['relation'] for p in permissions}!=expected or len(permissions)!=len(expected)):
        raise prefix.PrefixError('NATIVE_REPAIR56_SOURCE_REQUIRED')
    deficits=[p for p in permissions if not p['canShareLock']]
    if any(p['relation'] not in PROVIDER_METADATA or p['owner']!=PROVIDER_METADATA[p['relation']]
           or not p['canSelect'] or p['canWrite'] for p in deficits):
        raise prefix.PrefixError('NATIVE_REPAIR56_SOURCE_REQUIRED')
    return tuple(sorted(p['relation'] for p in deficits))


def ledger_guard(name):
    if not re.fullmatch(NAME,name):raise ValueError('EXACT_REPAIR56_PROBE_NAME_REQUIRED')
    return ("BEGIN; CREATE SCHEMA gridex_native_repair56_probe;\n"
            "REVOKE ALL ON SCHEMA gridex_native_repair56_probe FROM PUBLIC,anon,authenticated,service_role;\n"
            "CREATE FUNCTION gridex_native_repair56_probe.reject_ledger() RETURNS trigger\n"
            "LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $guard$ BEGIN\n"
            "IF NEW.name IS DISTINCT FROM '"+name+"' THEN RAISE EXCEPTION 'WRONG_PROBE' USING ERRCODE='P5600'; END IF;\n"
            +BOUNDARY+"RAISE EXCEPTION 'NATIVE_REPAIR56_LEDGER_PROBE' USING ERRCODE='P5657';\nEND $guard$;\n"
            "REVOKE ALL ON FUNCTION gridex_native_repair56_probe.reject_ledger() FROM PUBLIC,anon,authenticated,service_role;\n"
            "CREATE TRIGGER gridex_native_repair56_guard BEFORE INSERT ON supabase_migrations.schema_migrations\n"
            "FOR EACH ROW EXECUTE FUNCTION gridex_native_repair56_probe.reject_ledger();\n"
            "SELECT pg_catalog.to_json(true); COMMIT;")


def probes(prefix,program):
    mid=list(program.parts[:3])+["DO $fail$ BEGIN RAISE EXCEPTION 'MID' USING ERRCODE='P5653'; END $fail$;"]
    timed=list(program.parts[:3])+["DO $deadline$ BEGIN PERFORM pg_catalog.pg_sleep(61); END $deadline$;"]
    post=('DO $post$ BEGIN\n'+BOUNDARY+"RAISE EXCEPTION 'POST' USING ERRCODE='P5656'; END $post$;\n").encode()
    old=((program.old_permission_probe,'42501',False),) if program.provider_relations else ()
    return old+((wrap(prefix,mid),'P5653',False),(wrap(prefix,timed),'57014',False),
                (program.sql+MARKER+post,'P5656',False),(program.sql+MARKER,'P5657',True))


def create_unit(prefix,native,directory,raw,expected,files):
    name='gridex_native_f0053_0056_'+prefix.sha(raw)[:12]
    time.sleep(1.05)
    native('migration','new',name)
    current={p.name for p in directory.iterdir()}; added=current-files
    if len(added)!=1 or not files<=current:raise prefix.PrefixError('NATIVE_CLI_CREATED_FILE_REQUIRED')
    path=directory/next(iter(added))
    if not re.fullmatch(r'\d{14}_'+re.escape(name)+r'\.sql',path.name) or path.name[:14]<=expected[-1]['version']:
        raise prefix.PrefixError('NATIVE_CLI_CREATED_FILE_REQUIRED')
    physical=prefix.private_write(path,raw);prefix.verify_private(path,raw,physical)
    return path,physical,name


def qualify(prefix,native,sql,directory,program,expected,retained,snapshot,report):
    before=snapshot(); files={p.name for p in directory.iterdir()}
    report.update(verified=False,cases=[])
    for raw,state,guarded in probes(prefix,program):
        report.update(phase='CLI_FILE_CREATION',currentProbe=state)
        path,physical,name=create_unit(prefix,native,directory,raw,expected,files)
        installed=False
        try:
            if guarded:
                report['phase']='LEDGER_GUARD_INSTALL'
                if sql(ledger_guard(name)) is not True:raise prefix.PrefixError('NATIVE_REPAIR56_PROOF_REQUIRED')
                installed=True
            for item in retained:prefix.verify_private(*item)
            report['phase']='EXPECTED_MIGRATION_FAILURE'
            result=native('migration','up','--local',allow_failure=True)
            prefix.verify_private(path,raw,physical)
            for item in retained:prefix.verify_private(*item)
            match=re.search(rb'SQLSTATE[ :]+([A-Z0-9]{5})\b',result.stderr)
            observed=match[1].decode() if match else None
            if result.returncode==0 or observed!=state:
                report['unexpectedSqlstate']=observed
                report['permissionDiagnostic']=previous.permission_diagnostic(result.stderr,before['catalog'])
                raise prefix.PrefixError('NATIVE_REPAIR56_PROOF_REQUIRED')
            if state=='42501' and previous.permission_diagnostic(result.stderr,before['catalog']).get('relation')!=program.provider_relations[0]:
                raise prefix.PrefixError('NATIVE_REPAIR56_PROOF_REQUIRED')
            if sql(prefix.LEDGER_SQL)!=expected:raise prefix.PrefixError('NATIVE_FAILED_LEDGER_CHANGED')
        finally:
            if installed and sql(DROP_GUARD) is not True:raise prefix.PrefixError('NATIVE_REPAIR56_PROOF_REQUIRED')
            prefix.verify_private(path,raw,physical);path.unlink()
        report['phase']='ROLLBACK_VERIFICATION'
        if snapshot()!=before or {p.name for p in directory.iterdir()}!=files:
            raise prefix.PrefixError('NATIVE_REPAIR56_ROLLBACK_REQUIRED')
        report['cases'].append({'expectedSqlstate':state,'programSha256':prefix.sha(raw),
                                'ledgerUnchanged':True,'catalogRowsAndSequencesRestored':True})
    report.update(verified=True,phase='VERIFIED',locksHeldAtLedgerInsert=True,
                  temporaryContextHeldAtLedgerInsert=True,localTimeoutsPreserved=True,
                  statementDeadlineExecuted=True,noAppliedProbeRows=True,helpersDisposed=True)


def prerequisite(prefix,sql,work,first43,legacy52):
    if (first43.get('historicalPrefixLedgerVerified') is not True or first43.get('foundationInputsExecuted')!=43
            or first43.get('timestampInputsExecuted')!=0 or first43.get('transactionBoundary27',{}).get('verified') is not True
            or len(first43.get('canonicalExecutionUnits',[]))!=43 or legacy52.get('verified') is not True
            or legacy52.get('cumulativeFoundationInputsExecuted')!=52 or legacy52.get('foundationInputsExecuted')!=9
            or legacy52.get('timestampInputsExecuted')!=0 or legacy52.get('canonicalExecutionUnitCount')!=1
            or legacy52.get('transactionBoundary44_52',{}).get('verified') is not True
            or legacy52.get('noOpRepeatVerified') is not True or legacy52.get('supportSha256')!=previous.PINS):
        raise prefix.PrefixError('NATIVE_REPAIR56_PREFIX_REQUIRED')
    directory=work/'supabase/migrations'
    if directory.resolve()!=directory or directory.stat().st_mode & 0o077:
        raise prefix.PrefixError('NATIVE_PRIVATE_SOURCE_REQUIRED')
    expected=sql(prefix.LEDGER_SQL)
    if type(expected) is not list or len(expected)!=45:
        raise prefix.PrefixError('NATIVE_REPAIR56_PREFIX_REQUIRED')
    if {p.name for p in directory.iterdir()}!={e['version']+'_'+e['name']+'.sql' for e in expected}:
        raise prefix.PrefixError('NATIVE_UNEXPECTED_MIGRATION_INPUT')
    retained=[]
    for i,(entry,program,receipt) in enumerate(zip(expected[1:44],prefix.prepare(),first43['canonicalExecutionUnits']),1):
        filename=receipt['cliFile'];path=directory/filename
        prefix.verify_entry(entry,filename,program)
        if (receipt['sourceSha256']!=program.source_sha256 or receipt['programSha256']!=program.digest
                or receipt['ordinal']!=i or receipt['source']!=program.source):
            raise prefix.PrefixError('NATIVE_REPAIR56_PREFIX_REQUIRED')
        meta=path.lstat();retained.append((path,program.sql,(meta.st_dev,meta.st_ino)))
        prefix.verify_private(*retained[-1])
    batch,sources=previous.load_sources(prefix)
    records=[{'ordinal':i,'source':'migrations/'+s.path.name,'sourceSha256':s.sha256} for i,s in enumerate(sources,44)]
    if list(legacy52.get('sources',[]))!=records:raise prefix.PrefixError('NATIVE_REPAIR56_PREFIX_REQUIRED')
    for entry,is_legacy in ((expected[0],False),(expected[-1],True)):
        filename=entry['version']+'_'+entry['name']+'.sql';path=directory/filename
        if path.is_symlink() or not path.is_file():raise prefix.PrefixError('NATIVE_PRIVATE_SOURCE_REQUIRED')
        meta=path.lstat();raw=path.read_bytes()
        prefix.verify_private(path,raw,(meta.st_dev,meta.st_ino))
        if is_legacy:
            if (filename!=legacy52['cliFile'] or prefix.sha(raw)!=legacy52['programSha256']
                    or entry['name']!='gridex_native_f0044_0052_'+prefix.sha(raw)[:12]
                    or prefix.sha(json.dumps(entry['statements'],separators=(',',':')).encode())!=legacy52['ledgerStatementsSha256']):
                raise prefix.PrefixError('NATIVE_REPAIR56_PREFIX_REQUIRED')
            prefix.verify_entry(entry,filename,SimpleNamespace(name=entry['name'],sql=raw))
        elif (entry['name']!='native_lifecycle_proof' or tuple(t for s in entry['statements'] for t in prefix.identity(s))!=prefix.identity(raw.decode())):
            raise prefix.PrefixError('NATIVE_SYNTHETIC_PREFLIGHT_LEDGER_REQUIRED')
        retained.append((path,raw,(meta.st_dev,meta.st_ino)))
    return directory,copy.deepcopy(expected),retained


def execute(prefix,native,sql,work,first43,legacy52,report):
    directory,expected,retained=prerequisite(prefix,sql,work,first43,legacy52)
    if report:raise prefix.PrefixError('NATIVE_FRESH_PROGRESS_REQUIRED')
    report.update(scope='FOUNDATION53_56_ATOMIC_NATIVE_NOT_FULL_REPLAY',verified=False,
                  foundationInputsExecuted=0,cumulativeFoundationInputsExecuted=52,timestampInputsExecuted=0,
                  completeReplayVerified=False,generatedTypesVerified=False,originalHistoricalVersionsMarkedApplied=False,
                  phase='SOURCE_ADMISSION')
    batch,sources=load_sources(prefix)
    keys=','.join("'"+k+"'" for k in prefix.SETTINGS)
    if sql("SELECT jsonb_build_object('role',current_user,'database',current_database(),'settings',"
           "(SELECT jsonb_object_agg(name,setting) FROM pg_settings WHERE name IN ("+keys+")));")!={
            'role':'postgres','database':'postgres','settings':prefix.SETTINGS}:
        raise prefix.PrefixError('NATIVE_PRIVATE_LOGGING_REQUIRED')
    def snapshot():
        return {'catalog':sql(catalog_sql(batch)),'rows':sql(previous.ROWS_SQL),'sequences':sql(SEQUENCES_SQL)}
    before=snapshot();validate_preimage(prefix,batch,sources,before['catalog'])
    providers=provider_profile(prefix,sql,before['catalog'])
    report['nativeReadOnlyProviderMetadata']=providers
    report['triggerAdmissionDiagnostic']=trigger_diagnostics.summarize(sql(trigger_diagnostics.QUERY))
    report['phase']='INDEPENDENT_SOURCE_DDL_ORACLE'
    final=sql(oracle_sql(prefix,batch,sources))
    if not isinstance(final,dict) or not final or final==before['catalog'] or snapshot()!=before or sql(prefix.LEDGER_SQL)!=expected:
        raise prefix.PrefixError('NATIVE_REPAIR56_ORACLE_ROLLBACK_REQUIRED')
    report['independentOracleRollbackVerified']=True
    if sql("SELECT to_json(to_regnamespace('gridex_native_repair56_probe') IS NULL);") is not True:
        raise prefix.PrefixError('NATIVE_REPAIR56_PROOF_REQUIRED')
    program=prepare(prefix,batch,sources,before['catalog'],final,providers)
    report['sources']=program.sources;report['transactionBoundary53_56']={}
    report['phase']='ATOMIC_BOUNDARY_QUALIFICATION'
    qualify(prefix,native,sql,directory,program,expected,retained,snapshot,report['transactionBoundary53_56'])
    new_batch,new_sources=load_sources(prefix)
    if prepare(prefix,new_batch,new_sources,before['catalog'],final,providers).sql!=program.sql:
        raise prefix.PrefixError('NATIVE_REPAIR56_SOURCE_REQUIRED')
    report['phase']='ATOMIC_CLI_MIGRATION'
    path,physical,name=create_unit(prefix,native,directory,program.sql,expected,{p.name for p in directory.iterdir()})
    retained.append((path,program.sql,physical))
    for item in retained:prefix.verify_private(*item)
    result=native('migration','up','--local',allow_failure=True)
    for item in retained:prefix.verify_private(*item)
    actual=sql(prefix.LEDGER_SQL)
    if result.returncode:
        match=re.search(rb'SQLSTATE[ :]+([A-Z0-9]{5})\b',result.stderr)
        if match:report['failedSqlstate']=match[1].decode()
        if actual!=expected:raise prefix.PrefixError('NATIVE_FAILED_LEDGER_CHANGED')
        raise prefix.PrefixError('NATIVE_HISTORICAL_SQL_FAILED')
    if type(actual) is not list or len(actual)!=len(expected)+1 or actual[:-1]!=expected:
        raise prefix.PrefixError('NATIVE_UNEXPECTED_LEDGER_DELTA')
    prefix.verify_entry(actual[-1],path.name,program)
    after=snapshot()
    if after['catalog']!=final:raise prefix.PrefixError('NATIVE_REPAIR56_REFERENCE_REQUIRED')
    native('migration','up','--local')
    for item in retained:prefix.verify_private(*item)
    if sql(prefix.LEDGER_SQL)!=actual or snapshot()!=after:
        raise prefix.PrefixError('NATIVE_HISTORICAL_LEDGER_REPEAT_CHANGED')
    report.update(verified=True,phase='VERIFIED',foundationInputsExecuted=4,cumulativeFoundationInputsExecuted=56,
                  canonicalExecutionUnitCount=1,cliFile=path.name,programSha256=prefix.sha(program.sql),
                  ledgerStatementsSha256=prefix.sha(json.dumps(actual[-1]['statements'],separators=(',',':')).encode()),
                  unchangedEarlierLedger=True,noOpRepeatVerified=True,sourcePreservationAssertionsExecuted=True,
                  supportSha256=dict(PINS))
    return report
