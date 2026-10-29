// reality-defects: J3-11 (inbound Ediel robustness: the same interchange delivered in two mails)
//
// Observed in the reality world (scenario J3, run on 5f2db53e): the grid owner sent one E66 twice, in two mails with
// different Message-IDs. Both were stored unattributed from the shared mailbox. The copy processed first was
// attributed to the tenant; attributing the other one violated ux_inbound_email_messages_company_sender_interchange
// (company_id, environment, sender_ediel_id, interchange_reference), so its job threw 23505 five times and ended
// "failed" while the mail itself stayed "received"/"not_checked" with no error: silently stuck, looking unpolled.
// Not a race: whichever copy is attributed second always fails, deterministically.
//
// The fake table below enforces exactly that partial unique index on UPDATE, like PostgreSQL.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ mails: [] as Row[], jobs: [] as Row[], claim: [] as Row[] }))
const mocks = vi.hoisted(() => ({ create: vi.fn(async () => 'ediel-original-1'), tenant: vi.fn(), process: vi.fn() }))

vi.mock('@/lib/supabase/service', () => {
  const uniqueInterchange = (row: Row) => row.company_id && row.sender_ediel_id && row.interchange_reference
    ? `${row.company_id}|${row.environment}|${row.sender_ediel_id}|${row.interchange_reference}` : null
  class Query {
    filters: Array<(row: Row) => boolean> = []
    patch: Row | null = null
    take = Infinity
    constructor(private table: string) {}
    select() { return this }
    order() { return this }
    limit(n: number) { this.take = n; return this }
    eq(column: string, value: unknown) { this.filters.push(row => row[column] === value); return this }
    neq(column: string, value: unknown) { this.filters.push(row => row[column] !== value); return this }
    is(column: string, value: unknown) { this.filters.push(row => (row[column] ?? null) === value); return this }
    in(column: string, values: unknown[]) { this.filters.push(row => values.includes(row[column])); return this }
    update(patch: Row) { this.patch = patch; return this }
    rows() { return this.table === 'inbound_email_messages' ? io.mails : this.table === 'inbound_processing_jobs' ? io.jobs : [] }
    run(): { data: Row[] | null; error: Row | null } {
      const matched = this.rows().filter(row => this.filters.every(filter => filter(row))).slice(0, this.take)
      if (this.patch) {
        for (const row of matched) {
          const next = { ...row, ...this.patch }
          const key = this.table === 'inbound_email_messages' ? uniqueInterchange(next) : null
          if (key && io.mails.some(other => other !== row && uniqueInterchange(other) === key)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "ux_inbound_email_messages_company_sender_interchange"' } }
          }
        }
        for (const row of matched) Object.assign(row, this.patch)
      }
      return { data: matched.map(row => ({ ...row })), error: null }
    }
    maybeSingle() { const { data, error } = this.run(); return Promise.resolve({ data: data?.[0] ?? null, error }) }
    single() { return this.maybeSingle() }
    then<T>(resolve: (value: unknown) => T, reject?: (reason: unknown) => T) { return Promise.resolve(this.run()).then(resolve, reject) }
  }
  return { supabaseService: { from: (table: string) => new Query(table),
    // Like the real claim RPC (PERF006): the claim stamps this worker's lease receipt on the stored job row and
    // returns it, so the lease-guarded finish matches the row it claimed.
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name !== 'claim_inbound_processing_jobs') return { data: null, error: null }
      const lease = { status: 'processing', locked_by: String(args?.p_worker_id ?? ''), locked_at: '2026-10-27T08:00:00.000Z' }
      for (const claimed of io.claim) Object.assign(io.jobs.find(job => job.id === claimed.id) ?? {}, lease)
      return { data: io.claim.map(row => ({ ...row, ...lease })), error: null }
    } } }
})
vi.mock('@/lib/ediel/inbound/receptions', () => ({ InboundReceptionHeldError: class extends Error {}, readUnattributedTechnicalIntake: async () => null }))
vi.mock('@/lib/inbound-mail/inboundStatusUpdater', async () => {
  const { supabaseService } = await import('@/lib/supabase/service')
  return {
    updateInboundEmailProcessingStatus: async (input: { inboundEmailMessageId: string; companyId?: string | null; status: string; matchStatus?: string; errorMessage?: string; matchPayload?: Row }) => {
      const { error } = await supabaseService.from('inbound_email_messages').update({ company_id: input.companyId ?? null, processing_status: input.status,
        match_status: input.matchStatus, error_message: input.errorMessage ?? null, match_payload: input.matchPayload ?? {} }).eq('id', input.inboundEmailMessageId)
      if (error) throw error
    },
    createParseResult: async () => 'parse-1',
    createInboundEdielMessage: mocks.create,
    createUnresolvedInboundEdielMessage: vi.fn(), applySafeInboundStatusUpdate: vi.fn(),
  }
})
vi.mock('@/lib/inbound-mail/inboundTaskFactory', () => ({ createInboundMailTask: vi.fn() }))
vi.mock('@/lib/inbound-mail/inboundMatcher', () => ({
  matchOutboundRequestForInbound: async () => ({ status: 'missing', entityId: null, entityType: null, reasons: ['unsolicited periodic values'], candidates: [] }),
  matchMeteringPointForInbound: async () => ({ status: 'missing', entityId: null, entityType: null, reasons: [], candidates: [] }),
}))
vi.mock('@/lib/inbound-mail/inboundTenantResolver', () => ({ resolveTenantForInboundEdiel: mocks.tenant }))

import { processInboundEmailMessage } from '@/lib/inbound-mail/edielInboundProcessor'

const EDIFACT = ["UNA:+.? '", "UNB+UNOC:3+80004:ZZ+70001:ZZ+260927:0600+J3DUPREF++23-DDQ-E66-T++++1'", "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
  "BGM+E66::260+MJ3DUPREF+9+AB'", "NAD+MS+80004:SVK:260'", "NAD+MR+70001:SVK:260'", "UNT+4+1'", "UNZ+1+J3DUPREF'"].join('\n')

/** One mail as reception stores it from the shared mailbox: unattributed, with the stored dedupe facts. */
const storedMail = (id: string, payload = EDIFACT): Row => ({ id, company_id: null, mailbox_id: 'mb-shared', environment: 'test', raw_email: null,
  body_text: 'Ediel', raw_edifact_payload: payload, processing_status: 'received', match_status: 'not_checked', sender_ediel_id: '80004',
  interchange_reference: 'J3DUPREF', transaction_reference: '1', external_reference: 'MJ3DUPREF', ediel_mailboxes: { id: 'mb-shared', environment: 'test' } })
const mail = (id: string) => io.mails.find(row => row.id === id)!

beforeEach(() => {
  io.mails = []; io.jobs = []; io.claim = []
  vi.clearAllMocks()
  mocks.tenant.mockResolvedValue({ status: 'resolved', companyId: 'tenant-a', reasons: [], candidates: ['tenant-a'], evidence: [], shared: null })
})

describe('J3-11 the same interchange in two mails', () => {
  it('holds the second copy visibly as a duplicate of the first instead of failing its job on the unique index', async () => {
    io.mails = [storedMail('mail-1'), storedMail('mail-2')]
    // The later mail happens to be processed first (job order is not mail order).
    await expect(processInboundEmailMessage({ inboundEmailMessageId: 'mail-2', actorUserId: 'actor-1' })).resolves.toMatchObject({ companyId: 'tenant-a' })
    const second = await processInboundEmailMessage({ inboundEmailMessageId: 'mail-1', actorUserId: 'actor-1' })
    expect(second).toMatchObject({ status: 'manual_review', companyId: null })
    expect(mail('mail-2').company_id).toBe('tenant-a')
    expect(mail('mail-1')).toMatchObject({ company_id: null, processing_status: 'manual_review', match_status: 'duplicate_interchange',
      match_payload: expect.objectContaining({ duplicateOfInboundEmailMessageId: 'mail-2', samePayload: true, tenantCompanyId: 'tenant-a', authorizesBusinessEffect: false }) })
    // One Ediel original for one interchange: nothing applied or acknowledged twice.
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it('says so when the sender reused the reference for different content', async () => {
    io.mails = [storedMail('mail-1'), storedMail('mail-2', EDIFACT.replace("NAD+MR+70001:SVK:260'", "NAD+MR+70001:SVK:260'\nFTX+AAO+++andra'"))]
    await processInboundEmailMessage({ inboundEmailMessageId: 'mail-1', actorUserId: 'actor-1' })
    await processInboundEmailMessage({ inboundEmailMessageId: 'mail-2', actorUserId: 'actor-1' })
    expect(mail('mail-2')).toMatchObject({ match_status: 'duplicate_interchange', match_payload: expect.objectContaining({ duplicateOfInboundEmailMessageId: 'mail-1', samePayload: false }) })
    expect(String(mail('mail-2').error_message)).toContain('återanvände')
  })
})

describe('J3-11 a processing job that gives up', () => {
  it('marks its mail failed with the reason instead of leaving it "received"', async () => {
    vi.doMock('@/lib/inbound-mail/edielInboundProcessor', () => ({ processInboundEmailMessage: async () => { throw Object.assign(new Error('permanent'), { code: 'XX000' }) } }))
    vi.resetModules()
    const { processQueuedInboundProcessingJobs } = await import('@/lib/inbound-mail/edielMailboxPoller')
    io.mails = [storedMail('mail-9')]
    io.jobs = [{ id: 'job-9', inbound_email_message_id: 'mail-9', status: 'processing', attempts_count: 5 }]
    io.claim = [{ ...io.jobs[0] }]
    const result = await processQueuedInboundProcessingJobs({ workerId: 'w', actorUserId: 'actor-1' })
    expect(result.failed).toBe(1)
    expect(io.jobs[0]).toMatchObject({ status: 'failed', step: 'processor_failed' })
    expect(mail('mail-9')).toMatchObject({ processing_status: 'failed', error_message: expect.stringContaining('permanent') })
    vi.doUnmock('@/lib/inbound-mail/edielInboundProcessor')
  })
})
