import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { assertPhasedAssignment, type BusinessAdmission } from '../scripts/simulation/track1/fixtures/main03Cohort'

// Actual adapter code, with synthetic data and private temporary files only.
// No Docker, SQL, network, build, replay or hosted workflow runs in this suite.
const python = String.raw`
import copy,importlib.util,json,pathlib,sys,tempfile,os
request=json.loads(sys.argv[1]);path=pathlib.Path('scripts/simulation/runtime/assigned_backend.py')
try:
 spec=importlib.util.spec_from_file_location('assigned_backend',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 op=request['op'];case=request.get('case','valid')
 if op=='config':
  source=b'project_id = "source-project"\n[api]\nport = 54321\n[db]\nport = 54322\n[auth]\nenabled = true\n'
  output=module.runtime_config(source,'t1-123-1')
  if case=='port':output=output.replace(b'54321',b'55421')
  if case=='other':output=output.replace(b'enabled = true',b'enabled = false')
  if case=='duplicate':output+=b'\nproject_id = "second"\n'
  if case=='project':output=output.replace(b't1-123-1',b't1-999-1')
  module.check_config(source,output,'t1-123-1');result={'projectOnly':output.replace(b't1-123-1',b'source-project')==source}
 elif op=='capacity':
  module.check_capacity(request['driver'],request['bytes']);result={'admitted':True}
 elif op=='binding':
  actual={'Id':'a'*64,'Running':True,'Labels':{'com.supabase.cli.project':'t1-123-1'},'Ports':{'5432/tcp':[{'HostIp':'127.0.0.1','HostPort':'54322'}]},'Networks':{'project':{'NetworkID':'b'*64}}}
  if case=='id':actual['Id']='c'*64
  if case=='project':actual['Labels']['com.supabase.cli.project']='foreign'
  if case=='stopped':actual['Running']=False
  if case=='wildcard':actual['Ports']['5432/tcp'][0]['HostIp']='0.0.0.0'
  if case=='ipv6':actual['Ports']['5432/tcp'].append({'HostIp':'::','HostPort':'54322'})
  if case=='port':actual['Ports']['5432/tcp'][0]['HostPort']='55422'
  if case=='network':actual['Networks']['project']['NetworkID']='c'*64
  module.check_container(actual,'a'*64,'t1-123-1','b'*64,{'5432/tcp':54322});result={'admitted':True}
 elif op=='smoke':
  assertions=[{'title':name+' real infrastructure observation','status':'passed','failureMessages':[]} for name in ['T1SMOKE.01','T1SMOKE.02','T1SMOKE.03']]
  if case=='missing':assertions.pop()
  if case=='duplicate':assertions.append(dict(assertions[0]))
  if case=='unknown':assertions[0]['title']='MAIN03.01 forged business credit'
  if case=='skipped':assertions[1]['status']='pending'
  if case=='failed':assertions[1]['status']='failed'
  raw={'success':True,'numTotalTests':len(assertions),'numPassedTests':3,'numFailedTests':0,'numPendingTests':0,'testResults':[{'assertionResults':assertions}]}
  result=module.smoke_report(raw,17 if case=='exit' else 0)
 elif op=='private':
  with tempfile.TemporaryDirectory() as folder:
   target=pathlib.Path(folder)/'assignment.json';target.write_text('{}');target.chmod(0o600)
   if case=='mode':target.chmod(0o644)
   if case=='symlink':
    link=target.with_name('link.json');link.symlink_to(target);target=link
   module.private_path(str(target));result={'admitted':True}
 elif op=='publish':
  phases={name:{'status':'PASS','exitCode':0} for name in module.REQUIRED_PHASES}
  if case=='missing':del phases['build']
  if case=='not-run':phases['build']={'status':'NOT_RUN','exitCode':None}
  if case=='cleanup':phases['cleanup']={'status':'FAIL','exitCode':1}
  if case=='unknown':phases['replay']={'status':'OUTCOME_UNKNOWN','exitCode':None}
  if case=='boolean-exit':phases['replay']['exitCode']=False
  result=module.qualify_phases(phases,None if case=='no-primary' else 0)
 elif op=='exclusive':
  with tempfile.TemporaryDirectory() as folder:
   target=pathlib.Path(folder)/'receipt.json';module.seal(target,{'original':True})
   try:module.seal(target,{'original':False})
   except FileExistsError:pass
   result=json.loads(target.read_text())
 elif op=='phase':
  import subprocess
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);(root/'phases').mkdir(mode=0o700)
   if case=='interrupted':
    code="import importlib.util,pathlib,os,sys;s=importlib.util.spec_from_file_location('m',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.phase(pathlib.Path(sys.argv[2]),'build',lambda:os._exit(17))"
    run=subprocess.run([sys.executable,'-c',code,str(path.resolve()),folder],check=False);result={'exit':run.returncode,'intent':(root/'phases/build.intent.json').exists(),'final':(root/'phases/build.json').exists()}
   else:
    def operation():
     if case=='failed':raise RuntimeError('injected failure')
    try:module.phase(root,'build',operation)
    except RuntimeError:pass
    result=json.loads((root/'phases/build.json').read_text())
 elif op=='driver':
  import subprocess
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);(root/'scripts').mkdir();(root/'driver.sh').write_text(module.replay_driver())
   source="cleanup(){ printf '%s\\n' \"$LOCAL_STACK_START_ATTEMPTED\" >> \"$1/cleanups\"; }; trap cleanup EXIT\n"
   # The function uses a fixed controlled output; a sourced function has its own positional args.
   source="cleanup(){ printf '%s\\n' \"$LOCAL_STACK_START_ATTEMPTED\" >> "+__import__('shlex').quote(str(root/'cleanups'))+"; }; trap cleanup EXIT\n"
   source+='LOCAL_STACK_START_ATTEMPTED=1\n'+('false\n' if case=='failed' else 'true\n')
   (root/'scripts/gridex-aud-003-clean-replay.sh').write_text(source)
   run=subprocess.run(['bash',str(root/'driver.sh'),folder],check=False,capture_output=True)
   result={'exit':run.returncode,'cleanupCalls':(root/'cleanups').read_text().splitlines()}
 elif op=='environment':
  with tempfile.TemporaryDirectory() as folder:
   module.PRIVATE_TOOL_HOME=pathlib.Path(folder);os.environ['GH_TOKEN']='synthetic-github-token';os.environ['AWS_SECRET_ACCESS_KEY']='synthetic-provider-secret'
   child=module.command(['/usr/bin/env']).decode().splitlines();values=dict(line.split('=',1) for line in child)
   result={'privateHome':values['HOME']==folder,'github':'GH_TOKEN' in values,'provider':'AWS_SECRET_ACCESS_KEY' in values,'globalGit':values['GIT_CONFIG_GLOBAL']}
 elif op=='dotenv':
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);(root/'.env.production.local').write_text('UNASSIGNED=true')
   module.git=lambda _root,*args: 'a'*40 if args==('rev-parse','HEAD') else ('b'*40 if args==('rev-parse','HEAD^{tree}') else '')
   module.clean_source(root,'a'*40,'b'*40);result={'accepted':True}
 elif op=='redirect':
  module.NoRedirect().redirect_request(None,None,302,'Found',{},'https://unassigned.invalid/');result={'accepted':True}
 elif op=='timeout':
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);module.PRIVATE_TOOL_HOME=root
   code="import os,pathlib,subprocess,sys,time;child=subprocess.Popen(['sleep','30']);pathlib.Path(sys.argv[1]).write_text(str(os.getpgrp())+' '+str(child.pid));time.sleep(30)"
   try:module.command([sys.executable,'-c',code,str(root/'pids')],timeout=.4)
   except RuntimeError as error:message=str(error)
   group=int((root/'pids').read_text().split()[0]);result={'error':message,'remaining':module.group_members(group)}
 elif op=='smoke-timeout':
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);module.PRIVATE_TOOL_HOME=root
   for name in ['phases','raw','reports']:(root/name).mkdir(mode=0o700)
   app=root/'app';harness=root/'harness';(app/'node_modules/.bin').mkdir(parents=True);(harness/module.SMOKE).parent.mkdir(parents=True)
   (harness/module.SMOKE).write_text('controlled smoke source');descriptor=root/'assignment.json';module.seal(descriptor,{})
   a={'appDir':str(app),'harnessDir':str(harness),'simHome':folder,'smokeSha256':module.sha((harness/module.SMOKE).read_bytes())};r={'allowedSmokeSourceSha256':a['smokeSha256']}
   module.verify=lambda *_args:(a,r,{})
   os.environ.update({key:'controlled-context' for key in ['GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_JOB','GITHUB_ACTOR','GITHUB_REPOSITORY','GITHUB_EVENT_PATH']})
   executable=app/'node_modules/.bin/vitest'
   executable.write_text('#!'+sys.executable+'\nimport os,pathlib,subprocess,time\nsubprocess.Popen(["sleep","30"])\npathlib.Path('+repr(str(root/'group'))+').write_text(str(os.getpgrp()))\ntime.sleep(30)\n');executable.chmod(0o700)
   owned_command=module.command
   def short_command(*args,**kwargs):kwargs['timeout']=.4;return owned_command(*args,**kwargs)
   module.command=short_command;failure=None
   try:module.run_smoke(str(descriptor),str(harness/module.SMOKE),'startup-smoke',str(root/'reports/startup-smoke.json'))
   except RuntimeError as error:failure=str(error)
   group=int((root/'group').read_text());result={'error':failure,'remaining':module.group_members(group),'phase':module.read_json(root/'phases/smoke.json')['status'],'published':(root/'reports/startup-smoke.json').exists()}
 elif op=='cleanup':
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);(root/'phases').mkdir(mode=0o700);actions=[]
   a={'simHome':folder,'projectId':'t1-123-1','appDir':str(root/'app')};module.admission=lambda *_args,**_kwargs:a
   descriptor=root/'admission.json';descriptor.write_text('{}');descriptor.chmod(0o600)
   initial={'daemon':{'id':'daemon'},'inventory':{'containers':['c'*64],'networks':['d'*64],'volumes':['preexisting']}}
   network={'Id':'b'*64};container={'Id':'a'*64,**{key:key for key in ['Labels','Image','Name','Created','Networks','Mounts']}};volume={'Name':'owned'}
   for name,value in [('initial.json',initial),('network.json',network),('resources.json',{'containers':[container],'volumes':[volume]})]:module.seal(root/name,value)
   before={'containers':sorted(['a'*64,'c'*64]),'networks':sorted(['b'*64,'d'*64]),'volumes':['owned','preexisting']}
   if case=='unknown':before['containers'].append('e'*64)
   module.inventory=lambda:initial['inventory'] if actions else before
   module.daemon=lambda:{'id':'changed' if case=='daemon' else 'daemon'}
   module.stop_app=lambda _a:None
   module.inspect_container=lambda _id:{**container,'Image':'foreign'} if case=='container' else container
   module.volume_identity=lambda _name:{'Name':'foreign'} if case=='volume' else volume
   module.network_identity=lambda _id:{'Id':'foreign'} if case=='network' else network
   module.docker=lambda *args:actions.append(list(args))
   failure=None
   try:module.cleanup(str(descriptor))
   except RuntimeError as error:failure=str(error)
   result={'actions':actions,'error':failure,'clean':(root/'cleanup.json').exists()}
 elif op=='startup':
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);module.PRIVATE_TOOL_HOME=root;(root/'phases').mkdir(mode=0o700);(root/'private').mkdir(mode=0o700)
   a={'simHome':folder,'projectId':'t1-123-1','appDir':str(root/'app')};module.verify=lambda *_args:(a,{},{});module.seal(root/'private/app-values.json',{})
   class FakeProcess:
    pid=123
    def poll(self):return None
   module.subprocess.Popen=lambda *_args,**_kwargs:FakeProcess()
   birth={'pid':123,'startTicks':1,'exe':str(pathlib.Path(module.shutil.which('node')).resolve()),'cwd':a['appDir'],'cmdlineSha256':'a'*64}
   module.process_identity=lambda *_args:birth
   observed=[]
   def no_ready(*_args,**_kwargs):
    observed.append((root/'t1-123-1/app-process.json').exists());raise RuntimeError('runtime_http_redirect')
   module.local_open=no_ready
   original_seal=module.seal
   def fail_birth(target,value):
    if case=='birth' and pathlib.Path(target).name=='app-process.json':raise OSError('controlled receipt write failure')
    return original_seal(target,value)
   module.seal=fail_birth;failure=None
   try:module.up('unused controlled assignment port')
   except Exception as error:failure=str(error)
   stop_error=None
   if case=='birth':
    try:module.stop_app(a)
    except RuntimeError as error:stop_error=str(error)
   result={'birthBeforeReadiness':observed,'ready':(root/'t1-123-1/app-ready.json').exists(),'birth':(root/'t1-123-1/app-process.json').exists(),'unknownBirthRefused':stop_error=='runtime_app_birth_unknown','error':failure}
 elif op=='entrypoints':
  import subprocess,shutil
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);track=root/'scripts/simulation/track1';track.mkdir(parents=True);runtime=track.parent/'runtime';runtime.mkdir()
   for name in ['lib.sh','packet.py','up.sh','run.sh','down.sh']:shutil.copyfile(pathlib.Path('scripts/simulation/track1')/name,track/name)
   # Declared helper IO port: this tests the real entrypoint routing, before
   # legacy replay/build/collision/scenario checks, without admitting a runtime.
   (runtime/'assigned_backend.py').write_text("import json,sys;print(json.dumps(sys.argv[1:]));raise SystemExit(31)\n")
   descriptor=root/'assignment.json';descriptor.write_text(json.dumps({'schema':'track1-runtime-assignment-v2','mode':'coordinator_prepared_fresh'}));descriptor.chmod(0o600)
   env={'PATH':os.environ['PATH'],'TRACK1_ASSIGNMENT_FILE':str(descriptor),'SIM_HOME':folder};rows=[]
   for action in ['up','run','down']:
    args=['bash',str(track/(action+'.sh'))]+(['/absent-scenario','startup-smoke'] if action=='run' else [])
    run=subprocess.run(args,env=env,capture_output=True,text=True,check=False)
    rows.append({'action':action,'exit':run.returncode,'delegated':json.loads(run.stdout)[0]})
   shutil.copyfile(path,runtime/'assigned_backend.py')
   admitted=subprocess.run(['python3',str(track/'packet.py'),'--admit','up'],env=env,capture_output=True,text=True,check=False)
   result={'routes':rows,'incompleteAdmissionRefused':admitted.returncode!=0,'noBytecodeCache':not list(root.rglob('__pycache__'))}
 elif op=='prepare':
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);home=root/'home';home.mkdir(mode=0o700);app=root/'app';app.mkdir();harness=root/'harness';harness.mkdir()
   for name in ['phases','raw','private','replay','cli','tool-home']:(home/name).mkdir(mode=0o700)
   (home/'cli/supabase').mkdir(mode=0o700);module.PRIVATE_TOOL_HOME=home/'tool-home'
   source=b'project_id = "source-project"\n[api]\nport = 54321\n[db]\nport = 54322\n'
   fp='f'*64
   replay_source='cleanup(){ printf "%s\\n" "$LOCAL_STACK_START_ATTEMPTED" >> '+__import__('shlex').quote(str(home/'cleanup-calls'))+'; }\ntrap cleanup EXIT\nLOCAL_STACK_START_ATTEMPTED=1\n'
   replay_source+=('exit 17\n' if case=='replay' else 'echo "schema fingerprint verified: '+fp+'"\necho "[GRIDEX-REM-002 replay] PASS: empty local Supabase"\n')
   files={'supabase/config.toml':source,'supabase/schema.sql':b'controlled schema','scripts/gridex-aud-003-clean-replay.sh':replay_source.encode(),'scripts/gridex-aud-003-schema-fingerprint.sql':b'controlled fingerprint','supabase/migrations/001.sql':b'controlled migration'}
   original={}
   for name,data in files.items():
    for base in [app,home/'replay']:
     target=base/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    original[name]={'mode':'100644','blob':'a'*40,'sha256':module.sha(data)}
   output=module.runtime_config(source,'t1-123-1');(home/'replay/supabase/config.toml').write_bytes(output)
   a={'simHome':str(home),'appDir':str(app),'harnessDir':str(harness),'carrierDir':str(root/'carrier'),'appCommit':'a'*40,'appTree':'b'*40,'harnessCommit':'c'*40,'harnessTree':'d'*40,'workflowCarrier':'e'*40,'workflowBlob':'f'*40,'projectId':'t1-123-1','ports':{'db':54322,'api':54321,'app':3101},'reservation':{'actual':'controlled runtime receipt'},'event':{'repository':module.REPO,'name':'pull_request','action':'opened','branch':'codex/t1-startup-smoke-native','runId':'123','job':'startup-smoke','jobId':321,'attempt':1,'actor':'coordinator'},'smokeSha256':'0'*64,'expiresAtUtc':'2099-01-01T00:00:00+00:00'}
   descriptor=home/'admission.json';module.seal(descriptor,a)
   for name,data in [('source-manifest.json',original),('runtime-config.json',{'generatedSha256':module.sha(output)}),('initial.json',{'daemon':{'id':'daemon'},'inventory':{'containers':[],'networks':['d'*64],'volumes':[]}})]:module.seal(home/name,data)
   module.seal(home/'source-config.original',source);module.seal(home/'cli/supabase/config.toml',output)
   actions=[];actual_command=module.command
   def fake_command(args,**kwargs):
    actions.append(args[:3])
    if args[0]=='bash':return actual_command(args,**kwargs)
    if args[:2]==['npm','ci']:(app/'node_modules').mkdir()
    if args[:3]==['npm','run','build']:
     if case=='build':raise RuntimeError('controlled build failure')
     (app/'.next').mkdir();(app/'.next/BUILD_ID').write_text('controlled-build')
    if args[0]=='supabase':return json.dumps({'API_URL':module.API_URL,'DB_URL':module.DB_URL,'ANON_KEY':'synthetic-anon-key-which-is-long','SERVICE_ROLE_KEY':'synthetic-service-key-which-is-long'}).encode()
    if kwargs.get('log'):module.seal(kwargs['log'],b'controlled command output')
    return b''
   module.command=fake_command;module.admission=lambda *_args,**_kwargs:a;module.clean_source=lambda *_args:app
   module.daemon=lambda:{'id':'daemon'}
   network={'Id':'b'*64,'Name':'supabase_network_t1-123-1','Options':{'com.docker.network.bridge.host_binding_ipv4':'127.0.0.1'}}
   module.network_identity=lambda _id:network;module.docker=lambda *args:'b'*64
   containers={}
   for idx,(role,prefix,ports) in enumerate([('database','supabase_db_',{'5432/tcp':54322}),('api','supabase_kong_',{'8000/tcp':54321}),('storage','supabase_storage_',{})]):
    identifier=str(idx+1)*64;containers[identifier]={'Id':identifier,'Name':'/'+prefix+'t1-123-1','Running':True,'Labels':{'com.supabase.cli.project':'t1-123-1'},'Networks':{'project':{'NetworkID':'b'*64}},'Ports':{key:[{'HostIp':'127.0.0.1','HostPort':str(value)}] for key,value in ports.items()}}
   module.inventory=lambda:{'containers':sorted(containers),'networks':['b'*64,'d'*64],'volumes':[]}
   module.inspect_container=lambda identifier:containers[identifier]
   module.http_json=lambda url,*_args:(200,[] if '/storage/' in url else {})
   observed={'databaseSystemIdentifier':'12345','serverMajor':17,'schemaFingerprint':fp,'schemaFingerprintScope':'partial controlled','ledgerMigrationsSha256':'9'*64,'ledgerMigrationsCount':2,'sourceSchemaSha256':module.sha(files['supabase/schema.sql']),'postReplayAppliedMigrations':0}
   module.observed_database=lambda _app:observed
   error=None
   try:module.prepare(str(descriptor),str(home/'assignment.json'))
   except RuntimeError as failure:error=str(failure)
   assignment=(home/'assignment.json').exists();prepared=(home/'prepared-runtime.json').exists()
   bound=assignment and module.read_json(home/'assignment.json')['preparedReceiptSha256']==module.sha((home/'prepared-runtime.json').read_bytes())
   result={'error':error,'assignment':assignment,'prepared':prepared,'hashBound':bound,'replays':sum(row[0]=='bash' for row in actions),'builds':sum(row==['npm','run','build'] for row in actions),'sourceRestored':(home/'replay/supabase/config.toml').read_bytes()==source,'cleanupCalls':(home/'cleanup-calls').read_text().splitlines()}
   if case.startswith('identity-'):
    prepared_data=module.read_json(home/'prepared-runtime.json')
    if case=='identity-produced':
     result={key:prepared_data[key] for key in ['runId','jobId','runAttempt']}
    else:
     # A normative prepared input isolates the consumer's tamper boundary;
     # the independent actual-producer case above checks the emitted bytes.
     prepared_data.update({'runId':'123','jobId':321,'runAttempt':1})
     if case=='identity-job-name':prepared_data['jobId']='startup-smoke'
     if case=='identity-job-number':prepared_data['jobId']=322
     if case=='identity-run':prepared_data['runId']='456'
     if case=='identity-attempt':prepared_data['runAttempt']=2
     if case=='identity-boolean-job':prepared_data['jobId']=True
     if case=='identity-boolean-attempt':prepared_data['runAttempt']=True
     if case=='identity-missing-job':prepared_data.pop('jobId')
     failure=None
     try:module.check_prepared_files(a,module.read_json(home/'assignment.json'),prepared_data)
     except RuntimeError as error:failure=str(error)
     result={'accepted':failure is None,'error':failure}
   if case.startswith('publish'):
    for name in module.REQUIRED_PHASES:
     target=home/'phases'/ (name+'.json')
     if not target.exists():module.seal(target,{'status':'PASS','exitCode':0})
    (home/'reports').mkdir(mode=0o700);(home/a['projectId']).mkdir(mode=0o700)
    module.seal(home/a['projectId']/'stack.json',{'assignmentSha256':module.sha((home/'assignment.json').read_bytes())})
    assertions=[{'title':name+' controlled actual-code observation','status':'passed'} for name in ['T1SMOKE.01','T1SMOKE.02','T1SMOKE.03']]
    raw={'success':True,'numTotalTests':3,'numPassedTests':3,'numFailedTests':0,'numPendingTests':0,'testResults':[{'assertionResults':assertions}]}
    report=module.smoke_report(raw,0)
    if case=='publish-report':report['observations']=['MAIN03.01']
    module.seal(home/'raw/vitest.json',raw);module.seal(home/'smoke-exit.json',{'exitCode':0});module.seal(home/'reports/startup-smoke.json',report)
    module.seal(home/'cleanup.json',{'clean':True})
    if case!='publish-primary':module.seal(home/'primary-exit.json',{'exitCode':False if case=='publish-boolean' else 0})
    if case=='publish-unknown':(home/'phases/replay.json').write_text(json.dumps({'status':'OUTCOME_UNKNOWN','exitCode':None}))
    if case=='publish-sensitive':a['event']['actor']=str(home)
    if case=='publish-missing-prepared':(home/'prepared-runtime.json').unlink()
    publish_error=None
    try:module.publish_safe(str(descriptor),0)
    except Exception as failure:publish_error=str(failure)
    result={'published':(home/'safe/proof.json').exists(),'error':publish_error}
    if result['published']:result['proof']=module.read_json(home/'safe/proof.json')
 elif op in ('admission','site-admission'):
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);home=root/'home';home.mkdir(mode=0o700)
   for name in ['app','harness','carrier']:(root/name).mkdir()
   harness=root/'harness';(harness/'scripts/simulation/track1/scenarios').mkdir(parents=True);(harness/module.SMOKE).write_text('reviewed smoke')
   module.__file__=str(harness/'scripts/simulation/runtime/assigned_backend.py')
   event={'repository':module.REPO,'name':'pull_request','action':'opened','branch':'codex/t1-startup-smoke-native','runId':'123','job':'startup-smoke','jobId':321,'attempt':1,'actor':'coordinator'}
   eventfile=root/'event.json';eventfile.write_text(json.dumps({'action':'opened','pull_request':{'head':{'sha':'c'*40,'ref':event['branch'],'repo':{'full_name':module.REPO}}}}))
   os.environ.update({'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1','GITHUB_JOB':'startup-smoke','GITHUB_ACTOR':'coordinator','GITHUB_REPOSITORY':module.REPO,'GITHUB_EVENT_PATH':str(eventfile)})
   binary=root/'binary';binary.write_bytes(b'controlled fake executable bytes')
   versions={'node':'v22.23.4','npm':'10.9.2','supabase':'2.101.0','supabase-go':'2.101.0','psql':'psql 17.11','pg_dump':'pg_dump 17.11','docker':'28.0'}
   descriptor=home/'admission.json'
   a={'schema':'track1-hosted-producer-admission-v1','workerId':'codex-track1','exclusiveHost':True,'admissionFile':str(descriptor),'simHome':str(home),'expiresAtUtc':(module.now()+module.dt.timedelta(minutes=30)).isoformat(),'cleanupExpiresAtUtc':(module.now()+module.dt.timedelta(minutes=40)).isoformat(),'event':event,'budget':{'jobs':1,'replays':1,'builds':1,'appStarts':1,'smokes':1,'retries':0},'projectId':'t1-123-1','ports':{'db':54322,'api':54321,'app':3101},'appDir':str(root/'app'),'appCommit':'a'*40,'appTree':'b'*40,'harnessDir':str(harness),'harnessCommit':'d'*40,'harnessTree':'e'*40,'carrierDir':str(root/'carrier'),'workflowCarrier':'c'*40,'workflowTree':'f'*40,'workflowBlob':'7'*40,'smokeSha256':module.sha(b'reviewed smoke'),'requiredGenGates':{'qualified':True,'receiptSha256':'8'*64},'tools':{name:{'sha256':module.sha(binary.read_bytes()),'version':version} for name,version in versions.items()}}
   if op=='site-admission':
    event.update(branch='codex/t1-site-native',job='site-native')
    a.update(schema='track1-hosted-site-admission-v1',reportKind='site_native_v2',budget=dict(module.SITE_BUDGET),siteContract={'schema':'track1-site-native-contract-v1','inputEpoch':'site-native-input-v2','startConvention':'ediel-fixed-utc+01','sites':copy.deepcopy(module.SITE_EXPECTED),'businessBudgetSeconds':1800,'minAuthHeadroomSeconds':120,'producerId':'coordinator','outputDirectory':'site-native','sourceSha256':{p:module.SITE_REVIEWED_HASHES.get(p,'a'*64)for p in module.SITE_SOURCE_PATHS},'marketBoundsSourceSha256':'6573f66302a5900308e7a566569a1a389e854b682202f19a745f8ef0363adb06'})
    a['requiredGenGates']['applicability']={'schemaUnchanged':True,'typesUnchanged':True,'migrationsUnchanged':True}
    if case=='branch':event['branch']='codex/t1-startup-smoke-native'
    if case=='attempt':event['attempt']=2
    if case=='profile':a['reportKind']='infrastructure_smoke'
    if case=='site-budget':a['budget']['siteInvocations']=2
    if case=='cleanup-work-expired':a['expiresAtUtc']=(module.now()-module.dt.timedelta(seconds=1)).isoformat()
    eventfile.write_text(json.dumps({'action':'opened','pull_request':{'head':{'sha':'c'*40,'ref':event['branch'],'repo':{'full_name':module.REPO}}}}))
    os.environ['GITHUB_JOB']=event['job']
    module.check_site_sources=lambda _a:None
   refs=[module.PREFIX+'backend-test-t1',module.PREFIX+'producer-test-t1'];source_refs=[module.PREFIX+'slot-session-test']+[module.PREFIX+'file-'+module.sha(name.encode()) for name in module.SOURCE_PATHS]
   source={'base':'0'*40,'files':list(module.SOURCE_PATHS),'operation':'Reserve source files and rule IDs'}
   if op=='site-admission':
    source['files']=sorted(set(module.SOURCE_PATHS+module.SITE_SOURCE_PATHS));source_refs=[module.PREFIX+'slot-session-test']+[module.PREFIX+'file-'+module.sha(name.encode())for name in source['files']];source['operation']='Reserve source files and rule IDs; resources-sha256='+module.sha('\n'.join(sorted(source_refs)).encode())
    if case=='source-capsule':source['operation']+='changed'
   a['sourceClaims']=[{'receipt':'2'*40,'expectedNeutral':source,'refs':source_refs}]
   core=copy.deepcopy(a);attempt={key:a[key] for key in ['event','appCommit','appTree','harnessCommit','harnessTree','workflowCarrier','workflowBlob']}
   fields={'resources-sha256':module.sha(('\n'.join(sorted(refs))+'\n').encode()),'inputs-sha256':module.sha(module.encoded(attempt)),'admission-core-sha256':module.sha(module.encoded(core)),**{key:a[key] for key in ['appCommit','appTree','harnessCommit','harnessTree','workflowCarrier','workflowBlob']}}
   if op=='site-admission':fields['site-contract-sha256']=module.sha(module.encoded(a['siteContract']))
   neutral={'base':'0'*40,'files':[],'operation':('simulation-t1-site-native-v2; ' if op=='site-admission' else 'simulation-t1-startup-smoke-v1; ')+'; '.join(key+'='+value for key,value in fields.items())}
   a['reservation']={'refs':refs,'receipt':'1'*40,'expectedNeutral':neutral}
   if case=='namespace':neutral['operation']=neutral['operation'].replace('simulation-t1-startup-smoke-v1','contrl-native-v1')
   if case=='source-receipt':neutral['files']=['source.ts']
   if case=='gate':a['requiredGenGates']['qualified']=False
   if case=='expired':a['expiresAtUtc']=(module.now()-module.dt.timedelta(seconds=1)).isoformat()
   descriptor.write_text(json.dumps(a));descriptor.chmod(0o600)
   module.clean_source=lambda directory,*_args:pathlib.Path(directory)
   module.git=lambda *_args:'7'*40
   module.shutil.which=lambda _name:str(binary)
   module.command=lambda args,**_kwargs:versions['docker' if args[1]=='version' else next(name for name in versions if a['tools'][name]['version']==getattr(module,'testing_version','v22.23.4'))].encode()
   # Version reads occur in admission tools order; data never executes.
   observed_versions=iter(versions.values());module.command=lambda *_args,**_kwargs:next(observed_versions).encode()
   def fake_api(endpoint):
    if endpoint=='actions/runs/123':return {'id':123,'run_attempt':1,'event':'pull_request','head_sha':'c'*40,'path':module.WORKFLOW,'status':'in_progress'}
    if endpoint.startswith('actions/runs/123/attempts/1/jobs'):return {'jobs':[{'name':event['job'],'id':999 if case=='job' else 321,'status':'in_progress'}]}
    if endpoint.startswith('git/ref/'):
     ref='refs/'+endpoint.removeprefix('git/ref/');receipt='1'*40 if ref in refs else '2'*40
     if case=='pair' and ref==refs[1]:receipt='9'*40
     return {'ref':ref,'object':{'sha':receipt}}
    commit=endpoint.removeprefix('git/commits/')
    if commit=='0'*40:return {'tree':{'sha':'3'*40}}
    data=neutral if commit=='1'*40 else source
    return {'message':json.dumps(data),'parents':[{'sha':'0'*40}],'tree':{'sha':'3'*40}}
   module.api=fake_api
   module.admission(str(descriptor),teardown=case=='cleanup-work-expired');result={'accepted':True}
 else:raise RuntimeError('unknown test operation')
 print(json.dumps({'error':None,'result':result}))
except Exception as error:print(json.dumps({'error':str(error),'result':None}))
`
function probe(input: Record<string, unknown>) {
  return JSON.parse(execFileSync('python3', ['-c', python, JSON.stringify(input)], {
    encoding: 'utf8', timeout: 10_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  })) as { error: string | null; result: Record<string, unknown> | null }
}

describe('T1 assigned hosted infrastructure contract', () => {
  it('changes only the centrally declared project identity and preserves source configuration', () => {
    expect(probe({ op: 'config' })).toEqual({ error: null, result: { projectOnly: true } })
  })
  it.each(['port', 'other', 'duplicate', 'project'])('refuses runtime configuration %s drift', change => {
    expect(probe({ op: 'config', case: change }).error).toBe('runtime_config_diff')
  })
  it.each([
    ['overlay2', 15, true], ['overlayfs', 15, true], ['vfs', 40, true],
    ['overlay2', 14, false], ['vfs', 39, false], ['unknown', 100, false],
  ] as const)('enforces actual %s capacity %s GiB', (driver, gib, accepted) => {
    expect(probe({ op: 'capacity', driver, bytes: gib * 1024 ** 3 }).error)
      .toBe(accepted ? null : 'runtime_capacity')
  })
  it('binds the actual assigned container, project, network and loopback port', () => {
    expect(probe({ op: 'binding' })).toEqual({ error: null, result: { admitted: true } })
  })
  it.each(['id', 'project', 'stopped', 'wildcard', 'ipv6', 'port', 'network'])('rejects actual container %s mismatch', change => {
    expect(probe({ op: 'binding', case: change }).error).toBe('runtime_container_identity')
  })
  it('keeps all smoke observations outside the canonical campaign scenario map', () => {
    const result = probe({ op: 'smoke' })
    expect(result.error).toBeNull()
    expect(result.result).toMatchObject({ kind: 'infrastructure_smoke', qualified: true, scenarios: {}, new105ScenarioPassAttestations: 0 })
  })
  it.each(['missing', 'duplicate', 'unknown', 'skipped', 'failed', 'exit'])('never qualifies %s smoke results', change => {
    expect(probe({ op: 'smoke', case: change }).error).toBe('runtime_smoke_not_qualified')
  })
  it('accepts an owned canonical mode0600 private input', () => {
    expect(probe({ op: 'private' })).toEqual({ error: null, result: { admitted: true } })
  })
  it.each(['mode', 'symlink'])('rejects unsafe private input %s', change => {
    expect(probe({ op: 'private', case: change }).error).toBe('runtime_private_path')
  })
  it('qualifies only complete actual stage receipts with zero primary exit', () => {
    expect(probe({ op: 'publish' })).toEqual({ error: null, result: { qualified: true, new105ScenarioPassAttestations: 0 } })
  })
  it.each(['missing', 'not-run', 'cleanup', 'unknown', 'boolean-exit', 'no-primary'])('refuses publication qualification with %s proof', change => {
    expect(probe({ op: 'publish', case: change }).result).toEqual({ qualified: false, new105ScenarioPassAttestations: 0 })
  })
  it('preserves the first exclusively published receipt', () => {
    expect(probe({ op: 'exclusive' }).result).toEqual({ original: true })
  })
  it('records actual successful and failed stage outcomes', () => {
    expect(probe({ op: 'phase' }).result).toMatchObject({ status: 'PASS', exitCode: 0 })
    expect(probe({ op: 'phase', case: 'failed' }).result).toMatchObject({ status: 'FAIL', exitCode: 1 })
  })
  it('leaves an abrupt producer exit unknown without a fabricated final receipt', () => {
    expect(probe({ op: 'phase', case: 'interrupted' }).result).toEqual({ exit: 17, intent: true, final: false })
  })
  it.each(['valid', 'failed'])('delegates the real Bash EXIT trap exactly once for %s replay', change => {
    expect(probe({ op: 'driver', case: change }).result).toEqual({ exit: change === 'failed' ? 1 : 0, cleanupCalls: ['0'] })
  })
  it('uses a private child home and excludes synthetic GitHub/provider secrets', () => {
    expect(probe({ op: 'environment' }).result).toEqual({ privateHome: true, github: false, provider: false, globalGit: '/dev/null' })
  })
  it('refuses ignored Next dotenv inputs even when Git status is clean', () => {
    expect(probe({ op: 'dotenv' }).error).toBe('runtime_ambient_dotenv')
  })
  it('refuses a local HTTP redirect without contacting its foreign target', () => {
    expect(probe({ op: 'redirect' }).error).toBe('runtime_http_redirect')
  })
  it('terminates the actual harmless timed-out command session including its child', () => {
    expect(probe({ op: 'timeout' }).result).toEqual({ error: 'runtime_command_timeout', remaining: [] })
  })
  it('terminates the actual fake-Vitest worker session before leaving smoke outcome unknown', () => {
    expect(probe({ op: 'smoke-timeout' }).result).toEqual({ error: 'runtime_command_timeout', remaining: [], phase: 'OUTCOME_UNKNOWN', published: false })
  })
  it('removes only preflighted exact resources and preserves the preexisting inventory', () => {
    expect(probe({ op: 'cleanup' }).result).toEqual({ actions: [['rm', '--force', 'a'.repeat(64)], ['volume', 'rm', 'owned'], ['network', 'rm', 'b'.repeat(64)]], error: null, clean: true })
  })
  it.each(['unknown', 'daemon', 'container', 'volume', 'network'])('performs no destructive cleanup after %s mismatch', change => {
    const result = probe({ op: 'cleanup', case: change })
    expect(result.error).toBeNull()
    expect(result.result).toMatchObject({ actions: [], clean: false })
    expect(result.result?.error).toMatch(/^runtime_/)
  })
  it('admits only the complete actual-code coordinator/runtime-pair interface', () => {
    expect(probe({ op: 'admission' })).toEqual({ error: null, result: { accepted: true } })
  })
  it.each(['namespace', 'source-receipt', 'gate', 'expired', 'job', 'pair'])('refuses %s runtime authority', change => {
    expect(probe({ op: 'admission', case: change }).error).toMatch(/^runtime_/)
  })
  it('runs one controlled real-driver replay/build sequence and only then seals the hash-bound assignment', () => {
    expect(probe({ op: 'prepare' })).toEqual({ error: null, result: { error: null, assignment: true, prepared: true, hashBound: true, replays: 1, builds: 1, sourceRestored: true, cleanupCalls: ['0'] } })
  })
  it.each(['replay', 'build'])('never seals a prepared receipt or assignment after %s failure', change => {
    const result = probe({ op: 'prepare', case: change })
    expect(result.error).toBeNull()
    expect(result.result).toMatchObject({ assignment: false, prepared: false, hashBound: false, replays: 1, builds: change === 'replay' ? 0 : 1, sourceRestored: true, cleanupCalls: ['0'] })
    expect(result.result?.error).toBeTruthy()
  })
  it('seals the actual run, numeric job and attempt identity from producer admission', () => {
    expect(probe({ op: 'prepare', case: 'identity-produced' })).toEqual({ error: null, result: { runId: '123', jobId: 321, runAttempt: 1 } })
  })
  it('accepts correctly bound prepared execution identity', () => {
    expect(probe({ op: 'prepare', case: 'identity-valid' })).toEqual({ error: null, result: { accepted: true, error: null } })
  })
  it.each(['job-name', 'job-number', 'run', 'attempt', 'boolean-job', 'boolean-attempt', 'missing-job'])('rejects prepared execution identity %s drift', change => {
    expect(probe({ op: 'prepare', case: `identity-${change}` })).toEqual({ error: null, result: { accepted: false, error: 'runtime_prepared_job_identity' } })
  })
  it('seals the app birth before a controlled readiness failure', () => {
    expect(probe({ op: 'startup' }).result).toMatchObject({ birthBeforeReadiness: [true], birth: true, ready: false, error: 'runtime_http_redirect' })
  })
  it('refuses cleanup qualification after an unrecorded app birth', () => {
    expect(probe({ op: 'startup', case: 'birth' }).result).toMatchObject({ birthBeforeReadiness: [], birth: false, ready: false, unknownBirthRefused: true })
  })
  it('routes all three actual prepared entrypoints before legacy replay/build/scenario/stop paths', () => {
    expect(probe({ op: 'entrypoints' }).result).toEqual({ routes: ['up', 'run', 'down'].map(action => ({ action, exit: 31, delegated: action })), incompleteAdmissionRefused: true, noBytecodeCache: true })
  })
  it('publishes only the constructed fully bound infrastructure proof', () => {
    const result = probe({ op: 'prepare', case: 'publish' })
    expect(result.error).toBeNull()
    expect(result.result).toMatchObject({ published: true, error: null, proof: { qualified: true, kind: 'infrastructure_smoke', scenarios: {}, new105ScenarioPassAttestations: 0 } })
  })
  it.each(['primary', 'boolean', 'unknown', 'report', 'sensitive', 'missing-prepared'])('retains only an unqualified incident and nonzero result for %s evidence', change => {
    const result = probe({ op: 'prepare', case: `publish-${change}` })
    expect(result.error).toBeNull()
    expect(result.result).toMatchObject({ published: true, proof: { qualified: false, scenarios: {}, new105ScenarioPassAttestations: 0, reason: 'INCOMPLETE_OR_FAILED_PROOF' } })
    expect(JSON.stringify(result.result?.proof)).not.toMatch(/synthetic-service|synthetic-anon|\/tmp\//)
    expect(result.result?.error).toBeTruthy()
  })
  it('loads the actual preserved Vitest config in a separate harness using the declared dependency link', () => {
    const root = mkdtempSync(path.join(tmpdir(), 't1-config-control-'))
    try {
      const harness = path.join(root, 'harness')
      const app = path.join(root, 'app')
      const scenarios = path.join(harness, 'scripts/simulation/track1/scenarios')
      mkdirSync(scenarios, { recursive: true })
      mkdirSync(app)
      symlinkSync(realpathSync('node_modules'), path.join(app, 'node_modules'), 'dir')
      symlinkSync(path.join(app, 'node_modules'), path.join(harness, 'node_modules'), 'dir')
      copyFileSync('scripts/simulation/track1/vitest.config.mts', path.join(scenarios, '../vitest.config.mts'))
      copyFileSync('scripts/simulation/track1/scenarios/smoke.test.ts', path.join(scenarios, 'smoke.test.ts'))
      const listing = execFileSync(process.execPath, [path.resolve('node_modules/vitest/vitest.mjs'), 'list',
        '--config', path.join(scenarios, '../vitest.config.mts'), '--root', harness, '--maxWorkers=1', '--json',
      ], { encoding: 'utf8', timeout: 20_000, env: { PATH: process.env.PATH, HOME: root, CI: '1', TRACK1_APP_DIR: app } })
      const tests = JSON.parse(listing) as { name: string }[]
      expect(tests).toHaveLength(3)
      expect(tests.map(test => test.name.match(/T1SMOKE\.0[123]/)?.[0]).sort()).toEqual(['T1SMOKE.01', 'T1SMOKE.02', 'T1SMOKE.03'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 25_000)
})

// Execute the actual registered callback with finite ports. In particular,
// stable graph reads cannot authorize the second effect on their own.
async function nativeRetryCallback(permit: boolean, abort = true) {
  const tests = new Map<string, () => Promise<void>>(), before: Array<() => Promise<void>> = []
  let graphs = 0, posts = 0, requestedPermit = 0, correlated = false
  const fixture = { params: { billingMonth: '2027-02' }, companyId: 'synthetic-company', session: {}, oracle: { intervals: [], perDay: [], lines: {}, vatCents: {} }, days: [] }
  const ports: Record<string, unknown> = {
    vitest: { describe: (_: string, fn: () => void) => fn(), it: (name: string, fn: () => Promise<void>) => tests.set(name, fn),
      beforeAll: (fn: () => Promise<void>) => before.push(fn), afterAll: () => {}, expect, vi: { mock: () => {} } },
    '@/lib/supabase/service': {}, '@/lib/billing/sourceBasis': {},
    '../fixtures/main03Fixture': { buildMain03Fixture: async () => fixture, DEFAULT_MAIN03_PARAMS: fixture.params },
    '../fixtures/substitutions': { SUBSTITUTIONS: [], resetSubstitutions: () => {} }, '../fixtures/synthetic': {},
        '../fixtures/main03Cohort': { beginMain03CohortFromEnv: async () => ({ fixtureParams: fixture.params, admission: { operationId: '00000000-0000-4000-8000-000000000001' } }), captureMain03Candidate: async () => {},
      awaitMain03RetryPermit: async () => { requestedPermit++; if (!permit) throw new Error('cohort_hold:native_resolution_required') } },
    '../fixtures/runtime': { lit: JSON.stringify, writeArtifact: () => {}, TIMINGS: [], timed: async (_: string, fn: () => Promise<unknown>) => fn(), sleep: async () => {},
      dbRead: () => { const count = ++graphs === 1 ? 0 : 1; return { underlays: count, underlayIds: count ? ['synthetic-underlay'] : [], items: count * 2688, events: count ? 3 : 0, bindings: count, periodLocks: 0, pricingRuns: 0 } },
      http: async (_: unknown, method: string, _route: string, init?: { abortAfterMs?: number; headers?: Record<string, string> }) => {
        if (method === 'GET') return { status: 200, body: { data: { isLocked: false, lock: null } }, ms: 1, aborted: false }
        posts++; if (init?.abortAfterMs) correlated = init.headers?.['X-Request-ID'] === '00000000-0000-4000-8000-000000000001'
        if (init?.abortAfterMs) return { status: abort ? 0 : 200, body: null, ms: abort ? 400 : 20, aborted: abort }
        return { status: 200, body: {}, ms: 1, aborted: false }
      } },
  }
  const source = readFileSync('scripts/simulation/track1/scenarios/main03.test.ts', 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'exports', code)((name: string) => { if (!Object.hasOwn(ports, name)) throw new Error(`undeclared callback import ${name}`); return ports[name] }, {})
  for (const fn of before) await fn()
  const callback = [...tests].find(([name]) => name.startsWith('MAIN03.05 '))?.[1]
  if (!callback) throw new Error('actual MAIN03.05 callback absent')
  let error: unknown
  try { await callback() } catch (caught) { error = caught }
  return { error, posts, requestedPermit, correlated }
}

describe('phased native resolution before the actual retry', () => {
  it('holds before retry despite a stable graph when native resolution is absent', async () => {
    const result = await nativeRetryCallback(false)
    expect(result.error).toBeTruthy(); expect(result.posts).toBe(1); expect(result.requestedPermit).toBe(1)
  })
  it('permits only the original second effect after the reviewed gate', async () => {
    const result = await nativeRetryCallback(true)
    expect(result.error).toBeUndefined(); expect(result.posts).toBe(2); expect(result.requestedPermit).toBe(1); expect(result.correlated).toBe(true)
  })
  it('rejects a fast first response before asking for a permit', async () => {
    const result = await nativeRetryCallback(true, false)
    expect(result.error).toBeTruthy(); expect(result.posts).toBe(1); expect(result.requestedPermit).toBe(0)
  })
})

const phasedPython = String.raw`
import copy,importlib.util,json,pathlib,sys,tempfile,os,subprocess,time,uuid,socket,threading,types
os.umask(0o077)
request=json.loads(sys.argv[1]);spec=importlib.util.spec_from_file_location('adapter','scripts/simulation/runtime/assigned_backend.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
case=request['case'];op=request['op'];result={};processes=[]
try:
 with tempfile.TemporaryDirectory() as folder:
  root=pathlib.Path(folder);root.chmod(0o700);m.PRIVATE_TOOL_HOME=root
  def put(name,value):
   p=root/name;p.parent.mkdir(mode=0o700,parents=True,exist_ok=True);m.seal(p,value);return p
  def child(code='import time;time.sleep(30)',stdin=None):
   p=subprocess.Popen([sys.executable,'-c',code],cwd=root,start_new_session=True,stdin=stdin,stdout=subprocess.PIPE,stderr=subprocess.PIPE);processes.append(p);return p
  if op=='native':
   leader=child();birth=m.proc_birth(leader.pid);correlation=str(uuid.uuid4());attempt=str(uuid.uuid4());boot=str(uuid.uuid4())
   events=[dict(schema=m.NATIVE_SCHEMA,route='/api/internal/billing/generate-underlay',method='POST',correlationId=correlation,attemptId=attempt,bootId=boot,pid=leader.pid,event=event,sequence=n+1,elapsedMs=n*400,engineState='fulfilled'if n==2 else'pending',status=200 if n==2 else None,abortWhilePending=n==1,thrown=False)for n,event in enumerate(['started','client_disconnected','terminal'])]
   if case=='already-aborted':events[1]['abortWhilePending']=False
   if case=='no-disconnect':events.pop(1)
   if case=='duplicate':events.append(dict(events[-1]))
   if case=='rejected':events[-1].update(engineState='rejected',status=500)
   if case=='construction-error':events[-1]['status']=500
   if case=='thrown':events[-1]['thrown']=True
   if case=='not-entered':events=[dict(events[-1],engineState='not_entered',status=403,sequence=1)]
   if case=='different-attempt':events[-1]['attemptId']=str(uuid.uuid4())
   if case=='boot-drift':events[-1]['bootId']=str(uuid.uuid4())
   if case=='clock-order':events[-1]['elapsedMs']=1
   if case=='sequence':events[-1]['sequence']=4
   if case=='route':events[0]['route']='/other'
   if case=='old-wire':events[1]['event']='client_disconnect'
   if case=='foreign-process':
    foreign=child()
    for event in events:event['pid']=foreign.pid
   if case=='reused-birth':birth['startTicks']='0'
   native=m.native_resolution('\n'.join(json.dumps(event)for event in events),correlation,birth,str(root));result={'status':native['status'],'sameActualPid':native['worker']['pid']==leader.pid}
  elif op=='peer':
   process=child();birth=m.proc_birth(process.pid);pid=process.pid;uid=os.getuid();cwd=str(root)
   if case=='reused':birth['startTicks']='0'
   if case=='uid':uid+=1
   if case=='foreign':pid=child().pid
   if case=='cwd':cwd=str(root/'foreign')
   if case=='dead':process.terminate();process.wait()
   observed=m.phase_peer(pid,uid,birth,cwd);result={'same':observed['pid']==process.pid}
  elif op=='ipc':
   target=root/'phase.sock';server=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);server.bind(str(target));target.chmod(0o600);server.listen(2);server.settimeout(2)
   nonce='a'*64;doc={'schema':'track1-cohort-business-admission-v2','phase':'MAIN03_CANDIDATE','privateHome':str(root),'runId':'123','operationId':'operation','expiresAtUtc':m.dt.datetime.fromtimestamp(time.time()+300,m.dt.timezone.utc).isoformat(),'phaseAdapter':{'schema':'track1-parent-custody-ipc-v1','nonce':nonce,'socketPath':str(target),'assignment':{'sha256':'b'*64},'deadlineAtMs':int((time.time()+180)*1000),'parent':m.proc_birth(os.getpid())}}
   if case=='node-parent-reuse':doc['phaseAdapter']['parent']['startTicks']='0'
   admission=put('cohort.json',doc)
   payload=dict(schema='track1-parent-custody-ipc-v1',action='CUSTODY',requestId=str(uuid.uuid4()),nonce=nonce,assignmentSha256='b'*64,admissionSha256=m.sha(admission.read_bytes()),runId='123',operationId='operation',phase='MAIN03_CANDIDATE',facts={})
   if case=='nonce':payload['nonce']='c'*64
   if case=='assignment':payload['assignmentSha256']='c'*64
   if case=='phase':payload['phase']='MAIN03_SEAL'
   if case=='action':payload['action']='RUN_SQL'
   script="import sys,json,socket;sys.stdin.read(1);s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.connect(sys.argv[1]);s.sendall((sys.argv[2]+'\\n').encode());s.shutdown(socket.SHUT_WR);out=b''\nwhile True:\n p=s.recv(65536)\n if not p:break\n out+=p\nprint(out.decode())"
   args=[sys.executable,'-c',script,str(target),json.dumps(payload)]
   if case.startswith('node-'):
    uri=pathlib.Path('scripts/simulation/track1/fixtures/main03Cohort.ts').resolve().as_uri()
    script="import fs from 'node:fs';process.stdin.once('data',async()=>{try{const m=await import("+json.dumps(uri)+");const a=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(JSON.stringify(await m.parentCustodyRequest(a,'CUSTODY',{})));}catch{process.exitCode=1;}});"
    args=['node','--input-type=module','-e',script,str(admission)]
   environment=dict(os.environ,TRACK1_COHORT_ADMISSION_SHA256=m.sha(admission.read_bytes()))
   process=subprocess.Popen(args,cwd=root,env=environment,start_new_session=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE);processes.append(process)
   parent=object.__new__(m.PhaseParent);parent.socket=server;parent.home=root;parent.journal=types.SimpleNamespace(anchor={'wall':time.time(),'mono':time.monotonic(),'deadline':time.time()+60});parent.a={'harnessDir':str(root),'event':{'runId':'123'}};parent.basis={'operationId':'operation'};parent.current_admission=admission;parent.nonce=nonce;parent.binding={'assignmentSha256':'b'*64};parent.child={'birth':m.proc_birth(process.pid),'workload':'OBSERVE'};parent.custody={};(root/'phase-requests').mkdir(mode=0o700);m.phase_custody=lambda a,c:{'custodySha256':'d'*64}
   process.stdin.write(b'x');process.stdin.flush()
   try:parent.service()
   finally:server.close()
   out,error=process.communicate(timeout=3);m.need(process.returncode==0,'runtime_phase_actual_client_rejected');result={'reply':json.loads(out),'exit':process.returncode,'requestCount':len(list((root/'phase-requests').glob('*.json')))}
  elif op in {'input','input-history'}:
   a={'event':{'runId':'123'},'phaseContract':{'producerId':'producer','coordinator':{'id':'root'},'reviewers':[{'id':'reviewerA','sessionRef':'sessionA'},{'id':'reviewerB','sessionRef':'sessionB'}],'absoluteDeadlineAtUtc':m.dt.datetime.fromtimestamp(time.time()+900,m.dt.timezone.utc).isoformat()}}
   checkpoint={'state':'BEFORE_RETRY','binding':{'C':'source'},'observation':{'native':{'status':200},'acceptedPreviousInputSha256':'e'*64}}
   reviews=[dict(schema='track1-independent-phase-review-v1',reviewerId=r['id'],sessionRef=r['sessionRef'],decision='APPROVE',ordinal=1,checkpointSha256=m.sha(m.encoded(checkpoint)),binding=checkpoint['binding'],next='RETRY_ONCE')for r in a['phaseContract']['reviewers']]
   value=dict(schema='track1-root-next-phase-input-v1',ordinal=1,next='RETRY_ONCE',previousInputSha256='e'*64,checkpointSha256=m.sha(m.encoded(checkpoint)),binding=checkpoint['binding'],coordinatorId='root',producerId='producer',notBeforeEpoch=int(time.time())-1,deadlineEpoch=int(time.time())+300,artifactId=7,artifactArchiveSha256='f'*64)
   artifact=dict(id=7,name='t1-phase-123-1',workflow_run={'id':123},expired=False,digest='sha256:'+'f'*64)
   if case=='previous':value['previousInputSha256']='0'*64
   if case=='ordinal':value['ordinal']=2
   if case=='command':value['next']='APPROVE_SEND'
   if case=='expired':value['deadlineEpoch']=int(time.time())-1
   if case=='future':value['notBeforeEpoch']=int(time.time())+60
   if case=='artifact-run':artifact['workflow_run']['id']=124
   if case=='artifact-digest':artifact['digest']='sha256:'+'0'*64
   if case=='artifact-expired':artifact['expired']=True
   if case=='producer-review':reviews[0]['reviewerId']='producer'
   if case=='same-reviewer':reviews[1]['reviewerId']=reviews[0]['reviewerId']
   if case=='deny':reviews[0]['decision']='DENY'
   if case=='future-terminal':reviews[0]['terminalProcessSha256']='0'*64
   if case=='unknown-argv':value['argv']=['rm','-rf','foreign']
   value['reviewPayloadSha256']=[m.sha(m.canonical_phase(review))for review in reviews]
   if case=='body-drift':value['reviewPayloadSha256'][0]='0'*64
   if op=='input-history':
    value.update(notBeforeEpoch=int(time.time())-100,deadlineEpoch=int(time.time())-50)
    kwargs={}if case=='live'else{'at':time.time()-75 if case=='valid'else time.time()}
   else:kwargs={}
   result={'next':m.validate_phase_input(a,checkpoint,value,reviews,artifact,'e'*64,**kwargs)}
  elif op=='forged-local':
   (root/'phase-inputs').mkdir(mode=0o700);checkpoint={'state':'BEFORE_RETRY','binding':{},'observation':{}};put('phase-inputs/1.json',{'previousInputSha256':None,'checkpointSha256':m.sha(m.encoded(checkpoint))})
   parent=object.__new__(m.PhaseParent);parent.home=root;parent.previous_input=None;parent.child=None;parent.a={'phaseContract':{'holdSeconds':60}};parent.journal=types.SimpleNamespace(anchor={'wall':time.time(),'mono':time.monotonic(),'deadline':time.time()+60});calls=[]
   def authenticate(*args):calls.append('actual-authenticated-read');raise RuntimeError('runtime_phase_actual_remote_missing')
   m.authenticate_phase_input=authenticate
   try:parent.wait_input(checkpoint)
   finally:result={'actualReadAttempts':len(calls),'continued':False}
  elif op=='spawn-main04':
   import shutil
   harness=root/'harness';app=root/'app';scenarios=harness/'scripts/simulation/track1/scenarios';scenarios.mkdir(parents=True,mode=0o700);app.mkdir(mode=0o700)
   shared=pathlib.Path('node_modules').resolve();(app/'node_modules').symlink_to(shared,target_is_directory=True);(harness/'node_modules').symlink_to(shared,target_is_directory=True)
   shutil.copyfile('scripts/simulation/track1/vitest.config.mts',scenarios.parent/'vitest.config.mts')
   (scenarios/'main04.test.ts').write_text("import{describe,it,expect}from'vitest';describe('MAIN04 actual nested registration',()=>{it('MAIN04.01 prepare',()=>{expect(process.env.GH_TOKEN).toBeUndefined()});it('MAIN04.03 review',()=>{});it.skip('MAIN04.04 unadmitted approval',()=>{throw Error('must never execute')})})")
   (root/'business').mkdir(mode=0o700);put('private/app-values.json',{'NEXT_PUBLIC_SUPABASE_URL':m.API_URL,'NEXT_PUBLIC_SUPABASE_ANON_KEY':'synthetic-anon','SUPABASE_SERVICE_ROLE_KEY':'synthetic-local-service'});put('t1-123-1/stack.json',{'scope':'controlled-component-not-native'})
   cohort=put('cohort.json',{'runDir':str(root/'business/main04')});parent=object.__new__(m.PhaseParent);parent.a={'simHome':str(root),'appDir':str(app),'harnessDir':str(harness),'appCommit':'a'*40,'harnessCommit':'b'*40,'projectId':'t1-123-1','event':{'runId':'123'}};parent.home=root;parent.file=root/'assignment.json';parent.child=None;parent.basis={'operationId':'operation'};parent.last_input_deadline=time.time()+60;parent.journal=types.SimpleNamespace(anchor={'wall':time.time(),'mono':time.monotonic(),'deadline':time.time()+600});parent.service=lambda:time.sleep(.01)
   m.PhaseParent.spawn(parent,'MAIN04',cohort)
   try:terminal=m.PhaseParent.reap(parent)
   finally:
    if(root/'business/main04/report.json').exists():
     raw=m.read_json(root/'business/main04/report.json');result={'passed':raw['numPassedTests'],'pending':raw['numPendingTests']}
   result.update(waitObserved=terminal['waitObserved'],exitCode=terminal['exitCode'])
  elif op=='projection':
   graph={'normalized':[{'id':'00000000-0000-4000-8000-000000000001','quantity_kwh':'1.125','period_start':'2027-02-01T00:00:00+01:00','metadata':{'credential':'synthetic-private-sentinel'}}]}
   if case=='bad-decimal':graph['normalized'][0]['quantity_kwh']='synthetic-private-sentinel'
   if case=='bad-id':graph['normalized'][0]['id']='synthetic-private-sentinel'
   projected=m.safe_graph_projection(graph);result={'projection':projected,'privateAbsent':'synthetic-private-sentinel'not in json.dumps(projected)}
  elif op=='report':
   workload='MAIN04'if case=='main04'else'MAIN03';ids=['MAIN04.01','MAIN04.03','MAIN04.04']if workload=='MAIN04'else['MAIN03.01','MAIN03.02','MAIN03.03','MAIN03.05','MAIN03.04']
   assertions=[{'title':identifier+' actual callback','status':'pending'if identifier=='MAIN04.04'else'passed','failureMessages':[]}for identifier in ids];raw={'success':True,'numTotalTests':len(ids),'numPassedTests':2 if workload=='MAIN04'else 5,'numPendingTests':1 if workload=='MAIN04'else 0,'numFailedTests':0,'numFailedTestSuites':0,'numTodoTests':0,'testResults':[{'status':'passed','message':'','assertionResults':assertions}]};code=0
   if case=='missing':assertions.pop()
   if case=='nonzero':code=17
   if case=='boolean':code=False
   if case=='hook':raw['testResults'][0]['message']='hook failure'
   if case=='failed':assertions[0]['status']='failed'
   if case=='skip':assertions[0]['status']='pending'
   if case=='global':raw['numFailedTestSuites']=1
   if case=='lie':raw['success']=False
   result=m.phase_report(raw,code,workload,root,'123')
  elif op=='wait':
   process=child("import sys;sys.stdin.read(1);sys.exit(17 if sys.argv[0]=='impossible' else 0)",stdin=subprocess.PIPE)
   if case=='nonzero':
    process.terminate();process.wait();process=child('import sys;sys.stdin.read(1);sys.exit(17)',stdin=subprocess.PIPE)
   birth=m.proc_birth(process.pid);parent=object.__new__(m.PhaseParent);parent.a={'event':{'runId':'123'}};parent.basis={'operationId':'operation'};parent.child={'process':process,'birth':birth,'workload':'OBSERVE','directory':root,'stream':open(root/'run.log','xb')};parent.service=lambda:time.sleep(.01)
   process.stdin.write(b'x');process.stdin.flush();result=m.PhaseParent.reap(parent)
  elif op=='stop':
   process=child();birth=m.proc_birth(process.pid)
   if case=='wrong-birth':birth['startTicks']='0'
   m.stop_phase_session(birth);process.wait(timeout=3);result={'exited':process.returncode is not None,'remaining':m.group_members(birth['sid'])}
  elif op=='business-env':
   put('private/app-values.json',{'NEXT_PUBLIC_SUPABASE_URL':m.API_URL,'NEXT_PUBLIC_SUPABASE_ANON_KEY':'synthetic-anon','SUPABASE_SERVICE_ROLE_KEY':'synthetic-local-service','CRON_SECRET':'synthetic-cron','AWS_SECRET_ACCESS_KEY':'synthetic-provider'})
   cohort=put('cohort.json',{'runDir':str(root/'run')});a={'simHome':str(root),'appDir':str(root),'appCommit':'a'*40,'harnessDir':str(root),'projectId':'t1-123-1'}
   os.environ.update(GH_TOKEN='synthetic-control',AWS_SECRET_ACCESS_KEY='synthetic-provider');environment=m.phase_child_environment(a,root/'assignment.json',cohort)
   out=subprocess.check_output(['/usr/bin/env'],env=environment,text=True);actual=dict(line.split('=',1)for line in out.splitlines());result={'localServiceOnly':actual.get('SUPABASE_SERVICE_ROLE_KEY')=='synthetic-local-service','controlAbsent':'GH_TOKEN'not in actual,'providerAbsent':'AWS_SECRET_ACCESS_KEY'not in actual,'cronAbsent':'CRON_SECRET'not in actual}
  elif op=='complete-history':
   a={**{key:chr(97+n)*40 for n,key in enumerate(['appCommit','appTree','harnessCommit','harnessTree','workflowCarrier','workflowBlob'])},'event':{'runId':'123','jobId':7},'phaseContract':{'producerId':'producer','coordinator':{'id':'root'},'reviewers':[{'id':'reviewerA','sessionRef':'sessionA'},{'id':'reviewerB','sessionRef':'sessionB'}],'absoluteDeadlineAtUtc':m.dt.datetime.fromtimestamp(time.time()-10,m.dt.timezone.utc).isoformat()}}
   assignment=put('assignment.json',{'synthetic':'component only'});binding=m.phase_binding(a,assignment);parent=m.proc_birth(os.getpid());put('phase-parent.json',parent);previous=None;records={};calls=[]
   commands=['START_MAIN03','RETRY_ONCE','SEAL_MAIN03','PREPARE_REVIEW_MAIN04','REVIEW_DRAFT']
   for n,state in enumerate(m.PHASE_INPUT_STATES):
    observation={'acceptedPreviousInputSha256':previous,'native':{'status':200},'nativeReadiness':{'actualParent':parent,'componentOnly':True}}
    checkpoint={'state':state,'binding':binding,'observation':observation};put(f'phase-checkpoints/{n}.json',checkpoint)
    reviews=[dict(schema='track1-independent-phase-review-v1',reviewerId=r['id'],sessionRef=r['sessionRef'],decision='APPROVE',ordinal=n,checkpointSha256=m.sha(m.encoded(checkpoint)),binding=binding,next=commands[n])for r in a['phaseContract']['reviewers']]
    value=dict(schema='track1-root-next-phase-input-v1',ordinal=n,next=commands[n],previousInputSha256=previous,checkpointSha256=m.sha(m.encoded(checkpoint)),binding=binding,coordinatorId='root',producerId='producer',notBeforeEpoch=int(time.time())-200,deadlineEpoch=int(time.time())-50,artifactId=n+1,artifactArchiveSha256='f'*64)
    if n==0:
     value['nativeReadinessSha256']=m.sha(m.canonical_phase(observation['nativeReadiness']))
     for review in reviews:review['nativeReadinessSha256']=value['nativeReadinessSha256']
    value['reviewPayloadSha256']=[m.sha(m.canonical_phase(review))for review in reviews]
    artifact=dict(id=n+1,name=f't1-phase-123-{n}',workflow_run={'id':123},expired=False,digest='sha256:'+'f'*64)
    accepted={**value,'authenticatedInputReceipt':str(n+1)*40};put(f'phase-inputs/{n}.json',accepted)
    at=time.time()-100+n;receipt={'schema':'track1-parent-observed-acceptance-v1','ordinal':n,'binding':binding,'inputSha256':m.sha(m.encoded(accepted)),'phaseParentSha256':m.sha(m.encoded(parent)),'acceptedAtEpoch':at,'monotonicNs':n+1}
    if case=='forged-observation'and n==2:receipt['inputSha256']='0'*64
    if case=='outside-window'and n==2:receipt['acceptedAtEpoch']=time.time()
    if not(case=='missing-observation'and n==2):put(f'phase-accepted/{n}.json',receipt)
    records[n]=(value,reviews,artifact,previous,accepted);previous=m.sha(m.encoded(accepted))
   put('phase-completed.json',{'schema':'track1-phased-limited-observations-v1','state':'DRAFT_REVIEWED_NO_APPROVAL','binding':binding,'new105ScenarioPassAttestations':0,'lastInputSha256':previous,'lastCheckpointSha256':m.sha(m.encoded(checkpoint))})
   def authenticated(_a,cp,prior,*,accepted_at=None,teardown=False):
    n=m.PHASE_INPUT_STATES.index(cp['state']);value,reviews,artifact,expected_prior,accepted=records[n]
    m.need(teardown is True and prior==expected_prior,'runtime_phase_history_teardown_scope')
    m.validate_phase_input(_a,cp,value,reviews,artifact,prior,at=accepted_at);calls.append(n);return accepted
   m.authenticate_phase_input=authenticated;result={'binding':m.phase_verify_complete(a,root),'historicalAuthenticatedInputs':len(calls)}
  elif op=='business-budget':
   parent=object.__new__(m.PhaseParent);parent.a={'phaseContract':{'businessBudgetSeconds':1}};parent.business_started=time.monotonic()-2;parent.business_hold_seconds=0.;parent.journal=types.SimpleNamespace(anchor={'wall':time.time(),'mono':time.monotonic(),'deadline':time.time()+3600})
   def empty_socket():raise socket.timeout()
   parent.socket=types.SimpleNamespace(accept=empty_socket)
   if case=='valid':parent.a['phaseContract']['businessBudgetSeconds']=10
   if case=='hold-credit':parent.business_started=time.monotonic()-5;parent.business_hold_seconds=4.;parent.a['phaseContract']['businessBudgetSeconds']=3
   if case=='forged-credit':parent.business_hold_seconds=5.
   m.PhaseParent.service(parent);result={'continued':True}
  elif op=='clock':
   anchor={'wall':100.,'mono':10.,'deadline':200.};wall,mono=110.,20.
   if case=='rollback':wall=90.
   if case=='mono':mono=5.
   if case=='expired':wall,mono=201.,111.
   m.phase_clock(anchor,wall=wall,mono=mono);result={'accepted':True}
  elif op=='json':
   raw='{"a":1,"a":2}'if case=='duplicate'else'{"a":NaN}'if case=='nan'else'{"a":1}'
   result=m.phase_json(raw)
  elif op=='journal':
   journal=m.PhaseJournal(root,{'source':'a'},time.time()+60);first=journal.append('STARTUP_OBSERVED',{'actual':1})
   if case=='restart':m.PhaseJournal(root,{'source':'a'},time.time()+60)
   elif case=='unknown':journal.append('ARBITRARY_COMMAND',{})
   else:
    second=journal.append('MAIN03_RUNNING',{'actual':2});result={'linked':second['previousSha256']==m.sha(m.encoded(first)),'records':len(list((root/'phase-journal').glob('*.json')))}
  else:raise RuntimeError('unknown bounded component operation')
 print(json.dumps({'accepted':True,'result':result}))
except Exception as error:
 print(json.dumps({'accepted':False,'error':str(error) if isinstance(error,RuntimeError)and str(error).startswith('runtime_phase_')else type(error).__name__,'result':result}))
finally:
 for process in processes:
  if process.poll()is None:process.terminate()
  try:process.communicate(timeout=3)
  except subprocess.TimeoutExpired:process.kill();process.communicate()
`
function phaseProbe(op: string, change = 'valid'): { accepted: boolean; error?: string; result?: Record<string, unknown> } {
  return JSON.parse(execFileSync('python3', ['-B', '-c', phasedPython, JSON.stringify({ op, case: change })], { encoding: 'utf8', timeout: 15_000 }))
}

describe('explicit phased source protocol finite controls', () => {
  it('accepts actual-process-bound started/disconnect/fulfilled200 wire facts', () => { expect(phaseProbe('native')).toMatchObject({ accepted: true, result: { status: 200, sameActualPid: true } }) })
  it.each(['already-aborted','no-disconnect','duplicate','rejected','construction-error','thrown','not-entered','different-attempt','boot-drift','clock-order','sequence','route','old-wire','foreign-process','reused-birth'])('holds on native %s', change => { expect(phaseProbe('native', change)).toMatchObject({ accepted: false }) })
  it('authenticates an actual owned session peer', () => { expect(phaseProbe('peer')).toMatchObject({ accepted: true, result: { same: true } }) })
  it.each(['reused','uid','foreign','cwd','dead'])('refuses actual peer %s', change => { expect(phaseProbe('peer', change)).toMatchObject({ accepted: false }) })
  it('uses real private Unix IPC and kernel peer credentials for custody observations', () => { expect(phaseProbe('ipc')).toMatchObject({ accepted: true, result: { exit: 0, requestCount: 1, reply: { state: 'OBSERVED', observation: { custodySha256: 'd'.repeat(64) } } } }) })
  it('roundtrips the actual TS client through actual Python kernel-peer IPC', () => { expect(phaseProbe('ipc', 'node-client')).toMatchObject({ accepted: true, result: { exit: 0, requestCount: 1, reply: { custodySha256: 'd'.repeat(64) } } }) })
  it('the actual TS client refuses a reused parent birth before custody', () => { expect(phaseProbe('ipc', 'node-parent-reuse')).toMatchObject({ accepted: false }) })
  it.each(['nonce','assignment','phase','action'])('refuses actual IPC %s before a resumed effect', change => { expect(phaseProbe('ipc', change)).toMatchObject({ accepted: false }) })
  it('accepts only the next exact checkpoint/artifact/two-review input', () => { expect(phaseProbe('input')).toMatchObject({ accepted: true, result: { next: 'RETRY_ONCE' } }) })
  it.each(['previous','ordinal','command','expired','future','artifact-run','artifact-digest','artifact-expired','producer-review','same-reviewer','deny','future-terminal','unknown-argv','body-drift'])('refuses phase input %s', change => { expect(phaseProbe('input', change)).toMatchObject({ accepted: false }) })
  it('verifies an immutable historical input at the actually observed acceptance time', () => { expect(phaseProbe('input-history')).toMatchObject({ accepted: true, result: { next: 'RETRY_ONCE' } }) })
  it.each(['live','outside-window'])('never grants a currently expired future effect or invalid historical window: %s', change => { expect(phaseProbe('input-history', change)).toMatchObject({ accepted: false }) })
  it('re-authenticates before resuming even when a forged local acceptance exists', () => { expect(phaseProbe('forged-local')).toMatchObject({ accepted: false, result: { actualReadAttempts: 1, continued: false } }) })
  it('the actual MAIN04 spawn and real Vitest select two nested callbacks and keep .04 unexecuted', () => { expect(phaseProbe('spawn-main04')).toMatchObject({ accepted: true, result: { waitObserved: true, exitCode: 0, passed: 2, pending: 1 } }) })
  it('exports actual interval/identity facts while withholding arbitrary metadata', () => { expect(phaseProbe('projection')).toMatchObject({ accepted: true, result: { privateAbsent: true, projection: { normalized: { count: 1, rows: [{ quantity_kwh: '1.125' }] } } } }) })
  it.each(['bad-decimal','bad-id'])('refuses unsafe public graph projection %s', change => { expect(phaseProbe('projection', change)).toMatchObject({ accepted: false }) })
  it.each(['valid','main04'])('checks actual report required IDs and explicit MAIN04 HOLD: %s', change => { expect(phaseProbe('report', change)).toMatchObject({ accepted: true, result: { scenarios: {}, new105ScenarioPassAttestations: 0 } }) })
  it.each(['missing','nonzero','boolean','hook','failed','skip','global','lie'])('rejects actual report %s', change => { expect(phaseProbe('report', change)).toMatchObject({ accepted: false }) })
  it('records actual wait and terminal exit0 from an owned process', () => { expect(phaseProbe('wait')).toMatchObject({ accepted: true, result: { exitCode: 0, waitObserved: true } }) })
  it('refuses an actual nonzero waited child', () => { expect(phaseProbe('wait', 'nonzero')).toMatchObject({ accepted: false }) })
  it('stops only an exact owned process session and observes it empty', () => { expect(phaseProbe('stop')).toMatchObject({ accepted: true, result: { exited: true, remaining: [] } }) })
  it('refuses cleanup of a reused or mismatching birth', () => { expect(phaseProbe('stop', 'wrong-birth')).toMatchObject({ accepted: false }) })
  it('actually passes only the admitted local credential into a sanitized child', () => { expect(phaseProbe('business-env')).toMatchObject({ accepted: true, result: { localServiceOnly: true, controlAbsent: true, providerAbsent: true, cronAbsent: true } }) })
  it('replays all five authenticated inputs at observed acceptance times after business expiry', () => { expect(phaseProbe('complete-history')).toMatchObject({ accepted: true, result: { historicalAuthenticatedInputs: 5 } }) })
  it.each(['forged-observation','outside-window','missing-observation'])('refuses historical completion %s', change => { expect(phaseProbe('complete-history', change)).toMatchObject({ accepted: false }) })
  it('enforces the real active business budget despite a later absolute deadline', () => { expect(phaseProbe('business-budget', 'overrun')).toMatchObject({ accepted: false }) })
  it.each(['valid','hold-credit'])('permits measured finite active time: %s', change => { expect(phaseProbe('business-budget', change)).toMatchObject({ accepted: true }) })
  it('refuses fabricated excess HOLD time credit', () => { expect(phaseProbe('business-budget', 'forged-credit')).toMatchObject({ accepted: false }) })
  it('observes finite wall and monotonic clocks together', () => { expect(phaseProbe('clock')).toMatchObject({ accepted: true }) })
  it.each(['rollback','mono','expired'])('holds on clock %s', change => { expect(phaseProbe('clock', change)).toMatchObject({ accepted: false }) })
  it('preserves append-only observed phase linkage', () => { expect(phaseProbe('journal')).toMatchObject({ accepted: true, result: { linked: true, records: 2 } }) })
  it.each(['restart','unknown'])('refuses journal %s', change => { expect(phaseProbe('journal', change)).toMatchObject({ accepted: false }) })
  it.each(['duplicate','nan'])('refuses ambiguous JSON %s', change => { expect(phaseProbe('json', change)).toMatchObject({ accepted: false }) })
})

function phasedAssignmentFixture(change: string) {
  const home = mkdtempSync(path.join(tmpdir(), 't1-phased-binding-'))
  const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
  const file = (name: string, value: unknown) => { const target = path.join(home, name); writeFileSync(target, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); return { path: target, sha256: digest(readFileSync(target)) } }
  const runtime = { appCommit: 'a'.repeat(40), appTree: 'b'.repeat(40), harnessCommit: 'c'.repeat(40), harnessTree: 'd'.repeat(40), databaseSystemIdentifier: '123', serverMajor: 17 }
  const prepared = file('prepared.json', { schema: 'track1-prepared-runtime-v3', databaseSystemIdentifier: '123' })
  const observed = file('observed.json', runtime)
  const assigned = { schema: 'track1-runtime-assignment-v3', mode: 'coordinator_prepared_phased', reportKind: 'phased_cohort', ...runtime,
    simHome: home, appDir: home + '/app', harnessDir: home + '/harness', preparedReceiptFile: prepared.path, preparedReceiptSha256: prepared.sha256,
    businessLocalServiceKeySha256: 'e'.repeat(64), minimumAuthHeadroomMs: 180_000 }
  if (change === 'smoke-version') assigned.schema = 'track1-runtime-assignment-v2'
  if (change === 'smoke-mode') assigned.mode = 'coordinator_prepared_fresh'
  if (change === 'smoke-kind') assigned.reportKind = 'infrastructure_smoke'
  if (change === 'foreign-source') assigned.appCommit = 'f'.repeat(40)
  const assignment = file('assignment.json', assigned)
  const admission = { schema: 'track1-cohort-business-admission-v2', privateHome: home, simHome: home, appDir: home + '/app', harnessDir: home + '/harness', runtime,
    serviceRoleKeySha256: 'e'.repeat(64), expiresAtUtc: new Date(Date.now() + 300_000).toISOString(),
    phaseAdapter: { schema: 'track1-parent-custody-ipc-v1', assignment, runtimeObservation: observed, preparedSha256: prepared.sha256,
      socketPath: home + '/phase.sock', nonce: 'a'.repeat(64), minimumAuthHeadroomMs: 180_000, deadlineAtMs: Date.now() + 180_000 } }
  if (change === 'legacy-business') admission.schema = 'track1-cohort-business-admission-v1'
  if (change === 'local-key') admission.serviceRoleKeySha256 = '0'.repeat(64)
  if (change === 'auth-budget') admission.phaseAdapter.minimumAuthHeadroomMs = 120_000
  if (change === 'observation') admission.runtime.databaseSystemIdentifier = '124'
  if (change === 'prepared') admission.phaseAdapter.preparedSha256 = '0'.repeat(64)
  if (change === 'expired') admission.phaseAdapter.deadlineAtMs = Date.now() - 100
  if (change === 'socket') admission.phaseAdapter.socketPath = home + '/foreign.sock'
  return { home, admission: admission as unknown as BusinessAdmission }
}

describe('actual TS phased assignment version and local credential binding', () => {
  it('binds the actual immutable v3 files before accepting the new business profile', () => {
    const fixture = phasedAssignmentFixture('valid')
    try { expect(() => assertPhasedAssignment(fixture.admission)).not.toThrow() } finally { rmSync(fixture.home, { recursive: true }) }
  })
  it.each(['smoke-version', 'smoke-mode', 'smoke-kind', 'foreign-source', 'legacy-business', 'local-key', 'auth-budget', 'observation', 'prepared', 'expired', 'socket'])('refuses %s without a legacy fallback', change => {
    const fixture = phasedAssignmentFixture(change)
    try { expect(() => assertPhasedAssignment(fixture.admission)).toThrow('cohort_hold:') } finally { rmSync(fixture.home, { recursive: true }) }
  })
})

// Fixtures adapted from independent T3 checkpoint/deadline reproducers.
// These finite inputs never establish actual reviews or runtime admission.
const checkpointWireRegression = String.raw`import pathlib,importlib.util,tempfile,time,json,os,copy,hashlib
os.umask(0o077)
source=pathlib.Path('scripts/simulation/runtime/assigned_backend.py')
spec=importlib.util.spec_from_file_location('review_adapter',source);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as folder:
 home=pathlib.Path(folder);(home/'phase-checkpoints').mkdir(mode=0o700)
 parent=object.__new__(m.PhaseParent);parent.home=home;parent.binding={'C':'finite-reviewed-source'};parent.previous_input='e'*64;parent.journal=m.PhaseJournal(home,parent.binding,time.time()+900)
 parent.journal.append('STARTUP_OBSERVED',{'acceptedPreviousInputSha256':None});parent.journal.append('MAIN03_RUNNING',{'acceptedPreviousInputSha256':parent.previous_input})
 checkpoint=parent.checkpoint('BEFORE_RETRY',{'native':{'status':200}})
 a={'event':{'runId':'123'},'phaseContract':{'producerId':'finite-producer','coordinator':{'id':'finite-root'},'reviewers':[{'id':'finite-reviewer-A','sessionRef':'finite-session-A'},{'id':'finite-reviewer-B','sessionRef':'finite-session-B'}],'absoluteDeadlineAtUtc':m.dt.datetime.fromtimestamp(time.time()+900,m.dt.timezone.utc).isoformat()}}
 def attempt(c):
  reviews=[dict(schema='track1-independent-phase-review-v1',reviewerId=r['id'],sessionRef=r['sessionRef'],decision='APPROVE',ordinal=1,checkpointSha256=m.sha(m.encoded(c)),binding=c['binding'],next='RETRY_ONCE')for r in a['phaseContract']['reviewers']]
  value=dict(schema='track1-root-next-phase-input-v1',ordinal=1,next='RETRY_ONCE',previousInputSha256=parent.previous_input,checkpointSha256=m.sha(m.encoded(c)),binding=c['binding'],coordinatorId='finite-root',producerId='finite-producer',notBeforeEpoch=int(time.time())-1,deadlineEpoch=int(time.time())+300,artifactId=7,artifactArchiveSha256='f'*64,reviewPayloadSha256=[m.sha(m.canonical_phase(r))for r in reviews])
  artifact=dict(id=7,name='t1-phase-123-1',workflow_run={'id':123},expired=False,digest='sha256:'+'f'*64)
  try:return {'accepted':True,'next':m.validate_phase_input(a,c,value,reviews,artifact,parent.previous_input)}
  except Exception as error:return {'accepted':False,'error':str(error)}
 observed=attempt(checkpoint);assert observed=={'accepted':True,'next':'RETRY_ONCE'}
 stale=copy.deepcopy(checkpoint);stale['observation']['acceptedPreviousInputSha256']='0'*64
 refused=attempt(stale);assert refused=={'accepted':False,'error':'runtime_phase_input_linkage'}
 print(json.dumps({'actualExportAccepted':True,'staleRefused':True,'exportMatchesJournal':checkpoint['observation']==parent.journal.records[-1]['observation']}))
`
const cleanupDeadlineRegression = String.raw`import pathlib,importlib.util,tempfile,time,json,os,hashlib,datetime,uuid,sys
os.umask(0o077)
source=pathlib.Path('scripts/simulation/runtime/assigned_backend.py')
spec=importlib.util.spec_from_file_location('review_adapter',source);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as folder:
 root=pathlib.Path(folder);home=root/'home';home.mkdir(mode=0o700);app=root/'app';(app/'app/api/internal/billing/generate-underlay').mkdir(mode=0o700,parents=True);(app/'__tests__').mkdir(mode=0o700);(app/'supabase').mkdir(mode=0o700)
 route=app/'app/api/internal/billing/generate-underlay/route.ts';route.write_text(m.NATIVE_SCHEMA);test=app/'__tests__/billing-underlay-operation-observation.test.ts';test.write_text('finite-source-profile-only');(app/'supabase/config.toml').write_text('[auth]\njwt_expiry=3600\n')
 def iso(seconds):return datetime.datetime.fromtimestamp(time.time()+seconds,datetime.timezone.utc).isoformat()
 def actor(name):return {'id':name,'sessionRef':m.PREFIX+'slot-session-'+name,'receipt':'a'*40,'expectedNeutral':{'base':'b'*40,'files':[],'operation':'finite-only'}}
 contract={'schema':'track1-sameC-phase-contract-v1','producerId':'finite-producer','coordinator':actor('finite-root'),'reviewers':[actor('finite-review-a'),actor('finite-review-b')],'holdSeconds':60,'businessBudgetSeconds':60,'minAuthHeadroomSeconds':180,'operationId':str(uuid.uuid4()),'inputQualification':{'state':'ACTUAL_ORIGINAL_INPUT_QUALIFIED','basisKind':'original_frozen_input','receiptSha256':'c'*64,'approvalSha256':'d'*64,'inputVectorSha256':'e'*64},'nativeProfile':{'schema':m.NATIVE_SCHEMA,'readiness':'REVIEWED_SOURCE_RUNTIME_OBSERVATION_PENDING','routeSha256':m.sha(route.read_bytes()),'testSha256':m.sha(test.read_bytes())},'absoluteDeadlineAtUtc':iso(-1)}
 contract['nativeProfile']['sourceReviews']=[{'reviewerId':'finite-review-'+str(n),'receiptSha256':str(n+1)*64,'routeSha256':contract['nativeProfile']['routeSha256'],'testSha256':contract['nativeProfile']['testSha256']}for n in range(2)]
 a={'schema':'track1-hosted-phased-admission-v2','workerId':'codex-track1','exclusiveHost':True,'reportKind':'phased_cohort','simHome':str(home),'admissionFile':str(home/'admission.json'),'expiresAtUtc':iso(60),'cleanupExpiresAtUtc':iso(600),'appDir':str(app),'appCommit':'a'*40,'appTree':'b'*40,'phaseContract':contract,'event':{'repository':m.REPO,'name':'pull_request','action':'opened','branch':'codex/t1-phased-cohort-native','attempt':1,'runId':'123','job':'phased-cohort','actor':'finite-root'},'workflowCarrier':'f'*40,'budget':{'jobs':1,'replays':1,'builds':1,'appStarts':1,'smokes':1,'main03':1,'main04PrepareReview':1,'nativeRetries':1,'cleanup':1},'projectId':'t1-123-1','ports':{'db':54322,'api':54321,'app':3101}}
 event=root/'event.json';event.write_text(json.dumps({'action':'opened','pull_request':{'head':{'sha':a['workflowCarrier'],'ref':a['event']['branch'],'repo':{'full_name':m.REPO}}}}))
 os.environ.update(GITHUB_RUN_ID='123',GITHUB_RUN_ATTEMPT='1',GITHUB_JOB='phased-cohort',GITHUB_ACTOR='finite-root',GITHUB_REPOSITORY=m.REPO,GITHUB_EVENT_PATH=str(event))
 m.clean_source=lambda *_args:(_ for _ in ()).throw(RuntimeError('FINITE_IDENTITY_BOUNDARY_REACHED_NO_EFFECTS'))
 def attempt(deadline):
  a['phaseContract']['absoluteDeadlineAtUtc']=deadline;p=home/'admission.json';p.write_text(json.dumps(a));p.chmod(0o600)
  try:
   if sys.argv[1]=='effect':m.admission(str(p),teardown=False)
   else:m.phase_cleanup(str(p))
   return {'unexpectedSuccess':True}
  except RuntimeError as error:return {'error':str(error),'cleanupExpiryStillFuture':datetime.datetime.fromisoformat(a['cleanupExpiresAtUtc']).timestamp()>time.time()}
 if sys.argv[1]=='cleanup-expired':a['expiresAtUtc']=iso(-120);a['cleanupExpiresAtUtc']=iso(-60)
 print(json.dumps(attempt(iso(30)if sys.argv[1]=='future'else iso(-180)if sys.argv[1]=='cleanup-expired'else iso(-1))))
`

describe('actual exported checkpoint and cleanup admission interoperability', () => {
  it('accepts the actual exported prior-input link and rejects a stale link', () => {
    const result = JSON.parse(execFileSync('python3', ['-B', '-c', checkpointWireRegression], { encoding: 'utf8', timeout: 10_000 }))
    expect(result).toEqual({ actualExportAccepted: true, staleRefused: true, exportMatchesJournal: true })
  })
  it.each(['expired', 'future'])('cleanup reaches the controlled identity boundary with %s business deadline', change => {
    const result = JSON.parse(execFileSync('python3', ['-B', '-c', cleanupDeadlineRegression, change], { encoding: 'utf8', timeout: 10_000 }))
    expect(result.error).toBe('FINITE_IDENTITY_BOUNDARY_REACHED_NO_EFFECTS')
  })
  it.each([['effect', 'runtime_phase_deadline'], ['cleanup-expired', 'runtime_admission_expired']])('refuses expired %s authority', (change, error) => {
    const result = JSON.parse(execFileSync('python3', ['-B', '-c', cleanupDeadlineRegression, change], { encoding: 'utf8', timeout: 10_000 }))
    expect(result.error).toBe(error)
  })
})

const sitePython = String.raw`
import importlib.util,json,pathlib,sys,copy,tempfile
s=importlib.util.spec_from_file_location('site_runtime','scripts/simulation/runtime/assigned_backend.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
case=sys.argv[1]
c={'schema':'track1-site-native-contract-v1','inputEpoch':'site-native-input-v2','startConvention':'ediel-fixed-utc+01','businessBudgetSeconds':1800,'minAuthHeadroomSeconds':120,'producerId':'finite-producer','outputDirectory':'site-native','sourceSha256':{p:getattr(m,'SITE_REVIEWED_HASHES',{}).get(p,'a'*64) for p in getattr(m,'SITE_SOURCE_PATHS',[])},'marketBoundsSourceSha256':'6573f66302a5900308e7a566569a1a389e854b682202f19a745f8ef0363adb06','sites':{'A':{'rawStartMinute':'202609010000','startUtc':'2026-08-31T23:00:00.000Z','endUtc':'2026-09-30T22:00:00.000Z','salt':12,'intervals':2876,'totalMilliKwh':491266,'totalIncVatCents':57347,'preStartReadings':4,'preStartBillable':0},'B':{'rawStartMinute':'202609160000','startUtc':'2026-09-15T23:00:00.000Z','endUtc':'2026-09-25T22:00:00.000Z','salt':24,'intervals':956,'totalMilliKwh':156969,'totalIncVatCents':26377,'preStartReadings':4,'preStartBillable':0}}}
a={'budget':dict(m.SITE_BUDGET),'schema':'track1-hosted-site-admission-v1','reportKind':'site_native_v2','siteContract':c,'event':{'actor':'finite-producer'},'requiredGenGates':{'qualified':True,'receiptSha256':'b'*64,'applicability':{'schemaUnchanged':True,'typesUnchanged':True,'migrationsUnchanged':True}}}
try:
 if case.startswith('report'):
  ids=['SITE01.01','SITE01.02','SITE01.03','SITE01.04','SITE01.05','SITE01.05a','SITE01.05b']
  steps=[{'title':i+' actual substep','status':'passed','failureMessages':[]}for i in ids]
  if case=='report-gap':steps[5].update(status='failed',failureMessages=['FEATURE_GAP'])
  if case=='report-missing':steps.pop()
  if case=='report-duplicate':steps[-1]=steps[0]
  raw={'success':case!='report-gap','numTotalTests':len(steps),'numPassedTests':6 if case=='report-gap' else 7,'numFailedTests':1 if case=='report-gap' else 0,'numPendingTests':0,'numTodoTests':0,'numFailedTestSuites':1 if case=='report-gap' else 0,'testResults':[{'status':'failed' if case=='report-gap' else 'passed','assertionResults':steps}]}
  result=m.site_report(raw,1 if case=='report-gap' else 0)
 else:
  if case=='missing':a.pop('siteContract')
  if case=='epoch':c['inputEpoch']='historical-v1'
  if case=='start':c['sites']['B']['startUtc']='2026-09-15T22:00:00.000Z'
  if case=='end':c['sites']['B']['endUtc']='2026-09-26T00:00:00.000Z'
  if case=='money':c['sites']['A']['totalIncVatCents']=56830
  if case=='presupply':c['sites']['A']['preStartBillable']=4
  if case=='source':c['sourceSha256'].pop(next(iter(c['sourceSha256'])))
  if case=='old-source':c['sourceSha256']['scripts/simulation/track1/fixtures/site01Synthetic.ts']='f'*64
  if case=='market-source':c['marketBoundsSourceSha256']='f'*64
  if case=='gen':a['requiredGenGates']['applicability']['typesUnchanged']=False
  if case=='budget':c['businessBudgetSeconds']=True
  if case=='boolean-operation':a['budget']['siteInvocations']=True
  if case=='extra-operation':a['budget']['main03']=1
  if case=='actor':c['producerId']='foreign'
  m.check_site_contract(a);result={'accepted':True}
 print(json.dumps({'result':result,'error':None}))
except Exception as e:print(json.dumps({'result':None,'error':str(e)}))
`
function siteProbe(change: string) {
  return JSON.parse(execFileSync('python3', ['-B', '-c', sitePython, change], { encoding: 'utf8', timeout: 10_000 }))
}
describe('explicit SITE hosted input-v2 authority', () => {
  it('accepts a separate exact source/input/budget contract', () => expect(siteProbe('valid')).toEqual({ result: { accepted: true }, error: null }))
  it.each(['missing', 'epoch', 'start', 'end', 'money', 'presupply', 'source', 'gen', 'budget', 'actor', 'old-source', 'market-source', 'boolean-operation', 'extra-operation'])('refuses %s before preparing resources', change => {
    expect(siteProbe(change).error).toMatch(/^runtime_site_/)
  })
  it('reports all seven exact substeps without whole-scenario credit', () => {
    expect(siteProbe('report-valid').result).toMatchObject({ qualified: true, new105ScenarioPassAttestations: 0, scenarios: {} })
  })
  it('preserves the consolidation FEATURE_GAP as a failed, nonqualified substep', () => {
    const r = siteProbe('report-gap').result
    expect(r.qualified).toBe(false)
    expect(r.steps.find((v: { declaredStepId: string }) => v.declaredStepId === 'SITE01.05a').status).toBe('failed')
  })
  it.each(['report-missing', 'report-duplicate'])('refuses %s reporting instead of inventing observations', change => expect(siteProbe(change).error).toMatch(/^runtime_site_/))
})

const siteLifecyclePython = String.raw`
import importlib.util,json,pathlib,sys,tempfile,datetime,time,os
s=importlib.util.spec_from_file_location('site_runtime','scripts/simulation/runtime/assigned_backend.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
case=sys.argv[1]
with tempfile.TemporaryDirectory() as directory:
 home=pathlib.Path(directory);(home/'phases').mkdir();output=home/'site-native';output.mkdir()
 assignment=home/'assignment.json';m.seal(assignment,{'finite':'assignment'})
 a={'harnessDir':str(home),'expiresAtUtc':(m.now()+m.dt.timedelta(minutes=1)).isoformat(),'siteContract':{'businessBudgetSeconds':0.05 if case=='timeout' else 10}}
 m.verify=lambda *_args: (_ for _ in ()).throw(RuntimeError('runtime_finite_custody_changed')) if case=='drift' else None
 m.check_site_live=lambda *_args:None
 error=None
 try:m.phase(home,'site',lambda:m.site_child(a,str(assignment),[sys.executable,'-c','import time;time.sleep(30)' if case in ['timeout','drift'] else 'pass'],dict(os.environ),output))
 except Exception as e:error=type(e).__name__
 birth=m.read_json(output/'child-birth.json')
 result={'error':error,'phase':m.read_json(home/'phases/site.json'),'alive':bool(m.group_members(birth['pid']))}
 print(json.dumps(result))
`
describe('SITE parent owns finite subprocess lifecycle', () => {
  it.each(['timeout', 'drift'])('records %s as unknown business outcome and reaps only its session', change => {
    const r = JSON.parse(execFileSync('python3', ['-B', '-c', siteLifecyclePython, change], { encoding: 'utf8', timeout: 10_000 }))
    expect(r.error).toBe('OutcomeUnknown')
    expect(r.phase).toMatchObject({ status: 'OUTCOME_UNKNOWN', exitCode: null })
    expect(r.alive).toBe(false)
  })
})

const siteRunnerPython = String.raw`
import importlib.util,json,pathlib,sys,tempfile,copy,subprocess
s=importlib.util.spec_from_file_location('site_runtime','scripts/simulation/runtime/assigned_backend.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
case=sys.argv[1]
with tempfile.TemporaryDirectory() as directory:
 home=pathlib.Path(directory);(home/'phases').mkdir();(home/'reports').mkdir();(home/'private').mkdir();(home/'tool-home').mkdir(mode=0o700);m.PRIVATE_TOOL_HOME=home/'tool-home'
 assignment=home/'assignment.json';m.seal(assignment,{'finite':'assignment'})
 c={'businessBudgetSeconds':1800,'minAuthHeadroomSeconds':120};a={'schema':'track1-hosted-site-admission-v1','simHome':str(home),'appDir':str(home),'harnessDir':str(home),'projectId':'owned-project','appCommit':'a'*40,'siteContract':c}
 admission=home/'admission.json';m.seal(admission,a)
 r={'schema':'track1-runtime-assignment-site-v1','mode':'coordinator_prepared_site','reportKind':'site_native_v2','allowedActions':['up','site-run'],'siteContractSha256':m.sha(m.encoded(c)),'preparedReceiptSha256':'b'*64}
 prepared={'siteContractSha256':m.sha(m.encoded(c)),'observedAuthLifetimeSeconds':3600}
 calls=[];orphan=None
 m.admission=lambda *_args,**_kwargs:a
 def verify(*args):
  calls.append('verify');m.check_site_assignment(a,r);return a,r,prepared
 m.verify=verify;m.check_site_live=lambda *_args:None
 m.seal(home/'private/app-values.json',{'NEXT_PUBLIC_SUPABASE_URL':m.API_URL,'NEXT_PUBLIC_SUPABASE_ANON_KEY':'local-anon','SUPABASE_SERVICE_ROLE_KEY':'local-service'})
 if case.startswith('assignment'):
  if case=='assignment-smoke':r['schema']='track1-runtime-assignment-v2'
  if case=='assignment-actions':r['allowedActions'].append('run')
  if case=='assignment-contract':r['siteContractSha256']='f'*64
  error=None
  try:m.check_site_assignment(a,r)
  except Exception as e:error=str(e)
  print(json.dumps({'error':error}));sys.exit()
 if case=='build-drift':
  (home/'.next').mkdir();(home/'.next/BUILD_ID').write_text('same-id');(home/'.next/app.js').write_text('original')
  first=m.site_build_manifest(home);(home/'.next/app.js').write_text('changed');print(json.dumps({'detected':first!=m.site_build_manifest(home)}));sys.exit()
 def child(a,file,argv,env,output):
  global orphan
  calls.append('child')
  if case in ['orphan','birth-unknown']:
   m.seal(output/'child-launch.intent.json',{})
   if case=='orphan':
    orphan=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'],start_new_session=True);m.seal(output/'child-birth.json',m.proc_birth(orphan.pid))
  assert argv[-1]==str(home/m.SITE_SCENARIO) and not any(k in env for k in ['GH_TOKEN','GITHUB_TOKEN','AWS_SECRET_ACCESS_KEY'])
  ids=list(m.SITE_IDS);steps=[{'title':i+' finite observation','status':'failed' if case=='gap' and i=='SITE01.05a' else 'passed'}for i in ids]
  raw={'success':case!='gap','numTotalTests':7,'numPassedTests':6 if case=='gap' else 7,'numFailedTests':1 if case=='gap' else 0,'numPendingTests':0,'testResults':[{'status':'failed' if case=='gap' else 'passed','assertionResults':steps}]}
  if case!='missing-report':m.seal(output/'vitest.json',raw)
  m.seal(output/'site01-fixture.json',{'companyId':'finite-company','customerId':'finite-customer','actorUserId':'finite-actor','sites':{k:{'siteId':'site-'+k,'pointId':'point-'+k,'contractId':'contract-'+k}for k in ['A','B']}})
  return 1 if case=='gap' else 0
 m.site_child=child
 if case=='overwrite':(home/'site-native').mkdir()
 if case=='short-auth':prepared['observedAuthLifetimeSeconds']=1800
 error=None
 try:m.run_site(str(assignment))
 except Exception as e:error=type(e).__name__+':'+str(e)
 def cleanup(_path):
  calls.append('cleanup');m.seal(home/'phases/cleanup.intent.json',{});m.seal(home/'phases/cleanup.json',{'status':'PASS','exitCode':0});m.seal(home/'cleanup.json',{'clean':True,'remainingAssignedResources':0,'sourceRestored':True,'admissionSha256':m.sha(admission.read_bytes())})
 m.cleanup=cleanup;m.seal(home/'initial.json',{})
 for n in m.REQUIRED_PHASES[:-2]:
  if not (home/'phases'/ (n+'.json')).exists():m.seal(home/'phases'/ (n+'.json'),{'status':'PASS','exitCode':0})
 if case=='cleanup-unknown':m.seal(home/'phases/cleanup.intent.json',{})
 finish_error=None
 try:m.site_finish(str(admission),0 if error is None else 1)
 except Exception as e:finish_error=str(e)
 first_cleanup=calls.count('cleanup')
 try:m.site_finish(str(admission),0)
 except Exception:pass
 if orphan is not None:orphan.terminate();orphan.wait(timeout=5)
 print(json.dumps({'error':error,'finishError':finish_error,'calls':calls,'cleanupCount':calls.count('cleanup'),'firstCleanup':first_cleanup,'proof':m.read_json(home/'safe/site-proof.json'),'sitePhase':m.read_json(home/'phases/site.json')if(home/'phases/site.json').exists()else None}))
`
function siteRunnerProbe(change: string) {
  return JSON.parse(execFileSync('python3', ['-B', '-c', siteRunnerPython, change], { encoding: 'utf8', timeout: 10_000 }))
}
describe('actual separate SITE runner and once-only cleanup', () => {
  it('runs only the reviewed SITE child with local credentials and cleans up once', () => {
    const r = siteRunnerProbe('valid')
    expect(r.error).toBeNull()
    expect(r.proof).toMatchObject({ qualified: true, cleanupObserved: true, scenarios: {}, new105ScenarioPassAttestations: 0 })
    expect(r.cleanupCount).toBe(1)
    expect(r.calls.filter((v: string) => v === 'child')).toHaveLength(1)
  })
  it('retains completed functional failure and cleans up without retry', () => {
    const r = siteRunnerProbe('gap')
    expect(r.sitePhase).toMatchObject({ status: 'FAIL', exitCode: 1 })
    expect(r.proof.steps[5]).toEqual({ declaredStepId: 'SITE01.05a', status: 'failed' })
    expect(r.proof.qualified).toBe(false)
    expect(r.cleanupCount).toBe(1)
  })
  it('records missing child results as unknown and still cleans up', () => {
    const r = siteRunnerProbe('missing-report')
    expect(r.sitePhase).toMatchObject({ status: 'OUTCOME_UNKNOWN', exitCode: null })
    expect(r.proof.qualified).toBe(false)
    expect(r.cleanupCount).toBe(1)
  })
  it.each(['overwrite', 'short-auth'])('refuses %s before the business child', change => {
    const r = siteRunnerProbe(change)
    expect(r.error).toMatch(/runtime_site_/)
    expect(r.calls).not.toContain('child')
    expect(r.cleanupCount).toBe(1)
  })
  it('retains unknown cleanup intent without repeating a destructive attempt', () => {
    const r = siteRunnerProbe('cleanup-unknown')
    expect(r.cleanupCount).toBe(0)
    expect(r.proof).toMatchObject({ qualified: false, cleanupObserved: false })
  })
  it.each(['assignment-smoke', 'assignment-actions', 'assignment-contract'])('refuses %s authority', change => expect(siteRunnerProbe(change).error).toBe('runtime_site_assignment_contract'))
  it('detects changed compiled app bytes despite an unchanged build ID', () => expect(siteRunnerProbe('build-drift').detected).toBe(true))
})

describe('actual SITE admission and interrupted-parent cleanup guard', () => {
  it('admits the separate exact SITE profile through the actual shared verifier', () => expect(probe({ op: 'site-admission' }).error).toBeNull())
  it.each(['branch', 'attempt', 'profile', 'site-budget', 'gate', 'pair', 'source-capsule'])('refuses SITE %s assignment', change => expect(probe({ op: 'site-admission', case: change }).error).toMatch(/^runtime_/))
  it('permits only teardown after the workload deadline while cleanup admission remains live', () => expect(probe({ op: 'site-admission', case: 'cleanup-work-expired' }).error).toBeNull())
  it.each(['orphan', 'birth-unknown'])('holds backend cleanup for %s rather than destroying resources under a writer', change => {
    const r = siteRunnerProbe(change)
    expect(r.cleanupCount).toBe(0)
    expect(r.proof).toMatchObject({ qualified: false, cleanupObserved: false })
    expect(r.finishError).toMatch(/^runtime_site_child_/)
  })
})
