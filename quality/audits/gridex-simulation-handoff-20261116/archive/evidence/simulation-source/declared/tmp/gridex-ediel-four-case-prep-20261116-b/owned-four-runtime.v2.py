"""Finite EDIEL02.05/03.01/03.02/03.03 ordinary mail/Storage clone port. No action on import.
Uses unchanged qualified W reader/apply declarations. No Next, browser or private-app runtime.
The caller owns genuine Auth and same-session logout; this context always removes its own REST/DB.
"""
import contextlib,fcntl,hashlib,importlib.util,json,os,pathlib,re,resource,shutil,subprocess,time,urllib.parse
P=pathlib.Path
DONOR=P('/workspace/gridex-event-next-W-prep-20261115/parent.W.py')
DONOR_SHA='11f18b12b2f3bb958b05f66c7336f0897f3e3b609b676194117152bf67d89115'
BASE=P('/workspace/gridex-event-next-W-prep-20261115/target.EVENT.W.parent.EXECUTION.BOUND.safe.json')
DB='gridex_local_partner_http_20261113_a'
ROOT=P('/tmp/gridex-ediel-four-case-actual-20261116-b')
REST_NAME='gridex-ediel-four-rest-20261116-b'
ENV={k:v for k,v in os.environ.items() if not k.startswith('PG') and k not in {'DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'}}
D=['/usr/local/bin/docker','--host=unix:///var/run/docker.sock']
def H(p):
 h=hashlib.sha256()
 with P(p).open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def read(p):return json.loads(P(p).read_text())
def capture_after_queue_rowmap(runtime,baseline_path):
 # One fresh full qualified snapshot, with all522 row scopes retained. This is
 # an explicit compact observation, never a claim of another physical full RAW.
 baseline_path=P(baseline_path)
 need(baseline_path.parent==ROOT and baseline_path.name=='clone-after-poll.private.json'and baseline_path.is_file()and not baseline_path.is_symlink(),'EXACT_RETAINED_PREQUEUE_FULL_BASELINE')
 baseline=read(baseline_path);fresh=runtime['snapshot'](DB)
 need(set(fresh)==set(baseline)and len(fresh['rows'])==len(baseline['rows'])==522 and set(fresh['rows'])==set(baseline['rows'])and len(fresh['allRawFunctions'])==3443,'FRESH_COMPLETE_522_3443_SNAPSHOT')
 need(all(fresh[k]==baseline[k]for k in baseline if k!='rows'),'AFTER_QUEUE_ALL_NONROW_METADATA_EXACT')
 nonrow={k:v for k,v in fresh.items()if k!='rows'}
 witness={'state':'FRESH_FULL_NATIVE_AFTER_QUEUE_COMPACT_COMPLETE_ROWMAP','database':DB,'retainedFullBaseline':ref(baseline_path),'observedAtEpoch':time.time(),'rowScopes':522,'functions':3443,'rowMap':fresh['rows'],'nonrowWholeEqualityChecked':True,'nonrowCanonicalSHA256':hashlib.sha256(json.dumps(nonrow,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'changedRowScopes':sorted(k for k in fresh['rows']if fresh['rows'][k]!=baseline['rows'][k]),'noNewIndependentFullRawClaim':True,'nativeOriginalOracleAndPrivateChangedRowsStillRequired':True}
 save(ROOT/'clone-after-queue.rowmap.private.json',witness)
 return fresh,witness
FULL_RAW_NAMES=frozenset({'main-before-setup.private.json','clone-restored3443.private.json','before-auth.main.private.json','after-auth.main.private.json','clone-after-fixture.private.json','clone-after-poll.private.json','clone-after-canonical.private.json','clone-after-SMTP_451.private.json','clone-after-SMTP_550.private.json','clone-after-SMTP_DROP_DATA.private.json','owned-clone-after-business.private.json','postbusiness.main.private.json','postlogout.main.private.json','main-after-runtime.private.json','post-topology-restoration.main.private.json','owned-failure-full.private.json','emergency-postbusiness.main.private.json','final-cleanup-check.main.private.json'})
REUSE_FULL={'before-auth.main.private.json':('main-before-setup.private.json',),'owned-clone-after-business.private.json':('clone-after-SMTP_DROP_DATA.private.json','clone-after-SMTP_550.private.json','clone-after-SMTP_451.private.json','clone-after-canonical.private.json'),'postbusiness.main.private.json':('after-auth.main.private.json',),'emergency-postbusiness.main.private.json':('postbusiness.main.private.json','after-auth.main.private.json','main-before-setup.private.json'),'final-cleanup-check.main.private.json':('postlogout.main.private.json','emergency-postbusiness.main.private.json','main-before-setup.private.json'),'owned-failure-full.private.json':('owned-clone-after-business.private.json','clone-after-SMTP_DROP_DATA.private.json','clone-after-SMTP_550.private.json','clone-after-SMTP_451.private.json','clone-after-canonical.private.json','clone-after-poll.private.json','clone-after-fixture.private.json','clone-restored3443.private.json'),'main-after-runtime.private.json':('final-cleanup-check.main.private.json','postlogout.main.private.json','main-before-setup.private.json'),'post-topology-restoration.main.private.json':('final-cleanup-check.main.private.json','postlogout.main.private.json','main-before-setup.private.json')}
CAPTURE_BUDGET={'normalPhysicalFullMax':10,'fullBytesMax':23068672,'failureFcBytesMax':20971520,'smallEvidenceBytesMax':16777216,'reserveBytes':83886080,'emergencyFullMaxFromReserve':3}
_small_bytes=0
_emergency_full_used=0
def full_raw_account():
 rows={}
 for name in FULL_RAW_NAMES:
  p=ROOT/name
  if p.exists():
   st=p.lstat();need(p.is_file()and not p.is_symlink()and p.resolve()==p and st.st_mode&511==384 and st.st_size<=CAPTURE_BUDGET['fullBytesMax'],'OWN_BOUNDED_FULL_CAPTURE')
   rows[(st.st_dev,st.st_ino)]=st.st_size
 return {'uniquePhysicalFullCount':len(rows),'uniquePhysicalFullBytes':sum(rows.values())}
def save(p,v):
 global _small_bytes,_emergency_full_used
 p=P(p);data=(json.dumps(v,indent=2)+'\n').encode();full=isinstance(v,dict)and 'allRawFunctions'in v and 'rows'in v
 if full:
  need(p.parent==ROOT and p.name in FULL_RAW_NAMES and len(data)<=CAPTURE_BUDGET['fullBytesMax'],'FINITE_FULL_CAPTURE_NAME_AND_BYTES')
  for name in REUSE_FULL.get(p.name,()):
   original=ROOT/name
   if original.is_file()and not original.is_symlink()and read(original)==v:
    # The caller has just queried the native snapshot. Preserve a fresh equality
    # proof and a logical raw alias, without claiming another physical capture.
    need(not p.exists()and not p.is_symlink(),'EXCLUSIVE_FRESH_LOGICAL_CAPTURE_PATH')
    save(ROOT/(p.name+'.reuse-intent.safe.json'),{'state':'FRESH_NATIVE_WHOLE_OBJECT_EQUAL_CAPTURE_REUSE_INTENT','logicalPath':str(p),'existingRaw':ref(original),'observedAtEpoch':time.time(),'freshNativeQueryRequiredAtReviewedCallsite':True,'noNewPhysicalCaptureClaim':True})
    os.link(original,p,follow_symlinks=False);fd=os.open(p.parent,os.O_DIRECTORY);os.fsync(fd);os.close(fd)
    need(H(p)==H(original),'REUSED_RAW_BYTES_EXACT')
    save(ROOT/(p.name+'.reuse-complete.safe.json'),{'state':'LOGICAL_NATIVE_OBSERVATION_RAW_ALIAS_PUBLISHED','logicalRaw':ref(p),'existingRaw':ref(original),'observedAtEpoch':time.time(),'physicalInode':p.stat().st_ino,'noNewIndependentPhysicalCaptureClaim':True});return
  before=full_raw_account()
  if before['uniquePhysicalFullCount']>=CAPTURE_BUDGET['normalPhysicalFullMax']:
   need(p.name in {'emergency-postbusiness.main.private.json','final-cleanup-check.main.private.json','owned-failure-full.private.json','main-after-runtime.private.json','post-topology-restoration.main.private.json'}and _emergency_full_used<CAPTURE_BUDGET['emergencyFullMaxFromReserve'] and (_emergency_full_used+1)*CAPTURE_BUDGET['fullBytesMax']<=CAPTURE_BUDGET['reserveBytes'],'FINITE_UNKNOWN_RAWS_WITHIN_EXISTING_RESERVE_ONLY');_emergency_full_used+=1
 else:need(_small_bytes+len(data)<=CAPTURE_BUDGET['smallEvidenceBytesMax'],'FINITE_SMALL_EVIDENCE_BUDGET')
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(data);f.flush();os.fsync(f.fileno())
 if not full:_small_bytes+=len(data)
 fd=os.open(p.parent,os.O_DIRECTORY);os.fsync(fd);os.close(fd)

def failure_dump_limit():resource.setrlimit(resource.RLIMIT_FSIZE,(CAPTURE_BUDGET['failureFcBytesMax'],CAPTURE_BUDGET['failureFcBytesMax']))
READINESS_SQL="SET statement_timeout='8s';\nSET lock_timeout='5s';\nSELECT jsonb_build_object(\n 'database',current_database(),\n 'functionCount',(SELECT count(*)FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind IN('f','p') AND n.nspname NOT IN('pg_catalog','information_schema') AND n.nspname NOT LIKE'pg_toast%' AND n.nspname NOT LIKE'pg_temp%'),\n 'claimBodyMD5',md5((SELECT prosrc FROM pg_proc WHERE oid='public.claim_inbound_processing_jobs(text,integer,text,interval)'::regprocedure)),\n 'technicalReaderPresent',to_regprocedure('public.ediel_read_unattributed_technical_intake_v1(uuid,uuid,uuid)') IS NOT NULL,\n 'queueRows',(SELECT count(*)FROM public.inbound_processing_jobs),\n 'queueRowsFull',(SELECT coalesce(jsonb_agg(to_jsonb(j)ORDER BY id),'[]')FROM public.inbound_processing_jobs j),\n 'mailboxRows',(SELECT count(*)FROM public.ediel_mailboxes),\n 'emailRows',(SELECT count(*)FROM public.inbound_email_messages),\n 'technicalBirthRows',(SELECT count(*)FROM gridex_unattributed_intake.technical_births),\n 'mailboxSchemaPresent',to_regclass('public.ediel_mailboxes') IS NOT NULL,\n 'emailSchemaPresent',to_regclass('public.inbound_email_messages') IS NOT NULL,\n 'jobSchemaPresent',to_regclass('public.inbound_processing_jobs') IS NOT NULL,\n 'noBackgroundWorkersAssertedBySQL',false\n);\n"
def ordinary_queue_prerequisites(sql):
 raw=sql(DB,READINESS_SQL)
 r=json.loads(raw)
 need(r['database']==DB and r['functionCount']==3443,'EXACT_TRUSTED_3443_ORDINARY_SCHEMA_REQUIRED')
 need(r['claimBodyMD5']=='63dde69fa26d48381b510aa2837a5627' and r['technicalReaderPresent'] is True,'EXACT_NATIVE_QUEUE_AND_TECHNICAL_READER_REQUIRED')
 need(r['queueRows']==0 and r['queueRowsFull']==[],'PRISTINE_DECLARED_REFERENCE_QUEUE_REQUIRED_NO_FOREIGN_CLAIMS')
 need(all(r[k] is True for k in ['mailboxSchemaPresent','emailSchemaPresent','jobSchemaPresent']),'ORDINARY_MAIL_SCHEMA_REQUIRED')
 # Existing emails/mailboxes/technical births may remain; all foreign rows are fenced.
 # Own email technical-intake absence can be established only AFTER normal poll.
 # No-background-worker ownership is an outer process/lifecycle proof, never inferred here.
 return r

RESTORE_TOC=P(__file__).parent/'TRUSTED3443-RESTORE-TOC.private.txt'
RESTORE_TOC_SHA='3a5f47578b8be9d9f4f8553d33a24124085de415f3bba4d50e840c5a4c29e034'
RESTORE_SKIP_LINE=b'29019; 0 2273310 TABLE DATA public inbound_processing_jobs postgres'
RESTORE_REFERENCE=P('/tmp/gridex-event-headless-actual-20261115-c/trusted3443-before-event.private.json')
RESTORE_REFERENCE_SHA='ca0a7051994afd7142845cfe697654273cfea9c3d637de869cdef4de7e9e2dcf'
def filtered_restore_toc(raw):
 need(hashlib.sha256(raw).hexdigest()==RESTORE_TOC_SHA and raw.splitlines().count(RESTORE_SKIP_LINE)==1 and raw.count(RESTORE_SKIP_LINE)==1,'EXACT_SINGLE_QUEUE_TABLE_DATA_TOC_ENTRY_REQUIRED')
 selected=raw.replace(RESTORE_SKIP_LINE,b';'+RESTORE_SKIP_LINE)
 need(selected.replace(b';'+RESTORE_SKIP_LINE,RESTORE_SKIP_LINE)==raw,'ONLY_ONE_TOC_COMMENT_ALLOWED')
 return selected
@contextlib.contextmanager
def own_restore_list(cid,state):
 global _small_bytes
 selected=filtered_restore_toc(RESTORE_TOC.read_bytes());selected_sha=hashlib.sha256(selected).hexdigest();local=ROOT/'restore-selected.list.private'
 need(_small_bytes+len(selected)<=CAPTURE_BUDGET['smallEvidenceBytesMax'],'FINITE_SMALL_EVIDENCE_BYTES_REQUIRED')
 fd=os.open(local,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as out:out.write(selected);out.flush();os.fsync(out.fileno())
 _small_bytes+=len(selected)
 name=docker(['exec',cid,'mktemp','/tmp/gridex-ediel-four-restore-list-20261116-b.XXXXXX'],timeout=15).decode().strip()
 need(re.fullmatch(r'/tmp/gridex-ediel-four-restore-list-20261116-b\.[A-Za-z0-9]{6}',name),'EXACT_EXCLUSIVE_OWN_RESTORE_LIST_PATH')
 state.update(path=name,absent=False)
 try:
  z=subprocess.run(D+['exec','-i',cid,'sh','-c','cat > "$1"','gridex-own-restore-list',name],input=selected,env=ENV,capture_output=True,timeout=15)
  need(z.returncode==0 and docker(['exec',cid,'sha256sum','--',name],timeout=15).decode().split()[0]==selected_sha,'OWN_RESTORE_LIST_BYTES_REQUIRED')
  save(ROOT/'pristine-reference-restore-selection.safe.json',{'state':'DECLARED_REFERENCE_RESTORE_OMITS_ONLY_HISTORICAL_QUEUE_TABLE_DATA','toc':ref(RESTORE_TOC),'selectedLocal':ref(local),'selectedContainerSHA256':selected_sha,'containerPath':name,'commentedLine':RESTORE_SKIP_LINE.decode(),'sqlDeleteOrUpdate':False,'allOtherTOCBytesUnchanged':True})
  yield name
 finally:
  docker(['exec',cid,'rm','--',name],timeout=15)
  docker(['exec',cid,'sh','-c','test ! -e "$1" && test ! -L "$1"','gridex-own-restore-list-absent',name],timeout=15);state['absent']=True

def pristine_reference_rows(clone):
 need(H(RESTORE_REFERENCE)==RESTORE_REFERENCE_SHA,'QUALIFIED_TRUSTED_3443_REFERENCE_DRIFT');reference=read(RESTORE_REFERENCE)
 need(len(reference['rows'])==len(clone['rows'])==522 and set(reference['rows'])==set(clone['rows']),'ALL_522_REFERENCE_ROW_SCOPES_REQUIRED')
 need(reference['rows']['public.inbound_processing_jobs']['count']==6 and clone['rows']['public.inbound_processing_jobs']=={'hash':'d751713988987e9331980363e24189ce','count':0},'ONLY_REFERENCE_QUEUE_SIX_TO_EMPTY_REQUIRED')
 need(reference['rows']['public.platform_inbound_quarantine']==clone['rows']['public.platform_inbound_quarantine']=={'hash':'d751713988987e9331980363e24189ce','count':0},'ONLY_INCOMING_JOB_FK_SOURCE_EMPTY_REQUIRED')
 changed={k for k in reference['rows']if reference['rows'][k]!=clone['rows'][k]};need(changed=={'public.inbound_processing_jobs'},'ALL_OTHER_521_REFERENCE_ROW_HASHES_EXACT')
 for k in ['raw','semantic','postgis','otherFunctions','settings','functionRawAcl']:need(clone[k]==reference[k],'TRUSTED_STABLE_FUNCTION_OWNER_ACL_DEFINITION_SCHEMA_SETTINGS_PROJECTIONS_REQUIRED')
 need(len(clone['allRawFunctions'])==len(reference['allRawFunctions'])==3443,'TRUSTED_3443_CATALOG_COUNT_REQUIRED')
 return {'state':'PRISTINE_QUEUE_REFERENCE_ROWS_AND_STABLE_METADATA_EXACT','reference':ref(RESTORE_REFERENCE),'allRowScopes':522,'onlyChangedRowScope':'public.inbound_processing_jobs','beforeQueueCount':6,'restoredQueueCount':0,'allOther521RowHashesExact':True,'stableMetadataProjectionsExact':True,'crossCloneRawOIDEqualityNotClaimed':True}

def ref(p):return {'path':str(p),'sha256':H(p)}
def need(v,m):
 if not v:raise AssertionError(m)
def docker(a,timeout=30):return subprocess.run(D+a,env=ENV,check=True,capture_output=True,timeout=timeout).stdout

def load(T):
 need(H(RESTORE_TOC)==RESTORE_TOC_SHA and H(RESTORE_REFERENCE)==RESTORE_REFERENCE_SHA,'PRISTINE_REFERENCE_FILES_REQUIRED_BEFORE_CLONE')
 need(H(DONOR)==DONOR_SHA and H(BASE)==T['baseConfigSHA256'],'QUALIFIED_DONOR_DRIFT')
 for r in T['boundFiles']:need(H(r['path'])==r['sha256'],'SOURCE_DRIFT')
 s=importlib.util.spec_from_file_location('qualified_event_w',DONOR);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
 C=read(BASE);Q=read(C['qualifiedTargetPath']);need(H(C['qualifiedTargetPath'])==C['qualifiedTargetSHA256'],'READ_TARGET_DRIFT')
 for k in ['readDriver','fd92Driver','gen550Driver','eventN0Outer','eventNativeInputs']:
  r=C[k];need(H(r['path'])==r['sha256'],'NATIVE_SOURCE_DRIFT')
 for r in C['trustedSeed']['refs'].values():need(H(r['path'])==r['sha256'],'TRUSTED_SEED_DRIFT')
 return m,C,Q

def storage_constructor_budget():
 p=P('/tmp/gridex-ediel-owned-storage-integration-prep-20261116-b/storage_constructor_budget.py');need(H(p)=='7752c8d34552759528772fb731650d7d6b626c7bb35becc7ee5dd5686bce4ab6','FIXED_REVIEWED_VFS_CONSTRUCTOR_BUDGET_SOURCE')
 spec=importlib.util.spec_from_file_location('qualified_four_vfs_budget',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def budget(T):
 # Preserve the336MiB base (ownDB/WAL/reserve); add784MiB vfs image copy +32MiB constructor allowance.
 # All bounded full logical captures and dump outputs are on TMP, not WS.
 need(T['purposeBudget']=={'workspaceAvailableBytesMin':1207959552,'tmpAvailableBytesMin':385875968,'cgroupHeadroomBytesMin':2147483648,'ownDatabaseBytesMax':134217728},'PURPOSE_BUDGET_NOT_BOUND')
 need(T['captureBudget']==CAPTURE_BUDGET and sum([10*23068672,20971520,16777216,83886080])+33554432==385875968,'EXACT_FINITE_CAPTURE_AND_EXTRA_STORAGE_BUDGET_REQUIRED')
 b=T['purposeBudget'];v={p:shutil.disk_usage(p).free for p in ['/workspace','/tmp']}
 allowance=storage_constructor_budget();v['storageConstructorBudget']=allowance.fresh(docker)
 need(b['workspaceAvailableBytesMin']==allowance.WORKSPACE_MIN and b['tmpAvailableBytesMin']==allowance.TMP_MIN,'VFS_COPY_ALLOWANCE_ADDED_TO_UNCHANGED_BASE_NOT_TMP')
 need(T['memoryAdmissionMode']=='QUALIFIED_CONSERVATIVE_CGROUP_AVAILABLE_MEMORY_2GIB','EXPLICIT_AVAILABLE_MEMORY_ADOPTION_REQUIRED')
 helper=T['availableMemoryHelper'];need(H(helper['path'])==helper['sha256'],'QUALIFIED_AVAILABLE_MEMORY_HELPER_DRIFT')
 spec=importlib.util.spec_from_file_location('qualified_cgroup_available_memory',helper['path']);memory=importlib.util.module_from_spec(spec);spec.loader.exec_module(memory)
 sample=memory.read_actual();need(sample['thresholdBytes']==b['cgroupHeadroomBytesMin']==2147483648 and sample['advisoryEstimateNotGuaranteedReclaim'] is True,'UNCHANGED_2GIB_AND_HONEST_RECLAIM_ESTIMATE')
 v['memoryHeadroom']=sample['rawHeadroomBytes'];v['availableMemoryBytes']=sample['availableMemoryBytes'];v['availableMemorySample']=sample;v['explicitAvailableMemoryAdoption']=True;v['noOOMGuarantee']=True
 need(v['/workspace']>=b['workspaceAvailableBytesMin'] and v['/tmp']>=b['tmpAvailableBytesMin'] and sample['effectivePass'] is True and v['availableMemoryBytes']>=b['cgroupHeadroomBytesMin'],'HEADLESS_PURPOSE_RESOURCE_REQUIRED')
 return v

@contextlib.contextmanager
def _owned_runtime(T):
 os.umask(0o077);need(T['state']=='BOUND_READY' and T['actualRoot']==str(ROOT) and not ROOT.exists(),'FRESH_ACTUAL_ROOT_REQUIRED')
 need(time.time()<T['setupNotAfterEpochSeconds']<=time.time()+900,'FINITE_SETUP_WINDOW_REQUIRED');m,C,Q=load(T);observed=budget(T)
 pg=json.loads(docker(['inspect',Q['containerId']]))[0];expected_pg=next(x for x in Q['ownContainers']if x['id']==Q['containerId']);need(pg['Id']==Q['containerId'] and pg['Image']==expected_pg['image'] and pg['State']['Running']is True,'FRESH_EXACT_PG_ID_IMAGE_REQUIRED')
 ROOT.mkdir(mode=0o700);s,_=m.readers(C,Q,ENV,D,ROOT);sql=s['sql'];snapshot=s['snapshot'];cid=None;created=False;primary=None;restore_list_state={'path':None,'absent':True}
 seq=json.loads(sql('postgres',"SELECT json_agg(json_build_object('schema',schemaname,'sequence',sequencename,'lastValue',last_value) ORDER BY schemaname,sequencename) FROM pg_sequences;"));need(len(seq)==7,'ALL7_REQUIRED');save(ROOT/'main-before-setup.all7.safe.json',seq)
 counts=json.loads(sql('postgres',"SELECT json_build_object('sessions',(SELECT count(*)FROM auth.sessions),'refresh',(SELECT count(*)FROM auth.refresh_tokens),'mfaFactors',(SELECT count(*)FROM auth.mfa_factors),'mfaChallenges',(SELECT count(*)FROM auth.mfa_challenges),'mfaClaims',(SELECT count(*)FROM auth.mfa_amr_claims),'flowState',(SELECT count(*)FROM auth.flow_state));"));need(len(counts)==6 and all(v==0 for v in counts.values()),'FRESH_MAIN_AUTH0_REQUIRED');save(ROOT/'main-before-setup.auth.safe.json',counts)
 settings_before=json.loads(sql('template1',"SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY setdatabase,setrole),'[]')FROM pg_db_role_setting s;"));save(ROOT/'global-db-role-settings.before.private.json',settings_before)
 before=snapshot('postgres');need(len(before['rows'])==522 and len(before['allRawFunctions'])==3370,'CURRENT_MAIN_522_3370_REQUIRED');save(ROOT/'main-before-setup.private.json',before);save(ROOT/'resource-entry.safe.json',observed)
 need(not sql('template1',"select 1 from pg_database where datname='"+DB+"';"),'OWN_DB_EXISTS_NO_ADOPTION')
 need(not docker(['ps','-aq','--no-trunc','--filter','name=^/'+REST_NAME+'$']).strip(),'OWN_REST_EXISTS_NO_ADOPTION')
 save(ROOT/'intent.safe.json',{'state':'HEADLESS_EDIEL_FOUR_CASE_SETUP_INTENT','cloneDatabase':DB,'noUserAuthYet':True,'noBusinessMutationYet':True,'source':ref(__file__)})
 try:
  created=True;sql('template1','CREATE DATABASE '+DB+' WITH TEMPLATE template0 OWNER postgres;')
  seal=read(C['trustedSeed']['refs']['seal']['path']);dump=P(seal['dumpPath']);need(H(dump)==seal['dumpSHA256'] and dump.stat().st_size==seal['dumpBytes'],'EXACT_RESTORE_BASIS_REQUIRED')
  with own_restore_list(Q['containerId'],restore_list_state)as selected_list:
   with dump.open('rb') as f:p=subprocess.run(D+['exec','-i',Q['containerId'],'pg_restore','-U','supabase_admin','-d',DB,'--exit-on-error','--single-transaction','--use-list',selected_list],stdin=f,env=ENV,capture_output=True,timeout=120)
  save(ROOT/'restore.process.safe.json',{'exitCode':p.returncode,'stdoutSHA256':hashlib.sha256(p.stdout).hexdigest(),'stderrSHA256':hashlib.sha256(p.stderr).hexdigest(),'source':ref(dump),'noRetry':True});need(p.returncode==0,'RESTORE_STOP_NO_RETRY')
  need(all(v['roleOid']==0 for v in before['settings']) and s['settings']('postgres')==before['settings'],'EXACT_CURRENT_SETTINGS_REQUIRED')
  sql('template1',"DO $copy$ DECLARE x text;BEGIN FOR x IN SELECT unnest(setconfig)FROM pg_db_role_setting WHERE setdatabase=(SELECT oid FROM pg_database WHERE datname='postgres')AND setrole=0 LOOP EXECUTE format('ALTER DATABASE %I SET %I TO %L','"+DB+"',split_part(x,'=',1),substring(x from position('='in x)+1));END LOOP;END $copy$;",user='supabase_admin')
  sql(DB,C['cloneOnlyPostgisRepairSql'],user='supabase_admin')
  sm={v['signature']:v for v in s['function_metadata']('postgres')};cm={v['signature']:v for v in s['function_metadata'](DB)}
  for sig in C['cloneFunctionConfigRepair']:
   need(sm[sig]['owner']=='supabase_admin' and sm[sig]['config']==['search_path=net'] and cm[sig]['config'] in [None,['search_path=net']] and all(cm[sig][k]==sm[sig][k] for k in ['owner','bodyMD5','effectiveAcl']),'EXACT_CLONE_REPAIR_REQUIRED')
  sql(DB,C['cloneFunctionConfigRepairSql'],user='supabase_admin');clone=snapshot(DB);save(ROOT/'clone-restored3443.private.json',clone)
  need(len(clone['allRawFunctions'])==3443,'TRUSTED_3443_FUNCTIONS_REQUIRED_NO_EVENT_PATCHES')
  save(ROOT/'pristine-reference-rows.safe.json',pristine_reference_rows(clone))
  readiness=ordinary_queue_prerequisites(sql)
  save(ROOT/'ordinary-queue-prerequisites.safe.json',readiness)
  size=int(sql(DB,'select pg_database_size(current_database());'));need(size<=T['purposeBudget']['ownDatabaseBytesMax'] and shutil.disk_usage('/workspace').free>=83886080,'OWN_DB_SIZE_AND_REMAINING_RESERVE_BOUND')
  rp=read(C['restProvenance']['path']);need(H(rp['inspectPath'])==rp['inspectSHA256'],'REST_PROVENANCE_DRIFT');old=read(rp['inspectPath']);old=old[0] if isinstance(old,list) else old;need(old['Image']==C['restImageId'],'REST_IMAGE_DRIFT')
  env=dict(x.split('=',1)for x in old['Config']['Env']);url=urllib.parse.urlsplit(env['PGRST_DB_URI']);need(urllib.parse.unquote(url.path.lstrip('/'))=='postgres' and url.hostname==C['dbURIHost'] and (url.port or 5432)==5432,'REST_DB_SOURCE_SCOPE');env['PGRST_DB_URI']=urllib.parse.urlunsplit(url._replace(path='/'+DB))
  pc=C['managedDockerProxyConfig'];need(H(pc['path'])==pc['sha256'],'MANAGED_PROXY_CONFIG_DRIFT');defaults=read(pc['path'])['proxies']['default']
  for k,v in [('http_proxy','httpProxy'),('HTTP_PROXY','httpProxy'),('https_proxy','httpsProxy'),('HTTPS_PROXY','httpsProxy')]:env[k]=defaults[v]
  need(all('\n'not in v and '\r'not in v for v in env.values()),'CLOSED_ENV_VALUES');ep=ROOT/'clone-rest.env.private';fd=os.open(ep,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,'w')as f:f.write(''.join(k+'='+v+'\n'for k,v in env.items()));f.flush();os.fsync(f.fileno())
  net=json.loads(docker(['network','inspect',C['networkId']]))[0];need(net['Id']==C['networkId'] and net['Name']==C['networkName'],'EXACT_NETWORK_REQUIRED');db=json.loads(docker(['inspect',Q['containerId']]))[0];dn=db['NetworkSettings']['Networks'][C['networkName']];need(dn['NetworkID']==C['networkId'] and dn['IPAddress']==C['dbInternalIP'] and C['dbURIHost']in dn['Aliases'],'EXACT_PG_NETWORK_REQUIRED')
  need(json.loads(docker(['image','inspect',C['restImageId']]))[0]['Id']==C['restImageId'],'EXACT_LOCAL_REST_IMAGE_REQUIRED')
  cid=docker(['create','--name',REST_NAME,'--label','gridex.event.owner=headless-ediel-four-ordinary-queue','--label','gridex.event.source='+H(__file__),'--network',C['networkId'],'--env-file',str(ep),'--memory','256m','--cpus','0.5',C['restImageId'],*old['Config']['Cmd']]).decode().strip();need(re.fullmatch('[0-9a-f]{64}',cid),'OWN_CID_REQUIRED');save(ROOT/'rest-created.safe.json',{'id':cid,'image':C['restImageId']})
  docker(['start',cid]);obj=json.loads(docker(['inspect',cid]))[0];save(ROOT/'rest-inspect.private.json',obj);need(obj['Image']==C['restImageId'] and obj['HostConfig']['PortBindings']in[None,{}] and obj['Config']['Labels']['gridex.event.source']==H(__file__),'OWN_UNPUBLISHED_REST_REQUIRED')
  ip=obj['NetworkSettings']['Networks'][C['networkName']]['IPAddress'];need(re.fullmatch(r'172\.\d{1,3}\.\d{1,3}\.\d{1,3}',ip),'CLOSED_OWN_REST_IP')
  need(snapshot('postgres')==before,'MAIN_UNCHANGED_BEFORE_AUTH');save(ROOT/'clone-ready.safe.json',{'state':'HEADLESS_OWN_EDIEL_FOUR_QUEUE_CLONE3443_REST_READY_NO_AUTH','database':DB,'RESTId':cid,'RESTIP':ip,'RESTPort':3000,'ownDatabaseBytes':size,'normalBusinessNotRun':True,'noUserAuthYet':True,'queuePrerequisites':ref(ROOT/'ordinary-queue-prerequisites.safe.json')})
  yield {'space':s,'C':C,'Q':Q,'sql':sql,'snapshot':snapshot,'cloneBefore':clone,'queuedReadiness':readiness,'restId':cid,'restIP':ip,'restPort':3000,'mainBeforeSetup':before}
 except BaseException as e:primary=type(e).__name__;raise
 finally:
  errors=[];rest_absent=False;db_absent=False
  if not restore_list_state['absent']:
   try:
    name=restore_list_state['path'];need(re.fullmatch(r'/tmp/gridex-ediel-four-restore-list-20261116-b\.[A-Za-z0-9]{6}',name),'EXACT_OWN_RESTORE_LIST_CLEANUP_PATH')
    docker(['exec',Q['containerId'],'rm','-f','--',name],timeout=15);docker(['exec',Q['containerId'],'sh','-c','test ! -e "$1" && test ! -L "$1"','gridex-own-restore-list-absent',name],timeout=15);restore_list_state['absent']=True
   except BaseException as e:errors.append('RESTORE_LIST:'+type(e).__name__)
  try:
   if not cid:
    found=docker(['ps','-aq','--no-trunc','--filter','name=^/'+REST_NAME+'$']).decode().split();need(len(found)<=1,'AMBIGUOUS_OWN_REST')
    if found:cid=found[0]
   if cid:
    ob=json.loads(docker(['inspect',cid]))[0];need(ob['Image']==C['restImageId'] and ob['Config']['Labels']['gridex.event.source']==H(__file__),'EXACT_OWN_CLEANUP_IDENTITY')
    try:docker(['stop','--time','10',cid])
    finally:
     try:save(ROOT/'rest-stopped-inspect.private.json',json.loads(docker(['inspect',cid]))[0])
     finally:docker(['rm',cid])
   rest_absent=not bool(docker(['ps','-aq','--no-trunc','--filter','name=^/'+REST_NAME+'$']).strip())
  except BaseException as e:errors.append('REST:'+type(e).__name__)
  if primary is not None and created:
   try:
    if sql('template1',"select 1 from pg_database where datname='"+DB+"';"):
     try:save(ROOT/'owned-failure-full.private.json',snapshot(DB))
     except BaseException as exc:errors.append('FAILURE_FULL_CAPTURE:'+type(exc).__name__)
     fp=ROOT/'owned-failure.dump.private'
     with fp.open('xb')as out:
      os.fchmod(out.fileno(),0o600);z=subprocess.run(D+['exec','-i',Q['containerId'],'pg_dump','-U','supabase_admin','-d',DB,'--format=custom'],stdout=out,stderr=subprocess.PIPE,env=ENV,timeout=120,preexec_fn=failure_dump_limit);out.flush();os.fsync(out.fileno())
     save(ROOT/'owned-failure-dump.safe.json',{'exitCode':z.returncode,'dump':ref(fp),'bytes':fp.stat().st_size,'stderrSHA256':hashlib.sha256(z.stderr).hexdigest(),'unknownOutcomeNoRetry':True})
   except BaseException as e:errors.append('FAILURE_CAPTURE:'+type(e).__name__)
  try:
   if created and sql('template1',"select 1 from pg_database where datname='"+DB+"';"):sql('template1','DROP DATABASE '+DB+' WITH(FORCE);',user='supabase_admin')
   db_absent=not bool(sql('template1',"select 1 from pg_database where datname='"+DB+"';"))
  except BaseException as e:errors.append('DB:'+type(e).__name__)
  try:
   settings_after=json.loads(sql('template1',"SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY setdatabase,setrole),'[]')FROM pg_db_role_setting s;"));save(ROOT/'global-db-role-settings.after.private.json',settings_after);need(settings_after==settings_before,'GLOBAL_DB_ROLE_SETTINGS_RESTORED')
  except BaseException as e:errors.append('GLOBAL_SETTINGS:'+type(e).__name__)
  try:
   main_final=snapshot('postgres');save(ROOT/'main-after-runtime.private.json',main_final)
   seq_final=json.loads(sql('postgres',"SELECT json_agg(json_build_object('schema',schemaname,'sequence',sequencename,'lastValue',last_value) ORDER BY schemaname,sequencename) FROM pg_sequences;"));save(ROOT/'main-after-runtime.all7.safe.json',seq_final)
   auth_final=json.loads(sql('postgres',"SELECT json_build_object('sessions',(SELECT count(*)FROM auth.sessions),'refresh',(SELECT count(*)FROM auth.refresh_tokens),'mfaFactors',(SELECT count(*)FROM auth.mfa_factors),'mfaChallenges',(SELECT count(*)FROM auth.mfa_challenges),'mfaClaims',(SELECT count(*)FROM auth.mfa_amr_claims),'flowState',(SELECT count(*)FROM auth.flow_state));"));save(ROOT/'main-after-runtime.auth.safe.json',auth_final)
   need(len(seq_final)==7 and len(auth_final)==6 and all(v==0 for v in auth_final.values()),'RUNTIME_FINAL_AUTH0_ALL7_REQUIRED')
   need(set(main_final)==set(before) and set(main_final['rows'])==set(before['rows']) and all(main_final[k]==before[k]for k in before if k!='rows'),'RUNTIME_FINAL_NONROW_EXACT')
   changed={k for k in before['rows']if before['rows'][k]!=main_final['rows'][k]};need(changed<={'auth.users','auth.sessions','auth.mfa_amr_claims','auth.refresh_tokens','auth.audit_log_entries'},'RUNTIME_FINAL_NONAUTH_ROWS_EXACT')
   need({(x['schema'],x['sequence']):x['lastValue']for x in seq if x['schema']!='auth'}=={(x['schema'],x['sequence']):x['lastValue']for x in seq_final if x['schema']!='auth'},'RUNTIME_FINAL_PUBLIC_SEQUENCES_EXACT')
   if not(ROOT/'login.intent.safe.json').exists():need(main_final==before and seq_final==seq,'SETUP_WITHOUT_LOGIN_REQUIRES_WHOLE_MAIN_ALL7_EQUAL')
  except BaseException as e:errors.append('FINAL_MAIN_AUTH_ALL7:'+type(e).__name__)
  save(ROOT/'owned-runtime-closure.safe.json',{'state':'HEADLESS_OWN_RUNTIME_CLOSED'if rest_absent and db_absent and not errors else'STOP_CLEANUP_REQUIRES_REVIEW','ownRESTAbsent':rest_absent,'ownDBAbsent':db_absent,'ownContainerRestoreListAbsent':restore_list_state['absent'],'errorType':primary,'cleanupErrors':errors,'callerOwnsSameSessionLogoutAndMainAll7Residual':True,'captureBudget':CAPTURE_BUDGET,'captureCountsAtRuntimeClose':dict(full_raw_account(),smallEvidenceBytes=_small_bytes,emergencyFullFromReserveUsed=_emergency_full_used),'noScenarioPassClaim':True})
  need(rest_absent and db_absent and restore_list_state['absent'] and not errors,'MANDATORY_OWN_CLEANUP_REQUIRED')

@contextlib.contextmanager
def owned_runtime(T):
 C=read(BASE)
 with P(C['soleLockPath']).open('a+') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  integration=load_storage_integration(T)
  with _owned_runtime(T) as runtime:
   with integration.own_rest_storage(runtime,T['storageIntegration'],save)as storage:
    runtime['storage']=storage
    yield runtime


def load_storage_integration(T):
 ref=T['storageIntegrationModule']
 need(ref['path']=='/tmp/gridex-ediel-owned-storage-integration-prep-20261116-b/storage_integration.py'and ref['sha256']=='84d0f7d83501e6c919dba060c6836f8c79eb1166e214acfbfde3e1825977518b'and H(ref['path'])==ref['sha256'],'EXACT_FROZEN_OWN_STORAGE_INTEGRATION')
 st=T['storageIntegration']
 need(st['state']=='BOUND_OWN_STORAGE_INTEGRATION'and st['bridgePort']==3169 and st['sourceSHA256']==ref['sha256'],'BOUND_SAME_STORAGE_INTERFACE')
 need(st['notAfterEpoch']==st['storage']['notAfterEpoch']and st['storage']['ownRestRuntimeSHA256']==H(__file__),'SAME_STORAGE_LEASE_AND_OWN_REST_SOURCE')
 need(st['storage']['additionalTmpBytesMin']==33554432,'DECLARED_ADDITIONAL_STORAGE_TMP')
 spec=importlib.util.spec_from_file_location('qualified_four_case_storage',ref['path']);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 return module
