import copy
import unittest
from unittest.mock import patch
from contextlib import ExitStack
import canonical_schema_source_decisions as m

class Tests(unittest.TestCase):
 def fixture(self):
  module=m.comparator()
  diff=dict(scope='FULL_NATIVE_PUBLIC_PROJECTION_NOT_SCHEMA_ACCEPTANCE',
   snapshotSourceSha256=module.PINS['supabase/schema.sql'],syntheticLifecycleProbeStillPresent=False,
   cleanupVerified=True,privateWorkspaceRemoved=True,nativeSchemaRowsAndLedgerPreserved=True,
   referenceRestored=True,referenceDisposed=True,sections={})
  from canonical_forward_sources import FORWARD_SOURCES
  diff.update(foundationInputsExecuted=144,timestampInputsExecuted=514,
   forwardSources=dict(executed=True,inputsExecuted=len(FORWARD_SOURCES),sources=[dict(source=p,sourceSha256=h,
    executed=True,noOpRepeatVerified=True,rowsPreserved=True) for p,h in FORWARD_SOURCES]))
  for key in module.KEYS:diff['sections'][key]=dict(referenceCount=1000,replayCount=1000,
   referenceSha256='a'*64,replaySha256='b'*64,added=[],removed=[],changed=[])
  for r in m.approved():
   keys=('identity','fields','referenceSha256','replaySha256') if r['change']=='changed' else ('identity','sha256')
   group=diff['sections'][r['section']];group[r['change']].append({k:r[k] for k in keys})
   group['replayCount']+=(1 if r['change']=='added' else -1 if r['change']=='removed' else 0)
   diff[r['witness']]={'fixture':True}
  from canonical_native_final_sql import PINS
  diff['nativeFinalSql']=dict(scope='POST_REPLAY_SQL_NOT_SCHEMA_OR_TYPE_ACCEPTANCE',verified=True,
   checks=[dict(source=p,sourceSha256=h,verified=True,catalogAndRowsPreserved=True,ledgerUnchanged=True) for p,h in PINS.items()],
   schemaAccepted=False,generatedTypesVerified=False)
  return diff
 def verify(self,diff,fail=None,context=True):
  with ExitStack() as stack:
   stack.enter_context(patch.object(m.index_columns,'validate_context',side_effect=None if context else ValueError('survivor missing')))
   for key,module in m.WITNESSES.items():
    stack.enter_context(patch.object(module,'validate_execution_receipt',side_effect=ValueError('actual witness rejected') if key==fail else lambda *a,**k:None))
   return m.verify(diff)
 def test_reviewed_scope_is_closed_and_positive_only(self):
  records=m.approved()
  self.assertEqual(len(records),299)
  self.assertEqual(sum(r['section']=='policies' and r['change']=='removed' for r in records),59)
  self.assertFalse(any('REVIEW_REQUIRED' in r['decision'] for r in records))
 def test_exact_mapping_accepts_only_with_every_runtime_receipt(self):
  diff=self.fixture();result=self.verify(diff)
  self.assertTrue(result['schemaAccepted']);self.assertFalse(result['referenceRewritten'])
  for key in m.WITNESSES:
   with self.assertRaises(ValueError):self.verify(diff,fail=key)
 def test_unknown_actual_row_is_an_explicit_blocker(self):
  diff=self.fixture();group=diff['sections']['functions'];group['added'].append(dict(identity=['public','new_fn',''],sha256='c'*64));group['replayCount']+=1
  result=self.verify(diff)
  self.assertFalse(result['schemaAccepted']);self.assertEqual(len(result['unsupported']),1)
  self.assertNotIn('new_fn',str(result['unsupported']))
 def test_missing_duplicate_hash_and_field_drift_rejected(self):
  for defect in ('missing','duplicate','hash','fields','section','cleanup','count'):
   diff=self.fixture();group=diff['sections']['indexes'];row=group['changed'][0]
   if defect=='missing':group['changed'].pop()
   if defect=='duplicate':group['changed'].append(copy.deepcopy(row))
   if defect=='hash':row['replaySha256']='0'*64
   if defect=='fields':row['fields'].append('indisunique')
   if defect=='section':diff['sections'].pop('extensions')
   if defect=='cleanup':diff['cleanupVerified']=False
   if defect=='count':group['replayCount']+=1
   with self.subTest(defect=defect),self.assertRaises(ValueError):self.verify(diff)
 def test_repaired_policy_mapping_requires_every_exact_native_forward_receipt(self):
  for defect in ('missing','hash','repeat'):
   diff=self.fixture()
   if defect=='missing':diff.pop('forwardSources')
   elif defect=='hash':diff['forwardSources']['sources'][5]['sourceSha256']='0'*64
   else:diff['forwardSources']['sources'][5]['noOpRepeatVerified']=False
   with self.subTest(defect=defect),self.assertRaises(ValueError):self.verify(diff)
 def test_survivor_context_is_required_before_source_decisions(self):
  with self.assertRaises(ValueError):self.verify(self.fixture(),context=False)
 def test_inventory_bytes_cannot_be_changed_to_manufacture_approval(self):
  with patch.object(m,'DECISION_SHA','0'*64):
   with self.assertRaises(ValueError):m.approved()
if __name__=='__main__':unittest.main()
