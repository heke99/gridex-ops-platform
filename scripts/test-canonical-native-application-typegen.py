#!/usr/bin/env python3
"""Candidate transport negative controls; offline tests are not native evidence."""
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
import canonical_native_application_typegen as m

RAW=b'''export type Json = string | number | null
export type Database = {
 public: { Tables: { companies: { Row: { id: string } } }
 Functions: { resolve_ediel_timeseries_product_511: {
 Returns: { description: string\nvalid_to: string }[]
 } } }
}
'''
class Tests(unittest.TestCase):
 def test_output_rejects_fixture_invalid_bytes_and_missing_application(self):
  m.validate_raw(RAW)
  for raw in (RAW+b'gridex_native_lifecycle_probe:', b'error', RAW.replace(b'companies:',b'wrong:'),RAW+b'\xff'):
   with self.assertRaises(ValueError): m.validate_raw(raw)
 def test_existing_override_is_applied_to_private_candidate(self):
  transformed=m.apply_override(RAW)
  self.assertIn(b'description: string | null',transformed)
  self.assertIn(b'valid_to: string | null',transformed)
 def test_generation_requires_twice_identical_bytes_and_preservation(self):
  for defect in (None,'repeat','exit','state'):
   with self.subTest(defect=defect):
    runner=SimpleNamespace(target=Mock(),unchanged=Mock(),native=Mock())
    runner.native.side_effect=[SimpleNamespace(returncode=0,stdout=RAW),SimpleNamespace(returncode=1 if defect=='exit' else 0,stdout=RAW+b'\n' if defect=='repeat' else RAW)]
    from canonical_native_parity_engine import expected_receipt
    parent={'nativeParityEngineQualification':expected_receipt()}
    with patch.object(m,'admit'),patch.object(m,'snapshot',side_effect=['same','changed' if defect=='state' else 'same','same']):
     if defect:
      with self.assertRaises(ValueError): m.execute(runner,(),parent,'owned-project')
      self.assertNotIn('_nativeApplicationTypeCandidate',parent)
     else:
      m.execute(runner,(),parent,'owned-project')
      self.assertFalse(parent['nativeApplicationTypeCandidate']['generatedTypesVerified'])
      self.assertEqual(runner.native.call_count,2)
 def test_no_export_before_success_and_disposal(self):
  for success,cleanup,disposed in ((False,True,True),(True,False,True),(True,True,False)):
   with tempfile.TemporaryDirectory() as tmp:
    parent={'_nativeApplicationTypeCandidate':RAW,'cleanupVerified':cleanup,'privateWorkspaceRemoved':disposed}
    m.publish(parent,Path(tmp),success=success)
    self.assertNotIn('_nativeApplicationTypeCandidate',parent)
    self.assertEqual(list(Path(tmp).iterdir()),[])
 def test_success_exports_bound_candidate_only_after_disposal(self):
  with tempfile.TemporaryDirectory() as tmp:
   receipt={'candidateSha256':m.sha(RAW),'candidateBytes':len(RAW),'exported':False}
   parent={'_nativeApplicationTypeCandidate':RAW,'nativeApplicationTypeCandidate':receipt,
           'cleanupVerified':True,'privateWorkspaceRemoved':True}
   m.publish(parent,Path(tmp),success=True)
   self.assertEqual((Path(tmp)/'native-application-database.types.candidate.ts').read_bytes(),RAW)
   self.assertTrue(receipt['exported'])
   self.assertNotIn('_nativeApplicationTypeCandidate',parent)
 def test_wrong_export_hash_rejected_without_artifact(self):
  with tempfile.TemporaryDirectory() as tmp:
   parent={'_nativeApplicationTypeCandidate':RAW,'nativeApplicationTypeCandidate':{'candidateSha256':'0'*64},
           'cleanupVerified':True,'privateWorkspaceRemoved':True}
   with self.assertRaises(ValueError):m.publish(parent,Path(tmp),success=True)
   self.assertEqual(list(Path(tmp).iterdir()),[])
 def test_real_combined_order_parity_then_candidate_without_circular_admission(self):
  import canonical_native_parity_engine as parity
  runner=SimpleNamespace(target=Mock(spec=['assert_native_owned','reset','sql','drop_clone']),unchanged=Mock(),native=Mock(return_value=SimpleNamespace(returncode=0,stdout=RAW)))
  runner.target.sql.return_value='{}'
  parent={}
  output='\n'.join(expected for _,expected in parity.retain()['expected'])
  with patch.object(m,'admit'),patch.object(m,'snapshot',return_value='same'),patch.object(parity,'snapshot',return_value='same'),patch.object(parity,'run_engine',side_effect=[(0,''),(1,output)]):
   with self.assertRaisesRegex(ValueError,'PARITY_ENGINE_RECEIPT'):m.execute(runner,(),parent,'owned-project')
   runner.native.assert_not_called()
   parity.execute(runner,(),parent)
   m.execute(runner,(),parent,'owned-project')
  self.assertIn('_nativeApplicationTypeCandidate',parent)
  self.assertEqual(runner.native.call_count,2)
 def test_index_witness_must_match_same_schema_comparison_before_typegen(self):
  import canonical_policy_actor_qualification as actors
  import canonical_removed_policy_qualification as removed
  import canonical_added_view_witness as views
  import canonical_changed_view_witness as changed_views
  import canonical_changed_function_witness as functions
  import canonical_changed_index_witness as indexes
  import canonical_intake_jsonb_qualification as intake
  from canonical_native_final_sql import PINS
  from canonical_forward_sources import FORWARD_SOURCES
  modules=((actors,'policyActorQualification'),(removed,'removedPolicyQualification'),
           (views,'addedViewSourceWitness'),(changed_views,'changedViewSourceWitness'),
           (functions,'changedFunctionBehaviorWitness'),(intake,'intakeJsonbSourceWitness'))
  receipt=indexes.expected_receipt(indexes.contract(indexes.retain(indexes.ROOT)),native=True)
  for defect in (None,'missing','hash','comparison'):
   parent=dict(cliVersion='2.101.0',foundationInputsExecuted=144,timestampInputsExecuted=514,
    forwardSources=dict(inputsExecuted=len(FORWARD_SOURCES)),
    nativeFinalSql=dict(verified=True,checks=[dict(source=p,sourceSha256=h,verified=True,
      catalogAndRowsPreserved=True,ledgerUnchanged=True) for p,h in PINS.items()]),
    changedIndexSourceWitness=receipt.copy())
   comparison=dict(scope='FULL_NATIVE_PUBLIC_PROJECTION_NOT_SCHEMA_ACCEPTANCE',
    syntheticLifecycleProbeStillPresent=False,actualLedgerRows=0,referenceRestored=True,
    referenceDisposed=True,nativeSchemaRowsAndLedgerPreserved=True,changedIndexSourceWitness=receipt.copy())
   for _,key in modules:parent[key]=comparison[key]={'fixture':key}
   parent['_nativeSchemaComparison']=comparison
   if defect=='missing':parent.pop('changedIndexSourceWitness')
   if defect=='hash':parent['changedIndexSourceWitness']['sourceSelectionSha256']='0'*64
   if defect=='comparison':comparison['changedIndexSourceWitness']={}
   from contextlib import ExitStack
   with ExitStack() as stack:
    stack.enter_context(patch('canonical_native_final_sql.admit_forward'))
    stack.enter_context(patch('canonical_native_probe_cleanup.admit_completed'))
    for module,_ in modules:stack.enter_context(patch.object(module,'validate_execution_receipt',side_effect=lambda value,**kw:value))
    if defect:
     with self.assertRaises(ValueError):m.admit(SimpleNamespace(entries=[]),(),parent)
    else:m.admit(SimpleNamespace(entries=[]),(),parent)
 def test_missing_prerequisites_reject_before_generation(self):
  with patch('canonical_native_final_sql.admit_forward'),patch('canonical_native_probe_cleanup.admit_completed'):
   with self.assertRaises(ValueError):m.admit(SimpleNamespace(),(),{})
if __name__=='__main__':unittest.main()
