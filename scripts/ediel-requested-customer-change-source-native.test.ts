import {randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const delivery=vi.hoisted(()=>({smtp:vi.fn()}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:delivery.smtp})}}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {createRequestedCustomerChangeNativeFixture} from './helpers/ediel-requested-customer-change-native-fixture'
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
afterEach(()=>{vi.unstubAllEnvs();delivery.smtp.mockReset()})
async function fixture(){for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v);return createRequestedCustomerChangeNativeFixture(email=>delivery.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'}))}
it('actual non-death outgoing mandate archives missing authority, holds separate review and makes no event or queue',async()=>{
 const f=await fixture(),scope={companyId:f.companyId,actorUserId:f.uploader.id},before=sql(`SELECT jsonb_build_object('events',(SELECT count(*) FROM gridex_customer_life_events.events WHERE company_id=${literal(f.companyId)}),'messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_code='Z09'))`)
 const artifact=await archiveRequestedCustomerChangeSource({...f.submission('SYNTHETIC missing outgoing issuer',f.pdf('held'),false),...scope});expect(artifact.missing).toContain('authentic_current_outgoing_customer_mandate')
 expect(await reviewRequestedCustomerChangeSourceArtifact({artifactId:artifact.artifactId,sourceHash:artifact.sourceHash,claimsHash:artifact.claimsHash,companyId:f.companyId,actorUserId:f.reviewer.id,decision:'approve',reason:'Synthetic missing actual outgoing authority',clause:f.clause})).toMatchObject({status:'held'})
 expect(await prepareAndQueueRequestedCustomerChange({...scope,artifactId:artifact.artifactId})).toMatchObject({status:'held'})
 expect(sql(`SELECT jsonb_build_object('events',(SELECT count(*) FROM gridex_customer_life_events.events WHERE company_id=${literal(f.companyId)}),'messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_code='Z09'))`)).toEqual(before)
})
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
