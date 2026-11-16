"""Producer-only fixed normal API topology context. No login/session preflight.
Use one context across renewal + diagnostic + same-session logout. No CLI dispatch.
All actual target/scopes are future and must be independently qualified.
"""
import contextlib,hashlib,http.client,ipaddress,json,os,pathlib,select,signal,socket,socketserver,subprocess,threading,time
P=pathlib.Path(__file__).parent
DONOR=pathlib.Path('/tmp/gridex-local-server-role-window-maintenance-20261115-w/after-api-resume-inspect.private.json')
IDS=('148f5bf898b0caac70adfbbd871bc02a25a291d993a266569250e135ac40bda3','a80807ea605c1d8eba11922091dfbed4c5b5aabbaf390ee78ed5ab4140e26de3','c2b2e3d0b3f03077912d0178a90743c22c2ff8ea17ab1c21795c9ce43ed71990')
D=['/usr/local/bin/docker','--host=unix:///var/run/docker.sock']
ENV={k:v for k,v in os.environ.items() if k not in {'DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'}}
def H(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def command(args):return subprocess.run(D+args,env=ENV,capture_output=True,check=True,timeout=15).stdout
def inspect(cid):
 x=json.loads(command(['inspect',cid]))[0];assert x['Id']==cid;return x
def mounts_by_destination(rows):
 assert isinstance(rows,list) and all(isinstance(v,dict) and isinstance(v.get('Destination'),str) and v['Destination'].startswith('/') for v in rows)
 values={v['Destination']:v for v in rows};assert len(values)==len(rows),'DUPLICATE_MOUNT_DESTINATION'
 return values
def same(x,r):
 assert x['Id']==r['Id'] and all(x[k]==r[k] for k in ('Image','Config','HostConfig'))
 assert mounts_by_destination(x['Mounts'])==mounts_by_destination(r['Mounts']),'FULL_MOUNT_OBJECT_CHANGED'
 assert set(x['NetworkSettings']['Networks'])==set(r['NetworkSettings']['Networks'])
 assert all(n['NetworkID']==r['NetworkSettings']['Networks'][k]['NetworkID'] and n.get('Aliases')==r['NetworkSettings']['Networks'][k].get('Aliases') for k,n in x['NetworkSettings']['Networks'].items())
def address(x):
 networks=x['NetworkSettings']['Networks'];assert len(networks)==1
 ip=next(iter(networks.values()))['IPAddress'];assert ipaddress.ip_address(ip).version==4;return ip
def save(root,name,v):
 f=root/name;fd=os.open(f,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as out:json.dump(v,out,indent=2);out.flush();os.fsync(out.fileno())
def configured_kong_health_key(x):
 assert x['Id']==IDS[2]
 values=[v.split('=',1)[1] for v in x['Config']['Env'] if v.startswith('SUPABASE_ANON_KEY=')]
 assert len(values)==1 and values[0],'EXACT_CONFIGURED_KONG_ANON_HEALTH_KEY_REQUIRED'
 return values[0]
def health(ip,port,path,headers=None,observe=None):
 c=http.client.HTTPConnection(ip,port,timeout=2)
 try:
  c.request('GET',path,headers=headers or {});r=c.getresponse();data=r.read(65537)
  if observe is not None:observe({'status':r.status,'bodyBytes':len(data),'bodySHA256':hashlib.sha256(data).hexdigest(),'method':'GET','path':path})
  assert len(data)<=65536 and r.status==200;return hashlib.sha256(data).hexdigest()
 finally:c.close()
def wait_health(ip,port,path,headers=None,observe=None):
 for attempt in range(20):
  try:return health(ip,port,path,headers,observe)
  except (OSError,AssertionError,http.client.HTTPException):
   if attempt==19:raise
   time.sleep(.2)
class Server(socketserver.ThreadingTCPServer):
 allow_reuse_address=True;daemon_threads=True
@contextlib.contextmanager
def ready(target_path,scope_path):
 C=json.loads(pathlib.Path(target_path).read_text());G=json.loads(pathlib.Path(scope_path).read_text())
 assert G['targetSHA256']==H(target_path) and G['moduleSHA256']==H(__file__) and G['operation']=='FIXED_NORMAL_API_TOPOLOGY_HEALTH_ONLY'
 assert C['donorSHA256']==H(DONOR) and C['containerIds']==list(IDS)
 assert G['actualApprovals'] and len(G['actualApprovals'])==2 and time.time()<G['notAfterEpoch']
 for r in G['actualApprovals']:
  assert H(r['path'])==r['sha256'];body=json.loads(pathlib.Path(r['path']).read_text());assert body['reviewerAgent']==r['reviewerAgent'] and body['targetSHA256']==H(target_path)
 reviewers={r['reviewerAgent'] for r in G['actualApprovals']};assert '/root/execute_eight_parts' in reviewers and len(reviewers)==2 and reviewers<= {'/root/execute_eight_parts','/root','/root/qa_remaining_checks','/root/ediel_test_identity'}
 for r in C['sourceRefs']:assert H(r['path'])==r['sha256']
 root=pathlib.Path(C['evidenceRoot']);assert str(root)=='/tmp/gridex-one-site-auth-topology-actual-20261116-four-case-b' and not root.exists()
 os.mkdir(root,0o700);os.chmod(root,0o700)
 refs={x['Id']:x for x in json.loads(DONOR.read_text())};before={cid:inspect(cid) for cid in IDS}
 save(root,'before.private.json',before)
 for cid,x in before.items():same(x,refs[cid]);assert not x['State'].get('Paused') and not x['State'].get('Restarting')
 # The caller must preserve current DB/source/Main/all7 and establish native Auth0
 # before this separately reviewed topology context; no SQL is executed here.
 for r in C['entryRefs']:assert H(r['path'])==r['sha256']
 started=[];server=thread=None;old_stopped=False
 listener=C['originalForwarder'];assert listener['pid']==4169096 and listener['uid']==1000 and listener['startTime']==31840654 and listener['cmdSHA256']=='674a07324e416a055bbe1256f242112b8988d4e7cf8679ccd939240a3a035d58'
 oldscript=pathlib.Path('/workspace/gridex-site-validation-runtime-evidence-20261112/forwarder.py');endpoints=oldscript.parent/'endpoints.safe.json'
 assert H(oldscript)==listener['scriptSHA256'] and H(endpoints)==listener['endpointsSHA256']
 def identity(pid):
  q=pathlib.Path('/proc')/str(pid);st=q.joinpath('stat').read_text().rsplit(')',1)[1].split()
  return {'uid':q.stat().st_uid,'startTime':int(st[19]),'cmdSHA256':H(q/'cmdline'),'state':st[0]}
 def port_busy():
  return any(x.split()[3]=='0A' and int(x.split()[1].split(':')[1],16)==55321 for f in ('/proc/net/tcp','/proc/net/tcp6') for x in pathlib.Path(f).read_text().splitlines()[1:])
 save(root,'INTENT.safe.json',{'operation':G['operation'],'containerIds':list(IDS),'originalRunning':{k:v['State']['Running'] for k,v in before.items()},'targetSHA256':H(target_path),'noLoginOrSessionPreflight':True})
 try:
  old=identity(listener['pid']);assert all(old[k]==listener[k] for k in ('uid','startTime','cmdSHA256'))
  save(root,'OLD-FORWARDER-STOP-INTENT.safe.json',{'pid':listener['pid'],'startTime':listener['startTime'],'cmdSHA256':listener['cmdSHA256'],'listenerOwnershipNotProvedByFD':True})
  os.kill(listener['pid'],signal.SIGTERM);old_stopped=True
  until=time.monotonic()+15
  while time.monotonic()<until:
   try:alive=identity(listener['pid']);assert alive['startTime']==listener['startTime'];alive=alive['state']!='Z'
   except FileNotFoundError:alive=False
   if not alive:break
   time.sleep(.1)
  assert not alive and not port_busy(),'EXACT_FORWARDER_STOP_OR_PORT_UNKNOWN_NO_ESCALATION'
  for cid in IDS:
   if not before[cid]['State']['Running']:
    started.append(cid);command(['start',cid])
   x=inspect(cid);save(root,'running-'+cid[:12]+'.private.json',x);same(x,refs[cid]);assert x['State']['Running']
  current={cid:inspect(cid) for cid in IDS}
  save(root,'all-running.private.json',current)
  for cid,x in current.items():same(x,refs[cid])
  authip=address(current[IDS[0]]);kongip=address(current[IDS[2]])
  health_sequence=[0]
  def observe_health(value):
   health_sequence[0]+=1;save(root,'health-observation-'+str(health_sequence[0])+'.safe.json',value)
  wait_health(authip,9999,'/health',observe=observe_health)
  # Fixed port ownership is acquired by exclusive bind; never kill an old listener.
  class Forward(socketserver.BaseRequestHandler):
   def handle(self):
    try:
     with socket.create_connection((kongip,8000),timeout=2) as upstream:
      peers=(self.request,upstream)
      while True:
       available,_,_=select.select(peers,[],[],60)
       if not available:return
       for source in available:
        data=source.recv(65536)
        if not data:return
        (upstream if source is self.request else self.request).sendall(data)
    except OSError:return
  server=Server(('127.0.0.1',55321),Forward);thread=threading.Thread(target=server.serve_forever,daemon=False);thread.start()
  # Pre-renewal health only: use the already verified Kong Config.Env key.
  # This is NOT current role/JWT validity or actor authentication authority.
  carrier=pathlib.Path(C['currentCarrier']['path']);assert H(carrier)==C['currentCarrier']['sha256'];prior_anon=json.loads(carrier.read_text())['anonKey'];anon=configured_kong_health_key(current[IDS[2]])
  digest=wait_health('127.0.0.1',55321,'/auth/v1/health',{'apikey':anon},observe=observe_health)
  for cid in IDS:
   x=inspect(cid);save(root,'after-health-'+cid[:12]+'.private.json',x);same(x,refs[cid])
  save(root,'READY.safe.json',{'state':'STANDARD_AUTH_API_HEALTH_ROUTE_READY_NO_USER_AUTH','containerIds':list(IDS),'route':'http://127.0.0.1:55321/auth/v1/health','bodySHA256':digest,'freshAddressesBoundToExactCIDs':True,'noPasswordGetUserSessionCalls':True,'servicesStartedByContext':started,'notNativeOrBusinessPASS':True,'credentialSource':'verified exact Kong Config.Env SUPABASE_ANON_KEY for health only','priorCarrierHashPreservedNotQualifiedAsValidRole':True,'configuredHealthKeyEqualsPriorCarrier':anon==prior_anon})
  yield {'evidenceRoot':str(root),'authURL':'http://127.0.0.1:55321/auth/v1','forwarderOwnedByCurrentProcess':True}
 finally:
  # Own local forwarder closes before restoring only the services we started.
  try:
   if server is not None:server.shutdown();server.server_close()
   if thread is not None:thread.join(3);assert not thread.is_alive()
  finally:
   errors=[]
   for cid in reversed(started):
    try:command(['stop','--time','10',cid])
    except BaseException as exc:errors.append(type(exc).__name__)
   final={}
   for cid in IDS:
    try:
     x=inspect(cid);save(root,'restored-'+cid[:12]+'.private.json',x);same(x,refs[cid]);assert x['State']['Running']==before[cid]['State']['Running'];final[cid]=x['State']['Running']
    except BaseException as exc:errors.append(type(exc).__name__)
   if old_stopped:
    try:
     assert H(oldscript)==listener['scriptSHA256'] and H(endpoints)==listener['endpointsSHA256'] and not port_busy()
     log=(root/'original-forwarder-restored.private.log').open('xb')
     restored=subprocess.Popen(['python3',str(oldscript)],stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True);log.close()
     until=time.monotonic()+3
     while not port_busy() and time.monotonic()<until:assert restored.poll() is None;time.sleep(.05)
     assert restored.poll() is None and port_busy()
     save(root,'ORIGINAL-FORWARDER-RESTORED.safe.json',{'pid':restored.pid,**identity(restored.pid),'originalSourceAndEndpointsUnchanged':True,'noClaimHistoricalRouteHealthy':True})
    except BaseException as exc:errors.append(type(exc).__name__)
   save(root,'RESTORED.safe.json',{'originalRunningRestored':not errors,'running':final,'errorClasses':errors,'noGlobalServiceClaim':True})
   assert not errors,'TOPOLOGY_RESTORE_PARTIAL'
