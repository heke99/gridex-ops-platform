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
 def test_only_four_positive_source_checks_selected(self):
  rows=m.approved();self.assertEqual(len(rows),4)
  self.assertEqual({tuple(r['identity'][1:]) for r in rows},set(m.POSITIVE))
  self.assertFalse(set(m.POSITIVE)&set(m.UNSUPPORTED))
  self.assertTrue(all(r['fields']==['definition'] and r['witness']=='nativeFinalSql' for r in rows))
 def test_changed_source_and_unknown_identity_rejected(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory)
   for p,h in {m.AUDIT:m.AUDIT_SHA,**m.SOURCE_PINS}.items():
    dest=root/p;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes((m.ROOT/p).read_bytes())
   self.assertEqual(m.approved(root),m.approved())
   for p in m.SOURCE_PINS:
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
 def test_incomplete_native_prefix_cannot_bind_checks(self):
  with self.assertRaises(ValueError):m.validate_native({'nativeFinalSql':self.receipt()})

if __name__=='__main__':unittest.main()
