import {createHash,randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const delivery=vi.hoisted(()=>({smtp:vi.fn()}))
// External SMTP and counterparty response bytes/issuer controls are synthetic;
// send receipts, prospective intake, canonical validation and ACK owners run.
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:delivery.smtp})}}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {createRequestedCustomerChangeNativeFixture} from './helpers/ediel-requested-customer-change-native-fixture'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {seedOriginalMailboxNative} from './helpers/originalMailboxNative'
import {archiveRequestedCustomerChangeSource,reviewRequestedCustomerChangeSourceArtifact} from '@/lib/ediel/production/requestedCustomerChangeSource'
import {prepareAndQueueRequestedCustomerChange} from '@/lib/ediel/flows/prodatRequestedCustomerChange'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {getEdielMessageById} from '@/lib/ediel/db'
import {matchOutboundRequestForInbound} from '@/lib/inbound-mail/inboundMatcher'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {processInboundAckMessage} from '@/lib/ediel/flows/inboundAckProcessing'
import {readCommittedInboundAck} from '@/lib/ediel/ack/committedInboundAck'
import {renderContrl2Ediel2} from '@/lib/ediel/contrlEngine'
import {renderAperakEdiel} from '@/lib/ediel/aperakEngine'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import type {EdielMessageRow} from '@/lib/ediel/types'
type Fixture=Awaited<ReturnType<typeof createRequestedCustomerChangeNativeFixture>>
const hash=(raw:string)=>createHash('sha256').update(raw).digest('hex')
afterEach(()=>{vi.unstubAllEnvs();delivery.smtp.mockReset()})
function business(f:Fixture){return sql(`SELECT jsonb_build_object('customer',(SELECT to_jsonb(c) FROM public.customers c WHERE id=${literal(f.customerId)}),'supply',(SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE id=${literal(f.period)}),'point',(SELECT to_jsonb(p) FROM public.metering_points p WHERE id=${literal(f.pointId)}),'site',(SELECT to_jsonb(s) FROM public.customer_sites s WHERE id=${literal(f.siteId)}),'switches',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.supplier_switch_requests s WHERE company_id=${literal(f.companyId)}))`)}
function counts(f:Fixture,source:string){return sql(`SELECT jsonb_build_object('desired',(SELECT count(*) FROM gridex_customer_life_events.desired_changes WHERE company_id=${literal(f.companyId)}),'customerVersions',(SELECT count(*) FROM gridex_customer_life_events.customer_versions WHERE company_id=${literal(f.companyId)}),'confirmedVersions',(SELECT count(*) FROM gridex_requested_changes.confirmed_customer_versions WHERE company_id=${literal(f.companyId)}),'correlations',(SELECT count(*) FROM gridex_ack_authority.source_correlations WHERE source_message_id=${literal(source)}),'receipts',(SELECT count(*) FROM gridex_ack_authority.applied_receipts r JOIN gridex_ack_authority.source_correlations c USING(ack_message_id) WHERE c.source_message_id=${literal(source)}),'outboundZ06',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND direction='outbound' AND message_code='Z06'))`)}
async function sent(){
 for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v)
 const f=await createRequestedCustomerChangeNativeFixture(email=>delivery.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'})),before=business(f)
 const artifact=await archiveRequestedCustomerChangeSource({...f.submission('SYNTHETIC received ACK original',f.pdf('actual send')) ,companyId:f.companyId,actorUserId:f.uploader.id})
 expect(await reviewRequestedCustomerChangeSourceArtifact({artifactId:artifact.artifactId,sourceHash:artifact.sourceHash,claimsHash:artifact.claimsHash,companyId:f.companyId,actorUserId:f.reviewer.id,decision:'approve',reason:'Synthetic independent original review',clause:f.clause})).toMatchObject({status:'authorized'})
 const queued=await prepareAndQueueRequestedCustomerChange({companyId:f.companyId,actorUserId:f.uploader.id,artifactId:artifact.artifactId});expect(queued.status).toBe('queued')
 if(queued.status==='held')throw new Error('actual_requested_customer_original_required')
 expect(queued.message).toMatchObject({direction:'outbound',message_code:'Z09',application_reference:'23-DDQ-PRODAT',raw_payload:f.rawPayload})
 const wire=tokenizeEdifact(f.rawPayload)
 expect(wire.segments.some(s=>s.tag==='NAD'&&segmentComposite(s,1,wire.una)[0]==='UD')).toBe(true)
 expect(wire.segments.some(s=>s.tag==='CAV'&&segmentComposite(s,1,wire.una)[0]==='E34')).toBe(true)
 const provider=await sendEdielMessageViaSmtp(queued.message,{actorUserId:f.actorUserId});expect(provider.accepted.length).toBeGreaterThan(0)
 const original=(await getEdielMessageById(queued.message.id))!;expect(original.message_sent_at).toBeTruthy();expect(original.raw_payload).toBe(f.rawPayload)
 expect(Date.parse(original.message_sent_at!)).toBeLessThanOrEqual(Date.now())
 expect(business(f)).toEqual(before)
 return{f,before,original}
}
function externalAck(original:EdielMessageRow,family:'CONTRL'|'APERAK',defect?:'unknown'|'wrongLI'){
 const e=EdifactEnvelopeCodec.decode(original.raw_payload!)
 let segments=family==='CONTRL'?renderContrl2Ediel2({source:{rawPayload:original.raw_payload},outcome:'positive'}).segments:renderAperakEdiel({source:{id:original.id,messageFamily:'PRODAT',messageCode:'Z09',rawPayload:original.raw_payload},refs:{},externalReference:randomUUID(),transactionReference:randomUUID(),outcome:'positive'}).segments
 if(defect==='unknown')segments=segments.map(s=>s.startsWith('UCI+')?s.replace(/^(UCI\+)[^+]*/,'$1UNKNOWN'):s.startsWith('RFF+ACW:')?'RFF+ACW:UNKNOWN':s)
 if(defect==='wrongLI')segments=segments.map(s=>s.startsWith('RFF+LI:')?'RFF+LI:UNKNOWN':s)
 return EdifactEnvelopeCodec.encode({sender:e.receiver!,receiver:e.sender!,senderQualifier:e.receiverQualifier,receiverQualifier:e.senderQualifier,senderSubAddress:e.receiverSubAddress,receiverSubAddress:e.senderSubAddress,applicationReference:e.applicationReference,acknowledgementRequest:false,environment:'test',interchangeReference:randomUUID().replaceAll('-','').slice(0,14),messages:[{messageReference:randomUUID().replaceAll('-','').slice(0,14),messageTypeToken:family==='CONTRL'?'CONTRL:2:2:UN:EDIEL2':'APERAK:D:96A:UN:E2SE6A',businessSegments:segments}]})
}
async function intake(f:Fixture,original:EdielMessageRow,raw:string){
 const mail=await seedOriginalMailboxNative(sql,literal,{companyId:f.companyId,environment:'test',raw,smtpFrom:'synthetic@example.invalid'})
 const outboundMatch=await matchOutboundRequestForInbound({companyId:f.companyId,parsed:mail.parsed,inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId})
 const id=await createInboundEdielMessage({companyId:f.companyId,actorUserId:f.actorUserId,environment:'test',inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed,outboundMatch})
 expect(id).toBeTruthy();if(!id)throw new Error('actual_customer_ack_intake_required')
 const message=(await getEdielMessageById(id))!
 expect(Date.parse(message.message_received_at!)).toBeGreaterThan(Date.parse(original.message_sent_at!))
 expect(message).toMatchObject({direction:'inbound',inbound_email_message_id:mail.inboundEmailMessageId,mailbox_message_id:mail.inboundEmailMessageId,raw_payload:raw})
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
 return{message,decision}
}
it('actual sent Z09 receives same-original CONTRL then object APERAK, immutable retry and no automatic customer switch',async()=>{
 const{f,before,original}=await sent(),acks:EdielMessageRow[]=[]
 for(const family of ['CONTRL','APERAK'] as const){
  const{message,decision}=await intake(f,original,externalAck(original,family))
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
  expect(await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:f.companyId,decision})).toMatchObject({status:'recorded'})
  expect(await processInboundAckMessage({actorUserId:f.actorUserId,message})).toMatchObject({outcome:'positive',sourceMessage:{id:original.id},sourceAccepted:family==='APERAK',finalAckReached:family==='APERAK'})
  expect(await readCommittedInboundAck({actorUserId:f.actorUserId,message})).toMatchObject({kind:'exact_receipt',sourceMessageId:original.id,result:{outcome:'positive',sourceAccepted:family==='APERAK'}})
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ack_authority.source_correlations WHERE ack_message_id=${literal(message.id)} AND source_message_id=${literal(original.id)} AND ack_payload_hash=${literal(hash(message.raw_payload!))}`)).toBe(1)
  const updated=(await getEdielMessageById(original.id))!
  expect(updated.contrl_status).toBe('received')
  if(family==='CONTRL')expect(updated.aperak_status).toBe(original.aperak_status)
  else expect(updated.aperak_status).toBe('received')
  expect(business(f)).toEqual(before);acks.push(message)
 }
 expect(counts(f,original.id)).toEqual({desired:1,customerVersions:0,confirmedVersions:0,correlations:2,receipts:2,outboundZ06:0})
 const stable=counts(f,original.id)
 for(const message of acks){expect(await processInboundAckMessage({actorUserId:f.actorUserId,message})).toMatchObject({sourceMessage:{id:original.id},outcome:'positive'});expect(counts(f,original.id)).toEqual(stable)}
 expect((await getEdielMessageById(original.id))!.raw_payload).toBe(f.rawPayload);expect(business(f)).toEqual(before)
},120000)
it('fresh received unknown UCI and wrong LI cannot correlate or accept the sent customer original',async()=>{
 const{f,before,original}=await sent(),stable=counts(f,original.id)
 for(const[family,defect]of [['CONTRL','unknown'],['APERAK','wrongLI']] as const){
  const{message,decision}=await intake(f,original,externalAck(original,family,defect))
  await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:f.companyId,decision})
  expect(await processInboundAckMessage({actorUserId:f.actorUserId,message})).toMatchObject({sourceMessage:null,sourceAccepted:false,finalAckReached:false})
  expect(await readCommittedInboundAck({actorUserId:f.actorUserId,message})).toBeNull()
  expect(counts(f,original.id)).toEqual(stable)
  expect((await getEdielMessageById(original.id))!).toMatchObject({contrl_status:original.contrl_status,aperak_status:original.aperak_status,raw_payload:original.raw_payload})
  expect(business(f)).toEqual(before)
 }
},120000)
