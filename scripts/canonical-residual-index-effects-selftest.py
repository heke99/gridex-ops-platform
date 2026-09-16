#!/usr/bin/env python3
"""Finite index source/oracle controls; native PostgreSQL supplies catalog proof."""
import importlib.util
from pathlib import Path
from unittest.mock import patch
import unittest

ROOT=Path(__file__).resolve().parents[1]

class IndexEffectTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec=importlib.util.spec_from_file_location('index_effects',ROOT/'scripts/canonical-residual-index-effects.py')
        cls.m=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.m)
        cls.raw={p:(ROOT/'supabase'/p).read_bytes() for p in cls.m.PINS}

    def test_exact_finite_declarations(self):
        self.assertEqual([len(self.m.declarations(p,self.raw[p])) for p in self.m.PINS],[15,4])
        for p,raw in self.raw.items():
            self.assertEqual(tuple(d[0] for d in self.m.declarations(p,raw)),self.m.OBJECTS[p])

    def test_changed_missing_wrong_type_source_rejected(self):
        for p,raw in self.raw.items():
            for value in (raw+b'\n',b'',raw.decode(),bytearray(raw)):
                with self.subTest(source=p,kind=type(value).__name__),self.assertRaises(ValueError):
                    self.m.declarations(p,value)
        with self.assertRaises(ValueError):self.m.declarations('../unknown.sql',b'SELECT 1;')

    def test_oracle_uses_temporary_empty_tables_not_public_ddl(self):
        for p,raw in self.raw.items():
            sql=self.m.oracle(p,raw)
            self.assertIn('CREATE TEMP TABLE',sql)
            self.assertIn('ON COMMIT DROP',sql)
            self.assertNotIn('DROP INDEX public.',sql)
            self.assertNotIn('DELETE FROM public.',sql)
            self.assertNotIn('INSERT INTO public.',sql)
            self.assertEqual(sql.count('INSERT INTO pg_temp.gridex_index_effects'),len(self.m.OBJECTS[p]))

    def test_oracle_compares_semantics_not_names_alone(self):
        sql=self.m.oracle(self.m.DB1,self.raw[self.m.DB1])
        for term in ('indisunique','indnkeyatts','indnatts','indnullsnotdistinct','indisvalid',
                     'indisready','indimmediate','indcollation','indclass','indoption',
                     'pg_get_indexdef','pg_get_expr','indrelid','relam'):
            self.assertIn(term,sql)

    def test_result_contract_is_exact_and_true_only(self):
        rows=[{'index':d[1],'matches':True} for d in self.m.declarations(self.m.DB1,self.raw[self.m.DB1])]
        self.assertEqual(self.m.validate_result(self.m.DB1,self.raw[self.m.DB1],rows),[])
        for mutation in (rows[:-1],rows+rows[:1],None,{},[{'index':'unknown','matches':True}]):
            with self.assertRaises(ValueError):self.m.validate_result(self.m.DB1,self.raw[self.m.DB1],mutation)
        for value in (None,1,'true',{},[]):
            with self.assertRaises(ValueError):
                self.m.validate_result(self.m.DB1,self.raw[self.m.DB1],[{**rows[0],'matches':value},*rows[1:]])
        self.assertEqual(self.m.validate_result(self.m.DB1,self.raw[self.m.DB1],
            [{**rows[0],'matches':False},*rows[1:]]),[rows[0]['index']])

    def test_no_source_files_reopened(self):
        with patch.object(Path,'read_bytes',side_effect=AssertionError('source reopened')):
            for p,raw in self.raw.items():self.m.oracle(p,raw)

    def test_unowned_targets_rejected_before_sql(self):
        class Target:
            active=True;name='different';_created_name='owner'
            def command(self,*args):raise AssertionError('database touched')
        for target,db in ((Target(),'gridex_auth_legacy_replay'),(object(),'postgres'),
                          ('postgresql://live','gridex_auth_legacy_replay')):
            with self.assertRaises(ValueError):self.m.verify(target,db,self.m.DB1,self.raw[self.m.DB1])

    def test_both_actual_execution_lanes_verify_db1(self):
        for name in ('canonical-residual-replay.py','canonical-residual-transition-native.py'):
            self.assertIn('canonical-residual-index-effects.py',(ROOT/'scripts'/name).read_text())
        self.assertIn('canonical-residual-index-effects.py',(ROOT/'scripts/canonical-db2-reconstruction-native.py').read_text())

if __name__=='__main__':unittest.main(verbosity=2)
