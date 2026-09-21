import { beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest.part-2'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { observationHandoffMessage } from './helpers/utiltsObservationHandoff'
import { raw, line, characteristic, type Parts } from './fixtures/prodat-register'

const io = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), event: vi.fn(), ack: vi.fn(), persist: vi.fn(), from: vi.fn(), matches: vi.fn(), ingest: vi.fn(), allMatched: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: vi.fn() } }))
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
const point = '735999260731000007'
function source() {
  const body: Parts[] = [
    ['NAD', 'FR', ['91100', '160', 'SVK'], '', '', '', '', '', '', 'SE'], ['NAD', 'DO', ['21660', '160', 'SVK'], '', '', '', '', '', '', 'SE'],
    line('1', point, undefined, '9'), ['DTM', ['92', '202607010000', '203']], ['RFF', ['MG', 'M']], ...characteristic('Z16', '201', 3),
  ]
  const wire = raw(body)
  return { id: 'source-1', company_id: 'tenant-a', environment: 'test', direction: 'inbound', message_standard: 'edifact', message_family: 'PRODAT', message_code: 'Z04',
    metering_point_id: 'meter-tenant-a', raw_payload: wire, immutable_payload_hash: createHash('sha256').update(wire, 'utf8').digest('hex'),
    message_received_at: '2026-06-20T09:00:00Z', received_prodat_context: undefined as Record<string, unknown> | undefined }
}
let incoming: ReturnType<typeof observationHandoffMessage>
let rows: ReturnType<typeof source>[]
function query() {
  const q = {
    select: () => q, eq: () => q, in: () => q, lte: () => q, limit: () => q,
    then: <T, U>(resolve: (r: { data: typeof rows; count: number; error: null }) => T | PromiseLike<T>, reject?: (reason: unknown) => U | PromiseLike<U>) =>
      Promise.resolve({ data: rows, count: rows.length, error: null }).then(resolve, reject),
  }
  return q
}
beforeEach(() => {
  vi.clearAllMocks(); incoming = observationHandoffMessage(); rows = []
  io.get.mockImplementation(async () => incoming); io.update.mockResolvedValue(null); io.event.mockResolvedValue(null)
  io.ack.mockResolvedValue(['ack-1']); io.persist.mockResolvedValue([]); io.from.mockImplementation(query)
  io.matches.mockResolvedValue([{ transactionReference: 'GRIDEX2607E66001', externalMeteringPointId: point, meteringPointId: 'meter-tenant-a', externalGridAreaId: 'TES', matchStatus: 'matched', customerId: null, siteId: null, gridOwnerId: null }])
  io.allMatched.mockReturnValue(false); io.ingest.mockResolvedValue([{ id: 'value-1' }])
})
// Remove ONLY the intended diagnostic field on its normalized-payload surfaces.
// All statuses, events, messages, references, ACK/RPC/ingest arguments and return
// fields remain in the equality comparison, including any other new property.
function withoutDiagnostic(value: unknown, parent = ''): unknown {
  if (Array.isArray(value)) return value.map(item => withoutDiagnostic(item, parent))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !(key === 'receivedStructuralSources' && ['normalizedMeteringPayload', 'normalizedPayload'].includes(parent)))
    .map(([key, item]) => [key, withoutDiagnostic(item, key)]))
}
async function capture(accepted: boolean) {
  for (const mock of [io.update, io.event, io.ack, io.persist, io.ingest, io.from]) mock.mockClear()
  const policy = resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'E66', direction: 'inbound', referenceDate: incoming.created_at, applicationReference: '23-DDQ-E66-S', mode: 'parse' })
  const result = await processInboundUtiltsMessage({ actorUserId: 'operator', edielMessageId: incoming.id, canonicalPolicy: policy })
  expect(result).toMatchObject({ ackIds: ['ack-1'], outboundRequestId: null, ingestedMeterValueId: accepted ? 'value-1' : null,
    ingestedMeterValueIds: accepted ? ['value-1'] : [], billingUnderlayId: null })
  expect(io.persist).toHaveBeenCalledOnce()
  expect(io.update.mock.calls.map(([call]) => call.status)).toEqual(['parsed', 'validated'])
  expect(io.ack.mock.calls[0][0].ackPlan.utiltsErrCodes.includes('E19')).toBe(!accepted)
  expect(io.ingest).toHaveBeenCalledTimes(accepted ? 1 : 0)
  return structuredClone(withoutDiagnostic({ result, statuses: io.update.mock.calls, events: io.event.mock.calls,
    ack: io.ack.mock.calls, persistence: io.persist.mock.calls, ingestion: io.ingest.mock.calls }))
}
for (const accepted of [false, true]) for (const state of ['recorded', 'unavailable', 'contradictory'] as const) {
  it(`preserves every ${accepted ? 'accepted' : 'rejected'} business outcome with ${state} context`, async () => {
    if (accepted) { incoming = observationHandoffMessage('2026-10-01'); io.allMatched.mockReturnValue(true) }
    const baseline = await capture(accepted)
    const row = source()
    if (state !== 'unavailable') row.received_prodat_context = {
      version: 1, contextOrigin: 'database_insert', sourceMessageId: row.id, companyId: row.company_id, environment: row.environment,
      messageCode: row.message_code, payloadHash: state === 'contradictory' ? '0'.repeat(64) : row.immutable_payload_hash,
      sourceReceivedAt: row.message_received_at, capturedAt: '2026-06-20T09:00:01Z',
    }
    rows = [row]
    expect(await capture(accepted)).toEqual(baseline)
    const report = io.update.mock.calls[0][0].parsedPayload.normalizedMeteringPayload.receivedStructuralSources
    expect(report).toMatchObject({ authorityStatus: 'not_established', selection: 'not_performed' })
    if (state === 'contradictory') expect(report).toMatchObject({ status: 'read_failed', sources: [], issues: [{ code: 'source_receive_context_unavailable' }] })
    else expect(report.sources[0]).toMatchObject({ acceptance: 'not_checked', receiptContext: { status: state } })
  })
}
