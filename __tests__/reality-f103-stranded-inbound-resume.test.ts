// reality-defects: F103
// Scenario F run 26: four PRODAT Z04 confirmations arrived in one inbound-mail
// run. Three became parsed; for the fourth the canonical source-validation RPC
// outlived its 2 s client abort (the server still committed the assessment),
// processInboundEdielMessage threw prodat_canonical_source_validation_unconfirmed
// after 'linked', the engine kept the error only in the poll-run metadata, and
// no later run ever selected the message again: mail 'processed', job 'done',
// Ediel message 'received' forever, switch 'prepared'.
// Synthetic in-memory rows only; no database, no cron endpoint.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const io = vi.hoisted(() => ({
  tables: { ediel_messages: [] as Row[], inbound_email_messages: [] as Row[], ediel_message_events: [] as Row[] } as Record<string, Row[]>,
  fetchedMailIds: [] as string[],
  processed: [] as string[],
  failPlan: new Map<string, string[]>(),
  rpc: null as null | ((name: string, args: Row) => { abortSignal: (signal: AbortSignal) => Promise<{ data: unknown; error: unknown }> }),
}))

vi.mock('@/lib/supabase/service', () => {
  class Query implements PromiseLike<{ data: unknown; error: unknown }> {
    private filters: Array<(row: Row) => boolean> = []
    private patch: Row | null = null
    private max: number | null = null
    private orderBy: { column: string; ascending: boolean } | null = null
    private single = false
    constructor(private readonly table: string) {}
    select() { return this }
    update(patch: Row) { this.patch = patch; return this }
    eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this }
    in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this }
    not(column: string, operator: string, value: unknown) {
      if (operator !== 'is' || value !== null) throw new Error('unsupported not filter')
      this.filters.push((row) => row[column] !== null && row[column] !== undefined)
      return this
    }
    lt(column: string, value: string) { this.filters.push((row) => String(row[column]) < value); return this }
    gt(column: string, value: string) { this.filters.push((row) => String(row[column]) > value); return this }
    order(column: string, options: { ascending: boolean }) { this.orderBy = { column, ...options }; return this }
    limit(count: number) { this.max = count; return this }
    maybeSingle() { this.single = true; return this }
    private run(): { data: unknown; error: unknown } {
      const rows = io.tables[this.table] ?? []
      let matched = rows.filter((row) => this.filters.every((filter) => filter(row)))
      if (this.patch) {
        for (const row of matched) Object.assign(row, this.patch)
        return { data: matched.map((row) => ({ ...row })), error: null }
      }
      if (this.orderBy) {
        const { column, ascending } = this.orderBy
        matched = [...matched].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1))
      }
      if (this.max !== null) matched = matched.slice(0, this.max)
      const copies = matched.map((row) => ({ ...row }))
      return { data: this.single ? copies[0] ?? null : copies, error: null }
    }
    then<A = { data: unknown; error: unknown }, B = never>(
      resolve?: ((value: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null,
      reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      // Asynchronous like PostgREST: concurrent callers interleave between statements.
      return Promise.resolve().then(() => this.run()).then(resolve, reject)
    }
  }
  return { supabaseService: { from: (table: string) => new Query(table), rpc: (name: string, args: Row) => io.rpc!(name, args) } }
})

vi.mock('@/lib/ediel/db', () => ({
  createEdielMessageEvent: async (input: { edielMessageId: string; eventType: string; eventStatus?: string; message?: string; payload?: Row }) => {
    const row = { ediel_message_id: input.edielMessageId, event_type: input.eventType, event_status: input.eventStatus ?? 'info', message: input.message ?? null, payload: input.payload ?? {} }
    io.tables.ediel_message_events.push(row)
    return row
  },
}))

vi.mock('@/lib/inbound-mail/edielMailboxPoller.part-1', () => ({
  NO_ACTIVE_EDIEL_MAILBOX_ERROR: 'no mailbox', nowIso: () => new Date().toISOString(),
  envInt: (_name: string, fallback: number) => fallback,
  listConfiguredEdielMailboxes: async () => [{ id: 'mb-1' }],
  mailboxSkipReason: () => null, mailboxDebugItem: (mailbox: unknown) => mailbox,
}))
vi.mock('@/lib/inbound-mail/edielMailboxPoller.part-2', () => ({
  pollEdielMailbox: async () => ({ mailboxId: 'mb-1', mailboxName: 'shared', fetched: io.fetchedMailIds.length, stored: io.fetchedMailIds.length, deduped: 0,
    inboundEmailMessageIds: io.fetchedMailIds, dedupedInboundEmailMessageIds: [], errors: [] }),
  processQueuedInboundProcessingJobs: async () => ({ processed: 0, failed: 0, processedInboundEmailMessageIds: [] }),
  listEdielMessageIdsForInboundEmails: async (mailIds: string[]) => io.tables.ediel_messages
    .filter((row) => mailIds.includes(String(row.inbound_email_message_id))).map((row) => String(row.id)),
  ensureDiagnosticEdielMessagesForInboundEmails: async () => [], listRecentParsedInboundEmailIds: async () => [],
  logInboundPollRun: async () => undefined,
  mapWithConcurrency: async <T, R>(items: T[], _limit: number, run: (item: T) => Promise<R>) => Promise.all(items.map(run)),
  runInboundBusinessInArrivalLanes: async <R>(ids: string[], _limit: number, work: (id: string) => Promise<R>) => Promise.all(ids.map(work)),
}))
vi.mock('@/lib/inbound-mail/inboundOverdueMonitor', () => ({ createInboundOverdueTasks: async () => ({ ackOverdue: 0, z04Overdue: 0, z14Overdue: 0 }) }))
vi.mock('@/lib/customer-operations/automation', () => ({ processCustomerOperationJobs: async () => ({ claimed: 0, completed: 0, needsReview: 0, failed: 0, errors: [] }) }))
vi.mock('@/lib/ediel/flows/inboundProcessing', () => ({
  processInboundEdielMessage: async (input: { edielMessageId: string }) => {
    io.processed.push(input.edielMessageId)
    const failures = io.failPlan.get(input.edielMessageId) ?? []
    const failure = failures.shift()
    if (failure) throw new Error(failure)
    const row = io.tables.ediel_messages.find((candidate) => candidate.id === input.edielMessageId)
    if (row) Object.assign(row, { status: 'parsed', processing_status: 'parsed' })
  },
}))
vi.mock('@/lib/ediel/core/receivedSourceValidationEvidence', () => ({
  buildReceivedSourceValidationEvidence: () => ({ companyId: COMPANY_A, environment: 'production', sourceMessageId: STRANDED,
    sourcePayloadHash: 'b'.repeat(64), factsText: '{"syntaxDecision":"accepted"}' }),
}))

import { runInboundEdielMailEngine } from '@/lib/inbound-mail/edielMailboxPoller.part-3'
import { claimStrandedInboundEdielMessages, resumeStrandedInboundEdielMessages, STRANDED_INBOUND_RESUME_MARKER } from '@/lib/inbound-mail/strandedInboundEdielResume'
import { recordReceivedSourceValidation } from '@/lib/ediel/core/receivedSourceValidationLedger'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { CanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'

const COMPANY_A = '00000000-0000-4000-8000-00000000a001'
const COMPANY_B = '00000000-0000-4000-8000-00000000b001'
const STRANDED = '00000000-0000-4000-8000-0000000000d4'
const SIBLING = '00000000-0000-4000-8000-0000000000d1'
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

function z04(id: string, mailId: string, overrides: Row = {}): Row {
  return { id, company_id: COMPANY_A, direction: 'inbound', environment: 'production', message_family: 'PRODAT', message_code: 'Z04',
    status: 'received', processing_status: 'received', tenant_resolution_status: 'tenant_resolved', inbound_email_message_id: mailId,
    created_at: minutesAgo(1), updated_at: minutesAgo(1), ...overrides }
}
function mail(id: string, overrides: Row = {}): Row {
  return { id, company_id: COMPANY_A, processing_status: 'processed', match_status: 'matched', ...overrides }
}
const eventsOf = (id: string) => io.tables.ediel_message_events.filter((row) => row.ediel_message_id === id)
const statusOf = (id: string) => io.tables.ediel_messages.find((row) => row.id === id)?.status

beforeEach(() => {
  io.tables.ediel_messages = []; io.tables.inbound_email_messages = []; io.tables.ediel_message_events = []
  io.fetchedMailIds = []; io.processed = []; io.failPlan = new Map(); io.rpc = null
})

describe('F103 stranded inbound Ediel message', () => {
  it('a Z04 whose first processing threw is resumed by the next scheduled run and its failure is on its own timeline', async () => {
    io.tables.ediel_messages.push(z04(STRANDED, 'mail-4'), z04(SIBLING, 'mail-1'))
    io.tables.inbound_email_messages.push(mail('mail-4'), mail('mail-1'))
    io.failPlan.set(STRANDED, ['prodat_canonical_source_validation_unconfirmed'])
    io.fetchedMailIds = ['mail-4', 'mail-1']

    const first = await runInboundEdielMailEngine({ actorUserId: 'actor-1', environment: 'production', resumeStrandedInboundMessages: true })
    expect(first.debug.autoProcessErrors).toEqual([`${STRANDED}: prodat_canonical_source_validation_unconfirmed`])
    expect(statusOf(SIBLING)).toBe('parsed')
    expect(statusOf(STRANDED)).toBe('received')
    // Same run: the failed message is not retried immediately (excluded and within grace).
    expect(io.processed.filter((id) => id === STRANDED)).toHaveLength(1)
    expect(eventsOf(STRANDED)).toEqual([expect.objectContaining({ event_type: 'manual_note', event_status: 'error',
      payload: expect.objectContaining({ inboundBusinessProcessing: 'inbound_business_processing_failed', phase: 'first_run',
        error: 'prodat_canonical_source_validation_unconfirmed' }) })])

    // A later slot: no new mail, no job. Before the fix nothing selected the message.
    io.fetchedMailIds = []
    io.tables.ediel_messages.find((row) => row.id === STRANDED)!.updated_at = minutesAgo(15)
    const later = await runInboundEdielMailEngine({ actorUserId: 'actor-1', environment: 'production', resumeStrandedInboundMessages: true })
    expect(io.processed.filter((id) => id === STRANDED)).toHaveLength(2)
    expect(statusOf(STRANDED)).toBe('parsed')
    expect(later.debug.strandedInboundResume).toMatchObject({ claimed: 1, resumed: 1, failed: 0, exhausted: 0 })
    expect(eventsOf(STRANDED).filter((row) => (row.payload as Row).resume === STRANDED_INBOUND_RESUME_MARKER)).toEqual([expect.objectContaining({
      event_type: 'manual_note', event_status: 'warning', payload: expect.objectContaining({ kind: 'attempt', attempt: 1, maxAttempts: 3 }) })])
  })

  it('an engine run without the cron opt-in never resumes (manual polls keep their scope)', async () => {
    io.tables.ediel_messages.push(z04(STRANDED, 'mail-4', { updated_at: minutesAgo(30) }))
    io.tables.inbound_email_messages.push(mail('mail-4'))
    await runInboundEdielMailEngine({ actorUserId: 'actor-1', environment: 'production' })
    expect(io.processed).toEqual([])
    expect(statusOf(STRANDED)).toBe('received')
  })

  it('selects only stranded messages of the lane and tenant whose mail intake finished', async () => {
    const id = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`
    io.tables.ediel_messages.push(
      z04(id(1), 'm1', { updated_at: minutesAgo(30) }), // eligible
      z04(id(2), 'm2', { updated_at: minutesAgo(3) }), // within grace: maybe in flight
      z04(id(3), 'm3', { updated_at: minutesAgo(30), environment: 'test' }), // other lane
      z04(id(4), 'm4', { updated_at: minutesAgo(30) }), // mail intake not finished
      z04(id(5), 'm5', { updated_at: minutesAgo(30), status: 'parsed', processing_status: 'parsed' }),
      z04(id(6), 'm6', { updated_at: minutesAgo(30), tenant_resolution_status: 'tenant_not_found', processing_status: 'routing_unresolved' }),
      z04(id(7), 'm7', { updated_at: minutesAgo(30) }), // DSN mail
      z04(id(8), 'm8', { updated_at: minutesAgo(30), created_at: minutesAgo(8 * 24 * 60) }), // outside lookback
      z04(id(9), 'm9', { updated_at: minutesAgo(30), company_id: COMPANY_B }), // other tenant's mail row
      z04(id(10), 'm10', { updated_at: minutesAgo(30), direction: 'outbound' }),
      z04(id(11), 'm11', { updated_at: minutesAgo(30), processing_status: 'manual_review' }),
    )
    io.tables.inbound_email_messages.push(mail('m1'), mail('m2'), mail('m3'), mail('m4', { processing_status: 'received' }), mail('m5'),
      mail('m6'), mail('m7', { match_status: 'dsn_transport_review' }), mail('m8'), mail('m9', { company_id: COMPANY_A }), mail('m10'), mail('m11'))

    const lane = await claimStrandedInboundEdielMessages({ environment: 'production' })
    expect(lane.claimed.map((row) => row.id)).toEqual([id(1)])

    io.tables.ediel_messages.find((row) => row.id === id(1))!.updated_at = minutesAgo(30)
    expect((await claimStrandedInboundEdielMessages({ environment: 'production', companyId: COMPANY_B })).claimed).toEqual([])
    expect((await claimStrandedInboundEdielMessages({ environment: 'production', excludeIds: [id(1)] })).claimed).toEqual([])
  })

  it('two overlapping runs claim a stranded message once', async () => {
    io.tables.ediel_messages.push(z04(STRANDED, 'mail-4', { updated_at: minutesAgo(30) }))
    io.tables.inbound_email_messages.push(mail('mail-4'))
    const [left, right] = await Promise.all([
      claimStrandedInboundEdielMessages({ environment: 'production' }),
      claimStrandedInboundEdielMessages({ environment: 'production' }),
    ])
    expect([...left.claimed, ...right.claimed].map((row) => row.id)).toEqual([STRANDED])
  })

  it('stops after the attempt limit and leaves one operator note instead of retrying forever', async () => {
    io.tables.ediel_messages.push(z04(STRANDED, 'mail-4', { updated_at: minutesAgo(30) }))
    io.tables.inbound_email_messages.push(mail('mail-4'))
    io.failPlan.set(STRANDED, ['transient-1', 'transient-2', 'transient-3', 'never-reached'])
    const run = () => resumeStrandedInboundEdielMessages({ environment: 'production', actorUserId: 'actor-1', workerId: 'w', maxAttempts: 3,
      process: async (edielMessageId) => {
        const { processInboundEdielMessage } = await import('@/lib/ediel/flows/inboundProcessing')
        await processInboundEdielMessage({ actorUserId: 'actor-1', edielMessageId })
      } })
    const results = []
    for (let attempt = 0; attempt < 4; attempt += 1) {
      results.push(await run())
      io.tables.ediel_messages.find((row) => row.id === STRANDED)!.updated_at = minutesAgo(30)
    }
    expect(results.map((result) => result.claimed)).toEqual([1, 1, 1, 0])
    expect(results[2]).toMatchObject({ failed: 1, exhausted: 1 })
    expect(io.processed).toHaveLength(3)
    expect(statusOf(STRANDED)).toBe('received')
    const notes = eventsOf(STRANDED).filter((row) => row.event_type === 'manual_note')
    expect(notes.filter((row) => (row.payload as Row).exhausted === true)).toHaveLength(1)
    expect(notes.filter((row) => (row.payload as Row).inboundBusinessProcessing === 'inbound_business_processing_failed')).toHaveLength(3)
  })

  it('trigger: the PRODAT source-validation RPC outliving the 2 s client abort reads as unconfirmed although the server commits', async () => {
    let committed = false
    io.rpc = () => ({
      abortSignal: (signal: AbortSignal) => new Promise((resolve) => {
        // The database keeps executing after the HTTP client gave up (observed: 2233.6 ms max for this RPC).
        setTimeout(() => { committed = true }, 2_200)
        signal.addEventListener('abort', () => resolve({ data: null, error: { message: 'AbortError: This operation was aborted' } }))
      }),
    })
    const original = { id: STRANDED, company_id: COMPANY_A, message_family: 'PRODAT', environment: 'production' } as unknown as EdielMessageRow
    const receipt = await recordReceivedSourceValidation({ original, validated: original, resolvedCompanyId: COMPANY_A, decision: {} as CanonicalRuntimeDecision })
    expect(receipt.status).toBe('unconfirmed')
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(committed).toBe(true)
  }, 10_000)
})
