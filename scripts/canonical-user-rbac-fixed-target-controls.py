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
