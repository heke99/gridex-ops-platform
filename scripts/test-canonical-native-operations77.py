#!/usr/bin/env python3
"""Offline contracts for the finite69–77 continuation; not native SQL evidence."""
import copy
import importlib
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]

class Sources(unittest.TestCase):
    def setUp(self):
        self.m = importlib.import_module('canonical_native_operations77')
        self.p = importlib.import_module('canonical_native_historical_prefix')
        self.groups = self.m.load_groups(self.p)

    def test_exact_three_source_groups_and_bytes(self):
        self.assertEqual([(g.start,g.end) for g in self.groups], [(69,71),(72,74),(75,77)])
        self.assertEqual([[s.key for s in g.sources] for g in self.groups], [['L','E','U'],['M','E','Z'],['R','D','I']])
        for g in self.groups:
            for source in g.sources:
                self.assertEqual(self.p.cli_program(source.data),(source.data,False))

    def test_changed_pinned_support_and_missing_source_rejected(self):
        with patch.dict(self.m.PINS, {'canonical-customer-operations-batch.py':'0'*64}):
            with self.assertRaises(self.p.PrefixError): self.m.load_groups(self.p)
        g=self.groups[0]
        with patch.object(g.batch,'validate_sources',return_value=g.sources[::-1]):
            with self.assertRaises(self.p.PrefixError):
                self.m.prepare(self.p,g,({},[]),{},[],(),(),token='a'*32)

    def test_only_native_fixed_system_metadata_profile(self):
        profile=[{'relation':n,'owner':'supabase_admin','canSelect':True,'canWrite':False,'canStrongLock':False}
                 for n in self.m.SYSTEM_TABLES]
        self.assertEqual(self.m.system_profile(self.p,profile),self.m.SYSTEM_TABLES)
        for bad in (profile[:-1],profile*2,profile[::-1], [{**v,'canSelect':1} for v in profile],
                    [{**v,'canWrite':True} for v in profile],[{**v,'owner':'unknown'} for v in profile]):
            with self.assertRaises(self.p.PrefixError): self.m.system_profile(self.p,bad)

    def test_envelope_keeps_source_assertions_locks_timeouts_and_is_atomic(self):
        for g in self.groups:
            shape={'relation/public.fixture':{'kind':'r','owner':'postgres'}}
            with patch.object(g.batch,'new_index_keys',return_value=()):
                program=self.m.prepare(self.p,g,(shape,[]),shape,[],(),(),token='a'*32)
            self.assertEqual(len(self.p.identity(program.sql.decode())),3)
            for s in g.sources:self.assertEqual(program.sql.count(s.data),1)
            for part in (b'ACCESS EXCLUSIVE MODE',b'pg_advisory_xact_lock',b'operations_admission',
                         b'ALIGNMENT_FULL_ROWS_MISMATCH',b'IN SHARE ROW EXCLUSIVE MODE',
                         b"current_database()<>'postgres'",b'native_tail_context',b"SET LOCAL lock_timeout='3s'"):
                self.assertIn(part,program.sql)
            self.assertNotIn(b'INSERT INTO supabase_migrations',program.sql)
            self.assertNotIn(b'DISABLE TRIGGER',program.sql)
            self.assertEqual([x.state for x in program.probes], ['P0002',f'P{g.end}01','57014',f'P{g.end}02',f'P{g.end}03'])
            self.assertTrue(program.probes[-1].guard)
            self.assertNotIn(b'COMMIT;',program.sql)

    def test_finite_metadata_adapter_does_not_remove_domain_or_source_checks(self):
        g=self.groups[0];m=self.m
        domains=tuple(sorted(m.repair.PROVIDER_METADATA))
        shape={'relation/'+n:{'kind':'r','owner':o} for n,o in m.repair.PROVIDER_METADATA.items()}
        with patch.object(g.batch,'new_index_keys',return_value=()):
            program=m.prepare(self.p,g,(shape,[]),shape,[],domains,m.SYSTEM_TABLES,token='a'*32)
        self.assertEqual([x.state for x in program.probes], ['P0002','42501','42501','P7101','57014','P7102','P7103'])
        self.assertEqual([x.denied for x in program.probes[1:3]],['auth.schema_migrations','pg_catalog.pg_proc'])
        self.assertIn(b'LOCK TABLE pg_catalog.pg_description IN ACCESS SHARE MODE',program.sql)
        for s in g.sources:self.assertEqual(program.sql.count(s.data),1)
        for bad in (('public.fixture',),domains[::-1]):
            with self.assertRaises(self.p.PrefixError):
                m.prepare(self.p,g,(shape,[]),shape,[],bad,m.SYSTEM_TABLES,token='a'*32)

    def test_provider_references_are_not_ignored(self):
        g=self.groups[0];shape={'relation/auth.schema_migrations':{'kind':'r','owner':'supabase_auth_admin'}}
        with patch.object(self.m.repair.previous,'source_mentions_identifier',return_value=True):
            with self.assertRaises(self.p.PrefixError):
                self.m.prepare(self.p,g,(shape,[]),shape,[],('auth.schema_migrations',),(),token='a'*32)

    def test_delimiters_bad_tokens_and_group_order_rejected(self):
        g=self.groups[0]
        for bad in ('', 'x'*32, 'a'*31):
            with self.assertRaises(self.p.PrefixError):
                self.m.prepare(self.p,g,({},[]),{},[],(),(),token=bad)
        with self.assertRaises(self.p.PrefixError):
            self.m.wrap(self.p,['$native_tail_body$'])

    def test_guard_binds_real_ledger_identity_temp_context_and_all_locks(self):
        for g in self.groups:
            name=f'gridex_native_f{g.start:04d}_{g.end:04d}_'+'a'*12
            value=self.m.ledger_guard(g,name)
            for s in (name,'SECURITY INVOKER','pg_locks','txid_current','native_tail_context',
                      "stage='complete'",'3 seconds','60 seconds'):
                self.assertIn(s,value)
            self.assertNotIn('SECURITY DEFINER',value)
            with self.assertRaises(ValueError):self.m.ledger_guard(g,'arbitrary')

    def test_verified68_mandatory_before_any_additional_sql(self):
        def fail(*args,**kw):self.fail('SQL before prefix authorization')
        with self.assertRaises(self.p.PrefixError):
            self.m.execute(self.p,fail,fail,Path('/tmp'),{})

    def test_lifecycle_runs_tail_before_accepting_bounded77(self):
        text=(ROOT/'scripts/canonical-native-supabase-lifecycle.py').read_text()
        self.assertIn('canonical_native_operations77',text)
        self.assertIn('NATIVE_HISTORICAL_THROUGH77_VERIFIED',text)
        self.assertIn('NATIVE_LATER_ENVELOPES_AND_FULL_ACCEPTANCE_REQUIRED',
                      (ROOT/'scripts/canonical-auth-provisioning-replay.py').read_text())

class Probes(unittest.TestCase):
    def run_case(self,fault=None):
        m=importlib.import_module('canonical_native_operations77');p=importlib.import_module('canonical_native_historical_prefix')
        g=m.load_groups(p)[0]
        program=m.Program(g,b'SELECT 9;',tuple(m.Probe(f'SELECT {i};'.encode(),state,guard=i==4)
            for i,state in enumerate(('P7101','57014','P7102','P7103'),1)))
        entries=[{'version':'20260914000000','name':'earlier','statements':['SELECT 1']}]
        state={'runs':0,'guard':False};report={}
        with tempfile.TemporaryDirectory() as d:
            directory=Path(d);directory.chmod(0o700);old=directory/'20260914000000_earlier.sql'
            old.write_bytes(b'SELECT 1;');old.chmod(0o600);meta=old.stat()
            retained=[(old,b'SELECT 1;',(meta.st_dev,meta.st_ino))]
            def native(*args,**kwargs):
                if args[:2]==('migration','new'):
                    (directory/(f'2026091400000{state["runs"]+1}_'+args[2]+'.sql')).write_text('')
                    return SimpleNamespace(returncode=0,stderr=b'')
                self.assertEqual(args,('migration','up','--local'));self.assertTrue(kwargs['allow_failure'])
                state['runs']+=1
                code=program.probes[state['runs']-1].state
                if state['runs']==4:self.assertTrue(state['guard'])
                if fault=='file':old.write_bytes(b'SELECT 2;')
                return SimpleNamespace(returncode=0 if fault=='success' else 1,stderr=('SQLSTATE '+('P9999' if fault=='error' else code)).encode())
            def sql(query):
                if query==p.LEDGER_SQL:return entries+[{}] if fault=='ledger' else copy.deepcopy(entries)
                if query==m.DROP_GUARD:
                    state['guard']=False;return fault!='cleanup'
                self.assertIn('CREATE TRIGGER gridex_native_tail_guard',query);state['guard']=True;return True
            def snapshot():return {'rows':int(bool(state['runs']) and fault=='rows'),'provider':int(bool(state['runs']) and fault=='provider')}
            with patch.object(m.time,'sleep'):
                if fault:
                    with self.assertRaises(p.PrefixError):m.qualify(p,native,sql,directory,program,entries,retained,snapshot,report)
                    self.assertFalse(report['verified'])
                else:
                    m.qualify(p,native,sql,directory,program,entries,retained,snapshot,report)
                    self.assertTrue(report['verified']);self.assertEqual(len(report['cases']),4)
                    self.assertEqual(list(directory.iterdir()),[old]);self.assertFalse(state['guard'])
    def test_real_call_order_and_cleanup_model(self):self.run_case()
    def test_successful_fault_is_not_accepted(self):self.run_case('success')
    def test_wrong_sqlstate_is_not_accepted(self):self.run_case('error')
    def test_prior_file_mutation_rejected(self):self.run_case('file')
    def test_failed_ledger_mutation_rejected(self):self.run_case('ledger')
    def test_row_rollback_failure_rejected(self):self.run_case('rows')
    def test_provider_rollback_failure_rejected(self):self.run_case('provider')
    def test_guard_cleanup_failure_rejected(self):self.run_case('cleanup')

if __name__=='__main__':unittest.main(verbosity=2)
