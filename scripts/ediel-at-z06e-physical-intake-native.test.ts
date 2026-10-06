import {createHash,randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const delivery=vi.hoisted(()=>({smtp:vi.fn()}))
// SMTP/notifications and the helper's disclosed external legal controls are
// synthetic. Parser, intake, classification, processor, effects and ACKs run.
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:delivery.smtp})}}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {createBilateralCustomerSourceFixture} from './helpers/ediel-bilateral-customer-native-fixture'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {recordOriginalMailboxNativeReception} from './helpers/originalMailboxNative'
import {archiveBilateralCustomerSource,reviewBilateralCustomerSourceArtifact} from '@/lib/ediel/production/bilateralCustomerSource'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {createReceivedProdatCommittedEffectAcks} from '@/lib/ediel/flows/receivedProdatStructuralAcks'
import {readReceivedProdatFinalResponsePlan} from '@/lib/ediel/core/receivedProdatFinalResponsePlan'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {getEdielMessageById} from '@/lib/ediel/db'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {seedOriginalMailboxNative} from './helpers/originalMailboxNative'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {assertEdielSmtpReadiness} from '@/lib/ediel/mailReadiness'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {requireEdielInboundLegalContext} from '@/lib/ediel/tenant/sourceLegalContext'
import {supabaseService} from '@/lib/supabase/service'
type Fixture=Awaited<ReturnType<typeof createBilateralCustomerSourceFixture>>
function business(f:Fixture){return sql(`SELECT jsonb_build_object('customer',(SELECT to_jsonb(c) FROM public.customers c WHERE id=${literal(f.customerId)}),'supply',(SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE id=${literal(f.period)}),'point',(SELECT to_jsonb(p) FROM public.metering_points p WHERE id=${literal(f.pointId)}),'site',(SELECT to_jsonb(s) FROM public.customer_sites s WHERE id=${literal(f.siteId)}))`)}
function durable(f:Fixture){return sql(`SELECT jsonb_build_object('versions',(SELECT count(*) FROM gridex_customer_life_events.customer_versions WHERE source_message_id=${literal(f.sourceMessageId)}),'primary',(SELECT count(*) FROM gridex_received_sources.customer_primary_response_receipts WHERE source_message_id=${literal(f.sourceMessageId)}),'transitions',(SELECT count(*) FROM gridex_customer_life_events.transitions WHERE source_message_id=${literal(f.sourceMessageId)}),'acks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'raw',raw_payload,'family',message_family,'outcome',ack_outcome) ORDER BY id),'[]') FROM public.ediel_messages WHERE related_message_id=${literal(f.sourceMessageId)} AND direction='outbound'),'outboxes',(SELECT count(*) FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)} AND ediel_message_id IN(SELECT id FROM public.ediel_messages WHERE related_message_id=${literal(f.sourceMessageId)})))`)}
afterEach(()=>{vi.unstubAllEnvs();delivery.smtp.mockReset()})
it.each(['bankruptcy','customer_change'] as const)('prospective original %s reaches actual processor and its own committed primary ACK, retry stable',async kind=>{
 for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v)
 const f=await createBilateralCustomerSourceFixture(email=>delivery.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'}),{physicalBirth:true,repeatRegister:false})
 const before=business(f),hash=createHash('sha256').update(f.wire).digest('hex')
 // The actual technical owner identifies originals globally by this tuple.
 // A fresh interchange must not collide with the fixture's earlier Z04.
 expect(sql(`WITH own AS(SELECT gridex_ediel_technical_ack.envelope(raw_payload)e FROM public.ediel_messages WHERE id=${literal(f.sourceMessageId)}) SELECT jsonb_build_object('ids',jsonb_agg(old.id ORDER BY old.id),'reference',(SELECT e->>'uciReference' FROM own)) FROM public.ediel_messages old CROSS JOIN own CROSS JOIN LATERAL(SELECT gridex_ediel_technical_ack.envelope(old.raw_payload)e)p WHERE old.direction='inbound' AND p.e IS NOT NULL AND p.e->>'environment'=own.e->>'environment' AND p.e->'sender'=own.e->'sender' AND p.e->'receiver'=own.e->'receiver' AND p.e->>'applicationReference'=own.e->>'applicationReference' AND p.e->>'uciReference'=own.e->>'uciReference'`)).toMatchObject({ids:[f.sourceMessageId],reference:expect.stringMatching(/^[A-F0-9]{14}$/)})
 const birth=sql<{mail:string;parse:string;raw:string;hash:string;receivedMs:number;sourceMs:number;mailboxSelector:string}>(`SELECT jsonb_build_object('mail',r.inbound_email_message_id,'parse',r.parse_result_id,'raw',mail.raw_edifact_payload,'hash',r.received_payload_hash,'receivedMs',extract(epoch FROM mail.received_at)*1000,'sourceMs',extract(epoch FROM m.message_received_at)*1000,'mailboxSelector',m.mailbox_message_id) FROM public.ediel_messages m JOIN gridex_ediel_inbound_receptions.receptions r ON r.source_message_id=m.id AND r.classification='first_reception' JOIN public.inbound_email_messages mail ON mail.id=r.inbound_email_message_id WHERE m.id=${literal(f.sourceMessageId)}`)
 expect(birth).toMatchObject({mail:f.message.inbound_email_message_id,mailboxSelector:f.message.inbound_email_message_id,raw:f.wire,hash})
 expect(birth.receivedMs).toBe(birth.sourceMs)
 expect(await recordOriginalMailboxNativeReception({companyId:f.companyId,sourceMessageId:f.sourceMessageId,actorUserId:f.actorUserId,inboundEmailMessageId:birth.mail,parseResultId:birth.parse,sourcePayloadHash:hash})).toMatchObject({classification:'first_reception',businessEffectAuthorized:false})
 const initial=sql<string>(`SELECT to_jsonb(id) FROM gridex_received_sources.validation_assessments WHERE source_message_id=${literal(f.sourceMessageId)} AND previous_assessment_id IS NULL`)
 const artifact=await archiveBilateralCustomerSource({...f.submission(`SYNTHETIC physical ${kind}`,f.pdf(kind),true,kind),companyId:f.companyId,actorUserId:f.uploader.id})
 expect(artifact.missing).toEqual([])
 expect(await reviewBilateralCustomerSourceArtifact({...artifact,companyId:f.companyId,actorUserId:f.reviewer.id,decision:'approve',reason:'Synthetic independently reviewed exact physical original',clause:f.clause})).toMatchObject({status:'authorized'})
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceMessageId})
 const final=await readReceivedProdatFinalResponsePlan({companyId:f.companyId,sourceMessageId:f.sourceMessageId,rawPayload:f.wire})
 expect(final).not.toBeNull()
 if(!final)throw new Error('actual_physical_customer_primary_response_required')
 expect(final.plans).toHaveLength(1)
 const plan=final.plans[0]
 expect(plan.effectKind).toBe('customer_version')
 expect(plan.canonicalAssessmentId).not.toBe(initial)
 expect(sql(`WITH RECURSIVE chain AS(SELECT id,previous_assessment_id FROM gridex_received_sources.validation_assessments WHERE id=${literal(plan.canonicalAssessmentId)} UNION ALL SELECT a.id,a.previous_assessment_id FROM gridex_received_sources.validation_assessments a JOIN chain c ON a.id=c.previous_assessment_id) SELECT to_jsonb(EXISTS(SELECT FROM chain WHERE id=${literal(initial)}))`)).toBe(true)
 expect(sql(`SELECT jsonb_build_object('canonical',p.canonical_assessment_id,'object',p.object_assessment_id,'witnesses',(SELECT count(*) FROM gridex_received_sources.object_availability_witnesses w WHERE w.assessment_id=p.object_assessment_id)) FROM gridex_received_sources.customer_primary_response_receipts p WHERE p.source_message_id=${literal(f.sourceMessageId)}`)).toEqual({canonical:plan.canonicalAssessmentId,object:plan.objectAssessmentId,witnesses:1})
 const ids=await createReceivedProdatCommittedEffectAcks({actorUserId:f.actorUserId,companyId:f.companyId,sourceMessageId:f.sourceMessageId})
 expect(ids).toHaveLength(1)
 const ack=await getEdielMessageById(ids[0]);expect(ack).toMatchObject({company_id:f.companyId,environment:'test',direction:'outbound',message_family:'APERAK',related_message_id:f.sourceMessageId,ack_outcome:'positive',application_reference:'23-DDQ-PRODAT'})
 const parsed=tokenizeEdifact(ack!.raw_payload!),values=(tag:string)=>parsed.segments.filter(s=>s.tag===tag).map(s=>segmentComposite(s,1,parsed.una))
 expect(values('ERC')).toContainEqual(['100','','260'])
 expect(values('RFF')).toContainEqual(['LI',plan.acknowledgedReferences[0]])
 expect(sql(`SELECT payload->'canonicalAssessmentId' FROM public.ediel_outbox WHERE ediel_message_id=${literal(ids[0])}`)).toBe(plan.canonicalAssessmentId)
 expect(sql(`SELECT payload->'objectAssessmentId' FROM public.ediel_outbox WHERE ediel_message_id=${literal(ids[0])}`)).toBe(plan.objectAssessmentId)
 expect(sql(`SELECT jsonb_build_object('future',effective_at>clock_timestamp(),'name',resulting_customer->>'name','classification',resulting_customer#>>'{metadata,edielCustomerLifeEvent,classification}') FROM gridex_customer_life_events.customer_versions WHERE source_message_id=${literal(f.sourceMessageId)}`)).toEqual({future:true,name:'SYNTHETIC DATED CUSTOMER',classification:kind==='bankruptcy'?'bankruptcy':'other_masterdata'})
 expect(business(f)).toEqual(before)
 const stable=durable(f)
 expect(stable).toMatchObject({versions:1,primary:1,transitions:1,outboxes:2,acks:expect.arrayContaining([expect.objectContaining({family:'CONTRL',outcome:'positive'}),expect.objectContaining({family:'APERAK',outcome:'positive'})])})
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceMessageId})
 expect(await createReceivedProdatCommittedEffectAcks({actorUserId:f.actorUserId,companyId:f.companyId,sourceMessageId:f.sourceMessageId})).toEqual(ids)
 expect(durable(f)).toEqual(stable);expect(business(f)).toEqual(before)
},120000)

it('prospectively expired supplier role permits only correlated technical CONTRL and holds fresh physical original before business effects',async()=>{
 for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v)
 // Complete accepted control first; only the actual public supplier role then
 // expires BEFORE the separate original's mail reception and first persistence.
 const f=await createBilateralCustomerSourceFixture(email=>delivery.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'}),{physicalBirth:true,repeatRegister:false})
 const sentBefore=delivery.smtp.mock.calls.length
 const legal=await requireEdielInboundLegalContext(f.companyId,f.sourceMessageId)
 expect(legal).toMatchObject({actorRole:'electricity_supplier',direction:'inbound',environment:'test'})
 const before=business(f),e=EdifactEnvelopeCodec.decode(f.wire),reference=randomUUID().replaceAll('-','').slice(0,14).toUpperCase()
 const body=e.segments.filter(s=>!['UNB','UNH','UNT','UNZ'].includes(s.tag)).map(s=>s.tag==='BGM'?'BGM+Z06+'+reference+'+9+AB':s.tag==='RFF'&&segmentComposite(s,1,e.una)[0]==='LI'?'RFF+LI:LI'+reference:s.raw)
 const wire=EdifactEnvelopeCodec.encode({sender:e.sender!,receiver:e.receiver!,senderQualifier:e.senderQualifier,receiverQualifier:e.receiverQualifier,senderSubAddress:e.senderSubAddress,receiverSubAddress:e.receiverSubAddress,applicationReference:e.applicationReference,acknowledgementRequest:true,environment:'test',interchangeReference:reference,una:e.una,messages:[{messageReference:reference,messageTypeToken:e.segments.find(s=>s.tag==='UNH')!.elements[2],businessSegments:body}]})
 expect(sql(`WITH expired AS(UPDATE public.tenant_actor_roles SET valid_to=clock_timestamp()-interval '1 second' WHERE company_id=${literal(f.companyId)} AND environment='test' AND actor_id=${literal(legal.legalActorId)} AND role_code='electricity_supplier' AND valid_from<=clock_timestamp() AND (valid_to IS NULL OR clock_timestamp()<valid_to) RETURNING id) SELECT to_jsonb(count(*)) FROM expired`)).toBe(1)
 expect(sql(`SELECT jsonb_build_object('write',public.gridex_actor_has_company_permission(${literal(f.actorUserId)},${literal(f.companyId)},'communication.write'),'send',public.gridex_actor_has_company_permission(${literal(f.actorUserId)},${literal(f.companyId)},'communication.send'))`)).toEqual({write:true,send:true})
 const mail=await seedOriginalMailboxNative(sql,literal,{companyId:f.companyId,environment:'test',raw:wire,smtpFrom:assertEdielSmtpReadiness().from})
 const id=await createInboundEdielMessage({companyId:f.companyId,actorUserId:f.actorUserId,environment:'test',inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed})
 expect(id).toBeTruthy();if(!id)throw Error('actual_expired_role_physical_birth_required')
 const message=await getEdielMessageById(id);expect(message).not.toBeNull();if(!message)throw Error('actual_expired_role_original_required')
 const custody=()=>sql(`SELECT jsonb_build_object('raw',m.raw_payload,'company',m.company_id,'direction',m.direction,'received',m.message_received_at,'mail',m.inbound_email_message_id,'legal',(SELECT to_jsonb(r) FROM gridex_ediel_inbound_context.receipts r WHERE r.source_message_id=m.id),'receptions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM gridex_ediel_inbound_receptions.receptions r WHERE r.source_message_id=m.id)) FROM public.ediel_messages m WHERE m.id=${literal(id)}`)
 const original=custody()
 expect(original).toMatchObject({raw:wire,company:f.companyId,direction:'inbound',mail:mail.inboundEmailMessageId,legal:{status:'held',reason:'ediel_inbound_legal_context_required',payload_sha256:createHash('sha256').update(wire).digest('hex')}})
 const context=await supabaseService.rpc('ediel_require_inbound_legal_context_v1',{p_company_id:f.companyId,p_message_id:id})
 expect(context.error).toMatchObject({code:'P0001',message:'ediel_inbound_legal_context_required'})
 await expect(requireEdielInboundLegalContext(f.companyId,id)).rejects.toThrow('ediel_inbound_legal_context_required')
 const none=()=>sql(`SELECT jsonb_build_object('assessments',(SELECT count(*) FROM gridex_received_sources.validation_assessments WHERE source_message_id=${literal(id)}),'ruleBasis',(SELECT count(*) FROM gridex_ediel_source_rules.receipts WHERE source_message_id=${literal(id)}),'tasks',(SELECT count(*) FROM gridex_customer_life_events.tasks WHERE source_message_id=${literal(id)}),'facets',(SELECT count(*) FROM gridex_requested_changes.confirmed_customer_versions WHERE source_message_id=${literal(id)}),'availability',(SELECT count(*) FROM gridex_requested_changes.customer_version_availability WHERE source_message_id=${literal(id)}))`)
 const source={...f,sourceMessageId:id,message,wire}
 let stable:ReturnType<typeof durable>|undefined
 for(let attempt=0;attempt<2;attempt++){
  expect(await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:id})).toMatchObject({tenant_resolution_status:'tenant_ambiguous',business_match_status:'business_blocked',processing_status:'routing_unresolved'})
  expect(none()).toEqual({assessments:0,ruleBasis:0,tasks:0,facets:0,availability:0})
  const committed=durable(source)
  expect(committed).toMatchObject({versions:0,primary:0,transitions:0,outboxes:1,acks:[{id:expect.any(String),raw:expect.any(String),family:'CONTRL',outcome:'positive'}]})
  if(attempt===0){
   stable=committed
   const ackIds=sql<string[]>(`SELECT jsonb_agg(id ORDER BY id) FROM public.ediel_messages WHERE related_message_id=${literal(id)} AND direction='outbound'`)
   expect(ackIds).toHaveLength(1)
   const ack=await getEdielMessageById(ackIds[0]);expect(ack).toMatchObject({company_id:f.companyId,environment:'test',direction:'outbound',message_family:'CONTRL',related_message_id:id,ack_outcome:'positive'})
   const envelope=EdifactEnvelopeCodec.decode(ack!.raw_payload!),parsed=tokenizeEdifact(ack!.raw_payload!)
   expect(envelope.sender).toBe(e.receiver);expect(envelope.receiver).toBe(e.sender)
   expect(envelope.applicationReference).toBe(e.applicationReference);expect(envelope.environment).toBe('test')
   expect(parsed.segments.filter(s=>s.tag==='UCI').map(s=>segmentComposite(s,1,parsed.una))).toEqual([[reference]])
   expect(parsed.segments.find(s=>s.tag==='UCI')!.elements[4]).toBe('7')
   expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(ackIds[0])}`)).toBe(1)
  }else expect(committed).toEqual(stable)
  expect(custody()).toEqual(original);expect(business(f)).toEqual(before)
 }
 expect(delivery.smtp).toHaveBeenCalledTimes(sentBefore)
},120000)

it.each(['216','251'] as const)('fresh physical original missing own field %s has its actual diagnostic and no customer effect or positive APERAK',async field=>{
 for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v)
 // The strict helper independently exercises a fresh complete original first.
 // The malformed original uses actual mail/intake directly, without weakening
 // that helper's all-accepted requirement or changing any original afterward.
 const f=await createBilateralCustomerSourceFixture(email=>delivery.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'}),{physicalBirth:true,repeatRegister:false})
 const before=business(f),e=EdifactEnvelopeCodec.decode(f.wire),reference=randomUUID().replaceAll('-','').slice(0,14).toUpperCase(),ownLi='LI'+reference
 expect(e.segments.filter(s=>s.tag==='DTM'&&segmentComposite(s,1,e.una)[0]==='157')).toHaveLength(1)
 expect(e.segments.find(s=>s.tag==='NAD'&&segmentComposite(s,1,e.una)[0]==='IV')!.elements[4]).toBe('SYNTHETIC INVOICEE')
 const body=e.segments.filter(s=>!['UNB','UNH','UNT','UNZ'].includes(s.tag)&&!(field==='216'&&s.tag==='DTM'&&segmentComposite(s,1,e.una)[0]==='157')).map(s=>{
  if(s.tag==='BGM')return 'BGM+Z06+'+reference+'+9+AB'
  if(s.tag==='RFF'&&segmentComposite(s,1,e.una)[0]==='LI')return 'RFF+LI:'+ownLi
  if(field==='251'&&s.tag==='NAD'&&segmentComposite(s,1,e.una)[0]==='IV')return s.raw.replace('+SYNTHETIC INVOICEE+','++')
  return s.raw
 })
 const wire=EdifactEnvelopeCodec.encode({sender:e.sender!,receiver:e.receiver!,senderQualifier:e.senderQualifier,receiverQualifier:e.receiverQualifier,senderSubAddress:e.senderSubAddress,receiverSubAddress:e.receiverSubAddress,applicationReference:e.applicationReference,acknowledgementRequest:true,environment:'test',interchangeReference:reference,una:e.una,messages:[{messageReference:reference,messageTypeToken:e.segments.find(s=>s.tag==='UNH')!.elements[2],businessSegments:body}]})
 const mail=await seedOriginalMailboxNative(sql,literal,{companyId:f.companyId,environment:'test',raw:wire,smtpFrom:assertEdielSmtpReadiness().from})
 const id=await createInboundEdielMessage({companyId:f.companyId,actorUserId:f.actorUserId,environment:'test',inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed})
 expect(id).toBeTruthy();if(!id)throw Error('actual_missing_field_physical_birth_required')
 const message=await getEdielMessageById(id);expect(message).not.toBeNull();if(!message)throw Error('actual_missing_field_original_required')
 expect(message).toMatchObject({raw_payload:wire,direction:'inbound',message_code:'Z06'})
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
 expect(decision.syntaxDecision,JSON.stringify(decision.issues)).toBe('accepted')
 expect(decision.applicationDecision,JSON.stringify(decision.issues)).toBe('rejected')
 expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({prodatDiagnostic:expect.objectContaining({kind:'field',fieldNumber:field,errorKind:'missing',occurrence:expect.objectContaining({objectId:f.external,identityAgency:'9',lineItemReference:ownLi})})})]))
 const source={...f,sourceMessageId:id,message,wire}
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:id})
 expect(sql(`SELECT to_jsonb(facts_text::jsonb->>'applicationDecision') FROM gridex_received_sources.validation_assessments a WHERE source_message_id=${literal(id)} AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id)`)).toBe('rejected')
 const noBusiness=()=>sql(`SELECT jsonb_build_object('tasks',(SELECT count(*) FROM gridex_customer_life_events.tasks WHERE source_message_id=${literal(id)}),'facets',(SELECT count(*) FROM gridex_requested_changes.confirmed_customer_versions WHERE source_message_id=${literal(id)}),'availability',(SELECT count(*) FROM gridex_requested_changes.customer_version_availability WHERE source_message_id=${literal(id)}))`)
 expect(noBusiness()).toEqual({tasks:0,facets:0,availability:0})
 expect(durable(source)).toMatchObject({versions:0,primary:0,transitions:0})
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE related_message_id=${literal(id)} AND direction='outbound' AND message_family='APERAK' AND ack_outcome='positive'`)).toBe(0)
 expect(await readReceivedProdatFinalResponsePlan({companyId:f.companyId,sourceMessageId:id,rawPayload:wire})).toBeNull()
 expect(business(f)).toEqual(before)
 const stable=durable(source)
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:id})
 expect(durable(source)).toEqual(stable);expect(noBusiness()).toEqual({tasks:0,facets:0,availability:0});expect(business(f)).toEqual(before)
},120000)
