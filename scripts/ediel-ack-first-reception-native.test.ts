// masterplan: TR-05, AT-TR-05
// Actual parser, intake adapter and immutable reception owner. Disposable
// tenants/actors and retained external mail bytes are fixture inputs. This
// proves reception mechanics, not admitted ACK effects or market validation.
import {createHash, randomUUID} from 'node:crypto'
import {expect, it} from 'vitest'
import {parseEdifactPayload} from '@/lib/inbound-mail/edielEmailParser'
import {createInboundEdielMessage, createParseResult} from '@/lib/inbound-mail/inboundStatusUpdater'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {readInboundReceptionRequest} from '@/lib/ediel/inbound/receptions'
import {decisionNativeSql as sql, decisionUser, literal} from './helpers/ediel-decision-original-native-fixture'

const hash = (raw: string) => createHash('sha256').update(raw).digest('hex')

function externalAck(family: 'CONTRL' | 'APERAK') {
  const reference = randomUUID().replaceAll('-', '').slice(0, 14)
  const documentDate = new Date().toISOString().replace(/\D/g, '').slice(0, 12)
  const businessSegments = family === 'CONTRL'
    ? ['UCI+SOURCE+21660:ZZ+54321:ZZ+7']
    : ['BGM+++27', `DTM+137:${documentDate}:203`, 'RFF+ACW:SOURCE', 'NAD+FR+54321:160:SVK', 'NAD+DO+21660:160:SVK', 'ERC+40::260', 'FTX+AAO++102::260+Synthetic external rejection']
  return EdifactEnvelopeCodec.encode({
    sender: '54321', receiver: '21660', senderQualifier: 'ZZ', receiverQualifier: 'ZZ',
    applicationReference: '23-DDQ-PRODAT', acknowledgementRequest: false, environment: 'test', interchangeReference: reference,
    messages: [{messageReference: reference, messageTypeToken: family === 'CONTRL' ? 'CONTRL:2:2:UN:EDIEL2' : 'APERAK:D:96A:UN:E2SE6A', businessSegments}],
  })
}

async function fixture(family: 'CONTRL' | 'APERAK') {
  const companyId = randomUUID(), mailboxId = randomUUID(), raw = externalAck(family)
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(companyId)},'Synthetic ACK reception tenant','active');
    INSERT INTO public.ediel_mailboxes(id,company_id,mailbox_name,email_address,environment,is_active,is_shared_platform_mailbox)
    VALUES(${literal(mailboxId)},${literal(companyId)},'Synthetic retained ACK mailbox','ack-reception@example.invalid','test',true,false)`)
  // Original creation requires communication.write; immutable reception
  // recording resolves its legacy write marker to communication.send.
  const actor = await decisionUser(companyId, ['communication.write', 'communication.send', 'communication.read'], randomUUID() + 'Aa1!')
  expect(sql(`SELECT jsonb_build_object(
    'write',public.gridex_actor_has_company_permission(${literal(actor.id)},${literal(companyId)},'communication.write'),
    'send',public.gridex_actor_has_company_permission(${literal(actor.id)},${literal(companyId)},'communication.send'),
    'read',public.gridex_actor_has_company_permission(${literal(actor.id)},${literal(companyId)},'communication.read')
    )`)).toEqual({write: true, send: true, read: true})
  const retain = async () => {
    const inboundEmailMessageId = randomUUID(), parsed = parseEdifactPayload(raw)
    // Only this upstream retained-mail input is written directly. Parse rows,
    // canonical originals and private receipts come from production ports.
    sql(`INSERT INTO public.inbound_email_messages(id,company_id,environment,mailbox_id,internet_message_id,received_at,raw_edifact_payload,body_text,processing_status,match_status)
      VALUES(${literal(inboundEmailMessageId)},${literal(companyId)},'test',${literal(mailboxId)},${literal(inboundEmailMessageId + '@example.invalid')},clock_timestamp(),${literal(raw)},${literal(raw)},'received','not_checked')`)
    const parseResultId = await createParseResult({companyId, inboundEmailMessageId, parsed})
    return {companyId, actorUserId: actor.id, environment: 'test', inboundEmailMessageId, parseResultId, parsed}
  }
  return {companyId, mailboxId, raw, actor, retain}
}

function snapshot(companyId: string, messageId: string) {
  return sql(`SELECT jsonb_build_object(
    'original',to_jsonb(m),
    'receptions',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM gridex_ediel_inbound_receptions.receptions r WHERE r.source_message_id=m.id),
    'requests',(SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]') FROM gridex_ediel_inbound_receptions.response_requests q WHERE q.source_message_id=m.id),
    'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM public.ediel_message_events e WHERE e.ediel_message_id=m.id)
    ) FROM public.ediel_messages m WHERE m.id=${literal(messageId)} AND m.company_id=${literal(companyId)}`)
}

function businessEffects(companyId: string) {
  return sql(`SELECT jsonb_build_object(
    'validation',(SELECT count(*) FROM gridex_received_sources.validation_assessments WHERE company_id=${literal(companyId)}),
    'correlations',(SELECT count(*) FROM gridex_ack_authority.source_correlations WHERE company_id=${literal(companyId)}),
    'outboxes',(SELECT count(*) FROM public.ediel_outbox WHERE company_id=${literal(companyId)}),
    'attempts',(SELECT count(*) FROM gridex_ediel_transport.attempts WHERE company_id=${literal(companyId)})
    )`)
}

for (const family of ['CONTRL', 'APERAK'] as const) {
  it(`${family} actual intake binds its first retained mail, replays stably and holds an identical new reception`, async () => {
    const f = await fixture(family), first = await f.retain()
    const messageId = await createInboundEdielMessage(first)
    expect(messageId).toBeTruthy()
    if (!messageId) throw new Error('actual_ack_original_missing')
    const scope = {companyId: f.companyId, actorUserId: f.actor.id, messageId, inboundEmailMessageId: first.inboundEmailMessageId}
    const receipt = await readInboundReceptionRequest(scope)
    expect(receipt).toMatchObject({
      classification: 'first_reception', status: 'observed', responseRequestId: null, reason: null,
      parseResultId: first.parseResultId, canonicalPayloadHash: hash(f.raw), receivedPayloadHash: hash(f.raw),
      businessEffectAuthorized: false,
    })
    // The existing adapter stores a JS Date (milliseconds); the immutable
    // private receipt retains the exact native transport timestamp.
    expect(sql(`SELECT jsonb_build_object(
      'mailLinkMatches',m.inbound_email_message_id=mail.id,
      'originalSelectorMatches',m.mailbox_message_id=mail.id::text,
      'originalClockMatchesAtAdapterPrecision',m.message_received_at=date_trunc('milliseconds',mail.received_at),
      'receiptClockMatches',r.received_at=mail.received_at,
      'receiptMailboxMatches',r.transport_source_snapshot->>'mailboxId'=mail.mailbox_id::text,
      'rawMatches',m.raw_payload=mail.raw_edifact_payload,
      'receptions',(SELECT count(*) FROM gridex_ediel_inbound_receptions.receptions WHERE source_message_id=m.id),
      'requests',(SELECT count(*) FROM gridex_ediel_inbound_receptions.response_requests WHERE source_message_id=m.id)
      ) FROM public.ediel_messages m JOIN gridex_ediel_inbound_receptions.receptions r ON r.source_message_id=m.id
      JOIN public.inbound_email_messages mail ON mail.id=r.inbound_email_message_id WHERE m.id=${literal(messageId)}`)).toEqual({
      mailLinkMatches: true, originalSelectorMatches: true, originalClockMatchesAtAdapterPrecision: true, receiptClockMatches: true,
      receiptMailboxMatches: true, rawMatches: true, receptions: 1, requests: 0,
    })
    const original = snapshot(f.companyId, messageId)
    expect(await createInboundEdielMessage(first)).toBe(messageId)
    expect(await readInboundReceptionRequest(scope)).toMatchObject({receptionId: receipt!.receptionId, isReplay: true, classification: 'first_reception'})
    expect(snapshot(f.companyId, messageId)).toEqual(original)

    const duplicate = await f.retain(), beforeDuplicate = snapshot(f.companyId, messageId) as {original: unknown; events: unknown}
    await expect(createInboundEdielMessage(duplicate)).rejects.toMatchObject({name: 'InboundReceptionHeldError', reception: {
      sourceMessageId: messageId, inboundEmailMessageId: duplicate.inboundEmailMessageId,
      classification: 'protocol_duplicate', status: 'held', businessEffectAuthorized: false,
      reason: 'authentic_duplicate_transport_response_policy_required',
    }})
    const held = await readInboundReceptionRequest({...scope, inboundEmailMessageId: duplicate.inboundEmailMessageId})
    expect(held).toMatchObject({classification: 'protocol_duplicate', status: 'held', parseResultId: duplicate.parseResultId, canonicalPayloadHash: hash(f.raw), receivedPayloadHash: hash(f.raw)})
    expect(held!.responseRequestId).toBeTruthy()
    const afterDuplicate = snapshot(f.companyId, messageId) as {original: unknown; events: unknown; receptions: unknown[]; requests: unknown[]}
    expect(afterDuplicate.original).toEqual(beforeDuplicate.original)
    expect(afterDuplicate.events).toEqual(beforeDuplicate.events)
    expect(afterDuplicate.receptions).toHaveLength(2)
    expect(afterDuplicate.requests).toHaveLength(1)
    await expect(createInboundEdielMessage(duplicate)).rejects.toMatchObject({name: 'InboundReceptionHeldError', reception: {receptionId: held!.receptionId, isReplay: true}})
    expect(snapshot(f.companyId, messageId)).toEqual(afterDuplicate)
    expect(businessEffects(f.companyId)).toEqual({validation: 0, correlations: 0, outboxes: 0, attempts: 0})
  }, 30000)
}

// masterplan: SC-037, ACK-01, AT-ACK-01
// Prepared SOURCE only. The incumbent native producer must execute these against
// one coherent SOURCE8/backend/input epoch. The two TR-05 cases above stay intact.
import {vi} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {processInboundAckMessage} from '@/lib/ediel/flows/inboundAckProcessing'
import {applyCanonicalInboundAckStatusUpdate} from '@/lib/inbound-mail/canonicalInboundAckStatusUpdater'
import {applySafeInboundStatusUpdate} from '@/lib/inbound-mail/inboundStatusUpdater'
import {matchOutboundRequestForInbound, matchMeteringPointForInbound} from '@/lib/inbound-mail/inboundMatcher'
import {readCommittedInboundAck} from '@/lib/ediel/ack/committedInboundAck'
import {applyInboundAckSwitchTransition} from '@/lib/ediel/ack/switchRequestAckTransition'
import {resolveCanonicalRuntimeDecisionWithRegistry, readReceivedCanonicalProdatApplicationObjects} from '@/lib/ediel/core/runtimeDecision'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {captureFreshEdielSourceRulePackEvidence} from '@/lib/ediel/core/sourceRulePackEvidence'
import {createReceivedSourceOwnerSession} from '@/lib/ediel/sources/receivedSourceOwnerSession'
import {applyInboundBusinessStateMachine} from '@/lib/ediel/flows/inboundBusinessStateMachine'
import {seedNormalSwitchNativeFixture} from './helpers/ediel-normal-switch-native-fixture'
import {seedOriginalMailboxNative} from './helpers/originalMailboxNative'
import {ownerSourceWithInstallationStatus} from '../__tests__/helpers/sourceOwnerFixtures'
import {nativeCalendarShiftDays, shiftMarketDates, viaOriginalCalendar} from '../__tests__/helpers/nativeMarketCalendar'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'

// Only the external SMTP transport is replaced. All PG, parser, registry,
// ownership, first-reception, ledger and transition ports remain production code.
const sc037Provider = vi.hoisted(() => vi.fn())
vi.mock('nodemailer', () => ({default: {createTransport: () => ({sendMail: sc037Provider})}}))
type Sc037Entry = 'flow' | 'canonical_mail' | 'safe_mail'
type Sc037Fixture = Awaited<ReturnType<typeof seedNormalSwitchNativeFixture>>
type Sc037Request = Record<string, unknown> & {id: string; company_id: string; status: string}
const sc037Sql = <T = unknown>(statement: string) => sql<T>(statement)
const sc037Smtp = 'sc037-native@example.invalid'

async function sc037Seed(): Promise<Sc037Fixture> {
  vi.stubEnv('EDIEL_SHARED_MAILBOX_ADDRESS', sc037Smtp)
  vi.stubEnv('EDIEL_APP_DKIM_ENABLED', 'false'); vi.stubEnv('EMAIL_PROVIDER', 'resend')
  vi.stubEnv('EDIEL_SMTP_FROM', sc037Smtp); vi.stubEnv('EDIEL_SMTP_USER', sc037Smtp)
  vi.stubEnv('EDIEL_SMTP_PASS', 'synthetic-only'); vi.stubEnv('EDIEL_EMAIL_PROVIDER', 'strato')
  const requestedStartDate = shiftMarketDates('2026-10-01', nativeCalendarShiftDays())
  const f = await seedNormalSwitchNativeFixture({requestedStartDate, provider: email => {
    sc037Provider.mockResolvedValue({accepted: [email], rejected: [], messageId: randomUUID(), response: '250 synthetic accepted'})
  }})
  expect(f.originalZ03).toMatchObject({company_id: f.companyId, direction: 'outbound', message_family: 'PRODAT',
    message_code: 'Z03', switch_request_id: f.switchId})
  expect(f.originalZ03.message_sent_at).toBeTruthy()
  expect(sc037Sql(`SELECT jsonb_build_object('sealed',immutable_payload_hash,'physical',encode(sha256(convert_to(raw_payload,'UTF8')),'hex'))
    FROM public.ediel_messages WHERE id=${literal(f.originalZ03.id)} AND company_id=${literal(f.companyId)}`)).toEqual({
    sealed: hash(f.originalZ03.raw_payload!), physical: hash(f.originalZ03.raw_payload!),
  })
  return f
}

function sc037Request(f: Sc037Fixture): Sc037Request {
  return sc037Sql<Sc037Request>(`SELECT to_jsonb(s) FROM public.supplier_switch_requests s
    WHERE s.id=${literal(f.switchId)} AND s.company_id=${literal(f.companyId)}`)
}
function sc037Protected(f: Sc037Fixture) {
  return sc037Sql(`SELECT jsonb_build_object(
    'request',(SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE id=${literal(f.switchId)} AND company_id=${literal(f.companyId)}),
    'otherRequests',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.supplier_switch_requests s WHERE company_id=${literal(f.companyId)} AND id<>${literal(f.switchId)}),
    'periods',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.customer_supply_periods s WHERE company_id=${literal(f.companyId)}),
    'contracts',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM public.customer_contracts c WHERE company_id=${literal(f.companyId)}))`)
}
function sc037Effects(f: Sc037Fixture) {
  return sc037Sql(`SELECT jsonb_build_object(
    'messages',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]') FROM public.ediel_messages m WHERE company_id=${literal(f.companyId)}),
    'messageEvents',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM public.ediel_message_events e WHERE company_id=${literal(f.companyId)}),
    'switchEvents',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM public.supplier_switch_events e WHERE company_id=${literal(f.companyId)}),
    'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') FROM public.ediel_outbox o WHERE company_id=${literal(f.companyId)}),
    'attempts',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM gridex_ediel_transport.attempts a WHERE company_id=${literal(f.companyId)}))`)
}
function sc037Incoming(f: Sc037Fixture, action: '1' | '4' = '4'): string {
  const source = EdifactEnvelopeCodec.decode(f.originalZ03.raw_payload)
  expect(source.sender).toBe(f.sender); expect(source.receiver).toBe(f.receiver)
  expect(source.interchangeReference).toBeTruthy()
  const reference = randomUUID().replaceAll('-', '').slice(0, 14)
  // Prospective external wire input. The source reference/party composites
  // come from the actual sent original, not from mutable switch metadata.
  return EdifactEnvelopeCodec.encode({sender: source.receiver!, receiver: source.sender!,
    senderQualifier: source.receiverQualifier, receiverQualifier: source.senderQualifier,
    senderSubAddress: source.receiverSubAddress, receiverSubAddress: source.senderSubAddress,
    applicationReference: source.applicationReference, acknowledgementRequest: false,
    environment: 'test', interchangeReference: reference,
    messages: [{messageReference: reference, messageTypeToken: 'CONTRL:2:2:UN:EDIEL2', businessSegments: [
      `UCI+${source.interchangeReference}+${[source.sender, source.senderQualifier, source.senderSubAddress].map(x => x ?? '').join(':').replace(/:+$/, '')}+${[source.receiver, source.receiverQualifier, source.receiverSubAddress].map(x => x ?? '').join(':').replace(/:+$/, '')}+${action}`,
    ]}]})
}
async function sc037Mail(f: Sc037Fixture, raw = sc037Incoming(f)) {
  const mail = await seedOriginalMailboxNative(sc037Sql, literal, {companyId: f.companyId, environment: 'test', raw, smtpFrom: sc037Smtp})
  const outboundMatch = await matchOutboundRequestForInbound({companyId: f.companyId, parsed: mail.parsed,
    inboundEmailMessageId: mail.inboundEmailMessageId, parseResultId: mail.parseResultId})
  const meteringPointMatch = await matchMeteringPointForInbound({companyId: f.companyId, parsed: mail.parsed})
  expect(outboundMatch.status, 'actual physical ACK must correlate before the tested entrypoint').toBe('matched')
  return {companyId: f.companyId, environment: 'test', actorUserId: f.actorUserId,
    inboundEmailMessageId: mail.inboundEmailMessageId, parseResultId: mail.parseResultId, parsed: mail.parsed,
    outboundMatch, meteringPointMatch}
}
type Sc037Mail = Awaited<ReturnType<typeof sc037Mail>>
function sc037Ack(f: Sc037Fixture, mail: Sc037Mail): EdielMessageRow {
  const ack = sc037Sql<EdielMessageRow>(`SELECT to_jsonb(m) FROM public.ediel_messages m
    WHERE company_id=${literal(f.companyId)} AND environment='test' AND direction='inbound'
      AND inbound_email_message_id=${literal(mail.inboundEmailMessageId)} AND message_family='CONTRL'`)
  expect(ack).toMatchObject({company_id: f.companyId, direction: 'inbound', environment: 'test',
    raw_payload: mail.parsed.rawPayload, inbound_email_message_id: mail.inboundEmailMessageId})
  return ack
}
async function sc037Create(f: Sc037Fixture, mail: Sc037Mail): Promise<EdielMessageRow> {
  const id = await createInboundEdielMessage(mail)
  expect(id).toBeTruthy()
  const ack = sc037Ack(f, mail)
  expect(ack.id).toBe(id)
  const reception = await readInboundReceptionRequest({companyId: f.companyId, actorUserId: f.actorUserId,
    messageId: ack.id, inboundEmailMessageId: mail.inboundEmailMessageId})
  expect(reception).toMatchObject({classification: 'first_reception', parseResultId: mail.parseResultId,
    canonicalPayloadHash: hash(mail.parsed.rawPayload), receivedPayloadHash: hash(mail.parsed.rawPayload), businessEffectAuthorized: false})
  return ack
}
async function sc037Run(entry: Sc037Entry, f: Sc037Fixture, mail: Sc037Mail) {
  if (entry === 'flow') {
    const ack = await sc037Create(f, mail)
    const result = await processInboundAckMessage({actorUserId: f.actorUserId, message: ack})
    expect(result).toMatchObject({outcome: 'negative', wholeSourceRejected: true, sourceAccepted: false, switchRequestId: f.switchId})
  } else if (entry === 'canonical_mail') {
    expect(await applyCanonicalInboundAckStatusUpdate(mail)).toMatchObject({status: 'manual_review', matchStatus: 'negative_contrl'})
  } else await applySafeInboundStatusUpdate(mail)
  const ack = sc037Ack(f, mail)
  const receipt = await readCommittedInboundAck({actorUserId: f.actorUserId, message: ack})
  expect(receipt).toMatchObject({kind: 'exact_receipt', sourceMessageId: f.originalZ03.id,
    result: {outcome: 'negative', wholeSourceRejected: true, sourceAccepted: false}})
  return ack
}

// This composes the already-public source-owner fixture lane. It never inserts
// private confirmations/receipts or patches clocks/periods to impersonate one.
async function sc037Confirm(f: Sc037Fixture) {
  const owner = viaOriginalCalendar(ownerSourceWithInstallationStatus, nativeCalendarShiftDays())
  const source = owner('Z12', {readingDeclarations: true, sourceCodes: {installationStatus: 'Z12', settlementMethod: 'Z32'}})
  const business = tokenizeEdifact(source.raw_payload).segments.filter(s => !['UNA', 'UNB', 'UNH', 'UNT', 'UNZ'].includes(s.tag))
    .map(s => s.raw.replaceAll('735123456789012345', f.external)
      .replaceAll('NAD+Z02+11111:160:SVK', `NAD+Z02+${f.brpEdielId}:160:SVK`)
      .replaceAll('NAD+Z02+54321:160:SVK', `NAD+Z02+${f.brpEdielId}:160:SVK`)
      .replaceAll('12345:160:SVK', `${f.receiver}:160:SVK`).replaceAll('54321:160:SVK', `${f.sender}:160:SVK`)
      .replaceAll('RFF+LI:CASE-1', `RFF+LI:${f.caseReference}`).replaceAll('RFF+Z05:NET-1', `RFF+Z05:${f.gridAreaCode}`)
      .replaceAll('RFF+Z05:NET\'', `RFF+Z05:${f.gridAreaCode}'`)
      .replaceAll('NAD+UD+CUSTOMER-1::89', `NAD+UD+${f.customerIdentity.id}:${f.customerIdentity.qualifier}:${f.customerIdentity.agency}`))
  const ref = randomUUID().replaceAll('-', '').slice(0, 14)
  const raw = EdifactEnvelopeCodec.encode({sender: f.receiver, receiver: f.sender, senderQualifier: '14', receiverQualifier: '14',
    applicationReference: '23-DDQ-PRODAT', acknowledgementRequest: true, environment: 'test', interchangeReference: ref,
    messages: [{messageReference: ref, messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: business}]})
  const mail = await seedOriginalMailboxNative(sc037Sql, literal, {companyId: f.companyId, environment: 'test', raw, smtpFrom: sc037Smtp})
  const outboundMatch = await matchOutboundRequestForInbound({companyId: f.companyId, parsed: mail.parsed,
    inboundEmailMessageId: mail.inboundEmailMessageId, parseResultId: mail.parseResultId})
  const meteringPointMatch = await matchMeteringPointForInbound({companyId: f.companyId, parsed: mail.parsed})
  const id = await createInboundEdielMessage({...mail, companyId: f.companyId, environment: 'test', actorUserId: f.actorUserId, outboundMatch, meteringPointMatch})
  expect(id).toBeTruthy()
  const original = sc037Sql<EdielMessageRow>(`SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(id)} AND company_id=${literal(f.companyId)}`)
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(original, {actorUserId: f.actorUserId})
  expect([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision], JSON.stringify(decision.issues)).toEqual(['accepted', 'accepted', 'accepted'])
  expect(readReceivedCanonicalProdatApplicationObjects(decision, original)).toMatchObject({headerDecision: 'accepted', objects: [{applicationDecision: 'accepted', reasonCodes: []}]})
  const ledger = await recordReceivedSourceValidation({original, validated: original, resolvedCompanyId: f.companyId, decision})
  expect(ledger).toMatchObject({status: 'recorded'})
  await captureFreshEdielSourceRulePackEvidence(f.companyId, original.id)
  // This PRODAT-only session belongs solely to this genuine PRODAT Z04. It is
  // never reused as an ACK issuer; incoming ACK admission stays in the flow.
  const session = createReceivedSourceOwnerSession(ledger)
  expect(session).not.toBeNull()
  expect(await applyInboundBusinessStateMachine({message: original, actorUserId: f.actorUserId,
    matchedSwitchRequestId: f.switchId, onSourceSwitchCommitted: session!.onSwitchCommitted})).toMatchObject({outcome: 'supplier_switch_accepted'})
  expect(await session!.finish()).toMatchObject({status: 'recorded', sourceDisposition: 'accepted'})
  expect(sc037Request(f)).toMatchObject({status: 'accepted', inbound_z04_message_id: original.id})
  expect(sc037Sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.normal_switch_confirmations
    WHERE company_id=${literal(f.companyId)} AND switch_id=${literal(f.switchId)} AND source_message_id=${literal(original.id)}`)).toBe(1)
}

for (const entry of ['flow', 'canonical_mail', 'safe_mail'] as const) {
  it(`SC037 ${entry} applies a genuine admitted negative to its own pending switch exactly once`, async () => {
    const f = await sc037Seed(), mail = await sc037Mail(f), before = sc037Protected(f) as {periods: unknown; contracts: unknown; otherRequests: unknown}
    const ack = await sc037Run(entry, f, mail)
    const request = sc037Request(f)
    expect(request).toMatchObject({status: entry === 'flow' ? 'failed' : 'rejected', updated_by: f.actorUserId, outbound_z03_message_id: f.originalZ03.id})
    expect(request.failure_reason).toBeTruthy(); expect(request.failed_at).toBeTruthy()
    const after = sc037Protected(f) as typeof before
    expect(after.periods).toEqual(before.periods); expect(after.contracts).toEqual(before.contracts); expect(after.otherRequests).toEqual(before.otherRequests)
    // Replay the same genuine mail/immutable ACK: reconcile through the real
    // committed-reader/kernel without another failure event, task or write.
    const frozen = {protected: sc037Protected(f), effects: sc037Effects(f)}
    expect(await sc037Transition(f, ack, sc037Request(f))).toMatchObject({disposition: 'already_terminal', changed: false})
    expect({protected: sc037Protected(f), effects: sc037Effects(f)}).toEqual(frozen)
    await sc037Run(entry, f, mail)
    expect({protected: sc037Protected(f), effects: sc037Effects(f)}).toEqual(frozen)
    const receipt = await readCommittedInboundAck({actorUserId: f.actorUserId, message: sc037Ack(f, mail)})
    expect(receipt).toMatchObject({kind: 'exact_receipt', sourceMessageId: f.originalZ03.id})
    expect(ack.id).toBe(sc037Ack(f, mail).id)
  }, 60000)

  it(`SC037 ${entry} preserves the complete genuinely confirmed switch and supply state after a late negative`, async () => {
    const f = await sc037Seed()
    await sc037Confirm(f)
    const before = sc037Protected(f), mail = await sc037Mail(f)
    const ack = await sc037Run(entry, f, mail)
    expect(sc037Protected(f)).toEqual(before)
    const frozen = {protected: sc037Protected(f), effects: sc037Effects(f)}
    expect(await sc037Transition(f, ack, sc037Request(f))).toMatchObject({disposition: 'preserved_confirmation', changed: false})
    expect({protected: sc037Protected(f), effects: sc037Effects(f)}).toEqual(frozen)
    await sc037Run(entry, f, mail)
    expect({protected: sc037Protected(f), effects: sc037Effects(f)}).toEqual(frozen)
  }, 60000)
}

async function sc037AdmitWithoutProjection(f: Sc037Fixture, mail: Sc037Mail) {
  const ack = await sc037Create(f, mail)
  expect(await readCommittedInboundAck({actorUserId: f.actorUserId, message: ack})).toBeNull()
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(ack, {actorUserId: f.actorUserId})
  const ledger = await recordReceivedSourceValidation({original: ack, validated: ack, resolvedCompanyId: f.companyId, decision})
  expect(ledger).toMatchObject({status: 'recorded'})
  expect([decision.syntaxDecision, decision.applicationDecision]).toEqual(['accepted', 'accepted'])
  const applied = await supabaseService.rpc('gridex_apply_inbound_ack_source_v1', {p_company_id: f.companyId,
    p_environment: 'test', p_ack_message_id: ack.id, p_source_message_id: f.originalZ03.id, p_actor_user_id: f.actorUserId})
  expect(applied.error).toBeNull()
  expect(await readCommittedInboundAck({actorUserId: f.actorUserId, message: ack})).toMatchObject({kind: 'exact_receipt', result: {outcome: 'negative', wholeSourceRejected: true, sourceAccepted: false}})
  return ack
}
function sc037Transition(f: Sc037Fixture, ack: EdielMessageRow, expectedRequest: Sc037Request) {
  return applyInboundAckSwitchTransition({companyId: f.companyId, environment: 'test', actorUserId: f.actorUserId,
    ackMessageId: ack.id, ackPayloadHash: hash(ack.raw_payload!), sourceMessageId: f.originalZ03.id,
    sourcePayloadHash: hash(f.originalZ03.raw_payload!), switchRequestId: f.switchId, negativeStatus: 'rejected', expectedRequest})
}

it('SC037 real PG rejects a stale complete CAS without fallback or effects', async () => {
  const f = await sc037Seed(), mail = await sc037Mail(f), ack = await sc037AdmitWithoutProjection(f, mail), preimage = sc037Request(f)
  // A concurrent public diagnostic edit inhibits this stale CAS. It cannot
  // grant authority; no original/receipt/period timestamp is rewritten.
  sc037Sql(`UPDATE public.supplier_switch_requests SET updated_at=clock_timestamp() WHERE id=${literal(f.switchId)} AND company_id=${literal(f.companyId)}`)
  expect(sc037Request(f).updated_at).not.toEqual(preimage.updated_at)
  const before = {protected: sc037Protected(f), effects: sc037Effects(f)}
  expect(await sc037Transition(f, ack, preimage)).toMatchObject({disposition: 'stale_preimage', changed: false})
  expect({protected: sc037Protected(f), effects: sc037Effects(f)}).toEqual(before)
}, 60000)

it('SC037 real PG refuses a blocked current recipient without a direct fallback', async () => {
  const f = await sc037Seed(), ack = await sc037AdmitWithoutProjection(f, await sc037Mail(f))
  // Ordinary mutable public inhibitor only; no private source proof is made.
  sc037Sql(`UPDATE public.supplier_switch_requests SET lifecycle_blocked=true WHERE id=${literal(f.switchId)} AND company_id=${literal(f.companyId)}`)
  const before = {protected: sc037Protected(f), effects: sc037Effects(f)}
  expect(await sc037Transition(f, ack, sc037Request(f))).toMatchObject({disposition: 'not_applicable', changed: false})
  expect({protected: sc037Protected(f), effects: sc037Effects(f)}).toEqual(before)
}, 60000)

for (const entry of ['canonical_mail', 'safe_mail'] as const) {
  it(`SC037 ${entry} rejects actorless input before any source or protected-state write`, async () => {
    const f = await sc037Seed(), mail = await sc037Mail(f), before = {protected: sc037Protected(f), effects: sc037Effects(f)}
    const actorless = {...mail, actorUserId: undefined}
    await expect(entry === 'canonical_mail' ? applyCanonicalInboundAckStatusUpdate(actorless) : applySafeInboundStatusUpdate(actorless)).rejects.toThrow('ack_current_mail_scope_required')
    expect({protected: sc037Protected(f), effects: sc037Effects(f)}).toEqual(before)
  }, 60000)

  it(`SC037 ${entry} rejects the actual actor after current membership revocation before source birth`, async () => {
    const f = await sc037Seed(), mail = await sc037Mail(f)
    // The normal fixture retains a separate guardian admin. Revoking this
    // acting member is a real current authorization change, never a fake actor.
    sc037Sql(`UPDATE public.company_memberships SET is_active=false WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.actorUserId)}`)
    const before = {protected: sc037Protected(f), effects: sc037Effects(f)}
    await expect(entry === 'canonical_mail' ? applyCanonicalInboundAckStatusUpdate(mail) : applySafeInboundStatusUpdate(mail)).rejects.toThrow()
    expect({protected: sc037Protected(f), effects: sc037Effects(f)}).toEqual(before)
  }, 60000)

  it(`SC037 ${entry} holds an identical new retained mail instead of granting a second effect`, async () => {
    const f = await sc037Seed(), first = await sc037Mail(f), ack = await sc037Run(entry, f, first)
    const before = {protected: sc037Protected(f), effects: sc037Effects(f)}, duplicate = await sc037Mail(f, first.parsed.rawPayload)
    if (entry === 'canonical_mail') {
      expect(await applyCanonicalInboundAckStatusUpdate(duplicate)).toMatchObject({status: 'manual_review',
        matchStatus: 'authentic_duplicate_transport_response_policy_required', reception: {classification: 'protocol_duplicate', status: 'held', businessEffectAuthorized: false}})
    } else {
      await applySafeInboundStatusUpdate(duplicate)
      expect(sc037Sql(`SELECT jsonb_build_object('processing_status',processing_status,'match_status',match_status,'error_message',error_message)
        FROM public.inbound_email_messages WHERE id=${literal(duplicate.inboundEmailMessageId)} AND company_id=${literal(f.companyId)}`)).toMatchObject({
        processing_status: 'manual_review', match_status: 'protocol_duplicate', error_message: 'authentic_duplicate_transport_response_policy_required',
      })
    }
    const held = await readInboundReceptionRequest({companyId: f.companyId, actorUserId: f.actorUserId,
      messageId: ack.id, inboundEmailMessageId: duplicate.inboundEmailMessageId})
    expect(held).toMatchObject({classification: 'protocol_duplicate', status: 'held', businessEffectAuthorized: false,
      canonicalPayloadHash: hash(first.parsed.rawPayload), receivedPayloadHash: hash(first.parsed.rawPayload)})
    expect(held!.responseRequestId).toBeTruthy()
    expect({protected: sc037Protected(f), effects: sc037Effects(f)}).toEqual(before)
  }, 60000)
}
