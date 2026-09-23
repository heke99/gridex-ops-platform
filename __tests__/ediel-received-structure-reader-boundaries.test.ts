import { readReceivedStructuralSources } from '@/lib/ediel/utilts/receivedStructuralSources'
import { successfulUtiltsPersistenceIo } from './helpers/utiltsPersistenceIo'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest.part-2'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import * as dates from '@/lib/ediel/prodat/render/dates'
import { createHash } from 'node:crypto'
import { observationHandoffMessage, energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { raw, line, characteristic, type Parts } from './fixtures/prodat-register'

const io = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), event: vi.fn(), ack: vi.fn(), persist: vi.fn(), from: vi.fn(), scoped: vi.fn(), matches: vi.fn(), ingest: vi.fn(), allMatched: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: vi.fn() } }))
vi.mock('@/lib/supabase/tenantDb', async original => {
  const real = await original<typeof import('@/lib/supabase/tenantDb')>()
  return { ...real, tenantDb: (company: string) => { io.scoped(company); return real.tenantDb(company) } }
})
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: io.get, updateEdielMessageStatus: io.update, createEdielMessageEvent: io.event, linkEdielMessage: vi.fn() }))
vi.mock('@/lib/ediel/flows/shared', () => ({ ensureActorUserId: (id: string) => id }))
vi.mock('@/lib/onboarding/inboundEdielLinking', () => ({ findActiveMeteringPermissionForUtiltsMessage: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/ediel/utilts/transactionPersistence', async original => ({ ...await original<Record<string, unknown>>(), persistUtiltsTransactionResults: io.persist }))
vi.mock('@/lib/ediel/matching', () => ({ matchMeteringPointIdByIdentifier: vi.fn().mockResolvedValue(null), matchSiteAndCustomerForMeteringPoint: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/ediel/flows/utiltsDataRequest.part-1', async original => ({
  ...await original<Record<string, unknown>>(),
  resolveUtiltsRuntimeTestCaseCode: vi.fn().mockResolvedValue(null), matchUtiltsTransactionsForTenant: io.matches,
  linkInboundUtiltsMessageCanonically: vi.fn().mockResolvedValue({}), allUtiltsTransactionMeteringPointsMatched: io.allMatched,
  createUtiltsRuntimeAcks: io.ack, maybeIngestMeteringValue: io.ingest,
  stringOrNull: (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : null,
  ensureJson: (v: unknown) => v && typeof v === 'object' ? v : {},
}))
const point = '735999260731000007'
const secondPoint = '735999260731000014'
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
function row(id = 'source-1', meter = 'meter-tenant-a', objectId = point) {
  const body: Parts[] = [
    ['NAD', 'FR', ['91100', '160', 'SVK'], '', '', '', '', '', '', 'SE'], ['NAD', 'DO', ['21660', '160', 'SVK'], '', '', '', '', '', '', 'SE'],
    line('1', objectId, undefined, '9'), ['DTM', ['92', '202607010000', '203']], ['RFF', ['MG', 'M']], ...characteristic('Z16', '201', 3),
  ]
  const wire = raw(body)
  return { id, company_id: 'tenant-a', environment: 'test', direction: 'inbound', message_standard: 'edifact', message_family: 'PRODAT', message_code: 'Z04',
    metering_point_id: meter, raw_payload: wire, immutable_payload_hash: sha(wire), message_received_at: '2026-06-20T09:00:00Z' }
}
const matched = (transactionReference = 'GRIDEX2607E66001', externalMeteringPointId = point, meteringPointId = 'meter-tenant-a') => ({ transactionReference, externalMeteringPointId, meteringPointId, externalGridAreaId: 'TES', matchStatus: 'matched', customerId: null, siteId: null, gridOwnerId: null })
let incoming: ReturnType<typeof observationHandoffMessage>
let sourceRows: ReturnType<typeof row>[]
let dbError: unknown
let count: number
let neverResolve: boolean
const predicates: Array<[string, ...unknown[]]> = []
function query() {
  const q = {
    select: (...args: unknown[]) => { predicates.push(['select', ...args]); return q },
    eq: (...args: unknown[]) => { predicates.push(['eq', ...args]); return q },
    in: (...args: unknown[]) => { predicates.push(['in', ...args]); return q },
    lte: (...args: unknown[]) => { predicates.push(['lte', ...args]); return q },
    limit: (...args: unknown[]) => { predicates.push(['limit', ...args]); return q },
    order: (...args: unknown[]) => { predicates.push(['order', ...args]); return q },
    then: <T, U>(resolve: (r: { data: ReturnType<typeof row>[]; count: number; error: unknown }) => T | PromiseLike<T>, reject?: (reason: unknown) => U | PromiseLike<U>) => {
      const result = neverResolve ? new Promise<{ data: ReturnType<typeof row>[]; count: number; error: unknown }>(() => {}) : Promise.resolve({ data: sourceRows, count, error: dbError })
      return result.then(resolve, reject)
    },
  }
  return q
}
beforeEach(() => {
  vi.clearAllMocks(); predicates.length = 0; incoming = observationHandoffMessage(); sourceRows = [row()]; count = 1; dbError = null; neverResolve = false
  io.get.mockImplementation(async () => incoming); io.update.mockResolvedValue(null); io.event.mockResolvedValue(null)
  io.ack.mockResolvedValue(['ack-1']); io.persist.mockImplementation(successfulUtiltsPersistenceIo); io.matches.mockResolvedValue([matched()]); io.from.mockImplementation(query)
  io.allMatched.mockReturnValue(false); io.ingest.mockResolvedValue([{ id: 'value-1' }])
})
afterEach(() => { vi.useRealTimers() })
async function execute() {
  const policy = resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'E66', direction: 'inbound', referenceDate: incoming.created_at, applicationReference: '23-DDQ-E66-S', mode: 'parse' })
  return processInboundUtiltsMessage({ actorUserId: 'operator', edielMessageId: incoming.id, canonicalPolicy: policy })
}
function report(): { status: string; sources: Array<{ sourceMessageId: string }> } {
  const value = io.update.mock.calls[0][0].parsedPayload.normalizedMeteringPayload.receivedStructuralSources
  expect(value, 'the real public processor must reach the dated-source read contract').toBeDefined()
  expect(value).toMatchObject({ authorityStatus: 'not_established', selection: 'not_performed' })
  return value
}
it('uses the actual tenantDb wrapper and a hard bounded exact-count query before transaction persistence', async () => {
  await execute(); expect(report().status).toBe('inspected')
  expect(io.scoped).toHaveBeenCalledExactlyOnceWith('tenant-a')
  expect(io.from).toHaveBeenCalledExactlyOnceWith('ediel_messages')
  expect(predicates).toContainEqual(['limit', 101])
  expect(io.from.mock.invocationCallOrder[0]).toBeLessThan(io.persist.mock.invocationCallOrder[0])
})
it('batches two independently matched wire transactions into one tenant-scoped source query', async () => {
  const lines = incoming.raw_payload!.split('\n')
  const start = lines.findIndex(value => value.startsWith('IDE+'))
  const end = lines.findIndex(value => value.startsWith('UNT+'))
  const second = lines.slice(start, end).map(value => value.replaceAll(point, secondPoint).replaceAll('GRIDEX2607E66001', 'TX-2'))
  incoming.raw_payload = [...lines.slice(0, end), ...second, `UNT+${end + second.length - 1}+1'`, lines[end + 1]].join('\n')
  io.matches.mockResolvedValue([matched(), matched('TX-2', secondPoint, 'meter-2')])
  sourceRows = [row(), row('source-2', 'meter-2', secondPoint)]; count = 2
  await execute(); expect(report().sources.map(value => value.sourceMessageId).sort()).toEqual(['source-1', 'source-2'])
  expect(io.from).toHaveBeenCalledOnce()
  expect(predicates).toContainEqual(['in', 'metering_point_id', ['meter-tenant-a', 'meter-2']])
})
it('uses production as the trusted query environment without consulting a default', async () => {
  incoming.environment = 'production'; sourceRows[0].environment = 'production'
  await execute(); expect(report().sources).toHaveLength(1)
  expect(predicates).toContainEqual(['eq', 'environment', 'production'])
})
it('rejects uppercase encoding of an otherwise correct source seal', async () => {
  sourceRows[0].immutable_payload_hash = sourceRows[0].immutable_payload_hash.toUpperCase()
  await execute(); expect(report().sources).toEqual([])
})
for (const [name, mutate] of [
  ['missing MS', (text: string) => text.replace("NAD+MS+91100:SVK:260'", '')],
  ['missing MR', (text: string) => text.replace("NAD+MR+21660:SVK:260'", '')],
  ['duplicate MS', (text: string) => text.replace("NAD+MS+91100:SVK:260'", "NAD+MS+91100:SVK:260'NAD+MS+91100:SVK:260'")],
  ['duplicate MR', (text: string) => text.replace("NAD+MR+21660:SVK:260'", "NAD+MR+21660:SVK:260'NAD+MR+21660:SVK:260'")],
  ['wrong MS agency', (text: string) => text.replace('91100:SVK:260', '91100:OTHER:260')],
  ['wrong MR agency', (text: string) => text.replace('21660:SVK:260', '21660:SVK:999')],
  ['missing LOC172', (text: string) => text.replace(`LOC+172+${point}::9'`, '')],
  ['duplicate LOC172', (text: string) => text.replace(`LOC+172+${point}::9'`, `LOC+172+${point}::9'LOC+172+${point}::9'`)],
  ['ambiguous LOC agency', (text: string) => text.replace(`${point}::9`, `${point}::9:89`)],
  ['unsupported LOC agency', (text: string) => text.replace(`${point}::9`, `${point}::999`)],
  // Use the same service alphabet for both physical messages. Repeating UNA
  // instead exercises the existing upstream tokenizer rejection below.
  ['multiple physical messages', (text: string) => text + text.slice(text.startsWith('UNA') ? 9 : 0)],
] as const) it(`does not query from incoming ${name}, despite a plausible mocked match`, async () => {
  incoming.raw_payload = mutate(incoming.raw_payload!)
  if (name === 'multiple physical messages') {
    // Ambiguous physical identities now stop processing before status/ACKs.
    // Keep every source-reader boundary assertion on the identical wire.
    const evidence = await readReceivedStructuralSources({ message: incoming, transactionMatches: [{ ...matched(), matchStatus: 'matched' }] })
    expect(evidence).toBeDefined()
    expect(evidence).toMatchObject({ authorityStatus: 'not_established', selection: 'not_performed' })
    expect(evidence.status).toBe('not_requested')
  } else {
    await execute(); expect(report().status).toBe('not_requested')
  }
  expect(io.scoped).not.toHaveBeenCalled(); expect(io.from).not.toHaveBeenCalled()
})
it('does not treat a microsecond-later source receipt as an in-cutoff row', async () => {
  incoming.message_received_at = '2026-09-30T20:00:00.000001Z'
  sourceRows[0].message_received_at = '2026-09-30T20:00:00.000002Z'
  await execute(); expect(report().status).toBe('read_failed'); expect(report().sources).toEqual([])
})
it('accepts an equal receipt instant expressed using an explicit offset', async () => {
  incoming.message_received_at = '2026-09-30T20:00:00.000001Z'
  sourceRows[0].message_received_at = '2026-09-30T22:00:00.000001+02:00'
  await execute(); expect(report().sources).toHaveLength(1)
})
function withoutReader(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutReader)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'receivedStructuralSources').map(([key, item]) => [key, withoutReader(item)]))
}
async function capture() {
  for (const mock of [io.update, io.event, io.ack, io.persist, io.ingest, io.from, io.scoped]) mock.mockClear()
  const result = await execute()
  return structuredClone(withoutReader({ result, statuses: io.update.mock.calls, events: io.event.mock.calls, ack: io.ack.mock.calls, persistence: io.persist.mock.calls, ingestion: io.ingest.mock.calls }))
}
for (const path of ['rejected', 'accepted'] as const) for (const outcome of ['candidate', 'read-error', 'truncated'] as const) {
  it(`preserves all pre-existing ${path} outcomes for ${outcome} diagnostics`, async () => {
    if (path === 'accepted') { incoming = energyHandoffMessage('2026-10-01'); io.allMatched.mockReturnValue(true) }
    sourceRows = []; count = 0
    const baseline = await capture()
    expect(io.persist).toHaveBeenCalledOnce()
    expect(io.update.mock.calls.map(([call]) => call.status)).toEqual(['parsed', 'validated'])
    expect(io.ack.mock.calls[0][0].ackPlan.utiltsErrCodes.includes('E19')).toBe(path === 'rejected')
    expect(io.ingest).toHaveBeenCalledTimes(path === 'accepted' ? 1 : 0)
    if (outcome === 'candidate') { sourceRows = [row()]; count = 1 }
    if (outcome === 'read-error') dbError = { message: 'PRIVATE DB ERROR' }
    if (outcome === 'truncated') { sourceRows = [row()]; count = 2 }
    const actual = await capture()
    expect(actual).toEqual(baseline)
    expect(report().status).toBe(outcome === 'candidate' ? 'inspected' : outcome === 'read-error' ? 'read_failed' : 'incomplete')
  })
}
it('bounds a never-resolving diagnostic read without delaying the existing rejection indefinitely', async () => {
  vi.useFakeTimers(); neverResolve = true
  const result = execute()
  await vi.waitFor(() => expect(io.from).toHaveBeenCalledOnce())
  await vi.advanceTimersByTimeAsync(2100)
  await result
  expect(report().status).toBe('read_failed')
  expect(io.persist).toHaveBeenCalledOnce(); expect(io.ack).toHaveBeenCalledOnce()
})
it('keeps exact market-minute to UTC conversion in the existing PRODAT date owner', () => {
  const convert = (dates as unknown as { prodatMarketMinuteToUtc?: (v: string) => string | null }).prodatMarketMinuteToUtc
  expect(convert, 'existing date owner must expose the strict inverse').toBeTypeOf('function')
  for (const [input, expected] of [
    ['202607010000', '2026-06-30T23:00:00.000Z'], ['202612010835', '2026-12-01T07:35:00.000Z'],
    ['200002290015', '2000-02-28T23:15:00.000Z'], ['000101010000', '0000-12-31T23:00:00.000Z'],
  ]) expect(convert!(input)).toBe(expected)
  for (const input of ['', '202602300000', '190002290000', '202601012400', ' 202607010000', '20260701000000']) expect(convert!(input)).toBeNull()
  const oldTimezone = process.env.TZ
  try {
    for (const timezone of ['UTC', 'Europe/Stockholm', 'America/New_York']) {
      process.env.TZ = timezone
      expect(convert!('202607010000')).toBe('2026-06-30T23:00:00.000Z')
    }
  } finally { if (oldTimezone === undefined) delete process.env.TZ; else process.env.TZ = oldTimezone }
})
it('retains upstream rejection of the original repeated-UNA fixture without any source query or side effects', async () => {
  incoming.raw_payload = incoming.raw_payload! + incoming.raw_payload!
  await expect(execute()).rejects.toThrow('edifact_dangling_release_character')
  for (const mock of [io.scoped, io.from, io.update, io.event, io.persist, io.ack, io.ingest]) expect(mock).not.toHaveBeenCalled()
})
