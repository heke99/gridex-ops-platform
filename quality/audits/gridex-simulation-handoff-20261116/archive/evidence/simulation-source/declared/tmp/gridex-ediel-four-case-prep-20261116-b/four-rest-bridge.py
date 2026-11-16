"""Finite own REST proxy. Actual worker enforces its source-paired per-row boundary.
No native response, user, actor, role or provider outcome is manufactured.
"""
import contextlib,hashlib,http.client,http.server,json,pathlib,secrets,threading,time,urllib.parse
ROOT=pathlib.Path('/tmp/gridex-ediel-four-case-actual-20261116-b')
INVENTORY=pathlib.Path('/tmp/gridex-ediel-four-case-worker-prep-20261116-b/FETCH-ROUTES.SOURCE-ONLY.safe.json')
COMPANY='b36f6a30-18cd-4a70-8652-5b2da9b4eb64';ACTOR='ee029de5-22a8-4916-9c36-388d13f19cb1'
def need(v,m):
 if not v:raise AssertionError(m)
def H(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def names(v,keys):
 for k in keys:
  if isinstance(v.get(k),list):return set(v[k])
 raise AssertionError('FROZEN_HTTP_INVENTORY_FIELDS_REQUIRED')
@contextlib.contextmanager
def bridge(rt,keys,inventory_ref,save):
 need(inventory_ref['path']==str(INVENTORY)and H(INVENTORY)==inventory_ref['sha256'],'SOURCE_PAIRED_HTTP_INVENTORY_HASH')
 info=json.loads(INVENTORY.read_text());rpc=names(info,('rpcs','RPCS','rpcNames'));reads=names(info,('reads','READS','readRelations'));writes=names(info,('writes','WRITES','writeRelations'))
 need(rt['restPort']==3000 and len(rt['restId'])==64,'ACTUAL_OWN_REST_CONTAINER')
 gate={'enabled':False,'deadline':0,'userAccessToken':None,'requests':0,'denied':0,'phase':'WAIT_REAL_MAIN_ACTOR'}
 class Handler(http.server.BaseHTTPRequestHandler):
  def log_message(self,*a):pass
  def setup(self):super().setup();self.connection.settimeout(5)
  def do_GET(self):self.forward()
  def do_HEAD(self):self.forward()
  def do_POST(self):self.forward()
  def do_PATCH(self):self.forward()
  def forward(self):
   conn=None
   try:
    need(gate['enabled']and time.time()<gate['deadline'],'CLOSED_GENUINE_ACTOR_GATE_OR_DEADLINE')
    need(gate['requests']<512 and len(self.path)<=16384 and self.path.startswith('/rest/v1/'),'FINITE_OWN_REST_PATHS_ONLY')
    need(len(self.headers.get_all('Authorization',[]))==1 and len(self.headers.get_all('apikey',[]))==1 and len(self.headers.get_all('Content-Length',[]))<=1,'UNAMBIGUOUS_NORMAL_AUTH_HEADERS')
    need(not any(k in self.headers for k in ['Cookie','Proxy-Authorization','Transfer-Encoding']),'NO_COOKIE_PROXY_OR_CHUNKED_SOURCE')
    auth=self.headers.get('Authorization','');api=self.headers.get('apikey','');service=secrets.compare_digest(auth,'Bearer '+keys['serviceRoleKey'])and secrets.compare_digest(api,keys['serviceRoleKey']);user=bool(gate['userAccessToken'])and secrets.compare_digest(auth,'Bearer '+gate['userAccessToken'])and secrets.compare_digest(api,keys['anonKey']);need(service or user,'ACTUAL_SERVICE_OR_GENUINE_MAIN_USER_BEARER_ONLY')
    u=urllib.parse.urlsplit(self.path);need(not u.fragment and not u.scheme and not u.netloc,'EXACT_OWN_RELATIVE_URL');part=u.path[len('/rest/v1/'):]
    if part.startswith('rpc/'):
     need(self.command=='POST'and not u.query and part[4:]in rpc,'CLOSED_ORIGINAL_PRODUCT_RPC')
    else:need(part in(reads if self.command in('GET','HEAD')else writes)and self.command in('GET','HEAD','POST','PATCH'),'CLOSED_PUBLIC_READ_OR_NORMAL_WRITE_RELATION')
    size=int(self.headers.get('Content-Length','0'));need(0<=size<=2097152,'BOUNDED_NORMAL_REQUEST');body=self.rfile.read(size);need(len(body)==size,'COMPLETE_NORMAL_BODY')
    if body:
     value=json.loads(body);rows=value if isinstance(value,list)else[value];need(len(rows)<=4,'FINITE_NORMAL_ROW_BATCH')
     for row in rows:
      need(isinstance(row,dict),'JSON_PRODUCT_OBJECT')
      for k in('company_id','p_company_id','p_resolved_company_id'):
       if row.get(k)is not None:need(row[k]==COMPANY,'NO_FOREIGN_TENANT_WRITE')
      for k in('p_actor_user_id','p_actor_id','created_by','updated_by'):
       if row.get(k)is not None:need(row[k]==ACTOR,'GENUINE_ACTUAL_OPERATOR_WRITE')
    gate['requests']+=1;headers={k:v for k,v in self.headers.items()if k.lower()not in('host','connection','content-length','transfer-encoding','proxy-authorization')};conn=http.client.HTTPConnection(rt['restIP'],rt['restPort'],timeout=15);conn.request(self.command,self.path[len('/rest/v1'):],body=body,headers=headers);response=conn.getresponse();data=response.read(8388609);need(len(data)<=8388608,'BOUNDED_REAL_NATIVE_RESPONSE')
    self.send_response(response.status)
    for k,v in response.getheaders():
     if k.lower()not in('connection','content-length','transfer-encoding'):self.send_header(k,v)
    self.send_header('Content-Length',str(len(data)));self.send_header('Connection','close');self.end_headers()
    if self.command!='HEAD':self.wfile.write(data)
   except BaseException:
    gate['denied']+=1;gate['enabled']=False
    try:self.send_error(502,'OWN_REST_STOP_NO_RETRY')
    except BaseException:pass
   finally:
    if conn:conn.close()
    self.close_connection=True
 server=http.server.HTTPServer(('127.0.0.1',3168),Handler);thread=None
 try:
  thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();save(ROOT/'clone-bridge-ready.safe.json',{'state':'OWN_FOUR_CASE_REST_BRIDGE_GENUINE_ACTOR_GATE_CLOSED','port':3168,'actualOwnRESTCID':rt['restId'],'sourceInventory':inventory_ref});yield gate
 finally:
  gate['enabled']=False
  if thread and thread.is_alive():server.shutdown()
  server.server_close()
  if thread and thread.ident is not None:thread.join(timeout=5)
  need(not thread or not thread.is_alive(),'OWN_PROXY_THREAD_ABSENT');save(ROOT/'clone-bridge-closed.safe.json',{'state':'OWN_FOUR_CASE_REST_BRIDGE_CLOSED','requests':gate['requests'],'denied':gate['denied'],'threadAbsent':True})
