#!/usr/bin/env python3
"""Qualify the pinned official CLI on a fresh, local, synthetic-only project.

No Gridex source SQL, user data, linked project or hosted credentials are used.
This verifies native initialization and a real CLI-owned migration ledger, not
acceptance of the historical Gridex chain. Raw CLI/Docker streams stay private.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = '2.101.0'
FIRST = ('CREATE TABLE public.gridex_native_lifecycle_probe (id integer PRIMARY KEY);\n'
         'ALTER TABLE public.gridex_native_lifecycle_probe ENABLE ROW LEVEL SECURITY;\n'
         'INSERT INTO public.gridex_native_lifecycle_probe VALUES (1);\n')
FAILED = ('ALTER TABLE public.gridex_native_lifecycle_probe ADD COLUMN never_committed integer;\n'
          'SELECT public.gridex_native_missing_function();\n')
METADATA = """SELECT jsonb_build_object(
 'serverVersion',current_setting('server_version'),'currentRole',current_user,
 'schemaOwner',(SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='public'),
 'defaultPrivileges',(SELECT coalesce(jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(d.defaclrole),'schema',coalesce(n.nspname,'*'),'objectType',d.defaclobjtype,'acl',d.defaclacl::text) ORDER BY pg_get_userbyid(d.defaclrole),coalesce(n.nspname,'*'),d.defaclobjtype),'[]'::jsonb) FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname='public' OR d.defaclnamespace=0),
 'platformSchemas',(SELECT jsonb_agg(nspname ORDER BY nspname) FROM pg_namespace WHERE nspname IN ('auth','storage','realtime','supabase_migrations')),
 'extensions',(SELECT jsonb_agg(jsonb_build_object('name',extname,'version',extversion) ORDER BY extname) FROM pg_extension));"""
LEDGER = """SELECT jsonb_build_object(
 'ledger',(SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version),'[]'::jsonb) FROM supabase_migrations.schema_migrations),
 'probeRows',(SELECT count(*) FROM public.gridex_native_lifecycle_probe),
 'failedColumnExists',EXISTS(SELECT FROM pg_attribute WHERE attrelid='public.gridex_native_lifecycle_probe'::regclass AND attname='never_committed' AND NOT attisdropped),
 'probeAcl',(SELECT relacl::text FROM pg_class WHERE oid='public.gridex_native_lifecycle_probe'::regclass),
 'probeRls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.gridex_native_lifecycle_probe'::regclass));"""


def owner(value):
    if not re.fullmatch(r'gridex-native-[0-9]+-[0-9]+-[a-f0-9]{16}', value):
        raise ValueError('EXACT_NATIVE_OWNER_REQUIRED')
    return value


def config(project, port, shadow):
    owner(project)
    if any(type(p) is not int or not 1024 < p < 65536 for p in (port, shadow)) or port == shadow:
        raise ValueError('DISTINCT_LOCAL_PORTS_REQUIRED')
    return (f'project_id = "{project}"\n[db]\nport = {port}\nshadow_port = {shadow}\nmajor_version = 17\n'
            '[db.seed]\nenabled = false\n[api]\nenabled = false\n[analytics]\nenabled = false\n')


def check_container(data, project, network):
    owner(project)
    if (len(data) != 1 or data[0]['Name'] != '/supabase_db_'+project
            or data[0]['Config'].get('Labels', {}).get('com.supabase.cli.project') != project
            or network not in data[0]['NetworkSettings']['Networks']
            or not data[0]['Config']['Image'].startswith('public.ecr.aws/supabase/postgres:17.')):
        raise ValueError('OWNED_NATIVE_DATABASE_REQUIRED')
    return data[0]


def verify_ledger(value, filename):
    expected_version, name = filename[:-4].split('_', 1)
    entries = value['ledger']
    if (len(entries) != 1 or entries[0]['version'] != expected_version
            or entries[0]['name'] != name or type(value['probeRows']) is not int or value['probeRows'] != 1
            or value['failedColumnExists'] or value['probeRls'] is not True):
        raise ValueError('GENUINE_NATIVE_LEDGER_REQUIRED')
    statements = [s.strip().rstrip(';') for s in entries[0]['statements']]
    if statements != [s.strip() for s in FIRST.split(';') if s.strip()]:
        raise ValueError('EXECUTED_NATIVE_STATEMENTS_REQUIRED')


def run():
    if len(sys.argv) != 1 or os.environ.get('GITHUB_ACTIONS') != 'true':
        raise ValueError('DEDICATED_NATIVE_CI_REQUIRED')
    run_id, attempt = os.environ.get('GITHUB_RUN_ID',''), os.environ.get('GITHUB_RUN_ATTEMPT','')
    project = owner(f'gridex-native-{run_id}-{attempt}-{secrets.token_hex(8)}')
    cli = shutil.which('supabase')
    if cli is None:
        raise ValueError('PINNED_NATIVE_CLI_REQUIRED')
    report = {'scope':'SYNTHETIC_NATIVE_LIFECYCLE_NOT_GRIDEX_REPLAY_ACCEPTANCE',
              'cliVersion':VERSION,'outcome':'BLOCKED','historicalGridexSourcesExecuted':False,
              'completeReplayVerified':False,'generatedTypesVerified':False,'productionModified':False}
    phase = 'PREFLIGHT'; created_network = False; attempted_start = False; success = False
    with tempfile.TemporaryDirectory(prefix=project+'-') as directory:
        work = Path(directory); private_home = work/'home'; private_home.mkdir(mode=0o700)
        environment = {k:v for k,v in os.environ.items() if k in ('PATH','LANG','LC_ALL','TZ')}
        environment.update(HOME=str(private_home),XDG_CONFIG_HOME=str(private_home/'config'),CI='true')
        counter = 0
        def command(args, *, data=None, timeout=120, allow_failure=False):
            nonlocal counter
            counter += 1
            process = subprocess.run(args,input=data,capture_output=True,timeout=timeout,env=environment,cwd=work)
            for suffix, raw in [('out',process.stdout),('err',process.stderr)]:
                path = work/f'command-{counter}.{suffix}'
                with path.open('xb') as stream:
                    os.chmod(path,0o600); stream.write(raw)
            if process.returncode and not allow_failure:
                report['lastExitCode'] = process.returncode
                for marker, category in ((b'Could not find the `supabase-go` binary', 'CLI_COMPANION_BINARY_MISSING'),
                                         (b'Cannot connect to the Docker daemon', 'DOCKER_UNAVAILABLE'),
                                         (b'failed to parse config', 'NATIVE_CONFIG_REJECTED'),
                                         (b'failed to pull docker image', 'NATIVE_IMAGE_PULL_FAILED')):
                    if marker in process.stderr:
                        report['commandFailureCategory'] = category
                raise ValueError('NATIVE_COMMAND_FAILED')
            return process
        def native(*args, **kwargs):
            return command([cli,'--workdir',str(work),*args],**kwargs)
        def sql(query):
            return json.loads(command(['docker','exec','-i','supabase_db_'+project,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],data=query.encode()).stdout)
        def present(kind):
            return command(['docker',kind,'ls',*(['-a'] if kind == 'container' else []),
                            '-q','--filter','label=com.supabase.cli.project='+project]).stdout.strip()
        network = project+'-network'
        try:
            if command([cli,'--version']).stdout.decode().strip() != VERSION:
                raise ValueError('EXACT_NATIVE_CLI_VERSION_REQUIRED')
            if present('container') or present('volume'):
                raise ValueError('PREEXISTING_NATIVE_PROJECT_REJECTED')
            native('init')
            # Keep the two reservations distinct while choosing ports.
            with socket.socket() as a, socket.socket() as b:
                a.bind(('127.0.0.1',0)); b.bind(('127.0.0.1',0))
                text = config(project,a.getsockname()[1],b.getsockname()[1])
            path = work/'supabase/config.toml'; path.write_text(text); path.chmod(0o600)
            migrations = work/'supabase/migrations'; migrations.mkdir(exist_ok=True)
            if list(migrations.iterdir()) or (work/'supabase/.temp/project-ref').exists():
                raise ValueError('EMPTY_UNLINKED_NATIVE_PROJECT_REQUIRED')
            command(['docker','network','create','--internal','--label','gridex.native.owner='+project,network])
            created_network = True
            phase = 'NATIVE_DATABASE_START'; attempted_start = True
            native('--network-id',network,'db','start',timeout=600)
            inspected = check_container(json.loads(command(['docker','inspect','supabase_db_'+project]).stdout),project,network)
            report.update(image=inspected['Config']['Image'], imageId=inspected['Image'])
            report['nativeBootstrap'] = sql(METADATA)
            if (not report['nativeBootstrap']['serverVersion'].startswith('17.')
                    or report['nativeBootstrap']['currentRole'] != 'postgres'):
                raise ValueError('NATIVE_POSTGRES_ROLE_REQUIRED')
            phase = 'GENUINE_CLI_MIGRATION'
            native('migration','new','native_lifecycle_proof')
            files = list(migrations.glob('*.sql'))
            if len(files) != 1 or not re.fullmatch(r'\d{14}_native_lifecycle_proof.sql',files[0].name):
                raise ValueError('CLI_GENERATED_MIGRATION_REQUIRED')
            first = files[0]; first.write_text(FIRST); first.chmod(0o600)
            native('migration','up','--local')
            initial = sql(LEDGER); verify_ledger(initial,first.name)
            native('migration','up','--local')
            if sql(LEDGER) != initial:
                raise ValueError('NATIVE_LEDGER_IDEMPOTENCE_REQUIRED')
            phase = 'FAILED_MIGRATION_ROLLBACK'
            native('migration','new','native_rollback_proof')
            added = [p for p in migrations.glob('*.sql') if p != first]
            if (len(added) != 1 or not re.fullmatch(r'\d{14}_native_rollback_proof.sql',added[0].name)
                    or added[0].name[:14] <= first.name[:14]):
                raise ValueError('NEXT_CLI_MIGRATION_REQUIRED')
            added[0].write_text(FAILED); added[0].chmod(0o600)
            failure = native('migration','up','--local',allow_failure=True)
            if failure.returncode == 0 or sql(LEDGER) != initial:
                raise ValueError('NATIVE_FAILED_MIGRATION_ATOMICITY_REQUIRED')
            report.update(nativeLedgerVerified=True, successfulMigration=first.name,
                          executedSqlSha256=hashlib.sha256(FIRST.encode()).hexdigest(),
                          idempotent=True,failedMigrationRolledBack=True,
                          failedMigrationNotRecorded=True,probeAcl=initial['probeAcl'])
            success = True
        except Exception as error:
            report.update(outcome='BLOCKED',phase=phase,errorType=type(error).__name__)
            # Only this module's closed error codes are eligible for disclosure.
            allowed = {'NATIVE_COMMAND_FAILED', 'EXACT_NATIVE_CLI_VERSION_REQUIRED',
                       'PREEXISTING_NATIVE_PROJECT_REJECTED', 'EMPTY_UNLINKED_NATIVE_PROJECT_REQUIRED',
                       'OWNED_NATIVE_DATABASE_REQUIRED', 'NATIVE_POSTGRES_ROLE_REQUIRED',
                       'CLI_GENERATED_MIGRATION_REQUIRED', 'GENUINE_NATIVE_LEDGER_REQUIRED',
                       'EXECUTED_NATIVE_STATEMENTS_REQUIRED', 'NATIVE_LEDGER_IDEMPOTENCE_REQUIRED',
                       'NEXT_CLI_MIGRATION_REQUIRED', 'NATIVE_FAILED_MIGRATION_ATOMICITY_REQUIRED'}
            if type(error) is ValueError and len(error.args) == 1 and error.args[0] in allowed:
                report['errorCode'] = error.args[0]
            report['lastCommandIndex'] = counter
        finally:
            cleanup = True
            try:
                if attempted_start:
                    if path.read_text() != text:
                        raise ValueError('OWNED_NATIVE_CONFIG_CHANGED')
                    native('stop','--project-id',project,'--no-backup',timeout=120)
                    if present('container') or present('volume'):
                        raise ValueError('NATIVE_RESOURCES_REMAIN')
                if created_network:
                    found = command(['docker','network','ls','-q','--filter','name=^'+network+'$']).stdout.strip()
                    if found:
                        meta = json.loads(command(['docker','network','inspect',network]).stdout)[0]
                        if meta.get('Labels',{}).get('gridex.native.owner') != project or not meta.get('Internal'):
                            raise ValueError('NATIVE_NETWORK_OWNER_REQUIRED')
                        command(['docker','network','rm',network])
                        if command(['docker','network','ls','-q','--filter','name=^'+network+'$']).stdout.strip():
                            raise ValueError('NATIVE_NETWORK_DISPOSAL_UNVERIFIED')
            except Exception:
                cleanup = False
            report['cleanupVerified'] = cleanup
            success = success and cleanup
    report['privateWorkspaceRemoved'] = not work.exists()
    success = success and report['privateWorkspaceRemoved']
    if success:
        report['outcome'] = 'NATIVE_LIFECYCLE_VERIFIED'
    output = ROOT/'artifacts'; output.mkdir(exist_ok=True)
    (output/'native-supabase-lifecycle.json').write_text(json.dumps(report,sort_keys=True,indent=2)+'\n')
    print(json.dumps(report,sort_keys=True),flush=True)
    return 0 if success else 1


if __name__ == '__main__':
    def interrupted(*_):
        raise ValueError('NATIVE_INTERRUPTED')
    previous = {s:signal.getsignal(s) for s in (signal.SIGINT,signal.SIGTERM)}
    try:
        for signum in previous:
            signal.signal(signum,interrupted)
        raise SystemExit(run())
    except Exception:
        print('FAIL native lifecycle; no raw output or hosted target permitted',file=sys.stderr)
        raise SystemExit(1) from None
    finally:
        for signum,handler in previous.items():
            signal.signal(signum,handler)
