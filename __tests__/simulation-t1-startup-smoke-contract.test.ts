import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

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
 elif op=='admission':
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
   refs=[module.PREFIX+'backend-test-t1',module.PREFIX+'producer-test-t1'];source_refs=[module.PREFIX+'slot-session-test']+[module.PREFIX+'file-'+module.sha(name.encode()) for name in module.SOURCE_PATHS]
   source={'base':'0'*40,'files':list(module.SOURCE_PATHS),'operation':'Reserve source files and rule IDs'}
   a['sourceClaims']=[{'receipt':'2'*40,'expectedNeutral':source,'refs':source_refs}]
   core=copy.deepcopy(a);attempt={key:a[key] for key in ['event','appCommit','appTree','harnessCommit','harnessTree','workflowCarrier','workflowBlob']}
   fields={'resources-sha256':module.sha(('\n'.join(sorted(refs))+'\n').encode()),'inputs-sha256':module.sha(module.encoded(attempt)),'admission-core-sha256':module.sha(module.encoded(core)),**{key:a[key] for key in ['appCommit','appTree','harnessCommit','harnessTree','workflowCarrier','workflowBlob']}}
   neutral={'base':'0'*40,'files':[],'operation':'simulation-t1-startup-smoke-v1; '+'; '.join(key+'='+value for key,value in fields.items())}
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
    if endpoint.startswith('actions/runs/123/attempts/1/jobs'):return {'jobs':[{'name':'startup-smoke','id':999 if case=='job' else 321,'status':'in_progress'}]}
    if endpoint.startswith('git/ref/'):
     ref='refs/'+endpoint.removeprefix('git/ref/');receipt='1'*40 if ref in refs else '2'*40
     if case=='pair' and ref==refs[1]:receipt='9'*40
     return {'ref':ref,'object':{'sha':receipt}}
    commit=endpoint.removeprefix('git/commits/')
    if commit=='0'*40:return {'tree':{'sha':'3'*40}}
    data=neutral if commit=='1'*40 else source
    return {'message':json.dumps(data),'parents':[{'sha':'0'*40}],'tree':{'sha':'3'*40}}
   module.api=fake_api
   module.admission(str(descriptor));result={'accepted':True}
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
