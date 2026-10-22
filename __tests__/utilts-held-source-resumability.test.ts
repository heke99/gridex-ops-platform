// FINDINGS F80: an inbound UTILTS source whose own transactions are held for
// internal review must stay resumable after the evidence is approved, even when
// CONTRL or replies for OTHER transactions already exist. One server-side rule
// (lib/ediel/utilts/utiltsResumability.ts) governs the detail page, the list
// and processEdielOperationalMessageAction. Synthetic data only.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const db = vi.hoisted(() => {
  const state = {
    messages: [] as Record<string, unknown>[],
    transactions: [] as Record<string, unknown>[],
    reads: [] as { table: string; filters: [string, string, unknown][] }[],
  }
  const tableRows = (table: string) => table === 'ediel_messages' ? state.messages
    : table === 'ediel_ack_transaction_results' ? state.transactions : []
  const from = (table: string) => {
    const filters: [string, string, unknown][] = []
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.limit = () => q
    q.eq = (column: string, value: unknown) => { filters.push(['eq', column, value]); return q }
    q.in = (column: string, values: unknown[]) => { filters.push(['in', column, values]); return q }
    q.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
      state.reads.push({ table, filters: [...filters] })
      const data = tableRows(table).filter((row) => filters.every(([op, column, value]) =>
        op === 'eq' ? row[column] === value : (value as unknown[]).includes(row[column])))
      return Promise.resolve({ data: structuredClone(data), error: null }).then(resolve, reject)
    }
    return q
  }
  return { state, from }
})

const io = vi.hoisted(() => ({
  access: vi.fn(),
  scoped: vi.fn(),
  process: vi.fn(),
  event: vi.fn(),
  listAcks: vi.fn(),
  revalidate: vi.fn(),
  revalidateRelated: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: db.from } }))
vi.mock('@/lib/ediel/actionAccess', () => ({ requireEdielWriteActionAccess: io.access, requireEdielSendActionAccess: io.access }))
vi.mock('@/lib/ediel/operationalBridge', () => ({ processEdielOperationalMessage: io.process }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: io.event }))
vi.mock('@/lib/ediel/inbound/businessAckMessages', () => ({ listBusinessAckMessagesForSource: io.listAcks }))
vi.mock('@/app/admin/ediel/actions.part-1', () => ({
  formString: (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null,
  isPostgresUniqueViolation: (error: unknown) => Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === '23505'),
  requireScopedEdielMessageForAction: io.scoped,
  revalidateEdiel: io.revalidate,
  revalidateRelatedMessage: io.revalidateRelated,
}))
vi.mock('@/app/admin/ediel/actions.part-2', () => ({
  isActiveEdielAckMessage: (m: Row) => !['cancelled', 'failed', 'error', 'rejected'].includes(String(m.status ?? '')),
  isOperationalAckMessage: (m: Row) => ['CONTRL', 'APERAK', 'UTILTS_ERR'].includes(String(m.message_family)),
  isUtiltsErrAckMessage: (m: Row) => String(m.message_family) === 'UTILTS_ERR',
}))
vi.mock('@/app/admin/ediel/actions.part-4', () => ({}))
// Unrelated collaborators of actions.part-3 (PRODAT/ACK drafting) are not used here.
vi.mock('@/lib/ediel/prodat/prodatEnergyProduct', () => ({}))
vi.mock('@/lib/ediel/testing/utiltsAckOverrides', () => ({}))
vi.mock('@/lib/ediel/orchestrator', () => ({}))
vi.mock('@/lib/ediel/ack', () => ({}))
vi.mock('@/lib/ediel/utiltsEngine', () => ({}))
vi.mock('@/lib/ediel/testing/ackDecisionEngine', () => ({}))
vi.mock('@/lib/ediel/core/ackPreflight', () => ({}))
vi.mock('@/lib/ediel/prodat/prodatPriorPermissionFlow', () => ({}))
vi.mock('@/lib/ediel/prodat/loadPriorPermissionFlow', () => ({}))
vi.mock('@/lib/ediel/testing/prodatPermissionEngine', () => ({}))
vi.mock('@/lib/ediel/testing/aperakErrorRuleRegistry', () => ({}))
vi.mock('@/lib/ediel/operationalVerification', () => ({}))

import {
  appendUtiltsRuntimeHistory,
  decideUtiltsSourceResumability,
  describeUtiltsSourceResumability,
  readUtiltsSourceResumability,
  readUtiltsSourceResumabilityForSources,
} from '@/lib/ediel/utilts/utiltsResumability'
import {
  classifyUtiltsResumptionError,
  processEdielOperationalMessageAction,
  runEdielOperationalMessageAction,
} from '@/app/admin/ediel/actions.part-3'

const COMPANY = '11111111-1111-4111-8111-111111111111'
const FOREIGN = '99999999-9999-4999-8999-999999999999'
const ACTOR = '22222222-2222-4222-8222-222222222222'
const SOURCE = '33333333-3333-4333-8333-333333333333'
const id = (n: number) => `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`

function source(overrides: Row = {}): Row {
  return { id: SOURCE, company_id: COMPANY, environment: 'test', direction: 'inbound', message_family: 'UTILTS', message_code: 'E66', ...overrides }
}
function reply(n: number, family: string, overrides: Row = {}): Row {
  return { id: id(n), company_id: COMPANY, environment: 'test', direction: 'outbound', related_message_id: SOURCE,
    message_family: family, message_code: family === 'UTILTS_ERR' ? 'ERR' : 'E66', status: 'draft', transaction_reference: null, ...overrides }
}
function tx(transactionId: string, disposition: string, overrides: Row = {}): Row {
  const planned = disposition === 'internal_review' ? 'none' : disposition === 'accepted' ? 'positive_aperak'
    : disposition === 'processability_rejected' ? 'utilts_err' : 'negative_aperak'
  return { company_id: COMPANY, environment: 'test', source_message_id: SOURCE, source_transaction_id: transactionId,
    disposition, planned_response_type: planned, final_response_type: null, response_message_id: null, finalized_at: null,
    issue_codes: disposition === 'internal_review' ? ['UTILTS_ISSUER_IDENTITY_BASIS_UNAVAILABLE'] : [], ...overrides }
}
function finalized(row: Row, responseType: string, replyId: string): Row {
  return { ...row, final_response_type: responseType, response_message_id: replyId, finalized_at: '2026-10-20T10:00:00.000Z' }
}
const read = (companyId = COMPANY, environment: string | null = 'test') =>
  readUtiltsSourceResumability({ companyId, sourceMessageId: SOURCE, environment })

beforeEach(() => {
  vi.clearAllMocks()
  db.state.messages = [source()]
  db.state.transactions = []
  db.state.reads = []
  io.access.mockResolvedValue({ userId: ACTOR, companyId: COMPANY })
  io.scoped.mockImplementation(async (messageId: string) => db.state.messages.find((m) => m.id === messageId))
  io.event.mockResolvedValue({ id: 'event' })
  io.process.mockResolvedValue({ messageId: SOURCE, kind: 'inbound_utilts', processed: true, summary: 'ok' })
  io.listAcks.mockResolvedValue([])
})

describe('readUtiltsSourceResumability (single rule)', () => {
  it('(a) a held source with only a CONTRL is resumable for its held transaction', async () => {
    db.state.messages.push(reply(1, 'CONTRL', { status: 'sent' }))
    db.state.transactions = [tx('T1', 'internal_review')]
    const decision = await read()
    expect(decision).toMatchObject({ resumable: true, reason: 'held_transactions', heldTransactionIds: ['T1'],
      activeProtocolReplyIds: [id(1)], activeApplicationReplyIds: [] })
    expect(decision.heldTransactions).toEqual([{ transactionId: 'T1', issueCodes: ['UTILTS_ISSUER_IDENTITY_BASIS_UNAVAILABLE'] }])
    expect(describeUtiltsSourceResumability(decision)).toContain('bevarade originalet')
  })

  it('(b) a held transaction stays resumable when rejected siblings already have negative APERAK / UTILTS-ERR', async () => {
    db.state.messages.push(
      reply(1, 'CONTRL', { status: 'sent' }),
      reply(2, 'APERAK', { status: 'sent', transaction_reference: 'T2' }),
      reply(3, 'UTILTS_ERR', { status: 'sent', transaction_reference: 'T3' }),
    )
    db.state.transactions = [
      tx('T1', 'internal_review'),
      finalized(tx('T2', 'guide_rejected'), 'negative_aperak', id(2)),
      finalized(tx('T3', 'processability_rejected'), 'utilts_err', id(3)),
    ]
    expect(await read()).toMatchObject({ resumable: true, reason: 'held_transactions', heldTransactionIds: ['T1'],
      rejectedTransactionIds: ['T2', 'T3'], finalizedTransactionIds: ['T2', 'T3'], activeApplicationReplyIds: [id(2), id(3)] })
  })

  it('(b) a sibling reply whose finalization was not yet written does not block the held transaction', async () => {
    db.state.messages.push(reply(2, 'APERAK', { transaction_reference: 'T2' }))
    db.state.transactions = [tx('T1', 'internal_review'), tx('T2', 'guide_rejected')]
    expect(await read()).toMatchObject({ resumable: true, reason: 'held_transactions', heldTransactionIds: ['T1'] })
  })

  it('(c) a cancelled or failed reply never affects the decision', async () => {
    db.state.transactions = [tx('T1', 'internal_review')]
    db.state.messages.push(reply(5, 'APERAK', { status: 'cancelled' }), reply(6, 'UTILTS_ERR', { status: 'failed' }))
    const held = await read()
    expect(held).toMatchObject({ resumable: true, reason: 'held_transactions', activeApplicationReplyIds: [] })
    db.state.messages = db.state.messages.filter((m) => m.direction === 'inbound')
    expect(await read()).toEqual(held)

    // Without transactions: a cancelled message-level reply does not close a never-answered source.
    db.state.transactions = []
    db.state.messages.push(reply(5, 'APERAK', { status: 'cancelled' }))
    expect(await read()).toMatchObject({ resumable: true, reason: 'not_yet_answered' })
  })

  it('(d) no held transaction and an existing application reply is not resumable (no duplicate replies)', async () => {
    db.state.messages.push(reply(2, 'APERAK', { status: 'sent', transaction_reference: 'T2' }))
    db.state.transactions = [finalized(tx('T2', 'guide_rejected'), 'negative_aperak', id(2))]
    const decision = await read()
    expect(decision).toMatchObject({ resumable: false, reason: 'already_answered', heldTransactionIds: [], rejectedTransactionIds: ['T2'] })
    // The rejected transaction needs a new file from the sender; the UI says so instead of a button.
    expect(describeUtiltsSourceResumability(decision)).toContain('ny, rättad fil')

    // A positive final reply (resumed earlier) also closes the source.
    db.state.messages = [source(), reply(4, 'APERAK', { status: 'sent', transaction_reference: 'T1' })]
    db.state.transactions = [finalized(tx('T1', 'accepted'), 'positive_aperak', id(4))]
    expect(await read()).toMatchObject({ resumable: false, reason: 'already_answered' })

    // Legacy whole-message reply with no transaction rows: closed as today.
    db.state.messages = [source(), reply(7, 'UTILTS_ERR', { status: 'sent' })]
    db.state.transactions = []
    expect(await read()).toMatchObject({ resumable: false, reason: 'message_level_application_reply_exists' })
  })

  it('a whole-message application reply closes even a held source; a reply scoped to the held transaction is flagged', async () => {
    db.state.transactions = [tx('T1', 'internal_review')]
    db.state.messages.push(reply(7, 'UTILTS_ERR', { status: 'draft' }))
    expect(await read()).toMatchObject({ resumable: false, reason: 'message_level_application_reply_exists', heldTransactionIds: ['T1'] })

    db.state.messages = [source(), reply(8, 'APERAK', { transaction_reference: 'T1' })]
    expect(await read()).toMatchObject({ resumable: false, reason: 'already_answered', heldTransactionIds: [], heldWithReplyTransactionIds: ['T1'] })
  })

  it('a never-answered source (first run or CONTRL-only recovery) remains runnable as today', async () => {
    expect(await read()).toMatchObject({ resumable: true, reason: 'not_yet_answered' })
    db.state.messages.push(reply(1, 'CONTRL', { status: 'sent' }))
    expect(await read()).toMatchObject({ resumable: true, reason: 'not_yet_answered', activeProtocolReplyIds: [id(1)] })
  })

  it('(e) foreign company, other environment, non-UTILTS and outbound sources are not resumable', async () => {
    db.state.transactions = [tx('T1', 'internal_review')]
    expect(await read(FOREIGN)).toMatchObject({ resumable: false, reason: 'source_unavailable', heldTransactionIds: [] })
    // Every read is company-scoped.
    expect(db.state.reads.every((r) => r.filters.some(([op, column, value]) => op === 'eq' && column === 'company_id' && value === FOREIGN))).toBe(true)
    expect(await read(COMPANY, 'production')).toMatchObject({ resumable: false, reason: 'source_unavailable' })
    expect(await readUtiltsSourceResumability({ companyId: null, sourceMessageId: SOURCE })).toMatchObject({ resumable: false, reason: 'source_unavailable' })

    db.state.messages = [source({ message_family: 'PRODAT', message_code: 'Z04' })]
    expect(await read()).toMatchObject({ resumable: false, reason: 'not_inbound_utilts' })
    db.state.messages = [source({ direction: 'outbound' })]
    expect(await read()).toMatchObject({ resumable: false, reason: 'not_inbound_utilts' })

    // A foreign tenant's held rows never qualify our source.
    db.state.messages = [source()]
    db.state.transactions = [tx('T1', 'internal_review', { company_id: FOREIGN })]
    expect(await read()).toMatchObject({ resumable: true, reason: 'not_yet_answered', heldTransactionIds: [] })
  })

  it('the pure decision refuses a source row from another tenant even if handed over directly', () => {
    expect(decideUtiltsSourceResumability({ companyId: FOREIGN, environment: 'test', source: source() as never,
      transactions: [tx('T1', 'internal_review') as never], replies: [] })).toMatchObject({ resumable: false, reason: 'source_unavailable' })
  })

  it('the list batch reader applies the same rule per source', async () => {
    const other = '55555555-5555-4555-8555-555555555555'
    db.state.messages.push(source({ id: other }), reply(2, 'APERAK', { related_message_id: other, status: 'sent', transaction_reference: 'X1' }))
    db.state.messages.push(reply(1, 'CONTRL', { status: 'sent' }))
    db.state.transactions = [tx('T1', 'internal_review'),
      finalized(tx('X1', 'guide_rejected', { source_message_id: other }), 'negative_aperak', id(2))]
    const map = await readUtiltsSourceResumabilityForSources([
      source() as never, source({ id: other }) as never, source({ id: 'p', message_family: 'PRODAT' }) as never,
      source({ id: 'n', company_id: null }) as never,
    ])
    expect(map.get(SOURCE)).toEqual(await read())
    expect(map.get(SOURCE)).toMatchObject({ resumable: true, reason: 'held_transactions' })
    expect(map.get(other)).toMatchObject({ resumable: false, reason: 'already_answered', rejectedTransactionIds: ['X1'] })
    expect(map.get('p')).toMatchObject({ resumable: false, reason: 'not_inbound_utilts' })
    expect(map.get('n')).toMatchObject({ resumable: false, reason: 'source_unavailable' })
  })
})

function form(messageId = SOURCE) { const f = new FormData(); f.set('edielMessageId', messageId); return f }
const eventPhases = () => io.event.mock.calls.map(([e]) => (e as { payload: { phase?: string } }).payload.phase)
const lastEvent = () => io.event.mock.calls.at(-1)?.[0] as { message: string; eventStatus: string; actorUserId: string; payload: Record<string, unknown> }

// The canonical processor, modeled on its DB contract: a held row whose
// evidence is now approved leaves internal_review and gets exactly one final
// reply; final rows and earlier replies are never touched.
function approveEvidenceOnProcess() {
  io.process.mockImplementation(async () => {
    const held = db.state.transactions.find((row) => row.disposition === 'internal_review' && !row.finalized_at)
    if (!held) return { processed: true }
    db.state.messages.push(reply(40, 'APERAK', { transaction_reference: held.source_transaction_id }))
    Object.assign(held, { disposition: 'accepted', planned_response_type: 'positive_aperak', persistence_status: 'persisted',
      issue_codes: [], final_response_type: 'positive_aperak', response_message_id: id(40), finalized_at: '2026-10-22T09:00:00.000Z' })
    return { processed: true }
  })
}

describe('processEdielOperationalMessageAction re-checks the rule server-side', () => {
  it('(f) refuses without calling the canonical processor when the rule says not resumable', async () => {
    db.state.messages.push(reply(2, 'APERAK', { status: 'sent', transaction_reference: 'T2' }))
    db.state.transactions = [finalized(tx('T2', 'guide_rejected'), 'negative_aperak', id(2))]
    expect(await runEdielOperationalMessageAction(form())).toEqual({ status: 'refused', reason: 'already_answered' })
    expect(io.process).not.toHaveBeenCalled()
    expect(eventPhases()).toEqual(['utilts_source_resumption_refused'])
    expect(lastEvent().message).toContain('ny, rättad fil')
  })

  it('(f) keeps authorization first: no rule read or processing when access or scope is denied', async () => {
    io.access.mockRejectedValueOnce(new Error('forbidden'))
    await expect(runEdielOperationalMessageAction(form())).rejects.toThrow('forbidden')
    io.scoped.mockRejectedValueOnce(new Error('Meddelandet hittades inte'))
    await expect(runEdielOperationalMessageAction(form())).rejects.toThrow('hittades inte')
    expect(db.state.reads).toEqual([])
    expect(io.process).not.toHaveBeenCalled()
    expect(io.scoped).toHaveBeenCalledWith(SOURCE, { userId: ACTOR, companyId: COMPANY })
  })

  it('(f) calls the canonical processor exactly once for a resumable held source and audits who/when/outcome', async () => {
    db.state.messages.push(reply(1, 'CONTRL', { status: 'sent' }), reply(2, 'APERAK', { status: 'sent', transaction_reference: 'T2' }))
    db.state.transactions = [tx('T1', 'internal_review'), finalized(tx('T2', 'guide_rejected'), 'negative_aperak', id(2))]
    approveEvidenceOnProcess()

    const result = await runEdielOperationalMessageAction(form())
    expect(result).toEqual({ status: 'processed', resumedTransactionIds: ['T1'], stillHeldTransactionIds: [] })
    expect(io.process).toHaveBeenCalledExactlyOnceWith({ actorUserId: ACTOR, edielMessageId: SOURCE })
    expect(lastEvent()).toMatchObject({ actorUserId: ACTOR, eventStatus: 'success', payload: {
      phase: 'utilts_source_resumption_attempt', mode: 'held_transactions', actorUserId: ACTOR, outcome: 'processed',
      heldTransactionIdsBefore: ['T1'], resumedTransactionIds: ['T1'], reusedProtocolReplyIds: [id(1)], attemptedAt: expect.any(String) } })
    // Earlier replies untouched: still exactly one reply per transaction and the original CONTRL.
    const replies = db.state.messages.filter((m) => m.direction === 'outbound')
    expect(replies.map((m) => [m.message_family, m.transaction_reference, m.status])).toEqual([
      ['CONTRL', null, 'sent'], ['APERAK', 'T2', 'sent'], ['APERAK', 'T1', 'draft']])

    // A repeated attempt is refused by the same rule; no second processing, no duplicate reply.
    expect(await runEdielOperationalMessageAction(form())).toEqual({ status: 'refused', reason: 'already_answered' })
    expect(io.process).toHaveBeenCalledTimes(1)
    expect(db.state.messages.filter((m) => m.direction === 'outbound')).toHaveLength(3)
  })

  it('(f) reports transactions that are still held when the evidence is still missing', async () => {
    db.state.transactions = [tx('T1', 'internal_review')]
    const result = await runEdielOperationalMessageAction(form())
    expect(result).toEqual({ status: 'processed', resumedTransactionIds: [], stillHeldTransactionIds: ['T1'] })
    expect(io.process).toHaveBeenCalledOnce()
    expect(lastEvent()).toMatchObject({ eventStatus: 'warning', payload: { outcome: 'still_held', stillHeldTransactionIds: ['T1'] } })
    expect(lastEvent().message).toContain('hålls fortfarande för intern granskning')
  })

  it.each([
    ['finalization conflict', new Error('utilts_transaction_ack_finalization_conflict')],
    ['unique violation in cause chain', new Error('ack draft failed', { cause: { code: '23505', message: 'duplicate key value violates unique constraint "ux_ediel_ack_related"' } })],
  ])('(f) a concurrent/duplicate attempt (%s) returns a clear result instead of a 500', async (_label, error) => {
    db.state.transactions = [tx('T1', 'internal_review')]
    io.process.mockRejectedValueOnce(error)
    const result = await runEdielOperationalMessageAction(form())
    expect(result).toMatchObject({ status: 'already_processing_or_done' })
    expect(lastEvent()).toMatchObject({ eventStatus: 'warning', payload: { outcome: 'already_processing_or_done', heldTransactionIdsAfter: ['T1'] } })
    expect(io.revalidate).toHaveBeenCalledWith(SOURCE)

    // The form action itself resolves (no thrown 500) on the same failure.
    io.process.mockRejectedValueOnce(error)
    await expect(processEdielOperationalMessageAction(form())).resolves.toBeUndefined()
  })

  it('(f) a re-check that disagrees with an immutable earlier final reply is reported, not thrown', async () => {
    db.state.transactions = [tx('T1', 'internal_review')]
    io.process.mockRejectedValueOnce(new Error('blocked_final_ack_exists: Originalets ACK-utfall är oföränderligt.'))
    expect(await runEdielOperationalMessageAction(form())).toMatchObject({ status: 'final_reply_conflict' })
    io.process.mockRejectedValueOnce(Object.assign(new Error('utilts_transaction_persistence_failed:utilts_committed_transaction_retry_conflict'), { code: '23514' }))
    expect(await runEdielOperationalMessageAction(form())).toMatchObject({ status: 'final_reply_conflict' })
  })

  it('(f) an unknown processing failure still surfaces, after an audit event', async () => {
    db.state.transactions = [tx('T1', 'internal_review')]
    io.process.mockRejectedValueOnce(new Error('utilts_source_binding_conflict'))
    await expect(runEdielOperationalMessageAction(form())).rejects.toThrow('utilts_source_binding_conflict')
    expect(lastEvent()).toMatchObject({ eventStatus: 'error', payload: { outcome: 'failed', phase: 'utilts_source_resumption_attempt' } })
  })

  it('classifies only the known guard errors', () => {
    expect(classifyUtiltsResumptionError(new Error('utilts_transaction_ack_finalization_ambiguous'))).toBe('concurrent')
    expect(classifyUtiltsResumptionError({ code: '23505' })).toBe('concurrent')
    expect(classifyUtiltsResumptionError(new Error('blocked_final_ack_exists'))).toBe('final_conflict')
    expect(classifyUtiltsResumptionError(new Error('anything else'))).toBeNull()
  })

  it('non-UTILTS inbound keeps its existing application-reply guard', async () => {
    db.state.messages = [source({ message_family: 'PRODAT', message_code: 'Z04' })]
    io.listAcks.mockResolvedValueOnce([{ id: id(9), message_family: 'APERAK', status: 'sent' }])
    expect(await runEdielOperationalMessageAction(form())).toEqual({ status: 'refused', reason: 'application_reply_exists' })
    expect(io.process).not.toHaveBeenCalled()
    expect(db.state.reads).toEqual([])
    io.listAcks.mockResolvedValueOnce([])
    expect(await runEdielOperationalMessageAction(form())).toMatchObject({ status: 'processed' })
    expect(io.process).toHaveBeenCalledExactlyOnceWith({ actorUserId: ACTOR, edielMessageId: SOURCE })
  })
})

describe('(g) runtime history', () => {
  it('appends the previous runtime with timestamp and actor and keeps earlier entries', () => {
    const held = { validation: { classification: 'internal_review' }, ackPlan: { reason: 'held' } }
    const first = appendUtiltsRuntimeHistory({ validationReport: { utiltsRuntime: held }, actorUserId: ACTOR, at: '2026-10-22T09:00:00.000Z' })
    expect(first).toEqual([{ supersededAt: '2026-10-22T09:00:00.000Z', supersededByActorUserId: ACTOR, runtime: held }])
    const next = appendUtiltsRuntimeHistory({ validationReport: { utiltsRuntime: { validation: { classification: 'accepted' } }, utiltsRuntimeHistory: first },
      actorUserId: 'other', at: '2026-10-22T10:00:00.000Z' })
    expect(next).toHaveLength(2)
    expect(next[0]).toEqual(first[0])
    expect(next[1]).toMatchObject({ supersededByActorUserId: 'other', runtime: { validation: { classification: 'accepted' } } })
    expect(appendUtiltsRuntimeHistory({ validationReport: {}, actorUserId: ACTOR, at: 'x' })).toEqual([])
    expect(appendUtiltsRuntimeHistory({ validationReport: null, actorUserId: ACTOR, at: 'x' })).toEqual([])
  })
})
