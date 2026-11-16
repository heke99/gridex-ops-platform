"""UNARMED private GEN926 outer. Actual sole executor execute_eight_parts.
No import-time backend/ref effects; --check is filesystem/AST only.
"""
import argparse,ast,fcntl,hashlib,importlib.util,json,os,pathlib,re,signal,subprocess,time,urllib.parse
P=pathlib.Path(__file__).resolve().parent
sha=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def load(path,name):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def static(C):
 for f in C['boundFiles']:assert sha(f['path'])==f['sha256'],('BOUND_DRIFT',f['path'])
 assert sha(C['donorOuterPath'])=='24c473d5ac7689f9bd1e6344ab52443abb99067c86b90b2b16fdb931088e7a50'
 M=load(C['donorOuterPath'],'qualified_targeted_outer');manifest=M.ast_manifest(C)
 Q=json.loads(pathlib.Path(C['qualifiedTargetPath']).read_text());effective={**Q,**C}
 nodes,decls,blocks,_=M.donor_nodes(C)
 borrowed=ast.Module(body=nodes+decls+[n for values in blocks.values()for n in values],type_ignores=[])
 required={n.slice.value for n in ast.walk(borrowed)if isinstance(n,ast.Subscript)and isinstance(n.value,ast.Name)and n.value.id=='C'and isinstance(n.slice,ast.Constant)and isinstance(n.slice.value,str)}
 assert required<=effective.keys(),('BORROWED_CONSTANT_C_KEYS_MISSING',sorted(required-effective.keys()))
 manifest['borrowedConstantCKeys']=sorted(required);manifest['effectiveQualifiedTargetMerge']=True
 assert C['sourceRegistrationHead']=='5812881977cd1ccb4336ad2d9d9fe8f19e48be74'and C['sourceEntries']==926
 I=json.loads(pathlib.Path(C['sourceInputInventoryPath']).read_text());assert I['actualPhysicalInputCount']==1335 and I['actualSQLCount']==1333 and I['actualJSONCompanions']==2
 for f in I['inventory']:assert sha(f['actualReadOnlyPath'])==f['sha256']
 return M,manifest
def execute(target,go):
 os.umask(0o077);T=pathlib.Path(target);C=json.loads(T.read_text());G=json.loads(pathlib.Path(go).read_text());M,manifest=static(C)
 assert C['state']=='BOUND_READY'and G['rootArmed']is True and G['executeAgent']=='execute_eight_parts'
 assert G['wrapperSHA256']==sha(__file__)and G['targetSHA256']==sha(T)and G['donorASTManifest']==manifest
 assert len(G['scopeReviews'])==2
 for f in G['scopeReviews']:assert sha(f['path'])==f['sha256']
 assert re.fullmatch(r'[a-z0-9_]{1,28}',C['fixtureNonce']);db=C['cloneDatabase'];assert re.fullmatch(r'gridex_gen926_candidate_[a-z0-9_]+',db)and len(db)<64
 R=pathlib.Path(C['actualRunDir']);assert str(R).startswith('/tmp/gridex-gen926-actual-')and not R.exists()
 assert sha(C['qualifiedTargetPath'])==C['qualifiedTargetSHA256'];Q=json.loads(pathlib.Path(C['qualifiedTargetPath']).read_text());assert Q['containerId']==C['containerId']
 epoch=json.loads(pathlib.Path(C['quietEpochPath']).read_text());assert sha(C['quietEpochPath'])==C['quietEpochSHA256']and epoch['state']=='QUALIFIED_CURRENT_GEN926_QUIET_EPOCH'
 assert epoch['freshMainSnapshotSHA256']==C['freshMainSnapshotSHA256']and epoch['sourceManifestSHA256']==C['sourceManifestSHA256']
 source=json.loads(pathlib.Path(C['sourceManifestPath']).read_text())[C['sourceManifestKey']];assert len(source)==C['sourceManifestCount']
 assert sha(C['sourceManifestPath'])==C['sourceManifestSHA256']and all(sha(pathlib.Path(C['sourceRoot'])/p)==h for p,h in source.items())
 E={k:v for k,v in os.environ.items()if k not in ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','PGDATABASE','PGHOST','PGPORT','PGUSER','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGOPTIONS']};D=['/usr/local/bin/docker','--host=unix:///var/run/docker.sock']
 space=dict(globals());space['sha']=lambda data:hashlib.sha256(data).hexdigest();space.update(C={**Q,**C},Q=Q,E=E,D=D,P=R);space['space']=space
 nodes,decls,blocks,role_query=M.donor_nodes(C);exec(compile(ast.Module(body=nodes+decls,type_ignores=[]),'qualified_fd92_declarations','exec'),space)
 original=space['sql']
 def sql(db,query,user='postgres'):return original(db,'BEGIN READ ONLY;\n'+query+'\nROLLBACK;'if db=='postgres'else query,user=user)
 space['sql']=sql;space.update(state=space['main_state'],semantic=space['semantic_relations'],postgis=space['postgis_acl'])
 snapshot=space['snapshot'];save=space['save'];psql_file=space['psql_file'];fnraw=space['all_function_raw'];unchanged=space['unchanged_except_body']
 def docker(args):return subprocess.run(D+args,capture_output=True,env=E,timeout=30,check=True).stdout
 def ids():return set(docker(['ps','-aq','--no-trunc']).decode().split())
 with pathlib.Path(C['soleLockPath']).open('a+')as lock:
  fcntl.flock(lock,fcntl.LOCK_EX);actual=space['inspect']();byid={x['Id']:x for x in actual}
  assert sorted(C['pausedServiceIds'])==sorted(Q['pauseServiceIds'])and all(not byid[i]['State']['Running']for i in C['pausedServiceIds'])
  proc=pathlib.Path('/proc')/str(C['appProcessGroup']);stat=(proc/'stat').read_text().rsplit(')',1)[1].split();assert stat[19]==C['appStartTicks']and sha(proc/'cmdline')==C['appCmdlineSHA256']
  held=[]
  for p in pathlib.Path('/proc').iterdir():
   if not p.name.isdigit():continue
   try:
    z=(p/'stat').read_text().rsplit(')',1)[1].split()
    if int(z[2])==C['appProcessGroup']:held.append(z[0]);assert z[0]in['T','t','Z']
   except(FileNotFoundError,ProcessLookupError):pass
  assert held and os.getpgid(C['appProcessGroup'])==C['appProcessGroup'];assert sql('postgres',"select current_setting('server_version_num')::int/10000;")=='17'
  assert __import__('shutil').disk_usage(C['diskBudgetPath']).free>=C['preCloneBudgetBytes']
  assert not sql('template1',"select 1 from pg_database where datname='"+db+"';")
  R.mkdir(mode=0o700);before=snapshot('postgres');assert before==json.loads(pathlib.Path(C['freshMainSnapshotPath']).read_text())and len(before['rows'])==522 and len(before['allRawFunctions'])==3370
  assert sha(C['freshMainSnapshotPath'])==C['freshMainSnapshotSHA256'];save(R/'main-before.private.json',before)
  seal=json.loads(pathlib.Path(C['backupSealPath']).read_text());assert before['settings']==seal['sourceDatabaseSettingsFingerprints']and before['postgis']==seal['sourcePostgisExpandedAcl']
  J={'state':'DURABLE_INTENT_GEN926_ONE_CLONE_ONE_CAPTURE','sourceRegistrationHead':C['sourceRegistrationHead'],'inputInventorySHA256':C['sourceInputInventorySHA256'],'wrapperSHA256':sha(__file__),'targetSHA256':sha(T),'priorAbsent':True,'createAttempted':False,'captureInvocations':0,'noCanonicalLocalReplayClaim':True,'cloneDatabase':db};save(R/'intent.safe.json',J)
  space.update(db=db,directory=R,K=J,before=before,seal=seal,created=False);primary=None;baseline_ids=ids();helper=None;private_url=None
  try:
   J['createAttempted']=True;save(R/'intent.safe.json',J)
   exec(compile(ast.Module(body=blocks['restoreHistorical'],type_ignores=[]),'exact_fd92_historical_restore','exec'),space);save(R/'clone-historical-seed.private.json',space['clone'])
   # Preserve exact forward loop; defer only its old3368=current comparison until targeted2 are installed.
   exec(compile(ast.Module(body=blocks['twoForwardSemantics'][:1],type_ignores=[]),'exact_fd92_two_forward_loop','exec'),space);clone=space['clone']
   r,J['foundation']=psql_file(db,C['foundationPath'],R,'foundation');assert r.returncode==0;foundation=snapshot(db)
   assert foundation['allRawFunctions']==clone['allRawFunctions']and all(foundation['rows'][k]==v for k,v in clone['rows'].items()if k!='public.role_permissions')
   assert M.role_semantics(json.loads(sql(db,role_query)))==M.role_semantics(json.loads(sql('postgres',role_query)))
   r,J['targeted']=psql_file(db,C['targetedMigrationPath'],R,'targeted');assert r.returncode==0;current=snapshot(db)
   assert len(current['allRawFunctions'])==3370 and current['otherFunctions']==before['otherFunctions'];save(R/'clone-current3370-not-current-rows.private.json',current)
   r,J['candidate']=psql_file(db,C['candidateMigrationPath'],R,'candidate-ad594');assert r.returncode==0;candidate=snapshot(db);save(R/'candidate3420-before-capture.private.json',candidate)
   assert candidate['rows']==current['rows']and all(candidate[k]==current[k]for k in['postgis','settings'])
   recipe=json.loads(pathlib.Path(C['candidateRecipePath']).read_text());allowed={v['key']:v for v in recipe['existingOverlaysAllowed']};assert len(allowed)==11
   for key,v in current['allRawFunctions'].items():
    x=candidate['allRawFunctions'][key]
    if key not in allowed:assert x==v,'UNEXPECTED_OLD_FUNCTION_CHANGE'
    else:unchanged({key:v},{key:x},key,allowed[key]['beforeBodyMD5'],allowed[key]['afterBodyMD5'])
   new={k:v for k,v in candidate['allRawFunctions'].items()if k not in current['allRawFunctions']};expected={v['name']:v['bodyMD5']for v in recipe['newFunctionsExpectedAfterApply']}
   assert len(candidate['allRawFunctions'])==3420 and len(new)==50 and {k.split('.')[0]+'.'+v['rawPgProc']['proname']:__import__('hashlib').md5(v['rawPgProc']['prosrc'].encode()).hexdigest()for k,v in new.items()}==expected
   ns=json.loads(sql(db,"select json_agg(nspname order by nspname)from pg_namespace where nspname in('public','graphql_public')or nspname like'gridex\\_%'escape'\\';"));assert 'gridex_local_test'in ns;save(R/'candidate-full-qualified-namespace-inventory.safe.json',ns)
   # New private fixture tables must remain empty. This is schema capture, no commercial fixture/claim.
   private_rows=json.loads(sql(db,"select jsonb_object_agg(name,n)from("+' union all '.join("select '"+n+"' name,count(*)n from gridex_local_test."+n for n in C['expectedPrivateTables'])+")x;"));assert len(private_rows)==11 and all(n==0 for n in private_rows.values());save(R/'candidate-private-empty-rows.safe.json',private_rows)
   role=load(C['roleHelperPath'],'exact_producer_role');receipt,refs=role.acquire(C,G,save,R/'producer-role-journal.private.json');J['producerReceipt']=receipt;J['producerRefs']=refs;save(R/'intent.safe.json',J)
   clone_proof=R/'qualified-clone.safe.json';save(clone_proof,{'state':'QUALIFIED_PRIVATE_GEN926_CANDIDATE3420_NOT_CURRENT_ROWS','cloneDatabase':db,'containerId':C['containerId'],'sourceRegistrationHead':C['sourceRegistrationHead'],'candidateSnapshotSHA256':sha(R/'candidate3420-before-capture.private.json'),'privateEmptyRowsSHA256':sha(R/'candidate-private-empty-rows.safe.json'),'sourceInputInventorySHA256':C['sourceInputInventorySHA256'],'producerReceipt':receipt,'historicalDataNotCurrentRows':True})
   cap=R/'capture-wrapper';cap.mkdir(mode=0o700);binpath=cap/'bin';binpath.mkdir();client=cap/'pg-client.py';client.write_bytes(pathlib.Path(C['clientAdapterPath']).read_bytes());client.chmod(0o700)
   for n in ['psql','pg_dump']:(binpath/n).symlink_to(client)
   proxy=json.loads(pathlib.Path(C['clientTargetTemplatePath']).read_text());proxy.update(state='BOUND_READY',containerId=C['containerId'],cloneDatabase=db,privateCloneURLFile=C['privateCloneURLFile'],cloneHost=C['cloneHost'],clonePort=C['clonePort'],cloneUser='postgres');save(cap/'pg-client-target.safe.json',proxy)
   capture=cap/'private-capture.py';capture.write_bytes(pathlib.Path(C['captureHelperPath']).read_bytes());SC=json.loads(pathlib.Path(C['captureTargetTemplatePath']).read_text());private_url=pathlib.Path(C['privateCloneURLFile']).read_text().strip();u=urllib.parse.urlsplit(private_url);assert urllib.parse.unquote(u.path[1:])==db and u.hostname==C['cloneHost']and u.port==C['clonePort']and u.username=='postgres'
   cliwork=cap/'cli-workdir';(cliwork/'supabase').mkdir(parents=True);rawconfig=pathlib.Path(C['sourceCLIConfigPath']).read_text();project='gridex-gen-'+C['fixtureNonce'].replace('_','-');derived,count=re.subn(r'^project_id\s*=\s*"[^"]+"','project_id = "'+project+'"',rawconfig,count=1,flags=re.M);assert count==1;(cliwork/'supabase/config.toml').write_text(derived)
   SC.update(state='ROOT_ARMED_QUALIFIED_CLONE_PRIVATE_CAPTURE',producerReceipt=receipt,producerRefs=refs,qualifiedCloneReceiptPath=str(clone_proof),qualifiedCloneReceiptSHA256=sha(clone_proof),cloneDatabase=db,cloneHost=C['cloneHost'],clonePort=C['clonePort'],cloneUser='postgres',privateCloneURLFile=C['privateCloneURLFile'],qualifiedNamespaceInventory=ns,cliNetworkId=C['cliNetworkId'],pgMetaImageTag=C['pgMetaImageTag'],pgMetaImageId=C['pgMetaImageId'],pgMetaCanReachCloneViaQualifiedCLIHostConfig=True,cliWorkdir=str(cliwork),newPrivateOutputDirectory=str(R/'generated'),psqlPath=str(binpath/'psql'),pgDumpPath=str(binpath/'pg_dump'),runtimeResourceScopeReceiptPath=C['runtimeResourceScopeReceiptPath'],runtimeResourceScopeReceiptSHA256=C['runtimeResourceScopeReceiptSHA256'])
   SC['toolFiles']=[f for f in SC['toolFiles']if not f['path'].startswith(C['capturePrepDirectory'])];SC['toolFiles'] +=[{'path':str(p),'sha256':sha(p)}for p in[client,binpath/'psql',binpath/'pg_dump',cap/'pg-client-target.safe.json']]
   SC['boundFiles']=[f for f in SC['boundFiles']if not f['path'].endswith('/cli-workdir/supabase/config.toml')];SC['boundFiles'].append({'path':str(cliwork/'supabase/config.toml'),'sha256':sha(cliwork/'supabase/config.toml')});SC['privateConfigProvenance'].update(byteIdentical=False,privateToolProjectOverride=project,onlyChangedField='project_id toolcontext; originalAPI/dbconfig unchanged, notcanonicalreplay')
   st=cap/'execution-target.safe.json';save(st,SC);cg=cap/'root-execution-go.safe.json';save(cg,{'rootArmed':True,'wrapperSHA256':sha(capture),'targetSHA256':sha(st),'independentScopeReviews':G['scopeReviews'],'outerRootGOPath':str(go),'outerRootGOSHA256':sha(go)})
   J['captureInvocations']=1;save(R/'intent.safe.json',J)
   with(R/'capture.stdout.private.log').open('xb')as out,(R/'capture.stderr.private.log').open('xb')as err:
    helper=subprocess.Popen([C['pythonPath'],str(capture),'--target',str(st),'--root-go',str(cg),'--execute'],stdin=subprocess.DEVNULL,stdout=out,stderr=err,env=E,start_new_session=True,pass_fds=(lock.fileno(),));J['capturePID']=helper.pid;save(R/'intent.safe.json',J)
    try:J['captureExit']=helper.wait(timeout=C['captureTimeoutSeconds'])
    except BaseException:
     os.killpg(helper.pid,signal.SIGTERM)
     try:helper.wait(timeout=5)
     except subprocess.TimeoutExpired:os.killpg(helper.pid,signal.SIGKILL);helper.wait(timeout=5)
     raise
   assert J['captureExit']==0;after=snapshot(db);save(R/'candidate3420-after-capture.private.json',after);assert after==candidate,'CAPTURE_CHANGED_CANDIDATE'
   assert json.loads(sql(db,"select jsonb_object_agg(name,n)from("+' union all '.join("select '"+n+"' name,count(*)n from gridex_local_test."+n for n in C['expectedPrivateTables'])+")x;"))==private_rows
   J['state']='PRIVATE_GENERATION_MET_PENDING_CLEANUP_MAIN_POST';save(R/'intent.safe.json',J)
  except BaseException as e:primary=e;J.update(state='STOP_NO_RETRY_UNKNOWN_OR_FAILURE',errorClass=type(e).__name__)
  finally:
   # CLI process timeout does not prove sidecar absence. Identify only newly
   # created exactimage+exactprivatecloneURL+generate_types containers, never bulk rm.
   try:
    owned=[];unmatched=[]
    for cid in ids()-baseline_ids:
     obj=json.loads(docker(['inspect',cid]))[0];envs=dict(v.split('=',1)for v in obj['Config'].get('Env',[])if '='in v)
     candidate_url=urllib.parse.urlsplit(envs.get('PG_META_DB_URL',''))
     if obj['Image']==C['pgMetaImageId']and private_url and urllib.parse.unquote(candidate_url.path.lstrip('/'))==db and envs.get('PG_META_GENERATE_TYPES')=='typescript':
      save(R/('own-pgmeta-'+cid+'.private.json'),obj);owned.append(cid)
     else:
      unmatched.append({'id':cid,'imageId':obj['Image']})
      if obj['Image']==C['pgMetaImageId']and envs.get('PG_META_GENERATE_TYPES')=='typescript':J['unknownPotentialOwnPgmeta']=True
    J['ownedPgmetaContainersRemoved']=[]
    for cid in owned:docker(['rm','-f',cid]);J['ownedPgmetaContainersRemoved'].append(cid)
    J['newUnmatchedContainersPreserved']=unmatched;J['ownPgmetaAbsent']=not(set(owned)&ids());assert J['ownPgmetaAbsent']and not J.get('unknownPotentialOwnPgmeta')
   except BaseException as e:J['pgmetaCleanupErrorClass']=type(e).__name__
   try:
    exists=bool(sql('template1',"select 1 from pg_database where datname='"+db+"';"));assert not exists or J['createAttempted'];space['created']=exists
    exec(compile(ast.Module(body=blocks['ownedDropAndAbsence'],type_ignores=[]),'exact_fd92_owned_drop_absence','exec'),space)
   except BaseException as e:J['cleanupErrorClass']=type(e).__name__
   try:final=snapshot('postgres');save(R/'main-after.private.json',final);J['mainFullSnapshotUnchanged']=final==before
   except BaseException as e:J['mainAfterCaptureErrorClass']=type(e).__name__
   save(R/'intent.safe.json',J)
  assert J.get('ownPgmetaAbsent')and J.get('cloneAbsent')and J.get('mainFullSnapshotUnchanged')and not J.get('cleanupErrorClass')and not J.get('pgmetaCleanupErrorClass')
  if primary is not None:raise primary
  assert J['captureInvocations']==1 and J['captureExit']==0;J['state']='TERMINAL_PRIVATE_GEN926_CANDIDATE3420_NOT_CANONICAL_REPLAY_OR_TRACKED_GEN';save(R/'summary.safe.json',J)
  print(json.dumps({'state':J['state'],'runDir':str(R),'producerReceiptHeld':J['producerReceipt']}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--target',required=True);p.add_argument('--root-go');p.add_argument('--execute',action='store_true');a=p.parse_args();C=json.loads(pathlib.Path(a.target).read_text())
 if not a.execute:print(json.dumps({'state':'FILESYSTEM_AST_ONLY_NO_RUNTIME','donorASTManifest':static(C)[1]}))
 else:assert a.root_go;execute(a.target,a.root_go)
