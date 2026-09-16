import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import canonical_constraint_source_decisions as m

class Tests(unittest.TestCase):
 def receipt(self):
  return dict(scope='POST_REPLAY_SQL_NOT_SCHEMA_OR_TYPE_ACCEPTANCE',verified=True,
   checks=[dict(source=p,sourceSha256=h,verified=True,catalogAndRowsPreserved=True,ledgerUnchanged=True) for p,h in m.final_sql.PINS.items()],schemaAccepted=False,generatedTypesVerified=False)
 def test_exact_six_positive_source_constraints_selected(self):
  rows=m.approved();self.assertEqual(len(rows),6)
  self.assertEqual({tuple(r['identity'][1:]) for r in rows},set(m.POSITIVE))
  self.assertFalse(set(m.POSITIVE)&set(m.UNSUPPORTED))
  self.assertTrue(all(r['fields']==['definition'] and r['witness']=='nativeFinalSql' for r in rows))
 def test_changed_source_and_unknown_identity_rejected(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory)
   for p,h in {m.AUDIT:m.AUDIT_SHA,m.INTENT_EVIDENCE:m.INTENT_EVIDENCE_SHA,m.MEMBERSHIP_EVIDENCE:m.MEMBERSHIP_EVIDENCE_SHA,**m.SOURCE_PINS,**m.MEMBERSHIP_SOURCE_PINS}.items():
    dest=root/p;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes((m.ROOT/p).read_bytes())
   self.assertEqual(m.approved(root),m.approved())
   for p in {**m.SOURCE_PINS,**m.MEMBERSHIP_SOURCE_PINS,m.MEMBERSHIP_EVIDENCE:m.MEMBERSHIP_EVIDENCE_SHA}:
    dest=root/p;raw=dest.read_bytes();dest.write_bytes(raw+b' ')
    with self.assertRaises(ValueError):m.approved(root)
    dest.write_bytes(raw)
   with patch.dict(m.POSITIVE,{('unknown','unknown_check'):'GUESS'}):
    with self.assertRaises(ValueError):m.approved(root)
 def test_final_sql_receipt_must_be_exact_native_and_preserved(self):
  good=self.receipt();self.assertIs(m.validate_execution_receipt(good,native=True),good)
  for change in ('hash','missing','order','verified','ledger','extra','bool'):
   bad=copy.deepcopy(good)
   if change=='hash':bad['checks'][0]['sourceSha256']='0'*64
   if change=='missing':bad['checks'].pop()
   if change=='order':bad['checks'].reverse()
   if change=='verified':bad['verified']=False
   if change=='ledger':bad['checks'][0]['ledgerUnchanged']=False
   if change=='extra':bad['schemaAccepted']=True
   if change=='bool':bad['verified']=1
   with self.assertRaises(ValueError):m.validate_execution_receipt(bad,native=True)
  with self.assertRaises(ValueError):m.validate_execution_receipt(good,native=False)
 def test_intent_requires_actual_exact_t514_native_receipt(self):
  unit=dict(kind='timestamp',ordinal=514,phase=1,phaseCount=1,source=m.INTENT_SOURCE,
   sourceSha256=m.INTENT_SHA,phaseSha256=m.INTENT_SHA,executed=True,nativeVerified=True,
   stage='EXECUTED_AND_LEDGER_VERIFIED',unchangedEarlierLedger=True,
   originalHistoricalVersionMarkedApplied=False,outerTransactionTransferredToCli=True,
   programSha256=m.INTENT_PROGRAM_SHA,ledgerStatementsSha256='a'*64,
   cliFile='20260915180000_gridex_native_t0514_p01_'+m.INTENT_PROGRAM_SHA[:12]+'.sql')
  tail=dict(executed=True,timestampInputsExecuted=514,phase='ALL_SELECTED_TIMESTAMP_INPUTS_EXECUTED',noOpRepeatVerified=True,executionUnits=[unit])
  self.assertIs(m.validate_intent_tail(tail),tail)
  for key,value in [('sourceSha256','0'*64),('ordinal',513),('programSha256','b'*64),('nativeVerified',False),('unchangedEarlierLedger',False),('cliFile','other.sql')]:
   bad=copy.deepcopy(tail);bad['executionUnits'][0][key]=value
   with self.assertRaises(ValueError):m.validate_intent_tail(bad)
  for units in ([],[unit,unit]):
   bad={**tail,'executionUnits':units}
   with self.assertRaises(ValueError):m.validate_intent_tail(bad)
 def test_incomplete_native_prefix_cannot_bind_checks(self):
  with self.assertRaises(ValueError):m.validate_native({'nativeFinalSql':self.receipt()})

if __name__=='__main__':unittest.main()
