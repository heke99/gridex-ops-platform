#!/usr/bin/env python3
"""Fail-closed exact-registry checks; mocked context is not a database proof."""
import copy
import unittest
from unittest.mock import patch
import canonical_schema_physical_order_decisions as m

class PhysicalOrderTests(unittest.TestCase):
    def setUp(self):
        self.document=m.contract(m.retain())
        self.diff=dict(scope='FULL_NATIVE_PUBLIC_PROJECTION_NOT_SCHEMA_ACCEPTANCE',
            syntheticLifecycleProbeStillPresent=False,cleanupVerified=True,
            privateWorkspaceRemoved=True,nativeSchemaRowsAndLedgerPreserved=True,
            referenceRestored=True,referenceDisposed=True,
            sections={'columns':{'changed':copy.deepcopy(self.document['records'])},
                      'relations':{'changed':copy.deepcopy(self.document['requiredChangedViews'])}},
            changedViewSourceWitness={'fixture':True},nativeFinalSql={'fixture':True})

    def validate_mocked_context(self,diff):
        with patch.object(m.views,'validate_execution_receipt') as view,patch.object(m,'validate_execution_receipt') as final:
            m.validate_context(diff)
            view.assert_called_once_with(diff['changedViewSourceWitness'],native=True)
            final.assert_called_once_with(diff['nativeFinalSql'],native=True)

    def test_exact_positive_mapping(self):
        rows=m.approved()
        self.assertEqual(len(rows),723)
        self.assertEqual(len({tuple(r['identity']) for r in rows}),723)
        self.assertTrue(all(r['fields']==['attnum'] and r['witness']=='nativeFinalSql' for r in rows))
        self.assertEqual([r['identity'][1] for r in self.document['requiredChangedViews']],
                         ['canonical_internal_contract_offers_v','ediel_unresolved_messages'])
        self.validate_mocked_context(self.diff)

    def test_each_pin_and_missing_source_rejected(self):
        retained=m.retain()
        for i in range(len(retained)):
            bad=list(retained);bad[i]=(bad[i][0],bad[i][1]+b'\n')
            with self.assertRaises(ValueError):m.contract(tuple(bad))
        with self.assertRaises(ValueError):m.contract(retained[:-1])
        with self.assertRaises(ValueError):m.contract((retained[0],retained[0]))

    def test_every_hash_pair_and_nonordinal_field_rejected(self):
        for i in range(723):
            for key,value in [('referenceSha256','0'*64),('replaySha256','0'*64),('fields',['attnum','data_type'])]:
                with self.subTest(index=i,key=key):
                    bad=copy.deepcopy(self.diff);bad['sections']['columns']['changed'][i][key]=value
                    with self.assertRaisesRegex(ValueError,'EXACT_RECORDS'):m.validate_context(bad)

    def test_missing_duplicate_unknown_shape_rejected(self):
        for mutation in ('missing','duplicate','unknown','extra'):
            bad=copy.deepcopy(self.diff);rows=bad['sections']['columns']['changed']
            if mutation=='missing':rows.pop()
            elif mutation=='duplicate':rows.append(copy.deepcopy(rows[0]))
            elif mutation=='extra':rows[0]['invented']=True
            else:
                row=copy.deepcopy(rows[0]);row['identity'][-1]='unknown_column';rows.append(row)
            with self.assertRaisesRegex(ValueError,'EXACT_RECORDS'):m.validate_context(bad)

    def test_both_view_contexts_required(self):
        for i in range(2):
            bad=copy.deepcopy(self.diff);bad['sections']['relations']['changed'][i]['replaySha256']='0'*64
            with self.assertRaisesRegex(ValueError,'CHANGED_VIEW_CONTEXT'):m.validate_context(bad)
        with patch.object(m.views,'validate_execution_receipt',side_effect=ValueError('view missing')):
            with self.assertRaisesRegex(ValueError,'view missing'):m.validate_context(self.diff)

    def test_native_receipts_and_preservation_required(self):
        for k in ('cleanupVerified','privateWorkspaceRemoved','nativeSchemaRowsAndLedgerPreserved','referenceRestored','referenceDisposed'):
            bad=copy.deepcopy(self.diff);bad[k]=False
            with self.assertRaisesRegex(ValueError,'NATIVE_CONTEXT'):m.validate_context(bad)
        with self.assertRaises(ValueError):m.validate_context(self.diff)
        with self.assertRaises(ValueError):m.validate_execution_receipt({'fixture':True},native=True)
        with self.assertRaises(ValueError):m.validate_execution_receipt({},native=False)

if __name__=='__main__':unittest.main()
