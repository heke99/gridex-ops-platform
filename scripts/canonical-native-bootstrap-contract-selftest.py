#!/usr/bin/env python3
"""Reject incomplete authorization comparisons and bootstrap source drift."""
import copy
import hashlib
import importlib.util
import json
from types import SimpleNamespace
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_bootstrap', ROOT/'scripts/canonical_native_bootstrap_contract.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def matrix():
    return {'grants': [{'kind': k, 'role': r, 'privilege': p, 'allowed': True}
                       for k, r, p in sorted(m.EXPECTED_KEYS)],
            'rlsEnabled': True, 'forcedRls': False, 'functionSecurityDefiner': False,
            'publicFunctionExecute': True}


class BootstrapContractTests(unittest.TestCase):
    def test_bootstrap_contains_native_table_and_sequence_defaults(self):
        text = (ROOT/'scripts/sql/gridex-supabase-compatible-bootstrap.sql').read_text()
        self.assertIn(m.NEW, text)
        self.assertNotIn(m.OLD, text)

    def test_exact_old_bootstrap_is_a_red_fixture_not_a_new_baseline(self):
        old, new = m.sources()
        self.assertEqual(hashlib.sha256(old).hexdigest(), m.OLD_SHA)
        self.assertEqual(old.replace(m.OLD.encode(), m.NEW.encode()), new)
        self.assertNotEqual(old, new)

    def test_live_authorization_matrix_is_complete(self):
        value = matrix()
        self.assertEqual(len(value['grants']), 48)
        self.assertEqual(m.validate(value), value)
        for field in ('rlsEnabled', 'forcedRls', 'functionSecurityDefiner', 'publicFunctionExecute'):
            bad = copy.deepcopy(value); bad.pop(field)
            with self.assertRaises(ValueError): m.validate(bad)
        for rows in ([], value['grants'][:-1], value['grants']+[value['grants'][0]]):
            bad = {**value, 'grants': rows}
            with self.assertRaises(ValueError): m.validate(bad)

    def test_untrusted_roles_privileges_and_boolean_lookalikes_rejected(self):
        for field, replacement in [('role', 'private@example.invalid'), ('privilege', 'OTHER'),
                                   ('allowed', 1), ('allowed', None)]:
            bad = matrix(); bad['grants'][0][field] = replacement
            with self.assertRaises(ValueError): m.validate(bad)

    def test_red_control_must_show_only_missing_client_table_and_sequence_grants(self):
        native = matrix(); old = copy.deepcopy(native)
        for row in old['grants']:
            if row['kind'] in ('table', 'sequence') and row['role'] != 'postgres':
                row['allowed'] = False
        self.assertEqual(m.verify_difference(native, old, native), 33)
        with self.assertRaises(ValueError): m.verify_difference(native, native, native)
        with self.assertRaises(ValueError): m.verify_difference(native, old, old)
        changed = copy.deepcopy(old); changed['rlsEnabled'] = False
        with self.assertRaises(ValueError): m.verify_difference(native, changed, native)
        changed = copy.deepcopy(old); changed['grants'][0]['allowed'] = not changed['grants'][0]['allowed']
        with self.assertRaises(ValueError): m.verify_difference(native, changed, native)

    def test_current_or_historical_byte_changes_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'bootstrap.sql'
            path.write_bytes((ROOT/'scripts/sql/gridex-supabase-compatible-bootstrap.sql').read_bytes()+b'\n')
            with patch.object(m, 'BOOTSTRAP', path):
                with self.assertRaises(ValueError): m.sources()

    def test_no_arbitrary_project_is_an_execution_target(self):
        for project in ('piidsfebjqjmnepdpnas', 'main', 'gridex-sb-a', '../x'):
            with self.assertRaises(ValueError): m.verify(lambda *a, **k: self.fail('command ran'), project)


class ExecutionTests(unittest.TestCase):
    project = 'gridex-sb-012345abcdef-0123456789abcdef'

    def fixture(self, fail=None, wrong_owner=False, external_network=False):
        calls = []; portable_calls = []
        native = matrix(); old = copy.deepcopy(native)
        for row in old['grants']:
            if row['kind'] in ('table', 'sequence') and row['role'] != 'postgres':
                row['allowed'] = False
        class Portable:
            active = False
            directory = None
            def __enter__(self):
                self.active = True; self.directory = object()
                return self
            def __exit__(self, *args):
                if fail == 'cleanup':
                    raise ValueError('portable cleanup failure')
                self.active = False; self.directory = None
            def reset(self, database):
                portable_calls.append(('reset', database))
            def sql(self, database, query, stage, **kwargs):
                portable_calls.append((stage, database, query, kwargs))
                if fail == 'bootstrap' and query == m.sources()[0]:
                    raise ValueError('bootstrap failure')
                if query == m.CAPTURE:
                    value = old if database == 'gridex_auth_legacy_native' else native
                    if fail == 'comparison' and database == 'gridex_auth_legacy_atomic':
                        value = {**native, 'rlsEnabled': False}
                    return json.dumps(value)
                return ''
        portable = Portable()
        def command(args, *, data=None):
            calls.append((args, data))
            value = ''
            if args[:2] == ['docker', 'inspect']:
                value = [{'Name': '/supabase_db_'+self.project,
                    'Config': {'Image': 'public.ecr.aws/supabase/postgres:17.6.1.fixture',
                        'Labels': {'com.supabase.cli.project': 'wrong' if wrong_owner else self.project}},
                    'NetworkSettings': {'Networks': {self.project+'-network': {}}}}]
            elif args[:3] == ['docker', 'network', 'inspect']:
                value = [{'Labels': {'gridex.native.owner': self.project}, 'Internal': not external_network}]
            elif data is not None:
                self.assertEqual(args[args.index('-d')+1], 'postgres')
                self.assertIn(data, (m.PROBES.encode(), m.CAPTURE.encode(), m.DROP.encode()))
                if fail == 'collision' and data == m.PROBES.encode():
                    raise ValueError('probe collision')
                if fail == 'native_cleanup' and data == m.DROP.encode():
                    raise ValueError('native cleanup failure')
                if data == m.CAPTURE.encode(): value = native
            return SimpleNamespace(stdout=json.dumps(value).encode())
        return command, calls, portable, portable_calls

    def test_native_and_two_vanilla_databases_are_compared_and_cleaned(self):
        command, calls, portable, local = self.fixture()
        with patch.object(m, 'load_portable', return_value=portable):
            result = m.verify(command, self.project)
        self.assertTrue(result['nativeDefaultGrantsMatched'])
        self.assertEqual(result['oldBootstrapMissingPrivileges'], 33)
        self.assertFalse(result['fullReplayAccepted'])
        self.assertTrue(result['separateVanillaRuntime'])
        self.assertFalse(portable.active); self.assertIsNone(portable.directory)
        self.assertEqual([c[1] for c in local if c[0] == 'reset'],
                         ['gridex_auth_legacy_native', 'gridex_auth_legacy_atomic'])
        self.assertEqual([c[2] for c in local if c[0] == 'bootstrap_complete_input'], list(m.sources()))
        self.assertEqual(calls[-1][1], m.DROP.encode())
        self.assertFalse(any('--linked' in a or '--db-url' in a for a, d in calls))

    def test_unowned_or_external_runtime_never_executes_sql(self):
        for options in ({'wrong_owner': True}, {'external_network': True}):
            command, calls, _, _ = self.fixture(**options)
            with self.assertRaises(ValueError): m.verify(command, self.project)
            self.assertFalse(any(a[:2] == ['docker', 'exec'] for a, d in calls))

    def test_collision_never_drops_existing_objects_or_starts_portable_runtime(self):
        command, calls, _, _ = self.fixture(fail='collision')
        with patch.object(m, 'load_portable') as load:
            with self.assertRaisesRegex(ValueError, 'probe collision'): m.verify(command, self.project)
            load.assert_not_called()
        self.assertFalse(any(d == m.DROP.encode() for a, d in calls))

    def test_bootstrap_and_comparison_failures_still_clean_both_runtimes(self):
        for fail in ('bootstrap', 'comparison'):
            command, calls, portable, _ = self.fixture(fail=fail)
            with patch.object(m, 'load_portable', return_value=portable):
                with self.assertRaises(ValueError): m.verify(command, self.project)
            self.assertFalse(portable.active); self.assertIsNone(portable.directory)
            self.assertEqual(calls[-1][1], m.DROP.encode())

    def test_portable_cleanup_failure_does_not_skip_native_probe_cleanup(self):
        command, calls, portable, _ = self.fixture(fail='cleanup')
        with patch.object(m, 'load_portable', return_value=portable):
            with self.assertRaisesRegex(ValueError, 'portable cleanup failure'): m.verify(command, self.project)
        self.assertEqual(calls[-1][1], m.DROP.encode())

    def test_native_cleanup_failure_cannot_report_success(self):
        command, calls, portable, _ = self.fixture(fail='native_cleanup')
        with patch.object(m, 'load_portable', return_value=portable):
            with self.assertRaisesRegex(ValueError, 'native cleanup failure'): m.verify(command, self.project)
        self.assertFalse(portable.active)

    def test_portable_runtime_does_not_adopt_an_environment_target(self):
        with patch.dict(os.environ, {'GRIDEX_LEGACY_CONTAINER_NAME': 'gridex-auth-legacy-someone-else'}):
            with self.assertRaisesRegex(ValueError, 'GENERATED_PORTABLE_OWNER_REQUIRED'): m.load_portable()


if __name__ == '__main__':
    unittest.main(verbosity=2)
