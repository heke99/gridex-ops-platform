#!/usr/bin/env python3
"""Qualify only the source-bound forward10 LOCK context on an owned native CLI.

Synthetic tables, no real data, no historical replay or schema/type acceptance.
The original migration is never modified or marked applied by this probe.
"""
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

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'supabase/migrations/20260915183840_drop_inert_inbound_client_policies.sql'
DIGEST = '5cd56392d5647196fe4f64e7d5a76fe5fa0a3a9a454efcfd34a6d8f754ac86a7'
LOCK = ('lock table public.inbound_ediel_match_attempts, public.inbound_ediel_parse_results,\n'
        '  public.inbound_email_attachments in access exclusive mode;')
TABLES = ('inbound_ediel_match_attempts', 'inbound_ediel_parse_results', 'inbound_email_attachments')
SETTINGS = "set local lock_timeout='5s'; set local statement_timeout='60s'; set local search_path=pg_catalog,public;\n"
CHECK = """current_setting('lock_timeout')::interval=interval '5 seconds' AND current_setting('statement_timeout')::interval=interval '60 seconds'
 AND current_setting('search_path')='pg_catalog, public'
 AND (SELECT count(*)=3 FROM pg_locks WHERE pid=pg_backend_pid() AND granted
 AND mode='AccessExclusiveLock' AND relation IN ('public.inbound_ediel_match_attempts'::regclass,
 'public.inbound_ediel_parse_results'::regclass,'public.inbound_email_attachments'::regclass))
 AND (SELECT count(*)=1 FROM public.inbound_ediel_match_attempts WHERE id=7)"""
CHECK_SQL = "IF (" + CHECK + ") IS DISTINCT FROM true THEN RAISE EXCEPTION 'LOCK_CONTEXT_BAD' USING ERRCODE='PF009'; END IF; "
SNAPSHOT = """SELECT jsonb_build_object('ledger',(SELECT jsonb_agg(to_jsonb(t) ORDER BY version)
 FROM supabase_migrations.schema_migrations t), 'rows',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id)
 FROM public.inbound_ediel_match_attempts t));"""
DROP = "DROP TRIGGER forward_lock_guard ON supabase_migrations.schema_migrations; DROP FUNCTION public.forward_lock_guard();"


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ERRORS = frozenset(('FIXED_SOURCE_REQUIRED', 'EXACT_LOCK_REQUIRED', 'CLI_REQUIRED',
    'PROBE_COMMAND_FAILED', 'ONE_CLI_FILE_REQUIRED', 'CLI_IDENTITY_REQUIRED', 'GUARD_NAME_REQUIRED',
    'EXACT_CLI_REQUIRED', 'PREEXISTING_TARGET_REJECTED', 'INITIAL_CLI_FILE_REQUIRED',
    'EXACT_FAILURE_AND_ROLLBACK_REQUIRED', 'EXACT_SUCCESS_REPEAT_REQUIRED', 'INTERRUPTED', 'EXACT_COMPILED_LOCK_REQUIRED'))


def run():
    if len(sys.argv) != 1:
        raise ValueError('NO_TARGET_OR_SCOPE_ARGUMENTS_ACCEPTED')
    def interrupted(_signum, _frame):
        raise ValueError('INTERRUPTED')
    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    source = ROOT / SOURCE
    if source.is_symlink() or hashlib.sha256(source.read_bytes()).hexdigest() != DIGEST:
        raise ValueError('FIXED_SOURCE_REQUIRED')
    if source.read_text().count(LOCK) != 1:
        raise ValueError('EXACT_LOCK_REQUIRED')
    import canonical_forward_sources as forward_sources
    import canonical_native_forward_runtime as forward_runtime
    import canonical_native_forward_lock as lock_context
    import canonical_native_timestamp_sources as compiler
    compiled = forward_runtime.programs(forward_sources.retain(ROOT))[9]
    original_body, transferred = compiler.transfer_outer(source.read_bytes())
    if (transferred is not True or compiled.source_sha256 != DIGEST
            or compiled.sql.count(lock_context.OPEN) != 1 or compiled.sql.count(lock_context.CLOSE) != 1
            or compiled.sql.replace(lock_context.OPEN, b'').replace(lock_context.CLOSE, b'') != original_body):
        raise ValueError('EXACT_COMPILED_LOCK_REQUIRED')
    start = compiled.sql.index(lock_context.OPEN)
    end = compiled.sql.index(lock_context.CLOSE) + len(lock_context.CLOSE)
    compiled_lock = compiled.sql[start:end]
    if compiled_lock != lock_context.OPEN + LOCK.encode() + lock_context.CLOSE:
        raise ValueError('EXACT_COMPILED_LOCK_REQUIRED')
    life = load('canonical-native-supabase-lifecycle')
    transport = load('canonical_native_cli_transport')
    cli = shutil.which('supabase')
    if cli is None:
        raise ValueError('CLI_REQUIRED')
    project = life.project_name(os.environ['GITHUB_RUN_ID'], os.environ['GITHUB_RUN_ATTEMPT'], secrets.token_hex(8))
    network = project + '-network'
    report = dict(scope='SYNTHETIC_FORWARD10_LOCK_CONTEXT_NOT_RELEASE_ACCEPTANCE', sourceSha256=DIGEST,
                  productionModified=False, schemaAccepted=False, generatedTypesVerified=False,
                  compiledProgramSha256=hashlib.sha256(compiled.sql).hexdigest(),
                  completeSourceByteRoundtripVerified=True, cases=[])
    created = started = False
    error = None
    with tempfile.TemporaryDirectory(prefix=project + '-') as directory:
        work = Path(directory)
        env = {k:v for k,v in os.environ.items() if k in ('PATH', 'LANG', 'LC_ALL', 'TZ')}
        (work / 'home').mkdir(mode=0o700)
        env.update(HOME=str(work / 'home'), XDG_CONFIG_HOME=str(work / 'home/config'), CI='true')

        def command(args, data=None, allow_failure=False, timeout=600):
            result = subprocess.run(args, input=data, capture_output=True, cwd=work, env=env, timeout=timeout)
            if result.returncode and not allow_failure:
                report['commandSqlstates'] = sorted(set(re.findall(rb'SQLSTATE ([A-Z0-9]{5})', result.stderr)))
                report['commandSqlstates'] = [s.decode() for s in report['commandSqlstates']]
                raise ValueError('PROBE_COMMAND_FAILED')
            return result

        def native(*args, **kwargs):
            args = transport.cli_command(cli, work, project, args) if created else [cli, '--workdir', str(work), *args]
            return command(args, **kwargs)

        def sql(text, output=True):
            result = command(['docker', 'exec', '-i', 'supabase_db_' + project, 'psql', '-XqAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], data=text.encode())
            return json.loads(result.stdout) if output else None

        def new(raw):
            # Let the CLI create each identity from its own clock, never rename it.
            time.sleep(1.1)
            name = 'gridex_native_forward_10_' + hashlib.sha256(raw).hexdigest()[:12]
            before = set(migrations.glob('*.sql'))
            native('migration', 'new', name)
            added = set(migrations.glob('*.sql')) - before
            if len(added) != 1:
                raise ValueError('ONE_CLI_FILE_REQUIRED')
            path = added.pop()
            if not re.fullmatch(r'\d{14}_' + name + r'\.sql', path.name):
                raise ValueError('CLI_IDENTITY_REQUIRED')
            path.write_bytes(raw)
            path.chmod(0o600)
            return path, name

        def guard(name, failure):
            if not re.fullmatch(r'gridex_native_forward_10_[a-f0-9]{12}', name):
                raise ValueError('GUARD_NAME_REQUIRED')
            body = "IF NEW.name<> '" + name + "' THEN RAISE EXCEPTION 'LOCK_NAME_BAD' USING ERRCODE='PF009'; END IF; " + CHECK_SQL
            body += "RAISE EXCEPTION 'LOCK_LEDGER_FAULT' USING ERRCODE='PF002'; " if failure else 'RETURN NEW; '
            sql('CREATE FUNCTION public.forward_lock_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$ BEGIN ' + body + 'END $guard$; '
                'REVOKE ALL ON FUNCTION public.forward_lock_guard() FROM PUBLIC,anon,authenticated,service_role; '
                'CREATE TRIGGER forward_lock_guard BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.forward_lock_guard();', False)

        try:
            if command([cli, '--version']).stdout.strip() != b'2.101.0':
                raise ValueError('EXACT_CLI_REQUIRED')
            for kind in ('container', 'volume'):
                if command(['docker', kind, 'ls', '-q', '--filter', 'label=com.supabase.cli.project=' + project]).stdout.strip():
                    raise ValueError('PREEXISTING_TARGET_REJECTED')
            native('init')
            config = work / 'supabase/config.toml'
            text = life.config(project, 5432, 54322, config.read_text())
            config.write_text(text)
            migrations = work / 'supabase/migrations'
            migrations.mkdir(mode=0o700, exist_ok=True)
            command(['docker', 'network', 'create', '--internal', '--label', 'gridex.native.owner=' + project, network])
            created = True
            started = True
            native('--network-id', network, 'db', 'start')
            meta = life.check_container(json.loads(command(['docker', 'inspect', 'supabase_db_' + project]).stdout), project, network)
            report['image'] = meta['Config']['Image']
            native('migration', 'new', 'native_lifecycle_proof')
            files = list(migrations.glob('*.sql'))
            if len(files) != 1:
                raise ValueError('INITIAL_CLI_FILE_REQUIRED')
            initial = '\n'.join('CREATE TABLE public.' + t + ' (id integer PRIMARY KEY); ALTER TABLE public.' + t + ' ENABLE ROW LEVEL SECURITY;' for t in TABLES)
            files[0].write_text(initial)
            files[0].chmod(0o600)
            native('migration', 'up', '--local')
            baseline = sql(SNAPSHOT)
            plain = (SETTINGS + LOCK + '\nINSERT INTO public.inbound_ediel_match_attempts VALUES (7);\n').encode()
            adapted = plain.replace(LOCK.encode(), compiled_lock)
            for label, raw, expected, ledger in (
                ('original_top_level_lock', plain, '25P01', False),
                ('adapted_post_body_rollback', adapted + ('DO $post$ BEGIN ' + CHECK_SQL + "RAISE EXCEPTION 'LOCK_POST_FAULT' USING ERRCODE='PF001'; END $post$;").encode(), 'PF001', False),
                ('adapted_ledger_rollback', adapted, 'PF002', True),
            ):
                path, name = new(raw)
                if ledger:
                    guard(name, True)
                try:
                    result = native('migration', 'up', '--local', allow_failure=True)
                    states = re.findall(rb'^ERROR:.*?\(SQLSTATE ([A-Z0-9]{5})\)', result.stderr, re.M)
                    if result.returncode == 0 or states != [expected.encode()] or sql(SNAPSHOT) != baseline:
                        report['unexpectedStates'] = [s.decode() for s in states]
                        report['failedCase'] = label
                        raise ValueError('EXACT_FAILURE_AND_ROLLBACK_REQUIRED')
                    report['cases'].append(dict(case=label, sqlstate=expected, rowsAndLedgerRestored=True))
                finally:
                    if ledger:
                        sql(DROP, False)
                    path.unlink()
            path, name = new(adapted)
            guard(name, False)
            native('migration', 'up', '--local')
            after = sql(SNAPSHOT)
            sql(DROP, False)
            native('migration', 'up', '--local')
            if sql(SNAPSHOT) != after or after['rows'] != [{'id':7}] or len(after['ledger']) != 2:
                raise ValueError('EXACT_SUCCESS_REPEAT_REQUIRED')
            report.update(lockAndSettingsHeldAtLedger=True, genuineCliLedger=True, repeatVerified=True)
        except Exception as exc:
            error = type(exc).__name__
            report['failureCode'] = exc.args[0] if type(exc) is ValueError and len(exc.args) == 1 and type(exc.args[0]) is str and exc.args[0] in ERRORS else 'UNCLASSIFIED'
        finally:
            clean = True
            try:
                if started:
                    native('stop', '--project-id', project, '--no-backup')
                    for kind in ('container', 'volume'):
                        if command(['docker', kind, 'ls', '-q', '--filter', 'label=com.supabase.cli.project=' + project]).stdout.strip():
                            raise ValueError('OWNED_RESOURCES_REMAIN')
                if created:
                    metadata = json.loads(command(['docker', 'network', 'inspect', network]).stdout)[0]
                    if metadata.get('Labels', {}).get('gridex.native.owner') != project or metadata.get('Internal') is not True:
                        raise ValueError('OWNED_NETWORK_REQUIRED')
                    command(['docker', 'network', 'rm', network])
            except Exception:
                clean = False
            report['cleanupVerified'] = clean
    report['privateWorkspaceRemoved'] = not work.exists()
    report['outcome'] = 'LOCK_CONTEXT_QUALIFIED_NOT_RELEASE' if error is None and clean and not work.exists() else 'BLOCKED'
    out = ROOT / 'artifacts'
    out.mkdir(exist_ok=True)
    (out / 'forward-lock-preflight.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, sort_keys=True))
    return 0 if report['outcome'] == 'LOCK_CONTEXT_QUALIFIED_NOT_RELEASE' else 1


if __name__ == '__main__':
    raise SystemExit(run())
