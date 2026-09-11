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
    membership_type_controls(c,cases)
    accepted_input_controls(c)
    reference_input_controls(c)
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


def membership_type_controls(c,cases):
    """Exercise the real rejection/rollback runner with private synthetic input.

    A missing membership type must not be labeled whole-source success, and a
    syntax error from a different catalog shape must not satisfy this case.
    Native PostgreSQL remains the separate hosted proof.
    """
    matrix = {(key,name):options for key,name,options in cases.cases()}
    name = 'reduced_membership_column_absent'
    def run(change=None,source_key='D2'):
        catalog = {'relation/public.'+table:{'kind':'r'} for table in
                   ('company_memberships','company_invitations')}
        for column in ('membership_role','email','invited_email'):
            catalog['column/public.company_invitations/'+column] = {'type':'text'}
        before = (catalog,[['public.companies',{'id':1,'name':'synthetic canary'}],
                    ['auth.refresh_tokens_id_seq',{'last_value':41,'log_cnt':0,'is_called':True}]])
        if change=='membership_type_present':
            catalog['column/public.company_memberships/membership_role'] = {'type':'text'}
        elif change in ('membership_role','email','invited_email'):
            del catalog['column/public.company_invitations/'+change]
        elif change=='wrong_relation':
            catalog['relation/public.company_invitations']['kind'] = 'v'
        after = copy.deepcopy(before)
        if change=='rollback_row':
            after[1][0][1]['name'] = 'changed synthetic canary'
        elif change=='rollback_sequence':
            after[1][1][1]['is_called'] = False
        elif change=='rollback_catalog':
            after[0]['relation/public.company_memberships']['kind'] = 'v'
        state = '23514' if change=='wrong_state' else '00000' if change=='source_success' else '42601'
        code = 0 if change in ('source_success','zero_exit') else 1
        message = 'ERROR: 42601: syntax error at or near "synthetic private parser token"'
        if change=='wrong_message':
            message = 'ERROR: synthetic unrelated rejection'
        native = c.Result('',message,code,state,None,None)
        source = type('SyntheticMembershipTypeSource',(),{'key':source_key})()
        destroyed = []
        def execute(self,sent_source,database,rollback,suffix):
            c.check(sent_source is source and database==c.DATABASES[source_key] and
                    rollback==(source_key=='C2') and not suffix,'TYPE_DEPENDENCY_NATIVE_ROUTE_REQUIRED')
            return native
        proof = type('SyntheticMembershipTypeProof',(),{'native':execute,
            'snapshot':lambda *args:copy.deepcopy(after),
            'destroy':lambda self,database:destroyed.append(database)})()
        fixture = type('SyntheticMembershipTypeFixture',(),{'database':c.DATABASES[source_key],
            'seed':lambda *args:copy.deepcopy(before)})()
        fixtures = type('SyntheticMembershipTypeFixtures',(),{'Fixture':lambda *args:fixture})()
        output = io.StringIO()
        with patch.object(c,'Source',return_value=source),contextlib.redirect_stdout(output):
            try:
                cases.run_case(c,None,fixtures,proof,source_key,name,matrix[source_key,name])
            finally:
                c.check(destroyed==[c.DATABASES[source_key]],'TYPE_DEPENDENCY_DISPOSAL_REQUIRED')
                c.check('synthetic private parser token' not in output.getvalue(),'TYPE_ERROR_MESSAGE_MUST_STAY_PRIVATE')
    run()
    for change in ('wrong_state','source_success','zero_exit','wrong_message','membership_type_present',
                   'membership_role','email','invited_email','wrong_relation',
                   'rollback_row','rollback_sequence','rollback_catalog'):
        c.rejected(lambda:run(change))
    # C2's static column-absent branch remains a whole-source success lane.
    c.rejected(lambda:run(source_key='C2'))


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


@contextlib.contextmanager
def accepted_handle(c):
    with tempfile.TemporaryDirectory(prefix='fixed-accepted-input-') as directory:
        h = c.legacy.OwnedPostgres()
        h.name = h._created_name = 'gridex-auth-legacy-fixed-12345678-1'
        h.directory = type('PrivateDirectory',(),{'name':directory})()
        h.active = True
        h.reference = ({},{})
        c.repair.REFERENCES[h] = c.repair.Reference(directory,{},{})
        c.dedupe._REFERENCES[h] = c.dedupe._Reference(directory,h.name,h.reference,c.repair.REFERENCES[h],{},{},[])
        try:
            with patch.object(h,'verify_logging'),contextlib.redirect_stdout(io.StringIO()):
                yield h
        finally:
            h.active = False
            c.repair.REFERENCES.pop(h,None)
            c.dedupe._REFERENCES.pop(h,None)
            c.dedupe._STATES.pop(h,None)


def admission_bytes(c):
    sources = c.repair.validate_sources(c.repair.reviewed_paths())
    return ((c.repair.SUPPORT/'canonical-user-rbac-repair-admission.sql').read_text()
            .replace('-- REPAIR_CATALOG_CAPTURE',c.repair.catalog_capture('repair_catalog_before'))
            .replace('-- REPAIR_SEED_ORACLE',c.repair.seed_oracle_sql(sources))
            .replace('-- REPAIR_DIAGNOSTIC_GUARD',c.repair.diagnostic_guard(sources))).encode()


def context_bytes(c,h,route):
    """Expected complete generated statements, independently of adapter buffers."""
    literal = c.legacy.literal
    if route == 'legacy':
        base,final = h.reference
        return ('SET TRANSACTION ISOLATION LEVEL READ COMMITTED;\n'
                'CREATE TEMP TABLE legacy_reference(base jsonb NOT NULL,final jsonb) ON COMMIT DROP;\n'
                'INSERT INTO legacy_reference VALUES ('+literal(json.dumps(base))+'::jsonb,'+
                (literal(json.dumps(final))+'::jsonb' if final else 'NULL')+');\n').encode()
    ref = c.repair.REFERENCES[h]
    hashes = ','.join(literal(source.sha256) for source in c.repair.validate_sources(c.repair.reviewed_paths()))
    return ('SET TRANSACTION ISOLATION LEVEL READ COMMITTED;\n'
            'CREATE TEMP TABLE repair_reference(base jsonb NOT NULL,final jsonb NOT NULL,hashes text[] NOT NULL) ON COMMIT DROP;\n'
            'INSERT INTO repair_reference VALUES ('+literal(json.dumps(ref.base))+'::jsonb,'+
            literal(json.dumps(ref.final))+'::jsonb,ARRAY['+hashes+']);').encode()


def reference_catalog(c):
    """Source-backed populated datum, not a simulated native catalog claim."""
    name,digest = c.AcceptedInputs.PREFIX
    raw = c.repair.read_source(c.ROOT/'supabase/migrations'/name)
    c.legacy.verify_bytes(raw,digest)
    declaration = c.re.search(r'create\s+(?:or\s+replace\s+)?function\s+public\.gridex_db1_default_company_id\s*\(.*?\$\$.*?\$\$\s*;',raw.decode(),c.re.I|c.re.S)
    c.check(declaration is not None,'PINNED_REFERENCE_DECLARATION_REQUIRED')
    return {'function/public.gridex_db1_default_company_id()':{'definition':declaration.group()}}


def reference_input_controls(c):
    output = ''.join('LEGACY_STAGE_'+alias+'\n' for alias in (*'ABCDEFHI','COMPLETED'))
    output += ''.join('REPAIR_STAGE_'+alias+'\n' for alias in ('R2','E2','S2','COMPLETED'))
    with accepted_handle(c) as h:
        catalog = reference_catalog(c)
        h.reference = (catalog,None)
        tokens,calls = [],[]
        def process(argv,**kwargs):
            if inputs.buffers:
                route = inputs.route
                order = inputs.LEGACY_ORDER if route=='legacy' else inputs.ORDER
                database = 'gridex_auth_legacy_reference' if c.dedupe._STATES.get(h) is None else c.replay.DATABASE
                expected = c.legacy.OwnedPostgres.command(h,database,[Path(h.directory.name)/name for name in order],True)
                expected[expected.index('/legacy-private/'+order[0])] = '-'
                payload = context_bytes(c,h,route)
                if route=='repair':
                    index = expected.index('/legacy-private/'+order[1])
                    del expected[index-1:index+1]
                    payload += b'\n'+admission_bytes(c)
                c.check(argv==expected and kwargs.get('input')==payload,'POPULATED_REFERENCE_BYTES_AND_ARGV_REQUIRED')
                module = c.legacy if route=='legacy' else c.repair
                for source in module.validate_sources(module.reviewed_paths()):
                    whole = ('whole-' if route=='legacy' else 'repair-whole-')+source.alias+'.sql'
                    c.check((Path(h.directory.name)/whole).read_bytes()==source.data and
                            '/legacy-private/'+whole in argv and source.data not in payload,
                            'INDEPENDENT_UNCHANGED_MIGRATION_INPUT_REQUIRED')
                tokens.extend(inputs.buffers)
                calls.append((route,database))
            return subprocess.CompletedProcess(argv,0,output.encode(),b'')
        with patch.object(subprocess,'run',side_effect=process),c.AcceptedInputs(h) as inputs:
            c.legacy.execute(h,'gridex_auth_legacy_reference',c.legacy.reviewed_paths())
            c.check(not (Path(h.directory.name)/'envelope-context.sql').exists(),'REFERENCE_CONTEXT_MUST_STAY_IN_MEMORY')
            h.reference = (catalog,catalog)
            c.legacy.execute(h,'gridex_auth_legacy_reference',c.legacy.reviewed_paths())
            c.repair.REFERENCES[h] = c.repair.Reference(h.directory.name,catalog,catalog)
            c.dedupe._REFERENCES[h] = c.dedupe._Reference(h.directory.name,h.name,h.reference,c.repair.REFERENCES[h],catalog,catalog,[])
            c.dedupe._STATES[h] = 'FRESH'
            with tempfile.TemporaryDirectory(prefix='fixed-reference-stage-') as directory:
                stage = c.legacy.StagedSources(Path(directory))
                prefix = c.legacy.verified_prefix()
                for path,text in prefix:
                    if path.startswith('migrations/'):
                        (stage.hold/Path(path).name).write_bytes(text.encode())
                oracle = c.ROOT/'supabase/migrations/20260810193450_canonical_access_provisioning_runtime_v1.sql'
                (stage.hold/oracle.name).write_bytes(c.repair.read_source(oracle))
                for module in (c.legacy,c.repair):
                    for source in module.validate_sources(module.reviewed_paths()):
                        (stage.hold/source.path.name).write_bytes(source.data)
                loop = c.replay.FoundationLoop.__new__(c.replay.FoundationLoop)
                loop.applied,loop.terminal,loop.scope = False,False,'legacy52'
                loop.target,loop.b = h,c.legacy
                loop.validate = lambda *args:(stage,[text.encode() for _,text in prefix])
                loop._run(None,None)
                c.repair.execute(h,c.replay.DATABASE,c.repair.reviewed_paths(),stage)
            c.check(not (Path(h.directory.name)/'repair-context.sql').exists(),'REFERENCE_CONTEXT_MUST_STAY_IN_MEMORY')
        c.check(calls==[('legacy','gridex_auth_legacy_reference')]*2+
                [('legacy',c.replay.DATABASE),('repair',c.replay.DATABASE)],'REFERENCE_PREP_AND_ACTUAL_ROUTES_REQUIRED')
        c.check(all(not token.valid and not token.data for token in tokens),'REFERENCE_BUFFERS_CLEARED_REQUIRED')
        proof = type('PopulatedReferenceProof',(),{'h':h,'name':h.name,'directory':h.directory.name,'accepted_inputs':inputs})()
        with patch.object(subprocess,'run',return_value=subprocess.CompletedProcess([],0,b'',b'')):
            privacy(c,proof)
    reference_failure_controls(c,output)


def reference_failure_controls(c,output):
    for route,failure in (('legacy','reference'),('legacy','phase'),('legacy','database'),
                          ('legacy','foreign'),('legacy','physical'),('legacy','result'),
                          ('legacy','completion'),('repair','reference'),('repair','phase'),
                          ('repair','foreign'),('repair','physical')):
        with accepted_handle(c) as h:
            catalog = reference_catalog(c)
            h.reference = (catalog,catalog)
            c.repair.REFERENCES[h] = c.repair.Reference(h.directory.name,catalog,catalog)
            c.dedupe._REFERENCES[h] = c.dedupe._Reference(h.directory.name,h.name,h.reference,c.repair.REFERENCES[h],catalog,catalog,[])
            original = h.private,h.run_files
            result = subprocess.CompletedProcess([],1 if failure=='result' else 0,
                                                  b'' if failure=='completion' else output.encode(),b'')
            tokens = []
            with patch.object(subprocess,'run',return_value=result) as run,c.AcceptedInputs(h) as inputs:
                if route=='repair':c.dedupe._STATES[h] = 'FRESH'
                module = c.legacy if route=='legacy' else c.repair
                database = 'gridex_auth_legacy_reference' if route=='legacy' else c.replay.DATABASE
                if failure in ('result','completion'):
                    c.rejected(lambda:module.execute(h,database,module.reviewed_paths()))
                else:
                    files = module.envelope_files(h,module.reviewed_paths())
                    tokens.extend(inputs.buffers)
                    if failure=='reference':
                        if route=='legacy':h.reference = (dict(catalog),dict(catalog))
                        else:c.repair.REFERENCES[h] = c.repair.Reference(h.directory.name,catalog,catalog)
                    if failure=='phase':c.dedupe._STATES[h] = 'SUCCEEDED'
                    if failure=='database':database = c.replay.DATABASE
                    if failure=='foreign':files[0] = c.MemoryAdmission(object(),b'SELECT 1;',files[0].name)
                    if failure=='physical':files[0] = Path(h.directory.name)/files[0].name
                    c.rejected(lambda:h.run_files(database,files,'whole_batch'))
                    c.check(not run.called,'REFERENCE_REJECTION_BEFORE_PROCESS_REQUIRED')
                c.check(not inputs.buffers and not inputs.envelope and inputs.binding is None and
                        all(not token.valid and not token.data for token in tokens),'REFERENCE_ERROR_CLEARS_IMMEDIATELY')
            c.check((h.private,h.run_files)==original,'REFERENCE_METHOD_RESTORATION_REQUIRED')


def accepted_input_controls(c):
    """Real unchanged writer/execute and command; only SQL/process transport is mocked."""
    output = b'REPAIR_STAGE_R2\nREPAIR_STAGE_E2\nREPAIR_STAGE_S2\nREPAIR_STAGE_COMPLETED\n'
    for failure in (None,'exit','state','stages','process','timeout','database','owner','phase',
                    'files','duplicate','physical','stage','transaction','expect','foreign',
                    'remove_private','remove_run_files','body_failure'):
        with accepted_handle(c) as h:
            old_private,old_run = h.private,h.run_files
            tokens = []
            def process(argv,**kwargs):
                tokens.extend(inputs.buffers)
                expected = c.legacy.OwnedPostgres.command(h,c.replay.DATABASE,
                            [Path(h.directory.name)/name for name in inputs.ORDER],True)
                expected[expected.index('/legacy-private/repair-context.sql')] = '-'
                admission_index = expected.index('/legacy-private/repair-admission.sql')
                del expected[admission_index-1:admission_index+1]
                c.check(argv == expected and kwargs['input'] == context_bytes(c,h,'repair')+b'\n'+admission_bytes(c),
                        'UNCHANGED_ADMISSION_COMMAND_AND_BYTES_REQUIRED')
                c.check(kwargs['capture_output'] is True and kwargs['timeout']==120
                        and kwargs['env']==c.legacy.clean_environment(),'ACCEPTED_PROCESS_OPTIONS_REQUIRED')
                if failure=='process': raise OSError('synthetic process failure')
                if failure=='timeout': raise subprocess.TimeoutExpired(argv,120)
                state = b'ERROR: 23514: synthetic private error' if failure=='state' else b''
                text = b'' if failure=='stages' else output
                # A raw source-bound result must remain in memory on this route.
                text += c.Source('C2').slots['email'].encode()+b'\n'
                return subprocess.CompletedProcess(argv,1 if failure=='exit' else 0,text,state)
            def exercise():
                with c.AcceptedInputs(h) as adapter:
                    nonlocal inputs
                    inputs = adapter
                    c.dedupe._STATES[h] = 'FRESH'
                    if failure in ('remove_private','remove_run_files'):
                        c.repair.envelope_files(h,c.repair.reviewed_paths())
                        tokens.extend(inputs.buffers)
                        del h.__dict__[failure.removeprefix('remove_')]
                        return
                    if failure=='body_failure':
                        c.repair.envelope_files(h,c.repair.reviewed_paths())
                        tokens.extend(inputs.buffers)
                        raise c.BoundaryError('SYNTHETIC_BODY_FAILURE')
                    if failure in ('files','duplicate','physical','stage','transaction','expect','foreign'):
                        files = c.repair.envelope_files(h,c.repair.reviewed_paths())
                        tokens.extend(inputs.buffers)
                        if failure=='files': files[2],files[4] = files[4],files[2]
                        if failure=='duplicate': files[2] = files[1]
                        if failure=='physical': files[1] = Path(h.directory.name)/files[1].name
                        if failure=='foreign': files[1] = c.MemoryAdmission(object(),b'SELECT 1;')
                        h.run_files(c.replay.DATABASE,files,'wrong' if failure=='stage' else 'whole_batch',
                                    transaction=failure!='transaction',expect='23514' if failure=='expect' else '00000')
                        return
                    if failure=='owner': h.name = 'gridex-auth-legacy-fixed-12345678-2'
                    if failure=='phase': c.dedupe._STATES[h] = 'SUCCEEDED'
                    result = c.repair.execute(h,'gridex_auth_legacy_reference' if failure=='database' else c.replay.DATABASE,
                                              c.repair.reviewed_paths())
                    c.check(result['sources']==4,'REPAIR_EXECUTOR_REQUIRED')
                    c.check(not (Path(h.directory.name)/'repair-admission.sql').exists(),
                            'GENERATED_ADMISSION_MUST_STAY_IN_MEMORY')
            inputs = None
            with patch.object(subprocess,'run',side_effect=process) as run:
                if failure is None: exercise()
                else: c.rejected(exercise)
                if failure not in (None,'exit','state','stages','process','timeout'):
                    c.check(not run.called,'INVALID_ADMISSION_BEFORE_PROCESS_REQUIRED')
            c.check(h.private==old_private and h.run_files==old_run and
                    'private' not in h.__dict__ and 'run_files' not in h.__dict__,
                    'ACCEPTED_METHOD_RESTORATION_REQUIRED')
            c.check(inputs.closed and not inputs.buffers and not inputs.envelope and
                    all(not token.valid and not token.data for token in tokens),'PRIVATE_BUFFERS_CLEARED_REQUIRED')
            for token in tokens: c.rejected(token.read_text)
            c.check(not (Path(h.directory.name)/'client-last.out').exists(),
                    'ADAPTED_RESULT_MUST_STAY_IN_MEMORY')
    staged_input_controls(c)
    privacy_input_controls(c)


@contextlib.contextmanager
def accepted_writers(c):
    """Exercise all four unchanged writers, including the replay loop and H2 executor."""
    output = b'REPAIR_STAGE_R2\nREPAIR_STAGE_E2\nREPAIR_STAGE_S2\nREPAIR_STAGE_COMPLETED\n'
    result = subprocess.CompletedProcess([],0,output,b'')
    with accepted_handle(c) as h,patch.object(subprocess,'run',return_value=result):
        with c.AcceptedInputs(h) as inputs:
            with patch.object(h,'reset'):
                h.prefix('gridex_auth_legacy_reference')
            prefix = c.legacy.verified_prefix()
            c.dedupe._STATES[h] = 'FRESH'
            with tempfile.TemporaryDirectory(prefix='fixed-accepted-stage-') as directory:
                stage = c.legacy.StagedSources(Path(directory))
                for name in inputs.sources:
                    (stage.hold/inputs.sources[name][0]).write_bytes(inputs.canonical(name))
                for source in c.repair.validate_sources(c.repair.reviewed_paths()):
                    (stage.hold/source.path.name).write_bytes(source.data)
                loop = c.replay.FoundationLoop.__new__(c.replay.FoundationLoop)
                loop.applied,loop.terminal,loop.scope = False,False,'legacy52'
                loop.target,loop.b = h,c.legacy
                loop.validate = lambda *args:(stage,[text.encode() for _,text in prefix])
                real_is_file = Path.is_file
                # The real shell removes canonical files while the accepted HOLD is live.
                with patch.object(Path,'is_file',lambda p:False if p.parent==c.ROOT/'supabase/migrations' else real_is_file(p)):
                    with patch.object(c.legacy,'execute',return_value={'sources':9}):
                        loop._run(None,None)
                    c.repair.execute(h,c.replay.DATABASE,c.repair.reviewed_paths(),stage)
                    c.dedupe._STATES[h] = 'ACCEPTED56'
                    with patch.object(c.dedupe,'snapshot',return_value=({},[])),patch.object(c.dedupe,'assert_final'),patch.object(h,'sql',return_value='0'):
                        c.dedupe.execute(h,c.replay.DATABASE,c.dedupe.reviewed_paths(),stage)
        c.check(set(inputs.records)==set(inputs.sources),'FOUR_REAL_WRITERS_REQUIRED')
        proof = type('AcceptedProof',(),{'h':h,'name':h.name,'directory':h.directory.name,'accepted_inputs':inputs})()
        yield proof


def staged_input_controls(c):
    for failure in ('missing','symlink','mutated','foreign_stage','foreign_writer'):
        with accepted_handle(c) as h,c.AcceptedInputs(h) as inputs:
            c.dedupe._STATES[h] = 'FRESH'
            if failure=='foreign_writer':
                c.rejected(lambda:h.private('repair-whole-E2.sql',inputs.canonical('repair-whole-E2.sql')))
                continue
            with tempfile.TemporaryDirectory(prefix='fixed-input-stage-') as directory:
                stage = c.legacy.StagedSources(Path(directory))
                for source in c.repair.validate_sources(c.repair.reviewed_paths()):
                    (stage.hold/source.path.name).write_bytes(source.data)
                target = stage.hold/c.repair.SPECS[1][1]
                if failure=='missing': target.unlink()
                if failure=='mutated': target.write_bytes(target.read_bytes()+b'\n')
                if failure=='symlink':
                    target.unlink()
                    target.symlink_to(c.repair.reviewed_paths()[1])
                if failure=='foreign_stage': stage = type('ForeignStage',(),{'hold':stage.hold})()
                with patch.object(subprocess,'run') as run:
                    c.rejected(lambda:c.repair.execute(h,c.replay.DATABASE,c.repair.reviewed_paths(),stage))
                    c.check(not run.called and not inputs.buffers,'STAGE_DENIED_BEFORE_INPUT_REQUIRED')


def privacy_input_controls(c):
    """Whole-input provenance is the only exception; collector/artifact scan stays exact."""
    failures = (None,'collector','collector_failure','generated_empty','generated_literal','artifact',
                'copied','lookalike','mutated','replaced','symlink','foreign_proof','missing_source',
                'source_symlink','source_mutated','manifest','no_provenance',
                'generated_legacy_context','generated_repair_context')
    for failure in failures:
        with accepted_writers(c) as proof,contextlib.ExitStack() as stack:
            inputs = proof.accepted_inputs
            path = Path(proof.directory)/'repair-whole-E2.sql'
            literal = c.Source('C2').slots['email'].encode()
            result = subprocess.CompletedProcess([],0,b'',b'')
            if failure=='collector': result.stdout = literal
            if failure=='collector_failure': result.returncode = 1
            if failure in ('generated_empty','generated_literal'):
                (path.parent/'repair-admission.sql').write_bytes(b'SELECT 1;' if failure=='generated_empty' else literal)
            if failure in ('generated_legacy_context','generated_repair_context'):
                name = 'envelope-context.sql' if failure=='generated_legacy_context' else 'repair-context.sql'
                (path.parent/name).write_bytes(b'SELECT 1;')
            if failure=='artifact': (path.parent/'client-last.out').write_bytes(literal)
            if failure in ('copied','lookalike'):
                destination = path.parent/('foreign' if failure=='copied' else 'lookalike')
                destination.mkdir()
                (destination/path.name).write_bytes(path.read_bytes())
            if failure=='mutated': path.write_bytes(path.read_bytes()+b'\n')
            if failure=='replaced':
                replacement = path.parent/'replacement.sql'
                replacement.write_bytes(path.read_bytes())
                replacement.replace(path)
            if failure=='symlink':
                original = path.parent/'original.sql'
                path.rename(original)
                path.symlink_to(original)
            if failure=='foreign_proof': proof.h = object()
            if failure=='no_provenance': proof.accepted_inputs = None
            source = c.ROOT/'supabase/migrations'/inputs.sources[path.name][0]
            if failure=='missing_source':
                real = Path.is_file
                stack.enter_context(patch.object(Path,'is_file',lambda p:False if p==source else real(p)))
            if failure=='source_symlink':
                real = Path.is_symlink
                stack.enter_context(patch.object(Path,'is_symlink',lambda p:p==source or real(p)))
            if failure=='source_mutated':
                real = Path.read_bytes
                stack.enter_context(patch.object(Path,'read_bytes',lambda p:real(p)+b'\n' if p==source else real(p)))
            if failure=='manifest':
                real = Path.read_text
                manifest = c.ROOT/'scripts/migration-history-manifest.json'
                def changed(p,*args,**kwargs):
                    text = real(p,*args,**kwargs)
                    if p==manifest:
                        data = json.loads(text)
                        data['files'][source.name] = '0'*64
                        return json.dumps(data)
                    return text
                stack.enter_context(patch.object(Path,'read_text',changed))
            with patch.object(subprocess,'run',return_value=result):
                if failure is None: privacy(c,proof)
                else: c.rejected(lambda:privacy(c,proof))


def privacy(c,proof):
    return c.private_inputs.privacy(c,proof)


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
