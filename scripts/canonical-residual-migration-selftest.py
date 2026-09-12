#!/usr/bin/env python3
"""Unit/source tests only. These do not claim a native PostgreSQL execution."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest
import sys
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('residual_probe', ROOT/'scripts/canonical-residual-migration-probe.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

class ResidualTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = probe.load('gridex-replay-input-accounting').account(ROOT)

    def test_exact_complete_residual_inventory(self):
        sources = probe.bound_sources(self.report)
        self.assertEqual(len(sources), 37)
        self.assertEqual(len(set(sources)), 37)
        self.assertEqual(self.report['counts']['SUBSTITUTED'], 19)
        self.assertEqual(self.report['counts']['UNCLASSIFIED'], 14)

    def test_edited_hash_is_rejected(self):
        wrong = copy.deepcopy(self.report)
        next(x for x in wrong['migrations'] if x['classification']=='UNCLASSIFIED')['sha256']='0'*64
        with self.assertRaisesRegex(ValueError, 'RESIDUAL_SOURCE_SET_MISMATCH'):
            probe.bound_sources(wrong)

    def test_missing_source_is_rejected(self):
        wrong = copy.deepcopy(self.report)
        wrong['migrations'] = [x for x in wrong['migrations'] if x['path'] != probe.BASELINE_PATHS[0]]
        with self.assertRaisesRegex(ValueError, 'RESIDUAL_SOURCE_SET_MISMATCH'):
            probe.bound_sources(wrong)

    def test_reordered_sources_are_rejected(self):
        wrong = copy.deepcopy(self.report); wrong['migrations'].reverse()
        with self.assertRaisesRegex(ValueError, 'RESIDUAL_SOURCE_SET_MISMATCH'):
            probe.bound_sources(wrong)

    def test_input_errors_cannot_be_ignored(self):
        wrong = dict(self.report,errors=['not safe'])
        with self.assertRaisesRegex(ValueError, 'RESIDUAL_INVENTORY_MISMATCH'):
            probe.bound_sources(wrong)

    def test_safe_receipt_does_not_copy_values(self):
        text=json.dumps(dict(stage='residual_1',sqlstate='42601',exit_code=3,sql='private-value'))
        self.assertEqual(probe.native_result(text,'residual_1',False),dict(sqlstate='42601',exitCode=3))

    def test_missing_native_evidence_does_not_become_success(self):
        for text in ('', 'private SQL text', '{}', '[]'):
            with self.assertRaisesRegex(ValueError, 'RESIDUAL_RECEIPT_MISMATCH'):
                probe.native_result(text, 'residual_1', True)

    def test_wrong_stage_and_duplicate_receipt_are_rejected(self):
        text=json.dumps(dict(stage='residual_2',sqlstate='00000',exit_code=0))
        for raw, stage in ((text, 'residual_1'),(text+'\n'+text, 'residual_2')):
            with self.assertRaisesRegex(ValueError, 'RESIDUAL_RECEIPT_MISMATCH'):
                probe.native_result(raw, stage, True)

    def test_state_and_process_result_must_agree(self):
        for state,code,success in [('00000',3,False),('42601',0,True),('00000',False,True),('private-value',3,False)]:
            text=json.dumps(dict(stage='residual_1',sqlstate=state,exit_code=code))
            with self.assertRaisesRegex(ValueError, 'RESIDUAL_RECEIPT_MISMATCH'):
                probe.native_result(text,'residual_1',success)

    def test_catalog_diff_is_metadata_only(self):
        before={'column/public.demo/x':{'default':'private-value'},'relation/public.old':1}
        after={'column/public.demo/x':{'default':'other-private-value'},'relation/public.new':1}
        result=probe.catalog_delta(before,after)
        self.assertEqual(result['changed']['keys'],['column/public.demo/x'])
        self.assertEqual(result['added']['keys'],['relation/public.new'])
        self.assertEqual(result['removed']['keys'],['relation/public.old'])
        self.assertNotIn('private-value',json.dumps(result))

    def test_arbitrary_catalog_text_is_not_exposed(self):
        with self.assertRaisesRegex(ValueError,'RESIDUAL_CATALOG_KEY_MISMATCH'):
            probe.catalog_delta({}, {'column/user@example.test': 'private-value'})

    def test_unknown_target_and_checkpoint_fail_before_sql(self):
        controller=probe.load('canonical-foundation-frontier-diagnostic').load_controller()
        with self.assertRaisesRegex(ValueError, 'RESIDUAL_OWNED_CHECKPOINT_REQUIRED'):
            probe.probe_sources(controller, None, object(), self.report,'foundation118')
        with self.assertRaisesRegex(ValueError, 'RESIDUAL_OWNED_CHECKPOINT_REQUIRED'):
            probe.probe_sources(controller, None, object(), self.report,'production')

if __name__=='__main__':
    unittest.main()
