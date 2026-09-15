#!/usr/bin/env python3
"""Admission and preservation controls for native comparison, no SQL proof."""
import unittest
import importlib.util
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import canonical_native_schema_reference as m
from canonical_native_final_sql import PINS


class Tests(unittest.TestCase):
    def fixture(self):
        target = Mock(); target.snapshot.return_value = ('catalog', 'rows')
        runner = SimpleNamespace(target=target, unchanged=Mock(), entries=['actual-ledger'])
        parent = dict(nativeFinalSql=dict(verified=True, checks=[dict(source=path,sourceSha256=sha,
            verified=True,catalogAndRowsPreserved=True,ledgerUnchanged=True) for path,sha in PINS.items()]),
            forwardSources=dict(inputsExecuted=4))
        comparator = Mock()
        import canonical_policy_actor_qualification as actors
        parent['policyActorQualification'] = dict(actors.expected_result(), source=actors.SOURCE,
            sourceSha256=actors.SOURCE_SHA256, completePolicyContextSha256='a'*64,
            catalogAndRowsPreserved=True,nativeTarget=True,ledgerProvenanceAccepted=False)
        comparator.pinned.return_value = {'supabase/schema.sql': b'exact-reference'}
        comparator.compare.return_value = dict(schemaAccepted=False, generatedTypesVerified=False)
        comparator.capture.return_value = dict(relations=[dict(nspname="public",relname="gridex_native_lifecycle_probe")])
        return runner, parent, comparator

    def test_complete_comparison_keeps_acceptance_false(self):
        runner, parent, comparator = self.fixture()
        with patch('canonical_native_final_sql.admit_forward') as admit, patch.object(m,'load_comparator',return_value=comparator):
            result=m.compare(runner, (), parent)
        admit.assert_called_once_with(runner, (), parent)
        comparator.capture.assert_called_once_with(runner.target, 'postgres')
        self.assertFalse(result['schemaAccepted'])
        self.assertFalse(result['cleanupVerified'])
        self.assertTrue(result['syntheticLifecycleProbeStillPresent'])
        runner.unchanged.assert_called_once()

    def test_missing_final_sql_or_real_ledger_blocks_reference_restore(self):
        for defect in ('checks', 'hash', 'ledger', 'actor'):
            runner, parent, comparator = self.fixture()
            if defect == 'checks': parent['nativeFinalSql']['checks'].pop()
            if defect == 'hash': parent['nativeFinalSql']['checks'][0]['sourceSha256']='bad'
            if defect == 'actor': parent['policyActorQualification']={}
            with patch('canonical_native_final_sql.admit_forward',side_effect=ValueError('ledger') if defect=='ledger' else None), patch.object(m,'load_comparator',return_value=comparator):
                with self.assertRaises(ValueError): m.compare(runner, (), parent)
            comparator.isolated_reference.assert_not_called()

    def test_native_mutation_blocks_comparison(self):
        runner, parent, comparator = self.fixture()
        runner.target.snapshot.side_effect=[('catalog','rows'),('changed','rows')]
        with patch('canonical_native_final_sql.admit_forward'), patch.object(m,'load_comparator',return_value=comparator):
            with self.assertRaisesRegex(ValueError,'PRESERVATION'): m.compare(runner, (), parent)
        comparator.compare.assert_not_called()


    def test_report_is_not_published_when_either_disposal_proof_is_missing(self):
        spec=importlib.util.spec_from_file_location('native_schema_lifecycle',Path(__file__).with_name('canonical-native-supabase-lifecycle.py'))
        lifecycle=importlib.util.module_from_spec(spec);spec.loader.exec_module(lifecycle)
        for cleanup,private in ((False,True),(True,False),(False,False),(True,True)):
            with self.subTest(cleanup=cleanup,private=private), tempfile.TemporaryDirectory() as tmp:
                report=dict(cleanupVerified=cleanup,privateWorkspaceRemoved=private,
                    _nativeSchemaComparison=dict(sections={},schemaAccepted=False))
                lifecycle.publish_schema_comparison(report,Path(tmp))
                self.assertEqual((Path(tmp)/'native-full-schema-reference-diff.json').exists(), cleanup and private)
                self.assertNotIn('_nativeSchemaComparison',report)
                if not(cleanup and private):
                    self.assertEqual(report['nativeSchemaReferenceComparison'],dict(available=False,
                        reason='NATIVE_DISPOSAL_REQUIRED',schemaAccepted=False))


if __name__=='__main__': unittest.main()
