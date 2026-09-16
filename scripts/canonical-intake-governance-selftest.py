#!/usr/bin/env python3
"""Private complete R/D/I characterization at a closed accepted actual74."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock,patch

sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file)
    value=importlib.util.module_from_spec(spec);sys.modules[name]=value;spec.loader.exec_module(value);return value
batch=module('intake_sources','canonical-intake-governance-batch.py')
lower=module('intake_private_support','canonical-readiness-operations-selftest.py')
r=batch.replay.load_readiness_runtime();a=r.alignment;support=lower.support
NATIVE=lower.NATIVE;ORACLE=lower.ORACLE


def closed_completion(h):
    prior=lower.closed_completion(h);ref=r._REFERENCES.get(h)
    run=r._RUNS.get(h);release=r._RELEASES.get(h)
    batch.check(type(ref) is r.Reference and ref.prior is prior.reference
                and ref.inputs is prior.reference.inputs and ref.name==h.name
                and ref.directory==h.directory.name,'INTAKE_REFERENCE_LINKS_REQUIRED')
    batch.check(type(run) is r.Release and type(release) is r.Release
                and run.reference is release.reference is ref
                and run.prior_completion is release.prior_completion is prior
                and run.staging is release.staging is ref.inputs.closed_staging
                and run.token==release.token and run.before==release.before
                and run.program==release.program and bool(release.after),'INTAKE_CLOSED_COMPLETION_REQUIRED')
    return release


class Proof(lower.Proof):
    # Reuse the accepted private PIPE reader and exact created-clone disposal.
    # Those methods call this owned() before every query/clone/drop.
    def __init__(self,h):
        a.repair.require_owned(h)
        batch.check(r.dedupe._STATES.get(h)=='SUCCEEDED'
                    and r.dedupe._REFERENCES[h].scope=='readiness74','INTAKE_ACTUAL74_REQUIRED')
        self.h=h;self.name=h.name;self.directory=h.directory.name
        self.release=closed_completion(h);self.run_receipt=r._RUNS[h]
        self.predecessor_runs=(r.prior._RUNS[h],a._RUNS[h])
        self.references=(h.reference,a.repair.REFERENCES[h],r.dedupe._REFERENCES[h])
        self.created=set();self.sources=batch.validate_sources(batch.reviewed_paths())
        self.core=support.characterization();self.reader=support.private_reader(self.core,h)
        self.reader.name=self.name;self.reader.directory=self.directory;self.reader.owned=self.owned
        self.origin=self.snapshot(r.DATABASE);accepted=json.loads(self.release.after)
        batch.check(self.origin[0]==accepted[0] and a.rows_equal(self.origin[1],accepted[1]),'INTAKE_FROZEN_ACTUAL74_REQUIRED')
        self.canary=self.snapshot(r.fixed.CANARY)

    def owned(self,database):
        a.repair.require_owned(self.h)
        batch.check(closed_completion(self.h) is self.release
                    and r._RUNS.get(self.h) is self.run_receipt
                    and r.prior._RUNS.get(self.h) is self.predecessor_runs[0]
                    and a._RUNS.get(self.h) is self.predecessor_runs[1]
                    and self.h.name==self.name and self.h.directory.name==self.directory
                    and self.h.reference is self.references[0]
                    and a.repair.REFERENCES.get(self.h) is self.references[1]
                    and r.dedupe._REFERENCES.get(self.h) is self.references[2]
                    and self.references[2].scope=='readiness74'
                    and r.dedupe._STATES.get(self.h)=='SUCCEEDED','INTAKE_OWNER_REQUIRED')
        batch.check(database in (r.DATABASE,r.fixed.CANARY) or database in self.created,'INTAKE_RESERVED_DATABASE_REQUIRED')

    def clone_prepared(self,before):
        self.owned(NATIVE);batch.check(NATIVE in self.created and ORACLE not in self.created,'INTAKE_PREPARED_SOURCE_REQUIRED')
        batch.check(self.query(r.DATABASE,"SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname="+a.batch.literal(ORACLE)+");").strip()=='f','INTAKE_FRESH_ORACLE_REQUIRED')
        self.h.docker(['exec',self.name,'createdb','-U','postgres','-T',NATIVE,ORACLE]);self.created.add(ORACLE)
        try:
            self.reader.identity(ORACLE)
            batch.check(r.encoded(self.snapshot(ORACLE))==r.encoded(before),'INTAKE_PREPARED_CLONE_REQUIRED')
        except BaseException:
            self.drop(ORACLE);raise

    def case(self,name,setup='',error=None,fault=None,repeat=False,probe=None):
        self.clone(NATIVE)
        try:
            if setup:self.query(NATIVE,setup)
            before=self.snapshot(NATIVE)
            if error is None:
                self.clone_prepared(before)
                try:
                    batch.check(r.encoded(self.snapshot(ORACLE))==r.encoded(before),'INTAKE_FIXTURE_EQUALITY_REQUIRED')
                    self.query(ORACLE,batch.oracle_sql(self.sources,before));expected=self.snapshot(ORACLE)[0]
                finally:self.drop(ORACLE)
                rows=batch.expected_rows(before[1],before[0]);suffix=batch.assertions(before,expected,rows,self.sources)
            else:suffix=''
            sql=''
            keys=tuple(source.key for source in self.sources)
            for source in self.sources:
                sql+=source.data.decode()+"\nSELECT 'INTAKE_SOURCE_"+source.key+"';\n"
                if fault==source.key:sql+='SELECT 1/0;\n'
            result=self.run(NATIVE,sql+suffix);expected_error='22012' if fault else error
            if expected_error:
                batch.check(result.code!=0 and result.state==expected_error,'INTAKE_EXACT_REJECTION_REQUIRED')
                if fault:batch.check([key for key in keys if 'INTAKE_SOURCE_'+key in result.stdout.splitlines()]==list(keys[:keys.index(fault)+1]))
                batch.check(r.encoded(self.snapshot(NATIVE))==r.encoded(before),'INTAKE_ROLLBACK_REQUIRED')
            else:
                batch.check(result.code==0 and result.state=='00000' and result.stdout.splitlines().count('INTAKE_COMPLETE')==1,'INTAKE_NATIVE_COMPLETION_REQUIRED')
                after=self.snapshot(NATIVE)
                batch.check(a.batch.catalog.final_equal(before[0],after[0],expected,batch.new_index_keys(self.sources,before[0],before[1]))
                            and a.rows_equal(after[1],rows),'INTAKE_POST_COMMIT_REQUIRED')
                if repeat:
                    again=self.run(NATIVE,sql+batch.assertions(after,after[0],after[1],self.sources))
                    batch.check(again.code==0 and again.state=='00000' and r.encoded(self.snapshot(NATIVE))==r.encoded(after),'INTAKE_REPEAT_REQUIRED')
                if probe:probe(self,before,after)
            batch.check(batch.validate_sources(batch.reviewed_paths())==self.sources)
        finally:
            for database in (ORACLE,NATIVE):
                if database in self.created:self.drop(database)
        batch.check(r.encoded(self.snapshot(r.DATABASE))==r.encoded(self.origin),'INTAKE_ORIGIN_PRESERVATION_REQUIRED')
        batch.check(r.encoded(self.snapshot(r.fixed.CANARY))==r.encoded(self.canary),'INTAKE_CANARY_REQUIRED')
        print('PASS intake case='+name+'; complete sources/catalog/comments/rows/rollback/preservation',flush=True)


class Constructors(unittest.TestCase):
    def test_whole_source_order_hashes_and_physical_owner(self):
        sources=batch.validate_sources(batch.reviewed_paths());self.assertEqual(tuple(s.key for s in sources),('R','D','I'))
        for invalid in (list(batch.reviewed_paths()),batch.reviewed_paths()[::-1],batch.reviewed_paths()[:-1]):
            with self.assertRaises(batch.BoundaryError):batch.validate_sources(invalid)
        with tempfile.TemporaryDirectory() as directory:
            hold=Path(directory)
            for source in sources:(hold/source.path.name).write_bytes(source.data)
            stage=batch.legacy.StagedSources(hold);self.assertEqual(batch.validate_sources(batch.reviewed_paths(),stage),sources)
            path=hold/sources[0].path.name;original=Path.stat
            def stat(candidate,*args,**kwargs):
                value=original(candidate,*args,**kwargs)
                if candidate==path:value=list(value);value[4]=os.getuid()+1;return os.stat_result(value)
                return value
            with patch.object(Path,'stat',stat):
                with self.assertRaises(batch.BoundaryError):batch.validate_sources(batch.reviewed_paths(),stage)
            path.write_bytes(sources[0].data+b'\n')
            with self.assertRaises(batch.BoundaryError):batch.validate_sources(batch.reviewed_paths(),stage)
            path.unlink();path.symlink_to(sources[0].path)
            with self.assertRaises(batch.BoundaryError):batch.validate_sources(batch.reviewed_paths(),stage)

    def test_status_check_precedes_normalization_and_orphan_deletion(self):
        shape={'relation/public.companies':{}}
        for table,status in (('companies','legacy'),('company_memberships',' '),('company_invitations','sending'),('auth_email_events','completed')):
            with self.assertRaises(batch.BoundaryError):batch.expected_rows([['public.'+table,{'id':'x','company_id':'missing','status':status}]],shape)
        before=[['public.companies',{'id':'a','status':None,'updated_at':'retained'}],['public.company_memberships',{'id':'m','company_id':'a','status':None}],['public.company_invitations',{'id':'i','company_id':'a','status':None}]]
        rows=batch.expected_rows(before,shape)
        self.assertEqual([row['status'] for _,row in rows],['active','active','pending']);self.assertIsNone(before[0][1]['status'])
        self.assertEqual(rows[0][1]['updated_at'],'retained')

    def test_orphan_json_values_preserve_valid_owners_and_distinguish_json_null(self):
        shape={'relation/public.companies':{},'column/public.tenant_governance_events/metadata':{'notnull':True}}
        values=({}, {'keep':1,'company_deleted_or_missing':False},[],[1],7,None)
        before=[['public.tenant_governance_events',{'id':str(n),'company_id':'missing','metadata':value,'created_at':'retained'}] for n,value in enumerate(values)]
        before += [['public.company_memberships',{'company_id':'missing','status':'active'}],['public.company_invitations',{'company_id':'missing','status':'pending'}],['public.audit_logs',{'company_id':'missing'}],['public.audit_logs',{'company_id':None}]]
        rows=batch.expected_rows(before,shape);flag={'company_deleted_or_missing':True}
        self.assertEqual([row['metadata'] for _,row in rows[:6]],[flag,{'keep':1,**flag},[flag],[1,flag],[7,flag],[None,flag]])
        self.assertEqual(len(rows),8);self.assertTrue(all(row['company_id'] is None for _,row in rows))
        self.assertEqual(before[0][1]['company_id'],'missing')
        shape['column/public.tenant_governance_events/metadata']['notnull']=False
        with self.assertRaises(batch.BoundaryError):batch.expected_rows(before,shape)

    def test_intake_defaults_preserve_historical_values_and_null_owners(self):
        before=[['public.customers',{'id':'a','created_at':'retained'}],['public.customers',{'id':'b','intake_status':'invalid','intake_quality_score':101,'intake_missing_fields':None}],['public.ediel_test_runs',{'id':'c','company_id':None}]]
        rows=batch.expected_rows(before,{})
        self.assertEqual(rows[0][1],{'id':'a','created_at':'retained',**batch.INTAKE_DEFAULTS})
        self.assertEqual(rows[1:],before[1:]);self.assertNotIn('intake_status',before[0][1])

    def test_independent_table_column_and_name_guards(self):
        sources=batch.validate_sources(batch.reviewed_paths())
        shape={'relation/public.customers':{},'relation/public.ediel_route_profiles':{},'column/public.ediel_route_profiles/environment':{},'column/public.ediel_route_profiles/receiver_ediel_id':{}}
        sql=batch.oracle_sql(sources,(shape,[]));self.assertNotIn('CREATE INDEX IF NOT EXISTS ediel_route_profiles_company_receiver_idx',sql)
        shape['column/public.ediel_route_profiles/is_enabled']={};shape['constraint/public.other/customers_intake_status_check']={}
        sql=batch.oracle_sql(sources,(shape,[]));self.assertIn('CREATE INDEX IF NOT EXISTS ediel_route_profiles_company_receiver_idx',sql);self.assertIn('add constraint customers_intake_status_check',sql)
        shape['constraint/public.customers/customers_intake_status_check']={}
        sql=batch.oracle_sql(sources,(shape,[]));self.assertNotIn('add constraint customers_intake_status_check',sql)
        self.assertNotIn('update public.',sql.lower());self.assertNotIn('delete from',sql.lower())

    def test_foreign_handle_rejects_before_private_transport(self):
        with patch.object(support,'private_reader') as reader:
            for h in (None,object(),SimpleNamespace(active=True)):
                with self.assertRaises(batch.BoundaryError):Proof(h)
            reader.assert_not_called()

    def test_failed_prepared_clone_disposes_only_created_oracle(self):
        proof=Proof.__new__(Proof);proof.h=SimpleNamespace(docker=Mock());proof.name='fixture'
        proof.created={NATIVE};proof.owned=Mock();proof.query=Mock(return_value='f');proof.reader=SimpleNamespace(identity=Mock())
        proof.snapshot=Mock(return_value=({'drift':True},[]))
        with self.assertRaises(batch.BoundaryError):proof.clone_prepared(({},[]))
        self.assertEqual(proof.created,{NATIVE})
        self.assertEqual(proof.h.docker.call_args.args[0],['exec','fixture','dropdb','-U','postgres','--force',ORACLE])

    def test_readiness_closed_links_rechecked_before_every_query(self):
        class Handle:pass
        h=Handle();h.name='fixture';h.directory=SimpleNamespace(name='/fixture');h.reference=object()
        stage=object();dref=SimpleNamespace(scope='readiness74',continuation=True)
        inputs=SimpleNamespace(closed=True,active=False,staging=None,closed_staging=stage)
        fref=r.fixed.Reference(h.name,h.directory.name,dref,b'',(),inputs,())
        fixed=r.fixed.Reservation(fref,b'',b'','fixed-token')
        aref=a.Reference(h.name,h.directory.name,fref,inputs,(),(),b'',())
        arun=a.Release(aref,fixed,stage,b'alignment-before',b'','alignment-token')
        arelease=a.replace(arun,after=b'accepted-alignment')
        oref=r.prior.Reference(h.name,h.directory.name,aref,inputs,(),b'')
        orun=r.prior.Release(oref,arelease,stage,b'operations-before',b'','operations-token',b'operations-program')
        prior=r.prior.replace(orun,after=b'accepted-operations')
        ref=r.Reference(h.name,h.directory.name,oref,inputs,())
        run=r.Release(ref,prior,stage,b'before',b'','token',b'program');release=r.replace(run,after=r.encoded(({},[])))
        registries=(r._REFERENCES,r._RUNS,r._RELEASES,a.repair.REFERENCES,r.dedupe._REFERENCES,r.dedupe._STATES,
                    r.prior._REFERENCES,r.prior._RUNS,r.prior._RELEASES,a._REFERENCES,a._RUNS,a._RELEASES,
                    r.fixed._REFERENCES,r.fixed._RUNS,r.fixed._RELEASES)
        values=(ref,run,release,object(),dref,'SUCCEEDED',oref,orun,prior,aref,arun,arelease,fref,fixed,fixed)
        try:
            for registry,value in zip(registries,values):registry[h]=value
            with patch.object(a.repair,'require_owned'),patch.object(Proof,'snapshot',return_value=({},[])),patch.object(support,'private_reader',return_value=SimpleNamespace()):
                proof=Proof(h);proof.owned(r.DATABASE)
                for registry,original in ((r.prior._RUNS,orun),(a._RUNS,arun)):
                    registry[h]=r.replace(original)
                    try:
                        with self.assertRaises(batch.BoundaryError):proof.owned(r.DATABASE)
                    finally:registry[h]=original
                for invalid in (r.replace(run,reference=object()),r.replace(run,prior_completion=object()),r.replace(run,staging=object()),r.replace(run,before=b'foreign'),r.replace(run,program=b'foreign')):
                    r._RUNS[h]=invalid
                    with self.assertRaises(batch.BoundaryError):Proof(h)
                    with self.assertRaises(batch.BoundaryError):proof.owned(r.DATABASE)
                r._RUNS[h]=run
                with self.assertRaises(batch.BoundaryError):proof.owned(NATIVE)
                r.fixed._RUNS[h]=object()
                with self.assertRaises(batch.BoundaryError):proof.owned(r.DATABASE)
        finally:
            for registry in registries:registry.pop(h,None)


def seed_sql():
    return '''INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) VALUES
 ('91000000-0000-4000-8000-000000000001','intake-one@example.invalid','{}','{}','2020-01-01','2020-01-02'),
 ('91000000-0000-4000-8000-000000000002','intake-two@example.invalid','{}','{}','2020-01-01','2020-01-02');
INSERT INTO public.companies(id,name,slug,status,created_at,updated_at) VALUES
 ('92000000-0000-4000-8000-000000000001','Intake tenant one','intake-one','active','2020-01-01','2020-01-02'),
 ('92000000-0000-4000-8000-000000000002','Intake tenant two','intake-two','active','2020-01-01','2020-01-02');
INSERT INTO public.customers(id,company_id,full_name,created_at,updated_at) VALUES
 ('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','Intake customer one','2020-01-01','2020-01-02'),
 ('93000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002','Intake customer two','2020-01-01','2020-01-02');
INSERT INTO public.company_memberships(id,company_id,user_id,membership_role,role,status,created_at,updated_at) VALUES
 ('94000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','member','member','active','2020-01-01','2020-01-02'),
 ('94000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000002','member','member','active','2020-01-01','2020-01-02');
INSERT INTO public.company_invitations(id,company_id,email,membership_role,status,token,created_at,updated_at) VALUES
 ('95000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','intake-invite-one@example.invalid','member','pending','95000000-0000-4000-8000-000000000011','2020-01-01','2020-01-02'),
 ('95000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002','intake-invite-two@example.invalid','member','pending','95000000-0000-4000-8000-000000000012','2020-01-01','2020-01-02');
INSERT INTO public.auth_email_events(id,company_id,email,action,event_type,status,created_at) VALUES
 ('96000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','intake-one@example.invalid','invite_sent','invite_sent','sent','2020-01-01');
INSERT INTO public.ediel_test_runs(id,company_id,customer_id,role_code,test_suite,test_case_code,created_at,updated_at) VALUES
 ('97000000-0000-4000-8000-000000000001',NULL,'93000000-0000-4000-8000-000000000001','supplier','AGT','fixture-one','2020-01-01','2020-01-02'),
 ('97000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000001','supplier','AGT','fixture-two','2020-01-01','2020-01-02');'''


def orphan_sql():
    return seed_sql()+'''ALTER TABLE public.company_memberships DROP CONSTRAINT company_memberships_company_id_fkey;
ALTER TABLE public.company_invitations DROP CONSTRAINT company_invitations_company_id_fkey;
ALTER TABLE public.tenant_governance_events DROP CONSTRAINT tenant_governance_events_company_id_fkey;
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_company_id_fkey;
UPDATE public.company_memberships SET company_id='92000000-0000-4000-8000-000000000099' WHERE id='94000000-0000-4000-8000-000000000001';
UPDATE public.company_invitations SET company_id='92000000-0000-4000-8000-000000000099' WHERE id='95000000-0000-4000-8000-000000000001';
INSERT INTO public.tenant_governance_events(id,company_id,action,metadata,created_at)
SELECT ('98000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'92000000-0000-4000-8000-000000000099','fixture',value,'2020-01-01'
FROM (VALUES(1,'{}'::jsonb),(2,'{"keep":1,"company_deleted_or_missing":false}'::jsonb),(3,'[]'::jsonb),(4,'[1]'::jsonb),(5,'7'::jsonb),(6,'null'::jsonb)) v(n,value);
INSERT INTO public.tenant_governance_events(id,company_id,action,metadata,created_at) VALUES
 ('98000000-0000-4000-8000-000000000007','92000000-0000-4000-8000-000000000002','fixture','{"keep":true}','2020-01-01');
INSERT INTO public.audit_logs(id,company_id,entity_type,entity_id,action,created_at,updated_at) VALUES
 ('99000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000099','fixture','one','fixture','2020-01-01','2020-01-02'),
 ('99000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002','fixture','two','fixture','2020-01-01','2020-01-02');'''


def baseline_probe(proof,before,after):
    added=after[0].keys()-before[0].keys()
    batch.check(sum(key.startswith('index/') for key in added)==15
                and sum(key.startswith('column/') for key in added)==3
                and sum(key.startswith('constraint/') for key in added)==2,'INTAKE_BASELINE_DELTA_REQUIRED')
    for name in ('ediel_messages_company_family_status_idx','customers_company_personal_number_idx','customers_company_org_number_idx'):
        key='index/public.'+name;batch.check(after[0][key]==before[0][key],'INTAKE_EXISTING_INDEX_PRESERVATION_REQUIRED')
    print('PASS intake baseline delta indexes15 columns3 newChecks2; existing index variants preserved',flush=True)


def intake_probe(proof,before,after):
    for name in ('customers_intake_status_check','customers_intake_quality_score_check'):
        batch.check(after[0]['constraint/public.customers/'+name]['validated'] is False,'INTAKE_NOT_VALID_REQUIRED')
    for value,error in ((-1,'23514'),(0,None),(100,None),(101,'23514')):
        result=proof.run(NATIVE,"UPDATE public.customers SET intake_status='draft',intake_quality_score="+str(value)+"; ROLLBACK;")
        batch.check((result.code!=0 and result.state==error) if error else (result.code==0 and result.state=='00000'),'INTAKE_SCORE_ENFORCEMENT_REQUIRED')
    result=proof.run(NATIVE,"UPDATE public.customers SET intake_status='fixture-invalid',intake_quality_score=50; ROLLBACK;")
    batch.check(result.code!=0 and result.state=='23514','INTAKE_STATUS_ENFORCEMENT_REQUIRED')
    batch.check(r.encoded(proof.snapshot(NATIVE))==r.encoded(after),'INTAKE_PROBE_PRESERVATION_REQUIRED')


def native():
    support.require_owner();originals=r.replay.originals_snapshot()
    with r.legacy.OwnedPostgres() as h:
        with r.fixed.AcceptedInputs(h):
            r.dedupe.prepare_reference(h,'readiness74');h.reset(r.fixed.CANARY)
            reader=support.private_reader(support.characterization(),h)
            reader.query(r.fixed.CANARY,"CREATE TABLE public.intake_canary(value text); INSERT INTO public.intake_canary VALUES('preserved');")
            batch.check(r.replay.serve_child(r.legacy,h,['bash',str(ROOT/'scripts/gridex-aud-003-clean-replay.sh'),'--readiness-prefix-proof'],'readiness74')==0)
            proof=Proof(h);proof.case('baseline',repeat=True,probe=baseline_probe)
            proof.case('two_tenant_preservation',seed_sql(),repeat=True)
            nulls=seed_sql()+'''ALTER TABLE public.companies ALTER COLUMN status DROP NOT NULL;
ALTER TABLE public.company_memberships ALTER COLUMN status DROP NOT NULL;
ALTER TABLE public.company_invitations ALTER COLUMN status DROP NOT NULL;
UPDATE public.companies SET status=NULL;UPDATE public.company_memberships SET status=NULL;UPDATE public.company_invitations SET status=NULL;'''
            proof.case('nullable_statuses',nulls,repeat=True)
            for table,value in (('companies','fixture-invalid'),('company_memberships',' '),('company_invitations',' ')):
                setup=seed_sql()+'ALTER TABLE public.'+table+' DROP CONSTRAINT '+table+'_status_check; UPDATE public.'+table+' SET status='+a.batch.literal(value)+';'
                proof.case('invalid_'+table,setup,error='23514')
            for value in ('sending','sent','delivery_uncertain','invited','failed'):
                proof.case('legacy_invitation_'+value,seed_sql()+"UPDATE public.company_invitations SET status='"+value+"';",error='23514')
            proof.case('legacy_email_completed',seed_sql()+"UPDATE public.auth_email_events SET status='completed';",error='23514')
            proof.case('orphan_all_branches',orphan_sql(),repeat=True)
            dirty=seed_sql()+'''ALTER TABLE public.customers ADD COLUMN intake_status text,ADD COLUMN intake_missing_fields jsonb,ADD COLUMN intake_quality_score integer;
UPDATE public.customers SET intake_status='fixture-invalid',intake_missing_fields='["retained"]',intake_quality_score=101;'''
            proof.case('historical_invalid_intake',dirty,repeat=True,probe=intake_probe)
            proof.case('same_name_intake_constraint',"ALTER TABLE public.customers ADD CONSTRAINT customers_intake_status_check CHECK(full_name IS NOT NULL) NOT VALID;",repeat=True)
            proof.case('unrelated_constraint_name',"CREATE TABLE public.intake_other(value text CONSTRAINT customers_intake_status_check CHECK(value<>''));",repeat=True)
            proof.case('optional_table_absent','ALTER TABLE public.ediel_messages RENAME TO intake_hidden_messages;',repeat=True)
            proof.case('guarded_column_absent','ALTER TABLE public.ediel_route_profiles RENAME COLUMN receiver_ediel_id TO intake_hidden_receiver;',repeat=True)
            proof.case('intake_table_absent','ALTER TABLE public.customers RENAME TO intake_hidden_customers;',repeat=True)
            proof.case('intake_required_column_absent','ALTER TABLE public.customer_cases RENAME COLUMN source TO intake_hidden_source;',error='42703')
            for key in ('R','D','I'):proof.case('fault_'+key,seed_sql(),fault=key)
        r.fixed.privacy(h);batch.check(r.replay.originals_snapshot()==originals,'INTAKE_ORIGINALS_REQUIRED')
    print('PASS standalone intake governance sources at actual74; no selection or actual77 claim',flush=True)


def main():
    parser=argparse.ArgumentParser(allow_abbrev=False);mode=parser.add_mutually_exclusive_group()
    mode.add_argument('--selection-only',action='store_true');mode.add_argument('--cleanup-owned',action='store_true');args=parser.parse_args()
    if args.cleanup_owned:support.require_owner();r.legacy.cleanup_workflow_owned();return
    result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(Constructors))
    if not result.wasSuccessful():raise batch.BoundaryError('INTAKE_CONSTRUCTORS_FAILED')
    if not args.selection_only:native()

if __name__=='__main__':
    try:main()
    except BaseException as error:
        if isinstance(error,SystemExit):raise
        label=str(error) if re.fullmatch(r'[A-Z][A-Z0-9_]{0,79}',str(error)) else type(error).__name__
        print('FAIL intake source category='+label,file=sys.stderr);sys.exit(1)
