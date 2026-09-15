import copy
import unittest
from unittest.mock import patch
import canonical_uuid_inet_source_decisions as m
from canonical_forward_sources import FORWARD_SOURCES
from canonical_native_final_sql import PINS

class Tests(unittest.TestCase):
 def fixture(self):
  return dict(foundationInputsExecuted=144,timestampInputsExecuted=514,
   forwardSources=dict(executed=True,inputsExecuted=len(FORWARD_SOURCES),sources=[dict(source=p,sourceSha256=h,
    executed=True,noOpRepeatVerified=True,rowsPreserved=True) for p,h in FORWARD_SOURCES]),
   nativeFinalSql=dict(scope='POST_REPLAY_SQL_NOT_SCHEMA_OR_TYPE_ACCEPTANCE',verified=True,
    checks=[dict(source=p,sourceSha256=h,verified=True,catalogAndRowsPreserved=True,ledgerUnchanged=True) for p,h in PINS.items()],schemaAccepted=False,generatedTypesVerified=False),
   sections=dict(columns=dict(added=[],removed=[],changed=[{k:r[k] for k in ('identity','fields','referenceSha256','replaySha256')} for r in m.approved()]),
    constraints=dict(added=[dict(identity=['public','ediel_send_locks','ediel_send_locks_locked_by_fkey'],sha256=m.FK_SHA)],changed=[],removed=[])))
 def test_exact_four_column_rows_and_actual_payload_evidence(self):
  records=m.approved();self.assertEqual(len(records),2)
  for old,new in m.rows():
   self.assertEqual(set(old),set(new));self.assertTrue(old['is_nullable']);self.assertTrue(new['is_nullable'])
   self.assertEqual(old['attnum'],new['attnum']);self.assertEqual(new['column_default'],'')
  evidence=m.evidence();self.assertEqual(evidence['receipt']['invalidTextRejections'],7)
  self.assertFalse(evidence['receipt']['foreignKeyQualified'])
 def test_exact_native_metadata_and_fk_context_preserve_explicit_limits(self):
  receipt=m.validate_context(self.fixture())
  self.assertTrue(receipt['actualColumnMetadataVerified']);self.assertTrue(receipt['validatedAuthUserFkMetadataVerified'])
  for key in ('unknownUserRejectionExecuted','parentDeleteBehaviorExecuted','postgrestHttpVerified','arbitraryTextCompatible','inetTextByteEquivalence','schemaAccepted'):
   self.assertFalse(receipt[key])
 def test_missing_changed_duplicate_column_or_fk_is_never_approved(self):
  for section,change in (('columns','changed'),('constraints','added')):
   for defect in ('missing','hash','duplicate','extra','reclassified'):
    diff=self.fixture();rows=diff['sections'][section][change];row=rows[0]
    if defect=='missing':rows.pop(0)
    if defect=='hash':row['replaySha256' if section=='columns' else 'sha256']='0'*64
    if defect=='duplicate':rows.append(copy.deepcopy(row))
    if defect=='extra':row['extra']=True
    if defect=='reclassified':diff['sections'][section]['removed'].append(copy.deepcopy(row))
    with self.subTest(section=section,defect=defect),self.assertRaises(ValueError):m.validate_context(diff)
 def test_partial_native_or_final_sql_cannot_supply_metadata(self):
  for defect in ('prefix','forward','final'):
   diff=self.fixture()
   if defect=='prefix':diff['timestampInputsExecuted']=513
   if defect=='forward':diff['forwardSources']['sources'][-1]['noOpRepeatVerified']=False
   if defect=='final':diff['nativeFinalSql']['checks'][-1]['ledgerUnchanged']=False
   with self.assertRaises(ValueError):m.validate_context(diff)
 def test_evidence_and_reconstructed_hashes_are_pinned(self):
  with patch.object(m,'EVIDENCE_SHA','0'*64):
   with self.assertRaises(ValueError):m.approved()
  with patch.object(m,'FK_SHA','0'*64):
   with self.assertRaises(ValueError):m.approved()
if __name__=='__main__':unittest.main()
