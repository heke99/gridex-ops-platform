#!/usr/bin/env python3
"""Finite constructor/privacy tests; these never claim a PostgreSQL execution."""
import importlib.util
import ast
import inspect
import re
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
        self.assertEqual(report['counts']['SUBSTITUTED'], 19)
        self.assertEqual(report['counts']['UNCLASSIFIED'], 14)
        self.assertFalse(report['sqlExecutionVerified'])

    def test_success_is_never_full_acceptance(self):
        value = diag.receipt({'counts': {}}, 'SELECTED_CHAIN_EXECUTED_NOT_CERTIFIED')
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

    def test_workflow_uses_existing_private_input_owner_contract(self):
        # Read the actual adapter predicate rather than duplicating its regex.
        controller = diag.load_controller()
        code = ast.parse(inspect.getsource(controller.load_private()))
        patterns = [node.args[0].value for node in ast.walk(code)
                    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr == 'fullmatch' and node.args
                    and isinstance(node.args[0], ast.Constant)
                    and isinstance(node.args[0].value, str)
                    and node.args[0].value.startswith('gridex-auth-legacy-')]
        self.assertEqual(len(patterns), 1)
        workflow = (diag.ROOT / '.github/workflows/gridex-db-frontier.yml').read_text()
        line = next(line for line in workflow.splitlines() if 'GRIDEX_LEGACY_CONTAINER_NAME:' in line)
        name = line.split(':', 1)[1].strip().replace('${{ github.run_id }}', '123456').replace('${{ github.run_attempt }}', '1')
        self.assertRegex(name, patterns[0])
        self.assertIsNone(re.fullmatch(patterns[0], 'gridex-auth-legacy-frontier-123456-1'))

    def test_exception_labels_are_closed_not_arbitrary_uppercase(self):
        controller = diag.load_controller()
        boundary = controller.load_batch().BoundaryError
        self.assertEqual(diag.safe_failure_category(controller, boundary('FRESH_FIXED_PREPARATION_REQUIRED')),
                         'FRESH_FIXED_PREPARATION_REQUIRED')
        self.assertEqual(diag.safe_failure_category(controller, boundary('SECRET_API_KEY_1234')), 'UNCLASSIFIED')
        self.assertEqual(diag.safe_failure_category(controller, RuntimeError('user@example.test password')), 'UNCLASSIFIED')

    def test_missing_native_error_is_explicit(self):
        self.assertEqual(diag.safe_error_identifiers(b'connection closed'), {'sqlstate': None, 'schema_identifiers': []})

if __name__ == '__main__':
    unittest.main()
