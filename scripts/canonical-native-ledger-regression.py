#!/usr/bin/env python3
"""Native ledger regressions; offline fixtures are not database acceptance."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import canonical_native_timestamp_sources as timestamp_sources
import canonical_forward_sources as forward_sources
import canonical_added_view_witness as views
import canonical_changed_view_witness as changed_views
import canonical_changed_function_witness as changed_functions
import canonical_changed_index_witness as changed_indexes
import canonical_intake_jsonb_qualification as intake
import canonical_added_nonunique_index_decisions as nonunique
import canonical_removed_policy_qualification as removed_policies

ROOT = Path(__file__).resolve().parents[1]


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


prefix_tests = load('prefix_regression_fixture', 'test-canonical-native-historical-prefix.py')
lifecycle_tests = load('lifecycle_regression_fixture', 'canonical-native-supabase-lifecycle-selftest.py')
prefix = prefix_tests.m
lifecycle = lifecycle_tests.m


class LedgerTailTests(unittest.TestCase):
    def test_cli_comment_only_tail_is_exactly_bound_to_original_source(self):
        sql = b"SELECT 1;\n-- original trailing comment\n"
        p = prefix.Program(1, 'migrations/tail.sql', prefix.sha(sql), sql, False)
        filename = '20260914120000_' + p.name + '.sql'
        entry = {'version': filename[:14], 'name': p.name,
                 'statements': ['SELECT 1', '-- original trailing comment']}
        prefix.verify_entry(entry, filename, p)
        for fragments in (['SELECT 1'], ['SELECT 1', '-- different comment'],
                          ['-- original trailing comment', 'SELECT 1'],
                          ['SELECT 1', '-- original trailing comment\nSELECT 2'],
                          ['SELECT 1', '-- original trailing comment', '-- original trailing comment']):
            with self.assertRaises(prefix.PrefixError):
                prefix.verify_entry({**entry, 'statements': fragments}, filename, p)

    def test_trailing_comment_without_final_semicolon_stays_in_statement(self):
        sql = b"SELECT 1 /* original tail */"
        p = prefix.Program(1, 'migrations/tail.sql', prefix.sha(sql), sql, False)
        filename = '20260914120000_' + p.name + '.sql'
        entry = {'version': filename[:14], 'name': p.name,
                 'statements': ['SELECT 1 /* original tail */']}
        prefix.verify_entry(entry, filename, p)
        with self.assertRaises(prefix.PrefixError):
            prefix.verify_entry({**entry, 'statements': ['SELECT 1', '/* original tail */']}, filename, p)

    def test_real_first_source_with_cli_retained_comment_tail(self):
        p = prefix.prepare()[0]
        text = p.sql.decode()
        parts = []
        start = 0
        # Mirror upstream SplitAndTrim's semicolon/EOF emission, retaining
        # comments. The fixture is not a claim of native database execution.
        for token, _, end in prefix.sql_tokens(text):
            if token == ';':
                part = text[start:end].rstrip(';').strip()
                if part:
                    parts.append(part)
                start = end
        tail = text[start:].rstrip(';').strip()
        if tail:
            parts.append(tail)
        self.assertEqual(len(prefix.identity(text)), 93)
        self.assertEqual(len(parts), 94)
        self.assertTrue(parts[-1].startswith('--'))
        filename = '20260914120000_' + p.name + '.sql'
        entry = {'version': filename[:14], 'name': p.name, 'statements': parts}
        prefix.verify_entry(entry, filename, p)
        with self.assertRaises(prefix.PrefixError):
            prefix.verify_entry({**entry, 'statements': parts[1:]}, filename, p)


class HistoricalDiagnosticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Compile the actual source plan before the lifecycle fixture replaces
        # subprocess.run. Its Docker/CLI fake cannot execute the input selector
        # that writes the two accounting files. No timestamp SQL is reached in
        # these deliberately failing foundation diagnostics.
        cls.timestamp_plan = timestamp_sources.prepare()
        cls.forward_retained = forward_sources.retain(ROOT)
        cls.view_retained = views.retain(ROOT)
        cls.changed_view_retained = changed_views.retain(ROOT)
        cls.changed_function_retained = changed_functions.retain(ROOT)
        cls.changed_index_retained = changed_indexes.retain(ROOT)
        cls.intake_retained = intake.retain(ROOT)
        cls.nonunique_retained = nonunique.retain(ROOT)
        cls.removed_policy_retained = removed_policies.retain(ROOT)

    def test_known_prefix_code_is_preserved_without_formatting_exception(self):
        historical = lifecycle.load_historical_prefix()
        error = historical.PrefixError('NATIVE_EXECUTED_LEDGER_REQUIRED')
        self.assertEqual(lifecycle.failure_code(error, historical), 'NATIVE_EXECUTED_LEDGER_REQUIRED')

    def test_arbitrary_values_subclasses_and_extra_arguments_are_not_reported(self):
        historical = lifecycle.load_historical_prefix()
        class UntrustedPrefix(historical.PrefixError):
            pass
        for error in (historical.PrefixError('private SQL literal'),
                      historical.PrefixError('NATIVE_EXECUTED_LEDGER_REQUIRED', 'private SQL literal'),
                      historical.PrefixError(['NATIVE_EXECUTED_LEDGER_REQUIRED']),
                      ValueError('NATIVE_EXECUTED_LEDGER_REQUIRED'),
                      UntrustedPrefix('NATIVE_EXECUTED_LEDGER_REQUIRED'),
                      RuntimeError('private SQL literal')):
            self.assertIsNone(lifecycle.failure_code(error, historical))
        self.assertIsNone(lifecycle.failure_code(historical.PrefixError('NATIVE_EXECUTED_LEDGER_REQUIRED'), None))
        self.assertIsNone(lifecycle.failure_code(ValueError('private SQL literal'), SimpleNamespace()))

    def test_existing_lifecycle_error_allowlist_is_retained(self):
        self.assertEqual(lifecycle.failure_code(ValueError('NATIVE_COMMAND_FAILED'), None),
                         'NATIVE_COMMAND_FAILED')
        self.assertIsNone(lifecycle.failure_code(ValueError('NATIVE_COMMAND_FAILED private SQL literal'), None))

    def test_invalid_view_source_stops_before_native_transport_or_database_start(self):
        fake=SimpleNamespace(prepare=lambda:())
        with patch.dict(lifecycle.os.environ,{'GITHUB_ACTIONS':'true','GITHUB_RUN_ID':'12345','GITHUB_RUN_ATTEMPT':'1'}), \
             patch.object(lifecycle.sys,'argv',['lifecycle']), \
             patch.object(lifecycle.shutil,'which',return_value='/fixture/supabase'), \
             patch.object(lifecycle,'load_historical_prefix',return_value=fake), \
             patch.object(timestamp_sources,'prepare',return_value=self.timestamp_plan), \
             patch.object(forward_sources,'retain',return_value=self.forward_retained), \
             patch.object(views,'retain',side_effect=ValueError('ADDED_VIEW_WITNESS_SOURCE_REQUIRED')), \
             patch.object(lifecycle,'load_transport') as transport:
            with self.assertRaisesRegex(ValueError,'ADDED_VIEW_WITNESS_SOURCE_REQUIRED'):
                lifecycle.run(historical_prefix=True)
        transport.assert_not_called()

    def historical_failure(self, message):
        historical = lifecycle.load_historical_prefix()
        def execute(*args):
            args[-1].update(foundationInputsExecuted=0,
                           historicalGridexSourcesExecuted=False,
                           historicalPrefixLedgerVerified=False)
            raise historical.PrefixError(message)
        fake = SimpleNamespace(PrefixError=historical.PrefixError,
                               prepare=lambda: (), execute=execute)
        original = lifecycle.run
        with patch.object(lifecycle, 'load_historical_prefix', return_value=fake), \
             patch.object(timestamp_sources, 'prepare', return_value=self.timestamp_plan), \
             patch.object(forward_sources, 'retain', return_value=self.forward_retained), \
             patch.object(views, 'retain', return_value=self.view_retained), \
             patch.object(changed_views, 'retain', return_value=self.changed_view_retained), \
             patch.object(changed_functions, 'retain', return_value=self.changed_function_retained), \
             patch.object(changed_indexes, 'retain', return_value=self.changed_index_retained), \
             patch.object(intake, 'retain', return_value=self.intake_retained), \
             patch.object(nonunique, 'retain', return_value=self.nonunique_retained), \
             patch.object(removed_policies, 'retain', return_value=self.removed_policy_retained) as retained, \
             patch.object(lifecycle.provider_events, 'bootstrap', return_value=lifecycle.provider_events.receipt()), \
             patch.object(lifecycle, 'run', side_effect=lambda: original(historical_prefix=True)):
            result = lifecycle_tests.NativeTests().execute_fixture()
            retained.assert_called_once()
            return result

    def test_real_catch_path_reports_code_and_preserves_failure_and_cleanup(self):
        status, report = self.historical_failure('NATIVE_EXECUTED_LEDGER_REQUIRED')
        self.assertEqual(status, 1)
        self.assertEqual(report['errorCode'], 'NATIVE_EXECUTED_LEDGER_REQUIRED')
        self.assertEqual(report['phase'], 'HISTORICAL_FIRST43_NATIVE_LEDGER')
        self.assertEqual(report['outcome'], 'BLOCKED')
        self.assertTrue(report['historicalPrivateInputsDisposed'])
        self.assertFalse(report['historicalGridexSourcesExecuted'])
        self.assertFalse(report['completeReplayVerified'])

    def test_real_catch_path_suppresses_unknown_exception_payload(self):
        status, report = self.historical_failure('private SQL literal')
        self.assertEqual(status, 1)
        self.assertNotIn('errorCode', report)
        self.assertNotIn('private SQL literal', json.dumps(report))
        self.assertTrue(report['historicalPrivateInputsDisposed'])



if __name__ == '__main__':
    unittest.main(verbosity=2)
