#!/usr/bin/env python3
"""Offline tests for bounded read-only terminal diagnostics; no SQL execution."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('final_diagnostic_test', ROOT/'scripts/canonical-replay-final-diagnostic.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class TerminalDiagnosticTests(unittest.TestCase):
    def test_pinned_projection_covers_same_thirteen_tables_two_functions(self):
        expected = m.snapshot_projection(m.pinned_inputs()[0])
        self.assertEqual(set(expected['tables']), set(m.TABLES))
        self.assertEqual(set(expected['functions']), set(m.FUNCTIONS))
        self.assertEqual(len(expected['tables']['companies']['columns']), 138)

    def test_changed_snapshot_or_fingerprint_query_rejected(self):
        real = Path.read_bytes
        for filename in m.PINS:
            def changed(path, *args, **kwargs):
                data = real(path, *args, **kwargs)
                return data+b'\n' if path == m.ROOT/filename else data
            with self.subTest(filename=filename), patch.object(Path, 'read_bytes', changed):
                with self.assertRaisesRegex(ValueError, 'DIAGNOSTIC_SOURCE_CHANGED'):
                    m.pinned_inputs()

    def test_function_body_transport_format_is_not_schema_difference(self):
        a = 'CREATE FUNCTION public.a() RETURNS text\nAS $$\nSELECT 1;\n$$;'
        b = 'CREATE OR REPLACE FUNCTION public.a()\n RETURNS text\nAS $function$\nSELECT 1;\n$function$\n'
        self.assertEqual(m.function_body_hash(a), m.function_body_hash(b))
        self.assertNotEqual(m.function_body_hash(a), m.function_body_hash(b.replace('SELECT 1;', 'SELECT 2;')))

    def test_broken_projection_does_not_silently_drop_columns(self):
        text = m.pinned_inputs()[0]
        with self.assertRaisesRegex(ValueError, 'SNAPSHOT_COLUMN_REQUIRED'):
            m.snapshot_projection(text.replace('CREATE TABLE public.companies (\n    id uuid DEFAULT gen_random_uuid() NOT NULL,', 'CREATE TABLE public.companies (\n    ??? unknown,', 1))

    def test_private_census_hashes_literals_without_disclosing_them(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory/'fixture-0123456789abcdef.sql').write_bytes(b'SELECT secret@example.invalid;')
            (directory/'ordinary.sql').write_bytes(b'SELECT 1;')
            report = m.private_census(directory, (b'secret@example.invalid',), {}, {})
            encoded = json.dumps(report)
            self.assertNotIn('secret@example.invalid', encoded)
            self.assertEqual(report['matchingArtifactCount'], 1)
            self.assertEqual(report['artifacts'][0]['artifact'], 'fixture-0123456789abcdef.sql')
            self.assertIs(report['privacyAccepted'], False)

    def test_private_census_does_not_follow_symlinks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); directory = root/'owned'; directory.mkdir()
            outside = root/'outside.sql'; outside.write_text('hidden marker')
            (directory/'link.sql').symlink_to(outside)
            with self.assertRaisesRegex(ValueError, 'DIAGNOSTIC_SYMLINK_REJECTED'):
                m.private_census(directory, (b'hidden marker',), {}, {})

    def test_artifact_name_cannot_publish_untrusted_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory/'leak-secret@example.invalid.sql').write_bytes(b'marker')
            report = m.private_census(directory, (b'marker',), {}, {})
            self.assertNotIn('secret@example.invalid', json.dumps(report))
            self.assertEqual(report['artifacts'][0]['artifact'], 'UNCLASSIFIED_PRIVATE_ARTIFACT')

    def test_matching_whole_input_is_reported_not_exempted_or_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp); source = directory/'replay-source-1.sql'; source.write_bytes(b'needle')
            sha = hashlib.sha256(b'needle').hexdigest()
            report = m.private_census(directory, (b'needle',), {'replay-source-1.sql': (source, ())}, {sha: 'reviewed/source.sql'})
            self.assertTrue(report['artifacts'][0]['recordedWholeInputName'])
            self.assertEqual(report['artifacts'][0]['exactOriginal'], 'reviewed/source.sql')
            self.assertIs(report['privacyAccepted'], False)

    def test_observer_always_preserves_original_terminal_failure(self):
        controller = SimpleNamespace(_serve_child=Mock())
        handle = object(); original = Mock(side_effect=RuntimeError('original terminal failure'))
        observer = m.terminal_observer(controller, original)
        with self.assertRaisesRegex(RuntimeError, '^original terminal failure$'):
            observer(handle)
        original.assert_called_once_with(handle)

    def catalog_fixture(self):
        text = m.pinned_inputs()[0]
        expected = m.snapshot_projection(text)
        actual = {'columns':[], 'constraints':[], 'functions':[]}
        for table, definition in expected['tables'].items():
            for i, c in enumerate(definition['columns'], 1):
                actual['columns'].append({'table_name':table,'ordinal_position':i,
                    'column_name':c['name'],'udt_name':c['udt'],
                    'is_nullable':'YES' if c['nullable'] else 'NO',
                    'column_default':'must-never-be-emitted@example.invalid'})
            actual['constraints'] += [{'table_name':table,'conname':c}
                for c in definition['constraints']]
        for name in m.FUNCTIONS:
            start = text.index('CREATE FUNCTION public.'+name+'(')
            end = text.index('\n\n--', start)
            actual['functions'].append({'proname':name,'definition':text[start:end],
                'prosecdef':expected['functions'][name]['securityDefiner']})
        return expected, actual

    def test_identical_limited_projection_never_claims_full_acceptance(self):
        expected, actual = self.catalog_fixture()
        report = m.compare_projection(expected, actual)
        self.assertEqual(report['tableDifferences'], [])
        self.assertTrue(all(f['bodyMatchesSnapshot'] for f in report['functions']))
        self.assertIs(report['schemaAccepted'], False)
        self.assertIs(report['defaultsConstraintSemanticsRlsAclIndexesAndLedgerVerified'], False)
        self.assertNotIn('must-never-be-emitted', json.dumps(report))

    def test_presence_nullability_type_and_constraint_drift_are_reported(self):
        expected, actual = self.catalog_fixture()
        company = next(r for r in actual['columns'] if r['table_name']=='companies')
        company.update(udt_name='text', is_nullable='YES')
        actual['constraints'] = [r for r in actual['constraints']
            if not (r['table_name']=='companies' and r['conname']=='companies_pkey')]
        report = m.compare_projection(expected, actual)
        drift = next(r for r in report['tableDifferences'] if r['table']=='companies')
        self.assertEqual(drift['columnDifferences'][0],
            {'column':'id','different':['type','nullability']})
        self.assertIn('companies_pkey', drift['missingConstraints'])
        self.assertNotIn('must-never-be-emitted', json.dumps(report))

    def test_diagnostic_error_cannot_replace_terminal_disposal(self):
        original = Mock(side_effect=RuntimeError('original failure remains'))
        controller = SimpleNamespace()
        def failing_shell(h, observer):
            scope='full'; tail=SimpleNamespace(state='executed')
            loop=SimpleNamespace(applied=True); child=SimpleNamespace(poll=lambda:1)
            observer(h)
        controller._serve_child = failing_shell
        observer = m.terminal_observer(controller, original)
        with patch.object(m, 'collect', side_effect=ValueError('private source text')), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            with self.assertRaisesRegex(RuntimeError, '^original failure remains$'):
                failing_shell(object(), observer)
        original.assert_called_once()
        report=json.loads(output.getvalue())
        self.assertEqual(report['outcome'], 'EVIDENCE_UNAVAILABLE')
        self.assertNotIn('private source text', output.getvalue())

    def test_extra_command_arguments_rejected_before_controller_or_sql(self):
        with patch.object(m.sys, 'argv', ['diagnostic', '--url', 'postgres://external']), patch.object(m, 'load_controller') as load:
            with self.assertRaisesRegex(ValueError, 'NO_DIAGNOSTIC_ARGUMENTS_ACCEPTED'):
                m.main()
        load.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
