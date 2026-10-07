// masterplan: AT-Z13V-ESCO, AT-Z13VH-ESCO
// Bounded request/ACK proof, not later Z14/N, history or whole-card approval.
// Only disposable identities, legal issuer inputs, counterpart bytes and
// external SMTP are synthetic. All archive/review/send/intake/ACK owners run.
import {createHash,randomUUID} from 'node:crypto'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {seedNativeEscoFixture as seed,prepareNativeEscoPermissionFixture as prepare,
 resetNativeEscoFixture,nativeEscoSql as sql,nativeEscoLiteral as lit,
 nativeEscoExternal} from './fixtures/ediel-service-evidence-native'
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
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'

type Fixture=Awaited<ReturnType<typeof seed>>
type Pending=Awaited<ReturnType<typeof prepare>>
const hash=(raw:string)=>createHash('sha256').update(raw).digest('hex')
beforeEach(resetNativeEscoFixture)
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})

async function request(mode:'V'|'VH'){
 const seeded=await seed(mode)
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
 return{f,p,checkSentinel}
}

// Full row images, not count-only absence assertions. Journal/status deltas
// live in ACK state; legal scope, foreign tenant, data and supply must not move.
function business(f:Fixture,p:Pending){
 const companies=`(${lit(f.ids.company)},${lit(f.ids.beneficiary)})`
 const tables=['companies','customers','customer_sites','metering_points','ediel_service_assignments',
  'ediel_service_evidence','ediel_assignment_permission_links','ediel_data_access_grants',
  'customer_supply_periods','supplier_switch_requests','meter_reading_series','meter_reading_values',
  'metering_permission_sites','ediel_service_history']
 const rows=tables.map(table=>`'${table}',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.${table} r WHERE ${table==='companies'?'id':'company_id'} IN ${companies})`)
 return sql(`SELECT jsonb_build_object(${rows.join(',')},
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
 if(defect==='negative')segments=segments.map(s=>s.startsWith('BGM+')?s.replace(/\+34$/,'+27'):s==='ERC+100::260'?'ERC+42::260':s)
 if(defect==='unknown')segments=segments.map(s=>s.startsWith('UCI+')?s.replace(/^(UCI\+)[^+]*/,'$1UNKNOWN'):s.startsWith('RFF+ACW:')?'RFF+ACW:UNKNOWN':s)
 if(defect==='wrongLI')segments=segments.map(s=>s.startsWith('RFF+LI:')?'RFF+LI:UNKNOWN':s)
 return EdifactEnvelopeCodec.encode({sender:e.receiver!,receiver:e.sender!,senderQualifier:e.receiverQualifier,receiverQualifier:e.senderQualifier,
  senderSubAddress:e.receiverSubAddress,receiverSubAddress:e.senderSubAddress,applicationReference:e.applicationReference,
  acknowledgementRequest:false,environment:'test',interchangeReference:randomUUID().replaceAll('-','').slice(0,14),
  messages:[{messageReference:randomUUID().replaceAll('-','').slice(0,14),messageTypeToken:family==='CONTRL'?'CONTRL:2:2:UN:EDIEL2':'APERAK:D:96A:UN:E2SE6A',businessSegments:segments}]})
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
 await processInboundEdielMessage({actorUserId:f.ids.actor,edielMessageId:message.id})
 const after=fullOutbox(f)
 // APERAK receives its own syntax CONTRL through the real public processor.
 // Preserve every old/foreign queue row; admit only that one source-bound
 // technical response. A replay and CONTRL itself create no queue entry.
 for(const row of before)expect(after.find(candidate=>candidate.id===row.id)).toEqual(row)
 const added=after.filter(row=>!before.some(previous=>previous.id===row.id))
 if(message.message_family==='APERAK'&&!committed){
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

for(const mode of ['V','VH'] as const){
 it(`${mode}: actual Z13 receives CONTRL then object APERAK; waits for customer without access, immutable replay`,async()=>{
  const{f,p,checkSentinel}=await request(mode),before=business(f,p),pending=await permission(f,p),acks:EdielMessageRow[]=[]
  await noAccess(f,p)
  for(const family of ['CONTRL','APERAK'] as const){
   const message=await intake(f,p,counterpart(p,family))
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
  expect(result.error).toMatchObject({code:'23514',message:'immutable_received_ack_source_cannot_change'})
  expect((await getEdielMessageById(message.id))!).toEqual(message)
  expect(ackState(f,p)).toEqual(stable);expect(await permission(f,p)).toEqual(pending)
  expect(fullOutbox(f)).toEqual(queuedBefore)
  expect(business(f,p)).toEqual(before);await noAccess(f,p);checkSentinel()
 },120000)
}
