'use strict';
// Fixed genuine API admin -> unchanged normal mailbox bootstrap/poll/queue adapter.
// No Next server, SQL, browser, positive EDIEL admission or background engine.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),readline=require('node:readline');
const ROOT='/tmp/gridex-ediel-four-case-actual-20261116-b',AUTH='http://127.0.0.1:55321',REST='http://127.0.0.1:3168',DB='gridex_local_partner_http_20261113_a';
const ACTOR='ee029de5-22a8-4916-9c36-388d13f19cb1',COMPANY='b36f6a30-18cd-4a70-8652-5b2da9b4eb64';
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),need=(v,m)=>{if(!v)throw Error(m)},uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
function bytes(r,own=false){need(r&&/^[a-f0-9]{64}$/.test(r.sha256),'HASH_REF');const f=path.resolve(r.path),s=fs.lstatSync(f);need(f===r.path&&fs.realpathSync(f)===f&&s.isFile()&&!s.isSymbolicLink()&&s.size<=8*1024*1024,'BOUNDED_REAL_FILE');if(own)need(f.startsWith(ROOT+'/')&&(s.mode&511)===384,'OWN_MODE600_INPUT');const b=fs.readFileSync(f);need(H(b)===r.sha256,'INPUT_DRIFT');return b}
const read=(r,own=false)=>JSON.parse(bytes(r,own));
function save(n,v){need(/^[a-z0-9.-]+$/.test(n),'CLOSED_OUTPUT');const f=ROOT+'/'+n,fd=fs.openSync(f,'wx',384);try{fs.writeFileSync(fd,JSON.stringify(v,null,2)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}return{path:f,sha256:H(fs.readFileSync(f))}}
const output=v=>process.stdout.write(JSON.stringify(v)+'\n');
const MAILBOX_NAME='Gridex shared test Ediel',WORKER='ediel-four-owned-20261116-a';
const COMMANDS=require('./four-case-commands.v3.cjs'),BOUNDARY=require('./four-case-fetch.v2.cjs');
const canon=v=>JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(canon(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canon(v[k]))])):v);
async function main(){
 need(process.argv.length===3&&process.argv[2]===ROOT+'/target.BOUND.private.json','FIXED_NEW_TARGET');
 const raw=fs.readFileSync(process.argv[2]),C=read({path:process.argv[2],sha256:H(raw)},true),targetSHA256=H(raw);
 need(C.state==='BOUND_HEADLESS_ORIGINAL_EDIEL_FOUR_CASES'&&C.executeAgent==='execute_eight_parts'&&C.authOrigin===AUTH&&C.cloneRestOrigin===REST&&C.cloneDatabase===DB,'UNARMED_NO_AUTH');
 need(C.actorId===ACTOR&&C.companyId===COMPANY&&C.sessionBudgetSeconds===1800&&C.commandReserveSeconds===60,'FIXED_PRINCIPAL_AND_FINITE_WINDOW');
 for(const r of C.boundFiles)bytes(r);read(C.sourceFreeze);read(C.mainBeforeAuth,true);read(C.all7BeforeAuth,true);const pre=read(C.nativePrerequisites,true);
 need(pre.database===DB&&pre.functionCount===3443&&pre.queueRows===0&&pre.queueRowsFull?.length===0&&pre.claimBodyMD5==='63dde69fa26d48381b510aa2837a5627','DECLARED_PRISTINE_QUEUE_3443_REQUIRED');
 bytes(C.mailTlsCA);need(process.env.NODE_EXTRA_CA_CERTS===C.mailTlsCA.path&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&process.env.GRIDEX_IMAP_ALLOW_PLAINTEXT_LOOPBACK!=='true','REAL_TLS_CA_NO_INSECURE_OVERRIDE');
 const goPath=ROOT+'/GO.actual.safe.json',G=read({path:goPath,sha256:H(fs.readFileSync(goPath))},true),workerSHA256=H(fs.readFileSync(__filename));
 need(G.rootArmed===true&&G.executeAgent==='execute_eight_parts'&&G.targetSHA256===targetSHA256&&G.workerSHA256===workerSHA256,'EXACT_SEPARATE_GO');
 need(G.scopeReviews.length===2&&G.scopeReviews.some(r=>r.reviewerAgent==='/root/execute_eight_parts')&&G.scopeReviews.some(r=>['/root','/root/qa_remaining_checks','/root/ediel_test_identity'].includes(r.reviewerAgent)),'TWO_REAL_ACTUAL_SCOPE_REVIEWS');
 for(const r of G.scopeReviews){const a=read(r);need(a.verdict==='EXECUTION_SCOPE_APPROVE'&&a.reviewerAgent===r.reviewerAgent&&a.targetSHA256===targetSHA256&&a.workerSHA256===workerSHA256&&a.sourceSHA256===C.sourceFreeze.sha256,'ACTUAL_SCOPE_MATCH')}
 need(Date.now()<C.authNotAfterEpoch*1000&&C.authNotAfterEpoch*1000<=Date.now()+1800000,'FRESH_FINITE_AUTH_WINDOW');
 const actor=read(C.actorCredential),keys=read(C.serverKeys);need(actor.id===ACTOR,'ACTUAL_OPERATOR_CREDENTIAL');
 const realFetch=globalThis.fetch;let cleanupOnly=false,passwordSpent=false,logoutSpent=false,principalReady=false,descriptor=null,modules=null,deadline=C.authNotAfterEpoch,halted=false,ownSession=false,input,timer,phase='READY';const ctx={phase:'READY',root:ROOT,targetSHA256,descriptor:null,modules:null,deadline,halted:false,spent:new Set(),mailbox:null,emails:[],jobs:[],sources:[],outboxes:[],authClient:null,authAccessToken:null};
 const assertWindow=()=>need(!cleanupOnly&&Date.now()+60000<deadline*1000,'COMMAND_WINDOW_ELAPSED');
 const armTimer=()=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>{try{save('window-stop.safe.json',{targetSHA256,noRetry:true})}catch{}finally{if(input)input.close();process.stdin.pause()}},Math.max(0,deadline*1000-Date.now()-60000))};
 globalThis.fetch=async(i,init)=>{
  const req=new Request(i,init),u=new URL(req.url),m=req.method.toUpperCase();need([AUTH,REST].includes(u.origin)&&!u.hash,'FIXED_AUTH_OR_OWN_CLONE');
  const login=u.origin===AUTH&&m==='POST'&&u.pathname==='/auth/v1/token'&&u.search==='?grant_type=password',user=u.origin===AUTH&&m==='GET'&&u.pathname==='/auth/v1/user'&&!u.search,logout=u.origin===AUTH&&m==='POST'&&u.pathname==='/auth/v1/logout'&&u.search==='?scope=local';
  if(login){need(!cleanupOnly&&!passwordSpent,'ONE_NORMAL_LOGIN');passwordSpent=true}if(logout){need(!logoutSpent,'ONE_LOCAL_LOGOUT');logoutSpent=true}
  if(login||user||logout){if(!cleanupOnly)need(Date.now()<deadline*1000,'AUTH_WINDOW');return realFetch(req,{redirect:'error',signal:AbortSignal.timeout(15000)})}
  assertWindow();need(principalReady,'GETUSER_BEFORE_NATIVE');
  const rpc=m==='POST'&&u.pathname.startsWith('/rest/v1/rpc/')&&!u.search?u.pathname.slice(13):null;
  if(rpc==='canonical_authenticated_tenant_context'){need(u.origin===AUTH,'CANONICAL_MAIN_ONLY');const b=JSON.parse(await req.clone().text());need(b.p_selected_company_id===COMPANY,'EXPLICIT_NORMAL_COMPANY_SELECTION');return realFetch(req,{redirect:'error',signal:AbortSignal.timeout(15000)})}
  return BOUNDARY.handle(req,{ctx,keys,realFetch,assertWindow});
 };
 const {createClient}=require('/tmp/gridex-scenario-source-442256/node_modules/@supabase/supabase-js'),client=createClient(AUTH,keys.anonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const principal=async()=>{const u=await client.auth.getUser();need(!u.error&&u.data.user?.id===ACTOR,'GENUINE_GETUSER');principalReady=true;const r=await client.rpc('canonical_authenticated_tenant_context',{p_selected_company_id:COMPANY});need(!r.error&&r.data?.authorized===true&&r.data?.access_invariant_ok===true&&r.data?.user_id===ACTOR&&r.data?.is_platform_admin===true&&r.data?.selected_company_id===COMPANY,'GENUINE_CANONICAL_MAIN_COMPANY');return{user:u.data.user,data:r.data}};
 try{
  save('login.intent.safe.json',{targetSHA256,normalPasswordGrant:true,noRetry:true});const a=await client.auth.signInWithPassword({email:actor.email,password:actor.password});ownSession=!!a.data.session;need(!a.error&&ownSession&&a.data.user?.id===ACTOR,'NORMAL_PASSWORD_GRANT');
  const claims=JSON.parse(Buffer.from(a.data.session.access_token.split('.')[1],'base64url').toString('utf8'));need(claims.sub===ACTOR&&claims.role==='authenticated'&&typeof claims.session_id==='string'&&claims.exp>C.authNotAfterEpoch+120,'REAL_SESSION_JWT_COVERS_WINDOW');
  const p=await principal(),getUser=save('genuine-getuser.private.json',{user:p.user,error:null}),canonicalAccess=save('canonical-access.private.json',{data:p.data,error:null}),privateSession=save('own-auth-session.private.json',{user_id:ACTOR,session_id:claims.session_id,access_token:a.data.session.access_token,expires_at:claims.exp});
  const ready=save('genuine-actor-ready.safe.json',{state:'GENUINE_HEADLESS_FOUR_CASE_ACTOR_READY',actorId:ACTOR,companyId:COMPANY,sessionExpiresAtEpochSeconds:claims.exp,authNotAfterEpochSeconds:C.authNotAfterEpoch,getUser,canonicalAccess,privateSession,workerSHA256,targetSHA256});output({state:'REAL_GETUSER_CANONICAL_FOUR_CASE_READY',proof:ready});
  ctx.authClient=client;ctx.authAccessToken=a.data.session.access_token;ctx.claims=claims;ctx.keys=keys;
  input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});armTimer();
  for await(const line of input){need(line.length<=65536,'BOUNDED_IPC');const q=JSON.parse(line);
   if(q.command==='cleanupSameSession'){const a=read(q.mainAfterCommands,true),b=read(q.all7AfterCommands,true);need(a.targetSHA256===targetSHA256&&b.targetSHA256===targetSHA256,'POSTBUSINESS_MAIN_ALL7_BEFORE_LOGOUT');break}
   need(!halted,'HALTED_CLEANUP_ONLY');
   try{
    assertWindow();await principal();
    await COMMANDS.run(q,{ctx,C,pre,ROOT,ACTOR,COMPANY,DB,REST,WORKER,bytes,read,save,output,need,uuid,canon,principal});
    if(ctx.deadline!==deadline){deadline=ctx.deadline;armTimer()}

   }catch(e){halted=true;save('halt.unknown.safe.json',{targetSHA256,errorClass:e?.name??'Error',safeguardName:typeof e?.message==='string'&&/^[A-Z0-9_]{1,160}$/.test(e.message)?e.message:'NORMAL_MODULE_OR_TRANSPORT_ERROR_REQUIRES_NATIVE_READBACK',phase:ctx.phase,noRetry:true,nativeReadbackRequired:true});output({state:'HALTED_UNKNOWN_CLEANUP_ONLY'})}
  }
 }finally{
  if(timer)clearTimeout(timer);if(input)input.close();cleanupOnly=true;
  if(ownSession){try{save('logout.intent.safe.json',{targetSHA256,oneGetUserThenLocalLogout:true})}catch{}try{const u=await client.auth.getUser();need(!u.error&&u.data.user?.id===ACTOR,'OWN_GETUSER_BEFORE_LOGOUT');const r=await client.auth.signOut({scope:'local'});need(!r.error,'LOCAL_LOGOUT_UNKNOWN');save('logout.return.safe.json',{targetSHA256,normalAPILocalLogoutReturned:true,nativeAuth0StillRequired:true})}catch(e){try{save('logout.unknown.safe.json',{targetSHA256,errorClass:e?.name??'Error',noRetry:true,nativeAuth0Required:true})}catch{}}}
  globalThis.fetch=realFetch;
 }
 output({state:'HEADLESS_WORKER_RETURNED_NATIVE_FINAL_CLOSURE_REQUIRED',fourCasePhaseComplete:ctx.phase==='COMPLETE',fullOriginalCaseCredit:0});
}
if(require.main===module)main().catch(e=>{process.stderr.write(JSON.stringify({state:'HEADLESS_FOUR_CASE_WORKER_STOPPED',errorClass:e?.name??'Error'})+'\n');process.exitCode=1});
