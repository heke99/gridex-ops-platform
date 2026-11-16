#!/usr/bin/env python3
"""SOLE PRODUCER: hash-whitelisted SQL, one disposable PG17 DB, no main DDL.
Not armed until separate root GO binds these exact wrapper+target bytes.
"""
import os,sys,json,pathlib,hashlib,subprocess,re,shutil,time,fcntl
os.umask(0o077)
P=pathlib.Path('/workspace/gridex-wlabel-native-evidence-20261112')
sha=lambda b:hashlib.sha256(b).hexdigest()
assert len(sys.argv)==1,'NO_ARGV_OR_DSN_ALLOWED'
raw=(P/'execution-target.safe.json').read_bytes();C=json.loads(raw)
G=json.loads((P/'root-test-go.safe.json').read_text())
assert G['targetSHA256']==sha(raw) and G['wrapperSHA256']==sha(pathlib.Path(__file__).read_bytes()) and G['disposableOnly'] is True
for x in C['sourceFiles']:
 assert sha(pathlib.Path(x['path']).read_bytes())==x['sha256'],'SOURCE_CHANGED'
payload=sys.stdin.buffer.read(1024*1024+1);assert len(payload)<=1024*1024
H=sha(payload);allowed={x['sha256']:x for x in C['payloads']};assert H in allowed,'UNREVIEWED_SQL_INPUT'
assert sha(pathlib.Path(allowed[H]['path']).read_bytes())==H
assert not re.search(rb'(?mi)^\s*\\',payload),'NO_PSQL_METACOMMANDS'
DB=C['cloneDatabase'];assert re.fullmatch(r'gridex_wlabel_[a-z0-9_]+',DB)and len(DB)<=63 and DB!='postgres'
E={k:v for k,v in os.environ.items()if k not in ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','PGDATABASE','PGHOST','PGPORT','PGUSER','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGOPTIONS']}
D=['/usr/local/bin/docker','--host=unix:///var/run/docker.sock']
def run(args,**kw):
 r=subprocess.run(D+args,env=E,capture_output=True,timeout=kw.pop('timeout',90),**kw)
 if r.returncode:
  (P/('setup-error-'+str(time.time_ns())+'.private.log')).write_bytes(r.stdout+b'\n'+r.stderr)
  raise subprocess.CalledProcessError(r.returncode,args,output=r.stdout,stderr=r.stderr)
 return r
def sql(db,query,user='postgres'):return run(['exec','-i',C['containerId'],'psql','-X','-q','-A','-t','-U',user,'-d',db,'-v','ON_ERROR_STOP=1'],input=query.encode()).stdout.decode().strip()
def disk_guard(required):assert shutil.disk_usage(P).free>=required,'DISK_RESERVE_INSUFFICIENT'
def inspect():
 rows=json.loads(run(['inspect']+[x['id']for x in C['ownContainers']]).stdout)
 for r,e in zip(rows,C['ownContainers']):assert r['Id']==e['id']and r['Image']==e['image']and r['Config']['Labels']['gridex.run']==C['label']
 assert next(x for x in rows if x['Id']==C['containerId'])['State']['Running'];return rows
TABLES=['companies','roles','role_permissions','company_memberships','user_roles','customers','customer_sites','customer_contracts','company_invitations','canonical_command_results','canonical_audit_events','company_provisioning_jobs','audit_logs','domain_events']
def main_state(db='postgres'):
 parts=["'"+t+"',(select jsonb_build_object('count',count(*),'hash',md5(coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text),'[]'::jsonb)::text))from public."+t+" t)"for t in TABLES]
 parts += ["'ledger',(select jsonb_build_object('count',count(*),'hash',md5(coalesce(jsonb_agg(to_jsonb(m)order by version),'[]'::jsonb)::text))from supabase_migrations.schema_migrations m)","'functions',(select md5(string_agg(p.oid::regprocedure::text||p.prosrc||coalesce((select string_agg(x::text,','order by x::text)from unnest(p.proacl)x),'')||pg_get_userbyid(p.proowner),E'\\n'order by p.oid::regprocedure::text))from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')","'columns',(select md5(string_agg(c.relname||':'||a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull,E'\\n'order by c.relname,a.attnum))from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'and a.attnum>0 and not a.attisdropped)","'clusterRoles',(select md5(coalesce(jsonb_agg(to_jsonb(r)order by oid),'[]'::jsonb)::text)from pg_roles r)","'clusterRoleMemberships',(select md5(coalesce(jsonb_agg(to_jsonb(r)order by to_jsonb(r)::text),'[]'::jsonb)::text)from pg_auth_members r)"]
 parts += ["'relationSecurity',(select md5(string_agg(n.nspname||'.'||c.relname||':'||c.relkind::text||':'||pg_get_userbyid(c.relowner)||':'||c.relrowsecurity||':'||c.relforcerowsecurity||':'||coalesce((select string_agg(x::text,','order by x::text)from unnest(c.relacl)x),''),E'\\n'order by n.nspname,c.relname))from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in('pg_catalog','information_schema')and n.nspname not like'pg_toast%'and n.nspname not like'pg_temp%'and c.relkind in('r','p','v','m','S'))","'roleSemantics',(select jsonb_agg(jsonb_build_object('name',rolname,'superuser',rolsuper,'bypassRls',rolbypassrls,'createRole',rolcreaterole)order by rolname)from pg_roles where rolname in('postgres','supabase_admin','authenticated','anon','service_role'))","'protectedTableSemantics',(select jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',(select jsonb_agg(x::text order by x::text)from unnest(c.relacl)x))order by n.nspname,c.relname)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname||'.'||c.relname in('public.companies','public.company_memberships','public.roles','public.role_permissions','public.user_roles','auth.users'))"]
 return json.loads(sql(db,'select jsonb_build_object('+','.join(parts)+');'))
def semantic_relations(db):
 q="select md5(coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind::text,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(e.grantor),'grantee',case when e.grantee=0 then'PUBLIC'else pg_get_userbyid(e.grantee)end,'privilege',e.privilege_type,'grantable',e.is_grantable)order by e.grantor,e.grantee,e.privilege_type,e.is_grantable)from aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S'then's'::\"char\" else'r'::\"char\"end,c.relowner)))e))order by n.nspname,c.relname),'[]'::jsonb)::text)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in('pg_catalog','information_schema')and n.nspname not like'pg_toast%'and n.nspname not like'pg_temp%'and c.relkind in('r','p','v','m','S');"
 return sql(db,q)
def postgis_acl(db):
 q="select jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind::text,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'expandedAcl',(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(e.grantor),'grantee',case when e.grantee=0 then'PUBLIC'else pg_get_userbyid(e.grantee)end,'privilege',e.privilege_type,'grantable',e.is_grantable)order by e.grantor,e.grantee,e.privilege_type,e.is_grantable)from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))e))order by c.relname)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='extensions'and c.relname in('geography_columns','geometry_columns','spatial_ref_sys');"
 return json.loads(sql(db,q))
with(P/'sole-driver.lock').open('w')as lock:
 fcntl.flock(lock,fcntl.LOCK_EX)
 intent=P/('dump-v6-intent-'+H+'.safe.json');assert not intent.exists(),'PRIOR_INTENT_RECONCILE_NO_RETRY'
 inspect();disk_guard(C['preCloneBudgetBytes'])
 assert not sql('template1',"select 1 from pg_database where datname='"+DB+"';"),'TARGET_ALREADY_EXISTS_DO_NOT_ADOPT'
 predecessor=None
 expected=C['reconciledPredecessors'].get(H)
 prior=P/(('dump-v5-intent-'if expected and expected.get('sealedDumpSHA256')else'dump-intent-')+H+'.safe.json')
 if expected:
  assert prior.exists()and str(prior)==expected['path']and sha(prior.read_bytes())==expected['sha256'],'REQUIRED_PREDECESSOR_MISSING_OR_CHANGED'
  previous=json.loads(prior.read_text());assert previous['state']=='FAILED_OR_UNCERTAIN_NO_RETRY'and previous['mainStateUnchanged']is True and previous['cloneAbsent']is True,'PREDECESSOR_NOT_PROVEN_MAIN_PRESERVED_CLONE_ABSENT'
  if expected.get('sealedDumpSHA256'):
   seal=P/'main-baseline-dump.safe.json';dump=P/'main-baseline.dump.private'
   assert previous.get('ownCloneDropped')is True and previous.get('errorClass')=='AssertionError'and previous.get('cloneDatabaseSettingsPreserved')is True and previous.get('cloneBaselineMatchesMain')is False and {k for k in previous['mainBefore']if previous['mainBefore'][k]!=previous['cloneBefore'][k]}=={'relationSecurity'}and 'sqlExitCode'not in previous and seal.exists()and dump.exists()and sha(seal.read_bytes())==expected['sealedDumpReceiptSHA256']and sha(dump.read_bytes())==expected['sealedDumpSHA256'],'SEALED_DUMP_PREDECESSOR_NOT_VERIFIED'
   priorDump=json.loads(seal.read_text());assert priorDump['sha256']==expected['sealedDumpSHA256']and priorDump['mainState']==previous['mainAfter'],'SEALED_DUMP_SOURCE_NOT_MATCHING_PREDECESSOR'
  else:
   assert not(P/'main-baseline.dump.private').exists(),'UNQUALIFIED_EXISTING_DUMP'
  predecessor={'path':str(prior),'sha256':expected['sha256'],'terminalState':previous['state'],'mainPreservedCloneAbsent':True,'reusedVerifiedDumpSHA256':expected.get('sealedDumpSHA256')}
 elif prior.exists():
  raise AssertionError('UNRECONCILED_PREDECESSOR')
 before=main_state();J={'state':'INTENT_BEFORE_ANY_CREATE','sourceHead':C['sourceHead'],'payloadSHA256':H,'database':DB,'mainBefore':before,'reconciledPredecessor':predecessor,'noMainSchemaDdlOrClusterRoleGrant':True};intent.write_text(json.dumps(J,indent=2));created=False
 try:
  # Own idle API services are paused so TEMPLATE never needs forced disconnects.
  for service in C['pauseServiceIds']:run(['stop',service],timeout=40)
  assert sql('template1',"select current_setting('server_version_num')::int/10000;")=='17'
  # Full custom dump, including original object owners/ACL; never --no-owner,
  # filters, synthetic extension stubs, source connection changes or worker actions.
  settings=json.loads(sql('template1',"select coalesce(jsonb_agg(jsonb_build_object('roleOid',setrole::integer,'key',split_part(x,'=',1),'valueHash',md5(x))),'[]'::jsonb)from pg_db_role_setting cross join lateral unnest(setconfig)x where setdatabase=(select oid from pg_database where datname='postgres');"))
  assert all(x['roleOid']==0 and x['key']=='app.settings.jwt_exp'for x in settings),'UNQUALIFIED_DATABASE_SETTING'
  assert sql('postgres',"select count(*)from pg_subscription;")=='0','UNQUALIFIED_SUBSCRIPTION'
  dump=P/'main-baseline.dump.private';seal=P/'main-baseline-dump.safe.json'
  if seal.exists():
   meta=json.loads(seal.read_text());assert dump.exists()and sha(dump.read_bytes())==meta['sha256']and meta['mainState']==before,'BASELINE_DUMP_DRIFT'
  else:
   assert not dump.exists(),'UNCERTAIN_DUMP_RECONCILE_NO_OVERWRITE'
   disk_guard(C['preDumpBudgetBytes'])
   with dump.open('xb')as output:
    r=subprocess.run(D+['exec',C['containerId'],'pg_dump','-U','supabase_admin','-d','postgres','-Fc'],env=E,stdout=output,stderr=subprocess.PIPE,timeout=120)
   (P/'pg-dump.stderr.private.log').write_bytes(r.stderr)
   assert r.returncode==0,'ACTUAL_PG_DUMP_FAILED'
   assert dump.stat().st_size<=C['dumpBudgetBytes'],'DUMP_BUDGET_EXCEEDED'
   meta={'sha256':sha(dump.read_bytes()),'bytes':dump.stat().st_size,'mainState':before,'noFilterNoOwnerSuppression':True,'sourceDatabaseSettingsFingerprints':settings,'ledgerRows':before['ledger']['count']}
   seal.write_text(json.dumps(meta,indent=2))
  disk_guard(C['preCloneBudgetBytes'])
  sql('template1','CREATE DATABASE '+DB+' WITH TEMPLATE template0 OWNER postgres;');created=True
  with dump.open('rb')as data:
   r=subprocess.run(D+['exec','-i',C['containerId'],'pg_restore','-U','supabase_admin','-d',DB,'--exit-on-error','--single-transaction'],env=E,stdin=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120)
  (P/('restore-'+H+'.stdout.private.log')).write_bytes(r.stdout);(P/('restore-'+H+'.stderr.private.log')).write_bytes(r.stderr)
  assert r.returncode==0,'ACTUAL_FULL_RESTORE_FAILED_NO_FILTER_FALLBACK'
  # Copy the sole qualified database-local GUC to the clone, never source/global.
  sql('template1',"DO $copy$ DECLARE x text;BEGIN FOR x IN SELECT unnest(setconfig)FROM pg_db_role_setting WHERE setdatabase=(SELECT oid FROM pg_database WHERE datname='postgres')AND setrole=0 LOOP EXECUTE format('ALTER DATABASE %I SET %I TO %L','"+DB+"',split_part(x,'=',1),substring(x from position('='in x)+1));END LOOP;END $copy$;",user='supabase_admin')
  cloneSettings=json.loads(sql('template1',"select coalesce(jsonb_agg(jsonb_build_object('roleOid',setrole::integer,'key',split_part(x,'=',1),'valueHash',md5(x))),'[]'::jsonb)from pg_db_role_setting cross join lateral unnest(setconfig)x where setdatabase=(select oid from pg_database where datname='"+DB+"');"));assert cloneSettings==settings,'CLONE_DATABASE_SETTINGS_DIFFER'
  J['cloneDatabaseSettingsPreserved']=True
  diagnostic=P/'relation-diagnostic.safe.json';assert sha(diagnostic.read_bytes())==C['aclDiagnosticSHA256'],'UNQUALIFIED_ACL_DIAGNOSTIC'
  sourcePostgis=postgis_acl('postgres');assert sourcePostgis==C['exactSourcePostgisExpandedAcl'],'SOURCE_POSTGIS_ACL_CHANGED'
  sourceSemantic=semantic_relations('postgres')
  # Exactly eight measured original PG17 privileges with original grantor and grant options.
  sql(DB,C['cloneOnlyPostgisRepairSql'],user='supabase_admin')
  assert postgis_acl(DB)==sourcePostgis,'POSTGIS_SOURCE_ACL_NOT_EXACTLY_RESTORED'
  cloneSemantic=semantic_relations(DB);cloneBefore=main_state(DB);J['cloneBefore']=cloneBefore
  J['relationSecurityRawSource']=before['relationSecurity'];J['relationSecurityRawClone']=cloneBefore['relationSecurity'];J['relationSecuritySemanticSource']=sourceSemantic;J['relationSecuritySemanticClone']=cloneSemantic;J['threeMeasuredPostgisAclsRepairedCloneOnly']=True
  J['cloneBaselineMatchesMain']=sourceSemantic==cloneSemantic and all(cloneBefore[k]==v for k,v in before.items()if k!='relationSecurity')
  assert J['cloneBaselineMatchesMain'],'ACTUAL_RESTORE_BASELINE_FINGERPRINT_DIFFERS'

  admission=json.loads(sql(DB,"select jsonb_build_object('database',current_database(),'major',current_setting('server_version_num')::int/10000);"));assert admission=={'database':DB,'major':17}
  disk_guard(C['minReserveBytes']+C['tempBudgetBytes'])
  command=['exec','-i',C['containerId'],'psql','-X','-q','-A','-t','-U','postgres','-d',DB,'-v','ON_ERROR_STOP=1']
  start=time.monotonic();r=subprocess.run(D+command,env=E,input=payload,capture_output=True,timeout=120)
  (P/('stdout-'+H+'.private.log')).write_bytes(r.stdout);(P/('stderr-'+H+'.private.log')).write_bytes(r.stderr)
  J.update(sqlExitCode=r.returncode,elapsedSeconds=time.monotonic()-start,stdoutSHA256=sha(r.stdout),stderrSHA256=sha(r.stderr),expectedMarkerPresent=allowed[H]['expectedMarker'].encode()in r.stdout)
  if r.returncode!=0 or not J['expectedMarkerPresent']:raise RuntimeError('ACTUAL_NATIVE_ASSERTIONS_FAILED')
  J['state']='SQL_ASSERTIONS_MET_PENDING_CLEANUP'
 except BaseException as e:
  J['state']='FAILED_OR_UNCERTAIN_NO_RETRY';J['errorClass']=type(e).__name__;raise
 finally:
  if created:
   # Only this exact freshly-created clone may be dropped. Never touch source.
   sql('template1','DROP DATABASE '+DB+' WITH(FORCE);');J['ownCloneDropped']=True
  after=main_state();J['mainAfter']=after;J['mainStateUnchanged']=before==after
  assert before==after,'MAIN_OR_GLOBAL_ROLE_STATE_CHANGED'
  J['cloneAbsent']=not bool(sql('template1',"select 1 from pg_database where datname='"+DB+"';"))
  if J['state']=='SQL_ASSERTIONS_MET_PENDING_CLEANUP':J['state']='TERMINAL_ASSERTIONS_MET_CLEANUP_MET'
  J['freeBytesAfter']=shutil.disk_usage(P).free;intent.write_text(json.dumps(J,indent=2))
 if J['state']=='TERMINAL_ASSERTIONS_MET_CLEANUP_MET':
  sys.stdout.buffer.write(r.stdout);sys.stderr.buffer.write(r.stderr)
