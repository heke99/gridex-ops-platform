#!/usr/bin/env python3
"""Database-free SQL contract guards; native mutation controls run in whole-source proof."""
import json
import importlib.util
from pathlib import Path
import re
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
import canonical_full_governance_sql as oracle


class JournalAclContract(unittest.TestCase):
    def test_postflight_requires_exact_managed_table_acl(self):
        sql = oracle.complete_postflight_sql()
        journal = next(line for line in sql.split('select test_assert(')
                       if '6D2 journal exact owner/ACL/options/no source comments' in line)
        self.assertNotIn('relacl is null', journal)
        self.assertIn("aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))", journal)
        encoded = re.search(r"='(\[\[.*?\]\])'::jsonb", journal)
        self.assertIsNotNone(encoded, 'journal requires a fixed ACL matrix, not live defaults')
        actual = json.loads(encoded.group(1))
        expected = [[role, privilege, False, 'postgres']
                    for role in ('anon', 'authenticated', 'postgres', 'service_role')
                    for privilege in ('DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES',
                                      'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE')]
        self.assertEqual(actual, expected)
        self.assertNotIn('pg_default_acl', journal)
        for guard in ('relowner=(select oid from pg_roles where rolname=current_user)',
                      'reloptions is null', "obj_description('platform_session_revocations'::regclass) is null",
                      'col_description(attrelid,attnum) is not null'):
            self.assertIn(guard, journal)

    def test_native_controls_reject_unrelated_primary_error(self):
        path = Path(__file__).with_name('canonical-governance-journal-acl-selftest.py')
        spec = importlib.util.spec_from_file_location('journal_acl_controls', path)
        controls = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(controls)
        selected = controls.journal_catalog_check_sql()
        self.assertIn(selected, oracle.completion_shape_sql())
        self.assertEqual(selected.count('select test_assert('), 1)
        with patch.object(controls.fixture, 'reset_database') as reset, patch.object(
            controls.fixture, 'psql_sql', return_value=SimpleNamespace(
                stderr='ERROR:  P0001: FAIL: unrelated assertion\n')
        ) as execute:
            with self.assertRaises(AssertionError):
                controls.journal_catalog_negative_controls()
        reset.assert_called_once_with(template=controls.fixture.POST6D2_TEMPLATE)
        self.assertEqual(execute.call_count, 2, 'must stop at unqualified rejection')
        mutation = execute.call_args
        self.assertTrue(mutation.args[0].startswith('begin;\n'))
        self.assertEqual(mutation.kwargs, {'expected': 'P0001'})

    def test_native_controls_follow_successful_whole_source_in_both_jobs(self):
        root = Path(__file__).resolve().parents[1]
        for filename, predecessor, next_job in (
            ('ops-hardening.yml', 'scripts/canonical-auth-membership-group.py --partition original16 --evidence',
             '  auth-provisioning-legacy-proof:'),
            ('gridex-db-blocker-diagnostics.yml', 'scripts/canonical-blocker-diagnostics.py auth',
             '  native-transport:'),
        ):
            workflow = (root / '.github/workflows' / filename).read_text().split(next_job)[0]
            regression = 'run: python3 -B scripts/canonical-governance-journal-acl-selftest.py'
            self.assertGreater(workflow.index(regression), workflow.index(predecessor))
            self.assertLess(workflow.index('run: python3 -B scripts/canonical-journal-acl-selftest.py'),
                            workflow.index(predecessor))
            self.assertNotIn('continue-on-error', workflow)


if __name__ == '__main__':
    unittest.main(verbosity=2)
