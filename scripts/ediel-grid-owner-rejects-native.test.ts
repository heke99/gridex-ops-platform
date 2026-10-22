// reality-defects: GOR-01 (fixed), GOR-03 (fixed), GOR-04 (open), GOR-05 (open) (scenario I, scripts/reality/chain-i-grid-owner-rejects.test.ts)
// Rules exercised (specification only, not coverage tags): ACK-02, ACK-06, ACK-07, ACK-09, P-11, TR-05, ENV-04.
//
// Native proofs on the owned local Supabase: a real sent Z03 from the platform's own builder and transport
// (seedNormalSwitchNativeFixture, SMTP provider mocked), then the grid owner's answers received through the
// real inbound reception, canonical validation ledger and processInboundAckMessage — the same owner the
// inbound-mail cron runs. Counterparty bytes are synthetic fixtures (scripts/helpers/reality/rejectsWire.ts).
// Nothing is written to market state directly; the only clock fixture is GOR-05's ack deadline in the past.
//
// it.fails = an OPEN defect: the body asserts the expected behaviour and fails today. When the defect is fixed
// the test turns red and must be flipped to it(...). GOR_SHOW_DEFECTS=1 runs them as plain tests, so the exact
// failing assertion (and not a setup error) is visible.
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
const smtp = vi.hoisted(() => vi.fn())
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: smtp }) } }))
import { seedNormalSwitchNativeFixture, futureNativeSupplyDate, nativeSql as sql, literal } from './helpers/ediel-normal-switch-native-fixture'
import { receiveUtiltsRetry } from './helpers/utiltsConsumptionParties'
import { parseEdifactPayload } from '@/lib/inbound-mail/edielEmailParser'
import { createInboundEdielMessage, createParseResult } from '@/lib/inbound-mail/inboundStatusUpdater'
import { getEdielMessageById } from '@/lib/ediel/db'
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { recordReceivedSourceValidation } from '@/lib/ediel/core/receivedSourceValidationLedger'
import { processInboundAckMessage } from '@/lib/ediel/flows/inboundAckProcessing'
import { prepareAndQueueEdielZ03 } from '@/lib/ediel/flows/prodatSwitch'
import { checkAckDeadlines } from '@/lib/ediel/sla/checkAckDeadlines'
import { sweepEdielBusinessExpectations } from '@/lib/ediel/operations/businessExpectationSweep'
import { contrlFor, headerRejectionAperakFor, objectRejectionAperakFor, readReceivedRequest, syntaxRejectionContrlFor, REJECTION_CODES, type RejectionReason } from './helpers/reality/rejectsWire'

type Fixture = Awaited<ReturnType<typeof seedNormalSwitchNativeFixture>>
const openDefect = process.env.GOR_SHOW_DEFECTS ? it : it.fails
afterEach(() => { smtp.mockReset(); vi.unstubAllEnvs() })
function configureSmtp() {
  for (const [key, value] of Object.entries({ EDIEL_SHARED_MAILBOX_ADDRESS: 'synthetic@example.invalid', EDIEL_APP_DKIM_ENABLED: 'false', EMAIL_PROVIDER: 'resend',
    EDIEL_SMTP_FROM: 'synthetic@example.invalid', EDIEL_SMTP_USER: 'synthetic@example.invalid', EDIEL_SMTP_PASS: 'synthetic-only', EDIEL_EMAIL_PROVIDER: 'strato' })) vi.stubEnv(key, value)
}
/** A supplier with a signed customer whose Z03 the platform built and sent (SMTP 250, provider mocked). */
async function sentZ03(): Promise<Fixture> {
  configureSmtp()
  return seedNormalSwitchNativeFixture({ requestedStartDate: futureNativeSupplyDate(),
    provider: (email: string) => { smtp.mockResolvedValue({ accepted: [email], rejected: [], messageId: randomUUID(), response: '250 synthetic accepted' }) } })
}
/** One grid-owner file through the real reception: retained mail, parse result, inbound message, validation ledger, ACK owner. */
async function receive(f: Fixture, raw: string) {
  const parsed = parseEdifactPayload(raw)
  const { inboundEmailMessageId } = receiveUtiltsRetry(sql, literal, { companyId: f.companyId, actorUserId: f.actorUserId, raw, parsed })
  const parseResultId = await createParseResult({ companyId: f.companyId, inboundEmailMessageId, parsed })
  const id = await createInboundEdielMessage({ companyId: f.companyId, actorUserId: f.actorUserId, environment: 'test', inboundEmailMessageId, parseResultId, parsed })
  expect(id).toBeTruthy()
  const message = (await getEdielMessageById(id!))!
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(message)
  // The grid owner's file itself is a correct APERAK/CONTRL: our side accepts it as a document.
  expect([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision], JSON.stringify(decision.issues)).toEqual(['accepted', 'accepted', 'accepted'])
  expect(await recordReceivedSourceValidation({ original: message, validated: message, resolvedCompanyId: f.companyId, decision })).toMatchObject({ status: 'recorded' })
  const applied = await processInboundAckMessage({ actorUserId: f.actorUserId, message })
  return { message, applied }
}
type Observed = {
  switch: { status: string; failure_reason: string | null; failed_at: string | null; z04: boolean }
  z03: { status: string; contrl: string | null; aperak: string | null; ackDue: string | null; failure: string | null; canonical: string }
  outbound: string | null; z03Count: number; switchEvents: Array<{ type: string; status: string; message: string }>
  cases: number; notifications: number; operatorEvents: number; slaEvents: number; periods: number
}
/**
 * Operator-facing signals about THIS rejection/silence since `since`: a customer case, an action-required
 * customer-operation event about a rejection/ACK/overdue, or an ACK SLA event on the Z03. (The shared world's
 * customer-operations cron may add unrelated generic events to a fixture tenant; those are not counted.)
 */
function operatorSignals(f: Fixture, since: string) {
  const c = literal(f.companyId), t = literal(since)
  return sql<{ cases: number; events: number; sla: number }>(`SELECT jsonb_build_object(
    'cases',(SELECT count(*) FROM public.customer_cases WHERE company_id=${c} AND created_at>=${t}::timestamptz),
    'events',(SELECT count(*) FROM public.customer_operation_events WHERE company_id=${c} AND action_required AND created_at>=${t}::timestamptz
      AND event_code ~* '(reject|aperak|contrl|ack|overdue|ediel|response)'),
    'sla',(SELECT count(*) FROM public.ediel_ack_sla_events WHERE company_id=${c} AND ediel_message_id=${literal(f.originalZ03.id)}))`)
}
const dbNow = () => sql<string>(`SELECT to_jsonb(clock_timestamp())`)
function observe(f: Fixture): Observed {
  const c = literal(f.companyId), s = literal(f.switchId), z = literal(f.originalZ03.id)
  return sql<Observed>(`SELECT jsonb_build_object(
    'switch',(SELECT jsonb_build_object('status',status,'failure_reason',failure_reason,'failed_at',failed_at,'z04',inbound_z04_message_id IS NOT NULL) FROM public.supplier_switch_requests WHERE id=${s} AND company_id=${c}),
    'z03',(SELECT jsonb_build_object('status',m.status,'contrl',m.contrl_status,'aperak',m.aperak_status,'ackDue',m.ack_due_at,'failure',m.failure_reason,
      'canonical',(SELECT v.canonical_ack_state FROM public.ediel_message_ack_state_v v WHERE v.id=m.id)) FROM public.ediel_messages m WHERE m.id=${z} AND m.company_id=${c}),
    'outbound',(SELECT o.status FROM public.outbound_requests o WHERE o.id=(SELECT outbound_request_id FROM public.ediel_messages WHERE id=${z})),
    'z03Count',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${c} AND direction='outbound' AND message_family='PRODAT' AND message_code='Z03'),
    'switchEvents',(SELECT coalesce(jsonb_agg(jsonb_build_object('type',event_type,'status',event_status,'message',message) ORDER BY created_at),'[]') FROM public.supplier_switch_events WHERE switch_request_id=${s}),
    'cases',(SELECT count(*) FROM public.customer_cases WHERE company_id=${c} AND (supplier_switch_request_id=${s} OR customer_id=${literal(f.customerId)})),
    'notifications',(SELECT count(*) FROM public.customer_operation_jobs WHERE company_id=${c} AND job_type='dispatch_lifecycle_notification'),
    'operatorEvents',(SELECT count(*) FROM public.customer_operation_events WHERE company_id=${c} AND action_required),
    'slaEvents',(SELECT count(*) FROM public.ediel_ack_sla_events WHERE company_id=${c} AND ediel_message_id=${z}),
    'periods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${c}))`)
}

describe('grid owner rejects a sent Z03 — business rejection per object (BGM 34)', () => {
  const reasons = Object.keys(REJECTION_CODES).filter(r => r !== 'actor_not_connected') as RejectionReason[]
  // GOR-01 (fixed in lib/ediel/flows/inboundAckProcessing.ts): before the fix the switch stayed 'prepared' and the
  // Z03 'sent' with ack_due_at cleared — a silent stall. The rejection must reach the switch request.
  for (const reason of reasons) it(`GOR-01 ${reason} (ERC ${REJECTION_CODES[reason].erc}/${REJECTION_CODES[reason].code}): the switch ends rejected with the grid owner's reason`, async () => {
    const f = await sentZ03(), before = observe(f)
    expect(before.switch.status).not.toBe('failed')
    expect((await receive(f, contrlFor(f.originalZ03.raw_payload!, 'positive'))).applied).toMatchObject({ outcome: 'positive', sourceMessage: { id: f.originalZ03.id } })
    const raw = objectRejectionAperakFor(f.originalZ03.raw_payload!, reason)
    expect(raw).toMatch(/BGM\+\+\+34'/)
    const { applied } = await receive(f, raw)
    // The ACK owner correlates the rejection to our Z03 (ACK-06) and records it as negative...
    expect(applied).toMatchObject({ outcome: 'negative', sourceMessage: { id: f.originalZ03.id }, wholeSourceRejected: false, sourceAccepted: false })
    const after = observe(f)
    console.info('GOR-01', reason, JSON.stringify({ before: before.switch, after }))
    // ...and no supply may follow from it (holds today).
    expect(after.periods).toBe(0)
    // Expected: the rejected request leaves the waiting state with the DSO's code, never silently pending.
    expect(['failed', 'rejected']).toContain(after.switch.status)
    expect(after.switch.failure_reason ?? '').toContain(REJECTION_CODES[reason].code)
  }, 240_000)
})

describe('grid owner rejects a sent Z03 — whole message (BGM 27) and syntax (negative CONTRL)', () => {
  it('BGM 27 header rejection fails the switch, keeps the Z03 original and never re-sends it automatically', async () => {
    const f = await sentZ03()
    await receive(f, contrlFor(f.originalZ03.raw_payload!, 'positive'))
    const { applied } = await receive(f, headerRejectionAperakFor(f.originalZ03.raw_payload!))
    expect(applied).toMatchObject({ outcome: 'negative', wholeSourceRejected: true, sourceAccepted: false })
    const after = observe(f)
    console.info('BGM27', JSON.stringify(after))
    expect(after.switch.status).toBe('failed')
    expect(after.z03).toMatchObject({ status: 'failed', aperak: 'failed', ackDue: null })
    expect(after.periods).toBe(0)
    // TR-05: a negative APERAK is corrected with a NEW BGM by an operator; automation re-running the builder must
    // not send the rejected original (or a fresh copy) again.
    const calls = smtp.mock.calls.length
    const replay = await prepareAndQueueEdielZ03({ actorUserId: f.actorUserId, switchRequestId: f.switchId, communicationRouteId: f.routeId, environment: 'test' }).then(m => ({ id: m.id, status: m.status }), (e: Error) => ({ error: e.message }))
    console.info('BGM27 replay', JSON.stringify(replay))
    expect(observe(f).z03Count).toBe(1)
    expect(smtp.mock.calls.length).toBe(calls)
  }, 240_000)

  // GOR-03 (fixed): the switch carried only "APERAK negative whole-source acknowledgement"; the DSO's ERC/FTX was lost.
  it('GOR-03 the failed switch carries the grid owner\'s rejection code and text', async () => {
    const f = await sentZ03()
    await receive(f, contrlFor(f.originalZ03.raw_payload!, 'positive'))
    await receive(f, headerRejectionAperakFor(f.originalZ03.raw_payload!))
    const after = observe(f)
    console.info('GOR-03', JSON.stringify(after.switch))
    expect(after.switch.failure_reason ?? '').toMatch(/102|Meddelandehuvudet kunde inte läsas/)
  }, 240_000)

  // GOR-04 (open): a market rejection creates no operator case and no customer communication. The inbound
  // business state machine (customer case, website workflow 'switch_rejected', 'supplier_switch.rejected'
  // notification) never runs for CONTRL/APERAK (lib/ediel/flows/inboundProcessing.ts:1259-1273).
  openDefect('GOR-04 a whole-message rejection opens an operator case and queues the customer rejection notice', async () => {
    const f = await sentZ03()
    await receive(f, contrlFor(f.originalZ03.raw_payload!, 'positive'))
    const since = dbNow(), before = observe(f)
    await receive(f, headerRejectionAperakFor(f.originalZ03.raw_payload!))
    const after = observe(f), signals = operatorSignals(f, since)
    console.info('GOR-04', JSON.stringify({ signals, notifications: { before: before.notifications, after: after.notifications } }))
    expect(after.switch.status).toBe('failed')
    expect(signals.cases + signals.events).toBeGreaterThan(0)
    expect(after.notifications).toBeGreaterThan(before.notifications)
  }, 240_000)

  it('negative CONTRL (UCI action 4) fails the switch; no APERAK/Z04 can follow and nothing is re-sent', async () => {
    const f = await sentZ03(), calls = smtp.mock.calls.length
    const { applied } = await receive(f, syntaxRejectionContrlFor(f.originalZ03.raw_payload!))
    expect(applied).toMatchObject({ outcome: 'negative', wholeSourceRejected: true, sourceAccepted: false })
    const after = observe(f)
    console.info('CONTRL-negative', JSON.stringify(after))
    expect(after.switch.status).toBe('failed')
    expect(after.z03).toMatchObject({ status: 'failed', contrl: 'failed', ackDue: null })
    expect(after.periods).toBe(0)
    expect(smtp.mock.calls.length).toBe(calls)
  }, 240_000)
})

describe('duplicate and silent grid owner', () => {
  // ACK-09 (holds): the protocol duplicate is held by the reception owner (duplicate_response_held in the live
  // path, lib/ediel/orchestrator/autoAckOrchestrator.ts:54) and has no second business effect.
  it('a re-delivered identical negative APERAK has no second business effect', async () => {
    const f = await sentZ03()
    await receive(f, contrlFor(f.originalZ03.raw_payload!, 'positive'))
    const raw = headerRejectionAperakFor(f.originalZ03.raw_payload!)
    await receive(f, raw)
    const once = observe(f)
    const second = await receive(f, raw).then(r => ({ outcome: r.applied.outcome }), (e: Error) => ({ error: e.message }))
    const twice = observe(f)
    console.info('GOR-06', JSON.stringify({ second, once: once.switchEvents.length, twice: twice.switchEvents.length, events: twice.switchEvents }))
    expect(twice.switch).toEqual(once.switch)
    expect(twice.switchEvents.length).toBe(once.switchEvents.length)
  }, 240_000)

  // GOR-05 (open): a Z03 that the grid owner never answers is never surfaced as overdue.
  openDefect('GOR-05 a sent Z03 without CONTRL/APERAK past its deadline is overdue and reaches an operator', async () => {
    const f = await sentZ03()
    const facts = readReceivedRequest(f.originalZ03.raw_payload!)
    expect(facts.code).toBe('Z03')
    // Clock fixture: the 30-minute CONTRL/APERAK watch (TM-CONTRL, ENV-04) has passed.
    sql(`UPDATE public.ediel_messages SET ack_due_at=now()-interval '2 hours',contrl_due_at=now()-interval '2 hours' WHERE id=${literal(f.originalZ03.id)} AND company_id=${literal(f.companyId)}`)
    // The same tenant-scoped watchers the customer-operations cron runs.
    const since = dbNow()
    const deadlines = await checkAckDeadlines({ actorUserId: f.actorUserId, companyId: f.companyId })
    const sweep = await sweepEdielBusinessExpectations({ actorUserId: f.actorUserId })
    const after = observe(f), signals = operatorSignals(f, since)
    console.info('GOR-05', JSON.stringify({ deadlines, sweep: { scopes: sweep.scopes, observed: sweep.observed, nextActions: sweep.nextActions.length }, z03: after.z03, signals }))
    expect(after.z03.canonical).toBe('ack_overdue')
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_overdue_message_acks_v WHERE id=${literal(f.originalZ03.id)}`)).toBe(1)
    expect(signals.sla + signals.events + signals.cases).toBeGreaterThan(0)
  }, 240_000)
})
