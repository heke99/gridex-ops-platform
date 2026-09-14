#!/usr/bin/env python3
"""Reject incomplete authorization comparisons and bootstrap source drift."""
import copy
import hashlib
import importlib.util
import json
from types import SimpleNamespace
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
        calls = []
        native = matrix(); old = copy.deepcopy(native)
        for row in old['grants']:
            if row['kind'] in ('table', 'sequence') and row['role'] != 'postgres':
                row['allowed'] = False
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
                database = args[args.index('-d')+1]
                if fail == 'collision' and data == m.PROBES.encode() and database == 'postgres':
                    raise ValueError('probe collision')
                if fail == 'bootstrap' and data == m.sources()[0]:
                    raise ValueError('bootstrap failure')
                if data == m.CAPTURE.encode():
                    value = old if database == 'gridex_bootstrap_before' else native
                    if fail == 'comparison' and database == 'gridex_bootstrap_after':
                        value = {**native, 'rlsEnabled': False}
            elif fail == 'drop' and 'dropdb' in args and args[-1] == 'gridex_bootstrap_after':
                raise ValueError('drop failure')
            return SimpleNamespace(stdout=json.dumps(value).encode())
        return command, calls

    def test_all_three_databases_are_compared_then_owned_probes_removed(self):
        command, calls = self.fixture()
        result = m.verify(command, self.project)
        self.assertTrue(result['nativeDefaultGrantsMatched'])
        self.assertEqual(result['oldBootstrapMissingPrivileges'], 33)
        self.assertFalse(result['fullReplayAccepted'])
        captures = [a[a.index('-d')+1] for a, d in calls if d == m.CAPTURE.encode()]
        self.assertEqual(captures, ['postgres', 'gridex_bootstrap_before', 'gridex_bootstrap_after'])
        self.assertEqual([a[-1] for a, d in calls if 'dropdb' in a],
                         ['gridex_bootstrap_after', 'gridex_bootstrap_before'])
        self.assertEqual(calls[-1][1], m.DROP.encode())
        self.assertFalse(any('--linked' in a or '--db-url' in a for a, d in calls))

    def test_unowned_or_external_runtime_never_executes_sql(self):
        for options in ({'wrong_owner': True}, {'external_network': True}):
            command, calls = self.fixture(**options)
            with self.assertRaises(ValueError): m.verify(command, self.project)
            self.assertFalse(any(a[:2] == ['docker', 'exec'] for a, d in calls))

    def test_failed_setup_does_not_drop_preexisting_objects(self):
        command, calls = self.fixture(fail='collision')
        with self.assertRaisesRegex(ValueError, 'probe collision'): m.verify(command, self.project)
        self.assertFalse(any('dropdb' in a or d == m.DROP.encode() for a, d in calls))

    def test_failure_discards_only_successfully_created_databases(self):
        command, calls = self.fixture(fail='bootstrap')
        with self.assertRaisesRegex(ValueError, 'bootstrap failure'): m.verify(command, self.project)
        self.assertEqual([a[-1] for a, d in calls if 'dropdb' in a], ['gridex_bootstrap_before'])
        self.assertEqual(calls[-1][1], m.DROP.encode())

    def test_mismatch_fails_after_cleanup_without_success(self):
        command, calls = self.fixture(fail='comparison')
        with self.assertRaisesRegex(ValueError, 'AUTHORIZATION_MISMATCH'): m.verify(command, self.project)
        self.assertEqual(len([a for a, d in calls if 'dropdb' in a]), 2)
        self.assertEqual(calls[-1][1], m.DROP.encode())

    def test_failed_drop_still_attempts_all_remaining_cleanup(self):
        command, calls = self.fixture(fail='drop')
        with self.assertRaisesRegex(ValueError, 'PROBE_DISPOSAL_REQUIRED'): m.verify(command, self.project)
        self.assertEqual(len([a for a, d in calls if 'dropdb' in a]), 2)
        self.assertEqual(calls[-1][1], m.DROP.encode())


if __name__ == '__main__':
    unittest.main(verbosity=2)
