import { successfulUtiltsPersistenceIo } from './helpers/utiltsPersistenceIo'
import { beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest.part-2'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { observationHandoffMessage } from './helpers/utiltsObservationHandoff'
import { raw, line, characteristic, alphabets, type Parts } from './fixtures/prodat-register'

const io = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), event: vi.fn(), ack: vi.fn(), persist: vi.fn(), from: vi.fn(), matches: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: vi.fn() } }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: io.get, updateEdielMessageStatus: io.update, createEdielMessageEvent: io.event, linkEdielMessage: vi.fn() }))
vi.mock('@/lib/ediel/flows/shared', () => ({ ensureActorUserId: (id: string) => id }))
vi.mock('@/lib/onboarding/inboundEdielLinking', () => ({ findActiveMeteringPermissionForUtiltsMessage: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/ediel/utilts/transactionPersistence', async original => ({ ...await original<Record<string, unknown>>(), persistUtiltsTransactionResults: io.persist }))
vi.mock('@/lib/ediel/matching', () => ({ matchMeteringPointIdByIdentifier: vi.fn().mockResolvedValue(null), matchSiteAndCustomerForMeteringPoint: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/ediel/flows/utiltsDataRequest.part-1', async original => ({
  ...await original<Record<string, unknown>>(),
  resolveUtiltsRuntimeTestCaseCode: vi.fn().mockResolvedValue(null), matchUtiltsTransactionsForTenant: io.matches,
  linkInboundUtiltsMessageCanonically: vi.fn().mockResolvedValue({}), allUtiltsTransactionMeteringPointsMatched: vi.fn().mockReturnValue(false),
  createUtiltsRuntimeAcks: io.ack,
  stringOrNull: (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : null,
  ensureJson: (v: unknown) => v && typeof v === 'object' ? v : {},
}))
const point = '735999260731000007'
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const parties: Parts[] = [['NAD', 'FR', ['91100', '160', 'SVK'], '', '', '', '', '', '', 'SE'], ['NAD', 'DO', ['21660', '160', 'SVK'], '', '', '', '', '', '', 'SE']]
function wire(code = 'Z04', date = '202607010000', body?: Parts[], alphabet: readonly string[] = alphabets[0]) {
  return raw([...parties, ...(body ?? [line('1', point, undefined, '9'), ['DTM', [code === 'Z04' ? '92' : '157', date, '203']],
    ['RFF', ['MG', 'SOURCE-METER']], ...characteristic('Z16', '201', 3),
    ['NAD', 'UD', ['PRIVATE-ID', '', '89'], '', 'PRIVATE CUSTOMER', 'PRIVATE ADDRESS']])], code, alphabet)
}
function source(code = 'Z04', date = '202607010000', body?: Parts[], alphabet?: readonly string[]) {
  const value = wire(code, date, body, alphabet)
  return { id: 'source-1', company_id: 'tenant-a', environment: 'test', direction: 'inbound', message_standard: 'edifact',
    message_family: 'PRODAT', message_code: code, metering_point_id: 'meter-tenant-a', raw_payload: value,
    immutable_payload_hash: hash(value), message_received_at: '2026-06-20T09:00:00.000Z',
    parsed_payload: { meterNumber: 'CACHED-WRONG', authority: true }, status: 'validated' }
}
type Row = Record<string, unknown>
let rows: Row[]
let count: number | null
let dbError: unknown
let incoming: ReturnType<typeof observationHandoffMessage>
const queryCalls: Array<[string, ...unknown[]]> = []
function query() {
  const q = {
    select: (...args: unknown[]) => { queryCalls.push(['select', ...args]); return q },
    eq: (...args: unknown[]) => { queryCalls.push(['eq', ...args]); return q },
    in: (...args: unknown[]) => { queryCalls.push(['in', ...args]); return q },
    lte: (...args: unknown[]) => { queryCalls.push(['lte', ...args]); return q },
    limit: (...args: unknown[]) => { queryCalls.push(['limit', ...args]); return q },
    order: (...args: unknown[]) => { queryCalls.push(['order', ...args]); return q },
    then: <T, U>(resolve: (r: { data: Row[]; count: number | null; error: unknown }) => T | PromiseLike<T>, reject?: (reason: unknown) => U | PromiseLike<U>) =>
      Promise.resolve({ data: rows, count, error: dbError }).then(resolve, reject),
  }
  return q
}
function match(overrides: Row = {}) {
  return { transactionReference: 'GRIDEX2607E66001', externalMeteringPointId: point, externalGridAreaId: 'TES',
    meteringPointId: 'meter-tenant-a', customerId: null, siteId: null, gridOwnerId: null, matchStatus: 'matched', ...overrides }
}
beforeEach(() => {
  vi.clearAllMocks(); queryCalls.length = 0
  incoming = observationHandoffMessage(); rows = [source()]; count = 1; dbError = null
  io.get.mockImplementation(async () => incoming); io.update.mockResolvedValue(null); io.event.mockResolvedValue(null)
  io.ack.mockResolvedValue([]); io.persist.mockImplementation(successfulUtiltsPersistenceIo); io.matches.mockResolvedValue([match()]); io.from.mockImplementation(query)
})
type Evidence = { version: number; status: string; authorityStatus: string; selection: string; sources: Array<Record<string, unknown>>; issues: Array<{ code: string; sourceMessageId?: string }> }
async function run(): Promise<Evidence> {
  const policy = resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'E66', direction: 'inbound', referenceDate: '2026-09-30', applicationReference: '23-DDQ-E66-S', mode: 'parse' })
  await processInboundUtiltsMessage({ actorUserId: 'operator', edielMessageId: incoming.id, canonicalPolicy: policy })
  const reports = io.update.mock.calls.map(([call]) => call.parsedPayload.normalizedMeteringPayload.receivedStructuralSources)
  expect(reports[0], 'actual inbound processing must forward fresh dated received-source evidence').toBeDefined()
  for (const report of reports) expect(report).toEqual(reports[0])
  expect(io.event.mock.calls[0][0].payload.normalizedMeteringPayload.receivedStructuralSources).toEqual(reports[0])
  expect(reports[0]).toMatchObject({ version: 1, authorityStatus: 'not_established', selection: 'not_performed' })
  // Source diagnostics do not manufacture E61/E62 or replace the original ACK decision.
  expect(io.ack.mock.calls[0][0].ackPlan.utiltsErrCodes).not.toContain('E61')
  expect(io.ack.mock.calls[0][0].ackPlan.utiltsErrCodes).not.toContain('E62')
  return reports[0]
}

function context(row: Row = rows[0], overrides: Row = {}): Row {
  return { version: 1, contextOrigin: 'database_insert', sourceMessageId: row.id, companyId: row.company_id,
    environment: row.environment, messageCode: row.message_code, payloadHash: row.immutable_payload_hash,
    sourceReceivedAt: row.message_received_at, capturedAt: '2026-06-20T09:00:01.123456+00:00', ...overrides }
}
it('reads the database-owned context on the actual single-SELECT processor path without exposing the whole snapshot', async () => {
  rows[0].received_prodat_context = context()
  const result = await run()
  expect(result.issues).toEqual([])
  expect(result.sources[0]).toMatchObject({ acceptance: 'not_checked', receiptContext: {
    status: 'recorded', capturedAt: '2026-06-20T09:00:01.123456+00:00' } })
  expect(io.from).toHaveBeenCalledExactlyOnceWith('ediel_messages')
  const columns = queryCalls.find(([name]) => name === 'select')?.[1] as string
  expect(columns.split(',')).toContain('received_prodat_context:execution_context_snapshot->receivedProdatContext')
  expect(columns.split(',')).not.toContain('execution_context_snapshot')
  expect(columns).not.toContain('parsed_payload')
})
it.each([undefined, null])('leaves absent historical receive provenance unavailable: %s', async absent => {
  rows[0].received_prodat_context = absent
  const report = await run()
  expect(report.issues).toEqual([])
  expect(report.sources[0]).toMatchObject({ receiptContext: { status: 'unavailable' }, acceptance: 'not_checked' })
})
it.each([
  ['sourceMessageId', 'other-source'], ['messageCode', 'Z10'], ['payloadHash', '0'.repeat(64)],
  ['sourceReceivedAt', '2026-06-20T09:00:00.000001Z'], ['sourceReceivedAt', null],
  ['sourceReceivedAt', '2026-06-20T09:00:00'], ['sourceReceivedAt', '2026-11-31T09:00:00Z'],
  ['capturedAt', null], ['capturedAt', '2026-06-20T09:00:00'], ['capturedAt', '2026-11-31T09:00:00Z'],
  ['version', 2], ['version', '1'], ['contextOrigin', 'application_reparse'],
])('does not use a present context with inconsistent %s=%s', async (key, value) => {
  rows[0].received_prodat_context = context(rows[0], { [key as string]: value })
  const report = await run()
  expect(report.sources).toEqual([])
  expect(report).toMatchObject({ status: 'read_failed', issues: [{ code: 'source_receive_context_unavailable' }] })
  expect(JSON.stringify(report)).not.toContain('source-1')
})
it.each([[[]], ['forged'], [1], [true]])('rejects a non-object receive snapshot %s', async malformed => {
  rows[0].received_prodat_context = malformed
  const result = await run()
  expect(result).toMatchObject({ status: 'read_failed', sources: [], issues: [{ code: 'source_receive_context_unavailable' }] })
  assertNoSourceData(result)
})
it.each([
  { companyId: 'OTHER-TENANT-PRIVATE' }, { environment: 'production' }, { companyId: null },
])('validates every receive context scope before emitting ANY source identifiers: %j', async mismatch => {
  const second = { ...source(), id: 'SECOND-PRIVATE-SOURCE', received_prodat_context: context(rows[0], { sourceMessageId: 'SECOND-PRIVATE-SOURCE', ...mismatch }) }
  rows[0].received_prodat_context = context()
  rows.push(second); count = 2
  const report = await run()
  expect(report).toMatchObject({ status: 'read_failed', sources: [], issues: [{ code: 'source_receive_context_scope_unavailable' }] })
  expect(JSON.stringify(report)).not.toMatch(/source-1|SECOND-PRIVATE|OTHER-TENANT/)
})
it('accepts the same receipt instant in a different offset, retaining the incoming SELECT literal', async () => {
  incoming.message_received_at = '2026-09-30T22:00:00.000002+02:00'
  rows[0].message_received_at = '2026-06-20T11:00:00.000001+02:00'
  rows[0].received_prodat_context = context(rows[0], { sourceReceivedAt: '2026-06-20T09:00:00.000001Z' })
  expect((await run()).sources[0]).toMatchObject({ receiptContext: { status: 'recorded' } })
  expect(queryCalls).toContainEqual(['lte', 'message_received_at', '2026-09-30T22:00:00.000002+02:00'])
})
it.each(['2026-09-30T20:00:00.000002Z', '2026-09-30T22:00:00.000002+02:00'])('does not claim a receive context existed at the UTILTS cutoff when it was captured later: %s', async capturedAt => {
  incoming.message_received_at = '2026-09-30T20:00:00.000001Z'
  rows[0].received_prodat_context = context(rows[0], { capturedAt })
  const result = await run()
  expect(result).toMatchObject({ status: 'read_failed', sources: [], issues: [{ code: 'source_receive_context_unavailable' }] })
  assertNoSourceData(result)
})
it('allows equality at the capture cutoff to microsecond precision', async () => {
  incoming.message_received_at = '2026-09-30T20:00:00.000001Z'
  rows[0].received_prodat_context = context(rows[0], { capturedAt: '2026-09-30T22:00:00.000001+02:00' })
  expect((await run()).sources[0]).toMatchObject({ receiptContext: { status: 'recorded' } })
})
it('does not turn mutable applied/validated/accepted JSON into source acceptance', async () => {
  rows[0].received_prodat_context = context()
  rows[0].parsed_payload = { accepted: true, objectApplication: { status: 'applied' } }
  const result = await run()
  expect(result.sources[0]).toMatchObject({ acceptance: 'not_checked', receiptContext: { status: 'recorded' } })
})
it('keeps the actual ACK/persistence/return decisions unchanged when source context is absent or contradictory', async () => {
  await run()
  const baselineAck = structuredClone(io.ack.mock.calls[0][0])
  const baselinePersistence = structuredClone(io.persist.mock.calls)
  io.ack.mockClear(); io.persist.mockClear(); io.update.mockClear(); io.event.mockClear()
  rows[0].received_prodat_context = context(rows[0], { payloadHash: '0'.repeat(64) })
  await run()
  expect(io.ack.mock.calls[0][0]).toEqual(baselineAck)
  expect(io.persist.mock.calls).toEqual(baselinePersistence)
})

it('never promotes a legacy source using cached applied status when its insert context is unavailable', async () => {
  rows[0].parsed_payload = { accepted: true, receivedProdatContext: context() }
  const result = await run()
  expect(result.sources[0]).toMatchObject({ receiptContext: { status: 'unavailable' }, acceptance: 'not_checked' })
})

// Whitelist the supported version; unknown fields are not silently trusted.
it.each([{ acceptance: 'accepted' }, { privateValue: 'NEVER-EXPOSE' }])('rejects unsupported context fields: %j', async extra => {
  rows[0].received_prodat_context = context(rows[0], extra)
  const result = await run()
  expect(result).toMatchObject({ status: 'read_failed', sources: [], issues: [{ code: 'source_receive_context_unavailable' }] })
  assertNoSourceData(result)
  expect(JSON.stringify(result)).not.toContain('NEVER-EXPOSE')
})
function assertNoSourceData(result: Evidence) {
  const serialized = JSON.stringify(result)
  for (const secret of ['source-1', 'meter-tenant-a', point, 'SOURCE-METER', '2026-06-20', '202607010000', hash(wire())]) {
    expect(serialized).not.toContain(secret)
  }
  expect(serialized).not.toMatch(/sourceMessageId|sourcePayloadHash|sourceReceivedAt|objectId|effectiveFrom|registers/)
}
