#!/usr/bin/env python3
import hashlib
import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('db2_reconstruction',ROOT/'scripts/canonical-db2-reconstruction.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class DB2Tests(unittest.TestCase):
    def test_all_source_bytes_have_exactly_one_disposition(self):
        for path in m.PINS:
            raw=m.read(ROOT,path)
            parts=m.partition(path,raw)
            self.assertEqual(b''.join(part[3] for part in parts),raw)
            self.assertEqual(m.ledger(path,raw)['sha256'],hashlib.sha256(raw).hexdigest())
            self.assertFalse(m.ledger(path,raw)['wholeOriginalExecuted'])

    def test_changed_sources_are_not_silently_admitted(self):
        for path in m.PINS:
            with self.assertRaisesRegex(ValueError,'DB2_SOURCE_MISMATCH'):
                m.reconstruct(path,m.read(ROOT,path)+b'\n')

    def test_all_generic_schema_ranges_are_preserved(self):
        raw=m.read(ROOT,m.PREFLIGHT); rendered=m.reconstruct(m.PREFLIGHT,raw)
        for _,_,kind,value in m.partition(m.PREFLIGHT,raw):
            if kind=='schema': self.assertIn(value.decode(),rendered)
        self.assertEqual(rendered.count('alter table public.'),68)

    def test_schema_execution_has_no_reconciliation_dml_or_swallowing(self):
        sql=m.reconstruct(m.PREFLIGHT,m.read(ROOT,m.PREFLIGHT)).lower()
        for bad in ('update public.','insert into public.','gridex_db1_try_exec(',
                    'gridex_db2_v4_assert_ready(', 'run_customer_profile_backfill(',
                    'run_membership_reconciliation(', 'create table public.customer_profiles'):
            self.assertNotIn(bad,sql)
        self.assertEqual(sql.count('create unique index if not exists '),1)
        self.assertEqual(sql.count('create index if not exists '),3)

    def test_only_generic_closeout_check_is_retained(self):
        sql=m.reconstruct(m.FINISH,m.read(ROOT,m.FINISH))
        self.assertIn('schema_contract_missing_code_columns',sql)
        self.assertIn('issues <> 0',sql)
        for bad in ('company_count_not_one','div3rsa_missing','update public.','create or replace view public.gridex_db2_v4_final_readiness_v'):
            self.assertNotIn(bad,sql)

    def test_legacy_model_requires_separate_operator_work(self):
        for path in m.PINS:
            sql=m.reconstruct(path,m.read(ROOT,path))
            self.assertIn("to_regclass('public.customer_profiles') IS NOT NULL",sql)
            self.assertIn('DB2_LEGACY_OPERATOR_RECONCILIATION_REQUIRED',sql)

if __name__=='__main__': unittest.main()
