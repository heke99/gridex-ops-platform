#!/usr/bin/env python3
import unittest
from types import SimpleNamespace
from unittest.mock import Mock,patch
import canonical_native_parity_engine as m

class Tests(unittest.TestCase):
 def document(self):
  return {'schemas':['public'],**{k:[] for k in ('relations','columns','enums','constraints','indexes','functions','triggers','policies','relation_grants','function_grants','schema_grants','extensions')}}
 def test_pinned_original_sql_and_all_twenty_assertions_retained(self):
  retained=m.retain()
  self.assertEqual(len(retained['expected']),20)
  self.assertIn('create table companies',retained['base'])
  self.assertIn('alter view secure_customers set',retained['drift'])
  self.assertIn("add value 'cancelled'",retained['enum'])
 def test_actual_production_engine_equal_and_detected_grant_option_drift(self):
  retained=m.retain();left=self.document();right=self.document()
  self.assertEqual(m.run_engine(left,right,retained)[0],0)
  left['schema_grants']=[dict(nspname='public',grantee='pg_monitor',privilege_type='USAGE',is_grantable=False)]
  right['schema_grants']=[dict(nspname='public',grantee='pg_monitor',privilege_type='USAGE',is_grantable=True)]
  code,output=m.run_engine(left,right,retained)
  self.assertEqual(code,1)
  self.assertIn('schema grant public USAGE -> pg_monitor: is_grantable differs',output)
 def test_missing_catalog_section_cannot_count_as_detected_drift(self):
  retained=m.retain();left=self.document();right=self.document();right.pop('policies')
  code,_=m.run_engine(left,right,retained)
  self.assertEqual(code,2)
 def test_exception_drops_both_clones_and_does_not_mark_verified(self):
  runner=SimpleNamespace(target=Mock(spec=["assert_native_owned","reset","sql","drop_clone"]),unchanged=Mock())
  runner.target.sql.side_effect=['',ValueError('SQL_FAILURE')]
  report={}
  with patch.object(m,'admit'),patch.object(m,'snapshot',return_value='same'):
   with self.assertRaisesRegex(ValueError,'SQL_FAILURE'):m.execute(runner,(),report)
  self.assertEqual([x.args[0] for x in runner.target.drop_clone.call_args_list],list(reversed(m.CLONES)))
  self.assertNotIn('nativeParityEngineQualification',report)
 def test_full_flow_requires_all_original_expectations_and_parent_preservation(self):
  retained=m.retain()
  for defect in (None,'missing_case','parent','cleanup'):
   runner=SimpleNamespace(target=Mock(spec=['assert_native_owned','reset','sql','drop_clone']),unchanged=Mock())
   runner.target.sql.return_value='{}'
   report={}
   output='\n'.join(expected for _,expected in retained['expected'])
   if defect=='missing_case':output='\n'.join(output.splitlines()[:-1])
   if defect=='cleanup':runner.target.drop_clone.side_effect=[ValueError('DROP_FAILURE'),None]
   with self.subTest(defect=defect),patch.object(m,'admit'),patch.object(m,'snapshot',side_effect=['same','changed' if defect=='parent' else 'same']),patch.object(m,'run_engine',side_effect=[(0,''),(1,output)]):
    if defect:
     with self.assertRaises(ValueError):m.execute(runner,(),report)
     self.assertNotIn('nativeParityEngineQualification',report)
    else:
     receipt=m.execute(runner,(),report)
     self.assertEqual(len(receipt['driftCases']),20)
     self.assertFalse(receipt['schemaAccepted'])
    self.assertEqual(runner.target.drop_clone.call_count,2)
 def test_modified_source_pin_rejected(self):
  with patch.object(m,'PINS',{**m.PINS,'scripts/gridex-db-parity-selftest.sh':'0'*64}):
   with self.assertRaisesRegex(ValueError,'SOURCE_REQUIRED'):m.retain()
if __name__=='__main__':unittest.main()
