// PERF006 (issue #840, on top of PR #853): mailbox and inbound job leases are
// finalized only by the lease owner (owner/timestamp/status CAS). The real
// poller/worker modules run against a stateful in-memory PostgREST-shaped port.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMailboxRow, InboundProcessingJobRow } from '@/lib/inbound-mail/edielMailboxPoller.part-1'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  process: vi.fn(),
  rpcClaim: null as null | ((args: Row) => { data: unknown; error: unknown }),
  imap: { onConnect: null as null | (() => void), connectError: null as Error | null },
}))

function query(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let patch: Row | null = null
  let columns: string[] | null = null
  const rows = () => io.tables[table] ?? []
  const project = (row: Row) => columns ? Object.fromEntries(columns.map(c => [c, row[c]])) : structuredClone(row)
  const run = () => {
    const hits = rows().filter(row => filters.every(f => f(row)))
    if (patch) for (const row of hits) Object.assign(row, patch)
    return hits.map(project)
  }
  const q = {
    update: (value: Row) => { patch = value; return q },
    select: (cols?: string) => { columns = cols && cols !== '*' ? cols.split(',').map(s => s.trim()) : null; return q },
    eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q },
    is: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q },
    in: (k: string, vs: unknown[]) => { filters.push(r => vs.includes(r[k])); return q },
    or: (expr: string) => {
      const cutoff = expr.split('locked_at.lt.')[1]
      filters.push(r => r.locked_at === null || Date.parse(String(r.locked_at)) < Date.parse(cutoff))
      return q
    },
    order: () => q,
    limit: () => q,
    maybeSingle: async () => {
      const out = run()
      if (out.length > 1) return { data: null, error: { message: 'multiple rows' } }
      return { data: out[0] ?? null, error: null }
    },
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(resolve),
  }
  return q
}

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => {
    if (!['ediel_mailboxes', 'inbound_processing_jobs'].includes(table)) throw new Error(`unexpected table ${table}`)
    return query(table)
  },
  rpc: async (name: string, args: Row) => {
    if (name !== 'claim_inbound_processing_jobs') throw new Error(`unexpected rpc ${name}`)
    return io.rpcClaim ? io.rpcClaim(args) : { data: null, error: { code: 'PGRST202', message: 'Could not find claim_inbound_processing_jobs' } }
  },
} }))
vi.mock('@/lib/inbound-mail/edielInboundProcessor', () => ({ processInboundEmailMessage: io.process }))
vi.mock('imapflow', () => ({ ImapFlow: class {
  async connect() { if (io.imap.connectError) throw io.imap.connectError; io.imap.onConnect?.() }
  async getMailboxLock() { return { release: () => undefined } }
  async *fetch() { /* empty mailbox */ }
  async messageFlagsAdd() { return true }
  async logout() { return undefined }
} }))

import { markMailboxPollFinished, markMailboxPollStarted } from '@/lib/inbound-mail/edielMailboxPoller.part-1'
import {
  markInboundProcessingJobFinished, markInboundProcessingJobStarted, pollEdielMailbox,
  processQueuedInboundProcessingJobs, syncActiveInboundProcessingJobForMessage,
} from '@/lib/inbound-mail/edielMailboxPoller.part-2'

const T0 = Date.parse('2026-10-22T08:00:00.000Z')
const tick = (ms = 1000) => vi.setSystemTime(Date.now() + ms)

const mailboxRow = (): Row => ({
  id: 'mb-1', company_id: null, environment: 'test', mailbox_name: 'unit', email_address: 'unit@example.test',
  imap_host: 'imap.example.test', imap_port: 993, username: 'unit', secret_reference: 'env:UNIT_IMAP_PASS',
  metadata: {}, locked_at: null, locked_by: null, last_error: null, last_polled_at: null,
  last_successful_poll_at: null, updated_at: new Date(T0).toISOString(),
})
const jobRow = (over: Partial<InboundProcessingJobRow> = {}): InboundProcessingJobRow => ({
  id: 'job-1', company_id: 'co', mailbox_id: 'mb-1', inbound_email_message_id: 'msg-1', status: 'queued',
  step: null, attempts_count: 0, locked_at: null, locked_by: null, started_at: null, finished_at: null,
  error_message: null, payload: {}, created_at: '2026-10-20T00:00:00.000Z', updated_at: '2026-10-20T00:00:00.000Z',
  ...over,
})
const mailbox = () => io.tables.ediel_mailboxes[0]
const job = () => io.tables.inbound_processing_jobs[0] as unknown as InboundProcessingJobRow

// Models claim_inbound_processing_jobs: lock + count the attempt once, return the full row.
const sqlClaim = (args: Row) => {
  const hits = io.tables.inbound_processing_jobs.filter(r => ['queued', 'retry', 'received'].includes(String(r.status)) && r.locked_at === null)
  for (const r of hits) Object.assign(r, { status: 'processing', locked_by: args.p_worker_id, locked_at: new Date().toISOString(), attempts_count: Number(r.attempts_count) + 1 })
  return { data: hits.map(r => structuredClone(r)), error: null }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  vi.stubEnv('UNIT_IMAP_PASS', 'synthetic')
  vi.stubEnv('EDIEL_INBOUND_MAX_JOB_ATTEMPTS', '5')
  io.tables = { ediel_mailboxes: [mailboxRow()], inbound_processing_jobs: [jobRow() as unknown as Row] }
  io.process.mockReset()
  io.rpcClaim = sqlClaim
  io.imap.onConnect = null
  io.imap.connectError = null
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('mailbox lease receipt', () => {
  it('returns a unique owner receipt per acquisition and refuses a live lease', async () => {
    const a = await markMailboxPollStarted('mb-1', 'worker')
    expect(a).toMatchObject({ id: 'mb-1', locked_at: new Date(T0).toISOString() })
    expect(a!.locked_by).toMatch(/^worker:[0-9a-f-]{36}$/)
    expect(await markMailboxPollStarted('mb-1', 'worker')).toBeNull()
    tick(); const b = await markMailboxPollStarted('mb-1', 'worker', true)
    expect(b!.locked_by).not.toBe(a!.locked_by)
  })

  it('only the current owner can finalize; a displaced owner cannot clear the new lease', async () => {
    const a = (await markMailboxPollStarted('mb-1', 'worker'))!
    tick(); const b = (await markMailboxPollStarted('mb-1', 'worker', true))!
    await expect(markMailboxPollFinished({ claim: a, ok: false, errorMessage: 'stale' })).resolves.toBe(false)
    expect(mailbox()).toMatchObject({ locked_by: b.locked_by, locked_at: b.locked_at, last_error: null })
    await expect(markMailboxPollFinished({ claim: b, ok: true })).resolves.toBe(true)
    expect(mailbox()).toMatchObject({ locked_by: null, locked_at: null, last_successful_poll_at: expect.any(String) })
  })

  it('rejects a same-owner receipt with a different timestamp and malformed receipts', async () => {
    const a = (await markMailboxPollStarted('mb-1', 'worker'))!
    await expect(markMailboxPollFinished({ claim: { ...a, locked_at: new Date(T0 + 1).toISOString() }, ok: true })).resolves.toBe(false)
    await expect(markMailboxPollFinished({ claim: { ...a, locked_by: '' }, ok: true })).resolves.toBe(false)
    expect(mailbox().locked_by).toBe(a.locked_by)
  })

  it('pollEdielMailbox reports a lost lease instead of clearing the thief lease', async () => {
    io.imap.onConnect = () => { tick(); Object.assign(mailbox(), { locked_by: 'thief:x', locked_at: new Date().toISOString() }) }
    const result = await pollEdielMailbox({ mailbox: mailboxRow() as unknown as EdielMailboxRow, workerId: 'worker' })
    expect(result.errors).toEqual(['mailbox_poll_claim_lost'])
    expect(mailbox()).toMatchObject({ locked_by: 'thief:x', last_successful_poll_at: null })
  })

  it('pollEdielMailbox finalizes its own lease on success and on failure', async () => {
    const ok = await pollEdielMailbox({ mailbox: mailboxRow() as unknown as EdielMailboxRow, workerId: 'worker' })
    expect(ok.errors).toEqual([])
    expect(mailbox()).toMatchObject({ locked_by: null, locked_at: null, last_successful_poll_at: expect.any(String) })
    io.imap.connectError = new Error('imap down'); tick()
    const failed = await pollEdielMailbox({ mailbox: mailboxRow() as unknown as EdielMailboxRow, workerId: 'worker' })
    expect(failed.errors).toEqual(['imap down'])
    expect(mailbox()).toMatchObject({ locked_by: null, locked_at: null, last_error: 'imap down' })
  })
})

describe.each(['rpc', 'fallback'] as const)('inbound job finalization through %s claim', path => {
  beforeEach(() => { if (path === 'fallback') io.rpcClaim = null })

  it('finalizes with its own receipt and counts the attempt once (#853 preserved)', async () => {
    io.process.mockResolvedValue({ status: 'processed' })
    await expect(processQueuedInboundProcessingJobs({ workerId: 'worker' })).resolves.toEqual({ processed: 1, failed: 0 })
    expect(job()).toMatchObject({ status: 'done', attempts_count: 1, locked_by: null, locked_at: null })
  })

  it('a displaced worker cannot finalize or count a job reclaimed by another worker', async () => {
    io.process.mockImplementation(async () => {
      tick(); Object.assign(job(), { locked_by: 'other:y', locked_at: new Date().toISOString(), attempts_count: job().attempts_count + 1 })
      throw new Error('slow failure')
    })
    await expect(processQueuedInboundProcessingJobs({ workerId: 'worker' })).resolves.toEqual({ processed: 0, failed: 0 })
    expect(job()).toMatchObject({ status: 'processing', locked_by: 'other:y', attempts_count: 2, error_message: null })
  })

  it('retries four times and fails on the fifth attempt with one count per attempt', async () => {
    io.process.mockRejectedValue(new Error('transient'))
    const seen: Array<[number, string]> = []
    for (let i = 0; i < 6 && ['queued', 'retry'].includes(job().status); i += 1) {
      tick(); await processQueuedInboundProcessingJobs({ workerId: 'worker' })
      seen.push([job().attempts_count, job().status])
    }
    expect(seen).toEqual([[1, 'retry'], [2, 'retry'], [3, 'retry'], [4, 'retry'], [5, 'failed']])
  })
})

describe('direct finalization authority', () => {
  it('claim authority requires processing status, owner and timestamp', async () => {
    const claimed = (await markInboundProcessingJobStarted(jobRow(), 'worker'))!
    expect(claimed).toMatchObject({ status: 'processing', attempts_count: 1 })
    const receipt = { id: claimed.id, locked_by: claimed.locked_by!, locked_at: claimed.locked_at! }
    await expect(markInboundProcessingJobFinished({ jobId: 'job-1', authority: { kind: 'claim', receipt: { ...receipt, locked_by: 'worker:other' } }, status: 'done' })).resolves.toBe(false)
    await expect(markInboundProcessingJobFinished({ jobId: 'job-2', authority: { kind: 'claim', receipt }, status: 'done' })).resolves.toBe(false)
    expect(job().status).toBe('processing')
    await expect(markInboundProcessingJobFinished({ jobId: 'job-1', authority: { kind: 'claim', receipt }, status: 'done' })).resolves.toBe(true)
    expect(job()).toMatchObject({ status: 'done', locked_by: null })
    // A second finalize with the consumed receipt is refused.
    await expect(markInboundProcessingJobFinished({ jobId: 'job-1', authority: { kind: 'claim', receipt }, status: 'failed' })).resolves.toBe(false)
    expect(job().status).toBe('done')
  })

  it('admin sync finalizes an idle manual_review job via snapshot CAS', async () => {
    Object.assign(job(), { status: 'manual_review' })
    await expect(syncActiveInboundProcessingJobForMessage({ inboundEmailMessageId: 'msg-1', outcomeStatus: 'processed' })).resolves.toBe(true)
    expect(job()).toMatchObject({ status: 'done', step: 'processed' })
  })

  it('admin sync never overwrites a job a worker currently holds', async () => {
    Object.assign(job(), { status: 'processing', locked_by: 'worker:z', locked_at: new Date().toISOString() })
    await expect(syncActiveInboundProcessingJobForMessage({ inboundEmailMessageId: 'msg-1', outcomeStatus: 'processed' })).resolves.toBe(false)
    expect(job()).toMatchObject({ status: 'processing', locked_by: 'worker:z' })
  })

  it('idle authority refuses when the snapshot changed (status or updated_at)', async () => {
    Object.assign(job(), { status: 'manual_review' })
    await expect(markInboundProcessingJobFinished({ jobId: 'job-1', authority: { kind: 'idle', status: 'manual_review', updatedAt: '2026-01-01T00:00:00.000Z' }, status: 'done' })).resolves.toBe(false)
    await expect(markInboundProcessingJobFinished({ jobId: 'job-1', authority: { kind: 'idle', status: 'queued', updatedAt: job().updated_at }, status: 'done' })).resolves.toBe(false)
    await expect(markInboundProcessingJobFinished({ jobId: 'job-1', authority: { kind: 'idle', status: 'processing', updatedAt: job().updated_at }, status: 'done' })).resolves.toBe(false)
    expect(job().status).toBe('manual_review')
  })

  it('rejects an RPC claim that returns a foreign owner', async () => {
    io.rpcClaim = () => ({ data: [{ ...jobRow(), status: 'processing', locked_by: 'someone-else', locked_at: new Date().toISOString(), attempts_count: 1 }], error: null })
    await expect(processQueuedInboundProcessingJobs({ workerId: 'worker' })).rejects.toThrow('inbound_processing_job_claim_invalid')
    expect(io.process).not.toHaveBeenCalled()
  })
})
