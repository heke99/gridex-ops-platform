#!/usr/bin/env python3
"""PRIVATE proposal, NOT EXECUTED. Existing disposable CI producer only.
Outer invocation: python3 THIS --cli-sha256 REVIEWED_RELEASE_SHA -- COMMAND ...
COMMAND must encompass the existing entire clean step (including later artifacts)
or the existing whole upgrade script. Never run just the clean source in a child
that exits before its existing consumers. New source custody is not acquired.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib

EXACT_START = ['start', '-x', 'studio,imgproxy,mailpit,edge-runtime,logflare,vector']
OFFICIAL_CLI_SHA256 = 'b67f22c508bb7434e4e36151b722e289130ed9e07a7ad4f9faadf4c83237286f'
OFFICIAL_GO_SHA256 = '9dd9e81a21074081328b77a27a8aef7be45a2828f81d99c4e1fb65efbec73947'
CONFIG_SHA256 = 'b70b0dc8885304790bb5f0b019c7a5b83e4f48f23d7cf1bc2e4b859e913e0919'
LEDGER_SHA256 = '9fbd0d5cf1bb96fc0cf85e818f14954bdda866a54d959370e2bb4bc4f8fa4f31'
MARKER_BYTES = b'-- GRIDEX-REM-002 local ledger marker.\nselect 1;\n'
SQL_SHA256 = 'd92bdab13882e6c3c801986875dc133b11298483ac0e3790f7b717afc0063848'
# Exact independently read CURRENT, OLD53 and OLDc8 original source pins.
# All three use the same pinned 48-entry official dev ledger marker source.
CLEAN_SOURCE_PINS = {
    'be69a4dad9e979a0fe5a6d96e908d6c461063d8f2a047fab9864fd9ba7def81a',
    'b210192b34ee9d1f8a7dce5b59e8af170347518cf17b848d638e8e7fa37d0000',
    '87ba4ea12885a0f3e34789f569dbb02976f80f12322b5e83131670a551767022',
}
STATE_ENV = 'GRIDEX_STORAGE_LOCAL_WRAPPER_STATE'

def refuse(code):
    raise SystemExit('local_storage_wrapper_' + code)

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def regular(path):
    if path.is_symlink() or not path.is_file():
        refuse('regular_file_required')

def runner_guard():
    if os.environ.get('GITHUB_ACTIONS') != 'true' or not os.environ.get('RUNNER_TEMP'):
        refuse('disposable_ci_required')
    if any(os.environ.get(k) for k in ['BASH_ENV', 'ENV', 'BASH_FUNC_supabase%%']):
        refuse('shell_command_override_forbidden')
    if os.environ.get('GRIDEX_REPLAY_DB_URL'):
        refuse('external_database_forbidden')
    # All database destinations/credentials are fixed LOCAL defaults, never
    # recovered from status/container metadata, Auth, secrets or remote APIs.
    for name in ['SUPABASE_DB_PASSWORD', 'SUPABASE_DB_HOST', 'SUPABASE_DB_PORT',
                 'SUPABASE_DB_URL', 'SUPABASE_HOSTNAME']:
        if os.environ.get(name):
            refuse('database_override_forbidden')

def invoke_real(state, args):
    real = Path(state['real_cli'])
    regular(real)
    if sha(real) != state['real_cli_sha256']:
        refuse('real_cli_checksum_changed')
    go_binary = Path(state['go_binary'])
    regular(go_binary)
    if sha(go_binary) != OFFICIAL_GO_SHA256 or os.environ.get('SUPABASE_GO_BINARY') != str(go_binary):
        refuse('official_go_proxy_binary_changed')
    return subprocess.run([str(real), *args], check=False).returncode

def start_preflight(state):
    root = Path.cwd().resolve()
    clean = root / 'scripts/gridex-aud-003-clean-replay.sh'
    regular(clean)
    if sha(clean) not in CLEAN_SOURCE_PINS:
        refuse('unqualified_clean_source')
    config_path = root / 'supabase/config.toml'
    regular(config_path)
    if sha(config_path) != CONFIG_SHA256:
        refuse('source_config_checksum_unknown')
    # Official config.Load reads SUPABASE_* overrides and nested dotenv files.
    # Refuse unqualified inputs without reading their possible credentials.
    for name in os.environ:
        if name.startswith('SUPABASE_') and name not in {
            'SUPABASE_INTERNAL_IMAGE_REGISTRY', 'SUPABASE_GO_BINARY'}:
            refuse('cli_config_environment_unknown')
    if os.environ.get('SUPABASE_INTERNAL_IMAGE_REGISTRY') != 'ghcr.io':
        refuse('qualified_registry_required')
    for directory in [root, root / 'supabase']:
        for name in ['.env.development.local', '.env.local', '.env.development', '.env']:
            if (directory / name).exists() or (directory / name).is_symlink():
                refuse('unqualified_dotenv_input')
    config = tomllib.loads(config_path.read_text())
    if config.get('db', {}).get('major_version') != 17:
        refuse('postgres_major_unknown')
    if config.get('db', {}).get('port') != 54322:
        refuse('local_db_port_unknown')
    # The exact source scripts own migration/seed HOLD, not this wrapper.
    migrations = root / 'supabase/migrations'
    seed = root / 'supabase/seed.sql'
    if migrations.is_symlink() or not migrations.is_dir():
        refuse('migrations_directory_unknown')
    ledger = root / 'scripts/gridex-aud-003-main-ledger.json'
    regular(ledger)
    if sha(ledger) != LEDGER_SHA256:
        refuse('official_marker_ledger_source_unknown')
    entries = json.loads(ledger.read_text()).get('entries', [])
    if len(entries) != 48:
        refuse('official_marker_count_unknown')
    expected_markers = {str(e['version']) + '_' + e['name'] + '.sql' for e in entries}
    actual_markers = {p.name for p in migrations.glob('*.sql')}
    if actual_markers != expected_markers or len(expected_markers) != 48:
        refuse('official_marker_set_mismatch')
    for name in sorted(expected_markers):
        marker = migrations / name
        regular(marker)
        if marker.read_bytes() != MARKER_BYTES:
            refuse('official_marker_bytes_mismatch')
    regular(seed)
    if seed.stat().st_size != 0:
        refuse('seed_hold_not_completed')
    version = root / 'supabase/.temp/postgres-version'
    regular(version)
    if version.read_text() != '17.6.1.155':
        refuse('image_pin_unknown')
    if any((root / 'supabase/.temp' / name).exists() or
           (root / 'supabase/.temp' / name).is_symlink()
           for name in ['project-ref', 'pooler-url']):
        refuse('linked_project_forbidden')
    # Binding setup paths in state prevents OLD ROOT/CANDIDATE_ROOT variables
    # from redirecting this CURRENT-owned artifact to historical relative files.
    sql = Path(state['sql'])
    regular(sql)
    if sha(sql) != SQL_SHA256:
        refuse('owner_sql_checksum_changed')
    return root

def dispatch():
    runner_guard()
    state_path = Path(os.environ.get(STATE_ENV, ''))
    regular(state_path)
    if state_path.stat().st_uid != os.getuid() or state_path.stat().st_mode & 0o077:
        refuse('private_state_permissions')
    state = json.loads(state_path.read_text())
    if sha(Path(__file__).resolve()) != state['wrapper_sha256']:
        refuse('wrapper_checksum_changed')
    args = sys.argv[1:]
    # Other commands/argv and exit status are untouched. Unexpected start forms
    # are refused: replay may never continue without the qualified post-hook.
    if args and args[0] == 'start' and args != EXACT_START:
        refuse('start_arguments_unknown')
    if args != EXACT_START:
        return invoke_real(state, args)
    root = start_preflight(state)
    code = invoke_real(state, args)
    if code != 0:
        return code
    # Detect any CLI-created input drift BEFORE allowing the source to replay.
    if Path.cwd().resolve() != root:
        refuse('working_directory_changed')
    start_preflight(state)
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    env['PGPASSWORD'] = 'postgres'  # existing official disposable-local default
    env['PGCONNECT_TIMEOUT'] = '5'
    psql = Path(state['psql'])
    regular(psql)
    if sha(psql) != state['psql_sha256']:
        refuse('psql_checksum_changed')
    # -X and cleared PG* prevent startup files/PGOPTIONS/service files from
    # redirecting identity or executing extra SQL. No URLs/passwords are printed.
    return subprocess.run([
        str(psql), '-X', '-q', '-w', '-h', '127.0.0.1', '-p', '54322',
        '-U', 'supabase_storage_admin', '-d', 'postgres',
        '-v', 'ON_ERROR_STOP=1', '-f', state['sql'],
    ], env=env, check=False).returncode

def main():
    runner_guard()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cli-sha256', default=OFFICIAL_CLI_SHA256)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command or args.cli_sha256 != OFFICIAL_CLI_SHA256:
        refuse('reviewed_cli_pin_and_command_required')
    # Producer must provide the independently verified official release hash;
    # do NOT self-admit any discovered binary merely because it says2.101.0.
    cli_name = shutil.which('supabase')
    if not cli_name or os.environ.get(STATE_ENV) or os.environ.get('SUPABASE_GO_BINARY'):
        refuse('original_tools_or_nonrecursive_context_required')
    cli = Path(cli_name).resolve()
    # The existing workflow installs client17 and exports this matching pg_dump
    # path. Never resolve /usr/bin/psql to Debian's basename-sensitive pg_wrapper.
    psql = Path('/usr/lib/postgresql/17/bin/psql')
    pg_dump = Path('/usr/lib/postgresql/17/bin/pg_dump')
    if os.environ.get('GRIDEX_PG_DUMP') != str(pg_dump):
        refuse('matching_client17_workflow_contract_required')
    regular(cli)
    regular(psql)
    regular(pg_dump)
    if not os.access(psql, os.X_OK) or psql.read_bytes()[:4] != b'\x7fELF':
        refuse('real_client17_binary_required')
    client_version = subprocess.run([str(psql), '--version'], capture_output=True,
                                    text=True, check=False)
    if client_version.returncode or not re.fullmatch(
            r'psql \(PostgreSQL\) 17(?:\.[0-9]+)*(?: \([^\r\n]*\))?',
            client_version.stdout.strip()):
        refuse('real_client17_version_unknown')
    if sha(cli) != args.cli_sha256:
        refuse('reviewed_cli_checksum_mismatch')
    go_binary = cli.with_name('supabase-go')
    regular(go_binary)
    if sha(go_binary) != OFFICIAL_GO_SHA256:
        refuse('official_go_binary_checksum_mismatch')
    version = subprocess.run([str(cli), '--version'], capture_output=True,
                             text=True, check=False)
    if version.returncode or version.stdout.strip() != '2.101.0':
        refuse('cli_version_unknown')
    sql = Path(__file__).resolve().with_name('ci-local-storage-owner-bootstrap-rls-guarded-private.sql')
    regular(sql)
    if sha(sql) != SQL_SHA256:
        refuse('owner_sql_checksum_mismatch')
    temp_root = Path(os.environ['RUNNER_TEMP']).resolve()
    if not temp_root.is_dir() or temp_root.stat().st_uid != os.getuid():
        refuse('runner_temp_unknown')
    # PATH is changed only in the child environment. Parent PATH/traps remain
    # intact. Child's original cleanup trap runs before this finally cleanup.
    work = Path(tempfile.mkdtemp(prefix='gridex-storage-local-', dir=temp_root))
    try:
        wrapper = work / 'supabase'
        # Bind the child wrapper to this already-qualified interpreter; do not
        # resolve a different python3 from a later historical PATH.
        interpreter = Path(sys.executable).resolve()
        regular(interpreter)
        if ' ' in str(interpreter) or '\n' in str(interpreter):
            refuse('interpreter_path_unknown')
        original_source = Path(__file__).resolve().read_text()
        wrapper.write_text('#!' + str(interpreter) + '\n' + original_source.split('\n', 1)[1])
        wrapper.chmod(0o700)
        state = {
            'real_cli': str(cli), 'real_cli_sha256': args.cli_sha256,
            'go_binary': str(go_binary),
            'psql': str(psql), 'psql_sha256': sha(psql), 'sql': str(sql),
            'wrapper_sha256': sha(wrapper),
        }
        state_path = work / 'state.json'
        state_path.write_text(json.dumps(state))
        state_path.chmod(0o600)
        env = dict(os.environ)
        env['PATH'] = str(work) + os.pathsep + env['PATH']
        env[STATE_ENV] = str(state_path)
        # Official documented Phase0 proxy override; bind only the already
        # verified genuine sibling, never resolve a foreign fallback binary.
        env['SUPABASE_GO_BINARY'] = str(go_binary)
        return subprocess.run(command, env=env, check=False).returncode
    finally:
        shutil.rmtree(work)

if __name__ == '__main__':
    try:
        code = dispatch() if Path(sys.argv[0]).name == 'supabase' else main()
        # subprocess return codes use negative signal numbers; preserve the
        # conventional shell-visible signal exit instead of accidental255.
        raise SystemExit(128 - code if code < 0 else code)
    except (OSError, ValueError, KeyError, TypeError):
        # Never print exception text: it may include caller-controlled paths or
        # tool output. SQL raises fixed, non-sensitive diagnostic identifiers.
        refuse('invalid_local_source_or_environment')
