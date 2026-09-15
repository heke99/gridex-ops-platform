#!/usr/bin/env python3
"""Exact residual accounting and rejection tests, without a database target."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(filename):
    spec = importlib.util.spec_from_file_location('admission_test_' + filename.replace('-', '_'), ROOT/'scripts'/filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AdmissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = load('canonical-residual-source-admission.py')
        cls.complete = load('gridex-replay-complete-accounting.py')
        cls.selected = load('gridex-replay-input-accounting.py').account(ROOT)
        cls.contract = cls.m.verify(ROOT)

    def fixture(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        source_paths = {r['source'] for r in self.contract['sources']}
        for row in self.contract['sources']:
            source_paths.update(a['source'] for a in row['authorities'])
        paths = {'supabase/' + p for p in source_paths}
        paths.update('scripts/' + p for p in (*self.m.MODULES, *self.m.EXECUTORS))
        paths.update((self.m.MANIFEST, 'scripts/gridex-aud-003-foundation-order.json'))
        for relative in paths:
            path = root/relative
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT/relative, path)
        return root

    def rewrite_manifest(self, root, change):
        path = root/self.m.MANIFEST
        value = json.loads(path.read_text())
        change(value)
        path.write_text(json.dumps(value))

    def test_complete_plan_accounts_607_and_retains_601_without_claiming_sql_or_types(self):
        report = self.complete.account(ROOT)
        self.assertEqual(report['totalMigrations'], 607)
        self.assertEqual(report['rawSelectedInputCounts'], {'foundation':144, 'timestamp':520})
        self.assertEqual(report['additionalForwardSourceCount'], 6)
        self.assertEqual(len(report['additionalForwardSources']), 6)
        report = report['historicalAccounting']
        self.assertEqual(report['canonicalCounts'], {'wholeFileSelector':589,'reviewedResidualSources':7,
                                                    'explicitlyExcluded':5,'unresolved':0})
        self.assertEqual(report['totalMigrations'], 601)
        self.assertIs(report['canonicalSourceDispositionsComplete'], True)
        for key in ('sqlExecutionVerified','ledgerProvenanceVerified','completeReplayVerified','generatedTypesVerified'):
            self.assertIs(report[key], False)
            self.assertIs(self.contract[key], False)

    def test_original_selector_still_reports_its_own_seven_unresolved_sources(self):
        self.assertEqual(self.selected['counts'], {'FULL_FILE_SELECTED':589 + 6,'SUBSTITUTED':2,
                                                  'UNCLASSIFIED':5,'EXPLICITLY_EXCLUDED':5})
        result = subprocess.run([sys.executable,str(ROOT/'scripts/gridex-replay-input-accounting.py'),
                                 '--require-full-effects'],capture_output=True,text=True)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(json.loads(result.stdout)['sqlExecutionVerified'])

    def account_selected(self, selected):
        real_load = self.complete.load
        accounting = type('Accounting', (), {'account': staticmethod(lambda root: selected)})
        def loader(filename):
            return accounting if filename == 'gridex-replay-input-accounting.py' else real_load(filename)
        with patch.object(self.complete, 'load', side_effect=loader):
            return self.complete.account(ROOT)

    def test_forward_partition_reports_exact_registered_sources_without_execution_claims(self):
        forward = load('canonical_forward_sources.py')
        report = self.complete.account(ROOT)
        self.assertEqual(tuple((r['source'], r['sourceSha256']) for r in report['additionalForwardSources']),
                         forward.FORWARD_SOURCES)
        self.assertEqual(report['historicalAccounting']['selectedInputCounts'], {'foundation':144, 'timestamp':514})
        self.assertEqual(report['historicalAccounting']['totalMigrations'], 601)
        self.assertEqual(report['historicalAccounting']['canonicalCounts']['wholeFileSelector'], 589)
        self.assertEqual(report['baseSelectorCounts']['FULL_FILE_SELECTED'], 595)
        self.assertEqual(report['canonicalCounts']['additionalForwardSources'], 6)
        for key in ('sqlExecutionVerified','ledgerProvenanceVerified','completeReplayVerified','generatedTypesVerified'):
            self.assertIs(report[key], False)
            for source in report['additionalForwardSources']:
                self.assertIs(source[key], False)

    def test_forward_partition_rejects_unknown_changed_missing_or_reordered_sources(self):
        forward = load('canonical_forward_sources.py')
        for mutation in ('unknown', 'hash', 'missing', 'order', 'historical_hash'):
            with self.subTest(mutation=mutation):
                selected = copy.deepcopy(self.selected)
                path = (forward.FORWARD_SOURCES[0][0] if mutation != 'historical_hash'
                        else 'migrations/20260519_auth_callback_email_reset_sync.sql')
                row = next(r for r in selected['migrations'] if r['path'] == path)
                if mutation == 'unknown':
                    row['path'] = 'migrations/20260915130000_unregistered.sql'
                elif mutation in ('hash', 'historical_hash'):
                    row['sha256'] = '0' * 64
                elif mutation == 'missing':
                    selected['migrations'].remove(row)
                    selected['totalMigrations'] -= 1
                    selected['counts']['FULL_FILE_SELECTED'] -= 1
                    selected['selectedInputCounts']['timestamp'] -= 1
                else:
                    other = next(r for r in selected['migrations'] if r['path'] == forward.FORWARD_SOURCES[1][0])
                    row['execution'], other['execution'] = other['execution'], row['execution']
                with self.assertRaisesRegex(ValueError, 'FORWARD_(INVENTORY|TIMESTAMP)_PARTITION_REQUIRED'):
                    self.account_selected(selected)

    def test_every_source_byte_has_exactly_one_reviewed_disposition(self):
        for row in self.contract['sources']:
            raw = (ROOT/'supabase'/row['source']).read_bytes()
            offset = 0
            for part in row['parts']:
                self.assertEqual(part['startByte'], offset)
                end = part['endByteExclusive']
                self.assertGreater(end, offset)
                self.assertEqual(hashlib.sha256(raw[offset:end]).hexdigest(),part['sha256'])
                offset = end
            self.assertEqual(offset, len(raw))
            self.assertEqual(row['sourceByteCount'],len(raw))

    def test_full_originals_keep_their_complete_sql_hash(self):
        full = [row for row in self.contract['sources'] if row['mode']=='WHOLE_ORIGINAL_AT_REVIEWED_BOUNDARY']
        self.assertEqual(len(full),2)
        for row in full:
            self.assertEqual(row['renderedSha256'],row['sourceSha256'])

    def test_operator_partitions_are_explicit_and_not_reported_executed(self):
        split = [r for r in self.contract['sources'] if r['mode']=='CANONICAL_SCHEMA_WITH_EXPLICIT_OPERATOR_SEPARATION']
        self.assertEqual(len(split),2)
        for row in split:
            self.assertTrue(any(p['disposition']=='EXCLUDED_HISTORICAL_OPERATOR_DDL_AND_DATA' for p in row['parts']))
        self.assertIs(self.contract['historicalOperatorProgramExecuted'],False)

    def test_changed_original_bytes_are_rejected(self):
        root = self.fixture()
        source = root/'supabase'/self.contract['sources'][0]['source']
        source.write_bytes(source.read_bytes()+b'\n-- mutation\n')
        with self.assertRaisesRegex(ValueError,'SOURCE_MISMATCH'):
            self.m.verify(root)

    def test_changed_renderer_or_executor_is_not_admitted_by_the_old_contract(self):
        for name in (*self.m.MODULES,*self.m.EXECUTORS):
            root = self.fixture()
            path = root/'scripts'/name
            path.write_bytes(path.read_bytes()+b'\n# changed\n')
            with self.subTest(name=name),self.assertRaisesRegex(ValueError,'REVIEW_CONTRACT_MISMATCH'):
                self.m.verify(root)

    def test_missing_source_and_symlink_are_rejected(self):
        root = self.fixture()
        path = root/'supabase'/self.contract['sources'][0]['source']
        path.unlink()
        with self.assertRaisesRegex(ValueError,'SOURCE_REQUIRED'):
            self.m.verify(root)
        path.symlink_to(ROOT/'supabase'/self.contract['sources'][0]['source'])
        with self.assertRaisesRegex(ValueError,'SOURCE_REQUIRED'):
            self.m.verify(root)

    def test_changed_boundary_is_rejected_in_source_and_manifest(self):
        root = self.fixture()
        self.rewrite_manifest(root,lambda value:value['sources'][0]['boundary'].update(afterOrdinal=78))
        with self.assertRaisesRegex(ValueError,'REVIEW_CONTRACT_MISMATCH'):
            self.m.verify(root)
        root = self.fixture()
        path = root/'scripts/gridex-aud-003-foundation-order.json'
        value = json.loads(path.read_text());value['foundation'][98:100]=reversed(value['foundation'][98:100])
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError,'BOUNDARY_MISMATCH'):
            self.m.verify(root)

    def test_changed_rendered_hash_or_disposition_is_rejected(self):
        mutations = (
            lambda v:v['sources'][1].update(renderedSha256='0'*64),
            lambda v:v['sources'][1]['parts'][1].update(disposition='COPY_ORIGINAL_SQL'),
            lambda v:v['sources'][1]['parts'].pop(),
            lambda v:v['sources'][0]['parts'][0].update(endByteExclusive=1),
            lambda v:v.update(completeReplayVerified=True),
        )
        for change in mutations:
            root = self.fixture();self.rewrite_manifest(root,change)
            with self.assertRaisesRegex(ValueError,'REVIEW_CONTRACT_MISMATCH'):
                self.m.verify(root)

    def test_scalar_type_substitution_duplicate_keys_and_unknown_keys_rejected(self):
        for value in (0, None, 'false'):
            root = self.fixture();self.rewrite_manifest(root,lambda v:v.update(sqlExecutionVerified=value))
            with self.assertRaisesRegex(ValueError,'REVIEW_CONTRACT_MISMATCH'):
                self.m.verify(root)
        root=self.fixture();self.rewrite_manifest(root,lambda v:v.update(extra=True))
        with self.assertRaisesRegex(ValueError,'REVIEW_CONTRACT_MISMATCH'):
            self.m.verify(root)
        root=self.fixture();path=root/self.m.MANIFEST
        path.write_text('{"scope":"duplicate",'+path.read_text()[1:])
        with self.assertRaisesRegex(ValueError,'DUPLICATE_KEY'):
            self.m.verify(root)

    def test_an_eighth_unresolved_input_is_not_silently_exempted(self):
        selected=copy.deepcopy(self.selected)
        row=copy.deepcopy(next(r for r in selected['migrations'] if r['classification']=='UNCLASSIFIED'))
        row['path']='migrations/unreviewed.sql'
        selected['migrations'].append(row);selected['totalMigrations']+=1;selected['counts']['UNCLASSIFIED']+=1
        report=self.complete.combine(selected,self.contract)
        self.assertIs(report['canonicalSourceDispositionsComplete'],False)
        self.assertEqual(report['unresolved'],['migrations/unreviewed.sql'])

    def test_duplicate_or_missing_residual_is_rejected(self):
        for transform in (lambda rows:rows[:-1],lambda rows:rows[:-1]+[rows[0]]):
            residual=copy.deepcopy(self.contract);residual['sources']=transform(residual['sources'])
            with self.assertRaisesRegex(ValueError,'RESIDUAL_SET_MISMATCH'):
                self.complete.combine(self.selected,residual)

    def test_residual_cannot_overlap_a_selected_or_excluded_file(self):
        for classification in ('FULL_FILE_SELECTED','EXPLICITLY_EXCLUDED'):
            selected=copy.deepcopy(self.selected)
            next(r for r in selected['migrations'] if r['path']==self.contract['sources'][0]['source'])['classification']=classification
            with self.assertRaisesRegex(ValueError,'OVERLAP_OR_SOURCE_MISMATCH'):
                self.complete.combine(selected,self.contract)

    def test_residual_source_hash_must_match_selector(self):
        selected=copy.deepcopy(self.selected)
        next(r for r in selected['migrations'] if r['path']==self.contract['sources'][0]['source'])['sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'OVERLAP_OR_SOURCE_MISMATCH'):
            self.complete.combine(selected,self.contract)

    def test_duplicate_selector_and_false_count_rejected(self):
        selected=copy.deepcopy(self.selected);selected['migrations'].append(selected['migrations'][0]);selected['totalMigrations']+=1
        with self.assertRaisesRegex(ValueError,'DUPLICATE_SOURCE'):
            self.complete.combine(selected,self.contract)
        selected=copy.deepcopy(self.selected);selected['counts']['FULL_FILE_SELECTED']+=1
        with self.assertRaisesRegex(ValueError,'COUNT_MISMATCH'):
            self.complete.combine(selected,self.contract)

    def test_partition_gap_overlap_or_missing_tail_rejected(self):
        for spans in ([(1,3,'COPY')],[(0,2,'COPY'),(1,3,'COPY')],[(0,2,'COPY')],[(False,3,'COPY')]):
            with self.assertRaises(ValueError):
                self.m.partition(b'abc',spans)

    def test_no_replay_target_or_acceptance_override_argument_exists(self):
        for flag in ('--accept','--database-url','--skip-effects'):
            result=subprocess.run([sys.executable,str(ROOT/'scripts/gridex-replay-complete-accounting.py'),flag],
                                  capture_output=True,text=True)
            self.assertEqual(result.returncode,2)


if __name__=='__main__':
    unittest.main(verbosity=2)
