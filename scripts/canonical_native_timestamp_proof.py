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
        result = self._run(args, data=sql.encode(), timeout=420, allow_failure=True)
        # Verbose psql sends the primary SQLSTATE on an ERROR/FATAL/PANIC line.
        # Do not accept a NOTICE, arbitrary SQL echo or a second primary error.
        errors = re.findall(rb'^(?:psql:[^\r\n]*?:\d+:\s*)?(?:ERROR|FATAL|PANIC):\s+([A-Z0-9]{5}):',
                            result.stderr, re.M)
        if ((expect == '00000' and (result.returncode != 0 or errors))
                or (expect != '00000' and (result.returncode == 0 or errors != [expect.encode()]))):
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
                            '--if-exists', '--force', database])
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
        result = self._run(['docker', 'exec', self.name, 'createdb', '-U', 'postgres',
                            '-T', source, database], timeout=120)
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


def execute_live_sync(target, source_sql, progress, *, retained, apply_reconstruction):
    if type(target) is not NativeTimestampTarget:
        raise ValueError('LIVE_SYNC_NATIVE_TARGET_REQUIRED')
    return load_live_sync().execute_boundary(ROOT, target, 'postgres', source_sql, progress,
        retained=retained, apply_reconstruction=apply_reconstruction)
