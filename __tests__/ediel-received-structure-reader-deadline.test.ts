import { successfulUtiltsPersistenceIo } from './helpers/utiltsPersistenceIo'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest.part-2'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { observationHandoffMessage } from './helpers/utiltsObservationHandoff'
import { raw, line, characteristic } from './fixtures/prodat-register'
const io = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), event: vi.fn(), ack: vi.fn(), persist: vi.fn(), from: vi.fn(), matches: vi.fn(), ingest: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: vi.fn() } }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: io.get, updateEdielMessageStatus: io.update, createEdielMessageEvent: io.event, linkEdielMessage: vi.fn() }))
vi.mock('@/lib/ediel/flows/shared', () => ({ ensureActorUserId: (id: string) => id }))
vi.mock('@/lib/onboarding/inboundEdielLinking', () => ({ findActiveMeteringPermissionForUtiltsMessage: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/ediel/utilts/transactionPersistence', async original => ({ ...await original<Record<string, unknown>>(), persistUtiltsTransactionResults: io.persist }))
vi.mock('@/lib/ediel/flows/utiltsDataRequest.part-1', () => ({
  resolveUtiltsRuntimeTestCaseCode: vi.fn().mockResolvedValue(null), matchUtiltsTransactionsForTenant: io.matches,
  linkInboundUtiltsMessageCanonically: vi.fn().mockResolvedValue({}), allUtiltsTransactionMeteringPointsMatched: vi.fn().mockReturnValue(false),
  createUtiltsRuntimeAcks: io.ack, maybeIngestMeteringValue: io.ingest,
  stringOrNull: (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : null,
  ensureJson: (v: unknown) => v && typeof v === 'object' ? v : {},
}))
const point = '735999260731000007'
type Result = { data: Record<string, unknown>[]; count: number; error: null }
let incoming: ReturnType<typeof observationHandoffMessage>
let response: Promise<Result>
const predicates: Array<[string, ...unknown[]]> = []
function query() {
  const q = {
    select: (...a: unknown[]) => { predicates.push(['select', ...a]); return q },
    eq: (...a: unknown[]) => { predicates.push(['eq', ...a]); return q },
    in: (...a: unknown[]) => { predicates.push(['in', ...a]); return q },
    lte: (...a: unknown[]) => { predicates.push(['lte', ...a]); return q },
    limit: (...a: unknown[]) => { predicates.push(['limit', ...a]); return q },
    order: (...a: unknown[]) => { predicates.push(['order', ...a]); return q },
    then: <T, U>(resolve: (r: Result) => T | PromiseLike<T>, reject?: (e: unknown) => U | PromiseLike<U>) => response.then(resolve, reject),
  }
  return q
}
beforeEach(() => {
  vi.clearAllMocks(); predicates.length = 0; incoming = observationHandoffMessage(); response = Promise.resolve({ data: [], count: 0, error: null })
  io.get.mockImplementation(async () => incoming); io.update.mockResolvedValue(null); io.event.mockResolvedValue(null); io.ack.mockResolvedValue(['ack-1']); io.persist.mockImplementation(successfulUtiltsPersistenceIo); io.from.mockImplementation(query)
  io.matches.mockResolvedValue([{ transactionReference: 'GRIDEX2607E66001', externalMeteringPointId: point, externalGridAreaId: 'TES', meteringPointId: 'meter-tenant-a', matchStatus: 'matched', customerId: null, siteId: null, gridOwnerId: null }])
})
afterEach(() => vi.useRealTimers())
function execute() {
  const canonicalPolicy = resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'E66', direction: 'inbound', referenceDate: incoming.created_at, applicationReference: '23-DDQ-E66-S', mode: 'parse' })
  return processInboundUtiltsMessage({ actorUserId: 'operator', edielMessageId: incoming.id, canonicalPolicy })
}
function calls() { return structuredClone([io.update.mock.calls, io.event.mock.calls, io.persist.mock.calls, io.ack.mock.calls, io.ingest.mock.calls]) }
it.each(['2026-09-30T20:00:00.000001Z', '2026-09-30T22:00:00.000001+02:00'])('preserves literal microsecond database cutoff %s', async timestamp => {
  incoming.message_received_at = timestamp
  await execute()
  expect(io.from).toHaveBeenCalledExactlyOnceWith('ediel_messages')
  expect(predicates).toContainEqual(['lte', 'message_received_at', timestamp])
})
it('discards a valid delayed query response without any late diagnostic or business write', async () => {
  vi.useFakeTimers()
  let finish!: (r: Result) => void
  response = new Promise<Result>(resolve => { finish = resolve })
  const pending = execute()
  await vi.waitFor(() => expect(io.from).toHaveBeenCalledOnce())
  await vi.advanceTimersByTimeAsync(2100)
  await pending
  const report = io.update.mock.calls[0][0].parsedPayload.normalizedMeteringPayload.receivedStructuralSources
  expect(report).toMatchObject({ status: 'read_failed', sources: [], authorityStatus: 'not_established', selection: 'not_performed' })
  const before = calls()
  const source = raw([
    ['NAD', 'FR', ['91100', '160', 'SVK']], ['NAD', 'DO', ['21660', '160', 'SVK']],
    line('1', point, undefined, '9'), ['DTM', ['92', '202607010000', '203']], ['RFF', ['MG', 'M']], ...characteristic('Z16', '201', 3),
  ])
  finish({ data: [{ id: 'late-source', company_id: 'tenant-a', environment: 'test', direction: 'inbound', message_standard: 'edifact', message_family: 'PRODAT', message_code: 'Z04', metering_point_id: 'meter-tenant-a', message_received_at: '2026-06-20T09:00:00Z', raw_payload: source, immutable_payload_hash: createHash('sha256').update(source, 'utf8').digest('hex') }], count: 1, error: null })
  await vi.runAllTimersAsync()
  await Promise.resolve()
  expect(calls()).toEqual(before)
  for (const [call] of io.update.mock.calls) expect(call.parsedPayload.normalizedMeteringPayload.receivedStructuralSources).toEqual(report)
  expect(io.persist).toHaveBeenCalledOnce(); expect(io.ack).toHaveBeenCalledOnce()
})
