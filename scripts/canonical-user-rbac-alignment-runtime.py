"""Owned staged P/A/B/C/W continuation; no selftest or fixture authority.

Preparation binds an independently constructed extended actual63 reference.
Execution consumes the linked fixed completion once, on the original replay
database. Only successful original-child release can publish actual68.
"""
from collections import Counter
from dataclasses import dataclass, replace
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import select
import subprocess
import sys
import uuid
import weakref

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('alignment_runtime_loader', ROOT/'scripts/canonical-auth-provisioning-replay.py')
loader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(loader)
replay = loader.controller()
batch, fixed, dedupe = replay.load_alignment(), replay.load_fixed(), replay.load_dedupe()
legacy, repair = replay.load_batch(), replay.load_repair()
DATABASE = replay.DATABASE
HELPER = 'gridex_auth_legacy_helper'
ORACLE = 'gridex_auth_legacy_native'
_REFERENCES = weakref.WeakKeyDictionary()
_RUNS = weakref.WeakKeyDictionary()
_RELEASES = weakref.WeakKeyDictionary()


def reviewed_paths():
    return batch.reviewed_paths()


def check(value, label='ALIGNMENT_CONTINUATION_REJECTED'):
    batch.check(value, label)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def rows_equal(left, right):
    return Counter(encoded(row) for row in left) == Counter(encoded(row) for row in right)


def expected_receipt(raw):
    lines = raw.splitlines()
    check(lines.count('ALIGNMENT_COMPLETE') == lines.count('ALIGNMENT_EXPECTED_ROWS') == 1,
          'ALIGNMENT_COMPLETION_RECEIPT_REQUIRED')
    position = lines.index('ALIGNMENT_EXPECTED_ROWS')
    check(position == len(lines)-2 and lines.index('ALIGNMENT_COMPLETE') < position,
          'ALIGNMENT_COMPLETION_RECEIPT_REQUIRED')
    try:
        rows = json.loads(lines[-1])
    except (ValueError, TypeError):
        raise batch.BoundaryError('ALIGNMENT_COMPLETION_RECEIPT_REQUIRED') from None
    check(type(rows) is list and all(type(row) is list and len(row) == 2
          and type(row[0]) is str and type(row[1]) is dict for row in rows),
          'ALIGNMENT_COMPLETION_RECEIPT_REQUIRED')
    return rows


@dataclass(frozen=True, repr=False)
class Reference:
    name: str
    directory: str
    fixed: object
    inputs: object
    sources: tuple
    prefix: tuple
    baseline: bytes
    bounds: tuple


@dataclass(frozen=True, repr=False)
class Release:
    reference: object
    fixed_completion: object
    staging: object
    before: bytes
    after: bytes
    token: str
    files: tuple = ()
    prelude: bytes = b''


def base_owned(target):
    ref = fixed.owned(target)
    check(ref.dedupe.scope in ('alignment68', 'operations71', 'full'), 'ALIGNMENT_CONTINUATION_SCOPE_REQUIRED')
    ref.inputs.owned()
    check(replay.load_private()._ACTIVE.get(target) is ref.inputs,
          'ALIGNMENT_LIVE_INPUT_OWNER_REQUIRED')
    return ref


def owned(target, state=None):
    predecessor = base_owned(target)
    ref = _REFERENCES.get(target)
    check(type(ref) is Reference and ref.fixed is predecessor and ref.inputs is predecessor.inputs
          and ref.name == target.name and ref.directory == target.directory.name,
          'ALIGNMENT_REFERENCE_REQUIRED')
    if state is not None:
        check(dedupe._STATES.get(target) == state, 'ALIGNMENT_CONTINUATION_STATE_REQUIRED')
    return ref


def run_private(target, database, sql, files=()):
    """Memory-only controls/results; physical inputs are exact owned whole files."""
    base_owned(target)
    check(database in (DATABASE, HELPER, ORACLE), 'ALIGNMENT_PRIVATE_DATABASE_REQUIRED')
    target.verify_logging()
    if files:
        check_program(target, sql, files)
    command = target.command(database, transaction=True) + ['-f', '-']
    for path in files:
        check(type(path) is type(ROOT) and path.parent == Path(target.directory.name)
              and path.is_file() and not path.is_symlink() and path.resolve() == path
              and path.stat().st_uid == os.getuid(), 'ALIGNMENT_PRIVATE_INPUT_REQUIRED')
        command += ['-f', '/legacy-private/' + path.name]
    process = None
    payload = bytearray(sql.encode())
    try:
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, env=legacy.clean_environment())
        target.processes.append(process)
        process.stdin.write(b"SET TRANSACTION ISOLATION LEVEL READ COMMITTED; SET log_min_messages=panic; SET client_min_messages=error; SELECT 'ALIGNMENT_PRIVATE_READY' WHERE current_setting('log_min_messages')='panic' AND current_setting('client_min_messages')='error' AND current_setting('log_min_error_statement')='panic' AND current_setting('log_parameter_max_length_on_error')='0';\n")
        process.stdin.flush()
        ready, _, _ = select.select([process.stdout], [], [], 10)
        check(bool(ready) and process.stdout.readline() == b'ALIGNMENT_PRIVATE_READY\n', 'PRIVATE_SESSION_REQUIRED')
        stdout, stderr = process.communicate(bytes(payload), timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        raise batch.BoundaryError('ALIGNMENT_PRIVATE_PROCESS_FAILED') from None
    finally:
        payload.clear()
        if process is not None and process.poll() is None:
            process.kill(); process.communicate()
    if files:
        check_program(target, sql, files)
    state = legacy.safe_receipt(stderr.decode(errors='replace'), process.returncode, 'alignment')['sqlstate']
    if process.returncode != 0 or state != '00000':
        allowed = ('42P01','42703','42804','P0002','P0004','55000','2BP01','23505','57014','22012','57P01')
        raise batch.BoundaryError('ALIGNMENT_QUERY_' + (state if state in allowed else 'OTHER'))
    return stdout.decode()


def check_program(target, sql, files):
    owned(target, 'ALIGNMENT_NATIVE')
    run = _RUNS.get(target)
    check(type(run) is Release and target not in _RELEASES and run.prelude == sql.encode()
          and tuple(files) == tuple(path for path, _ in run.files) and bool(run.files),
          'ALIGNMENT_PROGRAM_BINDING_REQUIRED')
    for path, data in run.files:
        check(type(path) is type(ROOT) and path.parent == Path(target.directory.name)
              and path.is_file() and not path.is_symlink() and path.resolve() == path
              and path.stat().st_uid == os.getuid() and path.read_bytes() == data,
              'ALIGNMENT_CONSUMED_SOURCE_CHANGED')


def snapshot(target, database=DATABASE):
    sql = "SELECT 'ALIGNMENT_CATALOG';\n" + batch.catalog.sql(repair)
    sql += "\nSELECT 'ALIGNMENT_ROWS';\n" + batch.rows_sql()
    sql += "\nSELECT coalesce(jsonb_agg(jsonb_build_array(name,value) ORDER BY name,value),'[]') FROM alignment_rows; DROP TABLE alignment_rows;"
    lines = run_private(target, database, sql).splitlines()
    check(lines.count('ALIGNMENT_CATALOG') == lines.count('ALIGNMENT_ROWS') == 1,
          'ALIGNMENT_SNAPSHOT_REQUIRED')
    return (json.loads(lines[lines.index('ALIGNMENT_CATALOG')+1]),
            json.loads(lines[lines.index('ALIGNMENT_ROWS')+1]))


def prepare_reference(target, lower):
    predecessor = base_owned(target)
    frame = sys._getframe(1)
    check(frame.f_code is dedupe.prepare_reference.__code__ and frame.f_locals.get('target') is target
          and frame.f_locals.get('started') is lower and target not in dedupe._STATES
          and target not in _REFERENCES, 'ALIGNMENT_INDEPENDENT_PREPARATION_REQUIRED')
    sources = batch.validate_sources(reviewed_paths())
    prefix = tuple(legacy.verified_prefix())
    # Same two source-only declarations as the accepted independent proof.
    run_private(target, HELPER, 'ALTER TABLE public.companies ADD COLUMN industry text NOT NULL DEFAULT \'electricity_supplier\'; ALTER TABLE public.company_memberships ADD COLUMN suspended_at timestamptz;')
    baseline = snapshot(target, HELPER)
    upper = datetime.now(timezone.utc)
    check(type(lower) is datetime and lower.utcoffset() is not None and lower < upper,
          'ALIGNMENT_REFERENCE_BOUNDS_REQUIRED')
    _REFERENCES[target] = Reference(target.name, target.directory.name, predecessor,
        predecessor.inputs, sources, prefix, encoded(baseline), (lower, upper))


def identity(target, database):
    output = run_private(target, database, "SELECT current_database(),current_user,inet_server_addr() IS NULL,inet_server_port() IS NULL,(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database());")
    check(output.strip() == database+'|postgres|t|t|postgres', 'ALIGNMENT_LOCAL_OWNER_REQUIRED')


def independent_final(target, before, staging):
    owned(target, 'ALIGNMENT_NATIVE')
    check(run_private(target, DATABASE, 'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='+batch.literal(ORACLE)+');').strip() == 'f',
          'ALIGNMENT_FRESH_ORACLE_REQUIRED')
    created = False
    try:
        target.docker(['exec', target.name, 'createdb', '-U', 'postgres', '-T', DATABASE, ORACLE])
        created = True
        identity(target, ORACLE)
        check(encoded(snapshot(target, ORACLE)) == encoded(before), 'ALIGNMENT_ORACLE_CLONE_REQUIRED')
        run_private(target, ORACLE, batch.expected_ddl(_REFERENCES[target].sources, before[0], staging))
        return snapshot(target, ORACLE)[0]
    finally:
        if created:
            owned(target, 'ALIGNMENT_NATIVE')
            target.docker(['exec', target.name, 'dropdb', '-U', 'postgres', '--force', ORACLE])


def execute(target, database, paths, staging, actual_bounds):
    ref = owned(target, 'ALIGNMENT_NATIVE')
    frame = sys._getframe(1)
    check(frame.f_code is dedupe.continue_alignment.__code__ and frame.f_locals.get('target') is target,
          'ALIGNMENT_CONTROLLER_CALL_REQUIRED')
    check(database == DATABASE and type(staging) is legacy.StagedSources
          and ref.inputs.staging is staging and target not in _RUNS,
          'ALIGNMENT_ONCE_STAGED_EXECUTION_REQUIRED')
    sources = batch.validate_sources(paths, staging)
    check(sources == ref.sources, 'ALIGNMENT_FROZEN_SOURCES_REQUIRED')
    fixed.assert_final(target)
    predecessor = fixed._RELEASES.get(target)
    check(predecessor is fixed._RUNS.get(target) and type(predecessor) is fixed.Reservation,
          'ALIGNMENT_FIXED_COMPLETION_REQUIRED')
    identity(target, DATABASE)
    before = snapshot(target)
    reference = json.loads(ref.baseline)
    check(batch.catalog.independent_equal(before, reference, actual_bounds, ref.bounds, ref.prefix),
          'ALIGNMENT_INDEPENDENT_BASELINE_REQUIRED')
    expected_fixed = fixed.decoded(predecessor.s1)
    check({k:v for k,v in before[0].items() if not k.startswith('alignment_')} == expected_fixed[0]
          and rows_equal(before[1], expected_fixed[1]), 'ALIGNMENT_FIXED_BASELINE_REQUIRED')
    batch.admit_graph(before[0], staging)
    token = uuid.uuid4().hex
    # Reserve before oracle or migration work; failure cannot retry this handle.
    reservation = Release(ref, predecessor, staging, encoded(before), b'', token)
    _RUNS[target] = reservation
    expected = independent_final(target, before, staging)
    check(encoded(snapshot(target)) == reservation.before, 'ALIGNMENT_PREIMAGE_CHANGED')
    files = []
    program = []
    for index, source in enumerate(sources):
        path = target.private('alignment-whole-'+source.key+'.sql', source.data)
        check(path.read_bytes() == source.data, 'ALIGNMENT_WHOLE_FILE_REQUIRED')
        files.append(path)
        program.append((path, source.data))
        if source.key != 'W':
            previous = ('ADMITTED', 'P', 'A', 'B')[index]
            stage = batch.stage_sql(previous, source.key)
            path = target.private('alignment-stage-'+source.key+'.sql', stage)
            files.append(path)
            program.append((path, stage.encode()))
    assertions = batch.identity_assertions() + batch.assertions(False)
    assertions += "\nSELECT 'ALIGNMENT_EXPECTED_ROWS'; SELECT after_rows FROM alignment_reference;"
    path = target.private('alignment-assertions.sql', assertions)
    files.append(path)
    program.append((path, assertions.encode()))
    prelude = batch.prelude(sources, before, expected, token, staging=staging, target_database=DATABASE)
    prelude += identity_preimage_sql()
    reservation = replace(reservation, files=tuple(program),
                          prelude=prelude.encode())
    _RUNS[target] = reservation
    output = run_private(target, DATABASE, prelude, files)
    expected_rows = expected_receipt(output)
    after = snapshot(target)
    check(batch.catalog.final_equal(before[0], after[0], expected,
          batch.new_index_keys(sources, before[0], staging=staging)) and rows_equal(after[1], expected_rows),
          'ALIGNMENT_POST_COMMIT_MISMATCH')
    check(batch.validate_sources(paths, staging) == sources, 'ALIGNMENT_STAGED_SOURCE_CHANGED')
    _RELEASES[target] = replace(reservation, after=encoded(after))
    return {'sources': 5}


def identity_preimage_sql():
    # Runs after locked admission and before P in the same transaction.
    return 'CREATE TEMP TABLE alignment_identity_reference(value) ON COMMIT DROP AS ' + batch.identities_sql()


def completion(target):
    ref = owned(target)
    run, release = _RUNS.get(target), _RELEASES.get(target)
    check(type(run) is Release and type(release) is Release and run.reference is ref
          and release.reference is ref and run.token == release.token
          and run.fixed_completion is release.fixed_completion is fixed._RELEASES.get(target)
          and fixed._RELEASES.get(target) is fixed._RUNS.get(target)
          and run.staging is release.staging is ref.inputs.staging
          and run.before == release.before and run.files == release.files
          and run.prelude == release.prelude, 'ALIGNMENT_COMPLETION_LINK_REQUIRED')
    check(bool(release.after), 'ALIGNMENT_COMMITTED_SNAPSHOT_REQUIRED')
    return release


def assert_final(target):
    release = completion(target)
    identity(target, DATABASE)
    check(encoded(snapshot(target)) == release.after, 'ALIGNMENT_FINAL_STATE_CHANGED')
    return release


def release_checks(target, full=False):
    ref = owned(target, 'ALIGNMENT_COMPLETE')
    frame = sys._getframe(2)
    check(frame.f_code is replay._serve_child.__code__ and frame.f_locals.get('h') is target
          and type(frame.f_locals.get('loop')) is replay.FoundationLoop
          and frame.f_locals['loop'].target is target and frame.f_locals.get('status') == 0
          and frame.f_locals['child'].poll() == 0 and frame.f_locals['server'].fileno() == -1
          and not (Path(ref.directory)/'replay.sock').exists(), 'SUCCESSFUL_ORIGINAL_CHILD_REQUIRED')
    # Full source reconstruction remains gated; later migrations may intentionally
    # change the snapshot, but may never erase the linked committed reservation.
    check(type(full) is bool and full == (ref.fixed.dedupe.scope == 'full'), 'ALIGNMENT_RELEASE_SCOPE_REQUIRED')
    if not full:
        release = assert_final(target)
    else:
        release = completion(target)
    check(replay.originals_snapshot() == ref.fixed.originals, 'ALIGNMENT_ORIGINALS_RESTORATION_REQUIRED')
    fixed.privacy(target)
    return release
