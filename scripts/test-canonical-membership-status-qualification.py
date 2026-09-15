import unittest
from unittest.mock import patch
import canonical_membership_status_qualification as m

class Tests(unittest.TestCase):
 def test_source_domain_and_consumer_pins_are_exact(self):
  self.assertEqual(len(m.PINS),3)
  self.assertEqual(len(m.EXPECTED),11)
  self.assertIn("'deleted_test_only'",m.selection())
 def test_changed_source_or_domain_rejected(self):
  path=next(iter(m.PINS))
  with patch.dict(m.PINS,{path:'0'*64}):
   with self.assertRaises(ValueError):m.selection()
  with patch.object(m,'EXPECTED',m.EXPECTED[:-1]):
   with self.assertRaises(ValueError):m.selection()
 def test_finite_behavior_rolls_back_and_preserves_null_semantics(self):
  sql=m.render()
  self.assertTrue(sql.startswith('BEGIN;') and sql.endswith('ROLLBACK;'))
  self.assertIn('tested<>33 OR rejected<>4',sql)
  self.assertIn("status='active' AND is_active=true",sql)
  self.assertIn('VALUES(NULL,true)',sql)
  self.assertNotIn('ALTER TABLE public',sql)

if __name__=='__main__':unittest.main()
