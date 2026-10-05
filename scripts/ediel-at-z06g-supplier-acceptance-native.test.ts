// Acceptance evidence for AT-Z06G-SUPPLIER (human reference only).
// Native execution is NOT_RUN when authored. #503 retains suite registration,
// the existing stack/capture/helpers and all source changes. The fixture has
// ALREADY applied this F/G source before returning: these cases exercise the
// real processor/case/ACK consumers and retained application, not first apply.
// Physical ignored UD and malformed-ingress clauses remain held pending the
// retained owner's declared raw-input/deferred-apply seam. No coverage approval.
import {createHash,randomUUID} from 'node:crypto'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {createZ06fReadingNativeFixture} from './helpers/ediel-z06f-reading-followup-native-fixture'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {approveEdielInboundCase,createOrUpdateInboundProdatCase,getEdielInboundCaseForMessage} from '@/lib/ediel/inboundCases'
import {getEdielMessageById} from '@/lib/ediel/db'
import {readReceivedProdatFinalResponsePlan} from '@/lib/ediel/core/receivedProdatFinalResponsePlan'
import {readPhysicalAckSourceCorrelation} from '@/lib/ediel/ack/sourceCorrelation'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {edielSmtpConfig} from '@/lib/ediel/mailReadiness'
import type {EdielMessageRow} from '@/lib/ediel/types'

// Declared external port required by the existing signed-original producer.
// This SMTP result proves neither delivery to a real counterparty nor transport
// approval. Source, SQL, actor, case, ACK and outbox implementations are real.
const external=vi.hoisted(()=>({send:vi.fn()}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:external.send})}}))
beforeEach(()=>{
 vi.stubEnv('EDIEL_SHARED_MAILBOX_ADDRESS','synthetic@example.invalid')
 vi.stubEnv('EDIEL_APP_DKIM_ENABLED','false')
 vi.stubEnv('EMAIL_PROVIDER','resend');vi.stubEnv('EDIEL_EMAIL_PROVIDER','strato')
 vi.stubEnv('EDIEL_SMTP_FROM','synthetic@example.invalid')
 vi.stubEnv('EDIEL_SMTP_USER','synthetic@example.invalid')
 vi.stubEnv('EDIEL_SMTP_PASS','synthetic-only')
 external.send.mockReset()
})
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})
const fixture=()=>createZ06fReadingNativeFixture(email=>external.send.mockResolvedValue({
 accepted:[email],rejected:[],messageId:'synthetic-FG-acceptance-original',
 response:'250 explicitly synthetic accepted',
}))
type Fixture=Awaited<ReturnType<typeof fixture>>
type Change=Awaited<ReturnType<Fixture['change']>>
type Evidence={
 source:Record<string,unknown>
 market:Record<string,unknown>
 original:Record<string,unknown>
 receipts:Record<string,unknown>
 expectations:Record<string,unknown>[]
 observations:Record<string,unknown>[]
 acks:EdielMessageRow[]
 outbox:Record<string,unknown>[]
 events:Record<string,unknown>[]
 case:Record<string,unknown>|null
}

// Public disposable routing INPUT only, following the established raw-scope
// native suite. No protected readiness, authority, grant, permission registry,
// issuer mandate or original-capture fact is inserted by these acceptance files.
function configureAckRoute(f:Fixture){
 const routeId=randomUUID(),profileId=randomUUID(),smtp=edielSmtpConfig()
 sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email)
 VALUES(${literal(routeId)},${literal(f.f.companyId)},'Synthetic G acceptance ACK route','ediel_ack',${literal(f.f.gridId)},'bilateral_test',true,'recipient@example.invalid');
 INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,payload_format,transport_security_mode,smtp_to,receiver_email,mailbox,smtp_host,smtp_port)
 VALUES(${literal(profileId)},${literal(f.f.companyId)},${literal(routeId)},'Synthetic G acceptance ACK profile','test','edifact',${literal(f.f.sender)},${literal(f.f.receiver)},'23-DDQ-PRODAT',true,true,'edifact','unencrypted','recipient@example.invalid','recipient@example.invalid',${literal(smtp.from)},${literal(smtp.host)},${literal(smtp.port)});`)
 return {routeId,profileId}
}
function evidence(f:Fixture,sourceId:string):Evidence{
 const company=literal(f.f.companyId),source=literal(sourceId)
 return sql<Evidence>(`SELECT jsonb_build_object(
 'source',(SELECT jsonb_build_object('id',id,'company',company_id,'environment',environment,'direction',direction,'family',message_family,'code',message_code,'raw',raw_payload,'receivedAt',message_received_at,'sha256',encode(sha256(convert_to(raw_payload,'UTF8')),'hex')) FROM public.ediel_messages WHERE id=${source} AND company_id=${company}),
 'original',(SELECT to_jsonb(s) FROM gridex_received_sources.sources s WHERE source_message_id=${source} AND company_id=${company}),
 'market',jsonb_build_object(
  'customers',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.customers r WHERE company_id=${company}),
  'sites',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.customer_sites r WHERE company_id=${company}),
  'points',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.metering_points r WHERE company_id=${company}),
  'supply',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.customer_supply_periods r WHERE company_id=${company}),
  'customerContracts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.customer_contracts r WHERE company_id=${company}),
  'series',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.meter_reading_series r WHERE company_id=${company}),
  'graphs',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.customer_onboarding_operations r WHERE company_id=${company}),
  'marketOutbound',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.ediel_messages r WHERE company_id=${company} AND direction='outbound' AND message_family NOT IN('CONTRL','APERAK','UTILTS_ERR'))),
 'receipts',jsonb_build_object(
  'objects',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.source_message_id,r.first_line_index),'[]') FROM gridex_received_sources.structural_object_apply_receipts r WHERE company_id=${company}),
  'batches',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.source_message_id,r.requested_scope_key),'[]') FROM gridex_received_sources.structural_apply_batches r WHERE company_id=${company})),
 'expectations',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM gridex_received_reading_expectations.expectations r WHERE company_id=${company}),
 'observations',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.expectation_id,r.transaction_id),'[]') FROM gridex_received_reading_expectations.observations r WHERE company_id=${company}),
 'acks',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.ediel_messages r WHERE company_id=${company} AND related_message_id=${source} AND direction='outbound'),
 'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.ediel_outbox r WHERE company_id=${company} AND source_message_id=${source}),
 'events',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.ediel_message_events r WHERE company_id=${company} AND ediel_message_id=${source}),
 'case',(SELECT to_jsonb(r) FROM public.ediel_inbound_cases r WHERE company_id=${company} AND ediel_message_id=${source}))`)
}
function physical(change:Change){
 const wire=tokenizeEdifact(change.message.raw_payload!),lin=wire.segments.filter(segment=>segment.tag==='LIN')
 expect(lin).toHaveLength(1)
 const li=wire.segments.filter(segment=>segment.tag==='RFF'&&segmentComposite(segment,1,wire.una)[0]==='LI')
 const bgm=wire.segments.find(segment=>segment.tag==='BGM')!
 expect(li).toHaveLength(1)
 return {lineIndex:lin[0].index,li:segmentComposite(li[0],1,wire.una)[1],document:segmentComposite(bgm,2,wire.una)[0]}
}
async function pending(f:Fixture,change:Change){
 await processInboundEdielMessage({actorUserId:f.operator.id,edielMessageId:change.message.id})
 const actual=await getEdielMessageById(change.message.id)
 expect(actual).not.toBeNull()
 expect(actual!.raw_payload).toBe(change.message.raw_payload)
 const created=await createOrUpdateInboundProdatCase({actorUserId:f.operator.id,message:actual!})
 const saved=await getEdielInboundCaseForMessage(f.f.companyId,change.message.id)
 expect(saved).not.toBeNull();expect(created?.id).toBe(saved!.id)
 expect(saved).toMatchObject({company_id:f.f.companyId,ediel_message_id:change.message.id,status:'pending_review',message_code:'Z06'})
 return {actual:actual!,inboundCase:saved!,scope:physical(change)}
}
function expectOwnAcks(f:Fixture,change:Change,route:{routeId:string;profileId:string},stored:Evidence){
 const own=physical(change),sourceEnvelope=EdifactEnvelopeCodec.decode(change.message.raw_payload!)
 expect(stored.acks.map(ack=>ack.message_family).sort()).toEqual(['APERAK','CONTRL'])
 for(const ack of stored.acks){
  expect(ack).toMatchObject({company_id:f.f.companyId,environment:'test',direction:'outbound',related_message_id:change.message.id,ack_outcome:'positive'})
  expect(validateEdifactEnvelope(ack.raw_payload!).syntaxOk).toBe(true)
  const envelope=EdifactEnvelopeCodec.decode(ack.raw_payload!)
  expect(envelope.sender).toBe(sourceEnvelope.receiver);expect(envelope.receiver).toBe(sourceEnvelope.sender)
  const correlation=readPhysicalAckSourceCorrelation(ack,change.message)
  expect(correlation.classification.outcome).toBe('positive')
  if(ack.message_family==='CONTRL'){
   expect(correlation.scope).toBe('interchange')
   expect(correlation.acknowledgedReferences).toEqual([sourceEnvelope.interchangeReference!.slice(0,14)])
  }else{
   expect(ack.communication_route_id).toBe(route.routeId)
   expect(ack.route_profile_id).toBe(route.profileId)
   expect(correlation.lookupReferences).toContainEqual({type:'BGM_REF',value:own.document})
   expect(correlation.prodatObjectOutcomes).toEqual([{objectId:f.f.external,identityAgency:'9',firstLineIndex:own.lineIndex,lineItemReference:own.li,outcome:'positive'}])
   const wire=tokenizeEdifact(ack.raw_payload!)
   expect(wire.segments.filter(segment=>segment.tag==='ERC').map(segment=>segmentComposite(segment,1,wire.una)[0])).toEqual(['100'])
  }
 }
 expect(stored.outbox).toHaveLength(2)
 for(const ack of stored.acks){
  const entries=stored.outbox.filter(row=>row.ediel_message_id===ack.id)
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({company_id:f.f.companyId,source_message_id:change.message.id,environment:'test',message_family:ack.message_family,ack_outcome:'positive'})
 }
}

// Valid native controls deliberately fail if actual canonical auth, technical
// endpoint, source-bound route or ACK prerequisites are absent. They do not skip,
// catch-and-pass, seed missing permission keys or substitute mocked effects.
it('already-applied G source reaches real inbound case, own physical ACK/outbox and immutable retained replay',async()=>{
 const f=await fixture(),change=await f.change('G'),route=configureAckRoute(f)
 const initial=evidence(f,change.message.id),current=await pending(f,change)
 const before=evidence(f,change.message.id)
 expect(before.acks.map(ack=>ack.message_family)).toEqual(['CONTRL'])
 expect(before.market).toEqual(initial.market);expect(before.source).toEqual(initial.source);expect(before.original).toEqual(initial.original)
 const approved=await approveEdielInboundCase({companyId:f.f.companyId,actorUserId:f.operator.id,caseId:current.inboundCase.id,structuralObjectLineIndices:[current.scope.lineIndex]})
 expect(approved).toMatchObject({company_id:f.f.companyId,status:'applied',ediel_message_id:change.message.id})
 const after=evidence(f,change.message.id)
 expectOwnAcks(f,change,route,after)
 expect(after.source).toEqual(initial.source)
 expect(after.source.sha256).toBe(createHash('sha256').update(change.message.raw_payload!).digest('hex'))
 expect(after.original).toEqual(initial.original);expect(after.market).toEqual(initial.market)
 expect(after.receipts).toEqual(initial.receipts)
 expect(after.expectations).toEqual(initial.expectations);expect(after.observations).toEqual([])
 expect(after.expectations).toEqual([])
 const readingView=await f.read(change.message.id)
 expect(readingView.error).toBeNull()
 expect(readingView.data).toMatchObject({expectations:[]})
 const final=await readReceivedProdatFinalResponsePlan({companyId:f.f.companyId,sourceMessageId:change.message.id,rawPayload:change.message.raw_payload!})
 expect(final).not.toBeNull();expect(final!.totalObjectCount).toBe(1)
 expect(final!.plans).toMatchObject([{outcome:'positive',objectLineIndices:[current.scope.lineIndex],acknowledgedReferences:[current.scope.li],effectKind:'structural'}])
 const ackIds=after.acks.filter(ack=>ack.message_family==='APERAK').map(ack=>ack.id)
 expect(approved.review_decision).toMatchObject({structuralApplication:{version:1,sourceMessageId:change.message.id,objectLineIndices:[current.scope.lineIndex],appliedCount:1,appliedObjectCount:1,totalObjectCount:1,ackIds}})
 const replay=await approveEdielInboundCase({companyId:f.f.companyId,actorUserId:f.operator.id,caseId:approved.id,structuralObjectLineIndices:[current.scope.lineIndex]})
 expect(replay.status).toBe('applied')
 const stable=evidence(f,change.message.id)
 // Re-review timestamps may advance; immutable market/response originals do not.
 expect({...stable,case:null}).toEqual({...after,case:null})
 expect(replay.review_decision).toEqual(approved.review_decision)
 expect(stable.acks.map(ack=>ack.id)).toEqual(after.acks.map(ack=>ack.id))
 expect(external.send).toHaveBeenCalledTimes(1)
})

it('G case refuses foreign tenant/actor/graph selections and invalid own LIN scopes without new effects',async()=>{
 const f=await fixture(),foreign=await fixture(),change=await f.change('G')
 configureAckRoute(f)
 const current=await pending(f,change),before=evidence(f,change.message.id),foreignBefore=evidence(foreign,foreign.f.source)
 const base={companyId:f.f.companyId,actorUserId:f.operator.id,caseId:current.inboundCase.id}
 const invalid=[
  {override:{companyId:foreign.f.companyId},reason:'TENANT_CONTEXT_MISMATCH'},
  {override:{actorUserId:foreign.operator.id},reason:'ediel_tenant_actor_forbidden'},
  {override:{mode:'create_new_customer' as const},reason:'structural_apply_original_scope_required'},
  {override:{selectedCustomerId:foreign.f.customerId},reason:'structural_apply_original_scope_required'},
  {override:{selectedSiteId:foreign.f.siteId},reason:'structural_apply_original_scope_required'},
  {override:{selectedMeteringPointId:foreign.f.pointId},reason:'structural_apply_original_scope_required'},
  {override:{structuralObjectLineIndices:[]},reason:'structural_apply_requested_scope_invalid'},
  {override:{structuralObjectLineIndices:[current.scope.lineIndex,current.scope.lineIndex]},reason:'structural_apply_requested_scope_invalid'},
  {override:{structuralObjectLineIndices:[-1]},reason:'structural_apply_requested_scope_invalid'},
  {override:{structuralObjectLineIndices:[1.5]},reason:'structural_apply_requested_scope_invalid'},
  {override:{structuralObjectLineIndices:[current.scope.lineIndex+10000]},reason:'structural_apply_requested_scope_invalid'},
 ]
 for(const attempt of invalid){
  await expect(approveEdielInboundCase({...base,...attempt.override})).rejects.toThrow(attempt.reason)
  expect(evidence(f,change.message.id)).toEqual(before)
  expect(evidence(foreign,foreign.f.source)).toEqual(foreignBefore)
 }
 // Positive contrast consumes the same unaltered original after all refusals.
 const approved=await approveEdielInboundCase({...base,structuralObjectLineIndices:[current.scope.lineIndex]})
 expect(approved.status).toBe('applied')
 expect(evidence(foreign,foreign.f.source)).toEqual(foreignBefore)
 sql(`INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active,valid_from)
 VALUES(${literal(f.operator.id)},${literal(f.f.companyId)},'communication.write','deny',true,clock_timestamp()-interval '1 second');`)
 const deniedBefore=evidence(f,change.message.id)
 await expect(approveEdielInboundCase({...base,structuralObjectLineIndices:[current.scope.lineIndex]})).rejects.toThrow('ediel_tenant_permission_forbidden')
 expect(evidence(f,change.message.id)).toEqual(deniedBefore)
 expect(evidence(foreign,foreign.f.source)).toEqual(foreignBefore)
})
