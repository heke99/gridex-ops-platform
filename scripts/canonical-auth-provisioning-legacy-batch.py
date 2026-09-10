#!/usr/bin/env python3
"""Strict offline A/B/C/D/E/F/H/I/Q executor and its owned PostgreSQL target.

No URL, arbitrary source list or production connection is accepted. Catalog
references are built from pinned immutable first43 inside the same disposable
container. SQL/client/server streams remain private, including startup/cleanup.
"""
from __future__ import annotations
from dataclasses import dataclass
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
Q = '20260910140053_canonical_auth_provisioning_legacy_boundary.sql'
SOURCE_SPECS = (
 ('A','20260519_company_invite_temp_password_sync.sql','09ed878125a71c77c792e004fd1a38c4fa56a0b23e0bc3eafeb62be271c85dc9',415),
 ('B','20260520_direct_account_temporary_password_flow.sql','0fff8d88e6c89c4d4cf16ad1f760bf079b29b7d684b9e8d398efd2bbcead93ba',98),
 ('C','20260520_direct_temporary_password_auth_sync_fix.sql','f81c427325e8ecdb9380038ebad994def06004f1a67cd6b7718247e090b632db',183),
 ('D','20260527_debug_user_invites_role_flow.sql','3d47fa7e5307e3b4568e737a8ee54806e67049a41200b4581e25f1b479e2f107',80),
 ('E','20260527_fix_company_user_creation_schema_safe_backfill.sql','e6a91a085651cd6c3cd6eb4b75faf35f7f4a061f2046824367247bc4ff9edd22',222),
 ('F','20260527_fix_company_user_invite_runtime_columns.sql','bd83735afcfa2f4eeeda0bded43a447e0f060584c7fc28b2c6b6fd6c36d3560c',160),
 ('H','20260528_final_user_access_schema_safe_repair.sql','4968391d74a8ff813ce1f56a8b8d9ade682692d183988917e736d0f3c5857bd2',296),
 ('I','20260528_fix_user_roles_without_role_column_and_compact_users.sql','394a8eba24370f0158d52ddc84ea0baf938f3ef94a9d561ae1e679475974f3ca',190),
)
DATABASES = frozenset('gridex_auth_legacy_' + x for x in ('reference','template','prefix','seeded','dirty','native','atomic','lock','helper'))
SUPPORT = ROOT / 'scripts/sql'
BUSINESS = ('auth_email_events','company_invitations','company_memberships','user_profiles','user_roles')
SEEDS = ('company_admin','admin','operations_manager','operations_agent','customer_service_manager','customer_service_agent','sales_manager','pricing_manager','pricing_approver','finance_readonly','executive_readonly','compliance_manager','partner_manager','partner_api_user')
CATEGORIES = {'55000':'DIRTY_DATA','42804':'CATALOG_MISMATCH','42P01':'CATALOG_MISMATCH','42703':'CATALOG_MISMATCH','55P03':'LOCK_TIMEOUT','P0002':'ENVELOPE_REQUIRED','P0003':'PRESERVATION_FAILED','P0004':'UNEXPECTED_TRIGGER'}

class BoundaryError(RuntimeError):
    """Only static messages may be exposed; raw subprocess exceptions stay private."""

@dataclass(frozen=True)
class Source:
    alias: str
    path: Path
    sha256: str
    data: bytes


def digest(data):
    return hashlib.sha256(data).hexdigest()


def reviewed_paths():
    return tuple(ROOT/'supabase/migrations'/s[1] for s in SOURCE_SPECS) + (ROOT/'supabase/migrations'/Q,)


def check_support(sql):
    code = re.sub(r"""--[^\n]*|/\*.*?\*/|"(?:""|[^"])*"|'(?:''|[^'])*'""", " ", sql, flags=re.S)
    if re.search(r"\bEXECUTE\s+(?:format\s*\(\s*)?'[^']*\b(?:COMMIT|ROLLBACK|SAVEPOINT|START\s+TRANSACTION)\b",sql,re.I):
        raise BoundaryError('ENVELOPE_REQUIRED')
    code = re.sub(r"\bON\s+COMMIT\s+DROP\b", " ", code, flags=re.I)
    if re.search(r'^\s*\\',sql,re.M) or re.search(r'\b(?:COMMIT|ROLLBACK|SAVEPOINT|PREPARE\s+TRANSACTION|START\s+TRANSACTION|SET\s+(?:SESSION\s+)?(?:ROLE|AUTHORIZATION)|DISABLE\s+TRIGGER)\b|\bBEGIN\s*;',code,re.I):
        raise BoundaryError('ENVELOPE_REQUIRED')


def validate_admission(sql):
    """Require the transaction mutex before any target/catalog lookup or lock.

    The fixed database-local two-int namespace belongs only to this offline
    envelope. Exact preamble validation prevents a session lock, a second key,
    or a catalog deparser inserted before serialization from reopening a cycle.
    """
    code=re.sub(r"--[^\n]*|/\*.*?\*/", " ", sql, flags=re.S)
    preamble,separator,_=code.partition('DO $legacy$')
    expected="""SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = public,extensions,pg_temp;
SELECT pg_catalog.pg_advisory_xact_lock(20260910, 140053);
"""
    if (not separator or re.sub(r'\s+','',preamble)!=re.sub(r'\s+','',expected)
        or len(re.findall(r'\bpg_advisory\w*\b',code))!=1):
        raise BoundaryError('ADMISSION_LOCK_ORDER_MISMATCH')
    check_support(sql)


def verify_bytes(data,expected,line_count=None):
    if not re.fullmatch(r'[a-f0-9]{64}',expected or '') or digest(data)!=expected:
        raise BoundaryError('SOURCE_HASH_MISMATCH')
    if line_count is not None and len(data.splitlines())!=line_count:
        raise BoundaryError('SOURCE_LENGTH_MISMATCH')


def validate_sources(paths):
    if tuple(paths) != reviewed_paths() or any(not p.is_absolute() or p.is_symlink() for p in paths):
        raise BoundaryError('SOURCE_ORDER_MISMATCH')
    manifest = json.loads((ROOT/'scripts/migration-history-manifest.json').read_text())['files']
    result=[]
    for i,path in enumerate(paths):
        data=path.read_bytes()
        expected=SOURCE_SPECS[i][2] if i<8 else manifest.get(Q)
        if manifest.get(path.name)!=expected:
            raise BoundaryError('SOURCE_HASH_MISMATCH')
        verify_bytes(data,expected,SOURCE_SPECS[i][3] if i<8 else None)
        check_support(data.decode())
        result.append(Source(SOURCE_SPECS[i][0] if i<8 else 'Q',path,expected,data))
    for name in ('catalog','admission','assertions'):
        support=(SUPPORT/f'canonical-auth-provisioning-legacy-{name}.sql').read_text()
        (validate_admission if name=='admission' else check_support)(support)
    return tuple(result)


def verified_prefix():
    spec=importlib.util.spec_from_file_location('legacy_diagnostics_sources', ROOT/'scripts/canonical-auth-provisioning-diagnostics-selftest.py')
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    sources=module.verified_prefix_sources()
    for path,sql in module.validate_sources().items():
        sources.append((path,sql))
    if len(sources)!=43:
        raise BoundaryError('PREFIX_MISMATCH')
    return tuple(sources)


def validate_database(name):
    if name not in DATABASES:
        raise BoundaryError('OWNED_TARGET_REQUIRED')


def clean_environment():
    return {k:v for k,v in os.environ.items() if not k.startswith('PG') and k not in ('PSQL_HISTORY','PSQLRC')}


def safe_receipt(raw,code,stage):
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}',stage):
        stage='internal'
    found=re.search(r'(?:ERROR|FATAL|PANIC):\s+([A-Z0-9]{5}):',raw)
    state=found.group(1) if found else ('00000' if code==0 else 'XXXXX')
    return {'stage':stage,'exit_code':code,'sqlstate':state,'category':CATEGORIES.get(state,'OK' if code==0 else 'NATIVE_ERROR')}


def literal(value):
    return "'" + value.replace("'", "''") + "'"


class OwnedPostgres:
    """Created and destroyed here; no external-target constructor or URL fallback."""
    def __init__(self):
        self.name=os.environ.get('GRIDEX_LEGACY_CONTAINER_NAME') or ('gridex-auth-legacy-'+secrets.token_hex(8))
        if not re.fullmatch(r'gridex-auth-legacy-[a-z0-9-]{8,80}',self.name):
            raise BoundaryError('OWNED_TARGET_REQUIRED')
        self._created_name=self.name
        self.directory=None
        self.active=False
        self.reference=None
        self.processes=[]

    def private(self,name,data):
        if self.directory is None or not re.fullmatch(r'[a-zA-Z0-9_.-]+',name):
            raise BoundaryError('OWNED_TARGET_REQUIRED')
        path=Path(self.directory.name)/name
        with open(path,'wb') as f:
            os.chmod(path,0o600)
            f.write(data.encode() if isinstance(data,str) else data)
        return path

    def docker(self,args,timeout=60,input=None):
        try:
            result=subprocess.run(['docker',*args],input=input,capture_output=True,timeout=timeout,env=clean_environment())
        except (OSError,subprocess.TimeoutExpired):
            raise BoundaryError('OWNED_CONTAINER_COMMAND_FAILED') from None
        if self.directory:
            self.private('docker-private-last.out',result.stdout+result.stderr)
        if result.returncode:
            raise BoundaryError('OWNED_CONTAINER_COMMAND_FAILED')
        return result.stdout

    def __enter__(self):
        self.directory=tempfile.TemporaryDirectory(prefix='gridex-auth-legacy-')
        os.chmod(self.directory.name,0o700)
        try:
            # Network disabled; only private Unix-socket docker exec connections.
            # No GitHub service cleanup can expose this container's collector logs.
            self.docker(['run','--detach','--name',self.name,'--label','gridex.auth-legacy.owner='+self.name,
                '--network','none','--tmpfs','/var/lib/postgresql/data:rw,nosuid,nodev',
                '--mount','type=bind,src='+self.directory.name+',dst=/legacy-private,readonly',
                '-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17',
                'postgres','-c','logging_collector=on','-c','log_directory=pg_log_private',
                '-c','log_file_mode=0600','-c','log_statement=none','-c','log_min_error_statement=panic',
                '-c','log_error_verbosity=terse','-c','log_parameter_max_length=0',
                '-c','log_parameter_max_length_on_error=0','-c','log_min_duration_statement=-1',
                '-c','log_min_duration_sample=-1','-c','log_transaction_sample_rate=0',
                '-c','log_duration=off','-c','shared_preload_libraries=','-c','local_preload_libraries=',
                '-c','session_preload_libraries='],timeout=180)
            self.active=True
            deadline=time.monotonic()+60
            while True:
                try:
                    self.docker(['exec',self.name,'pg_isready','-U','postgres'],timeout=5)
                    break
                except BoundaryError:
                    if time.monotonic()>=deadline: raise
                    time.sleep(0.25)
            self.docker(['exec','--user','postgres',self.name,'chmod','0700','/var/lib/postgresql/data/pg_log_private'])
            self.verify_logging()
            return self
        except BaseException:
            self.close()
            raise

    def verify_logging(self):
        query="SELECT name,setting FROM pg_settings WHERE name IN ('logging_collector','log_file_mode','log_statement','log_min_error_statement','log_error_verbosity','log_parameter_max_length','log_parameter_max_length_on_error','log_min_duration_statement','log_min_duration_sample','log_transaction_sample_rate','log_duration','shared_preload_libraries','local_preload_libraries','session_preload_libraries') ORDER BY name;"
        raw=self.docker(['exec',self.name,'psql','-X','-U','postgres','-At','-c',query])
        settings=dict(line.split('|',1) for line in raw.decode().splitlines())
        expected={'logging_collector':'on','log_file_mode':'0600','log_statement':'none','log_min_error_statement':'panic','log_error_verbosity':'terse','log_parameter_max_length':'0','log_parameter_max_length_on_error':'0','log_min_duration_statement':'-1','log_min_duration_sample':'-1','log_transaction_sample_rate':'0','log_duration':'off','shared_preload_libraries':'','local_preload_libraries':'','session_preload_libraries':''}
        if settings!=expected:
            raise BoundaryError('PRIVATE_LOG_SETTINGS_MISMATCH')
        mode=self.docker(['exec',self.name,'stat','-c','%a','/var/lib/postgresql/data/pg_log_private']).strip()
        if mode!=b'700': raise BoundaryError('PRIVATE_LOG_PERMISSIONS_MISMATCH')

    def command(self,database,files=(),transaction=True):
        validate_database(database)
        if not self.active or self.name!=self._created_name: raise BoundaryError('OWNED_TARGET_REQUIRED')
        argv=['docker','exec','-i','-e','PGOPTIONS=-c search_path=public,extensions',self.name,'psql','-X','-U','postgres','-d',database,
              '-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-qAt']
        if transaction: argv.append('--single-transaction')
        for path in files:
            path=Path(path)
            if path.parent!=Path(self.directory.name): raise BoundaryError('PRIVATE_FILE_REQUIRED')
            argv+=['-f','/legacy-private/'+path.name]
        return argv

    def run_files(self,database,files,stage,transaction=True,expect='00000',timeout=120):
        started=time.monotonic()
        try:
            result=subprocess.run(self.command(database,files,transaction),capture_output=True,timeout=timeout,env=clean_environment())
        except (OSError,subprocess.TimeoutExpired):
            raise BoundaryError('PRIVATE_SQL_PROCESS_FAILED') from None
        self.private('client-last.out',result.stdout+result.stderr)
        receipt=safe_receipt(result.stderr.decode(errors='replace'),result.returncode,stage)
        receipt['milliseconds']=round((time.monotonic()-started)*1000)
        print(json.dumps(receipt,sort_keys=True),flush=True)
        if receipt['sqlstate']!=expect or (expect=='00000')!=(result.returncode==0):
            raise BoundaryError('UNEXPECTED_SQL_RESULT')
        return result.stdout.decode()

    def sql(self,database,sql,stage='fixture',expect='00000',transaction=True):
        path=self.private('fixture-'+secrets.token_hex(8)+'.sql',sql)
        return self.run_files(database,[path],stage,transaction,expect)

    def reset(self,database):
        validate_database(database)
        self.docker(['exec',self.name,'dropdb','-U','postgres','--if-exists','--force',database])
        self.docker(['exec',self.name,'createdb','-U','postgres',database])

    def prefix(self,database):
        self.reset(database)
        bootstrap=(ROOT/'scripts/sql/gridex-supabase-compatible-bootstrap.sql').read_text()
        # R owns a BEGIN/COMMIT, so prefix is intentionally outside the batch
        # transaction; whole immutable prefix bytes are never stripped.
        files=[self.private('bootstrap.sql',bootstrap),self.private('prefix-search-path.sql','SET search_path = public,extensions;')]
        files.extend(self.private('prefix-'+str(i)+'.sql',sql) for i,(_,sql) in enumerate(verified_prefix(),1))
        self.run_files(database,files,'first43',transaction=False)

    def catalog(self,database):
        sql=(SUPPORT/'canonical-auth-provisioning-legacy-catalog.sql').read_text()
        return json.loads(self.sql(database,sql,'catalog'))

    def close(self):
        for p in self.processes:
            if p.poll() is None:
                p.terminate()
                try: p.wait(timeout=5)
                except subprocess.TimeoutExpired: p.kill(); p.wait()
        if self.active:
            # Match exact owned name AND label before destroying only our target.
            try:
                label=self.docker(['inspect','--format','{{ index .Config.Labels "gridex.auth-legacy.owner" }}',self.name]).decode().strip()
                if label!=self.name: raise BoundaryError('OWNERSHIP_MISMATCH')
                self.docker(['rm','--force','--volumes',self.name])
                self.active=False
            finally:
                if self.active: raise BoundaryError('OWNED_CONTAINER_CLEANUP_FAILED')
        if self.directory:
            self.directory.cleanup(); self.directory=None

    def __exit__(self,*args):
        self.close()


def ddl_oracles(sources):
    """Independent temporary DDL oracles, never substituted migration execution.

    All originals still execute once, unchanged. These test-only temporary
    objects canonicalize source declarations for exact pg_catalog comparisons.
    """
    chunks=['CREATE TEMP TABLE legacy_expected_deltas(key text PRIMARY KEY,value jsonb NOT NULL) ON COMMIT DROP;']
    columns={}; indexes={}; checks={}
    for source in sources[:8]:
        text=source.data.decode()
        for alter in re.finditer(r'alter\s+table\s+(?:if\s+exists\s+)?public\.(\w+)\s+(.*?);',text,re.I|re.S):
            table,body=alter.groups()
            for m in re.finditer(r'add\s+column\s+if\s+not\s+exists\s+(\w+)\s+([^,;]+)',body,re.I):
                column,decl=m.groups()
                if not re.fullmatch(r'(?:text|uuid|boolean|timestamptz|jsonb)(?:\s+(?:not\s+)?null)?(?:\s+default\s+(?:now\(\)|gen_random_uuid\(\)|true|false|\x27[^\x27]*\x27(?:::jsonb)?))?(?:\s+(?:not\s+)?null)?(?:\s+references\s+(?:public|auth)\.\w+\(\w+\)\s+on\s+delete\s+set\s+null)?',decl.strip(),re.I):
                    raise BoundaryError('UNREVIEWED_COLUMN_DECLARATION')
                columns.setdefault((table,column),re.split(r'\s+references\s+',decl.strip(),flags=re.I)[0])
        for m in re.finditer(r'create\s+(unique\s+)?index\s+if\s+not\s+exists\s+(\w+)\s+on\s+public\.(\w+)(.*?);',text,re.I|re.S):
            unique,name,table,tail=m.groups(); indexes.setdefault(name,(bool(unique),table,tail))
    # Independently sourced final CHECK authorities, not Q's text.
    for filename,names in (
        ('20260520_user_profiles_auth_action_constraint_hardfix.sql',('user_profiles_last_auth_email_action_check',)),
        ('20260520_direct_account_temporary_password_flow.sql',('user_profiles_user_status_check',)),
        ('20260528_final_user_access_schema_safe_repair.sql',('company_memberships_role_check','company_memberships_status_check')),
        ('20260527_fix_company_user_invite_runtime_columns.sql',('company_invitations_membership_role_check',)),
        ('20260810193450_canonical_access_provisioning_runtime_v1.sql',('company_invitations_status_check',)),
    ):
        path=ROOT/'supabase/migrations'/filename
        manifest=json.loads((ROOT/'scripts/migration-history-manifest.json').read_text())['files']
        if digest(path.read_bytes())!=manifest[filename]: raise BoundaryError('ORACLE_HASH_MISMATCH')
        for name in names:
            match=re.search(r'add\s+constraint\s+'+name+r'\s+check\s*(\(.*?\))\s*(?:not\s+valid)?;',path.read_text(),re.S|re.I)
            if not match: raise BoundaryError('ORACLE_CHECK_NOT_FOUND')
            table='user_profiles' if name.startswith('user_profiles_') else ('company_memberships' if name.startswith('company_memberships_') else 'company_invitations')
            checks[name]=(table,match.group(1))
    for i,((table,column),decl) in enumerate(columns.items()):
        oracle='legacy_column_oracle_'+str(i)
        key='column/public.'+table+'/'+column
        chunks.append(f'''CREATE TEMP TABLE {oracle} ({column} {decl}) ON COMMIT DROP;
INSERT INTO pg_temp.legacy_expected_deltas
SELECT {literal(key)},jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,
'default',pg_get_expr(d.adbin,d.adrelid,false),'identity',a.attidentity,'generated',a.attgenerated,
'collation',a.attcollation::regcollation::text,'acl',a.attacl)
FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
WHERE a.attrelid='pg_temp.{oracle}'::regclass AND a.attname={literal(column)}
AND NOT (SELECT catalog ? {literal(key)} FROM pg_temp.legacy_catalog_before);''')
    for i,(name,(unique,table,tail)) in enumerate(indexes.items()):
        oracle='legacy_index_oracle_'+str(i); index=oracle+'_idx'; key='index/public.'+name
        chunks.append(f'''CREATE TEMP TABLE {oracle} (LIKE public.{table}) ON COMMIT DROP;
CREATE {'UNIQUE ' if unique else ''}INDEX {index} ON {oracle} {tail};
INSERT INTO pg_temp.legacy_expected_deltas SELECT {literal(key)},jsonb_build_object(
'definition',regexp_replace(regexp_replace(pg_get_indexdef(i.indexrelid,0,false),{literal(index)},{literal(name)}), ' ON [^ ]+ USING ',{literal(' ON public.'+table+' USING ')}),
'valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique,'primary',i.indisprimary,
'exclusion',i.indisexclusion,'immediate',i.indimmediate,'nulls_not_distinct',i.indnullsnotdistinct)
FROM pg_index i WHERE i.indexrelid='pg_temp.{index}'::regclass
AND NOT (SELECT catalog ? {literal(key)} FROM pg_temp.legacy_catalog_before);''')
    for i,(name,(table,expr)) in enumerate(checks.items()):
        oracle='legacy_check_oracle_'+str(i)
        chunks.append(f'''CREATE TEMP TABLE {oracle} (LIKE public.{table}) ON COMMIT DROP;
ALTER TABLE {oracle} ADD CONSTRAINT {name} CHECK {expr};
INSERT INTO pg_temp.legacy_expected_deltas SELECT {literal('constraint/public.'+table+'/'+name)},
jsonb_build_object('kind',c.contype,'definition',pg_get_constraintdef(c.oid,false),
'validated',c.convalidated,'deferrable',c.condeferrable,'deferred',c.condeferred,'noinherit',c.connoinherit)
FROM pg_constraint c WHERE c.conrelid='pg_temp.{oracle}'::regclass AND c.conname={literal(name)};''')
    # Source D insert descriptions are immutable noncredential catalog metadata.
    rows=re.findall(r"\('([^']+)', '[^']+', '([^']+)', 'company'\)",sources[3].data.decode())
    if tuple(key for key,_ in rows)!=SEEDS: raise BoundaryError('ROLE_SEED_ORACLE_MISMATCH')
    chunks.append('CREATE TEMP TABLE legacy_seed_oracle(key text PRIMARY KEY,description text) ON COMMIT DROP;')
    chunks.append('INSERT INTO legacy_seed_oracle VALUES '+','.join('('+literal(k)+','+literal(d)+')' for k,d in rows)+';')
    return '\n'.join(chunks)


def catalog_capture(table):
    query=(SUPPORT/'canonical-auth-provisioning-legacy-catalog.sql').read_text()
    return 'CREATE TEMP TABLE '+table+' ON COMMIT DROP AS '+query.replace("SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) FROM objects;","SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) AS catalog FROM objects;")


def stage_sql(previous,current):
    return f"""DO $legacy$ DECLARE relation_name text; amount bigint; BEGIN
IF (SELECT count(*) FROM pg_temp.legacy_context WHERE txid=txid_current() AND stage={literal(previous)})<>1 THEN
RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='ENVELOPE_REQUIRED'; END IF;
FOREACH relation_name IN ARRAY ARRAY['auth_email_events','company_invitations','company_memberships','user_profiles','user_roles'] LOOP
EXECUTE format('SELECT count(*) FROM public.%I',relation_name) INTO amount;
IF amount<>0 THEN RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED'; END IF; END LOOP;
UPDATE pg_temp.legacy_context SET stage={literal(current)} WHERE txid=txid_current(); END $legacy$;
SELECT 'LEGACY_STAGE_{current}';"""


def envelope_files(target,paths):
    """One reviewable executor; fixture and subsequent clean replay call this."""
    if type(target) is not OwnedPostgres or not target.active or target.reference is None:
        raise BoundaryError('OWNED_REFERENCE_REQUIRED')
    sources=validate_sources(paths)
    target.verify_logging()
    base,final=target.reference
    context='SET TRANSACTION ISOLATION LEVEL READ COMMITTED;\nCREATE TEMP TABLE legacy_reference(base jsonb NOT NULL,final jsonb) ON COMMIT DROP;\n'
    context+='INSERT INTO legacy_reference VALUES ('+literal(json.dumps(base))+'::jsonb,'+(literal(json.dumps(final))+'::jsonb' if final else 'NULL')+');\n'
    admission=(SUPPORT/'canonical-auth-provisioning-legacy-admission.sql').read_text()
    validate_admission(admission)
    admission=admission.replace('-- LEGACY_CATALOG_CAPTURE',catalog_capture('legacy_catalog_before'))
    oracle_sql=ddl_oracles(sources)
    check_support(oracle_sql)
    files=[target.private('envelope-context.sql',context),target.private('envelope-admission.sql',admission)]
    previous='admitted'
    for source in sources:
        files.append(target.private('whole-'+source.alias+'.sql',source.data))
        if source.alias!='Q':
            files.append(target.private('stage-'+source.alias+'.sql',stage_sql(previous,source.alias)))
        previous=source.alias
    assertions=(SUPPORT/'canonical-auth-provisioning-legacy-assertions.sql').read_text()
    assertions=assertions.replace('-- LEGACY_CATALOG_CAPTURE',catalog_capture('legacy_catalog_after'))
    assertions=assertions.replace('-- LEGACY_DDL_ORACLES',oracle_sql)
    assertions += "\nSELECT 'LEGACY_STAGE_COMPLETED' FROM pg_temp.legacy_context WHERE txid=txid_current() AND stage='completed';\n"
    files.append(target.private('envelope-assertions.sql',assertions))
    return files


def execute(target,database,paths):
    """Public strict API: reviewed paths plus a live owned isolated handle only."""
    files=envelope_files(target,paths)
    output=target.run_files(database,files,'whole_batch')
    stages=re.findall(r'^LEGACY_STAGE_([A-Z]+)$',output,re.M)
    if stages!=list('ABCDEFHI')+['COMPLETED']:
        raise BoundaryError('SOURCE_COMPLETION_MISMATCH')
    return {'stages':stages,'sources':9}


def prepare_reference(target):
    target.prefix('gridex_auth_legacy_reference')
    target.reset('gridex_auth_legacy_template')
    target.docker(['exec',target.name,'dropdb','-U','postgres','gridex_auth_legacy_template'])
    target.docker(['exec',target.name,'createdb','-U','postgres','-T','gridex_auth_legacy_reference','gridex_auth_legacy_template'])
    target.reference=(target.catalog('gridex_auth_legacy_reference'),None)
    execute(target,'gridex_auth_legacy_reference',reviewed_paths())
    target.reference=(target.reference[0],target.catalog('gridex_auth_legacy_reference'))
    execute(target,'gridex_auth_legacy_reference',reviewed_paths())
    return target.reference


def cleanup_workflow_owned():
    """Idempotent always-step fallback after process/job cancellation."""
    name=os.environ.get('GRIDEX_LEGACY_CONTAINER_NAME','')
    if not re.fullmatch(r'gridex-auth-legacy-[a-z0-9-]{8,80}',name):
        raise BoundaryError('OWNED_TARGET_REQUIRED')
    for suffix,label in (('', 'owner'),('-canary','canary')):
        result=subprocess.run(['docker','ps','-aq','--filter','name=^/'+name+suffix+'$',
            '--filter','label=gridex.auth-legacy.'+label+'='+name],capture_output=True,env=clean_environment())
        if result.returncode: raise BoundaryError('OWNED_CONTAINER_CLEANUP_FAILED')
        ids=result.stdout.decode().splitlines()
        if len(ids)>1 or any(not re.fullmatch(r'[a-f0-9]{12,64}',item) for item in ids):
            raise BoundaryError('OWNERSHIP_MISMATCH')
        if ids:
            result=subprocess.run(['docker','rm','--force','--volumes',ids[0]],capture_output=True,env=clean_environment())
            if result.returncode: raise BoundaryError('OWNED_CONTAINER_CLEANUP_FAILED')
    print('PASS owned-container cleanup')
