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
type Fixture=Awaited<ReturnType<typeof createBilateralCustomerSourceFixture>>
function business(f:Fixture){return sql(`SELECT jsonb_build_object('customer',(SELECT to_jsonb(c) FROM public.customers c WHERE id=${literal(f.customerId)}),'supply',(SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE id=${literal(f.period)}),'point',(SELECT to_jsonb(p) FROM public.metering_points p WHERE id=${literal(f.pointId)}),'site',(SELECT to_jsonb(s) FROM public.customer_sites s WHERE id=${literal(f.siteId)}))`)}
function durable(f:Fixture){return sql(`SELECT jsonb_build_object('versions',(SELECT count(*) FROM gridex_customer_life_events.customer_versions WHERE source_message_id=${literal(f.sourceMessageId)}),'primary',(SELECT count(*) FROM gridex_received_sources.customer_primary_response_receipts WHERE source_message_id=${literal(f.sourceMessageId)}),'transitions',(SELECT count(*) FROM gridex_customer_life_events.transitions WHERE source_message_id=${literal(f.sourceMessageId)}),'acks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'raw',raw_payload,'family',message_family,'outcome',ack_outcome) ORDER BY id),'[]') FROM public.ediel_messages WHERE related_message_id=${literal(f.sourceMessageId)} AND direction='outbound'),'outboxes',(SELECT count(*) FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)} AND ediel_message_id IN(SELECT id FROM public.ediel_messages WHERE related_message_id=${literal(f.sourceMessageId)})))`)}
afterEach(()=>{vi.unstubAllEnvs();delivery.smtp.mockReset()})
it.each(['bankruptcy','customer_change'] as const)('prospective original %s reaches actual processor and its own committed primary ACK, retry stable',async kind=>{
 for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v)
 const f=await createBilateralCustomerSourceFixture(email=>delivery.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'}),{physicalBirth:true})
 const before=business(f),hash=createHash('sha256').update(f.wire).digest('hex')
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
