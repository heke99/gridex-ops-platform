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
  c=m.constraints
  diff['historicalTimestampTail']=dict(executed=True,timestampInputsExecuted=514,
   phase='ALL_SELECTED_TIMESTAMP_INPUTS_EXECUTED',noOpRepeatVerified=True,executionUnits=[dict(
    kind='timestamp',ordinal=514,phase=1,phaseCount=1,source=c.INTENT_SOURCE,
    sourceSha256=c.INTENT_SHA,phaseSha256=c.INTENT_SHA,executed=True,nativeVerified=True,
    stage='EXECUTED_AND_LEDGER_VERIFIED',unchangedEarlierLedger=True,
    originalHistoricalVersionMarkedApplied=False,programSha256=c.INTENT_PROGRAM_SHA,
    outerTransactionTransferredToCli=True,ledgerStatementsSha256='a'*64,
    cliFile='20260915123456_gridex_native_t0514_p01_'+c.INTENT_PROGRAM_SHA[:12]+'.sql')])
  from canonical_native_final_sql import PINS
  diff['nativeFinalSql']=dict(scope='POST_REPLAY_SQL_NOT_SCHEMA_OR_TYPE_ACCEPTANCE',verified=True,
   checks=[dict(source=p,sourceSha256=h,verified=True,catalogAndRowsPreserved=True,ledgerUnchanged=True) for p,h in PINS.items()],
   schemaAccepted=False,generatedTypesVerified=False)
  # The UUID decision requires this actual FK context, but does not approve its behavior.
  diff['sections']['constraints']['added'].append(dict(identity=['public','ediel_send_locks','ediel_send_locks_locked_by_fkey'],sha256=m.uuid_inet.FK_SHA))
  diff['sections']['constraints']['replayCount']+=1
  return diff
 def verify(self,diff,fail=None,context=True):
  with ExitStack() as stack:
   stack.enter_context(patch.object(m.index_columns,'validate_context',side_effect=None if context else ValueError('survivor missing')))
   for key,module in m.WITNESSES.items():
    stack.enter_context(patch.object(module,'validate_execution_receipt',side_effect=ValueError('actual witness rejected') if key==fail else lambda *a,**k:None))
   return m.verify(diff)
 def test_reviewed_scope_is_closed_and_positive_only(self):
  records=m.approved()
  self.assertEqual(len(records),1390)
  self.assertEqual(sum(r['section']=='policies' and r['change']=='removed' for r in records),59)
  self.assertFalse(any('REVIEW_REQUIRED' in r['decision'] for r in records))
 def test_exact_mapping_requires_receipts_and_keeps_fk_acceptance_separate(self):
  diff=self.fixture();result=self.verify(diff)
  self.assertFalse(result['schemaAccepted']);self.assertFalse(result['referenceRewritten'])
  self.assertEqual(len(result['matched']),1390)
  self.assertEqual([(r['section'],r['change']) for r in result['unsupported']],[('constraints','added')])
  for key in m.WITNESSES:
   with self.assertRaises(ValueError):self.verify(diff,fail=key)
 def test_unknown_actual_row_is_an_explicit_blocker(self):
  diff=self.fixture();group=diff['sections']['functions'];group['added'].append(dict(identity=['public','new_fn',''],sha256='c'*64));group['replayCount']+=1
  result=self.verify(diff)
  self.assertFalse(result['schemaAccepted']);self.assertEqual(len(result['unsupported']),2)
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
 def test_intent_mapping_requires_exact_complete_native_t514_proof(self):
  for defect in ('missing','source','program','duplicate','ledger','incomplete'):
   diff=self.fixture();tail=diff['historicalTimestampTail'];unit=tail['executionUnits'][0]
   if defect=='missing':diff.pop('historicalTimestampTail')
   if defect=='source':unit['sourceSha256']='0'*64
   if defect=='program':unit['programSha256']='0'*64
   if defect=='duplicate':tail['executionUnits'].append(copy.deepcopy(unit))
   if defect=='ledger':unit['ledgerStatementsSha256']='missing'
   if defect=='incomplete':tail['timestampInputsExecuted']=513
   with self.subTest(defect=defect),self.assertRaises(ValueError):self.verify(diff)
 def test_uuid_requires_actual_fk_context(self):
  diff=self.fixture();diff['sections']['constraints']['added'].clear()
  with self.assertRaisesRegex(ValueError,'UUID_INET_FK_METADATA_REQUIRED'):self.verify(diff)
 def test_inventory_bytes_cannot_be_changed_to_manufacture_approval(self):
  with patch.object(m,'DECISION_SHA','0'*64):
   with self.assertRaises(ValueError):m.approved()
if __name__=='__main__':unittest.main()
