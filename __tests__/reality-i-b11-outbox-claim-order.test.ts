// reality-defects: I-B11 (variant)
// claim_ediel_outbox_items chooses the items by priority and age, but returns its UPDATE ... RETURNING rows in no
// order, and processEdielOutbox sends them one by one in that order. A correction or cancellation claimed in the same
// run as its original could leave first. Claimed items are now sent by priority, then age, then id.
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ claimed: [] as Array<Record<string, unknown>> }))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: async (name: string) => name === 'claim_ediel_outbox_items' ? { data: io.claimed, error: null } : { data: null, error: null },
} }))
vi.mock('@/lib/tenant/operationPolicy', () => ({ getTenantOperationDecision: async () => ({ allowed: true }) }))

import { claimEdielOutboxItems } from '@/lib/ediel/outbox/claimOutboxItems'

const item = (id: string, priority: number, createdAt: string) => ({ id, company_id: 'c', ediel_message_id: `m-${id}`, status: 'sending', environment: 'production', priority, created_at: createdAt })

beforeEach(() => { io.claimed = [] })

it('claimed outbox items come back by priority, then age, then id, whatever order RETURNING gave', async () => {
  io.claimed = [
    item('cancel', 100, '2026-10-27T08:00:02.000Z'),
    item('z03-b', 100, '2026-10-27T08:00:00.000Z'),
    item('urgent', 10, '2026-10-27T08:00:05.000Z'),
    item('z03-a', 100, '2026-10-27T08:00:00.000Z'),
  ]
  expect((await claimEdielOutboxItems({ workerId: 'w', environment: 'production' })).map(i => i.id)).toEqual(['urgent', 'z03-a', 'z03-b', 'cancel'])
})
