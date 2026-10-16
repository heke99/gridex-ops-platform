// SOURCE supplement for AT-Z03C-SUPPLIER; no whole masterplan approval tag.
// Only the external SMTP, registry issuer competence and synthetic fixture
// tenants are doubles. Actual product clocks, original producers, source/RBAC,
// public flows, renderer, customer owner, binding triggers and outbox are real.
// Future controlled accelerated execution is not elapsed market history.
import {execFileSync} from 'node:child_process'
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {createClient} from '@supabase/supabase-js'
import {beforeAll,describe,expect,it,vi} from 'vitest'
const smtp=vi.hoisted(()=>vi.fn())
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:smtp})}}))
import {seedNormalSwitchNativeFixture,futureNativeSupplyDate,nativeSql as sql,literal,type NormalSwitchStageNativeFixture} from './helpers/ediel-normal-switch-native-fixture'
import {attachNetworkRegistrySourceFixture} from './helpers/ediel-network-registry-native-fixture'
import {supabaseService} from '@/lib/supabase/service'
import {prepareAndQueueEdielZ03} from '@/lib/ediel/flows/prodatSwitch'
import {prepareAndQueueSwitchCancellation} from '@/lib/ediel/flows/prodatSwitchCancellation'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {getEdielMessageById} from '@/lib/ediel/db'
import {readSwitchCancellationSource,reserveSwitchCancellationSource} from '@/lib/ediel/production/switchCancellationSource'
import {prepareSwitchCancellationCustomerMasterdataContext} from '@/lib/ediel/production/customerMasterdataSource'
import {archiveNetworkRegistrySource,reviewNetworkRegistrySource,readNetworkRegistrySourceArtifact,readNetworkRegistrySourceBytes,type NetworkRegistrySourceSubmission} from '@/lib/ediel/production/networkRegistrySource'
import {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
import {createEdielMessageIntent} from '@/lib/ediel/intent/intentEngine'
import {createOutboundRequest} from '@/lib/cis/db'
import {buildSwitchCancellationDraft} from '@/lib/ediel/intent/renderers/switchCancellation'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import type {EdielMessageRow} from '@/lib/ediel/types'

type Fixture=NormalSwitchStageNativeFixture&{original:EdielMessageRow;li:string;start:string;seal:unknown}
type Snapshot=Record<string,unknown>
const password=randomUUID()+randomUUID()
let ordinaryDay:string,L_A:Fixture,L_B:Fixture,LK_A:Fixture,missingLI:Fixture,mutation:Fixture,decoy:Fixture
const evidence:Record<string,unknown>={schema:'ediel_z03c_supplier_boundary_native_v1',purpose:'supplement_missing_literal_behaviors',
  authentic_external_market_history:false,actual_elapsed_14_days:false,old33_rerun:false,whole_approval:false,
  existing_unchanged_33:{source_tree:'f96a92edce00c594fb70328d661b8642825526e3',head:'e9fdfb0ee625378e79e46e84bb5fad839e4c9b65',
    run_id:38774342508,job_id:116557964710,artifact_id:11992889234,run_attempt:1,
    ROOT_qualification_sha256:'2c1c4709c4cca43d7b75aeaa478036e39f3769dbcba0f13044bd73dba803c734',
    applicability:'ROOT qualified actual d9 unchanged original native/product ports; final integration applicability still required',
    reuse_scope:'existing C03 profile, own accepted provider250/requested-not-complete, physical ACK/Z04C causality, current role/foreign actor and LKday0; no calendar-gap credit'},
  cases:[],clock_phases:[],originals:[]}
const cases=evidence.cases as Array<Record<string,unknown>>,phases=evidence.clock_phases as Array<Record<string,unknown>>
function sha(value:string|Buffer){return createHash('sha256').update(value).digest('hex')}
function requireWorkingDirectory(){
  const root=process.env.GRIDEX_Z03C_EVIDENCE
  if(!root||!root.startsWith(process.cwd()+'/'))throw Error('z03c_owned_evidence_directory_required')
  return root
}
function persist(){writeFileSync(join(requireWorkingDirectory(),'product-boundary-receipt.json'),JSON.stringify(evidence,null,2)+'\n')}
function smtpProvider(email='recipient@example.invalid'){
  for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',
    EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',
    EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v)
  smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'})
}
function day(){return sql<string>(`SELECT to_jsonb((clock_timestamp()+interval '1 hour')::date);`)}
function plusDays(value:string,n:number){const date=new Date(value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+n);return date.toISOString().slice(0,10)}
function originalSeal(f:Pick<Fixture,'companyId'|'switchId'|'original'>){
  return sql<Snapshot>(`SELECT jsonb_build_object(
    'message',(SELECT to_jsonb(m) FROM public.ediel_messages m WHERE m.id=${literal(f.original.id)} AND m.company_id=${literal(f.companyId)}),
    'original',(SELECT to_jsonb(o) FROM gridex_received_sources.switch_originals o WHERE o.company_id=${literal(f.companyId)} AND o.message_id=${literal(f.original.id)} AND o.switch_id=${literal(f.switchId)}),
    'method',(SELECT to_jsonb(b) FROM gridex_received_sources.switch_contract_request_bindings b WHERE b.company_id=${literal(f.companyId)} AND b.message_id=${literal(f.original.id)}));`)
}
// Whole scoped rows, including ID sets and recorded side effects. Auth sessions
// and deliberately renewed registry versions are separate current-authority
// premises; neither is relabelled as a cancellation business effect.
const protectedTables=['public.customers','public.customer_sites','public.metering_points','public.customer_contracts',
  'public.customer_supply_periods','public.metering_permissions','public.customer_operation_jobs','public.customer_application_workflows',
  'public.customer_application_workflow_events','public.customer_events','gridex_received_sources.supply_source_transitions',
  'gridex_received_sources.normal_supply_activations','gridex_received_sources.normal_switch_confirmations',
  'gridex_received_sources.supply_object_effect_receipts','gridex_received_sources.supply_object_partitions'] as const
function domain(f:Fixture){return sql<Snapshot>('SELECT jsonb_build_object('+protectedTables.map(table=>
  `${literal(table)},(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]') FROM ${table} x WHERE company_id=${literal(f.companyId)})`).join(',')+');')}
function cancellationState(f:Fixture){return sql<Snapshot>(`SELECT jsonb_build_object(
  'switch',(SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE s.id=${literal(f.switchId)} AND s.company_id=${literal(f.companyId)}),
  'origins',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM gridex_switch_cancellations.origins x WHERE company_id=${literal(f.companyId)}),
  'intents',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.ediel_message_intents x WHERE company_id=${literal(f.companyId)}),
  'requests',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.outbound_requests x WHERE company_id=${literal(f.companyId)}),
  'messages',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.ediel_messages x WHERE company_id=${literal(f.companyId)}),
  'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.ediel_outbox x WHERE company_id=${literal(f.companyId)}),
  'preparations',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM gridex_customer_masterdata.preparations x WHERE company_id=${literal(f.companyId)}));`)}
function unchanged(f:Fixture,before:{domain:Snapshot;cancellation:Snapshot},decoyBefore:unknown){
  expect(domain(f)).toEqual(before.domain);expect(cancellationState(f)).toEqual(before.cancellation)
  expect(originalSeal(f)).toEqual(f.seal);expect({domain:domain(decoy),cancellation:cancellationState(decoy)}).toEqual(decoyBefore)
}
function request(f:Fixture){return {companyId:f.companyId,switchRequestId:f.switchId,actorUserId:f.actorUserId,preferredRouteId:f.routeId,environment:'test' as const}}
async function authorized(f:Fixture){
  const source=await readSwitchCancellationSource(request(f))
  expect(source).toMatchObject({status:'authorized',companyId:f.companyId,originalMessageId:f.original.id,
    originalHash:sha(f.original.raw_payload!),li:f.li,startAt:expect.any(String),pointId:f.external,customerId:f.customerId,
    siteId:f.siteId,meteringPointId:f.pointId,legalSenderId:f.sender,legalReceiverId:f.receiver})
  if(source.status!=='authorized')throw Error('z03c_actual_authorized_source_required')
  return source
}
async function birth(name:string,subtype:'L'|'LK'):Promise<Fixture>{
  smtpProvider()
  const stage=await seedNormalSwitchNativeFixture({deferOriginal:true,requestedStartDate:subtype==='LK'?ordinaryDay:futureNativeSupplyDate(20),provider:smtpProvider})
  if(subtype==='LK')sql(`UPDATE public.supplier_switch_requests SET prodat_variant='LK',prodat_reason='Z23',request_type='move_in' WHERE id=${literal(stage.switchId)} AND company_id=${literal(stage.companyId)};`)
  const queued=await prepareAndQueueEdielZ03({actorUserId:stage.actorUserId,switchRequestId:stage.switchId,communicationRouteId:stage.routeId,environment:'test'})
  await sendEdielMessageViaSmtp(queued,{actorUserId:stage.actorUserId,smtpMimeMode:'nodemailer-attachment'})
  const original=await getEdielMessageById(queued.id);expect(original).toMatchObject({id:queued.id,company_id:stage.companyId,direction:'outbound',message_code:'Z03',status:'sent'})
  if(!original?.raw_payload)throw Error('z03c_real_sent_original_required')
  const wire=tokenizeEdifact(original.raw_payload),liRows=wire.segments.filter(s=>s.tag==='RFF'&&segmentComposite(s,1,wire.una)[0]==='LI')
  expect(liRows).toHaveLength(1)
  const own=sql<Record<string,string>>(`SELECT gridex_received_sources.switch_origin_wire_v1(${literal(original.raw_payload)})#>'{objects,0}';`)
  const encodedDay=sql<string>(`SELECT to_jsonb(gridex_received_sources.permission_date_v1(${literal(own.start)}));`)
  expect(encodedDay).toBe(stage.requestedStartDate);expect(own.reason).toBe(subtype==='L'?'Z22':'Z23')
  const calendarDays=(Date.parse(encodedDay+'T12:00:00Z')-Date.parse(ordinaryDay+'T12:00:00Z'))/86400000
  if(subtype==='L')expect(calendarDays).toBeGreaterThanOrEqual(14)
  const f={...stage,original,li:segmentComposite(liRows[0],1,wire.una)[1],start:encodedDay,seal:null as unknown}
  expect(sql(`SELECT to_jsonb(gridex_received_sources.sent_source_is_current_v1(m)) FROM public.ediel_messages m WHERE m.id=${literal(original.id)} AND m.company_id=${literal(stage.companyId)};`)).toBe(true)
  f.seal=originalSeal(f)
  await authorized(f)
  // Synthetic actor credentials are prepared prospectively, never copied to
  // evidence. Fresh GoTrue login at each phase proves current same-principal
  // authority; no token is forged, backdated or given a longer lifetime.
  expect((await supabaseService.auth.admin.updateUserById(f.actorUserId,{password,email_confirm:true})).error).toBeNull()
  ;(evidence.originals as unknown[]).push({name,subtype,company_id:f.companyId,original_id:original.id,original_hash:sha(original.raw_payload),
    li:f.li,start_day:f.start,observed_birth_policy_day:ordinaryDay,calendar_days_before_start:calendarDays,seal:f.seal})
  persist();return f
}
async function phaseContextReadiness<T extends {error:{code?:string;message?:string}|null}>(
  read:(signal:AbortSignal)=>PromiseLike<T>,
  ports={monotonic:()=>performance.now(),wait:(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)),signal:(ms:number)=>AbortSignal.timeout(ms)},
){
  const started=ports.monotonic(),deadline=started+3000
  let context:T|undefined,attempts=0,futureRefusals=0
  while(attempts<30){
    const remaining=deadline-ports.monotonic()
    if(remaining<1)break
    context=await read(ports.signal(Math.floor(Math.min(1000,remaining))));attempts++
    if(context.error?.code!=='PGRST303'||context.error.message!=='JWT issued at future')break
    futureRefusals++
    const left=deadline-ports.monotonic()
    if(left<1||attempts===30)break
    await ports.wait(Math.min(100,left))
  }
  if(!context)throw Error('z03c_phase_auth_readiness_no_response')
  const elapsed=ports.monotonic()-started
  return {context,readiness:{attempts,exact_future_refusals:futureRefusals,elapsed_monotonic_ms:elapsed,ready:context.error===null&&elapsed<=3000}}
}
function assertFreshPhaseClaims(claims:{sub?:string;iat?:number;exp?:number},id:string,now:number){
  expect(claims.sub).toBe(id);expect(typeof claims.iat).toBe('number');expect(typeof claims.exp).toBe('number')
  expect(Math.abs(now-claims.iat!)).toBeLessThan(30);expect(claims.exp!).toBeGreaterThan(now);expect(claims.exp!-claims.iat!).toBeLessThanOrEqual(3600)
}
async function freshLogin(id:string,email:string,companyId:string,keys:string[],phaseClockReadiness=false){
  const client=createClient('http://127.0.0.1:54321',process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}})
  const logged=await client.auth.signInWithPassword({email,password});expect(logged.error).toBeNull()
  expect(logged.data.user?.id).toBe(id)
  const token=logged.data.session?.access_token
  if(!token)throw Error('z03c_actual_current_login_required')
  const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8')) as {sub?:string;iat?:number;exp?:number}
  const now=Date.now()/1000
  expect(claims.sub).toBe(id);expect(typeof claims.iat).toBe('number');expect(typeof claims.exp).toBe('number')
  expect(Math.abs(now-claims.iat!)).toBeLessThan(30);expect(claims.exp!).toBeGreaterThan(now);expect(claims.exp!-claims.iat!).toBeLessThanOrEqual(3600)
  // Only a proven advanced phase admits bounded JWT-validator readiness.
  // The read client returns the SAME real GoTrue token on every request;
  // it cannot refresh/reauthenticate or repeat a cancellation operation.
  const rpcClient=phaseClockReadiness?createClient('http://127.0.0.1:54321',process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{
    accessToken:async()=>token,auth:{persistSession:false,autoRefreshToken:false},
  }):client
  const ready=phaseClockReadiness?await phaseContextReadiness(signal=>rpcClient.rpc(
    'canonical_authenticated_tenant_context',{p_selected_company_id:companyId},
  ).abortSignal(signal)):null
  const context=ready?ready.context:await client.rpc('canonical_authenticated_tenant_context',{p_selected_company_id:companyId})
  expect(context.error).toBeNull();expect(context.data).toMatchObject({authorized:true,selected_company_id:companyId})
  if(ready){expect(ready.readiness.ready).toBe(true);assertFreshPhaseClaims(claims,id,Date.now()/1000)}
  // Normal-switch authority is its actual explicit user_permissions. The
  // historical context permission list projects role grants only; it must not
  // erase this fixture's real operational permission or require a new grant.
  // Reach the SAME current operational oracle that the cancellation owner uses,
  // now through the real freshly authenticated same-principal RPC connection.
  for(const key of keys){
    const permission=await rpcClient.rpc('gridex_actor_has_company_permission',{p_actor_user_id:id,p_company_id:companyId,p_permission:key})
    expect(permission.error).toBeNull();expect(permission.data).toBe(true)
  }
  await client.auth.signOut({scope:'local'})
  return {actor_user_id:id,company_id:companyId,iat:claims.iat,exp:claims.exp,authenticated_current_context:true,
    ...(ready?{phase_auth_readiness:ready.readiness}:{})}
}
function actualClocks(){
  const os=JSON.parse(execFileSync('python3',['-c','import time,json;print(json.dumps({"realtime_ms":time.time_ns()/1000000,"monotonic_ms":time.monotonic_ns()/1000000}))'],{encoding:'utf8',timeout:10000})) as Record<string,number>
  const pg=sql<Record<string,unknown>>(`BEGIN;SELECT jsonb_build_object('now_ms',extract(epoch FROM now())*1000,
    'statement_ms',extract(epoch FROM statement_timestamp())*1000,'clock_ms',extract(epoch FROM clock_timestamp())*1000,
    'policy_day',(clock_timestamp()+interval '1 hour')::date,'timezone',current_setting('TimeZone'),
    'postmaster_started_at',pg_postmaster_start_time(),'context_body_sha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'))
    FROM pg_proc p WHERE p.oid='gridex_switch_cancellations.context_v1(uuid,uuid,uuid,boolean)'::regprocedure;COMMIT;`)
  expect(pg.context_body_sha256).toBe('600e83702ed4695229aeaa133b258867d9736ac1939b8196e7d2e56ca145aa4e')
  const node={realtime_ms:Date.now(),monotonic_ms:performance.now()}
  for(const t of [os.realtime_ms,Number(pg.now_ms),Number(pg.statement_ms),Number(pg.clock_ms)])expect(Math.abs(node.realtime_ms-t)).toBeLessThan(5000)
  return {os,node,postgres_new_transaction:pg}
}
async function phase(name:string,targetDay:string,f:Fixture){
  const controlPath=process.env.GRIDEX_Z03C_CLOCK_CONTROL
  if(!controlPath)throw Error('z03c_owned_clock_controller_required')
  const control=JSON.parse(readFileSync(controlPath,'utf8')) as {admitted?:boolean;mode?:string;deadline_monotonic_ms?:number;original_realtime_ms?:number}
  if(control.admitted!==true||control.mode!=='native'||!control.deadline_monotonic_ms)throw Error('z03c_clock_controller_not_admitted')
  const before=actualClocks(),target=Date.parse(targetDay+'T12:00:00Z')
  expect(before.os.monotonic_ms).toBeLessThan(control.deadline_monotonic_ms)
  expect(target).toBeGreaterThan(before.node.realtime_ms)
  // This is the actual host kernel clock on a disposable admitted hosted VM.
  // No product clock input, body substitution, fake Date or original rewrite.
  const controller=process.env.GRIDEX_Z03C_CLOCK_CONTROLLER_SCRIPT
  if(!controller)throw Error('z03c_clock_executor_source_required')
  // The workflow executor serializes ALL actual clock writes with restoration
  // and rechecks the exact live controller/epoch inside its privileged flock.
  const change=JSON.parse(execFileSync('python3',[controller,'--advance',String(target/1000)],{encoding:'utf8',timeout:20000}))
  expect(change).toMatchObject({target_realtime_ms:target,shared_restore_lock:true})
  const after=actualClocks();expect(after.postgres_new_transaction.policy_day).toBe(targetDay)
  const health=await fetch('http://127.0.0.1:54321/auth/v1/health',{headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}})
  expect(health.ok).toBe(true)
  const apiDate=Date.parse(health.headers.get('date')??'')
  expect(Number.isFinite(apiDate)).toBe(true);expect(Math.abs(Date.now()-apiDate)).toBeLessThan(5000)
  const authority=await freshLogin(f.actorUserId,`${f.actorUserId}@example.invalid`,f.companyId,['communication.write','communication.send'],true)
  phases.push({name,target_policy_day:targetDay,before,after,local_api_auth_date_ms:apiDate,current_authority:authority})
  persist()
}
// The T0 helper caches a one-hour policy. A genuinely new dated successor is
// archived and separately reviewed through unchanged product ports. Reuse only
// its declared synthetic issuer competence/key, never its stale policy closure.
async function renewCurrentNetworkSource(f:Fixture){
  const registry=await attachNetworkRegistrySourceFixture(f)
  const predecessor=sql(`SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM gridex_network_registry_sources.artifacts v WHERE company_id=${literal(f.companyId)};`)
  const keys=['communication.read','communication.write','communication.send','ediel.network_registry.review']
  const uploader=await freshLogin(registry.uploader.id,registry.uploader.email,f.companyId,keys)
  const reviewer=await freshLogin(registry.reviewer.id,registry.reviewer.email,f.companyId,keys)
  expect(uploader.actor_user_id).not.toBe(reviewer.actor_user_id)
  const bytes=registry.pdf('current successor '+randomUUID()),reference='SYNTHETIC current successor '+randomUUID(),version=randomUUID()
  const base:NetworkRegistrySourceSubmission={environment:'test',networkActorId:registry.networkActorId,
    validFrom:new Date(Math.floor((Date.now()-3600000)/60000)*60000).toISOString(),
    validUntil:new Date(Math.floor((Date.now()+3600000)/60000)*60000).toISOString(),
    source:{bytesBase64:bytes.toString('base64'),mimeType:'application/pdf',reference,version}}
  // Distinct negative original; an immutable unsigned archive cannot later be
  // upgraded by attaching a receipt to the same bytes/hash/claims identity.
  const missingBytes=registry.pdf('missing issuer negative '+randomUUID())
  const missing=await archiveNetworkRegistrySource({...base,source:{...base.source,bytesBase64:missingBytes.toString('base64'),reference:reference+' missing',version:randomUUID()},companyId:f.companyId,actorUserId:registry.uploader.id})
  expect(missing.missing).toEqual(['authentic_current_network_registry_issuer_and_representation'])
  const missingReview=await reviewNetworkRegistrySource({...missing,companyId:f.companyId,actorUserId:registry.reviewer.id,
    decision:'approve',reason:'SYNTHETIC current successor missing issuer receipt control',clause:registry.clause})
  expect(missingReview.status).toBe('held')
  const claims=sql<Record<string,unknown>>(`SELECT gridex_network_registry_sources.claims_v1(${literal(f.companyId)},${literal(base)}::jsonb);`)
  const payload=Buffer.from(JSON.stringify({format:'ediel_network_registry_receipt_v1',receiptId:randomUUID(),claims,
    sourceHash:sha(bytes),sourceReference:reference,sourceVersion:version,registryVersion:'SYNTHETIC NETWORK ISSUER REGISTRY VERSION1',
    clause:registry.clause,issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+7200000).toISOString()}))
  // Same explicitly synthetic external issuer key as unchanged fixture6d2a78f8.
  const issuerReceipt={keyId:registry.keyId,representationId:registry.representationId,payloadBase64:payload.toString('base64'),
    signatureHex:createHmac('sha256',Buffer.alloc(32,47)).update(payload).digest('hex')}
  const archived=await archiveNetworkRegistrySource({...base,issuerReceipt,companyId:f.companyId,actorUserId:registry.uploader.id})
  expect(archived.missing).toEqual([])
  const reviewed=await reviewNetworkRegistrySource({...archived,companyId:f.companyId,actorUserId:registry.reviewer.id,
    decision:'approve',reason:'SYNTHETIC separate review of genuinely current dated successor',clause:registry.clause})
  expect(reviewed.status).toBe('authorized')
  const metadata=await readNetworkRegistrySourceArtifact({companyId:f.companyId,actorUserId:registry.reviewer.id,artifactId:archived.artifactId})
  const originalBytes=await readNetworkRegistrySourceBytes({companyId:f.companyId,actorUserId:registry.reviewer.id,artifactId:archived.artifactId})
  expect(metadata).toMatchObject({status:'authorized',sourceHash:sha(bytes)})
  expect(Date.parse(metadata.validFrom)).toBe(Date.parse(base.validFrom));expect(Date.parse(metadata.validUntil)).toBe(Date.parse(base.validUntil))
  expect(Buffer.from(originalBytes.bytes)).toEqual(bytes)
  const oldRows=sql(`SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM gridex_network_registry_sources.artifacts v WHERE company_id=${literal(f.companyId)} AND id NOT IN(${literal(missing.artifactId)},${literal(archived.artifactId)});`)
  expect(oldRows).toEqual(predecessor)
  evidence.current_network_successor={artifact_id:archived.artifactId,source_hash:sha(bytes),valid_from:base.validFrom,valid_until:base.validUntil,
    missing_issuer_held:true,separate_current_uploader:uploader,separate_current_reviewer:reviewer,predecessors_unchanged:true}
  persist()
}
async function reservedDraft(f:Fixture){
  const basis=await authorized(f),route=await resolveCanonicalOutboundContext({companyId:f.companyId,environment:'test',
    requestType:'supplier_switch',receiverEdielId:f.receiver,preferredRouteId:f.routeId,applicationReference:'23-DDQ-PRODAT'})
  const operationId=randomUUID(),reference=randomUUID().replaceAll('-','').slice(0,14)
  const intent=await createEdielMessageIntent({companyId:f.companyId,environment:'test',market:'electricity',messageFamily:'PRODAT',messageCode:'Z03',
    businessProcess:'supplier_switch',direction:'outbound',senderEdielId:route.senderEdielId,senderSubaddress:route.senderSubAddress,
    receiverEdielId:route.receiverEdielId,receiverSubaddress:route.receiverMessageSubAddress??route.receiverSubAddress,
    applicationReference:'23-DDQ-PRODAT',routeProfileId:route.routeRuntime!.route_profile_id!,communicationRouteId:route.route.id,
    customerId:f.customerId,customerSiteId:f.siteId,supplierSwitchRequestId:f.switchId,meteringPointId:f.external,gridAreaCode:f.gridAreaCode,
    operationId,interchangeReference:reference,messageReference:'1',transactionReference:f.li,idempotencyKey:`switch-cancellation:${f.original.id}`,
    payload:{actorRole:'supplier',switchCancellationOperationId:operationId,transactionSubtype:'C'},actorUserId:f.actorUserId,
    routeProfile:{applicationReference:'23-DDQ-PRODAT',actorRole:'supplier'}})
  const outbound=await createOutboundRequest({actorUserId:f.actorUserId,customerId:f.customerId,siteId:f.siteId,meteringPointId:f.pointId,
    requestType:'supplier_switch',sourceType:'manual',sourceId:intent.id,communicationRouteId:route.route.id,operationId,
    environment:'test',failOnMissingEnvironment:true,payload:{switchCancellationOperationId:operationId,transactionSubtype:'C',intentId:intent.id}})
  expect(await reserveSwitchCancellationSource({...request(f),intentId:intent.id,outboundRequestId:outbound.id})).toMatchObject({status:'reserved',operationId,messageId:null})
  const built=await buildSwitchCancellationDraft({actorUserId:f.actorUserId,basis,intent,routeContext:route,outboundRequestId:outbound.id})
  return {basis,route,operationId,intent,built}
}
async function refuseCalendar(name:string,f:Fixture,targetDay:string){
  await phase(name,targetDay,f)
  const before={domain:domain(f),cancellation:cancellationState(f)},decoyBefore={domain:domain(decoy),cancellation:cancellationState(decoy)}
  const source=await readSwitchCancellationSource(request(f));expect(source).toEqual({status:'held',missing:['source_z03_cancellation_calendar_window']})
  expect(await prepareAndQueueSwitchCancellation(request(f))).toEqual(source)
  unchanged(f,before,decoyBefore)
  cases.push({name,status:'PASSED',exact_refusal:'source_z03_cancellation_calendar_window',company_id:f.companyId,
    original_id:f.original.id,policy_day:day(),original_hash:sha(f.original.raw_payload!),no_effects:true,decoy_unchanged:true});persist()
}

describe.sequential('AT-Z03C supplementary lawful boundary native',()=>{
  beforeAll(async()=>{
    if(process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||process.env.GRIDEX_Z03C_CLOCK_CAPABILITY_ADMITTED!=='1')throw Error('z03c_admitted_disposable_hosted_clock_only')
    const control=JSON.parse(readFileSync(process.env.GRIDEX_Z03C_CLOCK_CONTROL??'','utf8'))
    if(control.admitted!==true||control.mode!=='native')throw Error('z03c_current_clock_controller_required')
    vi.stubEnv('GRIDEX_EDIEL_CASE_TEST_PASSWORD',password)
    ordinaryDay=day();evidence.ordinary_clock=actualClocks();evidence.ordinary_policy_day=ordinaryDay
    missingLI=await birth('missing-own-LI','L');mutation=await birth('bound-mutation','L')
    L_A=await birth('L_A','L');L_B=await birth('L_B','L');LK_A=await birth('LK_A','LK');decoy=await birth('unrelated-decoy','L')
    expect(Date.parse(plusDays(LK_A.start,1))).toBeLessThan(Date.parse(plusDays(L_A.start,-4)))
    expect(Date.parse(plusDays(L_A.start,-4))).toBeLessThan(Date.parse(plusDays(L_B.start,-3)))
    persist()
  })
  it('C03-MISSING-OWN-LI-OWNER-REFUSAL',async()=>{
    const f=missingLI,{basis,route,operationId,intent,built}=await reservedDraft(f)
    const decoded=EdifactEnvelopeCodec.decode(built.draft.rawPayload!),unh=decoded.segments.findIndex(s=>s.tag==='UNH'),unt=decoded.segments.findIndex(s=>s.tag==='UNT')
    if(!decoded.sender||!decoded.receiver||!decoded.interchangeReference||unh<0||unt<=unh)throw Error('z03c_lawful_prospective_envelope_required')
    const body=decoded.segments.slice(unh+1,unt).filter(s=>!(s.tag==='RFF'&&segmentComposite(s,1,decoded.una)[0]==='LI')).map(s=>s.raw)
    const raw=EdifactEnvelopeCodec.encode({sender:decoded.sender,receiver:decoded.receiver,senderQualifier:decoded.senderQualifier,
      receiverQualifier:decoded.receiverQualifier,senderSubAddress:decoded.senderSubAddress,receiverSubAddress:decoded.receiverSubAddress,
      applicationReference:decoded.applicationReference,environment:decoded.environment,acknowledgementRequest:decoded.acknowledgementRequest==='1',
      interchangeReference:decoded.interchangeReference,una:decoded.una,messages:[{messageReference:decoded.segments[unh].elements[1],messageTypeToken:decoded.segments[unh].elements[2],businessSegments:body}]})
    expect(validateEdifactEnvelope(raw).ok).toBe(true)
    expect(tokenizeEdifact(raw).segments.filter(s=>s.tag==='RFF'&&segmentComposite(s,1,decoded.una)[0]==='LI')).toEqual([])
    const before={domain:domain(f),cancellation:cancellationState(f)},decoyBefore={domain:domain(decoy),cancellation:cancellationState(decoy)}
    await expect(prepareSwitchCancellationCustomerMasterdataContext({companyId:f.companyId,operationId,actorUserId:f.actorUserId,
      intentId:intent.id,routeId:route.route.id,customerId:f.customerId,environment:'test',switchRequestId:f.switchId,
      originalMessageId:f.original.id,originalHash:basis.originalHash,rawPayload:raw,sourceContext:built.sourceCustomerMasterdataContext}))
      .rejects.toMatchObject({code:'P0001',message:'customer_masterdata_cancellation_actual_wire_required'})
    unchanged(f,before,decoyBefore)
    cases.push({name:'C03-MISSING-OWN-LI-OWNER-REFUSAL',status:'PASSED',exact_refusal:'customer_masterdata_cancellation_actual_wire_required',
      lawful_reservation_baseline:true,no_bound_message_or_queue:true,no_effects:true,decoy_unchanged:true});persist()
  })
  it('C03-BOUND-MUTATION-REFUSAL',async()=>{
    const f=mutation,result=await prepareAndQueueSwitchCancellation(request(f))
    expect(result.status).toBe('queued');if(!('message'in result))throw Error('z03c_real_bound_message_required')
    const before={domain:domain(f),cancellation:cancellationState(f)},decoyBefore={domain:domain(decoy),cancellation:cancellationState(decoy)}
    const fields=[{patch:{raw_payload:result.message.raw_payload+' '},code:'23514',message:'immutable_ediel_payload_cannot_change'},
      {patch:{direction:'inbound'},code:'P0001',message:'switch_cancellation_bound_message_immutable'},
      {patch:{original_message_id:decoy.original.id},code:'P0001',message:'switch_cancellation_bound_message_immutable'}]
    for(const {patch,code,message} of fields){
      const updated=await supabaseService.from('ediel_messages').update(patch).eq('company_id',f.companyId).eq('id',result.message.id).select('id')
      expect(updated.error).toMatchObject({code,message})
      expect(updated.data).toBeNull();unchanged(f,before,decoyBefore)
    }
    cases.push({name:'C03-BOUND-MUTATION-REFUSAL',status:'PASSED',exact_refusals:['23514:immutable_ediel_payload_cannot_change','P0001:switch_cancellation_bound_message_immutable'],
      fields:['raw_payload','direction','original_message_id'],actual_trigger_not_rls_zero_rows:true,no_effects:true,decoy_unchanged:true});persist()
  })
  it('C03-LK-DAY1-HOLD',async()=>{await refuseCalendar('C03-LK-DAY1-HOLD',LK_A,plusDays(LK_A.start,1))})
  it('C03-L4-ALLOW',async()=>{
    const f=L_A;await phase('C03-L4-ALLOW',plusDays(f.start,-4),f);await renewCurrentNetworkSource(f)
    const source=await authorized(f);expect(source).toMatchObject({originalSubtype:'L',deadline:plusDays(f.start,-4)})
    const beforeDomain=domain(f),decoyBefore={domain:domain(decoy),cancellation:cancellationState(decoy)},before=cancellationState(f)
    const result=await prepareAndQueueSwitchCancellation(request(f));expect(result.status).toBe('queued')
    if(!('message'in result))throw Error('z03c_actual_l4_cancellation_required')
    const message=(await getEdielMessageById(result.message.id))!
    expect(message).toMatchObject({company_id:f.companyId,direction:'outbound',message_family:'PRODAT',message_code:'Z03',
      original_message_id:f.original.id,switch_request_id:f.switchId,customer_id:f.customerId,site_id:f.siteId,metering_point_id:f.pointId,
      application_reference:'23-DDQ-PRODAT',sender_ediel_id:f.sender,receiver_ediel_id:f.receiver,transaction_reference:f.li})
    const wire=tokenizeEdifact(message.raw_payload!),cav=wire.segments.filter(s=>s.tag==='CCI'&&segmentComposite(s,2,wire.una)[0]==='Z13')
    expect(validateEdifactEnvelope(message.raw_payload!).ok).toBe(true);expect(cav).toHaveLength(1)
    expect(segmentComposite(wire.segments[wire.segments.indexOf(cav[0])+1],1,wire.una)).toEqual(['Z24'])
    expect(segmentComposite(wire.segments.find(s=>s.tag==='BGM'),1,wire.una)[0]).toBe('Z03')
    expect(wire.segments.filter(s=>s.tag==='RFF'&&segmentComposite(s,1,wire.una)[0]==='LI').map(s=>segmentComposite(s,1,wire.una)[1])).toEqual([f.li])
    const effects=sql<Record<string,unknown>>(`SELECT jsonb_build_object(
      'switch',(SELECT jsonb_build_object('status',status,'completed_at',completed_at,'original',outbound_z03_message_id) FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)} AND company_id=${literal(f.companyId)}),
      'origins',(SELECT count(*) FROM gridex_switch_cancellations.origins WHERE company_id=${literal(f.companyId)} AND switch_id=${literal(f.switchId)} AND original_message_id=${literal(f.original.id)} AND message_id=${literal(message.id)} AND payload_hash=${literal(sha(message.raw_payload!))}),
      'intents',(SELECT count(*) FROM public.ediel_message_intents WHERE company_id=${literal(f.companyId)} AND id=${literal(message.intent_id)} AND operation_id=${literal(message.source_operation_id)}::uuid AND ediel_message_id=${literal(message.id)} AND outbox_status='queued'),
      'requests',(SELECT count(*) FROM public.outbound_requests WHERE company_id=${literal(f.companyId)} AND id=${literal(message.outbound_request_id)} AND source_id=${literal(message.intent_id)}::uuid AND operation_id=${literal(message.source_operation_id)}::uuid),
      'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(message.id)}));`)
    expect(effects).toEqual({switch:{status:'cancellation_requested',completed_at:null,original:f.original.id},origins:1,intents:1,requests:1,outbox:1})
    expect(domain(f)).toEqual(beforeDomain);expect(originalSeal(f)).toEqual(f.seal)
    expect({domain:domain(decoy),cancellation:cancellationState(decoy)}).toEqual(decoyBefore)
    expect((cancellationState(f).messages as unknown[]).length).toBe((before.messages as unknown[]).length+1)
    cases.push({name:'C03-L4-ALLOW',status:'PASSED',policy_day:day(),deadline:source.deadline,original_id:f.original.id,message_id:message.id,
      physical_c03_hash:sha(message.raw_payload!),effects,queued_is_not_completed:true,no_domain_activation:true,decoy_unchanged:true});persist()
  })
  it('C03-L3-HOLD',async()=>{await refuseCalendar('C03-L3-HOLD',L_B,plusDays(L_B.start,-3))})
})
