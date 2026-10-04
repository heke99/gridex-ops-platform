// masterplan: TR-05, AT-TR-05, SC-040
// Actual local owners; only counterparty reply bytes and the external SMTP
// result are fixtures. No private admitted ACK, ready operation or attempt is
// inserted. Sent production originals are singleton, so these tests do not
// claim a genuine multi-object sent-original fixture or market certification.
import {createHash, randomUUID} from 'node:crypto'
import {afterEach, expect, it, vi} from 'vitest'
const smtp = vi.hoisted(() => vi.fn())
vi.mock('nodemailer', () => ({default: {createTransport: () => ({sendMail: smtp})}}))
import {supabaseService} from '@/lib/supabase/service'
import {seedNormalSwitchNativeFixture, futureNativeSupplyDate, normalSwitchNetworkRegistry, nativeSql as sql, literal} from './helpers/ediel-normal-switch-native-fixture'
import {receiveUtiltsRetry} from './helpers/utiltsConsumptionParties'
import {parseEdifactPayload} from '@/lib/inbound-mail/edielEmailParser'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {getEdielMessageById} from '@/lib/ediel/db'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {processInboundAckMessage} from '@/lib/ediel/flows/inboundAckProcessing'
import {readCommittedInboundAck} from '@/lib/ediel/ack/committedInboundAck'
import {renderContrl2Ediel2} from '@/lib/ediel/contrlEngine'
import {buildAperakDraft} from '@/lib/ediel/ack'
import {PRODAT_APERAK_APPLICATION_TEXTS} from '@/lib/ediel/prodat/prodatAperakText'
import {originalAckPartyIdentities, originalAckLegalNadSegment} from '@/lib/ediel/core/originalAckPartyIdentities'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact, segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {prepareAndQueueProdatRecovery, prepareProdatRecoveryDraft, queuePersistedProdatRecovery} from '@/lib/ediel/recovery/prodatRecovery'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {checkAckDeadlines} from '@/lib/ediel/sla/checkAckDeadlines'
import {sendOutboxItem} from '@/lib/ediel/outbox/sendOutboxItem'
import {readVerifiedEdielTransportCopy} from '@/lib/ediel/transport/verifiedCopy'
import {revokeNetworkRegistrySource} from '@/lib/ediel/production/networkRegistrySource'
import {readEdielProcessNextActions} from '@/lib/ediel/operations/processNextAction'
import type {EdielMessageRow} from '@/lib/ediel/types'

type Fixture = Awaited<ReturnType<typeof seedNormalSwitchNativeFixture>>
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex')
afterEach(() => {smtp.mockReset(); vi.unstubAllEnvs()})
function configureSmtp() {
  for (const [key, value] of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid', EDIEL_APP_DKIM_ENABLED:'false', EMAIL_PROVIDER:'resend', EDIEL_SMTP_FROM:'synthetic@example.invalid', EDIEL_SMTP_USER:'synthetic@example.invalid', EDIEL_SMTP_PASS:'synthetic-only', EDIEL_EMAIL_PROVIDER:'strato'})) vi.stubEnv(key, value)
}
async function seed(sent = true) {
  configureSmtp()
  return seedNormalSwitchNativeFixture({requestedStartDate:futureNativeSupplyDate(), ...(sent ? {provider:(email: string) => {smtp.mockResolvedValue({accepted:[email], rejected:[], messageId:randomUUID(), response:'250 synthetic accepted'})}} : {})})
}
function encode(original: EdielMessageRow, family: 'CONTRL' | 'APERAK' | 'PRODAT', businessSegments: string[], reverse = true) {
  const envelope = EdifactEnvelopeCodec.decode(original.raw_payload!)
  const originalUnh = envelope.segments.find(s => s.tag === 'UNH')!
  const messageTypeToken = family === 'CONTRL' ? 'CONTRL:2:2:UN:EDIEL2' : family === 'APERAK' ? 'APERAK:D:96A:UN:E2SE6A' : segmentComposite(originalUnh,2,envelope.una).join(':')
  return EdifactEnvelopeCodec.encode({sender:(reverse ? envelope.receiver : envelope.sender)!, receiver:(reverse ? envelope.sender : envelope.receiver)!, senderQualifier:reverse ? envelope.receiverQualifier : envelope.senderQualifier, receiverQualifier:reverse ? envelope.senderQualifier : envelope.receiverQualifier, senderSubAddress:reverse ? envelope.receiverSubAddress : envelope.senderSubAddress, receiverSubAddress:reverse ? envelope.senderSubAddress : envelope.receiverSubAddress, applicationReference:envelope.applicationReference, acknowledgementRequest:family === 'PRODAT' && envelope.acknowledgementRequest === '1', environment:'test', interchangeReference:randomUUID().replaceAll('-','').slice(0,14), messages:[{messageReference:randomUUID().replaceAll('-','').slice(0,14), messageTypeToken,businessSegments}]})
}
function correction(f: Fixture, options: {sameBgm?: boolean; omitObject?: boolean; wrongPoint?: boolean} = {}) {
  const wire = tokenizeEdifact(f.originalZ03.raw_payload!)
  let business = wire.segments.filter(s => !['UNA','UNB','UNH','UNT','UNZ'].includes(s.tag)).map(s => s.raw)
  // Change only the generated document ID; retain the real function and
  // acknowledgement fields, including the mandatory AB/NA declaration.
  if (!options.sameBgm) business = business.map(s => s.startsWith('BGM+') ? s.replace(/^(BGM\+[^+]*\+)[^+]*/,`$1${randomUUID().replaceAll('-','').slice(0,20)}`) : s)
  if (options.omitObject) business = business.slice(0,business.findIndex(s => s.startsWith('LIN+')))
  if (options.wrongPoint) business = business.map(s => s.replaceAll(f.external,'735123456789012345'))
  return encode(f.originalZ03,'PRODAT',business,false)
}
function externalAck(f: Fixture, kind: 'contrl' | 'aperak27' | 'aperak34') {
  if (kind === 'contrl') return encode(f.originalZ03,'CONTRL',renderContrl2Ediel2({source:{rawPayload:f.originalZ03.raw_payload}, outcome:'negative'}).segments)
  if (kind === 'aperak34') {
    // Pure renderer sees the remote party's received view only in memory.
    // The persisted original remains the actual sent outbound message.
    return buildAperakDraft({sourceMessage:{...f.originalZ03,direction:'inbound'}, actorUserId:f.actorUserId, outcome:'negative', applicationErrors:[{ercCode:'40', fieldCode:'107', text:PRODAT_APERAK_APPLICATION_TEXTS['107'], referenceQualifier:'Z07', referenceNumber:f.external, lineItemReference:f.caseReference}]}).rawPayload!
  }
  const parties = originalAckPartyIdentities({rawPayload:f.originalZ03.raw_payload,expectedFamily:'PRODAT'})
  const wire = tokenizeEdifact(f.originalZ03.raw_payload!), bgm = wire.segments.find(s => s.tag === 'BGM')!
  const date = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()).replace(/\D/g,'')
  // A counterparty's whole-header rejection is an external wire input; it
  // cannot be requested from our healthy-source local APERAK renderer.
  return encode(f.originalZ03,'APERAK',['BGM+++27',`DTM+137:${date}:203`,`RFF+ACW:${segmentComposite(bgm,2,wire.una)[0]}`,originalAckLegalNadSegment('FR',parties.legalReceiver),originalAckLegalNadSegment('DO',parties.legalSender),'ERC+40::260',`FTX+AAO++102::260+${PRODAT_APERAK_APPLICATION_TEXTS['102']}`])
}
async function receiveAck(f: Fixture, raw: string) {
  const parsed = parseEdifactPayload(raw)
  const reception = receiveUtiltsRetry(sql,literal,{companyId:f.companyId,actorUserId:f.actorUserId,raw,parsed})
  const id = await createInboundEdielMessage({companyId:f.companyId,actorUserId:f.actorUserId,environment:'test',...reception,parsed})
  expect(id).toBeTruthy()
  const message = (await getEdielMessageById(id!))!
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(message)
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
  expect(await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:f.companyId,decision})).toMatchObject({status:'recorded'})
  const applied = await processInboundAckMessage({actorUserId:f.actorUserId,message})
  expect(applied).toMatchObject({outcome:'negative',sourceMessage:{id:f.originalZ03.id},sourceAccepted:false})
  const committed = await readCommittedInboundAck({actorUserId:f.actorUserId,message:(await getEdielMessageById(id!))!})
  expect(committed).toMatchObject({kind:'exact_receipt',sourceMessageId:f.originalZ03.id,result:{outcome:'negative',sourceAccepted:false}})
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ack_authority.source_correlations WHERE ack_message_id=${literal(id)} AND source_message_id=${literal(f.originalZ03.id)} AND ack_payload_hash=${literal(hash(raw))}`)).toBe(1)
  return message
}
function originals(f: Fixture) {
  return sql(`SELECT jsonb_build_object('raw',m.raw_payload,'hash',m.immutable_payload_hash,'rendered',m.immutable_rendered_at,'archives',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.ediel_message_payloads p WHERE p.ediel_message_id=m.id),'attempts',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM gridex_ediel_transport.attempts a WHERE a.message_id=m.id)) FROM public.ediel_messages m WHERE m.id=${literal(f.originalZ03.id)}`)
}
async function transportOriginal(f: Fixture, attemptId: string) {
  const bytes = await readVerifiedEdielTransportCopy({companyId:f.companyId,actorUserId:f.actorUserId,messageId:f.originalZ03.id,attemptId})
  expect(bytes.length).toBeGreaterThan(0)
  return bytes
}
function effects(f: Fixture) {
  return sql(`SELECT jsonb_build_object('operations',(SELECT count(*) FROM gridex_received_sources.prodat_recovery_operations WHERE company_id=${literal(f.companyId)}),'messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)}),'outboxes',(SELECT count(*) FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)}),'attempts',(SELECT count(*) FROM gridex_ediel_transport.attempts WHERE company_id=${literal(f.companyId)}))`)
}
for (const kind of ['contrl','aperak27','aperak34'] as const) {
  it(`received ${kind} drives actual recovery, fresh intent/BGM/LI and queue with the sent original unchanged`,async () => {
    const f = await seed(), before = originals(f), ack = await receiveAck(f,externalAck(f,kind)), operationId = randomUUID()
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_message_payloads WHERE ediel_message_id=${literal(f.originalZ03.id)} AND payload_kind='raw_mime'`)).toBeGreaterThan(0)
    const input = {companyId:f.companyId,actorUserId:f.actorUserId,originalMessageId:f.originalZ03.id,sourceAckMessageId:ack.id,operationId,correctedRawPayload:correction(f)}
    if (kind !== 'contrl') {
      const denied = await supabaseService.rpc('ediel_prepare_prodat_recovery_v1',{p_company_id:f.companyId,p_actor_user_id:f.actorUserId,p_original_message_id:f.originalZ03.id,p_operation_id:randomUUID(),p_source_ack_message_id:ack.id,p_corrected_raw_payload:correction(f,{sameBgm:true}),p_previous_attempt_id:null})
      expect(denied.error).toBeNull(); expect(denied.data).toMatchObject({status:'held',reason:'negative_aperak_new_bgm_required'})
    }
    const prepared = await prepareProdatRecoveryDraft(input)
    expect(prepared).toMatchObject({status:'prepared',kind:kind === 'contrl' ? 'contrl_correction' : 'aperak_correction',operationId})
    if (!('messageId' in prepared)) throw Error('actual_correction_not_prepared')
    const fresh = (await getEdielMessageById(prepared.messageId))!
    expect(fresh.id).not.toBe(f.originalZ03.id); expect(fresh.original_message_id).toBe(f.originalZ03.id)
    expect(fresh.source_operation_id).toBe(operationId); expect(fresh.intent_id).toBeTruthy(); expect(fresh.intent_id).not.toBe(f.originalZ03.intent_id)
    expect(fresh.outbound_request_id).not.toBe(f.originalZ03.outbound_request_id)
    expect(fresh.external_reference).not.toBe(f.originalZ03.external_reference)
    const ownWire = tokenizeEdifact(fresh.raw_payload!), li = ownWire.segments.find(s => s.tag === 'RFF' && segmentComposite(s,1,ownWire.una)[0] === 'LI')!
    expect(segmentComposite(li,1,ownWire.una)[1]).toMatch(/^[A-Z0-9]{35}$/)
    expect(segmentComposite(li,1,ownWire.una)[1]).not.toBe(f.caseReference)
    expect(await queuePersistedProdatRecovery({companyId:f.companyId,actorUserId:f.actorUserId,messageId:fresh.id})).toMatchObject({status:'queued',messageId:fresh.id,operationId})
    const queued = (await getEdielMessageById(fresh.id))!
    expect(queued.status).toBe('queued'); expect(queued.raw_payload).toBe(fresh.raw_payload)
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(fresh.id)}`)).toBe(1)
    expect(smtp).toHaveBeenCalledTimes(1); expect(originals(f)).toEqual(before)
    const stable = effects(f)
    expect(await prepareAndQueueProdatRecovery(input)).toMatchObject({status:'existing',messageId:fresh.id})
    expect(effects(f)).toEqual(stable); expect(smtp).toHaveBeenCalledTimes(1)
  },120000)
}
it('actual correction preparation denies omitted/foreign objects and a prepared correction cannot queue after current actor revocation',async () => {
  const f = await seed(), ack = await receiveAck(f,externalAck(f,'contrl')), before = originals(f), initial = effects(f)
  for (const options of [{omitObject:true},{wrongPoint:true}]) {
    await expect(prepareProdatRecoveryDraft({companyId:f.companyId,actorUserId:f.actorUserId,originalMessageId:f.originalZ03.id,sourceAckMessageId:ack.id,operationId:randomUUID(),correctedRawPayload:correction(f,options)})).rejects.toThrow()
    expect(effects(f)).toEqual(initial)
  }
  const prepared = await prepareProdatRecoveryDraft({companyId:f.companyId,actorUserId:f.actorUserId,originalMessageId:f.originalZ03.id,sourceAckMessageId:ack.id,operationId:randomUUID(),correctedRawPayload:correction(f)})
  expect(prepared.status).toBe('prepared'); if (!('messageId' in prepared)) throw Error('actual_correction_not_prepared')
  const stable = effects(f)
  sql(`UPDATE public.company_memberships SET status='revoked',is_active=false WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.actorUserId)}`)
  await expect(queuePersistedProdatRecovery({companyId:f.companyId,actorUserId:f.actorUserId,messageId:prepared.messageId})).rejects.toThrow()
  expect(effects(f)).toEqual(stable); expect(originals(f)).toEqual(before); expect(smtp).toHaveBeenCalledTimes(1)
},120000)
it('a genuinely observed SMTP rejection permits one actual worker retry and preserves the previous attempt and archived original',async () => {
  const f = await seed(false)
  smtp.mockRejectedValue(Object.assign(new Error('synthetic definite connection refusal'),{code:'ECONNREFUSED',command:'CONN',syscall:'connect'}))
  await expect(sendEdielMessageViaSmtp(f.originalZ03,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})).rejects.toThrow()
  const attempt = sql<{id:string;classification:string;observed_at:string}>(`SELECT to_jsonb(a) FROM gridex_ediel_transport.attempts a WHERE message_id=${literal(f.originalZ03.id)}`)
  expect(attempt).toMatchObject({classification:'pre_connect_negative',observed_at:expect.any(String)})
  const oldTransportBytes = await transportOriginal(f,attempt.id)
  const before = originals(f), operationId = randomUUID()
  const oldArchives = sql<Array<{id:string;body:unknown}>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'body',to_jsonb(p)) ORDER BY p.id),'[]') FROM public.ediel_message_payloads p WHERE p.ediel_message_id=${literal(f.originalZ03.id)}`)
  expect(oldArchives.length).toBeGreaterThan(0)
  const queued = await prepareAndQueueProdatRecovery({companyId:f.companyId,actorUserId:f.actorUserId,originalMessageId:f.originalZ03.id,operationId,previousAttemptId:attempt.id})
  expect(queued).toMatchObject({status:'queued',kind:'verified_transfer_loss',messageId:f.originalZ03.id,operationId})
  if (!('outboxId' in queued)) throw Error('actual_retry_not_queued')
  expect(originals(f)).toEqual(before); expect(smtp).toHaveBeenCalledTimes(1)
  smtp.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'})
  expect(await sendOutboxItem({actorUserId:f.actorUserId,outboxItemId:queued.outboxId,workerId:`native-tr05-${randomUUID()}`,smtpMimeMode:'nodemailer-attachment'})).toMatchObject({status:'sent'})
  expect(smtp).toHaveBeenCalledTimes(2)
  expect(sql(`SELECT to_jsonb(a) FROM gridex_ediel_transport.attempts a WHERE id=${literal(attempt.id)}`)).toEqual(attempt)
  expect(await transportOriginal(f,attempt.id)).toEqual(oldTransportBytes)
  expect(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'body',to_jsonb(p)) ORDER BY p.id),'[]') FROM public.ediel_message_payloads p WHERE p.id=ANY(ARRAY[${oldArchives.map(p => literal(p.id)).join(',')}]::uuid[])`)).toEqual(oldArchives)
  expect(sql(`SELECT jsonb_build_object('raw',raw_payload,'hash',immutable_payload_hash) FROM public.ediel_messages WHERE id=${literal(f.originalZ03.id)}`)).toEqual({raw:f.originalZ03.raw_payload,hash:hash(f.originalZ03.raw_payload!)})
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.prodat_recovery_attempts WHERE operation_id=${literal(operationId)}`)).toBe(1)
  const stable = effects(f)
  await sendOutboxItem({actorUserId:f.actorUserId,outboxItemId:queued.outboxId,workerId:`native-tr05-${randomUUID()}`,smtpMimeMode:'nodemailer-attachment'})
  expect(effects(f)).toEqual(stable); expect(smtp).toHaveBeenCalledTimes(2)
},120000)
it('a queued definite-loss retry rechecks actual revoked network-source authority before worker provider entry',async () => {
  const f = await seed(false)
  smtp.mockRejectedValue(Object.assign(new Error('synthetic definite connection refusal'),{code:'ECONNREFUSED',command:'CONN',syscall:'connect'}))
  await expect(sendEdielMessageViaSmtp(f.originalZ03,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})).rejects.toThrow()
  const attempt = sql<{id:string;classification:string}>(`SELECT to_jsonb(a) FROM gridex_ediel_transport.attempts a WHERE message_id=${literal(f.originalZ03.id)}`)
  expect(attempt.classification).toBe('pre_connect_negative')
  const queued = await prepareAndQueueProdatRecovery({companyId:f.companyId,actorUserId:f.actorUserId,originalMessageId:f.originalZ03.id,operationId:randomUUID(),previousAttemptId:attempt.id})
  expect(queued.status).toBe('queued'); if (!('outboxId' in queued)) throw Error('actual_retry_not_queued')
  const archive = originals(f), registry = normalSwitchNetworkRegistry(f.companyId)!
  expect(registry).toBeTruthy()
  expect(await revokeNetworkRegistrySource({...registry.artifact,companyId:f.companyId,actorUserId:registry.reviewerId,reason:'Synthetic actual current network-source withdrawal'})).toMatchObject({status:'held'})
  smtp.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'})
  const result = await sendOutboxItem({actorUserId:f.actorUserId,outboxItemId:queued.outboxId,workerId:`native-tr05-${randomUUID()}`,smtpMimeMode:'nodemailer-attachment'})
  expect(result.status).not.toBe('sent'); expect(smtp).toHaveBeenCalledTimes(1)
  expect(originals(f)).toEqual(archive)
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.prodat_recovery_attempts WHERE operation_id IN(SELECT id FROM gridex_received_sources.prodat_recovery_operations WHERE company_id=${literal(f.companyId)})`)).toBe(0)
},120000)
it('fresh correction finalization rechecks the actual current network source after a qualified negative ACK',async () => {
  const f = await seed(), ack = await receiveAck(f,externalAck(f,'contrl')), registry = normalSwitchNetworkRegistry(f.companyId)!
  expect(registry).toBeTruthy()
  const before = effects(f) as {messages:number;outboxes:number;attempts:number}, archive = originals(f)
  expect(await revokeNetworkRegistrySource({...registry.artifact,companyId:f.companyId,actorUserId:registry.reviewerId,reason:'Synthetic actual source withdrawal before fresh finalization'})).toMatchObject({status:'held'})
  await expect(prepareProdatRecoveryDraft({companyId:f.companyId,actorUserId:f.actorUserId,originalMessageId:f.originalZ03.id,sourceAckMessageId:ack.id,operationId:randomUUID(),correctedRawPayload:correction(f)})).rejects.toThrow()
  expect(effects(f)).toMatchObject({messages:before.messages,outboxes:before.outboxes,attempts:before.attempts})
  expect(originals(f)).toEqual(archive); expect(smtp).toHaveBeenCalledTimes(1)
},120000)
it('a prepared correction consumes current public mandate authority and cannot send after the actual POA is revoked',async () => {
  const f = await seed(), ack = await receiveAck(f,externalAck(f,'aperak34'))
  const prepared = await prepareProdatRecoveryDraft({companyId:f.companyId,actorUserId:f.actorUserId,originalMessageId:f.originalZ03.id,sourceAckMessageId:ack.id,operationId:randomUUID(),correctedRawPayload:correction(f)})
  expect(prepared.status).toBe('prepared'); if (!('messageId' in prepared)) throw Error('actual_correction_not_prepared')
  const before = effects(f), archive = originals(f)
  // This is an external mandate withdrawal in the actual public source,
  // never an invented private qualification or a caller boolean.
  sql(`UPDATE public.powers_of_attorney SET status='revoked',updated_by=${literal(f.actorUserId)} WHERE id=${literal(f.powerOfAttorneyId)} AND company_id=${literal(f.companyId)}`)
  await expect(queuePersistedProdatRecovery({companyId:f.companyId,actorUserId:f.actorUserId,messageId:prepared.messageId})).rejects.toThrow()
  await expect(sendEdielMessageViaSmtp((await getEdielMessageById(prepared.messageId))!,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})).rejects.toThrow()
  expect(effects(f)).toEqual(before); expect(originals(f)).toEqual(archive); expect(smtp).toHaveBeenCalledTimes(1)
},120000)
it('an actual provider-entered unobserved attempt and expired timer cannot grant retry authority',async () => {
  const f = await seed(false)
  let release: ((result: {accepted:string[];rejected:string[];messageId:string;response:string}) => void) | undefined
  let entered: (() => void) | undefined
  const reached = new Promise<void>(resolve => {entered=resolve})
  const pending = new Promise<{accepted:string[];rejected:string[];messageId:string;response:string}>(resolve => {release=resolve})
  smtp.mockImplementation(() => {entered!(); return pending})
  const sending = sendEdielMessageViaSmtp(f.originalZ03,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})
  try {
    // Race the actual sender too, so a failed preflight cannot hang this test.
    await Promise.race([reached,sending.then(() => {throw Error('provider_not_entered')})])
    const attempt = sql<{id:string;entered_at:string;observed_at:null;classification:null}>(`SELECT to_jsonb(a) FROM gridex_ediel_transport.attempts a WHERE message_id=${literal(f.originalZ03.id)}`)
    expect(attempt).toMatchObject({entered_at:expect.any(String),observed_at:null,classification:null})
    sql(`INSERT INTO public.ediel_sla_timers(company_id,ediel_message_id,timer_type,due_at,status,created_by) VALUES(${literal(f.companyId)},${literal(f.originalZ03.id)},'contrl_due',now()-interval '1 hour','open',${literal(f.actorUserId)})`)
    const before = effects(f)
    await checkAckDeadlines({companyId:f.companyId,actorUserId:f.actorUserId})
    expect(await prepareAndQueueProdatRecovery({companyId:f.companyId,actorUserId:f.actorUserId,originalMessageId:f.originalZ03.id,operationId:randomUUID(),previousAttemptId:attempt.id})).toMatchObject({status:'held',reason:'verified_transfer_loss_required'})
    expect(effects(f)).toEqual(before); expect(smtp).toHaveBeenCalledTimes(1)
    expect(sql(`SELECT to_jsonb(a) FROM gridex_ediel_transport.attempts a WHERE id=${literal(attempt.id)}`)).toEqual(attempt)
  } finally {
    release!({accepted:['recipient@example.invalid'],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'})
    await sending
  }
},120000)
it('the actual sweep of a declared expired public SLA row cannot create recovery/outbox/provider effects for absent, accepted, partial or uncertain attempts',async () => {
  for (const kind of ['absent','accepted','partial','unknown'] as const) {
    const f = await seed(false)
    let evaluatedAt: string | undefined
    if (kind !== 'absent') {
      if (kind === 'unknown') smtp.mockRejectedValue(Object.assign(new Error('synthetic provider timeout'),{code:'ETIMEDOUT',command:'DATA'}))
      else smtp.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:kind === 'partial' ? ['other@example.invalid'] : [],messageId:randomUUID(),response:'250 synthetic accepted'})
      await sendEdielMessageViaSmtp(f.originalZ03,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'}).catch(() => null)
      expect(sql(`SELECT to_jsonb(classification) FROM gridex_ediel_transport.attempts WHERE message_id=${literal(f.originalZ03.id)}`)).toBe(kind)
    }
    if (kind === 'accepted') {
      const original = (await getEdielMessageById(f.originalZ03.id))!
      // This deadline comes from the actual accepted transport owner, unlike
      // the explicitly declared public sweep input below.
      expect(Number.isFinite(Date.parse(original.contrl_due_at!))).toBe(true)
      evaluatedAt = new Date(Date.parse(original.contrl_due_at!) + 86400000).toISOString()
      const before = effects(f), calls = smtp.mock.calls.length
      const actualWatch = await readEdielProcessNextActions({companyId:f.companyId,actorUserId:f.actorUserId,environment:'test',messageIds:[original.id],evaluatedAt,access:{canRead:true,canReview:true,canPrepare:true}})
      const overdue = actualWatch.get(original.id)
      expect(overdue).toMatchObject({sourceMessageId:original.id,automaticResendAllowed:false,authorizesProviderEntry:false})
      expect(overdue!.blockers).toContain('technical_sender_watch_overdue')
      expect(Date.parse(overdue!.timeBasis.technicalDueAt!)).toBe(Date.parse(original.contrl_due_at!))
      expect(effects(f)).toEqual(before); expect(smtp).toHaveBeenCalledTimes(calls)
    }
    const timerId = randomUUID()
    sql(`INSERT INTO public.ediel_sla_timers(id,company_id,ediel_message_id,timer_type,due_at,status,created_by) VALUES(${literal(timerId)},${literal(f.companyId)},${literal(f.originalZ03.id)},'contrl_due',now()-interval '1 hour','open',${literal(f.actorUserId)})`)
    const before = effects(f), archive = originals(f), calls = smtp.mock.calls.length
    expect(await checkAckDeadlines({companyId:f.companyId,actorUserId:f.actorUserId,now:evaluatedAt})).toMatchObject({expired:expect.any(Number)})
    expect(sql(`SELECT to_jsonb(status) FROM public.ediel_sla_timers WHERE id=${literal(timerId)}`)).toBe('expired')
    expect(effects(f)).toEqual(before); expect(originals(f)).toEqual(archive); expect(smtp).toHaveBeenCalledTimes(calls)
    const attemptId = sql<string | null>(`SELECT (SELECT to_jsonb(id) FROM gridex_ediel_transport.attempts WHERE message_id=${literal(f.originalZ03.id)})`)
    expect(await prepareAndQueueProdatRecovery({companyId:f.companyId,actorUserId:f.actorUserId,originalMessageId:f.originalZ03.id,operationId:randomUUID(),previousAttemptId:attemptId ?? randomUUID()})).toMatchObject({status:'held',reason:'verified_transfer_loss_required'})
    expect(effects(f)).toEqual(before); expect(smtp).toHaveBeenCalledTimes(calls)
  }
},180000)
