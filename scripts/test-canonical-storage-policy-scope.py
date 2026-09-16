"""Offline checks for exact Storage policy-role narrowing; not SQL evidence."""
import copy
import unittest
from unittest.mock import patch
import canonical_storage_policy_scope as m

class ScopeTests(unittest.TestCase):
    def snapshots(self):
        before = dict(catalog={'unrelated': {'unchanged': True}}, rows={'storage.objects': [2,'hash']}, ledger=[])
        for key,command in zip(m.KEYS,('r','a')):
            before['catalog'][key] = dict(command=command,permissive=True,roles=['0'],
                using='original predicate' if command=='r' else None,
                check='original predicate' if command=='a' else None)
        after=copy.deepcopy(before)
        for key in m.KEYS:after['catalog'][key]['roles']=['123']
        return before,after

    def test_only_two_policy_role_lists_may_change(self):
        before,after=self.snapshots()
        m.verify_delta(before,after,123)
        for defect in ('rows','ledger','using','check','command','permissive','extra','role','missing'):
            bad=copy.deepcopy(after)
            if defect in ('rows','ledger'):bad[defect]={}
            elif defect=='extra':bad['catalog']['unexpected']={}
            elif defect=='missing':del bad['catalog'][m.KEYS[0]]
            elif defect=='role':bad['catalog'][m.KEYS[0]]['roles']=[0,123]
            else:bad['catalog'][m.KEYS[0]][defect]='changed'
            with self.subTest(defect=defect),self.assertRaises(ValueError):m.verify_delta(before,bad,123)

    def test_unknown_preimages_and_roles_rejected(self):
        before,after=self.snapshots()
        for value in (None,True,'123',0,-1):
            with self.assertRaises(ValueError):m.verify_delta(before,after,value)
        for key in m.KEYS:
            for role in ([0],[True],['00'],['123'],[],['0','123']):
                bad=copy.deepcopy(before);bad['catalog'][key]['roles']=role
                with self.assertRaises(ValueError):m.verify_delta(bad,after,123)
        self.assertEqual(before,self.snapshots()[0])

    def test_numeric_or_noncanonical_postimage_role_is_rejected(self):
        before,after=self.snapshots()
        for value in ([123],[True],[123.0],['0123'],['0'],['123','0']):
            bad=copy.deepcopy(after)
            bad['catalog'][m.KEYS[0]]['roles']=value
            with self.subTest(value=value),self.assertRaises(ValueError):
                m.verify_delta(before,bad,123)

    def test_errors_are_closed_and_never_disclose_free_text(self):
        for table in ('roles','user_roles'):
            raw=f'psql:<stdin>:7: ERROR:  42501: permission denied for table {table}\nCONTEXT: private SQL\n'.encode()
            self.assertEqual('table:'+table,m.error_header(raw))
        for raw in (b'ERROR:  42501: permission denied for table secret\n',
                    b'ERROR:  42501: permission denied for table roles private data\n',
                    b'ERROR:  42501: permission denied for table roles\nERROR:  42501: other\n',
                    b'psql:other.sql:7: ERROR:  42501: permission denied for table roles\n',
                    b'ERROR:  42501: permission denied for table roles\x00',b'\xff',b'x'*65537,None):
            self.assertIsNone(m.error_header(raw))

    def test_source_pins_and_candidate_boundary(self):
        raw=m.candidate();text=raw.decode()
        self.assertIn('BEGIN;',text);self.assertTrue(text.endswith('COMMIT;\n'))
        self.assertIn('ALTER POLICY %I ON storage.objects TO authenticated',text)
        for forbidden in ('GRANT ','DISABLE ROW LEVEL SECURITY','SECURITY DEFINER','UPDATE public.','DELETE FROM '):
            self.assertNotIn(forbidden,text)
        with patch.object(m,'CANDIDATE_SHA','0'*64):
            with self.assertRaises(ValueError):m.candidate()
        with patch.object(m,'SOURCE_SHA','0'*64):
            with self.assertRaises(ValueError):m.candidate()

    def test_complete_original_s21_terminal_is_required(self):
        m.complete_s21('\nPERMISSION_CASE_COMPLETE\n')
        for output in ('','PERMISSION_CASE_COMPLETE\nnot complete','PERMISSION_CASE_COMPLETE\nPERMISSION_CASE_COMPLETE\n'):
            with self.assertRaises(ValueError):m.complete_s21(output)

if __name__=='__main__':unittest.main()
