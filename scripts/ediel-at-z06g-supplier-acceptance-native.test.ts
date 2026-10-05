// Acceptance design for AT-Z06G-SUPPLIER (human reference only).
// Native execution is NOT_RUN. The allocated existing helper defers first apply;
// these cases require real processor, fresh source review, case approval, dated
// first effect and physical ACK/outbox consumers. #503 retains registration,
// source/stack authority and malformed-ingress/unknown-condition prerequisites.
// The inherited field306 source qualification remains HELD. No coverage approval.
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
import {reviewReceivedStructuralSource} from '@/lib/ediel/sources/reviewReceivedStructuralSource'
import {readDatedSourceMeasurements} from '@/lib/ediel/sources/datedSourceMeasurements'
import {bindReceivedProdatIgnoredFields} from '@/lib/ediel/core/receivedProdatIgnoredFieldBinding'
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
type Assessment={id:string;company_id:string;environment:string;source_message_id:string;source_payload_hash:string;facts_text:string;facts_hash:string}
type ObjectAssessment=Assessment&{canonical_assessment_id:string}
type IgnoredFacet={canonical_assessment_id:string;company_id:string;environment:string;source_message_id:string;source_payload_hash:string;fields_text:string;fields_hash:string}
type Evidence={
 source:Record<string,unknown>
 market:Record<string,unknown>
 original:Record<string,unknown>
 receipts:{objects:Record<string,unknown>[];batches:Record<string,unknown>[];legacy:Record<string,unknown>[]}
 ledger:{canonical:Assessment[];objects:ObjectAssessment[];ignored:IgnoredFacet[]}
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
  'batches',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.source_message_id,r.requested_scope_key),'[]') FROM gridex_received_sources.structural_apply_batches r WHERE company_id=${company}),
  'legacy',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.source_message_id),'[]') FROM gridex_received_sources.structural_apply_receipts r WHERE company_id=${company})),
 'ledger',jsonb_build_object(
  'canonical',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM gridex_received_sources.validation_assessments r WHERE company_id=${company} AND source_message_id=${source} AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=r.id)),
  'objects',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM gridex_received_sources.object_assessments r WHERE company_id=${company} AND source_message_id=${source} AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=r.id)),
  'ignored',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.canonical_assessment_id),'[]') FROM gridex_received_sources.prodat_ignored_field_facets r JOIN gridex_received_sources.validation_assessments a ON a.id=r.canonical_assessment_id WHERE r.company_id=${company} AND r.source_message_id=${source} AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id))),
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
 expectUnapplied(evidence(f,change.message.id),change.message.id)
 await processInboundEdielMessage({actorUserId:f.operator.id,edielMessageId:change.message.id})
 expectUnapplied(evidence(f,change.message.id),change.message.id)
 const actual=await getEdielMessageById(change.message.id)
 expect(actual).not.toBeNull()
 expect(actual!.raw_payload).toBe(change.message.raw_payload)
 const created=await createOrUpdateInboundProdatCase({actorUserId:f.operator.id,message:actual!})
 const saved=await getEdielInboundCaseForMessage(f.f.companyId,change.message.id)
 expect(saved).not.toBeNull();expect(created?.id).toBe(saved!.id)
 expect(saved).toMatchObject({company_id:f.f.companyId,ediel_message_id:change.message.id,status:'pending_review',message_code:'Z06'})
 // The processor writes a fresh canonical/owner assessment. The helper's
 // earlier reviewed object is not current first-apply authority; review the
 // SAME original again through the existing service and its genuine guards.
 expect(await reviewReceivedStructuralSource({companyId:f.f.companyId,environment:'test',sourceMessageId:change.message.id,reviewerUserId:f.operator.id,confirmedOriginal:true,replacesSourceMessageId:null})).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
 expectUnapplied(evidence(f,change.message.id),change.message.id)
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

function ownEffects(stored:Evidence,sourceId:string){
 const own=(rows:Record<string,unknown>[])=>rows.filter(row=>row.source_message_id===sourceId)
 return {objects:own(stored.receipts.objects),batches:own(stored.receipts.batches),legacy:own(stored.receipts.legacy),expectations:own(stored.expectations)}
}
function expectUnapplied(stored:Evidence,sourceId:string){
 expect(ownEffects(stored,sourceId)).toEqual({objects:[],batches:[],legacy:[],expectations:[]})
}
async function deferredChange(f:Fixture,transformRaw?:(raw:string)=>string){
 let observed:Evidence|undefined,calls=0
 const change=await f.change('G',undefined,{deferFirstApply:true,transformRaw,beforeFirstApply:original=>{
  calls++;observed=evidence(f,original.id)
  expectUnapplied(observed,original.id)
  expect(observed.source.raw).toBe(original.raw_payload)
 }})
 // This callback ran once after the helper's real review, before the processor;
 // the separate fresh snapshot below observes the later actual case approval.
 expect(calls).toBe(1);expect(observed).toBeDefined()
 const initial=evidence(f,change.message.id)
 expect(initial).toEqual(observed);expectUnapplied(initial,change.message.id)
 expect(initial.acks).toEqual([]);expect(initial.outbox).toEqual([])
 return {change,initial}
}
function insertIgnoredUd(raw:string){
 const wire=tokenizeEdifact(raw),installation=wire.segments.filter(segment=>segment.tag==='NAD'&&segmentComposite(segment,1,wire.una)[0]==='IT')
 expect(installation).toHaveLength(1)
 expect(wire.segments.filter(segment=>segment.tag==='NAD'&&segmentComposite(segment,1,wire.una)[0]==='UD')).toEqual([])
 const span=segmentSourceSpan(installation[0])!
 // Public physical INPUT in this first LIN's SG17, before retained NAD IT.
 // Own transaction reason, LI, point and installation bytes are preserved.
 const ud='NAD+UD+IGNORED-G-USER::89++Ignored G Customer+Ignored G Street+Ignored G Town++54321+SE'
 return raw.slice(0,span.startOffset)+ud+wire.una.segmentTerminator+'\n'+raw.slice(span.startOffset)
}
function expectIgnoredUd(f:Fixture,change:Change,stored:Evidence){
 const own=physical(change),wire=tokenizeEdifact(change.message.raw_payload!)
 const ud=wire.segments.filter(segment=>segment.tag==='NAD'&&segmentComposite(segment,1,wire.una)[0]==='UD')
 const installation=wire.segments.find(segment=>segment.tag==='NAD'&&segmentComposite(segment,1,wire.una)[0]==='IT')!
 expect(ud).toHaveLength(1);expect(ud[0].index).toBeGreaterThan(own.lineIndex);expect(ud[0].index).toBeLessThan(installation.index)
 expect(segmentComposite(ud[0],2,wire.una)).toEqual(['IGNORED-G-USER','','89'])
 expect(segmentComposite(installation,2,wire.una)[0]).toBe(f.f.external)
 expect(validateEdifactEnvelope(change.message.raw_payload!).syntaxOk).toBe(true)
 expect(stored.ledger.canonical).toHaveLength(1);expect(stored.ledger.ignored).toHaveLength(1)
 const canonical=stored.ledger.canonical[0],facet=stored.ledger.ignored[0]
 expect(facet).toMatchObject({company_id:f.f.companyId,environment:'test',source_message_id:change.message.id,canonical_assessment_id:canonical.id,source_payload_hash:stored.source.sha256})
 expect(facet.fields_hash).toBe(createHash('sha256').update(facet.fields_text).digest('hex'))
 // Inspect the ACTUAL stored canonical-owner facet. This existing production
 // binding checks physical provenance; it makes no new applicability decision.
 const ignored=bindReceivedProdatIgnoredFields(JSON.parse(facet.fields_text),change.message.raw_payload!)
 expect(ignored).not.toBeNull()
 for(const fieldNumber of ['227','228','229','231','232','316']){
  const entries=ignored!.filter(field=>field.fieldNumber===fieldNumber)
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({sourceRule:'PRODAT26A:P119',occurrence:{scope:'object',objectId:f.f.external,identityAgency:'9',lineIndex:own.lineIndex,lineItemReference:own.li,ownReferences:{customerId:{kind:'present',value:'IGNORED-G-USER'}}}})
 }
}
function expectFirstEffect(f:Fixture,change:Change,before:Evidence,after:Evidence){
 expectUnapplied(before,change.message.id)
 const own=ownEffects(after,change.message.id),scope=physical(change),hash=createHash('sha256').update(change.message.raw_payload!).digest('hex')
 expect(own.objects).toHaveLength(1);expect(own.batches).toHaveLength(1);expect(own.legacy).toEqual([])
 expect(before.ledger.canonical).toHaveLength(1);expect(before.ledger.objects).toHaveLength(1)
 expect(after.ledger).toEqual(before.ledger)
 const canonical=before.ledger.canonical[0],assessment=before.ledger.objects[0]
 for(const record of [canonical,assessment]){
  expect(record).toMatchObject({company_id:f.f.companyId,environment:'test',source_message_id:change.message.id,source_payload_hash:hash})
  expect(record.facts_hash).toBe(createHash('sha256').update(record.facts_text).digest('hex'))
 }
 expect(assessment.canonical_assessment_id).toBe(canonical.id)
 const facts=JSON.parse(assessment.facts_text) as {objects:{object:Record<string,unknown>;disposition:string;business:{owner:string;companyId:string;customerId:string;siteId:string;meteringPointId:string;supplyPeriodId:string;wire:{effectiveFrom:{utc:string}}}}[]}
 expect(facts.objects).toHaveLength(1)
 const accepted=facts.objects[0]
 expect(accepted).toMatchObject({disposition:'accepted',object:{objectId:f.f.external,identityAgency:'9',registers:[{segmentIndex:scope.lineIndex}]},business:{owner:'reviewed-received-structure-v1',companyId:f.f.companyId,customerId:f.f.customerId,siteId:f.f.siteId,meteringPointId:f.f.pointId}})
 expect(accepted.business.supplyPeriodId).toBeTruthy()
 const receipt=own.objects[0],batch=own.batches[0]
 const binding={company_id:f.f.companyId,environment:'test',source_message_id:change.message.id,payload_hash:hash,canonical_assessment_id:canonical.id,object_assessment_id:assessment.id}
 expect(receipt).toMatchObject({...binding,first_line_index:scope.lineIndex,actor_user_id:f.operator.id,source_received_at:before.source.receivedAt})
 expect(receipt.object_scope).toEqual(accepted.object)
 expect(batch).toMatchObject(binding)
 const effect=receipt.effect as {effectiveAt:string;sourceReceivedAt:string;wire:unknown}
 expect(effect).toMatchObject({object:accepted.object,meteringPointId:f.f.pointId,siteId:f.f.siteId,sourceReceivedAt:before.source.receivedAt,wire:{messageCode:'Z06',businessCase:'change_without_reading',caseReference:scope.li,meterNumber:'METER-1',registers:[{position:1,registerId:'101'}]},readingFollowUp:{criterion:'AT-Z06G-SUPPLIER',status:'not_required_by_this_change',fulfilled:false,deadline:null}})
 expect(effect.wire).toEqual(accepted.business.wire)
 expect(Date.parse(effect.effectiveAt)).toBe(Date.parse(accepted.business.wire.effectiveFrom.utc))
 expect(batch.result).toMatchObject({applied:true,appliedCount:1,sourceMessageId:change.message.id,canonicalAssessmentId:canonical.id,objectAssessmentId:assessment.id,objects:[effect],manifest:[{object:accepted.object,status:'applied'}]})
 // Only the new original's dated ledger entry may appear. Prior source effects
 // and unrelated expectation/observation state retain their exact snapshots.
 for(const key of ['objects','batches','legacy'] as const){
  expect(after.receipts[key].filter(row=>row.source_message_id!==change.message.id)).toEqual(before.receipts[key])
 }
 expect(after.expectations.filter(row=>row.source_message_id!==change.message.id)).toEqual(before.expectations)
 expect(after.observations).toEqual(before.observations)
 expect(own.expectations).toEqual([])
}
async function verifyFirstCaseApplication(f:Fixture,change:Change,initial:Evidence,route:{routeId:string;profileId:string},ignoredUd=false){
 const current=await pending(f,change),before=evidence(f,change.message.id)
 expectUnapplied(before,change.message.id)
 expect(before.acks.map(ack=>ack.message_family)).toEqual(['CONTRL'])
 expect(before.market).toEqual(initial.market);expect(before.source).toEqual(initial.source);expect(before.original).toEqual(initial.original)
 expect(before.receipts).toEqual(initial.receipts);expect(before.expectations).toEqual(initial.expectations);expect(before.observations).toEqual(initial.observations)
 if(ignoredUd)expectIgnoredUd(f,change,before)
 const approved=await approveEdielInboundCase({companyId:f.f.companyId,actorUserId:f.operator.id,caseId:current.inboundCase.id,structuralObjectLineIndices:[current.scope.lineIndex]})
 expect(approved).toMatchObject({company_id:f.f.companyId,status:'applied',ediel_message_id:change.message.id})
 const after=evidence(f,change.message.id)
 expectFirstEffect(f,change,before,after);expectOwnAcks(f,change,route,after)
 expect(after.source).toEqual(initial.source);expect(after.source.sha256).toBe(createHash('sha256').update(change.message.raw_payload!).digest('hex'))
 expect(after.original).toEqual(initial.original)
 // The actual implementation commits a source-dated structural version; it
 // deliberately retains global masterdata and earlier meter values.
 expect(after.market).toEqual(initial.market)
 if(ignoredUd){
  expectIgnoredUd(f,change,after)
  expect(after.market.customers).toEqual(initial.market.customers)
  expect(after.market.sites).toEqual(initial.market.sites)
 }
 const dated=await readDatedSourceMeasurements({companyId:f.f.companyId,environment:'test',actorUserId:f.operator.id,cutoffAt:new Date().toISOString()})
 const versions=dated.versions.filter(version=>version.sourceMessageId===change.message.id)
 expect(versions).toHaveLength(1)
 expect(versions[0]).toMatchObject({sourceMessageId:change.message.id,payloadHash:after.source.sha256,assessmentId:before.ledger.objects[0].id,factsHash:before.ledger.objects[0].facts_hash,disposition:'accepted',wire:{businessCase:'change_without_reading',object:ownEffects(after,change.message.id).objects[0].object_scope,caseReference:current.scope.li,meterNumber:'METER-1',registers:[{registerId:'101'}]},measurements:{measurementMethod:'Z04'}})
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
 // Re-review timestamps may advance; original source, first receipt/batch,
 // expectation and committed physical response/outbox identities remain fixed.
 expect({...stable,case:null}).toEqual({...after,case:null})
 expect(replay.review_decision).toEqual(approved.review_decision)
 expect(stable.acks.map(ack=>ack.id)).toEqual(after.acks.map(ack=>ack.id))
 expect(external.send).toHaveBeenCalledTimes(1)
}

// Proposed native controls deliberately fail if actual canonical auth, technical
// endpoint, source-bound route or ACK prerequisites are absent. They do not skip,
// catch-and-pass, seed missing permission keys or substitute mocked effects.
// Inherited field306 input is E22; retained P26.A page60/122 witnesses require
// Z11/Z12. #503 must qualify/fix that existing fixture and canonical code list;
// this unexecuted proposal does not establish guide-valid source admission.
it('deferred G source reaches its first real case apply, own dated effect, physical ACK/outbox and immutable replay',async()=>{
 const f=await fixture(),{change,initial}=await deferredChange(f),route=configureAckRoute(f)
 await verifyFirstCaseApplication(f,change,initial,route)
})

it('physical inapplicable UD in G is retained as actual ignored evidence while own first effect and ACK leave customer identity/address unchanged',async()=>{
 const f=await fixture(),{change,initial}=await deferredChange(f,insertIgnoredUd),route=configureAckRoute(f)
 await verifyFirstCaseApplication(f,change,initial,route,true)
})

it('G case refuses foreign tenant/actor/graph selections and invalid own LIN scopes without new effects',async()=>{
 const f=await fixture(),foreign=await fixture(),{change}=await deferredChange(f)
 const route=configureAckRoute(f)
 const current=await pending(f,change),before=evidence(f,change.message.id),foreignBefore=evidence(foreign,foreign.f.source)
 expectUnapplied(before,change.message.id)
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
 // A real public synthetic DENY must refuse BEFORE any own first effect.
 // Remove only this disposable override; existing genuine permissions decide
 // the same-original positive contrast. No allow/registry grant is fabricated.
 const denyId=randomUUID()
 sql(`INSERT INTO public.user_permission_overrides(id,user_id,company_id,permission_key,effect,is_active,valid_from)
 VALUES(${literal(denyId)},${literal(f.operator.id)},${literal(f.f.companyId)},'communication.write','deny',true,clock_timestamp()-interval '1 second');`)
 await expect(approveEdielInboundCase({...base,structuralObjectLineIndices:[current.scope.lineIndex]})).rejects.toThrow('ediel_tenant_permission_forbidden')
 expect(evidence(f,change.message.id)).toEqual(before)
 expect(evidence(foreign,foreign.f.source)).toEqual(foreignBefore)
 sql(`DELETE FROM public.user_permission_overrides WHERE id=${literal(denyId)} AND user_id=${literal(f.operator.id)} AND company_id=${literal(f.f.companyId)} AND permission_key='communication.write' AND effect='deny';`)
 expectUnapplied(evidence(f,change.message.id),change.message.id)
 const approved=await approveEdielInboundCase({...base,structuralObjectLineIndices:[current.scope.lineIndex]})
 expect(approved.status).toBe('applied')
 const after=evidence(f,change.message.id)
 expectFirstEffect(f,change,before,after);expectOwnAcks(f,change,route,after)
 expect(after.source).toEqual(before.source);expect(after.original).toEqual(before.original);expect(after.market).toEqual(before.market)
 expect(evidence(foreign,foreign.f.source)).toEqual(foreignBefore)
})
