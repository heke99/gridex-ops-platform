// reality-defects: I-B11
// I-B11 (scenario I, batch 5e): the grid owner sent CONTRL, Z04 and a late negative APERAK 15 s apart. One poll stored
// them in that order, but claim_inbound_processing_jobs returns its UPDATE ... RETURNING rows without an order (its
// ORDER BY only picks which jobs are claimed). The run processed APERAK, Z04, CONTRL: the negative APERAK failed the
// switch before its Z04 was read, so P-11 (a late ACK never takes back a confirmed switch) could not hold. Claimed jobs
// are now processed oldest first, which is the order the mails were stored in.
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ claimed: [] as Array<Record<string, unknown>>, processedMail: [] as string[] }))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  // Like the real claim RPC (PERF006): claimed rows carry this worker's lease receipt.
  rpc: async (name: string, args?: Record<string, unknown>) => name === 'claim_inbound_processing_jobs' ? { data: ((rows: unknown, args?: Record<string, unknown>) => Array.isArray(rows) ? rows.map(row => ({ ...(row as object), status: 'processing', locked_by: String(args?.p_worker_id ?? ''), locked_at: '2026-10-27T08:00:00.000Z' })) : rows)(io.claimed, args), error: null } : { data: null, error: null },
  from: () => {
    const query: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'is', 'or', 'not', 'order', 'limit', 'update']) query[method] = () => query
    query.maybeSingle = async () => ({ data: null, error: null })
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
    return query
  },
} }))
vi.mock('@/lib/inbound-mail/edielInboundProcessor', () => ({
  processInboundEmailMessage: async (input: { inboundEmailMessageId: string }) => {
    io.processedMail.push(input.inboundEmailMessageId)
    return { status: 'processed' }
  },
}))

import { claimQueuedInboundProcessingJobs, processQueuedInboundProcessingJobs } from '@/lib/inbound-mail/edielMailboxPoller.part-2'

const job = (id: string, createdAt: string) => ({ id, inbound_email_message_id: `mail-${id}`, status: 'processing', attempts_count: 1, created_at: createdAt })

beforeEach(() => { io.claimed = []; io.processedMail = [] })

it('a CONTRL, Z04 and APERAK claimed together are processed in the order they were stored, not the order RETURNING gave', async () => {
  // The world's RETURNING order: newest first.
  io.claimed = [job('aperak', '2026-10-27T08:09:56.534519Z'), job('z04', '2026-10-27T08:09:56.470085Z'), job('contrl', '2026-10-27T08:09:56.306822Z')]
  await processQueuedInboundProcessingJobs({ workerId: 'w', environment: 'production' })
  expect(io.processedMail).toEqual(['mail-contrl', 'mail-z04', 'mail-aperak'])
})

it('the claim itself returns oldest first, with the id breaking a tie', async () => {
  io.claimed = [job('b', '2026-10-27T08:00:00.000Z'), job('c', '2026-10-27T08:00:01.000Z'), job('a', '2026-10-27T08:00:00.000Z')]
  expect((await claimQueuedInboundProcessingJobs('w', 50, 'production')).map(j => j.id)).toEqual(['a', 'b', 'c'])
})
