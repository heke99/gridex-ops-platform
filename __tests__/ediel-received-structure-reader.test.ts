import { readReceivedStructuralSources } from '@/lib/ediel/utilts/receivedStructuralSources'
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
it('loads independent sealed Z04 bytes through the real processor, not incoming or cached registers', async () => {
  const report = await run()
  expect(report.status).toBe('inspected'); expect(report.issues).toEqual([])
  expect(report.sources).toEqual([expect.objectContaining({ sourceMessageId: 'source-1', sourcePayloadHash: rows[0].immutable_payload_hash,
    meteringPointId: 'meter-tenant-a', objectId: point, identityAgency: '9', legalSenderId: '91100', legalReceiverId: '21660', messageCode: 'Z04',
    effectiveFrom: { fieldNumber: '210', marketMinute: '202607010000', utc: '2026-06-30T23:00:00.000Z' },
    meterNumber: 'SOURCE-METER', registers: [{ sourceOrder: 0, registerIndex: null, registerId: '201' }], acceptance: 'not_checked' })])
  const serialized = JSON.stringify(report)
  for (const privateValue of ['CACHED-WRONG', 'PRIVATE', 'UNB', 'M-GRIDEX-2607-01']) expect(serialized).not.toContain(privateValue)
  expect(io.from).toHaveBeenCalledExactlyOnceWith('ediel_messages')
  expect(queryCalls).toContainEqual(['eq', 'company_id', 'tenant-a'])
  expect(queryCalls).toContainEqual(['eq', 'environment', 'test'])
  expect(queryCalls).toContainEqual(['eq', 'direction', 'inbound'])
  expect(queryCalls).toContainEqual(['eq', 'message_standard', 'edifact'])
  expect(queryCalls).toContainEqual(['eq', 'message_family', 'PRODAT'])
  expect(queryCalls).toContainEqual(['in', 'metering_point_id', ['meter-tenant-a']])
  expect(queryCalls).toContainEqual(['lte', 'message_received_at', incoming.message_received_at])
  expect(queryCalls.find(([name]) => name === 'select')?.[2]).toEqual({ count: 'exact' })
})
it.each(['Z06', 'Z10'])('uses %s change validity, never later contract start or receipt date', async code => {
  rows = [source(code, '', [line('1', point, undefined, '9'), ['DTM', ['157', '202606080835', '203']], ['DTM', ['92', '202607010000', '203']],
    ['RFF', ['MG', 'NEW']], ['RFF', ['Z02', 'OLD']], ...characteristic('Z16', '202', 3)])]
  const report = await run()
  expect(report.sources[0]).toMatchObject({ messageCode: code, effectiveFrom: { fieldNumber: '216', marketMinute: '202606080835', utc: '2026-06-08T07:35:00.000Z' }, meterNumber: 'NEW', oldMeterNumber: 'OLD', contractStartMinute: '202607010000' })
})
it.each(alphabets)('uses the existing release-aware parser for alphabet %j', async (...alphabet) => {
  rows = [source('Z04', '', [line('1', point, undefined, '9'), ['DTM', ['92', '202607010000', '203']], ['RFF', ['MG', "M:+*;?!~^|%'001"]], ...characteristic('Z16', '00201', 3)], alphabet)]
  const report = await run()
  expect(report.sources[0]).toMatchObject({ meterNumber: "M:+*;?!~^|%'001", registers: [{ sourceOrder: 0, registerIndex: null, registerId: '00201' }] })
})
it('keeps each physical register without inheriting register-local identities', async () => {
  rows = [source('Z04', '', [line('1', point, '1', '9'), ['DTM', ['92', '202607010000', '203']], ['RFF', ['MG', 'M']], ...characteristic('Z16', '201', 3),
    line('2', point, '2', '9'), ...characteristic('Z16', '202', 3)])]
  expect((await run()).sources[0]).toMatchObject({ registers: [{ sourceOrder: 0, registerIndex: '1', registerId: '201' }, { sourceOrder: 1, registerIndex: '2', registerId: '202' }] })
})
it('retains incomplete Z06 field evidence without borrowing an incoming meter or register', async () => {
  rows = [source('Z06', '', [line('1', point, undefined, '9'), ['DTM', ['157', '202608010000', '203']]])]
  expect((await run()).sources[0]).toMatchObject({ meterNumber: null, registers: [{ sourceOrder: 0, registerIndex: null, registerId: null }], acceptance: 'not_checked' })
})
it('does not select a latest candidate, discard equal dates or use receipt order as supersession', async () => {
  rows = [source('Z10', '202612010000'), { ...source(), id: 'source-2' }, { ...source(), id: 'source-3' }]; count = 3
  const report = await run()
  expect(report.sources).toHaveLength(3)
  expect(report.sources.map(item => item.sourceMessageId).sort()).toEqual(['source-1', 'source-2', 'source-3'])
  expect(report.selection).toBe('not_performed')
})
it.each([
  ['company_id', 'tenant-b'], ['environment', 'production'], ['metering_point_id', 'other-point'],
  ['direction', 'outbound'], ['message_family', 'UTILTS'], ['message_standard', 'xml'], ['message_received_at', '2026-10-01T00:00:00Z'],
])('rejects an out-of-query-scope response for %s without returning its ID', async (key, value) => {
  rows = [{ ...source(), id: 'DO-NOT-EXPOSE', [key]: value }]
  const report = await run()
  expect(report.status).toBe('read_failed'); expect(report.sources).toEqual([])
  expect(JSON.stringify(report)).not.toContain('DO-NOT-EXPOSE')
})
it.each([null, '', '0'.repeat(64)])('does not promote absent or forged hash %j', async value => {
  rows[0].immutable_payload_hash = value
  const report = await run(); expect(report.sources).toEqual([])
  expect(report.issues).toContainEqual({ code: 'source_integrity_unavailable', sourceMessageId: 'source-1' })
})
it('does not trust valid-looking parsed JSON after a raw-byte mismatch', async () => {
  rows[0].raw_payload = `${rows[0].raw_payload} `
  expect((await run()).sources).toEqual([])
})
it.each([
  ['wrong legal actor', (value: string) => value.replace('91100:160:SVK', '91101:160:SVK')],
  ['wrong receiver', (value: string) => value.replace('21660:160:SVK', '21661:160:SVK')],
  ['wrong object agency', (value: string) => value.replace(`${point}:::9`, `${point}:::89`)],
  ['duplicate legal actor', (value: string) => value.replace('NAD+FR', 'NAD+FR+91100:160:SVK\'NAD+FR')],
  ['wrong legal code agency', (value: string) => value.replace('91100:160:SVK', '91100:160:OTHER')],
  ['another physical message', (value: string) => value + wire()],
  ['wrong actual family', (value: string) => value.replace('PRODAT:D:97A', 'UTILTS:D:97A')],
])('excludes %s despite correct hash and row labels', async (_name, alter) => {
  const value = (alter as (value: string) => string)(String(rows[0].raw_payload))
  rows[0].raw_payload = value; rows[0].immutable_payload_hash = hash(value)
  expect((await run()).sources).toEqual([])
})
it.each(['202602300000', '202607012400', '2026070100', ''])('never substitutes created/received time for invalid effective minute %j', async date => {
  rows = [source('Z04', date)]
  const report = await run(); expect(report.sources).toEqual([])
  expect(report.issues).toContainEqual({ code: 'source_effective_date_unavailable', sourceMessageId: 'source-1' })
})
it('does not borrow the other object date', async () => {
  rows = [source('Z04', '', [line('1', 'OTHER', undefined, '89'), ['DTM', ['92', '202607010000', '203']], line('2', point, undefined, '9'), ['RFF', ['MG', 'M']]])]
  expect((await run()).sources).toEqual([])
})
it('does not choose the first of duplicate effective date fields', async () => {
  rows = [source('Z04', '', [line('1', point, undefined, '9'), ['DTM', ['92', '202607010000', '203']], ['DTM', ['92', '202608010000', '203']]])]
  expect((await run()).sources).toEqual([])
})
it.each([null, 2, 101])('returns incomplete, not a selected prefix, when exact query count is %j', async total => {
  count = total
  const report = await run(); expect(report.status).toBe('incomplete'); expect(report.sources).toEqual([])
})
it('rejects duplicate row IDs rather than inventing two versions', async () => {
  rows = [source(), source()]; count = 2
  const report = await run(); expect(report.status).toBe('incomplete'); expect(report.sources).toEqual([])
})
it('represents an empty result as missing authority, not a valid zero-register inventory', async () => {
  rows = []; count = 0
  const report = await run(); expect(report.status).toBe('inspected'); expect(report.sources).toEqual([])
  expect(report.authorityStatus).toBe('not_established')
})
it.each(['response', 'throw'])('keeps %s read failure diagnostic-only and redacts database details', async kind => {
  if (kind === 'response') dbError = { message: 'PRIVATE DATABASE VALUE' }
  else io.from.mockImplementation(() => { throw new Error('PRIVATE DATABASE VALUE') })
  const report = await run(); expect(report.status).toBe('read_failed'); expect(report.sources).toEqual([])
  expect(JSON.stringify(report)).not.toContain('PRIVATE')
  expect(io.persist).toHaveBeenCalled()
})
it('does not use cached diagnostic authority in a reprocessed message', async () => {
  incoming.parsed_payload = { normalizedMeteringPayload: { receivedStructuralSources: { authorityStatus: 'accepted', sources: ['STALE'] } } }
  const report = await run(); expect(JSON.stringify(report)).not.toContain('STALE')
  expect(incoming.parsed_payload.normalizedMeteringPayload).toEqual({ receivedStructuralSources: { authorityStatus: 'accepted', sources: ['STALE'] } })
})
it.each(['unmatched', 'wrong-wire-id', 'ambiguous'])('does not query from a %s match', async kind => {
  io.matches.mockResolvedValue(kind === 'ambiguous' ? [match(), match({ meteringPointId: 'other' })] : [match(kind === 'unmatched' ? { matchStatus: 'unmatched' } : { externalMeteringPointId: 'OTHER' })])
  const report = await run(); expect(report.status).toBe('not_requested'); expect(io.from).not.toHaveBeenCalled()
})
it('does not query when the original receipt timestamp is absent', async () => {
  incoming.message_received_at = null
  const report = await run(); expect(report.status).toBe('not_requested'); expect(io.from).not.toHaveBeenCalled()
})
it('does not query without a trusted company even when cached point links exist', async () => {
  incoming.company_id = null
  // Preserve the reader's diagnostic contract directly. The processor now stops
  // this missing-tenant persistence contract before any ACK (covered separately).
  const report = await readReceivedStructuralSources({ message: incoming, transactionMatches: [{ ...match(), matchStatus: 'matched' }] })
  expect(report.status).toBe('not_requested'); expect(io.from).not.toHaveBeenCalled()
  expect(report).toMatchObject({ version: 1, authorityStatus: 'not_established', selection: 'not_performed' })
  expect(report.issues.map(issue => issue.code)).not.toContain('E61')
  expect(report.issues.map(issue => issue.code)).not.toContain('E62')
})
