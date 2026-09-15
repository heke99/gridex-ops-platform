#!/usr/bin/env python3
"""Own the pinned official CLI on a fresh, local, unlinked project.

The default command qualifies synthetic initialization and ledger behavior.
The ordinary replay caller can additionally request the pinned historical
first43 boundary, atomic44-52/53-56, whole-source57, bounded58-63 and atomic64-68. Neither mode accepts the
complete Gridex chain or its types.
Raw CLI/Docker streams stay private; no hosted credentials are accepted.
"""
import copy
import hashlib
import importlib.util
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
import tomllib
import canonical_native_provider_events as provider_events

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
    # The pinned CLI silently truncates longer project IDs to 40 characters.
    # Such a rename would invalidate both ownership checks and targeted cleanup.
    if not isinstance(value, str) or not re.fullmatch(r'gridex-sb-[a-f0-9]{12}-[a-f0-9]{16}', value):
        raise ValueError('EXACT_NATIVE_OWNER_REQUIRED')
    return value


def project_name(run_id, attempt, nonce):
    if (not all(isinstance(v, str) and re.fullmatch(r'[0-9]+', v) for v in (run_id, attempt))
            or not isinstance(nonce, str) or not re.fullmatch(r'[a-f0-9]{16}', nonce)):
        raise ValueError('EXACT_NATIVE_OWNER_REQUIRED')
    identity = hashlib.sha256((run_id+':'+attempt).encode()).hexdigest()[:12]
    return owner('gridex-sb-'+identity+'-'+nonce)


def config(project, port, shadow, template):
    """Change only local identity, ports and exposure in the CLI-generated file."""
    owner(project)
    if any(type(p) is not int or not 1024 < p < 65536 for p in (port, shadow)) or port == shadow:
        raise ValueError('DISTINCT_LOCAL_PORTS_REQUIRED')
    before = tomllib.loads(template)
    if before.get('remotes') or before.get('db', {}).get('major_version') != 17:
        raise ValueError('UNLINKED_NATIVE_PG17_TEMPLATE_REQUIRED')
    replacements = {('', 'project_id'): json.dumps(project), ('db', 'port'): str(port),
                    ('db', 'shadow_port'): str(shadow), ('db.seed', 'enabled'): 'false',
                    ('api', 'enabled'): 'false', ('analytics', 'enabled'): 'false'}
    section = ''; changed = set(); result = []
    for line in template.splitlines(keepends=True):
        heading = re.fullmatch(r'\[([a-z_]+(?:\.[a-z_]+)*)\]\s*(?:#.*)?', line.strip())
        if heading:
            section = heading[1]
        assignment = re.match(r'^(\s*)([a-z_]+)\s*=.*?(\r?\n)?$', line)
        key = (section, assignment[2]) if assignment else None
        if key in replacements:
            if key in changed:
                raise ValueError('EXACT_NATIVE_TEMPLATE_SITE_REQUIRED')
            changed.add(key)
            line = assignment[1]+assignment[2]+' = '+replacements[key]+(assignment[3] or '')
        result.append(line)
    if changed != set(replacements):
        raise ValueError('EXACT_NATIVE_TEMPLATE_SITE_REQUIRED')
    rendered = ''.join(result)
    expected = copy.deepcopy(before)
    expected['project_id'] = project
    expected['db']['port'] = port; expected['db']['shadow_port'] = shadow
    expected['db']['seed']['enabled'] = False
    expected['api']['enabled'] = False; expected['analytics']['enabled'] = False
    if tomllib.loads(rendered) != expected:
        raise ValueError('UNRELATED_NATIVE_CONFIG_CHANGE')
    return rendered


def command_signals(stdout, stderr):
    """Emit fixed diagnostic categories, never arbitrary error text or values."""
    raw = (stdout+b'\n'+stderr).lower()
    markers = {
        b'could not find the `supabase-go` binary': 'CLI_COMPANION_BINARY_MISSING',
        b'cannot connect to the docker daemon': 'DOCKER_UNAVAILABLE',
        b'failed to parse config': 'NATIVE_CONFIG_REJECTED',
        b'missing required field in config': 'NATIVE_REQUIRED_CONFIG_MISSING',
        b'project_id field in config is invalid': 'NATIVE_PROJECT_ID_REWRITTEN',
        b'unknown flag': 'NATIVE_FLAG_REJECTED',
        b'failed to pull docker image': 'NATIVE_IMAGE_PULL_FAILED',
        b'failed to connect to postgres': 'POSTGRES_CONNECTION_FAILED',
        b'connection refused': 'NATIVE_CONNECTION_REFUSED',
        b'network not found': 'NATIVE_NETWORK_MISSING',
        b'is not healthy': 'NATIVE_SERVICE_UNHEALTHY',
        b'address already in use': 'NATIVE_PORT_CONFLICT',
        b'initialising schema': 'NATIVE_SCHEMA_INITIALIZATION_REACHED',
        b'starting database': 'NATIVE_DATABASE_START_REACHED',
        b'permission denied': 'NATIVE_PERMISSION_DENIED',
        b'client version': 'DOCKER_API_VERSION_REPORTED',
        b'sqlstate': 'NATIVE_SQL_ERROR_REPORTED',
    }
    return sorted(category for marker, category in markers.items() if marker in raw)


def failure_code(error, historical):
    """Return only a fixed code from the exact trusted error class.

    Never stringify exceptions or disclose arbitrary SQL/process output. The
    historical boundary has its own ValueError subclass; excluding that exact
    class previously hid every first43 failure behind errorType=PrefixError.
    """
    lifecycle_codes = {'NATIVE_FOUNDATION_SOURCE_REQUIRED','NATIVE_FOUNDATION_TRANSACTION_REQUIRED','NATIVE_FOUNDATION_PROGRAM_REQUIRED','NATIVE_FOUNDATION_PREFIX_REQUIRED','NATIVE_FOUNDATION_LEDGER_REQUIRED','NATIVE_FOUNDATION_CLEANUP_REQUIRED','NATIVE_FOUNDATION_PROOF_REQUIRED','NATIVE_FOUNDATION_ROLLBACK_REQUIRED','NATIVE_FOUNDATION_EXECUTION_REQUIRED','NATIVE_FOUNDATION_REPEAT_REQUIRED', 'NATIVE_COMMAND_FAILED', 'EXACT_NATIVE_CLI_VERSION_REQUIRED',
                       'NATIVE_PROVIDER_EVENT_IMAGE_REQUIRED', 'NATIVE_PROVIDER_EVENT_CONTRACT_REQUIRED',
                       'NATIVE_PROVIDER_EVENT_BOOTSTRAP_REQUIRED', 'NATIVE_PROVIDER_CATALOG_SOURCE_REQUIRED',
                       'PREEXISTING_NATIVE_PROJECT_REJECTED', 'EMPTY_UNLINKED_NATIVE_PROJECT_REQUIRED',
                       'OWNED_NATIVE_DATABASE_REQUIRED', 'NATIVE_POSTGRES_ROLE_REQUIRED',
                       'CLI_GENERATED_MIGRATION_REQUIRED', 'GENUINE_NATIVE_LEDGER_REQUIRED',
                       'EXECUTED_NATIVE_STATEMENTS_REQUIRED', 'NATIVE_LEDGER_IDEMPOTENCE_REQUIRED',
                       'NEXT_CLI_MIGRATION_REQUIRED', 'NATIVE_FAILED_MIGRATION_ATOMICITY_REQUIRED'}
    lifecycle_codes.update({
        'NATIVE_PARITY_ENGINE_SOURCE_REQUIRED',
        'NATIVE_PARITY_ENGINE_PROGRAM_REQUIRED',
        'NATIVE_PARITY_ENGINE_RETAINED_REQUIRED',
        'NATIVE_PARITY_ENGINE_OUTPUT_REQUIRED',
        'NATIVE_PARITY_ENGINE_ONCE_REQUIRED',
        'NATIVE_PARITY_ENGINE_IDENTICAL_REQUIRED',
        'NATIVE_PARITY_ENGINE_DRIFT_DETECTION_REQUIRED',
        'NATIVE_PARITY_ENGINE_CLONE_DISPOSAL_REQUIRED',
        'NATIVE_PARITY_ENGINE_PARENT_PRESERVATION_REQUIRED',
        'NATIVE_PARITY_ENGINE_RECEIPT_REQUIRED',
    })
    lifecycle_codes.update({
        'CHANGED_INDEX_CASES_REQUIRED',
        'CHANGED_INDEX_DUPLICATE_ADMITTED',
        'CHANGED_INDEX_ENVIRONMENT_REQUIRED',
        'CHANGED_INDEX_EXCLUDED_DUPLICATE_REJECTED',
        'CHANGED_INDEX_FIXTURE_ROWS_REQUIRED',
        'CHANGED_INDEX_WITNESS_CATALOG_REQUIRED',
        'CHANGED_INDEX_WITNESS_EXECUTION_REQUIRED',
        'CHANGED_INDEX_WITNESS_LEDGER_REQUIRED',
        'CHANGED_INDEX_WITNESS_ONCE_REQUIRED',
        'CHANGED_INDEX_WITNESS_OWNED_TARGET_REQUIRED',
        'CHANGED_INDEX_WITNESS_PRESERVATION_REQUIRED',
        'CHANGED_INDEX_WITNESS_RESULT_REQUIRED',
        'CHANGED_INDEX_WITNESS_SOURCE_REQUIRED',
        'CHANGED_FUNCTION_SOURCE_REQUIRED',
        'CHANGED_FUNCTION_RESULT_REQUIRED',
        'CHANGED_FUNCTION_ONCE_REQUIRED',
        'CHANGED_FUNCTION_OWNED_TARGET_REQUIRED',
        'CHANGED_FUNCTION_BEHAVIOR_REQUIRED',
        'CHANGED_FUNCTION_PRESERVATION_REQUIRED',
        'NATIVE_APPLICATION_TYPEGEN_PREREQUISITES_REQUIRED',
        'NATIVE_APPLICATION_TYPEGEN_WITNESS_REQUIRED',
        'NATIVE_APPLICATION_TYPEGEN_OUTPUT_REQUIRED',
        'NATIVE_APPLICATION_TYPEGEN_ENCODING_REQUIRED',
        'NATIVE_APPLICATION_TYPEGEN_OVERRIDE_SOURCE_REQUIRED',
        'NATIVE_APPLICATION_TYPEGEN_OVERRIDE_REQUIRED',
        'NATIVE_APPLICATION_TYPEGEN_ONCE_REQUIRED',
        'NATIVE_APPLICATION_TYPEGEN_COMMAND_REQUIRED',
        'NATIVE_APPLICATION_TYPEGEN_STATE_PRESERVATION_REQUIRED',
        'NATIVE_APPLICATION_TYPEGEN_REPEAT_REQUIRED',
        'NATIVE_APPLICATION_TYPEGEN_EXPORT_BINDING_REQUIRED',
    })
    lifecycle_codes.update({
        'LIVE_SYNC_NATIVE_LEDGER_REQUIRED', 'LIVE_SYNC_NATIVE_TARGET_REQUIRED',
        'NATIVE_TIMESTAMP_BOUND_UNIT_REQUIRED', 'NATIVE_TIMESTAMP_BYTES_REQUIRED',
        'NATIVE_TIMESTAMP_CLI_POSTIMAGE_EQUIVALENCE_REQUIRED', 'NATIVE_TIMESTAMP_CLONE_OWNERSHIP',
        'NATIVE_CLONE_QUIESCE_OWNER_REQUIRED',
        'NATIVE_CLONE_QUIESCE_OPERATION_REQUIRED',
        'NATIVE_CLONE_QUIESCE_SOURCE_REQUIRED',
        'NATIVE_CLONE_QUIESCE_RESPONSE_REQUIRED',
        'NATIVE_CLONE_QUIESCE_INSPECT_REQUIRED',
        'NATIVE_CLONE_QUIESCE_PAUSE_REQUIRED',
        'NATIVE_CLONE_QUIESCE_DRAIN_REQUIRED',
        'NATIVE_CLONE_QUIESCE_RESTORE_REQUIRED',
        'NATIVE_CLONE_QUIESCE_PRESERVATION_REQUIRED',
        'NATIVE_TIMESTAMP_CLONE_CREATE_SOURCE_DATABASE_IN_USE',
        'NATIVE_TIMESTAMP_CLONE_CREATE_COPY_OWNER_DENIED',
        'NATIVE_TIMESTAMP_CLONE_CREATE_CREATE_PERMISSION_DENIED',
        'NATIVE_TIMESTAMP_CLONE_CREATE_OTHER', 'NATIVE_TIMESTAMP_CLONE_DROP_OTHER',
        'NATIVE_TIMESTAMP_CLONE_REQUIRED', 'NATIVE_TIMESTAMP_COMPLETION_REQUIRED',
        'NATIVE_TIMESTAMP_CONTAINER_REQUIRED', 'NATIVE_TIMESTAMP_DATABASE_REQUIRED',
        'NATIVE_TIMESTAMP_DOCKER_COMMAND_REQUIRED', 'NATIVE_TIMESTAMP_EARLIER_LEDGER_CHANGED',
        'NATIVE_TIMESTAMP_FAILED_UNIT_ROLLBACK_REQUIRED', 'NATIVE_TIMESTAMP_FAILURE_PROOF_REQUIRED',
        'NATIVE_TIMESTAMP_FOUNDATION_REQUIRED', 'NATIVE_TIMESTAMP_GUARD_CLEANUP_REQUIRED',
        'NATIVE_TIMESTAMP_INTERIOR_TRANSACTION_REQUIRED', 'NATIVE_TIMESTAMP_LEDGER_PROOF_REQUIRED',
        'NATIVE_TIMESTAMP_LEDGER_REQUIRED', 'NATIVE_TIMESTAMP_LOCK_BYTES_REQUIRED',
        'NATIVE_TIMESTAMP_LOCK_REQUIRED', 'NATIVE_TIMESTAMP_LOCK_SHAPE_REQUIRED',
        'NATIVE_TIMESTAMP_LOCK_SOURCE_REQUIRED', 'NATIVE_TIMESTAMP_NETWORK_REQUIRED',
        'NATIVE_TIMESTAMP_OWNER_REQUIRED', 'NATIVE_TIMESTAMP_POSTGIS_REQUIRED',
        'NATIVE_TIMESTAMP_PREEXISTING_CLONE', 'NATIVE_TIMESTAMP_PROGRAM_REQUIRED',
        'NATIVE_TIMESTAMP_RECONSTRUCTION_BYTES_REQUIRED', 'NATIVE_TIMESTAMP_REPEAT_REQUIRED',
        'NATIVE_TIMESTAMP_RESTORATION_SOURCE_REQUIRED', 'NATIVE_TIMESTAMP_RETAINED_BUNDLE_REQUIRED',
        'NATIVE_TIMESTAMP_RETAINED_PLAN_REQUIRED', 'NATIVE_TIMESTAMP_ROLLBACK_REQUIRED',
        'NATIVE_TIMESTAMP_SELECTION_REQUIRED', 'NATIVE_TIMESTAMP_SERVER_MUTATION_REJECTED',
        'NATIVE_TIMESTAMP_SETTINGS_REQUIRED', 'NATIVE_TIMESTAMP_SHIM_AUTHORITY_REQUIRED',
        'NATIVE_TIMESTAMP_SHIM_PROBE_REQUIRED', 'NATIVE_TIMESTAMP_SOURCE_EQUIVALENCE_REQUIRED',
        'NATIVE_TIMESTAMP_SOURCE_EXECUTION_REQUIRED', 'NATIVE_TIMESTAMP_SOURCE_ORDER_REQUIRED',
        'NATIVE_TIMESTAMP_SPLIT_BOUNDARY_REQUIRED', 'NATIVE_TIMESTAMP_SPLIT_BYTES_REQUIRED',
        'NATIVE_TIMESTAMP_SPLIT_SOURCE_REQUIRED', 'NATIVE_TIMESTAMP_SQL_ARGUMENT_REQUIRED',
        'NATIVE_TIMESTAMP_SQL_RESULT', 'NATIVE_TIMESTAMP_TRANSACTION_REQUIRED',
        'NATIVE_TIMESTAMP_TRANSACTION_TERMINATOR_REQUIRED', 'NATIVE_TIMESTAMP_UNIT_ACCOUNTING_REQUIRED',
        'NATIVE_TIMESTAMP_UTF8_REQUIRED', 'NATIVE_TIMESTAMP_CLONE_PREFLIGHT_REQUIRED',
        'NATIVE_FINAL_SQL_SOURCE_REQUIRED', 'NATIVE_FINAL_SQL_COMPLETE_PREFIX_REQUIRED',
        'NATIVE_FINAL_SQL_STATE_PRESERVATION_REQUIRED', 'NATIVE_FINAL_SQL_FORWARD_LEDGER_REQUIRED',
        'NATIVE_TYPEGEN_PREFLIGHT_COMMAND_REQUIRED', 'NATIVE_TYPEGEN_PREFLIGHT_OUTPUT_REQUIRED',
        'NATIVE_TYPEGEN_PREFLIGHT_PRESERVATION_REQUIRED', 'NATIVE_TYPEGEN_PREFLIGHT_REPEAT_REQUIRED',
        'NATIVE_LIVE_SYNC_PREFLIGHT_SOURCE_REQUIRED', 'NATIVE_LIVE_SYNC_PREFLIGHT_ACL_SOURCE_REQUIRED',
        'NATIVE_LIVE_SYNC_PREFLIGHT_LEDGER_REQUIRED', 'NATIVE_LIVE_SYNC_PREFLIGHT_ONCE_REQUIRED',
        'NATIVE_LIVE_SYNC_PREFLIGHT_PRESERVATION_REQUIRED', 'NATIVE_LIVE_SYNC_PREFLIGHT_CLONE_DISPOSAL_REQUIRED',
        'NATIVE_SCHEMA_FINAL_SQL_REQUIRED', 'NATIVE_SCHEMA_STATE_PRESERVATION_REQUIRED',
        'NATIVE_CLEANUP_DEPENDENCIES_REQUIRED',
        'NATIVE_CLEANUP_EXACT_REMOVAL_REQUIRED',
        'NATIVE_CLEANUP_EXACT_STATE_REQUIRED',
        'NATIVE_CLEANUP_FAILURE_CONTROL_REQUIRED',
        'NATIVE_CLEANUP_FINAL_SQL_REQUIRED',
        'NATIVE_CLEANUP_GUARD_DISPOSAL_REQUIRED',
        'NATIVE_CLEANUP_GUARD_REQUIRED',
        'NATIVE_CLEANUP_LEDGER_BYTES_REQUIRED',
        'NATIVE_CLEANUP_POLICY_SOURCE_REQUIRED',
        'NATIVE_CLEANUP_RECEIPT_REQUIRED',
        'NATIVE_CLEANUP_ROLLBACK_REQUIRED',
        'NATIVE_CLEANUP_SOURCE_REQUIRED',
        'NATIVE_CLEANUP_UNRECOGNIZED_OBJECT_REQUIRED',
        'POLICY_ACTOR_COMPLETE_REPLAY_REQUIRED', 'POLICY_ACTOR_OWNED_TARGET_REQUIRED',
        'POLICY_ACTOR_RESULT_REQUIRED', 'POLICY_ACTOR_RETAINED_PREDICATES_REQUIRED',
        'POLICY_ACTOR_ROLLBACK_REQUIRED', 'POLICY_ACTOR_SOURCE_REQUIRED',
    })
    historical_codes = {
        'NATIVE_ALIGNMENT68_FINAL_REQUIRED',
        'NATIVE_ALIGNMENT68_ORACLE_ROLLBACK_REQUIRED',
        'NATIVE_ALIGNMENT68_PREFIX_REQUIRED',
        'NATIVE_ALIGNMENT68_PROOF_REQUIRED',
        'NATIVE_ALIGNMENT68_PROVIDER_REQUIRED',
        'NATIVE_ALIGNMENT68_ROLLBACK_REQUIRED',
        'NATIVE_ALIGNMENT68_SOURCE_ORACLE_REQUIRED',
        'NATIVE_TAIL_SOURCE_REQUIRED',
        'NATIVE_TAIL_PROFILE_REQUIRED',
        'NATIVE_TAIL_PREFIX_REQUIRED',
        'NATIVE_TAIL_PREIMAGE_CHANGED',
        'NATIVE_TAIL_PROOF_REQUIRED',
        'NATIVE_TAIL_ROLLBACK_REQUIRED',
        'NATIVE_TAIL_ORACLE_ROLLBACK_REQUIRED',
        'NATIVE_TAIL_FINAL_REQUIRED',
        'NATIVE_TAIL_SOURCE_ORACLE_REQUIRED',
        'NATIVE_ALIGNMENT68_SOURCE_REQUIRED',
        'NATIVE_ALIGNMENT68_SYSTEM_PROFILE_REQUIRED',
        'NATIVE_BOUND_PROGRAM_REQUIRED',
        'NATIVE_CLI_CREATED_FILE_REQUIRED',
        'NATIVE_DATA_DIRECTORY_REQUIRED',
        'NATIVE_EXACT_PREFIX_REQUIRED',
        'NATIVE_EXECUTED_LEDGER_REQUIRED',
        'NATIVE_EXECUTED_STATEMENTS_REQUIRED',
        'NATIVE_FAILED_LEDGER_CHANGED',
        'NATIVE_FRESH_PROGRESS_REQUIRED',
        'NATIVE_HISTORICAL_LEDGER_REPEAT_CHANGED',
        'NATIVE_HISTORICAL_SQL_FAILED',
        'NATIVE_INTERIOR_TRANSACTION_CONTROL_REJECTED',
        'NATIVE_LOGGING_ADMIN_REQUIRED',
        'NATIVE_LEGACY52_SOURCE_REQUIRED',
        'NATIVE_LEGACY52_PREFIX_REQUIRED',
        'NATIVE_LEGACY52_PROOF_REQUIRED',
        'NATIVE_LEGACY52_ROLLBACK_REQUIRED',
        'NATIVE_FIXED63_AUTH_DEFAULT_REQUIRED',
        'NATIVE_FIXED63_BRANCH_EFFECT_REQUIRED',
        'NATIVE_FIXED63_CONSTRUCTOR_REQUIRED',
        'NATIVE_FIXED63_CONTEXT_REQUIRED',
        'NATIVE_FIXED63_EMPTY_PREIMAGE_REQUIRED',
        'NATIVE_FIXED63_GRAPH_REQUIRED',
        'NATIVE_FIXED63_LEDGER_FAULT',
        'NATIVE_FIXED63_ORACLE_REQUIRED',
        'NATIVE_FIXED63_PREFIX_REQUIRED',
        'NATIVE_FIXED63_PREREQUISITES_REQUIRED',
        'NATIVE_FIXED63_PROOF_REQUIRED',
        'NATIVE_FIXED63_PROVIDER_DRIFT',
        'NATIVE_FIXED63_RESTORATION_REQUIRED',
        'NATIVE_FIXED63_ROLLBACK_REQUIRED',
        'NATIVE_FIXED63_SOURCE_REQUIRED',
        'NATIVE_DEDUPE57_COMMIT_BOUNDARY_REQUIRED',
        'NATIVE_DEDUPE57_EMPTY_PREIMAGE_REQUIRED',
        'NATIVE_DEDUPE57_FINAL_REQUIRED',
        'NATIVE_DEDUPE57_ORACLE_REQUIRED',
        'NATIVE_DEDUPE57_PREFIX_REQUIRED',
        'NATIVE_DEDUPE57_PROOF_REQUIRED',
        'NATIVE_DEDUPE57_SOURCE_REQUIRED',
        'NATIVE_REPAIR56_SOURCE_REQUIRED',
        'NATIVE_REPAIR56_PREFIX_REQUIRED',
        'NATIVE_REPAIR56_REFERENCE_REQUIRED',
        'NATIVE_REPAIR56_PROOF_REQUIRED',
        'NATIVE_REPAIR56_ROLLBACK_REQUIRED',
        'NATIVE_REPAIR56_ORACLE_ROLLBACK_REQUIRED',
        'NATIVE_LOCK_SOURCE_REQUIRED',
        'NATIVE_LOCK27_PROOF_REQUIRED',
        'NATIVE_LOCK27_ROLLBACK_REQUIRED',
        'NATIVE_OWNED_SERVER_REQUIRED',
        'NATIVE_OWNER_REQUIRED',
        'NATIVE_PREFIX_ORDER_REQUIRED',
        'NATIVE_PRIVATE_LOGGING_REQUIRED',
        'NATIVE_PRIVATE_SOURCE_CHANGED',
        'NATIVE_PRIVATE_SOURCE_REQUIRED',
        'NATIVE_PSQL_METACOMMAND_REJECTED',
        'NATIVE_RESTART_NOT_READY',
        'NATIVE_SERVER_MUTATION_REJECTED',
        'NATIVE_SOURCE_BYTES_REQUIRED',
        'NATIVE_SOURCE_PATH_REQUIRED',
        'NATIVE_SQL_INPUT_REQUIRED',
        'NATIVE_SYNTHETIC_PREFLIGHT_LEDGER_REQUIRED',
        'NATIVE_UNEXPECTED_LEDGER_DELTA',
        'NATIVE_UNEXPECTED_MIGRATION_INPUT',
        'NATIVE_UNTERMINATED_SQL_TOKEN',
        'NATIVE_UTF8_SOURCE_REQUIRED',
    }
    if type(error) is ValueError:
        allowed = lifecycle_codes
    elif historical is not None and type(error) is getattr(historical, 'PrefixError', None):
        allowed = historical_codes
    else:
        return None
    if len(error.args) == 1 and type(error.args[0]) is str and error.args[0] in allowed:
        return error.args[0]
    return None


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


def load_transport():
    path = Path(__file__).with_name('canonical_native_cli_transport.py')
    spec = importlib.util.spec_from_file_location('gridex_native_cli_transport', path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def load_bootstrap():
    path = Path(__file__).with_name('canonical_native_bootstrap_contract.py')
    spec = importlib.util.spec_from_file_location('native_bootstrap_contract', path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def load_historical_prefix():
    path = Path(__file__).with_name('canonical_native_historical_prefix.py')
    spec = importlib.util.spec_from_file_location('canonical_native_historical_prefix', path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(spec.name, None)
        raise
    return module


def run(*, historical_prefix=False, clone_preflight=False):
    if type(historical_prefix) is not bool or type(clone_preflight) is not bool or (historical_prefix and clone_preflight):
        raise ValueError('EXACT_NATIVE_SCOPE_REQUIRED')
    if len(sys.argv) != 1 or os.environ.get('GITHUB_ACTIONS') != 'true':
        raise ValueError('DEDICATED_NATIVE_CI_REQUIRED')
    run_id, attempt = os.environ.get('GITHUB_RUN_ID',''), os.environ.get('GITHUB_RUN_ATTEMPT','')
    project = project_name(run_id, attempt, secrets.token_hex(8))
    cli = shutil.which('supabase')
    if cli is None:
        raise ValueError('PINNED_NATIVE_CLI_REQUIRED')
    report = {'scope':('SELECTED_CHAIN_EXECUTION_NOT_FULL_REPLAY_ACCEPTANCE' if historical_prefix
                       else 'SYNTHETIC_NATIVE_LIFECYCLE_NOT_GRIDEX_REPLAY_ACCEPTANCE'),
              'cliVersion':VERSION,'outcome':'BLOCKED','historicalGridexSourcesExecuted':False,
              'completeReplayVerified':False,'generatedTypesVerified':False,'productionModified':False}
    historical = load_historical_prefix() if historical_prefix else None
    programs = historical.prepare() if historical_prefix else None
    # Reject any unsupported tail source before creating a database or applying
    # the foundation. Retain immutable bytes for every later execution unit.
    if historical_prefix:
        from canonical_native_timestamp_sources import prepare as prepare_timestamp
        timestamp_plan = prepare_timestamp()
        from canonical_forward_sources import retain as retain_forward
        from canonical_native_forward_runtime import programs as forward_programs
        forward_retained = retain_forward(ROOT)
        forward_programs(forward_retained)
        from canonical_added_view_witness import retain as retain_added_views
        view_retained = retain_added_views(ROOT)
        from canonical_changed_view_witness import retain as retain_changed_views
        changed_view_retained = retain_changed_views(ROOT)
        from canonical_changed_function_witness import retain as retain_changed_functions
        changed_function_retained = retain_changed_functions(ROOT)
        from canonical_changed_index_witness import retain as retain_changed_indexes
        changed_index_retained = retain_changed_indexes(ROOT)
        from canonical_removed_policy_qualification import retain as retain_removed_policies
        removed_policy_retained = retain_removed_policies(ROOT)
    transport = load_transport()
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
                report['commandSignals'] = command_signals(process.stdout, process.stderr)
                raise ValueError('NATIVE_COMMAND_FAILED')
            return process
        def native(*args, **kwargs):
            if created_network:
                return command(transport.cli_command(cli, work, project, args), **kwargs)
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
                text = config(project,5432,b.getsockname()[1],
                              (work/'supabase/config.toml').read_text())
            path = work/'supabase/config.toml'; path.write_text(text); path.chmod(0o600)
            migrations = work/'supabase/migrations'; migrations.mkdir(exist_ok=True)
            if list(migrations.iterdir()) or (work/'supabase/.temp/project-ref').exists():
                raise ValueError('EMPTY_UNLINKED_NATIVE_PROJECT_REQUIRED')
            command(['docker','network','create','--internal','--label','gridex.native.owner='+project,network])
            created_network = True
            phase = 'NATIVE_DATABASE_START'; attempted_start = True
            native('--network-id',network,'db','start',timeout=600)
            inspected = check_container(json.loads(command(['docker','inspect','supabase_db_'+project]).stdout),project,network)
            report.update(image=inspected['Config']['Image'], imageId=inspected['Image'],
                          cliConnectsInsideInternalNetwork=True)
            report['nativeBootstrap'] = sql(METADATA)
            if historical_prefix:
                report['providerEventBootstrap']=provider_events.bootstrap(sql,report['imageId'],report['nativeBootstrap'])
            if (not report['nativeBootstrap']['serverVersion'].startswith('17.')
                    or report['nativeBootstrap']['currentRole'] != 'postgres'):
                raise ValueError('NATIVE_POSTGRES_ROLE_REQUIRED')
            phase = 'PORTABLE_BOOTSTRAP_AUTHORIZATION'
            report['portableBootstrapAuthorization'] = load_bootstrap().verify(command, project)
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
            if clone_preflight:
                phase = 'SYNTHETIC_NATIVE_CLONE_PREFLIGHT'
                spec = importlib.util.spec_from_file_location('native_clone_control',
                    Path(__file__).with_name('canonical-native-clone-preflight.py'))
                clone_module = importlib.util.module_from_spec(spec); spec.loader.exec_module(clone_module)
                report['nativeClonePreflight'] = clone_module.qualify(command, sql, project)
                phase = 'SYNTHETIC_NATIVE_TYPEGEN_PREFLIGHT'
                from canonical_native_typegen_preflight import qualify as qualify_typegen
                report['nativeTypegenPreflight'] = qualify_typegen(command, native, sql, project)
                phase = 'SYNTHETIC_NATIVE_SESSION_BEHAVIOR_PREFLIGHT'
                from canonical_native_live_sync_preflight import verify as qualify_live_sync
                qualify_live_sync(command, project, report)
            if historical_prefix:
                phase = 'HISTORICAL_FIRST43_NATIVE_LEDGER'
                # The failed synthetic file must not be retried ahead of the
                # real prefix. Never alter the successful CLI ledger row.
                added[0].unlink()
                report['historicalPrefix'] = {}
                historical.execute(command, native, sql, work, project, programs,
                                   report['historicalPrefix'])
                report['historicalGridexSourcesExecuted'] = True
                phase = 'HISTORICAL_LEGACY44_52_NATIVE_LEDGER'
                from canonical_native_legacy_envelope import execute as execute_legacy52
                report['historicalLegacy52'] = {}
                execute_legacy52(historical, native, sql, work,
                                 report['historicalPrefix'], report['historicalLegacy52'])
                report['foundationInputsExecuted'] = 52
                phase = 'HISTORICAL_REPAIR53_56_NATIVE_LEDGER'
                from canonical_native_repair_envelope import execute as execute_repair56
                report['historicalRepair56'] = {}
                execute_repair56(historical, native, sql, work, report['historicalPrefix'],
                                 report['historicalLegacy52'], report['historicalRepair56'],
                                 provider_bootstrap=report['providerEventBootstrap'])
                report['foundationInputsExecuted'] = 56
                phase = 'HISTORICAL_DEDUPE57_NATIVE_LEDGER'
                from canonical_native_dedupe57 import execute as execute_dedupe57
                report['historicalDedupe57'] = {}
                execute_dedupe57(historical, native, sql, work, report['historicalPrefix'],
                                 report['historicalLegacy52'], report['historicalRepair56'],
                                 report['historicalDedupe57'], provider_bootstrap=report['providerEventBootstrap'])
                report['foundationInputsExecuted'] = 57
                phase = 'HISTORICAL_FIXED58_63_NATIVE_LEDGER'
                from canonical_native_fixed63 import execute as execute_fixed63
                report['historicalFixed63'] = {}
                execute_fixed63(historical, native, sql, work, report['historicalPrefix'],
                                report['historicalLegacy52'], report['historicalRepair56'],
                                report['historicalDedupe57'], report['historicalFixed63'],
                                provider_bootstrap=report['providerEventBootstrap'])
                report['foundationInputsExecuted'] = 63
                phase = 'HISTORICAL_ALIGNMENT64_68_NATIVE_LEDGER'
                from canonical_native_alignment68 import execute as execute_alignment68
                report['historicalAlignment68'] = {}
                execute_alignment68(historical, native, sql, work, report['historicalPrefix'],
                                    report['historicalLegacy52'], report['historicalRepair56'],
                                    report['historicalDedupe57'], report['historicalFixed63'],
                                    report['historicalAlignment68'], provider_bootstrap=report['providerEventBootstrap'])
                report['foundationInputsExecuted'] = 68
                phase = 'HISTORICAL_OPERATIONS69_77_NATIVE_LEDGER'
                from canonical_native_operations77 import execute as execute_operations77
                execute_operations77(historical, native, sql, work, report)
                phase = 'HISTORICAL_FOUNDATION78_144_NATIVE_LEDGER'
                from canonical_native_foundation144 import execute as execute_foundation144
                execute_foundation144(historical, native, sql, work, report)
                phase = 'HISTORICAL_TIMESTAMP_NATIVE_LEDGER'
                from canonical_native_timestamp_runtime import execute as execute_timestamp
                execute_timestamp(command, native, sql, work, project, report, timestamp_plan, forward_retained,
                                  view_retained, removed_policy_retained, changed_view_retained, changed_function_retained, changed_index_retained)
            success = True
        except Exception as error:
            report.update(outcome='BLOCKED',phase=phase,errorType=type(error).__name__)
            code = failure_code(error, historical)
            if code is not None:
                report['errorCode'] = code
            report['lastCommandIndex'] = counter
        finally:
            if historical_prefix:
                report['historicalGridexSourcesExecuted'] = bool(
                    report.get('historicalPrefix', {}).get('historicalGridexSourcesExecuted'))
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
    report['historicalPrivateInputsDisposed'] = bool(historical_prefix and not work.exists()
                                                  and report.get('cleanupVerified'))
    success = success and report['privateWorkspaceRemoved']
    if success:
        report['outcome'] = ('NATIVE_SELECTED_CHAIN_EXECUTED_NOT_FULL_ACCEPTANCE' if historical_prefix
                             else 'NATIVE_LIFECYCLE_VERIFIED')
    output = ROOT/'artifacts'; output.mkdir(exist_ok=True)
    from canonical_native_application_typegen import publish as publish_application_candidate
    publish_application_candidate(report, output, success=success)
    publish_schema_comparison(report, output)
    (output/'native-supabase-lifecycle.json').write_text(json.dumps(report,sort_keys=True,indent=2)+'\n')
    print(json.dumps(report,sort_keys=True),flush=True)
    return 0 if success else 1



def publish_schema_comparison(report, output):
    comparison = report.pop('_nativeSchemaComparison', None)
    if comparison is None:
        return
    if report.get('cleanupVerified') is not True or report.get('privateWorkspaceRemoved') is not True:
        report['nativeSchemaReferenceComparison'] = dict(
            available=False, reason='NATIVE_DISPOSAL_REQUIRED', schemaAccepted=False)
        return
    comparison.update(cleanupVerified=True, privateWorkspaceRemoved=True)
    (output/'native-full-schema-reference-diff.json').write_text(json.dumps(comparison,sort_keys=True,indent=2)+'\n')
    report['nativeSchemaReferenceComparison'] = {key:value for key,value in comparison.items() if key != 'sections'}
    report['nativeSchemaReferenceComparison']['counts'] = {
        section: {kind:len(values[kind]) for kind in ('added','removed','changed')}
        for section,values in comparison['sections'].items()}


def run_guarded(*, historical_prefix=False, clone_preflight=False):
    """Keep cleanup signal handling when invoked by the ordinary replay entry."""
    def interrupted(*_):
        raise ValueError('NATIVE_INTERRUPTED')
    previous = {s:signal.getsignal(s) for s in (signal.SIGINT,signal.SIGTERM)}
    try:
        for signum in previous:
            signal.signal(signum,interrupted)
        if clone_preflight:
            return run(historical_prefix=historical_prefix, clone_preflight=clone_preflight)
        return run(historical_prefix=historical_prefix)
    finally:
        for signum,handler in previous.items():
            signal.signal(signum,handler)


if __name__ == '__main__':
    try:
        raise SystemExit(run_guarded())
    except Exception:
        print('FAIL native lifecycle; no raw output or hosted target permitted',file=sys.stderr)
        raise SystemExit(1) from None
