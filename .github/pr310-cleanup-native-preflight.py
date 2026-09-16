#!/usr/bin/env python3
"""Exact cleanup-program preflight on an isolated Supabase CLI owner, not release proof."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace

ROOT = Path.cwd().resolve()
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / 'scripts'))
import canonical_native_probe_cleanup as cleanup
import canonical_native_timestamp_snapshot as snapshots
import canonical_native_historical_prefix as prefix
import canonical_native_cli_transport as transport
SOURCE_HEAD = 'c6f7702a0214504bc44027d0526734e3adecf728'
ORIGINAL_SHA = '6b1e462e5c7738a51f504878bb2710ac9bd2372a6b43aa93433127bdd325830f'
LOCK = b'LOCK TABLE public.gridex_native_lifecycle_probe IN ACCESS EXCLUSIVE MODE;'
OPEN = b'DO $gridex_native_cleanup_lock$ BEGIN\n'
CLOSE = b'\nEND $gridex_native_cleanup_lock$;'


def main():
    if len(sys.argv) != 1:
        raise ValueError('NO_ARGUMENTS_ALLOWED')
    if subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip() != SOURCE_HEAD:
        raise ValueError('EXACT_SOURCE_HEAD_REQUIRED')
    original = cleanup.program().sql
    if prefix.sha(original) != ORIGINAL_SHA or not original.startswith(LOCK) or original.count(LOCK) != 1:
        raise ValueError('EXACT_ORIGINAL_PROGRAM_REQUIRED')
    candidate = OPEN + LOCK + CLOSE + original[len(LOCK):]
    if candidate.replace(OPEN, b'').replace(CLOSE, b'') != original:
        raise ValueError('EXACT_LOCK_ROUNDTRIP_REQUIRED')
    spec = importlib.util.spec_from_file_location('cleanup_preflight_life', ROOT / 'scripts/canonical-native-supabase-lifecycle.py')
    life = importlib.util.module_from_spec(spec); spec.loader.exec_module(life)
    cli = shutil.which('supabase')
    if cli is None:
        raise ValueError('CLI_REQUIRED')
    project = life.project_name(os.environ['GITHUB_RUN_ID'], os.environ['GITHUB_RUN_ATTEMPT'], secrets.token_hex(8))
    network = project + '-network'
    report = dict(scope='SYNTHETIC_EXACT_CLEANUP_PREFLIGHT_NOT_FULL_SOURCE_OR_TYPE_ACCEPTANCE',
                  sourceHead=SOURCE_HEAD, originalProgramSha256=prefix.sha(original),
                  candidateProgramSha256=prefix.sha(candidate), sourcePins=cleanup.PINS,
                  completeProgramByteRoundtripVerified=True, productionModified=False,
                  schemaAccepted=False, generatedTypesVerified=False, cases=[])
    created = started = success = False
    def interrupted(*_): raise ValueError('INTERRUPTED')
    signal.signal(signal.SIGTERM, interrupted); signal.signal(signal.SIGINT, interrupted)
    with tempfile.TemporaryDirectory(prefix=project + '-') as directory:
        work = Path(directory)
        (work / 'home').mkdir(mode=0o700)
        env = {k: v for k, v in os.environ.items() if k in ('PATH', 'LANG', 'LC_ALL', 'TZ')}
        env.update(HOME=str(work / 'home'), XDG_CONFIG_HOME=str(work / 'home/config'), CI='true')
        def command(args, data=None, allow_failure=False, timeout=600):
            result = subprocess.run(args, input=data, capture_output=True, cwd=work, env=env, timeout=timeout)
            if result.returncode and not allow_failure:
                report['sqlstates'] = [s.decode() for s in re.findall(rb'^ERROR:.*?\(SQLSTATE ([A-Z0-9]{5})\)', result.stderr, re.M)]
                raise ValueError('OWNED_COMMAND_FAILED')
            return result
        def native(*args, **kwargs):
            args = transport.cli_command(cli, work, project, args) if created else [cli, '--workdir', str(work), *args]
            return command(args, **kwargs)
        def sql(text, output=True):
            result = command(['docker','exec','-i','supabase_db_'+project,'psql','-XqAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','--single-transaction','-f','-'], data=text.encode())
            return json.loads(result.stdout) if output else None
        def snapshot():
            catalog, rows = snapshots.queries()
            return sql(catalog), sql(rows), sql(prefix.LEDGER_SQL)
        def new(raw):
            time.sleep(1.1)
            name = 'gridex_native_probe_cleanup_' + prefix.sha(raw)[:12]
            before = set(migrations.glob('*.sql'))
            native('migration','new',name)
            added = set(migrations.glob('*.sql')) - before
            if len(added) != 1: raise ValueError('ONE_REAL_CLI_FILE_REQUIRED')
            path = added.pop()
            if re.fullmatch(r'\d{14}_'+name+r'\.sql',path.name) is None: raise ValueError('REAL_CLI_IDENTITY_REQUIRED')
            path.write_bytes(raw); path.chmod(0o600)
            return path, name
        def install_guard(name, oid, failure):
            if re.fullmatch(r'gridex_native_probe_cleanup_[a-f0-9]{12}',name) is None or type(oid) is not int or oid <= 0:
                raise ValueError('FIXED_GUARD_REQUIRED')
            body = "IF NEW.name IS DISTINCT FROM '"+name+"' OR NOT ("+cleanup.ABSENT+") OR NOT EXISTS (SELECT FROM pg_locks WHERE pid=pg_backend_pid() AND granted AND mode='AccessExclusiveLock' AND relation="+str(oid)+") THEN RAISE EXCEPTION 'CLEANUP_BOUNDARY_BAD' USING ERRCODE='PC009'; END IF; "
            body += "RAISE EXCEPTION 'NATIVE_CLEANUP_LEDGER_FAULT' USING ERRCODE='PC002';" if failure else 'RETURN NEW;'
            sql("CREATE FUNCTION public.cleanup_preflight_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$ BEGIN "+body+" END $guard$; REVOKE ALL ON FUNCTION public.cleanup_preflight_guard() FROM PUBLIC,anon,authenticated,service_role; CREATE TRIGGER cleanup_preflight_guard BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.cleanup_preflight_guard();",False)
        def drop_guard():
            sql('DROP TRIGGER cleanup_preflight_guard ON supabase_migrations.schema_migrations; DROP FUNCTION public.cleanup_preflight_guard();',False)
        try:
            report['phase']='OWNED_START'
            if command([cli,'--version']).stdout.strip()!=b'2.101.0': raise ValueError('EXACT_CLI_REQUIRED')
            for kind in ('container','volume'):
                if command(['docker',kind,'ls','-q','--filter','label=com.supabase.cli.project='+project]).stdout.strip(): raise ValueError('PREEXISTING_TARGET_REJECTED')
            native('init')
            config=work/'supabase/config.toml';config.write_text(life.config(project,5432,54322,config.read_text()))
            migrations=work/'supabase/migrations';migrations.mkdir(mode=0o700,exist_ok=True)
            command(['docker','network','create','--internal','--label','gridex.native.owner='+project,network]);created=True
            started=True;native('--network-id',network,'db','start')
            meta=life.check_container(json.loads(command(['docker','inspect','supabase_db_'+project]).stdout),project,network)
            report['image']=meta['Config']['Image']
            native('migration','new','native_lifecycle_proof')
            files=list(migrations.glob('*.sql'))
            if len(files)!=1: raise ValueError('INITIAL_CLI_FILE_REQUIRED')
            policy=original.split(b'CREATE POLICY ',1)[1].split(b'\nDO $cleanup_shape$',1)[0]
            policy=b'CREATE POLICY '+policy.replace(b'pg_temp.gridex_native_cleanup_shape',b'public.gridex_native_lifecycle_probe')
            fixture=b'''CREATE TABLE public.admin_users(user_id uuid,is_active boolean,role text);
CREATE TABLE public.user_roles(user_id uuid,is_active boolean,role text,role_key text);
CREATE TABLE public.gridex_native_lifecycle_probe(id integer PRIMARY KEY);
ALTER TABLE public.gridex_native_lifecycle_probe ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gridex_native_lifecycle_probe FROM PUBLIC,anon,authenticated,service_role;
GRANT ALL ON TABLE public.gridex_native_lifecycle_probe TO postgres,authenticated,service_role;
INSERT INTO public.gridex_native_lifecycle_probe VALUES(1);
'''+policy
            files[0].write_bytes(fixture);files[0].chmod(0o600);native('migration','up','--local')
            baseline=snapshot();oid=sql("SELECT to_json('public.gridex_native_lifecycle_probe'::regclass::oid::bigint);")
            for label,raw,state,ledger in (
                ('original_top_level_lock',original,'25P01',False),
                ('adapted_full_program_post_body_rollback',candidate+cleanup.POST,'PC001',False),
                ('adapted_full_program_ledger_rollback',candidate,'PC002',True)):
                report['phase']=label
                path,name=new(raw)
                if ledger: install_guard(name,oid,True)
                try:
                    result=native('migration','up','--local',allow_failure=True)
                    states=re.findall(rb'^ERROR:.*?\(SQLSTATE ([A-Z0-9]{5})\)',result.stderr,re.M)
                    if result.returncode==0 or states!=[state.encode()]:
                        report['unexpectedStates']=[s.decode() for s in states]
                        labels=re.findall(rb'^ERROR: (NATIVE_CLEANUP_(?:SHAPE|PRIMARY_KEY|ACL|POLICY|DEPENDENCY)) \(SQLSTATE PC009\)',result.stderr,re.M)
                        report['shapeLabels']=[s.decode() for s in labels]
                        raise ValueError('EXACT_FAILURE_REQUIRED')
                finally:
                    if ledger: drop_guard()
                    path.unlink()
                if snapshot()!=baseline: raise ValueError('FULL_ROLLBACK_REQUIRED')
                report['cases'].append(dict(case=label,sqlstate=state,catalogRowsAndLedgerRestored=True))
            report['phase']='ADAPTED_SUCCESS_AND_REPEAT'
            dependencies=sql(cleanup.DEPENDENCIES)
            expected=cleanup.expected_after(((baseline[0],baseline[1]),[]),list(cleanup.BASE_KEYS)+[cleanup.POLICY_KEY]+dependencies)[0]
            path,name=new(candidate);install_guard(name,oid,False)
            try: native('migration','up','--local')
            finally: drop_guard()
            after=snapshot()
            if after[:2]!=expected or after[2][:-1]!=baseline[2] or len(after[2])!=len(baseline[2])+1: raise ValueError('EXACT_CLEANUP_EFFECT_REQUIRED')
            prefix.verify_entry(after[2][-1],path.name,SimpleNamespace(name=name,sql=candidate))
            native('migration','up','--local')
            if snapshot()!=after: raise ValueError('REPEAT_REQUIRED')
            report.update(exactFullProgramPassed=True,lockHeldThroughLedger=True,earlierLedgerPreserved=True,
                allOtherCatalogAndRowsPreserved=True,realCliLedgerVerified=True,repeatVerified=True)
            success=True
        except Exception as error:
            known={'EXACT_CLI_REQUIRED','PREEXISTING_TARGET_REJECTED','INITIAL_CLI_FILE_REQUIRED','OWNED_COMMAND_FAILED','EXACT_FAILURE_REQUIRED','FULL_ROLLBACK_REQUIRED','EXACT_CLEANUP_EFFECT_REQUIRED','REPEAT_REQUIRED','INTERRUPTED','ONE_REAL_CLI_FILE_REQUIRED','REAL_CLI_IDENTITY_REQUIRED','FIXED_GUARD_REQUIRED'}
            report['failureCode']=error.args[0] if type(error) is ValueError and len(error.args)==1 and error.args[0] in known else 'UNCLASSIFIED'
        finally:
            clean=True
            try:
                if started:
                    native('stop','--project-id',project,'--no-backup')
                    for kind in ('container','volume'):
                        if command(['docker',kind,'ls','-q','--filter','label=com.supabase.cli.project='+project]).stdout.strip(): raise ValueError('RESOURCES_REMAIN')
                if created:
                    metadata=json.loads(command(['docker','network','inspect',network]).stdout)[0]
                    if metadata.get('Labels',{}).get('gridex.native.owner')!=project or metadata.get('Internal') is not True: raise ValueError('OWNERSHIP_REQUIRED')
                    command(['docker','network','rm',network])
            except Exception: clean=False
            report['cleanupVerified']=clean
    report['privateWorkspaceRemoved']=not work.exists()
    success=success and clean and not work.exists()
    report['outcome']='EXACT_CLEANUP_CONTEXT_QUALIFIED_NOT_RELEASE' if success else 'BLOCKED'
    output=ROOT/'artifacts';output.mkdir(exist_ok=True)
    (output/'cleanup-native-preflight.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,sort_keys=True))
    return 0 if success else 1

if __name__=='__main__': raise SystemExit(main())
