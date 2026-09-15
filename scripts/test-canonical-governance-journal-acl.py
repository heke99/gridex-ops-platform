#!/usr/bin/env python3
"""Exact managed journal ACL regression; --sql requires the owned PG17 fixture."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import canonical_full_governance_sql as oracle

LABEL = '6D2 journal exact managed table ACL/grantor/grant-option/no column ACL'

class SourceTests(unittest.TestCase):
    def test_fixed_complete_grant_matrix(self):
        self.assertEqual(len(oracle.MANAGED_JOURNAL_ACL), 32)
        self.assertEqual(set(oracle.MANAGED_TABLE_PRIVILEGES), {
            'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'})
        for role in ('anon','authenticated','postgres','service_role'):
            entries = [x for x in oracle.MANAGED_JOURNAL_ACL if x[0] == role]
            self.assertEqual(len(entries), 8)
            self.assertTrue(all(x[2:] == (False, 'postgres') for x in entries))
        self.assertEqual(len(set(oracle.MANAGED_JOURNAL_ACL)),32)
        self.assertNotIn('PUBLIC', {x[0] for x in oracle.MANAGED_JOURNAL_ACL})

    def test_no_self_acceptance_of_current_default_acl(self):
        sql = oracle.journal_acl_oracle_sql()
        self.assertNotIn('pg_default_acl', sql)
        self.assertIn(json.dumps(oracle.MANAGED_JOURNAL_ACL), sql)
        for term in ("aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))",
                     'a.is_grantable', 'a.grantor', 'col.attacl is not null',
                     'collate "C"', "c.relpersistence='p'"):
            self.assertIn(term, sql)

    def test_complete_chain_retains_shape_and_exact_acl(self):
        sql = oracle.completion_shape_sql()
        self.assertIn(oracle.journal_acl_oracle_sql(), sql)
        self.assertNotIn('relacl is null', sql)
        for term in ('relowner=', 'reloptions is null', 'obj_description',
                     'col_description', 'a.attnotnull=e.required'):
            self.assertIn(term, sql)
        self.assertIn(sql, oracle.complete_postflight_sql())

    def test_oracle_cannot_modify_privileges(self):
        sql = oracle.journal_acl_oracle_sql().lower()
        for term in ('grant ', 'revoke ', 'alter ', 'drop ', 'update ', 'delete from'):
            self.assertNotIn(term, sql)


def sql_regression():
    # The existing runner fixes both ADMIN and TARGET to the loopback PG17
    # service, strips inherited PG credentials and owns all disposable DBs.
    path = ROOT / 'scripts/canonical-full-governance-source-selftest.py'
    spec = importlib.util.spec_from_file_location('journal_sql_fixture', path)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    runner.contract.validate()
    runner.full_empty_lane()
    statement = oracle.journal_acl_oracle_sql()
    runner.psql_sql(statement)
    # Every deliberate mutation and rejection happens in one transaction; the
    # failing psql connection closes and rolls it back. Baseline is rechecked.
    negative = {
        'unexpected_public': 'grant select on public.platform_session_revocations to public;',
        'missing_role': 'revoke all on public.platform_session_revocations from anon;',
        'grant_option': 'grant select on public.platform_session_revocations to authenticated with grant option;',
        'maintain_missing': 'revoke maintain on public.platform_session_revocations from service_role;',
        'column_acl': 'grant select(reason) on public.platform_session_revocations to public;',
    }
    for name, change in negative.items():
        result = runner.psql_sql('begin;\n' + change + statement, expected='P0001')
        assert 'FAIL: ' + LABEL in result.stderr, 'Wrong assertion in ' + name
        runner.psql_sql(statement)
        print('PASS JOURNAL ACL rejection/restoration:', name)
    print('PASS JOURNAL ACL: source-created baseline plus five negative controls; final access remains OPEN')


if __name__ == '__main__':
    if sys.argv[1:] == ['--sql']:
        sql_regression()
    else:
        unittest.main(verbosity=2)
