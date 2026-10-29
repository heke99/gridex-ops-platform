// reality-defects: P8 (the outbox cron sent one batch of 25 per run across every company)
// Main's hardened drain (3d08d112c) owns the budget, requeue and batch-bound cases in
// __tests__/ediel-outbox-drain-budget-progress.test.ts; this file keeps the scenario P8 was found in.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; status: string }
const io = vi.hoisted(() => ({ queue: [] as Row[], calls: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/ediel/outbox/processEdielOutbox', () => ({
  // processEdielOutbox's contract: claims one row at a time up to `limit`, reports `claimed`, and stops on an empty
  // queue or a row this drain already handled (`seenIds`). A sent row leaves the queue.
  processEdielOutbox: async (params: { limit?: number; environment?: string | null; companyId?: string | null; seenIds?: ReadonlySet<string> }) => {
    io.calls.push(params)
    const limit = params.limit ?? 25
    const run = { claimed: 0, processed: 0, sent: 0, failed: 0, blocked: 0, deliveryUncertain: 0, results: [] as Array<Record<string, unknown>>, stoppedBy: null as string | null }
    while (run.claimed < limit) {
      const row = io.queue.shift()
      if (!row) { run.stoppedBy = 'queue_empty'; break }
      run.claimed += 1
      if (params.seenIds?.has(row.id)) { io.queue.unshift(row); run.stoppedBy = 'repeated_rows'; return run }
      run.results.push({ id: row.id, status: row.status })
      run.processed += 1
      if (row.status === 'sent') run.sent += 1
      if (row.status === 'failed') run.failed += 1
      if (row.status === 'blocked') run.blocked += 1
    }
    return run
  },
}))
vi.mock('@/lib/ediel/companyCertifiedScopes', () => ({ recordCompanyCertifiedScopes: async () => ({ status: 'ran' }) }))
vi.mock('@/lib/ediel/automationActor', () => ({ resolveConfiguredEdielAutomationActorId: async () => 'automation-actor' }))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/ediel/outbox/process/route'
import { drainEdielOutbox } from '@/lib/ediel/outbox/drainEdielOutbox'

const rows = (n: number, prefix: string, status = 'sent') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}`, status }))

beforeEach(() => { io.queue = []; io.calls = []; vi.stubEnv('CRON_SECRET', 'cron-secret') })

describe('P8 the outbox cron drains the queue, not one batch', () => {
  it("another company's 59 rows no longer hold back the tenant's 37 replies to the next run", async () => {
    io.queue = [...rows(25, 'other', 'blocked'), ...rows(34, 'test-lane', 'failed'), ...rows(37, 'tenant')]
    const run = await drainEdielOutbox({ actorUserId: 'automation', environment: null })
    expect(io.queue).toEqual([])
    expect(run).toMatchObject({ processed: 96, sent: 37, blocked: 25, failed: 34, stoppedBy: 'queue_empty' })
    expect(run.results.filter(r => String(r.id).startsWith('tenant'))).toHaveLength(37)
    // Every batch goes through the ordinary claim with the run's lane and the platform-wide scope.
    expect(io.calls.every(call => call.companyId === null && call.environment === null)).toBe(true)
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
