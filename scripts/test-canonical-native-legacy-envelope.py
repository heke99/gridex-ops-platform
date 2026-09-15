#!/usr/bin/env python3
"""Offline controls for the real legacy52 adapter, not native execution proof."""
import copy
import importlib
import json
from pathlib import Path
import tempfile
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


class EnvelopeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (ROOT/'scripts/canonical_native_legacy_envelope.py').is_file():
            raise AssertionError('Native legacy44-52 implementation is required')
        cls.m = importlib.import_module('canonical_native_legacy_envelope')
        cls.p = importlib.import_module('canonical_native_historical_prefix')

    def setUp(self):
        self.batch, self.sources = self.m.load_sources(self.p)
        self.before = {'relation/public.fixture': {'kind': 'r', 'owner': 'postgres'}}
        self.program = self.m.prepare(self.p, self.batch, self.sources, self.before)

    def test_statement_deadline_is_set_before_the_atomic_body(self):
        self.assertTrue(self.program.sql.startswith(self.m.TIMEOUTS))
        self.assertEqual([tokens[0] for tokens in self.p.identity(self.program.sql.decode())],
                         ['SET', 'SET', 'DO'])
        timeout = next(raw for raw, state, _ in self.m.probes(self.p,self.program) if state=='57014')
        self.assertIn(b'pg_sleep(61)', timeout)
        self.assertIn(self.sources[0].data, timeout)

    def test_permission_diagnostic_cannot_publish_unrelated_error_text(self):
        catalog = {'relation/auth.protected_table': {}, 'relation/public.known': {}}
        known = self.m.permission_diagnostic(b'ERROR: permission denied for table protected_table (SQLSTATE 42501)', catalog)
        self.assertEqual(known, {'category':'TABLE_PERMISSION_DENIED','relation':'auth.protected_table'})
        self.assertEqual(self.m.permission_diagnostic(b'ERROR: permission denied for table secret_person (SQLSTATE 42501)',catalog), {})
        self.assertEqual(self.m.permission_diagnostic(b'private arbitrary SQL text',catalog), {})

    def test_only_exact_unrelated_provider_metadata_gets_read_lock_projection(self):
        before = {**self.before,'relation/auth.schema_migrations': {'kind':'r','owner':'supabase_auth_admin'}}
        program = self.m.prepare(self.p,self.batch,self.sources,before,('auth.schema_migrations',))
        self.assertIn(b"IN ('auth.schema_migrations') THEN",program.sql)
        self.assertIn(b'LOCK TABLE %s IN ACCESS SHARE MODE',program.sql)
        self.assertIn(b'LOCK TABLE %s IN SHARE MODE',program.sql)
        self.assertIn(b'LOCK TABLE %s IN ACCESS EXCLUSIVE MODE',program.sql)
        self.assertNotIn(b'LOCK TABLE %s IN ACCESS SHARE MODE',program.old_permission_probe)
        self.assertEqual([state for _,state,_ in self.m.probes(self.p,program)],
                         ['42501','P5244','57014','P5252','P5253'])
        for relation in ('public.customers','auth.users','auth.future_provider_table'):
            with self.assertRaises(self.p.PrefixError):
                self.m.prepare(self.p,self.batch,self.sources,before,(relation,))
        before['relation/auth.schema_migrations']['owner']='postgres'
        with self.assertRaises(self.p.PrefixError):
            self.m.prepare(self.p,self.batch,self.sources,before,('auth.schema_migrations',))

    def test_native_four_provider_profile_does_not_treat_comments_as_references(self):
        before = {**self.before, **{'relation/'+name:{'kind':'r','owner':owner}
                  for name,owner in self.m.PROVIDER_METADATA.items()}}
        relations = tuple(sorted(self.m.PROVIDER_METADATA))
        program = self.m.prepare(self.p,self.batch,self.sources,before,relations)
        self.assertEqual(program.provider_relations,relations)
        self.assertEqual(len(program.sources),9)
        for source in self.sources:
            self.assertEqual(program.sql.count(source.data),1)
        self.assertEqual([state for _,state,_ in self.m.probes(self.p,program)],
                         ['42501','P5244','57014','P5252','P5253'])

    def test_provider_scan_ignores_only_comments_including_inside_do(self):
        scan = self.m.source_mentions_identifier
        for sql in ("-- migrations\nSELECT 1;", "/* migrations */ SELECT 1;",
                    "DO $$ BEGIN /* migrations */ PERFORM 1; END $$;"):
            self.assertFalse(scan(self.p,sql,'migrations'))
        for sql in ('SELECT * FROM storage.migrations;', 'SELECT * FROM storage."migrations";',
                    "DO $$ BEGIN DELETE FROM storage.migrations; END $$;",
                    "DO $$ BEGIN EXECUTE 'DELETE FROM storage.migrations'; END $$;",
                    "DO $x$ BEGIN EXECUTE $sql$DELETE FROM storage.migrations$sql$; END $x$;"):
            self.assertTrue(scan(self.p,sql,'migrations'))

    def test_all_nine_whole_sources_are_one_atomic_cli_unit(self):
        m, p = self.m, self.p
        self.assertEqual(len(self.sources), 9)
        self.assertEqual([s.alias for s in self.sources], list('ABCDEFHIQ'))
        self.assertEqual([x['ordinal'] for x in self.program.sources], list(range(44, 53)))
        self.assertEqual(len(p.identity(self.program.sql.decode())), 3)
        self.assertEqual(p.identity(self.program.sql.decode())[-1][0], 'DO')
        self.assertEqual(self.program.name, 'gridex_native_f0044_0052_'+p.sha(self.program.sql)[:12])
        for source in self.sources:
            self.assertEqual(self.program.sql.count(source.data), 1)
        text = self.program.sql.decode()
        self.assertLess(text.index('pg_advisory_xact_lock'), text.index(self.sources[0].data.decode()))
        self.assertLess(text.index(self.sources[-1].data.decode()), text.index('Final assertions run'))
        self.assertIn('ON COMMIT DROP', text)
        self.assertIn('read committed', text)
        self.assertNotIn('SET TRANSACTION', text)
        self.assertNotIn('COMMIT;', text)
        self.assertNotIn('INSERT INTO supabase_migrations', text)

    def test_final_source_cannot_run_as_an_independent_migration(self):
        with self.assertRaises(self.p.PrefixError):
            self.m.prepare(self.p, self.batch, self.sources[-1:], self.before)

    def test_changed_or_reordered_sources_and_support_are_rejected(self):
        for sources in (self.sources[::-1], self.sources[:-1]):
            with self.assertRaises(self.p.PrefixError):
                self.m.prepare(self.p, self.batch, sources, self.before)
        with patch.object(self.m, 'PINS', {**self.m.PINS, next(iter(self.m.PINS)): '0'*64}):
            with self.assertRaises(self.p.PrefixError):
                self.m.load_sources(self.p)

    def test_comment_and_quoted_content_are_not_flattened(self):
        # This marker is quoted as data, never allowed to close the outer body.
        before = {'quoted': "' COMMIT; $gridex_native_legacy52$ --\n"}
        with self.assertRaises(self.p.PrefixError):
            self.m.prepare(self.p, self.batch, self.sources, before)
        raw = self.program.sql
        self.assertNotIn(b'BEGIN;\n', raw[:80])
        self.assertTrue(raw.endswith(b'END\n$gridex_native_legacy52$;\n'))

    def test_actual_ledger_requires_whole_execution_body(self):
        name = '20260914190000_'+self.program.name+'.sql'
        entry = {'version': name[:14], 'name': self.program.name,
                 'statements': ["SET LOCAL lock_timeout = '10s'", "SET LOCAL statement_timeout = '60s'",
                     self.program.sql[len(self.m.TIMEOUTS):].decode().rstrip().removesuffix(';')]}
        self.p.verify_entry(entry, name, self.program)
        for bad in (["SELECT 1"], entry['statements']*2,
                    [*entry['statements'][:-1],entry['statements'][-1].replace('stage=\'completed\'', 'stage=\'Q\'')]):
            with self.assertRaises(self.p.PrefixError):
                self.p.verify_entry({**entry, 'statements': bad}, name, self.program)

    def test_baseline_must_come_from_verified_first43(self):
        for previous in ({}, {'historicalPrefixLedgerVerified': True},
                         {'historicalPrefixLedgerVerified': True, 'foundationInputsExecuted': 52}):
            with tempfile.TemporaryDirectory() as d, self.assertRaises(self.p.PrefixError):
                self.m.execute(self.p, lambda *a, **k: self.fail('CLI called'),
                               lambda *a: self.fail('SQL called'), Path(d), previous, {})

    def test_original_limit_and_full_release_guard_remain(self):
        self.assertEqual(self.p.LIMIT, 43)
        self.assertEqual(len(self.p.prepare()), 43)
        self.assertIn('NATIVE_LATER_ENVELOPES_AND_FULL_ACCEPTANCE_REQUIRED',
                      (ROOT/'scripts/canonical-auth-provisioning-replay.py').read_text())

    def test_failure_probes_keep_sources_exact_and_check_ledger_boundary(self):
        probes = self.m.probes(self.p, self.program)
        self.assertEqual([state for _, state, _ in probes], ['P5244', '57014', 'P5252', 'P5253'])
        for raw, _, _ in probes:
            self.assertIn(self.sources[0].data, raw)
            self.assertEqual(raw.count(self.sources[0].data), 1)
        guard = self.m.ledger_guard('gridex_native_f0044_0052_'+'a'*12)
        for expected in ('SECURITY INVOKER', "locktype='advisory'", 'AccessExclusiveLock',
                         'legacy_context', 'completed', 'txid_current', '10 seconds', '60 seconds'):
            self.assertIn(expected, guard)
        self.assertNotIn('SECURITY DEFINER', guard)
        self.assertNotIn('true::json', guard)
        with self.assertRaises(ValueError):
            self.m.ledger_guard("unexpected'; DROP SCHEMA public;")

    def test_cli_transport_admits_only_whole_44_52_name_and_no_future_sources(self):
        transport = importlib.import_module('canonical_native_cli_transport')
        project = 'gridex-sb-45c3b5c5b510-0123456789abcdef'
        original = Path.stat
        def socket_stat(path, **kwargs):
            if str(path) == '/var/run/docker.sock':
                return SimpleNamespace(st_mode=stat.S_IFSOCK|0o660, st_gid=123)
            return original(path, **kwargs)
        with tempfile.TemporaryDirectory() as d, patch.object(Path, 'stat', socket_stat):
            base = Path(d); work = base/(project+'-private'); work.mkdir(mode=0o700)
            cli = base/'supabase'; cli.write_text('fixture')
            (base/'supabase-go').write_text('fixture')
            args = transport.cli_command(cli, work, project, ('migration', 'new', self.program.name))
            self.assertEqual(args[-3:], ['migration', 'new', self.program.name])
            for name in ('gridex_native_f0044_'+'a'*12, 'gridex_native_f0053_'+'a'*12,
                         self.program.name+'extra', self.program.name.replace('0052', '0053')):
                with self.assertRaisesRegex(ValueError, 'FIXED_NATIVE_CLI_COMMAND_REQUIRED'):
                    transport.cli_command(cli, work, project, ('migration', 'new', name))

    def test_support_and_original_sources_stay_byte_identical(self):
        for name, digest in self.m.PINS.items():
            self.assertEqual(self.p.sha((ROOT/'scripts'/name).read_bytes()), digest)
        manifest = json.loads((ROOT/'scripts/migration-history-manifest.json').read_text())['files']
        for source in self.sources:
            self.assertEqual(self.p.sha(source.data), manifest[source.path.name])


class ProofRuntimeTests(unittest.TestCase):
    def exercise(self, fault=None):
        m = importlib.import_module('canonical_native_legacy_envelope')
        p = importlib.import_module('canonical_native_historical_prefix')
        batch, sources = m.load_sources(p)
        program = m.prepare(p, batch, sources, {'relation/public.fixture': {'kind': 'r'}})
        expected = [{'version': '20260914190000', 'name': 'earlier', 'statements': ['SELECT 1']}]
        state = {'run': 0, 'created': 0, 'guard': False}
        report = {}
        with tempfile.TemporaryDirectory() as d:
            directory = Path(d); directory.chmod(0o700)
            old = directory/'20260914190000_earlier.sql'; old.write_bytes(b'SELECT 1;'); old.chmod(0o600)
            meta = old.stat(); retained = [(old, b'SELECT 1;', (meta.st_dev, meta.st_ino))]
            def native(*args, **kwargs):
                if args[:2] == ('migration', 'new'):
                    state['created'] += 1
                    filename = '2026091419000'+str(state['created'])+'_'+args[2]+'.sql'
                    (directory/filename).write_text('')
                    return SimpleNamespace(returncode=0, stdout=b'', stderr=b'')
                self.assertEqual(args, ('migration', 'up', '--local'))
                self.assertTrue(kwargs['allow_failure'])
                state['run'] += 1
                if state['run'] == 4: self.assertTrue(state['guard'])
                wanted = ['P5244', '57014', 'P5252', 'P5253'][state['run']-1]
                if fault == 'file': old.write_bytes(b'SELECT 2;')
                return SimpleNamespace(returncode=0 if fault == 'success' else 1, stdout=b'',
                    stderr=('SQLSTATE '+('P5200' if fault == 'wrong-state' else wanted)).encode())
            def sql(query):
                if query == p.LEDGER_SQL:
                    return expected+[{'fabricated': True}] if fault == 'ledger' else copy.deepcopy(expected)
                if query == m.DROP_GUARD:
                    state['guard'] = False
                    return fault != 'cleanup'
                self.assertIn('CREATE TRIGGER gridex_native_legacy52_guard', query)
                state['guard'] = True
                return True
            def snapshot():
                return {'rows': 2 if state['run'] and fault == 'rollback' else 1}
            with patch.object(m.time, 'sleep'):
                if fault:
                    with self.assertRaises(p.PrefixError):
                        m.qualify(p, native, sql, directory, program, expected, retained, snapshot, report)
                    self.assertFalse(report['verified'])
                else:
                    m.qualify(p, native, sql, directory, program, expected, retained, snapshot, report)
                    self.assertTrue(report['verified'])
                    self.assertEqual(len(report['cases']), 4)
                    self.assertEqual({x.name for x in directory.iterdir()}, {old.name})
                    self.assertFalse(state['guard'])

    def test_real_control_flow_passes_all_four_probes(self): self.exercise()
    def test_unexpected_success_is_rejected(self): self.exercise('success')
    def test_wrong_sqlstate_is_rejected(self): self.exercise('wrong-state')
    def test_changed_ledger_is_rejected(self): self.exercise('ledger')
    def test_failed_rollback_is_rejected(self): self.exercise('rollback')
    def test_failed_helper_disposal_is_rejected(self): self.exercise('cleanup')
    def test_changed_previous_cli_file_is_rejected(self): self.exercise('file')


if __name__ == '__main__':
    unittest.main(verbosity=2)
