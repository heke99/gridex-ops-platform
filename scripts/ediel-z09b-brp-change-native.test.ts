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
async function brpChangeEvent(f: Fixture, options: { effectiveAt?: string } = {}) {
  // One calendar month notice (fixed UTC+1) plus margin, inside the open period.
  const effectiveAt = options.effectiveAt ?? new Date(Date.parse(`${f.requestedStartDate}T00:00:00+01:00`) + 40 * 86_400_000).toISOString()
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
      // The grid owner's negative APERAK on the one object, the same qualified ERC 40 / 109 application error as P-08.
      applicationErrors: outcome === 'negative' ? [{ ercCode: '40', fieldCode: '109', text: PRODAT_APERAK_APPLICATION_TEXTS['109'],
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

it('AT-Z09B: APERAK before the required CONTRL plus a status-only PATCH confirms nothing; the genuine later CONTRL confirms once', async () => {
  const { f, sent } = await chain()
  await acknowledge(f, sent, 'APERAK')
  // Review I-760-A-01: only the tenant-writable status is forced to acknowledged before the required CONTRL arrives.
  sql(`UPDATE public.ediel_messages SET status='acknowledged' WHERE id=${literal(sent.original.id)} AND company_id=${literal(f.companyId)}`)
  expect(confirmations(sent.eventId)).toEqual([])
  expect(version(f, sent.eventId)).toMatchObject({ status: 'source_declared', confirmationMessageId: null })
  await acknowledge(f, sent, 'CONTRL')
  expect(confirmations(sent.eventId)).toEqual([{ event: sent.eventId, company: f.companyId, environment: 'test', message: sent.original.id }])
  expect(version(f, sent.eventId)).toMatchObject({ status: 'aperak_confirmed', confirmationMessageId: sent.original.id })
}, 900_000)

/** DECLARED SYNTHETIC external registry input, as in the normal fixture. Only
 * actor/identifier/role and registry ground are declared here; qualified supply,
 * BRP versions, originals, validations and ACK authority use their real owners. */
function distinctBrpRegistry(f: Fixture) {
  const identity = sql<{ brpActorId: string; brpEdielId: string }>(`BEGIN;
    SELECT pg_advisory_xact_lock(hashtextextended('native_outbound_dispatch_actor_identifier',0));
    WITH available AS (SELECT candidate::text value FROM generate_series(90000,98999) candidate
      WHERE NOT EXISTS(SELECT FROM public.platform_actor_identifiers WHERE lower(identifier_type) IN('edielid','ediel_id') AND identifier_value=candidate::text)
      AND NOT EXISTS(SELECT FROM public.tenant_actor_identifiers WHERE lower(identifier_type) IN('edielid','ediel_id') AND identifier_value=candidate::text)
      ORDER BY candidate LIMIT 1),
    actor AS (INSERT INTO public.platform_market_actors(id,name,status,match_status,visible_to_tenants)
      SELECT gen_random_uuid(),'SYNTHETIC dated-history BRP','active','verified',true FROM available RETURNING id),
    identity AS (INSERT INTO public.platform_actor_identifiers(actor_id,identifier_type,identifier_value,is_verified)
      SELECT actor.id,'EdielId',available.value,true FROM actor CROSS JOIN available RETURNING actor_id,identifier_value)
    SELECT jsonb_build_object('brpActorId',actor_id,'brpEdielId',identifier_value) FROM identity;COMMIT;`)
  expect(identity).toEqual({ brpActorId: expect.any(String), brpEdielId: expect.any(String) })
  expect(identity.brpEdielId).not.toBe(f.brpEdielId)
  const groundId = randomUUID(), source = 'SYNTHETIC dated-history BRP registry ' + groundId
  sql(`INSERT INTO public.platform_actor_roles(actor_id,actor_role,is_active) VALUES(${literal(identity.brpActorId)},'balance_responsible',true);
    INSERT INTO gridex_brp_changes.registry_grounds(id,company_id,environment,dso_actor_id,brp_actor_id,dso_ediel_id,brp_ediel_id,grid_area_code,
      registry_version,source_reference,source_sha256,registry_snapshot,approved_by,approved_at,valid_from)
    VALUES(${literal(groundId)},${literal(f.companyId)},'test',${literal(f.marketActorId)},${literal(identity.brpActorId)},${literal(f.receiver)},${literal(identity.brpEdielId)},${literal(f.gridAreaCode)},
      ${literal('SYNTHETIC-' + groundId)},${literal(source)},${literal(hash(source))},gridex_brp_changes.registry_snapshot_v1(${literal(f.marketActorId)},${literal(identity.brpActorId)}),
      ${literal(f.actorUserId)},clock_timestamp(),'2026-01-01T00:00:00Z')`)
  expect(sql(`SELECT to_jsonb(registry_snapshot=gridex_brp_changes.registry_snapshot_v1(dso_actor_id,brp_actor_id))
    FROM gridex_brp_changes.registry_grounds WHERE id=${literal(groundId)} AND company_id=${literal(f.companyId)}`)).toBe(true)
  return identity
}

type BrpHistoryVersion = {
  eventId: string; effectiveAt: string; effectiveUntil: string | null; brpActorId: string; brpEdielId: string;
  sourceMessageId: string; sourcePayloadHash: string; status: 'source_declared' | 'aperak_confirmed'; confirmedAt: string | null;
  confirmationMessageId: string | null; sourceRevoked: boolean; marketActivationProven: boolean
}
const history = (f: Fixture) => sql<{ companyId: string; supplyPeriodId: string; versions: BrpHistoryVersion[]; marketActivationProven: boolean }>(
  `SELECT public.ediel_brp_responsibility_history_v1(${literal(f.companyId)},${literal(f.periodId)},${literal(f.actorUserId)})`)
const historyExpected = (f: Fixture, versions: BrpHistoryVersion[]) => ({ companyId: f.companyId, supplyPeriodId: f.periodId, versions, marketActivationProven: false })
const declaredVersion = (f: Fixture, sent: Sent, brpActorId: string, effectiveAt: string): BrpHistoryVersion => ({
  eventId: sent.eventId, effectiveAt, effectiveUntil: null, brpActorId, brpEdielId: f.brpEdielId,
  sourceMessageId: sent.original.id, sourcePayloadHash: hash(sent.original.raw_payload!), status: 'source_declared',
  confirmedAt: null, confirmationMessageId: null, sourceRevoked: false, marketActivationProven: false,
})
function confirmedVersion(f: Fixture, sent: Sent, declared: BrpHistoryVersion): BrpHistoryVersion {
  const confirmation = sql<{ event: string; company: string; environment: string; message: string; at: string }>(`SELECT jsonb_build_object(
    'event',event_id,'company',company_id,'environment',environment,'message',message_id,'at',confirmed_at)
    FROM gridex_brp_changes.confirmations WHERE event_id=${literal(sent.eventId)}`)
  expect(confirmation).toEqual({ event: sent.eventId, company: f.companyId, environment: 'test', message: sent.original.id, at: expect.any(String) })
  expect(Number.isFinite(Date.parse(confirmation.at))).toBe(true)
  return { ...declared, status: 'aperak_confirmed', confirmedAt: confirmation.at, confirmationMessageId: sent.original.id }
}

/** Whole persisted original and authority rows, retained across later changes. */
const brpEvidence = (sent: Sent) => sql(`SELECT jsonb_build_object(
  'original',(SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(sent.original.id)}),
  'event',(SELECT to_jsonb(e) FROM gridex_brp_changes.events e WHERE id=${literal(sent.eventId)}),
  'origin',(SELECT to_jsonb(o) FROM gridex_brp_changes.origins o WHERE event_id=${literal(sent.eventId)}),
  'version',(SELECT to_jsonb(v) FROM gridex_brp_changes.period_versions v WHERE event_id=${literal(sent.eventId)}),
  'confirmation',(SELECT to_jsonb(c) FROM gridex_brp_changes.confirmations c WHERE event_id=${literal(sent.eventId)}),
  'correlations',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.ack_message_id),'[]') FROM gridex_ack_authority.source_correlations c WHERE source_message_id=${literal(sent.original.id)}),
  'outcomes',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.ack_family,o.ack_scope,o.source_reference),'[]') FROM gridex_ack_authority.scope_outcomes o WHERE source_message_id=${literal(sent.original.id)}),
  'receivedAcks',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]') FROM public.ediel_messages m
    JOIN gridex_ack_authority.source_correlations c ON c.ack_message_id=m.id WHERE c.source_message_id=${literal(sent.original.id)}))`)
function positiveAckBindings(f: Fixture, sent: Sent, contrl: EdielMessageRow, aperak: EdielMessageRow) {
  expect(contrl.id).not.toBe(aperak.id)
  expect(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('ack',ack_message_id,'original',source_message_id,'company',company_id,'environment',environment,
    'family',ack_family,'outcome',ack_outcome,'originalHash',source_payload_hash,'ackHash',ack_payload_hash) ORDER BY ack_family),'[]')
    FROM gridex_ack_authority.source_correlations WHERE source_message_id=${literal(sent.original.id)}`)).toEqual([
    { ack: aperak.id, original: sent.original.id, company: f.companyId, environment: 'test', family: 'APERAK', outcome: 'positive', originalHash: hash(sent.original.raw_payload!), ackHash: hash(aperak.raw_payload!) },
    { ack: contrl.id, original: sent.original.id, company: f.companyId, environment: 'test', family: 'CONTRL', outcome: 'positive', originalHash: hash(sent.original.raw_payload!), ackHash: hash(contrl.raw_payload!) },
  ])
  expect(sql(`SELECT to_jsonb(immutable_payload_hash) FROM public.ediel_messages WHERE id=${literal(sent.original.id)}`)).toBe(hash(sent.original.raw_payload!))
  appliedAperak(sent.original.id, 'positive')
}
const businessGraph = (f: Fixture) => sql(`SELECT jsonb_build_object(
  'customer',(SELECT to_jsonb(c) FROM public.customers c WHERE id=${literal(f.customerId)} AND company_id=${literal(f.companyId)}),
  'site',(SELECT to_jsonb(s) FROM public.customer_sites s WHERE id=${literal(f.siteId)} AND company_id=${literal(f.companyId)}),
  'point',(SELECT to_jsonb(p) FROM public.metering_points p WHERE id=${literal(f.pointId)} AND company_id=${literal(f.companyId)}),
  'contract',(SELECT to_jsonb(c) FROM public.customer_contracts c WHERE id=${literal(f.contractId)} AND company_id=${literal(f.companyId)}),
  'switch',(SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE id=${literal(f.switchId)} AND company_id=${literal(f.companyId)}),
  'period',(SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE id=${literal(f.periodId)} AND company_id=${literal(f.companyId)}),
  'originalZ03',(SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(f.originalZ03.id)}),
  'receivedZ04',(SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(f.consumptionSourceId)}))`)
const globalBrpSettings = (f: Fixture) => sql(`SELECT jsonb_build_object(
  'brp',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.ediel_brp_settings s WHERE company_id=${literal(f.companyId)}),
  'actor',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.ediel_actor_settings s WHERE company_id=${literal(f.companyId)}))`)

it('AT-Z09B: successive distinct dated BRPs retain the older original and confirmation without changing a populated same-company sibling', async () => {
  const f = await createProductionReceiptNativeFixture(externalTransport(), { sameCompanyContrast: true })
  expect(f.sameCompanyContrast).not.toBeNull()
  if (!f.sameCompanyContrast) throw new Error('populated_same_company_contrast_required')
  const sibling = { ...f, ...f.sameCompanyContrast }
  expect(sibling.companyId).toBe(f.companyId)
  for (const key of ['customerId', 'siteId', 'pointId', 'contractId', 'switchId', 'periodId', 'consumptionSourceId'] as const) expect(sibling[key]).not.toBe(f[key])
  expect(sql(`SELECT coalesce(jsonb_agg(market_end_at ORDER BY id),'[]') FROM public.customer_supply_periods
    WHERE company_id=${literal(f.companyId)} AND id IN(${literal(f.periodId)},${literal(sibling.periodId)})`)).toEqual([null, null])
  const route = masterdataRoute(f), settingsBefore = globalBrpSettings(f)
  const initialBrpActors = sql<string[]>(`SELECT jsonb_agg(brp_actor_id) FROM gridex_brp_changes.registry_grounds WHERE company_id=${literal(f.companyId)}
    AND environment='test' AND dso_ediel_id=${literal(f.receiver)} AND brp_ediel_id=${literal(f.brpEdielId)} AND grid_area_code=${literal(f.gridAreaCode)}`)
  expect(initialBrpActors).toHaveLength(1)
  const siblingIdentity = distinctBrpRegistry(f), secondIdentity = distinctBrpRegistry(f)
  expect(new Set([f.brpEdielId, siblingIdentity.brpEdielId, secondIdentity.brpEdielId]).size).toBe(3)
  expect(new Set([initialBrpActors[0], siblingIdentity.brpActorId, secondIdentity.brpActorId]).size).toBe(3)
  const start = Date.parse(`${f.requestedStartDate}T00:00:00+01:00`)
  const [t1, tMid, t2] = [40, 50, 60].map(days => new Date(start + days * 86_400_000).toISOString())
  expect(Date.parse(t1)).toBeLessThan(Date.parse(tMid)); expect(Date.parse(tMid)).toBeLessThan(Date.parse(t2))
  // Serialize only the input timestamps with PostgreSQL's JSON convention;
  // expected identity, status, source/hash and period scope stay independent.
  const dates = sql<{ first: string; sibling: string; second: string }>(`SELECT jsonb_build_object('first',${literal(t1)}::timestamptz,
    'sibling',${literal(tMid)}::timestamptz,'second',${literal(t2)}::timestamptz)`)
  const wireDate = (at: string) => new Date(Date.parse(at) + 3_600_000).toISOString().slice(0, 16).replace(/\D/g, '')
  const siblingBrp = { ...sibling, brpEdielId: siblingIdentity.brpEdielId }, secondBrp = { ...f, brpEdielId: secondIdentity.brpEdielId }
  const contrast = await sentZ27(siblingBrp, route, await brpChangeEvent(siblingBrp, { effectiveAt: tMid }))
  expect(contrast.original.raw_payload).toContain(`DTM+157:${wireDate(tMid)}:203'`)
  const contrastDeclared = declaredVersion(siblingBrp, contrast, siblingIdentity.brpActorId, dates.sibling)
  expect(history(sibling)).toEqual(historyExpected(sibling, [contrastDeclared]))
  const contrastContrl = await acknowledge(sibling, contrast, 'CONTRL')
  expect(history(sibling)).toEqual(historyExpected(sibling, [contrastDeclared]))
  const contrastAperak = await acknowledge(sibling, contrast, 'APERAK')
  positiveAckBindings(sibling, contrast, contrastContrl.message, contrastAperak.message)
  const contrastConfirmed = confirmedVersion(sibling, contrast, contrastDeclared)
  expect(history(sibling)).toEqual(historyExpected(sibling, [contrastConfirmed]))
  const siblingBefore = { history: history(sibling), graph: businessGraph(sibling), evidence: brpEvidence(contrast) }
  const unchangedSibling = () => {
    expect({ history: history(sibling), graph: businessGraph(sibling), evidence: brpEvidence(contrast) }).toEqual(siblingBefore)
    expect(globalBrpSettings(f)).toEqual(settingsBefore)
  }
  // The contrast is populated before either main-period change, even though
  // its effective date lies between their dates. It cannot end the main v1.
  expect(history(f)).toEqual(historyExpected(f, []))
  unchangedSibling()
  const first = await sentZ27(f, route, await brpChangeEvent(f, { effectiveAt: t1 }))
  expect(first.original.raw_payload).toContain(`DTM+157:${wireDate(t1)}:203'`)
  const firstDeclared = declaredVersion(f, first, initialBrpActors[0], dates.first)
  expect(history(f)).toEqual(historyExpected(f, [firstDeclared]))
  unchangedSibling()
  const firstContrl = await acknowledge(f, first, 'CONTRL')
  expect(history(f)).toEqual(historyExpected(f, [firstDeclared]))
  unchangedSibling()
  const firstAperak = await acknowledge(f, first, 'APERAK')
  positiveAckBindings(f, first, firstContrl.message, firstAperak.message)
  const firstConfirmed = confirmedVersion(f, first, firstDeclared), firstEvidence = brpEvidence(first)
  expect(history(f)).toEqual(historyExpected(f, [firstConfirmed]))
  unchangedSibling()
  const second = await sentZ27(secondBrp, route, await brpChangeEvent(secondBrp, { effectiveAt: t2 }))
  expect(second.original.raw_payload).toContain(`DTM+157:${wireDate(t2)}:203'`)
  expect(new Set([first.eventId, second.eventId, contrast.eventId]).size).toBe(3)
  expect(new Set([first.original.id, second.original.id, contrast.original.id]).size).toBe(3)
  const secondDeclared = declaredVersion(secondBrp, second, secondIdentity.brpActorId, dates.second)
  const firstEnded = { ...firstConfirmed, effectiveUntil: dates.second }
  expect(history(f)).toEqual(historyExpected(f, [firstEnded, secondDeclared]))
  expect(brpEvidence(first)).toEqual(firstEvidence)
  unchangedSibling()
  const secondContrl = await acknowledge(f, second, 'CONTRL')
  expect(history(f)).toEqual(historyExpected(f, [firstEnded, secondDeclared]))
  expect(confirmations(second.eventId)).toEqual([])
  expect(brpEvidence(first)).toEqual(firstEvidence)
  unchangedSibling()
  const secondAperak = await acknowledge(f, second, 'APERAK')
  positiveAckBindings(f, second, secondContrl.message, secondAperak.message)
  expect(new Set([contrastContrl.message.id, contrastAperak.message.id, firstContrl.message.id, firstAperak.message.id, secondContrl.message.id, secondAperak.message.id]).size).toBe(6)
  const secondConfirmed = confirmedVersion(f, second, secondDeclared)
  // Open qualified periods and no later own version: nullable known-latest
  // ends. The sibling's later date cannot truncate or overwrite either scope.
  const finalHistory = historyExpected(f, [firstEnded, secondConfirmed])
  expect(history(f)).toEqual(finalHistory)
  expect(brpEvidence(first)).toEqual(firstEvidence)
  unchangedSibling()
  const secondEvidence = brpEvidence(second)
  await processInboundAckMessage({ actorUserId: f.actorUserId, message: firstAperak.message })
  await processInboundAckMessage({ actorUserId: f.actorUserId, message: secondAperak.message })
  expect(history(f)).toEqual(finalHistory)
  expect(brpEvidence(first)).toEqual(firstEvidence); expect(brpEvidence(second)).toEqual(secondEvidence)
  unchangedSibling()
}, 900_000)
