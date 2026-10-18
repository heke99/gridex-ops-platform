// AT-Z04C-SUPPLIER prohibited effects on a genuinely received DDQ Z04/Z24.
// Constructed tenant/market/mail inputs and one SMTP provider double; public
// intake, canonical runtime, native owners and ACK producers are real. Untagged
// until this registered producer has a qualified run on an exact head.
// Positive control plus: receiver/sender role revocation, foreign actor,
// raw/direction rewrite, wrong LI/point correlation and per-field omission.
// Each refusal preserves the confirmed own period, switch and original.
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
const smtp = vi.hoisted(() => vi.fn())
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: smtp }) } }))
import { seedNormalSwitchNativeFixture, futureNativeSupplyDate, nativeSql as sql, literal } from './helpers/ediel-normal-switch-native-fixture'
import { seedOriginalMailboxNative } from './helpers/originalMailboxNative'
import { buildCancellationProspectiveZ04 } from './helpers/ediel-cancellation-prospective-source-2ea'
import { CLOSURE_OBJECT } from '../__tests__/helpers/closureWireFixtures'
import { supabaseService } from '@/lib/supabase/service'
import { getEdielMessageById } from '@/lib/ediel/db'
import { assertEdielSmtpReadiness } from '@/lib/ediel/mailReadiness'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { applySupplyMarketSource } from '@/lib/ediel/flows/supplyMarketTransition'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import { matchOutboundRequestForInbound, matchMeteringPointForInbound } from '@/lib/inbound-mail/inboundMatcher'
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { evaluateProdatTransactionReason } from '@/lib/ediel/prodat/prodatTransactionReason'
import { isQualifiedProdatApplicationError } from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import type { EdielMessageRow } from '@/lib/ediel/types'

type Fixture = Awaited<ReturnType<typeof seedNormalSwitchNativeFixture>>
type Period = { id: string; company_id: string; customer_id: string; metering_point_id: string; status: string;
  source_message_id: string; metadata: Record<string, unknown>; market_state_version: number }
afterEach(() => { smtp.mockReset(); vi.unstubAllEnvs() })
function configureSmtp(email = 'recipient@example.invalid') {
  for (const [key, value] of Object.entries({ EDIEL_SHARED_MAILBOX_ADDRESS: 'synthetic@example.invalid',
    EDIEL_APP_DKIM_ENABLED: 'false', EMAIL_PROVIDER: 'resend', EDIEL_SMTP_FROM: 'synthetic@example.invalid',
    EDIEL_SMTP_USER: 'synthetic@example.invalid', EDIEL_SMTP_PASS: 'synthetic-only', EDIEL_EMAIL_PROVIDER: 'strato' })) vi.stubEnv(key, value)
  smtp.mockResolvedValue({ accepted: [email], rejected: [], messageId: randomUUID(), response: '250 synthetic accepted' })
}
async function seed(): Promise<Fixture> {
  configureSmtp()
  const f = await seedNormalSwitchNativeFixture({ requestedStartDate: futureNativeSupplyDate(), provider: configureSmtp })
  const route = randomUUID(), profile = randomUUID(), config = assertEdielSmtpReadiness()
  sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email)
    VALUES(${literal(route)},${literal(f.companyId)},'Synthetic Z04C ACK route','ediel_ack',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid');
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,payload_format,transport_security_mode,smtp_to,receiver_email,mailbox,smtp_host,smtp_port)
    VALUES(${literal(profile)},${literal(f.companyId)},${literal(route)},'Synthetic Z04C ACK profile','test','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,true,'edifact','unencrypted','recipient@example.invalid','recipient@example.invalid',${literal(config.from)},${literal(config.host)},${config.port});`)
  return f
}
function envelope(f: Fixture, source: string) {
  const body = tokenizeEdifact(source).segments.filter(segment => !['UNA', 'UNB', 'UNH', 'UNT', 'UNZ'].includes(segment.tag))
    .map(segment => segment.tag === 'BGM' ? `BGM+Z04+${randomUUID().replaceAll('-', '').slice(0,20)}+9+AB` : segment.raw)
  return EdifactEnvelopeCodec.encode({ sender: f.receiver, receiver: f.sender, senderQualifier: '14', receiverQualifier: '14',
    applicationReference: '23-DDQ-PRODAT', acknowledgementRequest: true, environment: 'test',
    interchangeReference: randomUUID().replaceAll('-', '').slice(0,14), messages: [{ messageReference: randomUUID().replaceAll('-', '').slice(0,14),
      messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: body }] })
}
// The ordinary L confirmation and its exact C share every physical key.
const z04l = (f: Fixture) => buildCancellationProspectiveZ04(f)
const z04c = (f: Fixture, mutate: (wire: string) => string = wire => wire) =>
  envelope(f, mutate(buildCancellationProspectiveZ04(f).replace('CAV+Z22', 'CAV+Z24')))
async function nativePhase<T>(phase: string, run: () => Promise<T>): Promise<T> {
  try { return await run() } catch (cause) { throw new Error('native_z04c_phase:' + phase, { cause }) }
}
async function receiveProdat(f: Fixture, wire: string, subtype: 'L' | 'C') {
  return nativePhase('public_intake_Z04' + subtype, async () => {
    const receivedAt = new Date().toISOString(), config = assertEdielSmtpReadiness()
    const mail = await seedOriginalMailboxNative(sql, literal, { companyId: f.companyId, environment: 'test', raw: wire, receivedAt, smtpFrom: config.from })
    const outboundMatch = await matchOutboundRequestForInbound({ companyId: f.companyId, parsed: mail.parsed,
      inboundEmailMessageId: mail.inboundEmailMessageId, parseResultId: mail.parseResultId })
    const meteringPointMatch = await matchMeteringPointForInbound({ companyId: f.companyId, parsed: mail.parsed })
    const id = await createInboundEdielMessage({ companyId: f.companyId, actorUserId: f.actorUserId, environment: 'test',
      inboundEmailMessageId: mail.inboundEmailMessageId, parseResultId: mail.parseResultId, parsed: mail.parsed, outboundMatch, meteringPointMatch })
    expect(typeof id, 'public_creator_must_return_actual_source').toBe('string')
    const message = await getEdielMessageById(id!)
    expect(message).toMatchObject({ id, company_id: f.companyId, environment: 'test', direction: 'inbound', message_code: 'Z04',
      application_reference: '23-DDQ-PRODAT', raw_payload: wire, rule_profile_key: `PRODAT:Z04:${subtype}:26.A:r3` })
    expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_inbound_receptions.receptions WHERE company_id=${literal(f.companyId)}
      AND source_message_id=${literal(id)} AND classification='first_reception';`)).toBe(1)
    return message!
  })
}
async function process(f: Fixture, source: EdielMessageRow) {
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(source, { actorUserId: f.actorUserId })
  expect([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision], JSON.stringify(decision.issues))
    .toEqual(['accepted', 'accepted', 'accepted'])
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: source.id })
}
const periods = (f: Fixture) => sql<Period[]>(`SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.customer_supply_periods p WHERE company_id=${literal(f.companyId)};`)
const switchState = (f: Fixture) => sql<{ status: string; original: string; li: string; inbound: string | null; completed: string | null }>(`SELECT jsonb_build_object('status',status,'original',outbound_z03_message_id,'li',rff_li_reference,'inbound',inbound_z04_message_id,'completed',completed_at) FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)} AND company_id=${literal(f.companyId)};`)
const original = (f: Fixture) => sql(`SELECT jsonb_build_object('raw',raw_payload,'hash',immutable_payload_hash,'rendered',immutable_rendered_at,
  'archives',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.ediel_message_payloads p WHERE p.ediel_message_id=m.id))
  FROM public.ediel_messages m WHERE id=${literal(f.originalZ03.id)} AND company_id=${literal(f.companyId)};`)
// Every protected own business fact a C could wrongly execute.
const business = (f: Fixture) => ({ periods: periods(f), switch: switchState(f), original: original(f), history: sql(`SELECT jsonb_build_object(
  'transitions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.source_message_id),'[]') FROM gridex_received_sources.supply_source_transitions t WHERE company_id=${literal(f.companyId)}),
  'effects',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM gridex_received_sources.supply_object_effect_receipts t WHERE company_id=${literal(f.companyId)}),
  'partitions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.source_message_id),'[]') FROM gridex_received_sources.supply_object_partitions t WHERE company_id=${literal(f.companyId)}));`) })
const positiveAperaks = (f: Fixture, sourceId: string) => sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND related_message_id=${literal(sourceId)} AND direction='outbound' AND message_family='APERAK' AND ack_outcome='positive';`)
const ownTransitions = (f: Fixture, sourceId: string) => sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.supply_source_transitions WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(sourceId)};`)
async function confirmed(f: Fixture) {
  const confirmation = await receiveProdat(f, z04l(f), 'L'); await process(f, confirmation)
  const actual = periods(f)
  expect(actual, 'native_z04c_confirmed_supply_precondition').toHaveLength(1)
  expect(actual[0]).toMatchObject({ company_id: f.companyId, customer_id: f.customerId, metering_point_id: f.pointId,
    status: 'confirmed_by_grid_owner', source_message_id: confirmation.id })
  return { confirmation, period: actual[0] }
}
// Durable refusal surfaces of one received source: the owner's held object
// partition (validated event), a rolled-back apply, the frozen legal context and
// the own outbound replies. Emitted as a finite observation for the receipt.
type Refusal = { partition: Array<{ disposition: string; reason?: string }> | null; rolledBack: string[];
  context: { status: string; reason: string | null } | null; replies: Array<[string, string]> }
function refusal(f: Fixture, sourceId: string): Refusal {
  const observed = sql<Refusal>(`SELECT jsonb_build_object(
    'partition',(SELECT e.payload->'sourceObjectPartition' FROM public.ediel_message_events e WHERE e.company_id=${literal(f.companyId)}
      AND e.ediel_message_id=${literal(sourceId)} AND e.event_type='validated' AND jsonb_typeof(e.payload->'sourceObjectPartition')='array'
      ORDER BY e.created_at DESC,e.id DESC LIMIT 1),
    'rolledBack',(SELECT coalesce(jsonb_agg(e.payload->>'reason' ORDER BY e.created_at,e.id),'[]') FROM public.ediel_message_events e WHERE e.company_id=${literal(f.companyId)}
      AND e.ediel_message_id=${literal(sourceId)} AND e.payload->>'supplySourceApply'='rolled_back'),
    'context',(SELECT jsonb_build_object('status',r.status,'reason',r.reason) FROM gridex_ediel_inbound_context.receipts r WHERE r.company_id=${literal(f.companyId)} AND r.source_message_id=${literal(sourceId)}),
    'replies',(SELECT coalesce(jsonb_agg(jsonb_build_array(message_family,coalesce(ack_outcome,'none')) ORDER BY message_family,id),'[]') FROM public.ediel_messages
      WHERE company_id=${literal(f.companyId)} AND related_message_id=${literal(sourceId)} AND direction='outbound'));`)
  console.info('Z04C_REFUSAL_OBSERVATION', JSON.stringify(observed))
  return observed
}
function held(f: Fixture, before: ReturnType<typeof business>, sourceId: string,
  expected: { partitionReason?: string; contextReason?: string } = {}) {
  expect(business(f)).toEqual(before)
  expect(ownTransitions(f, sourceId)).toBe(0)
  const observed = refusal(f, sourceId)
  // A valid syntax CONTRL is permitted; no positive business APERAK is, and
  // any business APERAK produced for this source is negative.
  expect(positiveAperaks(f, sourceId)).toBe(0)
  expect(observed.replies.filter(([family, outcome]) => family === 'APERAK' && outcome === 'positive')).toEqual([])
  expect(observed.partition?.filter(entry => entry.disposition === 'applied') ?? []).toEqual([])
  if (expected.partitionReason) expect(observed.partition).toEqual([expect.objectContaining({ disposition: 'held', reason: expected.partitionReason })])
  if (expected.contextReason) expect(observed.context).toEqual({ status: 'held', reason: expected.contextReason })
  return observed
}

describe('actual native received Z04C prohibited effects', () => {
  it('positive control: exact C cancels only the own confirmed future period, replies CONTRL and APERAK, replays idempotently', async () => {
    const f = await seed(), decoy = await seed(), decoyBefore = business(decoy)
    const { confirmation, period } = await confirmed(f)
    const beforeOriginal = original(f)
    const c = await receiveProdat(f, z04c(f), 'C'); await process(f, c)
    expect(periods(f)).toHaveLength(1)
    expect(periods(f)[0]).toMatchObject({ id: period.id, status: 'cancelled', source_message_id: confirmation.id,
      market_state_version: period.market_state_version + 1, metadata: { startCancellationSource: c.id } })
    expect(switchState(f)).toMatchObject({ status: 'cancelled_before_start', original: f.originalZ03.id, li: f.caseReference, inbound: c.id })
    expect(switchState(f).completed).not.toBeNull()
    expect(ownTransitions(f, c.id)).toBe(1)
    const replies = sql<Array<{ family: string; outcome: string; id: string }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('family',message_family,'outcome',ack_outcome,'id',id) ORDER BY message_family),'[]')
      FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND related_message_id=${literal(c.id)} AND direction='outbound';`)
    expect(replies.map(reply => [reply.family, reply.outcome])).toEqual([['APERAK', 'positive'], ['CONTRL', 'positive']])
    for (const reply of replies) {
      await sendEdielMessageViaSmtp((await getEdielMessageById(reply.id))!, { actorUserId: f.actorUserId, smtpMimeMode: 'nodemailer-attachment' })
      expect((await getEdielMessageById(reply.id))?.status).toBe('sent')
    }
    const settled = business(f)
    await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: c.id })
    expect(business(f)).toEqual(settled); expect(positiveAperaks(f, c.id)).toBe(1)
    expect(original(f)).toEqual(beforeOriginal); expect(business(decoy)).toEqual(decoyBefore)
  }, 180000)

  it('a receiver supplier role expired after genuine C reception cannot cancel the confirmed start', async () => {
    const f = await seed(); await confirmed(f)
    const c = await receiveProdat(f, z04c(f), 'C'), before = business(f)
    expect(sql(`WITH changed AS (UPDATE public.tenant_actor_roles SET valid_to=clock_timestamp() WHERE company_id=${literal(f.companyId)} AND actor_id=${literal(f.actorUserId)} AND environment='test' AND role_code='electricity_supplier' AND valid_to IS NULL RETURNING id) SELECT to_jsonb(count(*)) FROM changed;`)).toBe(1)
    await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: c.id })
    // The frozen legal context was captured while the role was current and the
    // owner's legal actor is evaluated at reception time, so this refusal comes
    // from a later current-authority layer; its exact surface is emitted as
    // Z04C_REFUSAL_OBSERVATION and pinned after the first qualified run.
    held(f, before, c.id)
  }, 180000)

  it('a receiver supplier role expired before C reception holds the legal context and cannot cancel the confirmed start', async () => {
    const f = await seed(); await confirmed(f)
    const before = business(f)
    expect(sql(`WITH changed AS (UPDATE public.tenant_actor_roles SET valid_to=clock_timestamp() WHERE company_id=${literal(f.companyId)} AND actor_id=${literal(f.actorUserId)} AND environment='test' AND role_code='electricity_supplier' AND valid_to IS NULL RETURNING id) SELECT to_jsonb(count(*)) FROM changed;`)).toBe(1)
    const c = await receiveProdat(f, z04c(f), 'C')
    for (let attempt = 0; attempt < 2; attempt++) {
      await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: c.id })
      held(f, before, c.id, { contextReason: 'ediel_inbound_legal_context_required' })
    }
  }, 180000)

  it('a sender grid-owner role revoked before fresh C reception cannot cancel the confirmed start', async () => {
    const f = await seed(); await confirmed(f)
    const before = business(f)
    expect(sql(`WITH changed AS (UPDATE public.platform_actor_roles SET is_active=false WHERE actor_id=${literal(f.marketActorId)} AND actor_role='grid_owner' AND is_active RETURNING id) SELECT to_jsonb(count(*)) FROM changed;`)).toBe(1)
    const c = await receiveProdat(f, z04c(f), 'C')
    await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: c.id })
    // Fixed by 20261018100000: the first Z04/C needs today's sender registry.
    held(f, before, c.id, { partitionReason: 'z04c_current_sender_network_registry_required' })
  }, 180000)

  it('a genuine foreign execution actor cannot apply the own fresh C source', async () => {
    const f = await seed(), foreign = await seed(); await confirmed(f)
    const c = await receiveProdat(f, z04c(f), 'C'), before = business(f), foreignBefore = business(foreign)
    expect(await applySupplyMarketSource({ actorUserId: foreign.actorUserId, message: c }))
      .toMatchObject({ applied: false, reason: 'supply_execution_actor_unqualified', periods: [], commits: [], effectReceiptIds: [] })
    held(f, before, c.id); expect(business(foreign)).toEqual(foreignBefore)
  }, 180000)

  it('refuses raw and direction rewrites of a genuinely received Z04C without changing source, reception or effects', async () => {
    const f = await seed(); await confirmed(f)
    const c = await receiveProdat(f, z04c(f), 'C'); await process(f, c)
    const retained = () => sql(`SELECT jsonb_build_object('message',(SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(c.id)} AND company_id=${literal(f.companyId)}),
      'source',(SELECT to_jsonb(s) FROM gridex_received_sources.sources s WHERE source_message_id=${literal(c.id)} AND company_id=${literal(f.companyId)}),
      'receptions',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM gridex_ediel_inbound_receptions.receptions r WHERE source_message_id=${literal(c.id)} AND company_id=${literal(f.companyId)}));`)
    const before = retained(), effects = business(f)
    expect(c.raw_payload).toContain('CAV+Z24')
    const rawChange = await supabaseService.from('ediel_messages').update({ raw_payload: c.raw_payload!.replace('CAV+Z24', 'CAV+Z22') })
      .eq('company_id', f.companyId).eq('id', c.id)
    expect(rawChange.error).toMatchObject({ code: '23514', message: 'immutable_ediel_payload_cannot_change' })
    expect(retained()).toEqual(before); expect(business(f)).toEqual(effects)
    const directionChange = await supabaseService.from('ediel_messages').update({ direction: 'outbound' })
      .eq('company_id', f.companyId).eq('id', c.id)
    expect(directionChange.error).toMatchObject({ code: '23514', message: 'immutable_ediel_received_context_cannot_change' })
    expect(retained()).toEqual(before); expect(business(f)).toEqual(effects)
  }, 180000)

  it.each(['li', 'point'])('holds Z04C with a wrong %s without cancelling the own confirmed start', async variant => {
    const f = await seed(); await confirmed(f)
    const before = business(f)
    const c = await receiveProdat(f, z04c(f, wire => variant === 'li'
      ? wire.replace(`RFF+LI:${f.caseReference}`, 'RFF+LI:UNRELATED') : wire.replaceAll(f.external, CLOSURE_OBJECT)), 'C')
    await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: c.id })
    held(f, before, c.id, variant === 'li' ? { partitionReason: 'z04c_exact_original_unavailable' } : {})
  }, 180000)

  it('a second distinct C after the start is cancelled is held as a duplicate and keeps the first C binding', async () => {
    const f = await seed(); await confirmed(f)
    const first = await receiveProdat(f, z04c(f), 'C'); await process(f, first)
    expect(switchState(f)).toMatchObject({ status: 'cancelled_before_start', inbound: first.id })
    const before = business(f)
    const second = await receiveProdat(f, z04c(f), 'C')
    expect(second.id).not.toBe(first.id)
    await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: second.id })
    held(f, before, second.id, { partitionReason: 'z04c_start_already_cancelled' })
    expect(switchState(f)).toMatchObject({ status: 'cancelled_before_start', inbound: first.id })
  }, 180000)

  it.each(['226', '260', '223', '210', '227', '228', '232', '231', '316', '233', '234', '262'])('holds individually omitted required Z04C field %s with its actual national diagnostic', async fieldNumber => {
    const f = await seed(); await confirmed(f)
    const before = business(f)
    const wire = z04c(f, wire => {
      const parsed = tokenizeEdifact(wire), terminator = parsed.una.segmentTerminator
      if (fieldNumber === '223') {
        const index = parsed.segments.findIndex(segment => segment.tag === 'CCI' && segmentComposite(segment, 2, parsed.una)[0] === 'Z13')
        const characteristic = parsed.segments[index], value = parsed.segments[index + 1]
        expect(index).toBeGreaterThanOrEqual(0); expect(value.tag).toBe('CAV'); expect(segmentComposite(value, 1, parsed.una)[0]).toBe('Z24')
        // The own field is absent, rather than an invalid CCI with no value.
        return wire.replace(characteristic.raw + terminator + value.raw + terminator, '')
      }
      if (['226', '260', '210'].includes(fieldNumber)) {
        const target = parsed.segments.find(segment => fieldNumber === '210'
          ? segment.tag === 'DTM' && segmentComposite(segment, 1, parsed.una)[0] === '92'
          : segment.tag === 'RFF' && segmentComposite(segment, 1, parsed.una)[0] === (fieldNumber === '226' ? 'LI' : 'Z05'))
        expect(target).toBeDefined()
        return wire.replace(target!.raw + terminator, '')
      }
      const qualifier = ['233', '234'].includes(fieldNumber) ? 'IT' : fieldNumber === '262' ? 'Z02' : 'UD'
      const party = parsed.segments.find(segment => segment.tag === 'NAD' && segmentComposite(segment, 1, parsed.una)[0] === qualifier)
      expect(party).toBeDefined()
      const element = ({ '227': 2, '228': 4, '232': 6, '231': 8, '316': 9, '233': 2, '234': 5, '262': 2 } as Record<string, number>)[fieldNumber]
      // The synthetic NADs contain no released separators; keep every other child.
      const children = party!.raw.split(parsed.una.dataElementSeparator)
      expect(children[element]).toBeTruthy()
      children[element] = ''
      return wire.replace(party!.raw, children.join(parsed.una.dataElementSeparator))
    })
    if (fieldNumber === '223') {
      // Without its own 223 the received wire cannot name a C profile. Observe
      // the actual national diagnostic and the public creator's refusal.
      const tokens = tokenizeEdifact(wire)
      const diagnostic = evaluateProdatTransactionReason({ rawSegments: tokens.segments.map(segment => segment.raw), una: tokens.una, code: 'Z04' })
      expect(diagnostic.issues).toContainEqual(expect.objectContaining({ code: 'PRODAT_TRANSACTION_REASON_INVALID',
        prodatDiagnostic: expect.objectContaining({ kind: 'field', fieldNumber: '223', errorKind: 'missing' }) }))
      expect(diagnostic.applicationErrors.length).toBeGreaterThan(0)
      expect(diagnostic.applicationErrors.every(isQualifiedProdatApplicationError)).toBe(true)
      const mail = await seedOriginalMailboxNative(sql, literal, { companyId: f.companyId, environment: 'test', raw: wire,
        receivedAt: new Date().toISOString(), smtpFrom: assertEdielSmtpReadiness().from })
      const outboundMatch = await matchOutboundRequestForInbound({ companyId: f.companyId, parsed: mail.parsed,
        inboundEmailMessageId: mail.inboundEmailMessageId, parseResultId: mail.parseResultId })
      const meteringPointMatch = await matchMeteringPointForInbound({ companyId: f.companyId, parsed: mail.parsed })
      const warning = vi.spyOn(console, 'warn')
      try {
        const id = await createInboundEdielMessage({ companyId: f.companyId, actorUserId: f.actorUserId, environment: 'test',
          inboundEmailMessageId: mail.inboundEmailMessageId, parseResultId: mail.parseResultId, parsed: mail.parsed, outboundMatch, meteringPointMatch })
        if (id) {
          // If a source is born, it must not resolve a C profile or execute.
          const born = (await getEdielMessageById(id))!
          expect(born.rule_profile_key).not.toBe('PRODAT:Z04:C:26.A:r3')
          await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: id })
          expect(ownTransitions(f, id)).toBe(0); expect(positiveAperaks(f, id)).toBe(0)
        }
      } finally { warning.mockRestore() }
      expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND raw_payload=${literal(wire)} AND rule_profile_key='PRODAT:Z04:C:26.A:r3';`)).toBe(0)
      expect(business(f)).toEqual(before)
      return
    }
    const c = await receiveProdat(f, wire, 'C')
    const decision = await resolveCanonicalRuntimeDecisionWithRegistry(c, { actorUserId: f.actorUserId })
    expect(decision.syntaxDecision, JSON.stringify(decision.issues)).toBe('accepted')
    expect(decision.issues).toContainEqual(expect.objectContaining({ prodatDiagnostic: expect.objectContaining({ fieldNumber }) }))
    await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: c.id })
    held(f, before, c.id)
    expect(createHash('sha256').update(c.raw_payload!).digest('hex')).toBe(createHash('sha256').update(wire).digest('hex'))
  }, 180000)
})
