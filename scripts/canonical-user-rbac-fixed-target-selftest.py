#!/usr/bin/env python3
"""Private whole-source characterization; never source-selection acceptance.

Only constructors run locally. SQL runs in the accepted offline owned PG17
container. Fixed identities and all SQL output remain in controller memory.
"""
import argparse
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import select
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


replay = load('fixed_replay', 'canonical-auth-provisioning-replay.py')
legacy, repair, dedupe = replay.load_batch(), replay.load_repair(), replay.load_dedupe()
BoundaryError = legacy.BoundaryError
SPECS = {
    'B0': ('20260519_bootstrap_div3rsa_superadmin.sql', 344,
           'bd9e06fc4b0244bc3bf6d9fc64924552766edf303168d4e2e11f0b8abe0334c0'),
    'C2': ('20260525_debug_batch_2c_activate_afshin_nibela.sql', 249,
           'b92f043727f2e5699a277c7d649dd583b8f04b1bdcd759840a2d0d1e52953659'),
    'D2': ('20260525_debug_batch_2d_activate_afshin_nibela_v2.sql', 287,
           '048bf0d47d0ae0e996517b770ac4d4591726a2b8e029a91348c8a031acf37dd7'),
    'F2': ('20260525_debug_batch_2f_normalize_afshin_nibela.sql', 245,
           '9fcf47f11a881c01a670f7858af5a297a2a49fb5033fdc256a024c8ae979e35b'),
}
DATABASES = dict(zip(SPECS, ('gridex_auth_legacy_native', 'gridex_auth_legacy_dirty',
                           'gridex_auth_legacy_atomic', 'gridex_auth_legacy_lock')))
WRITE_TABLES = frozenset(('auth.users', 'public.companies', 'public.user_profiles',
                         'public.roles', 'public.permissions', 'public.role_permissions',
                         'public.user_roles', 'public.company_memberships',
                         'public.company_invitations', 'public.audit_logs'))
# No new database names, URLs, provider clients, roles, or generic target option.
CANARY = 'gridex_auth_legacy_seeded'


def check(condition, label='FIXED_ASSERTION_FAILED'):
    if not condition:
        raise BoundaryError(label)


class Source:
    """Pinned whole bytes; repr never discloses source-bound fixture values."""
    def __init__(self, key, path=None):
        check(key in SPECS, 'SOURCE_REQUIRED')
        self.key = key
        name, lines, digest = SPECS[key]
        canonical = ROOT/'supabase/migrations'/name
        path = canonical if path is None else path
        check(type(path) is type(canonical) and path == canonical and path.is_file()
              and not path.is_symlink() and path.resolve() == path, 'WHOLE_SOURCE_REQUIRED')
        data = repair.read_source(path)
        legacy.verify_bytes(data, digest, lines)
        manifest = json.loads((ROOT/'scripts/migration-history-manifest.json').read_text())['files']
        check(manifest.get(name) == digest, 'ORIGINAL_MANIFEST_REQUIRED')
        self.path, self.data = path, data
        self.text = data.decode()
        self.slots = {}
        pattern = r"v_(company_id|user_id|correct_user_id|old_user_id|actor_user_id|email)\s+(?:uuid|text)\s*:=\s*'([^']+)'"
        for variable, value in re.findall(pattern, self.text, re.I):
            symbol = {'company_id':'C_target', 'user_id':'U_boot' if key == 'B0' else 'U_target',
                      'correct_user_id':'U_target', 'old_user_id':'U_old',
                      'actor_user_id':'U_actor', 'email':'email'}[variable]
            self.slots[symbol] = value
        expected = {'B0': {'U_boot'}, 'C2': {'C_target','U_target','U_actor','email'},
                    'D2': {'C_target','U_target','U_actor','email'},
                    'F2': {'C_target','U_target','U_old','email'}}[key]
        check(set(self.slots) == expected, 'SOURCE_SLOT_SHAPE')
        for symbol, value in self.slots.items():
            if symbol != 'email':
                check(str(uuid.UUID(value)) == value, 'SOURCE_SLOT_TYPE')
        check(bool(re.search(r'^commit;\s*$', self.text, re.I | re.M)) == (key in ('D2','F2')),
              'NATIVE_TRANSACTION_REQUIRED')

    def literal(self, line, ordinal=0):
        values = re.findall(r"'((?:''|[^'])*)'", self.text.splitlines()[line-1])
        check(len(values) > ordinal, 'SOURCE_ORACLE_LITERAL')
        return values[ordinal].replace("''", "'")

    def refresh(self):
        other = Source(self.key)
        check(other.data == self.data, 'SOURCE_CHANGED')
        return other.data


def ident(value):
    check(re.fullmatch(r'[a-z_][a-z0-9_]*', value) is not None, 'IDENTIFIER_REQUIRED')
    return '"'+value+'"'


def qualified(table):
    check(table in WRITE_TABLES, 'CLOSED_WRITE_TABLE_REQUIRED')
    return '.'.join(ident(part) for part in table.split('.'))


def value_sql(value):
    if value is None:
        return 'NULL'
    if type(value) is bool:
        return 'true' if value else 'false'
    if type(value) in (int, float):
        return str(value)
    if type(value) in (dict, list):
        return legacy.literal(json.dumps(value, separators=(',',':')))+'::jsonb'
    check(type(value) is str, 'FIXTURE_VALUE_TYPE')
    return legacy.literal(value)


# Complete portable catalog includes FKs, indexes, functions, event triggers and ACLs.
CATALOG_SQL = repair.catalog_sql()
ROWS_SQL = '''
CREATE TEMP TABLE fixed_rows(name text, value jsonb) ON COMMIT DROP;
DO $$ DECLARE r record; BEGIN
FOR r IN SELECT n.nspname,c.relname,c.relkind FROM pg_class c
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p','S') LOOP
 IF r.relkind='S' THEN
  EXECUTE format('INSERT INTO fixed_rows SELECT %L,jsonb_build_object(''last_value'',last_value,''log_cnt'',log_cnt,''is_called'',is_called) FROM %I.%I',r.nspname||'.'||r.relname,r.nspname,r.relname);
 ELSE
  EXECUTE format('INSERT INTO fixed_rows SELECT %L,to_jsonb(x) FROM %I.%I x',r.nspname||'.'||r.relname,r.nspname,r.relname);
 END IF;
END LOOP; END $$;
SELECT coalesce(jsonb_agg(jsonb_build_array(name,value) ORDER BY name,value),'[]') FROM fixed_rows;
DROP TABLE fixed_rows;
'''


def snapshot_sql():
    return "SELECT 'FIXED_CATALOG';\n"+CATALOG_SQL+"\nSELECT 'FIXED_ROWS';\n"+ROWS_SQL


def decode_snapshot(output):
    lines = output.splitlines()
    check(lines.count('FIXED_CATALOG') == 1 and lines.count('FIXED_ROWS') == 1,
          'PRIVATE_SNAPSHOT_REQUIRED')
    return (json.loads(lines[lines.index('FIXED_CATALOG')+1]),
            json.loads(lines[lines.index('FIXED_ROWS')+1]))


@dataclass(repr=False)
class Result:
    stdout: str
    stderr: str
    code: int
    state: str
    lower: datetime
    upper: datetime


class Proof:
    def __init__(self, h):
        repair.require_owned(h)
        dedupe.require_owned(h)
        check(dedupe._STATES.get(h) == 'SUCCEEDED', 'ACTUAL57_REQUIRED')
        self.h, self.name, self.directory = h, h.name, h.directory.name
        self.references = (h.reference, repair.REFERENCES[h], dedupe._REFERENCES[h])
        self.reservations = {}
        self.origin = self.snapshot(replay.DATABASE)
        self.canary = self.snapshot(CANARY)
        check(self.origin[0] == self.references[2].final, 'ACTUAL57_CATALOG_REQUIRED')
        self.graph(self.origin[0])

    def owned(self, database):
        repair.require_owned(self.h)
        dedupe.require_owned(self.h)
        legacy.validate_database(database)
        check(self.h.name == self.name and self.h.directory.name == self.directory
              and self.references[0] is self.h.reference
              and self.references[1] is repair.REFERENCES[self.h]
              and self.references[2] is dedupe._REFERENCES[self.h]
              and dedupe._STATES.get(self.h) == 'SUCCEEDED', 'STALE_FIXED_OWNER')

    def identity(self, database):
        self.owned(database)
        raw = self.h.docker(['inspect','--format',
             '{{.HostConfig.NetworkMode}}|{{ index .Config.Labels "gridex.auth-legacy.owner" }}',self.name])
        check(raw.decode().strip() == 'none|'+self.name, 'OFFLINE_OWNER_REQUIRED')
        self.h.verify_logging()
        result = self.run(database, "SELECT current_database(),current_user,inet_server_addr() IS NULL,inet_server_port() IS NULL,(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database());")
        check(result.stdout.strip() == database+'|postgres|t|t|postgres', 'LOCAL_OWNED_DATABASE_REQUIRED')

    def run(self, database, sql, transaction=True):
        """Trusted fixed command; stdin and raw stdout/stderr never become files."""
        self.owned(database)
        command = self.h.command(database, transaction=transaction) + ['-f', '-']
        lower = datetime.now(timezone.utc)
        process = None
        try:
            process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, env=legacy.clean_environment())
            self.h.processes.append(process)
            # Server ERROR primary text can contain a fixed identity, even with
            # log_min_error_statement=panic. Verify suppression BEFORE input.
            process.stdin.write(b"SET log_min_messages=panic; SELECT 'FIXED_PRIVATE_READY' WHERE current_setting('log_min_messages')='panic' AND current_setting('log_min_error_statement')='panic' AND current_setting('log_parameter_max_length_on_error')='0';\n")
            process.stdin.flush()
            ready, _, _ = select.select([process.stdout], [], [], 10)
            check(bool(ready) and process.stdout.readline() == b'FIXED_PRIVATE_READY\n',
                  'PRIVATE_SESSION_REQUIRED')
            stdout, stderr = process.communicate(
                sql.encode() if isinstance(sql,str) else sql, timeout=120)
        except (OSError, subprocess.TimeoutExpired):
            raise BoundaryError('PRIVATE_MEMORY_PROCESS_FAILED') from None
        finally:
            if process is not None and process.poll() is None:
                process.kill()
                process.communicate()
        upper = datetime.now(timezone.utc)
        receipt = legacy.safe_receipt(stderr.decode(errors='replace'), process.returncode, 'private')
        return Result(stdout.decode(),stderr.decode(errors='replace'),process.returncode,
                      receipt['sqlstate'],lower,upper)

    def query(self, database, sql):
        result = self.run(database, sql)
        check(result.code == 0 and result.state == '00000', 'PRIVATE_QUERY_FAILED')
        return result.stdout

    def snapshot(self, database):
        return decode_snapshot(self.query(database, snapshot_sql()))

    def graph(self, catalog):
        """Actual constructor/source graph has no user triggers on these tables.

        Sources update stable PK rows, never delete parents. FK reads are closed
        to the same synthetic relation set; no FK cascade can leave that set.
        Whole-catalog equality checks preserve operational trigger registrations.
        """
        for key, item in catalog.items():
            if key.startswith('event_trigger/'):
                check(item['enabled'] == 'D', 'UNREVIEWED_EVENT_TRIGGER')
            if key.startswith(('trigger/','rule/')):
                table = key.split('/')[1]
                check(table not in WRITE_TABLES, 'UNREVIEWED_WRITE_TRIGGER')
            if key.startswith('relation/') and key.split('/')[1] in WRITE_TABLES:
                check(item['kind'] == 'r', 'ORDINARY_TABLE_REQUIRED')
            if key.startswith('constraint/') and item['kind'] == 'f':
                table = key.split('/')[1]
                if table in WRITE_TABLES:
                    match = re.search(r'REFERENCES ([\w.]+)\(', item['definition'])
                    check(match is not None, 'FK_GRAPH_REQUIRED')
                    parent = match[1] if '.' in match[1] else 'public.'+match[1]
                    check(parent in WRITE_TABLES, 'UNREVIEWED_FK_TARGET')
        # No default/provider hook on a newly authored Auth user.
        for key,item in catalog.items():
            if key.startswith('column/auth.users/'):
                default = item['default']
                check(default is None or default.startswith('NULL::') or
                      (key == 'column/auth.users/is_anonymous' and default == 'false') or
                      (key == 'column/auth.users/confirmed_at' and item['generated'] == 's'
                       and default == 'LEAST(email_confirmed_at, phone_confirmed_at)'), 'AUTH_DEFAULT_REVIEW_REQUIRED')

    def clone(self, source, case):
        database = DATABASES[source.key]
        self.owned(database)
        check(database not in self.reservations, 'FRESH_RESERVATION_REQUIRED')
        self.identity(replay.DATABASE)
        check(self.snapshot(replay.DATABASE) == self.origin, 'ACTUAL57_ORIGIN_CHANGED')
        # Each case gets a fresh database; the accepted terminal replay is never reset.
        self.h.docker(['exec',self.name,'dropdb','-U','postgres','--if-exists','--force',database])
        self.h.docker(['exec',self.name,'createdb','-U','postgres','-T',replay.DATABASE,database])
        self.identity(database)
        before = self.snapshot(database)
        check(before == self.origin, 'ACTUAL_CLONE_REQUIRED')
        self.graph(before[0])
        values = set(source.slots.values())
        serialized = json.dumps(before[1],sort_keys=True)
        check(not any(value in serialized for value in values),
              'RESERVED_SLOT_COLLISION')
        self.reservations[database] = (source,case)
        return database

    def destroy(self, database):
        self.owned(database)
        check(database in self.reservations, 'FIXTURE_RESERVATION_REQUIRED')
        self.identity(database)
        self.h.docker(['exec',self.name,'dropdb','-U','postgres','--force',database])
        result = self.h.docker(['exec',self.name,'psql','-X','-U','postgres','-d','postgres','-qAt','-c',
                    'SELECT datname FROM pg_database WHERE datname='+legacy.literal(database)+';'])
        check(not result.strip(), 'EXACT_DISPOSAL_REQUIRED')
        del self.reservations[database]
        check(self.snapshot(replay.DATABASE) == self.origin, 'ORIGIN_CANARY_CHANGED')
        check(self.snapshot(CANARY) == self.canary, 'INDEPENDENT_CANARY_CHANGED')

    def native(self, source, database, rollback=False, suffix=''):
        self.identity(database)
        check(self.reservations.get(database, (None,))[0] is source, 'SOURCE_RESERVATION_REQUIRED')
        self.graph(self.snapshot(database)[0])
        data = source.refresh()
        if source.key in ('B0','C2'):
            check(rollback, 'OUTER_ROLLBACK_REQUIRED')
            data = b'BEGIN;\n'+data+b'\n'+snapshot_sql().encode()+b'\nROLLBACK;\n'
        else:
            check(not rollback, 'NATIVE_COMMIT_REQUIRED')
        return self.run(database, data+b'\n'+suffix.encode(), transaction=False)


def arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--selection-only',action='store_true')
    modes.add_argument('--cleanup-owned',action='store_true')
    return parser.parse_args(argv)


def constructors():
    for key in SPECS:
        source = Source(key)
        check(source.refresh() == source.data)
        for candidate in (source.path.with_name('substitution.sql'), ROOT/'scripts'/source.path.name):
            rejected(lambda: Source(key,candidate))
        for changed in (b'', source.data[:100], source.data+b'\n', source.data.replace(b'commit;',b'')):
            if changed != source.data:
                with patch.object(repair,'read_source',return_value=changed):
                    rejected(lambda: Source(key))
        with patch.object(Path,'is_symlink',return_value=True):
            rejected(lambda: Source(key))
    for argv in (['--unknown'], ['--selection-only','--cleanup-owned']):
        with contextlib.redirect_stderr(io.StringIO()):
            try:
                arguments(argv)
            except SystemExit as error:
                check(error.code == 2)
            else:
                raise BoundaryError('UNKNOWN_MODE_ACCEPTED')
    check(legacy is repair.legacy and legacy is dedupe.legacy and repair is dedupe.repair)
    check(set(DATABASES.values()) | {CANARY,replay.DATABASE} <= legacy.DATABASES)
    models = load('fixed_control_oracles','canonical-user-rbac-fixed-target-oracles.py')
    cases = load('fixed_control_cases','canonical-user-rbac-fixed-target-cases.py')
    controls = load('fixed_controls','canonical-user-rbac-fixed-target-controls.py')
    controls.constructors(sys.modules[__name__],models,cases)


def rejected(operation):
    try:
        operation()
    except (BoundaryError,FileNotFoundError):
        return
    raise BoundaryError('REJECTION_CONTROL_FAILED')


def require_workflow_owner():
    name = os.environ.get('GRIDEX_LEGACY_CONTAINER_NAME','')
    check(re.fullmatch(r'gridex-auth-legacy-fixed-[0-9]+-[0-9]+',name) is not None,'EXACT_FIXED_WORKFLOW_OWNER_REQUIRED')


def sql_main():
    require_workflow_owner()
    models = load('fixed_oracles','canonical-user-rbac-fixed-target-oracles.py')
    fixtures = load('fixed_fixtures','canonical-user-rbac-fixed-target-fixtures.py')
    cases = load('fixed_cases','canonical-user-rbac-fixed-target-cases.py')
    core = sys.modules[__name__]
    original = replay.originals_snapshot()
    with legacy.OwnedPostgres() as h:
        dedupe.prepare_reference(h)
        refs = h.reference,repair.REFERENCES[h],dedupe._REFERENCES[h]
        h.reset(CANARY)
        h.sql(CANARY,"CREATE TABLE public.fixed_canary(id integer PRIMARY KEY,value text); INSERT INTO public.fixed_canary VALUES (1,'preserved');",'fixed_canary')
        command = ['bash',str(ROOT/'scripts/gridex-aud-003-clean-replay.sh'),'--dedupe-prefix-proof']
        check(replay.serve_child(legacy,h,command,'dedupe57') == 0,'ACTUAL57_SHELL_REQUIRED')
        check(replay.originals_snapshot() == original,'WHOLE_SOURCE_STAGE_RESTORATION_REQUIRED')
        check(h.reference is refs[0] and repair.REFERENCES[h] is refs[1] and dedupe._REFERENCES[h] is refs[2],
              'REFERENCE_IDENTITIES_CHANGED')
        proof = Proof(h)
        controls = load('fixed_sql_controls','canonical-user-rbac-fixed-target-controls.py')
        controls.admissions(core,models,fixtures,proof)
        for source,name,options in cases.cases():
            cases.run_case(core,models,fixtures,proof,source,name,options)
        controls.privacy(core,proof)
        check(not proof.reservations,'ALL_FIXTURES_DISPOSED_REQUIRED')
        check(dedupe._STATES[h] == 'SUCCEEDED','ACCEPTED_LIFECYCLE_CHANGED')
        check(replay.originals_snapshot() == original,'FINAL_SOURCE_RESTORATION_REQUIRED')
    print('PASS complete private fixed-target characterization; selection unchanged')


def main():
    args = arguments()
    if args.cleanup_owned:
        require_workflow_owner()
        legacy.cleanup_workflow_owned()
        return
    constructors()
    if args.selection_only:
        print('PASS fixed-target constructors; no SQL executed')
        return
    sql_main()


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        if isinstance(error,SystemExit):
            raise
        # No exception repr, traceback, server detail/hint or source output escapes.
        label = str(error) if re.fullmatch(r'[A-Z][A-Z0-9_]{0,79}',str(error)) else type(error).__name__
        print('FAIL private fixed-target proof category='+label,file=sys.stderr)
        sys.exit(1)
