#!/usr/bin/env python3
"""Offline boundary controls; PostgreSQL proof is run by native CI separately."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'scripts'))
import canonical_native_timestamp_proof as proof

PROJECT = 'gridex-sb-' + 'a'*12 + '-' + 'b'*16

class Transport:
    def __init__(self):
        self.calls = []
        self.databases = {'postgres': 1}
        self.next_oid = 2
        self.inspect = [{'Name': '/supabase_db_'+PROJECT, 'State': {'Running': True},
            'Config': {'Image': 'public.ecr.aws/supabase/postgres:17.6.1.084',
                       'Labels': {'com.supabase.cli.project': PROJECT}},
            'Image': 'sha256:'+'a'*64,
            'NetworkSettings': {'Networks': {PROJECT+'-network': {}}}}]
        self.network = [{'Name': PROJECT+'-network', 'Internal': True,
                         'Labels': {'gridex.native.owner': PROJECT}}]
        self.result = None
    def __call__(self, args, **kwargs):
        self.calls.append((args, kwargs))
        if args[:2] == ['docker', 'inspect']:
            output = self.inspect
        elif args[:3] == ['docker', 'network', 'inspect']:
            output = self.network
        elif 'createdb' in args:
            self.databases[args[-1]] = self.next_oid; self.next_oid += 1
            output = None
        elif 'dropdb' in args:
            self.databases.pop(args[-1], None); output = None
        elif b"FROM pg_database WHERE datname='" in kwargs.get('data', b''):
            query = kwargs['data'].decode()
            name = query.split("datname='")[1].split("'")[0]
            output = self.databases.get(name)
            # psql renders SQL NULL as an empty field; only explicit JSON null
            # produces the bytes json.loads can decode for an absent database.
            if output is None and "'null'::json" not in query:
                return subprocess.CompletedProcess(args, 0, b'\n', b'')
        elif self.result is not None:
            return self.result
        else:
            output = True
        return subprocess.CompletedProcess(args, 0, json.dumps(output).encode()+b'\n', b'')

class BoundaryTests(unittest.TestCase):
    def setUp(self):
        self.transport = Transport()
        self.target = proof.NativeTimestampTarget(self.transport, PROJECT)
        # Maintenance SQL has its own faithful boundary suite. Keep these
        # existing transport/clone tests focused on OIDs and error projection.
        def quiesced(target, destination):
            return target._run(['docker','exec',target.name,'createdb','-U','postgres',
                                '--maintenance-db=template1','-T','postgres',destination],
                               timeout=120,allow_failure=True)
        current = patch('canonical_native_clone_quiesce.create_from_postgres',side_effect=quiesced)
        current.start(); self.addCleanup(current.stop)

    def test_arbitrary_project_rejected_before_io(self):
        for name in ('production', PROJECT+'x', 'https://x.supabase.co'):
            t = Transport()
            with self.assertRaisesRegex(ValueError, 'NATIVE_TIMESTAMP_OWNER_REQUIRED'):
                proof.NativeTimestampTarget(t, name)
            self.assertEqual(t.calls, [])

    def test_real_container_and_internal_network_ownership_required(self):
        for path, value in ((('Config','Labels','com.supabase.cli.project'),'wrong'),
                            (('State','Running'),False), (('Name',),'/production')):
            t = Transport(); item = t.inspect[0]
            for key in path[:-1]: item = item[key]
            item[path[-1]] = value
            with self.assertRaisesRegex(ValueError, 'NATIVE_TIMESTAMP_CONTAINER_REQUIRED'):
                proof.NativeTimestampTarget(t, PROJECT)
        t = Transport(); t.network[0]['Internal'] = False
        with self.assertRaisesRegex(ValueError, 'NATIVE_TIMESTAMP_NETWORK_REQUIRED'):
            proof.NativeTimestampTarget(t, PROJECT)

    def test_external_or_uncreated_database_is_rejected_without_sql(self):
        for database in ('production', 'gridex_auth_legacy_replay', proof.CLONES[0]):
            before = len(self.transport.calls)
            with self.assertRaises(ValueError): self.target.sql(database, 'SELECT 1')
            self.assertEqual(len(self.transport.calls), before)

    def test_primary_database_can_never_be_reset_or_dropped(self):
        before = len(self.transport.calls)
        with self.assertRaises(ValueError): self.target.reset('postgres')
        with self.assertRaises(ValueError): self.target.drop_clone('postgres')
        self.assertEqual(len(self.transport.calls), before)

    def test_preexisting_clone_is_never_removed(self):
        name = proof.CLONES[0]; self.transport.databases[name] = 123
        with self.assertRaisesRegex(ValueError, 'NATIVE_TIMESTAMP_PREEXISTING_CLONE'):
            self.target.clone('postgres', name)
        self.assertFalse(any('dropdb' in args or 'createdb' in args for args, _ in self.transport.calls))

    def test_absent_clone_identity_is_explicit_json_null(self):
        self.assertIsNone(self.target._oid(proof.CLONES[0]))
        self.assertFalse(any('dropdb' in args or 'createdb' in args for args, _ in self.transport.calls))

    def test_owned_clone_replacement_checks_database_oid(self):
        name = proof.CLONES[0]; self.target.clone('postgres', name)
        self.transport.databases[name] = 999
        before = len(self.transport.calls)
        with self.assertRaisesRegex(ValueError, 'NATIVE_TIMESTAMP_CLONE_OWNERSHIP'):
            self.target.drop_clone(name)
        self.assertFalse(any('dropdb' in args for args, _ in self.transport.calls[before:]))

    def test_clone_oid_replacement_denies_queries_as_well_as_deletion(self):
        name = proof.CLONES[0]; self.target.clone('postgres', name)
        self.transport.databases[name] = 999
        with self.assertRaisesRegex(ValueError, 'NATIVE_TIMESTAMP_CLONE_OWNERSHIP'):
            self.target.sql(name, 'SELECT true')

    def test_replaced_clone_cannot_be_used_as_template_or_admitted_command(self):
        source, destination = proof.CLONES[:2]
        self.target.clone('postgres', source)
        self.target.clone('postgres', destination)
        self.transport.databases[source] = 999
        for operation in (lambda: self.target.command(source),
                          lambda: self.target.clone(source, destination),
                          lambda: self.target._create(proof.CLONES[2], source)):
            before = len(self.transport.calls)
            with self.assertRaisesRegex(ValueError, 'NATIVE_TIMESTAMP_CLONE_OWNERSHIP'):
                operation()
            self.assertFalse(any('dropdb' in args or 'createdb' in args
                                 for args, _ in self.transport.calls[before:]))
        self.assertIn(destination, self.transport.databases)

    def test_clone_lifecycle_and_sql_use_only_same_container_socket(self):
        name = proof.CLONES[0]; self.target.clone('postgres', name)
        self.target.sql(name, 'SELECT true', transaction=False)
        self.target.drop_clone(name)
        with self.assertRaises(ValueError): self.target.sql(name, 'SELECT true')
        for args, _ in self.transport.calls:
            self.assertNotIn('--db-url', args); self.assertNotIn('-h', args)
            if 'psql' in args: self.assertIn('supabase_db_'+PROJECT, args)

    def failed_clone_command(self, operation, stderr):
        original = self.transport
        def command(args, **options):
            if operation in args:
                original.calls.append((args, options))
                if options.get('allow_failure') is not True:
                    raise ValueError('NATIVE_COMMAND_FAILED')
                return subprocess.CompletedProcess(args, 1, b'private output', stderr)
            return original(args, **options)
        self.target._run = command

    def test_create_failures_have_closed_diagnostics_and_never_claim_ownership(self):
        prefix = b'createdb: error: database creation failed: ERROR:  '
        cases = (
            (prefix+b'source database "postgres" is being accessed by other users\nDETAIL:  private connection details\n', 'SOURCE_DATABASE_IN_USE'),
            (prefix+b'permission denied to copy database "postgres"\n', 'COPY_OWNER_DENIED'),
            (prefix+b'permission denied to create database\n', 'CREATE_PERMISSION_DENIED'),
            (prefix+b'private unknown failure\n', 'OTHER'),
            (b'NOTICE: permission denied to create database\n'+prefix+b'unknown\n', 'OTHER'),
            (prefix+b'permission denied to copy database "private_other"\n', 'OTHER'),
            (prefix+b'permission denied to create database\n'+prefix+b'unknown\n', 'OTHER'),
            (prefix+b'permission denied to create database private suffix\n', 'OTHER'),
        )
        for stderr, reason in cases:
            with self.subTest(reason=reason):
                self.failed_clone_command('createdb', stderr)
                with self.assertRaises(ValueError) as error:
                    self.target.clone('postgres', proof.CLONES[0])
                self.assertEqual(str(error.exception), 'NATIVE_TIMESTAMP_CLONE_CREATE_'+reason)
                self.assertNotIn(proof.CLONES[0], self.target._owned)
                self.assertNotIn(proof.CLONES[0], self.transport.databases)

    def test_failed_drop_preserves_ownership_for_cleanup_retry(self):
        name = proof.CLONES[0]
        self.target.clone('postgres', name)
        owned = dict(self.target._owned)
        self.failed_clone_command('dropdb', b'dropdb: error: database removal failed: ERROR: private failure\n')
        with self.assertRaises(ValueError) as error:
            self.target.drop_clone(name)
        self.assertEqual(str(error.exception), 'NATIVE_TIMESTAMP_CLONE_DROP_OTHER')
        self.assertEqual(self.target._owned, owned)
        self.assertIn(name, self.transport.databases)
        self.target._run = self.transport
        self.target.drop_clone(name)
        self.assertNotIn(name, self.target._owned)

    def test_clone_diagnostics_are_exact_lifecycle_allowlist_values(self):
        spec = importlib.util.spec_from_file_location('clone_diagnostic_lifecycle',
            ROOT/'scripts/canonical-native-supabase-lifecycle.py')
        lifecycle = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(lifecycle)
        codes = ['NATIVE_TIMESTAMP_CLONE_CREATE_'+reason for reason in
                 ('SOURCE_DATABASE_IN_USE','COPY_OWNER_DENIED','CREATE_PERMISSION_DENIED','OTHER')]
        codes.append('NATIVE_TIMESTAMP_CLONE_DROP_OTHER')
        for code in codes:
            self.assertEqual(lifecycle.failure_code(ValueError(code), None), code)
            self.assertIsNone(lifecycle.failure_code(ValueError(code+' private details'), None))

    def test_psql_stdin_is_an_explicit_script_for_transaction_mode(self):
        # PostgreSQL17 -1 requires -c or -f; bare piped stdin is insufficient.
        base = ['docker', 'exec', '-i', '-e', 'PGOPTIONS=-c search_path=public,extensions',
                'supabase_db_'+PROJECT, 'psql', '-X', '-U', 'postgres', '-d', 'postgres',
                '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-qAt', '-f', '-']
        self.assertEqual(self.target.command('postgres'), base+['--single-transaction'])
        self.assertEqual(self.target.command('postgres', transaction=False), base)

    def test_snapshot_admin_operations_are_finite_owned_clone_only(self):
        from canonical_native_timestamp_snapshot import ADMIN_CONTROLS
        for case in ('arbitrary SQL', 'production', None):
            before = len(self.transport.calls)
            with self.assertRaisesRegex(ValueError, 'NATIVE_TIMESTAMP_SNAPSHOT_ADMIN_CASE_REQUIRED'):
                self.target.snapshot_admin_control(case)
            self.assertEqual(len(self.transport.calls), before)
        with self.assertRaisesRegex(ValueError, 'NATIVE_TIMESTAMP_DATABASE_REQUIRED'):
            self.target.snapshot_admin_control('setup')
        clone = 'gridex_native_timestamp_phase'
        self.target.clone('postgres', clone)
        for case in ADMIN_CONTROLS:
            self.target.snapshot_admin_control(case)
            args, options = self.transport.calls[-1]
            self.assertEqual(args[args.index('-d')+1], clone)
            self.assertEqual(args[args.index('-h')+1], '127.0.0.1')
            self.assertEqual(args[args.index('-U')+1], 'supabase_admin')
            self.assertIn('supabase_db_' + PROJECT, args)
            self.assertTrue(options['data'].endswith(ADMIN_CONTROLS[case].encode()))
            self.assertIn(b'IS DISTINCT FROM true THEN RAISE', options['data'])
            self.assertIn(b'inet_server_port()=5432', options['data'])
        self.transport.databases[clone] = 999
        with self.assertRaisesRegex(ValueError, 'NATIVE_TIMESTAMP_CLONE_OWNERSHIP'):
            self.target.snapshot_admin_control('event_trigger')

    def test_snapshot_admin_sql_failure_is_never_certified(self):
        self.target.clone('postgres', 'gridex_native_timestamp_phase')
        self.transport.result = subprocess.CompletedProcess([], 3, b'', b'ERROR: 42501: denied')
        with self.assertRaisesRegex(ValueError, 'NATIVE_TIMESTAMP_SNAPSHOT_ADMIN_REQUIRED'):
            self.target.snapshot_admin_control('setup')

    def test_failed_sql_requires_exact_primary_sqlstate(self):
        for stderr, accepted in ((b'ERROR:  42601: private error\n', True),
                                 (b'NOTICE:  42601: forged\nERROR:  23514: real\n', False),
                                 (b'ERROR:  42601: first\nERROR:  23514: second\n', False)):
            self.transport.result = subprocess.CompletedProcess([], 3, b'', stderr)
            if accepted: self.target.sql('postgres', 'bad sql', expect='42601')
            else:
                with self.assertRaisesRegex(ValueError, 'NATIVE_TIMESTAMP_SQL_RESULT'):
                    self.target.sql('postgres', 'bad sql', expect='42601')

    def test_sql_failure_diagnostic_is_closed_and_preserves_strict_rejection(self):
        cases = (
            (b'psql:<stdin>:3: ERROR:  42501: private object and user details\n', 3,
             'INSUFFICIENT_PRIVILEGE', 'ONE', 'NONZERO'),
            (b'NOTICE: 42501: forged\n', 3, 'NONE', 'ZERO', 'NONZERO'),
            (b'ERROR: 42501: first\nERROR: 42601: second\n', 3, 'MULTIPLE', 'MULTIPLE', 'NONZERO'),
            (b'ERROR: QQQQQ: private unrecognized code\n', 3, 'OTHER', 'ONE', 'NONZERO'),
            (b'ERROR: 42501: inconsistent zero exit\n', 0, 'INSUFFICIENT_PRIVILEGE', 'ONE', 'ZERO'),
        )
        for stderr, code, state, count, exit_category in cases:
            self.target._last_sql_failure = None
            self.transport.result = subprocess.CompletedProcess([], code, b'private stdout', stderr)
            with self.assertRaisesRegex(ValueError, '^NATIVE_TIMESTAMP_SQL_RESULT$'):
                self.target.sql('postgres','SELECT private_data','live_sync_behavior_fixture')
            self.assertEqual(self.target._last_sql_failure, dict(
                stage='LIVE_SYNC_BEHAVIOR_FIXTURE',expected='SUCCESS',actual=state,
                primaryErrors=count,exit=exit_category))
        self.transport.result = subprocess.CompletedProcess([],3,b'',b'ERROR: 42601: private\n')
        self.target._last_sql_failure = None
        with self.assertRaises(ValueError): self.target.sql('postgres','private','arbitrary_private_stage',expect='QQQQQ')
        self.assertEqual(self.target._last_sql_failure['stage'],'OTHER')
        self.assertEqual(self.target._last_sql_failure['expected'],'OTHER')

    def test_live_sync_failure_attaches_only_adapter_diagnostic(self):
        progress={'sessionReconstruction':{'nativeBoundaryVerified':False}}
        diagnostic=dict(stage='LIVE_SYNC_BEHAVIOR_MATRIX',expected='SUCCESS',actual='ASSERTION',
                        primaryErrors='ONE',exit='NONZERO')
        live=proof.load_live_sync()
        def failure(*args,**kwargs):
            self.target._last_sql_failure=diagnostic
            raise ValueError('NATIVE_TIMESTAMP_SQL_RESULT')
        with patch.object(proof,'load_live_sync',return_value=live), \
             patch.object(live,'execute_boundary',side_effect=failure):
            with self.assertRaisesRegex(ValueError,'NATIVE_TIMESTAMP_SQL_RESULT'):
                proof.execute_live_sync(self.target,'',progress,retained=None,apply_reconstruction=lambda _:None)
        self.assertEqual(progress['sessionReconstruction']['nativeSqlFailure'],diagnostic)
        self.assertFalse(progress['sessionReconstruction']['nativeBoundaryVerified'])

    def test_mutated_target_rejected(self):
        self.target.name = 'production'
        with self.assertRaisesRegex(ValueError, 'NATIVE_TIMESTAMP_OWNER_REQUIRED'):
            self.target.command('postgres')

    def test_arbitrary_docker_command_is_rejected(self):
        before = len(self.transport.calls)
        with self.assertRaises(ValueError): self.target.docker(['rm', '--force', 'production'])
        self.assertEqual(len(self.transport.calls), before)

    def test_native_live_sync_requires_verified_callback_before_sql(self):
        live = proof.load_live_sync()
        for callback in (None, 'not callable'):
            with self.assertRaisesRegex(ValueError, 'LIVE_SYNC_NATIVE_APPLICATION_REQUIRED'):
                live.execute_boundary(ROOT, self.target, 'postgres', '', {}, apply_reconstruction=callback)

    def test_full_boundary_keeps_controls_and_routes_final_native_application(self):
        live = proof.load_live_sync()
        original = live.fix.read_pinned(ROOT, live.fix.SOURCE, live.fix.SOURCE_SHA256)
        rendered, _ = live.fix.reconstruct(ROOT, original)
        definition, expected = live.fix.function_parts(live.fix.read_pinned(ROOT, live.fix.FORWARD, live.fix.FORWARD_SHA256))
        before = dict(definer=False, body='old', definition='return true;', oid=1, owner=10,
                      acl=None, execute={'anon':False}, volatility='s')
        accepted = dict(before, definer=True, body=expected, definition=definition)
        calls = []
        def sql(database, query, stage='fixture', **kwargs):
            calls.append((database, stage, kwargs)); return ''
        for valid in (False, True):
            progress = {}; callbacks = []
            def apply(text):
                callbacks.append(text)
                return {'ledgerVerified': valid, 'renderedSha256': hashlib.sha256(text.encode()).hexdigest()}
            with patch.object(live, 'clone'), patch.object(live, 'snapshot', return_value=('catalog', 'rows')), \
                    patch.object(live, 'metadata', side_effect=[before, accepted, accepted]), \
                    patch.object(live, 'behavior'), patch.object(live, 'checkpoint'), \
                    patch.object(self.target, 'sql', side_effect=sql), patch.object(self.target, 'docker'):
                if valid:
                    live.execute_boundary(ROOT, self.target, 'postgres', original, progress, apply_reconstruction=apply)
                else:
                    with self.assertRaisesRegex(ValueError, 'LIVE_SYNC_NATIVE_LEDGER_REQUIRED'):
                        live.execute_boundary(ROOT, self.target, 'postgres', original, progress, apply_reconstruction=apply)
            self.assertEqual(callbacks, [rendered])
            self.assertIs(progress['sessionReconstruction']['nativeBoundaryVerified'], valid)
        self.assertFalse(any(stage == 'live_sync_reconstructed_source' for _, stage, _ in calls))
        controls = {stage: kwargs.get('expect') for _, stage, kwargs in calls}
        self.assertEqual(controls['live_sync_original_red'], '42601')
        self.assertEqual(controls['live_sync_injected_rollback'], 'ZX001')
        self.assertEqual(controls['live_sync_preimage_negative'], '55000')

    def test_callback_receipt_is_bound_to_exact_rendered_source(self):
        rendered = 'begin; SELECT true; commit;\n'
        receipt = {'ledgerVerified': True, 'renderedSha256': hashlib.sha256(rendered.encode()).hexdigest()}
        proof.verify_application_receipt(rendered, receipt)
        for changed in ({}, {**receipt, 'ledgerVerified': 1}, {**receipt, 'renderedSha256': 'a'*64}):
            with self.assertRaisesRegex(ValueError, 'LIVE_SYNC_NATIVE_LEDGER_REQUIRED'):
                proof.verify_application_receipt(rendered, changed)

class SnapshotTests(unittest.TestCase):
    def test_projection_covers_non_system_schemas_and_preserves_ledger_separation(self):
        import canonical_native_timestamp_snapshot as snapshot
        catalog, rows = snapshot.queries()
        self.assertNotIn("n.nspname IN ('public','auth','storage')", catalog + rows)
        for query in (catalog, rows):
            self.assertIn("n.nspname !~ '^pg_'", query)
            self.assertIn("n.nspname <> 'information_schema'", query)
        self.assertNotIn("n.nspname='supabase_migrations'", catalog)
        self.assertIn("NOT (n.nspname='supabase_migrations' AND c.relname='schema_migrations')", rows)
        for key in ('schema/', 'extension/', 'event_trigger/', 'type/', 'domain_constraint/'):
            self.assertIn("'" + key, catalog)
        self.assertIn("'acl',t.typacl", catalog)
        self.assertIn("obj_description(e.oid,'pg_extension')", catalog)

    def test_live_sync_native_adapter_uses_the_complete_domain_image(self):
        live = proof.load_live_sync()
        from unittest.mock import Mock
        target = Mock()
        target.snapshot.return_value = ('full catalog', 'all private rows')
        self.assertEqual(live.snapshot(target, 'clone'), target.snapshot.return_value)
        target.snapshot.assert_called_once_with('clone')

    def test_snapshot_controls_require_each_exact_object_and_preserve_parent(self):
        import canonical_native_timestamp_snapshot as snapshot
        from unittest.mock import Mock
        for missed in (None, *[c[0] for c in snapshot.CONTROLS], 'parent'):
            parent = ({'parent': 'before'}, {})
            state = {'clone': ({}, {}), 'dropped': False}
            target = Mock()
            def take(database='postgres'):
                if database == 'postgres':
                    return ({'parent': 'after'}, {}) if missed == 'parent' and state['dropped'] else copy.deepcopy(parent)
                return copy.deepcopy(state['clone'])
            def sql(database, query, stage):
                if stage == 'timestamp_snapshot_setup': return ''
                case = next(c for c in snapshot.CONTROLS if stage == 'timestamp_snapshot_control_' + c[0])
                name, image, key, _ = case
                # An unrelated change must never stand in for the required effect.
                state['clone'][image]['unrelated'] = name
                if name != missed: state['clone'][image][key] = 'changed'
                return ''
            target.snapshot.side_effect = take
            target.sql.side_effect = sql
            target.snapshot_admin_control.side_effect = lambda case: (None if case == 'setup' else sql('gridex_native_timestamp_phase', '', 'timestamp_snapshot_control_' + case))
            target.drop_clone.side_effect = lambda database: state.update(dropped=True)
            with self.subTest(missed=missed):
                if missed:
                    with self.assertRaisesRegex(ValueError, 'NATIVE_TIMESTAMP_SNAPSHOT_'):
                        snapshot.qualify(target)
                else:
                    result = snapshot.qualify(target)
                    self.assertEqual(len(result['cases']), 9)
                    self.assertTrue(result['parentUnchanged'])
                target.drop_clone.assert_called_once_with('gridex_native_timestamp_phase')

    def test_projection_rejects_changed_pinned_catalog(self):
        import canonical_native_timestamp_snapshot as snapshot
        original = Path.read_bytes
        def altered(path):
            raw = original(path)
            return raw + b'--changed' if path.name == 'canonical-user-rbac-repair-catalog.sql' else raw
        with patch.object(Path, 'read_bytes', altered):
            with self.assertRaisesRegex(ValueError, 'NATIVE_TIMESTAMP_SNAPSHOT_SOURCE_REQUIRED'):
                snapshot.queries()

if __name__ == '__main__': unittest.main()
