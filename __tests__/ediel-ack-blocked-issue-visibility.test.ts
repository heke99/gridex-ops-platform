import { beforeEach, describe, expect, it, vi } from 'vitest'

// Fynd 025: a canonical_inbound_ack_guard block (failed ACK enqueue) is an
// operator-visible issue, tenant-scoped like the other canonical issue lists.
const io = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }))
vi.mock('@/lib/supabase/service', () => {
  const q: Record<string, unknown> = {}
  Object.assign(q, { select: () => q, eq: () => q, in: () => q, order: () => q, limit: async () => ({ data: io.rows, error: null }) })
  return { supabaseService: { from: () => q } }
})

import { isAckEnqueueBlockedEvent, listCanonicalAckEnqueueBlockedEvents, mapCanonicalIssueEvent } from '@/lib/ediel/db'
import type { EdielMessageEventRow } from '@/lib/ediel/types'

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222'
const blocked = (company: string, id = `ev-${company}`) => ({ id, company_id: company, ediel_message_id: `src-${company}`, event_type: 'manual_note',
  event_status: 'warning', message: 'UTILTS_ERR skapades inte: outbox queue misslyckades: down', created_at: '2026-10-30T00:00:00Z', created_by: 'actor',
  payload: { blockedBy: 'canonical_inbound_ack_guard', ackFamily: 'UTILTS_ERR', ackMessageId: `ack-${company}`, sourceMessageId: `src-${company}` } }) as EdielMessageEventRow
const note = { ...blocked(A, 'plain'), payload: { note: 'x' } } as EdielMessageEventRow

beforeEach(() => { io.rows = [] })

describe('ACK enqueue blocked events are visible issues', () => {
  it('mapCanonicalIssueEvent maps the guard block as ack_enqueue_blocked with the ACK id', () => {
    expect(mapCanonicalIssueEvent(blocked(A))).toMatchObject({ issue_kind: 'ack_enqueue_blocked', ack_family: 'UTILTS_ERR',
      existing_ack_message_id: `ack-${A}`, source_message_id: `src-${A}`, company_id: A })
    expect(mapCanonicalIssueEvent(note)).toBeNull()
  })
  it('the message page issue predicate includes the block and nothing unrelated', () => {
    expect(isAckEnqueueBlockedEvent(blocked(A))).toBe(true)
    expect(isAckEnqueueBlockedEvent(note)).toBe(false)
    expect(isAckEnqueueBlockedEvent({ payload: { blockedBy: 'other_guard' } })).toBe(false)
  })
  it('the list is tenant scoped: another tenant event is not returned', async () => {
    io.rows = [blocked(A), blocked(B), note]
    const rows = await listCanonicalAckEnqueueBlockedEvents({ companyId: A })
    expect(rows.map(row => row.id)).toEqual([`ev-${A}`])
    expect(await listCanonicalAckEnqueueBlockedEvents({ companyId: B })).toEqual([expect.objectContaining({ id: `ev-${B}`, existing_ack_message_id: `ack-${B}` })])
  })
})
