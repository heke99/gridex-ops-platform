import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type Phase = 'claim' | 'finish'
const io = vi.hoisted(() => ({
  jobs: [] as Row[], enqueue: vi.fn(), beforeClaim: undefined as (() => void) | undefined,
  beforeFinish: undefined as (() => void) | undefined, fail: undefined as Phase | undefined,
  omitClaimField: undefined as string | undefined, persistedTimestamp: undefined as string | undefined,
}))

// Only DB and enqueue ports are synthetic. Predicates execute against current
// mutable rows, and SELECT returns projected snapshots of the committed row.
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let patch: Row | undefined
  let selection = '*'
  let single = false
  let maximum = Infinity
  const query = {
    select(value = '*') { selection = value; return query },
    update(value: Row) { patch = value; return query },
    eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query },
    in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return query },
    lt(key: string, value: string) { filters.push(row => row[key] != null && String(row[key]) < value); return query },
    lte(key: string, value: string) { filters.push(row => row[key] != null && String(row[key]) <= value); return query },
    order() { return query },
    limit(value: number) { maximum = value; return query },
    maybeSingle() { single = true; return query },
    single() { single = true; return query },
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.resolve().then(() => {
        if (table === 'domain_events') return { data: { id: 'event-1', company_id: 'company-1' }, error: null }
        if (table !== 'event_outbox') throw new Error(`Unexpected table ${table}`)
        const phase = patch?.status === 'processing' ? 'claim' : patch && patch.last_error !== 'webhook_fanout_recovered_after_stale_processing_lock' ? 'finish' : undefined
        if (phase === 'claim') io.beforeClaim?.()
        if (phase === 'finish') io.beforeFinish?.()
        if (phase && io.fail === phase) return { data: null, error: new Error(`synthetic ${phase} database failure`) }
        const rows = io.jobs.filter(row => filters.every(filter => filter(row))).slice(0, maximum)
        if (patch) rows.forEach(row => Object.assign(row, structuredClone(patch)))
        if (phase === 'claim' && io.persistedTimestamp) rows.forEach(row => { row.locked_at = io.persistedTimestamp })
        const snapshots = rows.map(row => selection === '*' ? structuredClone(row)
          : Object.fromEntries(selection.split(',').map(key => [key, structuredClone(row[key])])))
        if (phase === 'claim' && io.omitClaimField) snapshots.forEach(row => { delete row[io.omitClaimField!] })
        return { data: single ? snapshots[0] ?? null : snapshots, error: null }
      }).then(resolve, reject)
    },
  }
  return query
} } }))
vi.mock('@/lib/integrations/webhooks', () => ({ enqueueWebhookDeliveriesForEvent: io.enqueue }))

import { processDomainEventWebhookFanout } from '@/lib/events/domainEvents'

const now = new Date('2026-10-20T12:00:00.000Z')
const job = (): Row => ({ id: 'job-1', company_id: 'company-1', domain_event_id: 'event-1',
  destination_type: 'webhook', destination_key: 'webhook_fanout_v1', status: 'queued',
  attempts: 0, max_attempts: 5, available_at: '2026-10-20T11:00:00.000Z',
  locked_by: null, locked_at: null, last_error: null, payload: { original: true } })
function deferred() {
  let resolve!: (value: number) => void
  let reject!: (error: Error) => void
  const promise = new Promise<number>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function untilEnqueued(count: number) {
  for (let turn = 0; turn < 40; turn += 1) {
    if (io.enqueue.mock.calls.length === count) return
    await Promise.resolve()
  }
  throw new Error('finite fixture did not reach enqueue boundary')
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  io.jobs = [job()]; io.beforeClaim = undefined; io.beforeFinish = undefined
  io.fail = undefined; io.omitClaimField = undefined; io.persistedTimestamp = undefined
  io.enqueue.mockReset().mockResolvedValue(2)
})
afterEach(() => vi.useRealTimers())

describe('actual domain-event fanout claim ownership', () => {
  it.each(['success', 'throw'] as const)('stale A %s cannot complete or fail the replacement B lease', async outcome => {
    const a = deferred(); const b = deferred()
    io.enqueue.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const runA = processDomainEventWebhookFanout()
    await untilEnqueued(1)
    const ownerA = io.jobs[0].locked_by
    vi.setSystemTime(new Date(now.getTime() + 16 * 60_000))
    const runB = processDomainEventWebhookFanout()
    await untilEnqueued(2)
    const replacement = structuredClone(io.jobs[0])
    if (outcome === 'success') a.resolve(1)
    else a.reject(new Error('synthetic stale enqueue failure'))
    expect(await runA).toEqual({ processed: 1, completed: 0, failed: 0 })
    expect(io.jobs[0]).toEqual(replacement)
    expect(replacement.locked_by).not.toBe(ownerA)
    b.resolve(2)
    expect(await runB).toEqual({ processed: 1, completed: 1, failed: 0 })
    expect(io.jobs[0]).toMatchObject({ status: 'sent', attempts: 1, locked_at: null, locked_by: null, payload: { delivery_count: 2 } })
  })

  it('uses a unique UUID for each acquisition even with the same application clock', async () => {
    io.jobs.push({ ...job(), id: 'job-2' })
    const owners: unknown[] = []
    io.enqueue.mockImplementation(async () => { owners.push(io.jobs.find(row => row.status === 'processing')?.locked_by); return 0 })
    expect(await processDomainEventWebhookFanout()).toEqual({ processed: 2, completed: 2, failed: 0 })
    expect(new Set(owners).size).toBe(2)
    for (const owner of owners) expect(owner).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  describe.each(['success', 'throw'] as const)('%s finalization', outcome => {
    it.each(['locked_by', 'locked_at', 'status'] as const)('requires the exact claimed %s', async field => {
      io.enqueue.mockImplementation(async () => {
        io.jobs[0][field] = field === 'status' ? 'failed' : field === 'locked_by' ? 'replacement-owner' : '2026-10-20T12:01:00.000Z'
        if (outcome === 'throw') throw new Error('synthetic enqueue failure after lease changed')
        return 3
      })
      const result = await processDomainEventWebhookFanout()
      expect(result).toEqual({ processed: 1, completed: 0, failed: 0 })
      expect(io.jobs[0][field]).toBe(field === 'status' ? 'failed' : field === 'locked_by' ? 'replacement-owner' : '2026-10-20T12:01:00.000Z')
    })
  })

  it('keeps the exact persisted claim timestamp instead of reconstructing it', async () => {
    io.persistedTimestamp = '2026-10-20T12:00:00.123456Z'
    expect(await processDomainEventWebhookFanout()).toEqual({ processed: 1, completed: 1, failed: 0 })
    expect(io.jobs[0].status).toBe('sent')
  })

  it('uses attempts and maximum from the actual claimed row rather than an older listing', async () => {
    io.beforeClaim = () => { io.jobs[0].attempts = 4; io.jobs[0].max_attempts = 5 }
    io.enqueue.mockRejectedValue(new Error('synthetic enqueue failure'))
    expect(await processDomainEventWebhookFanout()).toEqual({ processed: 1, completed: 0, failed: 1 })
    expect(io.jobs[0]).toMatchObject({ status: 'dead_letter', attempts: 5, failed_at: now.toISOString() })
  })

  it.each(['locked_by', 'locked_at'])('fails closed before enqueue when returned receipt lacks %s', async field => {
    io.omitClaimField = field
    await expect(processDomainEventWebhookFanout()).rejects.toThrow('webhook_fanout_claim_invalid')
    expect(io.enqueue).not.toHaveBeenCalled()
  })

  it('does not count a successful completion when the affected row disappeared', async () => {
    io.enqueue.mockImplementation(async () => { io.jobs = []; return 2 })
    expect(await processDomainEventWebhookFanout()).toEqual({ processed: 1, completed: 0, failed: 0 })
  })

  it.each(['claim', 'finish'] as const)('surfaces a %s database error instead of claiming completion', async phase => {
    io.fail = phase
    await expect(processDomainEventWebhookFanout()).rejects.toThrow(`synthetic ${phase} database failure`)
    expect(io.jobs[0].status).toBe(phase === 'claim' ? 'queued' : 'processing')
    if (phase === 'claim') expect(io.enqueue).not.toHaveBeenCalled()
  })

  it('preserves strict fast-path eventId errors after recording its own retry state', async () => {
    const error = new Error('synthetic strict enqueue failure')
    io.enqueue.mockRejectedValue(error)
    await expect(processDomainEventWebhookFanout({ eventId: 'event-1' })).rejects.toBe(error)
    expect(io.jobs[0]).toMatchObject({ status: 'failed', attempts: 1, available_at: '2026-10-20T12:00:30.000Z', last_error: error.message, locked_at: null, locked_by: null })
  })

  it('preserves a stale fast-path error while leaving B ownership untouched', async () => {
    const a = deferred(); const b = deferred()
    const error = new Error('synthetic strict stale enqueue failure')
    io.enqueue.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const runA = processDomainEventWebhookFanout({ eventId: 'event-1' })
    await untilEnqueued(1)
    vi.setSystemTime(new Date(now.getTime() + 16 * 60_000))
    const runB = processDomainEventWebhookFanout()
    await untilEnqueued(2)
    const replacement = structuredClone(io.jobs[0])
    a.reject(error)
    await expect(runA).rejects.toBe(error)
    expect(io.jobs[0]).toEqual(replacement)
    b.resolve(1)
    expect(await runB).toEqual({ processed: 1, completed: 1, failed: 0 })
  })

  it('keeps a live processing lease ineligible until the existing stale interval elapses', async () => {
    io.jobs[0] = { ...job(), status: 'processing', locked_by: 'existing-owner', locked_at: now.toISOString() }
    const original = structuredClone(io.jobs[0])
    expect(await processDomainEventWebhookFanout()).toEqual({ processed: 0, completed: 0, failed: 0 })
    expect(io.jobs[0]).toEqual(original)
    expect(io.enqueue).not.toHaveBeenCalled()
  })

  it('does not claim a listed job whose retry was postponed before the actual claim', async () => {
    let postponed: Row | undefined
    io.beforeClaim = () => {
      io.beforeClaim = undefined
      Object.assign(io.jobs[0], { status: 'failed', attempts: 2,
        available_at: '2026-10-20T12:30:00.000Z', last_error: 'synthetic newer retry decision' })
      postponed = structuredClone(io.jobs[0])
    }
    expect(await processDomainEventWebhookFanout()).toEqual({ processed: 0, completed: 0, failed: 0 })
    expect(io.enqueue).not.toHaveBeenCalled()
    expect(io.jobs[0]).toEqual(postponed)
  })
})
