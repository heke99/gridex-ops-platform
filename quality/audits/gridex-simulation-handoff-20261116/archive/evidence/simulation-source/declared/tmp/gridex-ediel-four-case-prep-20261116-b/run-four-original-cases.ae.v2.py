"""One fixed original EDIEL02.05 + EDIEL03.01-.03 cohort; no import effects.
Normal product operations execute once. Original policy FAIL is recorded, not hidden.
"""
import argparse,contextlib,hashlib,importlib.util,json,os,pathlib,re,selectors,signal,subprocess,sys,time,uuid
P=pathlib.Path;PREP=P(__file__).resolve().parent;ROOT=P('/tmp/gridex-ediel-four-case-actual-20261116-b')
WP=P('/tmp/gridex-ediel-four-case-worker-prep-20261116-b');NODE='/tmp/gridex-lean-actual-qualification-20261113/node22.selected'
ACTOR='ee029de5-22a8-4916-9c36-388d13f19cb1';COMPANY='b36f6a30-18cd-4a70-8652-5b2da9b4eb64';DB='gridex_local_partner_http_20261113_a'
CASES=('WRONG_PARTY','SMTP_451','SMTP_550','SMTP_DROP_DATA');SMTP=CASES[1:]
def need(v,m):
 if not v:raise AssertionError(m)
def H(p):return hashlib.sha256(P(p).read_bytes()).hexdigest()
def ref(p):return {'path':str(p),'sha256':H(p)}
def read(p):return json.loads(P(p).read_text())
def load(p,n):
 s=importlib.util.spec_from_file_location(n,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def output(v):print(json.dumps(v),flush=True)
def wait_file(p,deadline):
 while time.time()<deadline and not P(p).is_file():time.sleep(.1)
 need(P(p).is_file(),'FINITE_REVIEW_OR_OBSERVATION_TIMEOUT');return read(p)
def verify_outer_go(t,g):
 need(g['rootArmed']is True and g['executeAgent']=='execute_eight_parts'and g['targetSHA256']==H(t)and g['controllerSHA256']==H(__file__),'ACTUAL_OUTER_GO')
 need(len(g['scopeReviews'])==2 and {x['reviewerAgent']for x in g['scopeReviews']}=={'/root','/root/execute_eight_parts'},'TWO_REAL_OUTER_REVIEWERS')
 for x in g['scopeReviews']:
  need(H(x['path'])==x['sha256'],'SCOPE_HASH');a=read(x['path']);need(a['verdict']=='EXECUTION_SCOPE_APPROVE'and a['reviewerAgent']==x['reviewerAgent']and a['targetSHA256']==H(t)and a['controllerSHA256']==H(__file__),'REAL_OUTER_SCOPE_BODY')
def native_fence(rt,m,tag,targetsha):
 snap=rt['snapshot']('postgres');seq=json.loads(rt['sql']('postgres',"SELECT json_agg(json_build_object('schema',schemaname,'sequence',sequencename,'lastValue',last_value) ORDER BY schemaname,sequencename) FROM pg_sequences;"));auth=json.loads(rt['sql']('postgres',"SELECT json_build_object('sessions',(SELECT count(*)FROM auth.sessions),'refresh',(SELECT count(*)FROM auth.refresh_tokens),'mfaFactors',(SELECT count(*)FROM auth.mfa_factors),'mfaChallenges',(SELECT count(*)FROM auth.mfa_challenges),'mfaClaims',(SELECT count(*)FROM auth.mfa_amr_claims),'flowState',(SELECT count(*)FROM auth.flow_state));"));need(len(snap['rows'])==522 and len(snap['allRawFunctions'])==3370 and len(seq)==7 and len(auth)==6,'WHOLE_MAIN_ALL7_AUTH6')
 raw=ROOT/(tag+'.main.private.json');m.save(raw,snap);m.save(ROOT/(tag+'.all7.safe.json'),{'targetSHA256':targetsha,'sequences':seq});m.save(ROOT/(tag+'.auth.safe.json'),auth);m.save(ROOT/(tag+'.main-proof.safe.json'),{'targetSHA256':targetsha,'fullSnapshot':ref(raw),'bytes':raw.stat().st_size,'rowScopes':522,'functions':3370,'freshObservedAtEpoch':time.time(),'rawAliasReuseProof':ref(P(str(raw)+'.reuse-complete.safe.json'))if P(str(raw)+'.reuse-complete.safe.json').exists()else None,'outerOwnsFullVerification':True});return snap,seq,auth

def graph_delta(a,b,allowed):
 need(set(a)==set(b)and set(a['rows'])==set(b['rows'])and all(a[k]==b[k]for k in a if k!='rows'),'WHOLE_MAIN_NONROW_OR_SCOPE_DRIFT');changed={k for k in a['rows']if a['rows'][k]!=b['rows'][k]};need(changed<=allowed,'MAIN_NONAUTH_DRIFT');return sorted(changed)
def worker_preflight(target,out,full,ca):
 env=dict(os.environ,NODE_EXTRA_CA_CERTS=ca);r=subprocess.run([NODE,'--max-old-space-size=64',str(WP/'validate-byte-refs.v3.cjs'),'--target',str(target)]+(['--full-actual']if full else[]),capture_output=True,text=True,env=env,timeout=15)
 need(len(r.stdout.encode())<=2097152 and len(r.stderr.encode())<=65536,'BOUNDED_EXACT_PREFLIGHT_OUTPUT');v=json.loads(r.stdout);fd=os.open(out,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w')as f:json.dump(v,f,indent=2);f.flush();os.fsync(f.fileno())
 need(r.returncode==0 and v['passed']is True,'EXACT_STATIC_OR_PRELOGIN_PREFIX_FAILED')
 if full:
  need(v['dynamicRefsAbsent']==[]and v['actualPrefixExecuted']is True and v['fullActualMode']is True,'FULL_ACTUAL_PREFIX_AND_DYNAMIC_REFS_REQUIRED');c=read(target);need(c['state']=='BOUND_HEADLESS_ORIGINAL_EDIEL_FOUR_CASES'and c['actualRoot']==str(ROOT)and c['cloneDatabase']==DB and c['actorId']==ACTOR and c['companyId']==COMPANY,'EXACT_ACTUAL_FOUR_CASE_SCALARS');need(P(target)==ROOT/'target.BOUND.private.json'and P(target).resolve()==P(target)and P(target).stat().st_mode&511==384,'EXACT_OWN_ACTUAL_TARGET')
 return v

def current_role(T):
 b=read(T['roleBinding']['path'])
 for k in('renewal','carrier','independentOutcome'):need(H(b[k]['path'])==b[k]['sha256'],'CURRENT_ROLE_BINDING_HASH')
 renewal=read(b['renewal']['path']);peer=read(b['independentOutcome']['path']);need(renewal['state']=='SERVER_KEYS_NORMALLY_RENEWED_FOR_FULL_WINDOW'and renewal['newExp']>time.time()+1920,'REAL_FULL_ROLE_WINDOW');need(peer['verdict']=='ACTUAL_STANDARD_AE_RENEWAL_COMPONENT_APPROVE'and peer['renewal']==b['renewal']and peer['carrier']==b['carrier']and peer['actualClaims']=={'iat':renewal['newIat'],'exp':renewal['newExp'],'seconds':7200,'roles':['anon','service_role']},'GENUINE_AE_OUTCOME');need(peer['sameSecretOnlyTwoFieldsChangedPrivatelyVerified']is True and peer['normalReload0Health200200']is True and H(T['globalCarrierPath'])==b['carrier']['sha256'],'ONLY_NORMAL_TWO_ROLES_SAME_SECRET_CURRENT');return b,renewal,read(b['carrier']['path'])

def run(target,go):
 os.umask(0o077);T=read(target);verify_outer_go(target,read(go));need(T['state']=='BOUND_READY'and T['originalIds']==['EDIEL02.05','EDIEL03.01','EDIEL03.02','EDIEL03.03'],'ONLY_FOUR_SELECTED_ORIGINALS')
 for x in T['boundFiles']:need(H(x['path'])==x['sha256'],'SOURCE_OR_STATIC_INPUT_DRIFT')
 m=load(PREP/'owned-four-runtime.v2.py','four_owned');sem=load(PREP/'four-case-semantic-native.py','four_native');mail=load(PREP/'four-mail-transports.py','four_mail');host=load(PREP/'four-rest-bridge.py','four_bridge');core=load(PREP/'four-case-native.v3.py','four_core')
 # All implementation interfaces must be source-frozen before preparation/Auth.
 for name in('pre_auth','baseline','receiver_before','receiver_issued','routes','capture','sources','contrl','smtp','phase_witness','frame'):need(callable(getattr(sem,name,None)),'FROZEN_SEMANTIC_NATIVE_INTERFACE_REQUIRED')
 worker_preflight(WP/'WORKER-TARGET.UNARMED.safe.json',PREP/'PRECLONE-WORKER-PREFLIGHT.safe.json',False,T['mailTlsCA']['path'])
 topology=load(T['topologyModule']['path'],'four_normal_topology')
 rt=None;anchor=None;wt=None;outer_error=None
 try:
  with topology.ready(T['topologyTarget']['path'],T['topologyGO']['path']):
   output({'state':'NORMAL_TOPOLOGY_READY_NO_USER_AUTH'});need(sys.stdin.readline().strip()=='REAPPLY_CURRENT_AE','EXPLICIT_SAME_AE_CONFIG_OPERATION')
   q=subprocess.run([sys.executable,T['reapplyScript']['path']],capture_output=True,env=m.ENV,timeout=120);need(q.returncode==0,'SAME_AE_REAPPLY_STOP_NO_RETRY');applied=read(T['reapplyReadyPath']);need(applied['state']=='SAME_AE_STANDARD_KONG_CONFIG_REAPPLIED_AUTH_REST200_NO_MINT'and applied['carrierSHA256']==T['currentYCarrierSHA256']and [x['status']for x in applied['statuses']]==[200,200],'ACTUAL_SAME_AE_AUTH_REST_HEALTH')
   binding,renewal,keys=current_role(T)
   with m.owned_runtime(T)as rt:
    rt['serverKeys']=keys;rt['save']=m.save
    bucket_input={'state':'BOUND_OWN_REAL_STORAGE_BUCKET_FIXTURE_ONLY','origin':'http://127.0.0.1:3169','deadlineEpoch':T['storageIntegration']['notAfterEpoch'],'carrier':binding['carrier'],'initializer':ref(rt['storage']['bucketInitializer'])};m.save(ROOT/'storage-bucket-input.private.json',bucket_input)
    init=subprocess.run([NODE,'--max-old-space-size=192',str(PREP/'initialize-own-storage-bucket.cjs'),str(ROOT/'storage-bucket-input.private.json')],capture_output=True,timeout=45);need(len(init.stdout)<=2097152 and len(init.stderr)<=65536 and init.returncode==0,'REAL_OWN_BUCKET_FIXTURE_STOP_BEFORE_USER_AUTH');bucket=json.loads(init.stdout);m.save(ROOT/'storage-bucket-fixture.safe.json',bucket);rt['storage']['phases'].finish_fixture(bucket)
    mail.static_probe(m.save)
    pre=sem.pre_auth(rt);m.save(ROOT/'native-prerequisites.private.json',pre);base=sem.baseline(rt);m.save(ROOT/'native-before-fixture.private.json',base);pre_frame=sem.frame(rt,'before-fixture',None,m.save)
    before,seq0,auth0=native_fence(rt,m,'before-auth',None);need(before==rt['mainBeforeSetup']and all(v==0 for v in auth0.values()),'FRESH_MAIN_AUTH0_BEFORE_PASSWORD')
    C=read(WP/'WORKER-TARGET.UNARMED.safe.json');C.update(state='BOUND_HEADLESS_ORIGINAL_EDIEL_FOUR_CASES',authNotAfterEpoch=int(time.time())+1800,actorCredential=T['actorCredential'],serverKeys=binding['carrier'],sourceFreeze=T['workerSourceFreeze'],mainBeforeAuth=ref(ROOT/'before-auth.main-proof.safe.json'),all7BeforeAuth=ref(ROOT/'before-auth.all7.safe.json'),nativePrerequisites=ref(ROOT/'native-prerequisites.private.json'),mailTlsCA=T['mailTlsCA'])
    for k in('actorCredential','serverKeys','sourceFreeze','mainBeforeAuth','all7BeforeAuth','nativePrerequisites'):C['boundFiles'].append(C[k])
    wt=ROOT/'target.BOUND.private.json';m.save(wt,C);worker_preflight(wt,ROOT/'PRELOGIN-WORKER-PREFLIGHT.safe.json',True,C['mailTlsCA']['path']);output({'state':'ALL_STATIC_NATIVE_STORAGE_PREREQUISITES_READY_NO_AUTH','workerTarget':ref(wt),'fullPreloginPrefixPassed':True});wait_file(ROOT/'GO.actual.safe.json',time.time()+600)
    with host.bridge(rt,keys,T['HTTPInventory'],m.save)as gate:
     worker=None;stderr=None;anchor=None;primary=None;results=[]
     try:
      env=dict(os.environ)
      for key in list(env):
       if key=='GRIDEX_AUTOMATION_USER_ID'or re.match(r'^(GRIDEX_SHARED_EDIEL_|GRIDEX_SHARED_TEST_EDIEL_|EDIEL_(TEST_|PRODUCTION_)?(IMAP|SMTP|INBOUND))',key):env.pop(key)
      env['NODE_EXTRA_CA_CERTS']=C['mailTlsCA']['path'];env.pop('NODE_TLS_REJECT_UNAUTHORIZED',None);env.pop('GRIDEX_IMAP_ALLOW_PLAINTEXT_LOOPBACK',None)
      need(renewal['newExp']>time.time()+1920 and H(T['globalCarrierPath'])==binding['carrier']['sha256'],'FRESH_REVIEWED_WINDOW_CURRENT_CARRIER_BEFORE_PASSWORD')
      stderr=(ROOT/'worker.stderr.private.log').open('xb');os.fchmod(stderr.fileno(),0o600);worker=subprocess.Popen([NODE,'--conditions=react-server','--max-old-space-size=192',str(WP/'normal-four-case-worker.v3.cjs'),str(wt)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=stderr,text=True,bufsize=1,start_new_session=True);need(os.getpgid(worker.pid)==worker.pid,'ACTUAL_OWN_WORKER_PGID');m.save(ROOT/'worker-launch.safe.json',{'pid':worker.pid,'PGID':worker.pid,'targetSHA256':H(wt),'nodeOldSpaceMiB':192,'actualPGIDRecorded':True})
      select=selectors.DefaultSelector();select.register(worker.stdout,selectors.EVENT_READ)
      def receive(expected,seconds=60):
       need(select.select(seconds),'FINITE_NORMAL_WORKER_RESPONSE');line=worker.stdout.readline(65537);need(line and len(line)<=65536,'BOUNDED_WORKER_RESPONSE');value=json.loads(line);need(value['state']in expected,'WORKER_HALTED_OR_UNEXPECTED_STAGE');return value
      def command(value,expected,seconds=60):
       need(worker.poll()is None,'ACTUAL_OWN_WORKER_ALIVE');gate['phase']=value['command'];worker.stdin.write(json.dumps(value)+'\n');worker.stdin.flush();return receive(expected,seconds)
      ready=receive({'REAL_GETUSER_CANONICAL_FOUR_CASE_READY'});need(H(ready['proof']['path'])==ready['proof']['sha256'],'GENUINE_MAIN_ACTOR_READY_PROOF');rt['actorReadyProof']=ready['proof'];anchor=native_fence(rt,m,'after-auth',H(wt));graph_delta(before,anchor[0],{'auth.users','auth.sessions','auth.mfa_amr_claims','auth.refresh_tokens','auth.audit_log_entries'});need([x for x in seq0 if x['schema']!='auth']==[x for x in anchor[1]if x['schema']!='auth'],'NONAUTH_ALL7_UNCHANGED_THROUGH_LOGIN')
      with mail.actual_four(m.save)as fixtures:
       session=read(ROOT/'own-auth-session.private.json');deadline=min(time.time()+780,min(x['startedAtEpoch']+840 for x in fixtures),T['storageIntegration']['notAfterEpoch']-120,C['authNotAfterEpoch']-60,session['expires_at']-120);need(time.time()+120<deadline,'REAL_REMAINING_BUNDLE_LEASE');gate.update(enabled=True,deadline=deadline,userAccessToken=session['access_token'])
       receiver_before=sem.receiver_before(rt);m.save(ROOT/'receiver-before.private.json',receiver_before)
       d={**read(T['cohortConfig']['path']),'state':'ACTUAL_OWNED_FOUR_CASE_CLONE_BOUND','database':DB,'actorId':ACTOR,'companyId':COMPANY,'cloneRestOrigin':'http://127.0.0.1:3168','storageOrigin':'http://127.0.0.1:3169','baselineNative':ref(ROOT/'native-before-fixture.private.json'),'mailTlsCA':C['mailTlsCA'],'transportFixtures':fixtures,'runtimeDeadlineEpoch':deadline,'receiverBefore':receiver_before,'unknownPartyBefore':pre['unknownPartyBefore']};m.save(ROOT/'clone-descriptor.private.json',d);command({'command':'bindClone','input':ref(ROOT/'clone-descriptor.private.json')},{'CLONE_BOUND_FOUR_CASE_NORMAL_EXPORTS_READY'})
       frame=pre_frame
       need(receiver_before['currentConflicts']==[],'FIXED_COHORT_ISSUE_ONLY_NO_OLD_REGISTRATION_MUTATION')
       issued=command({'command':'issueReceiver'},{'NORMAL_RECEIVER_ISSUE_RETURNED_NATIVE_ACK_REQUIRED'});n=sem.receiver_issued(rt,read(issued['result']['path']));m.save(ROOT/'receiver-issued.native.private.json',n);command({'command':'ackReceiverIssued','nativeInput':ref(ROOT/'receiver-issued.native.private.json')},{'ACTUAL_FRESH_RECEIVER_NATIVE_ACKED'})
       made=command({'command':'makeFourPayloads'},{'FOUR_FRESH_PHYSICAL_PAYLOADS_READY'});payloads=read(made['payloads']['path']);need(len(payloads)==4 and all(P(x['mime']['path']).stat().st_size<=65536 for x in payloads),'EXACT_FOUR_BOUNDED_SOURCE_MIMES')
       routed=command({'command':'createAckRoutes'},{'AUTHENTICATED_TEST_ROUTES_RETURNED_NATIVE_ACK_REQUIRED'});routes=sem.routes(rt,read(routed['result']['path']));m.save(ROOT/'routes.native.private.json',routes);command({'command':'ackRoutes','nativeInput':ref(ROOT/'routes.native.private.json')},{'THREE_IMMUTABLE_NATIVE_ACK_ROUTES_READY'})
       box=command({'command':'createMailbox'},{'MAILBOX_RETURNED_NATIVE_ACK_REQUIRED'});mid=box['mailboxId'];n=sem.capture(rt,mid);m.save(ROOT/'mailbox.native.private.json',n);command({'command':'ackMailbox','nativeInput':ref(ROOT/'mailbox.native.private.json')},{'MAILBOX_NATIVE_ACKED_READY_FOR_EXACT_FOUR_DEPOSITS'});frame=sem.phase_witness(rt,frame,'fixture',{'receiver':read(issued['result']['path']),'routes':read(routed['result']['path']),'mailboxId':mid},m.save,fullName='clone-after-fixture.private.json')
       physical=mail.deposit_four(rt,fixtures[0],payloads,T,m.save);m.save(ROOT/'four-physical-deposits.private.json',physical);command({'command':'pollFour','physicalDeposit':ref(ROOT/'four-physical-deposits.private.json')},{'POLL_RETURNED_FOUR_NATIVE_EMAIL_JOB_ACK_REQUIRED'})
       n=sem.capture(rt,mid);m.save(ROOT/'poll.native.private.json',n);command({'command':'ackPoll','nativeInput':ref(ROOT/'poll.native.private.json')},{'FOUR_OWN_EMAIL_JOBS_NATIVE_ACKED'});frame=sem.phase_witness(rt,frame,'poll',{'mailboxId':mid,'payloads':payloads},m.save,fullName='clone-after-poll.private.json')
       m.save(ROOT/'queue-before.native.private.json',sem.capture(rt,mid));command({'command':'processOwnFourJobs','nativeBefore':ref(ROOT/'queue-before.native.private.json')},{'NORMAL_FOUR_JOB_QUEUE_RETURNED_NATIVE_SOURCES_REQUIRED'},120)
       n=sem.sources(rt,mid,payloads);m.save(ROOT/'sources.native.private.json',n);command({'command':'ackInboundSources','nativeInput':ref(ROOT/'sources.native.private.json')},{'FOUR_ATTRIBUTED_SOURCES_AND_NATIVE_WRONG_PARTY_HOLD_ACKED'});fresh,rowmap=m.capture_after_queue_rowmap(rt,ROOT/'clone-after-poll.private.json');frame=sem.phase_witness(rt,frame,'sources',{'mailboxId':mid,'sources':n},m.save,snapshot=fresh)
       command({'command':'processTechnicalSources'},{'NORMAL_TECHNICAL_BATCH_RETURNED_THREE_CONTRL_NATIVE_ACK_REQUIRED'},180);n=sem.contrl(rt,mid,n,routes);m.save(ROOT/'contrl.native.private.json',n);command({'command':'ackThreeContrlOutboxes','nativeInput':ref(ROOT/'contrl.native.private.json')},{'THREE_IMMUTABLE_NORMAL_CONTRL_OUTBOXES_NATIVE_ACKED'});frame=sem.phase_witness(rt,frame,'contrl',{'mailboxId':mid,'contrl':n},m.save,fullName='clone-after-canonical.private.json')
       for i,case in enumerate(SMTP):
        actual=n['contrlCases'][i];rt['storage']['phases'].arm_case(case,COMPANY,[actual['message']['id']]);command({'command':'sendSmtpCase','caseName':case},{'NORMAL_SMTP_RETURNED_NATIVE_PHYSICAL_ARCHIVE_ACK_REQUIRED'},90);rt['storage']['phases'].finish_case();storage=rt['storage']['phases'].evidence();m.save(ROOT/(case+'.storage.safe.json'),storage);physical=mail.smtp_physical(fixtures[i+1],m.save);observed=sem.smtp(rt,case,actual,storage,physical,base);m.save(ROOT/(case+'.native.private.json'),observed);command({'command':'ackSmtpCase','caseName':case,'nativeInput':ref(ROOT/(case+'.native.private.json'))},{'SMTP_OBSERVED_NATIVE_POLICY_AND_PHYSICAL_RECEIPT','FOUR_CASE_OBSERVATIONS_REQUIRE_INDEPENDENT_ORACLE'});frame=sem.phase_witness(rt,frame,'smtp',{'mailboxId':mid,'case':observed},m.save,fullName='clone-after-'+case+'.private.json');results.append({'caseName':case,'native':ref(ROOT/(case+'.native.private.json')),'physical':ref(ROOT/(case+'.physical.private.json')),'normalPolicyMayFailOriginalCriterion':True})
      post=native_fence(rt,m,'postbusiness',H(wt));need(post[0]==anchor[0]and post[1]==anchor[1],'MAIN_WHOLE_ALL7_UNCHANGED_DURING_OWN_COHORT');command({'command':'cleanupSameSession','mainAfterCommands':ref(ROOT/'postbusiness.main-proof.safe.json'),'all7AfterCommands':ref(ROOT/'postbusiness.all7.safe.json')},{'HEADLESS_WORKER_RETURNED_NATIVE_FINAL_CLOSURE_REQUIRED'});worker.stdin.close();worker.wait(timeout=20);need(worker.returncode==0,'NORMAL_WORKER_EXIT_REQUIRED');final=native_fence(rt,m,'postlogout',H(wt));need(all(x==0 for x in final[2].values())and final[1]==anchor[1],'NATIVE_AUTH0_AFTER_GETUSER_ALL7_FINAL');delta=graph_delta(post[0],final[0],{'auth.sessions','auth.mfa_amr_claims','auth.refresh_tokens','auth.audit_log_entries'});m.save(ROOT/'four-original-observations.safe.json',{'state':'FOUR_ACTUAL_ORIGINAL_CASE_OBSERVATIONS_REQUIRE_INDEPENDENT_VERDICT','originalIds':T['originalIds'],'results':results,'MainOnlyExpectedLogoutDelta':delta,'noAutomaticCasePASSOrCounterUpdate':True})
     except BaseException as e:
      primary=type(e).__name__
      if worker and worker.poll()is None:
       try:
        native_fence(rt,m,'emergency-postbusiness',H(wt));worker.stdin.write(json.dumps({'command':'cleanupSameSession','mainAfterCommands':ref(ROOT/'emergency-postbusiness.main-proof.safe.json'),'all7AfterCommands':ref(ROOT/'emergency-postbusiness.all7.safe.json')})+'\n');worker.stdin.flush();worker.stdin.close();worker.wait(timeout=30)
       except BaseException:pass
      m.save(ROOT/'batch-stop.safe.json',{'state':'STOP_NO_BUSINESS_OR_TRANSPORT_RETRY','errorClass':primary,'mandatoryNativeReadbackAndClosure':True});raise
     finally:
      if worker and worker.poll()is None:
       need(os.getpgid(worker.pid)==worker.pid,'EXACT_OWN_WORKER_PGID_BEFORE_SIGNAL');os.killpg(worker.pid,signal.SIGTERM)
       try:worker.wait(timeout=10)
       except subprocess.TimeoutExpired:os.killpg(worker.pid,signal.SIGKILL);worker.wait(timeout=5)
      if stderr:stderr.close()
      if worker:m.save(ROOT/'worker-process-closed.safe.json',{'pid':worker.pid,'PGID':worker.pid,'exitCode':worker.returncode,'ownedProcessAbsent':worker.poll()is not None,'primaryError':primary})
      closure=native_fence(rt,m,'final-cleanup-check',H(wt));need(all(v==0 for v in closure[2].values()),'MANDATORY_FINAL_NATIVE_AUTH0');need(closure[1]==(anchor[1]if anchor else seq0),'MANDATORY_ALL7_ANCHOR');graph_delta(anchor[0]if anchor else before,closure[0],{'auth.sessions','auth.mfa_amr_claims','auth.refresh_tokens','auth.audit_log_entries'}if anchor else{'auth.users','auth.sessions','auth.mfa_amr_claims','auth.refresh_tokens','auth.audit_log_entries'})
   output({'state':'OWN_FOUR_COHORT_RUNTIME_CLOSED_TOPOLOGY_RESTORATION_NEXT','root':str(ROOT)})
 except BaseException as e:
  outer_error=type(e).__name__;raise
 finally:
  if rt is not None:
   try:
    final=native_fence(rt,m,'post-topology-restoration',H(wt)if wt and wt.exists()else None);need(all(x==0 for x in final[2].values()),'POST_TOPOLOGY_NATIVE_AUTH0')
    if anchor:
     need(final[1]==anchor[1],'POST_TOPOLOGY_ALL7_AFTER_GETUSER_EXACT');graph_delta(anchor[0],final[0],{'auth.sessions','auth.mfa_amr_claims','auth.refresh_tokens','auth.audit_log_entries'})
    else:
     entry=m.read(ROOT/'main-before-setup.all7.safe.json');need([x for x in final[1]if x['schema']!='auth']==[x for x in entry if x['schema']!='auth'],'POST_TOPOLOGY_NONAUTH_SEQUENCES_WITHOUT_GETUSER_ANCHOR');graph_delta(rt['mainBeforeSetup'],final[0],{'auth.users','auth.sessions','auth.mfa_amr_claims','auth.refresh_tokens','auth.audit_log_entries'})
    m.save(ROOT/'post-topology-closure.safe.json',{'state':'FRESH_POST_TOPOLOGY_MAIN_AUTH0_RESIDUAL_CAPTURED','afterGetUserAnchorExists':anchor is not None,'all7AfterGetUserExact':bool(anchor),'originalErrorClassPreserved':outer_error,'noRetrospectiveCaseOrIndependentCaptureClaim':True});output({'state':'FOUR_COHORT_TOPOLOGY_RETURNED_INDEPENDENT_VERDICTS_REQUIRED','root':str(ROOT)})
   except BaseException as e:
    m.save(ROOT/'post-topology-closure.UNKNOWN.safe.json',{'errorClass':type(e).__name__,'originalErrorClass':outer_error,'properClosureNotClaimed':True})
    if outer_error is None:raise

if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--target',required=True);a.add_argument('--go',required=True);a.add_argument('--execute',action='store_true');v=a.parse_args();need(v.execute,'EXPLICIT_EXECUTION_REQUIRED');run(v.target,v.go)
