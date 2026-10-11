// masterplan: SC-046
// A late, older E66 version runs through the real production processing path
// (processInboundUtiltsMessage → persistence adapter → bound sinks →
// createUtiltsRuntimeAcks → ACK finalization). Only the database persistence
// RPC answers versionState 'late_older_history', as the forward SQL does; the
// harness mocks are those of ediel-utilts-persistence-processor.test.ts.
// createCanonicalAckMessage is mocked here; the real kernel, positive authority,
// atomic ACK creation and receipt finalization are proven in
// __tests__/ediel-utilts-err-gateway.test.ts (SC-046 cases).
// Not native replay or market evidence.
import { createUtiltsFinalValidationIo, qualifyUtiltsFixtureSource as registerFixtureSource, currentUtiltsActorQuery, UTILTS_FIXTURE_ACTOR } from './helpers/utiltsCurrentOwnerFixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest.part-2'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { recountEdifactUnt } from './helpers/recountEdifactUnt'
import { bindingRpcRows } from './helpers/utiltsBoundFixture'
import { receivedUtiltsOwnerFixture, resetUtiltsCanonicalOwnerIo } from './helpers/utiltsCanonicalOwnerIo'
import { createHash } from 'node:crypto'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { segmentUntrimmedRaw, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import type { UtiltsBoundPersistenceInput } from '@/lib/ediel/utilts/transactionPersistence'

const io = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), event: vi.fn(), ack: vi.fn(), rpc: vi.fn(), from: vi.fn(), meter: vi.fn(), bill: vi.fn(), complete: vi.fn(), findOutbound: vi.fn(), finalized: [] as unknown[] }))
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

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const TX = 'GRIDEX2607E66001'
let results: unknown[] = []
let sourceOrdinal = 0
beforeEach(() => {
  vi.clearAllMocks(); resetUtiltsCanonicalOwnerIo(); sourceOrdinal = 0; io.finalized = []
  io.findOutbound.mockResolvedValue(null); io.complete.mockResolvedValue(null); io.update.mockResolvedValue(null); io.event.mockResolvedValue(null)
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
    const q = { select: () => q, eq: () => q, is: () => q, in: () => q, lte: () => q, limit: () => q,
      update: (values: unknown) => { if (table === 'ediel_ack_transaction_results') io.finalized.push(values); return q },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === 'ediel_ack_transaction_results' ? [{ id: 'ack-row' }] : [], count: 0, error: null }).then(resolve) }
    return q
  })
})

/** Same declared synthetic TEST source as the processor harness. */
function declaredTestSource(message: EdielMessageRow): EdielMessageRow {
  if (message.environment === 'test' && message.raw_payload) {
    const unbs = tokenizeEdifact(message.raw_payload).segments.filter(t => t.tag === 'UNB')
    if (unbs.length === 1) { const raw = segmentUntrimmedRaw(unbs[0]); if (raw.endsWith('++1')) message.raw_payload = message.raw_payload.replace(raw, raw + '++1') }
  }
  Object.assign(message, receivedUtiltsOwnerFixture(message))
  message.id = '22222222-2222-4222-8222-' + String(++sourceOrdinal).padStart(12, '0')
  ;(message.execution_context_snapshot as { receivedUtiltsContext: { sourceMessageId: string } }).receivedUtiltsContext.sourceMessageId = message.id
  registerFixtureSource(message)
  return message
}
// Own 512 is the transaction DTM+597; own 532 is DTM+368. Both are older than
// the newer version already stored, which only the database can know.
function lateOlder(field: '512' | '532') {
  const message = energyHandoffMessage('2026-10-01')
  message.sender_ediel_id = '91100'; message.receiver_ediel_id = '21660'
  const own = "DTM+597:202607010020:203'"
  if (field === '532') message.raw_payload = message.raw_payload!.replace(own, own + "\nDTM+368:202607010021:203'")
  message.raw_payload = recountEdifactUnt(message.raw_payload!)
  return message
}

describe('SC-046 late older E66 is planned for a positive APERAK with no sink effect (ACK kernel mocked)', () => {
  it.each([['512', 'registrationDate', '2026-06-30T22:20:00.000Z'], ['532', 'latestUpdateDate', '2026-06-30T22:21:00.000Z']] as const)(
    'own %s (%s) late older version: positive APERAK finalized, no sink effect, no ERR', async (field, key, instant) => {
      const message = declaredTestSource(lateOlder(field)); io.get.mockResolvedValue(message)
      results = [{ transactionId: TX, disposition: 'accepted', responseType: 'positive_aperak', persistenceStatus: 'persisted', versionState: 'late_older_history' }]
      await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
      // The own version time is what the database compares against the newer one.
      const sent = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')![1].p_transactions
      expect(sent).toMatchObject([{ transactionId: TX, disposition: 'accepted', responseType: 'positive_aperak', [key]: instant }])
      // Expected: one real positive APERAK for the same source and transaction.
      const aperaks = io.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK')
      expect(aperaks).toHaveLength(1)
      expect(aperaks[0][0].outcome).toBe('positive')
      expect(aperaks[0][0].sourceMessage.id).toBe(message.id)
      expect(JSON.stringify(aperaks[0][0].draft)).toContain(TX)
      // Expected: the transaction's ACK receipt is finalized as positive APERAK.
      expect(io.finalized).toContainEqual(expect.objectContaining({ final_response_type: 'positive_aperak', response_message_id: 'ack-APERAK', finalized_at: expect.any(String) }))
      // Prohibited: no ERR and no negative response.
      expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
      expect(io.ack.mock.calls.filter(([call]) => call.outcome === 'negative')).toEqual([])
      expect(io.finalized).not.toContainEqual(expect.objectContaining({ final_response_type: expect.stringMatching(/negative|err/) }))
      // Prohibited: the current meter value and the single billing total stay untouched.
      expect(io.meter).not.toHaveBeenCalled()
      expect(io.bill).not.toHaveBeenCalled()
    })
  it('control: the same source as current data is consumed once', async () => {
    const message = declaredTestSource(lateOlder('512')); io.get.mockResolvedValue(message)
    results = [{ transactionId: TX, disposition: 'accepted', responseType: 'positive_aperak', persistenceStatus: 'persisted', versionState: 'current' }]
    await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
    expect(io.meter).toHaveBeenCalledTimes(1); expect(io.bill).toHaveBeenCalledTimes(1)
    expect(io.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK')).toHaveLength(1)
  })
})
