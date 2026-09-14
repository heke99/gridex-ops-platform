#!/usr/bin/env python3
"""Source and transport controls; these do not execute a database."""
import importlib
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]

class SourceTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue((ROOT/'scripts/canonical_native_fixed63.py').is_file(),
                        'Native fixed-target continuation is not implemented')
        self.m=importlib.import_module('canonical_native_fixed63')
        self.p=importlib.import_module('canonical_native_historical_prefix')
        self.core,self.sources=self.m.load_sources(self.p)

    def test_exact_six_sources_and_order(self):
        self.assertEqual([s.key for s in self.sources],['P','B0','C2','D2','F2','X'])
        self.assertEqual(len(self.sources),6)
        self.assertEqual(len(self.p.identity(self.sources[0].data.decode())),3)
        for s in self.sources:
            self.assertEqual(s.data,(ROOT/'supabase/migrations'/s.path.name).read_bytes())

    def test_native_cleanup_changes_only_reviewed_admission(self):
        project='gridex-sb-45c3b5c5b510-0123456789abcdef'
        raw=self.m.cleanup_source(self.p,self.sources[-1],project)
        self.assertNotEqual(raw,self.sources[-1].data)
        self.assertIn(b'FIXED_DESCENDANT_REMAINS',raw)
        self.assertIn(b'FIXED_CAPTURED_ROW_MISMATCH',raw)
        self.assertIn(b'FIXED_SEED_PREIMAGE_MISMATCH',raw)
        self.assertNotIn(b'gridex_auth_legacy_replay',raw)
        self.assertIn(b"current_database()<>'postgres'",raw)
        self.assertIn(b'inet_server_port() IS DISTINCT FROM 5432',raw)
        self.assertIn(project.encode(),raw)
        start=self.sources[-1].data.index(b'  IF envelope->\'company\'')
        self.assertEqual(raw[raw.index(b'  IF envelope->\'company\''):],self.sources[-1].data[start:])
        with self.assertRaises(self.p.PrefixError):
            self.m.cleanup_source(self.p,self.sources[-1],'unowned-production')

    def test_native_auth_defaults_remain_non_privileged(self):
        for name,value,kind in [('is_anonymous','false','boolean'),('is_sso_user','false','boolean'),
                ('confirmation_token',"''::character varying",'character varying(255)'),
                ('email_change_confirm_status','0','smallint')]:
            self.m.auth_default(self.p,name,{'default':value,'type':kind,'generated':''})
        for name,value,kind in [('is_super_admin','true','boolean'),('is_sso_user','true','boolean'),
                ('encrypted_password',"'hash'::text",'text'),('raw_app_meta_data',"'{\"role\":\"admin\"}'::jsonb",'jsonb'),
                ('other',"nextval('x')",'integer')]:
            with self.assertRaises(self.p.PrefixError):
                self.m.auth_default(self.p,name,{'default':value,'type':kind,'generated':''})


class LaneTests(unittest.TestCase):
    def exercise(self,fault=None,probe=False):
        import copy
        import tempfile
        from types import SimpleNamespace
        from unittest.mock import patch
        m=importlib.import_module('canonical_native_fixed63')
        p=importlib.import_module('canonical_native_historical_prefix')
        report={};state={'guard':False,'calls':0,'shape':{'rows':[]},'entries':[
            {'version':'20260914000000','name':'earlier','statements':['SELECT 1']} ]}
        with tempfile.TemporaryDirectory() as d:
            directory=Path(d);directory.chmod(0o700)
            old=directory/'20260914000000_earlier.sql';old.write_bytes(b'SELECT 1;');old.chmod(0o600)
            meta=old.stat();retained=[(old,b'SELECT 1;',(meta.st_dev,meta.st_ino))]
            original=copy.deepcopy(state['entries']);raw=b'SELECT 2;'
            def sql(query):
                if query==p.LEDGER_SQL:return copy.deepcopy(state['entries'])
                if query==m.DROP_GUARD:
                    state['guard']=False;return fault!='cleanup'
                self.assertIn('CREATE TRIGGER gridex_native_fixed63_guard',query)
                state['guard']=True;return True
            def native(*args,**kwargs):
                if args[:2]==('migration','new'):
                    (directory/('20260914220000_'+args[2]+'.sql')).write_text('')
                    return SimpleNamespace(returncode=0,stderr=b'')
                self.assertEqual(args,('migration','up','--local'));state['calls']+=1
                path=next(f for f in directory.glob('*.sql') if f!=old)
                if fault=='private':old.write_bytes(b'SELECT 3;')
                if fault=='rows':state['shape']={'rows':[{'changed':True}]}
                if probe or fault=='apply':
                    if fault=='ledger':state['entries'].append({'fake':True})
                    return SimpleNamespace(returncode=0 if fault=='success' else 1,
                        stderr=b'SQLSTATE P6300' if fault=='state' else b'SQLSTATE P6363')
                entry={'version':path.name[:14],'name':path.name[15:-4],
                       'statements':['SELECT 9'] if fault=='statements' else ['SELECT 2']}
                state['entries'].append(entry)
                return SimpleNamespace(returncode=0,stderr=b'')
            lane=m.Lane(p,native,sql,directory,original,retained)
            with patch.object(m.time,'sleep'):
                def call():
                    if probe:
                        lane.fault('f0063',raw,'P6363',lambda:copy.deepcopy(state['shape']),{'rows':[]},report,m.ledger_guard)
                    else:lane.run('f0058',raw,report)
                if fault:
                    with self.assertRaises(p.PrefixError):call()
                    self.assertNotIn('verified',report)
                else:
                    call()
                    if probe:
                        self.assertTrue(report['negativeControls'][0]['scopedRollbackVerified'])
                        self.assertEqual(state['entries'],original);self.assertFalse(state['guard'])
                        self.assertEqual({f.name for f in directory.iterdir()},{old.name})
                    else:
                        self.assertEqual(lane.entries[:-1],original)
                        self.assertEqual(report['canonicalExecutionUnits'][0]['programSha256'],p.sha(raw))
                        self.assertEqual(len(lane.retained),2)

    def test_positive_real_ledger_contract(self):self.exercise()
    def test_wrong_statements_fail(self):self.exercise('statements')
    def test_failed_execution_is_terminal(self):self.exercise('apply')
    def test_old_private_file_change_fails(self):self.exercise('private')
    def test_cleanup_guard_rolls_back_without_applied_row(self):self.exercise(probe=True)
    def test_probe_unexpected_success_fails(self):self.exercise('success',probe=True)
    def test_probe_wrong_sqlstate_fails(self):self.exercise('state',probe=True)
    def test_probe_ledger_mutation_fails(self):self.exercise('ledger',probe=True)
    def test_probe_row_mutation_fails(self):self.exercise('rows',probe=True)
    def test_probe_guard_cleanup_failure_fails(self):self.exercise('cleanup',probe=True)

class AdmissionTests(unittest.TestCase):
    def test_unverified_prefix_never_touches_database(self):
        import tempfile
        m=importlib.import_module('canonical_native_fixed63');p=importlib.import_module('canonical_native_historical_prefix')
        def fail(*a,**k):self.fail('DB was accessed before prefix admission')
        with tempfile.TemporaryDirectory() as d,self.assertRaises(p.PrefixError):
            m.require_prefix(p,fail,Path(d),{}, {}, {}, {})

    def test_exact_names_cannot_select_later_steps_or_arbitrary_target(self):
        import re
        m=importlib.import_module('canonical_native_fixed63')
        for name in ('f0058','f0059','f0060','f0061','f0062','f0063','fixed_constructor'):
            self.assertIsNotNone(re.fullmatch(m.NAME,'gridex_native_'+name+'_'+'a'*12))
        for name in ('f0064','f0144','hosted','f0058_0063'):
            self.assertIsNone(re.fullmatch(m.NAME,'gridex_native_'+name+'_'+'a'*12))
        with self.assertRaises(ValueError):m.ledger_guard("bad'; DROP SCHEMA public;")

    def test_original_source_integrity_is_a_prerequisite(self):
        from unittest.mock import patch
        m=importlib.import_module('canonical_native_fixed63');p=importlib.import_module('canonical_native_historical_prefix')
        with patch.object(m,'CORE_SHA','0'*64),self.assertRaises(p.PrefixError):m.load_sources(p)

    def test_restoration_is_not_a_production_or_whole_group_atomic_claim(self):
        text=(ROOT/'scripts/canonical_native_fixed63.py').read_text()
        self.assertIn('groupAtomic=False',text)
        self.assertIn('completeReplayVerified=False',text)
        self.assertIn('generatedTypesVerified=False',text)
        self.assertIn('originalHistoricalVersionsMarkedApplied=False',text)
        self.assertNotIn('DISABLE TRIGGER',text)
        self.assertNotIn('ALTER ROLE',text)


class ExecutionTests(unittest.TestCase):
    def exercise(self,fault=None):
        import copy
        import tempfile
        from types import SimpleNamespace
        from unittest.mock import patch
        m=importlib.import_module('canonical_native_fixed63');p=importlib.import_module('canonical_native_historical_prefix')
        core,sources=m.load_sources(p)
        provider_state={'providerCatalog':{},'providerSequenceShape':{},'providerEvents':m.provider.expected()}
        before={'catalog':{'base':{}},'rows':[]};expected={'catalog':{'base':{},'added':{}},'rows':[]}
        state={'snapshot':copy.deepcopy(before),'ledger':[{'version':'20260914000000','name':'earlier','statements':['SELECT 1']}],
               'stage':0,'last_tag':None,'oracle_key':None,'repeat':False}
        report={};owner='gridex-sb-45c3b5c5b510-0123456789abcdef'
        class Oracle:
            def __init__(self,*args):self.key='constructor'
            def assert_snapshot(self,actual):
                wanted={'catalog':expected['catalog'],'rows':[['fixture',{'key':self.key}]]}
                if self.key in ('D2','F2'):
                    wanted['rows'].append(['public.company_memberships',{'user_id':sources[2].slots['U_target']}])
                if actual!=(wanted['catalog'],wanted['rows']) or fault=='oracle':
                    raise core.BoundaryError('FULL_CATALOG_ORACLE_MISMATCH')
        with tempfile.TemporaryDirectory() as d:
            directory=Path(d);directory.chmod(0o700)
            old=directory/'20260914000000_earlier.sql';old.write_bytes(b'SELECT 1;');old.chmod(0o600)
            meta=old.stat();retained=[(old,b'SELECT 1;',(meta.st_dev,meta.st_ino))]
            def sql(query):
                if query==p.LEDGER_SQL:return copy.deepcopy(state['ledger'])
                if query==m.EXTERNAL_FKS:return 1 if fault=='incoming' else 0
                if query==m.provider.QUERY:return copy.deepcopy(m.provider.expected())
                if query==m.provider.SEQUENCE_SHAPE:return {}
                if query==m.provider.static_catalog_sql(core.repair):
                    return {'changed':True} if fault=='provider' and state['stage']>1 else {}
                if query==m.repair.catalog_sql(core.repair):return copy.deepcopy(state['snapshot']['catalog'])
                if query=='BEGIN; SET LOCAL search_path=public,extensions,pg_temp;\n'+core.ROWS_SQL+'\nCOMMIT;':
                    return [['drift',{}]] if fault=='repeat' and state['repeat'] else copy.deepcopy(state['snapshot']['rows'])
                if "jsonb_build_object('role',current_user" in query:
                    return {'role':'postgres','database':'postgres','settings':p.SETTINGS}
                self.fail('Unexpected query in driver')
            def native(*args,**kw):
                if args[:2]==('migration','new'):
                    tag=args[2][len('gridex_native_'):].rsplit('_',1)[0];state['last_tag']=tag
                    (directory/('20260914230'+str(state['stage'])+'00_'+args[2]+'.sql')).write_text('')
                    return SimpleNamespace(returncode=0,stderr=b'')
                self.assertEqual(args,('migration','up','--local'))
                files=[f for f in directory.glob('*.sql') if f.name not in {e['version']+'_'+e['name']+'.sql' for e in state['ledger']}]
                if not files:
                    state['repeat']=True;return SimpleNamespace(returncode=0,stderr=b'')
                self.assertEqual(len(files),1);path=files[0];tag=state['last_tag'];state['stage']+=1
                if fault=='apply' and tag=='f0061':return SimpleNamespace(returncode=1,stderr=b'SQLSTATE 42501')
                text=path.read_text();stmts=[text[t[0][1]:t[-1][2]] for t in p.statements(text)]
                state['ledger'].append({'version':path.name[:14],'name':path.name[15:-4],
                                       'statements':['SELECT 999'] if fault=='ledger' else stmts})
                if tag in ('f0058','f0063'):state['snapshot']=copy.deepcopy(expected)
                else:
                    key={'fixed_constructor':'constructor','f0059':'B0','f0060':'C2','f0061':'D2','f0062':'F2'}[tag]
                    state['snapshot']={'catalog':expected['catalog'],'rows':[['fixture',{'key':key}]]}
                    if key in ('D2','F2'):state['snapshot']['rows'].append(['public.company_memberships',{'user_id':sources[2].slots['U_target']}])
                if fault=='restoration' and tag=='f0063':state['snapshot']['rows']=[['leftover',{}]]
                return SimpleNamespace(returncode=0,stderr=b'')
            def probe(lane,tag,raw,code,snapshot,wanted,report,guard=None):
                self.assertEqual(snapshot(),wanted)
                if fault=='probe':raise p.PrefixError('NATIVE_FIXED63_PROOF_REQUIRED')
                report.setdefault('negativeControls',[]).append({'stage':tag,'expectedSqlstate':code,'scopedRollbackVerified':True})
            def set_oracle(o,s):o.key=s.key
            with patch.object(m,'load_sources',return_value=(core,sources)), \
                 patch.object(m,'require_prefix',return_value=(directory,copy.deepcopy(state['ledger']),retained,owner)), \
                 patch.object(m,'native_graph'),patch.object(core,'seed_expectation'), \
                 patch.object(core,'prerequisite_state',return_value=(expected['catalog'],expected['rows'])), \
                 patch.object(core,'prerequisite_catalog',return_value=expected['catalog']), \
                 patch.object(m,'constructor',return_value=(b'SELECT 11;',Oracle())), \
                 patch.object(core,'Oracle',Oracle),patch.object(core,'bootstrap',side_effect=set_oracle), \
                 patch.object(core,'activate',side_effect=set_oracle),patch.object(core,'normalize',side_effect=set_oracle), \
                 patch.object(m.Lane,'fault',probe),patch.object(m.time,'sleep'), \
                 patch.object(m,'cleanup_program',return_value=b'SELECT 63;'):
                if fault:
                    with self.assertRaises(p.PrefixError):m.execute(p,native,sql,Path(d),{}, {}, {}, {},report,provider_bootstrap=m.provider.receipt())
                    self.assertFalse(report['verified'])
                    self.assertEqual(report['cumulativeFoundationInputsExecuted'],57)
                else:
                    m.execute(p,native,sql,Path(d),{}, {}, {}, {},report,provider_bootstrap=m.provider.receipt())
                    self.assertTrue(report['verified']);self.assertEqual(report['cumulativeFoundationInputsExecuted'],63)
                    self.assertEqual(len(report['canonicalExecutionUnits']),7)
                    self.assertEqual(len(report['negativeControls']),5)
                    self.assertEqual([s['ordinal'] for s in report['sources']],list(range(58,64)))
                    self.assertFalse(report['groupAtomic']);self.assertFalse(report['completeReplayVerified'])
                    self.assertFalse(report['generatedTypesVerified'])

    def test_all_sources_ledgers_oracles_and_cleanup_are_required(self):self.exercise()
    def test_external_incoming_fk_rejected(self):self.exercise('incoming')
    def test_source_oracle_mismatch_rejected(self):self.exercise('oracle')
    def test_provider_drift_rejected(self):self.exercise('provider')
    def test_failed_source_never_advances_accepted_boundary(self):self.exercise('apply')
    def test_wrong_ledger_rejected(self):self.exercise('ledger')
    def test_probe_failure_rejected(self):self.exercise('probe')
    def test_restoration_failure_rejected(self):self.exercise('restoration')
    def test_repeat_mutation_rejected(self):self.exercise('repeat')

if __name__=='__main__':unittest.main(verbosity=2)
