#!/usr/bin/env python3
"""Finite whole-source admission tests; native checks run in the owned replay."""
import copy
import importlib.util
from pathlib import Path
import sys
import unittest
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]

def load(name):
    spec=importlib.util.spec_from_file_location(name.replace('-','_'),ROOT/'scripts'/(name+'.py'))
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

restored=load('canonical-timestamp-source-restoration')
frontier=load('canonical-foundation-frontier-diagnostic')
tail=frontier.load_timestamp()

class SourceRestorationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.foundation,cls.report=frontier.verify_selection(frontier.load_controller())
        cls.selected,cls.prerequisites=tail.load_inputs(ROOT,cls.report,cls.foundation)

    def test_four_sources_are_selected_whole_at_exact_original_positions(self):
        restored.validate_selection(ROOT,self.selected)
        self.assertEqual(len(self.selected),512)
        self.assertEqual(self.report['counts'],{'FULL_FILE_SELECTED':562,'SUBSTITUTED':19,'UNCLASSIFIED':14,'EXPLICITLY_EXCLUDED':5})
        for row in self.report['migrations']:
            if row['path'] in restored.SOURCES:
                self.assertEqual(row['classification'],'FULL_FILE_SELECTED')
                self.assertEqual(len(row['execution']),1)
                self.assertTrue(all(a['preserveSourceReplay'] for a in row['derivedArtifacts']))

    def test_removed_source_is_rejected(self):
        changed=[s for s in self.selected if s[0]!=next(iter(restored.SOURCES))]
        with self.assertRaisesRegex(ValueError,'RESTORATION_SOURCE_OR_ORDER_MISMATCH'):
            restored.validate_selection(ROOT,changed)

    def test_duplicate_source_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'RESTORATION_SOURCE_OR_ORDER_MISMATCH'):
            restored.validate_selection(ROOT,self.selected+[self.selected[7]])

    def test_changed_order_is_rejected(self):
        changed=list(self.selected);changed[7],changed[8]=changed[8],changed[7]
        with self.assertRaisesRegex(ValueError,'RESTORATION_SOURCE_OR_ORDER_MISMATCH'):
            restored.validate_selection(ROOT,changed)

    def test_changed_source_pin_is_rejected(self):
        changed=list(self.selected);changed[7]=(changed[7][0],'0'*64)
        with self.assertRaisesRegex(ValueError,'RESTORATION_SOURCE_OR_ORDER_MISMATCH'):
            restored.validate_selection(ROOT,changed)

    def test_all_four_sources_have_fail_closed_native_postconditions(self):
        counts=[len(restored.checks(p)) for p in restored.SOURCES]
        self.assertEqual(counts,[8,8,11,5])
        for p in restored.SOURCES:
            for e in restored.checks(p):
                rendered=restored.assert_sql(e)
                self.assertIn('IS DISTINCT FROM true',rendered)
                self.assertIn("ERRCODE='23514'",rendered)

    def test_unlisted_source_has_no_assertion_or_acceptance_path(self):
        with self.assertRaisesRegex(ValueError,'RESTORATION_SOURCE_NOT_ADMITTED'):
            restored.checks('migrations/unknown.sql')

    def test_arbitrary_source_root_is_not_accepted(self):
        with self.assertRaisesRegex(ValueError,'RESTORATION_SOURCE_ROOT_MISMATCH'):
            restored.validate_selection('/tmp',self.selected)

    def test_full_effects_still_has_33_blocking_original_dispositions(self):
        self.assertEqual(self.report['counts']['SUBSTITUTED']+self.report['counts']['UNCLASSIFIED'],33)
        self.assertIs(self.report['sqlExecutionVerified'],False)
        self.assertIs(self.report['ledgerProvenanceVerified'],False)

if __name__=='__main__':unittest.main()
