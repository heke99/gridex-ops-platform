"""Qualification transport for the parent's disposable native Supabase project.

No CLI execution or ledger insertion lives here. Complete-source qualifications
use same-container PostgreSQL clones; final application belongs to the parent's
real CLI runner and must return a source-bound, verified ledger receipt.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
CLONES = ('gridex_auth_legacy_dirty', 'gridex_auth_legacy_atomic',
          'gridex_auth_legacy_native', 'gridex_auth_legacy_helper',
          'gridex_native_timestamp_original', 'gridex_native_timestamp_candidate',
          'gridex_native_timestamp_phase')
LIVE_SYNC_FIXTURE_SHA256 = 'fd58be14dfc5409a65f3e5d4d3d0d8b9073347a0f4a676839bf770d38cbc89ca'
LIVE_SYNC_ACL_SQL = {
    role: 'BEGIN; SET LOCAL ROLE '+role+"; SELECT set_config('request.jwt.claim.sub','',true); SELECT public.gridex_is_current_session_allowed(); ROLLBACK;"
    for role in ('anon','authenticated','service_role')
}
LIVE_SYNC_LOGIN_SQL = """SELECT jsonb_build_object(
'sessionUser',session_user,'currentUser',current_user,
'login',r.rolcanlogin,'superuser',r.rolsuper,'bypassRls',r.rolbypassrls,
'setRoles',jsonb_build_object('anon',pg_has_role(current_user,'anon','SET'),
'authenticated',pg_has_role(current_user,'authenticated','SET'),
'service_role',pg_has_role(current_user,'service_role','SET')))
FROM pg_roles r WHERE r.rolname=session_user;"""
LIVE_SYNC_LOGIN_EXPECTED = dict(sessionUser='authenticator',currentUser='authenticator',
    login=True,superuser=False,bypassRls=False,
    setRoles=dict(anon=True,authenticated=True,service_role=True))

SQL_STAGES = {
    name: name.upper() for name in (
        'live_sync_behavior_fixture', 'live_sync_behavior_matrix',
        'live_sync_acl_anon', 'live_sync_acl_authenticated', 'live_sync_acl_service_role',
        'timestamp_clone_identity', 'timestamp_catalog', 'timestamp_rows',
        'live_sync_acl_login')
}
SQL_STATES = {
    '00000': 'SUCCESS', '42501': 'INSUFFICIENT_PRIVILEGE', '42601': 'SYNTAX',
    '42P01': 'RELATION_MISSING', '42703': 'COLUMN_MISSING', '42883': 'FUNCTION_MISSING',
    '23505': 'UNIQUE_VIOLATION', '23514': 'CHECK_VIOLATION', '55000': 'PREREQUISITE_STATE',
    'P0001': 'ASSERTION', 'ZX001': 'INJECTED_FAULT', 'XX000': 'INTERNAL',
    '3F000': 'SCHEMA_MISSING', '42P06': 'SCHEMA_EXISTS', '0A000': 'UNSUPPORTED',
}


def sql_failure_diagnostic(stage, expect, errors, returncode):
    """Only finite labels escape private psql streams; unknown text stays private."""
    actual = (SQL_STATES.get(errors[0].decode('ascii'), 'OTHER') if len(errors)==1
              else 'NONE' if not errors else 'MULTIPLE')
    return dict(stage=SQL_STAGES.get(stage,'OTHER'), expected=SQL_STATES.get(expect,'OTHER'),
                actual=actual, primaryErrors='ONE' if len(errors)==1 else 'ZERO' if not errors else 'MULTIPLE',
                exit='ZERO' if returncode==0 else 'NONZERO')


def sql_transport_diagnostic(result):
    """Finite response-shape evidence, never raw streams or server identities.

    Markers describe observed bytes only. They cannot establish the cause or
    substitute for the exact primary SQLSTATE and exit assertion in sql().
    """
    def size(raw):
        return 'EMPTY' if not raw else 'LE_256' if len(raw)<=256 else 'LE_4096' if len(raw)<=4096 else 'GT_4096'
    exits = {0:'SUCCESS', 1:'PSQL_OR_CLIENT_ERROR', 2:'PSQL_CONNECTION_ERROR',
             3:'PSQL_SCRIPT_ERROR', 125:'DOCKER_RUN_ERROR', 126:'EXEC_NOT_EXECUTABLE',
             127:'EXEC_NOT_FOUND', 137:'EXIT_137', 143:'EXIT_143',
             -9:'SIGNAL_9', -15:'SIGNAL_15'}
    markers = {
        b'server closed the connection unexpectedly':'SERVER_CONNECTION_CLOSED',
        b'connection refused':'CONNECTION_REFUSED',
        b'no such file or directory':'FILE_OR_SOCKET_MISSING',
        b'the database system is starting up':'DATABASE_STARTING',
        b'the database system is shutting down':'DATABASE_SHUTTING_DOWN',
        b'the database system is in recovery mode':'DATABASE_RECOVERY',
        b'password authentication failed':'AUTHENTICATION_FAILED',
        b'peer authentication failed':'PEER_AUTHENTICATION_FAILED',
        b'no pg_hba.conf entry':'HBA_REJECTED',
        b'terminating connection due to administrator command':'CONNECTION_TERMINATED',
        b'oci runtime exec failed':'OCI_EXEC_FAILED',
        b'is not running':'CONTAINER_NOT_RUNNING',
        b'no such container':'CONTAINER_MISSING',
        b'cannot connect to the docker daemon':'DOCKER_UNAVAILABLE',
    }
    raw=(result.stdout+b'\n'+result.stderr).lower()
    signals={label for needle,label in markers.items() if needle in raw}
    # Exact line shapes distinguish missing verbosity from client diagnostics.
    prefixes = {
        'VERBOSE_PRIMARY': rb'^(?:psql:[^\r\n]*?:\d+:\s*)?(?:ERROR|FATAL|PANIC):\s+[A-Z0-9]{5}:',
        'UNVERBOSE_PRIMARY': rb'^(?:psql:[^\r\n]*?:\d+:\s*)?(?:ERROR|FATAL|PANIC):',
        'PSQL_CLIENT': rb'^psql: error:',
        'DOCKER_CLIENT': rb'^(?:docker:|Error response from daemon:|OCI runtime exec failed:)',
    }
    for line in result.stderr.splitlines()+result.stdout.splitlines():
        verbose = bool(re.search(prefixes['VERBOSE_PRIMARY'],line))
        for label, pattern in prefixes.items():
            if label=='UNVERBOSE_PRIMARY' and verbose:
                continue
            if re.search(pattern,line):
                signals.add(label)
    return dict(exitKind=exits.get(result.returncode,'OTHER'),
                stdoutSize=size(result.stdout),stderrSize=size(result.stderr),
                signals=sorted(signals) or ['OTHER'])


def clone_create_failure(stderr, source):
    """Classify one utility primary error; details and names remain private."""
    primary = [line for line in stderr.splitlines()
               if line.startswith((b'createdb: error:', b'ERROR:', b'FATAL:', b'PANIC:'))]
    match = (re.fullmatch(rb'createdb: error: database creation failed: ERROR: *(.+)', primary[0])
             if len(primary) == 1 else None)
    if match:
        messages = {
            b'source database "'+source.encode()+b'" is being accessed by other users': 'SOURCE_DATABASE_IN_USE',
            b'permission denied to copy database "'+source.encode()+b'"': 'COPY_OWNER_DENIED',
            b'permission denied to create database': 'CREATE_PERMISSION_DENIED',
        }
        reason = messages.get(match[1], 'OTHER')
    else:
        reason = 'OTHER'
    return 'NATIVE_TIMESTAMP_CLONE_CREATE_'+reason


def load_live_sync():
    spec = importlib.util.spec_from_file_location('native_timestamp_live_sync',
        ROOT/'scripts/canonical-live-sync-proof.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # The native adapter uses the broader domain image for the existing proof's
    # clone comparisons too. Original SQL and all acceptance assertions remain.
    module.snapshot = lambda target, database: target.snapshot(database)
    return module


def verify_application_receipt(rendered, receipt):
    if (not isinstance(receipt, dict) or receipt.get('ledgerVerified') is not True
            or receipt.get('renderedSha256') != hashlib.sha256(rendered.encode()).hexdigest()):
        raise ValueError('LIVE_SYNC_NATIVE_LEDGER_REQUIRED')


class NativeTimestampTarget:
    """Finite socket-only API compatible with the existing source proof helpers.

    The supplied command is the lifecycle's private-output collector. Creation
    checks actual Docker ownership and internal networking. Existing databases
    cannot be claimed or destroyed: owned clone OIDs are checked before reuse.
    """
    def __init__(self, command, project):
        if (not callable(command) or not isinstance(project, str)
                or not re.fullmatch(r'gridex-sb-[a-f0-9]{12}-[a-f0-9]{16}', project)):
            raise ValueError('NATIVE_TIMESTAMP_OWNER_REQUIRED')
        self._run = command
        self._project = project
        self.name = self._created_name = 'supabase_db_'+project
        self.active = True
        self._owned = {}
        self._last_sql_failure = None
        self._recent_sql_failure = None
        self._live_sync_acl_receipts = {}
        self.assert_native_owned()

    def _admit(self):
        if (self.active is not True or self.name != self._created_name
                or self.name != 'supabase_db_'+self._project):
            raise ValueError('NATIVE_TIMESTAMP_OWNER_REQUIRED')

    def assert_native_owned(self):
        self._admit()
        raw = json.loads(self._run(['docker', 'inspect', self.name]).stdout)
        network = self._project+'-network'
        if (not isinstance(raw, list) or len(raw) != 1 or not isinstance(raw[0], dict)):
            raise ValueError('NATIVE_TIMESTAMP_CONTAINER_REQUIRED')
        item = raw[0]
        if (item.get('Name') != '/'+self.name or item.get('State', {}).get('Running') is not True
                or item.get('Config', {}).get('Labels', {}).get('com.supabase.cli.project') != self._project
                or not re.fullmatch(r'public\.ecr\.aws/supabase/postgres:17\.[0-9.]+', item.get('Config', {}).get('Image', ''))
                or not re.fullmatch(r'sha256:[a-f0-9]{64}', item.get('Image', ''))
                or set(item.get('NetworkSettings', {}).get('Networks', {})) != {network}):
            raise ValueError('NATIVE_TIMESTAMP_CONTAINER_REQUIRED')
        raw_network = json.loads(self._run(['docker', 'network', 'inspect', network]).stdout)
        if (not isinstance(raw_network, list) or len(raw_network) != 1
                or raw_network[0].get('Name') != network
                or raw_network[0].get('Internal') is not True
                or raw_network[0].get('Labels', {}).get('gridex.native.owner') != self._project):
            raise ValueError('NATIVE_TIMESTAMP_NETWORK_REQUIRED')
        return True

    def command(self, database, *, transaction=True):
        self._admit()
        if (database != 'postgres' and (database not in CLONES or database not in self._owned)):
            raise ValueError('NATIVE_TIMESTAMP_DATABASE_REQUIRED')
        if type(transaction) is not bool:
            raise ValueError('NATIVE_TIMESTAMP_TRANSACTION_REQUIRED')
        if database != 'postgres' and self._oid(database) != self._owned[database]:
            raise ValueError('NATIVE_TIMESTAMP_CLONE_OWNERSHIP')
        args = ['docker', 'exec', '-i', '-e', 'PGOPTIONS=-c search_path=public,extensions',
                self.name, 'psql', '-X', '-U', 'postgres', '-d', database,
                '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-qAt', '-f', '-']
        if transaction:
            args.append('--single-transaction')
        return args

    def sql(self, database, sql, stage='fixture', expect='00000', transaction=True):
        args = self.command(database, transaction=transaction)
        if (not isinstance(sql, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', stage)
                or not re.fullmatch(r'[A-Z0-9]{5}', expect)):
            raise ValueError('NATIVE_TIMESTAMP_SQL_ARGUMENT_REQUIRED')
        role = None
        if stage.startswith('live_sync_acl_') or sql in LIVE_SYNC_ACL_SQL.values():
            role = stage.removeprefix('live_sync_acl_')
            if (role not in LIVE_SYNC_ACL_SQL or sql != LIVE_SYNC_ACL_SQL[role]
                    or database != 'gridex_auth_legacy_helper' or transaction is not False
                    or expect != ('42501' if role=='anon' else '00000')):
                raise ValueError('NATIVE_LIVE_SYNC_ACL_BINDING_REQUIRED')
            self._live_sync_acl_receipts.pop(role,None)
            path=ROOT/'scripts/canonical-live-sync-proof.py'
            if (path.resolve()!=path or not path.is_file() or path.stat().st_size>100_000
                    or hashlib.sha256(path.read_bytes()).hexdigest()!=LIVE_SYNC_FIXTURE_SHA256):
                raise ValueError('NATIVE_LIVE_SYNC_ACL_SOURCE_REQUIRED')
            # Supabase image 17.6.1.106 has a reported SIGSEGV on a function
            # permission denial after a superuser login SET ROLE (upstream issue 2409).
            # Use the actual API login role; never SET SESSION AUTHORIZATION.
            args[args.index('-U')+1]='authenticator'
            # The owned CLI default role has password postgres; its Unix socket
            # uses peer authentication and cannot log in as the API role.
            # TCP is fixed to this already admitted container's loopback.
            args[args.index(self.name):args.index(self.name)] = ['-e','PGPASSWORD=postgres']
            args += ['-h','127.0.0.1','-p','5432','-w']
            raw=self._execute_sql(args,LIVE_SYNC_LOGIN_SQL,'live_sync_acl_login','00000')
            try:
                identity=json.loads(raw)
            except (TypeError,ValueError):
                raise ValueError('NATIVE_LIVE_SYNC_AUTHENTICATOR_REQUIRED') from None
            if identity != LIVE_SYNC_LOGIN_EXPECTED or any(type(identity.get(k)) is not bool
                    for k in ('login','superuser','bypassRls')) or any(
                    type(value) is not bool for value in identity['setRoles'].values()):
                raise ValueError('NATIVE_LIVE_SYNC_AUTHENTICATOR_REQUIRED')
        output=self._execute_sql(args,sql,stage,expect)
        if role is not None:
            self._live_sync_acl_receipts[role]=dict(
                scope='EXACT_SESSION_FIXTURE_API_LOGIN_NOT_HISTORICAL_LEDGER',
                login='authenticator',realLoginVerified=True,expectedStateVerified=True,
                expectedSqlstate=expect,
                sqlSha256=hashlib.sha256(sql.encode()).hexdigest(),
                loginQuerySha256=hashlib.sha256(LIVE_SYNC_LOGIN_SQL.encode()).hexdigest(),
                fixtureSourceSha256=LIVE_SYNC_FIXTURE_SHA256)
        return output

    def _execute_sql(self,args,sql,stage,expect):
        result = self._run(args, data=sql.encode(), timeout=420, allow_failure=True)
        # Verbose psql sends the primary SQLSTATE on an ERROR/FATAL/PANIC line.
        # Do not accept a NOTICE, arbitrary SQL echo or a second primary error.
        errors = re.findall(rb'^(?:psql:[^\r\n]*?:\d+:\s*)?(?:ERROR|FATAL|PANIC):\s+([A-Z0-9]{5}):',
                            result.stderr, re.M)
        if ((expect == '00000' and (result.returncode != 0 or errors))
                or (expect != '00000' and (result.returncode == 0 or errors != [expect.encode()]))):
            diagnostic = sql_failure_diagnostic(stage,expect,errors,result.returncode)
            diagnostic['transport'] = sql_transport_diagnostic(result)
            self._recent_sql_failure = diagnostic
            if self._last_sql_failure is None:
                self._last_sql_failure = diagnostic
            raise ValueError('NATIVE_TIMESTAMP_SQL_RESULT')
        return result.stdout.decode()

    def _oid(self, database):
        # Only finite locally authored names reach this literal.
        if database not in CLONES:
            raise ValueError('NATIVE_TIMESTAMP_CLONE_REQUIRED')
        raw = self.sql('postgres', "SELECT COALESCE(to_json((SELECT oid::text FROM pg_database WHERE datname='"+
                       database+"')), 'null'::json);", 'timestamp_clone_identity')
        oid = json.loads(raw)
        if oid is not None and not re.fullmatch(r'[0-9]+', str(oid)):
            raise ValueError('NATIVE_TIMESTAMP_CLONE_OWNERSHIP')
        return None if oid is None else str(oid)

    def drop_clone(self, database):
        self._admit()
        if database not in CLONES:
            raise ValueError('NATIVE_TIMESTAMP_CLONE_REQUIRED')
        actual = self._oid(database)
        owned = self._owned.get(database)
        if owned is None:
            if actual is not None:
                raise ValueError('NATIVE_TIMESTAMP_PREEXISTING_CLONE')
            return b''
        if actual != owned:
            raise ValueError('NATIVE_TIMESTAMP_CLONE_OWNERSHIP')
        result = self._run(['docker', 'exec', self.name, 'dropdb', '-U', 'postgres',
                            '--if-exists', '--force', database], allow_failure=True)
        if result.returncode != 0:
            raise ValueError('NATIVE_TIMESTAMP_CLONE_DROP_OTHER')
        del self._owned[database]
        return result.stdout

    def _create(self, database, source):
        self._admit()
        if database not in CLONES:
            raise ValueError('NATIVE_TIMESTAMP_CLONE_REQUIRED')
        if source != 'template0':
            self.command(source)
        if self._oid(database) is not None:
            raise ValueError('NATIVE_TIMESTAMP_PREEXISTING_CLONE')
        if source == 'postgres':
            from canonical_native_clone_quiesce import create_from_postgres
            result = create_from_postgres(self, database)
        else:
            result = self._run(['docker', 'exec', self.name, 'createdb', '-U', 'postgres',
                                '-T', source, database], timeout=120, allow_failure=True)
        if result.returncode != 0:
            raise ValueError(clone_create_failure(result.stderr, source))
        oid = self._oid(database)
        if oid is None:
            raise ValueError('NATIVE_TIMESTAMP_CLONE_OWNERSHIP')
        self._owned[database] = oid
        return result.stdout

    def clone(self, source, destination):
        self.command(source)
        if source == destination:
            raise ValueError('NATIVE_TIMESTAMP_CLONE_REQUIRED')
        self.drop_clone(destination)
        return self._create(destination, source)

    def reset(self, database):
        self.drop_clone(database)
        return self._create(database, 'template0')

    def docker(self, args, timeout=60, input=None):
        """Only the legacy proof helpers' two exact clone command shapes."""
        self._admit()
        if input is not None or not isinstance(args, list):
            raise ValueError('NATIVE_TIMESTAMP_DOCKER_COMMAND_REQUIRED')
        prefix = ['exec', self.name]
        if len(args) == 8 and args[:7] == prefix+['dropdb', '-U', 'postgres', '--if-exists', '--force']:
            return self.drop_clone(args[-1])
        if len(args) == 8 and args[:6] == prefix+['createdb', '-U', 'postgres', '-T']:
            return self._create(args[-1], args[-2])
        raise ValueError('NATIVE_TIMESTAMP_DOCKER_COMMAND_REQUIRED')

    def catalog(self, database):
        from canonical_native_timestamp_snapshot import queries
        query, _ = queries()
        return json.loads(self.sql(database, query, 'timestamp_catalog'))

    def snapshot(self, database='postgres'):
        from canonical_native_timestamp_snapshot import queries
        _, rows = queries()
        return self.catalog(database), json.loads(self.sql(database, rows, 'timestamp_rows'))

    def snapshot_admin_control(self, case):
        """Only three fixed synthetic operations on our already-owned probe clone.

        Native postgres remains a non-superuser. Like the separate lifecycle
        logging setup, this uses the existing container-local infrastructure
        owner connection; it never runs historical SQL or changes provider events.
        """
        from canonical_native_timestamp_snapshot import ADMIN_CONTROLS
        if type(case) is not str or case not in ADMIN_CONTROLS:
            raise ValueError('NATIVE_TIMESTAMP_SNAPSHOT_ADMIN_CASE_REQUIRED')
        clone = 'gridex_native_timestamp_phase'
        self.assert_native_owned()
        self.command(clone)  # Requires our retained OID; never claims an existing DB.
        args = ['docker', 'exec', '-i', self.name, 'psql', '-X', '-qAt', '-w',
                '-h', '127.0.0.1', '-p', '5432', '-U', 'supabase_admin', '-d', clone,
                '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-f', '-', '--single-transaction']
        check = ("DO $admit$ BEGIN IF (current_user='supabase_admin' "
                 "AND current_database()='gridex_native_timestamp_phase' "
                 "AND (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) "
                 "AND inet_client_addr()='127.0.0.1'::inet "
                 "AND inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=5432 "
                 "AND (SELECT oid::text FROM pg_database WHERE datname=current_database())='"+
                 self._owned[clone]+"') IS DISTINCT FROM true THEN RAISE EXCEPTION 'NATIVE_TIMESTAMP_SNAPSHOT_ADMIN_REQUIRED'; "
                 "END IF; END $admit$;\n")
        result = self._run(args, data=(check+ADMIN_CONTROLS[case]).encode(),
                           timeout=60, allow_failure=True)
        if result.returncode != 0:
            raise ValueError('NATIVE_TIMESTAMP_SNAPSHOT_ADMIN_REQUIRED')

    def close(self):
        for database in tuple(self._owned):
            self.drop_clone(database)
        self.active = False


def admit_live_sync_acl_receipts(receipts):
    if type(receipts) is not dict or set(receipts)!=set(LIVE_SYNC_ACL_SQL):
        raise ValueError('NATIVE_LIVE_SYNC_ACL_RECEIPTS_REQUIRED')
    for role,sql in LIVE_SYNC_ACL_SQL.items():
        expected=dict(scope='EXACT_SESSION_FIXTURE_API_LOGIN_NOT_HISTORICAL_LEDGER',
            login='authenticator',realLoginVerified=True,expectedStateVerified=True,
            expectedSqlstate='42501' if role=='anon' else '00000',
            sqlSha256=hashlib.sha256(sql.encode()).hexdigest(),
            loginQuerySha256=hashlib.sha256(LIVE_SYNC_LOGIN_SQL.encode()).hexdigest(),
            fixtureSourceSha256=LIVE_SYNC_FIXTURE_SHA256)
        if (receipts[role]!=expected or receipts[role]['realLoginVerified'] is not True
                or receipts[role]['expectedStateVerified'] is not True):
            raise ValueError('NATIVE_LIVE_SYNC_ACL_RECEIPTS_REQUIRED')
    return json.loads(json.dumps(receipts))


def execute_live_sync(target, source_sql, progress, *, retained, apply_reconstruction):
    if type(target) is not NativeTimestampTarget:
        raise ValueError('LIVE_SYNC_NATIVE_TARGET_REQUIRED')
    target._last_sql_failure = None
    target._live_sync_acl_receipts = {}
    try:
        result=load_live_sync().execute_boundary(ROOT, target, 'postgres', source_sql, progress,
                                               retained=retained, apply_reconstruction=apply_reconstruction)
        if (progress.get('sessionReconstruction',{}).get('nativeBoundaryVerified') is not True
                or any(name in target._owned for name in CLONES[:4])):
            raise ValueError('NATIVE_LIVE_SYNC_ACL_RECEIPTS_REQUIRED')
        progress['sessionReconstruction']['apiLoginAclQualification']=admit_live_sync_acl_receipts(target._live_sync_acl_receipts)
        return result
    except Exception:
        if target._last_sql_failure is not None and 'sessionReconstruction' in progress:
            progress['sessionReconstruction']['nativeSqlFailure'] = dict(target._last_sql_failure)
        raise
