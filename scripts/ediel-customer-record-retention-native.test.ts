import {type SupabaseClient} from '@supabase/supabase-js'
import {createHash,randomUUID} from 'node:crypto'
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
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {CUSTOMER_RECORD_RETENTION_CLASSES} from '@/lib/ediel/retention/recordClasses.catalog'
import {POST} from '@/app/api/ediel/customer-record-retention/route'
import {requireCustomerRecordAvailable,requireContractRecordsAvailable,requirePortalRetentionAccess} from '@/lib/ediel/retention/customerRecordClasses'
import {seedCustomerRecordRetentionNativeFixture} from './helpers/ediel-customer-record-retention-native-fixture'
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
afterEach(()=>{vi.unstubAllEnvs();ports.smtp.mockReset();ports.client=null;ports.company=''})
async function fixture(){const f=await seedCustomerRecordRetentionNativeFixture({provider:email=>ports.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'})});ports.company=f.companyId;return f}
async function http(client:SupabaseClient,body:unknown){ports.client=client;return POST(new NextRequest('http://localhost/api/ediel/customer-record-retention',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}))}
it('actual signed publication/PDF/POA/Z03, canonical onboarding and own public histories feed all twelve distinct native class owners through scoped HTTP; actual JWT Storage removal has a real unavailable readback',async()=>{
 const f=await fixture()
 for(const k of CUSTOMER_RECORD_RETENTION_CLASSES){
  const document=Buffer.from('SYNTHETIC SOURCE-SPECIFIC POLICY '+k),response=await http(f.submitter.client,{action:'submit',retentionClass:k,targetId:f.targets[k],documentBase64:document.toString('base64'),issuerReceipt:f.policy(k,document)});expect(response.status,await response.clone().text()).toBe(200);const submitted=await response.json();expect(submitted).toMatchObject({status:'submitted',issuerQualified:true,retentionClass:k})
  const inspected=await http(f.reviewer.client,{action:'read',decisionId:submitted.decisionId});expect(inspected.status).toBe(200);const bytes=await inspected.json();expect(Buffer.from(bytes.documentBase64,'base64')).toEqual(document);expect(bytes.documentHash).toBe(digest(document))
  const same=await f.submitter.client.rpc('ediel_review_customer_record_retention_v1',{p_company_id:f.companyId,p_actor_user_id:f.submitter.id,p_decision_id:submitted.decisionId,p_outcome:'approve',p_reason:'invalid same writer'});expect(same.error).not.toBeNull()
  const reviewed=await http(f.reviewer.client,{action:'review',decisionId:submitted.decisionId,outcome:'approve',reason:'SYNTHETIC separate exact-source mechanism review'});expect(reviewed.status,await reviewed.clone().text()).toBe(200);expect((await reviewed.json()).status).toBe('approved')
  const beforePdf=k==='contract_signed_pdf_bytes'?sql<{path:string;hash:string}>(`SELECT jsonb_build_object('path',storage_path,'hash',document_sha256) FROM public.customer_contract_documents WHERE id=${literal(f.targets[k])}`):null
  if(beforePdf){const before=await supabaseService.storage.from('customer-contract-documents').download(beforePdf.path);expect(before.error).toBeNull();expect(digest(Buffer.from(await before.data!.arrayBuffer()))).toBe(beforePdf.hash)}
  const purged=await http(f.submitter.client,{action:'purge',decisionId:submitted.decisionId});expect(purged.status,await purged.clone().text()).toBe(200);const receipt=await purged.json();expect(receipt).toMatchObject({retentionClass:k,targetId:f.targets[k],status:beforePdf?'storage_object_absent':'redacted'})
  if(beforePdf){expect(receipt.physicalBytesObservedUnavailable).toBe(true);const unavailable=await supabaseService.storage.from('customer-contract-documents').download(beforePdf.path);expect(unavailable.data).toBeNull();expect(['404','400']).toContain(String(unavailable.error?.statusCode));expect(unavailable.error?.message).toMatch(/not found|does not exist/i)}
  else{const spec=sql<{table:string;redaction:Record<string,unknown>}>(`SELECT jsonb_build_object('table',source_table,'redaction',redaction) FROM gridex_ediel_retention.record_class_catalog WHERE retention_class=${literal(k)}`),row=sql<Record<string,unknown>>(`SELECT to_jsonb(r) FROM public.${spec.table} r WHERE id=${literal(f.targets[k])}`);for(const [field,value]of Object.entries(spec.redaction))expect(row[field],k+'.'+field).toEqual(value==='RETENTION_EMAIL'?`retained-signature-${f.targets[k]}@example.invalid`:value)}
  await expect(requireCustomerRecordAvailable({companyId:f.companyId,retentionClass:k,targetId:f.targets[k]})).rejects.toBeDefined()
  expect((await (await http(f.submitter.client,{action:'purge',decisionId:submitted.decisionId})).json()).replay).toBe(true)
 }
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.record_tombstones WHERE company_id=${literal(f.companyId)}`)).toBe(12)
 await expect(requireContractRecordsAvailable({companyId:f.companyId,contractId:f.contractId})).rejects.toBeDefined();await expect(requirePortalRetentionAccess({companyId:f.companyId,customerId:f.customerId})).rejects.toBeDefined()
},180000)
it('missing legal competence, hostile tenant selectors and committed current reviewer class DENY hold actual source bytes and histories without partial tombstone or provider effects',async()=>{
 const f=await fixture(),k='customer_address_history',document=Buffer.from('SYNTHETIC negative scope decision')
 const unqualified=await http(f.submitter.client,{action:'submit',retentionClass:k,targetId:f.targets[k],documentBase64:document.toString('base64'),issuerReceipt:null});const u=await unqualified.json();expect(u.issuerQualified).toBe(false);expect((await http(f.reviewer.client,{action:'review',decisionId:u.decisionId,outcome:'approve',reason:'SYNTHETIC no issuer must hold'})).status).toBe(409)
 expect((await http(f.submitter.client,{action:'purge',decisionId:u.decisionId,companyId:randomUUID()})).status).toBe(400)
 const qualifiedDoc=Buffer.from('SYNTHETIC exact negative class policy'),created=await http(f.submitter.client,{action:'submit',retentionClass:k,targetId:f.targets[k],documentBase64:qualifiedDoc.toString('base64'),issuerReceipt:f.policy(k,qualifiedDoc)}),decision=(await created.json()).decisionId;expect((await http(f.reviewer.client,{action:'review',decisionId:decision,outcome:'approve',reason:'SYNTHETIC separate'})).status).toBe(200)
 const before=sql<Record<string,unknown>>(`SELECT to_jsonb(a) FROM public.customer_addresses a WHERE id=${literal(f.targets[k])}`)
 sql(`INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active) VALUES(${literal(f.reviewer.id)},${literal(f.companyId)},'ediel.retention.address_history','deny',true)`)
 expect((await http(f.submitter.client,{action:'purge',decisionId:decision})).status).toBe(409);expect(sql(`SELECT to_jsonb(a) FROM public.customer_addresses a WHERE id=${literal(f.targets[k])}`)).toEqual(before);expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.record_tombstones WHERE company_id=${literal(f.companyId)}`)).toBe(0)
 sql(`DELETE FROM public.user_permission_overrides WHERE user_id=${literal(f.reviewer.id)} AND company_id=${literal(f.companyId)}`)
 const trigger='native_record_retention_late_'+randomUUID().replaceAll('-','');sql(`CREATE FUNCTION public.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.company_id=${literal(f.companyId)}::uuid AND NEW.action='ediel.retention.record_tombstoned' THEN RAISE EXCEPTION 'actual final retention audit blocked';END IF;RETURN NEW;END$$;CREATE TRIGGER ${trigger} BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.${trigger}()`)
 try{expect((await http(f.submitter.client,{action:'purge',decisionId:decision})).status).toBe(403);expect(sql(`SELECT to_jsonb(a) FROM public.customer_addresses a WHERE id=${literal(f.targets[k])}`)).toEqual(before);expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.record_tombstones WHERE company_id=${literal(f.companyId)}`)).toBe(0)}finally{sql(`DROP TRIGGER ${trigger} ON public.audit_logs;DROP FUNCTION public.${trigger}()`)}
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
    AND query LIKE '%ediel_begin_customer_record_retention_v1%' LIMIT 1) x)`)
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
 sql(`INSERT INTO public.customer_portal_accounts(id,company_id,customer_id,user_id,status,is_active,email) VALUES(${literal(randomUUID())},${literal(f.companyId)},${literal(f.customerId)},${literal(f.submitter.id)},'active',true,'synthetic-db05@example.invalid');
  INSERT INTO public.customer_portal_claims(id,company_id,customer_id,user_id,status,token_hash) VALUES(${literal(randomUUID())},${literal(f.companyId)},${literal(f.customerId)},${literal(f.submitter.id)},'active',${literal(randomUUID())})`)
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_portal_accounts WHERE company_id=${literal(f.companyId)} AND customer_id=${literal(f.customerId)} AND status='active' AND is_active`)).toBeGreaterThan(0)
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_portal_claims WHERE company_id=${literal(f.companyId)} AND customer_id=${literal(f.customerId)} AND status='active'`)).toBeGreaterThan(0)
}

function db05State(f:Awaited<ReturnType<typeof fixture>>){
 return {providerCalls:ports.smtp.mock.calls.length,database:sql<Record<string,unknown>>(`SELECT jsonb_build_object(
  'source',(SELECT to_jsonb(x) FROM public.customer_addresses x WHERE id=${literal(f.targets['customer_address_history'])}),
  'customers',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb) FROM public.customers x WHERE company_id=${literal(f.companyId)}),
  'portals',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb) FROM public.customer_portal_accounts x WHERE company_id=${literal(f.companyId)}),
  'claims',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb) FROM public.customer_portal_claims x WHERE company_id=${literal(f.companyId)}),
  'decisions',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb) FROM gridex_ediel_retention.record_decisions x WHERE company_id=${literal(f.companyId)}),
  'reviews',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM gridex_ediel_retention.record_reviews x JOIN gridex_ediel_retention.record_decisions d ON d.id=x.decision_id WHERE d.company_id=${literal(f.companyId)}),
  'tombstones',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY target_id),'[]'::jsonb) FROM gridex_ediel_retention.record_tombstones x WHERE company_id=${literal(f.companyId)}),
  'events',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM gridex_ediel_retention.record_events x WHERE EXISTS(SELECT FROM gridex_ediel_retention.record_decisions d WHERE d.company_id=${literal(f.companyId)} AND d.retention_class=x.retention_class AND d.target_id=x.target_id)),
  'audits',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb) FROM public.audit_logs x WHERE company_id=${literal(f.companyId)}))`)}
}

for(const field of ['issuedAt','expiresAt','retainUntil','journalRetainUntil'] as const){
 it(`DB05 record valid-HMAC ${field} missing/NULL/nonfinite fails closed without partial source/portal effects`,async()=>{
  const f=await fixture(),k='customer_address_history'
  db05PortalPremises(f) // Ordinary nonempty premises precede every basis/policy.
  for(const value of [undefined,null,'infinity']){
   const document=Buffer.from('SYNTHETIC DB05 '+field+':'+String(value)),receipt=f.policy(k,document,{[field]:value})
   const submitted=await http(f.submitter.client,{action:'submit',retentionClass:k,targetId:f.targets[k],documentBase64:document.toString('base64'),issuerReceipt:receipt})
   expect(submitted.status,await submitted.clone().text()).toBe(200)
   const decision=await submitted.json();expect(decision.issuerQualified).toBe(false)
   expect((await http(f.reviewer.client,{action:'review',decisionId:decision.decisionId,outcome:'approve',reason:'SYNTHETIC NULL must hold'})).status).toBe(409)
   const before=db05State(f)
   expect((await http(f.submitter.client,{action:'purge',decisionId:decision.decisionId})).status).toBe(409)
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
 it(`DB05 record ${control.boundary} blockerPID wait ${control.mode} uses database clock and preserves or actually revokes/redacts`,async()=>{
  const f=await fixture(),k='customer_address_history',document=Buffer.from('SYNTHETIC DB05 WAIT '+control.boundary+':'+control.mode)
  db05PortalPremises(f)
  const originalReceipt=f.policy(k,document),body=JSON.parse(Buffer.from(originalReceipt.payloadBase64,'base64').toString('utf8')) as Record<string,unknown>
  const clock=sql<{now:string;releaseAt:string;validUntil:string}>(`SELECT jsonb_build_object('now',clock_timestamp(),'releaseAt',clock_timestamp()+interval '8 seconds','validUntil',clock_timestamp()+interval '1 hour')`)
  const issuer=randomUUID(),key=Buffer.from(randomUUID()+randomUUID()),legal='SYNTHETIC DB05 WAIT COMPETENCE ONLY'
  sql(`INSERT INTO gridex_ediel_retention.issuers(id,company_id,legal_reference,legal_evidence,legal_hash,signing_key,valid_from,valid_to)
   VALUES(${literal(issuer)},${literal(f.companyId)},${literal(legal)},decode('53594e544845544943','hex'),encode(sha256(decode('53594e544845544943','hex')),'hex'),decode(${literal(key.toString('hex'))},'hex'),${literal(clock.now)}::timestamptz-interval '1 day',${literal(control.mode==='issuer-expiry'?clock.releaseAt:clock.validUntil)})`)
  body.issuerLegalReference=legal;body.issuedAt=new Date(Date.parse(clock.now)-60000).toISOString();body.retainUntil=new Date(Date.parse(clock.now)-1000).toISOString()
  body.expiresAt=control.mode==='receipt-expiry'?clock.releaseAt:clock.validUntil
  body.journalRetainUntil=control.mode==='journal-expiry'?clock.releaseAt:clock.validUntil
  const payload=Buffer.from(JSON.stringify(body)),receipt={issuerId:issuer,payloadBase64:payload.toString('base64'),signatureHex:db05Hmac('sha256',key).update(payload).digest('hex')}
  const submitted=await http(f.submitter.client,{action:'submit',retentionClass:k,targetId:f.targets[k],documentBase64:document.toString('base64'),issuerReceipt:receipt});expect(submitted.status,await submitted.clone().text()).toBe(200)
  const decision=await submitted.json();expect(decision.issuerQualified).toBe(true)
  expect((await http(f.reviewer.client,{action:'review',decisionId:decision.decisionId,outcome:'approve',reason:'SYNTHETIC separate current exact class'})).status).toBe(200)
  if(control.mode==='reviewer-class-deny'||control.mode==='purger-operation-deny'){
   const actor=control.mode==='reviewer-class-deny'?f.reviewer.id:f.submitter.id
   const permission=control.mode==='reviewer-class-deny'?'ediel.retention.address_history':'ediel.retention.purge'
   sql(`INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active,valid_from) VALUES(${literal(actor)},${literal(f.companyId)},${literal(permission)},'deny',true,${literal(clock.releaseAt)})`)
  }
  const before=db05State(f)
  const held=db05Holder(control.boundary==='issuer'?`SELECT id FROM gridex_ediel_retention.issuers WHERE id=${literal(issuer)} AND company_id=${literal(f.companyId)} FOR UPDATE`:'LOCK TABLE public.customer_portal_accounts,public.customer_portal_claims IN ACCESS EXCLUSIVE MODE')
  let pending:Promise<Response>|undefined,result:Response|undefined
  try{
   const holderPid=await held.ready
   pending=http(f.submitter.client,{action:'purge',decisionId:decision.decisionId})
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
   expect(after.database.source).toMatchObject({street_1:null,street_2:null,postal_code:null,city:null,municipality:null,metadata:{}});expect(after.database.source).not.toEqual(before.database.source)
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
 it(`DB05 record ${control.boundary} actual SHARE-holderPID ${control.mode} finishes before the first effect`,async()=>{
  const f=await fixture(),k='customer_address_history',document=Buffer.from('SYNTHETIC DB05 ROW '+control.boundary+':'+control.mode)
  db05PortalPremises(f) // Nonempty ordinary portal rows before basis/policy.
  const originalReceipt=f.policy(k,document),body=JSON.parse(Buffer.from(originalReceipt.payloadBase64,'base64').toString('utf8')) as Record<string,unknown>
  const clock=sql<{now:string;releaseAt:string;validUntil:string}>(`SELECT jsonb_build_object('now',clock_timestamp(),'releaseAt',clock_timestamp()+interval '8 seconds','validUntil',clock_timestamp()+interval '1 hour')`)
  const issuer=randomUUID(),key=Buffer.from(randomUUID()+randomUUID()),legal='SYNTHETIC DB05 ROW COMPETENCE ONLY'
  sql(`INSERT INTO gridex_ediel_retention.issuers(id,company_id,legal_reference,legal_evidence,legal_hash,signing_key,valid_from,valid_to) VALUES(${literal(issuer)},${literal(f.companyId)},${literal(legal)},decode('53594e544845544943','hex'),encode(sha256(decode('53594e544845544943','hex')),'hex'),decode(${literal(key.toString('hex'))},'hex'),${literal(clock.now)}::timestamptz-interval '1 day',${literal(clock.validUntil)})`)
  body.issuerLegalReference=legal;body.issuedAt=new Date(Date.parse(clock.now)-60000).toISOString();body.retainUntil=new Date(Date.parse(clock.now)-1000).toISOString()
  body.expiresAt=control.mode==='receipt-expiry'?clock.releaseAt:clock.validUntil;body.journalRetainUntil=clock.validUntil
  const payload=Buffer.from(JSON.stringify(body)),receipt={issuerId:issuer,payloadBase64:payload.toString('base64'),signatureHex:db05Hmac('sha256',key).update(payload).digest('hex')}
  const submitted=await http(f.submitter.client,{action:'submit',retentionClass:k,targetId:f.targets[k],documentBase64:document.toString('base64'),issuerReceipt:receipt});expect(submitted.status,await submitted.clone().text()).toBe(200)
  const decision=await submitted.json();expect(decision.issuerQualified).toBe(true)
  expect((await http(f.reviewer.client,{action:'review',decisionId:decision.decisionId,outcome:'approve',reason:'SYNTHETIC separate row-wait review'})).status).toBe(200)
  const before=db05State(f)
  const table=control.boundary==='account-row'?'customer_portal_accounts':'customer_portal_claims'
  const statement=control.boundary==='source-row'?`SELECT id FROM public.customer_addresses WHERE id=${literal(f.targets[k])}::uuid AND company_id=${literal(f.companyId)} ORDER BY id FOR SHARE`:`SELECT id FROM public.${table} WHERE company_id=${literal(f.companyId)} AND customer_id=${literal(f.customerId)} ORDER BY id FOR SHARE`
  const held=db05Holder(statement)
  let pending:Promise<Response>|undefined,result:Response|undefined
  try{
   const holderPid=await held.ready
   pending=http(f.submitter.client,{action:'purge',decisionId:decision.decisionId})
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
   expect(after.database.source).toMatchObject({street_1:null,street_2:null,postal_code:null,city:null,municipality:null,metadata:{}});expect(after.database.source).not.toEqual(before.database.source)
   expect(after.providerCalls).toBe(before.providerCalls)
  }
 },180000)
}
