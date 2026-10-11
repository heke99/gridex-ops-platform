// masterplan: AT-Z09B-SUPPLIER
// Native clean-replay proof of the supplier's own Z09B (BRP change, field 223
// Z27): a dated BRP-change event on a qualified Z03/Z04 consumption period is
// rendered by the actual BRP producer, sent through the actual SMTP owner, and
// the grid owner's CONTRL and APERAK are received through the actual inbound
// mail path and ACK authority. Only the final positive APERAK on that same,
// unchanged original confirms exactly its dated BRP version. The BRP-change
// event row is an explicit SYNTHETIC fixture boundary (there is no approval
// API), never authentic market evidence.
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { createProductionReceiptNativeFixture } from './helpers/ediel-z04d-production-native-fixture'
import { nativeSql as sql, literal } from './helpers/ediel-normal-switch-native-fixture'
import { prepareAndQueueBrpChangeZ09 } from '@/lib/ediel/flows/prodatBrpChange'
import { readBrpChangeSource } from '@/lib/ediel/production/brpChangeSource'
import { assertEdielSmtpReadiness } from '@/lib/ediel/mailReadiness'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport'
import { getEdielMessageById } from '@/lib/ediel/db'
import { seedOriginalMailboxNative } from './helpers/originalMailboxNative'
import { matchOutboundRequestForInbound } from '@/lib/inbound-mail/inboundMatcher'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { recordReceivedSourceValidation } from '@/lib/ediel/core/receivedSourceValidationLedger'
import { processInboundAckMessage } from '@/lib/ediel/flows/inboundAckProcessing'
import { renderContrl2Ediel2 } from '@/lib/ediel/contrlEngine'
import { renderAperakEdiel } from '@/lib/ediel/aperakEngine'
import { PRODAT_APERAK_APPLICATION_TEXTS } from '@/lib/ediel/prodat/prodatAperakText'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import type { EdielMessageRow } from '@/lib/ediel/types'

const smtp = vi.hoisted(() => ({ provider: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: smtp.provider }) } }))
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); smtp.provider.mockReset() })

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
type Fixture = Awaited<ReturnType<typeof createProductionReceiptNativeFixture>>
type Sent = { eventId: string; original: EdielMessageRow }

function externalTransport() {
  for (const [key, value] of Object.entries({ EDIEL_SHARED_MAILBOX_ADDRESS: 'synthetic@example.invalid', EDIEL_APP_DKIM_ENABLED: 'false',
    EDIEL_SMTP_FROM: 'synthetic@example.invalid', EDIEL_SMTP_USER: 'synthetic@example.invalid', EDIEL_SMTP_PASS: 'synthetic-only', EDIEL_EMAIL_PROVIDER: 'strato' })) vi.stubEnv(key, value)
  return (email: string) => smtp.provider.mockResolvedValue({ accepted: [email], rejected: [], messageId: `synthetic-Z09B-${randomUUID()}`, response: '250 synthetic accepted' })
}

/** The supplier's own customer_masterdata route to the same grid owner. */
function masterdataRoute(f: Fixture) {
  const route = randomUUID(), profile = randomUUID(), mail = assertEdielSmtpReadiness()
  sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email)
    VALUES(${literal(route)},${literal(f.companyId)},'Synthetic Z09B BRP change route','customer_masterdata',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid');
   INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,transport_security_mode,mailbox,smtp_host,smtp_port,smtp_to,receiver_email)
    VALUES(${literal(profile)},${literal(f.companyId)},${literal(route)},'Synthetic Z09B BRP change profile','test','edifact','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,true,'unencrypted',${literal(mail.from)},${literal(mail.host)},${mail.port},'recipient@example.invalid','recipient@example.invalid');`)
  return route
}

/** SYNTHETIC dated BRP-change event on the fixture's qualified consumption
 * period, built only from the installed source basis and registry ground. */
async function brpChangeEvent(f: Fixture) {
  // One calendar month notice (fixed UTC+1) plus margin, inside the open period.
  const effectiveAt = new Date(Date.parse(`${f.requestedStartDate}T00:00:00+01:00`) + 40 * 86_400_000).toISOString()
  const basis = sql<{ qualified: boolean; customerId: string; meteringPointId: string; legalActorId: string; sourceMessageId: string; marketStateVersion: number; dsoEdielId: string;
    sourceObjects: { point: string; identityAgency: string; gridArea: string }[] }>(`SELECT gridex_received_sources.supply_period_source_basis_v1(${literal(f.companyId)},${literal(f.periodId)},
      ${literal(effectiveAt)}::timestamptz,${literal(effectiveAt)}::timestamptz+interval '1 minute')`)
  expect(basis, JSON.stringify(basis)).toMatchObject({ qualified: true, dsoEdielId: f.receiver })
  expect(basis.sourceObjects).toHaveLength(1)
  const ground = sql<string[]>(`SELECT coalesce(jsonb_agg(id),'[]') FROM gridex_brp_changes.registry_grounds WHERE company_id=${literal(f.companyId)} AND environment='test'
    AND dso_ediel_id=${literal(f.receiver)} AND brp_ediel_id=${literal(f.brpEdielId)} AND grid_area_code=${literal(f.gridAreaCode)}`)
  expect(ground).toHaveLength(1)
  const id = randomUUID(), object = basis.sourceObjects[0], decision = hash('SYNTHETIC Z09B BRP decision ' + id)
  sql(`INSERT INTO gridex_brp_changes.events(id,company_id,environment,supply_period_id,customer_id,metering_point_id,legal_actor_id,legal_sender_id,point_id,identity_agency,registry_ground_id,
      supply_source_message_id,supply_state_version,effective_at,brp_contract_reference,brp_contract_sha256,brp_contract_version,market_decision_reference,source_reference,source_sha256,source_version,approved_by,approved_at)
    VALUES(${literal(id)},${literal(f.companyId)},'test',${literal(f.periodId)},${literal(basis.customerId)},${literal(basis.meteringPointId)},${literal(basis.legalActorId)},${literal(f.sender)},
      ${literal(object.point)},${literal(object.identityAgency)},${literal(ground[0])},${literal(basis.sourceMessageId)},${basis.marketStateVersion},${literal(effectiveAt)},
      'SYNTHETIC Z09B BRP contract',${literal(decision)},'1','SYNTHETIC Z09B market decision',${literal('SYNTHETIC-Z09B-' + id)},${literal(decision)},'1',${literal(f.actorUserId)},clock_timestamp())`)
  const read = await readBrpChangeSource({ companyId: f.companyId, eventId: id, actorUserId: f.actorUserId })
  expect(read, JSON.stringify(read)).toMatchObject({ status: 'authorized', legalReceiverId: f.receiver, brpEdielId: f.brpEdielId })
  return id
}

/** Render through the actual BRP producer, assert the Z09B wire and its
 * immutable origin binding, then send through the actual SMTP owner. */
async function sentZ27(f: Fixture, route: string, eventId: string): Promise<Sent> {
  const queued = await prepareAndQueueBrpChangeZ09({ companyId: f.companyId, eventId, actorUserId: f.actorUserId, preferredRouteId: route })
  expect(queued, JSON.stringify(queued)).toMatchObject({ status: 'queued' })
  if (queued.status !== 'queued') throw new Error('z09b_queued_required')
  const raw = queued.message.raw_payload!
  expect(EdifactEnvelopeCodec.decode(raw).applicationReference).toBe('23-DDQ-PRODAT')
  expect(raw).toMatch(/BGM\+Z09\+/); expect(raw).toContain("CAV+Z27'"); expect(raw).toContain(`NAD+Z02+${f.brpEdielId}:160:SVK'`)
  expect(raw).toMatch(/DTM\+157:[0-9]{12}:203'/); expect(raw).not.toMatch(/NAD\+UD\+/)
  expect(queued.message).toMatchObject({ direction: 'outbound', message_family: 'PRODAT', message_code: 'Z09', source_operation_id: eventId, company_id: f.companyId, environment: 'test' })
  expect(sql(`SELECT jsonb_build_object('message',message_id,'hash',payload_hash) FROM gridex_brp_changes.origins WHERE event_id=${literal(eventId)}`))
    .toEqual({ message: queued.message.id, hash: hash(raw) })
  smtp.provider.mockResolvedValue({ accepted: ['recipient@example.invalid'], rejected: [], messageId: randomUUID(), response: '250 synthetic accepted' })
  await sendEdielMessageViaSmtp(queued.message, { actorUserId: f.actorUserId })
  const original = (await getEdielMessageById(queued.message.id))!
  expect(original.message_sent_at).toBeTruthy(); expect(original.raw_payload).toBe(raw)
  return { eventId, original }
}

function externalAck(original: EdielMessageRow, family: 'CONTRL' | 'APERAK', outcome: 'positive' | 'negative' = 'positive') {
  const e = EdifactEnvelopeCodec.decode(original.raw_payload!)
  const segments = family === 'CONTRL' ? renderContrl2Ediel2({ source: { rawPayload: original.raw_payload }, outcome: 'positive' }).segments
    : renderAperakEdiel({ source: { id: original.id, messageFamily: 'PRODAT', messageCode: 'Z09', rawPayload: original.raw_payload }, refs: {}, externalReference: randomUUID(), transactionReference: randomUUID(), outcome,
      // The grid owner's negative APERAK on the BRP change date of the one object: ERC 40, field 216.
      applicationErrors: outcome === 'negative' ? [{ ercCode: '40', fieldCode: '216', text: PRODAT_APERAK_APPLICATION_TEXTS['216'],
        referenceQualifier: 'Z07', referenceNumber: /LIN\+1\+\+([0-9]+):/.exec(original.raw_payload!)![1], lineItemReference: /RFF\+LI:([^']+)'/.exec(original.raw_payload!)![1] }] : null }).segments
  return EdifactEnvelopeCodec.encode({ sender: e.receiver!, receiver: e.sender!, senderQualifier: e.receiverQualifier, receiverQualifier: e.senderQualifier, senderSubAddress: e.receiverSubAddress,
    receiverSubAddress: e.senderSubAddress, applicationReference: e.applicationReference, acknowledgementRequest: false, environment: 'test', interchangeReference: randomUUID().replaceAll('-', '').slice(0, 14),
    messages: [{ messageReference: randomUUID().replaceAll('-', '').slice(0, 14), messageTypeToken: family === 'CONTRL' ? 'CONTRL:2:2:UN:EDIEL2' : 'APERAK:D:96A:UN:E2SE6A', businessSegments: segments }] })
}

async function acknowledge(f: Fixture, sent: Sent, family: 'CONTRL' | 'APERAK', outcome: 'positive' | 'negative' = 'positive') {
  const mail = await seedOriginalMailboxNative(sql, literal, { companyId: f.companyId, environment: 'test', raw: externalAck(sent.original, family, outcome), smtpFrom: 'synthetic@example.invalid' })
  const outboundMatch = await matchOutboundRequestForInbound({ companyId: f.companyId, parsed: mail.parsed, inboundEmailMessageId: mail.inboundEmailMessageId, parseResultId: mail.parseResultId })
  const id = await createInboundEdielMessage({ companyId: f.companyId, actorUserId: f.actorUserId, environment: 'test', inboundEmailMessageId: mail.inboundEmailMessageId,
    parseResultId: mail.parseResultId, parsed: mail.parsed, outboundMatch })
  expect(id).toBeTruthy()
  const message = (await getEdielMessageById(id!))!
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(message)
  expect(await recordReceivedSourceValidation({ original: message, validated: message, resolvedCompanyId: f.companyId, decision })).toMatchObject({ status: 'recorded' })
  expect([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision], JSON.stringify(decision.issues)).toEqual(['accepted', 'accepted', 'accepted'])
  const processed = await processInboundAckMessage({ actorUserId: f.actorUserId, message })
  expect(processed).toMatchObject({ outcome, sourceMessage: { id: sent.original.id } })
  return { message, processed }
}

const confirmations = (eventId: string) => sql<{ event: string; company: string; environment: string; message: string }[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object(
  'event',event_id,'company',company_id,'environment',environment,'message',message_id) ORDER BY message_id),'[]') FROM gridex_brp_changes.confirmations WHERE event_id=${literal(eventId)}`)
const version = (f: Fixture, eventId: string) => sql<{ versions: { eventId: string; status: string; confirmationMessageId: string | null; sourceMessageId: string; brpEdielId: string; marketActivationProven: boolean }[] }>(
  `SELECT public.ediel_brp_responsibility_history_v1(${literal(f.companyId)},${literal(f.periodId)},${literal(f.actorUserId)})`).versions.find(v => v.eventId === eventId)
function appliedAperak(original: string, outcome: 'positive' | 'negative') {
  expect(sql(`SELECT jsonb_build_object('aperak',(SELECT aperak_status FROM public.ediel_messages WHERE id=${literal(original)}),
    'outcomes',(SELECT coalesce(jsonb_agg(outcome ORDER BY outcome),'[]') FROM gridex_ack_authority.scope_outcomes WHERE source_message_id=${literal(original)} AND ack_family='APERAK'),
    'correlations',(SELECT count(*) FROM gridex_ack_authority.source_correlations WHERE source_message_id=${literal(original)} AND ack_family='APERAK'))`))
    .toEqual({ aperak: 'received', outcomes: [outcome], correlations: 1 })
}

async function chain() {
  const f = await createProductionReceiptNativeFixture(externalTransport())
  const route = masterdataRoute(f)
  return { f, sent: await sentZ27(f, route, await brpChangeEvent(f)) }
}

it('AT-Z09B: CONTRL alone confirms nothing; the positive APERAK confirms exactly its own dated BRP version once', async () => {
  const { f, sent } = await chain()
  expect(confirmations(sent.eventId)).toEqual([])
  expect(version(f, sent.eventId)).toMatchObject({ status: 'source_declared', confirmationMessageId: null, sourceMessageId: sent.original.id, brpEdielId: f.brpEdielId })
  await acknowledge(f, sent, 'CONTRL')
  expect((await getEdielMessageById(sent.original.id))!).toMatchObject({ contrl_status: 'received', aperak_status: 'pending' })
  expect(confirmations(sent.eventId)).toEqual([])
  const { message } = await acknowledge(f, sent, 'APERAK')
  appliedAperak(sent.original.id, 'positive')
  const confirmed = [{ event: sent.eventId, company: f.companyId, environment: 'test', message: sent.original.id }]
  expect(confirmations(sent.eventId)).toEqual(confirmed)
  expect(version(f, sent.eventId)).toMatchObject({ status: 'aperak_confirmed', confirmationMessageId: sent.original.id, marketActivationProven: false })
  // Replay of the same APERAK changes nothing; the confirmation is immutable.
  await processInboundAckMessage({ actorUserId: f.actorUserId, message })
  expect(confirmations(sent.eventId)).toEqual(confirmed)
  expect(() => sql(`DELETE FROM gridex_brp_changes.confirmations WHERE event_id=${literal(sent.eventId)}`)).toThrow()
  expect(confirmations(sent.eventId)).toEqual(confirmed)
}, 900_000)

it('AT-Z09B: a negative APERAK on the BRP change confirms nothing', async () => {
  const { f, sent } = await chain()
  await acknowledge(f, sent, 'CONTRL')
  await acknowledge(f, sent, 'APERAK', 'negative')
  appliedAperak(sent.original.id, 'negative')
  expect(confirmations(sent.eventId)).toEqual([])
  expect(version(f, sent.eventId)).toMatchObject({ status: 'source_declared', confirmationMessageId: null })
}, 900_000)

it('AT-Z09B: a mutated sent Z09B original is refused by the sealed-payload guard and never confirmed', async () => {
  const { f, sent } = await chain()
  const sealed = () => sql<{ raw: string; hash: string }>(`SELECT jsonb_build_object('raw',raw_payload,'hash',immutable_payload_hash) FROM public.ediel_messages WHERE id=${literal(sent.original.id)}`)
  const before = sealed()
  expect(() => sql(`UPDATE public.ediel_messages SET raw_payload=replace(raw_payload,'CAV+Z27','CAV+Z28') WHERE id=${literal(sent.original.id)} AND company_id=${literal(f.companyId)}`)).toThrow()
  expect(sealed()).toEqual(before)
  expect(confirmations(sent.eventId)).toEqual([])
}, 900_000)
