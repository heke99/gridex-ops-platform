"""Bounded constructor controls; mocked transport makes no SQL claim."""
import contextlib
import copy
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
from datetime import datetime, timedelta, timezone
from unittest.mock import patch


def constructors(c,models,cases):
    with tempfile.TemporaryDirectory(prefix='fixed-constructor-') as directory:
        h = c.legacy.OwnedPostgres()
        h.directory = type('PrivateDirectory',(),{'name':directory})()
        h.active = True
        h.reference = ({},{})
        ref = c.repair.Reference(directory,{},{})
        c.repair.REFERENCES[h] = ref
        dedupe_ref = c.dedupe._Reference(directory,h.name,h.reference,ref,{},{},[])
        c.dedupe._REFERENCES[h] = dedupe_ref
        c.dedupe._STATES[h] = 'SUCCEEDED'
        p = c.Proof.__new__(c.Proof)
        p.h,p.name,p.directory,p.references = h,h.name,directory,(h.reference,ref,dedupe_ref)
        p.reservations = {}
        p.owned(c.replay.DATABASE)
        for database in ('postgres','external_db','postgresql://external/fixture','/tmp/socket',55440):
            c.rejected(lambda:p.owned(database))
        for attribute,bad in (('name','wrong'),('_created_name','wrong'),('active',False),('reference',({},{}))):
            with patch.object(h,attribute,bad):
                c.rejected(lambda:p.owned(c.replay.DATABASE))
        for state in ('FRESH','TERMINAL','DISPOSED'):
            with patch.dict(c.dedupe._STATES,{h:state}):
                c.rejected(lambda:p.owned(c.replay.DATABASE))
        with patch.dict(c.repair.REFERENCES,{h:c.repair.Reference(directory,{},{})}):
            c.rejected(lambda:p.owned(c.replay.DATABASE))
        h.active = False  # A constructor only; there is no owned SQL process.
    for owner in ('','gridex-auth-legacy-other-12345678','postgresql://remote/example'):
        with patch.dict(os.environ,{'GRIDEX_LEGACY_CONTAINER_NAME':owner}):
            c.rejected(c.require_workflow_owner)
    with patch.dict(os.environ,{'GRIDEX_LEGACY_CONTAINER_NAME':'gridex-auth-legacy-fixed-12345678-1'}):
        c.require_workflow_owner()
    graph_controls(c)
    transport_controls(c)
    identity_controls(c)
    oracle_controls(c,models)
    bootstrap_tie_controls(c,models,cases)
    actor_fk_controls(c,cases)
    role_status_controls(c,cases)
    workflow(c)
    names = [(key,name) for key,name,_ in cases.cases()]
    c.check(len(names)==len(set(names)) and {key for key,_ in names}==set(c.SPECS),'CLOSED_CASE_MATRIX_REQUIRED')
    for key in c.SPECS:
        success = 'actual_missing_column_rejection' if key=='B0' else 'actual_success'
        c.check((key,success) in names and (key,'actual_guard') in names,'ACTUAL_LANE_REQUIRED')
    for key in ('D2','F2'):
        for failure in ('sentinel','backend','controller'):
            c.check((key,'actual_postcommit_'+failure) in names,'DURABILITY_LANE_REQUIRED')


def graph_controls(c):
    p = c.Proof.__new__(c.Proof)
    baseline = {'relation/public.companies':{'kind':'r'},
                'column/auth.users/is_anonymous':{'default':'false','generated':''},
                'constraint/public.company_memberships/closed':{'kind':'f','definition':'FOREIGN KEY (company_id) REFERENCES companies(id)'}}
    p.graph(baseline)
    changes = (
        ('trigger/public.companies/new',{'enabled':'O'}),
        ('rule/public.companies/new',{'enabled':'O'}),
        ('event_trigger/new',{'enabled':'O'}),
        ('relation/public.companies',{'kind':'f'}),
        ('column/auth.users/encrypted_password',{'default':"'unreviewed'::text",'generated':''}),
        ('constraint/public.company_memberships/closed',{'kind':'f','definition':'FOREIGN KEY (company_id) REFERENCES external.target(id)'}),
    )
    for key,value in changes:
        c.rejected(lambda:p.graph(dict(baseline,**{key:value})))


def transport_controls(c):
    class Process:
        def __init__(self,ready):
            self.stdin = io.BytesIO()
            self.stdout = io.BytesIO(ready)
            self.stderr = io.BytesIO()
            self.returncode = None
            self.inputs = []
        def communicate(self,payload=None,timeout=None):
            self.inputs.append(payload)
            self.returncode = 0
            return b'private synthetic result',b''
        def poll(self):
            return self.returncode
        def kill(self):
            self.returncode = -9
    with tempfile.TemporaryDirectory(prefix='fixed-transport-') as directory:
        h = c.legacy.OwnedPostgres()
        h.directory = type('PrivateDirectory',(),{'name':directory})()
        h.active = True
        p = c.Proof.__new__(c.Proof)
        p.h = h
        p.owned = lambda database: c.legacy.validate_database(database)
        for ready in (b'FIXED_PRIVATE_READY\n',b'unsafe\n'):
            process = Process(ready)
            with patch.dict(os.environ,{'PGHOST':'external.invalid','PGPORT':'55440','PGUSER':'external','PGDATABASE':'external','PGSERVICE':'external','PGOPTIONS':'unsafe'}),patch.object(subprocess,'Popen',return_value=process) as popen,patch.object(c.select,'select',return_value=([process.stdout],[],[])):
                operation = lambda:p.run(c.DATABASES['B0'],'PRIVATE_SYNTHETIC_INPUT',transaction=False)
                if ready.startswith(b'FIXED_PRIVATE_READY'):
                    result = operation()
                    c.check(result.code==0 and process.inputs==[b'PRIVATE_SYNTHETIC_INPUT'],'MEMORY_ONLY_INPUT_REQUIRED')
                else:
                    c.rejected(operation)
                    c.check(all(value is None for value in process.inputs),'BEFORE_SOURCE_PRIVATE_SESSION_DENIAL')
                argv = popen.call_args.args[0]
                c.check(argv[-2:]==['-f','-'] and 'PRIVATE_SYNTHETIC_INPUT' not in argv,'NO_SOURCE_ARGUMENTS')
                c.check('-h' not in argv and '-p' not in argv and not any(key.startswith('PG') for key in popen.call_args.kwargs['env']),'NO_EXTERNAL_CONNECTION_OPTIONS')
                c.check(not list(Path(directory).iterdir()),'NO_PRIVATE_OUTPUT_FILES')
        h.active = False


def oracle_controls(c,models):
    lower = datetime(2026,1,1,tzinfo=timezone.utc)
    upper = lower+timedelta(seconds=2)
    original_id = '10000000-0000-4000-8000-000000000001'
    generated_id = '10000000-0000-4000-8000-000000000002'
    foreign_id = '10000000-0000-4000-8000-000000000003'
    table = 'public.companies'
    catalog = {'relation/'+table:{'kind':'r'},
        'column/'+table+'/id':{'default':'gen_random_uuid()','generated':'','type':'uuid'},
        'column/'+table+'/name':{'default':None,'generated':'','type':'text'},
        'column/'+table+'/updated_at':{'default':'now()','generated':'','type':'timestamp with time zone'}}
    before = (catalog,[[table,{'id':original_id,'name':'canary','updated_at':'2020-01-01T00:00:00+00:00'}],
               ['auth.refresh_tokens_id_seq',{'last_value':41,'log_cnt':0,'is_called':True}]])
    after = copy.deepcopy(before)
    after[1].append([table,{'id':generated_id,'name':'generated synthetic','updated_at':'2026-01-01T00:00:01+00:00'}])
    def oracle():
        result = models.Oracle(c,before,lower,upper)
        result.new(table,{'name':'generated synthetic'})
        return result
    oracle().assert_snapshot(after)
    bad = []
    changed = copy.deepcopy(after);changed[1][0][1]['id']=foreign_id;bad.append(changed)
    changed = copy.deepcopy(after);changed[1][-1][1]['id']=original_id;bad.append(changed)
    changed = copy.deepcopy(after);changed[1][-1][1]['updated_at']='2027-01-01T00:00:00+00:00';bad.append(changed)
    changed = copy.deepcopy(after);changed[1][1][1]['is_called']=False;bad.append(changed)
    changed = copy.deepcopy(after);changed[1][0][1]['name']='changed canary';bad.append(changed)
    changed = copy.deepcopy(after);changed[1].append(['public.audit_logs',{'id':foreign_id}]);bad.append(changed)
    changed = copy.deepcopy(after);changed[0]['relation/'+table]['kind']='f';bad.append(changed)
    for changed in bad:
        c.rejected(lambda:oracle().assert_snapshot(changed))


def bootstrap_tie_controls(c,models,cases):
    """Synthetic model/runner regression, with independent complete postimages.

    No historical literals or SQL execution enter this constructor. Each pair
    permits a different oldest matching PK; mixed effects must still fail.
    """
    def uid(number):
        return '20000000-0000-4000-8000-'+str(number).zfill(12)
    user,first_id,second_id = uid(1),uid(2),uid(3)
    old,now = '2020-01-01T00:00:00+00:00','2026-01-01T00:00:01+00:00'
    literals = {(74,0):'super_admin',(74,1):'Synthetic system role',(74,2):'Synthetic description',
                (75,0):'company_admin',(75,1):'Synthetic company role',(75,2):'Synthetic description',
                (209,0):'synthetic-tie',(210,3):'123456',(243,0):'Synthetic selected company',
                (245,0):'123-456',(248,0):'Synthetic contact',(249,0):'Synthetic industry',
                (289,1):'Synthetic role note',(322,1):'Synthetic company audit',(323,1):'Synthetic source'}
    source = type('SyntheticSource',(),{'key':'B0','slots':{'U_boot':user},
                 'literal':lambda self,line,ordinal=0:literals[line,ordinal],
                 'refresh':lambda self:b'SYNTHETIC_CONSTRUCTOR_ONLY'})()
    rows = [['auth.users',{'id':user,'email':'tie-constructor@example.invalid'}]]
    for number,key in ((4,'super_admin'),(5,'company_admin')):
        rows.append(['public.roles',{'id':uid(number),'key':key,'name':'Before','description':'Before'}])
        rows.append(['public.user_roles',{'id':uid(number+2),'user_id':user,'role_id':uid(number),
                     'status':'inactive','is_active':False}])
    for number,company in enumerate((first_id,second_id)):
        rows.append(['public.companies',{'id':company,'name':'Before','slug':'synthetic-tie' if number==0 else None,
                     'org_number':None if number==0 else '123-456','status':'onboarding',
                     'primary_contact_email':None,'primary_contact_name':None,'industry':None,
                     'metadata':{'canary':True},'created_at':old,'updated_at':old}])
        rows.append(['public.company_memberships',{'id':uid(8+number),'company_id':company,'user_id':user,
                     'membership_role':'member','status':'inactive','accepted_at':None,'suspended_at':old,
                     'metadata':{'canary':True}}])
    rows.append(['public.user_profiles',{'id':user,'email':'preserved@example.invalid','full_name':'Preserved',
                 'active_company_id':None}])
    rows.append(['auth.refresh_tokens_id_seq',{'last_value':41,'log_cnt':0,'is_called':True}])
    catalog = {}
    for table,row in rows:
        catalog['relation/'+table] = {'kind':'S' if table.endswith('_seq') else 'r'}
        for column in row:
            catalog['column/'+table+'/'+column] = {'default':None,'generated':'','type':'text'}
    catalog['relation/public.audit_logs'] = {'kind':'r'}
    for column in ('id','actor_user_id','company_id','entity_type','entity_id','action','new_values','metadata'):
        catalog['column/public.audit_logs/'+column] = {'default':'gen_random_uuid()' if column=='id' else None,
                                                      'generated':'','type':'uuid' if column=='id' else 'text'}
    constraint = 'constraint/public.company_memberships/company_memberships_role_check'
    catalog[constraint] = {'definition':'Synthetic prior check'}
    before = catalog,rows
    def transition(preimage,winner,audit_number):
        after = copy.deepcopy(preimage)
        after[0][constraint]['definition'] = "CHECK ((membership_role = ANY (ARRAY['owner'::text, 'company_admin'::text, 'member'::text, 'viewer'::text])))"
        for table,row in after[1]:
            if table=='public.roles':
                row.update(name='Synthetic system role' if row['key']=='super_admin' else 'Synthetic company role',
                           description='Synthetic description')
            elif table=='public.user_roles' and row['role_id']==uid(4):
                row.update(status='active',is_active=True)
            elif table=='public.companies' and row['id']==winner:
                row.update(name='Synthetic selected company',slug=row['slug'] or 'synthetic-tie',
                           org_number=row['org_number'] or '123-456',status='active',
                           primary_contact_email='tie-constructor@example.invalid',primary_contact_name='Synthetic contact',
                           industry='Synthetic industry',updated_at=now,
                           metadata={'canary':True,'operational_company':True,'bootstrap_confirmed_at':now})
            elif table=='public.company_memberships' and row['company_id']==winner:
                row.update(membership_role='owner',status='active',accepted_at=now,suspended_at=None,
                           metadata={'canary':True,'bootstrap_confirmed_at':now,'role_note':'Synthetic role note'})
            elif table=='public.user_profiles':
                row['active_company_id'] = winner
        after[1].append(['public.audit_logs',{'id':uid(audit_number),'actor_user_id':user,'company_id':winner,
                         'entity_type':'company','entity_id':winner,'action':'bootstrap_operational_company',
                         'new_values':{'company_name':'Synthetic company audit','user_id':user},
                         'metadata':{'source':'Synthetic source'}}])
        return after
    def encoded(snapshot):
        return 'FIXED_CATALOG\n'+json.dumps(snapshot[0])+'\nFIXED_ROWS\n'+json.dumps(snapshot[1])+'\n'
    def result(*snapshots):
        return c.Result(''.join(map(encoded,snapshots)),'',0,'00000',
                        datetime(2026,1,1,tzinfo=timezone.utc),datetime(2026,1,1,0,0,2,tzinfo=timezone.utc))
    initial = transition(before,first_id,10)
    def run(first,second):
        destroyed = []
        proof = type('SyntheticProof',(),{
            'native':lambda *args,**kwargs:result(initial),
            'run':lambda *args,**kwargs:result(first,second),
            'snapshot':lambda *args:copy.deepcopy(before),'identity':lambda *args:None,
            'destroy':lambda self,database:destroyed.append(database)})()
        fixture = type('SyntheticFixture',(),{'database':c.DATABASES['B0'],'seed':lambda *args:copy.deepcopy(before)})()
        fixtures = type('SyntheticFixtures',(),{'Fixture':lambda *args:fixture})()
        with patch.object(c,'Source',return_value=source),contextlib.redirect_stdout(io.StringIO()):
            try:
                cases.run_case(c,models,fixtures,proof,'B0','synthetic_tie_regression',
                               {'reduced':True,'match':'tie','repeat':True})
            finally:
                c.check(destroyed==[c.DATABASES['B0']],'TIE_REGRESSION_DISPOSAL_REQUIRED')
    # The first repeated execution can differ from the prior rolled-back one;
    # the second can either keep or change its own winner.
    for first_winner in (first_id,second_id):
        first = transition(before,first_winner,11)
        for second_winner in (first_id,second_id):
            second = transition(first,second_winner,12)
            run(first,second)
    first = transition(before,first_id,11)
    second = transition(first,second_id,12)
    mutations = (
        ('public.companies','id',second_id,'id',uid(99)),
        ('public.companies','id',second_id,'name','Unmodeled company change'),
        ('public.company_memberships','company_id',second_id,'membership_role','member'),
        ('public.user_profiles','id',user,'active_company_id',first_id),
        ('public.audit_logs','id',uid(12),'entity_id',first_id),
        ('auth.users','id',user,'email','changed@example.invalid'),
        ('auth.refresh_tokens_id_seq','last_value',41,'is_called',False),
    )
    for table,key,value,column,bad in mutations:
        changed = copy.deepcopy(second)
        next(row for name,row in changed[1] if name==table and row[key]==value)[column] = bad
        c.rejected(lambda:run(first,changed))
    changed = copy.deepcopy(second);changed[0][constraint]['definition']='Unmodeled check'
    c.rejected(lambda:run(first,changed))
    changed = copy.deepcopy(second);changed[1].append(copy.deepcopy(changed[1][-1]))
    c.rejected(lambda:run(first,changed))
    # The named lane must remain two distinct oldest matching PKs; an unequal
    # timestamp or duplicate identity cannot broaden the legal alternatives.
    for column,bad in (('created_at','2021-01-01T00:00:00+00:00'),('id',first_id)):
        changed = copy.deepcopy(before)
        next(row for table,row in changed[1] if table=='public.companies' and row['id']==second_id)[column] = bad
        c.rejected(lambda:cases.assert_expected(c,models,changed,source,result(),{'match':'tie'},initial))


def actor_fk_controls(c,cases):
    """Native-message classifier regression only; no database is executed."""
    def run(source_key,constraint='fixed_actor_fk',state='23503',change=None):
        table = 'company_invitations' if source_key=='C2' else 'company_memberships'
        catalog = {'constraint/public.'+table+'/'+name:{'kind':'f','definition':
                   'FOREIGN KEY (invited_by) REFERENCES auth.users(id)'+suffix}
                   for name,suffix in ((table+'_invited_by_fkey',' ON DELETE SET NULL'),('fixed_actor_fk',''))}
        before = (catalog,[['auth.refresh_tokens_id_seq',{'last_value':41,'log_cnt':0,'is_called':True}]])
        current = copy.deepcopy(before)
        message_table = table
        if change=='wrong_parent':
            catalog['constraint/public.'+table+'/'+constraint]['definition'] = 'FOREIGN KEY (invited_by) REFERENCES public.roles(id)'
        elif change=='wrong_column':
            catalog['constraint/public.'+table+'/'+constraint]['definition'] = 'FOREIGN KEY (user_id) REFERENCES auth.users(id)'
        elif change=='wrong_kind':
            catalog['constraint/public.'+table+'/'+constraint]['kind'] = 'c'
        elif change=='missing_catalog':
            del catalog['constraint/public.'+table+'/'+constraint]
        elif change=='wrong_table':
            message_table = 'companies'
        elif change=='rollback':
            current[1][0][1]['is_called'] = False
        if change!='rollback':
            current = copy.deepcopy(before)
        message = 'ERROR: insert or update on table "'+message_table+'" violates foreign key constraint "'+constraint+'"'
        result = c.Result('',message,1,state,None,None)
        destroyed = []
        proof = type('SyntheticActorProof',(),{
            'native':lambda *args,**kwargs:result,'snapshot':lambda *args:copy.deepcopy(current),
            'destroy':lambda self,database:destroyed.append(database)})()
        fixture = type('SyntheticActorFixture',(),{'database':c.DATABASES[source_key],
                        'seed':lambda *args:copy.deepcopy(before)})()
        fixtures = type('SyntheticActorFixtures',(),{'Fixture':lambda *args:fixture})()
        source = type('SyntheticActorSource',(),{'key':source_key})()
        with patch.object(c,'Source',return_value=source),contextlib.redirect_stdout(io.StringIO()):
            try:
                cases.run_case(c,None,fixtures,proof,source_key,'reduced_actor_fk',
                               {'actor_fk':True,'reduced':True,'no_U_actor':True,'membership':'none','error':True})
            finally:
                c.check(destroyed==[c.DATABASES[source_key]],'ACTOR_REGRESSION_DISPOSAL_REQUIRED')
    for source_key,table in (('C2','company_invitations'),('D2','company_memberships')):
        run(source_key,table+'_invited_by_fkey')
        run(source_key)
        for change in ('wrong_parent','wrong_column','wrong_kind','missing_catalog','wrong_table','rollback'):
            c.rejected(lambda:run(source_key,change=change))
        c.rejected(lambda:run(source_key,state='23502'))
        c.rejected(lambda:run(source_key,constraint='unrelated_fk'))


def role_status_controls(c,cases):
    """Check the shared real seed branches against the retained status domain."""
    fixtures = c.load('fixed_status_fixtures','canonical-user-rbac-fixed-target-fixtures.py')
    allowed = {'active','disabled','removed_from_company','invitation_revoked','locked_security'}
    def guard(rows):
        c.check(all(row['status'] in allowed for table,row in rows if table=='public.user_roles'),
                'ROLE_FIXTURE_STATUS_CHECK')
    for key,name,options in cases.cases():
        if not (options.get('role_row') or options.get('other_target_role')):
            continue
        rows = []
        f = fixtures.Fixture.__new__(fixtures.Fixture)
        f.c,f.case,f.options = c,name,options
        f.database = c.DATABASES[key]
        f.catalog = {}
        f.before = ({},[])
        f.statements = []
        f.ids = {symbol:fixtures.synthetic('status-control/'+symbol) for symbol in
                 ('other_user','other_company','other_role','other_actor')}
        slots = {symbol:fixtures.synthetic('status-control/'+symbol) for symbol in
                 ('U_target','C_target','U_actor','U_old')}
        slots['email'] = 'status-control@example.invalid'
        f.source = type('SyntheticStatusSource',(),{'key':key,'slots':slots})()
        role_id = fixtures.synthetic('status-control/role')
        f.oracle = type('SyntheticStatusOracle',(),{
            'present':lambda *args:True,'columns':lambda *args:{'membership_role':{}},
            'by':lambda *args,**kwargs:[{'id':role_id}],
            'one':lambda *args,**kwargs:{'id':role_id},'assert_snapshot':lambda *args:None})()
        def record(table,values,slot):
            row = dict(values)
            if table=='public.user_roles':
                row.setdefault('status','active')
                row.setdefault('is_active',True)
            rows.append((table,row))
        f.insert = record
        def submit(*args):
            guard(rows)
            return c.Result('','',0,'00000',None,None)
        f.proof = type('SyntheticStatusProof',(),{'identity':lambda *args:None,'graph':lambda *args:None,
                        'run':submit,'snapshot':lambda *args:f.before})()
        f.seed()
        c.check(any(table=='public.user_roles' for table,row in rows),'STATUS_BRANCH_EXERCISED_REQUIRED')
        for table,row in rows:
            if table=='public.user_roles':
                c.check((row['status']=='active')==row['is_active'],'FIXTURE_ACTIVITY_CONSISTENCY_REQUIRED')
    c.rejected(lambda:guard([('public.user_roles',{'status':'inactive'})]))
    f.proof.run = lambda *args:c.Result('','SYNTHETIC_PRIVATE_SERVER_MESSAGE',1,'23514',None,None)
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        c.rejected(f.seed)
    c.check(output.getvalue()=='SETUP fixed-target '+f.source.key+' '+f.case+' sqlstate=23514\n',
            'SETUP_RECEIPT_VALUES_MUST_STAY_PRIVATE')
    role_status_shape_controls(c,cases,fixtures)


def role_status_shape_controls(c,cases,fixtures):
    constraint = 'constraint/public.user_roles/user_roles_status_check'
    definition = "CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'removed_from_company'::text, 'invitation_revoked'::text, 'locked_security'::text])))"
    before = ({constraint:{'kind':'c','definition':definition}},[])
    native = c.Result('','ERROR: new row for relation "user_roles" violates check constraint "user_roles_status_check"',1,'23514',None,None)
    matrix = {(key,name):options for key,name,options in cases.cases()}
    actual = matrix['F2','actual_old_roles_status_rejected']
    reduced = matrix['F2','reduced_old_roles_disabled']
    c.check(actual.get('error') and actual.get('role_status_error') and not actual.get('reduced') and
            reduced.get('reduced') and reduced.get('without_role_status_check') and not reduced.get('error'),
            'ACTUAL_REDUCED_STATUS_LANES_REQUIRED')
    cases.verify_failure(c,native,'F2','actual_old_roles_status_rejected',actual,before)
    for state,message in (('23505',native.stderr),('23514','ERROR: unrelated check constraint'),('00000',native.stderr)):
        c.rejected(lambda:cases.verify_failure(c,c.Result('',message,1,state,None,None),'F2',
                   'actual_old_roles_status_rejected',actual,before))
    c.rejected(lambda:cases.verify_failure(c,native,'F2','actual_old_roles_status_rejected',actual,({},[])))
    bad = copy.deepcopy(before);bad[0][constraint]['definition']='CHECK (true)'
    c.rejected(lambda:cases.verify_failure(c,native,'F2','actual_old_roles_status_rejected',actual,bad))
    # Exercise the real reduced SQL constructor with a synthetic catalog. This
    # records declarations only; it does not execute or claim PostgreSQL proof.
    catalog = {constraint:copy.deepcopy(before[0][constraint]),
               'constraint/public.user_roles/fixed_status_canary':{'kind':'c','definition':'CHECK (is_active IS NOT NULL)'},
               'function/public.gridex_normalize_org_number(p_value text)':{'definition':
                   'CREATE FUNCTION public.gridex_normalize_org_number(p_value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT p_value $$'}}
    for table in fixtures.TABLE_ORDER:
        catalog['relation/'+table] = {'kind':'r'}
        catalog['column/'+table+'/id'] = {'type':'uuid','notnull':True,'default':None,'generated':''}
    def construct(key,name,options):
        f = fixtures.Fixture.__new__(fixtures.Fixture)
        f.c,f.source,f.case,f.options = c,type('SyntheticStatusShape',(),{'key':key})(),name,options
        f.database = c.DATABASES[key]
        current = copy.deepcopy(catalog)
        if options.get('without_role_status_check'):
            current.pop(constraint)
        sql = []
        resets = []
        def record(self,database,text):
            sql.append(text)
            return c.Result('','',0,'00000',None,None)
        f.proof = type('SyntheticStatusShapeProof',(),{'origin':(catalog,[]),
            'h':type('SyntheticReset',(),{'reset':lambda *args:resets.append(True)})(),
            'owned':lambda *args:None,'identity':lambda *args:None,'graph':lambda *args:None,
            'run':record,'snapshot':lambda *args:(current,[])})()
        try:
            f.reduced()
        except c.BoundaryError:
            c.check(not sql and not resets,'STATUS_SHAPE_REJECT_BEFORE_MUTATION')
            raise
        c.check(len(sql)==1 and len(resets)==1,'STATUS_SHAPE_CONSTRUCTOR_REQUIRED')
        declaration = 'ADD CONSTRAINT "user_roles_status_check" '+definition
        c.check((declaration in sql[0])==(not options.get('without_role_status_check')),'STATUS_SHAPE_EXACT_CHECK_REQUIRED')
        c.check('ADD CONSTRAINT "fixed_status_canary" CHECK (is_active IS NOT NULL)' in sql[0] and
                c.dedupe.index_declarations() in sql[0],'OTHER_STATUS_GUARDS_PRESERVED')
    construct('F2','reduced_old_roles_disabled',reduced)
    construct('F2','reduced_null_company_role_moved',{'reduced':True})
    for key,name,options in (('C2','reduced_old_roles_disabled',reduced),
                             ('F2','actual_old_roles_status_rejected',reduced),
                             ('F2','reduced_old_roles_disabled',{'without_role_status_check':True})):
        c.rejected(lambda:construct(key,name,options))


def workflow(c):
    text = (c.ROOT/'.github/workflows/ops-hardening.yml').read_text()
    match = c.re.search(r'^  user-rbac-fixed-target-proof:\n(.*?)(?=^  [a-zA-Z0-9_-]+:|\Z)',text,c.re.M|c.re.S)
    c.check(match is not None,'FIXED_WORKFLOW_REQUIRED')
    job = match[0]
    c.check('    timeout-minutes: 20\n' in job,'FIXED_TIMEOUT_REQUIRED')
    c.check('GRIDEX_LEGACY_CONTAINER_NAME: gridex-auth-legacy-fixed-${{ github.run_id }}-${{ github.run_attempt }}' in job,'EXACT_WORKFLOW_OWNER_REQUIRED')
    commands = c.re.findall(r'^        run: (.+)$',job,c.re.M)
    c.check(commands==['python3 scripts/canonical-user-rbac-fixed-target-selftest.py',
                        'python3 scripts/canonical-user-rbac-fixed-target-selftest.py --cleanup-owned'],'INDEPENDENT_COMMAND_REQUIRED')
    c.check('        if: always()\n        run: '+commands[1] in job,'EXACT_ALWAYS_CLEANUP_REQUIRED')
    for forbidden in ('services:','needs:','upload-artifact','docker logs','apt-get','pip install','--selection-only','command20'):
        c.check(forbidden not in job,'UNSAFE_WORKFLOW_SURFACE')


def privacy(c,proof):
    """Inspect server collector/client files privately; never publish contents."""
    sources = [c.Source(key) for key in c.SPECS]
    values = {value.encode() for source in sources for value in source.slots.values()}
    for source in sources:
        for line in {'B0':(226,227,228,231),'C2':(33,),'D2':(33,66),'F2':(40,)}[source.key]:
            values.add(source.literal(line).encode())
    # The closed owner command reads only its collector directory, into memory.
    command = ['docker','exec',proof.name,'sh','-c','cat /var/lib/postgresql/data/pg_log_private/*.log']
    result = subprocess.run(command,capture_output=True,timeout=30,env=c.legacy.clean_environment())
    c.check(result.returncode==0,'PRIVATE_COLLECTOR_INSPECTION_REQUIRED')
    c.check(not any(value in result.stdout+result.stderr for value in values),'SOURCE_LITERAL_IN_COLLECTOR')
    for path in Path(proof.directory).rglob('*'):
        if path.is_file():
            contents = path.read_bytes()
            c.check(not any(value in contents for value in values),'SOURCE_LITERAL_IN_PRIVATE_ARTIFACT')


def admissions(c,models,fixtures,proof):
    for source_key in c.SPECS:
        source = c.Source(source_key)
        f = fixtures.Fixture(c,models,proof,source,'actual_admission_controls',{})
        database = f.database
        try:
            c.rejected(lambda:proof.clone(source,'nonfresh'))
            before = proof.snapshot(database)
            # Closed harmless stand-ins for an unreviewed write trigger/FK.
            for sql in (
                "CREATE FUNCTION public.fixed_unknown_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; CREATE TRIGGER fixed_unknown BEFORE INSERT ON public.companies FOR EACH ROW EXECUTE FUNCTION public.fixed_unknown_trigger();",
                "CREATE TABLE public.fixed_unknown_parent(id uuid PRIMARY KEY); ALTER TABLE public.companies ADD COLUMN fixed_unknown_id uuid REFERENCES public.fixed_unknown_parent(id);",
            ):
                result = proof.run(database,'BEGIN;\n'+sql+'\n'+c.snapshot_sql()+'\nROLLBACK;',transaction=False)
                c.check(result.code==0,'ADMISSION_NEGATIVE_CONSTRUCTOR_FAILED')
                unsafe = c.decode_snapshot(result.stdout)
                c.rejected(lambda:proof.graph(unsafe[0]))
                c.check(proof.snapshot(database)==before,'ADMISSION_CONTROL_ROLLBACK')
            # Actual role/owner observation fails before any fixed input.
            proof.query(database,'ALTER DATABASE '+database+' OWNER TO service_role;')
            try:
                c.rejected(lambda:proof.identity(database))
            finally:
                proof.query(database,'ALTER DATABASE '+database+' OWNER TO postgres;')
            c.check(proof.snapshot(database)==before,'ADMISSION_OWNER_RESTORED')
        finally:
            proof.destroy(database)


def identity_controls(c):
    database = c.DATABASES['B0']
    name = 'gridex-auth-legacy-fixed-12345678-1'
    p = c.Proof.__new__(c.Proof)
    p.name = name
    p.owned = lambda value: c.legacy.validate_database(value)
    p.h = type('IdentityRecorder',(),{'docker':lambda *args:('none|'+name).encode(), 'verify_logging':lambda *args:None})()
    valid = database+'|postgres|t|t|postgres'
    p.run = lambda *args:c.Result(valid,'',0,'00000',None,None)
    p.identity(database)
    for fields in (('wrong','postgres','t','t','postgres'),(database,'external','t','t','postgres'),
                   (database,'postgres','f','t','postgres'),(database,'postgres','t','f','postgres'),
                   (database,'postgres','t','t','external')):
        p.run = lambda *args:c.Result('|'.join(fields),'',0,'00000',None,None)
        c.rejected(lambda:p.identity(database))
    p.run = lambda *args:c.Result(valid,'',0,'00000',None,None)
    p.h.docker = lambda *args:('bridge|'+name).encode()
    c.rejected(lambda:p.identity(database))
    p.h.docker = lambda *args:b'none|different-owner'
    c.rejected(lambda:p.identity(database))
    p.h.docker = lambda *args:('none|'+name).encode()
    p.h.verify_logging = lambda:(_ for _ in ()).throw(c.BoundaryError('PRIVATE_LOG_SETTINGS_MISMATCH'))
    c.rejected(lambda:p.identity(database))
