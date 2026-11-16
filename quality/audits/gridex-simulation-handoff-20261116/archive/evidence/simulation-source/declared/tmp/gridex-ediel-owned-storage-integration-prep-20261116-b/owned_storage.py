"""Producer-only real Storage sibling for a fresh, already qualified own clone.
No import-time backend activity. Caller owns Auth, business dispatch and full oracle.
"""
import contextlib,hashlib,http.client,importlib.util,json,os,pathlib,re,shutil,stat,subprocess,time,urllib.parse
P=pathlib.Path
DB='gridex_local_partner_http_20261113_a'
ROOT=P('/tmp/gridex-ediel-owned-storage-actual-20261116-b')
NAME='gridex-ediel-owned-storage-20261116-b'
IMAGE='sha256:da6409e5fd135ab8895f0c344f82066d99c107ca1031ed4a1ab1d33f0b775572'
INSPECT=P('/tmp/gridex-local-server-role-window-maintenance-20261116-aa/before-maintenance-inspect.private.json')
INSPECT_SHA='dded6a250e535079e6f4a301953ccceaf0cf1696cfe2d1470ae52cec83bdddbe'
ORIGINAL_STORAGE='ebba619f50cd24d2e3156bbdb6e474a65dfab115299611fe25907d0789b94feb'
OBJECT_ROOT=ROOT/'objects'
D=['/usr/local/bin/docker','--host=unix:///var/run/docker.sock']
ENV={k:v for k,v in os.environ.items()if not k.startswith(('DOCKER_','PG'))}
MIGRATION_NAMES=('create-migrations-table','initialmigration','storage-schema','pathtoken-column','add-migrations-rls','add-size-functions','change-column-name-in-get-size','add-rls-to-buckets','add-public-to-buckets','fix-search-function','search-files-search-function','add-trigger-to-auto-update-updated_at-column','add-automatic-avif-detection-flag','add-bucket-custom-limits','use-bytes-for-max-size','add-can-insert-object-function','add-version','drop-owner-foreign-key','add_owner_id_column_deprecate_owner','alter-default-value-objects-id','list-objects-with-delimiter','s3-multipart-uploads','s3-multipart-uploads-big-ints','optimize-search-function','operation-function','custom-metadata','objects-prefixes','search-v2','object-bucket-name-sorting','create-prefixes','update-object-levels','objects-level-index','backward-compatible-index-on-objects','backward-compatible-index-on-prefixes','optimize-search-function-v1','add-insert-trigger-prefixes','optimise-existing-functions','add-bucket-name-length-trigger','iceberg-catalog-flag-on-buckets','add-search-v2-sort-support','fix-prefix-race-conditions-optimized','add-object-level-update-trigger','rollback-prefix-triggers','fix-object-level','vector-bucket-type','vector-buckets','buckets-objects-grants','iceberg-table-metadata','iceberg-catalog-ids','buckets-objects-grants-postgres','search-v2-optimised','index-backward-compatible-search','drop-not-used-indexes-and-functions','drop-index-lower-name','drop-index-object-level','prevent-direct-deletes','fix-optimized-search-function','s3-multipart-uploads-metadata','operation-ergonomics')
READINESS_SQL="""SET statement_timeout='8s';SET lock_timeout='5s';
SELECT json_build_object('database',current_database(),
'migrations',(SELECT coalesce(json_agg(to_jsonb(m)ORDER BY id),'[]')FROM storage.migrations m),
'buckets',(SELECT coalesce(json_agg(to_jsonb(b)ORDER BY id),'[]')FROM storage.buckets b),
'objects',(SELECT count(*)FROM storage.objects));"""

def need(v,m):
 if not v:raise AssertionError(m)
def H(p):return hashlib.sha256(P(p).read_bytes()).hexdigest()
def read(p):return json.loads(P(p).read_bytes())
def docker(args,timeout=15):return subprocess.run(D+args,env=ENV,capture_output=True,check=True,timeout=timeout).stdout
def constructor_budget():
 p=P(__file__).parent/'storage_constructor_budget.py';need(H(p)=='7752c8d34552759528772fb731650d7d6b626c7bb35becc7ee5dd5686bce4ab6','FIXED_REVIEWED_VFS_CONSTRUCTOR_BUDGET_SOURCE')
 spec=importlib.util.spec_from_file_location('qualified_storage_vfs_budget',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def roles(keys):
 # Actual signature/only-two-field verification belongs to the genuine epoch peer.
 need(set(keys)>={'anonKey','serviceRoleKey','jwtSecret'},'ACTUAL_SERVER_KEY_CARRIER_REQUIRED')
def source_storage():
 need(H(INSPECT)==INSPECT_SHA,'QUALIFIED_STORAGE_INSPECT_DRIFT')
 rows=read(INSPECT);x=next(v for v in rows if v['Id']==ORIGINAL_STORAGE)
 need(x['Image']==IMAGE and x['Config']['Cmd']==['node','dist/start/server.js'] and x['Config']['Entrypoint']==['docker-entrypoint.sh'],'QUALIFIED_REAL_STORAGE_IMAGE_REQUIRED')
 return x
def prepare_env(original,keys,rest_ip):
 roles(keys);need(re.fullmatch(r'172\.\d{1,3}\.\d{1,3}\.\d{1,3}',rest_ip),'EXACT_OWN_REST_IP_REQUIRED')
 e=dict(v.split('=',1)for v in original['Config']['Env']if '='in v)
 need(e['STORAGE_BACKEND']=='file'and e['FILE_STORAGE_BACKEND_PATH']=='/var/lib/storage','FILE_BACKEND_ONLY')
 u=urllib.parse.urlsplit(e['DATABASE_URL'])
 need(u.scheme=='postgres'and u.username=='supabase_storage_admin'and u.hostname=='db'and u.port==5432 and u.path=='/postgres'and not u.query,'QUALIFIED_DB_URI_SHAPE')
 need(e['AUTH_JWT_SECRET']==keys['jwtSecret'],'SAME_ACTUAL_JWT_SECRET_REQUIRED')
 e={k:v for k,v in e.items()if 'proxy'not in k.lower()}
 need(not any(k.startswith('AWS_')or k in {'GLOBAL_S3_ENDPOINT','STORAGE_S3_ENDPOINT','PG_QUEUE_CONNECTION_URL','DATABASE_MULTITENANT_URL','MULTITENANT_DATABASE_URL'}for k in e),'NO_EXTERNAL_S3_OR_OTHER_DATABASE')
 e.update(DATABASE_URL=urllib.parse.urlunsplit(u._replace(path='/'+DB)),POSTGREST_URL='http://'+rest_ip+':3000',ANON_KEY=keys['anonKey'],SERVICE_KEY=keys['serviceRoleKey'],AUTH_JWT_SECRET=keys['jwtSecret'],TENANT_ID=NAME,GLOBAL_S3_BUCKET=NAME,STORAGE_BACKEND='file',FILE_STORAGE_BACKEND_PATH='/var/lib/storage',FILE_SIZE_LIMIT='2097152',MULTI_TENANT='false',DB_INSTALL_ROLES='false',DB_ALLOW_MIGRATION_REFRESH='false',DB_MIGRATIONS_FREEZE_AT='operation-ergonomics',PG_QUEUE_ENABLE='false',PG_QUEUE_WORKERS_ENABLE='false',S3_PROTOCOL_ENABLED='false',ENABLE_IMAGE_TRANSFORMATION='false',NODE_OPTIONS='--max-old-space-size=128')
 e.update(WORKERS_NUM='1',DATABASE_MAX_CONNECTIONS='2',DATABASE_STATEMENT_TIMEOUT='8000',TRACING_ENABLED='false',OTEL_METRICS_ENABLED='false')
 need(all('\n'not in v and '\r'not in v for v in e.values()),'SINGLE_LINE_PRIVATE_ENV_REQUIRED')
 return e
def readiness(rt):
 x=json.loads(rt['sql'](DB,READINESS_SQL));need(x['database']==DB,'OWN_STORAGE_DATABASE_ONLY')
 ms=x['migrations'];need(len(ms)==59 and {v['name']for v in ms}==set(MIGRATION_NAMES),'ALL_59_IMAGE_MIGRATIONS_ALREADY_APPLIED')
 need(len({v['id']for v in ms})==59 and all(isinstance(v.get('hash'),str)and v['hash']for v in ms),'NATIVE_MIGRATION_IDENTITIES_AND_HASHES_REQUIRED')
 need(x['objects']==0,'FRESH_OWN_OBJECT_METADATA_EMPTY_REQUIRED')
 return x
def main_fence(rt):
 snap=rt['snapshot']('postgres')
 seq=json.loads(rt['sql']('postgres',"SELECT json_agg(json_build_object('schema',schemaname,'sequence',sequencename,'lastValue',last_value)ORDER BY schemaname,sequencename)FROM pg_sequences;"))
 need(len(snap['rows'])==522 and len(snap['allRawFunctions'])==3370 and len(seq)==7,'QUALIFIED_MAIN_FULL_AND_ALL7_REQUIRED')
 return snap,seq
def inspect_own(cid,restid,source_sha):
 x=json.loads(docker(['inspect',cid]))[0]
 need(x['Id']==cid and x['Image']==IMAGE and x['Config']['Labels'].get('gridex.storage.owner')==NAME and x['Config']['Labels'].get('gridex.storage.source')==source_sha,'EXACT_OWN_STORAGE_IDENTITY')
 need(x['HostConfig']['NetworkMode']=='container:'+restid and x['HostConfig']['PortBindings']in(None,{})and not x['HostConfig'].get('Binds')and not x['HostConfig'].get('VolumesFrom'),'OWN_REST_NETNS_NO_MAIN_VOLUME_OR_HOST_PORT')
 need(x['HostConfig']['ReadonlyRootfs']is True and set(x['HostConfig']['Tmpfs'])=={'/tmp'},'READONLY_SERVICE_ROOT_AND_BOUNDED_TMP_REQUIRED')
 mounts=x['Mounts'];need(len(mounts)==1 and mounts[0]['Type']=='bind'and mounts[0]['Source']==str(OBJECT_ROOT)and mounts[0]['Destination']=='/var/lib/storage'and mounts[0]['RW']is True,'ONLY_EXCLUSIVE_OWN_OBJECT_DIRECTORY_MOUNT')
 return x
def object_inventory():
 """Bounded read-only custody, never deletion. Unreadable objects remain explicit."""
 rows=[];total=0;unreadable=[]
 def walk_error(exc):raise exc
 for root,dirs,files in os.walk(OBJECT_ROOT,followlinks=False,onerror=walk_error):
  for name in dirs+files:
   p=P(root)/name;s=p.lstat();need(not stat.S_ISLNK(s.st_mode),'OWN_OBJECT_SYMLINK_UNEXPECTED')
  for name in files:
   p=P(root)/name;s=p.lstat();need(stat.S_ISREG(s.st_mode),'REGULAR_OWN_OBJECT_REQUIRED');total+=s.st_size;need(len(rows)<256 and total<=16777216,'FINITE_OWN_OBJECT_FILE_COUNT_AND_BYTES')
   r={'relativePath':str(p.relative_to(OBJECT_ROOT)),'bytes':s.st_size,'uid':s.st_uid,'gid':s.st_gid,'mode':oct(stat.S_IMODE(s.st_mode))}
   try:r['sha256']=H(p)
   except PermissionError:r['readableByProducer']=False;unreadable.append(r['relativePath'])
   rows.append(r)
 return {'objectRoot':str(OBJECT_ROOT),'files':rows,'totalBytes':total,'unreadablePaths':unreadable,'rawFilesRetained':True,'normalStorageAPIReadbackAndOriginalOracleStillRequired':True}

@contextlib.contextmanager
def own_storage(rt,T,save):
 """Called only by a source-paired outer controller under its real actual scopes.
 The service must stop before the owning REST/clone context exits.
 """
 need(T['state']=='BOUND_OWN_STORAGE'and T['actualRoot']==str(ROOT)and not ROOT.exists(),'FRESH_BOUND_STORAGE_ROOT_REQUIRED')
 need(time.time()<T['notAfterEpoch']<=time.time()+1800,'PARENT_BOUNDED_WINDOW_REQUIRED')
 need(T['additionalTmpBytesMin']==33554432 and shutil.disk_usage('/tmp').free>=T['additionalTmpBytesMin'],'OWN_OBJECT_AND_EVIDENCE_STORAGE_RESERVE_REQUIRED')
 for r in T['sourcePins']:need(H(r['path'])==r['sha256'],'STORAGE_COMPONENT_SOURCE_DRIFT')
 need(T['sourceSHA256']==H(__file__)and rt['restId']!=ORIGINAL_STORAGE and re.fullmatch('[0-9a-f]{64}',rt['restId']),'ACTUAL_OWN_REST_CID_REQUIRED')
 original=source_storage();carrier=T['carrier'];need(H(carrier['path'])==carrier['sha256']==H('/workspace/gridex-site-validation-runtime-evidence-20261112/runtime.private.json'),'ACTUAL_SELECTED_CARRIER_CURRENT')
 peer_ref=T['roleOutcome'];need(H(peer_ref['path'])==peer_ref['sha256'],'GENUINE_SELECTED_ROLE_OUTCOME_REF_REQUIRED');peer=read(peer_ref['path'])
 need(peer['reviewerAgent']=='/root/qa_remaining_checks'and peer['verdict']=='ACTUAL_STANDARD_'+T['serverEpoch']+'_RENEWAL_COMPONENT_APPROVE'and peer['carrier']==carrier,'EXACT_REAL_SERVER_EPOCH_OUTCOME_REQUIRED')
 need(peer['actualClaims']['roles']==['anon','service_role']and peer['actualClaims']['exp']-peer['actualClaims']['iat']==7200 and peer['actualClaims']['exp']>T['notAfterEpoch']+120 and peer['sameSecretOnlyTwoFieldsChangedPrivatelyVerified']is True,'REAL_SERVER_ROLE_WINDOW_SAME_SECRET_REQUIRED')
 keys=read(carrier['path']);e=prepare_env(original,keys,rt['restIP'])
 # No original service is started, stopped, mounted or rewritten.
 rest=json.loads(docker(['inspect',rt['restId']]))[0];need(rest['State']['Running']is True and rest['Config']['Labels'].get('gridex.event.owner','').startswith('headless-')and rest['Config']['Labels'].get('gridex.event.source')==T['ownRestRuntimeSHA256'],'QUALIFIED_OWN_REST_NAMESPACE_REQUIRED')
 need(not docker(['ps','-aq','--no-trunc','--filter','name=^/'+NAME+'$']).strip(),'OWN_STORAGE_EXISTS_NO_ADOPTION')
 base=readiness(rt);clone_before=rt['snapshot'](DB);main_before,seq_before=main_fence(rt)
 ROOT.mkdir(mode=0o700);OBJECT_ROOT.mkdir(mode=0o700)
 # Private0700 ancestor prevents host traversal. Sticky leaf supports unchanged
 # image UID; only this new CID sees the bind, and every artifact is retained.
 os.chmod(OBJECT_ROOT,0o1777)
 ep=ROOT/'storage.env.private';fd=os.open(ep,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'w')as f:f.write(''.join(k+'='+v+'\n'for k,v in e.items()));f.flush();os.fsync(f.fileno())
 save(ROOT/'intent.safe.json',{'state':'ONE_OWN_REAL_STORAGE_FILE_BACKEND_INTENT','sourceSHA256':H(__file__),'image':IMAGE,'ownDatabase':DB,'restId':rt['restId'],'networkMode':'container:'+rt['restId'],'objectRoot':str(OBJECT_ROOT),'objectBytesMax':16777216,'objectBytesArePolicyBoundNotFilesystemQuota':True,'MainStorageNeverAdopted':True})
 cid=None;primary=None;absent=False;constructor_unknown=False;constructor_dispatched=False
 try:
  allowance=constructor_budget();facts=allowance.fresh(docker)
  need(shutil.disk_usage('/workspace').free>=allowance.IMAGE_CEILING+allowance.CONSTRUCTOR_RESERVE,'REMAINING_VFS_IMAGE_COPY_AND_CONSTRUCTOR_WORKSPACE_REQUIRED')
  save(ROOT/'constructor-admission.safe.json',dict(facts,workspaceAvailableBeforeCreate=shutil.disk_usage('/workspace').free,remainingWorkspaceBytesMin=allowance.IMAGE_CEILING+allowance.CONSTRUCTOR_RESERVE,originalCreateTimeoutSeconds=30))
  constructor_dispatched=True;cid=docker(['create','--name',NAME,'--label','gridex.storage.owner='+NAME,'--label','gridex.storage.source='+H(__file__),'--network','container:'+rt['restId'],'--memory','256m','--memory-swap','256m','--cpus','0.5','--cap-drop','ALL','--security-opt','no-new-privileges','--read-only','--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=16777216,mode=1777','--mount','type=bind,source='+str(OBJECT_ROOT)+',destination=/var/lib/storage,bind-propagation=rprivate','--env-file',str(ep),IMAGE,*original['Config']['Cmd']],timeout=30).decode().strip()
  need(re.fullmatch('[0-9a-f]{64}',cid),'CREATED_OWN_STORAGE_CID_REQUIRED');save(ROOT/'created.safe.json',{'containerId':cid,'sourceSHA256':H(__file__)})
  inspect_own(cid,rt['restId'],H(__file__));docker(['start',cid],timeout=15)
  conn=http.client.HTTPConnection(rt['restIP'],5000,timeout=3)
  end=min(time.time()+20,T['notAfterEpoch'])
  while True:
   try:
    conn.request('GET','/status');response=conn.getresponse();body=response.read(65537);need(response.status==200 and len(body)<=65536,'REAL_STORAGE_STATUS_REQUIRED');break
   except (OSError,http.client.HTTPException):
    need(time.time()<end,'OWN_STORAGE_STARTUP_STOP_NO_RESTART');time.sleep(.2);conn.close();conn=http.client.HTTPConnection(rt['restIP'],5000,timeout=3)
  conn.close();need(inspect_own(cid,rt['restId'],H(__file__))['State']['Running']is True,'REAL_OWN_STORAGE_SERVICE_RUNNING_REQUIRED')
  need(rt['snapshot'](DB)==clone_before,'STORAGE_STARTUP_MIGRATION_OR_OTHER_CLONE_DRIFT')
  main_now,seq_now=main_fence(rt);need(main_now==main_before and seq_now==seq_before,'MAIN_AND_ALL7_UNCHANGED_DURING_STORAGE_SETUP')
  save(ROOT/'ready.safe.json',{'state':'REAL_OWN_STORAGE_READY_NO_UPLOAD_OR_SMTP_CLAIM','containerId':cid,'storageIP':rt['restIP'],'storagePort':5000,'ownDatabase':DB,'migrationRows':59,'objectsAtStart':0,'image':IMAGE,'startupCloneAndMainAll7Exact':True,'noActorAuthority':True})
  yield {'storageId':cid,'storageIP':rt['restIP'],'storagePort':5000,'bucket':'ediel-files','ownDatabase':DB,'notAfterEpoch':T['notAfterEpoch']}
 except BaseException as exc:primary=type(exc).__name__;constructor_unknown=constructor_dispatched and isinstance(exc,subprocess.TimeoutExpired)and cid is None;raise
 finally:
  errors=[]
  try:
   if not cid:
    found=docker(['ps','-aq','--no-trunc','--filter','name=^/'+NAME+'$']).decode().split();need(len(found)<=1,'AMBIGUOUS_OWN_STORAGE')
    if found:cid=found[0]
   if cid:
    inspect_own(cid,rt['restId'],H(__file__))
    try:docker(['stop','--time','10',cid],timeout=15)
    finally:
     try:save(ROOT/'stopped-inspect.private.json',json.loads(docker(['inspect',cid]))[0])
     finally:docker(['rm',cid],timeout=15)
   absent=not bool(docker(['ps','-aq','--no-trunc','--filter','name=^/'+NAME+'$']).strip())
  except BaseException as exc:errors.append('STORAGE:'+type(exc).__name__)
  if absent and not constructor_unknown and ep.exists():ep.unlink()
  try:save(ROOT/'retained-object-custody.private.json',object_inventory())
  except BaseException as exc:errors.append('OBJECT_CUSTODY:'+type(exc).__name__)
  save(ROOT/'closed.safe.json',{'state':'OWN_STORAGE_CLOSED_REQUIRES_OUTER_MAIN_AUTH_ALL7_ORACLE'if absent and not errors and not constructor_unknown else'STOP_STORAGE_CLEANUP_REQUIRES_REVIEW','ownStorageAbsent':absent,'constructorRequestOutcomeUnknown':constructor_unknown,'daemonCancellationOrNoLateRegistrationNotProven':constructor_unknown,'exclusiveRawObjectRootRetained':str(OBJECT_ROOT),'privateEnvRemoved':not ep.exists(),'primaryErrorClass':primary,'cleanupErrors':errors,'callerOwnsFinalMainAuthAll7AndFullObjectEvidence':True})
  need(absent and not errors and not constructor_unknown,'MANDATORY_OWN_STORAGE_CLEANUP_REQUIRED')
