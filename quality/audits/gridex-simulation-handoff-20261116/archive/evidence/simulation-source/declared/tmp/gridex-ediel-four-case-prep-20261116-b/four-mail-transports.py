"""Four fixed owned loopback TLS fixtures; no action at import or implicit send."""
import contextlib,hashlib,imaplib,json,os,pathlib,shutil,signal,smtplib,ssl,subprocess,sys,time
P=pathlib.Path
ROOT=P('/tmp/gridex-ediel-four-case-actual-20261116-b')
MANIFEST=P('/tmp/gridex-ediel-four-case-fixture-prep-20261116-a/PREPARED.STATIC.safe.json')
HELPER=P('/tmp/gridex-ediel-local-transport-prep-v2-20261113/local_mail_fixture.py')
HELPER_SHA256='b16cccfc996379ff296c3cdcdd83c5582f3b7a97ea946221410f505809d1f2c5'
MANIFEST_SHA256='3da09ba35c5ca4dece7458b7186b9b418d6b523e5e297248e872965e3973e673'
CASES=('inbound','SMTP_451','SMTP_550','SMTP_DROP_DATA')
MODES=('accept','temporary_451','permanent_550','drop_after_data')
USER='ediel-four-owned-20261116-a@fixture.invalid'
RECIPIENTS=('ediel-four-receiver-20261116-a@fixture.invalid','ediel-four-451-source@fixture.invalid','ediel-four-550-source@fixture.invalid','ediel-four-drop-source@fixture.invalid')
def need(v,m):
 if not v:raise AssertionError(m)
def H(p):return hashlib.sha256(P(p).read_bytes()).hexdigest()
def ref(p):return {'path':str(p),'sha256':H(p)}
def read(p):return json.loads(P(p).read_text())
def validate(row,i):
 p=P(row['config']['path']);need(p.resolve()==p and p.is_file()and not p.is_symlink()and p.stat().st_mode&511==384 and H(p)==row['config']['sha256'],'EXACT_PRIVATE_REAL_CONFIG')
 c=read(p);need(row['caseName']==CASES[i]and c['state']=='PRODUCER_QUALIFIED_LOCAL_ONLY'and c['bindHost']=='127.0.0.1'and c['mode']==MODES[i]and c['smtpPort']==25276+i and c['imapPort']==21996+i,'EXACT_FOUR_CLOSED_ENDPOINTS')
 need(c['user']==USER and c['recipients']==[RECIPIENTS[i]]and len(c['password'])>=24 and c['ttlSeconds']==900 and c['maxMessages']==(4 if i==0 else 1),'EXACT_DECLARED_ACCOUNT_AND_ORIGINAL_LEASE_CAP')
 for k in ('CA','serverCertificate'):need(H(row[k]['path'])==row[k]['sha256'],'TLS_STATIC_SOURCE_HASH')
 return c

def proc_identity(pid):
 st=P('/proc/'+str(pid)+'/stat').read_text();return {'pid':pid,'uid':P('/proc/'+str(pid)).stat().st_uid,'startTime':int(st[st.rindex(')')+2:].split()[19]),'cmdSHA256':hashlib.sha256(P('/proc/'+str(pid)+'/cmdline').read_bytes()).hexdigest()}
def same_process(identity):
 try:return proc_identity(identity['pid'])==identity
 except (FileNotFoundError,ProcessLookupError):return False

def save_bytes(path,b):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(b);f.flush();os.fsync(f.fileno())

@contextlib.contextmanager
def one(row,i,save,probe=False):
 need(H(HELPER)==HELPER_SHA256,'UNCHANGED_QUALIFIED_MAIL_HELPER');c=validate(row,i);source=P(row['config']['path']);root=source.parent
 if probe:
  root=ROOT/'preauth-mail-static'/CASES[i].lower();root.mkdir(mode=0o700,parents=True)
  for name in ('server.crt','server.key','ca.crt'):save_bytes(root/name,(source.parent/name).read_bytes())
  source=root/'config.private.json';save_bytes(source,(json.dumps(c,indent=2)+'\n').encode())
 need(str(root).startswith('/tmp/gridex-ediel-')and not(root/'capture').exists(),'EXCLUSIVE_UNUSED_OWN_FIXTURE_ROOT')
 arm=root/'armed.four-case.safe.json';save(arm,{'status':'ROOT_ARMED_SOLEPRODUCER_LOCAL_TRANSPORT','configSHA256':H(source),'prototypeOnly':probe})
 out=ROOT/('transport-'+CASES[i].lower()+('-probe'if probe else'')+'.stdout.private.log');err=ROOT/('transport-'+CASES[i].lower()+('-probe'if probe else'')+'.stderr.private.log');of=os.open(out,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);ef=os.open(err,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);proc=None;identity=None;started=time.time()
 try:
  proc=subprocess.Popen([sys.executable,str(HELPER),'--config',str(source),'--expect-sha256',H(source),'--arm-file',str(arm)],stdin=subprocess.DEVNULL,stdout=of,stderr=ef,start_new_session=True)
  identity=proc_identity(proc.pid);need(os.getpgid(proc.pid)==proc.pid,'ACTUAL_OWN_FIXTURE_PGID');save(ROOT/('transport-'+CASES[i].lower()+('-probe'if probe else'')+'.launch.safe.json'),{**identity,'PGID':proc.pid,'config':ref(source),'startedAtEpoch':started,'prototypeOnly':probe})
  end=time.time()+10
  while time.time()<end:
   need(proc.poll()is None,'OWN_MAIL_FIXTURE_EARLY_EXIT')
   events=root/'capture/events.jsonl'
   if events.exists()and any(json.loads(x)['kind']=='listeners_started'for x in events.read_text().splitlines()):break
   time.sleep(.05)
  else:raise AssertionError('BOUNDED_TLS_LISTENER_READY_TIMEOUT')
  yield {'caseName':CASES[i],'root':str(root),'config':ref(source),'startedAtEpoch':started,'process':identity,'PGID':proc.pid,'prototypeOnly':probe}
 finally:
  os.close(of);os.close(ef)
  if proc:
   if proc.poll()is None:
    need(os.getpgid(proc.pid)==proc.pid and (identity is None or same_process(identity)),'EXACT_TRACKED_CHILD_FIXTURE_BEFORE_SIGNAL');os.killpg(proc.pid,signal.SIGTERM)
    try:proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
     need(os.getpgid(proc.pid)==proc.pid and (identity is None or same_process(identity)),'EXACT_TRACKED_CHILD_FIXTURE_BEFORE_KILL');os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
   save(ROOT/('transport-'+CASES[i].lower()+('-probe'if probe else'')+'.closed.safe.json'),{'pid':proc.pid,'PGID':proc.pid,'exitCode':proc.returncode,'ownedProcessAbsent':proc.poll()is not None,'prototypeOnly':probe,'config':ref(source)})

@contextlib.contextmanager
def actual_four(save):
 need(H(MANIFEST)==MANIFEST_SHA256,'FROZEN_FOUR_STATIC_CONFIG_MANIFEST');m=read(MANIFEST);need(len(m['fixtures'])==4,'EXACT_FOUR_STATIC_FIXTURES')
 with contextlib.ExitStack()as stack:
  yield [stack.enter_context(one(row,i,save))for i,row in enumerate(m['fixtures'])]

def static_probe(save):
 need(H(MANIFEST)==MANIFEST_SHA256,'FROZEN_FOUR_STATIC_CONFIG_MANIFEST');m=read(MANIFEST);results=[]
 for i,row in enumerate(m['fixtures']):
  with one(row,i,save,probe=True)as live:
   c=read(live['config']['path']);root=P(live['root']);ctx=ssl.create_default_context(cafile=str(root/'ca.crt'));ctx.minimum_version=ssl.TLSVersion.TLSv1_2
   expected=hashlib.sha256(ssl.PEM_cert_to_DER_cert((root/'server.crt').read_text())).hexdigest()
   with smtplib.SMTP_SSL('127.0.0.1',c['smtpPort'],timeout=5,context=ctx)as client:
    need(hashlib.sha256(client.sock.getpeercert(binary_form=True)).hexdigest()==expected,'ACTUAL_SMTP_LEAF_PIN');client.ehlo();client.login(c['user'],c['password'])
   client=imaplib.IMAP4_SSL('127.0.0.1',c['imapPort'],ssl_context=ctx,timeout=5)
   try:
    need(hashlib.sha256(client.sock.getpeercert(binary_form=True)).hexdigest()==expected,'ACTUAL_IMAP_LEAF_PIN');client.login(c['user'],c['password']);status,counts=client.select('INBOX',readonly=True);need(status=='OK'and counts==[b'0'],'INERT_OWN_IMAP_EMPTY')
   finally:client.logout()
   events=[json.loads(x)for x in(root/'capture/events.jsonl').read_text().splitlines()];need(not any(x['kind']in ('smtp_data_received','actual_data_captured')for x in events),'NO_PREAUTH_SMTP_DATA_OR_EMAIL')
   results.append({'caseName':CASES[i],'SMTPAndIMAPRealTLSAuth':True,'leafDERsha256':expected,'zeroSMTPDATA':True,'zeroEmail':True,'prototypeOnlyNoNativeAuthority':True})
 save(ROOT/'preauth-four-TLS-mail-probes.safe.json',{'state':'FOUR_INERT_TLS_AUTH_PROBES_CLOSED_NO_SOURCE_OR_ACTOR_AUTHORITY','cases':results,'actual900TransportLeasesNotStarted':True})

def smtp_physical(live,save):
 case=live['caseName'];need(case in CASES[1:],'ONLY_THREE_SMTP_FAULT_CASES');root=P(live['root']);events=[json.loads(x)for x in(root/'capture/events.jsonl').read_text().splitlines()];data=[x for x in events if x['kind']=='smtp_data_received'];accepted=[x for x in events if x['kind']=='actual_data_captured'];reject=[x for x in events if x['kind']=='smtp_explicit_reject'];unknown=[x for x in events if x['kind']=='smtp_response_intentionally_unknown'];need(len(data)==1,'EXACT_ONE_PHYSICAL_SMTP_DATA_PER_CASE')
 value={'caseName':case,'config':live['config'],'actualFixtureProcess':live['process'],'SMTPDataCount':1,'SMTPDataSHA256':data[0]['sha256'],'SMTPDataBytes':data[0]['bytes'],'acceptedMimeCount':len(accepted),'smtpResponseCode':reject[0]['code']if len(reject)==1 else None,'acceptedMimeSHA256':accepted[0]['sha256']if len(accepted)==1 else None,'intentionallyUnknownAfterDATA':len(unknown)==1,'eventsSnapshot':events}
 if case=='SMTP_DROP_DATA':need(len(accepted)==1 and len(unknown)==1 and not reject,'REAL_ONE_ACCEPTED_DATA_WITH_NO_FINAL_SMTP_RESPONSE')
 else:need(not accepted and len(reject)==1 and reject[0]['code']==(451 if case=='SMTP_451'else 550),'REAL_EXPLICIT_SMTP_REJECT_WITH_NO_ACCEPTED_EMAIL')
 save(ROOT/(case+'.physical.private.json'),value);return value

PHYSICAL_CLI=P(__file__).resolve().parent/'mail-physical-cli.four.cjs'
PHYSICAL_ADAPTER=P(__file__).resolve().parent/'mail-physical.four.cjs'
NODE='/tmp/gridex-lean-actual-qualification-20261113/node22.selected'
DEPENDENCY='/tmp/gridex-closed-evidence-relocation-20261113/gridex-krypkorning-run-20261111/package.json'
def physical_call(value,path,save):
 save(path,value);env={k:v for k,v in os.environ.items()if k not in('NODE_TLS_REJECT_UNAUTHORIZED','GRIDEX_IMAP_ALLOW_PLAINTEXT_LOOPBACK')}
 r=subprocess.run([NODE,'--max-old-space-size=64',str(PHYSICAL_CLI),'--input',str(path),'--input-sha256',H(path)],capture_output=True,timeout=30,env=env)
 need(len(r.stdout)<=2097152 and len(r.stderr)<=65536,'BOUNDED_OWN_PHYSICAL_CLI_OUTPUT');save(ROOT/(path.stem+'.process.safe.json'),{'returnCode':r.returncode,'stdoutSHA256':hashlib.sha256(r.stdout).hexdigest(),'stderrSHA256':hashlib.sha256(r.stderr).hexdigest(),'noRetry':True});need(r.returncode==0,'OWN_PHYSICAL_OPERATION_UNKNOWN_NO_RETRY');return json.loads(r.stdout)
def deposit_four(rt,inbound,payloads,T,save):
 need(inbound['caseName']=='inbound'and len(payloads)==4,'EXACT_OWN_FOUR_SOURCE_DEPOSITS');source=P(inbound['config']['path']);root=source.parent;leaf=hashlib.sha256(ssl.PEM_cert_to_DER_cert((root/'server.crt').read_text())).hexdigest()
 base={'state':'PRODUCER_BOUND_OWN_HOST_MAIL_PHYSICAL','deadlineEpochMs':int(min(T['storageIntegration']['notAfterEpoch'],inbound['startedAtEpoch']+840)*1000),'fixtureRoot':str(root),'fixture':ref(source),'ca':ref(root/'ca.crt'),'peerCertificateSha256':leaf,'dependencyEntry':DEPENDENCY}
 initial=physical_call({**base,'purpose':'READ_ONLY_IMAP'},ROOT/'imap-before-four.input.private.json',save);need(initial['messages']==[]and initial['unreadCount']==0,'ACTUAL_EMPTY_OWN_SOURCE_MAILBOX')
 deposits=[]
 for i,payload in enumerate(payloads):
  raw=P(payload['mime']['path']);need(raw.parent==ROOT and H(raw)==payload['mime']['sha256']and raw.stat().st_size<=65536,'EXACT_NORMAL_GENERATED_SOURCE_MIME');d=ROOT/('physical-deposit-'+str(i));d.mkdir(mode=0o700);copy=d/'source.eml';save_bytes(copy,raw.read_bytes());result=physical_call({**base,'purpose':'DEPOSIT_EXACT_RAW_ONCE','outputRoot':str(d),'rawMime':ref(copy)},ROOT/('deposit-'+str(i)+'.input.private.json'),save);need(result['rawSHA256']==payload['mime']['sha256']and result['acceptedCount']==1 and  result['rejectedCount']==0,'ONE_PHYSICAL_ACCEPT_PER_SOURCE');deposits.append({'caseName':payload['caseName'],'sha256':result['rawSHA256'],'result':result})
 actual=physical_call({**base,'purpose':'READ_ONLY_IMAP'},ROOT/'imap-after-four.input.private.json',save);need(len(actual['messages'])==4 and  actual['unreadCount']==4 and  sorted(x['sha256']for x in actual['messages'])==sorted(x['mime']['sha256']for x in payloads),'ACTUAL_FOUR_DISTINCT_RAW_IMAP_HASHES');save(ROOT/'four-physical-imap.private.json',actual)
 return {'state':'ACTUAL_FOUR_OWN_PHYSICAL_MIME_DEPOSITS','messages':deposits,'physicalIMAP':ref(ROOT/'four-physical-imap.private.json'),'allUnreadBeforeNormalPoll':True,'noProductCaseCredit':True}
