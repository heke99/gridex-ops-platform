import ast,fcntl,hashlib,json,os,pathlib,re,shutil,subprocess,sys,time
os.umask(0o077);P=pathlib.Path(__file__).resolve().parent;sha=lambda b:hashlib.sha256(b).hexdigest()
def main():
 assert len(sys.argv)==1
 T=P/'execution-target.safe.json';C=json.loads(T.read_text());G=json.loads((P/'root-execution-go.safe.json').read_text())
 assert G['disposableOnly']is True and G['foundationSixCasesOnly']is True and len(G['independentScopeReviewSHA256'])==2 and G['wrapperSHA256']==sha(pathlib.Path(__file__).read_bytes())and G['targetSHA256']==sha(T.read_bytes())
 for f in C['boundFiles']:assert sha(pathlib.Path(f['path']).read_bytes())==f['sha256']
 predecessor=json.loads(pathlib.Path(C['predecessorResultPath']).read_text());terminal=json.loads(pathlib.Path(C['predecessorIntentPath']).read_text())
 assert predecessor['state']=='V2_FIRST_NORMAL_NATIVE_RECORD_ALIAS_SOURCE_STOP_NO_RETRY'and predecessor['actualPrimaryError']=={'sqlstate':'55000','message':'record "p" is not assigned yet'}
 assert terminal['state']=='FAILED_OR_UNKNOWN_STOP_NO_RETRY'and terminal['mainFullSnapshotUnchanged']and len(terminal['cases'])==1 and terminal['cases'][0]['case']=='normal'and terminal['cases'][0]['ownCloneDropped']and terminal['cases'][0]['cloneAbsent']
 primary=re.findall(rb'(?m)^(?:psql:[^\n]*?:\s*)?ERROR:\s+([A-Z0-9]{5}):\s*([^\r\n]+)$',pathlib.Path(C['predecessorPrimaryStderrPath']).read_bytes());assert primary==[(b'55000',b'record "p" is not assigned yet')]
 Q = json.loads(pathlib.Path(C['qualifiedTargetPath']).read_text())
 E = {k: v for k, v in os.environ.items() if k not in ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'PGDATABASE', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS']}
 D = ['/usr/local/bin/docker', '--host=unix:///var/run/docker.sock']
 space = globals().copy()
 space.update(C=Q, E=E, D=D)
 for node in ast.parse(pathlib.Path(C['qualifiedReadDriverPath']).read_text()).body:
     if isinstance(node, ast.Assign) and any((isinstance(z, ast.Name) and z.id == 'TABLES' for z in node.targets)):
         exec(compile(ast.Module(body=[node], type_ignores=[]), 'qualified-read-helper', 'exec'), space)
     if isinstance(node, ast.FunctionDef) and node.name in ['run', 'sql', 'inspect', 'main_state', 'semantic_relations', 'postgis_acl']:
         exec(compile(ast.Module(body=[node], type_ignores=[]), 'qualified-read-helper', 'exec'), space)
 sql = space['sql']
 inspect = space['inspect']
 state = space['main_state']
 semantic = space['semantic_relations']
 postgis = space['postgis_acl']
 
 def rows(db):
     local = dict(space)
     local['sql'] = lambda unused, q: sql(db, q)
     exec(compile(pathlib.Path(C['fullRowsReaderPath']).read_text(), 'bound-rows-reader', 'exec'), local)
     return local['rows_snapshot']()
 
 def save(path, x):
     tmp = path.with_name(path.name + '.tmp')
     data = (json.dumps(x, indent=2) + '\n').encode()
     with tmp.open('xb') as o:
         o.write(data)
         o.flush()
         os.fsync(o.fileno())
     os.replace(tmp, path)
     fd = os.open(path.parent, os.O_DIRECTORY)
     try:
         os.fsync(fd)
     finally:
         os.close(fd)
     return sha(data)
 
 def settings(db):
     return json.loads(sql('template1', "select coalesce(jsonb_agg(jsonb_build_object('roleOid',setrole::integer,'key',split_part(x,'=',1),'valueHash',md5(x))),'[]')from pg_db_role_setting cross join lateral unnest(setconfig)x where setdatabase=(select oid from pg_database where datname='" + db + "');"))
 
 def function_metadata(db):
     return json.loads(sql(db, "select coalesce(jsonb_agg(jsonb_build_object('signature',n.nspname||'.'||p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'bodyMD5',md5(p.prosrc),'definitionMD5',md5(pg_get_functiondef(p.oid)),'config',p.proconfig,'aclRaw',p.proacl::text,'effectiveAcl',(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(e.grantor),'grantee',case when e.grantee=0 then 'PUBLIC' else pg_get_userbyid(e.grantee)end,'privilege',e.privilege_type,'grantable',e.is_grantable)order by e.grantor,e.grantee,e.privilege_type,e.is_grantable)from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))e))order by n.nspname,p.oid::regprocedure::text),'[]')from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind in('f','p')and n.nspname not in('pg_catalog','information_schema')and n.nspname not like'pg_toast%'and n.nspname not like'pg_temp%';"))
 
 def function_semantic(items):
     return [{k: v for k, v in x.items() if k != 'aclRaw'} for x in items]
 
 def snapshot(db):
     funcs = function_metadata(db)
     return {'raw': state(db), 'rows': rows(db), 'semantic': semantic(db), 'postgis': postgis(db), 'otherFunctions': function_semantic(funcs), 'settings': settings(db), 'allRawFunctions':all_function_raw(db), 'functionRawAcl': [{k: x[k] for k in ['signature', 'aclRaw']} for x in funcs]}
 
 def psql_file(db, path, case_dir, stem, variables=None):
     out = case_dir / (stem + '.stdout.private.log')
     err = case_dir / (stem + '.stderr.private.log')
     assert not out.exists() and (not err.exists())
     args = D + ['exec', '-i', Q['containerId'], 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
     for k, v in (variables or {}).items():
         args += ['-v', k + '=' + v]
     r = subprocess.run(args, input=pathlib.Path(path).read_bytes(), capture_output=True, env=E, timeout=150)
     out.write_bytes(r.stdout)
     err.write_bytes(r.stderr)
     return (r, {'exit': r.returncode, 'stdoutPath': str(out), 'stdoutSHA256': sha(r.stdout), 'stderrPath': str(err), 'stderrSHA256': sha(r.stderr)})
 
 def all_function_raw(db='postgres'):
     return json.loads(sql(db, "select coalesce(jsonb_object_agg(n.nspname||'.'||p.oid::regprocedure::text,jsonb_build_object('rawPgProc',to_jsonb(p),'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'expandedAcl',(select jsonb_agg(to_jsonb(a)order by a.grantor,a.grantee,a.privilege_type,a.is_grantable)from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a))),'{}')from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind in('f','p')and n.nspname not in('pg_catalog','information_schema')and n.nspname not like'pg_toast%'and n.nspname not like'pg_temp%';"))
 def old_rel_semantic(db):
  # Exact qualified full-relation query; omit only the newly created private schema.
  node=next(n for n in ast.parse(pathlib.Path(C['qualifiedReadDriverPath']).read_text()).body if isinstance(n,ast.FunctionDef)and n.name=='semantic_relations')
  query=next(n.value.value for n in node.body if isinstance(n,ast.Assign)and isinstance(n.value,ast.Constant))
  query=query.replace("where n.nspname not in('pg_catalog','information_schema')","where n.nspname<>'gridex_local_test'and n.nspname not in('pg_catalog','information_schema')")
  return sql(db,query)
 def unchanged_except_body(before,after,key,old_md5,new_md5):
  assert set(before)==set(after)
  for k,v in before.items():
   x=after[k]
   if k!=key:assert x==v,'OTHER_FUNCTION_RAW_CHANGED'
   else:
    assert {n:y for n,y in x['rawPgProc'].items()if n!='prosrc'}=={n:y for n,y in v['rawPgProc'].items()if n!='prosrc'}and x['owner']==v['owner']and x['expandedAcl']==v['expandedAcl']
    assert hashlib.md5(v['rawPgProc']['prosrc'].encode()).hexdigest()==old_md5 and hashlib.md5(x['rawPgProc']['prosrc'].encode()).hexdigest()==new_md5
    assert x['definition'].replace(x['rawPgProc']['prosrc'],v['rawPgProc']['prosrc'],1)==v['definition']
 def local_catalog(db):
  return json.loads(sql(db,"select jsonb_build_object('schemas',(select jsonb_agg(to_jsonb(n))from pg_namespace n where n.nspname='gridex_local_test'),'relations',(select coalesce(jsonb_agg(to_jsonb(c)order by c.oid),'[]')from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='gridex_local_test'),'columns',(select coalesce(jsonb_agg(to_jsonb(a)order by a.attrelid,a.attnum),'[]')from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='gridex_local_test'and a.attnum>0 and not a.attisdropped),'constraints',(select coalesce(jsonb_agg(to_jsonb(x)order by x.oid),'[]')from pg_constraint x join pg_namespace n on n.oid=x.connamespace where n.nspname='gridex_local_test'),'indexes',(select coalesce(jsonb_agg(to_jsonb(i)order by i.indexrelid),'[]')from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='gridex_local_test'),'triggers',(select coalesce(jsonb_agg(to_jsonb(t)order by t.oid),'[]')from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='gridex_local_test'),'policies',(select coalesce(jsonb_agg(to_jsonb(x)order by x.oid),'[]')from pg_policy x join pg_class c on c.oid=x.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='gridex_local_test'));"))
 def canonical_hash(v):return sha(json.dumps(v,sort_keys=True,separators=(',',':')).encode())
 def contract_schema_root(db):
  return sql(db,"SELECT md5(jsonb_build_object('schemas',(SELECT jsonb_agg(jsonb_build_array(nspname,nspowner,nspacl)ORDER BY nspname)FROM pg_namespace WHERE nspname NOT LIKE'pg_temp%'AND nspname NOT LIKE'pg_toast%'),'relations',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,c.relowner,c.relnatts,c.relrowsecurity,c.relforcerowsecurity,c.relacl)ORDER BY n.nspname,c.relname)FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN('pg_catalog','information_schema')AND n.nspname NOT LIKE'pg_temp%'AND n.nspname NOT LIKE'pg_toast%'),'columns',(SELECT jsonb_agg(to_jsonb(a)ORDER BY a.attrelid,a.attnum)FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN('pg_catalog','information_schema')AND n.nspname NOT LIKE'pg_temp%'AND n.nspname NOT LIKE'pg_toast%'AND a.attnum>0 AND NOT a.attisdropped),'constraints',(SELECT jsonb_agg(jsonb_build_array(x.oid,pg_get_constraintdef(x.oid),x.convalidated,x.condeferrable,x.condeferred)ORDER BY x.oid)FROM pg_constraint x JOIN pg_namespace n ON n.oid=x.connamespace WHERE n.nspname NOT LIKE'pg_temp%'AND n.nspname NOT LIKE'pg_toast%'),'indexes',(SELECT jsonb_agg(jsonb_build_array(i.indexrelid,pg_get_indexdef(i.indexrelid))ORDER BY i.indexrelid)FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE'pg_temp%'AND n.nspname NOT LIKE'pg_toast%'),'triggers',(SELECT jsonb_agg(jsonb_build_array(t.oid,t.tgenabled,pg_get_triggerdef(t.oid))ORDER BY t.oid)FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE'pg_temp%'AND n.nspname NOT LIKE'pg_toast%'),'policies',(SELECT jsonb_agg(to_jsonb(x)ORDER BY x.oid)FROM pg_policy x JOIN pg_class c ON c.oid=x.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE'pg_temp%'AND n.nspname NOT LIKE'pg_toast%'))::text);")
 def compact(db):
  x=snapshot(db)
  extra=json.loads(sql(db,"SELECT jsonb_build_object('roles',(SELECT coalesce(jsonb_agg(to_jsonb(t)ORDER BY id),'[]')FROM public.roles t),'permissions',(SELECT coalesce(jsonb_agg(to_jsonb(t)ORDER BY id),'[]')FROM public.permissions t),'mappings',(SELECT coalesce(jsonb_agg(to_jsonb(t)ORDER BY id),'[]')FROM public.role_permissions t),'profile',to_jsonb(public.gridex_staff_role_profile_v1('company_admin')),'profileMD5',(SELECT md5(prosrc)FROM pg_proc WHERE oid='public.gridex_staff_role_profile_v1(text)'::regprocedure),'mappingTriggers',(SELECT count(*)FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN('public.permissions'::regclass,'public.role_permissions'::regclass)));") )
  return {'rows':x['rows'],'raw':x['raw'],'functionFullRawRoot':canonical_hash(x['allRawFunctions']),'contractSchemaRoot':contract_schema_root(db),'relationSemantic':x['semantic'],'settings':x['settings'],'postgis':x['postgis'],'roleRows':extra['roles'],'permissionRows':extra['permissions'],'rolePermissionRows':extra['mappings'],'expectedProfile':extra['profile'],'profileMD5':extra['profileMD5'],'mappingTriggers':extra['mappingTriggers']}
 class Port:
  def __init__(self,db,directory,journal):self.db=db;self.directory=directory;self.journal=journal;self.counter=0
  def assert_owned_disposable(self,db):assert db==self.db and re.fullmatch(r'gridex_role_foundation_[a-z0-9_]+',db)
  def capture_compact(self,db,label):
   self.assert_owned_disposable(db);v=compact(db);save(self.directory/(label+'.safe.json'),v);return v
  def psql_exact(self,db,path,variables,exit_code,sqlstate=None,primary=None):
   self.assert_owned_disposable(db);assert str(path)in C['foundationPayloads'];self.counter+=1;r,record=psql_file(db,path,self.directory,'step-'+str(self.counter),variables);self.journal.setdefault('steps',[]).append(record);save(self.directory/'intent.safe.json',self.journal)
   assert r.returncode==exit_code,'UNEXPECTED_SQL_EXIT_NO_RETRY'
   if sqlstate:
    errors=re.findall(rb'(?m)^(?:psql:[^\n]*?:\s*)?ERROR:\s+([A-Z0-9]{5}):\s*([^\r\n]+)$',r.stderr);assert errors==[(sqlstate.encode(),primary.encode())],'EXACT_PRIMARY_ERROR_NOT_CONTEXT_REQUIRED'
  def assert_qualified_catalog_baseline(self,v):
   assert v['profileMD5']=='d87c0b5336465a3211533a8437ca2eee'and len(v['expectedProfile'])==35 and v['mappingTriggers']==0
   roles=[r for r in v['roleRows']if r['key']=='company_admin'];assert len(roles)==1 and roles[0]['scope']=='company'and roles[0]['is_active']is True;self.role_id=roles[0]['id'];assert not any(x['role_id']==self.role_id for x in v['rolePermissionRows']);perms=[x for x in v['permissionRows']if x['key']=='customers.read'];assert len(perms)==1 and perms[0]['is_active']is True;self.permission_id=perms[0]['id']
  def stable(self,a,b,allowed):
   assert all(b[k]==a[k]for k in ['functionFullRawRoot','contractSchemaRoot','relationSemantic','settings','postgis','roleRows','profileMD5','expectedProfile','mappingTriggers'])
   assert all(b['rows'][k]==v for k,v in a['rows'].items()if k not in allowed)
   assert all(b['raw'][k]==v for k,v in a['raw'].items()if k!='role_permissions')
  def assert_declared_fixture_only(self,case,a,b):
   allowed={'public.permissions'}if case=='inactive'else({'public.role_permissions'}if case!='normal'else set());self.stable(a,b,allowed)
   if case=='normal':assert a==b;return
   if case=='inactive':
    assert b['rolePermissionRows']==a['rolePermissionRows'];old={x['id']:x for x in a['permissionRows']};new={x['id']:x for x in b['permissionRows']};assert set(old)==set(new)
    for k,v in old.items():assert new[k]==({**v,'is_active':False}if k==self.permission_id else v)
    return
   assert a['permissionRows']==b['permissionRows'];old={x['id']:x for x in a['rolePermissionRows']};new={x['id']:x for x in b['rolePermissionRows']};assert all(new[k]==v for k,v in old.items());added=[v for k,v in new.items()if k not in old];assert len(added)==(2 if case=='duplicate'else 1)
   for v in added:
    assert v['role_id']==self.role_id and v['permission_id']==self.permission_id and v['role_key']is None
    assert v['effect']==('deny'if case=='deny'else'allow')and v['permission_key']==('customers.read'if case=='deny'else('customers.write'if case=='wrong_alias'else None))
  def assert_mapping_delta_only(self,case,a,b):
   self.stable(a,b,{'public.role_permissions'});assert a['permissionRows']==b['permissionRows'];old={x['id']:x for x in a['rolePermissionRows']};new={x['id']:x for x in b['rolePermissionRows']};assert all(new[k]==v for k,v in old.items());catalog={x['id']:x for x in b['permissionRows']};allowed=set(b['expectedProfile'])
   for k,v in new.items():
    if k not in old:assert v['role_id']==self.role_id and v['role_key']=='company_admin'and v['effect']=='allow'and catalog[v['permission_id']]['key']==v['permission_key']and v['permission_key']in allowed and catalog[v['permission_id']]['is_active']is True
   for perm in b['permissionRows']:
    if perm['key']in allowed and perm['is_active']is True:assert len([x for x in new.values()if x['role_id']==self.role_id and x['permission_id']==perm['id']])==1
 with pathlib.Path(C['soleLockPath']).open('w')as lock:
  fcntl.flock(lock,fcntl.LOCK_EX);journal=P/'intent.safe.json';assert not journal.exists();actual=inspect();assert all(not x['State']['Running']for x in actual if x['Id']in Q['pauseServiceIds']);assert sql('postgres',"select current_setting('server_version_num')::int/10000;")=='17'
  app=pathlib.Path('/proc')/str(C['ownAppProcessGroup']);assert b'start-app27.py'in(app/'cmdline').read_bytes()and os.getpgid(C['ownAppProcessGroup'])==C['ownAppProcessGroup']
  held=[]
  for proc in pathlib.Path('/proc').iterdir():
   if not proc.name.isdigit():continue
   try:
    fields=(proc/'stat').read_text().rsplit(')',1)[1].split()
    if int(fields[2])==C['ownAppProcessGroup']:held.append(fields[0]);assert fields[0]in['T','t','Z']
   except(FileNotFoundError,ProcessLookupError):pass
  assert held
  source=json.loads(pathlib.Path(C['source38Path']).read_text())['currentThirtyEight'];assert len(source)==38 and all(sha((pathlib.Path('/tmp/gridex-scenario-source-442256')/n).read_bytes())==h for n,h in source.items())
  helper={};exec(compile(pathlib.Path(C['caseHelperPath']).read_text(),'reviewed-offline-case-recipes','exec'),helper);assert tuple(C['cases'])==helper['CASES'];seal=json.loads(pathlib.Path(C['backupSealPath']).read_text());before=snapshot('postgres');assert len(before['rows'])==522 and len(before['allRawFunctions'])==3368 and before==json.loads(pathlib.Path(C['freshMainSnapshotPath']).read_text());assert before['settings']==seal['sourceDatabaseSettingsFingerprints']and all(x['roleOid']==0 and x['key']=='app.settings.jwt_exp'for x in before['settings'])and before['postgis']==seal['sourcePostgisExpandedAcl'];save(P/'main-before.private.json',before);J={'state':'INTENT_BEFORE_SIX_SERIAL_FOUNDATION_CLONES','wrapperSHA256':sha(pathlib.Path(__file__).read_bytes()),'targetSHA256':sha(T.read_bytes()),'historicalSeedNotCurrentBackup':True,'noAd594OrAuthFixtures':True,'cases':[]};save(journal,J)
  try:
   for case,db in zip(C['cases'],C['cloneDatabases']):
    assert re.fullmatch(r'gridex_role_foundation_[a-z0-9_]+',db)and len(db)<64 and shutil.disk_usage(P).free>=C['preCloneBudgetBytes']and not sql('template1',"select 1 from pg_database where datname='"+db+"';");directory=P/case;directory.mkdir(mode=0o700);created=False;K={'state':'INTENT_BEFORE_OWN_FOUNDATION_CLONE','case':case,'cloneDatabase':db};save(directory/'intent.safe.json',K)
    try:
     sql('template1','CREATE DATABASE '+db+' WITH TEMPLATE template0 OWNER postgres;');created=True
     with pathlib.Path(C['backupPath']).open('rb')as data:r=subprocess.run(D+['exec','-i',Q['containerId'],'pg_restore','-U','supabase_admin','-d',db,'--exit-on-error','--single-transaction'],stdin=data,capture_output=True,env=E,timeout=120)
     (directory/'restore.stdout.private.log').write_bytes(r.stdout);(directory/'restore.stderr.private.log').write_bytes(r.stderr);K['restoreExit']=r.returncode;assert r.returncode==0
     sql('template1',"DO $copy$ DECLARE x text;BEGIN FOR x IN SELECT unnest(setconfig)FROM pg_db_role_setting WHERE setdatabase=(SELECT oid FROM pg_database WHERE datname='postgres')AND setrole=0 LOOP EXECUTE format('ALTER DATABASE %I SET %I TO %L','"+db+"',split_part(x,'=',1),substring(x from position('='in x)+1));END LOOP;END $copy$;",user='supabase_admin');assert settings(db)==before['settings'];sql(db,C['cloneOnlyPostgisRepairSql'],user='supabase_admin');sm={x['signature']:x for x in function_metadata('postgres')};cm={x['signature']:x for x in function_metadata(db)};fm={x['signature']:x for x in json.loads(pathlib.Path(C['diagnosticCloneFunctionsPath']).read_text())}
     for sig in C['cloneFunctionConfigRepair']:
      assert sm[sig]['owner']=='supabase_admin'and sm[sig]['config']==['search_path=net']and cm[sig]==fm[sig]and cm[sig]['config']is None and all(cm[sig][k]==sm[sig][k]for k in ['owner','bodyMD5','effectiveAcl'])
     sql(db,C['cloneFunctionConfigRepairSql'],user='supabase_admin');clone=snapshot(db);assert all(clone['raw'][k]==v for k,v in seal['mainState'].items()if k!='relationSecurity')and clone['rows']==json.loads(pathlib.Path(C['sourceRowsPath']).read_text())and clone['semantic']==seal['relationSecuritySemantic']and clone['postgis']==seal['sourcePostgisExpandedAcl']and clone['otherFunctions']==function_semantic(json.loads(pathlib.Path(C['sourceFunctionsPath']).read_text()))
     for dep in C['dependencyForwards']:
      r,record=psql_file(db,dep['path'],directory,'seed-'+dep['name']);K[dep['name']]=record;assert r.returncode==0;current=snapshot(db);key=next(k for k in clone['allRawFunctions']if k.endswith(dep['signatureSuffix']));unchanged_except_body(clone['allRawFunctions'],current['allRawFunctions'],key,dep['oldBodyMD5'],dep['newBodyMD5']);assert all(current[k]==clone[k]for k in ['rows','semantic','postgis','settings'])and all(current['raw'][k]==v for k,v in clone['raw'].items()if k!='functions');clone=current
     assert clone['otherFunctions']==before['otherFunctions'];assert all(clone['rows'][k]==before['rows'][k]for k in ['public.roles','public.permissions','public.role_permissions']);K['result']=helper['execute_case'](Port(db,directory,K),case,db);K['state']='FOUNDATION_CASE_MET_SQL_UNIT_NOT_JWT'
    except BaseException as e:K.update(state='FAILED_OR_UNKNOWN_STOP_NO_RETRY',errorClass=type(e).__name__);save(directory/'intent.safe.json',K);raise
    finally:
     try:
      if created:sql('template1','DROP DATABASE '+db+' WITH(FORCE);');K['ownCloneDropped']=True
     except BaseException as e:K['cleanupErrorClass']=type(e).__name__
     try:K['cloneAbsent']=not bool(sql('template1',"select 1 from pg_database where datname='"+db+"';"))
     except BaseException as e:K['reconciliationErrorClass']=type(e).__name__
     save(directory/'intent.safe.json',K);J['cases'].append(K);save(journal,J)
    assert K.get('cloneAbsent')and not K.get('cleanupErrorClass')
   J['state']='ALL_SIX_FOUNDATION_CATALOG_COMPONENT_CASES_MET'
  except BaseException as e:J.update(state='FAILED_OR_UNKNOWN_STOP_NO_RETRY',errorClass=type(e).__name__);save(journal,J);raise
  finally:
   try:
    final=snapshot('postgres');save(P/'main-after.private.json',final);J['mainFullSnapshotUnchanged']=final==before
   except BaseException as e:J['mainAfterCaptureErrorClass']=type(e).__name__
   save(journal,J)
  assert J.get('mainFullSnapshotUnchanged')and all(x.get('cloneAbsent')for x in J['cases']);save(P/'summary.safe.json',J)
if __name__=='__main__':main()
