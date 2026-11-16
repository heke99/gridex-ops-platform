"""Fixed own REST-netns Storage sibling. Import performs no I/O or dispatch.
The caller owns the genuine user, normal REST worker, native ACKs and full oracle.
"""
import contextlib,hashlib,http.client,http.server,importlib.util,json,pathlib,secrets,threading,time
P=pathlib.Path(__file__).parent
def H(path):return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
def need(value,message):
 if not value:raise AssertionError(message)
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,P/file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

class StoragePhases:
 """Admission/observation only: no implicit request, retry or business authority."""
 def __init__(self,object_policy,company,service_key,deadline):
  need(object_policy.UUID.fullmatch(company)and isinstance(service_key,str)and bool(service_key),'ACTUAL_COMPANY_AND_SELECTED_SERVICE_KEY')
  need(time.time()<deadline<=time.time()+1800,'ORIGINAL_PARENT_DEADLINE')
  self.object_policy=object_policy;self.company=company;self.service_key=service_key;self.deadline=deadline
  self.phase='FIXTURE_BUCKET';self.gets=0;self.creates=0;self.saw404=False;self.bucket=None;self.bucket_reads=[];self.objects=None;self.request_count=0;self.observations=[];self.inflight=False;self.message_ids=set();self.current_ids=set()
 def admit(self,method,path,headers,body):
  need(time.time()<self.deadline and self.phase in {'FIXTURE_BUCKET','BUSINESS_OBJECTS'},'STORAGE_PHASE_OR_DEADLINE_STOP')
  need(not self.inflight and self.request_count<32,'FINITE_SERIAL_STORAGE_REQUESTS')
  h={k.lower():v for k,v in headers.items()}
  need(not any(k in h for k in ['cookie','proxy-authorization','transfer-encoding']),'NO_COOKIE_PROXY_CHUNKED_STORAGE')
  need(secrets.compare_digest(h.get('authorization',''),'Bearer '+self.service_key)and secrets.compare_digest(h.get('apikey',''),self.service_key),'ACTUAL_SELECTED_NORMAL_SERVICE_CLIENT_ONLY')
  need(isinstance(body,bytes)and len(body)<=2097152 and '?'not in path and '#'not in path and '%'not in path,'BOUNDED_EXACT_STORAGE_PATH')
  if self.phase=='FIXTURE_BUCKET':
   if method=='GET':
    need(path=='/storage/v1/bucket/ediel-files'and body==b''and self.gets<2,'EXACT_BUCKET_TWO_READS_ONLY');self.gets+=1
   elif method=='POST':
    need(path=='/storage/v1/bucket'and self.saw404 and self.creates==0,'BUCKET_CREATE_ONLY_AFTER_REAL_404_ONCE')
    need(json.loads(body)=={'id':'ediel-files','name':'ediel-files','public':False,'file_size_limit':2097152,'allowed_mime_types':['message/rfc822']},'EXACT_NORMAL_PRIVATE_BUCKET_CREATE_BODY');self.creates+=1
   else:raise AssertionError('NO_OTHER_FIXTURE_STORAGE_METHOD')
   downstream=path[len('/storage/v1'):]
  else:
   need(any(('/'+mid+'/')in path for mid in self.current_ids),'CURRENT_CASE_OUTBOUND_OBJECT_ONLY')
   downstream=self.objects.admit(method,path,h,body)
  self.request_count+=1;self.inflight=True
  return downstream
 def observe(self,method,path,status,body):
  need(self.inflight and isinstance(status,int)and isinstance(body,bytes)and len(body)<=2097152,'BOUNDED_REAL_STORAGE_RESPONSE')
  record={'method':method,'path':path,'httpStatus':status,'responseBytes':len(body),'responseSHA256':hashlib.sha256(body).hexdigest()}
  if self.phase=='FIXTURE_BUCKET'and method=='GET':
   value=json.loads(body)
   if status==404 or status>=400 and str(value.get('statusCode'))=='404':self.saw404=True
   elif status==200:
    need(value.get('id')=='ediel-files'and value.get('name')=='ediel-files'and value.get('public')is False,'ACTUAL_PRIVATE_BUCKET_REQUIRED')
    need(value.get('file_size_limit')is None or isinstance(value['file_size_limit'],int)and value['file_size_limit']>=2097152,'EXISTING_BUCKET_CAN_ACCEPT_BOUNDED_MIME')
    need(value.get('allowed_mime_types')is None or 'message/rfc822'in value['allowed_mime_types'],'EXISTING_BUCKET_MIME_POLICY')
    self.bucket=value;self.bucket_reads.append(value)
   else:need(status>=400,'NO_UNEXPECTED_BUCKET_RESPONSE')
  elif self.phase=='BUSINESS_OBJECTS'and method=='GET'and status==200:
   expected=path.rsplit('/',1)[1][:-4]
   need(hashlib.sha256(body).hexdigest()==expected,'REAL_OBJECT_DOWNLOAD_HASH_MATCHES_UPLOADED_RAW')
   record['actualReadbackHashMatched']=True
  self.observations.append(record);self.inflight=False
 def finish_fixture(self,helper_result):
  need(self.phase=='FIXTURE_BUCKET'and not self.inflight and self.gets==2 and self.bucket is not None,'REAL_BUCKET_FIXTURE_COMPLETED')
  need(helper_result.get('state')=='ACTUAL_OWN_STORAGE_ARCHIVE_BUCKET_OBSERVED'and helper_result.get('bucket')==self.bucket and helper_result.get('created')==(self.creates==1),'SDK_FIXTURE_RESULT_MATCHES_REAL_OBSERVATION')
  need(self.creates==1 or len(self.bucket_reads)==2 and self.bucket_reads[0]==self.bucket_reads[1],'EXISTING_BUCKET_UNCHANGED_TWO_READS')
  self.phase='BETWEEN_CASES'
 def arm_case(self,case_id,company,message_ids):
  # Only the source-paired outer may call this after its genuine native ACK.
  # This API validates scope, never asserts that a human/native ACK occurred.
  need(self.phase=='BETWEEN_CASES'and not self.inflight and company==self.company,'FIXTURE_DONE_SAME_ACTUAL_COMPANY')
  need(case_id in {'SMTP_451','SMTP_550','SMTP_DROP_DATA'}and 1<=len(message_ids)<=4,'EXACT_FINITE_SMTP_CASE')
  need(not any(x.get('case')==case_id for x in self.observations),'NO_CASE_REARM_RETRY')
  need(not (set(message_ids)&self.message_ids)and len(self.message_ids|set(message_ids))<=4,'DISTINCT_FINITE_COHORT_OUTBOUND_MESSAGES')
  need(all(isinstance(x,str)and self.object_policy.UUID.fullmatch(x)for x in message_ids),'ACTUAL_UUID_OUTBOUND_MESSAGES')
  self.current_ids=set(message_ids);self.message_ids.update(message_ids)
  if self.objects:self.objects.message_ids=frozenset(self.message_ids)
  else:self.objects=self.object_policy.ClosedStorageObjects(company,self.message_ids)
  self.observations.append({'case':case_id,'actualMessageIDs':sorted(message_ids),'authorityIsOuterNativeACKNotThisRecord':True});self.phase='BUSINESS_OBJECTS'
 def finish_case(self):
  need(self.phase=='BUSINESS_OBJECTS'and not self.inflight,'NO_PENDING_OBJECT_REQUEST')
  need(all(any(x.get('actualReadbackHashMatched')and ('/'+mid+'/')in x.get('path','')for x in self.observations)for mid in self.current_ids),'EACH_CASE_NORMAL_REAL_STORAGE_READBACK_REQUIRED')
  self.phase='BETWEEN_CASES'
 def stop(self):self.phase='STOP'
 def evidence(self):
  return {'state':self.phase,'requests':self.request_count,'inflight':self.inflight,'bucketFixtureReads':self.gets,'bucketCreateAttempts':self.creates,'observations':self.observations,'realAPIOnlyNoEchoOrAutomaticRetry':True,'noSMTPOrOriginalCasePassClaim':True}

@contextlib.contextmanager
def own_rest_storage(rt,T,save):
 """Nest inside the existing qualified owned REST/database context.
 Yields a fixed3169 Storage proxy and typed fixture/case admission state.
 Worker rewrites only owned3168/storage/v1 to3169, normal SDK unchanged.
 """
 need(T['state']=='BOUND_OWN_STORAGE_INTEGRATION'and T['bridgePort']==3169,'BOUND_FIXED_STORAGE_INTEGRATION')
 for ref in T['sourcePins']:need(H(ref['path'])==ref['sha256'],'INTEGRATION_SOURCE_DRIFT')
 need(T['sourceSHA256']==H(__file__),'EXACT_INTEGRATION_SOURCE')
 storage_source=load('gridex_owned_storage_integration_runtime','owned_storage.py');policy=load('gridex_owned_storage_integration_objects','storage_route_policy.py')
 need(T['storage']['notAfterEpoch']==T['notAfterEpoch'],'SAME_ORIGINAL_PARENT_DEADLINE')
 carrier=T['storage']['carrier'];need(H(carrier['path'])==carrier['sha256'],'ACTUAL_CARRIER_BEFORE_STORAGE')
 keys=json.loads(pathlib.Path(carrier['path']).read_bytes())
 phases=StoragePhases(policy,T['companyId'],keys['serviceRoleKey'],T['notAfterEpoch'])
 with storage_source.own_storage(rt,T['storage'],save)as storage:
  class Handler(http.server.BaseHTTPRequestHandler):
   def log_message(self,*args):pass
   def setup(self):super().setup();self.connection.settimeout(5)
   def do_GET(self):self.forward()
   def do_POST(self):self.forward()
   def forward(self):
    conn=None
    try:
     need(len(self.path)<=8192 and self.path.startswith('/storage/v1/'),'STORAGE_PREFIX_ONLY')
     need(len(self.headers.get_all('Content-Length',[]))<=1 and len(self.headers.get_all('Authorization',[]))==1 and len(self.headers.get_all('apikey',[]))==1,'UNAMBIGUOUS_STORAGE_HEADERS')
     size=int(self.headers.get('Content-Length','0'));need(0<=size<=2097152,'BOUNDED_STORAGE_CONTENT_LENGTH');body=self.rfile.read(size);need(len(body)==size,'COMPLETE_STORAGE_REQUEST_BODY')
     downstream=phases.admit(self.command,self.path,dict(self.headers),body)
     # The runtime already verified immutable own CID/image/netns. No host,
     # URL, database, credentials or route are taken from request input.
     headers={k:v for k,v in self.headers.items()if k.lower()not in {'host','connection','content-length','transfer-encoding','proxy-authorization'}}
     conn=http.client.HTTPConnection(storage['storageIP'],5000,timeout=15);conn.request(self.command,downstream,body=body,headers=headers)
     response=conn.getresponse();payload=response.read(2097153);phases.observe(self.command,self.path,response.status,payload)
     self.send_response(response.status)
     for k,v in response.getheaders():
      if k.lower()not in {'connection','content-length','transfer-encoding'}:self.send_header(k,v)
     self.send_header('Content-Length',str(len(payload)));self.send_header('Connection','close');self.end_headers();self.wfile.write(payload)
    except BaseException:
     phases.stop()
     try:self.send_error(502,'OWN_STORAGE_BRIDGE_STOP_NO_RETRY')
     except BaseException:pass
    finally:
     if conn:conn.close()
     self.close_connection=True
  server=http.server.HTTPServer(('127.0.0.1',3169),Handler);thread=None
  try:
   thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
   save(storage_source.ROOT/'bridge-ready.safe.json',{'state':'REAL_OWN_STORAGE_FIXED_PROXY_FIXTURE_ONLY','port':3169,'ownStorageCID':storage['storageId'],'ownRESTCID':rt['restId'],'normalWorkerRESTPortUnchanged':3168,'noActorOrBusinessAuthority':True})
   yield {'host':'127.0.0.1','port':3169,'phases':phases,'bucketInitializer':str(P/'ensure-own-archive-bucket.cjs'),'actualStorage':storage}
  finally:
   phases.stop()
   if thread and thread.is_alive():server.shutdown()
   server.server_close()
   if thread and thread.ident is not None:thread.join(timeout=5)
   need(not thread or not thread.is_alive(),'OWN_STORAGE_PROXY_THREAD_ABSENT')
   save(storage_source.ROOT/'bridge-closed.safe.json',dict(phases.evidence(),ownProxyThreadAbsent=True,rawObjectsRetainedByStorageRuntime=True))
