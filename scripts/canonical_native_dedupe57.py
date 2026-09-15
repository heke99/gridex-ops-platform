"""Whole H2 through the official CLI on the parent's disposable native56.

H2 commits BEFORE its final SELECT and the CLI ledger insertion. Do not claim
atomic rollback across that boundary. Expected post-commit fault probes inspect
persisted indexes, then explicitly dispose only those two oracle-verified probe
indexes. Any unexpected failure is terminal; the parent disposes the owned DB.
No linked target, original-source rewrite, ledger repair or privilege change.
"""
from dataclasses import dataclass, field
import copy
import importlib.util
import json
from pathlib import Path
import re
import sys
import time
from types import SimpleNamespace

import canonical_native_repair_envelope as repair
import canonical_native_provider_events as provider

ROOT = Path(__file__).resolve().parents[1]
BATCH_SHA = 'fc9c13d3894b297e1c66e69486d4bf55b1a07a430a5b311e1e3fbc69552803ea'
SOURCE_SHA = '98522e209332c44c804d7acccf831f25fb13b75b048fbe3613c8d69fcb373a9b'
NAME = r'gridex_native_f0057_[a-f0-9]{12}'
INDEXES = ('user_roles_active_unique_role_text_idx','user_roles_active_unique_role_id_idx')
ROLE_COUNT = 'SELECT count(*) FROM public.user_roles;'
CLEAN_INDEXES = '''BEGIN;
DROP INDEX public.user_roles_active_unique_role_text_idx;
DROP INDEX public.user_roles_active_unique_role_id_idx;
SELECT pg_catalog.to_json(true); COMMIT;
'''
DROP_GUARD = '''BEGIN;
DROP TRIGGER gridex_native_dedupe57_guard ON supabase_migrations.schema_migrations;
DROP FUNCTION gridex_native_dedupe57_probe.reject_ledger();
DROP SCHEMA gridex_native_dedupe57_probe;
SELECT pg_catalog.to_json(true); COMMIT;
'''
TX_PROBE = b'''BEGIN;
CREATE TEMP TABLE gridex_h2_tx_probe (xid bigint NOT NULL) ON COMMIT PRESERVE ROWS;
INSERT INTO gridex_h2_tx_probe VALUES (txid_current());
'''


def load_source(prefix):
    try:
        path=ROOT/'scripts/canonical-user-rbac-dedupe-batch.py'
        if path.resolve()!=path or prefix.sha(path.read_bytes())!=BATCH_SHA:
            raise ValueError('source')
        # Reuse the immutable H2 authority; never invoke its other DB lifecycle.
        spec=importlib.util.spec_from_file_location('native57_source_authority',path)
        batch=importlib.util.module_from_spec(spec);sys.modules[spec.name]=batch
        try:spec.loader.exec_module(batch)
        finally:sys.modules.pop(spec.name,None)
        source,=batch.validate_sources(batch.reviewed_paths())
        order=json.loads((ROOT/'scripts/gridex-aud-003-foundation-order.json').read_text())['foundation']
        if (prefix.sha(json.dumps(order,separators=(',',':')).encode())!=prefix.ORDER_SHA
                or order[56]!='migrations/'+source.path.name or source.sha256!=SOURCE_SHA):
            raise ValueError('order')
        program(prefix,source)
        return batch,source
    except Exception:
        raise prefix.PrefixError('NATIVE_DEDUPE57_SOURCE_REQUIRED') from None


def program(prefix,source):
    if prefix.sha(source.data)!=SOURCE_SHA or source.sha256!=SOURCE_SHA:
        raise prefix.PrefixError('NATIVE_DEDUPE57_SOURCE_REQUIRED')
    words=prefix.identity(source.data.decode())
    if [s[0].upper() for s in words]!=['BEGIN','WITH','WITH','CREATE','CREATE','COMMIT','SELECT']:
        raise prefix.PrefixError('NATIVE_DEDUPE57_SOURCE_REQUIRED')
    return SimpleNamespace(sql=source.data,name='gridex_native_f0057_'+SOURCE_SHA[:12])


@dataclass(frozen=True)
class Probe:
    sql: bytes=field(repr=False)
    state: str
    committed: bool
    guard: bool=False


def probes(prefix,source):
    program(prefix,source)
    text=source.data.decode();commit=prefix.statements(text)[5][0][1]
    error=lambda state:("DO $h2_fail$ BEGIN RAISE EXCEPTION 'NATIVE_H2_FAULT' USING ERRCODE='"+state+"'; END $h2_fail$;\n").encode()
    return (Probe(text[:commit].encode()+error('P5750')+text[commit:].encode(),'P5750',False),
            Probe(source.data+b'\n'+error('P5752'),'P5752',True),
            Probe(TX_PROBE+source.data,'P5751',True,True))


def ledger_guard(name):
    if not re.fullmatch(NAME,name):raise ValueError('EXACT_DEDUPE57_PROBE_NAME_REQUIRED')
    return ("BEGIN; CREATE SCHEMA gridex_native_dedupe57_probe;\n"
      "REVOKE ALL ON SCHEMA gridex_native_dedupe57_probe FROM PUBLIC,anon,authenticated,service_role;\n"
      "CREATE FUNCTION gridex_native_dedupe57_probe.reject_ledger() RETURNS trigger\n"
      "LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $guard$ BEGIN\n"
      "IF NEW.name IS DISTINCT FROM '"+name+"'\n"
      " OR (SELECT count(*) FROM pg_temp.gridex_h2_tx_probe)<>1\n"
      " OR txid_current()=(SELECT xid FROM pg_temp.gridex_h2_tx_probe)\n"
      " OR EXISTS(SELECT FROM public.user_roles)\n"
      " OR to_regclass('public.user_roles_active_unique_role_text_idx') IS NULL\n"
      " OR to_regclass('public.user_roles_active_unique_role_id_idx') IS NULL\n"
      " THEN RAISE EXCEPTION 'NATIVE_H2_COMMIT_BOUNDARY_REQUIRED' USING ERRCODE='P5700'; END IF;\n"
      "RAISE EXCEPTION 'NATIVE_H2_LEDGER_FAULT' USING ERRCODE='P5751';\nEND $guard$;\n"
      "REVOKE ALL ON FUNCTION gridex_native_dedupe57_probe.reject_ledger() FROM PUBLIC,anon,authenticated,service_role;\n"
      "CREATE TRIGGER gridex_native_dedupe57_guard BEFORE INSERT ON supabase_migrations.schema_migrations\n"
      "FOR EACH ROW EXECUTE FUNCTION gridex_native_dedupe57_probe.reject_ledger();\n"
      "SELECT pg_catalog.to_json(true); COMMIT;")


def prerequisite(prefix,sql,work,first43,legacy52,repair56):
    if (first43.get('historicalPrefixLedgerVerified') is not True
            or first43.get('foundationInputsExecuted')!=43
            or first43.get('transactionBoundary27',{}).get('verified') is not True
            or len(first43.get('canonicalExecutionUnits',[]))!=43):
        raise prefix.PrefixError('NATIVE_DEDUPE57_PREFIX_REQUIRED')
    for receipt,limit,count,boundary,pins in (
            (legacy52,52,9,'transactionBoundary44_52',repair.previous.PINS),
            (repair56,56,4,'transactionBoundary53_56',repair.PINS)):
        if (receipt.get('verified') is not True or receipt.get('cumulativeFoundationInputsExecuted')!=limit
                or receipt.get('foundationInputsExecuted')!=count or receipt.get('timestampInputsExecuted')!=0
                or receipt.get('canonicalExecutionUnitCount')!=1 or receipt.get('noOpRepeatVerified') is not True
                or receipt.get(boundary,{}).get('verified') is not True or receipt.get('supportSha256')!=pins):
            raise prefix.PrefixError('NATIVE_DEDUPE57_PREFIX_REQUIRED')
    directory=work/'supabase/migrations'
    if (work.resolve()!=work or not re.fullmatch(r'gridex-sb-[a-f0-9]{12}-[a-f0-9]{16}-.+',work.name)
            or work.stat().st_mode&0o077 or directory.resolve()!=directory or directory.stat().st_mode&0o077):
        raise prefix.PrefixError('NATIVE_PRIVATE_SOURCE_REQUIRED')
    entries=sql(prefix.LEDGER_SQL)
    if type(entries) is not list or len(entries)!=46:
        raise prefix.PrefixError('NATIVE_DEDUPE57_PREFIX_REQUIRED')
    filenames={e['version']+'_'+e['name']+'.sql' for e in entries}
    if len(filenames)!=46 or {p.name for p in directory.iterdir()}!=filenames:
        raise prefix.PrefixError('NATIVE_UNEXPECTED_MIGRATION_INPUT')
    retained=[]
    for entry in entries:
        filename=entry['version']+'_'+entry['name']+'.sql';path=directory/filename
        if path.is_symlink() or not path.is_file():raise prefix.PrefixError('NATIVE_PRIVATE_SOURCE_REQUIRED')
        meta=path.lstat();raw=path.read_bytes()
        prefix.verify_private(path,raw,(meta.st_dev,meta.st_ino))
        prefix.verify_entry(entry,filename,SimpleNamespace(name=entry['name'],sql=raw))
        retained.append((path,raw,(meta.st_dev,meta.st_ino)))
    if (entries[0]['name']!='native_lifecycle_proof' or prefix.sha(retained[0][1])!=
            '579837c5a2c89fbf538f2bd61f8337ef8995b1d35b780665ebac93b9ca717ec0'):
        raise prefix.PrefixError('NATIVE_SYNTHETIC_PREFLIGHT_LEDGER_REQUIRED')
    for i,(unit,receipt) in enumerate(zip(prefix.prepare(),first43['canonicalExecutionUnits']),1):
        if (retained[i][1]!=unit.sql or receipt['cliFile']!=retained[i][0].name
                or receipt['ordinal']!=i or receipt['source']!=unit.source
                or receipt['sourceSha256']!=unit.source_sha256 or receipt['programSha256']!=unit.digest):
            raise prefix.PrefixError('NATIVE_DEDUPE57_PREFIX_REQUIRED')
    for index,receipt,loader,ordinal,stem in (
            (44,legacy52,repair.previous.load_sources,44,'gridex_native_f0044_0052_'),
            (45,repair56,repair.load_sources,53,'gridex_native_f0053_0056_')):
        _,sources=loader(prefix);path,raw,_=retained[index];entry=entries[index]
        records=[{'ordinal':i,'source':'migrations/'+s.path.name,'sourceSha256':s.sha256}
                 for i,s in enumerate(sources,ordinal)]
        if (list(receipt['sources'])!=records or receipt['cliFile']!=path.name
                or receipt['programSha256']!=prefix.sha(raw) or entry['name']!=stem+prefix.sha(raw)[:12]
                or receipt['ledgerStatementsSha256']!=prefix.sha(json.dumps(entry['statements'],separators=(',',':')).encode())):
            raise prefix.PrefixError('NATIVE_DEDUPE57_PREFIX_REQUIRED')
    return directory,copy.deepcopy(entries),retained


def create_unit(prefix,native,directory,raw,entries,files):
    name='gridex_native_f0057_'+prefix.sha(raw)[:12]
    time.sleep(1.05);native('migration','new',name)
    current={p.name for p in directory.iterdir()};added=current-files
    if len(added)!=1 or not files<=current:raise prefix.PrefixError('NATIVE_CLI_CREATED_FILE_REQUIRED')
    path=directory/next(iter(added))
    if not re.fullmatch(r'\d{14}_'+re.escape(name)+r'\.sql',path.name) or path.name[:14]<=entries[-1]['version']:
        raise prefix.PrefixError('NATIVE_CLI_CREATED_FILE_REQUIRED')
    physical=prefix.private_write(path,raw);prefix.verify_private(path,raw,physical)
    return path,physical,name


def qualify(prefix,native,sql,directory,source,entries,retained,snapshot,before,final,report):
    files={p.name for p in directory.iterdir()};report.update(verified=False,cases=[])
    expected_final={**before,'catalog':final}
    for probe in probes(prefix,source):
        report.update(phase='CLI_FILE_CREATION',currentProbe=probe.state)
        path,physical,name=create_unit(prefix,native,directory,probe.sql,entries,files)
        installed=False
        try:
            if probe.guard:
                if sql(ledger_guard(name)) is not True:raise prefix.PrefixError('NATIVE_DEDUPE57_PROOF_REQUIRED')
                installed=True
            for item in retained:prefix.verify_private(*item)
            report['phase']='EXPECTED_MIGRATION_FAILURE'
            result=native('migration','up','--local',allow_failure=True)
            prefix.verify_private(path,probe.sql,physical)
            for item in retained:prefix.verify_private(*item)
            match=re.search(rb'SQLSTATE[ :]+([A-Z0-9]{5})\b',result.stderr)
            observed=match[1].decode() if match else None
            if result.returncode==0 or observed!=probe.state:
                report['unexpectedSqlstate']=observed
                raise prefix.PrefixError('NATIVE_DEDUPE57_PROOF_REQUIRED')
            if sql(prefix.LEDGER_SQL)!=entries:raise prefix.PrefixError('NATIVE_FAILED_LEDGER_CHANGED')
        finally:
            if installed and sql(DROP_GUARD) is not True:raise prefix.PrefixError('NATIVE_DEDUPE57_PROOF_REQUIRED')
            prefix.verify_private(path,probe.sql,physical);path.unlink()
        report['phase']='COMMIT_BOUNDARY_VERIFICATION'
        if snapshot()!=(expected_final if probe.committed else before):
            raise prefix.PrefixError('NATIVE_DEDUPE57_COMMIT_BOUNDARY_REQUIRED')
        if probe.committed:
            # Not rollback: the exact two new, fully checked probe indexes are
            # explicitly disposed. No domain row/sequence is reset or rewritten.
            report['phase']='COMMITTED_PROBE_INDEX_DISPOSAL'
            if sql(CLEAN_INDEXES) is not True:raise prefix.PrefixError('NATIVE_DEDUPE57_PROOF_REQUIRED')
        if snapshot()!=before or sql(prefix.LEDGER_SQL)!=entries or {p.name for p in directory.iterdir()}!=files:
            raise prefix.PrefixError('NATIVE_DEDUPE57_PROOF_REQUIRED')
        report['cases'].append({'expectedSqlstate':probe.state,'programSha256':prefix.sha(probe.sql),
          'ledgerUnchanged':True,'transactionRolledBack':not probe.committed,
          'committedIndexesObserved':probe.committed,'explicitProbeIndexDisposalVerified':probe.committed,
          'scopedPreimageRestored':True})
    report.update(verified=True,phase='VERIFIED',sourceCommitSeparatesLedger=True,
                  rollbackAcrossSourceCommitClaimed=False,helpersDisposed=True)


def execute(prefix,native,sql,work,first43,legacy52,repair56,report,*,provider_bootstrap):
    directory,entries,retained=prerequisite(prefix,sql,work,first43,legacy52,repair56)
    if report:raise prefix.PrefixError('NATIVE_FRESH_PROGRESS_REQUIRED')
    report.update(scope='WHOLE_H2_NATIVE57_EMPTY_ROLES_NOT_FULL_REPLAY',verified=False,
      phase='SOURCE_ADMISSION',foundationInputsExecuted=0,cumulativeFoundationInputsExecuted=56,
      timestampInputsExecuted=0,completeReplayVerified=False,generatedTypesVerified=False,
      originalHistoricalVersionsMarkedApplied=False,sourceAndLedgerAtomic=False,
      rollbackAcrossSourceCommitClaimed=False)
    batch,source=load_source(prefix);unit=program(prefix,source)
    authority,_=repair.load_sources(prefix)
    keys=','.join("'"+k+"'" for k in prefix.SETTINGS)
    if sql("SELECT jsonb_build_object('role',current_user,'database',current_database(),'settings',"
           "(SELECT jsonb_object_agg(name,setting) FROM pg_settings WHERE name IN ("+keys+")));")!={
            'role':'postgres','database':'postgres','settings':prefix.SETTINGS}:
        raise prefix.PrefixError('NATIVE_PRIVATE_LOGGING_REQUIRED')
    provider.require(sql,provider_bootstrap)
    def snapshot():
        return {'catalog':sql(repair.catalog_sql(authority)),
                'rows':sql(repair.previous.ROWS_SQL),'sequences':sql(repair.SEQUENCES_SQL),
                'providerCatalog':sql(provider.static_catalog_sql(authority)),
                'providerSequenceShape':sql(provider.SEQUENCE_SHAPE),'providerEvents':sql(provider.QUERY)}
    before=snapshot();index_keys={'index/public.'+name for name in INDEXES}
    roles_count=sql(ROLE_COUNT)
    if type(roles_count) is not int or roles_count!=0 or index_keys&set(before['catalog']):
        raise prefix.PrefixError('NATIVE_DEDUPE57_EMPTY_PREIMAGE_REQUIRED')
    report['phase']='INDEPENDENT_INDEX_ORACLE'
    final=sql('BEGIN; SET LOCAL search_path=public,extensions,pg_temp;\n'+batch.index_declarations()+
              '\n'+authority.catalog_sql()+'\nROLLBACK;')
    if (type(final) is not dict or set(final)-set(before['catalog'])!=index_keys
            or {k:v for k,v in final.items() if k not in index_keys}!=before['catalog']
            or any(final[k].get(prop) is not True for k in index_keys for prop in ('unique','valid','ready'))
            or snapshot()!=before or sql(prefix.LEDGER_SQL)!=entries):
        raise prefix.PrefixError('NATIVE_DEDUPE57_ORACLE_REQUIRED')
    report['independentIndexOracleRollbackVerified']=True
    report['transactionBoundary57']={};report['phase']='COMMIT_BOUNDARY_QUALIFICATION'
    qualify(prefix,native,sql,directory,source,entries,retained,snapshot,before,final,report['transactionBoundary57'])
    _,again=load_source(prefix)
    if again.data!=source.data or snapshot()!=before:
        raise prefix.PrefixError('NATIVE_DEDUPE57_SOURCE_REQUIRED')
    report['phase']='WHOLE_SOURCE_CLI_EXECUTION'
    path,physical,_=create_unit(prefix,native,directory,unit.sql,entries,{p.name for p in directory.iterdir()})
    retained.append((path,unit.sql,physical))
    result=native('migration','up','--local',allow_failure=True)
    for item in retained:prefix.verify_private(*item)
    actual=sql(prefix.LEDGER_SQL)
    if result.returncode:
        report['terminalOwnedDatabaseDisposalRequired']=True
        match=re.search(rb'SQLSTATE[ :]+([A-Z0-9]{5})\b',result.stderr)
        if match:report['failedSqlstate']=match[1].decode()
        if actual!=entries:raise prefix.PrefixError('NATIVE_FAILED_LEDGER_CHANGED')
        raise prefix.PrefixError('NATIVE_HISTORICAL_SQL_FAILED')
    if type(actual) is not list or len(actual)!=47 or actual[:-1]!=entries:
        raise prefix.PrefixError('NATIVE_UNEXPECTED_LEDGER_DELTA')
    prefix.verify_entry(actual[-1],path.name,unit)
    after={**before,'catalog':final}
    if snapshot()!=after:raise prefix.PrefixError('NATIVE_DEDUPE57_FINAL_REQUIRED')
    native('migration','up','--local')
    for item in retained:prefix.verify_private(*item)
    if sql(prefix.LEDGER_SQL)!=actual or snapshot()!=after:
        raise prefix.PrefixError('NATIVE_HISTORICAL_LEDGER_REPEAT_CHANGED')
    report.update(verified=True,phase='VERIFIED',foundationInputsExecuted=1,cumulativeFoundationInputsExecuted=57,
      canonicalExecutionUnitCount=1,cliFile=path.name,programSha256=prefix.sha(unit.sql),
      sources=[{'ordinal':57,'source':'migrations/'+source.path.name,'sourceSha256':source.sha256}],
      supportSha256={'canonical-user-rbac-dedupe-batch.py':BATCH_SHA},
      ledgerStatementsSha256=prefix.sha(json.dumps(actual[-1]['statements'],separators=(',',':')).encode()),
      unchangedEarlierLedger=True,noOpRepeatVerified=True,wholeSourceRetained=True,
      trailingVerificationRetained=True,domainRowsAndSequencesPreserved=True,
      providerCacheSequenceRollbackClaimed=False)
    return report
