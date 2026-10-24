// reality-defects: F106
// Scenario F run 26 (tenant 7b53f121, production lane): 123 inbound UTILTS E66
// from the grid owner, but 42 never got a technical CONTRL and 18 got one that
// stayed a draft without an ediel_outbox row. The technical CONTRL step of
// processInboundEdielMessage hit statement timeouts (57014) or
// ediel_existing_ack_original_read_unavailable; it only wrote a
// "CONTRL skapades inte" note and processing went on to parsed/validated, so no
// mail job and not the F103 'received' resume ever revisited the source. Where
// the UTILTS runtime later created the CONTRL (createUtiltsRuntimeAcks) it never
// queued it. The scheduled inbound engine now resumes exactly those replies.
// Synthetic in-memory rows only; no database, no cron endpoint.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRecoveryRpcPort } from './helpers/edielRecoveryRpcPort'

type Row = Record<string, unknown>

const io = vi.hoisted(() => ({
  tables: { ediel_messages: [] as Row[], ediel_message_events: [] as Row[], ediel_outbox: [] as Row[] } as Record<string, Row[]>,
  resumed: [] as Row[],
  resumeFailures: [] as string[],
  outbox: [] as Row[],
  retainedReads: [] as Row[],
  retainedOverride: null as null | ((sourceId: string) => Row | null),
}))

let recovery: ReturnType<typeof createRecoveryRpcPort>

function columnValue(row: Row, column: string): unknown {
  const [base, key] = column.split('->>')
  if (key === undefined) return row[base]
  const value = row[base]
  return value && typeof value === 'object' ? (value as Row)[key] : undefined
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
    in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(columnValue(row, column))); return this }
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
  return { supabaseService: { from: (table: string) => new Query(table), rpc: (name: string, args: Row) => recovery.rpc(name, args) } }
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
  readExistingAckBeforeDraft: async (input: { sourceMessage: Row; ackFamily: string; ackScope?: string }) => {
    io.retainedReads.push({ sourceId: input.sourceMessage.id, ackFamily: input.ackFamily, ackScope: input.ackScope })
    if (io.retainedOverride) return io.retainedOverride(String(input.sourceMessage.id))
    return io.tables.ediel_messages.find((row) => row.related_message_id === input.sourceMessage.id && row.message_family === 'CONTRL') ?? null
  },
}))

vi.mock('@/lib/ediel/outbox/createOutboxItem', () => ({
  createOutboxItem: async (input: { message: Row; sourceMessageId: string; status: string; queueOnlyIfInserted?: boolean; payload?: Row }) => {
    io.outbox.push(input)
    // Insert-only on the reply's unique key, like the real upsert(ignoreDuplicates).
    if (!io.tables.ediel_outbox.some((row) => row.ediel_message_id === input.message.id)) {
      io.tables.ediel_outbox.push({ ediel_message_id: input.message.id, status: input.status, company_id: input.message.company_id, environment: input.message.environment, source_message_id: input.sourceMessageId })
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
}))
vi.mock('@/lib/inbound-mail/inboundOverdueMonitor', () => ({ createInboundOverdueTasks: async () => ({ ackOverdue: 0, z04Overdue: 0, z14Overdue: 0 }) }))
vi.mock('@/lib/customer-operations/automation', () => ({ processCustomerOperationJobs: async () => ({ claimed: 0, completed: 0, needsReview: 0, failed: 0, errors: [] }) }))
vi.mock('@/lib/ediel/flows/inboundProcessing', () => ({
  processInboundEdielMessage: async () => { throw new Error('business processing must not be re-run by the technical ACK resume') },
  resumeInboundTechnicalAck: async (input: { actorUserId: string; edielMessageId: string; companyId: string; environment: string }) => {
    io.resumed.push(input)
    const failure = io.resumeFailures.shift()
    if (failure) throw new Error(failure)
    const id = `contrl-for-${input.edielMessageId}`
    io.tables.ediel_messages.push({ id, company_id: input.companyId, environment: input.environment, direction: 'outbound',
      message_family: 'CONTRL', status: 'draft', related_message_id: input.edielMessageId })
    io.tables.ediel_outbox.push({ ediel_message_id: id, status: 'queued' })
    return { outcome: 'created', ackMessageId: id }
  },
}))

import { runInboundEdielMailEngine } from '@/lib/inbound-mail/edielMailboxPoller.part-3'
import { claimMissedTechnicalAcks, MISSED_TECHNICAL_ACK_RESUME_MARKER, resumeMissedTechnicalAcks } from '@/lib/inbound-mail/missedTechnicalAckResume'

const TENANT = '00000000-0000-4000-8000-0000000f1060'
const OTHER_TENANT = '00000000-0000-4000-8000-0000000f1061'
const ACTOR = '00000000-0000-4000-8000-0000000f10ac'
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
const id = (n: number) => `00000000-0000-4000-8000-0000000e66${String(n).padStart(2, '0')}`

function e66(n: number, overrides: Row = {}): Row {
  return { id: id(n), company_id: TENANT, environment: 'production', direction: 'inbound', message_standard: 'edifact',
    message_family: 'UTILTS', message_code: 'E66', status: 'parsed', processing_status: 'parsed', created_at: minutesAgo(60),
    updated_at: minutesAgo(30), ...overrides }
}
/** The note processInboundEdielMessage writes when the technical CONTRL step throws. */
function technicalFailure(sourceId: string, overrides: Row = {}, reason = 'canceling statement due to statement timeout · kod: 57014'): Row {
  const source = io.tables.ediel_messages.find((row) => row.id === sourceId)
  return { ediel_message_id: sourceId, company_id: source?.company_id ?? TENANT, event_type: 'manual_note', event_status: 'warning',
    message: `CONTRL skapades inte: ${reason}`, payload: { blockedBy: 'canonical_inbound_ack_guard', ackFamily: 'CONTRL', sourceMessageId: sourceId },
    created_at: minutesAgo(45), ...overrides }
}
function draftContrl(sourceId: string, ackId: string, overrides: Row = {}): Row {
  const source = io.tables.ediel_messages.find((row) => row.id === sourceId)!
  return { id: ackId, company_id: source.company_id, environment: source.environment, direction: 'outbound', message_family: 'CONTRL',
    status: 'draft', related_message_id: sourceId, ...overrides }
}
const resumeEvents = (messageId: string) => io.tables.ediel_message_events
  .filter((row) => row.ediel_message_id === messageId && (row.payload as Row).resume === MISSED_TECHNICAL_ACK_RESUME_MARKER)

beforeEach(() => {
  recovery = createRecoveryRpcPort(() => io.tables)
  io.tables.ediel_messages = []; io.tables.ediel_message_events = []; io.tables.ediel_outbox = []
  io.resumed = []; io.resumeFailures = []; io.outbox = []; io.retainedReads = []; io.retainedOverride = null
})

describe('F106 missed technical CONTRL', () => {
  it('the next scheduled run creates the CONTRL a timed-out source never got, without re-running its business processing', async () => {
    io.tables.ediel_messages.push(e66(1))
    io.tables.ediel_message_events.push(technicalFailure(id(1)))

    const run = await runInboundEdielMailEngine({ environment: 'production', actorUserId: ACTOR, resumeStrandedInboundMessages: true })

    expect(io.resumed).toEqual([{ actorUserId: ACTOR, edielMessageId: id(1), companyId: TENANT, environment: 'production' }])
    expect(run.debug.technicalAckResume).toMatchObject({ candidates: 1, claimed: 1, created: 1, requeued: 0, failed: 0 })
    expect(run.debug.autoProcessErrors).toEqual([])
    expect(resumeEvents(id(1))).toEqual([expect.objectContaining({ event_status: 'warning',
      payload: expect.objectContaining({ kind: 'attempt', mode: 'missing', attempt: 1, maxAttempts: 3 }) })])

    // Resolved: the next run selects nothing.
    const again = await runInboundEdielMailEngine({ environment: 'production', actorUserId: ACTOR, resumeStrandedInboundMessages: true })
    expect(again.debug.technicalAckResume).toMatchObject({ candidates: 0, claimed: 0 })
    expect(io.resumed).toHaveLength(1)
  })

  it('a CONTRL left as a draft without outbox entry is queued from its protected retained original', async () => {
    io.tables.ediel_messages.push(e66(2))
    io.tables.ediel_messages.push(draftContrl(id(2), 'contrl-draft-2'))
    io.tables.ediel_message_events.push(technicalFailure(id(2), {}, 'ediel_existing_ack_original_read_unavailable'))

    const run = await runInboundEdielMailEngine({ environment: 'production', actorUserId: ACTOR, resumeStrandedInboundMessages: true })

    expect(io.resumed).toEqual([])
    expect(io.retainedReads).toEqual([{ sourceId: id(2), ackFamily: 'CONTRL', ackScope: 'interchange' }])
    expect(io.outbox).toEqual([expect.objectContaining({ sourceMessageId: id(2), status: 'prepared', queueOnlyIfInserted: true,
      message: expect.objectContaining({ id: 'contrl-draft-2' }), payload: expect.objectContaining({ createdBy: 'missed_technical_ack_resume' }) })])
    expect(run.debug.technicalAckResume).toMatchObject({ candidates: 1, requeued: 1, failed: 0 })
    expect(resumeEvents('contrl-draft-2')).toEqual([expect.objectContaining({ payload: expect.objectContaining({ kind: 'attempt', mode: 'unqueued' }) })])

    const again = await runInboundEdielMailEngine({ environment: 'production', actorUserId: ACTOR, resumeStrandedInboundMessages: true })
    expect(again.debug.technicalAckResume).toMatchObject({ candidates: 0 })
    expect(io.outbox).toHaveLength(1)
  })

  it('a draft whose protected read names another reply is never queued', async () => {
    io.tables.ediel_messages.push(e66(3))
    io.tables.ediel_messages.push(draftContrl(id(3), 'contrl-draft-3'))
    io.tables.ediel_message_events.push(technicalFailure(id(3)))
    io.retainedOverride = () => ({ id: 'some-other-reply', company_id: TENANT, environment: 'production' })

    const result = await resumeMissedTechnicalAcks({ environment: 'production', actorUserId: ACTOR, workerId: 'w', resumeTechnicalAck: async () => { throw new Error('unused') } })

    expect(io.outbox).toEqual([])
    expect(result).toMatchObject({ claimed: 1, failed: 1, requeued: 0 })
    expect(result.errors[0]).toBe('contrl-draft-3: missed_technical_ack_retained_original_mismatch')
    expect(result.errors[1]).toContain('ediel_recovery_owner_outcome_ambiguous')
    expect(result.errors).toHaveLength(2)
  })

  it('only the failed technical replies of this lane and tenant are selected', async () => {
    io.tables.ediel_messages.push(
      e66(10), // missing, eligible
      e66(11), // CONTRL sent already
      e66(12), // draft CONTRL already queued
      e66(13, { status: 'received', processing_status: 'received' }), // F103 owns it
      e66(14, { environment: 'test' }), // other lane
      e66(15, { company_id: OTHER_TENANT }), // other tenant (tenant-scoped run)
      e66(16, { message_family: 'CONTRL', message_code: 'CONTRL' }), // a CONTRL is never acknowledged
      e66(17), // failure note too young (grace)
      e66(18), // no failure note at all
      e66(19, { status: 'cancelled' }),
    )
    io.tables.ediel_messages.push(draftContrl(id(11), 'contrl-sent-11', { status: 'sent' }), draftContrl(id(12), 'contrl-queued-12'))
    io.tables.ediel_outbox.push({ ediel_message_id: 'contrl-queued-12', status: 'failed' })
    for (const n of [10, 11, 12, 13, 14, 15, 16, 19]) io.tables.ediel_message_events.push(technicalFailure(id(n)))
    io.tables.ediel_message_events.push(technicalFailure(id(17), { created_at: minutesAgo(2) }))
    // An APERAK failure note is not a technical CONTRL failure.
    io.tables.ediel_message_events.push(technicalFailure(id(18), { payload: { blockedBy: 'canonical_inbound_ack_guard', ackFamily: 'APERAK' } }))

    const tenantRun = await claimMissedTechnicalAcks({ environment: 'production', companyId: TENANT })
    expect(tenantRun.claimed.map((row) => [row.kind, row.messageId])).toEqual([['missing', id(10)]])

    const laneRun = await claimMissedTechnicalAcks({ environment: 'production', excludeIds: [id(10)] })
    expect(laneRun.claimed.map((row) => [row.kind, row.messageId, row.companyId])).toEqual([['missing', id(15), OTHER_TENANT]])
    expect(io.outbox).toEqual([])
  })

  it('overlapping runs resume one missing reply once', async () => {
    io.tables.ediel_messages.push(e66(20))
    io.tables.ediel_message_events.push(technicalFailure(id(20)))
    const [left, right] = await Promise.all([
      claimMissedTechnicalAcks({ environment: 'production' }),
      claimMissedTechnicalAcks({ environment: 'production' }),
    ])
    expect([...left.claimed, ...right.claimed].map((row) => row.messageId)).toEqual([id(20)])
  })

  it('a thrown technical reply stays uncertain without a second automatic write', async () => {
    io.tables.ediel_messages.push(e66(30))
    io.tables.ediel_message_events.push(technicalFailure(id(30)))
    io.resumeFailures = ['canceling statement due to statement timeout', 'canceling statement due to statement timeout', 'ediel_existing_ack_original_read_unavailable']
    const options = { environment: 'production' as const, actorUserId: ACTOR, workerId: 'w', graceMinutes: 2,
      resumeTechnicalAck: async (target: { edielMessageId: string; companyId: string; environment: 'test' | 'production' }) => {
        const failure = io.resumeFailures.shift()
        io.resumed.push(target)
        if (failure) throw new Error(failure)
        return { outcome: 'created', ackMessageId: 'never' }
      } }
    const results = []
    for (let run = 0; run < 4; run += 1) {
      // A claim moves updated_at; the next scheduled run is a later minute.
      results.push(await resumeMissedTechnicalAcks({ ...options, now: () => new Date(Date.now() + run * 60_000) }))
    }
    expect(results.map((result) => [result.claimed, result.failed, result.exhausted])).toEqual([[1, 1, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]])
    expect(io.resumed).toHaveLength(1)
    expect(resumeEvents(id(30)).filter((row) => (row.payload as Row).kind === 'exhausted')).toEqual([])
    expect([...recovery.work.values()]).toEqual([expect.objectContaining({ state: 'uncertain', attempts: 1 })])
  })
  it('refuses a source whose persisted attempt history already reached the cap', async () => {
    io.tables.ediel_messages.push(e66(31))
    io.tables.ediel_message_events.push(technicalFailure(id(31)))
    for (let attempt = 1; attempt <= 3; attempt++) io.tables.ediel_message_events.push({ ediel_message_id: id(31), company_id: TENANT, event_type: 'manual_note', created_at: minutesAgo(30), payload: { resume: MISSED_TECHNICAL_ACK_RESUME_MARKER, kind: 'attempt', attempt } })
    const result = await resumeMissedTechnicalAcks({ environment: 'production', actorUserId: ACTOR, workerId: 'w', resumeTechnicalAck: async () => { throw new Error('exhausted work must never execute') } })
    expect(result).toMatchObject({ claimed: 0, created: 0, requeued: 0 })
    expect([...recovery.work.values()]).toEqual([expect.objectContaining({ state: 'exhausted', attempts: 3 })])
    expect(io.resumed).toEqual([])
  })

})
