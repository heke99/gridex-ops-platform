#!/usr/bin/env python3
"""Local source/transport controls, not a substitute for native SQL execution."""
import importlib
import copy
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]

class SourceTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue((ROOT/'scripts/canonical_native_dedupe57.py').is_file(),
                        'Native H2 continuation is not implemented')
        self.m=importlib.import_module('canonical_native_dedupe57')
        self.p=importlib.import_module('canonical_native_historical_prefix')
        self.batch,self.source=self.m.load_source(self.p)

    def test_whole_source_and_trailing_verification_are_retained(self):
        program=self.m.program(self.p,self.source)
        self.assertEqual(program.sql,self.source.data)
        self.assertEqual(self.p.sha(program.sql),self.batch.SHA256)
        ids=self.p.identity(program.sql.decode())
        self.assertEqual([s[0].upper() for s in ids],['BEGIN','WITH','WITH','CREATE','CREATE','COMMIT','SELECT'])
        self.assertEqual(program.name,'gridex_native_f0057_'+self.batch.SHA256[:12])
        with self.assertRaises(self.p.PrefixError):self.p.cli_program(self.source.data)

    def test_support_change_is_rejected(self):
        with patch.object(self.m,'BATCH_SHA','0'*64),self.assertRaises(self.p.PrefixError):
            self.m.load_source(self.p)

    def test_changed_source_cannot_be_a_program(self):
        for data in (self.source.data+b'\n',self.source.data.replace(b'commit;',b'rollback;')):
            with self.assertRaises(self.p.PrefixError):
                self.m.program(self.p,SimpleNamespace(data=data,sha256=self.source.sha256))

    def test_probes_distinguish_precommit_rollback_from_postcommit_persistence(self):
        probes=self.m.probes(self.p,self.source)
        self.assertEqual([(p.state,p.committed,p.guard) for p in probes],
                         [('P5750',False,False),('P5752',True,False),('P5751',True,True)])
        self.assertIn(b"ERRCODE='P5750'",probes[0].sql)
        self.assertLess(probes[0].sql.index(b"ERRCODE='P5750'"),probes[0].sql.index(b'commit;'))
        self.assertEqual(probes[1].sql.count(self.source.data),1)
        self.assertEqual(probes[2].sql.count(self.source.data),1)
        self.assertIn(b'ON COMMIT PRESERVE ROWS',probes[2].sql)
        self.assertIn('txid_current()',self.m.ledger_guard('gridex_native_f0057_'+'a'*12))

    def test_exact_ledger_preserves_begin_commit_and_final_select(self):
        program=self.m.program(self.p,self.source);text=program.sql.decode()
        statements=[text[s[0][1]:s[-1][2]] for s in self.p.statements(text)]
        filename='20260914210000_'+program.name+'.sql'
        entry={'version':filename[:14],'name':program.name,'statements':statements}
        self.p.verify_entry(entry,filename,program)
        for invalid in (statements[:-1],statements[1:],statements[:5]+statements[6:]):
            with self.assertRaises(self.p.PrefixError):
                self.p.verify_entry({**entry,'statements':invalid},filename,program)

    def test_transport_only_admits_exact57_not_later_boundaries(self):
        t=importlib.import_module('canonical_native_cli_transport')
        project='gridex-sb-45c3b5c5b510-0123456789abcdef';original=Path.stat
        def inspect(path,**kw):
            if str(path)=='/var/run/docker.sock':return SimpleNamespace(st_mode=stat.S_IFSOCK|0o660,st_gid=123)
            return original(path,**kw)
        with tempfile.TemporaryDirectory() as d,patch.object(Path,'stat',inspect):
            base=Path(d);work=base/(project+'-private');work.mkdir(mode=0o700)
            cli=base/'supabase';cli.write_text('fixture');(base/'supabase-go').write_text('fixture')
            name=self.m.program(self.p,self.source).name
            self.assertEqual(t.cli_command(cli,work,project,('migration','new',name))[-1],name)
            for bad in ('gridex_native_f0064_'+'a'*12,'gridex_native_f0057_0063_'+'a'*12,name+'x'):
                with self.assertRaises(ValueError):t.cli_command(cli,work,project,('migration','new',bad))

    def test_index_cleanup_is_not_domain_data_rollback(self):
        sql=self.m.CLEAN_INDEXES
        self.assertEqual(sql.count('DROP INDEX '),2)
        for forbidden in ('CASCADE','DELETE FROM','TRUNCATE','setval','ALTER ROLE','DISABLE TRIGGER'):
            self.assertNotIn(forbidden,sql)
        with self.assertRaises(ValueError):self.m.ledger_guard("bad'; DROP TABLE public.roles;")

    def test_unverified_prefix_rejected_before_sql(self):
        def fail(*args,**kwargs):self.fail('Unverified prefix reached the database')
        with tempfile.TemporaryDirectory() as d,self.assertRaises(self.p.PrefixError):
            self.m.prerequisite(self.p,fail,Path(d),{}, {}, {})

    def test_full_release_barrier_remains(self):
        self.assertIn('NATIVE_LATER_ENVELOPES_AND_FULL_ACCEPTANCE_REQUIRED',
                      (ROOT/'scripts/canonical-auth-provisioning-replay.py').read_text())
        self.assertEqual(self.p.LIMIT,43)


class ProbeTests(unittest.TestCase):
    def exercise(self,fault=None):
        m=importlib.import_module('canonical_native_dedupe57')
        p=importlib.import_module('canonical_native_historical_prefix')
        _,source=m.load_source(p)
        before={'catalog':{'old':{}},'rows':[], 'sequences':{}}
        final={**before['catalog'],'index1':{},'index2':{}}
        entries=[{'version':'20260914000000','name':'earlier','statements':['SELECT 1']}]
        state={'run':0,'guard':False,'snapshot':copy.deepcopy(before),'ledger':copy.deepcopy(entries)}
        report={}
        with tempfile.TemporaryDirectory() as d:
            directory=Path(d);directory.chmod(0o700)
            old=directory/'20260914000000_earlier.sql';old.write_bytes(b'SELECT 1;');old.chmod(0o600)
            info=old.stat();retained=[(old,b'SELECT 1;',(info.st_dev,info.st_ino))]
            def native(*args,**kw):
                if args[:2]==('migration','new'):
                    (directory/('2026091420000'+str(state['run']+1)+'_'+args[2]+'.sql')).write_text('')
                    return SimpleNamespace(returncode=0,stderr=b'')
                self.assertEqual(args,('migration','up','--local'));self.assertTrue(kw['allow_failure'])
                state['run']+=1;number=state['run']
                state['snapshot']={**before,'catalog':final} if number>1 else copy.deepcopy(before)
                if fault=='rolled-back-after-commit' and number>1:state['snapshot']=copy.deepcopy(before)
                if fault=='committed-before-fault':state['snapshot']={**before,'catalog':final}
                if fault=='rows':state['snapshot']['rows']=[{'unwanted':True}]
                if fault=='ledger':state['ledger'].append({'unwanted':True})
                if fault=='file':old.write_bytes(b'SELECT 2;')
                if number==3:self.assertTrue(state['guard'])
                code='P5700' if fault=='state' else ['P5750','P5752','P5751'][number-1]
                return SimpleNamespace(returncode=0 if fault=='success' else 1,stderr=('SQLSTATE '+code).encode())
            def sql(query):
                if query==p.LEDGER_SQL:return copy.deepcopy(state['ledger'])
                if query==m.DROP_GUARD:
                    state['guard']=False;return fault!='guard-cleanup'
                if query==m.CLEAN_INDEXES:
                    self.assertEqual(state['snapshot'],{**before,'catalog':final})
                    if fault=='index-cleanup':return False
                    state['snapshot']=copy.deepcopy(before);return True
                self.assertIn('CREATE TRIGGER gridex_native_dedupe57_guard',query)
                state['guard']=True;return True
            with patch.object(m.time,'sleep'):
                if fault:
                    with self.assertRaises(p.PrefixError):
                        m.qualify(p,native,sql,directory,source,entries,retained,
                                  lambda:copy.deepcopy(state['snapshot']),before,final,report)
                    self.assertFalse(report['verified'])
                else:
                    m.qualify(p,native,sql,directory,source,entries,retained,
                              lambda:copy.deepcopy(state['snapshot']),before,final,report)
                    self.assertTrue(report['verified']);self.assertEqual(len(report['cases']),3)
                    self.assertEqual([c['transactionRolledBack'] for c in report['cases']],[True,False,False])
                    self.assertEqual([c['committedIndexesObserved'] for c in report['cases']],[False,True,True])
                    self.assertFalse(report['rollbackAcrossSourceCommitClaimed'])
                    self.assertEqual({f.name for f in directory.iterdir()},{old.name})
                    self.assertFalse(state['guard'])

    def test_actual_fault_shapes_and_explicit_cleanup(self):self.exercise()
    def test_postcommit_rollback_claim_rejected(self):self.exercise('rolled-back-after-commit')
    def test_precommit_persistence_rejected(self):self.exercise('committed-before-fault')
    def test_unexpected_success_rejected(self):self.exercise('success')
    def test_wrong_error_rejected(self):self.exercise('state')
    def test_ledger_mutation_rejected(self):self.exercise('ledger')
    def test_row_mutation_rejected(self):self.exercise('rows')
    def test_previous_source_mutation_rejected(self):self.exercise('file')
    def test_index_disposal_failure_rejected(self):self.exercise('index-cleanup')
    def test_ledger_guard_disposal_failure_rejected(self):self.exercise('guard-cleanup')


class ExecutionTests(unittest.TestCase):
    def exercise(self,fault=None):
        m=importlib.import_module('canonical_native_dedupe57')
        p=importlib.import_module('canonical_native_historical_prefix')
        authority,_=m.repair.load_sources(p)
        before={'relation/public.user_roles':{'kind':'r'}}
        final={**before,**{'index/public.'+name:{'unique':True,'valid':True,'ready':True} for name in m.INDEXES}}
        entries=[{'version':'202609140000'+str(i).zfill(2),'name':'earlier'+str(i),'statements':['SELECT 1']} for i in range(46)]
        state={'applied':False,'oracle':False,'repeat':False,'runs':0,'ledger':copy.deepcopy(entries)};report={}
        with tempfile.TemporaryDirectory() as d:
            directory=Path(d);directory.chmod(0o700)
            old=directory/'old.sql';old.write_bytes(b'SELECT 1;');old.chmod(0o600)
            meta=old.stat();retained=[(old,b'SELECT 1;',(meta.st_dev,meta.st_ino))]
            def sql(query):
                if query==p.LEDGER_SQL:return copy.deepcopy(state['ledger'])
                if query==m.ROLE_COUNT:return 1 if fault=='nonempty' else 0
                if query==m.repair.catalog_sql(authority):
                    return final if state['applied'] or (state['oracle'] and fault=='oracle-rollback') else before
                if query==m.repair.previous.ROWS_SQL:
                    return [{'unwanted':True}] if (state['applied'] and fault=='rows') or (state['repeat'] and fault=='repeat') else []
                if query==m.repair.SEQUENCES_SQL:return {}
                if query==m.provider.QUERY:return m.provider.expected()
                if query==m.provider.SEQUENCE_SHAPE:return {'pinned':'sequence shape'}
                if query==m.provider.static_catalog_sql(authority):return {'pinned':'provider catalog'}
                if "jsonb_build_object('role',current_user" in query:
                    return {'role':'postgres','database':'postgres','settings':p.SETTINGS}
                if query.startswith('BEGIN;') and query.endswith('ROLLBACK;'):
                    state['oracle']=True;return final
                self.fail('Unexpected SQL callback')
            def native(*args,**kw):
                if args[:2]==('migration','new'):
                    (directory/('20260914210000_'+args[2]+'.sql')).write_text('')
                else:
                    self.assertEqual(args,('migration','up','--local'));state['runs']+=1
                    if state['runs']==1:
                        if fault=='apply':return SimpleNamespace(returncode=1,stderr=b'SQLSTATE 42501')
                        path=next(f for f in directory.glob('*.sql') if f!=old);text=path.read_text()
                        stmts=[text[s[0][1]:s[-1][2]] for s in p.statements(text)]
                        if fault=='statements':stmts=stmts[:-1]
                        state['ledger'].append({'version':path.name[:14],'name':path.name[15:-4],'statements':stmts})
                        state['applied']=True
                    else:state['repeat']=True
                return SimpleNamespace(returncode=0,stderr=b'')
            def qualify(*args):
                self.assertFalse(state['applied']);self.assertTrue(state['oracle'])
                args[-1].update(verified=True)
            with patch.object(m,'prerequisite',return_value=(directory,entries,retained)), \
                 patch.object(m,'qualify',side_effect=qualify),patch.object(m.time,'sleep'):
                if fault:
                    with self.assertRaises(p.PrefixError):
                        m.execute(p,native,sql,Path(d),{}, {}, {}, report,provider_bootstrap=m.provider.receipt())
                    self.assertFalse(report['verified'])
                    if fault=='apply':self.assertTrue(report['terminalOwnedDatabaseDisposalRequired'])
                else:
                    m.execute(p,native,sql,Path(d),{}, {}, {}, report,provider_bootstrap=m.provider.receipt())
                    self.assertTrue(report['verified']);self.assertEqual(report['cumulativeFoundationInputsExecuted'],57)
                    self.assertEqual(state['ledger'][:-1],entries)
                    self.assertFalse(report['sourceAndLedgerAtomic'])
                    self.assertFalse(report['rollbackAcrossSourceCommitClaimed'])
                    self.assertFalse(report['completeReplayVerified']);self.assertFalse(report['generatedTypesVerified'])

    def test_main_requires_source_oracle_actual_ledger_and_repeat(self):self.exercise()
    def test_nonempty_roles_not_admitted(self):self.exercise('nonempty')
    def test_oracle_side_effect_not_admitted(self):self.exercise('oracle-rollback')
    def test_actual_failure_is_terminal(self):self.exercise('apply')
    def test_final_select_missing_from_ledger_rejected(self):self.exercise('statements')
    def test_rows_changed_rejected(self):self.exercise('rows')
    def test_repeat_changed_rejected(self):self.exercise('repeat')

if __name__=='__main__':unittest.main(verbosity=2)
