// simulation: track4/8
// Finding 20261029-3f1a8ab1/claude-track4/8 (port of finance 14032874f, F107):
// the operator's UTILTS engine action stored the file's values, then the
// application reply (APERAK) creation hit a statement timeout (57014) and the
// action threw, so the press answered HTTP 500 although the values were kept.
// Here the real action runs the real UTILTS processor (harness from
// __tests__/reality-f107-utilts-reply-after-store-processor.test.ts: real
// parser/engine/owner, modeled IO). The meter value and billing sinks are
// modeled by their sink identity, like the database's idempotent sinks, so a
// second press shows whether the flow would write anything new.
// Synthetic data only.
import { createUtiltsFinalValidationIo, qualifyUtiltsFixtureSource as registerFixtureSource, currentUtiltsActorQuery, UTILTS_FIXTURE_ACTOR } from './helpers/utiltsCurrentOwnerFixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { bindingRpcRows } from './helpers/utiltsBoundFixture'
import { receivedUtiltsOwnerFixture, resetUtiltsCanonicalOwnerIo } from './helpers/utiltsCanonicalOwnerIo'
import { createHash } from 'node:crypto'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { segmentUntrimmedRaw, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import type { UtiltsBoundPersistenceInput } from '@/lib/ediel/utilts/transactionPersistence'

const io = vi.hoisted(() => ({
  get: vi.fn(), update: vi.fn(), event: vi.fn(), ack: vi.fn(), rpc: vi.fn(), from: vi.fn(), meter: vi.fn(), bill: vi.fn(),
  complete: vi.fn(), findOutbound: vi.fn(), access: vi.fn(), scoped: vi.fn(), listAcks: vi.fn(), revalidate: vi.fn(), revalidateRelated: vi.fn(),
}))
// Sink rows keyed by the identity the flow hands to the sink.
const sinks = vi.hoisted(() => ({ meter: new Map<string, string>(), underlay: new Map<string, string>(), meterWrites: 0, underlayWrites: 0 }))

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: async (...args: unknown[]) => { const message = await io.get(...args); if (!message) return message; if (args[0] !== message.id || message.execution_context_snapshot.receivedUtiltsContext.payloadHash !== hash(message.raw_payload)) throw Error('fixture_actual_immutable_source_scope_required'); return message }, updateEdielMessageStatus: io.update, createEdielMessageEvent: io.event, linkEdielMessage: vi.fn(), listEdielTestRuns: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/ediel/core/kernel', () => ({ createCanonicalAckMessage: io.ack }))
vi.mock('@/lib/ediel/flows/shared', () => ({ ensureActorUserId: (id: string) => id }))
vi.mock('@/lib/metering/normalizeMeteringValues', () => ({ normalizeAndStoreMeteringValue: io.meter }))
vi.mock('@/lib/billing/meterValueBillingMatcher', () => ({ updateMeterValueBillingReadiness: vi.fn() }))
vi.mock('@/lib/cis/db', () => ({ ingestBillingUnderlay: io.bill, findOpenOutboundBySource: io.findOutbound, syncGridOwnerDataRequestReceivedFromEdiel: io.complete }))
vi.mock('@/lib/ediel/matching', () => ({
  matchMeteringPointIdByIdentifier: vi.fn().mockResolvedValue('point-a'),
  matchMeteringPointForEdielMessage: vi.fn().mockResolvedValue('point-a'),
  matchSiteAndCustomerForMeteringPoint: vi.fn().mockResolvedValue({ customerId: 'customer-a', siteId: 'site-a', gridOwnerId: 'owner-a' }),
  findMatchingGridOwnerDataRequest: vi.fn().mockResolvedValue({ id: 'request-a', request_scope: 'billing_underlay', response_payload: {}, customer_id: 'customer-a', metering_point_id: 'point-a' }),
}))
// Action boundary: authorization and scoped read are modeled; the engine is the real UTILTS processor.
vi.mock('@/lib/ediel/actionAccess', () => ({ requireEdielWriteActionAccess: io.access, requireEdielSendActionAccess: io.access }))
vi.mock('@/lib/ediel/inbound/businessAckMessages', () => ({ listBusinessAckMessagesForSource: io.listAcks }))
vi.mock('@/lib/ediel/operationalBridge', () => ({
  processEdielOperationalMessage: async (params: { actorUserId: string; edielMessageId: string }) =>
    (await import('@/lib/ediel/flows/utiltsDataRequest.part-2')).processInboundUtiltsMessage(params),
}))
vi.mock('@/app/admin/ediel/actions.part-1', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/admin/ediel/actions.part-1')>()),
  requireScopedEdielMessageForAction: io.scoped,
  revalidateEdiel: io.revalidate,
  revalidateRelatedMessage: io.revalidateRelated,
}))

import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest.part-2'
import { processEdielOperationalMessageAction, runEdielOperationalMessageAction } from '@/app/admin/ediel/actions.part-3'

let sourceOrdinal = 0
let declaredSources = new WeakSet<object>()
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
let results: unknown[] | undefined
let approvedRpc: ((name: string, args: Record<string, unknown>) => unknown) | undefined

beforeEach(() => {
  vi.clearAllMocks(); resetUtiltsCanonicalOwnerIo(); sourceOrdinal = 0; declaredSources = new WeakSet(); results = []; approvedRpc = undefined
  sinks.meter.clear(); sinks.underlay.clear(); sinks.meterWrites = 0; sinks.underlayWrites = 0
  io.findOutbound.mockResolvedValue(null); io.complete.mockResolvedValue(null)
  io.update.mockResolvedValue(null); io.event.mockResolvedValue(null)
  io.meter.mockImplementation(async (input: Record<string, unknown>) => {
    const key = [input.companyId, input.sourceMessageId, input.sourceTransactionReference, input.boundObservationOrdinal, input.meteringPointId, input.periodStart].join('|')
    if (!sinks.meter.has(key)) { sinks.meterWrites += 1; sinks.meter.set(key, `meter-value-${sinks.meter.size + 1}`) }
    return { status: 'stored', meteringValue: { id: sinks.meter.get(key) } }
  })
  io.bill.mockImplementation(async (input: Record<string, unknown>) => {
    const key = [input.expectedCompanyId, input.boundSourceMessageId, input.underlayYear, input.underlayMonth].join('|')
    if (!sinks.underlay.has(key)) { sinks.underlayWrites += 1; sinks.underlay.set(key, `underlay-${sinks.underlay.size + 1}`) }
    return { id: sinks.underlay.get(key) }
  })
  io.ack.mockImplementation(async ({ ackFamily }) => ({ id: `ack-${ackFamily}` }))
  io.listAcks.mockResolvedValue([])
  io.access.mockResolvedValue({ userId: UTILTS_FIXTURE_ACTOR, companyId: null })
  io.scoped.mockImplementation(async (id: string) => io.get(id))
  const finalValidationIo = createUtiltsFinalValidationIo()
  io.rpc.mockImplementation((name, args) => {
    const canonical = finalValidationIo(name, args)
    if (canonical) return canonical
    const input = name === 'gridex_persist_utilts_consumption_v1' ? { companyId: args.p_company_id, environment: args.p_environment, sourceMessageId: args.p_source_message_id, messageCode: args.p_message_code, rawPayload: args.p_raw_payload, transactions: args.p_transactions, contracts: args.p_transactions.map((t: { consumptionContract: unknown }) => t.consumptionContract) } as UtiltsBoundPersistenceInput : null
    const response = input ? { data: bindingRpcRows(input, results), error: null } : { data: null, error: { message: 'unavailable' } }
    return Object.assign(Promise.resolve(response), { abortSignal: () => Promise.resolve(response) })
  })
  io.from.mockImplementation((table: string) => {
    const actor = currentUtiltsActorQuery(table); if (actor) return actor
    const q = { select: () => q, eq: () => q, is: () => q, in: () => q, lte: () => q, limit: () => q, update: () => q,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === 'ediel_ack_transaction_results' ? [{ id: 'ack-row' }] : [], count: 0, error: null }).then(resolve) }
    return q
  })
})

function declaredTestSource(message: EdielMessageRow): EdielMessageRow {
  if (declaredSources.has(message)) return message
  if (message.environment === 'test' && message.raw_payload) {
    const tokens = tokenizeEdifact(message.raw_payload), unbs = tokens.segments.filter(t => t.tag === 'UNB')
    if (unbs.length === 1) { const raw = segmentUntrimmedRaw(unbs[0]); if (raw.endsWith('++1')) message.raw_payload = message.raw_payload.replace(raw, raw + '++1') }
  }
  Object.assign(message, receivedUtiltsOwnerFixture(message))
  message.id = '22222222-2222-4222-8222-' + String(++sourceOrdinal).padStart(12, '0')
  const captured = message.execution_context_snapshot as { receivedUtiltsContext: { sourceMessageId: string } }
  captured.receivedUtiltsContext.sourceMessageId = message.id
  registerFixtureSource(message)
  declaredSources.add(message)
  return message
}

function issuerEvidence(approved: boolean) {
  approvedRpc = approvedRpc ?? io.rpc.getMockImplementation()!
  const base = approvedRpc
  io.rpc.mockImplementation((name: string, args: Record<string, unknown>) =>
    !approved && name === 'gridex_read_utilts_issuer_identity_authority_v1'
      ? Promise.resolve({ data: null, error: { message: 'issuer evidence not approved (fixture)' } })
      : base(name, args))
}

const TX = 'GRIDEX2607E66001'
const heldRow = { transactionId: TX, disposition: 'internal_review', responseType: 'none', persistenceStatus: 'not_applicable' }
type Update = { validationReport?: Record<string, unknown>; status?: string }
const TIMEOUT = () => ({ code: '57014', details: null, hint: null, message: 'canceling statement due to statement timeout' })
const form = (id: string) => { const f = new FormData(); f.set('edielMessageId', id); return f }
const replyFailedEvents = () => io.event.mock.calls.map(([call]) => call as { eventStatus: string; message: string; payload: Record<string, unknown> })
  .filter((call) => call.payload?.phase === 'utilts_reply_failed_after_store')

// A held E66 (issuer evidence not yet approved) whose evidence is then approved;
// from then on every APERAK creation times out (57014).
async function heldSourceWithTimingOutReply(): Promise<EdielMessageRow> {
  const message = declaredTestSource(energyHandoffMessage('2026-10-01'))
  message.sender_ediel_id = '91100'; message.receiver_ediel_id = '21660'
  io.get.mockResolvedValue(message); issuerEvidence(false)
  results = [heldRow]
  await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  message.validation_report = io.update.mock.calls.map(([call]) => (call as Update).validationReport).filter(Boolean).at(-1)!
  expect(sinks.meterWrites).toBe(0)
  io.ack.mockClear(); io.update.mockClear(); io.event.mockClear(); issuerEvidence(true)
  results = undefined
  io.ack.mockImplementation(async ({ ackFamily }) => { if (ackFamily === 'APERAK') throw TIMEOUT(); return { id: `ack-${ackFamily}` } })
  io.access.mockResolvedValue({ userId: UTILTS_FIXTURE_ACTOR, companyId: message.company_id })
  return message
}

describe('track4/8 UTILTS engine action: values stored, then the APERAK times out (57014)', () => {
  it('returns a partial-success result with the reply failure instead of throwing', async () => {
    const message = await heldSourceWithTimingOutReply()

    const result = await runEdielOperationalMessageAction(form(message.id))

    expect(result).toEqual({ status: 'reply_failed_after_store', storedMeterValueCount: 1, billingUnderlayId: 'underlay-1',
      reason: 'canceling statement due to statement timeout' })
    expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('APERAK')
    expect(sinks.meterWrites).toBe(1)
    // Reported durably on the source, with what was stored and why the reply is missing.
    expect(replyFailedEvents()).toHaveLength(1)
    expect(replyFailedEvents()[0]).toMatchObject({ eventStatus: 'error', payload: { storedMeterValueCount: 1, storedMeterValueIds: ['meter-value-1'],
      billingUnderlayId: 'underlay-1', error: 'canceling statement due to statement timeout' } })
    // Not claimed as validated: the reply is missing.
    expect(io.update.mock.calls.map(([call]) => (call as Update).status)).not.toContain('validated')
    expect(io.revalidate).toHaveBeenCalledWith(message.id)
  })

  it('the form action resolves (no HTTP 500)', async () => {
    const message = await heldSourceWithTimingOutReply()
    await expect(processEdielOperationalMessageAction(form(message.id))).resolves.toBeUndefined()
    expect(replyFailedEvents()).toHaveLength(1)
  })

  it('a second press while the reply still times out writes no new values or underlay', async () => {
    const message = await heldSourceWithTimingOutReply()

    const first = await runEdielOperationalMessageAction(form(message.id))
    const meterAfterFirst = [...sinks.meter.entries()]
    const second = await runEdielOperationalMessageAction(form(message.id))

    expect(first).toMatchObject({ status: 'reply_failed_after_store', storedMeterValueCount: 1, billingUnderlayId: 'underlay-1' })
    expect(second).toEqual(first)
    // The same sink identity is handed over again: nothing new is written.
    expect(sinks.meterWrites).toBe(1)
    expect(sinks.underlayWrites).toBe(1)
    expect([...sinks.meter.entries()]).toEqual(meterAfterFirst)
    expect(io.meter).toHaveBeenCalledTimes(2)
    expect(replyFailedEvents().map((event) => event.payload.storedMeterValueIds)).toEqual([['meter-value-1'], ['meter-value-1']])
  })

  it('a 57014 before anything was stored still surfaces unchanged', async () => {
    const message = await heldSourceWithTimingOutReply()
    const timeout = TIMEOUT()
    io.meter.mockRejectedValueOnce(timeout)

    await expect(runEdielOperationalMessageAction(form(message.id))).rejects.toBe(timeout)
    expect(replyFailedEvents()).toEqual([])
  })
})
