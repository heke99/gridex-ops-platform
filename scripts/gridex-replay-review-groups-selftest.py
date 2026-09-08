#!/usr/bin/env python3
"""Regression tests for conservative replay review grouping."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import shutil
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
CHECKER = ROOT / 'scripts/gridex-replay-review-groups.py'


def load_checker():
    spec = importlib.util.spec_from_file_location('gridex_replay_review_groups', CHECKER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def accounting_report():
    rows = [
        {'path': 'migrations/20260101_final_saas_hardening.sql', 'sha256': 'a' * 64,
         'classification': 'UNCLASSIFIED', 'execution': [], 'derivedArtifacts': []},
        {'path': 'migrations/20260102_ediel_invoice.sql', 'sha256': 'b' * 64,
         'classification': 'SUBSTITUTED', 'execution': [],
         'derivedArtifacts': [{'artifact': 'bootstrap/derived.sql', 'stage': 'foundation',
                               'ordinal': 3, 'preserveSourceReplay': False}]},
        {'path': 'migrations/20260103_misc.sql', 'sha256': 'c' * 64,
         'classification': 'FULL_FILE_SELECTED',
         'execution': [{'stage': 'timestamp', 'ordinal': 7}], 'derivedArtifacts': []},
    ]
    return {'schemaVersion': 1, 'status': 'UNCLASSIFIED_INPUTS',
            'evidenceScope': 'INPUT_SELECTION_ONLY', 'totalMigrations': len(rows),
            'counts': {'FULL_FILE_SELECTED': 1, 'SUBSTITUTED': 1,
                       'EXPLICITLY_EXCLUDED': 0, 'UNCLASSIFIED': 1},
            'migrations': rows, 'errors': []}


SQL = {
    'migrations/20260101_final_saas_hardening.sql': '''
        ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_users ON public.company_memberships USING (true);
    ''',
    'migrations/20260102_ediel_invoice.sql': '''
        CREATE FUNCTION public.send_ediel_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN EXECUTE 'UPDATE public.invoices SET status = paid'; RETURN NEW; END $$;
        CREATE TRIGGER invoice_event BEFORE UPDATE ON public.invoices
        FOR EACH ROW EXECUTE FUNCTION public.send_ediel_invoice();
    ''',
    'migrations/20260103_misc.sql': 'SELECT 1;',
}


class ReviewGroupsTest(unittest.TestCase):
    def setUp(self):
        self.module = load_checker()
        self.report = accounting_report()

    def build(self, focus=None):
        return self.module.group_report(copy.deepcopy(self.report),
                                        lambda path: SQL[path], focus)

    def test_every_accounted_input_is_preserved_once_and_mapped(self):
        grouped = self.build()
        self.assertEqual([row['path'] for row in grouped['inputs']],
                         [row['path'] for row in self.report['migrations']])
        self.assertEqual(grouped['global']['totalMigrations'], 3)
        for original, mapped in zip(self.report['migrations'], grouped['inputs']):
            for key in ('path', 'sha256', 'classification', 'execution', 'derivedArtifacts'):
                self.assertEqual(mapped[key], original[key])
            self.assertTrue(mapped['reviewDomains'])

    def test_generic_filename_gets_auth_adjacency_without_dependency_claim(self):
        row = self.build()['inputs'][0]
        self.assertEqual(row['filenameDomains'], [])
        self.assertIn('manual_review', row['reviewDomains'])
        self.assertIn('auth_membership_tenant', row['reviewDomains'])
        self.assertEqual({item['object'] for item in row['sharedObjectCandidates']},
                         {'public.company_memberships', 'public.user_profiles'})
        self.assertFalse(row['provenReadWriteDependencies'])
        self.assertFalse(row['replayApprovalGranted'])
        self.assertFalse(row['effectsVerified'])

    def test_cross_group_overlap_and_dynamic_sql_are_retained(self):
        row = self.build()['inputs'][1]
        self.assertIn('ediel', row['reviewDomains'])
        self.assertIn('billing', row['reviewDomains'])
        self.assertTrue(row['lexicalHints']['dynamicSql'])
        self.assertTrue(row['lexicalHints']['function'])
        self.assertTrue(row['lexicalHints']['trigger'])
        self.assertIn(row['path'], self.build()['groups']['ediel'])
        self.assertIn(row['path'], self.build()['groups']['billing'])

    def test_unmatched_input_stays_visible_in_manual_review(self):
        row = self.build()['inputs'][2]
        self.assertEqual(row['reviewDomains'], ['manual_review'])
        self.assertIn(row['path'], self.build()['groups']['manual_review'])

    def test_unresolved_inputs_sort_first_without_changing_classification(self):
        rows = self.build()['inputs']
        self.assertEqual([row['classification'] for row in rows],
                         ['UNCLASSIFIED', 'SUBSTITUTED', 'FULL_FILE_SELECTED'])
        self.assertEqual(self.report['counts'], self.build()['global']['classificationCounts'])

    def test_focused_group_keeps_global_unresolved_and_cross_group_references(self):
        grouped = self.build('auth_membership_tenant')
        self.assertEqual(grouped['global']['unresolvedCounts'],
                         {'SUBSTITUTED': 1, 'UNCLASSIFIED': 1, 'total': 2})
        self.assertEqual(list(grouped['groups']), ['auth_membership_tenant'])
        self.assertEqual(len(grouped['inputs']), 1)
        self.assertIn('manual_review', grouped['inputs'][0]['reviewDomains'])

    def test_output_is_deterministic(self):
        first = json.dumps(self.build(), indent=2, sort_keys=True)
        second = json.dumps(self.build(), indent=2, sort_keys=True)
        self.assertEqual(first, second)

    def test_accounting_validation_failure_is_hard_failure(self):
        with mock.patch.object(self.module, 'account', side_effect=ValueError('checksum mismatch')):
            with mock.patch.object(sys, 'argv', ['checker', '--root', str(ROOT)]):
                with mock.patch('builtins.print') as output:
                    code = self.module.main()
        self.assertEqual(code, 2)
        document = json.loads(output.call_args.args[0])
        self.assertEqual(document['status'], 'INVALID_INPUT_CONTRACT')
        self.assertIn('checksum mismatch', document['errors'][0])

    def test_incidental_filename_substring_stays_in_manual_review(self):
        self.report['migrations'][2]['path'] = 'migrations/capital.sql'
        grouped = self.module.group_report(self.report, lambda path: 'SELECT 1;')
        row = next(row for row in grouped['inputs'] if row['path'] == 'migrations/capital.sql')
        self.assertEqual(row['filenameDomains'], [])
        self.assertEqual(row['reviewDomains'], ['manual_review'])

    def test_lexical_statement_hints_and_static_trigger_attachment(self):
        grouped = self.build()
        self.assertTrue(grouped['inputs'][0]['lexicalHints']['ddl'])
        self.assertTrue(grouped['inputs'][0]['lexicalHints']['policy'])
        self.assertFalse(grouped['inputs'][0]['lexicalHints']['dml'])
        self.assertTrue(grouped['inputs'][1]['lexicalHints']['dml'])
        static = self.module.group_report(self.report, lambda path:
            'CREATE TRIGGER t BEFORE UPDATE ON public.invoices '
            'FOR EACH ROW EXECUTE FUNCTION public.invoice_event();')
        self.assertTrue(static['inputs'][0]['lexicalHints']['trigger'])
        self.assertFalse(static['inputs'][0]['lexicalHints']['dynamicSql'])

    def test_grouping_does_not_mutate_accounting(self):
        before = copy.deepcopy(self.report)
        self.module.group_report(self.report, lambda path: SQL[path])
        self.assertEqual(self.report, before)

    def test_focus_retains_shared_object_paths_outside_focus(self):
        sql = dict(SQL)
        sql[self.report['migrations'][0]['path']] += ' SELECT * FROM public.shared_object;'
        sql[self.report['migrations'][1]['path']] += ' SELECT * FROM public.shared_object;'
        grouped = self.module.group_report(self.report, lambda path: sql[path],
                                           'auth_membership_tenant')
        candidate = next(item for item in grouped['inputs'][0]['sharedObjectCandidates']
                         if item['object'] == 'public.shared_object')
        self.assertEqual(len(candidate['inputPaths']), 2)
        self.assertIn('billing', candidate['reviewDomains'])

    def test_focus_cannot_turn_global_unresolved_into_success(self):
        with mock.patch.object(self.module, 'account', return_value=self.report):
            with mock.patch.object(sys, 'argv', ['checker', '--group', 'integrations']):
                with mock.patch.object(Path, 'read_text', return_value='SELECT 1;'):
                    with mock.patch('builtins.print') as output:
                        code = self.module.main()
        self.assertEqual(code, 1)
        document = json.loads(output.call_args.args[0])
        self.assertEqual(document['inputs'], [])
        self.assertEqual(document['global']['unresolvedCounts']['total'], 2)

    def test_real_accounting_rejects_corrupt_checksum_before_grouping(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'scripts').mkdir()
            (root / 'supabase/migrations').mkdir(parents=True)
            for name in ('migration-history-manifest.json',
                         'gridex-aud-003-legacy-foundation.json',
                         'gridex-aud-003-noncanonical-artifacts.json'):
                shutil.copyfile(ROOT / 'scripts' / name, root / 'scripts' / name)
            manifest = json.loads((root / 'scripts/migration-history-manifest.json').read_text())
            name = next(iter(manifest['files']))
            (root / 'supabase/migrations' / name).write_text('-- deliberately corrupt fixture')
            result = subprocess.run([sys.executable, str(CHECKER), '--root', str(root)],
                                    text=True, capture_output=True)
        self.assertEqual(result.returncode, 2, result.stderr)
        document = json.loads(result.stdout)
        self.assertEqual(document['status'], 'INVALID_INPUT_CONTRACT')
        self.assertIn('checksum mismatch', document['errors'][0])

    def test_real_repository_output_is_deterministic_and_unresolved_exit_is_nonzero(self):
        command = [sys.executable, str(CHECKER), '--root', str(ROOT)]
        first = subprocess.run(command, text=True, capture_output=True)
        second = subprocess.run(command, text=True, capture_output=True)
        self.assertEqual(first.returncode, 1, first.stderr)
        self.assertEqual(first.stdout, second.stdout)
        document = json.loads(first.stdout)
        self.assertEqual(len(document['inputs']), document['global']['totalMigrations'])
        self.assertGreater(document['global']['unresolvedCounts']['total'], 0)


if __name__ == '__main__':
    unittest.main()
