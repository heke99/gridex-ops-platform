// claim_inbound_processing_jobs increments attempts_count when it claims a job
// (including a stale `processing` reclaim after a killed run). The processor
// added one more, so only 4 of EDIEL_INBOUND_MAX_JOB_ATTEMPTS=5 ran, and a job
// that kept killing the function was reclaimed every 15 minutes forever.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ claimed: [] as Array<Record<string, unknown>>, updates: [] as Array<Record<string, unknown>>, processedMail: [] as string[], fail: true }))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: async (name: string) => name === 'claim_inbound_processing_jobs' ? { data: io.claimed, error: null } : { data: null, error: null },
  from: () => {
    const query: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'is', 'or', 'not', 'order', 'limit']) query[method] = () => query
    query.update = (patch: Record<string, unknown>) => { io.updates.push(patch); return query }
    query.maybeSingle = async () => ({ data: null, error: null })
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
    return query
  },
} }))
vi.mock('@/lib/inbound-mail/edielInboundProcessor', () => ({
  processInboundEmailMessage: async (input: { inboundEmailMessageId: string }) => {
    io.processedMail.push(input.inboundEmailMessageId)
    if (io.fail) throw new Error('transient')
    return { status: 'processed' }
  },
}))

import { processQueuedInboundProcessingJobs } from '@/lib/inbound-mail/edielMailboxPoller.part-2'

const job = (attempts: number) => ({ id: 'job-1', inbound_email_message_id: 'mail-1', status: 'processing', attempts_count: attempts })

beforeEach(() => { io.claimed = []; io.updates = []; io.processedMail = []; io.fail = true; delete process.env.EDIEL_INBOUND_MAX_JOB_ATTEMPTS })

describe('inbound job attempt limit', () => {
  it('retries a failing job until the fifth claimed attempt', async () => {
    io.claimed = [job(4)]
    await processQueuedInboundProcessingJobs({ workerId: 'w' })
    expect(io.updates.at(-1)).toMatchObject({ status: 'retry' })
    io.claimed = [job(5)]
    await processQueuedInboundProcessingJobs({ workerId: 'w' })
    expect(io.updates.at(-1)).toMatchObject({ status: 'failed' })
  })

  it('stops a job reclaimed beyond the limit without running it again', async () => {
    io.claimed = [job(6)]
    const result = await processQueuedInboundProcessingJobs({ workerId: 'w' })
    expect(io.processedMail).toEqual([])
    expect(result.failed).toBe(1)
    expect(io.updates.at(-1)).toMatchObject({ status: 'failed' })
  })
})
