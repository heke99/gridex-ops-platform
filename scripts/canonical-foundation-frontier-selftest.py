#!/usr/bin/env python3
"""Finite constructor/privacy tests; these never claim a PostgreSQL execution."""
import importlib.util
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
path = Path(__file__).with_name('canonical-foundation-frontier-diagnostic.py')
spec = importlib.util.spec_from_file_location('frontier_diagnostic_test', path)
diag = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diag)

class FrontierTests(unittest.TestCase):
    def test_real_source_selection_retains_all_unresolved_dispositions(self):
        order, report = diag.verify_selection(diag.load_controller())
        self.assertEqual(len(order), 118)
        self.assertEqual(report['counts']['SUBSTITUTED'], 23)
        self.assertEqual(report['counts']['UNCLASSIFIED'], 14)
        self.assertFalse(report['sqlExecutionVerified'])

    def test_success_is_never_full_acceptance(self):
        value = diag.receipt({'counts': {}}, 'SELECTED_FOUNDATION_EXECUTED_NOT_CERTIFIED')
        for key in ('completeReplayVerified','ledgerProvenanceVerified','generatedTypesVerified','productionModified'):
            self.assertIs(value[key], False)

    def test_error_receipt_does_not_copy_values_or_context(self):
        result = diag.safe_error_identifiers(b'ERROR: 42703: column "missing_column" does not exist\nDETAIL: secret-value\nCONTEXT: relation "private_row" password-value')
        self.assertEqual(result, {'sqlstate': '42703', 'schema_identifiers': [{'kind': 'column', 'identifier': 'missing_column'}]})
        self.assertNotIn('secret', str(result))

    def test_unknown_error_headline_is_not_exposed(self):
        result = diag.safe_error_identifiers(b'ERROR: P0001: user@example.test password-123\nQUERY: SELECT secret')
        self.assertEqual(result, {'sqlstate': 'P0001', 'schema_identifiers': []})

    def test_untrusted_label_is_not_an_identifier(self):
        result = diag.safe_error_identifiers(b'ERROR: 42P01: relation "user@example.test" does not exist')
        self.assertEqual(result['schema_identifiers'], [])

    def test_missing_native_error_is_explicit(self):
        self.assertEqual(diag.safe_error_identifiers(b'connection closed'), {'sqlstate': None, 'schema_identifiers': []})

if __name__ == '__main__':
    unittest.main()
