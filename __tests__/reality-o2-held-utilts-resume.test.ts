// reality-defects: O2
// reality-defects: G-1 (scenario G: one inbound-mail cron run took 315 s; a held resume started late overran the route limit)
// Reality finding O2: inbound UTILTS held for internal review were released
// only by a platform admin (who is also a tenant member) pressing "Återuppta
// hållna transaktioner" per message (scenario F step F6c: ~123 clicks), and
// each held file became an APERAK/UTILTS-ERR SLA breach. The inbound cron now
// resumes a held source through the operator's own engine path once every held
// transaction's hold reason is resolved without a human decision (issuer or
// periodic evidence now present, bounded structure re-check), and never a hold
// that needs a human. Synthetic in-memory rows only; no database, no cron endpoint.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  issuerQualified: new Set<string>(),
  periodicQualified: new Set<string>(),
  rpcCalls: [] as Array<{ name: string; args: Row }>,
  processed: [] as Array<{ actorUserId: string; edielMessageId: string }>,
  processImpl: null as null | ((input: { actorUserId: string; edielMessageId: string }) => Promise<void>),
  members: new Set<string>(),
  activeTgtCase: null as string | null,
  clock: { now: new Date('2026-10-23T12:00:00.000Z') },
}))

function columnValue(row: Row, column: string): unknown {
  const [base, key] = column.split('->>')
  if (key === undefined) return row[base]
  const value = row[base]
  if (!value || typeof value !== 'object') return undefined
  const member = (value as Row)[key]
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
    in(column: string, values: unknown[]) {
      if (values.length > 100) throw new Error('URI too long')
      this.filters.push((row) => values.includes(columnValue(row, column)))
      return this
    }
    is(column: string, value: null) { this.filters.push((row) => (columnValue(row, column) ?? null) === value); return this }
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
      const copies = matched.map((row) => structuredClone(row))
      return { data: this.single ? copies[0] ?? null : copies, error: null }
    }
    then<A = { data: unknown; error: unknown }, B = never>(
      resolve?: ((value: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null,
      reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      return Promise.resolve().then(() => this.run()).then(resolve, reject)
    }
  }
  // The protected read RPCs, scoped like the SQL (company + source); status from the synthetic evidence state.
  const rpc = async (name: string, args: Row) => {
    io.rpcCalls.push({ name, args })
    const source = (io.tables.ediel_messages ?? []).find((row) => row.id === args.p_message_id && row.company_id === args.p_company_id)
    if (!source) return { data: null, error: { message: 'scope' } }
    const base = { version: 1, companyId: source.company_id, environment: source.environment, sourceMessageId: source.id }
    if (name === 'gridex_read_utilts_issuer_identity_authority_v1') {
      const qualified = io.issuerQualified.has(String(source.id))
      return { data: { ...base, status: qualified ? 'qualified' : 'held', authorityVersionId: qualified ? '55555555-5555-4555-8555-555555555555' : null,
        namespaceEpoch: qualified ? '1' : null, messageReferenceCollision: false, transactionReferenceCollisions: [],
        holdReason: qualified ? null : 'ediel_utilts_historical_issuer_basis_unavailable' }, error: null }
    }
    if (name === 'gridex_read_periodic_dgi_e66_reason_v1') {
      const qualified = io.periodicQualified.has(String(source.id))
      return { data: { ...base, status: qualified ? 'qualified' : 'held', expectedReasons: qualified ? [{ scopeHash: 'a'.repeat(64) }] : [],
        holdReason: qualified ? null : 'ediel_periodic_reason_current_contract_source_fact_required' }, error: null }
    }
    throw new Error(`unexpected rpc ${name}`)
  }
  return { supabaseService: { from: (table: string) => new Query(table), rpc } }
})

vi.mock('@/lib/ediel/db', () => ({
  createEdielMessageEvent: async (input: { edielMessageId: string; eventType: string; eventStatus?: string; message?: string; payload?: Row; actorUserId: string }) => {
    const row = { ediel_message_id: input.edielMessageId, event_type: input.eventType, event_status: input.eventStatus ?? 'info',
      message: input.message ?? null, payload: input.payload ?? {}, actor_user_id: input.actorUserId, created_at: io.clock.now.toISOString() }
    io.tables.ediel_message_events.push(row)
    return row
  },
}))

vi.mock('@/lib/ediel/services/authorization', () => ({
  // Active tenant member with the permission (synthetic membership set "company|actor").
  assertEdielTenantActor: async (input: { companyId: string; actorUserId: string; permission: string }) => {
    if (!io.members.has(`${input.companyId}|${input.actorUserId}`)) throw new Error('ediel_tenant_actor_forbidden')
  },
}))

vi.mock('@/lib/ediel/flows/utiltsDataRequest.part-1', () => ({
  resolveUtiltsRuntimeTestCaseCode: async (input: { sourceMessage: Row }) =>
    (input.sourceMessage.parsed_payload as Row | undefined)?.testCaseCode as string | undefined
      ?? (input.sourceMessage.environment === 'test' ? io.activeTgtCase : null),
}))

// The canonical processor. Like the real engine it re-reads the evidence: a source
// whose issuer/periodic basis is now present leaves review and gets its APERAK,
// queued in the outbox (operational origin, F112); otherwise it stays held.
vi.mock('@/lib/ediel/operationalBridge', () => ({
  processEdielOperationalMessage: async (input: { actorUserId: string; edielMessageId: string }) => {
    io.processed.push(input)
    if (io.processImpl) return io.processImpl(input)
    const rows = io.tables.ediel_ack_transaction_results.filter((row) => row.source_message_id === input.edielMessageId)
    for (const row of rows) {
      const codes = row.issue_codes as string[]
      const blocked = (codes.includes('UTILTS_ISSUER_IDENTITY_BASIS_UNAVAILABLE') && !io.issuerQualified.has(input.edielMessageId))
        || (codes.includes('UTILTS_PERIODIC_REASON_SOURCE_UNAVAILABLE') && !io.periodicQualified.has(input.edielMessageId))
        || codes.includes('UTILTS_STRUCTURE_UNAVAILABLE')
      if (blocked) continue
      const ackId = `aperak-${input.edielMessageId}-${String(row.source_transaction_id)}`
      io.tables.ediel_messages.push({ id: ackId, company_id: row.company_id, environment: row.environment, direction: 'outbound',
        message_family: 'APERAK', message_code: 'APERAK', status: 'prepared', related_message_id: input.edielMessageId,
        transaction_reference: row.source_transaction_id })
      io.tables.ediel_outbox.push({ ediel_message_id: ackId, status: 'prepared' })
      Object.assign(row, { disposition: 'accepted', planned_response_type: 'positive_aperak', final_response_type: 'positive_aperak',
        response_message_id: ackId, finalized_at: io.clock.now.toISOString(), issue_codes: [] })
    }
  },
}))

// The inbound-mail cron engine around the resume (mailbox polling and the other resumes find nothing here).
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
  mapWithConcurrency: async <T, R>(items: T[], _limit: number, work: (item: T) => Promise<R>) => Promise.all(items.map(work)),
  runInboundBusinessInArrivalLanes: async <R>(ids: string[], _limit: number, work: (id: string) => Promise<R>) => Promise.all(ids.map(work)),
}))
vi.mock('@/lib/inbound-mail/inboundOverdueMonitor', () => ({ createInboundOverdueTasks: async () => ({ ackOverdue: 0, z04Overdue: 0, z14Overdue: 0 }) }))
vi.mock('@/lib/customer-operations/automation', () => ({ processCustomerOperationJobs: async () => ({ claimed: 0, completed: 0, needsReview: 0, failed: 0, errors: [] }) }))
vi.mock('@/lib/ediel/flows/inboundProcessing', () => ({
  processInboundEdielMessage: async () => { throw new Error('first-run processing is not the held resume') },
  resumeInboundTechnicalAck: async () => { throw new Error('not the held resume') },
}))

import { runInboundEdielMailEngine } from '@/lib/inbound-mail/edielMailboxPoller.part-3'
import { classifyHeldUtiltsTransaction, HELD_UTILTS_RESUME_MARKER, resumeHeldInboundUtilts, roundRobinByCompany } from '@/lib/ediel/utilts/heldUtiltsResume'

const ACTOR = '22222222-2222-4222-8222-222222222222'
const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '99999999-9999-4999-8999-999999999999'
const ISSUER = 'UTILTS_ISSUER_IDENTITY_BASIS_UNAVAILABLE'
const at = (minutesAgo: number) => new Date(io.clock.now.getTime() - minutesAgo * 60_000).toISOString()
let serial = 0

function heldSource(input: { company?: string; environment?: 'test' | 'production'; codes?: string[][]; heldMinutesAgo?: number; source?: Row } = {}) {
  serial += 1
  const id = `src-${String(serial).padStart(3, '0')}`
  const company = input.company ?? TENANT_A, environment = input.environment ?? 'production'
  io.tables.ediel_messages.push({ id, company_id: company, environment, direction: 'inbound', message_standard: 'edifact',
    message_family: 'UTILTS', message_code: 'E66', status: 'validated', updated_at: at(input.heldMinutesAgo ?? 30),
    sender_ediel_id: '16700', receiver_ediel_id: '70309', application_reference: '23-DDQ-E66-S', raw_payload: "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
    parsed_payload: {}, validation_report: {}, ...(input.source ?? {}) })
  // The technical CONTRL exists already; it never blocks a held transaction.
  io.tables.ediel_messages.push({ id: `contrl-${id}`, company_id: company, environment, direction: 'outbound', message_family: 'CONTRL',
    message_code: 'CONTRL', status: 'sent', related_message_id: id, transaction_reference: null })
  for (const [index, codes] of (input.codes ?? [[ISSUER]]).entries()) {
    io.tables.ediel_ack_transaction_results.push({ company_id: company, environment, source_message_id: id, source_transaction_id: `T${serial}-${index}`,
      disposition: 'internal_review', planned_response_type: 'none', final_response_type: null, response_message_id: null, finalized_at: null,
      issue_codes: codes, created_at: at(input.heldMinutesAgo ?? 30), updated_at: at(input.heldMinutesAgo ?? 30) })
  }
  return id
}

const run = (overrides: Partial<Parameters<typeof resumeHeldInboundUtilts>[0]> = {}) => resumeHeldInboundUtilts({
  environment: 'production', actorUserId: ACTOR, workerId: 'worker-1', now: () => io.clock.now, ...overrides })
const resumeEvents = (id: string) => io.tables.ediel_message_events
  .filter((row) => row.ediel_message_id === id && (row.payload as Row).resume === HELD_UTILTS_RESUME_MARKER)
const stillHeld = (id: string) => io.tables.ediel_ack_transaction_results.some((row) => row.source_message_id === id && row.disposition === 'internal_review')

beforeEach(() => {
  io.tables = { ediel_messages: [], ediel_message_events: [], ediel_ack_transaction_results: [], ediel_outbox: [] }
  io.issuerQualified = new Set(); io.periodicQualified = new Set(); io.rpcCalls = []; io.processed = []; io.processImpl = null
  io.members = new Set([`${TENANT_A}|${ACTOR}`, `${TENANT_B}|${ACTOR}`]); io.activeTgtCase = null
  io.clock.now = new Date('2026-10-23T12:00:00.000Z'); serial = 0
})

describe('O2: hold reasons that resolve without a human decision', () => {
  it('classifies issuer, periodic and data-dependent structure holds as automatic; everything else stays manual', () => {
    expect(classifyHeldUtiltsTransaction({ issueCodes: [ISSUER] })).toEqual({ kind: 'automatic', classes: ['issuer_identity'] })
    expect(classifyHeldUtiltsTransaction({ issueCodes: ['UTILTS_PERIODIC_REASON_SOURCE_UNAVAILABLE'] })).toEqual({ kind: 'automatic', classes: ['periodic_reason'] })
    expect(classifyHeldUtiltsTransaction({ issueCodes: ['UTILTS_STRUCTURE_UNAVAILABLE'], structureReason: 'structural_state_missing' }))
      .toEqual({ kind: 'automatic', classes: ['structure_data'] })
    expect(classifyHeldUtiltsTransaction({ issueCodes: ['UTILTS_STRUCTURE_UNAVAILABLE'], structureReason: 'utilts_consumption_identity_unsupported' }))
      .toEqual({ kind: 'manual', reason: 'structure_requires_review' })
    expect(classifyHeldUtiltsTransaction({ issueCodes: ['UTILTS_STRUCTURE_UNAVAILABLE'], structureReason: 'structural_baseline_ambiguous' }))
      .toEqual({ kind: 'manual', reason: 'structure_requires_review' })
    expect(classifyHeldUtiltsTransaction({ issueCodes: ['UTILTS_STRUCTURE_UNAVAILABLE'] })).toEqual({ kind: 'manual', reason: 'structure_evidence_missing' })
    expect(classifyHeldUtiltsTransaction({ issueCodes: ['UTILTS_REGULATING_OBJECT_OWNER_UNAVAILABLE', ISSUER] })).toEqual({ kind: 'manual', reason: 'regulating_object_owner' })
    expect(classifyHeldUtiltsTransaction({ issueCodes: [] })).toEqual({ kind: 'manual', reason: 'unknown_hold' })
    expect(classifyHeldUtiltsTransaction({ issueCodes: ['UTILTS_SOMETHING_NEW'] })).toEqual({ kind: 'manual', reason: 'unknown_hold' })
  })
})

describe('O2: the inbound cron resumes held UTILTS once the issuer evidence is approved', () => {
  it('waits while the issuer basis is missing, then resumes every held file through the operator engine path', async () => {
    const sources = [heldSource(), heldSource(), heldSource()]
    // Before approval (the world before F6c): nothing is re-run, nothing is answered.
    const before = await run()
    expect(before).toMatchObject({ heldSources: 3, evaluated: 3, waiting: 3, claimed: 0, resumed: 0, failed: 0 })
    expect(io.processed).toEqual([])
    expect(io.tables.ediel_outbox).toEqual([])

    for (const id of sources) io.issuerQualified.add(id)
    const after = await run()
    expect(after).toMatchObject({ heldSources: 3, claimed: 3, resumed: 3, stillHeld: 0, failed: 0, errors: [] })
    // Same path as the operator: processEdielOperationalMessage for the tenant's source, as the automation actor.
    expect(io.processed).toEqual(sources.map((edielMessageId) => ({ actorUserId: ACTOR, edielMessageId })))
    for (const id of sources) {
      expect(stillHeld(id)).toBe(false)
      expect(io.tables.ediel_outbox.filter((row) => String(row.ediel_message_id).startsWith(`aperak-${id}`))).toHaveLength(1)
      const events = resumeEvents(id)
      expect(events.map((row) => (row.payload as Row).kind)).toEqual(['attempt', 'result'])
      expect(events[0].payload).toMatchObject({ holdClasses: ['issuer_identity'], attempt: 1, maxAttempts: 6, fingerprint: 'issuer:55555555-5555-4555-8555-555555555555:1' })
      // The operator's attempt event, marked as the scheduled resume.
      expect(events[1].payload).toMatchObject({ phase: 'utilts_source_resumption_attempt', outcome: 'processed', resumedBy: 'scheduled_held_utilts_resume',
        mode: 'held_transactions', heldTransactionIdsBefore: [expect.any(String)], heldTransactionIdsAfter: [] })
    }
    // Every protected read was scoped to the source's own tenant.
    for (const call of io.rpcCalls) {
      const source = io.tables.ediel_messages.find((row) => row.id === call.args.p_message_id)!
      expect(call.args.p_company_id).toBe(source.company_id)
    }
  })

  it('is idempotent: a later run finds nothing, and two concurrent runs run the engine once per source', async () => {
    const a = heldSource(), b = heldSource()
    io.issuerQualified.add(a); io.issuerQualified.add(b)
    const [first, second] = await Promise.all([run(), run()])
    expect(first.claimed + second.claimed).toBe(2)
    expect(io.processed.map((row) => row.edielMessageId).sort()).toEqual([a, b])
    const third = await run()
    expect(third).toMatchObject({ heldSources: 0, claimed: 0 })
    expect(io.processed).toHaveLength(2)
  })

  it('does not re-run a source again for the same evidence when the engine still holds it', async () => {
    const id = heldSource()
    io.issuerQualified.add(id)
    io.processImpl = async () => undefined // the engine re-checks and still holds (e.g. another basis is missing)
    expect(await run()).toMatchObject({ claimed: 1, stillHeld: 1 })
    // updated_at must age past the grace window again; the same evidence is never retried.
    io.clock.now = new Date(io.clock.now.getTime() + 60 * 60_000)
    expect(await run()).toMatchObject({ claimed: 0, alreadyTried: 1 })
    expect(io.processed).toHaveLength(1)
  })

  it('retries a failed run within maxAttempts and then leaves the source to the operator', async () => {
    const id = heldSource()
    io.issuerQualified.add(id)
    io.processImpl = async () => { throw new Error('statement timeout') }
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      io.clock.now = new Date(io.clock.now.getTime() + 10 * 60_000)
      expect(await run({ maxAttempts: 3 })).toMatchObject({ claimed: 1, failed: 1 })
    }
    io.clock.now = new Date(io.clock.now.getTime() + 10 * 60_000)
    expect(await run({ maxAttempts: 3 })).toMatchObject({ claimed: 0, exhausted: 1 })
    expect(io.processed).toHaveLength(3)
    const kinds = resumeEvents(id).map((row) => (row.payload as Row).kind)
    expect(kinds.filter((kind) => kind === 'attempt')).toHaveLength(3)
    expect(kinds).toContain('exhausted')
    // The core's own failure record is kept for every attempt.
    expect(resumeEvents(id).filter((row) => (row.payload as Row).outcome === 'failed')).toHaveLength(3)
  })

  it('resumes a periodic-reason hold once the protected periodic read qualifies', async () => {
    const id = heldSource({ codes: [['UTILTS_PERIODIC_REASON_SOURCE_UNAVAILABLE']] })
    expect(await run()).toMatchObject({ waiting: 1, claimed: 0 })
    io.periodicQualified.add(id)
    expect(await run()).toMatchObject({ claimed: 1, resumed: 1 })
    expect(stillHeld(id)).toBe(false)
  })

  it('re-checks a data-dependent structure hold only on a bounded backoff', async () => {
    const id = heldSource({ codes: [['UTILTS_STRUCTURE_UNAVAILABLE']], heldMinutesAgo: 10,
      source: { parsed_payload: { normalizedMeteringPayload: { receivedStructureQualification: { comparisons: [
        { transactionId: 'T1-0', status: 'unavailable', reason: 'structural_state_missing' }] } } } } })
    expect(await run()).toMatchObject({ waiting: 1, claimed: 0 })
    const checks: string[] = []
    for (const minutes of [10, 70, 6 * 60 + 70, 24 * 60 + 6 * 60 + 70, 3 * 24 * 60]) {
      io.clock.now = new Date(Date.parse('2026-10-23T12:00:00.000Z') + minutes * 60_000)
      const result = await run()
      if (result.claimed) checks.push(String(resumeEvents(id).at(-1)!.payload && (resumeEvents(id).at(-1)!.payload as Row).fingerprint))
    }
    // One re-check per backoff step (15 min, 1 h, 6 h, 24 h), then only the operator.
    expect(checks).toEqual(['structure:0', 'structure:1', 'structure:2', 'structure:3'])
    expect(stillHeld(id)).toBe(true)
  })
})

describe('O2: holds that need a human, and sources that are not operational, are never resumed', () => {
  it('leaves regulating-object, wire-fixed structure, unknown and mixed holds to the operator', async () => {
    const regulating = heldSource({ codes: [['UTILTS_REGULATING_OBJECT_OWNER_UNAVAILABLE']] })
    const wire = heldSource({ codes: [['UTILTS_STRUCTURE_UNAVAILABLE']], source: { parsed_payload: { normalizedMeteringPayload: { receivedStructureQualification: {
      comparisons: [{ transactionId: 'T2-0', status: 'unavailable', reason: 'utilts_consumption_identity_unsupported' }] } } } } })
    const unknown = heldSource({ codes: [['UTILTS_NOT_A_KNOWN_HOLD']] })
    const mixed = heldSource({ codes: [[ISSUER], ['UTILTS_REGULATING_OBJECT_OWNER_UNAVAILABLE']] })
    for (const id of [regulating, wire, unknown, mixed]) io.issuerQualified.add(id)
    expect(await run()).toMatchObject({ heldSources: 4, manual: 4, claimed: 0 })
    expect(io.processed).toEqual([])
    expect(io.tables.ediel_message_events).toEqual([])
  })

  it('skips TGT test cases, AGT/system-test sources and Ediel-portal references exactly like the reply dispatch', async () => {
    const tgtCase = heldSource({ environment: 'test', source: { parsed_payload: { testCaseCode: 'U2.1.8b' } } })
    const agt = heldSource({ environment: 'test', source: { parsed_payload: { fileEngine: { mode: 'agt' } } } })
    const systemTest = heldSource({ environment: 'test', source: { parsed_payload: { systemTest: { suite: 'utilts' } } } })
    const operationalTest = heldSource({ environment: 'test' })
    for (const id of [tgtCase, agt, systemTest, operationalTest]) io.issuerQualified.add(id)
    expect(await run({ environment: 'test' })).toMatchObject({ heldSources: 4, notOperational: 3, claimed: 1, resumed: 1 })
    expect(io.processed.map((row) => row.edielMessageId)).toEqual([operationalTest])

    const portal = heldSource({ source: { sender_ediel_id: '91100', application_reference: '23-DDQ-E66-T' } })
    io.issuerQualified.add(portal)
    io.activeTgtCase = 'U2.1.1'
    const activeRun = heldSource({ environment: 'test' })
    io.issuerQualified.add(activeRun)
    expect(await run()).toMatchObject({ notOperational: 1, claimed: 0 })
    expect(await run({ environment: 'test' })).toMatchObject({ claimed: 0 })
    expect(io.processed).toHaveLength(1)
  })

  it('never crosses tenants or lanes, and skips a tenant whose actor is not an active member', async () => {
    const a = heldSource({ company: TENANT_A }), b = heldSource({ company: TENANT_B }), testLane = heldSource({ company: TENANT_A, environment: 'test' })
    for (const id of [a, b, testLane]) io.issuerQualified.add(id)
    io.members.delete(`${TENANT_B}|${ACTOR}`)
    const result = await run()
    expect(result).toMatchObject({ heldSources: 2, claimed: 1, resumed: 1, skippedCompanies: 1 })
    expect(result.errors).toEqual([expect.stringContaining(`${TENANT_B}: actor_not_authorized`)])
    expect(io.processed.map((row) => row.edielMessageId)).toEqual([a])
    expect(stillHeld(b)).toBe(true)
    expect(stillHeld(testLane)).toBe(true)

    io.members.add(`${TENANT_B}|${ACTOR}`)
    expect(await run({ companyId: TENANT_A })).toMatchObject({ heldSources: 0 })
    expect(await run({ companyId: TENANT_B })).toMatchObject({ heldSources: 1, resumed: 1 })
  })
})

describe('O2: per-run budgets and per-company fairness', () => {
  it('takes companies in turn and stops at the count budget', async () => {
    const a = Array.from({ length: 8 }, () => heldSource({ company: TENANT_A, heldMinutesAgo: 60 }))
    const b = Array.from({ length: 2 }, () => heldSource({ company: TENANT_B, heldMinutesAgo: 30 }))
    for (const id of [...a, ...b]) io.issuerQualified.add(id)
    expect(await run({ limit: 4 })).toMatchObject({ heldSources: 10, claimed: 4, resumed: 4 })
    expect(io.processed.map((row) => row.edielMessageId)).toEqual([a[0], b[0], a[1], b[1]])
    expect(roundRobinByCompany([{ companyId: 'x', n: 1 }, { companyId: 'x', n: 2 }, { companyId: 'y', n: 3 }]).map((row) => row.n)).toEqual([1, 3, 2])
  })

  it('starts no new source after the time budget', async () => {
    for (let index = 0; index < 3; index += 1) io.issuerQualified.add(heldSource())
    io.processImpl = async () => { io.clock.now = new Date(io.clock.now.getTime() + 90_000) }
    const result = await run({ timeBudgetMs: 120_000 })
    expect(result).toMatchObject({ claimed: 2, budgetExhausted: true })
  })

  it('does not touch a hold younger than the grace window (its creating run may still be working)', async () => {
    io.issuerQualified.add(heldSource({ heldMinutesAgo: 1 }))
    expect(await run()).toMatchObject({ heldSources: 0, claimed: 0 })
  })
})

describe('O2: the scheduled inbound-mail cron runs the held resume', () => {
  it('resumes a held source whose issuer evidence is approved, only in the scheduled lane run', async () => {
    const id = heldSource()
    io.issuerQualified.add(id)
    const manual = await runInboundEdielMailEngine({ actorUserId: ACTOR, environment: 'production', sharedOnly: true, allowMissingMailboxConfig: true })
    expect(manual.debug.heldUtiltsResume ?? null).toBeNull()
    expect(io.processed).toEqual([])

    const scheduled = await runInboundEdielMailEngine({ actorUserId: ACTOR, environment: 'production', resumeStrandedInboundMessages: true,
      sharedOnly: true, allowMissingMailboxConfig: true })
    expect(scheduled.debug.heldUtiltsResume).toMatchObject({ heldSources: 1, claimed: 1, resumed: 1, failed: 0 })
    expect(scheduled.debug.autoProcessErrors).toEqual([])
    expect(io.processed).toEqual([{ actorUserId: ACTOR, edielMessageId: id }])
    expect(stillHeld(id)).toBe(false)
  })
})

describe('G-1: the held resume starts no source it cannot finish before the route deadline', () => {
  const T0 = Date.parse('2026-10-23T12:00:00.000Z')

  it('starts a source only when its expected duration fits before the deadline', async () => {
    for (let index = 0; index < 3; index += 1) io.issuerQualified.add(heldSource())
    // One resume stores a whole file: 150 s each, as measured in scenario G.
    io.processImpl = async () => { io.clock.now = new Date(io.clock.now.getTime() + 150_000) }
    const result = await run({ timeBudgetMs: 600_000, deadlineAt: T0 + 270_000, expectedSourceMs: 100_000 })
    // Start 0 s (0+100 <= 270), finished 150 s; next needs the observed 150 s: 300 > 270, not started.
    expect(result).toMatchObject({ claimed: 1, budgetExhausted: true })
    expect(io.processed).toHaveLength(1)
    expect(io.clock.now.getTime()).toBeLessThanOrEqual(T0 + 270_000)
  })

  it('starts nothing when the expected duration no longer fits (e.g. after a long mail batch)', async () => {
    const id = heldSource()
    io.issuerQualified.add(id)
    const result = await run({ deadlineAt: T0 + 140_000, expectedSourceMs: 150_000 })
    expect(result).toMatchObject({ claimed: 0, budgetExhausted: true })
    expect(io.processed).toEqual([])
    expect(stillHeld(id)).toBe(true)
    expect(resumeEvents(id)).toEqual([])
    // A later run with time left resumes it.
    expect(await run({ deadlineAt: T0 + 270_000, expectedSourceMs: 150_000 })).toMatchObject({ claimed: 1, resumed: 1 })
    expect(stillHeld(id)).toBe(false)
  })

  it('re-checks the deadline after probing, just before claiming', async () => {
    const id = heldSource()
    io.issuerQualified.add(id)
    const probe = io.clock.now.getTime()
    // The (synthetic) clock advances 60 s while the protected issuer read runs.
    const now = () => new Date(io.rpcCalls.length > 0 ? probe + 60_000 : probe)
    const result = await run({ now, deadlineAt: probe + 200_000, expectedSourceMs: 150_000 })
    expect(result).toMatchObject({ evaluated: 1, claimed: 0, budgetExhausted: true })
    expect(io.rpcCalls.map((call) => call.name)).toContain('gridex_read_utilts_issuer_identity_authority_v1')
    expect(io.processed).toEqual([])
  })

  it('without a deadline keeps the time-budget behaviour unchanged', async () => {
    for (let index = 0; index < 3; index += 1) io.issuerQualified.add(heldSource())
    io.processImpl = async () => { io.clock.now = new Date(io.clock.now.getTime() + 90_000) }
    expect(await run({ timeBudgetMs: 120_000, expectedSourceMs: 150_000 })).toMatchObject({ claimed: 2, budgetExhausted: true })
  })

  it('the inbound engine passes the route deadline to the held resume', async () => {
    const id = heldSource()
    io.issuerQualified.add(id)
    const late = await runInboundEdielMailEngine({ actorUserId: ACTOR, environment: 'production', resumeStrandedInboundMessages: true,
      sharedOnly: true, allowMissingMailboxConfig: true, deadlineAt: Date.now() + 60_000 })
    expect(late.debug.heldUtiltsResume).toMatchObject({ claimed: 0, budgetExhausted: true })
    expect(io.processed).toEqual([])
    const early = await runInboundEdielMailEngine({ actorUserId: ACTOR, environment: 'production', resumeStrandedInboundMessages: true,
      sharedOnly: true, allowMissingMailboxConfig: true, deadlineAt: Date.now() + 270_000 })
    expect(early.debug.heldUtiltsResume).toMatchObject({ claimed: 1, resumed: 1 })
    expect(stillHeld(id)).toBe(false)
  })
})
