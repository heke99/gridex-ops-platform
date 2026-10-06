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
import {createBilateralCustomerSourceFixture} from './helpers/ediel-bilateral-customer-native-fixture'
import {bilateralCustomerNativeWire} from './helpers/ediel-bilateral-customer-native-wire'
import {supabaseService} from '@/lib/supabase/service'
import {archiveBilateralCustomerSource,reviewBilateralCustomerSourceArtifact} from '@/lib/ediel/production/bilateralCustomerSource'
import {applyConfirmedCustomerSource} from '@/lib/ediel/production/confirmedCustomerSource'
import {readConfirmedCustomerHistory,isConfirmedCustomerHistoryQualified} from '@/lib/ediel/production/confirmedCustomerHistory'
import {inspectStructuralReadset} from '@/lib/ediel/sources/structuralSourceReadset'
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
 expect(original.outbound_request_id).toBeTruthy()
 expect(sql(`SELECT to_jsonb(status) FROM public.outbound_requests WHERE id=${literal(original.outbound_request_id)}`)).toBe('acknowledged')
 const stable=counts(f,original.id)
 const accepted=(await getEdielMessageById(original.id))!
 for(const message of acks){expect(await processInboundAckMessage({actorUserId:f.actorUserId,message})).toMatchObject({sourceMessage:{id:original.id},outcome:'positive'});expect(counts(f,original.id)).toEqual(stable)}
 expect((await getEdielMessageById(original.id))!).toMatchObject({status:accepted.status,contrl_status:accepted.contrl_status,aperak_status:accepted.aperak_status,raw_payload:accepted.raw_payload})
 expect(sql(`SELECT to_jsonb(status) FROM public.outbound_requests WHERE id=${literal(original.outbound_request_id)}`)).toBe('acknowledged')
 expect((await getEdielMessageById(original.id))!.raw_payload).toBe(f.rawPayload);expect(business(f)).toEqual(before)
},120000)
it('fresh received unknown UCI and wrong LI cannot correlate or accept the sent customer original',async()=>{
 const{f,before,original}=await sent(),stable=counts(f,original.id)
 for(const[family,defect]of [['CONTRL','unknown'],['APERAK','wrongLI']] as const){
  const{message,decision}=await intake(f,original,externalAck(original,family,defect))
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','manual_review','manual_review'])
  expect(decision.issues.map(issue=>issue.code)).toContain('CANONICAL_ACK_SOURCE_EVIDENCE_UNAVAILABLE')
  expect(await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:f.companyId,decision})).toMatchObject({status:'recorded'})
  expect(await processInboundAckMessage({actorUserId:f.actorUserId,message})).toMatchObject({sourceMessage:null,sourceAccepted:false,finalAckReached:false})
  expect(await readCommittedInboundAck({actorUserId:f.actorUserId,message})).toBeNull()
  expect(counts(f,original.id)).toEqual(stable)
  expect((await getEdielMessageById(original.id))!).toMatchObject({contrl_status:original.contrl_status,aperak_status:original.aperak_status,raw_payload:original.raw_payload})
  expect(business(f)).toEqual(before)
 }
},120000)

it('after actual Z09 send and same-original ACKs, an independent later Z06 commits its own confirmed history without changing the request or live customer',async()=>{
 const{f,before,original}=await sent()
 for(const family of ['CONTRL','APERAK'] as const){
  const{message,decision}=await intake(f,original,externalAck(original,family))
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
  expect(await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:f.companyId,decision})).toMatchObject({status:'recorded'})
  expect(await processInboundAckMessage({actorUserId:f.actorUserId,message})).toMatchObject({outcome:'positive',sourceMessage:{id:original.id},sourceAccepted:family==='APERAK',finalAckReached:family==='APERAK'})
 }
 const requestState=()=>sql(`SELECT jsonb_build_object('original',(SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(original.id)}),'desired',(SELECT jsonb_agg(to_jsonb(d) ORDER BY event_id) FROM gridex_customer_life_events.desired_changes d WHERE company_id=${literal(f.companyId)}),'correlations',(SELECT jsonb_agg(to_jsonb(c) ORDER BY ack_message_id) FROM gridex_ack_authority.source_correlations c WHERE source_message_id=${literal(original.id)}),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY ack_message_id) FROM gridex_ack_authority.applied_receipts r JOIN gridex_ack_authority.source_correlations c USING(ack_message_id) WHERE c.source_message_id=${literal(original.id)}))`)
 const accepted=requestState(),e=EdifactEnvelopeCodec.decode(original.raw_payload!),li=e.segments.find(s=>s.tag==='RFF'&&segmentComposite(s,1,e.una)[0]==='LI')!,effective=e.segments.find(s=>s.tag==='DTM'&&segmentComposite(s,1,e.una)[0]==='157')!
 const marketMinute=segmentComposite(effective,1,e.una)[1]
 // The declared external DSO supplies a complete Z06 (including its own
 // required reporting/installation fields), with exact requested UD/IV/date/LI.
 // This is the existing finite native-original seam, not physical intake or
 // an invented authoritative Z09-to-Z06 correlation receipt.
 const base=EdifactEnvelopeCodec.decode(bilateralCustomerNativeWire({sender:f.receiver,receiver:f.sender,point:f.external,customerIdentity:f.customerIdentity.id,reference:segmentComposite(li,1,e.una)[1],marketMinute,repeatRegister:false,invoicee:true}))
 const clock=sql<string>(`SELECT to_jsonb(to_char(clock_timestamp() AT TIME ZONE 'Etc/GMT-1','YYYYMMDDHH24MI'))`)
 const body=base.segments.filter(s=>!['UNB','UNH','UNT','UNZ'].includes(s.tag)).map(s=>{
  if(s.tag==='BGM')return 'BGM+Z06+'+randomUUID().replaceAll('-','').slice(0,14)+'+9+AB'
  if(s.tag==='DTM'&&segmentComposite(s,1,base.una)[0]==='137')return 'DTM+137:'+clock+':203'
  if(s.tag==='NAD'&&['UD','IV','Z02'].includes(segmentComposite(s,1,base.una)[0]))return e.segments.find(originalSegment=>originalSegment.tag==='NAD'&&segmentComposite(originalSegment,1,e.una)[0]===segmentComposite(s,1,base.una)[0])!.raw
  return s.raw
 })
 const raw=EdifactEnvelopeCodec.encode({sender:e.receiver!,receiver:e.sender!,senderQualifier:e.receiverQualifier,receiverQualifier:e.senderQualifier,senderSubAddress:e.receiverSubAddress,receiverSubAddress:e.senderSubAddress,applicationReference:e.applicationReference,acknowledgementRequest:true,environment:'test',interchangeReference:randomUUID().replaceAll('-','').slice(0,14),timeZone:'Etc/GMT-1',messages:[{messageReference:randomUUID().replaceAll('-','').slice(0,14),messageTypeToken:base.segments.find(s=>s.tag==='UNH')!.elements[2],businessSegments:body}]})
 const incomingWire=EdifactEnvelopeCodec.decode(raw)
 expect(raw).not.toBe(original.raw_payload);expect(incomingWire.interchangeReference).not.toBe(e.interchangeReference)
 expect(incomingWire.segments.find(s=>s.tag==='NAD'&&segmentComposite(s,1,incomingWire.una)[0]==='UD')!.raw).toBe(e.segments.find(s=>s.tag==='NAD'&&segmentComposite(s,1,e.una)[0]==='UD')!.raw)
 expect(incomingWire.segments.find(s=>s.tag==='RFF'&&segmentComposite(s,1,incomingWire.una)[0]==='LI')!.raw).toBe(li.raw)
 expect(incomingWire.segments.find(s=>s.tag==='DTM'&&segmentComposite(s,1,incomingWire.una)[0]==='157')!.raw).toBe(effective.raw)
 const received=await createBilateralCustomerSourceFixture(email=>delivery.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'}),{existingSupply:f,sourceWire:raw})
 expect(received.sourceMessageId).not.toBe(original.id)
 expect(received.message).toMatchObject({direction:'inbound',message_code:'Z06',related_message_id:null,raw_payload:raw})
 expect(Date.parse(received.message.message_received_at!)).toBeGreaterThan(Date.parse(original.message_sent_at!))
 const artifact=await archiveBilateralCustomerSource({...received.submission('SYNTHETIC independent later received source',received.pdf('later source')),companyId:f.companyId,actorUserId:received.uploader.id})
 expect(artifact.missing).toEqual([])
 expect(await reviewBilateralCustomerSourceArtifact({...artifact,companyId:f.companyId,actorUserId:received.reviewer.id,decision:'approve',reason:'Synthetic separate independently received original',clause:received.clause})).toMatchObject({status:'authorized',sourceMessageId:received.sourceMessageId})
 const result=await applyConfirmedCustomerSource({companyId:f.companyId,sourceMessageId:received.sourceMessageId,actorUserId:received.reviewer.id})
 expect(result).toMatchObject({applied:true,sourceMessageId:received.sourceMessageId,eventId:null,authority:{kind:'bilateral',artifactId:artifact.artifactId},payloadHash:hash(raw)})
 const versionState=()=>sql(`SELECT jsonb_build_object('versions',(SELECT count(*) FROM gridex_requested_changes.confirmed_customer_versions WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(received.sourceMessageId)}),'witnesses',(SELECT count(*) FROM gridex_requested_changes.customer_version_availability WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(received.sourceMessageId)}),'primaryVersions',(SELECT count(*) FROM gridex_customer_life_events.customer_versions WHERE company_id=${literal(f.companyId)}),'primaryReceipts',(SELECT count(*) FROM gridex_received_sources.customer_primary_response_receipts WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(received.sourceMessageId)}))`)
 expect(versionState()).toEqual({versions:1,witnesses:1,primaryVersions:0,primaryReceipts:0})
 const cutoffAt=sql<string>('SELECT to_jsonb(clock_timestamp())'),scope={companyId:f.companyId,environment:'test' as const,customerId:f.customerId,siteId:f.siteId,meteringPointId:f.pointId,legalSupplier:f.sender,legalNetwork:f.receiver,fromDate:f.requestedStartDate,toDate:f.requestedStartDate,cutoffAt}
 const snapshot=await supabaseService.rpc('gridex_source_object_snapshot_v1',{p_company_id:f.companyId,p_environment:'test',p_cutoff:cutoffAt});expect(snapshot.error).toBeNull()
 const readset=inspectStructuralReadset(scope,snapshot.data);expect(readset.timeline).toMatchObject({status:'inspected',boundedReadComplete:true})
 const history=await readConfirmedCustomerHistory({scope,readset,actorUserId:received.reviewer.id})
 expect(isConfirmedCustomerHistoryQualified(history,scope,readset)).toBe(true);expect(history.versions).toHaveLength(1)
 expect(history.versions[0]).toMatchObject({sourceMessageId:received.sourceMessageId,payloadHash:hash(raw),supplyPeriodId:f.period,objectId:f.external,legalSender:f.receiver,legalReceiver:f.sender,marketMinute,authorityKind:'bilateral',party:{id:f.customerIdentity.id}})
 expect(requestState()).toEqual(accepted);expect(business(f)).toEqual(before)
 expect(await applyConfirmedCustomerSource({companyId:f.companyId,sourceMessageId:received.sourceMessageId,actorUserId:received.reviewer.id})).toMatchObject({applied:true,sourceMessageId:received.sourceMessageId,eventId:null})
 expect(versionState()).toEqual({versions:1,witnesses:1,primaryVersions:0,primaryReceipts:0});expect(requestState()).toEqual(accepted);expect(business(f)).toEqual(before)
},120000)
