"""UNARMED publication EVENT clone/REST/owned-native-factory constructor. No import-time runtime actions.
Only execute_eight_parts may execute an exact two-reviewed, ROOT-armed tuple.
Owns ONE clone and ONE unpublished REST container; child owns app/GW/frontnet.
"""
import argparse, ast, fcntl, hashlib, http.client, ipaddress, json, os, pathlib, re, shutil, signal, subprocess, time, urllib.parse

P = pathlib.Path(__file__).resolve().parent
DB = 'gridex_local_partner_http_20261113_a'
def sha(path):
    h=hashlib.sha256()
    with pathlib.Path(path).open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()
def read(path): return json.loads(pathlib.Path(path).read_text())
def save(path, value):
    path = pathlib.Path(path)
    raw = (json.dumps(value, indent=2) + '\n').encode()
    with path.with_suffix(path.suffix+'.tmp').open('xb') as out:
        out.write(raw); out.flush(); os.fsync(out.fileno())
    os.replace(path.with_suffix(path.suffix+'.tmp'), path); path.chmod(0o600)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)

READ_NAMES = {'run','sql','inspect','main_state','semantic_relations','postgis_acl'}
FD_NAMES = {'rows','settings','function_metadata','function_semantic','snapshot','psql_file','all_function_raw','unchanged_except_body'}
def declarations(C):
    # Only whitelisted declarations, never donor module top-level execution or
    # old historical restore/forwards/foundation/GEN/claim mutators.
    for key in ['readDriver','fd92Driver','gen550Driver']:
        assert sha(C[key]['path']) == C[key]['sha256'], ('DONOR_DRIFT',key)
    rt = ast.parse(pathlib.Path(C['readDriver']['path']).read_bytes())
    rn = [n for n in rt.body if isinstance(n,ast.FunctionDef) and n.name in READ_NAMES or
          isinstance(n,ast.Assign) and any(isinstance(v,ast.Name) and v.id=='TABLES' for v in n.targets)]
    ft = ast.parse(pathlib.Path(C['fd92Driver']['path']).read_bytes())
    main = next(n for n in ft.body if isinstance(n,ast.FunctionDef) and n.name=='main')
    fn = [n for n in main.body if isinstance(n,ast.FunctionDef) and n.name in FD_NAMES]
    assert {n.name for n in rn if isinstance(n,ast.FunctionDef)} == READ_NAMES
    assert {n.name for n in fn} == FD_NAMES
    manifest = {key:hashlib.sha256(ast.dump(ast.Module(body=nodes,type_ignores=[]),include_attributes=False).encode()).hexdigest()
                for key,nodes in [('readDeclarations',rn),('fd92Declarations',fn)]}
    return rn,fn,manifest

def static(C):
    assert C['cloneDatabase']==DB and C['executorAgent']=='execute_eight_parts'
    assert C['candidate']['sha256']=='ad594a0d86c80b16a2aa5137a07544210d39d16bb0a511c98fc4e842130f3e8e'
    for f in C['boundFiles']+[C['candidate'],C['recipe'],C['restProvenance']]:
        assert sha(f['path'])==f['sha256'], ('BOUND_DRIFT',f['path'])
    for key in ['childScript','childTarget']:
        if C.get(key): assert sha(C[key]['path'])==C[key]['sha256'],key
    if C.get('runtimeSession'):
        s=C['runtimeSession']
        assert sha(s['modulePath'])==s['moduleSHA256'] and sha(s['launcherPath'])==s['launcherSHA256'] and sha(s['targetTemplatePath'])==s['targetTemplateSHA256']
        assert s['launcherPath']==C['childScript']['path'] and s['targetTemplatePath']==C['childTarget']['path']
    assert set(C['expectedPrivateTables'])=={'run_admissions','object_bindings','source_declarations','source_observations','materializations','attestations','revocations','execution_witnesses','command_journal','period_locks','ack_captures'}
    for key in ['apiMigration','apiNativeProof','apiAfterSnapshot','apiExpectedCatalog','apiNativeOuterTarget']:
        f=C[key];assert sha(f['path'])==f['sha256'],('API_BOUND_DRIFT',key)
    for key in ['eventNativeInputs','eventN0ActualIndex','eventN0Outer']:
        r=C[key];assert sha(r['path'])==r['sha256'],('EVENT_QUALIFIED_INPUT_DRIFT',key)
    for r in C['trustedSeed']['refs'].values():assert sha(r['path'])==r['sha256']
    return declarations(C)[2]

def readers(C,Q,E,D,R):
    rn,fn,manifest=declarations(C)
    # Every existing READ helper expects BOTH own-container metadata and new
    # constructor fields. Preserve the qualified namespace fix from GEN550.
    namespace={**Q,**C}
    space=dict(globals(),C=namespace,Q=Q,E=E,D=D,P=R)
    space['sha']=lambda raw:hashlib.sha256(raw).hexdigest()  # donor byte-domain, never path-domain
    space['space']=space
    exec(compile(ast.Module(body=rn+fn,type_ignores=[]),'qualified_READ_fd92_declarations','exec'),space)
    original=space['sql']
    def sql(db,query,user='postgres'):
        # Hard fence MAIN: no caller can accidentally execute DDL/DML there.
        return original(db,'BEGIN READ ONLY;\n'+query+'\nROLLBACK;' if db=='postgres' else query,user=user)
    space.update(sql=sql,state=space['main_state'],semantic=space['semantic_relations'],postgis=space['postgis_acl'])
    return space,manifest

def app_absent(C):
    receipt=read(C['appTerminationReceiptPath'])
    assert sha(C['appTerminationReceiptPath'])==C['appTerminationReceiptSHA256']
    assert receipt['state']=='OWN_GROUP_TERMINATED' and receipt['processGroup']==C['appProcessGroup']
    assert receipt['allOwnedChildrenAbsentOrSameIdentityZombie'] and receipt['port3108ListenerEmpty']
    for item in receipt['ownedChildren']:
        p=pathlib.Path('/proc')/str(item['pid'])
        try:
            stat=(p/'stat').read_text().rsplit(')',1)[1].split()
            assert stat[19]==item['startTicks'] and stat[0]=='Z','APP_PID_LIVE_OR_REUSED'
        except FileNotFoundError: pass
    for name in ['/proc/net/tcp','/proc/net/tcp6']:
        for line in pathlib.Path(name).read_text().splitlines()[1:]:
            f=line.split(); assert not(f[3]=='0A' and int(f[1].split(':')[1],16)==3108),'APP_LISTENER_PRESENT'

def child_wait(args,E,R,fd,seconds,cap,cleanup_grace):
    assert 1<=seconds<=1800 and 1024<=cap<=16*1024*1024
    assert cleanup_grace==90
    a=R/'child.stdout.private.log';b=R/'child.stderr.private.log'
    with a.open('xb') as out,b.open('xb') as err:
        proc=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=out,stderr=err,env=E,
                              start_new_session=True,pass_fds=(fd,))
        save(R/'child-process.safe.json',{'pid':proc.pid,'processGroup':proc.pid,'lockFD':fd,'timeoutSeconds':seconds,'cleanupGraceSeconds':cleanup_grace,'outputCapBytes':cap})
        start=time.monotonic()
        try:
            while proc.poll() is None:
                assert time.monotonic()-start<=seconds and a.stat().st_size<=cap and b.stat().st_size<=cap,'CHILD_BUDGET_STOP'
                time.sleep(.1)
        except BaseException:
            os.killpg(proc.pid,signal.SIGTERM)
            try:proc.wait(timeout=cleanup_grace)
            except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
            raise
    assert a.stat().st_size<=cap and b.stat().st_size<=cap
    return proc.returncode

def child_descriptor(C,parent_descriptor,producer_bound_files):
    keys=['cloneRestContainerId','restIP','authIP','backendNetworkId','backendNetworkName','notAfterEpochSeconds','producerPreflightReceiptSHA256','terminatedMainProcesses']
    result={k:parent_descriptor[k] for k in keys}
    result.update(mainTerminationReceiptPath=C['appTerminationReceiptPath'],mainTerminationReceiptSHA256=C['appTerminationReceiptSHA256'],producerBoundFiles=producer_bound_files)
    return result

def child_command(C,target,go,descriptor,fd,E):
    args=[C['pythonPath'],C['childScript']['path'],'--target',C['childTarget']['path'],'--descriptor',str(descriptor),'--parent-go',str(go),'--parent-target',str(target)]
    return args,dict(E,GRIDEX_PILOT57_PARENT_LOCK_FD=str(fd))

def capture_owned_event_failure(C,Q,E,D,R,J):
    query=pathlib.Path('/workspace/gridex-event-next-W-prep-20261115/read-publication-failure.W.sql')
    receipt={'state':'READ_ONLY_OWN_EVENT_CAPTURE_ATTEMPTED','queryPath':str(query),'querySHA256':'d4a742dbc66ffd8d46d430fd5b52f84d992927a982d5e50c016653c600a2272d'}
    try:
        assert sha(query)=='d4a742dbc66ffd8d46d430fd5b52f84d992927a982d5e50c016653c600a2272d'
        event=C['eventRuntime'];assert event['factoryId']=='6b76923f-08c0-4bc3-a01c-449d9153abb9' and event['companyId']=='b36f6a30-18cd-4a70-8652-5b2da9b4eb64' and event['eventId']=='0a7762bb-c871-4e81-a9a5-c2138b546f92'
        result=subprocess.run(D+['exec','-i',Q['containerId'],'psql','-X','-A','-t','-q','-v','ON_ERROR_STOP=1','-v','expected_database='+DB,'-U','postgres','-d',DB],input=query.read_bytes(),capture_output=True,env=E,timeout=15)
        for suffix,data in [('stdout',result.stdout),('stderr',result.stderr)]:
            path=R/('owned-event-failure.'+suffix+'.private.log');path.write_bytes(data);path.chmod(0o600);receipt[suffix]={'path':str(path),'sha256':sha(path)}
        receipt['exit']=result.returncode;assert result.returncode==0
        assert len(result.stdout)<=16*1024*1024
        value=json.loads(result.stdout);assert value['database']==DB and value['scope']=={'factory_id':event['factoryId'],'company_id':event['companyId'],'domain_event_id':event['eventId']}
        path=R/'owned-event-failure.native.private.json';save(path,value);receipt.update(state='READ_ONLY_OWN_EVENT_CAPTURED',native={'path':str(path),'sha256':sha(path)})
    except BaseException as error:
        receipt.update(state='READ_ONLY_OWN_EVENT_CAPTURE_FAILED_FULL_FC_STILL_ATTEMPTED',errorClass=type(error).__name__)
    path=R/'owned-event-failure.receipt.safe.json';save(path,receipt);J['ownedEventFailureCapture']={'path':str(path),'sha256':sha(path),'state':receipt['state']}

def capture_failure(C,Q,E,D,R,sql,seal,J):
    # Unknown response outcome is never replayed. Keep actual private IDs,
    # journal/witness/source rows and locks before dropping the owned clone.
    allowed=C['expectedPrivateTables']+C['apiExtraPrivateTables']
    present=json.loads(sql(DB,"select coalesce(jsonb_agg(c.relname order by c.relname),'[]')from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='gridex_local_test'and c.relkind='r'and c.relname=ANY(ARRAY["+','.join("'"+n+"'" for n in allowed)+"]);"))
    assert set(present)<=set(allowed)
    parts=["select '"+n+"' name,coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text),'[]') rows from gridex_local_test."+n+' t' for n in present]
    value=sql(DB,'BEGIN READ ONLY;select jsonb_object_agg(name,rows)from('+' union all '.join(parts)+')x;ROLLBACK;') if parts else '{}' 
    assert len(value.encode())<=32*1024*1024,'FAILURE_PRIVATE_ROWS_BUDGET'
    fp=R/'failure-private-eleven-fullrows.private.json';fp.write_text(value+'\n');fp.chmod(0o600)
    locks=sql(DB,"BEGIN READ ONLY;select jsonb_build_object('locks',(select coalesce(jsonb_agg(to_jsonb(l)),'[]')from pg_locks l where database=(select oid from pg_database where datname=current_database())),'sessions',(select coalesce(jsonb_agg(jsonb_build_object('pid',pid,'usename',usename,'state',state,'wait_event_type',wait_event_type,'wait_event',wait_event,'backend_xid',backend_xid,'backend_xmin',backend_xmin)),'[]')from pg_stat_activity where datname=current_database()));ROLLBACK;")
    lp=R/'failure-clone-locks.private.json';lp.write_text(locks+'\n');lp.chmod(0o600)
    J['failurePrivateRows']={'path':str(fp),'sha256':sha(fp)};J['failureLocks']={'path':str(lp),'sha256':sha(lp)}
    # Full Fc retains the public fixture graph even if a timed-out response
    # omitted its generated UUIDs. Bounded optional evidence, never a replay.
    cap=seal['dumpBytes']+64*1024*1024
    if shutil.disk_usage(C['diskBudgetPath']).free<cap+C['failureDumpReserveBytes']:
        J['failureDumpState']='NOT_CAPTURED_DISK_BUDGET';return
    dp=R/'failure-clone-current.dump.private';ep=R/'failure-pg-dump.stderr.private.log'
    with dp.open('xb') as out,ep.open('xb') as err:
        proc=subprocess.Popen(D+['exec',Q['containerId'],'pg_dump','-U','supabase_admin','-d',DB,'-Fc'],stdout=out,stderr=err,stdin=subprocess.DEVNULL,env=E,start_new_session=True)
        started=time.monotonic()
        try:
            while proc.poll() is None:
                assert time.monotonic()-started<=120 and dp.stat().st_size<=cap and ep.stat().st_size<=2*1024*1024,'FAILURE_DUMP_BUDGET'
                time.sleep(.1)
        except BaseException:
            os.killpg(proc.pid,signal.SIGTERM)
            try:proc.wait(timeout=5)
            except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
            J['failureDumpState']='PARTIAL_BUDGET_STOP_PRESERVED';return
    with dp.open('rb') as check:header=check.read(5)
    assert proc.returncode==0 and header==b'PGDMP'
    J['failureDumpState']='FULL_CURRENT_CLONE_FC_CAPTURED_BEFORE_DROP';J['failureDump']={'path':str(dp),'sha256':sha(dp),'bytes':dp.stat().st_size}


def receiver_private_read(C,sql):
    names=C['expectedPrivateTables']+C['apiExtraPrivateTables']
    parts=["select '"+n+"' name,coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text),'[]') rows from gridex_local_test."+n+' t' for n in names]
    return json.loads(sql(DB,"BEGIN READ ONLY;select jsonb_build_object('database',current_database(),'private',(select jsonb_object_agg(name,rows)from("+' union all '.join(parts)+")x),'receiverRegistrations',(select coalesce(jsonb_agg(to_jsonb(r)order by to_jsonb(r)::text),'[]')from gridex_controlled_test_receiver.registrations r));ROLLBACK;"))

def event_native_helpers(C,space,sql,R):
    f=C['eventN0Outer'];assert sha(f['path'])==f['sha256'];tree=ast.parse(pathlib.Path(f['path']).read_bytes())
    body=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='execute').body;names={'event_catalog','publication_catalog','verify_new','step'}
    nodes=[n for n in body if isinstance(n,ast.FunctionDef)and n.name in names];assert {n.name for n in nodes}==names
    ns=dict(globals(),C=C,space=space,sql=sql,R=R,db=DB,H=sha)
    exec(compile(ast.Module(body=nodes,type_ignores=[]),'qualified_publication_N0_native_helpers','exec'),ns);return ns

def prepare_event_clone(C,space,sql,R,clone):
    seed=C['trustedSeed'];expected=read(seed['refs']['fullSnapshot']['path']);private=receiver_private_read(C,sql);retained=read(seed['refs']['private14AndReceiverRows']['path'])
    assert len(clone['allRawFunctions'])==3443 and len(clone['rows'])==522
    assert all(clone[k]==expected[k]for k in ['rows','semantic','settings','postgis','otherFunctions'])
    assert private==retained and len(private['private'])==14 and all(v==[]for v in private['private'].values()),'PRIVATE14_NOT_EMPTY'
    # Retained C6 rows are data only: no C6/admission lifetime or LOCAL ISSUE gate.
    N=event_native_helpers(C,space,sql,R);normalized=json.loads(sql(DB,C['subscriptionNormalizationSQL']));save(R/'old-subscription-projection.safe.json',normalized)
    inputs=read(C['eventNativeInputs']['path'])
    for name,key in [('predecessor','predecessor'),('publication','newForward')]:
        before=space['snapshot'](DB);p,receipt=N['step'](inputs[key]['path'],'apply-'+name);save(R/('apply-'+name+'.receipt.safe.json'),receipt);assert p.returncode==0
        after=space['snapshot'](DB);save(R/(name+'-after.private.json'),after)
        N['verify_new'](before,after,C['eventExpectedBodies']if name=='predecessor'else C['publicationExpectedBodies'])
        assert all(after['rows'][k]==v for k,v in clone['rows'].items()if k!='public.webhook_subscriptions')
        assert json.loads(sql(DB,C['subscriptionNormalizationSQL']))==normalized and receiver_private_read(C,sql)==private
        assert all(after[k]==clone[k]for k in ['settings','postgis'])
        cat=N['event_catalog']();assert cat['receivers']==0 and cat['factories']==0
        if name=='predecessor':old_cat=cat
        else:assert cat==old_cat
        pub=N['publication_catalog']()if name=='publication'else None
        if pub:assert pub['bindings']==0
        p,receipt=N['step'](inputs[key]['path'],'replay-'+name);save(R/('replay-'+name+'.receipt.safe.json'),receipt);assert p.returncode==0
        assert space['snapshot'](DB)==after and N['event_catalog']()==cat and receiver_private_read(C,sql)==private
        if pub:assert N['publication_catalog']()==pub
    assert len(after['allRawFunctions'])==3457;save(R/'candidate3457-before-factory.private.json',after)
    return after,private,N

def register_owned_event_factory(C,space,sql,R,before,private,N):
    E=C['eventRuntime'];assert E['companyId']=='b36f6a30-18cd-4a70-8652-5b2da9b4eb64'and E['eventId']=='0a7762bb-c871-4e81-a9a5-c2138b546f92'
    for p,h in [('verifiedSessionPath','verifiedSessionSHA256'),('prefixPath','prefixSHA256'),('canonicalPath','canonicalSHA256'),('sourceReadPath','sourceReadSHA256'),('factoryEnvPath','factoryEnvSHA256')]:assert sha(E[p])==E[h],('EVENT_BINDING_DRIFT',p)
    session=read(E['verifiedSessionPath']);prefix=read(E['prefixPath']);data=read(E['canonicalPath'])['data'];actor=session['user_id']
    assert re.fullmatch('[0-9a-f-]{36}',actor)and actor==E['actorId']==prefix['actorId']==data['user_id']
    assert prefix['sameContextNoStorageStateInjection']is True and prefix['state']=='GENUINE_EE_CONTEXT_HELD_READY_BEFORE_FRESH_BACKUP'and session['expires_at']>time.time()+120
    assert data['authorized']is True and data['access_invariant_ok']is True and data['is_platform_admin']is True
    assert data['selected_company_id']in(None,E['companyId']),'UNEXPECTED_CANONICAL_COMPANY'
    # Global platform proof is labelled honestly; A-specific actor_ok is enforced
    # by the actual native registrar, not a fabricated selected-A prebackup JSON.
    observed=read(E['sourceReadPath']);row=next(r for r in observed['rows']if r['requestedCompanyId']==E['companyId']and r['requestedEventId']==E['eventId'])
    actual=json.loads(sql(DB,"BEGIN READ ONLY;SELECT jsonb_build_object('event',to_jsonb(e),'payloadSHA256',encode(extensions.digest(convert_to(e.payload::text,'UTF8'),'sha256'),'hex'))FROM public.domain_events e WHERE e.id='"+E['eventId']+"'::uuid AND e.company_id='"+E['companyId']+"'::uuid;ROLLBACK;"))
    assert actual['event']==row['event']and actual['payloadSHA256']==row['storedPayloadJsonbTextUtf8Sha256']==E['sourcePayloadSHA256']
    assert actual['event']['event_type']=='contracts.publication.changed'and actual['event']['source']=='database'and actual['event']['aggregate_type']=='contract_publication'
    envpath=pathlib.Path(E['factoryEnvPath']);assert envpath.stat().st_mode&0o077==0;env={}
    for line in envpath.read_text().splitlines():
        if not line or line.startswith('#'):continue
        k,v=line.split('=',1);assert k not in env;env[k]=v
    factory=env['GRIDEX_LOCAL_WEBHOOK_FACTORY_ID'];token=env['GRIDEX_LOCAL_WEBHOOK_FACTORY_TOKEN']
    assert re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',factory)and re.fullmatch('[0-9a-f]{64}',token)and factory==E['factoryId']
    appconfig=read(C['childTarget']['path']);appenv={}
    for line in pathlib.Path(appconfig['appEnvFile']).read_text().splitlines():
        if not line or line.startswith('#'):continue
        k,v=line.split('=',1);assert k not in appenv;appenv[k]=v
    assert appenv.get('GRIDEX_LOCAL_WEBHOOK_FACTORY_ID')==factory and appenv.get('GRIDEX_LOCAL_WEBHOOK_FACTORY_TOKEN')==token,'APP_FACTORY_ENV_NOT_BOUND_TO_NATIVE_REQUEST'
    secret_sha=hashlib.sha256(token.encode('utf8')).hexdigest()
    save(R/'factory-registration-intent.safe.json',{'companyId':E['companyId'],'actorId':actor,'factoryId':factory,'secretSHA256':secret_sha,'registrar':'public.gridex_register_local_webhook_runtime_v1','sessionUser':'postgres','noJwtClaimsOrSetRole':True})
    value=json.loads(sql(DB,"SELECT public.gridex_register_local_webhook_runtime_v1('"+E['companyId']+"'::uuid,'"+actor+"'::uuid,'"+factory+"'::uuid,'"+secret_sha+"'::text);",user='postgres'))
    assert set(value)=={'factoryId','expiresAt','replayed'}and value['factoryId']==factory and value['replayed']is False
    rows=json.loads(sql(DB,"SELECT coalesce(jsonb_agg(to_jsonb(f)),'[]')FROM gridex_webhook_test.runtime_factories f;"));assert len(rows)==1;f=rows[0]
    assert f['id']==factory and f['company_id']==E['companyId']and f['actor_id']==actor and f['secret_sha256']==secret_sha and f['database_name']==DB
    assert str(f['database_oid'])==sql(DB,"select oid::text from pg_database where datname=current_database();")
    expires=__import__('datetime').datetime.fromisoformat(value['expiresAt'].replace('Z','+00:00')).timestamp()
    assert time.time()<C['notAfterEpochSeconds']<=expires-60,'FACTORY_NATIVE_LEASE_DOES_NOT_COVER_BOUND_WINDOW'
    assert space['snapshot'](DB)==before and receiver_private_read(C,sql)==private
    cat=N['event_catalog']();assert cat['factories']==1 and cat['receivers']==0 and N['publication_catalog']()['bindings']==0
    proof={'state':'ACTUAL_OWNED_NATIVE_EVENT_FACTORY_REGISTERED','receipt':value,'companyId':E['companyId'],'actorId':actor,'factoryId':factory,'database':DB,'sourceEventId':E['eventId'],'sourcePayloadSHA256':E['sourcePayloadSHA256'],'realRegistryRow':f,'preBackupCanonicalSelectedCompanyId':data['selected_company_id'],'companyScopeQualifiedByActualNativeRegistrar':True,'noPositiveEventDeliveryClaim':True}
    path=R/'event-factory-native.private.json';save(path,proof);save(R/'candidate3457-before-child.private.json',space['snapshot'](DB));return path,value

def execute(target,go):
    os.umask(0o077);C=read(target);G=read(go);manifest=static(C)
    assert C['state']=='BOUND_READY' and G['rootArmed'] is True and G['executeAgent']=='execute_eight_parts'
    assert G['wrapperSHA256']==sha(__file__) and G['targetSHA256']==sha(target) and G['donorASTManifest']==manifest
    assert len(G['scopeReviews'])==2
    assert {f['reviewerAgent'] for f in G['scopeReviews']}=={'/root','/root/execute_eight_parts'}
    for f in G['scopeReviews']:
        assert sha(f['path'])==f['sha256'] and f['verdict']=='EXECUTION_SCOPE_APPROVE'
        assert f['wrapperSHA256']==G['wrapperSHA256'] and f['targetSHA256']==G['targetSHA256']
    assert C.get('childScript') and C.get('childTarget'),'CHILD_NOT_BOUND'
    Q=read(C['qualifiedTargetPath']);assert sha(C['qualifiedTargetPath'])==C['qualifiedTargetSHA256']
    assert Q['containerId']==C['containerId']
    epoch=read(C['quietEpochPath']);assert sha(C['quietEpochPath'])==C['quietEpochSHA256']
    assert epoch['state']=='QUALIFIED_CURRENT_API5_HTTP_QUIET_EPOCH' and epoch['containerId']==C['containerId']
    seal=read(C['backupSealPath']);assert sha(C['backupSealPath'])==C['backupSealSHA256']
    assert seal['state']=='CURRENT_FULL_BACKUP_SEALED_MAIN522_3370_BYTE_UNCHANGED' and seal['genuineCurrentRowsNotHistorical931d'] is True
    for key,h in [('dumpPath','dumpSHA256'),('mainBeforePath','mainBeforeSHA256'),('mainAfterPath','mainAfterSHA256')]:assert sha(seal[key])==seal[h]
    assert pathlib.Path(seal['dumpPath']).stat().st_size==seal['dumpBytes']
    assert pathlib.Path(seal['mainBeforePath']).read_bytes()==pathlib.Path(seal['mainAfterPath']).read_bytes()
    assert seal['source40ManifestPath']==C['sourceManifestPath'] and seal['source40ManifestSHA256']==C['sourceManifestSHA256']
    source=read(C['sourceManifestPath'])[C['sourceManifestKey']]
    assert len(source)==C['sourceManifestCount']==40 and sha(C['sourceManifestPath'])==C['sourceManifestSHA256']
    assert all(sha(pathlib.Path(C['sourceRoot'])/p)==h for p,h in source.items())
    R=pathlib.Path(C['actualRunDir']);assert str(R)=='/workspace/gridex-event-publication-positive-actual-20261115-w' and not R.exists()
    E={k:v for k,v in os.environ.items() if k not in ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','PGDATABASE','PGHOST','PGPORT','PGUSER','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGOPTIONS']}
    D=['/usr/local/bin/docker','--host=unix:///var/run/docker.sock']
    space,_=readers(C,Q,E,D,R);sql=space['sql'];snapshot=space['snapshot']
    def docker(args,timeout=30):return subprocess.run(D+args,env=E,capture_output=True,check=True,timeout=timeout).stdout
    with pathlib.Path(C['soleLockPath']).open('a+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        app_absent(C)
        actual=space['inspect']();by={o['Id']:o for o in actual}
        assert all(not by[i]['State']['Running'] for i in C['pausedServiceIds'])
        assert sql('template1',"select current_setting('server_version_num')::int/10000;")=='17'
        assert shutil.disk_usage(C['diskBudgetPath']).free>=C['preCloneBudgetBytes']
        assert not sql('template1',"select 1 from pg_database where datname='"+DB+"';"),'CLONE_EXISTS_NO_ADOPTION'
        assert not docker(['ps','-aq','--no-trunc','--filter','name=^/'+C['restName']+'$']).strip(),'REST_NAME_EXISTS'
        before=snapshot('postgres');expected=read(seal['mainBeforePath'])
        assert before==expected and len(before['rows'])==522 and len(before['allRawFunctions'])==3370
        R.mkdir(mode=0o700);save(R/'main-before.private.json',before)
        checkpoint=C['trustedSeed'];checkpoint_seal=read(checkpoint['refs']['seal']['path']);restore_dump={'path':checkpoint_seal['dumpPath'],'sha256':checkpoint_seal['dumpSHA256'],'bytes':checkpoint_seal['dumpBytes']};assert pathlib.Path(restore_dump['path']).stat().st_size==restore_dump['bytes'] and sha(restore_dump['path'])==restore_dump['sha256']
        J={'state':'INTENT_PUBLICATION_EVENT_3457_AND_OWNED_NATIVE_FACTORY','wrapperSHA256':sha(__file__),'targetSHA256':sha(target),'cloneDatabase':DB,'dumpSHA256':restore_dump['sha256'],'freshCurrentMainSealSHA256':C['backupSealSHA256'],'createAttempted':False,'restCreateAttempted':False,'restId':None,'authStartAttempted':False,'mainSource40Unchanged':True,'childStarted':False}
        save(R/'intent.safe.json',J);primary=None
        try:
            J['createAttempted']=True;save(R/'intent.safe.json',J)
            sql('template1','CREATE DATABASE '+DB+' WITH TEMPLATE template0 OWNER postgres;')
            with pathlib.Path(restore_dump['path']).open('rb') as data:
                p=subprocess.run(D+['exec','-i',Q['containerId'],'pg_restore','-U','supabase_admin','-d',DB,'--exit-on-error','--single-transaction'],stdin=data,capture_output=True,env=E,timeout=120)
            (R/'restore.stdout.private.log').write_bytes(p.stdout);(R/'restore.stderr.private.log').write_bytes(p.stderr);J['restoreExit']=p.returncode;save(R/'intent.safe.json',J);assert p.returncode==0,'RESTORE_FAILED_NO_RETRY'
            # Only the CURRENT sealed DB-specific settings. No historical values.
            assert all(v['roleOid']==0 for v in before['settings']),'UNQUALIFIED_ROLE_SPECIFIC_DB_SETTINGS'
            assert space['settings']('postgres')==before['settings']
            sql('template1',"DO $copy$ DECLARE x text;BEGIN FOR x IN SELECT unnest(setconfig)FROM pg_db_role_setting WHERE setdatabase=(SELECT oid FROM pg_database WHERE datname='postgres')AND setrole=0 LOOP EXECUTE format('ALTER DATABASE %I SET %I TO %L','"+DB+"',split_part(x,'=',1),substring(x from position('='in x)+1));END LOOP;END $copy$;",user='supabase_admin')
            sql(DB,C['cloneOnlyPostgisRepairSql'],user='supabase_admin')
            sm={v['signature']:v for v in space['function_metadata']('postgres')};cm={v['signature']:v for v in space['function_metadata'](DB)}
            for sig in C['cloneFunctionConfigRepair']:
                assert sm[sig]['owner']=='supabase_admin' and sm[sig]['config']==['search_path=net']
                assert cm[sig]['config'] in [None,['search_path=net']]
                assert all(cm[sig][k]==sm[sig][k] for k in ['owner','bodyMD5','effectiveAcl'])
            sql(DB,C['cloneFunctionConfigRepairSql'],user='supabase_admin')
            clone=snapshot(DB);save(R/'trusted3443-before-event.private.json',clone)
            prepared,private,event_helpers=prepare_event_clone(C,space,sql,R,clone)
            factory_path,factory_receipt=register_owned_event_factory(C,space,sql,R,prepared,private,event_helpers)
            J.update(trusted3443SeedRestored=True,publication3457AppliedReplay=True,ownedNativeFactoryRegistered=True,noC6OrAdmissionGate=True,noLocalIssueOrApiWirePatch=True);save(R/'intent.safe.json',J)
            rp=read(C['restProvenance']['path']);assert sha(rp['inspectPath'])==rp['inspectSHA256']
            old=read(rp['inspectPath']);old=old[0] if isinstance(old,list) else old
            assert old['Image']==C['restImageId'] and rp['imageId']==C['restImageId']
            env=dict(x.split('=',1) for x in old['Config']['Env']);url=urllib.parse.urlsplit(env['PGRST_DB_URI'])
            assert urllib.parse.unquote(url.path.lstrip('/'))=='postgres' and url.hostname==C['dbURIHost'] and (url.port or 5432)==5432
            env['PGRST_DB_URI']=urllib.parse.urlunsplit(url._replace(path='/'+DB))
            # Docker's qualified managed defaults inject exactly these four
            # proxy variables. Bind their CURRENT source, never clear/override
            # host config or change NO_PROXY/other inherited REST settings.
            proxy_config=C['managedDockerProxyConfig']
            assert sha(proxy_config['path'])==proxy_config['sha256'],'MANAGED_PROXY_CONFIG_DRIFT'
            defaults=read(proxy_config['path'])['proxies']['default']
            for key,source_key in [('http_proxy','httpProxy'),('HTTP_PROXY','httpProxy'),('https_proxy','httpsProxy'),('HTTPS_PROXY','httpsProxy')]:
                assert isinstance(defaults[source_key],str) and defaults[source_key] and '\n' not in defaults[source_key] and '\r' not in defaults[source_key]
                env[key]=defaults[source_key]
            envpath=R/'clone-rest.env.private';envpath.write_text(''.join(k+'='+v+'\n' for k,v in env.items()));envpath.chmod(0o600)
            assert all('\n' not in v and '\r' not in v for v in env.values())
            net=json.loads(docker(['network','inspect',C['networkId']]))[0];assert net['Id']==C['networkId'] and net['Name']==C['networkName']
            dbobj=json.loads(docker(['inspect',Q['containerId']]))[0]
            dbnet=dbobj['NetworkSettings']['Networks'][C['networkName']]
            assert dbnet['NetworkID']==C['networkId'] and dbnet['IPAddress']==C['dbInternalIP'] and C['dbURIHost'] in dbnet['Aliases']
            image=json.loads(docker(['image','inspect',C['restImageId']]))[0];assert image['Id']==C['restImageId']
            J['restCreateAttempted']=True;save(R/'intent.safe.json',J)
            cid=docker(['create','--name',C['restName'],'--label','gridex.private.owner=pilot57-current','--label','gridex.private.target='+sha(target),'--network',C['networkId'],'--env-file',str(envpath),'--memory','256m','--cpus','0.5',C['restImageId'],*old['Config']['Cmd']]).decode().strip()
            assert re.fullmatch('[0-9a-f]{64}',cid);J['restId']=cid;save(R/'intent.safe.json',J)
            docker(['start',cid]);obj=json.loads(docker(['inspect',cid]))[0];save(R/'clone-rest-inspect.private.json',obj)
            assert obj['Image']==C['restImageId'] and obj['HostConfig']['PortBindings'] in [None,{}]
            assert obj['Config']['Cmd']==old['Config']['Cmd'] and obj['Config']['Entrypoint']==old['Config']['Entrypoint']
            assert dict(v.split('=',1) for v in obj['Config']['Env'])==env and set(obj['NetworkSettings']['Networks'])=={C['networkName']}
            ip=obj['NetworkSettings']['Networks'][C['networkName']]['IPAddress'];assert ip and obj['State']['Running']
            auth=json.loads(docker(['inspect',C['currentAuthId']]))[0]
            assert auth['Id']=='148f5bf898b0caac70adfbbd871bc02a25a291d993a266569250e135ac40bda3'
            assert not auth['State']['Running'] and auth['Image']==by[C['currentAuthId']]['Image']
            # Exact existing148f lifecycle: one declared start after sealed
            # baseline, GET-only health/user access, restore paused in finally.
            J['authStartAttempted']=True;save(R/'intent.safe.json',J)
            docker(['start',C['currentAuthId']])
            auth=json.loads(docker(['inspect',C['currentAuthId']]))[0];save(R/'auth-start-inspect.private.json',auth)
            assert auth['Image']==by[C['currentAuthId']]['Image'] and auth['State']['Running']
            assert auth['Config']==by[C['currentAuthId']]['Config'] and auth['HostConfig']==by[C['currentAuthId']]['HostConfig'],'AUTH_CONFIG_DRIFT'
            an=auth['NetworkSettings']['Networks'][C['networkName']]
            assert an['NetworkID']==C['networkId'];auth_ip=an['IPAddress'];assert ipaddress.ip_address(auth_ip).version==4
            health=None
            for _ in range(50):
                conn=http.client.HTTPConnection(auth_ip,9999,timeout=2)
                try:
                    conn.request('GET','/health');response=conn.getresponse();body=response.read(65537)
                    assert len(body)<=65536,'AUTH_HEALTH_BUDGET'
                    if response.status==200:health={'status':200,'bodySHA256':hashlib.sha256(body).hexdigest()};break
                except (OSError,http.client.HTTPException):pass
                finally:conn.close()
                time.sleep(.2)
            assert health,'AUTH_HEALTH_NOT_READY_NO_START_RETRY'
            ap=R/'auth-getonly-start.safe.json';save(ap,{'state':'EXACT148F_STARTED_GET_HEALTH_ONLY','authContainerId':C['currentAuthId'],'imageId':auth['Image'],'authIP':auth_ip,'authPort':9999,'health':health,'writesPermitted':False,'originalPausedRestoredByParentFinally':True})
            descriptor={'state':'PUBLICATION_EVENT_CLONE3457_NATIVE_FACTORY_REST_READY_CHILD_PENDING','cloneDatabase':DB,'databaseContainerId':Q['containerId'],'cloneRestContainerId':cid,'restImageId':C['restImageId'],'restIP':ip,'restPort':3000,'restURL':'http://'+ip+':3000','backendNetworkId':C['networkId'],'backendNetworkName':C['networkName'],'authContainerId':C['currentAuthId'],'authIP':auth_ip,'authPort':9999,'authStartProofPath':str(ap),'authStartProofSHA256':sha(ap),'notAfterEpochSeconds':C['notAfterEpochSeconds'],'producerPreflightReceiptSHA256':C['producerPreflightReceiptSHA256'],'terminatedMainProcesses':read(C['appTerminationReceiptPath'])['ownedChildren'],'appTerminationReceiptPath':C['appTerminationReceiptPath'],'appTerminationReceiptSHA256':C['appTerminationReceiptSHA256'],'source40ManifestPath':C['sourceManifestPath'],'source40ManifestSHA256':C['sourceManifestSHA256'],'candidateSnapshotPath':str(R/'candidate3457-before-child.private.json'),'candidateSnapshotSHA256':sha(R/'candidate3457-before-child.private.json'),'constructorTargetSHA256':sha(target),'parentOwnsRestAndCloneCleanup':True,'childOwnsAppGatewayCanaryFrontnetOnly':True}
            descriptor.update(eventFactoryReceiptPath=str(factory_path),eventFactoryReceiptSHA256=sha(factory_path),eventFactoryId=factory_receipt['factoryId'],eventFactoryExpiresAt=factory_receipt['expiresAt'])
            save(R/'clone-rest-descriptor.safe.json',descriptor)
            # Narrow child contract, not the richer parent audit descriptor.
            dynamic=child_descriptor(C,descriptor,[{'path':str(p),'sha256':sha(p)} for p in [pathlib.Path(C['backupSealPath']),pathlib.Path(C['quietEpochPath']),pathlib.Path(C['appTerminationReceiptPath']),ap,factory_path,R/'candidate3457-before-child.private.json']])
            dp=R/'child-dynamic-descriptor.safe.json';save(dp,dynamic)
            args,CE=child_command(C,target,go,dp,lock.fileno(),E)
            J['childStarted']=True;save(R/'intent.safe.json',J)
            J['childExit']=child_wait(args,CE,R,lock.fileno(),C['childTimeoutSeconds'],C['childOutputCapBytes'],C['childCleanupGraceSeconds']);save(R/'intent.safe.json',J);assert J['childExit']==0
            child_config=read(C['childTarget']['path']);terminal_path=pathlib.Path(child_config['runtimeDir'])/'launcher-terminal.safe.json';terminal=read(terminal_path)
            assert terminal['state']=='TERMINAL_RUNTIME_CHILD_OWN_RESOURCES_CLOSED_PARENT_MAIN_PENDING'
            assert terminal['descriptorSHA256']==sha(dp) and terminal['inputTemplateSHA256']==C['childTarget']['sha256']
            assert terminal['moduleSHA256']==C['runtimeSession']['moduleSHA256'] and terminal['launcherSHA256']==C['childScript']['sha256'] and terminal['parentGoSHA256']==sha(go)
            assert terminal['allOwnContainersAbsent'] and terminal['allOwnNetworksAbsent']
            assert sha(terminal['runtimeReceiptPath'])==terminal['runtimeReceiptSHA256'];session=read(terminal['runtimeReceiptPath'])
            assert session['state']=='TERMINAL_RUNTIME_SESSION_OWN_RESOURCES_CLOSED_PARENT_MAIN_POST_AND_CLONE_DROP_REQUIRED'
            assert set(session['ownedContainers'])=={'app','gateway','canary'} and session['allOwnContainersAbsent'] and session['allOwnNetworksAbsent']
            assert all(v=='OWN_REMOVED' for v in session['cleanup'].values())
            assert all(k in session for k in ['appFirewall','gatewayFirewall','beforeTCP','beforeDNS','afterTCP','afterDNS','canaryAfter','appSteadyAfter','gatewaySteadyAfter'])
            completion=terminal['producerCompletion'];assert completion==session['browserCallbackResult']
            assert completion['state']=='PRODUCER_CONTROL_RENDEZVOUS_TERMINAL_NOT_BUSINESS_PROOF'
            assert sha(completion['readyPath'])==completion['readySHA256'] and sha(completion['producerProofPath'])==completion['producerProofSHA256']
            J['childTerminalReceipt']={'path':str(terminal_path),'sha256':sha(terminal_path)}
            J['producerControlCompletionOnlyNotScenarioVerdict']=completion;save(R/'intent.safe.json',J)
            J['state']='CHILD_TERMINAL_PENDING_OWN_CLEANUP_MAIN_POST'
        except BaseException as error:
            primary=error;J.update(state='STOP_NO_RETRY_KEEP_ALL_ARTIFACTS',errorClass=type(error).__name__)
        finally:
            if primary is not None and J['createAttempted']:
                try:
                    # Quiesce our transport before recording an unknown commit;
                    # no stale app/GW request may enter REST during the dump.
                    if J['restId']:
                        obj=json.loads(docker(['inspect',J['restId']]))[0]
                        assert obj['Image']==C['restImageId'] and obj['Config']['Labels']['gridex.private.target']==sha(target)
                        if obj['State']['Running']:docker(['stop','--time','10',J['restId']],timeout=30)
                        J['ownRESTStoppedBeforeFailureCapture']=True
                    if sql('template1',"select 1 from pg_database where datname='"+DB+"';"):
                        capture_owned_event_failure(C,Q,E,D,R,J)
                        capture_failure(C,Q,E,D,R,sql,dict(seal,dumpBytes=restore_dump['bytes']),J)
                except BaseException as error:J['failureCaptureErrorClass']=type(error).__name__
                save(R/'intent.safe.json',J)
            try:
                if J['authStartAttempted']:
                    auth=json.loads(docker(['inspect',C['currentAuthId']]))[0]
                    assert auth['Image']==by[C['currentAuthId']]['Image']
                    if auth['State']['Running']:docker(['stop','--time','10',C['currentAuthId']],timeout=30)
                J['authOriginalPausedRestored']=not json.loads(docker(['inspect',C['currentAuthId']]))[0]['State']['Running']
            except BaseException as error:J['authPauseErrorClass']=type(error).__name__
            try:
                if J['restCreateAttempted'] and not J['restId']:
                    found=docker(['ps','-aq','--no-trunc','--filter','name=^/'+C['restName']+'$']).decode().split()
                    assert len(found)<=1,'AMBIGUOUS_REST_PRESERVE'
                    if found:J['restId']=found[0];save(R/'intent.safe.json',J)
                if J['restId']:
                    obj=json.loads(docker(['inspect',J['restId']]))[0]
                    assert obj['Image']==C['restImageId'] and obj['Config']['Labels']['gridex.private.target']==sha(target)
                    if obj['State']['Running']:docker(['stop','--time','10',J['restId']],timeout=30)
                    docker(['rm',J['restId']]);assert not docker(['ps','-aq','--no-trunc','--filter','id='+J['restId']]).strip()
                J['ownRESTAbsent']=True
            except BaseException as error:J['restCleanupErrorClass']=type(error).__name__
            try:
                exists=bool(sql('template1',"select 1 from pg_database where datname='"+DB+"';"))
                assert not exists or J['createAttempted']
                if exists:sql('template1','DROP DATABASE '+DB+' WITH(FORCE);',user='supabase_admin')
                J['cloneAbsent']=not bool(sql('template1',"select 1 from pg_database where datname='"+DB+"';"))
            except BaseException as error:J['cloneCleanupErrorClass']=type(error).__name__
            try:
                after=snapshot('postgres');save(R/'main-after.private.json',after);J['mainFullSnapshotUnchanged']=after==before
                source=read(C['sourceManifestPath'])[C['sourceManifestKey']]
                J['source40Unchanged']=sha(C['sourceManifestPath'])==C['sourceManifestSHA256'] and all(sha(pathlib.Path(C['sourceRoot'])/p)==h for p,h in source.items())
                save(R/'post-cleanup-container-inspect.private.json',json.loads(docker(['inspect']+[v['id'] for v in Q['ownContainers']])))
            except BaseException as error:J['mainAfterErrorClass']=type(error).__name__
            save(R/'intent.safe.json',J)
        assert J.get('ownRESTAbsent') and J.get('cloneAbsent') and J.get('authOriginalPausedRestored') and J.get('mainFullSnapshotUnchanged') and J.get('source40Unchanged'),'CLEANUP_OR_MAIN_PRESERVATION_FAILED'
        if primary is not None:raise primary
        J['state']='TERMINAL_API_HTTP_CHILD_AND_CURRENT_MAIN_PRESERVED';save(R/'summary.safe.json',J)
        print(json.dumps({'state':J['state'],'summaryPath':str(R/'summary.safe.json'),'summarySHA256':sha(R/'summary.safe.json')}))

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--target',required=True);a.add_argument('--root-go');a.add_argument('--execute',action='store_true');args=a.parse_args()
    if args.execute:
        assert args.root_go;execute(args.target,args.root_go)
    else:print(json.dumps({'state':'UNARMED_FILESYSTEM_AST_ONLY','donorASTManifest':static(read(args.target))}))
