// supabase-js returns PostgREST/RPC errors as plain objects, not Error
// instances. The inbound poller turned every such cause into "Okänt
// processfel." on the job, so operators could not see e.g. a statement timeout.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ updates: [] as Array<Record<string, unknown>>, processError: null as unknown }))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  // Like the real claim RPC (PERF006): the claimed row carries this worker's lease receipt.
  rpc: async (name: string, args?: Record<string, unknown>) => name === 'claim_inbound_processing_jobs'
    ? { data: [{ id: 'job-1', inbound_email_message_id: 'mail-1', attempts_count: 0, status: 'processing', locked_by: String(args?.p_worker_id ?? ''), locked_at: '2026-10-27T08:00:00.000Z' }], error: null }
    : { data: null, error: null },
  from: () => {
    const query: Record<string, unknown> = {}
    let updated = false
    let rowId: unknown = null
    for (const method of ['select', 'in', 'is', 'or', 'not', 'order', 'limit']) query[method] = () => query
    query.eq = (column: string, value: unknown) => { if (column === 'id') rowId = value; return query }
    query.update = (patch: Record<string, unknown>) => { io.updates.push(patch); updated = true; return query }
    // A lease-guarded update that matches returns its row, as PostgREST does (PERF006 counts only committed finishes).
    query.maybeSingle = async () => ({ data: updated ? { id: rowId } : null, error: null })
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
    return query
  },
} }))
vi.mock('@/lib/inbound-mail/edielInboundProcessor', () => ({
  processInboundEmailMessage: async () => { throw io.processError },
}))

import { processQueuedInboundProcessingJobs } from '@/lib/inbound-mail/edielMailboxPoller.part-2'

beforeEach(() => { io.updates = [] })

describe('inbound job failure message', () => {
  it('keeps the database cause of a plain PostgREST error on the retried job', async () => {
    io.processError = { message: 'canceling statement due to statement timeout', code: '57014', details: null, hint: null }
    const result = await processQueuedInboundProcessingJobs({ workerId: 'worker-1' })
    expect(result.failed).toBe(1)
    const recorded = JSON.stringify(io.updates)
    expect(recorded).toContain('canceling statement due to statement timeout')
    expect(recorded).not.toContain('Okänt processfel')
  })

  it('still reports an ordinary Error message unchanged', async () => {
    io.processError = new Error('ediel_inbound_original_persistence_required')
    await processQueuedInboundProcessingJobs({ workerId: 'worker-1' })
    expect(JSON.stringify(io.updates)).toContain('ediel_inbound_original_persistence_required')
  })
})
