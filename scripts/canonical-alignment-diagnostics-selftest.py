#!/usr/bin/env python3
"""Privacy and failure-attribution regressions for the alignment proof."""
import importlib.util
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('alignment_diagnostic_subject',
    Path(__file__).with_name('canonical-user-rbac-customer-alignment-selftest.py'))
c = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = c
spec.loader.exec_module(c)


class Diagnostics(unittest.TestCase):
    def test_case_and_known_guard_survive_cleanup(self):
        c._NATIVE_FAILURE = None
        original = c.batch.BoundaryError('ALIGNMENT_EMPTY_COUNT_SOURCE_ORACLE')
        with self.assertRaises(OSError):
            with c.diagnostic_stage('behavior_cases'):
                try:
                    with c.diagnostic_stage('case_baseline'):
                        raise original
                finally:
                    raise OSError('private cleanup')
        self.assertEqual(c._NATIVE_FAILURE, dict(stage='case_baseline', type='BOUNDARY',
            category='BOUNDARY_REJECTED', guard='ALIGNMENT_EMPTY_COUNT_SOURCE_ORACLE'))

    def test_unknown_guard_is_never_disclosed(self):
        for value in ('private value', 'ALIGNMENT_PRIVATE_CUSTOMER',
                      ['ALIGNMENT_EMPTY_COUNT_SOURCE_ORACLE']):
            receipt = c.failure_receipt('private case', c.batch.BoundaryError(value))
            self.assertEqual(receipt, dict(stage='internal', type='BOUNDARY', category='BOUNDARY_REJECTED'))

    def test_native_failure_classifies_only_primary_source_header(self):
        self.assertTrue(hasattr(c, 'NativeResultError'))
        header = 'psql:/legacy-private/alignment-assertions.sql:12: ERROR:  P0004: ALIGNMENT_FINAL_CATALOG_MISMATCH\n'
        result = c.core.Result('private stdout', header + 'CONTEXT: private payload', 3, 'P0004', None, None)
        receipt = c.failure_receipt('case_baseline', c.NativeResultError(result))
        self.assertEqual(receipt, dict(stage='case_baseline', type='NATIVE_RESULT',
            category='QUERY_ASSERTION', input='assertions', assertion='ALIGNMENT_FINAL_CATALOG_MISMATCH'))
        for prefix in ('NOTICE: private\n', 'private quoted text\n', '\n'):
            result = c.core.Result('', prefix + header, 3, 'P0004', None, None)
            receipt = c.failure_receipt('case_baseline', c.NativeResultError(result))
            self.assertEqual(receipt['input'], 'UNCLASSIFIED')
            self.assertEqual(receipt['assertion'], 'UNCLASSIFIED')

    def test_native_unknowns_and_marker_failure_remain_failures(self):
        self.assertTrue(hasattr(c, 'NativeResultError'))
        cases = c.load('alignment_diagnostic_cases', 'canonical-user-rbac-customer-alignment-cases.py')
        for code, state, stdout in ((1, 'private state', ''), (0, '00000', ''),
                                    (0, '00000', 'ALIGNMENT_COMPLETE\nALIGNMENT_COMPLETE')):
            result = c.core.Result(stdout, 'private stderr', code, state, None, None)
            with self.assertRaises(c.NativeResultError) as caught:
                cases.succeeded(c, result)
            receipt = c.failure_receipt('case_baseline', caught.exception)
            self.assertEqual(receipt['category'], 'PRIVATE_QUERY_FAILED')
            self.assertNotIn('private', str(receipt))
        result = c.core.Result('ALIGNMENT_COMPLETE\n', '', 0, '00000', None, None)
        cases.succeeded(c, result)


if __name__ == '__main__':
    unittest.main()
