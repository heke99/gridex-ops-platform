#!/usr/bin/env python3
"""Diagnostic-only continuation of the existing selected migration chain.

No external target, ledger, schema baseline, types or acceptance override. The
caller owns the isolated PG17 target and keeps AcceptedInputs active throughout.
The pinned shell remains authoritative for selection and prerequisite ordering.
"""
from __future__ import annotations

import hashlib
import importlib.util
from pathlib import Path
import re
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
SHELL_SHA256 = '37e3f54b3c9d8361d99719995bd6418b52a1b7b175f3e8b5d41ab90072384323'
BOUNDARIES = {
    '20260824140830': 'bootstrap/20260824_powers_of_attorney_legal_bundle_version_document_prerequisite.sql',
    '20260902093000': 'bootstrap/20260902_inbound_email_dedupe_replay_prerequisite.sql',
    '20260902096000': 'bootstrap/20260902_inbound_ediel_pipeline_replay_prerequisite.sql',
    '20260902100000': 'bootstrap/20260902_grid_owner_name_key_replay_prerequisite.sql',
    '20260902100500': 'bootstrap/20260902_white_label_admin_membership_hygiene_replay_shim.sql',
}
WHITE_LABEL_PREFIX = '20260902100500'
WHITE_LABEL_PROBE = "select case when to_regclass('public.white_label_platform_memberships') is null and to_regprocedure('public.gridex_user_has_white_label_admin_membership(uuid)') is null then 'yes' else 'no' end"
WHITE_LABEL_DROP = 'drop function if exists public.gridex_user_has_white_label_admin_membership(uuid);'


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def verify_spatial_runtime(target):
    """Read back the real owned image/PG17/PostGIS capability before source SQL."""
    if not target.active or target.name != target._created_name:
        raise ValueError('SPATIAL_RUNTIME_REQUIRED')
    fmt = '{{.Config.Image}}|{{.Image}}|{{.HostConfig.NetworkMode}}|{{index .Config.Labels "gridex.auth-legacy.owner"}}'
    parts = target.docker(['inspect', '--format', fmt, target.name]).decode().strip().split('|')
    if (len(parts) != 4 or parts[0] != 'postgis/postgis:17-3.5'
            or not re.fullmatch(r'sha256:[0-9a-f]{64}', parts[1])
            or parts[2] != 'none' or parts[3] != target.name):
        raise ValueError('SPATIAL_RUNTIME_REQUIRED')
    query = "SELECT current_setting('server_version_num'), default_version FROM pg_available_extensions WHERE name = 'postgis';"
    capability = target.docker(['exec', target.name, 'psql', '-X', '-U', 'postgres', '-d', 'postgres',
                                '-At', '-v', 'ON_ERROR_STOP=1', '-c', query]).decode().strip()
    if not re.fullmatch(r'17[0-9]{4}\|3\.5\.[0-9]+', capability):
        raise ValueError('SPATIAL_RUNTIME_REQUIRED')
    version, postgis = capability.split('|')
    return {'image': parts[0], 'imageId': parts[1],
            'serverVersionNum': int(version), 'postgisVersion': postgis}


def read_source(root, source):
    """Require canonical non-symlink source paths and exact admitted bytes."""
    relative, expected = source
    if not re.fullmatch(r'(migrations|bootstrap)/[A-Za-z0-9_.-]+\.sql', relative):
        raise ValueError('UNSAFE_SOURCE_PATH')
    base = root / 'supabase'
    path = base / relative
    if (base.is_symlink() or path.parent.is_symlink() or path.is_symlink()
            or not path.resolve().is_relative_to(base.resolve()) or not path.is_file()):
        raise ValueError('UNSAFE_SOURCE_PATH')
    data = path.read_bytes()
    if sha256(data) != expected:
        raise ValueError('SOURCE_HASH_MISMATCH')
    return data.decode('utf-8')


def validate_boundaries(selected, prerequisites):
    if set(prerequisites) != set(BOUNDARIES):
        raise ValueError('TIMESTAMP_BOUNDARY_CHANGED')
    for prefix, relative in BOUNDARIES.items():
        if (prerequisites[prefix][0] != relative or
                sum(Path(source[0]).name.startswith(prefix + '_') for source in selected) != 1):
            raise ValueError('TIMESTAMP_BOUNDARY_CHANGED')


def load_inputs(root, report, foundation):
    """Execute the unmodified selector, never the replay shell itself."""
    scripts, supabase = root / 'scripts', root / 'supabase'
    shell = scripts / 'gridex-aud-003-clean-replay.sh'
    if report['selector']['sha256'] != SHELL_SHA256 or sha256(shell.read_bytes()) != SHELL_SHA256:
        raise ValueError('REPLAY_SHELL_CHANGED')
    spec = importlib.util.spec_from_file_location('timestamp_input_accounting', scripts / 'gridex-replay-input-accounting.py')
    accounting = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(accounting)
    text = shell.read_text()
    if text.count(accounting.SELECTOR_HEADER) != 1:
        raise ValueError('REPLAY_SELECTOR_CHANGED')
    selector = text.split(accounting.SELECTOR_HEADER, 1)[1].split('\nPY\n', 1)[0]
    if sha256(selector.encode()) != report['selector']['pythonSha256']:
        raise ValueError('REPLAY_SELECTOR_CHANGED')
    with tempfile.TemporaryDirectory(prefix='gridex-timestamp-selection-') as directory:
        first, last = Path(directory) / 'foundation', Path(directory) / 'timestamp'
        paths = [*(scripts / name for name in accounting.HISTORY),
                 *(scripts / name for name in accounting.PLANS),
                 scripts / (accounting.PREFIX + 'foundation-order.json'),
                 scripts / (accounting.PREFIX + 'noncanonical-artifacts.json'),
                 supabase, supabase / 'migrations', first, last]
        result = subprocess.run([sys.executable, '-', *map(str, paths)], input=selector,
                                capture_output=True, text=True, timeout=60)
        if result.returncode:
            # The selector error may contain source metadata: never echo it.
            raise ValueError('REPLAY_SELECTOR_REJECTED')
        first_paths = [Path(path).relative_to(supabase).as_posix() for path in first.read_text().splitlines()]
        last_paths = [Path(path).relative_to(supabase).as_posix() for path in last.read_text().splitlines()]
    if first_paths != foundation:
        raise ValueError('FOUNDATION_SELECTION_CHANGED')
    if (len(last_paths) != 508 or report['selectedInputCounts']['timestamp'] != 508
            or len(set(first_paths + last_paths)) != len(first_paths) + len(last_paths)):
        raise ValueError('TIMESTAMP_SELECTION_CHANGED')
    # The actual selector verifies migration and derived-artifact manifest pins.
    # Retain those selected bytes as digests, then revalidate before each effect.
    migration_pins = {entry['path']: entry['sha256'] for entry in report['migrations']}
    derived = {path: metadata for name in accounting.PLANS
               for path, metadata in accounting.read_json(scripts / name).get('derivedBootstrap', {}).items()}
    selected = [(path, migration_pins[path] if path.startswith('migrations/')
                 else derived[path]['artifactSha256']) for path in last_paths]
    by_path = {entry['path']: entry['sha256'] for entry in report['supplementalPrerequisites']}
    if set(by_path) != set(BOUNDARIES.values()):
        raise ValueError('TIMESTAMP_BOUNDARY_CHANGED')
    prerequisites = {prefix: (path, by_path[path]) for prefix, path in BOUNDARIES.items()}
    for source in selected + list(prerequisites.values()):
        read_source(root, source)
    validate_boundaries(selected, prerequisites)
    return selected, prerequisites


def execute_tail(root, target, database, selected, prerequisites, progress):
    """Stop at the first failure; preserve whole-file transaction semantics."""
    validate_boundaries(selected, prerequisites)
    progress['timestampApplied'] = 0

    def apply(source, stage):
        progress['source'] = source[0]
        progress['sourceSha256'] = source[1]
        # Only safe stage labels go to the existing private SQL runner. No SQL
        # output, exception text, rows or credentials are copied into progress.
        sql = read_source(root, source)
        if source[0] == 'migrations/20260728170000_live_schema_code_canonical_sync.sql':
            # A source-bound reconstruction with its native RED/GREEN/rollback
            # proof. This never changes the selected file or acceptance ledger.
            spec = importlib.util.spec_from_file_location('live_sync_boundary', root / 'scripts/canonical-live-sync-proof.py')
            proof = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(proof)
            proof.execute_boundary(root, target, database, sql, progress)
        else:
            target.sql(database, sql, stage, transaction=False)

    reached = set()
    for ordinal, source in enumerate(selected, 1):
        progress['timestampOrdinal'] = ordinal
        prefix = Path(source[0]).name.split('_', 1)[0]
        made_shim = False
        if prefix in BOUNDARIES:
            reached.add(prefix)
            progress['phase'] = 'TIMESTAMP_PREREQUISITE'
            if prefix == WHITE_LABEL_PREFIX:
                progress['source'] = source[0]
                progress['sourceSha256'] = source[1]
                progress['phase'] = 'WHITE_LABEL_PROBE'
                answer = target.sql(database, WHITE_LABEL_PROBE,
                                    'timestamp_white_label_probe', transaction=False).strip()
                if answer not in ('yes', 'no'):
                    raise ValueError('UNEXPECTED_SHIM_PROBE_RESULT')
                made_shim = answer == 'yes'
            if prefix != WHITE_LABEL_PREFIX or made_shim:
                apply(prerequisites[prefix], 'timestamp_prerequisite_' + str(list(BOUNDARIES).index(prefix) + 1))
        progress['phase'] = 'TIMESTAMP_SOURCE'
        apply(source, 'timestamp_' + str(ordinal))
        if made_shim:
            progress['phase'] = 'WHITE_LABEL_CLEANUP'
            target.sql(database, WHITE_LABEL_DROP, 'timestamp_white_label_cleanup', transaction=False)
        progress['timestampApplied'] = ordinal
    if reached != set(BOUNDARIES):
        raise ValueError('TIMESTAMP_BOUNDARY_CHANGED')
    progress['phase'] = 'SELECTED_CHAIN_EXECUTED_NOT_CERTIFIED'
