#!/usr/bin/env python3
"""Complete metering/readiness/Z01 source characterization; no selection authority."""
import argparse
import json
import os
import re
import tempfile
from types import SimpleNamespace
from unittest.mock import patch, Mock
import importlib.util
import sys
from pathlib import Path
import unittest
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('readiness_sources',ROOT/'scripts/canonical-readiness-operations-batch.py')
batch=importlib.util.module_from_spec(spec);sys.modules[spec.name]=batch;spec.loader.exec_module(batch)

class Constructors(unittest.TestCase):
    def test_whole_source_pins(self):
        sources=batch.validate_sources(batch.reviewed_paths())
        self.assertEqual(tuple(s.key for s in sources),('M','E','Z'))
        for invalid in (tuple(reversed(batch.reviewed_paths())),batch.reviewed_paths()[:-1],list(batch.reviewed_paths())):
            with self.assertRaises(batch.BoundaryError):batch.validate_sources(invalid)

    def test_backfill_only_null_customer_owned_rows_and_preserve_other_fields(self):
        before=[['public.companies',{'id':'a','status':'active'}],['public.companies',{'id':'b','status':'active'}],
                ['public.customers',{'id':'c','company_id':'a'}],
                ['public.outbound_requests',{'id':'x','customer_id':'c','company_id':None,'updated_at':'retained'}],
                ['public.partner_exports',{'id':'y','customer_id':'c','company_id':'b'}],
                ['public.billing_underlays',{'id':'z','customer_id':'missing','company_id':None,'readiness_status':None}]]
        rows=batch.expected_rows(before)
        self.assertIsNone(before[3][1]['company_id']);self.assertEqual(rows[3][1]['company_id'],'a')
        self.assertEqual(rows[3][1]['updated_at'],'retained');self.assertEqual(rows[4][1]['company_id'],'b')
        self.assertIsNone(rows[5][1]['company_id']);self.assertIsNone(rows[5][1]['readiness_status'])

    def test_key_format_historical_rows_and_null_reading_type(self):
        def row(**kwargs):
            return ['public.metering_values',{'company_id':'a','metering_point_id':'point','reading_type':None,'read_at':'2020-01-02T03:04:05.120000+00:00','is_current':False,**kwargs}]
        before=[row(),row(canonical_dedupe_key='retained'),row(read_at=None),row(period_start='2020-01-01T02:00:00+02:00')]
        after=batch.expected_rows(before)
        self.assertEqual(after[0][1]['canonical_dedupe_key'],'a|point|2020-01-02 03:04:05.12+00|no-period-start|no-period-end')
        self.assertEqual(after[1][1]['canonical_dedupe_key'],'retained');self.assertIsNone(after[2][1]['canonical_dedupe_key'])
        self.assertIn('|2020-01-01 00:00:00+00|',after[3][1]['canonical_dedupe_key'])
        self.assertFalse(after[0][1]['is_current'])

    def test_blocked_company_guard_only_on_owner_assignment(self):
        company=['public.companies',{'id':'a','status':'paused'}];customer=['public.customers',{'id':'c','company_id':'a'}]
        row=['public.metering_values',{'customer_id':'c','company_id':None}]
        with self.assertRaises(batch.BoundaryError):batch.expected_rows([company,customer,row])
        row[1]['company_id']='a';self.assertEqual(batch.expected_rows([company,customer,row])[2][1]['company_id'],'a')

    def test_company_normalization_is_independent_and_retains_timestamps(self):
        before=[['public.companies',{'id':'a','status':'active','branding':None,'billing_settings':{'keep':1},'operating_environment':'bad','updated_at':'retained'}]]
        after=batch.expected_rows(before)[0][1]
        self.assertEqual((after['branding'],after['billing_settings'],after['operating_environment'],after['updated_at']),({}, {'keep':1},'test','retained'))
        shape={'relation/public.companies':{},'relation/public.communication_routes':{},'relation/public.outbound_requests':{}}
        sql=batch.oracle_sql(batch.validate_sources(batch.reviewed_paths()),(shape,before))
        self.assertLess(sql.index('UPDATE public.companies SET'),sql.index('add constraint companies_operating_environment_check'))
        self.assertNotIn('set branding = coalesce',sql)

    def test_z_drops_only_text_matching_table_checks(self):
        shape={'relation/public.communication_routes':{},'relation/public.outbound_requests':{},
               'constraint/public.communication_routes/old':{'kind':'c','definition':"CHECK (route_scope <> 'x')"},
               'constraint/public.communication_routes/wildcard':{'kind':'c','definition':"CHECK (route_name <> 'routeXscope')"},
               'constraint/public.communication_routes/retained':{'kind':'c','definition':"CHECK (route_name <> '')"},
               'constraint/public.outbound_requests/other':{'kind':'u','definition':'UNIQUE (request_type)'},
               'constraint/public.unrelated/foreign':{'kind':'c','definition':"CHECK (route_scope <> '')"}}
        sql=batch.oracle_sql(batch.validate_sources(batch.reviewed_paths()),(shape,[]))
        self.assertIn('drop constraint if exists "old"',sql)
        self.assertIn('drop constraint if exists "wildcard"',sql)
        for name in ('retained','other','foreign'):self.assertNotIn('drop constraint if exists "'+name+'"',sql)



    def test_staged_bytes_and_owner_reject_before_source_use(self):
        sources=batch.validate_sources(batch.reviewed_paths())
        with tempfile.TemporaryDirectory(prefix='readiness-sources-') as directory:
            hold=Path(directory)
            for source in sources:(hold/source.path.name).write_bytes(source.data)
            stage=batch.legacy.StagedSources(hold)
            self.assertEqual(batch.validate_sources(batch.reviewed_paths(),stage),sources)
            path=hold/sources[0].path.name;original=Path.stat
            def stat(candidate,*args,**kwargs):
                value=original(candidate,*args,**kwargs)
                if candidate==path:
                    value=list(value);value[4]=os.getuid()+1;return os.stat_result(value)
                return value
            with patch.object(Path,'stat',stat):
                with self.assertRaises(batch.BoundaryError):batch.validate_sources(batch.reviewed_paths(),stage)
            path.write_bytes(sources[0].data+b'\n')
            with self.assertRaises(batch.BoundaryError):batch.validate_sources(batch.reviewed_paths(),stage)
            path.unlink();path.symlink_to(sources[0].path)
            with self.assertRaises(batch.BoundaryError):batch.validate_sources(batch.reviewed_paths(),stage)

    def test_foreign_handle_rejects_before_private_reader(self):
        with patch.object(support,'private_reader') as reader:
            for target in (None,object(),SimpleNamespace(active=True)):
                with self.assertRaises(batch.BoundaryError):Proof(target)
            reader.assert_not_called()

    def test_frozen_links_recheck_all_predecessors_before_sql(self):
        class Handle:pass
        h=Handle();h.name='fixture';h.directory=SimpleNamespace(name='/fixture');h.reference=object()
        stage=object();dedupe_ref=SimpleNamespace(scope='operations71',continuation=True)
        inputs=SimpleNamespace(closed=True,active=False,staging=None,closed_staging=stage)
        fref=r.fixed.Reference(h.name,h.directory.name,dedupe_ref,b'',(),inputs,())
        fixed=r.fixed.Reservation(fref,b'',b'','fixed-token')
        aref=a.Reference(h.name,h.directory.name,fref,inputs,(),(),b'',())
        ref=r.Reference(h.name,h.directory.name,aref,inputs,(),b'')
        predecessor_run=a.Release(aref,fixed,stage,b'prior',b'','prior-token')
        predecessor=a.replace(predecessor_run,after=b'accepted')
        run=r.Release(ref,predecessor,stage,b'before',b'','token',b'program')
        release=r.replace(run,after=r.encoded(({},[])))
        registries=(r._RUNS,r._RELEASES,r._REFERENCES,a._RUNS,a._RELEASES,a._REFERENCES,r.fixed._RELEASES,r.fixed._RUNS,r.fixed._REFERENCES,a.repair.REFERENCES,r.dedupe._REFERENCES,r.dedupe._STATES)
        values=(run,release,ref,predecessor_run,predecessor,aref,fixed,fixed,fref,object(),dedupe_ref,'SUCCEEDED')
        try:
            for registry,value in zip(registries,values):registry[h]=value
            with patch.object(a.repair,'require_owned'),patch.object(Proof,'snapshot',return_value=({},[])),patch.object(support,'private_reader',return_value=SimpleNamespace()):
                proof=Proof(h);proof.owned(r.DATABASE)
                with self.assertRaises(batch.BoundaryError):proof.owned(NATIVE)
                for registry in registries[:-1]:
                    old=registry[h];registry[h]=object()
                    try:
                        with self.assertRaises(batch.BoundaryError):proof.owned(r.DATABASE)
                    finally:registry[h]=old
                for invalid in (r.replace(run,reference=object()),r.replace(run,program=b'foreign'),r.replace(run,staging=object()),r.replace(run,before=b'foreign')):
                    r._RUNS[h]=invalid
                    with self.assertRaises(batch.BoundaryError):Proof(h)
                r._RUNS[h]=run
                r.fixed._RUNS[h]=object()
                with self.assertRaises(batch.BoundaryError):Proof(h)
                r.fixed._RUNS[h]=fixed
                a._RUNS.pop(h)
                with self.assertRaises(batch.BoundaryError):Proof(h)
        finally:
            for registry in registries:registry.pop(h,None)

    def test_failed_clone_admission_disposes_only_created_clone(self):
        proof=Proof.__new__(Proof);proof.h=SimpleNamespace(docker=Mock());proof.name='fixture'
        proof.created=set();proof.owned=Mock();proof.query=Mock(return_value='f');proof.reader=SimpleNamespace(identity=Mock())
        proof.origin=({},[]);proof.snapshot=Mock(return_value=({'drift':True},[]))
        with self.assertRaises(batch.BoundaryError):proof.clone(NATIVE)
        self.assertEqual(proof.created,set())
        self.assertEqual(proof.h.docker.call_args.args[0],['exec','fixture','dropdb','-U','postgres','--force',NATIVE])


r=batch.replay.load_operations_runtime();a=r.alignment
spec=importlib.util.spec_from_file_location('readiness_private_support',ROOT/'scripts/canonical-user-rbac-fixed-target-continuation-selftest.py')
support=importlib.util.module_from_spec(spec);spec.loader.exec_module(support)
NATIVE='gridex_auth_legacy_native';ORACLE='gridex_auth_legacy_atomic'

def closed_completion(h):
    ref=r._REFERENCES.get(h);aref=a._REFERENCES.get(h);fref=r.fixed._REFERENCES.get(h)
    check=batch.check
    check(type(ref) is r.Reference and type(aref) is a.Reference and type(fref) is r.fixed.Reference,
          'READINESS_REFERENCE_TYPES_REQUIRED')
    check(ref.alignment is aref and aref.fixed is fref and fref.dedupe is r.dedupe._REFERENCES.get(h)
          and ref.inputs is aref.inputs is fref.inputs and all(x.name==h.name and x.directory==h.directory.name for x in (ref,aref,fref)),
          'READINESS_REFERENCE_LINKS_REQUIRED')
    inputs=ref.inputs;stage=inputs.closed_staging
    check(inputs.closed and not inputs.active and inputs.staging is None and stage is not None,
          'READINESS_CLOSED_INPUTS_REQUIRED')
    run=r._RUNS.get(h);release=r._RELEASES.get(h);arun=a._RUNS.get(h);prior=a._RELEASES.get(h)
    fixed=r.fixed._RELEASES.get(h)
    check(type(fixed) is r.fixed.Reservation and fixed is r.fixed._RUNS.get(h) and fixed.reference is fref,
          'READINESS_FIXED_RESERVATION_REQUIRED')
    check(type(arun) is a.Release and type(prior) is a.Release and arun.reference is prior.reference is aref
          and arun.fixed_completion is prior.fixed_completion is fixed and arun.staging is prior.staging is stage
          and arun.token==prior.token and arun.before==prior.before and arun.files==prior.files
          and arun.prelude==prior.prelude and bool(prior.after),'READINESS_ALIGNMENT_COMPLETION_REQUIRED')
    check(type(run) is r.Release and type(release) is r.Release and run.reference is release.reference is ref
          and run.alignment_completion is release.alignment_completion is prior
          and run.staging is release.staging is stage and run.token==release.token
          and run.before==release.before and run.program==release.program and bool(release.after),
          'READINESS_OPERATIONS_COMPLETION_REQUIRED')
    return release


class Proof:
    def __init__(self,h):
        a.repair.require_owned(h)
        batch.check(r.dedupe._STATES.get(h)=='SUCCEEDED','READINESS_ACTUAL71_REQUIRED')
        batch.check(r.dedupe._REFERENCES[h].scope=='operations71','READINESS_EXACT_PREFIX_REQUIRED')
        self.h=h;self.name=h.name;self.directory=h.directory.name
        self.release=closed_completion(h);self.run_receipt=r._RUNS[h]
        self.references=(h.reference,a.repair.REFERENCES[h],r.dedupe._REFERENCES[h])
        self.predecessor_run=a._RUNS.get(h)
        self.created=set();self.sources=batch.validate_sources(batch.reviewed_paths())
        self.core=support.characterization();self.reader=support.private_reader(self.core,h)
        self.reader.name=self.name;self.reader.directory=self.directory
        self.reader.owned=self.owned
        self.origin=self.snapshot(r.DATABASE)
        accepted=json.loads(self.release.after)
        batch.check(self.origin[0]==accepted[0]
                    and a.rows_equal(self.origin[1],accepted[1]),'READINESS_FROZEN_ACTUAL71_REQUIRED')
        self.canary=self.snapshot(r.fixed.CANARY)

    def owned(self,database):
        a.repair.require_owned(self.h)
        batch.check(closed_completion(self.h) is self.release,'READINESS_FROZEN_COMPLETION_REQUIRED')
        batch.check(self.h.name==self.name and self.h.directory.name==self.directory
                    and self.h.reference is self.references[0]
                    and a.repair.REFERENCES[self.h] is self.references[1]
                    and r.dedupe._REFERENCES[self.h] is self.references[2]
                    and r._RELEASES.get(self.h) is self.release
                    and r._RUNS.get(self.h) is self.run_receipt
                    and r._REFERENCES.get(self.h) is self.release.reference
                    and a._RELEASES.get(self.h) is self.release.alignment_completion
                    and a._REFERENCES.get(self.h) is self.release.reference.alignment
                    and a._RUNS.get(self.h) is self.predecessor_run
                    and r.fixed._RELEASES.get(self.h) is self.release.alignment_completion.fixed_completion
                    and self.references[2].scope=='operations71'
                    and r.dedupe._STATES.get(self.h)=='SUCCEEDED','READINESS_OWNER_REQUIRED')
        batch.check(database in (r.DATABASE,r.fixed.CANARY) or database in self.created,
                    'READINESS_RESERVED_DATABASE_REQUIRED')

    def run(self,database,sql):
        return self.reader.run(database,"SET client_min_messages=error; SET TIME ZONE 'UTC'; SET DateStyle='ISO, MDY';\n"+sql)

    def query(self,database,sql):
        result=self.run(database,sql)
        if result.code or result.state!='00000':
            allowed=('42601','42P01','42703','23503','23505','23514','42710','42501','P0001','P0004','22012')
            raise batch.BoundaryError('READINESS_QUERY_'+(result.state if result.state in allowed else 'OTHER'))
        return result.stdout

    def snapshot(self,database):
        sql="SELECT 'READINESS_CATALOG';\n"+batch.operations.catalog_sql()+"\nSELECT 'READINESS_ROWS';\n"+a.batch.rows_sql()
        sql+="SELECT coalesce(jsonb_agg(jsonb_build_array(name,value) ORDER BY name,value),'[]') FROM alignment_rows; DROP TABLE alignment_rows;"
        lines=self.query(database,sql).splitlines()
        batch.check(lines.count('READINESS_CATALOG')==lines.count('READINESS_ROWS')==1)
        return (json.loads(lines[lines.index('READINESS_CATALOG')+1]),json.loads(lines[lines.index('READINESS_ROWS')+1]))

    def clone(self,database):
        self.owned(r.DATABASE)
        batch.check(database in (NATIVE,ORACLE) and database not in self.created,'READINESS_FRESH_DATABASE_REQUIRED')
        batch.check(self.query(r.DATABASE,"SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname="+a.batch.literal(database)+");").strip()=='f')
        self.h.docker(['exec',self.name,'createdb','-U','postgres','-T',r.DATABASE,database])
        self.created.add(database)
        try:
            self.reader.identity(database)
            batch.check(r.encoded(self.snapshot(database))==r.encoded(self.origin),'READINESS_CLONE_REQUIRED')
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
                    batch.check(r.encoded(oracle_before)==r.encoded(before),'READINESS_FIXTURE_EQUALITY_REQUIRED')
                    self.query(ORACLE,batch.oracle_sql(self.sources,before))
                    expected=self.snapshot(ORACLE)[0]
                finally:self.drop(ORACLE)
                rows=batch.expected_rows(before[1])
                suffix=batch.assertions(before,expected,rows,self.sources)
            else:suffix=''
            sql=''
            for source in self.sources:
                sql+=source.data.decode()+"\nSELECT 'READINESS_SOURCE_"+source.key+"';\n"
                if fault==source.key:sql+='SELECT 1/0;\n'
            result=self.run(NATIVE,sql+suffix)
            expected_error='22012' if fault else error
            if expected_error:
                batch.check(result.code!=0 and result.state==expected_error,'READINESS_EXACT_NATIVE_REJECTION_REQUIRED')
                if fault:
                    reached=[key for key in ('M','E','Z') if 'READINESS_SOURCE_'+key in result.stdout.splitlines()]
                    batch.check(reached==list(('M','E','Z')[:('M','E','Z').index(fault)+1]))
                batch.check(r.encoded(self.snapshot(NATIVE))==r.encoded(before),'READINESS_ROLLBACK_REQUIRED')
            else:
                batch.check(result.code==0 and result.state=='00000' and result.stdout.splitlines().count('READINESS_COMPLETE')==1,'READINESS_NATIVE_COMPLETION_REQUIRED')
                after=self.snapshot(NATIVE)
                batch.check(a.batch.catalog.final_equal(before[0],after[0],expected,batch.new_index_keys(self.sources,before[0],before[1]))
                            and a.rows_equal(after[1],rows),'READINESS_POST_COMMIT_REQUIRED')
                if repeat:
                    again=self.run(NATIVE,sql+batch.assertions(after,after[0],after[1],self.sources))
                    batch.check(again.code==0 and again.state=='00000' and r.encoded(self.snapshot(NATIVE))==r.encoded(after),'READINESS_REPEAT_REQUIRED')
                if name=='baseline':self.view_probes()
            batch.check(batch.validate_sources(batch.reviewed_paths())==self.sources)
        finally:
            for database in (ORACLE,NATIVE):
                if database in self.created:self.drop(database)
        batch.check(r.encoded(self.snapshot(r.DATABASE))==r.encoded(self.origin),'READINESS_ORIGIN_PRESERVATION_REQUIRED')
        batch.check(r.encoded(self.snapshot(r.fixed.CANARY))==r.encoded(self.canary),'READINESS_CANARY_REQUIRED')
        print('PASS readiness case='+name+'; complete source/catalog/comments/rows/rollback/preservation',flush=True)
    def view_probes(self):
        before=self.snapshot(NATIVE)
        for role in ('anon','authenticated','service_role'):
            for view in ('billing_readiness_flags','gridex_tenant_runtime_readiness'):
                result=self.run(NATIVE,'SET LOCAL ROLE '+role+'; SELECT * FROM public.'+view+';')
                batch.check(result.code!=0 and result.state=='42501','READINESS_VIEW_ACL_REQUIRED')
        # Rollback-only synthetic branches preserve actual view ACLs and all rows.
        setup="DELETE FROM public.ediel_actor_settings; DELETE FROM public.communication_routes; DELETE FROM public.ediel_route_profiles;"
        for status,ediel,route,expected in (('active',None,False,'missing_actor_profile'),('active','999',False,'missing_route'),
                                          ('active','999',True,'ready'),('paused','999',True,'blocked_company_status'),
                                          ('deleted_test_only','999',False,'')):
            # Seed active so operational INSERT guard succeeds before status changes.
            sql=setup+"UPDATE public.companies SET status='active',ediel_id="+('NULL' if ediel is None else "'999'")+";"
            if route:sql+="INSERT INTO public.communication_routes(id,company_id,route_name,created_at,updated_at) SELECT '82000000-0000-4000-8000-000000000001',id,'Readiness route','2020-01-01','2020-01-02' FROM public.companies;"
            sql+="UPDATE public.companies SET status='"+status+"'; SELECT readiness_status FROM public.gridex_tenant_runtime_readiness; ROLLBACK;"
            result=self.run(NATIVE,sql)
            batch.check(result.code==0 and result.state=='00000' and result.stdout.strip()==expected,'READINESS_VIEW_BRANCH_REQUIRED')
        for enabled,expected in ((False,'missing_route'),(True,'ready')):
            sql=setup+"UPDATE public.companies SET status='active',ediel_id=NULL;"
            sql+="INSERT INTO public.ediel_actor_settings(id,company_id,actor_name,actor_ediel_id,created_at,updated_at) SELECT '82000000-0000-4000-8000-000000000002',id,'Readiness actor','999990003','2020-01-01','2020-01-02' FROM public.companies;"
            sql+="INSERT INTO public.ediel_route_profiles(id,company_id,is_enabled,created_at,updated_at) SELECT '82000000-0000-4000-8000-000000000003',id,"+('true' if enabled else 'false')+",'2020-01-01','2020-01-02' FROM public.companies;"
            sql+="SELECT readiness_status FROM public.gridex_tenant_runtime_readiness; ROLLBACK;"
            result=self.run(NATIVE,sql)
            batch.check(result.code==0 and result.state=='00000' and result.stdout.strip()==expected,'READINESS_PROFILE_BRANCH_REQUIRED')
        sql="INSERT INTO public.billing_underlays(id,company_id,status,readiness_status,created_at,updated_at) SELECT ('83000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,id,'pending',value,'2020-01-01','2020-01-02' FROM public.companies CROSS JOIN (VALUES(1,'warning'),(2,'blocked'),(3,'requires_correction'),(4,'ready'),(5,NULL)) x(n,value); SELECT string_agg(readiness_status,',' ORDER BY readiness_status) FROM public.billing_readiness_flags; ROLLBACK;"
        result=self.run(NATIVE,sql)
        batch.check(result.code==0 and result.state=='00000' and result.stdout.strip()=='blocked,requires_correction,warning','READINESS_BILLING_BRANCH_REQUIRED')
        batch.check(r.encoded(self.snapshot(NATIVE))==r.encoded(before),'READINESS_PROBE_PRESERVATION_REQUIRED')


def seed_sql():
    return '''INSERT INTO public.companies(id,name,slug,status,created_at,updated_at) VALUES
 ('81000000-0000-4000-8000-000000000001','Readiness second tenant','readiness-second','active','2020-01-01','2020-01-02');
INSERT INTO public.customers(id,company_id,full_name,created_at,updated_at) SELECT
 '81000000-0000-4000-8000-000000000002',id,'Readiness first customer','2020-01-01','2020-01-02' FROM public.companies WHERE id<>'81000000-0000-4000-8000-000000000001';
INSERT INTO public.customers(id,company_id,full_name,created_at,updated_at) VALUES
 ('81000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000001','Readiness second customer','2020-01-01','2020-01-02');
INSERT INTO public.grid_owner_data_requests(id,company_id,customer_id,requested_at,created_at,updated_at) VALUES
 ('81000000-0000-4000-8000-000000000011',NULL,'81000000-0000-4000-8000-000000000002','2020-01-01','2020-01-01','2020-01-02');
INSERT INTO public.billing_underlays(id,company_id,customer_id,readiness_status,created_at,updated_at) VALUES
 ('81000000-0000-4000-8000-000000000012',NULL,'81000000-0000-4000-8000-000000000003',NULL,'2020-01-01','2020-01-02'),
 ('81000000-0000-4000-8000-000000000013',NULL,'81000000-0000-4000-8000-000000000099','warning','2020-01-01','2020-01-02');
INSERT INTO public.partner_exports(id,company_id,customer_id,target_system,queued_at,created_at,updated_at) VALUES
 ('81000000-0000-4000-8000-000000000014',NULL,'81000000-0000-4000-8000-000000000002','fixture','2020-01-01','2020-01-01','2020-01-02'),
 ('81000000-0000-4000-8000-000000000015','81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','fixture','2020-01-01','2020-01-01','2020-01-02');
INSERT INTO public.outbound_requests(id,company_id,customer_id,request_type,queued_at,created_at,updated_at) VALUES
 ('81000000-0000-4000-8000-000000000016',NULL,'81000000-0000-4000-8000-000000000003','customer_masterdata','2020-01-01','2020-01-01','2020-01-02');
INSERT INTO public.metering_values(id,company_id,customer_id,metering_point_id,reading_type,read_at,period_start,period_end,is_current,canonical_dedupe_key,value_status,created_at,updated_at) VALUES
 ('81000000-0000-4000-8000-000000000021',NULL,'81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000090','consumption','2020-02-02T03:04:05.123400+00',NULL,'2020-02-03',true,NULL,NULL,'2020-01-01','2020-01-02'),
 ('81000000-0000-4000-8000-000000000022',NULL,'81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000090','consumption','2020-02-02T03:04:05.123400+00',NULL,'2020-02-03',false,NULL,'current','2020-01-01','2020-01-02'),
 ('81000000-0000-4000-8000-000000000023','81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000090','consumption','2020-02-02',NULL,NULL,true,'retained-key','current','2020-01-01','2020-01-02');'''


def native():
    support.require_owner();originals=r.replay.originals_snapshot()
    with r.legacy.OwnedPostgres() as h:
        with r.fixed.AcceptedInputs(h):
            r.dedupe.prepare_reference(h,'operations71');h.reset(r.fixed.CANARY)
            reader=support.private_reader(support.characterization(),h)
            reader.query(r.fixed.CANARY,"CREATE TABLE public.readiness_canary(value text); INSERT INTO public.readiness_canary VALUES('preserved');")
            batch.check(r.replay.serve_child(r.legacy,h,['bash',str(ROOT/'scripts/gridex-aud-003-clean-replay.sh'),'--operations-prefix-proof'],'operations71')==0)
            proof=Proof(h);proof.case('baseline',repeat=True);proof.case('two_tenant_backfills',seed_sql(),repeat=True)
            proof.case('key_collision',seed_sql()+"UPDATE public.metering_values SET is_current=true WHERE id='81000000-0000-4000-8000-000000000022';",error='23505')
            proof.case('blocked_backfill',seed_sql()+"UPDATE public.companies SET status='paused';",error='P0001')
            key_only="INSERT INTO public.metering_values(id,company_id,metering_point_id,read_at,created_at,updated_at) SELECT '84000000-0000-4000-8000-000000000001',id,'84000000-0000-4000-8000-000000000002','2020-01-01','2020-01-01','2020-01-02' FROM public.companies; UPDATE public.companies SET status='paused';"
            proof.case('blocked_key_only',key_only,repeat=True)
            proof.case('dirty_environment',"ALTER TABLE public.companies DROP CONSTRAINT companies_operating_environment_check; UPDATE public.companies SET operating_environment='fixture-invalid';",repeat=True)
            proof.case('null_environment',"UPDATE public.companies SET operating_environment=NULL;",repeat=True)
            proof.case('production_environment',"UPDATE public.companies SET operating_environment='production';",repeat=True)
            proof.case('invalid_route',"INSERT INTO public.communication_routes(id,route_name,route_scope,created_at,updated_at) VALUES('85000000-0000-4000-8000-000000000001','fixture','fixture-invalid','2020-01-01','2020-01-02');",error='23514')
            proof.case('invalid_request',"INSERT INTO public.outbound_requests(id,request_type,queued_at,created_at,updated_at) VALUES('85000000-0000-4000-8000-000000000002','fixture-invalid','2020-01-01','2020-01-01','2020-01-02');",error='23514')
            checks="ALTER TABLE public.communication_routes ADD CONSTRAINT readiness_first CHECK(route_scope<>'x'),ADD CONSTRAINT readiness_second CHECK(route_scope<>'y'),ADD CONSTRAINT readiness_keep CHECK(route_name<>''),ADD CONSTRAINT readiness_wildcard CHECK(route_name<>'routeXscope'); CREATE TABLE public.readiness_unrelated(route_scope text CHECK(route_scope<>'x'));"
            proof.case('matching_checks',checks,repeat=True)
            proof.case('same_name_nonmatching',"ALTER TABLE public.communication_routes ADD CONSTRAINT communication_routes_route_scope_check CHECK(route_name<>'');",error='42710')
            proof.case('optional_absent','ALTER TABLE public.ediel_messages RENAME TO readiness_hidden_messages;',repeat=True)
            proof.case('missing_read_column','ALTER TABLE public.metering_values RENAME COLUMN read_at TO readiness_hidden_read_at;',error='42703')
            proof.case('missing_route','ALTER TABLE public.communication_routes RENAME TO readiness_hidden_routes;',error='42P01')
            proof.case('missing_outbound','ALTER TABLE public.outbound_requests RENAME TO readiness_hidden_outbound;',error='42P01')
            for key in ('M','E','Z'):proof.case('fault_'+key,seed_sql(),fault=key)
        r.fixed.privacy(h);batch.check(r.replay.originals_snapshot()==originals,'READINESS_ORIGINALS_REQUIRED')
    print('PASS standalone readiness source characterization at actual71; NOT selected or actual74',flush=True)


def main():
    parser=argparse.ArgumentParser(allow_abbrev=False);mode=parser.add_mutually_exclusive_group()
    mode.add_argument('--selection-only',action='store_true');mode.add_argument('--cleanup-owned',action='store_true');args=parser.parse_args()
    if args.cleanup_owned:support.require_owner();r.legacy.cleanup_workflow_owned();return
    result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(Constructors))
    if not result.wasSuccessful():raise batch.BoundaryError('READINESS_CONSTRUCTORS_FAILED')
    if not args.selection_only:native()

if __name__=='__main__':
    try:main()
    except BaseException as error:
        if isinstance(error,SystemExit):raise
        label=str(error) if re.fullmatch(r'[A-Z][A-Z0-9_]{0,79}',str(error)) else type(error).__name__
        print('FAIL readiness source category='+label,file=sys.stderr);sys.exit(1)
