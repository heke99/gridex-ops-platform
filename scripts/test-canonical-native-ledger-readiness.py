#!/usr/bin/env python3
"""Offline transport/source rejection tests; SQL qualification belongs to CI."""
import dataclasses
import json
import sys
from types import SimpleNamespace
import unittest

sys.dont_write_bytecode = True
import canonical_native_timestamp_sources as compiler
try:
    import canonical_native_ledger_readiness as readiness
except ModuleNotFoundError:
    readiness = None


class ReadinessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.units = {u.ordinal: u for u in compiler.prepare().units
                     if u.ordinal in (257, 262, 275, 351)}

    def setUp(self):
        self.assertIsNotNone(readiness, 'native ledger readiness qualification is required')

    def test_exact_sources_produce_finite_qualification_cases(self):
        for ordinal, unit in self.units.items():
            sql, cases = readiness.program(unit)
            self.assertTrue(sql)
            self.assertGreaterEqual(len(cases), 4)
            self.assertEqual(len(cases), len(set(cases)))
            self.assertEqual(compiler.prefix.statements(sql)[0][0][0].upper(), 'BEGIN')
            self.assertEqual(compiler.prefix.statements(sql)[-1][0][0].upper(), 'ROLLBACK')

    def test_changed_unknown_or_unqualified_source_cannot_reach_sql(self):
        unit = self.units[257]
        for changed in (dataclasses.replace(unit, source_sql=unit.source_sql+b'\n'),
                        dataclasses.replace(unit, source_sha256='0'*64),
                        dataclasses.replace(unit, qualifications=('CLI_TRANSACTION',)),
                        dataclasses.replace(unit, sql=unit.sql+b'SELECT 1;')):
            with self.assertRaises(ValueError):
                readiness.program(changed)

    def transport(self, *, bad_output=False, fail_sql=False, changed_snapshot=False, leftover=False):
        unit = self.units[257]
        tokens = compiler.prefix.statements(unit.sql.decode())
        entry = dict(version='20260915170000', name=unit.name,
                     statements=[unit.sql.decode()[item[0][1]:item[-1][2]] for item in tokens])
        class Target:
            exists = False
            after = False
            def assert_native_owned(self): return True
            def snapshot(self, database='postgres'):
                return 'changed' if changed_snapshot and self.after else 'same'
            def clone(self, source, destination): self.exists = True
            def drop_clone(self, database): self.exists = leftover
            def _oid(self, database): return '123' if self.exists else None
            def sql(self, database, query, stage='fixture', **kwargs):
                if query == compiler.prefix.LEDGER_SQL: return json.dumps([entry])
                if stage == 'ledger_readiness_observe': return 'false'
                if stage == 'ledger_readiness_behavior':
                    self.after = True
                    if fail_sql: raise ValueError('NATIVE_TIMESTAMP_SQL_RESULT')
                    return 'false' if bad_output else 'true'
                return '[]'
        runner = SimpleNamespace(target=Target(), entries=[entry], unchanged=lambda: None)
        return runner, unit

    def test_receipt_requires_sql_success_rollback_and_clone_disposal(self):
        runner, unit = self.transport()
        result = readiness.qualify(runner, unit)
        self.assertTrue(result['ledgerReadinessVerified'])
        self.assertFalse(result['ledgerReadiness']['deploymentReady'])
        self.assertFalse(result['ledgerReadiness']['historicalLedgerAliasesCreated'])
        self.assertFalse(runner.target.exists)
        for options in ({'bad_output':True}, {'fail_sql':True},
                        {'changed_snapshot':True}, {'leftover':True}):
            runner, unit = self.transport(**options)
            with self.subTest(options=options), self.assertRaises(ValueError):
                readiness.qualify(runner, unit)

    def test_wrong_real_statement_ledger_rejected_before_clone(self):
        runner, unit = self.transport()
        runner.entries[-1]['statements'] = ['SELECT 1']
        with self.assertRaises(ValueError):
            readiness.qualify(runner, unit)
        self.assertFalse(runner.target.exists)


if __name__ == '__main__':
    unittest.main()
