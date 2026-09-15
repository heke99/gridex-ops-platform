"""Offline admission and preservation tests; actual PG17 behavior is a CI gate."""
import copy
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/canonical-inbound-service-privileges-selftest.py'


def load():
    if not SCRIPT.is_file():
        raise AssertionError('inbound service-only fixture is not implemented')
    spec = importlib.util.spec_from_file_location('inbound_service_fixture', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class InboundServicePrivilegesTests(unittest.TestCase):
    def test_pinned_selection_without_sql_tools(self):
        self.assertTrue(SCRIPT.is_file(), 'inbound service-only fixture is not implemented')
        result = subprocess.run([sys.executable, '-B', str(SCRIPT), '--selection-only'],
                                cwd=ROOT, env={'PATH': ''}, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('SELECTION_ONLY_NOT_SQL', result.stdout)
        self.assertNotIn('cleanupVerified', result.stdout)

    def test_external_target_option_is_rejected_without_echo(self):
        self.assertTrue(SCRIPT.is_file(), 'inbound service-only fixture is not implemented')
        result = subprocess.run([sys.executable, '-B', str(SCRIPT), '--database-url=private_canary'],
                                cwd=ROOT, env={'PATH': ''}, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('private_canary', result.stdout + result.stderr)

    def test_changed_bytes_and_symlink_fail_closed(self):
        module = load()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'candidate.sql'
            path.write_bytes(b'select secret_canary;')
            with self.assertRaises(ValueError):
                module.read_candidate(path)
            path.write_bytes(module.CANDIDATE.read_bytes())
            link = Path(directory) / 'link.sql'
            link.symlink_to(path)
            with self.assertRaises(ValueError):
                module.read_candidate(link)

    def test_exact_oracle_rejects_omitted_removal_and_other_changes(self):
        module = load()
        before = dict(acl=[
            ['public', 'inbound_ediel_match_attempts', 'postgres', 'authenticated', 'SELECT', False],
            ['public', 'inbound_ediel_match_attempts', 'postgres', 'authenticated', 'TRUNCATE', False],
            ['public', 'inbound_ediel_match_attempts', 'postgres', 'service_role', 'TRUNCATE', False],
            ['public', 'outside_inbound', 'postgres', 'authenticated', 'TRIGGER', False],
            ['control', 'inbound_ediel_match_attempts', 'postgres', 'authenticated', 'SELECT', False],
            ['public', 'inbound_ediel_match_attempts', 'postgres', 'anon', 'SELECT', False],
        ], rows={'public.inbound_ediel_match_attempts': [{'id': 1, 'value': 'retained'}]},
           catalog={'policy': 'false', 'column_acl': [], 'rls': True})
        after = copy.deepcopy(before)
        del after['acl'][:2]
        module.verify_delta(before, after)
        module.verify_delta(after, after)
        for change in [
            lambda x: x['acl'].append(before['acl'][0]),
            lambda x: x['acl'].pop(0),
            lambda x: x['acl'].pop(1),
            lambda x: x['acl'].pop(2),
            lambda x: x['acl'].pop(3),
            lambda x: x['acl'][0].__setitem__(5, True),
            lambda x: x['rows']['public.inbound_ediel_match_attempts'][0].__setitem__('value', 'changed'),
            lambda x: x['catalog'].__setitem__('policy', 'true'),
            lambda x: x['catalog'].__setitem__('column_acl', ['new']),
        ]:
            damaged = copy.deepcopy(after)
            change(damaged)
            with self.assertRaisesRegex(ValueError, '^EXACT_INBOUND_ACL_DELTA_REQUIRED$'):
                module.verify_delta(before, damaged)


if __name__ == '__main__':
    unittest.main()
