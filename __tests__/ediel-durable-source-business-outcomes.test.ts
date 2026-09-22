import { beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest.part-2'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { observationHandoffMessage } from './helpers/utiltsObservationHandoff'
import { COMPANY, OTHER, row, snapshot } from './helpers/receivedSourceInventoryFixtures'

const io = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), event: vi.fn(), ack: vi.fn(), persist: vi.fn(), from: vi.fn(), rpc: vi.fn(), matches: vi.fn(), ingest: vi.fn(), allMatched: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: io.get, updateEdielMessageStatus: io.update, createEdielMessageEvent: io.event, linkEdielMessage: vi.fn() }))
vi.mock('@/lib/ediel/flows/shared', () => ({ ensureActorUserId: (id: string) => id }))
vi.mock('@/lib/onboarding/inboundEdielLinking', () => ({ findActiveMeteringPermissionForUtiltsMessage: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/ediel/utilts/transactionPersistence', async original => ({ ...await original<Record<string, unknown>>(), persistUtiltsTransactionResults: io.persist }))
vi.mock('@/lib/ediel/flows/utiltsDataRequest.part-1', () => ({
  resolveUtiltsRuntimeTestCaseCode: vi.fn().mockResolvedValue(null), matchUtiltsTransactionsForTenant: io.matches,
  linkInboundUtiltsMessageCanonically: vi.fn().mockResolvedValue({}), allUtiltsTransactionMeteringPointsMatched: io.allMatched,
  createUtiltsRuntimeAcks: io.ack, maybeIngestMeteringValue: io.ingest,
  stringOrNull: (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null,
  ensureJson: (value: unknown) => value && typeof value === 'object' ? value : {},
}))
const SNAPSHOT = '44444444-4444-4444-8444-444444444444'
const ATTEMPT = '55555555-5555-4555-8555-555555555555'
const HASH = 'a'.repeat(64)
const point = '735999260731000007'
type Scenario = 'unavailable' | 'complete' | 'unknown-receipt' | 'foreign-scope' | 'bad-write-receipt' | 'write-throws' | 'overflow'
let incoming: ReturnType<typeof observationHandoffMessage>
let scenario: Scenario
let signals: AbortSignal[]

function linkedQuery() {
  const q = { select: () => q, eq: () => q, in: () => q, lte: () => q, limit: () => q,
    then: <T, U>(resolve: (r: { data: never[]; count: number; error: null }) => T | PromiseLike<T>, reject?: (reason: unknown) => U | PromiseLike<U>) =>
      Promise.resolve({ data: [], count: 0, error: null }).then(resolve, reject) }
  return q
}
function ledgerRpc(name: string, args: Record<string, unknown>) {
  return { abortSignal: async (signal: AbortSignal) => {
    signals.push(signal)
    if (name === 'gridex_received_source_snapshot_v1') {
      if (scenario === 'unavailable') return { data: null, error: { message: 'redacted unavailable RPC' } }
      const rows = scenario === 'unknown-receipt' ? [row({ receivedContext: null, sourceReceivedAt: null })] : [row()]
      const data = { ...snapshot(rows, { cutoffAt: incoming.message_received_at, readAt: '2026-10-02T00:00:00Z' }), snapshotId: SNAPSHOT, snapshotHash: HASH }
      if (scenario === 'foreign-scope') return { data: { ...data, companyId: OTHER }, error: null }
      if (scenario === 'overflow') return { data: { ...data, exhaustive: false, sourceCount: 1001, sources: [] }, error: null }
      return { data, error: null }
    }
    if (name === 'gridex_record_source_discovery_v1') {
      if (scenario === 'write-throws') throw new Error('private SQL error must not leak')
      const inventoryHash = createHash('sha256').update(String(args.p_inventory_text), 'utf8').digest('hex')
      return { data: { version: 1, companyId: COMPANY, environment: 'test', snapshotId: SNAPSHOT, snapshotHash: HASH,
        engineVersion: 'physical-lin-inventory-v1', attemptId: ATTEMPT,
        inventoryHash: scenario === 'bad-write-receipt' ? '0'.repeat(64) : inventoryHash }, error: null }
    }
    throw new Error('unexpected RPC: ' + name)
  } }
}
beforeEach(() => {
  vi.clearAllMocks(); incoming = observationHandoffMessage('2026-09-30', COMPANY); scenario = 'unavailable'; signals = []
  io.get.mockImplementation(async () => incoming); io.update.mockResolvedValue(null); io.event.mockResolvedValue(null)
  io.ack.mockResolvedValue(['ack-1']); io.persist.mockResolvedValue([]); io.from.mockImplementation(linkedQuery); io.rpc.mockImplementation(ledgerRpc)
  io.matches.mockResolvedValue([{ transactionReference: 'GRIDEX2607E66001', externalMeteringPointId: point, meteringPointId: `meter-${COMPANY}`,
    externalGridAreaId: 'TES', matchStatus: 'matched', customerId: null, siteId: null, gridOwnerId: null }])
  io.allMatched.mockReturnValue(false); io.ingest.mockResolvedValue([{ id: 'value-1' }])
})
// Exclude ONLY this new diagnostic on the two intended normalized surfaces.
// Every other status, ACK, persistence, ingestion, event and return value stays
// in the equality comparison. Existing PR369 outcome assertions are untouched.
function withoutDurableDiagnostic(value: unknown, parent = ''): unknown {
  if (Array.isArray(value)) return value.map(item => withoutDurableDiagnostic(item, parent))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !(key === 'durableReceivedSourceInventory' && ['normalizedMeteringPayload', 'normalizedPayload'].includes(parent)))
    .map(([key, item]) => [key, withoutDurableDiagnostic(item, key)]))
}
async function capture(accepted: boolean) {
  for (const mock of [io.update, io.event, io.ack, io.persist, io.ingest, io.from, io.rpc]) mock.mockClear()
  signals = []
  const policy = resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'E66', direction: 'inbound', referenceDate: incoming.created_at,
    applicationReference: '23-DDQ-E66-S', mode: 'parse' })
  const result = await processInboundUtiltsMessage({ actorUserId: 'operator', edielMessageId: incoming.id, canonicalPolicy: policy })
  expect(result).toMatchObject({ ackIds: ['ack-1'], outboundRequestId: null, ingestedMeterValueId: accepted ? 'value-1' : null,
    ingestedMeterValueIds: accepted ? ['value-1'] : [], billingUnderlayId: null })
  expect(io.persist).toHaveBeenCalledOnce()
  expect(io.update.mock.calls.map(([call]) => call.status)).toEqual(['parsed', 'validated'])
  expect(io.ack.mock.calls[0][0].ackPlan.utiltsErrCodes.includes('E19')).toBe(!accepted)
  expect(io.ingest).toHaveBeenCalledTimes(accepted ? 1 : 0)
  expect(io.rpc.mock.calls[0]).toEqual(['gridex_received_source_snapshot_v1', { p_company_id: COMPANY, p_environment: 'test', p_cutoff: incoming.message_received_at }])
  expect(signals.length).toBeGreaterThan(0); expect(signals.every(signal => signal instanceof AbortSignal)).toBe(true)
  return structuredClone(withoutDurableDiagnostic({ result, statuses: io.update.mock.calls, events: io.event.mock.calls,
    ack: io.ack.mock.calls, persistence: io.persist.mock.calls, ingestion: io.ingest.mock.calls }))
}
for (const accepted of [false, true]) for (const state of ['complete', 'unknown-receipt', 'foreign-scope', 'bad-write-receipt', 'write-throws', 'overflow'] as const) {
  it(`actual durable RPC integration preserves all ${accepted ? 'accepted' : 'rejected'} business outcomes: ${state}`, async () => {
    if (accepted) { incoming = observationHandoffMessage('2026-10-01', COMPANY); io.allMatched.mockReturnValue(true) }
    const baseline = await capture(accepted)
    scenario = state
    expect(await capture(accepted)).toEqual(baseline)
    const inventory = io.update.mock.calls[0][0].parsedPayload.normalizedMeteringPayload.durableReceivedSourceInventory
    expect(inventory).toMatchObject({ authorityStatus: 'not_established', selection: 'not_performed', historyCoverage: 'before_ledger_unknown' })
    if (state === 'foreign-scope') {
      expect(inventory).toMatchObject({ status: 'read_failed', sources: [], persistence: { status: 'unconfirmed' } })
      expect(io.rpc).toHaveBeenCalledTimes(1); expect(JSON.stringify(inventory)).not.toContain(SNAPSHOT)
    } else {
      expect(io.rpc).toHaveBeenCalledTimes(2)
      expect(io.rpc.mock.calls[1][0]).toBe('gridex_record_source_discovery_v1')
      expect(io.rpc.mock.calls[1][1]).toMatchObject({ p_company_id: COMPANY, p_environment: 'test', p_snapshot_id: SNAPSHOT, p_snapshot_hash: HASH,
        p_engine_version: 'physical-lin-inventory-v1' })
      if (state === 'bad-write-receipt' || state === 'write-throws') {
        expect(inventory).toMatchObject({ status: 'incomplete', persistence: { status: 'unconfirmed' } })
        expect(JSON.stringify(inventory)).not.toContain('private SQL')
      } else {
        expect(inventory.persistence).toMatchObject({ status: 'stored', snapshotId: SNAPSHOT, attemptId: ATTEMPT })
        expect(inventory.status).toBe(state === 'complete' ? 'enumerated' : 'incomplete')
        if (state === 'complete') expect(inventory.sources[0].objects.map((object: { objectId: string }) => object.objectId)).toEqual(['MP-A', 'MP-B'])
        if (state === 'overflow') expect(inventory.sources).toEqual([])
      }
    }
  })
}
