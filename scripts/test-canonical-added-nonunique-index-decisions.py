import copy,json,unittest
from unittest.mock import patch
import canonical_added_nonunique_index_decisions as m

class Tests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.retained=m.retain();cls.records=m.contract(cls.retained)
 def actual(self):return [dict(row=copy.deepcopy(r['row']),valid=True,ready=True,live=True) for r in self.records]
 def test_exact_positive362_only(self):
  rows=m.approved();self.assertEqual(len(rows),362)
  self.assertTrue(all(r['section']=='indexes' and r['change']=='added' for r in rows))
  allrows=json.loads(dict(self.retained)[m.REGISTER])['records']
  excluded={tuple(r['identity']) for r in allrows if r['row']['indisunique'] or r['row']['indisprimary']}
  self.assertEqual(len(excluded),89);self.assertFalse(excluded&{tuple(r['identity']) for r in rows})
  self.assertEqual(len(m.PINS)-2,66)
 def test_each_source_pin_changed_rejected(self):
  for i in range(len(self.retained)):
   changed=list(self.retained);p,raw=changed[i];changed[i]=(p,raw+b' ')
   with self.assertRaises(ValueError):m.contract(tuple(changed))
 def test_native_every_definition_and_index_state_required(self):
  m.verify_rows(self.actual(),self.retained)
  for mutation in ('definition','missing','duplicate','unknown','unique','valid','ready','live','bool'):
   rows=self.actual()
   if mutation=='definition':rows[0]['row']['definition']+=' WHERE false'
   elif mutation=='missing':rows.pop()
   elif mutation=='duplicate':rows[-1]=rows[0]
   elif mutation=='unknown':rows[0]['row']['indexname']='unknown'
   elif mutation=='unique':rows[0]['row']['indisunique']=True
   elif mutation=='bool':rows[0]['valid']=1
   else:rows[0][mutation]=False
   with self.assertRaises(ValueError):m.verify_rows(rows,self.retained)
 def test_receipt_requires_real_native_catalog_and_preservation(self):
  good=m.expected_receipt();m.validate_execution_receipt(good,native=True)
  for key,value in [('validReadyLiveVerified',False),('indexCount',451),('ledgerUnchanged',False),('verified',1),('sourcePinsSha256','0'*64),('schemaAccepted',True)]:
   bad={**good,key:value}
   with self.assertRaises(ValueError):m.validate_execution_receipt(bad,native=True)
  with self.assertRaises(ValueError):m.validate_execution_receipt(good,native=False)
 def test_parent_binds_query_and_preserves_ledger(self):
  from contextlib import ExitStack
  for broken in (False,True):
   progress={}
   with ExitStack() as stack:
    stack.enter_context(patch.object(m.actors,'_admit',return_value=('postgres',True)))
    stack.enter_context(patch.object(m.actors,'_complete'))
    stack.enter_context(patch.object(m.actors,'_snapshot',return_value={}))
    stack.enter_context(patch.object(m.transport,'parent_ledger',side_effect=[[],[1] if broken else []]))
    stack.enter_context(patch.object(m.transport,'query',return_value=json.dumps(self.actual())))
    if broken:
     with self.assertRaises(ValueError):m.execute_parent(object(),self.retained,progress)
     self.assertFalse(progress[m.KEY]['verified'])
    else:self.assertTrue(m.execute_parent(object(),self.retained,progress)['verified'])
 def test_external_target_no_query(self):
  with patch.object(m.transport,'query') as query:
   with self.assertRaises(ValueError):m.execute_parent(object(),self.retained,{})
   query.assert_not_called()
 def test_readonly_query_checks_private_index_state(self):
  sql=m.render(self.retained)
  self.assertTrue(sql.startswith('SELECT'))
  for field in ('i.indisvalid','i.indisready','i.indislive','pg_get_indexdef(i.indexrelid)'):self.assertIn(field,sql)
  self.assertNotIn('CREATE ',sql)

if __name__=='__main__':unittest.main()
