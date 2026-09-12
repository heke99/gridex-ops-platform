#!/usr/bin/env python3
"""Selection and stop-on-error tests, not evidence of native SQL execution."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]

def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

frontier = load('canonical-foundation-frontier-diagnostic')
tail = load('canonical-timestamp-frontier')

class Target:
    def __init__(self, answer='no', failure=None):
        self.calls = []
        self.answer, self.failure = answer, failure

    def sql(self, database, sql, stage, transaction):
        self.calls.append((database, sql, stage, transaction))
        if stage == self.failure:
            raise RuntimeError('private SQL error with private-value')
        return self.answer if stage == 'timestamp_white_label_probe' else ''

class TimestampTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.foundation, cls.report = frontier.verify_selection(frontier.load_controller())

    def test_exact_source_selector_retains_all_512_tail_inputs(self):
        selected, prerequisites = tail.load_inputs(ROOT, self.report, self.foundation)
        self.assertEqual(len(selected), 512)
        self.assertEqual(len(prerequisites), 5)
        self.assertEqual(len(set(path for path, sha in selected)), 512)
        self.assertEqual(self.report['counts']['UNCLASSIFIED'], 14)
        self.assertEqual(self.report['counts']['SUBSTITUTED'], 19)
        self.assertEqual(selected[-1][0], 'migrations/20260908120000_preserve_gridex_user_has_role_key.sql')
        # Newer prerequisite/boundary migrations execute in the foundation,
        # not at the end of the chronological tail. Do not reorder them.
        self.assertEqual(self.foundation[67], 'migrations/20260911114443_canonical_user_rbac_customer_alignment_boundary.sql')

    def test_changed_shell_pin_fails_before_selector_or_sql(self):
        wrong = dict(self.report, selector=dict(self.report['selector'], sha256='0' * 64))
        with self.assertRaisesRegex(ValueError, 'REPLAY_SHELL_CHANGED'):
            tail.load_inputs(ROOT, wrong, self.foundation)

    def test_changed_foundation_order_is_not_accepted(self):
        with self.assertRaisesRegex(ValueError, 'FOUNDATION_SELECTION_CHANGED'):
            tail.load_inputs(ROOT, self.report, list(reversed(self.foundation)))

    def test_all_boundaries_are_required_once(self):
        selected, prerequisites = tail.load_inputs(ROOT, self.report, self.foundation)
        missing = [source for source in selected if not Path(source[0]).name.startswith('20260902100500_')]
        with self.assertRaisesRegex(ValueError, 'TIMESTAMP_BOUNDARY_CHANGED'):
            tail.validate_boundaries(missing, prerequisites)
        duplicate = selected + [next(source for source in selected if Path(source[0]).name.startswith('20260902100500_'))]
        with self.assertRaisesRegex(ValueError, 'TIMESTAMP_BOUNDARY_CHANGED'):
            tail.validate_boundaries(duplicate, prerequisites)

    def test_source_mutation_symlink_and_escape_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'supabase/migrations').mkdir(parents=True)
            source = root / 'supabase/migrations/test.sql'
            source.write_text('SELECT 1;')
            pin = tail.sha256(source.read_bytes())
            self.assertEqual(tail.read_source(root, ('migrations/test.sql', pin)), 'SELECT 1;')
            source.write_text('SELECT 2;')
            with self.assertRaisesRegex(ValueError, 'SOURCE_HASH_MISMATCH'):
                tail.read_source(root, ('migrations/test.sql', pin))
            source.unlink()
            other = root / 'other.sql'; other.write_text('SELECT 1;')
            source.symlink_to(other)
            with self.assertRaisesRegex(ValueError, 'UNSAFE_SOURCE_PATH'):
                tail.read_source(root, ('migrations/test.sql', pin))
            with self.assertRaisesRegex(ValueError, 'UNSAFE_SOURCE_PATH'):
                tail.read_source(root, ('../other.sql', pin))

    def fixture(self, root):
        (root / 'supabase/migrations').mkdir(parents=True)
        (root / 'supabase/bootstrap').mkdir()
        selected, prerequisites = [], {}
        for ordinal, (prefix, rel) in enumerate(tail.BOUNDARIES.items(), 1):
            source = 'migrations/' + prefix + '_fixture.sql'
            text = f'SELECT {ordinal};'
            (root / 'supabase' / source).write_text(text)
            selected.append((source, tail.sha256(text.encode())))
            text = f'SELECT {ordinal + 10};'
            (root / 'supabase' / rel).write_text(text)
            prerequisites[prefix] = (rel, tail.sha256(text.encode()))
        return selected, prerequisites

    def test_exact_boundary_order_and_no_shim_when_not_needed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); selected, prerequisites = self.fixture(root)
            target, progress = Target(), {}
            tail.execute_tail(root, target, 'owned_test', selected, prerequisites, progress)
            self.assertEqual(progress['timestampApplied'], 5)
            self.assertEqual([call[2] for call in target.calls], [
                'timestamp_prerequisite_1', 'timestamp_1',
                'timestamp_prerequisite_2', 'timestamp_2',
                'timestamp_prerequisite_3', 'timestamp_3',
                'timestamp_prerequisite_4', 'timestamp_4',
                'timestamp_white_label_probe', 'timestamp_5'])
            self.assertTrue(all(call[3] is False for call in target.calls))

    def test_shim_is_removed_only_when_this_run_created_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); selected, prerequisites = self.fixture(root)
            target, progress = Target(answer='yes\n'), {}
            tail.execute_tail(root, target, 'owned_test', selected, prerequisites, progress)
            self.assertEqual([call[2] for call in target.calls][-4:], [
                'timestamp_white_label_probe', 'timestamp_prerequisite_5',
                'timestamp_5', 'timestamp_white_label_cleanup'])
            self.assertEqual(target.calls[-1][1], tail.WHITE_LABEL_DROP)

    def test_unexpected_probe_value_stops_before_migration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); selected, prerequisites = self.fixture(root)
            target, progress = Target(answer='private-value'), {}
            with self.assertRaisesRegex(ValueError, 'UNEXPECTED_SHIM_PROBE_RESULT'):
                tail.execute_tail(root, target, 'owned_test', selected, prerequisites, progress)
            self.assertEqual(progress['timestampApplied'], 4)
            self.assertNotIn('timestamp_5', [call[2] for call in target.calls])

    def test_first_sql_failure_stops_without_retry_or_later_effects(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); selected, prerequisites = self.fixture(root)
            target, progress = Target(failure='timestamp_2'), {}
            with self.assertRaises(RuntimeError):
                tail.execute_tail(root, target, 'owned_test', selected, prerequisites, progress)
            self.assertEqual(progress['timestampApplied'], 1)
            self.assertEqual(progress['timestampOrdinal'], 2)
            self.assertEqual(progress['source'], selected[1][0])
            self.assertEqual(len(target.calls), 4)
            self.assertNotIn('private-value', str(progress))

    def test_postgis_is_explicit_and_never_an_arbitrary_image_or_url(self):
        owned = frontier.load_controller().load_batch()
        self.assertIs(owned.OwnedPostgres()._postgis, False)
        self.assertIs(owned.OwnedPostgres(postgis=True)._postgis, True)
        for value in ('postgres:17', 'postgresql://private', 1, None):
            with self.assertRaises(owned.BoundaryError):
                owned.OwnedPostgres(postgis=value)
        with self.assertRaises(TypeError):
            owned.OwnedPostgres(image='untrusted-image')

    def test_both_profiles_retain_identical_isolation_and_private_logging(self):
        owned = frontier.load_controller().load_batch()
        commands = []
        def stop_after_constructing_command(target, args, **kwargs):
            commands.append(args)
            raise RuntimeError('stop before invoking Docker')
        for spatial in (False, True):
            target = owned.OwnedPostgres(postgis=spatial)
            with patch.object(owned.OwnedPostgres, 'docker', stop_after_constructing_command):
                with self.assertRaisesRegex(RuntimeError, 'stop before invoking Docker'):
                    with target:
                        self.fail('no actual runtime permitted in constructor tests')
            self.assertIsNone(target.directory)
            self.assertFalse(target.active)
        for command in commands:
            self.assertEqual(command[command.index('--network') + 1], 'none')
            self.assertNotIn('-p', command)
            self.assertNotIn('--publish', command)
            self.assertIn('/var/lib/postgresql/data:rw,nosuid,nodev', command)
            self.assertIn('log_min_error_statement=panic', command)
            self.assertIn('log_file_mode=0600', command)
            self.assertTrue(command[command.index('--mount') + 1].endswith(',dst=/legacy-private,readonly'))
        self.assertIn('postgres:17', commands[0])
        self.assertNotIn('postgis/postgis:17-3.5', commands[0])
        self.assertIn('postgis/postgis:17-3.5', commands[1])
        self.assertNotIn('postgres:17', commands[1])

    def test_spatial_runtime_requires_actual_version_extension_image_and_owner(self):
        class Runtime:
            name = _created_name = 'gridex-auth-legacy-continuation-1-1'
            active = True
            def __init__(self, image='postgis/postgis:17-3.5', network='none', owner=None, version='170006|3.5.2'):
                self.inspect = '|'.join((image, 'sha256:' + '1' * 64, network, owner or self.name))
                self.version = version
            def docker(self, args):
                return (self.inspect if args[0] == 'inspect' else self.version).encode()
        result = tail.verify_spatial_runtime(Runtime())
        self.assertEqual(result['serverVersionNum'], 170006)
        self.assertEqual(result['postgisVersion'], '3.5.2')
        for runtime in (Runtime(image='postgres:17'), Runtime(network='bridge'),
                        Runtime(owner='someone-else'), Runtime(version='170006|'),
                        Runtime(version='180001|3.5.2'), Runtime(version='private-value')):
            with self.assertRaisesRegex(ValueError, 'SPATIAL_RUNTIME_REQUIRED'):
                tail.verify_spatial_runtime(runtime)

    def test_source_revalidated_before_each_sql_call(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); selected, prerequisites = self.fixture(root)
            (root / 'supabase' / selected[0][0]).write_text('SELECT 123;')
            target, progress = Target(), {}
            with self.assertRaisesRegex(ValueError, 'SOURCE_HASH_MISMATCH'):
                tail.execute_tail(root, target, 'owned_test', selected, prerequisites, progress)
            self.assertEqual(progress['timestampApplied'], 0)
            self.assertNotIn('timestamp_1', [call[2] for call in target.calls])

if __name__ == '__main__':
    unittest.main()
