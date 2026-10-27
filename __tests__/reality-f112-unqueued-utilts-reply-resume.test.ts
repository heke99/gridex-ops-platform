// reality-defects: F112
// Scenario F run 28 (tenant 53d47067, production lane): the reprocessed held
// E66 got their APERAK only as drafts without an ediel_outbox row (e.g.
// c8b83a21 and 9067d4af); earlier runs left 49 runtime CONTRL drafts the same
// way. The inbound cron now queues exactly the operational runtime replies that
// were left unqueued: lane- and tenant-scoped, claimed per source, bounded,
// counted, insert-only. Test Center/TGT drafts and pre-F112 test-lane drafts are
// never taken. The F106 technical-ACK resume also stops failing with
// "URI too long" (it read hundreds of ids in one PostgREST URL).
// Synthetic in-memory rows only; no database, no cron endpoint.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const io = vi.hoisted(() => ({
  tables: { ediel_messages: [] as Row[], ediel_message_events: [] as Row[], ediel_outbox: [] as Row[] } as Record<string, Row[]>,
  outbox: [] as Row[],
  retainedReads: [] as Row[],
  retainedOverride: null as null | ((input: Row) => Row | null),
  maxInList: 0,
}))

function columnValue(row: Row, column: string): unknown {
  const [base, key] = column.split('->>')
  if (key === undefined) return row[base]
  const value = row[base]
  if (!value || typeof value !== 'object') return undefined
  const member = (value as Row)[key]
  // ->> returns text, like PostgreSQL.
  return member === undefined || member === null ? null : typeof member === 'object' ? JSON.stringify(member) : String(member)
}

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
    eq(column: string, value: unknown) { this.filters.push((row) => columnValue(row, column) === value); return this }
    is(column: string, value: null) { this.filters.push((row) => (columnValue(row, column) ?? null) === value); return this }
    in(column: string, values: unknown[]) {
      // PostgREST puts the list into the URL; the world's gateway refused ~384 ids.
      if (values.length > 100) throw new Error('URI too long')
      io.maxInList = Math.max(io.maxInList, values.length)
      this.filters.push((row) => values.includes(columnValue(row, column)))
      return this
    }
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
  return { supabaseService: { from: (table: string) => new Query(table), rpc: () => { throw new Error('no rpc in this test') } } }
})

vi.mock('@/lib/ediel/db', () => ({
  createEdielMessageEvent: async (input: { edielMessageId: string; eventType: string; eventStatus?: string; message?: string; payload?: Row }) => {
    const row = { ediel_message_id: input.edielMessageId, event_type: input.eventType, event_status: input.eventStatus ?? 'info',
      message: input.message ?? null, payload: input.payload ?? {}, created_at: new Date().toISOString() }
    io.tables.ediel_message_events.push(row)
    return row
  },
}))

vi.mock('@/lib/ediel/core/ackDraftSource', () => ({
  readExistingAckBeforeDraft: async (input: { sourceMessage: Row; ackFamily: string; ackScope?: string; acknowledgedReferences?: string[]; outcome?: string }) => {
    const read = { sourceId: input.sourceMessage.id, ackFamily: input.ackFamily, ackScope: input.ackScope, references: input.acknowledgedReferences, outcome: input.outcome }
    io.retainedReads.push(read)
    if (io.retainedOverride) return io.retainedOverride(read)
    return io.tables.ediel_messages.find((row) => row.related_message_id === input.sourceMessage.id && row.message_family === input.ackFamily
      && (input.ackScope !== 'transaction' || (input.acknowledgedReferences ?? []).includes(String(row.transaction_reference)))) ?? null
  },
}))

vi.mock('@/lib/ediel/outbox/createOutboxItem', () => ({
  createOutboxItem: async (input: { message: Row; sourceMessageId: string; status: string; queueOnlyIfInserted?: boolean; payload?: Row }) => {
    io.outbox.push(input)
    // Insert-only on the reply's unique key, like the real upsert(ignoreDuplicates).
    if (!io.tables.ediel_outbox.some((row) => row.ediel_message_id === input.message.id)) {
      io.tables.ediel_outbox.push({ ediel_message_id: input.message.id, status: input.status })
    }
    return { id: `outbox-${String(input.message.id)}` }
  },
}))

vi.mock('@/lib/inbound-mail/edielMailboxPoller.part-1', () => ({
  NO_ACTIVE_EDIEL_MAILBOX_ERROR: 'no mailbox', nowIso: () => new Date().toISOString(),
  envInt: (_name: string, fallback: number) => fallback,
  listConfiguredEdielMailboxes: async () => [{ id: 'mb-1' }],
  mailboxSkipReason: () => null, mailboxDebugItem: (mailbox: unknown) => mailbox,
}))
vi.mock('@/lib/inbound-mail/edielMailboxPoller.part-2', () => ({
  pollEdielMailbox: async () => ({ mailboxId: 'mb-1', mailboxName: 'shared', fetched: 0, stored: 0, deduped: 0,
    inboundEmailMessageIds: [], dedupedInboundEmailMessageIds: [], errors: [] }),
  processQueuedInboundProcessingJobs: async () => ({ processed: 0, failed: 0, processedInboundEmailMessageIds: [] }),
  listEdielMessageIdsForInboundEmails: async () => [],
  ensureDiagnosticEdielMessagesForInboundEmails: async () => [], listRecentParsedInboundEmailIds: async () => [],
  logInboundPollRun: async () => undefined,
  mapWithConcurrency: async <T, R>(items: T[], _limit: number, run: (item: T) => Promise<R>) => Promise.all(items.map(run)),
  runInboundBusinessInArrivalLanes: async <R>(ids: string[], _limit: number, work: (id: string) => Promise<R>) => Promise.all(ids.map(work)),
}))
vi.mock('@/lib/inbound-mail/inboundOverdueMonitor', () => ({ createInboundOverdueTasks: async () => ({ ackOverdue: 0, z04Overdue: 0, z14Overdue: 0 }) }))
vi.mock('@/lib/customer-operations/automation', () => ({ processCustomerOperationJobs: async () => ({ claimed: 0, completed: 0, needsReview: 0, failed: 0, errors: [] }) }))
vi.mock('@/lib/ediel/flows/inboundProcessing', () => ({
  processInboundEdielMessage: async () => { throw new Error('business processing must not be re-run by the reply resume') },
  resumeInboundTechnicalAck: async () => { throw new Error('the reply resume never re-runs the technical CONTRL owner') },
}))

import { runInboundEdielMailEngine } from '@/lib/inbound-mail/edielMailboxPoller.part-3'
import { claimUnqueuedUtiltsRuntimeReplies, resumeUnqueuedUtiltsRuntimeReplies, UNQUEUED_UTILTS_REPLY_RESUME_MARKER } from '@/lib/inbound-mail/unqueuedUtiltsRuntimeReplyResume'
import { claimMissedTechnicalAcks } from '@/lib/inbound-mail/missedTechnicalAckResume'

const NOW = new Date()
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString()
const RAW = "UNH+1+UTILTS:D:02B:UN:E5SE5A'BGM+E66+DOC-1+9'UNT+3+1'"

function addSource(id: string, overrides: Row = {}): Row {
  const row = { id, company_id: 'tenant-a', environment: 'production', direction: 'inbound', message_standard: 'edifact',
    message_family: 'UTILTS', message_code: 'E66', status: 'validated', processing_status: 'validated', updated_at: minutesAgo(60),
    sender_ediel_id: '16700', receiver_ediel_id: '70309', application_reference: '23-DDQ-E66-T', raw_payload: RAW,
    parsed_payload: {}, validation_report: {}, ...overrides }
  io.tables.ediel_messages.push(row)
  return row
}

function addReply(id: string, sourceId: string, input: { family?: string; payload?: Row; at?: number; reference?: string } = {}): Row {
  const source = io.tables.ediel_messages.find((row) => row.id === sourceId)!
  const family = input.family ?? 'APERAK'
  const reference = input.reference ?? `T-${id}`
  const ack = { id, company_id: source.company_id, environment: source.environment, direction: 'outbound', message_family: family,
    status: 'draft', ack_outcome: 'positive', related_message_id: sourceId, transaction_reference: family === 'CONTRL' ? null : reference }
  io.tables.ediel_messages.push(ack)
  io.tables.ediel_message_events.push({ ediel_message_id: sourceId, company_id: source.company_id,
    event_type: family === 'CONTRL' ? 'contrl_sent' : family === 'APERAK' ? 'aperak_sent' : 'utilts_err_sent',
    message: `${family} hanterad via canonical kernel.`, created_at: minutesAgo(input.at ?? 30),
    payload: { ackMessageId: id, outcome: 'positive', ...(family === 'CONTRL' ? { ackScope: null, relatedTransactionReference: null }
      : { ackScope: 'transaction', relatedTransactionReference: reference }), ...(input.payload ?? {}) } })
  return ack
}

beforeEach(() => {
  io.tables = { ediel_messages: [], ediel_message_events: [], ediel_outbox: [] }
  io.outbox = []; io.retainedReads = []; io.retainedOverride = null; io.maxInList = 0
})

const resume = (overrides: Row = {}) => resumeUnqueuedUtiltsRuntimeReplies({ environment: 'production', actorUserId: 'actor-1',
  workerId: 'worker-1', now: () => NOW, ...overrides } as Parameters<typeof resumeUnqueuedUtiltsRuntimeReplies>[0])

describe('F112: stranded operational UTILTS runtime replies are queued by the inbound cron', () => {
  it('queues the world case: a production E66 APERAK draft without outbox row, from its protected original', async () => {
    addSource('src-1')
    addReply('c8b83a21', 'src-1', { reference: 'T260912145726' })
    const result = await resume()
    expect(result).toMatchObject({ candidates: 1, claimedSources: 1, claimed: 1, requeued: 1, failed: 0 })
    expect(io.retainedReads).toEqual([{ sourceId: 'src-1', ackFamily: 'APERAK', ackScope: 'transaction', references: ['T260912145726'], outcome: 'positive' }])
    expect(io.outbox).toHaveLength(1)
    expect(io.outbox[0]).toMatchObject({ status: 'prepared', queueOnlyIfInserted: true, sourceMessageId: 'src-1',
      message: { id: 'c8b83a21' }, payload: { createdBy: 'unqueued_utilts_reply_resume', provenance: 'pre_f112' } })
    expect(io.tables.ediel_message_events.find((row) => (row.payload as Row).resume === UNQUEUED_UTILTS_REPLY_RESUME_MARKER))
      .toMatchObject({ ediel_message_id: 'c8b83a21', payload: { kind: 'attempt', attempt: 1, maxAttempts: 3 } })
  })

  it('a later run or a concurrent run never queues the same reply twice', async () => {
    addSource('src-1')
    addReply('ack-1', 'src-1')
    const [first, second] = await Promise.all([resume(), resume()])
    expect(first.requeued + second.requeued).toBe(1)
    const third = await resume()
    expect(third).toMatchObject({ candidates: 0, claimed: 0, requeued: 0 })
    expect(io.outbox).toHaveLength(1)
    expect(io.tables.ediel_outbox).toHaveLength(1)
  })

  it('also queues an operational reply whose first outbox insert failed, in the test lane', async () => {
    addSource('src-t', { environment: 'test' })
    addReply('ack-t', 'src-t', { payload: { replyDispatch: 'operational_outbox', outboxQueued: false } })
    const result = await resume({ environment: 'test' })
    expect(result).toMatchObject({ requeued: 1 })
    expect(io.outbox[0]).toMatchObject({ message: { id: 'ack-t' }, payload: { provenance: 'queue_failed' } })
  })

  it('never takes Test Center/TGT drafts, pre-F112 test-lane drafts, queued replies or F106-owned CONTRL', async () => {
    addSource('src-tc', { environment: 'test' })
    addReply('ack-test-center', 'src-tc', { payload: { replyDispatch: 'draft_only', outboxQueued: null } })
    addSource('src-old-test', { environment: 'test' })
    addReply('ack-old-test', 'src-old-test')
    addSource('src-prod-draft-only')
    addReply('ack-draft-only', 'src-prod-draft-only', { payload: { replyDispatch: 'draft_only', outboxQueued: null } })
    addSource('src-queued')
    addReply('ack-queued', 'src-queued')
    io.tables.ediel_outbox.push({ ediel_message_id: 'ack-queued', status: 'blocked' })
    addSource('src-sent')
    addReply('ack-sent', 'src-sent').status = 'sent'
    addSource('src-portal', { sender_ediel_id: '91100' })
    addReply('ack-portal', 'src-portal')
    addSource('src-technical')
    addReply('contrl-technical', 'src-technical', { family: 'CONTRL' })
    io.tables.ediel_message_events.push({ ediel_message_id: 'src-technical', company_id: 'tenant-a', event_type: 'manual_note',
      message: 'CONTRL skapades inte: statement timeout', created_at: minutesAgo(40), payload: { blockedBy: 'canonical_inbound_ack_guard', ackFamily: 'CONTRL' } })
    addSource('src-young')
    addReply('ack-young', 'src-young', { at: 3 })
    addSource('src-cancelled', { status: 'cancelled' })
    addReply('ack-cancelled', 'src-cancelled')
    for (const environment of ['production', 'test'] as const) {
      expect(await claimUnqueuedUtiltsRuntimeReplies({ environment, now: () => NOW })).toEqual({ candidates: 0, claimedSources: 0, claimed: [] })
    }
    expect(io.outbox).toEqual([])
  })

  it('queues a runtime CONTRL draft without the F106 note, but keeps tenant and lane scope', async () => {
    addSource('src-a')
    addReply('contrl-a', 'src-a', { family: 'CONTRL' })
    addSource('src-b', { company_id: 'tenant-b' })
    addReply('ack-b', 'src-b')
    const scoped = await resume({ companyId: 'tenant-a' })
    expect(scoped).toMatchObject({ requeued: 1 })
    expect(io.retainedReads[0]).toMatchObject({ ackFamily: 'CONTRL', ackScope: 'interchange', references: [] })
    expect(io.outbox.map((call) => (call.message as Row).id)).toEqual(['contrl-a'])
    expect(await resume({ environment: 'test' })).toMatchObject({ candidates: 0 })
  })

  it('is bounded per run by sources and replies', async () => {
    for (let index = 0; index < 4; index += 1) {
      addSource(`src-${index}`)
      addReply(`ack-${index}-1`, `src-${index}`, { at: 60 - index })
      addReply(`ack-${index}-2`, `src-${index}`, { at: 60 - index })
    }
    expect(await resume({ limit: 2 })).toMatchObject({ claimedSources: 2, requeued: 4 })
    expect(await resume({ limit: 10, replyLimit: 3 })).toMatchObject({ claimed: 3, requeued: 3 })
  })

  it('never trusts a draft that is not the source’s protected original; gives up after max attempts', async () => {
    addSource('src-1')
    addReply('ack-1', 'src-1')
    io.retainedOverride = () => ({ id: 'another-reply', company_id: 'tenant-a', environment: 'production' })
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await resume({ now: () => new Date(NOW.getTime() + attempt * 1000) })
      expect(result).toMatchObject({ claimed: 1, requeued: 0, failed: 1, exhausted: attempt === 3 ? 1 : 0 })
      expect(result.errors[0]).toContain('unqueued_utilts_reply_retained_original_mismatch')
    }
    expect(await resume({ now: () => new Date(NOW.getTime() + 10_000) })).toMatchObject({ candidates: 0, claimed: 0 })
    expect(io.outbox).toEqual([])
  })

  it('runs in the scheduled inbound engine next to the F106 resume', async () => {
    addSource('src-1')
    addReply('ack-1', 'src-1', { at: 30 })
    const result = await runInboundEdielMailEngine({ actorUserId: 'actor-1', environment: 'production', resumeStrandedInboundMessages: true,
      sharedOnly: true, allowMissingMailboxConfig: true })
    expect(result.debug.utiltsReplyResume).toMatchObject({ requeued: 1, failed: 0 })
    expect(result.debug.autoProcessErrors).toEqual([])
    expect(io.tables.ediel_outbox).toEqual([{ ediel_message_id: 'ack-1', status: 'prepared' }])
  })

  it('without the scheduled flag the engine does not run the resume', async () => {
    addSource('src-1')
    addReply('ack-1', 'src-1')
    const result = await runInboundEdielMailEngine({ actorUserId: 'actor-1', environment: 'production', sharedOnly: true, allowMissingMailboxConfig: true })
    expect(result.debug.utiltsReplyResume ?? null).toBeNull()
    expect(io.outbox).toEqual([])
  })
})

describe('F112: the F106 technical-ACK resume reads its ids in chunks', () => {
  it('claims unqueued technical CONTRLs of hundreds of noted sources without "URI too long"', async () => {
    for (let index = 0; index < 150; index += 1) {
      addSource(`src-${index}`)
      io.tables.ediel_message_events.push({ ediel_message_id: `src-${index}`, company_id: 'tenant-a', event_type: 'manual_note',
        message: 'CONTRL skapades inte: statement timeout', created_at: minutesAgo(40), payload: { blockedBy: 'canonical_inbound_ack_guard', ackFamily: 'CONTRL' } })
      io.tables.ediel_messages.push({ id: `contrl-${index}`, company_id: 'tenant-a', environment: 'production', direction: 'outbound',
        message_family: 'CONTRL', status: 'draft', related_message_id: `src-${index}` })
    }
    const { candidates, claimed } = await claimMissedTechnicalAcks({ environment: 'production', now: () => NOW })
    expect(candidates).toBe(150)
    expect(claimed).toHaveLength(10)
    expect(claimed.every((row) => row.kind === 'unqueued')).toBe(true)
    expect(io.maxInList).toBeLessThanOrEqual(50)
  })
})
