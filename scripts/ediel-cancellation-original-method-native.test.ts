// Source-only C217 verification: constructed agreement/tenant inputs and one
// external SMTP double. Source, bind, transport, intake and ACK owners are real.
// No whole cancellation or external market-acceptance approval.
import {createHash,randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const smtp=vi.hoisted(()=>vi.fn())
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:smtp})}}))
import {nativeSql as sql,literal,seedNormalSwitchNativeFixture,futureNativeSupplyDate,type NormalSwitchStageNativeFixture} from './helpers/ediel-normal-switch-native-fixture'
import {seedOriginalMailboxNative} from './helpers/originalMailboxNative'
import {prepareAndQueueEdielZ03} from '@/lib/ediel/flows/prodatSwitch'
import {prepareAndQueueSwitchCancellation} from '@/lib/ediel/flows/prodatSwitchCancellation'
import {readSwitchCancellationSource} from '@/lib/ediel/production/switchCancellationSource'
import {getEdielMessageById} from '@/lib/ediel/db'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {assertEdielSmtpReadiness} from '@/lib/ediel/mailReadiness'
import {buildContrlDraft,buildAperakDraft} from '@/lib/ediel/ack'
import {processInboundAckMessage} from '@/lib/ediel/flows/inboundAckProcessing'
import {readCommittedInboundAck} from '@/lib/ediel/ack/committedInboundAck'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import type {EdielMessageRow} from '@/lib/ediel/types'
type Fixture=NormalSwitchStageNativeFixture
afterEach(()=>{smtp.mockReset();vi.unstubAllEnvs()})
function configureSmtp(email='recipient@example.invalid'){
 for(const[key,value]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(key,value)
 smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'})
}
function physicalMethods(raw:string){
 const wire=tokenizeEdifact(raw)
 return wire.segments.flatMap((segment,index)=>segment.tag==='CCI'&&segmentComposite(segment,2,wire.una)[0]==='Z04'&&wire.segments[index+1]?.tag==='CAV'?[segmentComposite(wire.segments[index+1],1,wire.una)[0]]:[])
}
function originalSnapshot(f:Fixture,sourceId:string){
 return sql("SELECT jsonb_build_object('message',to_jsonb(m),'payloads',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.ediel_message_payloads p WHERE ediel_message_id=m.id),'original',(SELECT to_jsonb(o) FROM gridex_received_sources.switch_originals o WHERE message_id=m.id),'binding',(SELECT to_jsonb(b) FROM gridex_received_sources.switch_contract_request_bindings b WHERE message_id=m.id),'supply',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.customer_supply_periods p WHERE company_id=m.company_id)) FROM public.ediel_messages m WHERE id="+literal(sourceId)+" AND company_id="+literal(f.companyId))
}
const origin=(id:string)=>sql("SELECT to_jsonb(o) FROM gridex_switch_cancellations.origins o WHERE message_id="+literal(id))
const archives=(id:string)=>sql("SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.ediel_message_payloads p WHERE ediel_message_id="+literal(id))
async function receiveAck(f:Fixture,sent:EdielMessageRow,family:'CONTRL'|'APERAK'){
 const params={actorUserId:f.actorUserId,sourceMessage:{...sent,direction:'inbound' as const},outcome:'positive' as const}
 const raw=(family==='CONTRL'?buildContrlDraft(params):buildAperakDraft(params)).rawPayload!
 const mail=await seedOriginalMailboxNative(sql,literal,{companyId:f.companyId,environment:'test',raw,smtpFrom:assertEdielSmtpReadiness().from})
 const id=await createInboundEdielMessage({companyId:f.companyId,actorUserId:f.actorUserId,environment:'test',inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed})
 expect(typeof id).toBe('string')
 const message=(await getEdielMessageById(id!))!
 expect(message.raw_payload).toBe(raw)
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
 expect(await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:f.companyId,decision})).toMatchObject({status:'recorded'})
 expect(await processInboundAckMessage({actorUserId:f.actorUserId,message})).toMatchObject({outcome:'positive',sourceMessage:{id:sent.id}})
 expect(await readCommittedInboundAck({actorUserId:f.actorUserId,message:(await getEdielMessageById(message.id))!})).toMatchObject({kind:'exact_receipt',sourceMessageId:sent.id})
 expect(await processInboundAckMessage({actorUserId:f.actorUserId,message:(await getEdielMessageById(message.id))!})).toMatchObject({outcome:'positive',sourceMessage:{id:sent.id}})
}
it.each(['L','LK'] as const)('preserves the qualified %s original217 through public C origination, SMTP, physical ACKs and replay',async subtype=>{
 configureSmtp()
 const day=subtype==='LK'?sql<string>("SELECT to_jsonb((clock_timestamp()+interval '1 hour')::date)"):futureNativeSupplyDate()
 const f=await seedNormalSwitchNativeFixture({deferOriginal:true,requestedStartDate:day,provider:configureSmtp})
 if(subtype==='LK')sql("UPDATE public.supplier_switch_requests SET prodat_variant='LK',prodat_reason='Z23',request_type='move_in' WHERE id="+literal(f.switchId)+" AND company_id="+literal(f.companyId))
 const queuedOriginal=await prepareAndQueueEdielZ03({actorUserId:f.actorUserId,switchRequestId:f.switchId,communicationRouteId:f.routeId,environment:'test'})
 await sendEdielMessageViaSmtp(queuedOriginal,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})
 const original=(await getEdielMessageById(queuedOriginal.id))!
 const before=originalSnapshot(f,original.id),callsBefore=smtp.mock.calls.length
 const request={companyId:f.companyId,switchRequestId:f.switchId,actorUserId:f.actorUserId,preferredRouteId:f.routeId,environment:'test' as const}
 const source=await readSwitchCancellationSource(request)
 expect(source).toMatchObject({status:'authorized',originalSubtype:subtype,originalMessageId:original.id,originalHash:createHash('sha256').update(original.raw_payload!).digest('hex')})
 if(source.status!=='authorized')throw Error('qualified_original217_source_not_authorized')
 expect(physicalMethods(original.raw_payload!)).toEqual([source.requestedMethod])
 const result=await prepareAndQueueSwitchCancellation(request)
 expect(result.status).toBe('queued')
 if(result.status==='held')throw Error('qualified_original217_cancellation_held')
 const cancellation=(await getEdielMessageById(result.message.id))!
 expect(cancellation).toMatchObject({original_message_id:original.id,switch_request_id:f.switchId,customer_id:f.customerId,metering_point_id:f.pointId})
 expect(physicalMethods(cancellation.raw_payload!)).toEqual([source.requestedMethod])
 expect(sql("SELECT to_jsonb(basis ? 'requestedMethod') FROM gridex_switch_cancellations.origins WHERE message_id="+literal(cancellation.id))).toBe(false)
 const bound=origin(cancellation.id)
 await sendEdielMessageViaSmtp(cancellation,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})
 const sent=(await getEdielMessageById(cancellation.id))!
 expect(sent.status).toBe('sent');expect(smtp.mock.calls).toHaveLength(callsBefore+1)
 for(const family of ['CONTRL','APERAK'] as const)await receiveAck(f,sent,family)
 expect(sql("SELECT to_jsonb(status) FROM public.supplier_switch_requests WHERE id="+literal(f.switchId))).toBe('cancellation_requested')
 const afterAcks=smtp.mock.calls.length,archived=archives(cancellation.id)
 await sendEdielMessageViaSmtp((await getEdielMessageById(cancellation.id))!,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})
 expect(smtp.mock.calls).toHaveLength(afterAcks)
 const existing=await prepareAndQueueSwitchCancellation(request)
 expect(existing).toMatchObject({status:'existing',message:{id:cancellation.id}})
 expect(sql("SELECT to_jsonb(count(*)) FROM gridex_switch_cancellations.origins WHERE company_id="+literal(f.companyId))).toBe(1)
 expect(origin(cancellation.id)).toEqual(bound);expect(archives(cancellation.id)).toEqual(archived)
 expect(originalSnapshot(f,original.id)).toEqual(before)
},180000)
