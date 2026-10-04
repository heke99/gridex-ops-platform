// masterplan: TR-05, AT-TR-05, SC-040, TR-10, AT-TR-10, SC-063
// Actual local owners; synthetic upstream tenant/network/mail inputs,
// public clock and DB-fault fixtures are declared below. Counterparty reply
// bytes and external SMTP results are fixtures. No private admitted ACK,
// ready operation or transport attempt is inserted. Sent production originals are singleton, so these tests do not
// claim a genuine multi-object sent-original fixture or market certification.
import {createHash, randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {afterEach, expect, it, vi} from 'vitest'
const smtp = vi.hoisted(() => vi.fn())
vi.mock('nodemailer', () => ({default: {createTransport: () => ({sendMail: smtp})}}))
import {supabaseService} from '@/lib/supabase/service'
import {seedNormalSwitchNativeFixture, futureNativeSupplyDate, normalSwitchNetworkRegistry, nativeSql as sql, literal} from './helpers/ediel-normal-switch-native-fixture'
import {receiveUtiltsRetry} from './helpers/utiltsConsumptionParties'
import {parseEdifactPayload} from '@/lib/inbound-mail/edielEmailParser'
import {createInboundEdielMessage, createParseResult} from '@/lib/inbound-mail/inboundStatusUpdater'
import {getEdielMessageById} from '@/lib/ediel/db'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {buildReceivedSourceValidationEvidence} from '@/lib/ediel/core/receivedSourceValidationEvidence'
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
import {claimEdielOutboxItem} from '@/lib/ediel/outbox/claimOutboxItems'
import {processEdielOutbox} from '@/lib/ediel/outbox/processEdielOutbox'
import {readVerifiedEdielTransportCopy} from '@/lib/ediel/transport/verifiedCopy'
import {readEdielTransportCopies} from '@/lib/ediel/transport/copy'
import {revokeNetworkRegistrySource} from '@/lib/ediel/production/networkRegistrySource'
import {readAcceptedEdielTransportProjection} from '@/lib/ediel/transport/acceptedProjection'
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
  const {inboundEmailMessageId} = receiveUtiltsRetry(sql,literal,{companyId:f.companyId,actorUserId:f.actorUserId,raw,parsed})
  // The retained mailbox/raw-mail input is declared; parse persistence and
  // family/code normalization use the actual intake adapter. The helper's
  // unused synthetic parse row cannot qualify this reception.
  const parseResultId = await createParseResult({companyId:f.companyId,inboundEmailMessageId,parsed})
  const reception = {inboundEmailMessageId,parseResultId}
  const id = await createInboundEdielMessage({companyId:f.companyId,actorUserId:f.actorUserId,environment:'test',...reception,parsed})
  expect(id).toBeTruthy()
  const message = (await getEdielMessageById(id!))!
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(message)
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
  const validationInput={original:message,validated:message,resolvedCompanyId:f.companyId,decision}
  const evidence=buildReceivedSourceValidationEvidence(validationInput)
  expect(evidence,JSON.stringify({id:message.id,family:message.message_family,code:message.message_code,receivedAt:message.message_received_at,context:(message.execution_context_snapshot as Record<string,unknown> | null)?.receivedAckContext})).not.toBeNull()
  const validationReceipt=await recordReceivedSourceValidation(validationInput)
  if(validationReceipt.status!=='recorded' && evidence){
    // Diagnose the same public owner using its real fresh canonical evidence.
    // This cannot replace the failed production receipt or seed ACK admission.
    const diagnostic=await supabaseService.rpc('gridex_record_source_validation_v1',{p_company_id:evidence.companyId,p_environment:evidence.environment,p_source_message_id:evidence.sourceMessageId,p_source_payload_hash:evidence.sourcePayloadHash,p_facts_text:evidence.factsText})
    expect(diagnostic.error,JSON.stringify(diagnostic.error)).toBeNull()
  }
  expect(validationReceipt).toMatchObject({status:'recorded'})
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
    await expect(prepareProdatRecoveryDraft({companyId:f.companyId,actorUserId:f.actorUserId,originalMessageId:f.originalZ03.id,sourceAckMessageId:ack.id,operationId:randomUUID(),correctedRawPayload:correction(f,options)})).resolves.toEqual({status:'held',reason:'corrected_exact_failed_scope_required'})
    expect(effects(f)).toEqual(initial); expect(originals(f)).toEqual(before); expect(smtp).toHaveBeenCalledTimes(1)
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
  // A new pre-send archive may be appended before current-authority refusal.
  // Every pre-existing byte/hash/attempt must remain exactly unchanged.
  const retained=archive as {raw:string;hash:string;rendered:string;archives:Array<{id:string}>;attempts:unknown[]}
  const current=originals(f) as typeof retained
  expect({...current,archives:current.archives.filter(p=>retained.archives.some(old=>old.id===p.id))}).toEqual(retained)
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
it('fresh correction finalization denies a retired actual guide activation after a qualified negative ACK',async () => {
  const f=await seed(),ack=await receiveAck(f,externalAck(f,'contrl'))
  const packId=f.originalZ03.canonical_rule_pack_id
  expect(packId).toBeTruthy()
  const prior=sql<string>(`SELECT to_jsonb(status) FROM public.ediel_rule_packs WHERE id=${literal(packId!)}`)
  expect(prior).toBe('active')
  const before=effects(f) as {messages:number;outboxes:number;attempts:number},original=originals(f),calls=smtp.mock.calls.length
  // A declared withdrawal of the actual persisted activation. No replacement
  // guide edition, caller qualification or private admission is invented.
  sql(`UPDATE public.ediel_rule_packs SET status='retired' WHERE id=${literal(packId!)};SELECT to_jsonb(true)`)
  try {
    await expect(prepareProdatRecoveryDraft({companyId:f.companyId,actorUserId:f.actorUserId,originalMessageId:f.originalZ03.id,sourceAckMessageId:ack.id,operationId:randomUUID(),correctedRawPayload:correction(f)})).rejects.toThrow()
    expect(effects(f)).toMatchObject({messages:before.messages,outboxes:before.outboxes,attempts:before.attempts})
    expect(originals(f)).toEqual(original);expect(smtp).toHaveBeenCalledTimes(calls)
  } finally {
    sql(`UPDATE public.ediel_rule_packs SET status=${literal(prior)} WHERE id=${literal(packId!)};SELECT to_jsonb(true)`)
  }
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
it('the actual sweep of a declared expired public SLA row cannot create recovery/outbox/provider effects for absent, accepted, foreign-mixed or uncertain attempts',async () => {
  for (const kind of ['absent','accepted','foreign_mixed','unknown'] as const) {
    const f = await seed(false)
    let evaluatedAt: string | undefined
    if (kind !== 'absent') {
      if (kind === 'unknown') smtp.mockRejectedValue(Object.assign(new Error('synthetic provider timeout'),{code:'ETIMEDOUT',command:'DATA'}))
      else smtp.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:kind === 'foreign_mixed' ? ['other@example.invalid'] : [],messageId:randomUUID(),response:'250 synthetic accepted'})
      await sendEdielMessageViaSmtp(f.originalZ03,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'}).catch(() => null)
      // A foreign rejected address cannot prove partial delivery to this
      // original's sole recipient. The real classifier must remain unknown.
      expect(sql(`SELECT to_jsonb(classification) FROM gridex_ediel_transport.attempts WHERE message_id=${literal(f.originalZ03.id)}`)).toBe(kind === 'foreign_mixed' ? 'unknown' : kind)
    }
    if (kind === 'accepted') {
      const original = (await getEdielMessageById(f.originalZ03.id))!
      // This deadline comes from the actual accepted transport owner, unlike
      // the explicitly declared public sweep input below.
      expect(Number.isFinite(Date.parse(original.contrl_due_at!))).toBe(true)
      evaluatedAt = new Date(Date.parse(original.contrl_due_at!) + 86400000).toISOString()
      const before = effects(f), calls = smtp.mock.calls.length
      // Z03 has no business-expectation watch projection. Read its actual
      // accepted transport owner, retain its deadline, and prove that moving
      // beyond the deadline changes neither receipt nor resend authority.
      const accepted=await readAcceptedEdielTransportProjection({companyId:f.companyId,actorUserId:f.actorUserId,environment:'test',messageId:original.id})
      expect(accepted).toMatchObject({status:'accepted_projection',messageId:original.id,authorizesProviderEntry:false,deliveryProven:false})
      expect(Date.parse(evaluatedAt)).toBeGreaterThan(Date.parse(original.contrl_due_at!))
      expect(Date.parse(original.contrl_due_at!)).toBeGreaterThan(Date.parse(accepted!.observedAt))
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

function outboxId(f: Fixture) {
  return sql<string>(`SELECT to_jsonb(id) FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(f.originalZ03.id)}`)
}
function workerState(id: string) {
  return sql<Record<string,unknown>>(`SELECT to_jsonb(o) FROM public.ediel_outbox o WHERE id=${literal(id)}`)
}
function expireDeclaredWorkerLease(id: string) {
  // A declared clock fixture on the genuinely claimed public queue row. This
  // does not create transport entry, acceptance or retry authority.
  sql(`UPDATE public.ediel_outbox SET locked_at=now()-interval '1 hour' WHERE id=${literal(id)}; SELECT to_jsonb(true)`)
}
it('a real after-DATA unknown worker result is retained and worker restart cannot resend or authorize recovery',async () => {
  const f = await seed(false), id = outboxId(f)
  smtp.mockRejectedValue(Object.assign(new Error('synthetic connection lost awaiting DATA response'),{code:'ETIMEDOUT',command:'DATA'}))
  const outcome = await sendOutboxItem({actorUserId:f.actorUserId,outboxItemId:id})
  expect(outcome).toMatchObject({status:'delivery_uncertain'})
  const attempt = sql<Record<string,unknown>>(`SELECT to_jsonb(a) FROM gridex_ediel_transport.attempts a WHERE message_id=${literal(f.originalZ03.id)}`)
  expect(attempt).toMatchObject({company_id:f.companyId,message_id:f.originalZ03.id,entered_at:expect.any(String),observed_at:expect.any(String),classification:'unknown',provider_result:{error:{code:'ETIMEDOUT',command:'DATA'}}})
  expect(workerState(id),JSON.stringify(outcome)).toMatchObject({status:'delivery_uncertain',locked_by:null,locked_at:null,last_error:expect.stringContaining('delivery_uncertain_after_smtp_send')})
  const copies = await readEdielTransportCopies({companyId:f.companyId,actorUserId:f.actorUserId,messageId:f.originalZ03.id})
  expect(copies).toMatchObject({status:'available',authorizesResend:false,deliveryProven:false})
  expect(copies.copies).toEqual(expect.arrayContaining([expect.objectContaining({attemptId:attempt.id,smtpClassification:'unknown',rfcMessageId:expect.any(String),mimeArchiveRef:expect.any(String),mimeSha256:expect.stringMatching(/^[a-f0-9]{64}$/)})]))
  const before = effects(f), original = originals(f), queue = workerState(id)
  expect(await processEdielOutbox({actorUserId:f.actorUserId,companyId:f.companyId,environment:'test'})).toMatchObject({processed:0,deliveryUncertain:0})
  expect(await sendOutboxItem({actorUserId:f.actorUserId,outboxItemId:id})).toMatchObject({status:'blocked'})
  expect(await prepareAndQueueProdatRecovery({companyId:f.companyId,actorUserId:f.actorUserId,originalMessageId:f.originalZ03.id,operationId:randomUUID(),previousAttemptId:String(attempt.id)})).toMatchObject({status:'held',reason:'verified_transfer_loss_required'})
  expect(effects(f)).toEqual(before); expect(originals(f)).toEqual(original); expect(workerState(id)).toEqual(queue)
  expect(smtp).toHaveBeenCalledTimes(1)
},120000)
it('an expired actual pre-entry worker lease is held and its stale identity cannot enter SMTP',async () => {
  const f = await seed(false), id = outboxId(f), workerId = `synthetic-worker-${randomUUID()}`
  const claim = await claimEdielOutboxItem({actorUserId:f.actorUserId,outboxItemId:id,workerId})
  expect(claim).toMatchObject({id,status:'sending',locked_by:workerId,current_send_attempt_id:expect.any(String)})
  expect(await claimEdielOutboxItem({actorUserId:f.actorUserId,outboxItemId:id,workerId:`other-${workerId}`})).toBeNull()
  expireDeclaredWorkerLease(id)
  expect(await processEdielOutbox({actorUserId:f.actorUserId,companyId:f.companyId,environment:'test'})).toMatchObject({processed:0})
  expect(workerState(id)).toMatchObject({status:'delivery_uncertain',locked_by:null,current_send_attempt_id:claim!.current_send_attempt_id,last_error:'stale_sending_lock_requires_transport_reconciliation'})
  expect(await sendOutboxItem({actorUserId:f.actorUserId,outboxItemId:id,workerId,sendAttemptId:claim!.current_send_attempt_id,alreadyClaimed:true})).toMatchObject({status:'blocked',error:'outbox_item_not_claimed_by_worker'})
  // Exercise the actual SQL fence too, rather than relying on the worker's
  // early public-row check or a fabricated private reservation.
  await expect(sendEdielMessageViaSmtp(f.originalZ03,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment',dispatchOwner:{kind:'worker',outboxId:id,sendAttemptId:claim!.current_send_attempt_id!,workerId}})).rejects.toMatchObject({message:expect.stringContaining('ediel_transport_worker_fence_lost')})
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_transport.attempts WHERE message_id=${literal(f.originalZ03.id)}`)).toBe(0)
  expect(smtp).not.toHaveBeenCalled()
},120000)
it('lease expiry while the real worker awaits SMTP cannot re-enter, and its late accepted receipt only reconciles the same original',async () => {
  const f = await seed(false), id = outboxId(f)
  let release: ((result: {accepted:string[];rejected:string[];messageId:string;response:string}) => void) | undefined
  let entered: (() => void) | undefined
  const entry = new Promise<void>(resolve => {entered=resolve})
  const pending = new Promise<{accepted:string[];rejected:string[];messageId:string;response:string}>(resolve => {release=resolve})
  smtp.mockImplementation(() => {entered!(); return pending})
  const sending = sendOutboxItem({actorUserId:f.actorUserId,outboxItemId:id})
  try {
    await Promise.race([entry,sending.then(() => {throw Error('provider_not_entered')})])
    const attempt = sql<Record<string,unknown>>(`SELECT to_jsonb(a) FROM gridex_ediel_transport.attempts a WHERE message_id=${literal(f.originalZ03.id)}`)
    expect(attempt).toMatchObject({entered_at:expect.any(String),observed_at:null,classification:null})
    expireDeclaredWorkerLease(id)
    expect(await processEdielOutbox({actorUserId:f.actorUserId,companyId:f.companyId,environment:'test'})).toMatchObject({processed:0})
    expect(workerState(id)).toMatchObject({status:'delivery_uncertain',locked_by:null})
    expect(await sendOutboxItem({actorUserId:f.actorUserId,outboxItemId:id})).toMatchObject({status:'blocked'})
    expect(sql(`SELECT to_jsonb(a) FROM gridex_ediel_transport.attempts a WHERE id=${literal(String(attempt.id))}`)).toEqual(attempt)
    expect(smtp).toHaveBeenCalledTimes(1)
  } finally {
    release!({accepted:['recipient@example.invalid'],rejected:[],messageId:randomUUID(),response:'250 synthetic late acceptance'})
    await sending
  }
  expect(await sending).toMatchObject({status:'sent'})
  const observed = sql<Record<string,unknown>>(`SELECT to_jsonb(a) FROM gridex_ediel_transport.attempts a WHERE message_id=${literal(f.originalZ03.id)}`)
  expect(observed).toMatchObject({classification:'accepted',observed_at:expect.any(String)})
  const stable = originals(f)
  expect(await processEdielOutbox({actorUserId:f.actorUserId,companyId:f.companyId,environment:'test'})).toMatchObject({processed:0})
  expect(originals(f)).toEqual(stable); expect(smtp).toHaveBeenCalledTimes(1)
},120000)
it('an actual accepted journal survives failed DB projection and repairs with its frozen clock without another SMTP call',async () => {
  const f = await seed(false), id = outboxId(f)
  smtp.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'})
  // A declared, message-scoped DB fault. No private source/admission or
  // accepted receipt is seeded; the real provider owner must establish it.
  sql(`ALTER TABLE public.ediel_messages ADD CONSTRAINT tr10_native_projection_failure CHECK(id<>${literal(f.originalZ03.id)}::uuid OR message_sent_at IS NULL); SELECT to_jsonb(true)`)
  try {
    expect(await sendOutboxItem({actorUserId:f.actorUserId,outboxItemId:id})).toMatchObject({status:'delivery_uncertain'})
    expect((await getEdielMessageById(f.originalZ03.id))!.message_sent_at).toBeNull()
    expect(sql(`SELECT to_jsonb(a) FROM gridex_ediel_transport.attempts a WHERE message_id=${literal(f.originalZ03.id)}`)).toMatchObject({classification:'accepted',observed_at:expect.any(String)})
    expect(workerState(id)).toMatchObject({status:'delivery_uncertain'})
  } finally {
    sql('ALTER TABLE public.ediel_messages DROP CONSTRAINT tr10_native_projection_failure; SELECT to_jsonb(true)')
  }
  const attempt = sql<{observed_at:string}>(`SELECT to_jsonb(a) FROM gridex_ediel_transport.attempts a WHERE message_id=${literal(f.originalZ03.id)}`)
  const original = (await getEdielMessageById(f.originalZ03.id))!
  const repaired = await sendEdielMessageViaSmtp(original,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})
  expect(Date.parse(repaired.dispatchObservedAt!)).toBe(Date.parse(attempt.observed_at))
  expect(Date.parse((await getEdielMessageById(original.id))!.message_sent_at!)).toBe(Date.parse(attempt.observed_at))
  expect(await processEdielOutbox({actorUserId:f.actorUserId,companyId:f.companyId,environment:'test'})).toMatchObject({processed:0})
  expect(smtp).toHaveBeenCalledTimes(1)
},120000)
it('an unswept expired genuine claim cannot reach the provider with its old worker identity',async () => {
  const f = await seed(false), id = outboxId(f), workerId = `synthetic-expired-${randomUUID()}`
  const claim = await claimEdielOutboxItem({actorUserId:f.actorUserId,outboxItemId:id,workerId})
  expect(claim).toMatchObject({status:'sending',current_send_attempt_id:expect.any(String)})
  expireDeclaredWorkerLease(id)
  smtp.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'})
  const before = effects(f)
  expect(await sendOutboxItem({actorUserId:f.actorUserId,outboxItemId:id,workerId,sendAttemptId:claim!.current_send_attempt_id,alreadyClaimed:true})).toMatchObject({status:'blocked'})
  expect(effects(f)).toEqual(before); expect(smtp).not.toHaveBeenCalled()
},120000)
it('a genuine worker blocked on its claimed row cannot enter SMTP when its lease expires during the lock wait',async () => {
  if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_local_only')
  const f=await seed(false),id=outboxId(f),workerId=`synthetic-lock-wait-${randomUUID()}`
  const claim=await claimEdielOutboxItem({actorUserId:f.actorUserId,outboxItemId:id,workerId})
  expect(claim).toMatchObject({status:'sending',current_send_attempt_id:expect.any(String)})
  const {nativeLockProcess,nativeLockProcessEnv}=await import('./helpers/native-lock-process')
  // This timing-only barrier forwards the unchanged SDK request/result. The
  // real worker must finish its public updates, archive and private prepare
  // before the row is locked; otherwise a queue UPDATE could be the waiter.
  let entryReady!: (input:Record<string,unknown>)=>void,releaseEntry!: ()=>void
  const entryReached=new Promise<Record<string,unknown>>(resolve=>{entryReady=resolve})
  const entryBarrier=new Promise<void>(resolve=>{releaseEntry=resolve})
  const originalRpc=supabaseService.rpc.bind(supabaseService)
  let entryCalls=0,entryError:{code:string;message:string}|null|undefined
  const observe=vi.spyOn(supabaseService,'rpc').mockImplementation((name,args,options)=>{
    const input=(args as {p_input?:Record<string,unknown>}|undefined)?.p_input
    const request=originalRpc(name,args,options)
    if(name==='gridex_ediel_transport_attempt_v1'&&input?.action==='enter'&&input.messageId===f.originalZ03.id){
      entryCalls++
      const then=request.then.bind(request)
      request.then=((resolve,reject)=>entryBarrier.then(()=>then(response=>{
        entryError=response.error
        return response
      })).then(resolve,reject)) as typeof request.then
      entryReady(input)
    }
    return request
  })
  let lock:ReturnType<typeof nativeLockProcess>|undefined,setupTimer:ReturnType<typeof setTimeout>|undefined
  let sending:ReturnType<typeof sendOutboxItem>|undefined
  try {
    smtp.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'})
    sending=sendOutboxItem({actorUserId:f.actorUserId,outboxItemId:id,workerId,sendAttemptId:claim!.current_send_attempt_id,alreadyClaimed:true})
    // Observe rejection immediately, also while the owned lock is outstanding.
    void sending.catch(()=>undefined)
    const identity=await Promise.race([entryReached,sending.then(()=>{throw Error('native_worker_did_not_reach_entry')}),new Promise<never>((_,reject)=>{setupTimer=setTimeout(()=>reject(Error('native_worker_entry_barrier_timeout')),30000)})])
    clearTimeout(setupTimer)
    expect(identity).toMatchObject({companyId:f.companyId,environment:'test',messageId:f.originalZ03.id,actorUserId:f.actorUserId,attemptId:expect.any(String)})
    const prepared=sql<Record<string,unknown>>(`SELECT to_jsonb(a) FROM gridex_ediel_transport.attempts a WHERE id=${literal(identity.attemptId)}`)
    expect(prepared).toMatchObject({entered_at:null,observed_at:null,owner:{kind:'worker',outboxId:id,sendAttemptId:claim!.current_send_attempt_id,workerId}})
    const queueIdentity=`id=${literal(id)} AND company_id=${literal(f.companyId)} AND environment='test' AND ediel_message_id=${literal(f.originalZ03.id)} AND status='sending' AND current_send_attempt_id=${literal(claim!.current_send_attempt_id)} AND locked_by=${literal(workerId)}`
    // A committed public clock input leaves two seconds only after all real
    // front-door work has finished. No production role/request timeout changes.
    expect(sql(`WITH updated AS(UPDATE public.ediel_outbox SET locked_at=clock_timestamp()-interval '9 minutes 58 seconds' WHERE ${queueIdentity} RETURNING id) SELECT to_jsonb(count(*)) FROM updated`)).toBe(1)
    const holder=spawn('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe'],env:nativeLockProcessEnv()})
    let output=''
    holder.stdout.on('data',chunk=>{output=(output+String(chunk)).slice(-4096)})
    lock=nativeLockProcess(holder,{marker:'LOCK_READY',markerError:'synthetic_lock_holder_not_ready',markerTimeoutMs:5000,lifetimeMs:15000})
    holder.stdin.write(`SELECT pg_backend_pid();\nBEGIN;\nSELECT id FROM public.ediel_outbox WHERE ${queueIdentity} FOR UPDATE;\n\\echo LOCK_READY\n`)
    await lock.ready
    const holderPid=Number(output.split('\n')[0]);expect(Number.isInteger(holderPid)&&holderPid>0).toBe(true)
    const probe=()=>sql<{blocked:boolean;current:boolean;expired:boolean}>(`WITH observed_clock AS MATERIALIZED(SELECT clock_timestamp() AS observed_at) SELECT jsonb_build_object('blocked',EXISTS(SELECT FROM pg_stat_activity a WHERE a.wait_event_type='Lock' AND a.query LIKE '%gridex_ediel_transport_attempt_v1%' AND ${holderPid}=ANY(pg_blocking_pids(a.pid))),'current',EXISTS(SELECT FROM public.ediel_outbox,observed_clock WHERE ${queueIdentity} AND locked_at<=observed_at AND locked_at>observed_at-interval '10 minutes'),'expired',EXISTS(SELECT FROM public.ediel_outbox,observed_clock WHERE ${queueIdentity} AND locked_at<=observed_at-interval '10 minutes'))`)
    releaseEntry()
    let blocked=false
    for(let i=0;i<30&&!blocked;i++){
      const observed=probe()
      if(observed.blocked){expect(observed.current).toBe(true);blocked=true;break}
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    expect(blocked,'real provider-entry RPC must wait on the row while its lease is current').toBe(true)
    let expired=false
    for(let i=0;i<50&&!expired;i++){
      const observed=probe()
      expect(observed.blocked,'entry must still be waiting until the DB clock expires the lease').toBe(true)
      expect(observed.current||observed.expired,'the exact worker claim must remain present with a valid lease clock').toBe(true)
      expired=observed.expired
      if(!expired)await new Promise(resolve=>setTimeout(resolve,50))
    }
    expect(expired,'release must follow actual DB-clock lease expiry').toBe(true)
    expect(smtp).not.toHaveBeenCalled()
    await lock.release('COMMIT')
    // Entry response loss is conservatively public-uncertain; only the actual
    // native refusal proves this race. A 57014 timeout cannot satisfy it.
    expect(await sending).toMatchObject({status:'delivery_uncertain'})
    expect(entryCalls).toBe(1)
    expect(entryError).toMatchObject({code:'P0001',message:expect.stringContaining('ediel_transport_worker_fence_lost')})
    expect(sql(`SELECT to_jsonb(a) FROM gridex_ediel_transport.attempts a WHERE id=${literal(identity.attemptId)}`)).toEqual(prepared)
    expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_transport.attempts WHERE message_id=${literal(f.originalZ03.id)} AND entered_at IS NOT NULL`)).toBe(0)
    expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_transport.reconciliation_cases WHERE message_id=${literal(f.originalZ03.id)}`)).toBe(0)
    expect(smtp).not.toHaveBeenCalled()
  } finally {
    clearTimeout(setupTimer)
    try {await lock?.dispose()}
    finally {
      releaseEntry()
      try {if(sending)await sending.catch(()=>undefined)}
      finally {observe.mockRestore()}
    }
  }
},120000)
