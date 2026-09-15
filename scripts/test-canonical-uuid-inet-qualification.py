import unittest
from types import SimpleNamespace
from unittest.mock import Mock,patch
import canonical_uuid_inet_qualification as m

class Tests(unittest.TestCase):
 def test_exact_sources_and_supported_payload_program(self):
  retained=m.retain();m.contract(retained);sql=m.render(retained)
  self.assertTrue(sql.startswith('BEGIN;'));self.assertTrue(sql.endswith('ROLLBACK;'))
  self.assertEqual(sql.count('CREATE TEMP TABLE'),2)
  self.assertIn('jsonb_populate_record',sql);self.assertIn('EXCEPTION WHEN invalid_text_representation',sql)
  self.assertIn('uuid_cases<>3 OR ip_cases<>5 OR rejected<>7',sql)
  for forbidden in ('INSERT INTO public.','ALTER TABLE','GRANT ','CREATE TABLE public.'):self.assertNotIn(forbidden,sql)
 def test_changed_missing_reordered_sources_rejected(self):
  retained=m.retain()
  for bad in ((),retained[:-1],retained[::-1],((retained[0][0],retained[0][1]+b' '),)+retained[1:]):
   with self.assertRaises(ValueError):m.contract(bad)
 def test_unowned_target_never_executes(self):
  with patch.object(m.subprocess,'run') as run:
   with self.assertRaises(ValueError):m.query(Mock(),'SELECT true;')
   run.assert_not_called()
 def test_execution_and_preservation_fail_closed(self):
  retained=m.retain()
  for defect in (None,'sql','result','snapshot','source','owner'):
   target=Mock();query=Mock(return_value='f' if defect=='result' else 't')
   if defect=='sql':query.side_effect=ValueError('SQL rejected')
   with patch.object(m,'admit',side_effect=[None,ValueError('ownership lost') if defect=='owner' else None]),\
        patch.object(m,'query',query),patch.object(m.actors,'_snapshot',side_effect=['before','changed' if defect=='snapshot' else 'before']),\
        patch.object(m,'retain',return_value=() if defect=='source' else retained):
    if defect:
     with self.subTest(defect=defect),self.assertRaises(ValueError):m.execute(target,retained)
    else:
     receipt=m.execute(target,retained);self.assertEqual(receipt['supportedIpCases'],5)
     self.assertTrue(receipt['catalogAndRowsPreserved']);self.assertFalse(receipt['schemaAccepted'])
     self.assertFalse(receipt['foreignKeyQualified']);self.assertFalse(receipt['postgrestHttpVerified'])
 def test_query_uses_owned_stdin_without_sql_output_files(self):
  target=Mock();target.command.return_value=['docker','exec','-i','owned','psql']
  legacy=SimpleNamespace(clean_environment=lambda:{},safe_receipt=lambda *args:{'sqlstate':'00000'})
  result=SimpleNamespace(returncode=0,stdout=b't\n',stderr=b'')
  with patch.object(m,'admit'),patch.object(m,'load_legacy',return_value=legacy),patch.object(m.subprocess,'run',return_value=result) as run:
   self.assertEqual(m.query(target,'SELECT true;'),'t')
   self.assertEqual(run.call_args.args[0][-2:],['-f','-']);self.assertEqual(run.call_args.kwargs['input'],b'SELECT true;')
   result.returncode=1;result.stderr=b'private SQL'
   with self.assertRaisesRegex(ValueError,'UUID_INET_SQL_REQUIRED'):m.query(target,'SELECT true;')
if __name__=='__main__':unittest.main()
