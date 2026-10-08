// masterplan: AT-Z13V-ESCO, AT-Z13VH-ESCO
// Request/ACK and prospective public Z14-to-grant proof. Whole-card approval
// additionally needs the declared business-role/direction/R-D refusals.
// Only disposable identities, legal issuer inputs, counterpart bytes and
// external SMTP are synthetic. All archive/review/send/intake/ACK owners run.
import {createHash,randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {seedNativeEscoFixture as seed,prepareNativeEscoPermissionFixture as prepare,
 resetNativeEscoFixture,nativeEscoSql as sql,nativeEscoLiteral as lit,
 nativeEscoExternal,NATIVE_ESCO_DB} from './fixtures/ediel-service-evidence-native'
import {seedOriginalMailboxNative} from './helpers/originalMailboxNative'
import {readEdielServiceAdministration} from '@/lib/ediel/services/administration'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {matchOutboundRequestForInbound} from '@/lib/inbound-mail/inboundMatcher'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {readCommittedInboundAck} from '@/lib/ediel/ack/committedInboundAck'
import {readPhysicalAckSourceCorrelation} from '@/lib/ediel/ack/sourceCorrelation'
import {getEdielMessageById} from '@/lib/ediel/db'
import {renderContrl2Ediel2} from '@/lib/ediel/contrlEngine'
import {renderAperakEdiel} from '@/lib/ediel/aperakEngine'
import {renderProdat} from '@/lib/ediel/prodatEngine'
import {readReceivedProdatFinalResponsePlan} from '@/lib/ediel/core/receivedProdatFinalResponsePlan'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalAckGuide} from '@/lib/ediel/rulebook/ackGuidePolicy'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {edielSmtpConfig} from '@/lib/ediel/mailReadiness'
import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'

type Fixture=Awaited<ReturnType<typeof seed>>
type Pending=Awaited<ReturnType<typeof prepare>>
const hash=(raw:string)=>createHash('sha256').update(raw).digest('hex')
beforeEach(resetNativeEscoFixture)
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})

async function request(mode:'V'|'VH',objectReply=false){
 const seeded=await seed(mode)
 configureProspectiveAckRoute(seeded)
 const objectAckProfile=objectReply?configureProspectiveAckRoute(seeded,'APERAK'):null
 let f=seeded
 const sentinel=sql(`SELECT to_jsonb(a) FROM public.ediel_service_assignments a WHERE id=${lit(seeded.assignment)}`)
 if(mode==='VH'){
  // Prospective public input, before approval/archival/request. The shared
  // fixture's future-end assignment stays held and byte-for-byte unchanged.
  const day=sql<string>(`SELECT to_jsonb(((clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date-1)::text)`)
  const fields={...seeded.fields,data_end:day+'T00:00:00Z'}
  const created=await seeded.command({action:'create_assignment',commandId:randomUUID(),fields})
  expect(created).toMatchObject({status:'held'})
  const assignment=String(created.assignmentId)
  expect(assignment).not.toBe(seeded.assignment)
  f={...seeded,fields,assignment,current:()=>sql(`SELECT jsonb_build_object('version',version,'basis',scope_basis_version,
   'scope',gridex_service_administration.scope_v1(a),
   'hash',encode(sha256(convert_to(gridex_service_administration.scope_v1(a)::text,'UTF8')),'hex'))
   FROM public.ediel_service_assignments a WHERE company_id=${lit(seeded.ids.company)} AND id=${lit(assignment)}`)}
 }
 const p=await prepare(f)
 const wire=EdifactEnvelopeCodec.decode(p.z13.raw_payload!)
 expect(p.z13).toMatchObject({company_id:f.ids.company,direction:'outbound',environment:'test',message_code:'Z13',status:'sent',application_reference:'23-DGI-PRODAT'})
 expect([wire.sender,wire.receiver]).toEqual([f.sender,f.receiver])
 expect(wire.segments.find(s=>s.tag==='BGM')?.elements[1]).toBe('Z13')
 expect(wire.segments.filter(s=>s.tag==='LIN')).toHaveLength(1)
 expect(wire.segments.find(s=>s.tag==='LIN')?.elements[1]).toBe('1')
 expect(wire.segments.find(s=>s.tag==='LIN')?.raw).toBe('LIN+1')
 expect(wire.segments.some(s=>s.tag==='DTM'&&segmentComposite(s,1,wire.una)[0]==='329')).toBe(false)
 expect(wire.segments.filter(s=>s.tag==='NAD'&&segmentComposite(s,1,wire.una)[0]==='UD')
  .map(s=>segmentComposite(s,2,wire.una)[0])).toEqual(['199001011234'])
 expect(wire.segments.find(s=>s.tag==='CCI'&&s.raw==='CCI++Z13')).toBeTruthy()
 expect(wire.segments.some(s=>s.raw===(mode==='V'?'CAV+S17':'CAV+S18'))).toBe(true)
 expect(sql(`SELECT to_jsonb(immutable_payload_hash) FROM public.ediel_messages WHERE id=${lit(p.z13.id)}`)).toBe(hash(p.z13.raw_payload!))
 expect(p.z13.message_sent_at).toBeTruthy()
 expect(nativeEscoExternal.send).toHaveBeenCalledTimes(1)
 const checkSentinel=()=>{
  if(mode==='VH')expect(sql(`SELECT to_jsonb(a) FROM public.ediel_service_assignments a WHERE id=${lit(seeded.assignment)}`)).toEqual(sentinel)
 }
 checkSentinel()
 return{f,p,checkSentinel,objectAckProfile}
}

// External configuration input only, supplied before archive/send/ACK birth.
// The shared E66 profile remains unchanged; the protected route selector,
// source authority, real draft persistence and outbox insertion still run.
function configureProspectiveAckRoute(f:Fixture,family:'CONTRL'|'APERAK'='CONTRL'){
 const profile=randomUUID(),smtp=edielSmtpConfig()
 const images=(exclude?:string)=>sql(`SELECT jsonb_build_object(
  'routes',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.communication_routes r WHERE company_id IN (${lit(f.ids.company)},${lit(f.ids.beneficiary)})),
  'profiles',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.ediel_route_profiles p WHERE company_id IN (${lit(f.ids.company)},${lit(f.ids.beneficiary)})${exclude?` AND id<>${lit(exclude)}`:''}))`)
 const before=images()
 sql(`INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,
  message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,
  mailbox,smtp_host,smtp_port,smtp_to,receiver_email,message_family,business_code,
  sender_subaddress,sender_sub_address,receiver_subaddress,receiver_sub_address,transport_profile_id)
  SELECT ${lit(profile)},company_id,communication_route_id,${lit('Synthetic '+family+' only')},environment,
  message_standard,payload_format,sender_ediel_id,receiver_ediel_id,${lit(f.app)},is_enabled,is_active,
  mailbox,smtp_host,smtp_port,smtp_to,receiver_email,${lit(family)},${lit(family)},
  sender_subaddress,sender_sub_address,receiver_subaddress,receiver_sub_address,transport_profile_id
  FROM public.ediel_route_profiles WHERE id=${lit(f.ids.ackProfile)} AND company_id=${lit(f.ids.company)}`)
 expect(images(profile)).toEqual(before)
 // These are actual configured candidates, not a fabricated route capability.
 // The native selector must independently qualify this same unique input.
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.communication_routes r
  JOIN public.ediel_route_profiles p ON p.communication_route_id=r.id AND p.company_id=r.company_id
  LEFT JOIN public.ediel_transport_profiles tp ON tp.id=p.transport_profile_id AND tp.company_id=p.company_id AND tp.environment='test'
  WHERE r.company_id=${lit(f.ids.company)} AND r.is_active AND r.route_scope='ediel_ack'
  AND r.environment_type::text IN ('tgt_test','agt_test','bilateral_test')
  AND p.environment='test' AND p.is_enabled AND p.is_active AND p.message_standard='edifact' AND p.payload_format='edifact'
  AND (p.message_family IS NULL OR p.message_family=${lit(family)}) AND (p.business_code IS NULL OR p.business_code=${lit(family)})
  AND p.sender_ediel_id=${lit(f.sender)} AND p.receiver_ediel_id=${lit(f.receiver)}
  AND coalesce(p.sender_subaddress,p.sender_sub_address,'')='' AND coalesce(p.receiver_subaddress,p.receiver_sub_address,'')=''
  AND (p.sender_subaddress IS NULL OR p.sender_sub_address IS NULL OR p.sender_subaddress=p.sender_sub_address)
  AND (p.receiver_subaddress IS NULL OR p.receiver_sub_address IS NULL OR p.receiver_subaddress=p.receiver_sub_address)
  AND p.application_reference=${lit(f.app)} AND p.mailbox=${lit(smtp.from)}
  AND r.target_email~'^[^[:space:]@<>]+@[^[:space:]@<>]+\\.[^[:space:]@<>]+$'
  AND ((p.transport_profile_id IS NULL AND p.smtp_host=${lit(smtp.host)} AND p.smtp_port=${lit(smtp.port)})
   OR(tp.id IS NOT NULL AND tp.is_active AND tp.transport_channel='smtp' AND tp.direction IN ('outbound','both')
    AND tp.sender_email=${lit(smtp.from)} AND tp.host=${lit(smtp.host)} AND tp.port=${lit(smtp.port)}
    AND (p.smtp_host IS NULL OR p.smtp_host=${lit(smtp.host)}) AND (p.smtp_port IS NULL OR p.smtp_port=${lit(smtp.port)})))`)).toBe(1)
 return profile
}

// Full row images, not count-only absence assertions. Journal/status deltas
// live in ACK state; legal scope, foreign tenant, data and supply must not move.
function business(f:Fixture,p:Pending){
 const companies=`(${lit(f.ids.company)},${lit(f.ids.beneficiary)})`
 const tables=['companies','customers','customer_sites','metering_points','ediel_service_assignments',
  'ediel_service_evidence','ediel_assignment_permission_links','ediel_data_access_grants',
  'customer_supply_periods','supplier_switch_requests','meter_reading_series','meter_reading_values',
  'metering_permission_sites','ediel_service_history','communication_routes','ediel_route_profiles']
 const rows=tables.map(table=>`'${table}',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.${table} r WHERE ${table==='companies'?'id':'company_id'} IN ${companies})`)
 return sql<Record<string,unknown>>(`SELECT jsonb_build_object(${rows.join(',')},
  'permissions',(SELECT coalesce(jsonb_agg(CASE WHEN r.id=${lit(p.permissionId)} THEN to_jsonb(r)-ARRAY['status','updated_at','updated_by'] ELSE to_jsonb(r) END ORDER BY r.id),'[]') FROM public.metering_permissions r WHERE company_id IN ${companies}),
  'permissionEffects',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') FROM gridex_received_sources.permission_effect_receipts r WHERE company_id IN ${companies}),
  'permissionTransitions',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') FROM gridex_received_sources.permission_effect_transitions_v1 r WHERE company_id IN ${companies}),
  'origins',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.intent_id),'[]') FROM gridex_service_permission.origins r WHERE company_id IN ${companies}),
  'transportAttempts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM gridex_ediel_transport.attempts r WHERE company_id IN ${companies}),
  'sealedOriginal',(SELECT jsonb_build_object('id',id,'company',company_id,'environment',environment,'direction',direction,
   'family',message_family,'code',message_code,'standard',message_standard,'raw',raw_payload,'hash',immutable_payload_hash,
   'rendered',immutable_rendered_at,'sent',message_sent_at,'sender',sender_ediel_id,'receiver',receiver_ediel_id,
   'application',application_reference,'interchange',interchange_reference,'transaction',transaction_reference,
   'route',communication_route_id,'routeProfile',route_profile_id,'intent',intent_id,'request',outbound_request_id,
   'operation',source_operation_id,'customer',customer_id,'site',site_id,'point',metering_point_id,
   'executionContext',execution_context_snapshot) FROM public.ediel_messages WHERE id=${lit(p.z13.id)}),
  'exports',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM gridex_ediel_exports.jobs r WHERE beneficiary_company_id=${lit(f.ids.beneficiary)}),
  'foreignMessages',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.ediel_messages r WHERE company_id=${lit(f.ids.beneficiary)}))`)
}
function ackState(f:Fixture,p:Pending){
 return sql(`SELECT jsonb_build_object(
  'correlations',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.ack_message_id),'[]') FROM gridex_ack_authority.source_correlations r WHERE source_message_id=${lit(p.z13.id)}),
  'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.ack_message_id),'[]') FROM gridex_ack_authority.applied_receipts r JOIN gridex_ack_authority.source_correlations c USING(ack_message_id) WHERE c.source_message_id=${lit(p.z13.id)}),
  'original',(SELECT to_jsonb(r) FROM public.ediel_messages r WHERE id=${lit(p.z13.id)}),
  'requests',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.outbound_requests r WHERE company_id=${lit(f.ids.company)}),
  'effects',${lit(f.effects())}::jsonb)`)
}
async function permission(f:Fixture,p:Pending){
 const result=await supabaseService.from('metering_permissions').select('*').eq('company_id',f.ids.company).eq('id',p.permissionId).single()
 if(result.error)throw result.error
 expect(result.data).toMatchObject({source_z13_message_id:p.z13.id,source_z14_message_id:null,inbound_z14_message_id:null,approved_start_date:null,approved_end_date:null})
 return result.data
}

async function withPermissionShare<T>(action:(signal:AbortSignal)=>Promise<T>):Promise<T>{
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321'
  ||NATIVE_ESCO_DB!=='postgresql://postgres:postgres@127.0.0.1:54322/postgres')throw Error('synthetic_local_native_only')
 const holder=spawn('psql',[NATIVE_ESCO_DB,'-XAtq','-v','ON_ERROR_STOP=1'],{stdio:'pipe'})
 const abort=new AbortController()
 let closed=false,expired=false,output=''
 const completion=new Promise<number|null>(resolve=>holder.once('close',code=>{closed=true;resolve(code)}))
 let refuse:(error:Error)=>void=()=>{}
 const ready=new Promise<void>((resolve,reject)=>{
  refuse=reject
  holder.once('error',()=>reject(Error('native_permission_holder_start_failed')))
  holder.once('exit',()=>reject(Error('native_permission_holder_exit_before_ready')))
  holder.stdout.on('data',chunk=>{
   output+=String(chunk)
   if(output.includes('NATIVE_PERMISSION_SHARE_READY\n'))resolve()
  })
 })
 // Consume diagnostics privately; never forward a child connection string.
 holder.stderr.on('data',()=>{})
 holder.stdin.on('error',()=>{})
 const timeout=setTimeout(()=>{
  expired=true;abort.abort();holder.kill('SIGTERM');refuse(Error('native_permission_holder_timeout'))
 },15000)
 try{
  holder.stdin.write("BEGIN; SET LOCAL idle_in_transaction_session_timeout='15s'; LOCK TABLE public.metering_permissions IN SHARE MODE; SELECT 'NATIVE_PERMISSION_SHARE_READY';\n")
  await ready
  return await action(abort.signal)
 }finally{
  if(!closed&&!holder.stdin.destroyed)holder.stdin.end('ROLLBACK;\n')
  const exit=await completion
  clearTimeout(timeout)
  if(expired||exit!==0)throw Error('native_permission_holder_cleanup_failed')
 }
}

async function proveWaitingLockRollback(f:Fixture,p:Pending,message:EdielMessageRow){
 // Real-owner preparation for an isolated public-RPC atomicity control.
 // Intake itself did not mint a canonical assessment. Use the same actual
 // resolver/ledger owners as the processor, with no invented facts or status.
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message,{actorUserId:f.ids.actor})
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision]).toEqual(['accepted','accepted','accepted'])
 const recorded=await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:f.ids.company,decision})
 expect(recorded.status).toBe('recorded')
 if(recorded.status!=='recorded')throw Error('native_actual_canonical_owner_required')
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.validation_assessments v
  WHERE id=${lit(recorded.assessmentId)} AND source_message_id=${lit(message.id)} AND company_id=${lit(f.ids.company)}
  AND environment='test' AND source_payload_hash=${lit(hash(message.raw_payload!))}
  AND facts_text::jsonb->>'syntaxDecision'='accepted' AND facts_text::jsonb->>'applicationDecision'='accepted'
  AND facts_text::jsonb->>'functionalDecision'='accepted'
  AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)`)).toBe(1)
 const full=()=>sql(`SELECT jsonb_build_object(
  'received',(SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${lit(message.id)}),
  'outcomes',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') FROM gridex_ack_authority.scope_outcomes r WHERE source_message_id=${lit(p.z13.id)}),
  'chains',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') FROM public.ediel_ack_chains r WHERE source_message_id=${lit(p.z13.id)}),
  'physical',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.ack_message_id),'[]') FROM gridex_ack_authority.prodat_physical_receipts r WHERE source_message_id=${lit(p.z13.id)}))`)
 const before=business(f,p),pending=await permission(f,p),acks=ackState(f,p),queues=fullOutbox(f),physical=full()
 await withPermissionShare(async signal=>{
  const result=await supabaseService.rpc('gridex_apply_inbound_ack_source_v1',{
   p_company_id:f.ids.company,p_environment:'test',p_ack_message_id:message.id,p_source_message_id:p.z13.id,p_actor_user_id:f.ids.actor,
  }).abortSignal(signal)
  expect(result.error?.code).toBe('55P03')
  expect(result.data).toBeNull()
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ack_authority.source_correlations WHERE ack_message_id=${lit(message.id)}`)).toBe(0)
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ack_authority.applied_receipts WHERE ack_message_id=${lit(message.id)}`)).toBe(0)
  expect(ackState(f,p)).toEqual(acks);expect(await permission(f,p)).toEqual(pending)
  expect(business(f,p)).toEqual(before);expect(fullOutbox(f)).toEqual(queues);expect(full()).toEqual(physical)
 })
 // Holder is closed before the unchanged full public processor runs below.
 expect(ackState(f,p)).toEqual(acks);expect(await permission(f,p)).toEqual(pending)
 expect(business(f,p)).toEqual(before);expect(fullOutbox(f)).toEqual(queues);expect(full()).toEqual(physical)
}
async function noAccess(f:Fixture,p:Pending){
 const read=await readEdielServiceAdministration({companyId:f.ids.company,actorUserId:f.ids.actor,assignmentId:f.assignment})
 expect(read).toMatchObject({companyId:f.ids.company,marketActivationGranted:false,grants:[]})
 expect(read.assignments).toHaveLength(1)
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.permission_effect_receipts WHERE company_id=${lit(f.ids.company)}`)).toBe(0)
 await permission(f,p)
}

function counterpart(p:Pending,family:'CONTRL'|'APERAK',defect?:'unknown'|'wrongLI'|'negative'){
 const e=EdifactEnvelopeCodec.decode(p.z13.raw_payload!)
 let segments=family==='CONTRL'
  ?renderContrl2Ediel2({source:{rawPayload:p.z13.raw_payload},outcome:'positive'}).segments
  :renderAperakEdiel({source:{id:p.z13.id,messageFamily:'PRODAT',messageCode:'Z13',rawPayload:p.z13.raw_payload},refs:{},
   externalReference:randomUUID(),transactionReference:randomUUID(),outcome:'positive'}).segments
 // Declared counterpart bytes, before mailbox birth. Do not fabricate a
 // qualified local negative-diagnostic capability for the production renderer.
 if(defect==='negative'){
  // A synthetic external rejection of the actual object field 223. This does not
  // claim that our locally valid Z13 is invalid or mint a local diagnostic.
  const reasonIndex=e.segments.findIndex(s=>s.raw==='CCI++Z13')
  expect(reasonIndex).toBeGreaterThanOrEqual(0)
  const receivedReason=segmentComposite(e.segments[reasonIndex+1],1,e.una)[0]
  expect(['S17','S18']).toContain(receivedReason)
  expect(e.segments[reasonIndex+1].tag).toBe('CAV')
  // BGM34 means processed object outcome. BGM27/header202 would reject the
  // whole message and cannot assert this object's final refusal contract.
  segments=segments.map(s=>s==='ERC+100::260'?'ERC+42::260'
   :s==='FTX+AAO+++OK'?`FTX+AAO++223::260+Felaktigt Transaktionstyp (undertyp) ${receivedReason}`:s)
 }
 if(defect==='unknown')segments=segments.map(s=>s.startsWith('UCI+')?s.replace(/^(UCI\+)[^+]*/,'$1UNKNOWN'):s.startsWith('RFF+ACW:')?'RFF+ACW:UNKNOWN':s)
 if(defect==='wrongLI')segments=segments.map(s=>s.startsWith('RFF+LI:')?'RFF+LI:UNKNOWN':s)
 const raw=EdifactEnvelopeCodec.encode({sender:e.receiver!,receiver:e.sender!,senderQualifier:e.receiverQualifier,receiverQualifier:e.senderQualifier,
  senderSubAddress:e.receiverSubAddress,receiverSubAddress:e.senderSubAddress,applicationReference:e.applicationReference,
  acknowledgementRequest:false,environment:'test',interchangeReference:randomUUID().replaceAll('-','').slice(0,14),
  messages:[{messageReference:randomUUID().replaceAll('-','').slice(0,14),messageTypeToken:family==='CONTRL'?'CONTRL:2:2:UN:EDIEL2':'APERAK:D:96A:UN:E2SE6A',businessSegments:segments}]})
 if(defect==='negative'){
  const wire=tokenizeEdifact(raw),date=segmentComposite(wire.segments.find(s=>s.tag==='DTM'&&s.raw.startsWith('DTM+137:')),1,wire.una)[1]
  expect(date).toMatch(/^\d{12}$/)
  const policy=resolveCanonicalEdielPolicy({family:'APERAK',messageCode:'APERAK',direction:'inbound',
   associationAssignedCode:segmentComposite(wire.segments.find(s=>s.tag==='UNH'),2,wire.una)[4],
   applicationReference:e.applicationReference,referenceDate:`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`,mode:'parse'})
  expect(validateCanonicalAckGuide({policy,rawPayload:raw,rawSegments:wire.segments.map(s=>s.raw),una:wire.una,sourceRawPayload:p.z13.raw_payload})).toEqual([])
  const physical=readPhysicalAckSourceCorrelation({...p.z13,direction:'inbound',message_family:'APERAK',raw_payload:raw},p.z13)
  expect(physical.classification.outcome).toBe('negative')
  expect(physical.scope).toBe('object')
  expect(physical.acknowledgedReferences).toEqual([p.li])
 }
 return raw
}
async function retained(f:Fixture,raw:string){
 const mail=await seedOriginalMailboxNative(sql,lit,{companyId:f.ids.company,environment:'test',raw,smtpFrom:'esco-native@example.invalid'})
 const outboundMatch=await matchOutboundRequestForInbound({companyId:f.ids.company,parsed:mail.parsed,
  inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId})
 return{companyId:f.ids.company,actorUserId:f.ids.actor,environment:'test',parsed:mail.parsed,
  inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,outboundMatch}
}
function fullOutbox(f:Fixture){
 return sql<Record<string,unknown>[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.ediel_outbox r WHERE company_id IN (${lit(f.ids.company)},${lit(f.ids.beneficiary)})`)
}
async function intake(f:Fixture,p:Pending,raw:string){
 const queuedBefore=fullOutbox(f)
 const input=await retained(f,raw),id=await createInboundEdielMessage(input)
 expect(fullOutbox(f)).toEqual(queuedBefore)
 expect(id).toBeTruthy();if(!id)throw new Error('native_esco_physical_intake_required')
 const message=(await getEdielMessageById(id))!
 expect(message).toMatchObject({company_id:f.ids.company,direction:'inbound',environment:'test',raw_payload:raw,
  inbound_email_message_id:input.inboundEmailMessageId,mailbox_message_id:input.inboundEmailMessageId,immutable_payload_hash:hash(raw)})
 expect(Date.parse(message.message_received_at!)).toBeGreaterThan(Date.parse(p.z13.message_sent_at!))
 return message
}
async function consume(f:Fixture,message:EdielMessageRow){
 const before=fullOutbox(f)
 const committed=await readCommittedInboundAck({actorUserId:f.ids.actor,message})
 try{await processInboundEdielMessage({actorUserId:f.ids.actor,edielMessageId:message.id})}
 catch(error){observeAckFailure(f,message);throw error}
 const after=fullOutbox(f)
 // APERAK receives its own syntax CONTRL through the real public processor.
 // Preserve every old/foreign queue row; admit only that one source-bound
 // technical response. A replay and CONTRL itself create no queue entry.
 for(const row of before)expect(after.find(candidate=>candidate.id===row.id)).toEqual(row)
 const added=after.filter(row=>!before.some(previous=>previous.id===row.id))
 if(message.message_family==='APERAK'&&!committed){
  if(added.length!==1)observeAckFailure(f,message)
  expect(added).toHaveLength(1)
  const queued=added[0]
  expect(queued).toMatchObject({company_id:f.ids.company,environment:'test',source_message_id:message.id,
   message_family:'CONTRL',ack_outcome:'positive',status:'queued',attempts:0})
  const response=(await getEdielMessageById(String(queued.ediel_message_id)))!
  expect(response).toMatchObject({company_id:f.ids.company,environment:'test',direction:'outbound',
   message_family:'CONTRL',related_message_id:message.id})
  const physical=readPhysicalAckSourceCorrelation(response,message)
  expect(physical).toMatchObject({scope:'interchange',classification:{outcome:'positive'}})
  expect(physical.acknowledgedReferences).toEqual([EdifactEnvelopeCodec.decode(message.raw_payload!).interchangeReference])
  expect(sql(`SELECT to_jsonb(immutable_payload_hash) FROM public.ediel_messages WHERE id=${lit(response.id)}`)).toBe(hash(response.raw_payload!))
 }else expect(added).toEqual([])
 const stored=(await getEdielMessageById(message.id))!
 expect(stored.raw_payload).toBe(message.raw_payload)
 return readCommittedInboundAck({actorUserId:f.ids.actor,message:stored})
}

// Failure observations disclose only fixed decision states and known counts.
// They never seed authority, repair a source or replace the original failure.
function observeAckFailure(f:Fixture,message:EdielMessageRow){
 try{
  const state=(name:string)=>`CASE WHEN v.facts_text::jsonb->>${lit(name)} IN ('accepted','rejected','not_applicable','manual_review') THEN v.facts_text::jsonb->>${lit(name)} ELSE 'unrecognized' END`
  const observed=sql(`SELECT jsonb_build_object(
   'family',${lit(message.message_family)},
   'canonical',(SELECT coalesce(jsonb_agg(jsonb_build_object('syntax',${state('syntaxDecision')},
    'application',${state('applicationDecision')},'functional',${state('functionalDecision')})),'[]')
    FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=${lit(message.id)}
    AND v.company_id=${lit(f.ids.company)} AND v.environment='test'
    AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)),
   'technicalBlocked',(SELECT count(*) FROM public.ediel_message_events e WHERE e.ediel_message_id=${lit(message.id)}
    AND e.company_id=${lit(f.ids.company)} AND e.event_payload->>'blockedBy'='canonical_inbound_ack_guard'),
   'technicalRouteZero',(SELECT count(*) FROM public.ediel_message_events e WHERE e.ediel_message_id=${lit(message.id)}
    AND e.company_id=${lit(f.ids.company)} AND e.message LIKE '%ediel_technical_ack_route_count:0%'))`)
  console.info('NATIVE_ACK_OBSERVATION '+JSON.stringify(observed))
 }catch{console.info('NATIVE_ACK_OBSERVATION '+JSON.stringify({diagnosticAvailable:false}))}
}

// Declared prospective grid-owner counterpart bytes. This does not choose a
// database profile, mint a canonical assessment or apply a permission.
function positiveZ14(f:Fixture,p:Pending){
 const rendered=renderProdat({code:'Z14',variant:f.mode,mode:'test',
  actor:{senderEdielId:f.receiver,receiverEdielId:f.sender},route:{applicationReference:f.app},
  version:{selectedVersion:'E2SE6A',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A'},
  context:{code:'Z14',bgmReference:randomUUID().replaceAll('-','').slice(0,20),transactionReference:p.li,
   senderEdielId:f.receiver,receiverEdielId:f.sender,legalSenderId:f.receiver,legalReceiverId:f.sender,
   customerName:'Synthetic Customer',customerId:'199001011234',customerIdCodeListQualifier:'SE2',customerIdAgency:'260',customerCountry:'SE',
   meterPointId:f.point,gridAreaId:'TES',reasonForTransaction:f.mode==='V'?'S17':'S18',permissionStatus:'A74',permissionPurpose:'B72',
   permissionId:'SYNTHETIC-PERMISSION-'+p.permissionId.slice(0,8),permissionTimestamp:new Date().toISOString(),
   reportStartDate:f.fields.data_start,reportEndDate:f.fields.data_end,reportingFrequency:'D',energyProductId:f.product,
   observationLength:'60',observationLengthFormat:'806',meteringMethod:'Z04',installationDirection:'E19',
   siteAddress:'Synthetic Street 1',siteCity:'Teststad',sitePostalCode:'12345',siteCountry:'SE',siteIdAgency:'9'}})
 // Request-dependent facts stay with the received reporting owner. This
 // renderer cannot qualify them; the public processor must accept them.
 expect(rendered.issues.filter(x=>x.severity==='error'&&!/_UNDETERMINED$/.test(x.code)),JSON.stringify(rendered.issues)).toEqual([])
 return EdifactEnvelopeCodec.encode({sender:f.receiver,receiver:f.sender,applicationReference:f.app,
  interchangeReference:randomUUID().replaceAll('-','').slice(0,14),environment:'test',acknowledgementRequest:true,
  messages:[{messageReference:'1',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:rendered.segments}]})
}

async function currentPermission(f:Fixture,p:Pending){
 const result=await supabaseService.from('metering_permissions').select('*').eq('company_id',f.ids.company).eq('id',p.permissionId).single()
 if(result.error)throw result.error
 return result.data
}

// Allow only the explicitly asserted own source transition and one exact
// grant. Every prior/foreign row and every other business table stays whole.
function continuationInvariant(image:Record<string,unknown>,f:Fixture,p:Pending,sourceId:string,grantId?:string){
 const result={...image}
 const select=(key:string,changed:(row:Record<string,unknown>)=>boolean)=>{
  result[key]=(image[key] as Record<string,unknown>[]).filter(row=>!changed(row))
 }
 const own=(row:Record<string,unknown>)=>row.company_id===f.ids.company
 select('permissions',row=>own(row)&&row.id===p.permissionId)
 select('metering_permission_sites',row=>own(row)&&row.metering_permission_id===p.permissionId&&row.facility_id===f.point)
 for(const key of ['permissionEffects','permissionTransitions'])select(key,row=>own(row)&&row.permission_id===p.permissionId&&row.source_message_id===sourceId)
 if(grantId){
  select('ediel_data_access_grants',row=>own(row)&&row.id===grantId&&row.assignment_id===f.assignment)
  select('ediel_service_history',row=>own(row)&&row.entity_table==='ediel_data_access_grants'&&row.entity_id===grantId)
 }
 return result
}

async function committedZ14Replies(f:Fixture,p:Pending,source:EdielMessageRow,previous:Record<string,unknown>[],profile:string){
 const after=fullOutbox(f)
 for(const row of previous)expect(after.find(candidate=>candidate.id===row.id)).toEqual(row)
 const added=after.filter(row=>!previous.some(old=>old.id===row.id))
 expect(added).toHaveLength(2)
 expect(added.map(row=>row.message_family).sort()).toEqual(['APERAK','CONTRL'])
 const wire=tokenizeEdifact(source.raw_payload!),line=wire.segments.find(s=>s.tag==='LIN')!
 for(const queue of added){
  expect(queue).toMatchObject({company_id:f.ids.company,environment:'test',source_message_id:source.id,
   ack_outcome:'positive',status:'queued',attempts:0})
  const ack=(await getEdielMessageById(String(queue.ediel_message_id)))!
  expect(ack).toMatchObject({company_id:f.ids.company,environment:'test',direction:'outbound',related_message_id:source.id,
   message_family:queue.message_family,ack_outcome:'positive'})
  const envelope=EdifactEnvelopeCodec.decode(ack.raw_payload!),physical=readPhysicalAckSourceCorrelation(ack,source)
  expect([envelope.sender,envelope.receiver]).toEqual([f.sender,f.receiver])
  expect(physical.classification.outcome).toBe('positive')
  if(ack.message_family==='CONTRL'){
   expect(physical.scope).toBe('interchange')
   expect(physical.acknowledgedReferences).toEqual([EdifactEnvelopeCodec.decode(source.raw_payload!).interchangeReference])
  }else{
   expect(ack.route_profile_id).toBe(profile)
   expect(physical.prodatObjectOutcomes).toEqual([{objectId:f.point,identityAgency:'9',firstLineIndex:line.index,lineItemReference:p.li,outcome:'positive'}])
   expect(envelope.segments.filter(s=>s.tag==='ERC').map(s=>segmentComposite(s,1,envelope.una)[0])).toEqual(['100'])
  }
  expect(sql(`SELECT to_jsonb(immutable_payload_hash) FROM public.ediel_messages WHERE id=${lit(ack.id)}`)).toBe(hash(ack.raw_payload!))
 }
 const plan=await readReceivedProdatFinalResponsePlan({companyId:f.ids.company,sourceMessageId:source.id,rawPayload:source.raw_payload!})
 expect(plan?.plans).toHaveLength(1)
 expect(plan!.plans[0]).toMatchObject({effectKind:'metering_permission',outcome:'positive',objectLineIndices:[line.index]})
 expect(sql(`SELECT jsonb_build_object('source',source_message_id,'company',company_id,'hash',payload_hash,'canonical',canonical_assessment_id,'permission',permission_id,'original',qualified_original_message_id)
  FROM gridex_received_sources.permission_effect_receipts WHERE id=${lit(plan!.plans[0].effectReceiptId)}`)).toEqual({source:source.id,company:f.ids.company,
   hash:hash(source.raw_payload!),canonical:plan!.plans[0].canonicalAssessmentId,permission:p.permissionId,original:p.z13.id})
 return after
}

async function continueToPublishedGrant(f:Fixture,p:Pending,profile:string,checkSentinel:()=>void){
 const before=business(f,p),waiting=await permission(f,p),queues=fullOutbox(f),original=(await getEdielMessageById(p.z13.id))!
 expect(waiting.status).toBe('waiting_for_customer_approval')
 await noAccess(f,p)
 const source=await intake(f,p,positiveZ14(f,p))
 expect(source).toMatchObject({message_family:'PRODAT',message_code:'Z14'})
 expect(business(f,p)).toEqual(before)
 // The first source/domain invocation is the real public processor. Public
 // birth must choose V/VH itself; a missing selector is genuine RED here.
 await processInboundEdielMessage({actorUserId:f.ids.actor,edielMessageId:source.id})
 const active=await currentPermission(f,p),mode=f.mode==='V'?'S17':'S18',after=business(f,p)
 expect(active).toMatchObject({status:'active',source_z13_message_id:p.z13.id,source_z14_message_id:source.id,inbound_z14_message_id:source.id,
  customer_id:f.ids.customer,rff_li_reference:p.li,permission_id:'SYNTHETIC-PERMISSION-'+p.permissionId.slice(0,8)})
 expect(Number(active.market_state_version)).toBe(Number(waiting.market_state_version??0)+1)
 expect(active.metadata).toMatchObject({marketPermission:{mode,legalActor:f.sender,dsoActor:f.receiver,sourceZ14:source.id,
  objects:expect.arrayContaining([expect.objectContaining({point:f.point,product:f.product,status:'A74'})])}})
 const sites=sql<Record<string,unknown>[]>(`SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.metering_permission_sites s
  WHERE company_id=${lit(f.ids.company)} AND metering_permission_id=${lit(p.permissionId)}`)
 expect(sites).toHaveLength(1)
 expect(sites[0]).toMatchObject({customer_id:f.ids.customer,facility_id:f.point,status:'approved',
  metadata:{source:'inbound_prodat_z14',edielMessageId:source.id,mode,product:f.product}})
 expect(Date.parse(String(sites[0].start_at))).toBe(Date.parse(f.fields.data_start))
 if(f.fields.data_end)expect(Date.parse(String(sites[0].end_at))).toBe(Date.parse(f.fields.data_end))
 else expect(sites[0].end_at).toBeNull()
 expect(continuationInvariant(after,f,p,source.id)).toEqual(continuationInvariant(before,f,p,source.id))
 const stableQueues=await committedZ14Replies(f,p,source,queues,profile)
 expect(await readEdielServiceAdministration({companyId:f.ids.company,actorUserId:f.ids.actor,assignmentId:f.assignment})).toMatchObject({grants:[]})
 const link=sql<string>(`SELECT to_jsonb(id) FROM public.ediel_assignment_permission_links WHERE company_id=${lit(f.ids.company)} AND assignment_id=${lit(f.assignment)} AND permission_id=${lit(p.permissionId)}`)
 const fields={permission_link_id:link,object_ids:[f.point],product_ids:[f.product],fields:f.fields.field_sets,
  data_start:f.fields.data_start,data_end:f.fields.data_end,valid_from:f.fields.valid_from,valid_to:f.fields.valid_to}
 const create=(scope=fields)=>f.command({action:'create_grant',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:f.current().version,fields:scope})
 // A public command cannot expand the actual assignment's object scope.
 await expect(create({...fields,object_ids:[f.point,'735999260731999999']})).rejects.toMatchObject({message:'ediel_grant_scope_exceeds_assignment'})
 expect(business(f,p)).toEqual(after);expect(fullOutbox(f)).toEqual(stableQueues)
 const grant=await create()
 expect(grant).toMatchObject({status:'held',assignmentId:f.assignment,accessGranted:false})
 const grantId=String(grant.grantId),grantRow=()=>sql<Record<string,unknown>>(`SELECT to_jsonb(g) FROM public.ediel_data_access_grants g WHERE company_id=${lit(f.ids.company)} AND id=${lit(grantId)}`)
 const held=grantRow()
 expect(held).toMatchObject({company_id:f.ids.company,beneficiary_company_id:f.ids.beneficiary,assignment_id:f.assignment,status:'held',
  permission_link_id:link,object_ids:[f.point],product_ids:[f.product],fields:f.fields.field_sets,purpose:f.fields.purpose})
 for(const key of ['data_start','data_end','valid_from','valid_to'] as const){
  if(fields[key]===null)expect(held[key]).toBeNull()
  else expect(Date.parse(String(held[key]))).toBe(Date.parse(fields[key]!))
 }
 expect(await readEdielServiceAdministration({companyId:f.ids.company,actorUserId:f.ids.actor,assignmentId:f.assignment})).toMatchObject({grants:[held]})
 const publishCommand={action:'publish_grant',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:f.current().version,
  grantId,expectedGrantVersion:Number(held.version)}
 const published=await f.command(publishCommand)
 expect(published).toMatchObject({status:'active',grantId,accessGranted:true})
 const live=grantRow(),{status,version,updated_at,...liveScope}=live
 void status;void version;void updated_at
 const {status:heldStatus,version:heldVersion,updated_at:heldTime,...heldScope}=held
 void heldStatus;void heldVersion;void heldTime
 expect(liveScope).toEqual(heldScope);expect(live.status).toBe('active');expect(Number(live.version)).toBe(Number(held.version)+1)
 const final=business(f,p)
 expect(continuationInvariant(final,f,p,source.id,grantId)).toEqual(continuationInvariant(before,f,p,source.id,grantId))
 expect(fullOutbox(f)).toEqual(stableQueues)
 await processInboundEdielMessage({actorUserId:f.ids.actor,edielMessageId:source.id})
 expect(await f.command(publishCommand)).toEqual(published)
 expect(business(f,p)).toEqual(final);expect(fullOutbox(f)).toEqual(stableQueues)
 expect(await currentPermission(f,p)).toEqual(active)
 expect((await getEdielMessageById(source.id))?.raw_payload).toBe(source.raw_payload)
 expect((await getEdielMessageById(p.z13.id))?.raw_payload).toBe(original.raw_payload)
 expect(sql(`SELECT to_jsonb(immutable_payload_hash) FROM public.ediel_messages WHERE id=${lit(source.id)}`)).toBe(hash(source.raw_payload!))
 expect(await readEdielServiceAdministration({companyId:f.ids.company,actorUserId:f.ids.actor,assignmentId:f.assignment})).toMatchObject({grants:[live]})
 checkSentinel()
}

for(const mode of ['V','VH'] as const){
 it(`${mode}: public Z14 after actual request ACKs grants only the separately published beneficiary scope; immutable replay`,async()=>{
  const{f,p,objectAckProfile,checkSentinel}=await request(mode,true)
  expect(objectAckProfile).toBeTruthy()
  for(const family of ['CONTRL','APERAK'] as const){
   const ack=await intake(f,p,counterpart(p,family))
   expect(await consume(f,ack)).toMatchObject({kind:'exact_receipt',sourceMessageId:p.z13.id,
    result:{outcome:'positive',sourceAccepted:family==='APERAK',finalAckReached:family==='APERAK'}})
  }
  await continueToPublishedGrant(f,p,objectAckProfile!,checkSentinel)
 },120000)

 it(`${mode}: actual Z13 receives CONTRL then object APERAK; waits for customer without access, immutable replay`,async()=>{
  const{f,p,checkSentinel}=await request(mode),before=business(f,p),pending=await permission(f,p),acks:EdielMessageRow[]=[]
  await noAccess(f,p)
  for(const family of ['CONTRL','APERAK'] as const){
   const message=await intake(f,p,counterpart(p,family))
   if(mode==='V'&&family==='APERAK')await proveWaitingLockRollback(f,p,message)
   expect(await consume(f,message)).toMatchObject({kind:'exact_receipt',sourceMessageId:p.z13.id,
    result:{outcome:'positive',sourceAccepted:family==='APERAK',finalAckReached:family==='APERAK'}})
   const original=(await getEdielMessageById(p.z13.id))!
   expect(original.contrl_status).toBe('received')
   if(family==='CONTRL'){
    expect(original.aperak_status).toBe(p.z13.aperak_status)
    expect(await permission(f,p)).toEqual(pending)
   }else{
    expect(original.aperak_status).toBe('received')
    // Genuine persisted state, not the pure TS enum or an invented RPC key.
    const current=await permission(f,p)
    expect(current.status).toBe('waiting_for_customer_approval')
    const immutable=(row:typeof current)=>{const{status,updated_at,updated_by,...rest}=row;void status;void updated_at;void updated_by;return rest}
    expect(immutable(current)).toEqual(immutable(pending))
   }
   expect(original.raw_payload).toBe(p.z13.raw_payload)
   expect(sql(`SELECT to_jsonb(immutable_payload_hash) FROM public.ediel_messages WHERE id=${lit(original.id)}`)).toBe(hash(p.z13.raw_payload!))
   expect(business(f,p)).toEqual(before);await noAccess(f,p);checkSentinel();acks.push(message)
  }
  const stable=ackState(f,p),waiting=await permission(f,p),sends=nativeEscoExternal.send.mock.calls.length
  for(const message of acks){expect(await consume(f,message)).toMatchObject({kind:'exact_receipt',sourceMessageId:p.z13.id});expect(ackState(f,p)).toEqual(stable)}
  expect(await permission(f,p)).toEqual(waiting)
  expect(nativeEscoExternal.send).toHaveBeenCalledTimes(sends)
  expect(business(f,p)).toEqual(before);checkSentinel()
 },120000)

 for(const[family,defect]of [['CONTRL','unknown'],['APERAK','wrongLI']] as const){
  it(`${mode}: ${family} ${defect} cannot admit another original or grant access`,async()=>{
   const{f,p,checkSentinel}=await request(mode),before=business(f,p),pending=await permission(f,p)
   const original=(await getEdielMessageById(p.z13.id))!,message=await intake(f,p,counterpart(p,family,defect))
   expect(await consume(f,message)).toBeNull()
   expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ack_authority.source_correlations WHERE ack_message_id=${lit(message.id)}`)).toBe(0)
   expect((await getEdielMessageById(p.z13.id))!).toEqual(original)
   expect(await permission(f,p)).toEqual(pending)
   expect(business(f,p)).toEqual(before);await noAccess(f,p);checkSentinel()
  },120000)
 }
 it(`${mode}: received negative object APERAK records refusal, not customer permission`,async()=>{
  const{f,p,checkSentinel}=await request(mode),before=business(f,p),pending=await permission(f,p)
  const contrl=await intake(f,p,counterpart(p,'CONTRL'))
  expect(await consume(f,contrl)).toMatchObject({kind:'exact_receipt',sourceMessageId:p.z13.id,
   result:{outcome:'positive',sourceAccepted:false,finalAckReached:false}})
  expect(await permission(f,p)).toEqual(pending)
  expect(business(f,p)).toEqual(before);await noAccess(f,p);checkSentinel()
  const message=await intake(f,p,counterpart(p,'APERAK','negative'))
  expect(await consume(f,message)).toMatchObject({kind:'exact_receipt',sourceMessageId:p.z13.id,
   result:{outcome:'negative',sourceAccepted:false,finalAckReached:true}})
  expect(await permission(f,p)).toEqual(pending)
  expect(business(f,p)).toEqual(before);await noAccess(f,p);checkSentinel()
 },120000)
 for(const defect of ['wrongTenant','wrongRole'] as const){
  it(`${mode}: ${defect} is refused at the public intake boundary with no ACK effect`,async()=>{
   const{f,p,checkSentinel}=await request(mode),input=await retained(f,counterpart(p,'APERAK'))
   const before=business(f,p),stable=ackState(f,p),pending=await permission(f,p)
   const queuedBefore=fullOutbox(f)
   await expect(createInboundEdielMessage({...input,...(defect==='wrongTenant'?{companyId:f.ids.beneficiary}:{actorUserId:f.ids.reviewer})}))
    .rejects.toMatchObject({name:'EdielExecutionFailure',disposition:{kind:'security_quarantine',
     code:defect==='wrongTenant'?'EDIEL_TENANT_ACTOR_FORBIDDEN':'EDIEL_TENANT_PERMISSION_FORBIDDEN'}})
   expect(ackState(f,p)).toEqual(stable);expect(await permission(f,p)).toEqual(pending)
   expect(fullOutbox(f)).toEqual(queuedBefore)
   expect(business(f,p)).toEqual(before);await noAccess(f,p);checkSentinel()
  },120000)
 }
 it(`${mode}: a received ACK cannot mutate its frozen physical original before processing`,async()=>{
  const{f,p,checkSentinel}=await request(mode),message=await intake(f,p,counterpart(p,'APERAK'))
  const before=business(f,p),stable=ackState(f,p),pending=await permission(f,p)
  const queuedBefore=fullOutbox(f)
  const changed=message.raw_payload!.replace('RFF+LI:'+p.li,'RFF+LI:UNKNOWN')
  expect(changed).not.toBe(message.raw_payload)
  const result=await supabaseService.from('ediel_messages').update({raw_payload:changed}).eq('id',message.id).select('id')
  expect(result.error).toMatchObject({code:'23514',message:'immutable_ediel_payload_cannot_change'})
  expect((await getEdielMessageById(message.id))!).toEqual(message)
  expect(ackState(f,p)).toEqual(stable);expect(await permission(f,p)).toEqual(pending)
  expect(fullOutbox(f)).toEqual(queuedBefore)
  expect(business(f,p)).toEqual(before);await noAccess(f,p);checkSentinel()
 },120000)
}
