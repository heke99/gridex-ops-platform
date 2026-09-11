#!/usr/bin/env python3
"""Private standalone characterization on accepted actual68; no source selection."""
import argparse
import copy
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock
from types import SimpleNamespace

sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]

def load(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file)
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)
    return module

batch=load('customer_operations_sources','canonical-customer-operations-batch.py')
r=batch.replay.load_alignment_runtime()
support=load('customer_operations_test_support','canonical-user-rbac-fixed-target-continuation-selftest.py')
NATIVE='gridex_auth_legacy_native';ORACLE='gridex_auth_legacy_atomic'

class Constructors(unittest.TestCase):
    def test_complete_sources_order_and_staged_bytes(self):
        sources=batch.validate_sources(batch.reviewed_paths())
        self.assertEqual(tuple(s.key for s in sources),('L','E','U'))
        for invalid in (tuple(reversed(batch.reviewed_paths())),batch.reviewed_paths()[:-1],list(batch.reviewed_paths())):
            with self.assertRaises(batch.BoundaryError):batch.validate_sources(invalid)
        with tempfile.TemporaryDirectory(prefix='operations-stage-') as directory:
            hold=Path(directory)
            for source in sources:(hold/source.path.name).write_bytes(source.data)
            stage=r.legacy.StagedSources(hold)
            self.assertEqual(batch.validate_sources(batch.reviewed_paths(),stage),sources)
            path=hold/sources[1].path.name;path.write_bytes(sources[1].data+b'\n')
            with self.assertRaises(batch.BoundaryError):batch.validate_sources(batch.reviewed_paths(),stage)
            path.unlink();path.symlink_to(sources[1].path)
            with self.assertRaises(batch.BoundaryError):batch.validate_sources(batch.reviewed_paths(),stage)

    def test_physical_owner_is_required(self):
        original=Path.stat;foreign=batch.reviewed_paths()[0]
        def stat(path,*args,**kwargs):
            value=original(path,*args,**kwargs)
            if path==foreign:
                values=list(value);values[4]=os.getuid()+1;return os.stat_result(values)
            return value
        with patch.object(Path,'stat',stat):
            with self.assertRaises(batch.BoundaryError):batch.validate_sources(batch.reviewed_paths())

    def test_staged_file_owner_is_required(self):
        sources=batch.validate_sources(batch.reviewed_paths())
        with tempfile.TemporaryDirectory(prefix='operations-owner-') as directory:
            hold=Path(directory)
            for source in sources:(hold/source.path.name).write_bytes(source.data)
            stage=r.legacy.StagedSources(hold);foreign=hold/sources[0].path.name;original=Path.stat
            def stat(path,*args,**kwargs):
                value=original(path,*args,**kwargs)
                if path==foreign:
                    values=list(value);values[4]=os.getuid()+1;return os.stat_result(values)
                return value
            with patch.object(Path,'stat',stat):
                with self.assertRaises(batch.BoundaryError):batch.validate_sources(batch.reviewed_paths(),stage)

    def test_one_zero_multiple_and_blocked_company_models(self):
        before=[['public.companies',{'id':'one','status':'active'}],
                ['public.ediel_actor_settings',{'id':'a','company_id':None,'updated_at':'retained'}],
                ['public.communication_routes',{'id':'b','company_id':'already'}],
                ['public.ediel_route_profiles',{'id':'c','company_id':None}],
                ['public.ediel_test_run_messages',{'id':'d','message':'retained'}],
                ['auth.users',{'id':'user','email':'synthetic'}]]
        saved=copy.deepcopy(before);after=batch.expected_rows(before)
        self.assertEqual(before,saved)
        self.assertEqual(after[1][1],{'id':'a','company_id':'one','updated_at':'retained'})
        self.assertEqual(after[2][1]['company_id'],'already')
        self.assertEqual(after[3][1]['company_id'],'one')
        self.assertIsNone(after[4][1]['company_id']);self.assertEqual(after[5],before[5])
        for companies in ([],[['public.companies',{'id':'two','status':'active'}],before[0]]):
            input_rows=companies+before[1:]
            self.assertIsNone(batch.expected_rows(input_rows)[len(companies)][1]['company_id'])
        for status in ('paused','unknown','','pending_deletion'):
            blocked=copy.deepcopy(before);blocked[0][1]['status']=status
            with self.assertRaises(batch.BoundaryError):batch.expected_rows(blocked)
            self.assertEqual(batch.expected_rows(blocked[:1]),blocked[:1])
        for status in ('onboarding',None):
            allowed=copy.deepcopy(before);allowed[0][1]['status']=status
            self.assertEqual(batch.expected_rows(allowed)[1][1]['company_id'],'one')

    def test_oracle_handles_global_fk_guard_and_optional_tables(self):
        sources=batch.validate_sources(batch.reviewed_paths())
        shape={'relation/public.customers':{},'relation/public.companies':{},'relation/auth.users':{},
               'relation/public.supplier_switch_events':{},'operations_constraint_names':[]}
        sql=batch.ddl(sources,shape)
        self.assertIn('add constraint supplier_switch_events_archived_by_fkey',sql)
        self.assertNotIn('ediel_actor_settings_company_env_active_idx',sql)
        self.assertNotRegex(sql,r'(?i)UPDATE public\.')
        shape['operations_constraint_names']=['supplier_switch_events_archived_by_fkey','supplier_switch_events_company_id_fkey']
        sql=batch.ddl(sources,shape)
        self.assertNotIn('add constraint supplier_switch_events_',sql)
        shape['relation/public.ediel_actor_settings']={}
        self.assertIn('ediel_actor_settings_company_env_active_idx',batch.ddl(sources,shape))
        self.assertIn('on delete cascade',sql) # Original journal contract, not a retention claim.

    def test_all_added_nullable_fields_preserve_existing_values(self):
        before=[['public.customers',{'id':'customer','moved_out_at':'2020-01-01'}],
                ['public.customer_sites',{'id':'site','closed_reason':'original'}],
                ['public.supplier_switch_events',{'id':'event','archived_by':'original'}]]
        rows=batch.expected_rows(before)
        self.assertEqual(rows[0][1]['moved_out_at'],'2020-01-01')
        self.assertEqual(rows[1][1]['closed_reason'],'original')
        self.assertEqual(rows[2][1]['archived_by'],'original')
        self.assertIsNone(rows[0][1]['lifecycle_closed_at'])
        self.assertIsNone(rows[2][1]['company_id'])

    def test_foreign_handle_rejects_before_reader(self):
        with patch.object(support,'private_reader') as reader:
            for handle in (object(),None,SimpleNamespace(active=True)):
                with self.assertRaises(batch.BoundaryError):Proof(handle)
            reader.assert_not_called()

    def test_stale_completion_links_and_reserved_database_reject_before_sql(self):
        class Handle:pass
        h=Handle();h.name='fixture';h.directory=SimpleNamespace(name='/fixture');h.reference=object()
        ref=object();prior=object();stage=object()
        run=r.Release(ref,prior,stage,b'before',b'','token')
        release=r.replace(run,after=r.encoded(({},[])))
        registries=(r._RUNS,r._RELEASES,r._REFERENCES,r.fixed._RELEASES,r.repair.REFERENCES,r.dedupe._REFERENCES,r.dedupe._STATES)
        originals=(run,release,ref,prior,object(),SimpleNamespace(scope='alignment68'),'SUCCEEDED')
        try:
            for registry,value in zip(registries,originals):registry[h]=value
            with patch.object(r.repair,'require_owned'),patch.object(Proof,'snapshot',return_value=({},[])),patch.object(support,'private_reader',return_value=SimpleNamespace()):
                proof=Proof(h)
                proof.owned(r.DATABASE)
                with self.assertRaises(batch.BoundaryError):proof.owned(NATIVE)
                for registry in (r._RUNS,r._REFERENCES,r.fixed._RELEASES,r._RELEASES):
                    value=registry[h];registry[h]=object()
                    try:
                        with self.assertRaises(batch.BoundaryError):proof.owned(r.DATABASE)
                    finally:registry[h]=value
                for state,scope in (('FIXED_COMPLETE','alignment68'),('SUCCEEDED','fixed-target')):
                    r.dedupe._STATES[h]=state;r.dedupe._REFERENCES[h]=SimpleNamespace(scope=scope)
                    with self.assertRaises(batch.BoundaryError):Proof(h)
                    r.dedupe._STATES[h]='SUCCEEDED';r.dedupe._REFERENCES[h]=originals[-2]
        finally:
            for registry in registries:registry.pop(h,None)

    def test_clone_origin_mismatch_removes_only_new_owned_clone(self):
        proof=Proof.__new__(Proof);proof.name='fixture';proof.h=SimpleNamespace(docker=Mock())
        proof.created=set();proof.owned=Mock();proof.query=Mock(return_value='f')
        proof.reader=SimpleNamespace(identity=Mock());proof.origin=({},[])
        proof.snapshot=Mock(return_value=({'unexpected':True},[]))
        with self.assertRaises(batch.BoundaryError):proof.clone(NATIVE)
        self.assertEqual(proof.created,set())
        self.assertEqual(proof.h.docker.call_args.args[0],['exec','fixture','dropdb','-U','postgres','--force',NATIVE])



class Proof:
    def __init__(self,h):
        r.repair.require_owned(h)
        batch.check(r.dedupe._STATES.get(h)=='SUCCEEDED','OPERATIONS_ACTUAL68_REQUIRED')
        batch.check(r.dedupe._REFERENCES[h].scope=='alignment68','OPERATIONS_EXACT_PREFIX_REQUIRED')
        self.h=h;self.name=h.name;self.directory=h.directory.name
        self.release=r._RELEASES.get(h);self.run_receipt=r._RUNS.get(h);self.references=(h.reference,r.repair.REFERENCES[h],r.dedupe._REFERENCES[h])
        batch.check(type(self.release) is r.Release and type(self.run_receipt) is r.Release
                    and self.release.reference is r._REFERENCES.get(h)
                    and self.release.fixed_completion is r.fixed._RELEASES.get(h)
                    and self.release.token==self.run_receipt.token and bool(self.release.after),
                    'OPERATIONS_LINKED_COMPLETION_REQUIRED')
        self.created=set();self.sources=batch.validate_sources(batch.reviewed_paths())
        self.core=support.characterization();self.reader=support.private_reader(self.core,h)
        self.reader.name=self.name;self.reader.directory=self.directory
        self.reader.owned=self.owned
        self.origin=self.snapshot(r.DATABASE)
        accepted=json.loads(self.release.after)
        batch.check({k:v for k,v in self.origin[0].items() if not k.startswith('operations_')}==accepted[0]
                    and r.rows_equal(self.origin[1],accepted[1]),'OPERATIONS_FROZEN_ACTUAL68_REQUIRED')
        self.canary=self.snapshot(r.fixed.CANARY)

    def owned(self,database):
        r.repair.require_owned(self.h)
        batch.check(self.h.name==self.name and self.h.directory.name==self.directory
                    and self.h.reference is self.references[0]
                    and r.repair.REFERENCES[self.h] is self.references[1]
                    and r.dedupe._REFERENCES[self.h] is self.references[2]
                    and r._RELEASES.get(self.h) is self.release
                    and r._RUNS.get(self.h) is self.run_receipt
                    and r._REFERENCES.get(self.h) is self.release.reference
                    and r.fixed._RELEASES.get(self.h) is self.release.fixed_completion
                    and self.references[2].scope=='alignment68'
                    and r.dedupe._STATES.get(self.h)=='SUCCEEDED','OPERATIONS_OWNER_REQUIRED')
        batch.check(database in (r.DATABASE,r.fixed.CANARY) or database in self.created,
                    'OPERATIONS_RESERVED_DATABASE_REQUIRED')

    def run(self,database,sql):
        return self.reader.run(database,"SET client_min_messages=error;\n"+sql)

    def query(self,database,sql):
        result=self.run(database,sql)
        if result.code or result.state!='00000':
            allowed=('42P01','42703','23503','42501','P0001','P0004','22012')
            raise batch.BoundaryError('OPERATIONS_QUERY_'+(result.state if result.state in allowed else 'OTHER'))
        return result.stdout

    def snapshot(self,database):
        sql="SELECT 'OPERATIONS_CATALOG';\n"+batch.catalog_sql()+"\nSELECT 'OPERATIONS_ROWS';\n"+r.batch.rows_sql()
        sql+="SELECT coalesce(jsonb_agg(jsonb_build_array(name,value) ORDER BY name,value),'[]') FROM alignment_rows; DROP TABLE alignment_rows;"
        lines=self.query(database,sql).splitlines()
        batch.check(lines.count('OPERATIONS_CATALOG')==lines.count('OPERATIONS_ROWS')==1)
        return (json.loads(lines[lines.index('OPERATIONS_CATALOG')+1]),json.loads(lines[lines.index('OPERATIONS_ROWS')+1]))

    def clone(self,database):
        self.owned(r.DATABASE)
        batch.check(database in (NATIVE,ORACLE) and database not in self.created,'OPERATIONS_FRESH_DATABASE_REQUIRED')
        batch.check(self.query(r.DATABASE,"SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname="+r.batch.literal(database)+");").strip()=='f')
        self.h.docker(['exec',self.name,'createdb','-U','postgres','-T',r.DATABASE,database])
        self.created.add(database)
        try:
            self.reader.identity(database)
            batch.check(r.encoded(self.snapshot(database))==r.encoded(self.origin),'OPERATIONS_CLONE_REQUIRED')
        except BaseException:
            self.drop(database)
            raise

    def drop(self,database):
        self.owned(database);batch.check(database in self.created)
        self.h.docker(['exec',self.name,'dropdb','-U','postgres','--force',database]);self.created.remove(database)

    def case(self,name,setup='',error=None,fault=None,repeat=False):
        self.clone(NATIVE)
        try:
            if setup:self.query(NATIVE,setup)
            before=self.snapshot(NATIVE)
            if error is None:
                self.clone(ORACLE)
                try:
                    if setup:self.query(ORACLE,setup)
                    # Fixtures are literal and deterministic; clocks stay explicit.
                    oracle_before=self.snapshot(ORACLE)
                    batch.check(r.encoded(oracle_before)==r.encoded(before),'OPERATIONS_FIXTURE_EQUALITY_REQUIRED')
                    self.query(ORACLE,batch.ddl(self.sources,before[0]))
                    expected=self.snapshot(ORACLE)[0]
                finally:self.drop(ORACLE)
                rows=batch.expected_rows(before[1])
                suffix=batch.assertions(before,expected,rows,self.sources)
            else:suffix=''
            sql=''
            for source in self.sources:
                sql+=source.data.decode()+"\nSELECT 'OPERATIONS_SOURCE_"+source.key+"';\n"
                if fault==source.key:sql+='SELECT 1/0;\n'
            result=self.run(NATIVE,sql+suffix)
            expected_error='22012' if fault else error
            if expected_error:
                batch.check(result.code!=0 and result.state==expected_error,'OPERATIONS_EXACT_NATIVE_REJECTION_REQUIRED')
                if fault:
                    reached=[key for key in ('L','E','U') if 'OPERATIONS_SOURCE_'+key in result.stdout.splitlines()]
                    batch.check(reached==list(('L','E','U')[:('L','E','U').index(fault)+1]))
                batch.check(r.encoded(self.snapshot(NATIVE))==r.encoded(before),'OPERATIONS_ROLLBACK_REQUIRED')
            else:
                batch.check(result.code==0 and result.state=='00000' and result.stdout.splitlines().count('OPERATIONS_COMPLETE')==1,'OPERATIONS_NATIVE_COMPLETION_REQUIRED')
                after=self.snapshot(NATIVE)
                batch.check(r.batch.catalog.final_equal(before[0],after[0],expected,batch.new_index_keys(self.sources,before[0]))
                            and r.rows_equal(after[1],rows),'OPERATIONS_POST_COMMIT_REQUIRED')
                if repeat:
                    again=self.run(NATIVE,sql+batch.assertions(after,after[0],after[1],self.sources))
                    batch.check(again.code==0 and again.state=='00000' and r.encoded(self.snapshot(NATIVE))==r.encoded(after),'OPERATIONS_REPEAT_REQUIRED')
                if name=='baseline':self.privileges()
            batch.check(batch.validate_sources(batch.reviewed_paths())==self.sources)
        finally:
            for database in (ORACLE,NATIVE):
                if database in self.created:self.drop(database)
        batch.check(r.encoded(self.snapshot(r.DATABASE))==r.encoded(self.origin),'OPERATIONS_ORIGIN_PRESERVATION_REQUIRED')
        batch.check(r.encoded(self.snapshot(r.fixed.CANARY))==r.encoded(self.canary),'OPERATIONS_CANARY_REQUIRED')
        print('PASS operations case='+name+'; complete source/catalog/comments/rows/rollback/preservation',flush=True)

    def privileges(self):
        before=self.snapshot(NATIVE)
        for role in ('anon','authenticated','service_role'):
            result=self.run(NATIVE,'SET LOCAL ROLE '+role+'; SELECT * FROM public.customer_lifecycle_events;')
            batch.check(result.code!=0 and result.state=='42501','OPERATIONS_ACL_DENIAL_REQUIRED')
        gap=self.query(NATIVE,"SELECT missing_select_policy,missing_insert_policy,missing_update_policy FROM public.gridex_debug_batch2_tenant_policy_gaps_v WHERE table_name='customer_lifecycle_events';")
        batch.check(gap.strip()=='t|t|t','OPERATIONS_HISTORICAL_POLICY_GAP_REQUIRED')
        customer="INSERT INTO public.customers(id,company_id,full_name,created_at,updated_at) SELECT '76000000-0000-4000-8000-000000000001',id,'Operations journal fixture','2020-01-01','2020-01-02' FROM public.companies LIMIT 1;"
        event="INSERT INTO public.customer_lifecycle_events(id,company_id,customer_id,event_type,event_status,created_at) SELECT '76000000-0000-4000-8000-000000000002',id,'76000000-0000-4000-8000-000000000001','move_out','completed','2020-01-01' FROM public.companies LIMIT 1;"
        for sql,state in ((customer+event.replace("'move_out'","'invalid'"),'23514'),
                          (customer+event.replace("'completed'","'invalid'"),'23514'),(event,'23503')):
            result=self.run(NATIVE,sql)
            batch.check(result.code!=0 and result.state==state,'OPERATIONS_JOURNAL_CONSTRAINT_REQUIRED')
        cascade=customer+event+"DELETE FROM public.customers WHERE id='76000000-0000-4000-8000-000000000001'; SELECT count(*) FROM public.customer_lifecycle_events; ROLLBACK;"
        result=self.run(NATIVE,cascade)
        batch.check(result.code==0 and result.state=='00000' and result.stdout.strip()=='0','OPERATIONS_SOURCE_CASCADE_REQUIRED')
        # Labelled rollback-only grants measure the policy separately from actual ACL denial.
        for claim,count in (('authenticated','0'),('service_role','1')):
            sql=customer+event+"GRANT SELECT ON public.customer_lifecycle_events TO authenticated; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role='"+claim+"'; SELECT count(*) FROM public.customer_lifecycle_events; ROLLBACK;"
            result=self.run(NATIVE,sql)
            batch.check(result.code==0 and result.state=='00000' and result.stdout.strip()==count,'OPERATIONS_ROLLBACK_POLICY_REQUIRED')
        batch.check(r.encoded(self.snapshot(NATIVE))==r.encoded(before),'OPERATIONS_PRIVILEGE_PROBE_PRESERVATION_REQUIRED')


def seed_sql():
    return '''INSERT INTO public.ediel_actor_settings(id,actor_name,actor_ediel_id,company_id,created_at,updated_at) VALUES
 ('71000000-0000-4000-8000-000000000001','Operations fixture','999990001',NULL,'2020-01-01','2020-01-02'),
 ('71000000-0000-4000-8000-000000000002','Operations owned fixture','999990002',(SELECT id FROM public.companies LIMIT 1),'2020-01-01','2020-01-02');
INSERT INTO public.communication_routes(id,route_name,company_id,created_at,updated_at) VALUES
 ('72000000-0000-4000-8000-000000000001','Operations fixture',NULL,'2020-01-01','2020-01-02'),
 ('72000000-0000-4000-8000-000000000002','Operations owned fixture',(SELECT id FROM public.companies LIMIT 1),'2020-01-01','2020-01-02');
INSERT INTO public.ediel_route_profiles(id,company_id,created_at,updated_at) VALUES
 ('73000000-0000-4000-8000-000000000001',NULL,'2020-01-01','2020-01-02'),
 ('73000000-0000-4000-8000-000000000002',(SELECT id FROM public.companies LIMIT 1),'2020-01-01','2020-01-02');
INSERT INTO public.ediel_test_runs(id,company_id,role_code,test_suite,test_case_code,created_at,updated_at) VALUES
 ('77000000-0000-4000-8000-000000000001',NULL,'supplier','operations-fixture','case-1','2020-01-01','2020-01-02');
INSERT INTO public.ediel_test_run_messages(id,test_run_id,ediel_message_id,step_no,created_at) VALUES
 ('77000000-0000-4000-8000-000000000002','77000000-0000-4000-8000-000000000001','77000000-0000-4000-8000-000000000003',1,'2020-01-01');'''


def native():
    support.require_owner();originals=r.replay.originals_snapshot()
    with r.legacy.OwnedPostgres() as h:
        with r.fixed.AcceptedInputs(h):
            r.dedupe.prepare_reference(h,'alignment68')
            h.reset(r.fixed.CANARY)
            reader=support.private_reader(support.characterization(),h)
            reader.query(r.fixed.CANARY,"CREATE TABLE public.operations_canary(value text);INSERT INTO public.operations_canary VALUES('preserved');")
            batch.check(r.replay.serve_child(r.legacy,h,['bash',str(ROOT/'scripts/gridex-aud-003-clean-replay.sh'),'--alignment-prefix-proof'],'alignment68')==0)
            proof=Proof(h)
            proof.case('baseline',repeat=True)
            proof.case('single_active',seed_sql(),repeat=True)
            proof.case('zero_companies','DELETE FROM public.companies;'+seed_sql())
            proof.case('multiple_companies',seed_sql()+"INSERT INTO public.companies(id,name,slug,status,created_at,updated_at) VALUES('74000000-0000-4000-8000-000000000001','Operations second tenant','operations-second','active','2020-01-01','2020-01-02');")
            proof.case('blocked_company',seed_sql()+"UPDATE public.companies SET status='paused';",error='P0001')
            proof.case('blocked_without_rows',"UPDATE public.companies SET status='paused';")
            proof.case('orphan_archived',seed_sql()+"INSERT INTO public.supplier_switch_events(id,event_type,archived_by,created_at) VALUES('75000000-0000-4000-8000-000000000001','fixture','75000000-0000-4000-8000-000000000099','2020-01-01');",error='23503')
            proof.case('missing_customers','ALTER TABLE public.customers RENAME TO operations_hidden_customers;',error='42P01')
            proof.case('missing_index_column','ALTER TABLE public.metering_points RENAME COLUMN end_date TO operations_hidden_end_date;',error='42703')
            proof.case('optional_absent','ALTER TABLE public.ediel_messages RENAME TO operations_hidden_messages;')
            proof.case('foreign_constraint_name',"CREATE TABLE public.operations_foreign_constraint(id uuid CONSTRAINT supplier_switch_events_archived_by_fkey REFERENCES auth.users(id));")
            for key in ('L','E','U'):proof.case('fault_'+key,seed_sql(),fault=key)
        r.fixed.privacy(h)
        batch.check(r.replay.originals_snapshot()==originals,'OPERATIONS_SOURCE_RESTORATION_REQUIRED')
    print('PASS standalone operations whole-source characterization at actual68; NOT selected or actual71',flush=True)


def main():
    parser=argparse.ArgumentParser(allow_abbrev=False)
    mode=parser.add_mutually_exclusive_group();mode.add_argument('--selection-only',action='store_true');mode.add_argument('--cleanup-owned',action='store_true')
    args=parser.parse_args()
    if args.cleanup_owned:support.require_owner();r.legacy.cleanup_workflow_owned();return
    result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(Constructors))
    if not result.wasSuccessful():raise batch.BoundaryError('OPERATIONS_CONSTRUCTORS_FAILED')
    if not args.selection_only:native()

if __name__=='__main__':
    try:main()
    except BaseException as error:
        if isinstance(error,SystemExit):raise
        label=str(error) if re.fullmatch(r'[A-Z][A-Z0-9_]{0,79}',str(error)) else type(error).__name__
        print('FAIL operations category='+label,file=sys.stderr);sys.exit(1)
