import {createHash,randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const delivery=vi.hoisted(()=>({smtp:vi.fn()}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:delivery.smtp})}}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {createRequestedCustomerChangeNativeFixture,createRequestedDeathNativeFixture} from './helpers/ediel-requested-customer-change-native-fixture'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {archiveRequestedCustomerChangeSource,readRequestedCustomerChangeSourceArtifact,readRequestedCustomerChangeSourceBytes,reviewRequestedCustomerChangeSourceArtifact} from '@/lib/ediel/production/requestedCustomerChangeSource'
import {readRequestedCustomerChangeFacts,requestedCustomerChangeRegisterFacts} from '@/lib/ediel/production/requestedCustomerChangeFacts'
import {readCustomerLifeEventSource} from '@/lib/ediel/production/lifeEventSource'
import {prepareAndQueueRequestedCustomerChange} from '@/lib/ediel/flows/prodatRequestedCustomerChange'
import {resolveCanonicalActorContext} from '@/lib/ediel/core/actorRegistry'
import {createCanonicalOutboundMessage} from '@/lib/ediel/core/kernel'
import {supabaseService} from '@/lib/supabase/service'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {validateRulebookMessageWithRegistry} from '@/lib/ediel/rulebook/validator'
import {archiveRequestedChangeSource,reviewRequestedChangeArtifact} from '@/lib/ediel/production/requestedChangeIntake'
import {readRequestedChangeSource} from '@/lib/ediel/production/requestedChangeSource'
import {prepareAndQueueProdatRequestedChange} from '@/lib/ediel/flows/prodatRequestedChange'
import {captureBilateralCustomerNativeSource} from './helpers/ediel-bilateral-customer-native-fixture'
import {bilateralCustomerNativeWire} from './helpers/ediel-bilateral-customer-native-wire'
import {applyConfirmedCustomerSource} from '@/lib/ediel/production/confirmedCustomerSource'
import {readConfirmedCustomerHistory,isConfirmedCustomerHistoryQualified} from '@/lib/ediel/production/confirmedCustomerHistory'
import {inspectStructuralReadset} from '@/lib/ediel/sources/structuralSourceReadset'
afterEach(()=>{vi.unstubAllEnvs();delivery.smtp.mockReset()})
async function fixture(){for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v);return createRequestedCustomerChangeNativeFixture(email=>delivery.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'}))}
async function deathFixture(){for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v);return createRequestedDeathNativeFixture(email=>delivery.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'}))}
type DeathFixture=Awaited<ReturnType<typeof deathFixture>>
function deathBusiness(f:DeathFixture){return sql(`SELECT jsonb_build_object('customer',(SELECT to_jsonb(c) FROM public.customers c WHERE id=${literal(f.customerId)}),'supply',(SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE id=${literal(f.period)}),'point',(SELECT to_jsonb(p) FROM public.metering_points p WHERE id=${literal(f.pointId)}),'site',(SELECT to_jsonb(s) FROM public.customer_sites s WHERE id=${literal(f.siteId)}),'switches',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.supplier_switch_requests s WHERE company_id=${literal(f.companyId)}))`)}
async function reviewDeath(f:DeathFixture){
 const artifact=await archiveRequestedChangeSource({...f.deathSubmission('SYNTHETIC exact signed death original'),companyId:f.companyId,actorUserId:f.uploader.id})
 expect(artifact.status).toBe('archived')
 expect(artifact.missing).toEqual(['separate_source_review_required'])
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_requested_changes.events WHERE company_id=${literal(f.companyId)}`)).toBe(0)
 const reviewed=await reviewRequestedChangeArtifact({...artifact,companyId:f.companyId,actorUserId:f.reviewer.id,decision:'approve',reason:'Synthetic separate review of complete signed death UD/IV underlag'})
 expect(reviewed.status).toBe('authorized');if(reviewed.status!=='authorized')throw Error('actual_reviewed_death_event_required')
 const basis=await readRequestedChangeSource({companyId:f.companyId,eventId:reviewed.eventId,actorUserId:f.uploader.id})
 expect(basis).toMatchObject({status:'authorized',variant:'E',eventKind:'death',supplyPeriodId:f.period,customerId:f.customerId})
 if(basis.status!=='authorized')throw Error('actual_current_death_source_required')
 expect(Date.parse(basis.effectiveAt)).toBe(Date.parse(f.effectiveAt))
 return reviewed
}
it('actual non-death outgoing mandate archives missing authority, holds separate review and makes no event or queue',async()=>{
 const f=await fixture(),scope={companyId:f.companyId,actorUserId:f.uploader.id},before=sql(`SELECT jsonb_build_object('events',(SELECT count(*) FROM gridex_customer_life_events.events WHERE company_id=${literal(f.companyId)}),'messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_code='Z09'))`)
 const artifact=await archiveRequestedCustomerChangeSource({...f.submission('SYNTHETIC missing outgoing issuer',f.pdf('held'),false),...scope});expect(artifact.missing).toContain('authentic_current_outgoing_customer_mandate')
 expect(await reviewRequestedCustomerChangeSourceArtifact({artifactId:artifact.artifactId,sourceHash:artifact.sourceHash,claimsHash:artifact.claimsHash,companyId:f.companyId,actorUserId:f.reviewer.id,decision:'approve',reason:'Synthetic missing actual outgoing authority',clause:f.clause})).toMatchObject({status:'held'})
 expect(await prepareAndQueueRequestedCustomerChange({...scope,artifactId:artifact.artifactId})).toMatchObject({status:'held'})
 expect(sql(`SELECT jsonb_build_object('events',(SELECT count(*) FROM gridex_customer_life_events.events WHERE company_id=${literal(f.companyId)}),'messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_code='Z09'))`)).toEqual(before)
})

it('genuine generic death archive and separate review reach the actual Z09 gateway and fresh SMTP send without automatic customer effects',async()=>{
 const f=await deathFixture(),before=deathBusiness(f),reviewed=await reviewDeath(f)
 // Archive/review operators remain separate from the real dispatch caller.
 expect(sql(`SELECT jsonb_build_object('archive',public.gridex_actor_has_company_permission(${literal(f.uploader.id)},${literal(f.companyId)},'communication.write'),'send',public.gridex_actor_has_company_permission(${literal(f.uploader.id)},${literal(f.companyId)},'communication.send'))`)).toEqual({archive:true,send:false})
 expect(sql(`SELECT jsonb_build_object('write',public.gridex_actor_has_company_permission(${literal(f.actorUserId)},${literal(f.companyId)},'communication.write'),'send',public.gridex_actor_has_company_permission(${literal(f.actorUserId)},${literal(f.companyId)},'communication.send'))`)).toEqual({write:true,send:true})
 const scope={companyId:f.companyId,eventId:reviewed.eventId,actorUserId:f.actorUserId,preferredRouteId:f.customerRouteId}
 expect(await readRequestedChangeSource(scope)).toMatchObject({status:'authorized',eventId:reviewed.eventId,eventKind:'death'})
 let stage='gateway'
 try{
 const result=await prepareAndQueueProdatRequestedChange(scope)
 expect(result.status).toBe('queued');if(result.status==='held')throw Error('actual_death_original_gateway_required')
 const message=result.message,e=EdifactEnvelopeCodec.decode(message.raw_payload)
 expect(sql(`SELECT jsonb_build_object('validated',i.validation_status='validated' AND i.validation_result->>'ok'='true' AND i.validation_result->>'status'='validated' AND i.blocking_reasons='[]'::jsonb,'originalBinding',i.ediel_message_id=m.id AND i.outbound_request_id=m.outbound_request_id,'ownedSite',i.customer_site_id=p.site_id AND m.site_id=p.site_id AND o.intent_binding->>'customer_site_id'=p.site_id::text,'ownedRequest',(SELECT r.site_id=p.site_id AND o.request_binding->>'site_id'=p.site_id::text FROM public.outbound_requests r WHERE r.id=m.outbound_request_id AND r.company_id=m.company_id AND r.customer_id=m.customer_id AND r.metering_point_id=m.metering_point_id)) FROM public.ediel_messages m JOIN public.ediel_message_intents i ON i.id=m.intent_id AND i.company_id=m.company_id JOIN public.metering_points p ON p.id=m.metering_point_id AND p.company_id=m.company_id AND p.customer_id=m.customer_id JOIN gridex_requested_changes.origins o ON o.intent_id=i.id AND o.company_id=m.company_id WHERE m.id=${literal(message.id)}`)).toEqual({validated:true,originalBinding:true,ownedSite:true,ownedRequest:true})
 expect(message).toMatchObject({direction:'outbound',message_family:'PRODAT',message_code:'Z09',sender_ediel_id:f.sender,receiver_ediel_id:f.receiver,source_operation_id:reviewed.eventId})
 expect(e.applicationReference).toBe('23-DDQ-PRODAT')
 expect(e.segments.find(s=>s.tag==='BGM')!.elements[1]).toBe('Z09')
 expect(e.segments.filter(s=>s.tag==='CAV').map(s=>segmentComposite(s,1,e.una)[0])).toEqual(expect.arrayContaining(['E34','Z41']))
 expect(segmentComposite(e.segments.find(s=>s.tag==='NAD'&&segmentComposite(s,1,e.una)[0]==='UD')!,2,e.una)).toEqual([f.customerIdentity.id,'SE2','260'])
 expect(segmentComposite(e.segments.find(s=>s.tag==='DTM'&&segmentComposite(s,1,e.una)[0]==='157')!,1,e.una)).toEqual(['157',f.marketMinute,'203'])
 expect(e.segments.filter(s=>s.tag==='RFF'&&segmentComposite(s,1,e.una)[0]==='LI')).toHaveLength(1)
 stage='gateway_retry'
 expect(await prepareAndQueueProdatRequestedChange(scope)).toMatchObject({status:'existing',message:{id:message.id,raw_payload:message.raw_payload}})
 expect(deathBusiness(f)).toEqual(before)
 const calls=delivery.smtp.mock.calls.length
 // This successful-send oracle deliberately exposes any genuine current
 // consumer incompatibility; no historical-source refusal is suppressed.
 stage='fresh_send'
 expect(await sendEdielMessageViaSmtp(message,{actorUserId:f.actorUserId})).toMatchObject({accepted:['recipient@example.invalid'],rejected:[],messageId:expect.any(String)})
 expect(delivery.smtp).toHaveBeenCalledTimes(calls+1)
 const sent=await supabaseService.from('ediel_messages').select('raw_payload,message_sent_at').eq('id',message.id).single();expect(sent.error).toBeNull()
 expect(sent.data?.raw_payload).toBe(message.raw_payload);expect(sent.data?.message_sent_at).toBeTruthy()
 expect(sql(`SELECT jsonb_build_object('primary',(SELECT count(*) FROM gridex_customer_life_events.customer_versions WHERE company_id=${literal(f.companyId)}),'desired',(SELECT count(*) FROM gridex_customer_life_events.desired_changes WHERE company_id=${literal(f.companyId)}),'confirmed',(SELECT count(*) FROM gridex_requested_changes.confirmed_customer_versions WHERE company_id=${literal(f.companyId)}),'automaticZ06',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND direction='outbound' AND message_code='Z06'))`)).toEqual({primary:0,desired:0,confirmed:0,automaticZ06:0})
 expect(deathBusiness(f)).toEqual(before)
 }catch(error){
  // Vitest does not serialize the wrapped PostgREST cause. Only bounded
  // identifiers may leave this failure path; never details/hints/receipts.
  const cause=error instanceof Error?error.cause:undefined
  const identifier=(value:unknown)=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(value)?value:'unavailable'
  const causeIdentifiers=cause&&typeof cause==='object'?{code:identifier('code'in cause?cause.code:undefined),message:identifier('message'in cause?cause.message:undefined)}:{code:'unavailable',message:'unavailable'}
  try{
   const diagnostic=sql(`SELECT jsonb_build_object('status',current_basis->>'status','missing',current_basis->'missing','basisEqual',current_basis=o.basis,'differentKeys',(SELECT jsonb_agg(k ORDER BY k) FROM (SELECT jsonb_object_keys(current_basis||o.basis) k) keys WHERE current_basis->k IS DISTINCT FROM o.basis->k),'originalCount',(SELECT count(*) FROM public.ediel_messages m WHERE m.company_id=o.company_id AND m.intent_id=o.intent_id),'timezone',current_setting('TimeZone')) FROM gridex_requested_changes.origins o CROSS JOIN LATERAL (SELECT gridex_requested_changes.context_v1(o.company_id,o.event_id,${literal(f.actorUserId)},'communication.send') AS current_basis) current_source WHERE o.company_id=${literal(f.companyId)} AND o.event_id=${literal(reviewed.eventId)}`)
   const projection=sql(`SELECT jsonb_build_object('requestSiteEqual',r.site_id IS NOT DISTINCT FROM m.site_id,'messageSentClock',m.message_sent_at IS NOT NULL,'acceptedJournalCount',(SELECT count(*) FROM gridex_ediel_transport.attempts a WHERE a.message_id=m.id AND a.company_id=m.company_id AND a.environment=m.environment AND a.entered_at IS NOT NULL AND a.observed_at IS NOT NULL AND a.classification='accepted')) FROM gridex_requested_changes.origins o JOIN public.ediel_messages m ON m.id=o.message_id AND m.company_id=o.company_id JOIN public.outbound_requests r ON r.id=m.outbound_request_id AND r.company_id=m.company_id WHERE o.company_id=${literal(f.companyId)} AND o.event_id=${literal(reviewed.eventId)}`)
   console.warn('generic_death_native_failure',JSON.stringify({stage,causeIdentifiers,diagnostic,projection}))
  }catch{console.warn('generic_death_native_failure',JSON.stringify({stage,causeIdentifiers,diagnostic:'unavailable'}))}
  throw error
 }
},120000)

it('genuine reviewed death event qualifies only its own physical Z06 confirmed facet and committed history; orphan and retry have no primary customer effect',async()=>{
 const f=await deathFixture(),before=deathBusiness(f),reference=randomUUID().replaceAll('-','').slice(0,14).toUpperCase()
 const base=EdifactEnvelopeCodec.decode(bilateralCustomerNativeWire({sender:f.receiver,receiver:f.sender,point:f.external,customerIdentity:f.customerIdentity.id,reference:'LI'+reference,marketMinute:f.marketMinute,repeatRegister:false,invoicee:true}))
 const body=base.segments.filter(s=>!['UNB','UNH','UNT','UNZ'].includes(s.tag)).flatMap(s=>{
  if(s.tag==='BGM')return ['BGM+Z06+'+reference+'+9+AB']
  return [s.raw,...(s.tag==='CAV'&&segmentComposite(s,1,base.una)[0]==='E34'?['CCI++Z17','CAV+Z41']:[])]
 })
 const wire=EdifactEnvelopeCodec.encode({sender:f.receiver,receiver:f.sender,senderQualifier:base.senderQualifier,receiverQualifier:base.receiverQualifier,senderSubAddress:base.senderSubAddress,receiverSubAddress:base.receiverSubAddress,applicationReference:base.applicationReference,acknowledgementRequest:true,environment:'test',interchangeReference:reference,una:base.una,messages:[{messageReference:reference,messageTypeToken:base.segments.find(s=>s.tag==='UNH')!.elements[2],businessSegments:body}]})
 // Actual no-context canonical admission, complete record, capture and finish.
 // No requested outgoing context is relabelled as an inbound classification.
 const source=await captureBilateralCustomerNativeSource(f,{sourceWire:wire,physicalBirth:true,repeatRegister:false})
 const input={companyId:f.companyId,sourceMessageId:source.sourceMessageId,actorUserId:f.reviewer.id}
 expect(await applyConfirmedCustomerSource(input)).toEqual({applied:false,reason:'customer_source_qualified_life_event_missing'})
 const state=()=>sql(`SELECT jsonb_build_object('confirmed',(SELECT count(*) FROM gridex_requested_changes.confirmed_customer_versions WHERE source_message_id=${literal(source.sourceMessageId)}),'availability',(SELECT count(*) FROM gridex_requested_changes.customer_version_availability WHERE source_message_id=${literal(source.sourceMessageId)}),'primary',(SELECT count(*) FROM gridex_customer_life_events.customer_versions WHERE company_id=${literal(f.companyId)}),'transitions',(SELECT count(*) FROM gridex_customer_life_events.transitions WHERE company_id=${literal(f.companyId)}),'primaryReceipts',(SELECT count(*) FROM gridex_received_sources.customer_primary_response_receipts WHERE source_message_id=${literal(source.sourceMessageId)}))`)
 expect(state()).toEqual({confirmed:0,availability:0,primary:0,transitions:0,primaryReceipts:0})
 expect(deathBusiness(f)).toEqual(before)
 const reviewed=await reviewDeath(f),payloadHash=createHash('sha256').update(wire).digest('hex')
 expect(await applyConfirmedCustomerSource(input)).toMatchObject({applied:true,sourceMessageId:source.sourceMessageId,eventId:reviewed.eventId,payloadHash})
 expect(state()).toEqual({confirmed:1,availability:1,primary:0,transitions:0,primaryReceipts:0})
 expect(sql(`SELECT jsonb_build_object('event',event_id,'bilateral',bilateral_artifact_id,'source',source_message_id,'payloadHash',payload_hash,'period',supply_period_id,'object',object_id,'agency',identity_agency,'canonical',canonical_assessment_id IS NOT NULL,'effectiveMs',extract(epoch FROM effective_at)*1000,'party',party) FROM gridex_requested_changes.confirmed_customer_versions WHERE source_message_id=${literal(source.sourceMessageId)}`)).toMatchObject({event:reviewed.eventId,bilateral:null,source:source.sourceMessageId,payloadHash,period:f.period,object:f.external,agency:'9',canonical:true,effectiveMs:Date.parse(f.effectiveAt),party:{id:f.customerIdentity.id,qualifier:'SE2',agency:'260',deathStatus:'Z41'}})
 const cutoffAt=sql<string>('SELECT to_jsonb(clock_timestamp())'),scope={companyId:f.companyId,environment:'test' as const,customerId:f.customerId,siteId:f.siteId,meteringPointId:f.pointId,legalSupplier:f.sender,legalNetwork:f.receiver,fromDate:f.requestedStartDate,toDate:f.requestedStartDate,cutoffAt}
 const snapshot=await supabaseService.rpc('gridex_source_object_snapshot_v1',{p_company_id:f.companyId,p_environment:'test',p_cutoff:cutoffAt});expect(snapshot.error).toBeNull()
 const readset=inspectStructuralReadset(scope,snapshot.data);expect(readset.timeline).toMatchObject({status:'inspected',boundedReadComplete:true})
 const history=await readConfirmedCustomerHistory({scope,readset,actorUserId:f.reviewer.id})
 expect(isConfirmedCustomerHistoryQualified(history,scope,readset)).toBe(true);expect(history.versions).toHaveLength(1)
 expect(history.versions[0]).toMatchObject({sourceMessageId:source.sourceMessageId,payloadHash,supplyPeriodId:f.period,objectId:f.external,identityAgency:'9',marketMinute:f.marketMinute,legalSender:f.receiver,legalReceiver:f.sender,party:{id:f.customerIdentity.id,qualifier:'SE2',agency:'260',deathStatus:'Z41'}})
 expect(Date.parse(history.versions[0].effectiveAt)).toBe(Date.parse(f.effectiveAt))
 const stable=state()
 expect(await applyConfirmedCustomerSource(input)).toMatchObject({applied:true,sourceMessageId:source.sourceMessageId,eventId:reviewed.eventId,payloadHash})
 expect(state()).toEqual(stable);expect(deathBusiness(f)).toEqual(before)
 expect((await supabaseService.from('ediel_messages').select('raw_payload').eq('id',source.sourceMessageId).single()).data?.raw_payload).toBe(wire)
},120000)
it('actual independent outgoing review publishes exact immutable non-death event; current issuer/reviewer revocation blocks every fresh consumer',async()=>{
 const f=await fixture(),scope={companyId:f.companyId,actorUserId:f.uploader.id},original=f.pdf('actual original'),artifact=await archiveRequestedCustomerChangeSource({...f.submission('SYNTHETIC exact outgoing customer agreement',original),...scope})
 expect(artifact.missing).toEqual([]);expect(Buffer.from((await readRequestedCustomerChangeSourceBytes({...scope,artifactId:artifact.artifactId})).bytes)).toEqual(original)
 await expect(reviewRequestedCustomerChangeSourceArtifact({artifactId:artifact.artifactId,sourceHash:artifact.sourceHash,claimsHash:artifact.claimsHash,...scope,decision:'approve',reason:'Synthetic self approval',clause:f.clause})).rejects.toMatchObject({message:'requested_customer_change_separate_reviewer_required'})
 const reviewed=await reviewRequestedCustomerChangeSourceArtifact({artifactId:artifact.artifactId,sourceHash:artifact.sourceHash,claimsHash:artifact.claimsHash,companyId:f.companyId,actorUserId:f.reviewer.id,decision:'approve',reason:'Synthetic separate whole original review',clause:f.clause});expect(reviewed.status).toBe('authorized');if(reviewed.status!=='authorized')throw Error('genuine_outgoing_review_required')
 expect(sql(`SELECT jsonb_build_object('classification',classification,'payload',approved_raw_payload,'death',allowed_customer_fields@>ARRAY['310'])FROM gridex_customer_life_events.events WHERE id=${literal(reviewed.eventId)}`)).toEqual({classification:'other_masterdata',payload:f.rawPayload,death:false})
 const basis=await readCustomerLifeEventSource({...scope,eventId:reviewed.eventId});expect(basis.status).toBe('authorized');if(basis.status!=='authorized')throw Error('genuine_selection_event_basis_required')
 const selectedScope={...scope,eventId:reviewed.eventId,basis},selection=await readRequestedCustomerChangeFacts(selectedScope)
 expect(selection?.status).toBe('qualified');if(selection?.status!=='qualified')throw Error('genuine_signed_selection_required')
 const selectedFacts=requestedCustomerChangeRegisterFacts(selection,selectedScope)
 expect(selectedFacts.endUserAddressObjects).toEqual([expect.objectContaining({meteringPointId:basis.pointId,availability:'available',source:expect.objectContaining({kind:'caller_selection',companyId:f.companyId})})])
 expect(selectedFacts.invoiceeObjects).toHaveLength(1)
 expect(()=>requestedCustomerChangeRegisterFacts({...selection},selectedScope)).toThrow('selected_facts_invalid')
 await expect(readRequestedCustomerChangeFacts({...selectedScope,basis:{...basis,sourceDigest:'f'.repeat(64)}})).rejects.toThrow('selected_facts_invalid')
 const again=await reviewRequestedCustomerChangeSourceArtifact({artifactId:artifact.artifactId,sourceHash:artifact.sourceHash,claimsHash:artifact.claimsHash,companyId:f.companyId,actorUserId:f.reviewer.id,decision:'approve',reason:'Synthetic current idempotent review',clause:f.clause});expect(again).toMatchObject({eventId:reviewed.eventId})
 sql(`INSERT INTO public.user_permission_overrides(company_id,user_id,permission_key,effect,is_active,valid_from,valid_to)VALUES(${literal(f.companyId)},${literal(f.reviewer.id)},'ediel.source.review','deny',true,now()-interval '1 day',now()+interval '1 day')`)
 expect(await readRequestedCustomerChangeFacts(selectedScope)).toMatchObject({status:'held'})
 expect((await readRequestedCustomerChangeSourceArtifact({...scope,artifactId:artifact.artifactId})).status).toBe('held');expect(await prepareAndQueueRequestedCustomerChange({...scope,artifactId:artifact.artifactId})).toMatchObject({status:'held'})
})
it('actual qualified outgoing source reaches the existing atomic original/intent/outbox gateway and immutable retry',async()=>{
 const f=await fixture(),scope={companyId:f.companyId,actorUserId:f.uploader.id},artifact=await archiveRequestedCustomerChangeSource({...f.submission('SYNTHETIC outgoing original gateway',f.pdf('gateway')),...scope})
 expect(await reviewRequestedCustomerChangeSourceArtifact({artifactId:artifact.artifactId,sourceHash:artifact.sourceHash,claimsHash:artifact.claimsHash,companyId:f.companyId,actorUserId:f.reviewer.id,decision:'approve',reason:'Synthetic separate outgoing review',clause:f.clause})).toMatchObject({status:'authorized'})
 const result=await prepareAndQueueRequestedCustomerChange({...scope,artifactId:artifact.artifactId});expect(result.status).toBe('queued');if(result.status==='held')throw Error('genuine_outgoing_original_gateway_required')
 expect(result.message.raw_payload).toBe(f.rawPayload)
 expect(sql(`SELECT jsonb_build_object('originals',(SELECT count(*) FROM gridex_customer_life_events.originals WHERE company_id=${literal(f.companyId)}),'desired',(SELECT count(*) FROM gridex_customer_life_events.desired_changes WHERE company_id=${literal(f.companyId)}),'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(result.message.id)}))`)).toMatchObject({originals:1,desired:1,outbox:1})
 expect(await prepareAndQueueRequestedCustomerChange({...scope,artifactId:artifact.artifactId})).toMatchObject({status:'existing',message:{id:result.message.id}})
 // Unsent original: accepted-journal replay after later revocation is a
 // separate legitimate path. This assertion exercises a fresh dispatch only.
 expect(sql(`SELECT to_jsonb(message_sent_at IS NULL) FROM public.ediel_messages WHERE id=${literal(result.message.id)} AND company_id=${literal(f.companyId)}`)).toBe(true)
 const alive=await supabaseService.rpc('ediel_customer_life_event_message_basis_v1',{p_company_id:f.companyId,p_message_id:result.message.id,p_actor_user_id:f.actorUserId})
 expect(alive.error).toBeNull();expect(alive.data).toMatchObject({basis:{status:'authorized',rawPayload:f.rawPayload}})
 const dispatchState=()=>sql(`SELECT jsonb_build_object('original',(SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(result.message.id)}),'desired',(SELECT jsonb_agg(to_jsonb(d) ORDER BY event_id) FROM gridex_customer_life_events.desired_changes d WHERE company_id=${literal(f.companyId)}),'originals',(SELECT jsonb_agg(to_jsonb(o) ORDER BY message_id) FROM gridex_customer_life_events.originals o WHERE company_id=${literal(f.companyId)}),'customer',(SELECT to_jsonb(c) FROM public.customers c WHERE id=${literal(f.customerId)}),'supply',(SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE id=${literal(f.period)}),'outbox',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.ediel_outbox o WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(result.message.id)}),'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.ediel_message_events e WHERE company_id=${literal(f.companyId)} AND (message_id=${literal(result.message.id)} OR ediel_message_id=${literal(result.message.id)})),'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM gridex_ediel_transport.attempts a WHERE company_id=${literal(f.companyId)} AND message_id=${literal(result.message.id)}),'workerAttempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM gridex_outbound_dispatch.attempts a WHERE company_id=${literal(f.companyId)} AND message_id=${literal(result.message.id)}),'workerEvents',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM gridex_outbound_dispatch.events e WHERE company_id=${literal(f.companyId)} AND message_id=${literal(result.message.id)}))`)
 const beforeDispatch=dispatchState(),providerCalls=delivery.smtp.mock.calls.length
 sql(`INSERT INTO gridex_requested_customer_changes.revocations(target_kind,target_id,source_reference,source_hash)VALUES('key',${literal(f.keyId)},'SYNTHETIC issuer revoked after original',${literal('b'.repeat(64))})`)
 await expect(sendEdielMessageViaSmtp(result.message,{actorUserId:f.actorUserId})).rejects.toMatchObject({code:'P0001',message:'customer_life_event_current_original_scope_changed'})
 expect(dispatchState()).toEqual(beforeDispatch);expect(delivery.smtp).toHaveBeenCalledTimes(providerCalls)
 expect(await prepareAndQueueRequestedCustomerChange({...scope,artifactId:artifact.artifactId})).toMatchObject({status:'held'})
})

it('actual supplier role refuses a fresh DSO sender before source validation; the genuine current supplier queues its reviewed original',async()=>{
 const f=await fixture(),actor=await resolveCanonicalActorContext('test',f.companyId,'supplier')
 expect(actor.senderEdielId).toBe(f.sender);expect(actor.marketRoles).toContain('electricity_supplier')
 expect(f.receiver).not.toBe(f.sender)
 expect(sql(`SELECT to_jsonb(count(DISTINCT a.counterparty_actor_id)) FROM public.tenant_bilateral_agreements a JOIN public.platform_actor_identifiers i ON i.actor_id=a.counterparty_actor_id JOIN public.platform_actor_roles r ON r.actor_id=i.actor_id WHERE a.id=${literal(f.agreementId)} AND a.company_id=${literal(f.companyId)} AND a.environment='test' AND a.is_enabled AND i.identifier_type='EdielId' AND i.identifier_value=${literal(f.receiver)} AND i.is_verified AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR i.valid_to>=current_date) AND r.actor_role='grid_owner' AND r.is_active`)).toBe(1)
 const state=()=>sql(`SELECT jsonb_build_object('messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)}),'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)}),'witnesses',(SELECT count(*) FROM gridex_ediel_outbound_owner.witnesses WHERE company_id=${literal(f.companyId)}),'originals',(SELECT count(*) FROM gridex_customer_life_events.originals WHERE company_id=${literal(f.companyId)}),'desired',(SELECT count(*) FROM gridex_customer_life_events.desired_changes WHERE company_id=${literal(f.companyId)}),'events',(SELECT count(*) FROM gridex_customer_life_events.events WHERE company_id=${literal(f.companyId)}),'customer',(SELECT to_jsonb(c) FROM public.customers c WHERE id=${literal(f.customerId)}),'supply',(SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE id=${literal(f.period)}))`)
 const before=state(),calls=delivery.smtp.mock.calls.length,e=EdifactEnvelopeCodec.decode(f.rawPayload)
 const body=e.segments.filter(segment=>!['UNB','UNH','UNT','UNZ'].includes(segment.tag)).map(segment=>segment.tag==='NAD'&&segmentComposite(segment,1,e.una)[0]==='FR'?segment.raw.replace('NAD+FR+'+actor.legalActorEdielId,'NAD+FR+'+f.receiver):segment.tag==='NAD'&&segmentComposite(segment,1,e.una)[0]==='DO'?segment.raw.replace('NAD+DO+'+f.receiver,'NAD+DO+'+actor.legalActorEdielId):segment.tag==='BGM'?'BGM+Z09+'+randomUUID().replaceAll('-','')+'+9+AB':segment.raw)
 const raw=EdifactEnvelopeCodec.encode({sender:f.receiver,receiver:f.sender,senderQualifier:e.receiverQualifier,receiverQualifier:e.senderQualifier,applicationReference:e.applicationReference,acknowledgementRequest:true,environment:'test',interchangeReference:randomUUID().replaceAll('-','').slice(0,14),messages:[{messageReference:randomUUID().replaceAll('-','').slice(0,14),messageTypeToken:e.segments.find(segment=>segment.tag==='UNH')!.elements[2],businessSegments:body}]})
 const create=(wire:string,sender:string,receiver:string)=>createCanonicalOutboundMessage({actorUserId:f.actorUserId,requestType:'customer_masterdata',baseInput:{actorUserId:f.actorUserId,companyId:f.companyId,environment:'test',direction:'outbound',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z09',applicationReference:'23-DDQ-PRODAT',senderEdielId:sender,receiverEdielId:receiver,sourceOperationId:randomUUID(),rawPayload:wire}})
 await expect(create(raw,f.receiver,f.sender)).rejects.toThrow('canonical_outbound_sender_identity_mismatch:supplier')
 expect(state()).toEqual(before);expect(delivery.smtp).toHaveBeenCalledTimes(calls)
 const dateEventRow={company_id:f.companyId,environment:'test' as const,direction:'outbound' as const,message_code:'Z09',sender_ediel_id:f.sender,receiver_ediel_id:f.receiver,sender_sub_address:null,receiver_sub_address:null,application_reference:'23-DDQ-PRODAT',transport_type:'smtp' as const,receiver_email:null,communication_route_id:null,route_profile_id:null,mailbox:null}
 const validation=await validateRulebookMessageWithRegistry({family:'PRODAT',code:'Z09',rawPayload:f.rawPayload,applicationReference:'23-DDQ-PRODAT',mode:'send',direction:'outbound',environment:'test',companyId:f.companyId,dateEventRow})
 expect(validation.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED'})]))
 const first=validation.issues.find(issue=>issue.severity==='error'||issue.blocking);expect(first).toBeDefined()
 await expect(create(f.rawPayload,f.sender,f.receiver)).rejects.toThrow(`${first!.code} - ${first!.description}`)
 expect(state()).toEqual(before);expect(delivery.smtp).toHaveBeenCalledTimes(calls)
 const scope={companyId:f.companyId,actorUserId:f.uploader.id},artifact=await archiveRequestedCustomerChangeSource({...f.submission('SYNTHETIC genuine role control',f.pdf('role control')),...scope})
 expect(artifact.missing).toEqual([])
 expect(await reviewRequestedCustomerChangeSourceArtifact({artifactId:artifact.artifactId,sourceHash:artifact.sourceHash,claimsHash:artifact.claimsHash,companyId:f.companyId,actorUserId:f.reviewer.id,decision:'approve',reason:'Synthetic independent role control',clause:f.clause})).toMatchObject({status:'authorized'})
 const queued=await prepareAndQueueRequestedCustomerChange({...scope,artifactId:artifact.artifactId});expect(queued.status).toBe('queued');if(queued.status==='held')throw Error('genuine_supplier_role_control_required')
 expect(queued.message).toMatchObject({sender_ediel_id:f.sender,receiver_ediel_id:f.receiver,raw_payload:f.rawPayload})
 expect(sql(`SELECT jsonb_build_object('originals',(SELECT count(*) FROM gridex_customer_life_events.originals WHERE company_id=${literal(f.companyId)}),'desired',(SELECT count(*) FROM gridex_customer_life_events.desired_changes WHERE company_id=${literal(f.companyId)}),'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(queued.message.id)}),'customer',(SELECT to_jsonb(c) FROM public.customers c WHERE id=${literal(f.customerId)}),'supply',(SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE id=${literal(f.period)}))`)).toEqual(expect.objectContaining({originals:1,desired:1,outbox:1,...Object.fromEntries(Object.entries(before as Record<string,unknown>).filter(([key])=>key==='customer'||key==='supply'))}))
},120000)
