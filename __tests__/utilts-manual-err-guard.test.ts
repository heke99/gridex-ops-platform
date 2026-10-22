// FINDINGS F84: the duplicate guard compares replies of the same family only, so a manual UTILTS-ERR could
// contradict an APERAK already sent for the same transactions or answer transactions held for internal review.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  resumability: null as Record<string, unknown> | null,
  created: [] as unknown[],
  events: [] as Array<Record<string, unknown>>,
}))

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/ediel/actionAccess', () => ({
  requireEdielWriteActionAccess: vi.fn(async () => ({ userId: 'staff-1', companyId: 'company-a' })),
  requireEdielSendActionAccess: vi.fn(),
}))
vi.mock('@/app/admin/ediel/actions.part-1', async importOriginal => ({
  ...(await importOriginal<object>()),
  requireScopedEdielMessageForAction: vi.fn(async (id: string) => ({
    id, company_id: 'company-a', environment: 'test', direction: 'inbound', message_family: 'UTILTS', raw_payload: 'UNB+...',
  })),
  revalidateEdiel: vi.fn(),
  revalidateRelatedMessage: vi.fn(async () => undefined),
}))
vi.mock('@/lib/ediel/utilts/utiltsResumability', () => ({
  readUtiltsSourceResumability: vi.fn(async () => state.resumability),
}))
vi.mock('@/lib/ediel/orchestrator', async importOriginal => ({
  ...(await importOriginal<object>()),
  createNegativeUtiltsResponse: vi.fn(async (input: unknown) => { state.created.push(input); return { id: 'err-1' } }),
}))
vi.mock('@/lib/ediel/db', async importOriginal => ({
  ...(await importOriginal<object>()),
  createEdielMessageEvent: vi.fn(async (event: Record<string, unknown>) => { state.events.push(event) }),
}))

import { createNegativeUtiltsResponseAction } from '@/app/admin/ediel/actions.part-4'

const decision = (overrides: Record<string, unknown> = {}) => ({
  resumable: true, reason: 'not_yet_answered', heldTransactionIds: [], heldTransactions: [], rejectedTransactionIds: [],
  finalizedTransactionIds: [], activeApplicationReplyIds: [], activeProtocolReplyIds: ['contrl-1'], heldWithReplyTransactionIds: [], ...overrides,
})
const form = () => { const data = new FormData(); data.set('edielMessageId', 'source-1'); data.set('messageText', 'E10 manual'); return data }

beforeEach(() => { state.created = []; state.events = []; state.resumability = decision() })

describe('manual UTILTS-ERR never contradicts or pre-empts another reply (F84)', () => {
  it('is created for an unanswered source with only a CONTRL', async () => {
    await createNegativeUtiltsResponseAction(form())
    expect(state.created).toEqual([expect.objectContaining({ edielMessageId: 'source-1', messageText: 'E10 manual' })])
  })

  it('is refused when an APERAK already answered the source', async () => {
    state.resumability = decision({ reason: 'already_answered', resumable: false, activeApplicationReplyIds: ['aperak-1'], finalizedTransactionIds: ['1'] })
    await createNegativeUtiltsResponseAction(form())
    expect(state.created).toEqual([])
    expect(state.events).toEqual([expect.objectContaining({ eventStatus: 'error', payload: expect.objectContaining({ phase: 'utilts_err_manual_guard', existingApplicationReplyIds: ['aperak-1'] }) })])
  })

  it('is refused while transactions are held for internal review', async () => {
    state.resumability = decision({ reason: 'held_transactions', heldTransactionIds: ['1'] })
    await createNegativeUtiltsResponseAction(form())
    expect(state.created).toEqual([])
    expect(String(state.events[0]?.message)).toContain('intern granskning')
  })

  it('is refused when a transaction already has its final reply even without an active message reply', async () => {
    state.resumability = decision({ reason: 'already_answered', resumable: false, finalizedTransactionIds: ['1'] })
    await createNegativeUtiltsResponseAction(form())
    expect(state.created).toEqual([])
  })
})
