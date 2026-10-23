// reality-defects: F107
// FINDINGS F107 (action level): "Återuppta hållna transaktioner" answered HTTP 500
// although the 96 values were stored, because the APERAK after the store failed
// (world run 28: F111's ediel_ack_atomic_foreign_source_resource) and the
// action rethrew. A stored-but-unanswered run must be reported as such, durably
// on the message, and the form action must resolve. A failure with nothing
// stored still surfaces. Mocks copied from __tests__/utilts-held-source-resumability.test.ts.
// Synthetic data only.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const db = vi.hoisted(() => {
  const state = { messages: [] as Row[], transactions: [] as Row[] }
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
      const data = tableRows(table).filter((row) => filters.every(([op, column, value]) =>
        op === 'eq' ? row[column] === value : (value as unknown[]).includes(row[column])))
      return Promise.resolve({ data: structuredClone(data), error: null }).then(resolve, reject)
    }
    return q
  }
  return { state, from }
})

const io = vi.hoisted(() => ({
  access: vi.fn(), scoped: vi.fn(), process: vi.fn(), event: vi.fn(), listAcks: vi.fn(), revalidate: vi.fn(), revalidateRelated: vi.fn(),
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
  isActiveEdielAckMessage: () => true, isOperationalAckMessage: () => true, isUtiltsErrAckMessage: () => false,
}))
vi.mock('@/app/admin/ediel/actions.part-4', () => ({}))
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

import { processEdielOperationalMessageAction, runEdielOperationalMessageAction } from '@/app/admin/ediel/actions.part-3'
import { createUtiltsRepliesAfterStore } from '@/lib/ediel/utilts/utiltsReplyAfterStore'

const COMPANY = '11111111-1111-4111-8111-111111111111'
const ACTOR = '22222222-2222-4222-8222-222222222222'
const SOURCE = '33333333-3333-4333-8333-333333333333'
const CONTRL = '44444444-4444-4444-8444-000000000001'
const VALUES = Array.from({ length: 96 }, (_, index) => `value-${index}`)

const source = (): Row => ({ id: SOURCE, company_id: COMPANY, environment: 'production', direction: 'inbound', message_family: 'UTILTS', message_code: 'E66' })
const held = (): Row => ({ company_id: COMPANY, environment: 'production', source_message_id: SOURCE, source_transaction_id: 'T1',
  disposition: 'internal_review', planned_response_type: 'none', final_response_type: null, response_message_id: null, finalized_at: null,
  issue_codes: ['UTILTS_ISSUER_IDENTITY_BASIS_UNAVAILABLE'] })
const form = () => { const f = new FormData(); f.set('edielMessageId', SOURCE); return f }
const attemptEvents = () => io.event.mock.calls.map(([e]) => e as { eventStatus: string; message: string; payload: Row })
  .filter((e) => e.payload.phase === 'utilts_source_resumption_attempt')

// World run 28: the held row leaves review and is persisted, 96 values are
// stored, then the APERAK is refused by the database (F111).
function storeThenRefuseReply() {
  io.process.mockImplementation(async () => {
    Object.assign(db.state.transactions[0], { disposition: 'accepted', planned_response_type: 'positive_aperak', issue_codes: [] })
    return createUtiltsRepliesAfterStore({ actorUserId: ACTOR, sourceMessageId: SOURCE, storedMeterValueIds: VALUES }, async () => {
      throw { code: 'P0001', details: null, hint: null, message: 'ediel_ack_atomic_foreign_source_resource' }
    })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  db.state.messages = [source(), { id: CONTRL, company_id: COMPANY, environment: 'production', direction: 'outbound', related_message_id: SOURCE,
    message_family: 'CONTRL', message_code: 'CONTRL', status: 'sent', transaction_reference: null }]
  db.state.transactions = [held()]
  io.access.mockResolvedValue({ userId: ACTOR, companyId: COMPANY })
  io.scoped.mockImplementation(async (id: string) => db.state.messages.find((m) => m.id === id))
  io.event.mockResolvedValue({ id: 'event' })
  io.listAcks.mockResolvedValue([])
})

describe('F107 "Återuppta hållna transaktioner" after values are stored', () => {
  it('reports "stored, reply missing" instead of an opaque failure, durably on the source', async () => {
    storeThenRefuseReply()
    const result = await runEdielOperationalMessageAction(form())
    expect(result).toEqual({ status: 'reply_failed_after_store', storedMeterValueCount: 96, pendingReplyTransactionIds: ['T1'],
      reason: 'ediel_ack_atomic_foreign_source_resource' })
    const [attempt] = attemptEvents()
    expect(attemptEvents()).toHaveLength(1)
    expect(attempt).toMatchObject({ eventStatus: 'error', payload: { outcome: 'reply_failed_after_store', storedMeterValueCount: 96,
      pendingReplyTransactionIds: ['T1'], heldTransactionIdsBefore: ['T1'], heldTransactionIdsAfter: [], reusedProtocolReplyIds: [CONTRL],
      error: 'ediel_ack_atomic_foreign_source_resource' } })
    expect(attempt.message).toContain('lagrade 96 mätvärde(n)')
    expect(attempt.message).toContain('applikationssvaret (APERAK/UTILTS-ERR) kunde inte skapas: ediel_ack_atomic_foreign_source_resource')
    // The old text claimed nothing changed although 96 values were stored.
    expect(attempt.message).not.toContain('Inga tidigare svar har ändrats')
    // The flow's own durable record is there as well.
    expect(io.event.mock.calls.some(([e]) => (e as { payload: Row }).payload.phase === 'utilts_reply_failed_after_store')).toBe(true)
    expect(io.revalidate).toHaveBeenCalledWith(SOURCE)
    expect(io.process).toHaveBeenCalledExactlyOnceWith({ actorUserId: ACTOR, edielMessageId: SOURCE })
  })

  it('the form action resolves (no HTTP 500) when only the reply failed after the store', async () => {
    storeThenRefuseReply()
    await expect(processEdielOperationalMessageAction(form())).resolves.toBeUndefined()
  })

  it('the retry stays gated by the same rule and is reported the same way while the reply keeps failing', async () => {
    storeThenRefuseReply()
    await runEdielOperationalMessageAction(form())
    // Nothing is held any more, no reply exists: the rule allows exactly the missing reply to be retried.
    storeThenRefuseReply()
    expect(await runEdielOperationalMessageAction(form())).toMatchObject({ status: 'reply_failed_after_store', storedMeterValueCount: 96 })
    expect(io.process).toHaveBeenCalledTimes(2)
    // Once a final reply exists the rule refuses without processing (no duplicate reply).
    db.state.messages.push({ id: 'aperak', company_id: COMPANY, environment: 'production', direction: 'outbound', related_message_id: SOURCE,
      message_family: 'APERAK', message_code: 'APERAK', status: 'sent', transaction_reference: 'T1' })
    Object.assign(db.state.transactions[0], { final_response_type: 'positive_aperak', response_message_id: 'aperak', finalized_at: '2026-10-23T18:30:00.000Z' })
    expect(await runEdielOperationalMessageAction(form())).toEqual({ status: 'refused', reason: 'already_answered' })
    expect(io.process).toHaveBeenCalledTimes(2)
  })

  it('a failure with nothing stored still surfaces after its audit event', async () => {
    io.process.mockRejectedValueOnce({ code: 'P0001', message: 'ediel_ack_atomic_foreign_source_resource' })
    await expect(runEdielOperationalMessageAction(form())).rejects.toMatchObject({ message: 'ediel_ack_atomic_foreign_source_resource' })
    expect(attemptEvents()).toMatchObject([{ eventStatus: 'error', payload: { outcome: 'failed' } }])
  })
})
