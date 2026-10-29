import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboundProcessingJobRow } from '@/lib/inbound-mail/edielMailboxPoller.part-1'

const io = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), process: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('@/lib/inbound-mail/edielInboundProcessor', () => ({ processInboundEmailMessage: io.process }))

import { processQueuedInboundProcessingJobs } from '@/lib/inbound-mail/edielMailboxPoller.part-2'

let job: InboundProcessingJobRow
let processorCalls: number
let claimError: { code: string; message: string } | null

// This adapter models the persisted claim contract: both SQL and the compatibility
// path increment attempts_count before handing the job to the real processor loop.
// The processor and its claim/finalize functions remain the production code.
function jobQuery() {
  const filters: Array<(row: InboundProcessingJobRow) => boolean> = []
  let patch: Partial<InboundProcessingJobRow> | null = null
  const query = {
    select: () => query,
    update: (value: Partial<InboundProcessingJobRow>) => { patch = value; return query },
    eq: (key: keyof InboundProcessingJobRow, value: unknown) => {
      filters.push(row => row[key] === value)
      return query
    },
    in: (key: keyof InboundProcessingJobRow, values: unknown[]) => {
      filters.push(row => values.includes(row[key]))
      return query
    },
    or: (expression: string) => {
      const cutoff = expression.split('locked_at.lt.')[1]
      filters.push(row => row.locked_at === null || Date.parse(row.locked_at) < Date.parse(cutoff))
      return query
    },
    order: () => query,
    limit: () => query,
    result: () => {
      if (!filters.every(filter => filter(job))) return []
      if (patch) Object.assign(job, patch)
      return [structuredClone(job)]
    },
    maybeSingle: async () => ({ data: query.result()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: query.result(), error: null }).then(resolve),
  }
  return query
}

function useClaimPath(path: 'rpc' | 'fallback') {
  io.rpc.mockImplementation(async (name: string, input: { p_worker_id: string }) => {
    if (name !== 'claim_inbound_processing_jobs') throw new Error(`Unexpected RPC: ${name}`)
    if (claimError) return { data: null, error: claimError }
    if (path === 'fallback') return { data: null, error: { code: 'PGRST202', message: 'Could not find claim_inbound_processing_jobs' } }
    if (!['queued', 'retry', 'received'].includes(job.status)) return { data: [], error: null }
    Object.assign(job, {
      status: 'processing', locked_by: input.p_worker_id, locked_at: new Date().toISOString(),
      attempts_count: job.attempts_count + 1,
    })
    return { data: [structuredClone(job)], error: null }
  })
}

async function runUntilTerminal() {
  const states: Array<{ attempt: number; status: string }> = []
  for (let safety = 0; safety < 6 && ['queued', 'retry'].includes(job.status); safety += 1) {
    await processQueuedInboundProcessingJobs({ workerId: 'unit-worker', actorUserId: 'unit-actor' })
    states.push({ attempt: job.attempts_count, status: job.status })
  }
  return states
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('EDIEL_INBOUND_MAX_JOB_ATTEMPTS', '5')
  processorCalls = 0
  claimError = null
  job = {
    id: 'unit-job', company_id: 'unit-company', mailbox_id: 'unit-mailbox',
    inbound_email_message_id: 'unit-message', status: 'queued', step: null,
    attempts_count: 0, locked_at: null, locked_by: null, started_at: null,
    finished_at: null, error_message: null, payload: {},
    created_at: '2026-10-20T00:00:00.000Z', updated_at: '2026-10-20T00:00:00.000Z',
  }
  io.from.mockImplementation((table: string) => {
    // The branch's give-up note on the mail (J3-11) after the last attempt: only its processing state is written.
    if (table === 'inbound_email_messages') {
      const update = { eq: () => update, then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) }
      return { update: () => update }
    }
    if (table !== 'inbound_processing_jobs') throw new Error(`Unexpected table: ${table}`)
    return jobQuery()
  })
  io.process.mockImplementation(async () => {
    processorCalls += 1
    throw new Error('Transient processing failure')
  })
})

afterEach(() => vi.unstubAllEnvs())

describe.each(['rpc', 'fallback'] as const)('inbound retry budget through %s claim', path => {
  beforeEach(() => useClaimPath(path))

  it('retries four failed attempts and terminalizes only the fifth failure', async () => {
    expect(await runUntilTerminal()).toEqual([
      { attempt: 1, status: 'retry' },
      { attempt: 2, status: 'retry' },
      { attempt: 3, status: 'retry' },
      { attempt: 4, status: 'retry' },
      { attempt: 5, status: 'failed' },
    ])
    expect(processorCalls).toBe(5)
    expect(job).toMatchObject({ step: 'processor_failed', locked_at: null, locked_by: null })
    await expect(processQueuedInboundProcessingJobs()).resolves.toEqual({ processed: 0, failed: 0, processedInboundEmailMessageIds: [] })
    expect(processorCalls).toBe(5)
  })

  it('can complete successfully on the fifth and final allowed attempt', async () => {
    io.process.mockImplementation(async () => {
      processorCalls += 1
      if (processorCalls < 5) throw new Error('Transient processing failure')
      return { status: 'processed' }
    })
    expect(await runUntilTerminal()).toEqual([
      { attempt: 1, status: 'retry' },
      { attempt: 2, status: 'retry' },
      { attempt: 3, status: 'retry' },
      { attempt: 4, status: 'retry' },
      { attempt: 5, status: 'done' },
    ])
    expect(processorCalls).toBe(5)
    expect(job.error_message).toBeNull()
  })

  it.each([
    ['1', [{ attempt: 1, status: 'failed' }]],
    ['2', [{ attempt: 1, status: 'retry' }, { attempt: 2, status: 'failed' }]],
  ])('honors a configured maximum of %s attempts', async (maximum, expected) => {
    vi.stubEnv('EDIEL_INBOUND_MAX_JOB_ATTEMPTS', maximum)
    expect(await runUntilTerminal()).toEqual(expected)
    expect(processorCalls).toBe(Number(maximum))
  })

  it('does not retry a successful first attempt', async () => {
    io.process.mockImplementation(async () => { processorCalls += 1; return { status: 'processed' } })
    expect(await runUntilTerminal()).toEqual([{ attempt: 1, status: 'done' }])
    expect(processorCalls).toBe(1)
  })

  it('keeps manual review separate from transient retry failures', async () => {
    io.process.mockImplementation(async () => { processorCalls += 1; return { status: 'manual_review' } })
    expect(await runUntilTerminal()).toEqual([{ attempt: 1, status: 'manual_review' }])
    expect(job).toMatchObject({
      review_owner: 'tenant_operations', review_priority: 'normal', review_reason: 'manual_review',
      review_resolved_at: null, review_resolution: null,
    })
    expect(processorCalls).toBe(1)
  })

  it('fails a job with no inbound message without calling the message processor', async () => {
    job.inbound_email_message_id = null
    expect(await runUntilTerminal()).toEqual([{ attempt: 1, status: 'failed' }])
    expect(job.step).toBe('missing_inbound_email_message_id')
    expect(processorCalls).toBe(0)
  })
})

it('propagates a non-compatibility claim failure without processing or finalizing the job', async () => {
  useClaimPath('rpc')
  claimError = { code: '08006', message: 'Database connection unavailable' }
  await expect(processQueuedInboundProcessingJobs()).rejects.toEqual(claimError)
  expect(job).toMatchObject({ status: 'queued', attempts_count: 0, locked_by: null, locked_at: null })
  expect(processorCalls).toBe(0)
})
