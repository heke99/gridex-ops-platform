#!/usr/bin/env python3
"""Source/transport control tests; fake callbacks are NOT native SQL evidence."""
import copy
import importlib
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]

class RepairEnvelopeTests(unittest.TestCase):
    def module(self):
        self.assertTrue((ROOT/'scripts/canonical_native_repair_envelope.py').is_file(),
                        'The native 53-56 atomic CLI envelope has not been implemented')
        return importlib.import_module('canonical_native_repair_envelope')

    def setUp(self):
        self.m = self.module()
        self.p = importlib.import_module('canonical_native_historical_prefix')
        self.batch, self.sources = self.m.load_sources(self.p)
        self.before = {'relation/public.roles': {'kind':'r', 'owner':'postgres'}}
        self.final = {**self.before, 'relation/public.gridex_debug_batch2_rbac_v': {'kind':'v'}}
        self.program = self.m.prepare(self.p,self.batch,self.sources,self.before,self.final,())

    def test_exact_four_whole_sources_are_one_unit(self):
        self.assertEqual([s.alias for s in self.sources], ['R2','E2','S2','W'])
        self.assertEqual([s['ordinal'] for s in self.program.sources], [53,54,55,56])
        for s in self.sources:
            self.assertEqual(self.program.sql.count(s.data),1)
        ids = self.p.identity(self.program.sql.decode())
        self.assertEqual(len(ids),3)
        self.assertEqual(ids[-1][0], 'DO')
        self.assertNotIn('SET TRANSACTION', self.program.sql.decode())
        self.assertNotIn('INSERT INTO supabase_migrations', self.program.sql.decode())
        self.assertIn('repair_expected_roles',self.program.sql.decode())
        self.assertIn("stage='W'",self.program.sql.decode())
        self.assertIn("SET stage='completed'",self.program.sql.decode())

    def test_reordered_missing_altered_sources_and_support_fail(self):
        for sources in (self.sources[:-1],self.sources[::-1], self.sources[-1:]):
            with self.assertRaises(self.p.PrefixError):
                self.m.prepare(self.p,self.batch,sources,self.before,self.final,())
        with patch.dict(self.m.PINS, {'canonical-user-rbac-repair-batch.py':'0'*64}):
            with self.assertRaises(self.p.PrefixError): self.m.load_sources(self.p)

    def test_provider_projection_is_finite_and_keeps_domain_exclusive_locks(self):
        before = {**self.before, **{'relation/'+n:{'kind':'r','owner':v}
                  for n,v in self.m.PROVIDER_METADATA.items()}}
        providers = tuple(sorted(self.m.PROVIDER_METADATA))
        program = self.m.prepare(self.p,self.batch,self.sources,before,self.final,providers)
        self.assertIn(b'ACCESS SHARE MODE',program.sql)
        self.assertIn(b'ACCESS EXCLUSIVE MODE',program.sql)
        for s in self.sources: self.assertEqual(program.sql.count(s.data),1)
        for bad in (('public.roles',),('auth.users',),('auth.unknown',),providers[::-1]):
            with self.assertRaises(self.p.PrefixError):
                self.m.prepare(self.p,self.batch,self.sources,before,self.final,bad)
        before['relation/auth.schema_migrations']['owner']='postgres'
        with self.assertRaises(self.p.PrefixError):
            self.m.prepare(self.p,self.batch,self.sources,before,self.final,providers)

    def test_real_provider_reference_is_never_ignored(self):
        before={**self.before,'relation/auth.schema_migrations': {'kind':'r','owner':'supabase_auth_admin'}}
        with patch.object(self.m.previous,'source_mentions_identifier',return_value=True):
            with self.assertRaises(self.p.PrefixError):
                self.m.prepare(self.p,self.batch,self.sources,before,self.final,('auth.schema_migrations',))

    def test_oracle_only_executes_source_ddl_and_rolls_back(self):
        query=self.m.oracle_sql(self.p,self.batch,self.sources)
        self.assertTrue(query.startswith('BEGIN;'))
        self.assertTrue(query.rstrip().endswith('ROLLBACK;'))
        self.assertNotIn('COMMIT;',query)
        self.assertNotIn(self.sources[3].data.decode(),query)
        self.assertNotIn('INSERT INTO public.roles',query)
        self.assertIn('security_invoker=true',query)
        self.assertIn('FROM pg_roles WHERE rolname<>current_user',query)
        self.assertIn('REVOKE ALL ON FUNCTION',query)
        self.assertIn('repair_reference',self.program.sql.decode())

    def test_baseline_source_authority_is_not_a_copied_final_snapshot(self):
        for before in ({}, self.before):
            with self.assertRaises(self.p.PrefixError):
                self.m.validate_preimage(self.p,self.batch,self.sources,before)

    def test_private_delimiter_cannot_escape_envelope(self):
        for text in ('$gridex_native_repair56$', '$repair56_part_0$'):
            with self.assertRaises(self.p.PrefixError):
                self.m.prepare(self.p,self.batch,self.sources,{'x':text},self.final,())

    def test_ledger_requires_exact_derived_program(self):
        tokens=self.p.statements(self.program.sql.decode())
        text=self.program.sql.decode()
        statements=[text[t[0][1]:t[-1][2]] for t in tokens]
        filename='20260914195000_'+self.program.name+'.sql'
        entry={'version':filename[:14],'name':self.program.name,'statements':statements}
        self.p.verify_entry(entry,filename,self.program)
        for bad in (['SELECT 1'],statements[:-1],statements*2,
                    [*statements[:-1],statements[-1].replace('ACCESS EXCLUSIVE','ACCESS SHARE')]):
            with self.assertRaises(self.p.PrefixError):
                self.p.verify_entry({**entry,'statements':bad},filename,self.program)

    def test_probes_include_mid_timeout_body_and_ledger_failures(self):
        probes=self.m.probes(self.p,self.program)
        self.assertEqual([s for _,s,_ in probes], ['P5653','57014','P5656','P5657'])
        self.assertIn(self.sources[0].data,probes[0][0])
        self.assertNotIn(self.sources[3].data,probes[0][0])
        self.assertIn(b'pg_sleep(61)',probes[1][0])
        for raw,_,_ in probes[2:]:
            for source in self.sources:self.assertIn(source.data,raw)
        self.assertEqual(probes[-1][2],True)
        guard=self.m.ledger_guard(self.program.name)
        for term in ('AccessExclusiveLock','AccessShareLock','pg_locks','repair_context',
                     'txid_current','10 seconds','60 seconds','SECURITY INVOKER'):
            self.assertIn(term,guard)
        self.assertNotIn('SECURITY DEFINER',guard)
        with self.assertRaises(ValueError):self.m.ledger_guard("bad'; DROP TABLE public.roles;")

    def test_prerequisite_never_admits_unverified52(self):
        def fail(*a,**k): self.fail('SQL/CLI before prefix admission')
        for receipt in ({},{'verified':True},{'verified':True,'cumulativeFoundationInputsExecuted':51}):
            with tempfile.TemporaryDirectory() as d,self.assertRaises(self.p.PrefixError):
                self.m.execute(self.p,fail,fail,Path(d),{},receipt,{})

    def test_transport_only_extends_to_exact53_56_shape(self):
        transport=importlib.import_module('canonical_native_cli_transport')
        project='gridex-sb-45c3b5c5b510-0123456789abcdef'; original=Path.stat
        def inspect(path,**kw):
            if str(path)=='/var/run/docker.sock':return SimpleNamespace(st_mode=stat.S_IFSOCK|0o660,st_gid=123)
            return original(path,**kw)
        with tempfile.TemporaryDirectory() as d,patch.object(Path,'stat',inspect):
            base=Path(d); work=base/(project+'-private'); work.mkdir(mode=0o700)
            cli=base/'supabase';cli.write_text('fixture');(base/'supabase-go').write_text('fixture')
            args=transport.cli_command(cli,work,project,('migration','new',self.program.name))
            self.assertEqual(args[-1],self.program.name)
            for bad in ('gridex_native_f0053_'+ 'a'*12,'gridex_native_f0053_0057_'+ 'a'*12,
                        'gridex_native_f0058_'+ 'a'*12,self.program.name+'x'):
                with self.assertRaises(ValueError):transport.cli_command(cli,work,project,('migration','new',bad))

    def test_full_release_guards_are_not_advanced(self):
        self.assertEqual(self.p.LIMIT,43)
        self.assertIn('NATIVE_LATER_ENVELOPES_AND_FULL_ACCEPTANCE_REQUIRED',
                      (ROOT/'scripts/canonical-auth-provisioning-replay.py').read_text())

class ProbeControlTests(unittest.TestCase):
    def exercise(self,fault=None):
        m=importlib.import_module('canonical_native_repair_envelope')
        p=importlib.import_module('canonical_native_historical_prefix')
        batch,sources=m.load_sources(p)
        program=m.prepare(p,batch,sources,{'relation/public.fixture':{'kind':'r'}},{'new':{}},())
        expected=[{'version':'20260914190000','name':'earlier','statements':['SELECT 1']}]
        state={'runs':0,'guard':False,'created':0};report={}
        with tempfile.TemporaryDirectory() as d:
            directory=Path(d);directory.chmod(0o700)
            old=directory/'20260914190000_earlier.sql';old.write_bytes(b'SELECT 1;');old.chmod(0o600)
            metadata=old.stat();retained=[(old,b'SELECT 1;',(metadata.st_dev,metadata.st_ino))]
            def native(*args,**kw):
                if args[:2]==('migration','new'):
                    state['created']+=1
                    name='2026091419000'+str(state['created'])+'_'+args[2]+'.sql'
                    (directory/name).write_text('')
                    return SimpleNamespace(returncode=0,stdout=b'',stderr=b'')
                self.assertEqual(args,('migration','up','--local'));self.assertTrue(kw['allow_failure'])
                state['runs']+=1
                if state['runs']==4:self.assertTrue(state['guard'])
                wanted=['P5653','57014','P5656','P5657'][state['runs']-1]
                if fault=='file':old.write_bytes(b'SELECT 2;')
                return SimpleNamespace(returncode=0 if fault=='success' else 1,stdout=b'',
                    stderr=('SQLSTATE '+('P5600' if fault=='state' else wanted)).encode())
            def sql(query):
                if query==p.LEDGER_SQL:return expected+[{'fabricated':True}] if fault=='ledger' else copy.deepcopy(expected)
                if query==m.DROP_GUARD:
                    state['guard']=False;return fault!='cleanup'
                self.assertIn('CREATE TRIGGER gridex_native_repair56_guard',query)
                state['guard']=True;return True
            def snapshot():
                return {'catalog':{},'rows':2 if state['runs'] and fault=='rows' else 1,
                        'sequences':2 if state['runs'] and fault=='sequence' else 1}
            with patch.object(m.time,'sleep'):
                if fault:
                    with self.assertRaises(p.PrefixError):
                        m.qualify(p,native,sql,directory,program,expected,retained,snapshot,report)
                    self.assertFalse(report['verified'])
                else:
                    m.qualify(p,native,sql,directory,program,expected,retained,snapshot,report)
                    self.assertTrue(report['verified']);self.assertEqual(len(report['cases']),4)
                    self.assertEqual({f.name for f in directory.iterdir()},{old.name})
                    self.assertFalse(state['guard'])

    def test_four_probes_run_without_applying_any_unit(self):self.exercise()
    def test_unexpected_success_is_rejected(self):self.exercise('success')
    def test_wrong_error_is_rejected(self):self.exercise('state')
    def test_ledger_mutation_is_rejected(self):self.exercise('ledger')
    def test_row_rollback_failure_is_rejected(self):self.exercise('rows')
    def test_sequence_mutation_is_rejected(self):self.exercise('sequence')
    def test_guard_cleanup_failure_is_rejected(self):self.exercise('cleanup')
    def test_previous_file_tampering_is_rejected(self):self.exercise('file')


class ProviderProfileTests(unittest.TestCase):
    def setUp(self):
        self.m=importlib.import_module('canonical_native_repair_envelope')
        self.p=importlib.import_module('canonical_native_historical_prefix')
        self.before={'relation/'+n:{'kind':'r','owner':o} for n,o in self.m.PROVIDER_METADATA.items()}
        self.before['relation/public.roles']={'kind':'r','owner':'postgres'}
        self.permissions=[{'relation':k[9:],'owner':v['owner'],'canSelect':True,
                           'canShareLock':v['owner']=='postgres','canWrite':v['owner']=='postgres'}
                          for k,v in self.before.items()]
    def test_exact_complete_profile_accepted(self):
        self.assertEqual(self.m.provider_profile(self.p,lambda q:self.permissions,self.before),
                         tuple(sorted(self.m.PROVIDER_METADATA)))
    def test_missing_duplicate_unknown_and_wrong_privilege_profiles_rejected(self):
        for values in (self.permissions[:-1],self.permissions+self.permissions[:1],
                       [{**p,'canSelect':1} for p in self.permissions],
                       [{**p,'canWrite':True} for p in self.permissions],
                       [{**p,'canShareLock':False} for p in self.permissions],
                       [{**p,'owner':'wrong'} for p in self.permissions]):
            with self.subTest(profile=values),self.assertRaises(self.p.PrefixError):
                self.m.provider_profile(self.p,lambda q:values,self.before)


class ExecutionControlTests(unittest.TestCase):
    def exercise(self,fault=None):
        m=importlib.import_module('canonical_native_repair_envelope')
        p=importlib.import_module('canonical_native_historical_prefix')
        batch,sources=m.load_sources(p)
        before={'relation/public.roles':{'kind':'r','owner':'postgres'}}
        final={**before,'function/public.diagnostic()':{'definition':'source oracle'}}
        expected=[{'version':'20260914190000','name':'earlier','statements':['SELECT 1']}]
        state={'applied':False,'repeat':False,'oracle':False,'ledger':copy.deepcopy(expected),'runs':0}
        report={}
        with tempfile.TemporaryDirectory() as d:
            directory=Path(d);directory.chmod(0o700)
            old=directory/'20260914190000_earlier.sql';old.write_bytes(b'SELECT 1;');old.chmod(0o600)
            meta=old.stat();retained=[(old,b'SELECT 1;',(meta.st_dev,meta.st_ino))]
            def sql(query):
                if query==p.LEDGER_SQL:return copy.deepcopy(state['ledger'])
                if query==m.catalog_sql(batch):
                    return final if state['applied'] or (state['oracle'] and fault=='oracle-rollback') else before
                if query==m.previous.ROWS_SQL:return [{'changed':True}] if state['repeat'] and fault=='repeat' else []
                if query==m.SEQUENCES_SQL:return {}
                if query==m.provider_events.static_catalog_sql(batch):return {'drift':True} if state['applied'] and fault=='provider-catalog' else {}
                if query==m.provider_events.SEQUENCE_SHAPE:return {'drift':True} if state['applied'] and fault=='provider-sequence' else {'type':'integer'}
                if query==m.provider_events.QUERY:return [] if state['applied'] and fault=='provider-events' else m.provider_events.expected()
                if query==m.trigger_diagnostics.QUERY:return {'roleTriggerCount':0,'events':[]}
                if "jsonb_build_object('role',current_user" in query:
                    return {'role':'postgres','database':'postgres','settings':p.SETTINGS}
                if query.startswith('BEGIN;') and 'ROLLBACK;' in query:
                    state['oracle']=True;return final
                if 'to_regnamespace' in query:return True
                self.fail('Unexpected SQL callback')
            def qualify(*args):
                self.assertFalse(state['applied']);self.assertTrue(state['oracle'])
                args[-1].update(verified=True)
            def native(*args,**kw):
                if args[:2]==('migration','new'):
                    (directory/('20260914190100_'+args[2]+'.sql')).write_text('')
                else:
                    self.assertEqual(args,('migration','up','--local'));state['runs']+=1
                    if state['runs']==1:
                        if fault in ('apply-failure','failed-ledger'):
                            if fault=='failed-ledger':state['ledger'].append({'fabricated':True})
                            return SimpleNamespace(returncode=1,stderr=b'SQLSTATE P5601')
                        state['applied']=True
                        path=next(f for f in directory.glob('*.sql') if f!=old);raw=path.read_text()
                        statements=[raw[t[0][1]:t[-1][2]] for t in p.statements(raw)]
                        state['ledger'].append({'version':path.name[:14],'name':path.name[15:-4],
                                               'statements':['SELECT 1'] if fault=='statements' else statements})
                    else:state['repeat']=True
                return SimpleNamespace(returncode=0,stderr=b'')
            with patch.object(m,'prerequisite',return_value=(directory,expected,retained)), \
                 patch.object(m,'validate_preimage'),patch.object(m,'provider_profile',return_value=()), \
                 patch.object(m,'qualify',side_effect=qualify),patch.object(m.time,'sleep'):
                if fault:
                    with self.assertRaises(p.PrefixError):m.execute(p,native,sql,Path(d),{}, {}, report,provider_bootstrap=m.provider_events.receipt())
                    self.assertFalse(report['verified'])
                else:
                    m.execute(p,native,sql,Path(d),{}, {}, report,provider_bootstrap=m.provider_events.receipt())
                    self.assertTrue(report['verified']);self.assertEqual(report['cumulativeFoundationInputsExecuted'],56)
                    self.assertTrue(report['independentOracleRollbackVerified'])
                    self.assertEqual(state['ledger'][:-1],expected)
                    self.assertFalse(report['completeReplayVerified']);self.assertFalse(report['generatedTypesVerified'])
                    self.assertEqual(report['timestampInputsExecuted'],0)

    def test_execute_requires_oracle_probes_real_ledger_and_repeat(self):self.exercise()
    def test_oracle_not_rolled_back_is_rejected(self):self.exercise('oracle-rollback')
    def test_actual_cli_failure_is_not_marked_applied(self):self.exercise('apply-failure')
    def test_failed_cli_with_ledger_write_is_rejected(self):self.exercise('failed-ledger')
    def test_wrong_actual_ledger_program_is_rejected(self):self.exercise('statements')
    def test_repeat_data_mutation_is_rejected(self):self.exercise('repeat')
    def test_provider_catalog_mutation_is_rejected(self):self.exercise('provider-catalog')
    def test_provider_sequence_definition_mutation_is_rejected(self):self.exercise('provider-sequence')
    def test_provider_routine_contract_mutation_is_rejected(self):self.exercise('provider-events')


def load_tests(loader, tests, pattern):
    spec=importlib.util.spec_from_file_location('native_trigger_diagnostic_tests',ROOT/'scripts/test-canonical-native-trigger-diagnostics.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    tests.addTests(loader.loadTestsFromModule(module))
    spec=importlib.util.spec_from_file_location('native_provider_event_tests',ROOT/'scripts/test-canonical-native-provider-events.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    tests.addTests(loader.loadTestsFromModule(module))
    return tests


if __name__=='__main__': unittest.main(verbosity=2)
