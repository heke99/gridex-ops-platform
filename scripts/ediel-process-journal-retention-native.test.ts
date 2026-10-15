import {type SupabaseClient} from '@supabase/supabase-js'
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const ports=vi.hoisted(()=>({smtp:vi.fn(),client:null as SupabaseClient|null,company:''}))
vi.mock('server-only',()=>({}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:ports.smtp})}}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>{if(!ports.client)throw Error('actual_native_jwt_client_required');return ports.client}}))
vi.mock('next/headers',()=>({cookies:async()=>({get:()=>({value:ports.company})})}))
import {supabaseService} from '@/lib/supabase/service'
import {nativeSql as sql,literal,seedNormalSwitchNativeFixture} from './helpers/ediel-normal-switch-native-fixture'
import {createCustomerRecordRetentionNativeUser} from './helpers/ediel-customer-record-retention-native-fixture'
import {mixedProdatNativeWire} from './helpers/ediel-mixed-prodat-native-wire'
import {PROCESS_JOURNAL_RETENTION_CLASSES,type ProcessJournalRetentionClass} from '@/lib/ediel/retention/processJournalRetention'
import {POST} from '@/app/api/ediel/process-journal-retention/route'
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
afterEach(()=>{vi.unstubAllEnvs();ports.smtp.mockReset();ports.client=null;ports.company=''})
async function http(client:SupabaseClient,body:unknown){ports.client=client;return POST(new NextRequest('http://localhost/api/ediel/process-journal-retention',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}))}
async function fixture(){
 for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v)
 const f=await seedNormalSwitchNativeFixture({provider:email=>ports.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'})})
 const common=['ediel.retention.read','ediel.retention.legal_history'],writer=await createCustomerRecordRetentionNativeUser(f.companyId,[...common,'ediel.retention.submit','ediel.retention.review','ediel.retention.purge']),reviewer=await createCustomerRecordRetentionNativeUser(f.companyId,[...common,'ediel.retention.review']),readonly=await createCustomerRecordRetentionNativeUser(f.companyId,common)
 const fact=sql<{id:string;hash:string}>(`SELECT jsonb_build_object('id',id::text,'hash',facts_hash) FROM gridex_correction_process.facts WHERE company_id=${literal(f.companyId)} AND table_name='customer_contracts' AND row_id=${literal(f.contractId)} ORDER BY id DESC LIMIT 1`)
 expect(fact.id).toMatch(/^\d+$/);expect(fact.hash).toMatch(/^[a-f0-9]{64}$/)
 const visibility=sql<{witnessId:string;factsHash:string;authority:string}>(`SET ROLE service_role;SELECT public.gridex_witness_correction_process_fact_v1(${literal(f.companyId)},${fact.id},${literal(fact.hash)},${literal(f.actorUserId)})`)
 expect(visibility.factsHash).toBe(fact.hash);expect(visibility.authority).toBe('none')
 // The real installed owner captures and serializes its own process population.
 const readset=sql<{snapshotId:string;readsetHash:string;readsetText:string}>(`SET ROLE service_role;SELECT public.gridex_open_correction_process_readset_v1(${literal(f.companyId)},'test',${literal(f.actorUserId)},clock_timestamp(),${literal(f.customerId)},NULL,NULL)`)
 expect(createHash('sha256').update(readset.readsetText).digest('hex')).toBe(readset.readsetHash);expect(JSON.parse(readset.readsetText)).toMatchObject({complete:false,authority:'none'})
 // Received raw original uses genuine own physical tenant/point facts. There
 // is no canonical/accepted/business-source seed or market effect: E035 reader
 // remains a hold-only prospective snapshot even for unqualified originals.
 let raw=mixedProdatNativeWire({external:f.external,sender:f.sender,receiver:f.receiver,customerIdentity:f.customerIdentity,caseReference:f.caseReference,startMinute:f.requestedStartDate.replaceAll('-','')+'0000',negativePoint:'735999123456789019'})
 raw=raw.replace(/UNB\+[^']*'/,segment=>{const parts=segment.slice(0,-1).split('+');while(parts.length<12)parts.push('');parts[9]='1';parts[11]='1';return parts.join('+')+"'"})
 const sourceId=randomUUID()
 sql(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,customer_id,site_id,metering_point_id,message_received_at,sender_ediel_id,receiver_ediel_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot) SELECT ${literal(sourceId)},${literal(f.companyId)},'test','inbound','edifact','PRODAT','Z04','received',${literal(raw)},${literal(f.customerId)},${literal(f.siteId)},${literal(f.pointId)},clock_timestamp(),${literal(f.receiver)},${literal(f.sender)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key='PRODAT:Z04:L:26.A:r3' AND profile.is_enabled`)
 const combined=sql<{snapshotId:string;readsetHash:string;readsetText:string}>(`SET ROLE service_role;SELECT public.gridex_correction_combined_snapshot_v1(${literal(f.companyId)},'test',${literal(sourceId)},clock_timestamp())`)
 expect(createHash('sha256').update(combined.readsetText).digest('hex')).toBe(combined.readsetHash)
 const targets:Record<ProcessJournalRetentionClass,string>={correction_process_fact_body:fact.id,correction_process_readset_body:readset.snapshotId,correction_process_combined_readset_body:combined.snapshotId}
 // Explicit test-only external legal competence and customer closure boundaries.
 // No runtime issuer/default policy or business source approval is manufactured.
 const issuer=randomUUID(),key=Buffer.from(randomUUID()+randomUUID())
 sql(`INSERT INTO gridex_ediel_retention.issuers(id,company_id,legal_reference,legal_evidence,legal_hash,signing_key,valid_from,valid_to) VALUES(${literal(issuer)},${literal(f.companyId)},'SYNTHETIC JOURNAL COMPETENCE ONLY',decode('53594e544845544943','hex'),encode(sha256(decode('53594e544845544943','hex')),'hex'),decode(${literal(key.toString('hex'))},'hex'),now()-interval '1 day',now()+interval '1 day');UPDATE public.customers SET status='archived' WHERE company_id=${literal(f.companyId)}`)
 ports.company=f.companyId
 const policy=async(k:ProcessJournalRetentionClass,document:Buffer,extra:Record<string,unknown>={})=>{
  const response=await http(writer.client,{action:'basis',retentionClass:k,targetId:targets[k]});expect(response.status,await response.clone().text()).toBe(200);const basis=await response.json()
  const payload=Buffer.from(JSON.stringify({format:'ediel_process_journal_retention_policy_v1',...basis,operation:({correction_process_fact_body:'redact_process_fact_body',correction_process_readset_body:'redact_process_readset_body',correction_process_combined_readset_body:'redact_process_combined_readset_body'})[k],companyId:f.companyId,documentHash:digest(document),issuerLegalReference:'SYNTHETIC JOURNAL COMPETENCE ONLY',legalBasisReference:'SYNTHETIC only exact process copy deadline',journalPurposeReference:'SYNTHETIC finite hash and identity purpose',accessRevocationRequired:true,issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),retainUntil:new Date(Date.now()-1000).toISOString(),journalRetainUntil:new Date(Date.now()+3600000).toISOString(),...extra}))
  return {issuerId:issuer,payloadBase64:payload.toString('base64'),signatureHex:createHmac('sha256',key).update(payload).digest('hex')}
 }
 return {...f,writer,reviewer,readonly,targets,policy,visibility}
}
it('actual publication/signature/PDF/POA/native SMTP and prospective process/readset/combined owners feed three independent class decisions through real GoTrue/scoped HTTP; all hashes and immutable metadata survive only their own qualified redaction',async()=>{
 const f=await fixture()
 for(const k of PROCESS_JOURNAL_RETENTION_CLASSES){
  const document=Buffer.from('SYNTHETIC distinct exact '+k),submitted=await http(f.writer.client,{action:'submit',retentionClass:k,targetId:f.targets[k],documentBase64:document.toString('base64'),issuerReceipt:await f.policy(k,document)});expect(submitted.status,await submitted.clone().text()).toBe(200);const decision=await submitted.json();expect(decision.issuerQualified).toBe(true)
  const read=await http(f.readonly.client,{action:'read',decisionId:decision.decisionId});expect(read.status).toBe(200);expect(Buffer.from((await read.json()).documentBase64,'base64')).toEqual(document)
  expect((await http(f.writer.client,{action:'review',decisionId:decision.decisionId,outcome:'approve',reason:'same actor forbidden'})).status).toBe(403)
  const reviewed=await http(f.reviewer.client,{action:'review',decisionId:decision.decisionId,outcome:'approve',reason:'SYNTHETIC separate exact source mechanism'});expect(reviewed.status,await reviewed.clone().text()).toBe(200);expect((await reviewed.json()).status).toBe('approved')
  const sourceTable=k==='correction_process_fact_body'?'facts':k==='correction_process_readset_body'?'readsets':'combined_snapshots',nativeTarget=k==='correction_process_fact_body'?f.targets[k]:literal(f.targets[k]),before=sql<Record<string,unknown>>(`SELECT to_jsonb(r) FROM gridex_correction_process.${sourceTable} r WHERE id=${nativeTarget}`)
  const result=await http(f.writer.client,{action:'purge',decisionId:decision.decisionId});expect(result.status,await result.clone().text()).toBe(200);expect(await result.json()).toMatchObject({status:'redacted',retentionClass:k,targetId:f.targets[k],sourceHash:decision.sourceHash,replay:false});expect((await (await http(f.writer.client,{action:'purge',decisionId:decision.decisionId})).json()).replay).toBe(true)
  const spec=sql<{table:string}>(`SELECT jsonb_build_object('table',source_table) FROM gridex_ediel_retention.process_class_catalog WHERE retention_class=${literal(k)}`),row=sql<Record<string,unknown>>(`SELECT to_jsonb(r) FROM gridex_correction_process.${spec.table} r WHERE id=${k==='correction_process_fact_body'?f.targets[k]:literal(f.targets[k])}`),body=k==='correction_process_fact_body'?row.new_fact:JSON.parse(String(row.readset_text))
  const immutable=(entry:Record<string,unknown>)=>Object.fromEntries(Object.entries(entry).filter(([key])=>k==='correction_process_fact_body'?!['old_fact','new_fact'].includes(key):key!=='readset_text'))
  expect(immutable(row)).toEqual(immutable(before))
  if(k==='correction_process_fact_body'){
   const past=sql<{witnessId:string;retentionUnavailable:boolean;bytesAvailable:boolean;authority:string}>(`SET ROLE service_role;SELECT public.gridex_witness_correction_process_fact_v1(${literal(f.companyId)},${f.targets[k]},${literal(decision.sourceHash)},${literal(f.actorUserId)})`);expect(past).toMatchObject({witnessId:f.visibility.witnessId,retentionUnavailable:true,bytesAvailable:false,authority:'none'})
   expect(()=>sql(`INSERT INTO gridex_correction_process.witnesses(fact_id,company_id,facts_hash) VALUES(${f.targets[k]},${literal(f.companyId)},${literal(decision.sourceHash)})`)).toThrow(/tombstoned/)
  }
  expect(body).toEqual({retentionUnavailable:true,sourceHash:decision.sourceHash,complete:false,authority:'none'});expect(k==='correction_process_fact_body'?row.facts_hash:row.readset_hash).toBe(decision.sourceHash)
  const held=await supabaseService.rpc('ediel_require_process_journal_available_v1',{p_company_id:f.companyId,p_retention_class:k,p_target_id:f.targets[k]});expect(held.error?.message).toContain('tombstoned')
 }
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.process_tombstones WHERE company_id=${literal(f.companyId)}`)).toBe(3)
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.process_events e JOIN gridex_ediel_retention.process_tombstones t USING(retention_class,target_id) WHERE t.company_id=${literal(f.companyId)}`)).toBe(3)
},180000)
it('actual all-included customer scope, current reviewer DENY, hostile company/actor, no issuer and late native audit failure hold the unchanged copies with no partial tombstone or provider side effect',async()=>{
 const f=await fixture(),k='correction_process_combined_readset_body',document=Buffer.from('SYNTHETIC whole-scope-only')
 const missing=await http(f.writer.client,{action:'submit',retentionClass:k,targetId:f.targets[k],documentBase64:Buffer.from('SYNTHETIC whole-scope-only without issuer').toString('base64'),issuerReceipt:null});expect((await missing.json()).issuerQualified).toBe(false)
 expect((await http(f.readonly.client,{action:'purge',decisionId:randomUUID()})).status).toBe(403);expect((await http(f.writer.client,{action:'basis',retentionClass:k,targetId:f.targets[k],companyId:randomUUID()})).status).toBe(400)
 const created=await http(f.writer.client,{action:'submit',retentionClass:k,targetId:f.targets[k],documentBase64:document.toString('base64'),issuerReceipt:await f.policy(k,document)}),decision=(await created.json()).decisionId
 // Actual newly committed independent open scope changes the qualified native
 // company's complete scope hash; no caller closure boolean can suppress it.
 const customer=randomUUID();sql(`INSERT INTO public.customers(id,company_id,customer_number,status,first_name,last_name) VALUES(${literal(customer)},${literal(f.companyId)},${literal('J-'+randomUUID())},'active','Synthetic','Journal scope')`)
 const held=await http(f.reviewer.client,{action:'review',decisionId:decision,outcome:'approve',reason:'SYNTHETIC active included scope'});expect(held.status).toBe(409)
 sql(`UPDATE public.customers SET status='archived' WHERE id=${literal(customer)}`)
 const doc2=Buffer.from('SYNTHETIC changed native scope needs new exact policy'),next=await http(f.writer.client,{action:'submit',retentionClass:k,targetId:f.targets[k],documentBase64:doc2.toString('base64'),issuerReceipt:await f.policy(k,doc2)}),id=(await next.json()).decisionId;expect((await http(f.reviewer.client,{action:'review',decisionId:id,outcome:'approve',reason:'SYNTHETIC now exact closed native scope'})).status).toBe(200)
 sql(`INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active) VALUES(${literal(f.reviewer.id)},${literal(f.companyId)},'ediel.retention.legal_history','deny',true)`);expect((await http(f.writer.client,{action:'purge',decisionId:id})).status).toBe(409);sql(`DELETE FROM public.user_permission_overrides WHERE user_id=${literal(f.reviewer.id)} AND company_id=${literal(f.companyId)}`)
 const trigger='journal_late_'+randomUUID().replaceAll('-','');sql(`CREATE FUNCTION public.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.company_id=${literal(f.companyId)}::uuid AND NEW.action='ediel.retention.process_redacted' THEN RAISE EXCEPTION 'native late journal audit rollback';END IF;RETURN NEW;END$$;CREATE TRIGGER ${trigger} BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.${trigger}()`)
 try{expect((await http(f.writer.client,{action:'purge',decisionId:id})).status).toBe(403);expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.process_tombstones WHERE company_id=${literal(f.companyId)}`)).toBe(0);expect((await http(f.writer.client,{action:'basis',retentionClass:k,targetId:f.targets[k]})).status).toBe(200)}finally{sql(`DROP TRIGGER ${trigger} ON public.audit_logs;DROP FUNCTION public.${trigger}()`)}
 expect(ports.smtp).toHaveBeenCalledTimes(1)
 for(const role of ['anon','authenticated','service_role'])expect(()=>sql(`SET ROLE ${role};SELECT * FROM gridex_ediel_retention.process_decisions`)).toThrow(/permission denied/)
},180000)


// DB05 PUBLIC post-last-wait controls. PREPARED SOURCE ONLY; no legal or
// runtime approval follows from these synthetic local fixtures.
import {spawn as db05Spawn} from 'node:child_process'
import {createHmac as db05Hmac} from 'node:crypto'
const db05Delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))

function db05Holder(statement:string){
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('db05_owned_local_only')
 const child=db05Spawn('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']})
 let stdout='',stderr='',acquired=false
 let resolveReady:(pid:number)=>void=()=>{},rejectReady:(error:Error)=>void=()=>{}
 const ready=new Promise<number>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject})
 const timer=setTimeout(()=>{child.kill('SIGTERM');rejectReady(Error('db05_lock_not_observed'))},8000)
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8')
 child.stdout.on('data',(data:string)=>{stdout+=data;const marker=/DB05_PUBLIC_HELD:(\d+)/.exec(stdout);if(!acquired&&marker){acquired=true;clearTimeout(timer);resolveReady(Number(marker[1]))}})
 child.stderr.on('data',(data:string)=>{stderr+=data})
 const done=new Promise<void>((resolve,reject)=>{
  child.on('error',(error:Error)=>{clearTimeout(timer);rejectReady(error);reject(error)})
  child.on('close',(code:number|null)=>{clearTimeout(timer);if(!acquired)rejectReady(Error('db05_holder_closed_before_marker'));if(code===0)resolve();else reject(Error('db05_holder_failed:'+String(code)+':'+stderr))})
 })
 // Retain the rejection for awaited cleanup without an unhandled promise.
 void done.catch(()=>{})
 child.stdin.write(`BEGIN;SET LOCAL lock_timeout='8s';${statement};SELECT 'DB05_PUBLIC_HELD:'||pg_backend_pid();\n`)
 return {ready,done,release:()=>{if(!child.stdin.writableEnded)child.stdin.end('ROLLBACK;\n')}}
}

async function db05ObserveWait(holderPid:number,deadline:string){
 let observed:{started:string;observed:string}|null=null
 for(let attempt=0;attempt<40;attempt++){
  observed=sql<{started:string;observed:string}|null>(`SELECT (SELECT to_jsonb(x) FROM (
   SELECT xact_start AS started,clock_timestamp() AS observed FROM pg_stat_activity
   WHERE state='active' AND wait_event_type='Lock' AND ${holderPid}=ANY(pg_blocking_pids(pid))
    AND query LIKE '%ediel_purge_process_journal_retention_v1%' LIMIT 1) x)`)
  if(observed)break
  await db05Delay(50)
 }
 expect(observed,'actual request must wait on the exact held PostgreSQL backend PID').not.toBeNull()
 expect(Date.parse(observed!.started)).toBeLessThan(Date.parse(deadline))
 expect(Date.parse(observed!.observed)).toBeLessThan(Date.parse(deadline))
 for(let attempt=0;attempt<200;attempt++){
  const remaining=sql<number>(`SELECT to_jsonb(extract(epoch FROM (${literal(deadline)}::timestamptz-clock_timestamp()))*1000)`)
  if(remaining<=0)break
  await db05Delay(Math.min(remaining+10,50))
 }
 expect(sql<boolean>(`SELECT to_jsonb(clock_timestamp()>=${literal(deadline)}::timestamptz)`)).toBe(true)
}

function db05PortalPremises(f:Awaited<ReturnType<typeof fixture>>){
 sql(`INSERT INTO public.customer_portal_accounts(id,company_id,customer_id,user_id,status,is_active,email) VALUES(${literal(randomUUID())},${literal(f.companyId)},${literal(f.customerId)},${literal(f.writer.id)},'active',true,'synthetic-db05@example.invalid');
  INSERT INTO public.customer_portal_claims(id,company_id,customer_id,user_id,status,token_hash) VALUES(${literal(randomUUID())},${literal(f.companyId)},${literal(f.customerId)},${literal(f.writer.id)},'active',${literal(randomUUID())})`)
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_portal_accounts WHERE company_id=${literal(f.companyId)} AND customer_id=${literal(f.customerId)} AND status='active' AND is_active`)).toBeGreaterThan(0)
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_portal_claims WHERE company_id=${literal(f.companyId)} AND customer_id=${literal(f.customerId)} AND status='active'`)).toBeGreaterThan(0)
}

function db05State(f:Awaited<ReturnType<typeof fixture>>){
 return {providerCalls:ports.smtp.mock.calls.length,database:sql<Record<string,unknown>>(`SELECT jsonb_build_object(
  'source',(SELECT to_jsonb(x) FROM gridex_correction_process.facts x WHERE id=${literal(f.targets['correction_process_fact_body'])}),
  'customers',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb) FROM public.customers x WHERE company_id=${literal(f.companyId)}),
  'portals',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb) FROM public.customer_portal_accounts x WHERE company_id=${literal(f.companyId)}),
  'claims',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb) FROM public.customer_portal_claims x WHERE company_id=${literal(f.companyId)}),
  'decisions',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb) FROM gridex_ediel_retention.process_decisions x WHERE company_id=${literal(f.companyId)}),
  'reviews',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM gridex_ediel_retention.process_reviews x JOIN gridex_ediel_retention.process_decisions d ON d.id=x.decision_id WHERE d.company_id=${literal(f.companyId)}),
  'tombstones',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY target_id),'[]'::jsonb) FROM gridex_ediel_retention.process_tombstones x WHERE company_id=${literal(f.companyId)}),
  'events',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM gridex_ediel_retention.process_events x WHERE EXISTS(SELECT FROM gridex_ediel_retention.process_decisions d WHERE d.company_id=${literal(f.companyId)} AND d.retention_class=x.retention_class AND d.target_id=x.target_id)),
  'audits',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb) FROM public.audit_logs x WHERE company_id=${literal(f.companyId)}))`)}
}

for(const field of ['issuedAt','expiresAt','retainUntil','journalRetainUntil'] as const){
 it(`DB05 process valid-HMAC ${field} missing/NULL/nonfinite fails closed without partial source/portal effects`,async()=>{
  const f=await fixture(),k='correction_process_fact_body'
  db05PortalPremises(f) // Ordinary nonempty premises precede every basis/policy.
  for(const value of [undefined,null,'infinity']){
   const document=Buffer.from('SYNTHETIC DB05 '+field+':'+String(value)),receipt=await f.policy(k,document,{[field]:value})
   const submitted=await http(f.writer.client,{action:'submit',retentionClass:k,targetId:f.targets[k],documentBase64:document.toString('base64'),issuerReceipt:receipt})
   expect(submitted.status,await submitted.clone().text()).toBe(200)
   const decision=await submitted.json();expect(decision.issuerQualified).toBe(false)
   expect((await http(f.reviewer.client,{action:'review',decisionId:decision.decisionId,outcome:'approve',reason:'SYNTHETIC NULL must hold'})).status).toBe(409)
   const before=db05State(f)
   expect((await http(f.writer.client,{action:'purge',decisionId:decision.decisionId})).status).toBe(409)
   expect(db05State(f)).toEqual(before)
  }
 },180000)
}

const db05WaitCases=[
 {boundary:'issuer',mode:'receipt-expiry'},
 {boundary:'issuer',mode:'issuer-expiry'},
 {boundary:'portal',mode:'receipt-expiry'},
 {boundary:'portal',mode:'journal-expiry'},
 {boundary:'portal',mode:'reviewer-class-deny'},
 {boundary:'portal',mode:'purger-operation-deny'},
 {boundary:'issuer',mode:'valid'},
 {boundary:'portal',mode:'valid'},
] as const
for(const control of db05WaitCases){
 it(`DB05 process ${control.boundary} blockerPID wait ${control.mode} uses database clock and preserves or actually revokes/redacts`,async()=>{
  const f=await fixture(),k='correction_process_fact_body',document=Buffer.from('SYNTHETIC DB05 WAIT '+control.boundary+':'+control.mode)
  db05PortalPremises(f)
  const originalReceipt=await f.policy(k,document),body=JSON.parse(Buffer.from(originalReceipt.payloadBase64,'base64').toString('utf8')) as Record<string,unknown>
  const clock=sql<{now:string;releaseAt:string;validUntil:string}>(`SELECT jsonb_build_object('now',clock_timestamp(),'releaseAt',clock_timestamp()+interval '8 seconds','validUntil',clock_timestamp()+interval '1 hour')`)
  const issuer=randomUUID(),key=Buffer.from(randomUUID()+randomUUID()),legal='SYNTHETIC DB05 WAIT COMPETENCE ONLY'
  sql(`INSERT INTO gridex_ediel_retention.issuers(id,company_id,legal_reference,legal_evidence,legal_hash,signing_key,valid_from,valid_to)
   VALUES(${literal(issuer)},${literal(f.companyId)},${literal(legal)},decode('53594e544845544943','hex'),encode(sha256(decode('53594e544845544943','hex')),'hex'),decode(${literal(key.toString('hex'))},'hex'),${literal(clock.now)}::timestamptz-interval '1 day',${literal(control.mode==='issuer-expiry'?clock.releaseAt:clock.validUntil)})`)
  body.issuerLegalReference=legal;body.issuedAt=new Date(Date.parse(clock.now)-60000).toISOString();body.retainUntil=new Date(Date.parse(clock.now)-1000).toISOString()
  body.expiresAt=control.mode==='receipt-expiry'?clock.releaseAt:clock.validUntil
  body.journalRetainUntil=control.mode==='journal-expiry'?clock.releaseAt:clock.validUntil
  const payload=Buffer.from(JSON.stringify(body)),receipt={issuerId:issuer,payloadBase64:payload.toString('base64'),signatureHex:db05Hmac('sha256',key).update(payload).digest('hex')}
  const submitted=await http(f.writer.client,{action:'submit',retentionClass:k,targetId:f.targets[k],documentBase64:document.toString('base64'),issuerReceipt:receipt});expect(submitted.status,await submitted.clone().text()).toBe(200)
  const decision=await submitted.json();expect(decision.issuerQualified).toBe(true)
  expect((await http(f.reviewer.client,{action:'review',decisionId:decision.decisionId,outcome:'approve',reason:'SYNTHETIC separate current exact class'})).status).toBe(200)
  if(control.mode==='reviewer-class-deny'||control.mode==='purger-operation-deny'){
   const actor=control.mode==='reviewer-class-deny'?f.reviewer.id:f.writer.id
   const permission=control.mode==='reviewer-class-deny'?'ediel.retention.legal_history':'ediel.retention.purge'
   sql(`INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active,valid_from) VALUES(${literal(actor)},${literal(f.companyId)},${literal(permission)},'deny',true,${literal(clock.releaseAt)})`)
  }
  const before=db05State(f)
  const held=db05Holder(control.boundary==='issuer'?`SELECT id FROM gridex_ediel_retention.issuers WHERE id=${literal(issuer)} AND company_id=${literal(f.companyId)} FOR UPDATE`:'LOCK TABLE public.customer_portal_accounts,public.customer_portal_claims IN ACCESS EXCLUSIVE MODE')
  let pending:Promise<Response>|undefined,result:Response|undefined
  try{
   const holderPid=await held.ready
   pending=http(f.writer.client,{action:'purge',decisionId:decision.decisionId})
   await db05ObserveWait(holderPid,clock.releaseAt)
   held.release();await held.done;result=await pending
  }finally{held.release();await held.done;if(pending)await pending}
  const after=db05State(f)
  if(control.mode!=='valid'){
   expect([403,409]).toContain(result!.status)
   expect(after).toEqual(before)
  }else{
   expect(result!.status,await result!.clone().text()).toBe(200)
   expect(await result!.json()).toMatchObject({status:'redacted',retentionClass:k,targetId:f.targets[k],sourceHash:decision.sourceHash,replay:false})
   const accounts=after.database.portals as Array<{status:string;is_active:boolean}>,claims=after.database.claims as Array<{status:string}>
   expect(accounts.length).toBeGreaterThan(0);expect(claims.length).toBeGreaterThan(0)
   expect(accounts.every(x=>x.status==='revoked'&&!x.is_active)).toBe(true);expect(claims.every(x=>x.status==='revoked')).toBe(true)
   expect((after.database.tombstones as unknown[]).length).toBe(1);expect((after.database.events as unknown[]).length).toBe(1)
   const source=after.database.source as Record<string,unknown>;expect(source.old_fact).toBeNull();expect(source.new_fact).toEqual({retentionUnavailable:true,sourceHash:decision.sourceHash,complete:false,authority:'none'});expect(source.facts_hash).toBe(decision.sourceHash);expect(Object.fromEntries(Object.entries(source).filter(([key])=>!['old_fact','new_fact'].includes(key)))).toEqual(Object.fromEntries(Object.entries(before.database.source as Record<string,unknown>).filter(([key])=>!['old_fact','new_fact'].includes(key))))
   expect(after.providerCalls).toBe(before.providerCalls)
  }
 },180000)
}


// Bounded correction6176666282: compatible RowShare plus conflicting row
// SHARE must be observed before all final authority/time checks and effects.
const db05RowCases=[
 {boundary:'account-row',mode:'receipt-expiry'},
 {boundary:'claim-row',mode:'receipt-expiry'},
 {boundary:'source-row',mode:'receipt-expiry'},
 {boundary:'account-row',mode:'valid'},
 {boundary:'claim-row',mode:'valid'},
 {boundary:'source-row',mode:'valid'},
] as const
for(const control of db05RowCases){
 it(`DB05 process ${control.boundary} actual SHARE-holderPID ${control.mode} finishes before the first effect`,async()=>{
  const f=await fixture(),k='correction_process_fact_body',document=Buffer.from('SYNTHETIC DB05 ROW '+control.boundary+':'+control.mode)
  db05PortalPremises(f) // Nonempty ordinary portal rows before basis/policy.
  const originalReceipt=await f.policy(k,document),body=JSON.parse(Buffer.from(originalReceipt.payloadBase64,'base64').toString('utf8')) as Record<string,unknown>
  const clock=sql<{now:string;releaseAt:string;validUntil:string}>(`SELECT jsonb_build_object('now',clock_timestamp(),'releaseAt',clock_timestamp()+interval '8 seconds','validUntil',clock_timestamp()+interval '1 hour')`)
  const issuer=randomUUID(),key=Buffer.from(randomUUID()+randomUUID()),legal='SYNTHETIC DB05 ROW COMPETENCE ONLY'
  sql(`INSERT INTO gridex_ediel_retention.issuers(id,company_id,legal_reference,legal_evidence,legal_hash,signing_key,valid_from,valid_to) VALUES(${literal(issuer)},${literal(f.companyId)},${literal(legal)},decode('53594e544845544943','hex'),encode(sha256(decode('53594e544845544943','hex')),'hex'),decode(${literal(key.toString('hex'))},'hex'),${literal(clock.now)}::timestamptz-interval '1 day',${literal(clock.validUntil)})`)
  body.issuerLegalReference=legal;body.issuedAt=new Date(Date.parse(clock.now)-60000).toISOString();body.retainUntil=new Date(Date.parse(clock.now)-1000).toISOString()
  body.expiresAt=control.mode==='receipt-expiry'?clock.releaseAt:clock.validUntil;body.journalRetainUntil=clock.validUntil
  const payload=Buffer.from(JSON.stringify(body)),receipt={issuerId:issuer,payloadBase64:payload.toString('base64'),signatureHex:db05Hmac('sha256',key).update(payload).digest('hex')}
  const submitted=await http(f.writer.client,{action:'submit',retentionClass:k,targetId:f.targets[k],documentBase64:document.toString('base64'),issuerReceipt:receipt});expect(submitted.status,await submitted.clone().text()).toBe(200)
  const decision=await submitted.json();expect(decision.issuerQualified).toBe(true)
  expect((await http(f.reviewer.client,{action:'review',decisionId:decision.decisionId,outcome:'approve',reason:'SYNTHETIC separate row-wait review'})).status).toBe(200)
  const before=db05State(f)
  const table=control.boundary==='account-row'?'customer_portal_accounts':'customer_portal_claims'
  const statement=control.boundary==='source-row'?`SELECT id FROM gridex_correction_process.facts WHERE id=${literal(f.targets[k])}::bigint AND company_id=${literal(f.companyId)} ORDER BY id FOR SHARE`:`SELECT id FROM public.${table} WHERE company_id=${literal(f.companyId)} AND customer_id=${literal(f.customerId)} ORDER BY id FOR SHARE`
  const held=db05Holder(statement)
  let pending:Promise<Response>|undefined,result:Response|undefined
  try{
   const holderPid=await held.ready
   pending=http(f.writer.client,{action:'purge',decisionId:decision.decisionId})
   await db05ObserveWait(holderPid,clock.releaseAt)
   held.release();await held.done;result=await pending
  }finally{held.release();await held.done;if(pending)await pending}
  const after=db05State(f)
  if(control.mode==='receipt-expiry'){
   expect([403,409]).toContain(result!.status);expect(after).toEqual(before)
  }else{
   expect(result!.status,await result!.clone().text()).toBe(200)
   expect(await result!.json()).toMatchObject({status:'redacted',retentionClass:k,targetId:f.targets[k],sourceHash:decision.sourceHash,replay:false})
   const accounts=after.database.portals as Array<{status:string;is_active:boolean}>,claims=after.database.claims as Array<{status:string}>
   expect(accounts.length).toBeGreaterThan(0);expect(claims.length).toBeGreaterThan(0)
   expect(accounts.every(x=>x.status==='revoked'&&!x.is_active)).toBe(true);expect(claims.every(x=>x.status==='revoked')).toBe(true)
   expect((after.database.tombstones as unknown[]).length).toBe(1);expect((after.database.events as unknown[]).length).toBe(1)
   const source=after.database.source as Record<string,unknown>;expect(source.old_fact).toBeNull();expect(source.new_fact).toEqual({retentionUnavailable:true,sourceHash:decision.sourceHash,complete:false,authority:'none'});expect(source.facts_hash).toBe(decision.sourceHash);expect(Object.fromEntries(Object.entries(source).filter(([key])=>!['old_fact','new_fact'].includes(key)))).toEqual(Object.fromEntries(Object.entries(before.database.source as Record<string,unknown>).filter(([key])=>!['old_fact','new_fact'].includes(key))))
   expect(after.providerCalls).toBe(before.providerCalls)
  }
 },180000)
}
