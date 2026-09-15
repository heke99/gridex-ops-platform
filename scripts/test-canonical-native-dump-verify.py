import unittest
from types import SimpleNamespace
from unittest.mock import Mock,patch
import canonical_native_dump_verify as m

class Tests(unittest.TestCase):
 def test_production_normalizer_preserves_body_text_and_stable_guards(self):
  raw=b"-- Dumped by pg_dump version 17.1\n\\restrict abc\nSELECT '-- body';\n\\unrestrict abc\n"
  result=m.normalize(raw)
  self.assertIn(b"SELECT '-- body';",result)
  self.assertNotIn(b'17.1',result);self.assertIn(b'gridexCanonicalSchemaSnapshot',result)
  self.assertEqual(result,m.normalize(raw.replace(b'abc',b'def')))
 def execute(self,outputs,state='same'):
  runner=SimpleNamespace(target=Mock(),unchanged=Mock());parent={}
  with patch.object(m,'admit_forward'),patch.object(m,'admit_completed'),\
       patch.object(m,'native_snapshot',side_effect=['same',state]),patch.object(m,'capture',side_effect=outputs):
   return m.execute(runner,(),parent)
 def test_exact_dump_and_repeat_are_required(self):
  raw=m.sources()[m.REFERENCE];receipt=self.execute([raw,raw]);m.validate(receipt)
  self.assertTrue(receipt['dumpEqual']);self.assertFalse(receipt['rawDumpExported'])
  for defect in ('repeat','state'):
   with self.assertRaises(ValueError):self.execute([raw,raw+b'SELECT 1;\n' if defect=='repeat' else raw],state='changed' if defect=='state' else 'same')
 def test_dump_difference_is_retained_but_cannot_pass_release(self):
  raw=m.sources()[m.REFERENCE].replace(b'\\unrestrict ',b'ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO anon;\n\\unrestrict ')
  receipt=self.execute([raw,raw]);self.assertFalse(receipt['dumpEqual'])
  with self.assertRaises(ValueError):m.validate(receipt)
  self.assertNotIn('ALTER DEFAULT',str(receipt))
 def test_forged_receipt_and_source_rejected(self):
  raw=m.sources()[m.REFERENCE];receipt=self.execute([raw,raw])
  for key,value in [('verified',1),('actualSha256','0'*64),('rawDumpExported',True),('extra',True)]:
   with self.assertRaises(ValueError):m.validate(dict(receipt,**{key:value}))
  with patch.object(m,'NORMALIZER_SHA','0'*64):
   with self.assertRaises(ValueError):m.sources()
 def test_unowned_target_never_runs_dump(self):
  with patch.object(m.subprocess,'run') as run:
   with self.assertRaises(ValueError):m.capture(Mock())
   run.assert_not_called()
if __name__=='__main__':unittest.main()
