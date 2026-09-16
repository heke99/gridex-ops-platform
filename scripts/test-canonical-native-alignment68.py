#!/usr/bin/env python3
"""Offline controls. Native acceptance requires the ordinary OPS artifact."""
import copy
from datetime import datetime, timezone
import importlib
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]

class SourceTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue((ROOT/'scripts/canonical_native_alignment68.py').is_file())
        self.m=importlib.import_module('canonical_native_alignment68')
        self.p=importlib.import_module('canonical_native_historical_prefix')
        self.batch,self.sources=self.m.load_sources(self.p)

    def test_exact_sources_without_interior_transactions(self):
        self.assertEqual([s.key for s in self.sources],['P','A','B','C','W'])
        for s in self.sources:
            self.assertEqual(self.p.cli_program(s.data),(s.data,False))
        self.assertEqual(len(self.batch.index_declarations(self.sources)),57)

    def test_altered_support_is_rejected(self):
        with patch.dict(self.m.PINS,{'canonical-user-rbac-customer-alignment-batch.py':'0'*64}):
            with self.assertRaises(self.p.PrefixError):self.m.load_sources(self.p)

    def test_system_profile_is_finite_and_read_only(self):
        values=[{'relation':n,'owner':'supabase_admin','canSelect':True,'canWrite':False,'canStrongLock':False}
                for n in self.m.SYSTEM_TABLES]
        self.assertEqual(self.m.system_profile(self.p,values),tuple(self.m.SYSTEM_TABLES))
        for bad in (values[:-1],values+values[:1],[{**v,'owner':'other'} for v in values],
                    [{**v,'canSelect':False} for v in values],[{**v,'canWrite':True} for v in values],
                    [{**v,'canStrongLock':1} for v in values]):
            with self.assertRaises(self.p.PrefixError):self.m.system_profile(self.p,bad)

    def test_graph_projection_never_ignores_unknown_events(self):
        before={'event_trigger/'+e['name']:{'enabled':'O'} for e in self.m.provider.expected()}
        with patch.object(self.batch,'admit_graph') as check:
            self.m.graph(self.p,self.batch,before)
            check.assert_called_once_with({})
        with self.assertRaises(self.p.PrefixError):self.m.graph(self.p,self.batch,{**before,'event_trigger/unknown':{}})

    def test_full_whole_source_envelope_preserves_boundaries(self):
        before={'relation/'+self.batch.DIAGNOSTIC:{'definition':'SELECT 1'},'relation/public.fixture':{'kind':'r'}}
        final=copy.deepcopy(before)
        with patch.object(self.batch,'new_index_keys',return_value=()),patch.object(self.batch,'expected_rows',return_value=[]):
            prepared=self.m.prepare(self.p,self.batch,self.sources,before,[],final,(),(),token='a'*32)
        for s in self.sources:self.assertEqual(prepared.sql.count(s.data),1)
        self.assertEqual(len(self.p.identity(prepared.sql.decode())),3)
        self.assertIn(b"current_database() NOT IN ('postgres')",prepared.sql)
        # CTAS accepts column names only; the SELECT determines JSONB type.
        self.assertIn(b'CREATE TEMP TABLE alignment_identity_reference(value) ON COMMIT DROP AS SELECT coalesce(jsonb_object_agg',prepared.sql)
        self.assertNotIn(b'alignment_identity_reference(value jsonb) ON COMMIT DROP AS',prepared.sql)
        self.assertIn(b"SET LOCAL lock_timeout='3s'",prepared.sql)
        self.assertIn(b'IN SHARE ROW EXCLUSIVE MODE',prepared.sql)
        self.assertNotIn(b'INSERT INTO supabase_migrations',prepared.sql)
        self.assertEqual([p.state for p in prepared.probes],['P6864','57014','P6868','P6869'])
        self.assertTrue(prepared.probes[-1].guard)

    def test_metadata_transfer_keeps_domain_exclusive_and_source_bytes(self):
        domain=tuple(sorted(self.m.repair.PROVIDER_METADATA))
        before={'relation/'+self.batch.DIAGNOSTIC:{'definition':'SELECT 1'},
                **{'relation/'+name:{'kind':'r','owner':owner} for name,owner in self.m.repair.PROVIDER_METADATA.items()}}
        with patch.object(self.batch,'new_index_keys',return_value=()),patch.object(self.batch,'expected_rows',return_value=[]):
            program=self.m.prepare(self.p,self.batch,self.sources,before,[],before,domain,tuple(self.m.SYSTEM_TABLES),token='a'*32)
        for s in self.sources:self.assertEqual(program.sql.count(s.data),1)
        self.assertEqual([p.state for p in program.probes],['42501','42501','P6864','57014','P6868','P6869'])
        self.assertEqual([p.denied for p in program.probes[:2]],['auth.schema_migrations','pg_catalog.pg_proc'])
        self.assertIn(b'ACCESS EXCLUSIVE MODE',program.sql)
        self.assertIn(b'LOCK TABLE pg_catalog.pg_proc IN ACCESS SHARE MODE;',program.sql)

    def test_safe_denial_requires_exact_error_and_identity(self):
        raw=b'ERROR: permission denied for table pg_proc (SQLSTATE 42501)'
        self.assertTrue(self.m.denial(raw,'pg_catalog.pg_proc'))
        self.assertFalse(self.m.denial(raw,'auth.schema_migrations'))
        self.assertFalse(self.m.denial(b'private text pg_proc','pg_catalog.pg_proc'))

    def test_expected_rows_do_not_allow_arbitrary_timestamp_or_value_drift(self):
        lower=datetime(2026,9,14,20,tzinfo=timezone.utc);upper=datetime(2026,9,14,21,tzinfo=timezone.utc)
        expected=[['public.metering_points',{'id':'x','updated_at':self.batch.CLOCK,'value':3}]]
        actual=[['public.metering_points',{'id':'x','updated_at':'2026-09-14T20:30:00+00:00','value':3}]]
        self.assertTrue(self.m.rows_equal(self.batch,expected,actual,(lower,upper)))
        for bad in ([[actual[0][0],{**actual[0][1],'value':4}]],actual*2,
                    [[actual[0][0],{**actual[0][1],'updated_at':'2026-09-14T19:30:00+00:00'}]]):
            self.assertFalse(self.m.rows_equal(self.batch,expected,bad,(lower,upper)))

    def test_marker_and_guard_hold_context_locks_and_deadline(self):
        guard=self.m.ledger_guard('gridex_native_f0064_0068_'+'a'*12)
        for text in ('SECURITY INVOKER','pg_locks','3 seconds','60 seconds','alignment_native_locks',"stage='W'"):
            self.assertIn(text,guard)
        self.assertNotIn('SECURITY DEFINER',guard)
        with self.assertRaises(ValueError):self.m.ledger_guard('unowned')

    def test_unverified_prefix_rejected_without_database(self):
        def fail(*a,**k):self.fail('DB access before verified prefix')
        with self.assertRaises(self.p.PrefixError):self.m.prerequisite(self.p,fail,Path('/tmp'),{}, {}, {}, {}, {})

class ProbeTests(unittest.TestCase):
    def exercise(self,fault=None):
        from types import SimpleNamespace
        import tempfile
        m=importlib.import_module('canonical_native_alignment68');p=importlib.import_module('canonical_native_historical_prefix')
        program=m.Program(b'SELECT 9;',tuple(m.Probe(b'SELECT '+str(i).encode()+b';',code,guard=i==4)
                for i,code in enumerate(('P6864','57014','P6868','P6869'),1)))
        entries=[{'version':'20260914000000','name':'earlier','statements':['SELECT 1']}]
        state={'runs':0,'guard':False,'snapshot':{'rows':[]},'entries':copy.deepcopy(entries)};report={}
        with tempfile.TemporaryDirectory() as d:
            directory=Path(d);directory.chmod(0o700)
            old=directory/'20260914000000_earlier.sql';old.write_bytes(b'SELECT 1;');old.chmod(0o600)
            meta=old.stat();retained=[(old,b'SELECT 1;',(meta.st_dev,meta.st_ino))]
            def sql(query):
                if query==p.LEDGER_SQL:return copy.deepcopy(state['entries'])
                if query==m.DROP_GUARD:state['guard']=False;return fault!='cleanup'
                self.assertIn('CREATE TRIGGER gridex_native_alignment68_guard',query)
                state['guard']=True;return True
            def native(*args,**kw):
                if args[:2]==('migration','new'):
                    (directory/('2026091422000'+str(state['runs'])+'_'+args[2]+'.sql')).write_text('')
                    return SimpleNamespace(returncode=0,stderr=b'')
                state['runs']+=1
                if state['runs']==4:self.assertTrue(state['guard'])
                if fault=='ledger':state['entries'].append({'fake':True})
                if fault=='rows':state['snapshot']={'rows':[{'drift':True}]}
                if fault=='private':old.write_bytes(b'SELECT 2;')
                code='P6800' if fault=='state' else program.probes[state['runs']-1].state
                return SimpleNamespace(returncode=0 if fault=='success' else 1,stderr=('SQLSTATE '+code).encode())
            with patch.object(m.time,'sleep'):
                def run():m.qualify(p,native,sql,directory,program,entries,retained,lambda:copy.deepcopy(state['snapshot']),report)
                if fault:
                    with self.assertRaises(p.PrefixError):run()
                    self.assertFalse(report['verified'])
                else:
                    run();self.assertTrue(report['verified']);self.assertEqual(len(report['cases']),4)
                    self.assertEqual({f.name for f in directory.iterdir()},{old.name})
                    self.assertFalse(state['guard'])
    def test_all_negative_controls_and_cleanup(self):self.exercise()
    def test_wrong_error_rejected(self):self.exercise('state')
    def test_unexpected_success_rejected(self):self.exercise('success')
    def test_ledger_mutation_rejected(self):self.exercise('ledger')
    def test_rows_mutation_rejected(self):self.exercise('rows')
    def test_private_file_mutation_rejected(self):self.exercise('private')
    def test_cleanup_failure_rejected(self):self.exercise('cleanup')


class ExecutionTests(unittest.TestCase):
    def exercise(self,fault=None):
        from types import SimpleNamespace
        import tempfile
        m=importlib.import_module('canonical_native_alignment68');p=importlib.import_module('canonical_native_historical_prefix')
        batch,sources=m.load_sources(p)
        before={'relation/'+batch.DIAGNOSTIC:{'definition':'SELECT 1'}}
        final={**before,'new':{'expected':True}}
        entries=[{'version':'202609140000'+str(i).zfill(2),'name':'old'+str(i),'statements':['SELECT 1']} for i in range(54)]
        state={'applied':False,'oracle':False,'repeat':False,'entries':copy.deepcopy(entries)};report={}
        with tempfile.TemporaryDirectory() as d:
            directory=Path(d);directory.chmod(0o700)
            old=directory/'old.sql';old.write_bytes(b'SELECT 1;');old.chmod(0o600)
            meta=old.stat();retained=[(old,b'SELECT 1;',(meta.st_dev,meta.st_ino))]
            def sql(query):
                if query==p.LEDGER_SQL:return copy.deepcopy(state['entries'])
                if query==m.SYSTEM_PROFILE:return [{'relation':n,'owner':'supabase_admin','canSelect':True,'canWrite':False,'canStrongLock':False} for n in m.SYSTEM_TABLES]
                if query==m.provider.QUERY:return m.provider.expected()
                if query==m.provider.SEQUENCE_SHAPE:return {}
                if query==m.provider.static_catalog_sql(batch.repair):return {'drift':True} if fault=='provider' and state['applied'] else {}
                if query==batch.identities_sql():return {}
                if query.startswith('BEGIN READ ONLY; SET LOCAL search_path=public,extensions,pg_temp;'):
                    return final if state['applied'] or (fault=='oracle' and state['oracle']) else before
                if query.startswith('BEGIN; SET LOCAL search_path=public,extensions,pg_temp;') and 'FROM alignment_rows;' in query:
                    return [['public.fixture',{'drift':True}]] if (fault=='rows' and state['applied']) or (fault=='repeat' and state['repeat']) else []
                if query.endswith('ROLLBACK;'):
                    state['oracle']=True;return final
                if "jsonb_build_object('role',current_user" in query:
                    return {'role':'postgres','database':'postgres','settings':p.SETTINGS}
                self.fail('Unexpected SQL callback')
            def native(*args,**kw):
                if args[:2]==('migration','new'):
                    (directory/('20260914220000_'+args[2]+'.sql')).write_text('')
                else:
                    if state['applied']:state['repeat']=True;return SimpleNamespace(returncode=0,stderr=b'')
                    if fault=='apply':return SimpleNamespace(returncode=1,stderr=b'SQLSTATE 42501')
                    path=next(f for f in directory.glob('*.sql') if f!=old);text=path.read_text()
                    stmts=[text[t[0][1]:t[-1][2]] for t in p.statements(text)]
                    state['entries'].append({'version':path.name[:14],'name':path.name[15:-4],
                        'statements':['SELECT 4'] if fault=='ledger' else stmts});state['applied']=True
                return SimpleNamespace(returncode=0,stderr=b'')
            def qualify(*args):args[-1].update(verified=True)
            with patch.object(m,'prerequisite',return_value=(directory,entries,retained)),patch.object(m,'graph'), \
                 patch.object(m.repair,'provider_profile',return_value=()),patch.object(m.time,'sleep'), \
                 patch.object(batch,'expected_ddl',return_value='SELECT 2;'), \
                 patch.object(m,'load_sources',return_value=(batch,sources)),patch.object(batch,'new_index_keys',return_value=()), \
                 patch.object(m,'qualify',side_effect=qualify):
                if fault:
                    with self.assertRaises(p.PrefixError):m.execute(p,native,sql,Path(d),{}, {}, {}, {}, {},report,provider_bootstrap=m.provider.receipt())
                    self.assertFalse(report['verified'])
                    self.assertEqual(report['cumulativeFoundationInputsExecuted'],63)
                else:
                    m.execute(p,native,sql,Path(d),{}, {}, {}, {}, {},report,provider_bootstrap=m.provider.receipt())
                    self.assertTrue(report['verified']);self.assertEqual(report['cumulativeFoundationInputsExecuted'],68)
                    self.assertEqual(state['entries'][:-1],entries)
                    self.assertFalse(report['completeReplayVerified']);self.assertFalse(report['generatedTypesVerified'])
    def test_complete_source_oracle_ledger_and_repeat_required(self):self.exercise()
    def test_oracle_rollback_failure_rejected(self):self.exercise('oracle')
    def test_failed_cli_rejected(self):self.exercise('apply')
    def test_wrong_ledger_rejected(self):self.exercise('ledger')
    def test_domain_rows_drift_rejected(self):self.exercise('rows')
    def test_provider_drift_rejected(self):self.exercise('provider')
    def test_repeat_drift_rejected(self):self.exercise('repeat')

if __name__=='__main__':unittest.main(verbosity=2)
