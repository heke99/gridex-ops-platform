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
