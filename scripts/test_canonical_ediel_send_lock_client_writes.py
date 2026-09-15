"""Offline tests of the candidate admission and exact preservation oracle."""
import copy
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/canonical-ediel-send-lock-client-writes-selftest.py'


def load():
    if not SCRIPT.is_file():
        raise AssertionError('send-lock client write fixture is not implemented')
    spec = importlib.util.spec_from_file_location('send_lock_client_writes', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SendLockClientWritesTests(unittest.TestCase):
    def test_selection_runs_without_database_tools(self):
        self.assertTrue(SCRIPT.is_file(), 'send-lock client write fixture is not implemented')
        result = subprocess.run([sys.executable, '-B', str(SCRIPT), '--selection-only'],
                                cwd=ROOT, env={'PATH': ''}, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('SELECTION_ONLY_NOT_SQL', result.stdout)

    def test_untrusted_target_option_fails_without_sql(self):
        self.assertTrue(SCRIPT.is_file(), 'send-lock client write fixture is not implemented')
        result = subprocess.run([sys.executable, '-B', str(SCRIPT), '--database-url=untrusted'],
                                cwd=ROOT, env={'PATH': ''}, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('untrusted', result.stderr)

    def test_existing_role_membership_is_rejected_before_owned_database(self):
        module = load()
        def reply(statement, **kwargs):
            if 'pg_auth_members' in statement:
                return 'f'  # Existing edge, including INHERIT FALSE, is not ours.
            if 'count(*) from pg_database' in statement:
                return '0'
            return 't'
        with mock.patch.object(module.fixture, 'sql', side_effect=reply), \
             mock.patch.object(module.fixture, 'owned_database') as owned, \
             mock.patch.object(sys, 'argv', [str(SCRIPT)]):
            with self.assertRaisesRegex(ValueError, '^PREEXISTING_FIXTURE_ROLE_MEMBERSHIP_REFUSED$'):
                module.run()
            owned.assert_not_called()

    def test_exact_seven_privileges_are_removed_and_select_is_preserved(self):
        module = load()
        privileges = ['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
        before = dict(acl=[['public','ediel_send_locks','postgres','authenticated',p,False]
                           for p in privileges+['SELECT']], rows={}, catalog={'columnAcl': ['SELECT(marker)']})
        after = copy.deepcopy(before)
        after['acl'] = [before['acl'][-1]]
        module.verify_delta(before, after)
        for entry in before['acl'][:-1]:
            damaged = copy.deepcopy(after)
            damaged['acl'].append(entry)
            with self.assertRaisesRegex(ValueError, '^EXACT_CLIENT_WRITE_DELTA_REQUIRED$'):
                module.verify_delta(before, damaged)
        damaged = copy.deepcopy(after)
        damaged['catalog']['columnAcl'] = []
        with self.assertRaisesRegex(ValueError, '^EXACT_CLIENT_WRITE_DELTA_REQUIRED$'):
            module.verify_delta(before, damaged)

    def test_changed_bytes_and_symlink_are_rejected(self):
        module = load()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'candidate.sql'
            path.write_bytes(b'select 1;')
            with self.assertRaises(ValueError):
                module.read_candidate(path)
            path.write_bytes(module.CANDIDATE.read_bytes())
            link = Path(directory) / 'candidate-link.sql'
            link.symlink_to(path)
            with self.assertRaises(ValueError):
                module.read_candidate(link)

    def test_exact_oracle_rejects_other_privilege_role_row_and_catalog_changes(self):
        module = load()
        # Literal ACL tuple layout comes from aclexplode: schema, table, grantor,
        # grantee, privilege, grant option. The expected delta is independent.
        before = dict(acl=[
            ['public', 'ediel_send_locks', 'postgres', 'authenticated', 'UPDATE', False],
            ['public', 'ediel_send_locks', 'postgres', 'authenticated', 'SELECT', False],
            ['public', 'ediel_send_locks', 'postgres', 'service_role', 'TRUNCATE', False],
            ['public', 'outside_targets', 'postgres', 'authenticated', 'TRUNCATE', False],
            ['control', 'ediel_send_locks', 'postgres', 'authenticated', 'TRUNCATE', False],
        ], rows={'public.ediel_send_locks': [{'id': 1, 'marker': 'retained'}]},
            catalog={'policies': [['oid', 'true']], 'rls': True})
        after = copy.deepcopy(before)
        del after['acl'][0]
        module.verify_delta(before, after)
        module.verify_delta(after, after)  # repeat has no remaining target grant
        for field, mutation in [
            ('unrevoked', lambda x: x['acl'].append(before['acl'][0])),
            ('other_privilege', lambda x: x['acl'].pop(0)),
            ('other_role', lambda x: x['acl'].pop(1)),
            ('other_table', lambda x: x['acl'].pop(2)),
            ('other_schema', lambda x: x['acl'].pop(3)),
            ('grant_option', lambda x: x['acl'][0].__setitem__(5, True)),
            ('row_value', lambda x: x['rows']['public.ediel_send_locks'][0].__setitem__('marker', 'changed')),
            ('policy', lambda x: x['catalog']['policies'].append(['extra', 'true'])),
            ('rls', lambda x: x['catalog'].__setitem__('rls', False)),
        ]:
            with self.subTest(field=field):
                damaged = copy.deepcopy(after)
                mutation(damaged)
                with self.assertRaisesRegex(ValueError, '^EXACT_CLIENT_WRITE_DELTA_REQUIRED$'):
                    module.verify_delta(before, damaged)


if __name__ == '__main__':
    unittest.main()
