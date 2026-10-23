// reality-defects: P8 (the outbox cron sent one batch of 25 per run across every company)
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; status: string }
const io = vi.hoisted(() => ({ queue: [] as Row[], requeue: new Set<string>(), calls: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/ediel/outbox/processEdielOutbox', () => ({
  // The claim takes the oldest `limit` claimable rows; a sent row leaves the queue, a requeued one stays.
  processEdielOutbox: async (params: { limit?: number; environment?: string | null; companyId?: string | null }) => {
    io.calls.push(params)
    const batch = io.queue.slice(0, params.limit ?? 25)
    io.queue = io.queue.slice(batch.length).concat(batch.filter(row => io.requeue.has(row.id)))
    const results = batch.map(row => ({ id: row.id, status: row.status }))
    return { processed: results.length, sent: results.filter(r => r.status === 'sent').length, failed: results.filter(r => r.status === 'failed').length,
      blocked: results.filter(r => r.status === 'blocked').length, deliveryUncertain: 0, results }
  },
}))

vi.mock('@/lib/ediel/companyCertifiedScopes', () => ({ recordCompanyCertifiedScopes: async () => ({ status: 'ran' }) }))
vi.mock('@/lib/ediel/automationActor', () => ({ resolveConfiguredEdielAutomationActorId: async () => 'automation-actor' }))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/ediel/outbox/process/route'
import { drainEdielOutbox } from '@/lib/ediel/outbox/drainEdielOutbox'

const rows = (n: number, prefix: string, status = 'sent') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}`, status }))

beforeEach(() => { io.queue = []; io.requeue = new Set(); io.calls = []; vi.stubEnv('CRON_SECRET', 'cron-secret') })

describe('P8 the outbox cron drains the queue, not one batch', () => {
  it("another company's 59 rows no longer hold back the tenant's 37 replies to the next run", async () => {
    io.queue = [...rows(25, 'other', 'blocked'), ...rows(34, 'test-lane', 'failed'), ...rows(37, 'tenant')]
    const run = await drainEdielOutbox({ actorUserId: 'automation', environment: null })
    expect(io.queue).toEqual([])
    expect(run).toMatchObject({ processed: 96, sent: 37, blocked: 25, failed: 34, batches: 4, stoppedBy: 'queue_empty' })
    expect(run.results.filter(r => String(r.id).startsWith('tenant'))).toHaveLength(37)
    // Every batch goes through the ordinary claim with the run's lane and the platform-wide scope.
    expect(io.calls.every(call => call.limit === 25 && call.companyId === null && call.environment === null)).toBe(true)
  })

  it('an exactly full batch claims once more and stops on the empty queue', async () => {
    io.queue = rows(25, 'tenant')
    const run = await drainEdielOutbox({ actorUserId: 'automation', environment: 'production' })
    expect(run).toMatchObject({ processed: 25, batches: 2, stoppedBy: 'queue_empty' })
    expect(io.calls.map(call => call.environment)).toEqual(['production', 'production'])
  })

  it('the time budget ends the run; the rest waits for the next run', async () => {
    io.queue = rows(200, 'tenant')
    // Each clock read advances 20 s: the run starts at 20 s and checks after each batch at 40, 60 and 80 s.
    let clock = 0
    const run = await drainEdielOutbox({ actorUserId: 'automation', budgetMs: 45_000, now: () => (clock += 20_000) })
    expect(run).toMatchObject({ batches: 3, processed: 75, stoppedBy: 'budget' })
    expect(io.queue).toHaveLength(125)
  })

  it('rows requeued by their own send are not retried in a tight loop', async () => {
    io.queue = rows(25, 'retry', 'queued')
    io.requeue = new Set(io.queue.map(row => row.id))
    const run = await drainEdielOutbox({ actorUserId: 'automation' })
    expect(run).toMatchObject({ batches: 2, stoppedBy: 'repeated_rows' })
  })

  it('the batch count is bounded', async () => {
    io.queue = rows(10_000, 'tenant')
    const run = await drainEdielOutbox({ actorUserId: 'automation', maxBatches: 3, budgetMs: Infinity })
    expect(run).toMatchObject({ batches: 3, processed: 75, stoppedBy: 'max_batches' })
  })
})

describe('P8 the scheduled outbox route', () => {
  it('one Vercel run sends the whole queue of 60 replies, every 5 minutes', async () => {
    io.queue = rows(60, 'tenant')
    const response = await GET(new NextRequest('http://localhost/api/ediel/outbox/process', { headers: { authorization: 'Bearer cron-secret' } }))
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, result: { processed: 60, sent: 60, stoppedBy: 'queue_empty' } })
    expect(io.queue).toEqual([])
  })
})
