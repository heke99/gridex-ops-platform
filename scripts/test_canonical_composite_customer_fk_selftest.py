"""Offline trust-boundary checks; PostgreSQL behavior needs the native fixture."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/canonical-composite-customer-fk-selftest.py'


def load_fixture():
    spec = importlib.util.spec_from_file_location('composite_fk_fixture', SCRIPT)
    fixture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixture)
    return fixture


class CompositeCustomerFkFixtureTests(unittest.TestCase):
    def test_selection_needs_no_database_executable(self):
        result = subprocess.run([sys.executable, str(SCRIPT), '--selection-only'],
                                cwd=ROOT, env={'PATH': ''}, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('PASS immutable selections; seven validated artifact row hashes', result.stdout)
        self.assertNotIn('PASS PostgreSQL17', result.stdout)

    def test_changed_source_is_rejected_before_selection(self):
        if not SCRIPT.is_file():
            self.fail('fixture implementation missing')
        fixture = load_fixture()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'source.sql'
            path.write_text('select secret_fixture_canary;')
            with self.assertRaisesRegex(ValueError, '^IMMUTABLE_SOURCE_CHANGED$'):
                fixture.read_pinned(path, '0' * 64)
            link = Path(directory) / 'link.sql'
            link.symlink_to(path)
            with self.assertRaisesRegex(ValueError, '^IMMUTABLE_SOURCE_CHANGED$'):
                fixture.read_pinned(link, fixture.sha(path.read_bytes()))

    def test_database_created_before_timeout_is_owned_and_cleaned(self):
        fixture = load_fixture()
        self.assertTrue(hasattr(fixture, 'owned_database'), 'ownership cleanup missing')
        state = {'database': False, 'role': False}

        def database_boundary(statement, **_):
            if 'create role' in statement:
                state['role'] = True
            elif statement.startswith('create database'):
                state['database'] = True
                raise subprocess.TimeoutExpired('psql', 90)
            elif 'shobj_description' in statement:
                return 't' if state['role'] else 'f'
            elif statement.startswith('select case'):
                return 'owned' if state['database'] else 'absent'
            elif statement.startswith('drop database'):
                state['database'] = False
            elif statement.startswith('drop role'):
                state['role'] = False
            elif statement.startswith('select count(*) from pg_database'):
                return '1' if state['database'] else '0'
            else:
                self.fail('unmodeled database boundary')
            return ''

        with patch.object(fixture, 'sql', side_effect=database_boundary):
            with self.assertRaises(subprocess.TimeoutExpired):
                with fixture.owned_database():
                    self.fail('timeout cannot enter fixture body')
        self.assertEqual(state, {'database': False, 'role': False})

    def test_different_owner_race_is_never_dropped(self):
        fixture = load_fixture()
        self.assertTrue(hasattr(fixture, 'owned_database'), 'ownership cleanup missing')
        destructive = []

        def database_boundary(statement, **_):
            if statement.startswith('create database'):
                raise ValueError('FIXTURE_SQL_FAILED')
            if 'shobj_description' in statement:
                return 't'
            if statement.startswith('select case'):
                return 'unowned'
            if statement.startswith('drop '):
                destructive.append(statement)
            return ''

        with patch.object(fixture, 'sql', side_effect=database_boundary):
            with self.assertRaisesRegex(ValueError, '^FIXTURE_DATABASE_OWNERSHIP_UNPROVED$'):
                with fixture.owned_database():
                    self.fail('failed create cannot enter fixture body')
        self.assertEqual(destructive, [])


if __name__ == '__main__':
    unittest.main()
