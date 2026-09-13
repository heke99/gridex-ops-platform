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

    def test_known_email_index_preimage_is_bound_to_immutable_history(self):
        source = ROOT/'supabase/migrations/20260519_saas_ui_tenant_admin.sql'
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), m.INVITE_PREIMAGE_SHA256)
        self.assertIn('ON public.company_invitations (lower(email), status);', source.read_text())

    def test_email_index_transition_is_guarded_and_precedes_original_ddl(self):
        sql = m.reconstruct(m.PREFLIGHT, m.read(ROOT, m.PREFLIGHT))
        guard = sql.index('DB2_INVITATION_INDEX_PREIMAGE_MISMATCH')
        ddl = sql.index('create index if not exists company_invitations_email_status_idx')
        self.assertLess(guard, ddl)
        for term in ('LOCK TABLE public.company_invitations IN SHARE MODE',
                     'DB2_INVITATION_INDEX_OWNED_DATABASE_REQUIRED',
                     'IS DISTINCT FROM', 'indisclustered', 'indisreplident',
                     'pg_description', 'pg_seclabel', 'reloptions', 'reltablespace'):
            self.assertIn(term, sql)
        self.assertEqual(sql.count('DROP INDEX public.company_invitations_email_status_idx;'), 1)
        self.assertNotIn('CASCADE', sql)
        self.assertIn('ON pg_temp.gridex_db2_invite_index_shape(lower(email), status);', sql)
        self.assertIn('ON pg_temp.gridex_db2_invite_index_shape(lower(email), status, created_at desc);', sql)

    def test_email_index_transition_compares_full_semantics(self):
        sql = m.reconstruct(m.PREFLIGHT, m.read(ROOT, m.PREFLIGHT))
        for term in ('indisunique', 'indisprimary', 'indisexclusion', 'indimmediate',
                     'indnullsnotdistinct', 'indisvalid', 'indisready', 'indislive',
                     'relam', 'indnkeyatts', 'indnatts', 'pg_get_indexdef', 'pg_get_expr',
                     'indcollation', 'indclass', 'indoption', 'indrelid'):
            self.assertIn(term, sql)

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
