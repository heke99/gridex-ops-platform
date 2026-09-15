#!/usr/bin/env python3
"""Portable forward transition controls; transport fixtures are not SQL proof."""
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import canonical_forward_portable as m
import canonical_forward_sources as sources

ROOT = Path(__file__).resolve().parents[1]

class PortableTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.retained = sources.retain(ROOT)

    def exercise(self, snapshots=None, postcondition=True, source_error=False):
        calls = []
        def sql(db, query, label, **kwargs):
            calls.append((db, query, label, kwargs))
            if label == 'forward_source_1' and source_error:
                raise ValueError('actual-source-failure')
            return json.dumps(postcondition)
        target = SimpleNamespace(sql=Mock(side_effect=sql))
        progress = dict(foundationApplied=144, timestampApplied=514)
        with patch.object(m, 'snapshot', side_effect=snapshots or [({}, [])]*6):
            try:
                result = m.execute(target, self.retained, progress)
            except ValueError as error:
                return error, progress, calls
        return result, progress, calls

    def test_partial_prefix_and_repeat_invocation_cannot_execute_sql(self):
        for progress in ({}, dict(foundationApplied=144,timestampApplied=513),
                         dict(foundationApplied=144,timestampApplied=514,forwardSources={})):
            target=Mock()
            with self.assertRaisesRegex(ValueError, 'FORWARD_PORTABLE_PREFIX_REQUIRED'):
                m.execute(target,self.retained,progress)
            target.sql.assert_not_called()

    def test_two_sources_execute_retained_bytes_and_repeat_without_nested_transaction(self):
        result, progress, calls = self.exercise()
        self.assertTrue(result['executed'])
        self.assertEqual(result['inputsExecuted'],2)
        self.assertFalse(result['ledgerProvenanceVerified'])
        self.assertFalse(result['schemaAccepted'])
        source_calls=[c for c in calls if c[2].startswith(('forward_source_','forward_repeat_'))]
        self.assertEqual([c[1].encode() for c in source_calls],
                         [self.retained[0].sql]*2+[self.retained[1].sql]*2)
        self.assertTrue(all(c[0]==m.DATABASE and c[3]==dict(transaction=False) for c in source_calls))

    def test_row_mutation_blocks_repeat_and_second_source(self):
        result, progress, calls = self.exercise(snapshots=[({},[]),({},['changed'])])
        self.assertEqual(str(result),'FORWARD_PORTABLE_POSTCONDITION_REQUIRED')
        self.assertFalse(progress['forwardSources']['executed'])
        self.assertFalse(any(c[2].startswith('forward_repeat') for c in calls))

    def test_catalog_drift_on_repeat_blocks_acceptance(self):
        result, progress, _ = self.exercise(snapshots=[({},[]),({},[]),({'drift':True},[])])
        self.assertEqual(str(result),'FORWARD_PORTABLE_REPEAT_REQUIRED')
        self.assertEqual(progress['forwardSources']['inputsExecuted'],0)

    def test_failed_postcondition_and_source_cannot_claim_execution(self):
        for args in (dict(postcondition=False),dict(source_error=True)):
            result, progress, calls = self.exercise(**args)
            self.assertIsInstance(result,ValueError)
            self.assertFalse(progress['forwardSources']['executed'])
            self.assertEqual(progress['forwardSources']['inputsExecuted'],0)
            self.assertFalse(any(c[2]=='forward_source_2' for c in calls))

if __name__ == '__main__':
    unittest.main()
