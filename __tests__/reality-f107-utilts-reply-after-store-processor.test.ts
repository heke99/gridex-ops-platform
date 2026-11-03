// reality-defects: F107
// FINDINGS F107 (processor level): a resumed held E66 stores its values and only
// then fails to create its APERAK (world run 28: F111's
// ediel_ack_atomic_foreign_source_resource). The failure must be recorded
// durably on the source as "stored, reply missing" and the original error must
// carry that state for the operator action. Harness copied from
// __tests__/utilts-held-source-resumability-processor.test.ts (real parser/engine/owner, modeled IO).
// Synthetic data only.
import { createUtiltsFinalValidationIo, qualifyUtiltsFixtureSource as registerFixtureSource, currentUtiltsActorQuery, UTILTS_FIXTURE_ACTOR } from './helpers/utiltsCurrentOwnerFixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest.part-2'
import { createUtiltsRepliesAfterStore, readUtiltsReplyFailedAfterStore } from '@/lib/ediel/utilts/utiltsReplyAfterStore'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { bindingRpcRows } from './helpers/utiltsBoundFixture'
import { receivedUtiltsOwnerFixture, resetUtiltsCanonicalOwnerIo } from './helpers/utiltsCanonicalOwnerIo'
import { createHash } from 'node:crypto'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { segmentUntrimmedRaw, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import type { UtiltsBoundPersistenceInput } from '@/lib/ediel/utilts/transactionPersistence'

const io = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), event: vi.fn(), ack: vi.fn(), rpc: vi.fn(), from: vi.fn(), meter: vi.fn(), bill: vi.fn(), complete: vi.fn(), findOutbound: vi.fn() }))
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

let sourceOrdinal = 0
let declaredSources = new WeakSet<object>()
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
let results: unknown[] | undefined
beforeEach(() => {
  vi.clearAllMocks(); resetUtiltsCanonicalOwnerIo(); sourceOrdinal = 0; declaredSources = new WeakSet(); results = []; io.findOutbound.mockResolvedValue(null); io.complete.mockResolvedValue(null)
  io.update.mockResolvedValue(null); io.event.mockResolvedValue(null)
  io.meter.mockResolvedValue({ status: 'stored', meteringValue: { id: 'meter-value' } }); io.bill.mockResolvedValue({ id: 'underlay' })
  io.ack.mockImplementation(async ({ ackFamily }) => ({ id: `ack-${ackFamily}` }))
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

const TX = 'GRIDEX2607E66001'
const heldRow = { transactionId: TX, disposition: 'internal_review', responseType: 'none', persistenceStatus: 'not_applicable' }
let approvedRpc: ((name: string, args: Record<string, unknown>) => unknown) | undefined
beforeEach(() => { approvedRpc = undefined })
function issuerEvidence(approved: boolean) {
  approvedRpc = approvedRpc ?? io.rpc.getMockImplementation()!
  const base = approvedRpc
  io.rpc.mockImplementation((name: string, args: Record<string, unknown>) =>
    !approved && name === 'gridex_read_utilts_issuer_identity_authority_v1'
      ? Promise.resolve({ data: null, error: { message: 'issuer evidence not approved (fixture)' } })
      : base(name, args))
}
function heldSource() {
  const message = energyHandoffMessage('2026-10-01')
  message.sender_ediel_id = '91100'; message.receiver_ediel_id = '21660'
  return declaredTestSource(message)
}
type Update = { validationReport?: Record<string, unknown>; status?: string }
const replyFailedEvents = () => io.event.mock.calls.map(([call]) => call as { eventStatus: string; message: string; payload: Record<string, unknown> })
  .filter((call) => call.payload?.phase === 'utilts_reply_failed_after_store')

// The exact world error object shape (PostgREST error, not an Error instance).
const F111_ERROR = () => ({ code: 'P0001', details: null, hint: null, message: 'ediel_ack_atomic_foreign_source_resource' })

describe('F107 processor: values stored, then the APERAK fails', () => {
  it('records "stored, reply missing" durably and marks the original error with the stored values', async () => {
    const message = heldSource(); io.get.mockResolvedValue(message); issuerEvidence(false)
    results = [heldRow]
    await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
    message.validation_report = io.update.mock.calls.map(([call]) => (call as Update).validationReport).filter(Boolean).at(-1)!
    expect(replyFailedEvents()).toEqual([])

    // Evidence approved; the APERAK is refused by the database (F111).
    io.ack.mockClear(); io.rpc.mockClear(); io.update.mockClear(); io.event.mockClear(); issuerEvidence(true)
    results = undefined
    const refused = F111_ERROR()
    io.ack.mockImplementation(async ({ ackFamily }) => { if (ackFamily === 'APERAK') throw refused; return { id: `ack-${ackFamily}` } })

    const thrown = await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id }).then(() => null, (error: unknown) => error)
    // Same error for every other caller; values were stored before the reply.
    expect(thrown).toBe(refused)
    expect(io.meter).toHaveBeenCalledTimes(1)
    expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('APERAK')
    expect(readUtiltsReplyFailedAfterStore(thrown)).toEqual({ sourceMessageId: message.id, storedMeterValueIds: ['meter-value'],
      billingUnderlayId: 'underlay', error: 'ediel_ack_atomic_foreign_source_resource' })
    // Durable on the message: one error event saying the values are stored and the reply is missing.
    const events = replyFailedEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ eventStatus: 'error', payload: { storedMeterValueCount: 1, storedMeterValueIds: ['meter-value'],
      billingUnderlayId: 'underlay', error: 'ediel_ack_atomic_foreign_source_resource' } })
    expect(events[0].message).toContain('1 mätvärde(n) lagrades och fakturaunderlag skapades, men applikationssvaret (APERAK/UTILTS-ERR) kunde inte skapas')
    // Not claimed as validated: the reply is missing.
    expect(io.update.mock.calls.map(([call]) => (call as Update).status)).not.toContain('validated')
  })

  it('a reply failure before anything was stored stays an unmarked, untouched error', async () => {
    const message = heldSource(); io.get.mockResolvedValue(message); issuerEvidence(false)
    results = [heldRow]
    const refused = F111_ERROR()
    io.ack.mockImplementation(async () => { throw refused })
    const thrown = await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id }).then(() => null, (error: unknown) => error)
    expect(thrown).toBe(refused)
    expect(io.meter).not.toHaveBeenCalled()
    expect(readUtiltsReplyFailedAfterStore(thrown)).toBeNull()
    expect(replyFailedEvents()).toEqual([])
  })
})

describe('createUtiltsRepliesAfterStore', () => {
  const base = { actorUserId: 'actor', sourceMessageId: 'source' }
  it('returns the replies unchanged on success and writes nothing', async () => {
    await expect(createUtiltsRepliesAfterStore({ ...base, storedMeterValueIds: ['v1'] }, async () => ['ack'])).resolves.toEqual(['ack'])
    expect(io.event).not.toHaveBeenCalled()
  })
  it('wraps a non-object failure so the stored state is still carried', async () => {
    const thrown = await createUtiltsRepliesAfterStore({ ...base, storedMeterValueIds: [] , billingUnderlayId: 'u1' }, async () => { throw 'boom' }).catch((error: unknown) => error)
    expect(thrown).toBeInstanceOf(Error)
    expect(readUtiltsReplyFailedAfterStore(thrown)).toMatchObject({ storedMeterValueIds: [], billingUnderlayId: 'u1', error: 'boom' })
  })
  it('still rethrows the original error when the durable event cannot be written', async () => {
    io.event.mockRejectedValueOnce(new Error('db down'))
    const original = new Error('reply failed')
    await expect(createUtiltsRepliesAfterStore({ ...base, storedMeterValueIds: ['v1'] }, async () => { throw original })).rejects.toBe(original)
    expect(readUtiltsReplyFailedAfterStore(original)?.storedMeterValueIds).toEqual(['v1'])
  })
})
