#!/usr/bin/env python3
"""Bounded lossless-continuation proof; local constructors make no SQL claim."""
import argparse
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import time
import sys
import tempfile
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def load():
    path = ROOT/'scripts/canonical-user-rbac-fixed-target-batch.py'
    assert path.is_file(), 'trusted continuation runtime is missing'
    spec = importlib.util.spec_from_file_location('continuation_test_loader',ROOT/'scripts/canonical-auth-provisioning-replay.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module.load_fixed()


def constructors():
    c = load()
    assert tuple(source.key for source in c.validate_sources(c.reviewed_paths())) == ('P','B0','C2','D2','F2','X')
    assert c.replay.SCOPES['fixed-target'] == 63
    assert c.replay.SCOPES['full'] == 112
    assert c.replay.scope_flags('fixed-target') == ['--fixed-target-prefix-proof']
    assert not any('selftest' in str(value) for value in c.__dict__.values() if isinstance(value,type(sys)))
    staging_controls(c)
    seed_controls(c)
    result_writer_controls(c)
    reference_controls(c)
    constructor_controls(c)
    cleanup_controls(c)
    company_cleanup_controls(c)
    cleanup_context_controls(c)
    lifecycle_controls(c)
    completed_continuation_controls(c)
    memory_controls(c)
    failure_receipt_controls(c)
    print('PASS continuation pins/reference/graph/PK/lifecycle/private-input constructors; no SQL executed')



def rejected(c, operation):
    try:
        operation()
    except c.BoundaryError:
        return
    raise AssertionError('UNSAFE_CONTINUATION_ACCEPTED')



def staging_controls(c):
    original=c.validate_sources(c.reviewed_paths())
    with tempfile.TemporaryDirectory(prefix='continuation-hold-') as directory:
        hold=Path(directory)
        for source in original:(hold/source.path.name).write_bytes(source.data)
        stage=c.legacy.StagedSources(hold)
        real_open=Path.open
        def retained_only(path,*args,**kwargs):
            if path.parent==ROOT/'supabase/migrations':raise AssertionError('CANONICAL_READ_DURING_HOLD')
            return real_open(path,*args,**kwargs)
        with patch.object(Path,'open',retained_only):
            sources=c.validate_sources(c.reviewed_paths(),stage)
            assert all(left.data==right.data for left,right in zip(sources,original))
            for source in sources[1:-1]:
                assert source.staging is stage and source.refresh()==source.data
        for source in sources:
            path=hold/source.path.name;raw=path.read_bytes()
            path.write_bytes(raw+b'\n')
            try:rejected(c,lambda:c.validate_sources(c.reviewed_paths(),stage))
            finally:path.write_bytes(raw)
        rejected(c,lambda:c.validate_sources(c.reviewed_paths()[::-1],stage))
        rejected(c,lambda:c.validate_sources(c.reviewed_paths(),type('ForeignStage',(),{'hold':hold})()))
        rejected(c,lambda:c.Source('B0',hold/original[1].path.name,stage))

def seed_fixture(c):
    source=c.Source('B0')
    row=dict(id='70000000-0000-4000-8000-000000000081',name=source.literal(226),
        slug=source.literal(209),company_slug=source.literal(209),org_number=None,
        normalized_org_number=None,status='active',is_active=True,is_paused=False,
        metadata={'source':'db1_default_company'},created_at='2020-01-01T00:00:00+00:00',
        updated_at='2020-01-01T00:00:00+00:00',created_by=None,updated_by=None,paused_at=None)
    catalog={'relation/public.companies':{'kind':'r'}}
    for name,value in row.items():
        catalog['column/public.companies/'+name]=dict(type='text',notnull=False,default=None,
            generated='',identity='',collation='-',acl=None)
    catalog['column/public.companies/id'].update(type='uuid',default='gen_random_uuid()')
    for name in ('created_at','updated_at'):
        catalog['column/public.companies/'+name].update(type='timestamp with time zone',default='now()')
    return catalog,row


def seed_controls(c):
    sources=c.validate_sources(c.reviewed_paths());catalog,row=seed_fixture(c)
    before=(catalog,[['public.companies',row]])
    template=c.seed_expectation(catalog,before[1],sources)
    actual=copy.deepcopy(row);actual['id']='70000000-0000-4000-8000-000000000082'
    actual['created_at']=actual['updated_at']='2021-01-01T00:00:00+00:00'
    lower=c.datetime(2020,12,31,tzinfo=c.timezone.utc);upper=c.datetime(2021,1,2,tzinfo=c.timezone.utc)
    assert c.bind_seed(template,actual,sources,lower,upper)==actual
    for name in actual:
        if name in ('id','created_at','updated_at'):continue
        changed=copy.deepcopy(actual);changed[name]='unreviewed'
        rejected(c,lambda:c.bind_seed(template,changed,sources,lower,upper))
    for name,value in (('id',sources[2].slots['C_target']),('id','invalid'),
                       ('created_at','1999-01-01T00:00:00+00:00'),('updated_at','2021-01-01T01:00:00+00:00')):
        changed=copy.deepcopy(actual);changed[name]=value
        rejected(c,lambda:c.bind_seed(template,changed,sources,lower,upper))
    rejected(c,lambda:c.seed_expectation(catalog,before[1]*2,sources))
    bad_catalog=copy.deepcopy(catalog);bad_catalog['column/public.companies/id']['default']='unreviewed()'
    rejected(c,lambda:c.seed_expectation(bad_catalog,before[1],sources))
    expected=c.prerequisite_state(before)
    assert expected[1]==[['public.companies',dict(row,industry='electricity_supplier')]]
    assert 'industry' not in row and before[0]==catalog
    reserved=c.company_reservation(expected,sources)
    assert reserved['before']==expected[1][0][1]
    assert reserved['after']==dict(reserved['before'],slug='fixed-prefix-reserved-'+row['id'])
    dirty=copy.deepcopy(expected);dirty[1][0][1]['org_number']=sources[1].literal(210,3)
    rejected(c,lambda:c.company_reservation(dirty,sources))
    # Exact B0 hyphen removal, not the broader generated digit normalization.
    probe=dict(row,slug='inert',org_number='x'+sources[1].literal(210,3))
    assert not c.company_matches(probe,sources[1])
    probe['org_number']=sources[1].literal(210,3)[:3]+'-'+sources[1].literal(210,3)[3:]
    assert c.company_matches(probe,sources[1])
    incoming={'constraint/public.roles/company':{'kind':'f','definition':'FOREIGN KEY (company_id) REFERENCES companies(id)'}}
    rejected(c,lambda:c.graph(incoming,[['public.companies',row],['public.roles',{'id':'role','company_id':row['id']}]]))
    # Exercise the actual H2 capture boundary; only external owner/snapshot I/O
    # is replaced. The independently frozen template must drive admission/S1.
    for dirty in (False,True):
        with synthetic_handle(c) as h:
            dref=c.dedupe._REFERENCES[h]
            c.dedupe._REFERENCES[h]=c.dedupe._Reference(dref.directory,dref.name,dref.legacy,dref.repair,catalog,catalog,[],True,'fixed-target')
            c._REFERENCES[h]=c.Reference(h.name,h.directory.name,c.dedupe._REFERENCES[h],
                c.encoded((c.prerequisite_catalog(catalog),[])),None,None,sources,template,lower)
            captured=copy.deepcopy(actual)
            if dirty:captured['metadata']={}
            state=(catalog,[['public.companies',captured]])
            with patch.object(c,'identity'),patch.object(c,'snapshot',return_value=state):
                if dirty:
                    try:c.capture_prefix(h)
                    except c.BoundaryError as error:
                        assert c.dedupe._failure_category(error)=='DETERMINISTIC_PREFIX_SEED_REQUIRED'
                    else:raise AssertionError('DIRTY_PREFIX_SEED_ACCEPTED')
                else:
                    c.capture_prefix(h)
                    assert c.decoded(c._RUNS[h].s0)==state
                    assert c.decoded(c._RUNS[h].s1)==c.prerequisite_state(state)
                    assert json.loads(c._RUNS[h].company)==c.company_reservation(c.prerequisite_state(state),sources)
                    rejected(c,lambda:c.capture_prefix(h))


def result_writer_controls(c):
    core=characterization();controls=core.load('continuation_result_controls','canonical-user-rbac-fixed-target-controls.py')
    _,row=seed_fixture(c);payload=json.dumps([['public.companies',row]]).encode()
    with controls.accepted_handle(core) as h,c.AcceptedInputs(h) as inputs:
        path=h.private('result-test.sql','SELECT synthetic_result;')
        for failure in (None,'sql_error','process_error','wrong_bytes','wrong_frame','phase','reference','staging'):
            output=io.StringIO();authorizations=[]
            def process(argv,**kwargs):
                authorizations.append(inputs.result_call)
                if failure=='process_error':raise OSError('PRIVATE_CANARY')
                if failure=='wrong_frame':h.private('client-last.out',payload)
                if failure=='phase':c.dedupe._STATES[h]='FRESH'
                if failure=='reference':h.reference=({},None)
                if failure=='staging':inputs.staging=object()
                return subprocess.CompletedProcess(argv,1 if failure=='sql_error' else 0,payload,b'ERROR:  XX000: synthetic' if failure=='sql_error' else b'')
            original=h.reference
            old_write=inputs._write
            def write(name,data,frame):
                return old_write(name,data+b'changed' if name=='client-last.out' else data,frame)
            with contextlib.ExitStack() as stack:
                stack.enter_context(contextlib.redirect_stdout(output))
                stack.enter_context(patch.object(subprocess,'run',side_effect=process))
                if failure=='wrong_bytes':stack.enter_context(patch.object(inputs,'_write',side_effect=write))
                if failure is None:
                    assert h.run_files(c.replay.DATABASE,[path],'dedupe_preimage')==payload.decode()
                else:rejected(c,lambda:h.run_files(c.replay.DATABASE,[path],'dedupe_preimage'))
            assert not (Path(h.directory.name)/'client-last.out').exists(),'RESULT_ARTIFACT_MUST_NOT_BE_WRITTEN'
            assert inputs.result_call is None and all(not call for call in authorizations)
            assert payload not in output.getvalue().encode()
            c.dedupe._STATES.pop(h,None);h.reference=original;inputs.staging=None
        rejected(c,lambda:h.private('client-last.out',payload))
    # Closing restores ordinary writer behavior; copied output is not exempt.
    with controls.accepted_writers(core) as proof:
        artifact=Path(proof.directory)/'client-last.out';artifact.write_bytes(payload)
        with patch.object(subprocess,'run',return_value=subprocess.CompletedProcess([],0,b'',b'')):
            rejected(c,lambda:core.private_inputs.privacy(core,proof))


def reference_controls(c):
    baseline={'relation/public.companies':{'kind':'r'},
              'column/public.companies/name':{'type':'text','notnull':True,'default':None,'generated':'','identity':'','collation':'"default"','acl':None}}
    expected=c.prerequisite_catalog(baseline)
    assert baseline=={'relation/public.companies':{'kind':'r'},'column/public.companies/name':expected['column/public.companies/name']}
    assert set(expected)-set(baseline)=={'column/public.companies/industry','column/public.company_memberships/suspended_at'}
    assert expected['column/public.companies/industry']['default']=="'electricity_supplier'::text"
    rejected(c,lambda:c.prerequisite_catalog(expected))
    c.graph(expected,[])
    for key,item in (
        ('trigger/public.companies/unknown',{'enabled':'O','definition':'BEFORE INSERT FOR EACH ROW'}),
        ('event_trigger/unknown',{'enabled':'O'}),
        ('column/public.companies/name',dict(expected['column/public.companies/name'],default="nextval('auth.refresh_tokens_id_seq'::regclass)")),
        ('column/public.companies/name',dict(expected['column/public.companies/name'],identity='a')),
        ('column/auth.users/encrypted_password',dict(expected['column/public.companies/name'],default="'unsafe'::text")),
        ('constraint/public.companies/unknown',{'kind':'f','definition':'FOREIGN KEY (id) REFERENCES outside.target(id)'}),
    ):
        changed=copy.deepcopy(expected);changed[key]=item
        rejected(c,lambda:c.graph(changed,[]))
    incoming=dict(expected,**{'constraint/public.child/parent':{'kind':'f','definition':'FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE'}})
    c.graph(incoming,[])
    rejected(c,lambda:c.graph(incoming,[['public.child',{'id':'opaque'}]]))
    for definition in ('AFTER DELETE FOR EACH STATEMENT','AFTER DELETE FOR EACH ROW','AFTER UPDATE FOR EACH STATEMENT'):
        changed=dict(incoming,**{'trigger/public.child/hook':{'enabled':'O','definition':definition}})
        rejected(c,lambda:c.graph(changed,[]))
    c.graph(dict(incoming,**{'trigger/public.child/hook':{'enabled':'O','definition':'BEFORE INSERT OR UPDATE FOR EACH ROW'}}),[])



def constructor_controls(c):
    catalog={}
    def column(table,name,default=None,required=False,kind='text',generated=''):
        catalog['relation/'+table]={'kind':'r'}
        catalog['column/'+table+'/'+name]=dict(type=kind,notnull=required,default=default,generated=generated,identity='',collation='-',acl=None)
    for name in ('id','email','encrypted_password','confirmation_token','recovery_token','email_confirmed_at',
                 'phone_confirmed_at','last_sign_in_at','raw_app_meta_data','raw_user_meta_data'):
        column('auth.users',name,required=name=='id')
    column('auth.users','is_anonymous','false',True,'boolean')
    column('auth.users','confirmed_at','LEAST(email_confirmed_at, phone_confirmed_at)',generated='s')
    for name in ('id','name','slug','status','created_by','updated_by','org_number'):
        column('public.companies',name,required=name in ('id','name','status'))
    column('public.companies','normalized_org_number','gridex_normalize_org_number(org_number)',generated='s')
    column('public.companies','created_at','now()',True,'timestamp with time zone')
    column('public.companies','industry',"'electricity_supplier'::text",True)
    sources=c.validate_sources(c.reviewed_paths())
    seed={key.split('/')[-1]:None for key in catalog if key.startswith('column/public.companies/')}
    seed.update(id='70000000-0000-4000-8000-000000000081',name=sources[1].literal(226),
                slug=sources[1].literal(209),status='active',created_at='2019-01-01T00:00:00+00:00',industry='electricity_supplier')
    before=(catalog,[['public.companies',seed]])
    sql,oracle=c.constructor(before,sources)
    assert sql.count('INSERT INTO ')==4 and sql.count('UPDATE public.companies')==1
    assert 'DELETE FROM' not in sql and 'SET id=' not in sql and 'to_jsonb(t)=' in sql
    assert {table:len(rows) for table,rows in oracle.rows.items()}=={'public.companies':2,'auth.users':3}
    assert oracle.rows['public.companies'][0]==dict(seed,slug='fixed-prefix-reserved-'+seed['id'])
    users=oracle.rows['auth.users'];company=oracle.rows['public.companies'][1]
    assert {row['id'] for row in users}=={sources[1].slots['U_boot'],sources[2].slots['U_target'],sources[2].slots['U_actor']}
    assert sources[4].slots['U_old'] not in {row['id'] for row in users}
    assert company['id']==sources[2].slots['C_target'] and company['slug']==sources[1].literal(209)
    assert company['created_by'] is None and company['updated_by'] is None
    assert all(row['encrypted_password'] is None and row['raw_app_meta_data'] is None and row['raw_user_meta_data'] is None for row in users)
    dirty=copy.deepcopy(catalog);dirty['column/auth.users/encrypted_password']['default']="'unsafe'::text"
    rejected(c,lambda:c.constructor((dirty,before[1]),sources))

def cleanup_controls(c):
    def uid(n):return '60000000-0000-4000-8000-'+str(n).zfill(12)
    catalog={
        'constraint/public.company_memberships/company':{'kind':'f','definition':'FOREIGN KEY (company_id) REFERENCES companies(id)'},
        'constraint/public.user_profiles/company':{'kind':'f','definition':'FOREIGN KEY (active_company_id) REFERENCES companies(id) ON DELETE SET NULL'},
        'constraint/public.user_profiles/user':{'kind':'f','definition':'FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE'},
        'constraint/public.role_permissions/role':{'kind':'f','definition':'FOREIGN KEY (role_id) REFERENCES roles(id)'},
    }
    original=(catalog,[['public.roles',{'id':uid(1),'key':'kept','description':'original'}],
                      ['public.role_permissions',{'id':uid(2),'role_id':uid(1),'effect':'allow'}],
                      ['auth.refresh_tokens_id_seq',{'last_value':41,'log_cnt':17,'is_called':True}]])
    after=copy.deepcopy(original);after[1][0][1]['description']='changed'
    after[1].extend([['auth.users',{'id':uid(3)}],['public.companies',{'id':uid(4)}],
                ['public.user_profiles',{'id':uid(3),'active_company_id':uid(4)}],
                ['public.company_memberships',{'id':uid(5),'company_id':uid(4)}],
                ['public.roles',{'id':uid(6),'key':'new','description':'new'}],
                ['public.role_permissions',{'id':uid(7),'role_id':uid(6),'effect':'allow'}]])
    deletions,restores=c.cleanup_plan(original,after)
    keys=[(x['table'],x['row']['id']) for x in deletions]
    assert len(keys)==6 and len(set(keys))==6
    assert keys.index(('public.user_profiles',uid(3)))<keys.index(('auth.users',uid(3)))
    assert keys.index(('public.user_profiles',uid(3)))<keys.index(('public.companies',uid(4)))
    assert keys.index(('public.role_permissions',uid(7)))<keys.index(('public.roles',uid(6)))
    assert restores==[dict(table='public.roles',before=original[1][0][1],after=after[1][0][1])]
    assert original[1][0][1]['description']=='original'
    missing=copy.deepcopy(after);missing[1][0][1]['id']=uid(9)
    rejected(c,lambda:c.cleanup_plan(original,missing))
    duplicate=copy.deepcopy(after);duplicate[1].append(copy.deepcopy(after[1][-1]))
    rejected(c,lambda:c.cleanup_plan(original,duplicate))
    # Full oracle equality rejects sequence log_cnt drift, independently of the
    # cleanup PK planner, which never resets a sequence.
    mismatch=copy.deepcopy(original);mismatch[1][2][1]['log_cnt']=18
    rejected(c,lambda:c.Oracle(c,original).assert_snapshot(mismatch))


def company_cleanup_controls(c):
    sources=c.validate_sources(c.reviewed_paths());catalog,row=seed_fixture(c)
    before=c.prerequisite_state((catalog,[['public.companies',row]]))
    company=c.company_reservation(before,sources)
    post=(before[0],[['public.companies',company['after']],
                    ['public.companies',dict(company['after'],id=sources[2].slots['C_target'],slug=sources[1].literal(209))]])
    deletions,restores=c.cleanup_plan(before,post,company)
    assert [item['row']['id'] for item in deletions]==[sources[2].slots['C_target']]
    assert restores==[company] and company['before']['id']==company['after']['id']
    for change in ('id','slug','missing','foreign_reservation'):
        changed=copy.deepcopy(post);binding=copy.deepcopy(company)
        if change=='id':changed[1][0][1]['id']='70000000-0000-4000-8000-000000000099'
        if change=='slug':changed[1][0][1]['slug']='unexpected'
        if change=='missing':changed[1].pop(0)
        if change=='foreign_reservation':binding['before']['id']=binding['after']['id']='70000000-0000-4000-8000-000000000099'
        rejected(c,lambda:c.cleanup_plan(before,changed,binding))
    rejected(c,lambda:c.cleanup_plan(before,post))


def cleanup_context_controls(c):
    with synthetic_handle(c) as h:
        check={'kind':'c','definition':'CHECK (true)','validated':True,'deferrable':False,'deferred':False,'noinherit':False}
        catalog,row=seed_fixture(c);catalog[c.CHECK_KEY]=check
        before=c.prerequisite_state((catalog,[['public.companies',row]]))
        sources=c.validate_sources(c.reviewed_paths());company=c.company_reservation(before,sources)
        post=(before[0],[['public.companies',company['after']]])
        c._RUNS[h]=c.Reservation(None,c.encoded(before),c.encoded(before),'a'*32,c.encoded(company))
        payload=c.cleanup_input(h,sources,post)
        assert b'company jsonb NOT NULL' in payload and c.value_sql(json.loads(c.encoded(company))).encode() in payload
        assert b'CREATE TEMP TABLE fixed_restoration_reservation' in payload,'INDEPENDENT_CLEANUP_RESERVATION_MISSING'
        assert payload.endswith(sources[-1].data)
        for source in sources:assert c.hashlib.sha256(source.data).hexdigest().encode() in payload


@contextlib.contextmanager
def synthetic_handle(c,continuation=True,state='H2_COMPLETE'):
    with tempfile.TemporaryDirectory(prefix='continuation-constructor-') as directory:
        h=c.legacy.OwnedPostgres();h.active=True
        h.name=h._created_name='gridex-auth-legacy-continuation-12345678-1'
        h.directory=type('Directory',(),{'name':directory})()
        h.reference=({},{});repair_ref=c.repair.Reference(directory,{},{})
        c.repair.REFERENCES[h]=repair_ref
        c.dedupe._REFERENCES[h]=c.dedupe._Reference(directory,h.name,h.reference,repair_ref,{},{},[],continuation,
                                                   'fixed-target' if continuation else 'dedupe57')
        c.dedupe._STATES[h]=state
        try:yield h
        finally:
            h.active=False
            for mapping in (c.repair.REFERENCES,c.dedupe._REFERENCES,c.dedupe._STATES,c._REFERENCES,c._RUNS,c._RELEASES):mapping.pop(h,None)


def lifecycle_controls(c):
    for mode in ('historical','wrong_stage','missing_fixed_reference','wrong_database','wrong_staging'):
        with synthetic_handle(c,mode!='historical', 'FRESH' if mode=='wrong_stage' else 'H2_COMPLETE') as h:
            calls=[]
            with patch.object(c.dedupe,'_dispose',side_effect=lambda target:calls.append(target)),patch.object(c,'privacy'):
                rejected(c,lambda:c.dedupe.continue_fixed(h,'foreign' if mode=='wrong_database' else c.replay.DATABASE,c.reviewed_paths(),object()))
            assert calls==[h] and c.dedupe._STATES[h]=='DISPOSED'
            rejected(c,lambda:c.dedupe.continue_fixed(h,c.replay.DATABASE,c.reviewed_paths(),object()))
            rejected(c,lambda:c.dedupe.fresh_target(h))
    for state in ('H2_COMPLETE','FIXED_NATIVE','FIXED_COMPLETE'):
        with synthetic_handle(c,True,state) as h:
            calls=[]
            with patch.object(c.dedupe,'_dispose',side_effect=lambda target:calls.append(target)),patch.object(c,'privacy'):
                rejected(c,lambda:c.dedupe.finish(h))
            assert calls==[h] and c.dedupe._STATES[h]=='DISPOSED'
    with synthetic_handle(c,False) as h:
        with patch.object(c.dedupe,'assert_final'):
            c.dedupe.finish(h)
        assert c.dedupe._STATES[h]=='SUCCEEDED'
        with patch.object(c.dedupe,'_dispose') as dispose:
            rejected(c,lambda:c.dedupe.fail(h))
            assert not dispose.called and c.dedupe._STATES[h]=='SUCCEEDED'
        rejected(c,lambda:c.dedupe.fresh_target(h))


def assert_completed_continuation(c,h,original_continue,staging):
    assert c.dedupe._STATES[h]=='SUCCEEDED','COMPLETED_CONTINUATION_REQUIRED'
    try:
        original_continue(h,c.replay.DATABASE,c.reviewed_paths(),staging)
    except c.BoundaryError as error:
        assert str(error)=='UNPUBLISHED_REPLAY_REQUIRED','SUCCEEDED_CONTINUATION_DENIAL_REQUIRED'
    else:
        raise AssertionError('SUCCEEDED_CONTINUATION_ACCEPTED')
    assert c.dedupe._STATES[h]=='SUCCEEDED','SUCCEEDED_HANDLE_CHANGED'


def completed_continuation_controls(c):
    # Same live observation patch as native_case, after all six submissions.
    # The proof must reach the real runtime's succeeded-handle denial.
    with synthetic_handle(c,True,'SUCCEEDED') as h:
        original=c.dedupe.continue_fixed
        submitted=['P','B0','C2','D2','F2','X']
        def observer(*args):
            assert not submitted and c.dedupe._STATES[h]=='H2_COMPLETE','COMPLETED_OBSERVER_REENTERED'
            return original(*args)
        with patch.object(c.dedupe,'continue_fixed',observer):
            assert_completed_continuation(c,h,original,object())
        assert submitted==['P','B0','C2','D2','F2','X'] and c.dedupe._STATES[h]=='SUCCEEDED'
        try:assert_completed_continuation(c,h,lambda *args:None,object())
        except AssertionError as error:assert str(error)=='SUCCEEDED_CONTINUATION_ACCEPTED'
        else:raise AssertionError('SUCCEEDED_DENIAL_CHECK_MISSING')


def failure_receipt_controls(c):
    """A terminal privacy failure must retain safe causes, never private text."""
    core=characterization()
    controls=core.load('continuation_failure_controls','canonical-user-rbac-fixed-target-controls.py')
    # Real accepted writers and scanner; only the external collector/disposal
    # commands are replaced. This is the hosted H2 -> capture -> fail order.
    with contextlib.redirect_stdout(io.StringIO()),controls.accepted_writers(core) as proof:
        h=proof.h
        sources=c.validate_sources(c.reviewed_paths())
        c._REFERENCES[h]=c.Reference(h.name,h.directory.name,c.dedupe._REFERENCES[h],b'',None,proof.accepted_inputs,sources)
        c.dedupe._REFERENCES[h]=c.dedupe._Reference(h.directory.name,h.name,h.reference,c.repair.REFERENCES[h],{},{},[],True,'fixed-target')
        c.dedupe._STATES[h]='H2_COMPLETE'
        private=next(iter(sources[1].slots.values())).encode()
        artifact=Path(h.directory.name)/'client-last.out'
        artifact.write_bytes(private)
        output=io.StringIO();states=[]
        with patch.object(c.subprocess,'run',return_value=subprocess.CompletedProcess([],0,b'',b'')),patch.object(c.dedupe,'_dispose',side_effect=lambda target:states.append(c.dedupe._STATES[target])),contextlib.redirect_stdout(output):
            try:
                c.check(False,'DEFAULT_ORACLE_REVIEW_REQUIRED')
            except c.BoundaryError:
                try:c.dedupe.fail(h)
                except c.BoundaryError as error:
                    assert str(error)=='FIXED_FAILURE_PRIVACY_REJECTED'
                else:raise AssertionError('PRIVACY_FAILURE_SWALLOWED')
        assert states==['TERMINAL'] and c.dedupe._STATES[h]=='DISPOSED'
        assert private not in output.getvalue().encode() and str(artifact) not in output.getvalue()
        assert output.getvalue().strip(),'SAFE_FAILURE_CAUSES_MISSING'
        assert json.loads(output.getvalue())=={'stage':'fixed_failure','state':'H2_COMPLETE',
            'cause':'DEFAULT_ORACLE_REVIEW_REQUIRED','privacy':'SOURCE_LITERAL_IN_PRIVATE_ARTIFACT','disposal':'VERIFIED'}
        c._REFERENCES.pop(h)
    # Arbitrary uppercase messages are still private, not valid category labels.
    secret='PRIVATE_SYNTHETIC_CANARY'
    for privacy_failure,disposal_failure in ((False,False),(True,False),(True,True)):
        with synthetic_handle(c,True,'H2_COMPLETE') as h:
            output=io.StringIO();states=[]
            def dispose(target):
                states.append(c.dedupe._STATES[target])
                if disposal_failure:raise ValueError(secret)
            with patch.object(c,'privacy',side_effect=c.BoundaryError(secret) if privacy_failure else None),patch.object(c.dedupe,'_dispose',side_effect=dispose),contextlib.redirect_stdout(output):
                try:raise c.BoundaryError(secret)
                except c.BoundaryError:
                    if privacy_failure:
                        rejected(c,lambda:c.dedupe.fail(h))
                    else:c.dedupe.fail(h)
            assert states==['TERMINAL']
            assert c.dedupe._STATES[h]==('TERMINAL' if disposal_failure else 'DISPOSED')
            assert secret not in output.getvalue()
            assert json.loads(output.getvalue())=={'stage':'fixed_failure','state':'H2_COMPLETE',
                'cause':'UNCLASSIFIED','privacy':'UNCLASSIFIED' if privacy_failure else 'VERIFIED',
                'disposal':'FAILED' if disposal_failure else 'VERIFIED'}


def memory_controls(c):
    class Process:
        def __init__(self,ready):
            self.stdin=io.BytesIO();self.stdout=io.BytesIO(ready);self.returncode=None;self.inputs=[]
        def communicate(self,data=None,timeout=None):
            self.inputs.append(data);self.returncode=0;return b'private output',b''
        def poll(self):return self.returncode
        def kill(self):self.returncode=-9
    with synthetic_handle(c,True,'FIXED_NATIVE') as h:
        for ready in (b'FIXED_PRIVATE_READY\n',b'unsafe\n'):
            p=Process(ready)
            with patch.object(c,'owned'),patch.object(h,'verify_logging'),patch.object(c.subprocess,'Popen',return_value=p) as process,patch.object(c.select,'select',return_value=([p.stdout],[],[])):
                if ready.startswith(b'FIXED_'):
                    result=c.run_private(h,b'SYNTHETIC_PRIVATE_INPUT',False)
                    assert result.code==0 and p.inputs==[b'SYNTHETIC_PRIVATE_INPUT']
                else:
                    rejected(c,lambda:c.run_private(h,b'SYNTHETIC_PRIVATE_INPUT',False))
                    assert all(value is None for value in p.inputs)
                assert process.call_args.args[0][-2:]==['-f','-']
                assert not any(key.startswith('PG') for key in process.call_args.kwargs['env'])
                assert not list(Path(h.directory.name).iterdir())


def characterization():
    # Tests reuse the accepted memory reader only. Runtime never imports this.
    spec=importlib.util.spec_from_file_location('continuation_memory_reader',ROOT/'scripts/canonical-user-rbac-fixed-target-selftest.py')
    module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
    return module


def private_reader(core,h):
    reader=core.Proof.__new__(core.Proof);reader.h=h
    def owned(database):
        core.repair.require_owned(h,False);core.legacy.validate_database(database)
    reader.owned=owned
    return reader


def native_case(mode,actual=False,prior=None):
    c=load();core=characterization();require_owner()
    originals=c.replay.originals_snapshot()
    sources=c.validate_sources(c.reviewed_paths())
    submitted=[];observed=[];disposed=[]
    with c.legacy.OwnedPostgres() as h:
        with c.AcceptedInputs(h) as inputs:
            c.dedupe.prepare_reference(h,'fixed-target')
            reader=private_reader(core,h)
            h.reset(core.CANARY)
            reader.query(core.CANARY,"CREATE TABLE public.continuation_canary(id integer PRIMARY KEY,value text); INSERT INTO public.continuation_canary VALUES(1,'preserved');")
            canary=reader.snapshot(core.CANARY)
            original_run=c.run_private
            original_continue=c.dedupe.continue_fixed
            original_cleanup=c.cleanup_input
            original_dispose=c.dedupe._dispose
            def execute(target,sql,transaction=True):
                raw=sql.encode() if isinstance(sql,str) else sql
                key=next((source.key for source in sources if raw==source.data or (source.key=='X' and raw.endswith(source.data))),None)
                if key:
                    submitted.append(key)
                    assert submitted==['P','B0','C2','D2','F2','X'][:len(submitted)]
                    if mode==key+'_error':raw+=b'\nSELECT 1/0;\n'
                    if mode==key+'_backend':raw+=b'\nSELECT pg_terminate_backend(pg_backend_pid());\n'
                result=original_run(target,raw,transaction)
                if key in ('D2','F2') and mode in (key+'_error',key+'_backend'):
                    state=reader.snapshot(c.replay.DATABASE)
                    assert sum(table=='public.company_memberships' for table,_ in state[1])==2
                    observed.append('COMMITTED_'+key)
                if key=='X' and result.code==0:
                    if mode=='catalog':reader.query(c.replay.DATABASE,'ALTER TABLE public.companies ADD COLUMN continuation_unexpected text;')
                    if mode=='sequence':reader.query(c.replay.DATABASE,"SELECT nextval('auth.refresh_tokens_id_seq');")
                if key and mode=='death_'+key:
                    assert result.code==0
                    state=reader.snapshot(c.replay.DATABASE)
                    if key=='X':assert state==c.decoded(c._RUNS[h].s1)
                    else:assert sum(table=='public.company_memberships' for table,_ in state[1])==2
                    # No child success/release receipt can be emitted after this.
                    c.privacy(h)
                    print(json.dumps({'death_ready':key,'directory':h.directory.name,'privacy':True}),flush=True)
                    os.kill(os.getpid(),signal.SIGKILL)
                return result
            def continuation(target,database,paths,staging):
                assert not submitted and c.dedupe._STATES[h]=='H2_COMPLETE'
                if mode=='dirty_rows':
                    reader.query(database,"INSERT INTO public.companies(id,name) VALUES('70000000-0000-4000-8000-000000000001','synthetic dirty');")
                if mode=='dirty_company':reader.query(database,"UPDATE public.companies SET metadata='{}'::jsonb;")
                if mode=='dirty_seed':
                    row=next(row for table,row in c.decoded(c._RUNS[h].s0)[1] if table=='public.roles')
                    reader.query(database,"UPDATE public.roles SET description='synthetic dirty' WHERE id="+c.value_sql(row['id'])+';')
                if mode=='dirty_default':
                    reader.query(database,"ALTER TABLE public.companies ALTER COLUMN name SET DEFAULT 'unreviewed';")
                if mode=='incoming_hook':
                    reader.query(database,"CREATE TABLE public.continuation_child(id uuid PRIMARY KEY,company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE); CREATE FUNCTION public.continuation_hook() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$; CREATE TRIGGER continuation_hook AFTER DELETE ON public.continuation_child FOR EACH STATEMENT EXECUTE FUNCTION public.continuation_hook();")
                if mode=='owner':reader.query(database,'ALTER DATABASE gridex_auth_legacy_replay OWNER TO service_role;')
                if mode=='hash':
                    path=staging.hold/sources[1].path.name;stat=path.stat();parent=path.parent.stat();data=path.read_bytes()
                    try:
                        path.write_bytes(data+b'\n')
                        return original_continue(target,database,paths,staging)
                    finally:
                        path.write_bytes(data);os.chmod(path,stat.st_mode)
                        os.utime(path,ns=(stat.st_atime_ns,stat.st_mtime_ns))
                        os.utime(path.parent,ns=(parent.st_atime_ns,parent.st_mtime_ns))
                if mode=='stage':return original_continue(target,database,paths,object())
                return original_continue(target,database,paths,staging)
            def cleanup(target,selected,post):
                raw=original_cleanup(target,selected,post)
                injection=''
                if mode=='missing_capture':
                    row=next(row for table,row in post[1] if table=='public.audit_logs')
                    injection='DELETE FROM public.audit_logs WHERE id='+c.value_sql(row['id'])+';'
                if mode=='seed_id':
                    assert c.cleanup_plan(c.decoded(c._RUNS[h].s1),post,json.loads(c._RUNS[h].company))[1]
                    injection="UPDATE fixed_restoration_context SET value=jsonb_set(value,ARRAY['restorations',(SELECT (ordinality-1)::text FROM jsonb_array_elements(value->'restorations') WITH ORDINALITY r(item,ordinality) WHERE item->>'table'='public.roles' LIMIT 1),'before','id'],to_jsonb('70000000-0000-4000-8000-000000000099'::text));"
                if mode=='envelope_hash':
                    injection="UPDATE fixed_restoration_context SET value=jsonb_set(value,'{hashes,0}',to_jsonb(repeat('0',64)));"
                if mode=='company_id':
                    injection="UPDATE fixed_restoration_context SET value=jsonb_set(value,'{company,before,id}',to_jsonb('70000000-0000-4000-8000-000000000099'::text));"
                if mode=='company_postimage':
                    injection="UPDATE fixed_restoration_context SET value=jsonb_set(value,'{company,after,slug}',to_jsonb('unreserved'::text));"
                if mode=='company_skip':
                    injection="UPDATE fixed_restoration_context SET value=jsonb_set(value,'{restorations}',(SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM jsonb_array_elements(value->'restorations') x WHERE x->>'table'<>'public.companies'));"
                if mode=='skip_restore':
                    assert c.cleanup_plan(c.decoded(c._RUNS[h].s1),post,json.loads(c._RUNS[h].company))[1]
                    injection="UPDATE fixed_restoration_context SET value=jsonb_set(value,'{restorations}','[]'::jsonb);"
                return raw[:-len(selected[-1].data)]+injection.encode()+b'\n'+selected[-1].data
            def dispose(target):
                assert target is h
                original_dispose(target)
                disposed.append(target)
                assert not reader.query(core.CANARY,"SELECT datname FROM pg_database WHERE datname='gridex_auth_legacy_replay';").strip()
                assert reader.snapshot(core.CANARY)==canary
            with contextlib.ExitStack() as stack:
                stack.enter_context(patch.object(c,'run_private',execute))
                stack.enter_context(patch.object(c.dedupe,'continue_fixed',continuation))
                stack.enter_context(patch.object(c,'cleanup_input',cleanup))
                stack.enter_context(patch.object(c.dedupe,'_dispose',dispose))
                def operation():
                    if actual:
                        command=['bash',str(ROOT/'scripts/gridex-aud-003-clean-replay.sh'),'--fixed-target-prefix-proof']
                        if mode=='child_exit':
                            command=['bash','-c','bash "$1" --fixed-target-prefix-proof; exit 73','continuation',str(ROOT/'scripts/gridex-aud-003-clean-replay.sh')]
                        return c.replay.serve_child(c.legacy,h,command,'fixed-target')
                    # Standalone uses the actual validated source staging and the
                    # same prefix writer. Its final handle stays unpublished.
                    with tempfile.TemporaryDirectory(prefix='continuation-stage-') as directory:
                        hold=Path(directory)
                        for source in (ROOT/'supabase/migrations').iterdir():
                            if source.is_file():shutil.copy2(source,hold/source.name)
                        c.dedupe.fresh_target(h)
                        loop=c.replay.FoundationLoop(c.legacy,h,'fixed-target')
                        paths=[str(hold/Path(p).name if p.startswith('migrations/') else ROOT/'supabase'/p) for p in loop.order]
                        loop.validate(hold,paths)
                        boot=reader.run(c.replay.DATABASE,(ROOT/'scripts/sql/gridex-supabase-compatible-bootstrap.sql').read_text(),False)
                        assert boot.code==0 and boot.state=='00000'
                        loop.run(hold,paths)
                    return 0
                if mode in ('success','repeat','standalone'):
                    assert operation()==0
                    assert submitted==['P','B0','C2','D2','F2','X']
                    final=reader.snapshot(c.replay.DATABASE)
                    assert final==c.decoded(c._RUNS[h].s1)
                    assert [row for table,row in final[1] if table=='public.companies']==[json.loads(c._RUNS[h].company)['before']]
                    if actual:
                        assert_completed_continuation(c,h,original_continue,inputs.closed_staging)
                    else:
                        assert c.dedupe._STATES[h]=='FIXED_COMPLETE'
                        # Direct finish is not a successful child. It terminally
                        # disposes the verified standalone graph without release.
                        rejected(c,lambda:c.dedupe.finish(h))
                        assert c.dedupe._STATES[h]=='DISPOSED'
                else:
                    rejected(c,operation)
                    assert c.dedupe._STATES[h]=='DISPOSED' and disposed==[h]
                    if mode in ('dirty_rows','dirty_company','dirty_seed','dirty_default','incoming_hook','owner','hash','stage'):
                        assert not submitted
                    if mode in ('missing_capture','seed_id','skip_restore','envelope_hash','company_id','company_postimage','company_skip','X_error','catalog','sequence'):
                        assert submitted==['P','B0','C2','D2','F2','X'],'ACTUAL_X_FAILURE_REQUIRED'
                    if mode in ('D2_error','D2_backend','F2_error','F2_backend'):
                        assert observed==['COMMITTED_'+mode[:2]]
                    rejected(c,lambda:c.dedupe.fresh_target(h))
                assert reader.snapshot(core.CANARY)==canary
                if prior is not None:
                    rejected(c,lambda:c.dedupe.fresh_target(prior))
                    rejected(c,lambda:c.dedupe.fail(prior))
                    assert reader.snapshot(core.CANARY)==canary
        # Same closed-input/collector privacy gate on success and every failure.
        c.privacy(h)
        assert c.replay.originals_snapshot()==originals
    print('PASS continuation mode='+mode+'; exact source count/state/disposal/canary/privacy',flush=True)
    return h


def controller_deaths():
    c=load();originals=c.replay.originals_snapshot()
    for key in ('D2','F2','X'):
        child=subprocess.run([sys.executable,str(Path(__file__).resolve()),'--death-worker',key],
                             capture_output=True,timeout=300,env=c.legacy.clean_environment())
        assert child.returncode==-signal.SIGKILL,'CONTROLLER_DEATH_REQUIRED'
        markers=[]
        for line in child.stdout.decode().splitlines():
            try:value=json.loads(line)
            except ValueError:continue
            if value.get('death_ready')==key:markers.append(value)
        assert len(markers)==1 and markers[0].get('privacy') is True and b'PASS continuation mode=' not in child.stdout
        name=os.environ['GRIDEX_LEGACY_CONTAINER_NAME']
        directory=Path(markers[0]['directory'])
        assert directory.name.startswith('gridex-auth-legacy-') and directory.is_dir() and not directory.is_symlink()
        def command(args):
            result=subprocess.run(['docker',*args],capture_output=True,timeout=30,env=c.legacy.clean_environment())
            assert result.returncode==0,'DEATH_OBSERVATION_FAILED'
            return result.stdout.decode().strip()
        try:
            assert command(['inspect','--format','{{ index .Config.Labels "gridex.auth-legacy.owner" }}',name])==name
            members=command(['exec',name,'psql','-X','-U','postgres','-d',c.replay.DATABASE,'-qAt','-c','SELECT count(*) FROM public.company_memberships;'])
            assert members==('0' if key=='X' else '2')
            assert command(['exec',name,'psql','-X','-U','postgres','-d','gridex_auth_legacy_seeded','-qAt','-c','SELECT value FROM public.continuation_canary;'])=='preserved'
            # The orphaned real shell must complete its original/HOLD trap.
            deadline=time.monotonic()+15
            while c.replay.originals_snapshot()!=originals and time.monotonic()<deadline:time.sleep(.1)
            assert c.replay.originals_snapshot()==originals,'DEAD_CONTROLLER_HOLD_RESTORATION_REQUIRED'
            c.legacy.cleanup_workflow_owned()
            result=subprocess.run(['docker','ps','-aq','--filter','name=^/'+name+'$'],capture_output=True,timeout=30,env=c.legacy.clean_environment())
            assert result.returncode==0 and not result.stdout.strip()
        finally:
            c.legacy.cleanup_workflow_owned()
            shutil.rmtree(directory)
        print('PASS continuation controller death after '+key+' COMMIT; exact outer cleanup/canary',flush=True)


def native():
    require_owner()
    native_case('standalone')
    first=native_case('success',actual=True)
    native_case('repeat',actual=True,prior=first)
    # Each rejected handle is disposed; no fixture re-arms a prior lifecycle.
    for mode in ('dirty_rows','dirty_company','dirty_seed','dirty_default','incoming_hook','owner','hash','stage',
                 'D2_error','D2_backend','F2_error','F2_backend','missing_capture','seed_id',
                 'skip_restore','envelope_hash','company_id','company_postimage','company_skip','X_error','catalog','sequence'):
        native_case(mode)
    native_case('child_exit',actual=True)
    controller_deaths()
    native_case('repeat',actual=True)
    print('PASS lossless fixed-target continuation; standalone/actual/fresh repeat/death/privacy',flush=True)

def main():
    parser = argparse.ArgumentParser(allow_abbrev=False)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--selection-only',action='store_true')
    modes.add_argument('--cleanup-owned',action='store_true')
    modes.add_argument('--death-worker',choices=('D2','F2','X'))
    args = parser.parse_args()
    if args.death_worker:
        require_owner(); native_case('death_'+args.death_worker,actual=True); return
    if args.cleanup_owned:
        c = load(); require_owner(); c.legacy.cleanup_workflow_owned(); return
    constructors()
    if not args.selection_only:
        native()


def require_owner():
    assert re.fullmatch(r'gridex-auth-legacy-continuation-[0-9]+-[0-9]+',os.environ.get('GRIDEX_LEGACY_CONTAINER_NAME','')), 'EXACT_CONTINUATION_OWNER_REQUIRED'


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        if isinstance(error,SystemExit): raise
        label = str(error) if re.fullmatch(r'[A-Z][A-Z0-9_]{0,79}',str(error)) else type(error).__name__
        print('FAIL continuation category='+label,file=sys.stderr)
        sys.exit(1)
