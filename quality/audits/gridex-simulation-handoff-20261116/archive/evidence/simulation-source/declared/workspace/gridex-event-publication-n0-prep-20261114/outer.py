"""PRIVATE UNARMED publication EVENT N0 clone-only DDL/replay/role-ACL qualification.
No import-time/backend-author calls. Producer sole executor; no Auth/REST/event seed/positive JWT/TLS.
Restores trusted preISSUE C6 3443/private14zero; applies244+b2b and fixture-free626 only.
"""
import argparse,ast,fcntl,hashlib,json,os,pathlib,re,shutil,subprocess,time
P=pathlib.Path(__file__).resolve().parent
H=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def read(p):return json.loads(pathlib.Path(p).read_text())
def save(p,v):
 p=pathlib.Path(p);raw=(json.dumps(v,indent=2)+'\n').encode()
 with p.open('xb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
 p.chmod(0o600)
def donor(C):
 d=C['readConstructor'];assert H(d['path'])==d['sha256'];t=ast.parse(pathlib.Path(d['path']).read_bytes())
 names={'sha','read','declarations','readers','app_absent'}
 nodes=[n for n in t.body if isinstance(n,ast.FunctionDef)and n.name in names or isinstance(n,ast.Assign)and any(isinstance(x,ast.Name)and x.id in {'READ_NAMES','FD_NAMES'}for x in n.targets)]
 assert {n.name for n in nodes if isinstance(n,ast.FunctionDef)}==names
 s=dict(globals());exec(compile(ast.Module(body=nodes,type_ignores=[]),'qualified_read_only_declarations','exec'),s)
 return s,hashlib.sha256(ast.dump(ast.Module(body=nodes,type_ignores=[]),include_attributes=False).encode()).hexdigest()
def static(C):
 assert C['cloneDatabase']=='gridex_event_publication_n0_20261114_a'and C['executorAgent']=='execute_eight_parts'
 for r in C['boundFiles']:assert H(r['path'])==r['sha256'],('BOUND_DRIFT',r['path'])
 for r in C['trustedCheckpoint']['refs'].values():assert H(r['path'])==r['sha256']
 for key,expected in [('eventPredecessor','2442259627a125778b34917ee6666bcff8281f72a28889b71d328ce0d7d15309'),('publicationForward','b2b65fff3367ba9c7ef8403cbe36f2e02e553070472ee080fac2aba79662f1a4'),('publicationN0Units','626e9b9c1f4efa662ded7b915e1a71077fac92f78036ed1a6d35684ca3eb1fa8')]:
  assert H(C[key]['path'])==C[key]['sha256']==expected
 assert len(C['eventExpectedBodies'])==8 and len(C['publicationExpectedBodies'])==6
 m,h=donor(C);return m,dict(m['declarations'](C)[2],constructorReadAST=h)
def execute(target,go):
 os.umask(0o077);C=read(target);G=read(go);m,manifest=static(C)
 assert C['state']=='BOUND_READY'and G['rootArmed']is True and G['executeAgent']=='execute_eight_parts'
 assert G['wrapperSHA256']==H(__file__)and G['targetSHA256']==H(target)and G['donorASTManifest']==manifest
 assert {r['reviewerAgent']for r in G['scopeReviews']}=={'/root','/root/execute_eight_parts'}and len(G['scopeReviews'])==2
 for r in G['scopeReviews']:
  assert H(r['path'])==r['sha256']and r['verdict']=='EXECUTION_SCOPE_APPROVE'and r['wrapperSHA256']==H(__file__)and r['targetSHA256']==H(target)
 Q=read(C['qualifiedTargetPath']);assert H(C['qualifiedTargetPath'])==C['qualifiedTargetSHA256']and Q['containerId']==C['containerId']
 seal=read(C['backupSealPath']);assert H(C['backupSealPath'])==C['backupSealSHA256']
 for p,k in [('dumpPath','dumpSHA256'),('mainBeforePath','mainBeforeSHA256'),('mainAfterPath','mainAfterSHA256')]:assert H(seal[p])==seal[k]
 assert pathlib.Path(seal['mainBeforePath']).read_bytes()==pathlib.Path(seal['mainAfterPath']).read_bytes()
 assert H(C['quietEpochPath'])==C['quietEpochSHA256']and H(C['freshMainSnapshotPath'])==C['freshMainSnapshotSHA256']
 source=read(C['sourceManifestPath'])[C['sourceManifestKey']];assert H(C['sourceManifestPath'])==C['sourceManifestSHA256']and len(source)==C['sourceManifestCount']
 assert all(H(pathlib.Path(C['sourceRoot'])/p)==h for p,h in source.items())
 R=pathlib.Path(C['actualRunDir']);db=C['cloneDatabase'];assert str(R).startswith('/workspace/gridex-event-publication-n0-actual-')and not R.exists()
 E={k:v for k,v in os.environ.items()if k not in ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','PGDATABASE','PGHOST','PGPORT','PGUSER','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGOPTIONS']};D=['/usr/local/bin/docker','--host=unix:///var/run/docker.sock']
 space,_=m['readers'](C,Q,E,D,R);sql=space['sql'];snapshot=space['snapshot']
 def private_rows():
  names=C['expectedPrivateTables']+C['apiExtraPrivateTables'];parts=["select '"+n+"'name,coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text),'[]')rows from gridex_local_test."+n+' t'for n in names]
  return json.loads(sql(db,"BEGIN READ ONLY;select jsonb_build_object('private',(select jsonb_object_agg(name,rows)from("+' union all '.join(parts)+")x),'receiverRegistrations',(select coalesce(jsonb_agg(to_jsonb(r)order by to_jsonb(r)::text),'[]')from gridex_controlled_test_receiver.registrations r));ROLLBACK;"))
 def step(path,stem,variables=None):
  proc,receipt=space['psql_file'](db,path,R,stem,variables=variables)
  assert len(proc.stdout)<=2*1024*1024 and len(proc.stderr)<=2*1024*1024
  return proc,receipt
 def event_catalog():
  return json.loads(sql(db,"select jsonb_build_object('namespace',(select to_jsonb(n)from pg_namespace n where nspname='gridex_webhook_test'),'relations',(select jsonb_agg(to_jsonb(c)order by c.oid)from pg_class c where c.relnamespace='gridex_webhook_test'::regnamespace or c.oid='public.webhook_deliveries_ordinary_dispatch'::regclass),'columns',(select jsonb_agg(to_jsonb(a)order by a.attrelid,a.attnum)from pg_attribute a where(a.attrelid in(select oid from pg_class where relnamespace='gridex_webhook_test'::regnamespace)or a.attrelid='public.webhook_deliveries_ordinary_dispatch'::regclass)and a.attnum>0 and not a.attisdropped),'constraints',(select jsonb_agg(to_jsonb(c)order by c.oid)from pg_constraint c where c.connamespace='gridex_webhook_test'::regnamespace),'receivers',(select count(*)from gridex_webhook_test.receivers),'factories',(select count(*)from gridex_webhook_test.runtime_factories),'view',pg_get_viewdef('public.webhook_deliveries_ordinary_dispatch'::regclass,true));"))
 def publication_catalog():
  return json.loads(sql(db,"select jsonb_build_object('namespace',(select to_jsonb(n)from pg_namespace n where nspname='gridex_webhook_publication_test'),'relations',(select jsonb_agg(to_jsonb(c)order by c.oid)from pg_class c where c.relnamespace='gridex_webhook_publication_test'::regnamespace),'columns',(select jsonb_agg(to_jsonb(a)order by a.attrelid,a.attnum)from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relnamespace='gridex_webhook_publication_test'::regnamespace and a.attnum>0 and not a.attisdropped),'constraints',(select jsonb_agg(to_jsonb(c)order by c.oid)from pg_constraint c where c.connamespace='gridex_webhook_publication_test'::regnamespace),'triggers',(select jsonb_agg(to_jsonb(t)order by t.oid)from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='gridex_webhook_publication_test'::regnamespace),'bindings',(select count(*)from gridex_webhook_publication_test.event_bindings));"))
 def verify_new(before,after,expected):
  for key,value in before['allRawFunctions'].items():assert after['allRawFunctions'][key]==value,('OLD_FUNCTION_RAW_CHANGED',key)
  new={k:v for k,v in after['allRawFunctions'].items()if k not in before['allRawFunctions']}
  assert len(new)==len(expected)and len(after['allRawFunctions'])==len(before['allRawFunctions'])+len(expected)
  assert {k.split('.')[0]+'.'+v['rawPgProc']['proname']:hashlib.md5(v['rawPgProc']['prosrc'].encode()).hexdigest()for k,v in new.items()}==expected
  roleoids=json.loads(sql(db,"select jsonb_object_agg(rolname,oid::text)from pg_roles where rolname in('postgres','authenticated','service_role');"))
  for key,v in new.items():
   name=key.split('.')[0]+'.'+v['rawPgProc']['proname'];p=v['rawPgProc'];assert v['owner']=='postgres'and p['proconfig']==['search_path=pg_catalog']and p['provolatile']=='v'
   assert p['prosecdef']is(name!='gridex_webhook_test.immutable_v1')
   role='authenticated'if name in ['public.gridex_issue_local_test_webhook_receiver_v1','public.gridex_issue_local_publication_test_receiver_v1']else'service_role'if name.startswith('public.gridex_claim_')or name.startswith('public.gridex_validate_')else None
   assert all(str(a['grantee'])==roleoids['postgres']or(role is not None and str(a['grantee'])==roleoids[role]and a['privilege_type']=='EXECUTE'and not a['is_grantable'])for a in v['expandedAcl'])
   if role:assert any(str(a['grantee'])==roleoids[role]for a in v['expandedAcl'])
 with pathlib.Path(C['soleLockPath']).open('a+')as lock:
  fcntl.flock(lock,fcntl.LOCK_EX);m['app_absent'](C);by={o['Id']:o for o in space['inspect']()};assert all(not by[i]['State']['Running']for i in C['pausedServiceIds'])
  assert sql('template1',"select current_setting('server_version_num')::int/10000;")=='17'
  assert shutil.disk_usage(C['diskBudgetPath']).free>=C['preCloneBudgetBytes']
  assert not sql('template1',"select 1 from pg_database where datname='"+db+"';")
  before=snapshot('postgres');assert before==read(C['freshMainSnapshotPath'])==read(seal['mainBeforePath'])
  assert len(before['rows'])==522 and len(before['allRawFunctions'])==3370
  cp=C['trustedCheckpoint'];trusted=read(cp['refs']['postIssueFullSnapshot']['path']);cpseal=read(cp['refs']['postIssueSeal']['path'])
  assert H(cpseal['dumpPath'])==cpseal['dumpSHA256']and pathlib.Path(cpseal['dumpPath']).stat().st_size==cpseal['dumpBytes']
  R.mkdir(mode=0o700);save(R/'main-before.private.json',before)
  J={'state':'INTENT_PUBLICATION_EVENT_N0_ONLY','targetSHA256':H(target),'wrapperSHA256':H(__file__),'cloneDatabase':db,'createAttempted':False,'noAuthRestBusinessOrEventSeed':True,'noAuthorityOrBusinessCalls':True};save(R/'intent.safe.json',J);primary=None
  try:
   J['createAttempted']=True;save(R/'create-intent.safe.json',J);sql('template1','CREATE DATABASE '+db+' WITH TEMPLATE template0 OWNER postgres;')
   with pathlib.Path(cpseal['dumpPath']).open('rb')as f:p=subprocess.run(D+['exec','-i',Q['containerId'],'pg_restore','-U','supabase_admin','-d',db,'--exit-on-error','--single-transaction'],stdin=f,capture_output=True,env=E,timeout=120)
   (R/'restore.stdout.private.log').write_bytes(p.stdout);(R/'restore.stderr.private.log').write_bytes(p.stderr);assert p.returncode==0,'RESTORE_STOP_NO_RETRY'
   assert before['settings']==trusted['settings']and all(v['roleOid']==0 for v in before['settings'])
   sql('template1',"DO $copy$ DECLARE x text;BEGIN FOR x IN SELECT unnest(setconfig)FROM pg_db_role_setting WHERE setdatabase=(SELECT oid FROM pg_database WHERE datname='postgres')AND setrole=0 LOOP EXECUTE format('ALTER DATABASE %I SET %I TO %L','"+db+"',split_part(x,'=',1),substring(x from position('='in x)+1));END LOOP;END $copy$;",user='supabase_admin')
   sql(db,C['cloneOnlyPostgisRepairSql'],user='supabase_admin')
   sm={v['signature']:v for v in space['function_metadata']('postgres')};cm={v['signature']:v for v in space['function_metadata'](db)}
   for sig in C['cloneFunctionConfigRepair']:
    assert sm[sig]['owner']=='supabase_admin'and sm[sig]['config']==['search_path=net']and cm[sig]['config']in[None,['search_path=net']]
    assert all(cm[sig][k]==sm[sig][k]for k in ['owner','bodyMD5','effectiveAcl'])
   sql(db,C['cloneFunctionConfigRepairSql'],user='supabase_admin')
   restored=snapshot(db);save(R/'restored3443-before.private.json',restored)
   assert len(restored['allRawFunctions'])==3443 and all(restored[k]==trusted[k]for k in ['rows','semantic','settings','postgis','otherFunctions'])
   wire=restored['allRawFunctions']['gridex_utilts_binding.gridex_utilts_binding.wire_tokens_v1(text)'];assert hashlib.md5(wire['rawPgProc']['prosrc'].encode()).hexdigest()=='ef0637580c08cd5801c95f3d93decd02'
   priv=private_rows();retained=read(cp['refs']['postIssuePrivate14AndReceiverRows']['path']);assert priv=={k:v for k,v in retained.items()if k!='database'}
   save(R/'private14-before.private.json',priv)
   assert all(v==[]for v in priv['private'].values()),'PREISSUE_PRIVATE14_NOT_EMPTY'
   assert sql(db,"select (to_regnamespace('gridex_webhook_test')is null and to_regclass('public.webhook_deliveries_ordinary_dispatch')is null and to_regnamespace('gridex_webhook_publication_test')is null)::text;")=='true'
   normalized=json.loads(sql(db,C['subscriptionNormalizationSQL']));save(R/'old-subscription-projection.safe.json',normalized)
   for name,key in [('predecessor','eventPredecessor'),('publication','publicationForward')]:
    before_apply=snapshot(db);p,receipt=step(C[key]['path'],'apply-'+name);save(R/('apply-'+name+'.receipt.safe.json'),receipt);assert p.returncode==0,'EXACT_DDL_APPLY_STOP_NO_RETRY'
    after_apply=snapshot(db);save(R/(name+'-after.private.json'),after_apply)
    verify_new(before_apply,after_apply,C['eventExpectedBodies']if name=='predecessor'else C['publicationExpectedBodies'])
    assert all(after_apply['rows'][k]==v for k,v in restored['rows'].items()if k!='public.webhook_subscriptions')
    assert json.loads(sql(db,C['subscriptionNormalizationSQL']))==normalized
    assert after_apply['settings']==restored['settings']and after_apply['postgis']==restored['postgis']and private_rows()==priv
    cat=event_catalog();assert cat['receivers']==0 and cat['factories']==0
    if name=='predecessor':old_event_cat=cat
    else:assert cat==old_event_cat,'PUBLICATION_CHANGED_OLD_EVENT_CATALOG'
    pubcat=publication_catalog()if name=='publication'else None
    if pubcat:assert pubcat['bindings']==0
    save(R/(name+'-catalog.safe.json'),{'event':cat,'publication':pubcat})
    p,receipt=step(C[key]['path'],'replay-'+name);save(R/('replay-'+name+'.receipt.safe.json'),receipt);assert p.returncode==0,'DDL_REPLAY_STOP_NO_RETRY'
    assert snapshot(db)==after_apply and event_catalog()==cat and private_rows()==priv,'DDL_REPLAY_CHANGED_STATE'
    if pubcat:assert publication_catalog()==pubcat
   assert len(after_apply['allRawFunctions'])==3457
   p,receipt=step(C['publicationN0Units']['path'],'publication-N0-roles-acl-rollback',{'expected_database':db});save(R/'publication-N0.receipt.safe.json',receipt)
   assert p.returncode==0 and b'PUBLICATION_TEST_N0_SQL_ROLE_ACL_PRIMARY_DENIAL_UNITS_ROLLBACK_NOT_GENUINE_JWT_OR_EVENT_PROOF'in p.stdout,'PUBLICATION_N0_NOT_MET'
   assert snapshot(db)==after_apply and event_catalog()==old_event_cat and publication_catalog()==pubcat and private_rows()==priv,'N0_ROLLBACK_CHANGED_STATE'
   J.update(predecessorAppliedAndReplay=True,publicationAppliedAndReplay=True,nativeFixtureFreeN0Met=True,positiveEventFactoryJwtTlsStatus='NOT_RUN',old3443FunctionsByteExact=True,private14Unchanged=True,publicationReadOnlyQuery='SEPARATE_PRODUCER_READ_ONLY_STEP_NOT_EXECUTED_BY_THIS_OUTER')
  except BaseException as e:
   primary=e;J['errorClass']=type(e).__name__
   try:
    if sql('template1',"select 1 from pg_database where datname='"+db+"';"):
     failed=snapshot(db);raw=(json.dumps(failed,indent=2)+'\n').encode();assert len(raw)<=48*1024*1024
     save(R/'failure-clone-snapshot.private.json',failed)
   except BaseException as capture:J['failureSnapshotCaptureErrorClass']=type(capture).__name__
  finally:
   try:
    exists=bool(sql('template1',"select 1 from pg_database where datname='"+db+"';"));assert not exists or J['createAttempted']
    if exists:
     sql('template1',"select pg_terminate_backend(pid)from pg_stat_activity where datname='"+db+"'and pid<>pg_backend_pid();",user='supabase_admin')
     sql('template1','DROP DATABASE '+db+';',user='supabase_admin')
    J['cloneAbsent']=not bool(sql('template1',"select 1 from pg_database where datname='"+db+"';"))
   except BaseException as e:J['cleanupErrorClass']=type(e).__name__
   try:post=snapshot('postgres');save(R/'main-after.private.json',post);J['mainFullSnapshotUnchanged']=post==before
   except BaseException as e:J['mainPostErrorClass']=type(e).__name__
   J['state']='TERMINAL_PUBLICATION_EVENT_N0_COMPONENT_CLOSED'if primary is None and J.get('cloneAbsent')and J.get('mainFullSnapshotUnchanged')else 'STOP_NO_RETRY';save(R/'terminal.safe.json',J)
  assert J.get('cloneAbsent')and J.get('mainFullSnapshotUnchanged')and not J.get('cleanupErrorClass')and not J.get('mainPostErrorClass')
  if primary:raise primary
  print(json.dumps({'state':J['state'],'runDir':str(R)}))
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--target',required=True);a.add_argument('--root-go');a.add_argument('--execute',action='store_true');x=a.parse_args()
 if x.execute:assert x.root_go;execute(x.target,x.root_go)
 else:print(json.dumps({'state':'UNARMED_FILESYSTEM_AST_ONLY','donorASTManifest':static(read(x.target))[1]}))
