// Acceptance evidence for AT-Z06G-SUPPLIER (human reference only).
// Native execution remains NOT_RUN for these additive first-effect controls.
// Retained already-applied cases and their assertions remain unchanged below.
// Optional existing-fixture input/deferred-apply seams add real first-case,
// physical ignored UD and source-refusal proofs without seeding acceptance.
// Existing qualified producer alone executes the native suite. No coverage approval.
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
import {segmentComposite,segmentSourceSpan,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {edielSmtpConfig} from '@/lib/ediel/mailReadiness'
import {supabaseService} from '@/lib/supabase/service'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {reviewReceivedStructuralSource} from '@/lib/ediel/sources/reviewReceivedStructuralSource'
import {approveSafeMasterdataChanges} from '@/lib/ediel/safeApplyReview'
import {readReceivedProdatApplicationObjects} from '@/lib/ediel/core/receivedProdatApplicationObjects'
import {captureFreshEdielSourceRulePackEvidence,requireEdielSourceRulePackEvidence} from '@/lib/ediel/core/sourceRulePackEvidence'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import type {SourceOwnerReceipt} from '@/lib/ediel/sources/receivedSourceOwnerSession'
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
// Frozen AT-Z06G-SUPPLIER wire: BGM=Z06 and field223 (CCI+Z13 -> CAV) = E32.
// Reading-only register fields 214 (CCI+Z02) and 218 (CCI+Z05) are mandatory
// only in Z06F, so the admitted G original must not need them.
function characteristic(raw:string,qualifier:string){
 const wire=tokenizeEdifact(raw)
 return wire.segments.filter(segment=>segment.tag==='CCI'&&segmentComposite(segment,2,wire.una)[0]===qualifier).map(head=>{
  const tail=wire.segments.find(segment=>segment.index===head.index+1)
  expect(tail?.tag).toBe('CAV')
  return segmentComposite(tail!,1,wire.una)
 })
}
function expectGWire(raw:string){
 const wire=tokenizeEdifact(raw)
 expect(wire.segments.filter(segment=>segment.tag==='BGM').map(segment=>segmentComposite(segment,1,wire.una)[0])).toEqual(['Z06'])
 expect(characteristic(raw,'Z13').map(value=>value[0])).toEqual(['E32'])
 expect(characteristic(raw,'Z02')).toEqual([]);expect(characteristic(raw,'Z05')).toEqual([])
}
async function pending(f:Fixture,change:Change){
 await processInboundEdielMessage({actorUserId:f.operator.id,edielMessageId:change.message.id})
 const actual=await getEdielMessageById(change.message.id)
 expect(actual).not.toBeNull()
 expect(actual!.raw_payload).toBe(change.message.raw_payload)
 expectGWire(actual!.raw_payload!)
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

// Proposed native controls deliberately fail if actual canonical auth, technical
// endpoint, source-bound route or ACK prerequisites are absent. They do not skip,
// catch-and-pass, seed missing permission keys or substitute mocked effects.
// Current field306 fixture uses national Z12; canonical list is Z11/Z12.
// These unexecuted controls require actual guide-valid source admission.
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

// First-effect evidence is additive to the retained already-applied controls.
// Intake finishes its own canonical session. The manual first-effect review
// follows that actual intake, rather than borrowing an earlier review revision.
async function pendingFirstApplication(f:Fixture,change:Change){
 const current=await pending(f,change)
 expect(await reviewReceivedStructuralSource({companyId:f.f.companyId,environment:'test',sourceMessageId:change.message.id,reviewerUserId:f.operator.id,confirmedOriginal:true,replacesSourceMessageId:null})).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
 return current
}
// Every protected source/assessment/apply/ACK implementation remains real.
function sourceEffects(f:Fixture,sourceId:string){
 const company=literal(f.f.companyId),source=literal(sourceId)
 return sql<{
  objects:{source_message_id:string;first_line_index:number;company_id:string;environment:string;payload_hash:string;canonical_assessment_id:string;object_assessment_id:string;actor_user_id:string;source_received_at:string;object_scope:{objectId:string;identityAgency:string;registers:{segmentIndex:number;registerPosition:number}[]};effect:{effectiveAt:string;sourceReceivedAt:string;sourceRegisters:{register:{segmentIndex:number};tokens:{tag:string;elements:string[][]}[]}[]}}[]
  batches:Record<string,unknown>[]
  expectations:Record<string,unknown>[]
  observations:Record<string,unknown>[]
  ignored:{source_payload_hash:string;fields_hash:string;fields_text:string}|null
 }>(`SELECT jsonb_build_object(
 'objects',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.first_line_index),'[]') FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.company_id=${company} AND r.source_message_id=${source}),
 'batches',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.requested_scope_key),'[]') FROM gridex_received_sources.structural_apply_batches r WHERE r.company_id=${company} AND r.source_message_id=${source}),
 'expectations',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM gridex_received_reading_expectations.expectations r WHERE r.company_id=${company} AND r.source_message_id=${source}),
 'observations',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.expectation_id,o.transaction_id),'[]') FROM gridex_received_reading_expectations.observations o JOIN gridex_received_reading_expectations.expectations e ON e.id=o.expectation_id WHERE e.company_id=${company} AND e.source_message_id=${source}),
 'ignored',(SELECT to_jsonb(i) FROM gridex_received_sources.prodat_ignored_field_facets i JOIN gridex_received_sources.validation_assessments v ON v.id=i.canonical_assessment_id WHERE i.company_id=${company} AND i.source_message_id=${source} AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)))`)
}

type RefusalEvidence={
 context:{source_message_id:string;company_id:string;environment:string;direction:string;payload_sha256:string;source_received_at:string;observed_at:string;status:string;reason:string|null;context:Record<string,unknown>}|null
 rules:{source_message_id:string;company_id:string;environment:string;direction:string;payload_sha256:string;captured_at:string;canonical_assessment_id:string}|null
 ruleCanonical:{id:string;source_message_id:string;company_id:string;environment:string;source_payload_hash:string}|null
 canonical:{id:string;source_message_id:string;company_id:string;environment:string;source_payload_hash:string;facts_text:string;facts_hash:string}|null
 assessment:{id:string;source_message_id:string;company_id:string;environment:string;source_payload_hash:string;canonical_assessment_id:string;facts_text:string;facts_hash:string}|null
 witness:{id:string;assessment_id:string;company_id:string;environment:string;source_message_id:string;facts_hash:string;observed_at:string}|null
 ownReceiverCount:number;ownPointCount:number
}
function refusalEvidence(f:Fixture,message:EdielMessageRow):RefusalEvidence{
 const wire=tokenizeEdifact(message.raw_payload!),receiver=wire.segments.find(segment=>segment.tag==='NAD'&&segmentComposite(segment,1,wire.una)[0]==='DO')!,point=wire.segments.find(segment=>segment.tag==='LIN')!
 const company=literal(f.f.companyId),source=literal(message.id),legal=literal(segmentComposite(receiver,2,wire.una)[0]),external=literal(segmentComposite(point,3,wire.una)[0])
 return sql<RefusalEvidence>(`SELECT jsonb_build_object(
 'context',(SELECT to_jsonb(r) FROM gridex_ediel_inbound_context.receipts r WHERE r.company_id=${company} AND r.source_message_id=${source}),
 'rules',(SELECT to_jsonb(r) FROM gridex_ediel_source_rules.receipts r WHERE r.company_id=${company} AND r.source_message_id=${source}),
 'ruleCanonical',(SELECT to_jsonb(v) FROM gridex_received_sources.validation_assessments v JOIN gridex_ediel_source_rules.receipts r ON r.canonical_assessment_id=v.id WHERE r.company_id=${company} AND r.source_message_id=${source}),
 'canonical',(SELECT to_jsonb(v) FROM gridex_received_sources.validation_assessments v WHERE v.company_id=${company} AND v.source_message_id=${source} AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)),
 'assessment',(SELECT to_jsonb(a) FROM gridex_received_sources.object_assessments a WHERE a.company_id=${company} AND a.source_message_id=${source} AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=a.id)),
 'witness',(SELECT to_jsonb(w) FROM gridex_received_sources.object_availability_witnesses w JOIN gridex_received_sources.object_assessments a ON a.id=w.assessment_id WHERE a.company_id=${company} AND a.source_message_id=${source} AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=a.id)),
 'ownReceiverCount',(SELECT count(DISTINCT i.company_id) FROM public.tenant_actor_identifiers i JOIN gridex_ediel_inbound_context.receipts r ON r.source_message_id=${source} WHERE i.company_id=${company} AND i.environment='test' AND i.identifier_type='EdielId' AND i.identifier_value=${legal} AND i.valid_from<=r.observed_at AND(i.valid_to IS NULL OR r.observed_at<i.valid_to)),
 'ownPointCount',(SELECT count(*) FROM public.metering_points p WHERE p.company_id=${company} AND p.meter_point_id=${external}))`)
}
function expectSourceContext(f:Fixture,message:EdielMessageRow,stored:RefusalEvidence,status:'ready'|'held'){
 expect(stored.context).not.toBeNull()
 expect(stored.context).toMatchObject({source_message_id:message.id,company_id:f.f.companyId,environment:'test',direction:'inbound',payload_sha256:createHash('sha256').update(message.raw_payload!).digest('hex'),status})
 expect(Date.parse(stored.context!.source_received_at)).toBe(Date.parse(message.message_received_at!))
 expect(Date.parse(stored.context!.observed_at)).toBeGreaterThanOrEqual(Date.parse(message.message_received_at!))
 if(status==='ready'){
  expect(stored.context!.reason).toBeNull();expect(stored.ownReceiverCount).toBe(1)
  expect(stored.context!.context).toMatchObject({legalEdielId:f.f.sender,transportEdielId:f.f.sender,actorRole:'electricity_supplier',family:'PRODAT',code:'Z06',applicationReference:'23-DDQ-PRODAT'})
 }
}
function expectReadyRefusalBasis(f:Fixture,message:EdielMessageRow,stored:RefusalEvidence){
 expectSourceContext(f,message,stored,'ready')
 expect(stored.rules).not.toBeNull();expect(stored.ruleCanonical).not.toBeNull()
 const source={source_message_id:message.id,company_id:f.f.companyId,environment:'test'},hash=createHash('sha256').update(message.raw_payload!).digest('hex')
 expect(stored.rules).toMatchObject({...source,direction:'inbound',payload_sha256:hash})
 expect(Date.parse(stored.rules!.captured_at)).toBeGreaterThanOrEqual(Date.parse(message.message_received_at!))
 expect(stored.ruleCanonical).toMatchObject({...source,id:stored.rules!.canonical_assessment_id,source_payload_hash:hash})
}
function expectRecordedOwnRefusal(f:Fixture,message:EdielMessageRow,review:SourceOwnerReceipt,stored:RefusalEvidence,
 application:NonNullable<Awaited<ReturnType<typeof readReceivedProdatApplicationObjects>>>,disposition:'rejected'|'unavailable',cause:string,missingField?:string){
 // A recorder/snapshot/witness incident cannot be counted as an own refusal.
 expect(review).toMatchObject({status:'recorded',sourceDisposition:'not_established',objectCounts:{accepted:0,rejected:disposition==='rejected'?1:0,held:disposition==='unavailable'?1:0}})
 if(review.status!=='recorded')throw Error('recorded_source_refusal_required')
 expectReadyRefusalBasis(f,message,stored)
 expect(stored.assessment).not.toBeNull();expect(stored.canonical).not.toBeNull();expect(stored.witness).not.toBeNull()
 const hash=createHash('sha256').update(message.raw_payload!).digest('hex'),source={source_message_id:message.id,company_id:f.f.companyId,environment:'test'}
 expect(stored.assessment).toMatchObject({...source,id:review.assessmentId,source_payload_hash:hash,canonical_assessment_id:application.assessmentId,facts_hash:review.factsHash})
 expect(stored.canonical).toMatchObject({...source,id:application.assessmentId,source_payload_hash:hash})
 expect(stored.assessment!.canonical_assessment_id).toBe(stored.canonical!.id)
 expect(stored.assessment!.facts_hash).toBe(createHash('sha256').update(stored.assessment!.facts_text).digest('hex'))
 expect(stored.canonical!.facts_hash).toBe(createHash('sha256').update(stored.canonical!.facts_text).digest('hex'))
 expect(JSON.parse(stored.canonical!.facts_text)).toMatchObject({syntaxDecision:'accepted'})
 expect(stored.witness).toMatchObject({...source,id:review.witnessId,assessment_id:review.assessmentId,facts_hash:review.factsHash})
 expect(Date.parse(stored.witness!.observed_at)).toBe(Date.parse(review.availableAt))
 const wire=tokenizeEdifact(message.raw_payload!),lin=wire.segments.find(segment=>segment.tag==='LIN')!,point=segmentComposite(lin,3,wire.una)[0],refs=wire.segments.filter(segment=>segment.tag==='RFF'&&segmentComposite(segment,1,wire.una)[0]==='LI'),messageReference=segmentComposite(wire.segments.find(segment=>segment.tag==='UNH')!,1,wire.una)[0]
 expect(refs).toHaveLength(missingField==='226'?0:1)
 if(refs.length)expect(segmentComposite(refs[0],1,wire.una)[1]).toBe(f.f.caseReference)
 expect(application.sourcePayloadHash).toBe(hash);expect(application.objects).toHaveLength(1)
 expect(application.objects[0]).toMatchObject({messageReference,objectId:point,identityAgency:'9',registers:[{segmentIndex:lin.index}]})
 const facts=JSON.parse(stored.assessment!.facts_text) as {owner:string;canonicalFactsHash:string;objects:{object:Record<string,unknown>;disposition:string;reasons:string[];business:unknown;party:unknown}[]}
 expect(facts).toMatchObject({owner:'received-source-object-decisions-v1',canonicalFactsHash:stored.canonical!.facts_hash})
 expect(facts.objects).toHaveLength(1)
 expect(facts.objects[0]).toMatchObject({disposition,business:null,party:null,object:{messageReference,objectId:point,identityAgency:'9',registers:[{segmentIndex:lin.index}]}})
 expect(facts.objects[0].reasons).toContain(cause)
 if(disposition==='rejected'){
  expect(application.headerDecision).toBe('accepted');expect(application.objects[0].applicationDecision).toBe('rejected')
  expect(application.objects[0].reasonCodes).toContain(cause)
  expect(point).toBe(f.f.external)
 }else{
  // The recorded hold is causally bound to an actual absent own tenant point,
  // never just a failed source recorder, missing basis or unrelated context.
  expect(stored.ownPointCount).toBe(0);expect(application.headerDecision).toBe('accepted')
  expect(application.objects[0]).toMatchObject({applicationDecision:'accepted',reasonCodes:[]})
  expect(JSON.parse(stored.canonical!.facts_text)).toMatchObject({syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted'})
 }
}
function expectPhysicalContextRefusal(f:Fixture,message:EdielMessageRow,stored:RefusalEvidence){
 expectSourceContext(f,message,stored,'held')
 expect(stored.context!.reason).toBe('ediel_inbound_legal_context_required')
 expect(stored.context!.context).toEqual({});expect(stored.ownReceiverCount).toBe(0)
 // The source INSERT captured this precise refusal. No unconfirmed review
 // result or missing-rule error substitutes for the actual held context.
}
async function prepareCapturedControl(f:Fixture,message:EdielMessageRow){
 expectSourceContext(f,message,refusalEvidence(f,message),'ready')
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message,{actorUserId:f.operator.id})
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision]).toEqual(['accepted','accepted','accepted'])
 expect(await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:f.f.companyId,decision})).toMatchObject({status:'recorded'})
 expect(await captureFreshEdielSourceRulePackEvidence(f.f.companyId,message.id)).toMatchObject({status:'captured'})
 await requireEdielSourceRulePackEvidence(f.f.companyId,message.id)
 expect(await reviewReceivedStructuralSource({companyId:f.f.companyId,environment:'test',sourceMessageId:message.id,reviewerUserId:f.operator.id,confirmedOriginal:true,replacesSourceMessageId:null})).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
 return {message,apply:()=>approveSafeMasterdataChanges({edielMessageId:message.id,actorUserId:f.operator.id})}
}

function expectNoFirstEffects(f:Fixture,message:EdielMessageRow){
 const effects=sourceEffects(f,message.id)
 expect(effects.objects).toEqual([]);expect(effects.batches).toEqual([])
 expect(effects.expectations).toEqual([]);expect(effects.observations).toEqual([])
 expect(evidence(f,message.id).acks.filter(ack=>ack.message_family==='APERAK'&&ack.ack_outcome==='positive')).toEqual([])
}
function removeSourceSegments(raw:string,select:(segment:ReturnType<typeof tokenizeEdifact>['segments'][number])=>boolean){
 const {segments}=tokenizeEdifact(raw),selected=segments.filter(select)
 expect(selected.length).toBeGreaterThan(0)
 let changed=raw
 for(const segment of [...selected].reverse()){
  const span=segmentSourceSpan(segment)!
  // Span omits the terminator: remove the complete selected physical segment.
  changed=changed.slice(0,span.startOffset)+changed.slice(span.endOffset+1)
 }
 return changed
}
function removeCharacteristic(raw:string,descriptor:string){
 const wire=tokenizeEdifact(raw),heads=wire.segments.filter(segment=>segment.tag==='CCI'&&segmentComposite(segment,2,wire.una)[0]===descriptor)
 expect(heads).toHaveLength(1)
 const head=heads[0],tail=wire.segments.find(segment=>segment.index===head.index+1)
 expect(tail?.tag).toBe('CAV')
 return removeSourceSegments(raw,segment=>segment.index===head.index||segment.index===tail!.index)
}
function extraUd(raw:string){
 const wire=tokenizeEdifact(raw),installation=wire.segments.filter(segment=>segment.tag==='NAD'&&segmentComposite(segment,1,wire.una)[0]==='IT')
 expect(installation).toHaveLength(1)
 const span=segmentSourceSpan(installation[0])!
 return raw.slice(0,span.startOffset)+"NAD+UD+FORBIDDEN-UD-G::89++Forbidden Identity+Forbidden Street+Town++12345+SE'\n"+raw.slice(span.startOffset)
}
function expectIgnoredUd(f:Fixture,change:Change){
 const wire=tokenizeEdifact(change.message.raw_payload!),groups=prodatRegisterGroups(wire.segments,wire.una,'Z06').groups
 expect(groups).toHaveLength(1)
 const own=groups[0],ud=own.segments.filter(segment=>segment.tag==='NAD'&&segmentComposite(segment,1,wire.una)[0]==='UD')
 expect(ud).toHaveLength(1);expect(segmentComposite(ud[0],2,wire.una)).toEqual(['FORBIDDEN-UD-G','','89'])
 const stored=sourceEffects(f,change.message.id).ignored
 expect(stored).not.toBeNull()
 expect(stored!.source_payload_hash).toBe(createHash('sha256').update(change.message.raw_payload!).digest('hex'))
 expect(stored!.fields_hash).toBe(createHash('sha256').update(stored!.fields_text).digest('hex'))
 const fields=JSON.parse(stored!.fields_text) as {fieldNumber:string;sourceRule:string;occurrence:Record<string,unknown>}[]
 for(const fieldNumber of ['END_USER_GROUP','227','228','229','231','232','316']){
  const field=fields.filter(item=>item.fieldNumber===fieldNumber)
  expect(field).toHaveLength(1)
  expect(field[0]).toMatchObject({sourceRule:'PRODAT26A:P119',occurrence:{objectId:f.f.external,identityAgency:'9',lineIndex:own.lineIndex,registerPosition:1,lineItemReference:f.f.caseReference,
   messageReference:segmentComposite(wire.segments.find(segment=>segment.tag==='UNH')!,1,wire.una)[0],ownReferences:{customerId:{kind:'present',value:'FORBIDDEN-UD-G'}}}})
 }
}
// Ignored F/G UD stays in physical/source evidence, never named customer
// business fields. The clean no-UD physical control has these exact 15 keys.
// This oracle deliberately exposes current c08e staging promotion until the
// existing decoder owner supplies its independently qualified correction.
function expectCleanStagedCustomer(f:Fixture,change:Change,stored:Evidence['case'],caseId:string,status:'pending_review'|'applied'){
 expect(stored).not.toBeNull()
 expect(stored).toMatchObject({id:caseId,company_id:f.f.companyId,ediel_message_id:change.message.id,message_code:'Z06',status})
 const customer=stored!.parsed_customer as Record<string,unknown>
 expect(customer).not.toBeNull();expect(typeof customer).toBe('object');expect(Array.isArray(customer)).toBe(false)
 const clean={customerId:null,customerIdQualifier:null,customerIdLabel:'Ej angivet',customerType:null,
  personalNumber:null,orgNumber:null,birthDate:null,fullName:null,companyName:null,firstName:null,lastName:null,
  address:null,postalCode:null,city:null,country:null}
 expect(Object.fromEntries(Object.keys(clean).map(key=>[key,customer[key]]))).toEqual(clean)
}
it.each([false,true])('G first case approval versions only its original structure; physical extra UD=%s never changes customer identity',async withUd=>{
 const f=await fixture(),change=await f.change('G',undefined,{deferFirstApply:true,...(withUd?{rawTransform:extraUd}:{})}),route=configureAckRoute(f)
 const initial=evidence(f,change.message.id)
 expectNoFirstEffects(f,change.message)
 if(withUd){expect(change.message.raw_payload).toContain('FORBIDDEN-UD-G');expect(initial.original.raw_payload).toBe(change.message.raw_payload!);expectIgnoredUd(f,change)}
 const current=await pendingFirstApplication(f,change),before=evidence(f,change.message.id)
 expectNoFirstEffects(f,change.message)
 expect(before.market).toEqual(initial.market);expect(before.source).toEqual(initial.source);expect(before.original).toEqual(initial.original)
 expect(before.acks.map(ack=>ack.message_family)).toEqual(['CONTRL'])
 expectCleanStagedCustomer(f,change,before.case,current.inboundCase.id,'pending_review')
 const approved=await approveEdielInboundCase({companyId:f.f.companyId,actorUserId:f.operator.id,caseId:current.inboundCase.id,structuralObjectLineIndices:[current.scope.lineIndex]})
 expect(approved.status).toBe('applied')
 const after=evidence(f,change.message.id),effects=sourceEffects(f,change.message.id),hash=createHash('sha256').update(change.message.raw_payload!).digest('hex')
 expectOwnAcks(f,change,route,after)
 expectCleanStagedCustomer(f,change,after.case,approved.id,'applied')
 expect(after.market).toEqual(initial.market);expect(after.source).toEqual(initial.source);expect(after.original).toEqual(initial.original)
 expect(effects.objects).toHaveLength(1);expect(effects.batches).toHaveLength(1)
 const own=effects.objects[0]
 expect(own).toMatchObject({source_message_id:change.message.id,first_line_index:current.scope.lineIndex,company_id:f.f.companyId,environment:'test',payload_hash:hash,actor_user_id:f.operator.id,
  object_scope:{objectId:f.f.external,identityAgency:'9',registers:[{segmentIndex:current.scope.lineIndex,registerPosition:1}]},
  effect:{meteringPointId:f.f.pointId,siteId:f.f.siteId,wire:{messageCode:'Z06',businessCase:'change_without_reading',caseReference:f.f.caseReference,registers:[{position:1,registerId:'101'}]}}})
 expect(own.canonical_assessment_id).toMatch(/^[0-9a-f-]{36}$/);expect(own.object_assessment_id).toMatch(/^[0-9a-f-]{36}$/)
 const effective=new Date(`${f.f.requestedStartDate}T00:00:00Z`);effective.setUTCDate(effective.getUTCDate()+12);effective.setUTCMinutes(effective.getUTCMinutes()-60)
 expect(Date.parse(own.effect.effectiveAt)).toBe(effective.getTime())
 expect(Date.parse(own.source_received_at)).toBe(Date.parse(change.message.message_received_at!))
 expect(Date.parse(own.effect.sourceReceivedAt)).toBe(Date.parse(change.message.message_received_at!))
 expect(own.effect.sourceRegisters).toHaveLength(1)
 expect(own.effect.sourceRegisters[0].register.segmentIndex).toBe(current.scope.lineIndex)
 expect(own.effect.sourceRegisters[0].tokens).toContainEqual(expect.objectContaining({tag:'LIN',elements:expect.arrayContaining([['1'],[f.f.external,'','','9']])}))
 expect(effects.batches[0]).toMatchObject({source_message_id:change.message.id,payload_hash:hash,canonical_assessment_id:own.canonical_assessment_id,object_assessment_id:own.object_assessment_id,result:{sourceMessageId:change.message.id,applied:true,appliedCount:1}})
 expect(effects.expectations).toEqual([]);expect(effects.observations).toEqual([])
 expect(own).toMatchObject({effect:{readingFollowUp:{status:'not_required_by_this_change',criterion:'AT-Z06G-SUPPLIER',deadline:null,fulfilled:false}}})
 expect((await f.read(change.message.id)).data).toMatchObject({expectations:[]})
 if(withUd)expectIgnoredUd(f,change)
 const final=await readReceivedProdatFinalResponsePlan({companyId:f.f.companyId,sourceMessageId:change.message.id,rawPayload:change.message.raw_payload!})
 expect(final).not.toBeNull();expect(final!.plans).toMatchObject([{outcome:'positive',effectKind:'structural',objectLineIndices:[current.scope.lineIndex],acknowledgedReferences:[current.scope.li]}])
 const replay=await approveEdielInboundCase({companyId:f.f.companyId,actorUserId:f.operator.id,caseId:approved.id,structuralObjectLineIndices:[current.scope.lineIndex]})
 expect(replay.status).toBe('applied');expect(sourceEffects(f,change.message.id)).toEqual(effects)
 expectCleanStagedCustomer(f,change,evidence(f,change.message.id).case,replay.id,'applied')
 expect({...evidence(f,change.message.id),case:null}).toEqual({...after,case:null})
 expect(external.send).toHaveBeenCalledTimes(1)
})

it('G physical missing fields/correlation and wrong legal parties cannot establish a first structural effect',async()=>{
 const f=await fixture();configureAckRoute(f)
 const probes:{name:string;field?:string;process?:false;transform:(raw:string)=>string}[]=[
  {name:'missing required own306',field:'306',transform:raw=>removeCharacteristic(raw,'Z07')},
  {name:'missing own LI',field:'226',transform:raw=>removeSourceSegments(raw,segment=>segment.tag==='RFF'&&segmentComposite(segment,1,tokenizeEdifact(raw).una)[0]==='LI')},
  {name:'reversed source roles',process:false,transform:raw=>raw.replaceAll(`${f.f.receiver}:14`,`${f.f.sender}:14`).replaceAll(`+${f.f.sender}:14+${f.f.sender}:14+`,`+${f.f.sender}:14+${f.f.receiver}:14+`)
   .replace(`NAD+FR+${f.f.receiver}:160:SVK`,`NAD+FR+${f.f.sender}:160:SVK`).replace(`NAD+DO+${f.f.sender}:160:SVK`,`NAD+DO+${f.f.receiver}:160:SVK`)},
  {name:'legal receiver mismatches transport',process:false,transform:raw=>raw.replace(`NAD+DO+${f.f.sender}:160:SVK`,`NAD+DO+${f.f.receiver}:160:SVK`)},
 ]
 for(const probe of probes){
  const message=await f.captureChange('G',undefined,{rawTransform:probe.transform}),initial=evidence(f,message.id)
  expect(validateEdifactEnvelope(message.raw_payload!).syntaxOk).toBe(true)
  expectNoFirstEffects(f,message)
  if(probe.process!==false){
   const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message,{actorUserId:f.operator.id})
   const defects=decision.issues.filter(issue=>issue.prodatDiagnostic?.kind==='field'&&issue.prodatDiagnostic.fieldNumber===probe.field&&issue.prodatDiagnostic.errorKind==='missing')
   expect(defects.length).toBeGreaterThan(0)
   expect(decision.prodatApplicationValidation?.objects).toMatchObject([{applicationDecision:'rejected'}])
   await processInboundEdielMessage({actorUserId:f.operator.id,edielMessageId:message.id})
   await requireEdielSourceRulePackEvidence(f.f.companyId,message.id)
   const review=await reviewReceivedStructuralSource({companyId:f.f.companyId,environment:'test',sourceMessageId:message.id,reviewerUserId:f.operator.id,confirmedOriginal:true,replacesSourceMessageId:null})
   const application=await readReceivedProdatApplicationObjects({companyId:f.f.companyId,sourceMessageId:message.id,rawPayload:message.raw_payload!})
   expect(application).not.toBeNull()
   expectRecordedOwnRefusal(f,message,review,refusalEvidence(f,message),application!,'rejected',defects[0].code,probe.field)
   await expect(approveSafeMasterdataChanges({edielMessageId:message.id,actorUserId:f.operator.id})).rejects.toThrow(/^structural_apply_no_qualified_object$/)
  }else{
   // These wrong legal receivers are held at genuine source-context capture,
   // before a canonical composition can legitimately be recorded.
   const wire=tokenizeEdifact(message.raw_payload!),envelope=EdifactEnvelopeCodec.decode(message.raw_payload!)
   const legalReceiver=wire.segments.find(segment=>segment.tag==='NAD'&&segmentComposite(segment,1,wire.una)[0]==='DO')!
   expect(segmentComposite(legalReceiver,2,wire.una)[0]).toBe(f.f.receiver)
   expect(envelope.receiver).toBe(probe.name==='reversed source roles'?f.f.receiver:f.f.sender)
   expect(envelope.sender).toBe(probe.name==='reversed source roles'?f.f.sender:f.f.receiver)
   expectPhysicalContextRefusal(f,message,refusalEvidence(f,message))
   await expect(approveSafeMasterdataChanges({edielMessageId:message.id,actorUserId:f.operator.id})).rejects.toThrow(/^ediel_inbound_legal_context_required$/)
  }
  expectNoFirstEffects(f,message)
  const after=evidence(f,message.id)
  expect(after.market).toEqual(initial.market);expect(after.source).toEqual(initial.source);expect(after.original).toEqual(initial.original)
 }
 // Same real owner and prerequisites accept an intact control after refusals.
 const control=await prepareCapturedControl(f,await f.captureChange('G')),current=await pendingFirstApplication(f,control)
 expectNoFirstEffects(f,control.message)
 expect(await approveEdielInboundCase({companyId:f.f.companyId,actorUserId:f.operator.id,caseId:current.inboundCase.id,structuralObjectLineIndices:[current.scope.lineIndex]})).toMatchObject({status:'applied'})
})

it('G cannot borrow a foreign physical point, admit outbound source input or mutate a sealed deferred original',async()=>{
 const f=await fixture(),foreign=await fixture();configureAckRoute(f)
 const message=await f.captureChange('G',undefined,{rawTransform:raw=>raw.replaceAll(f.f.external,foreign.f.external)}),initial=evidence(f,message.id),foreignBefore=evidence(foreign,foreign.f.source)
 await processInboundEdielMessage({actorUserId:f.operator.id,edielMessageId:message.id})
 await requireEdielSourceRulePackEvidence(f.f.companyId,message.id)
 const review=await reviewReceivedStructuralSource({companyId:f.f.companyId,environment:'test',sourceMessageId:message.id,reviewerUserId:f.operator.id,confirmedOriginal:true,replacesSourceMessageId:null})
 const application=await readReceivedProdatApplicationObjects({companyId:f.f.companyId,sourceMessageId:message.id,rawPayload:message.raw_payload!})
 expect(application).not.toBeNull()
 const stored=refusalEvidence(f,message)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.metering_points WHERE company_id=${literal(foreign.f.companyId)} AND id=${literal(foreign.f.pointId)} AND meter_point_id=${literal(foreign.f.external)}`)).toBe(1)
 expectRecordedOwnRefusal(f,message,review,stored,application!,'unavailable','structural_review_owner_unavailable')
 // The intact canonical own member reaches SQL11232's empty qualified partition.
 await expect(approveSafeMasterdataChanges({edielMessageId:message.id,actorUserId:f.operator.id})).rejects.toThrow(/^structural_apply_no_qualified_object$/)
 expectNoFirstEffects(f,message)
 expect(evidence(f,message.id).market).toEqual(initial.market);expect(evidence(foreign,foreign.f.source)).toEqual(foreignBefore)
 // Real INSERT constraints reject this unqualified outbound input. No route,
 // source-operation or acceptance authority is invented to bypass the guard.
 const sourceCount=sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.f.companyId)}`),directionBefore=evidence(f,message.id)
 await expect(f.captureChange('G',undefined,{direction:'outbound'})).rejects.toThrow('canonical_ediel_route_required')
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.f.companyId)}`)).toBe(sourceCount)
 expect(evidence(f,message.id)).toEqual(directionBefore);expectNoFirstEffects(f,message)
 const change=await f.change('G',undefined,{deferFirstApply:true}),sealed=evidence(f,change.message.id),effects=sourceEffects(f,change.message.id)
 const mutation=await supabaseService.from('ediel_messages').update({raw_payload:change.message.raw_payload!.replace('METER-1','ALTERED-METER')}).eq('id',change.message.id).eq('company_id',f.f.companyId)
 expect(mutation.error?.message).toContain('immutable_ediel_payload_cannot_change')
 expect(evidence(f,change.message.id)).toEqual(sealed);expect(sourceEffects(f,change.message.id)).toEqual(effects)
 const current=await pendingFirstApplication(f,change)
 expect(await approveEdielInboundCase({companyId:f.f.companyId,actorUserId:f.operator.id,caseId:current.inboundCase.id,structuralObjectLineIndices:[current.scope.lineIndex]})).toMatchObject({status:'applied'})
 expect(evidence(foreign,foreign.f.source)).toEqual(foreignBefore)
})
