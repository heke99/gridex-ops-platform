import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAckTimerPlan, createAckTimersForMessage } from '@/lib/ediel/sla/createAckTimers'
import type { EdielMessageRow } from '@/lib/ediel/types'

const io = vi.hoisted(() => ({ upsert: vi.fn(), event: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: () => ({ upsert: io.upsert }) } }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: io.event }))
const message = (extra: Record<string, unknown> = {}) => ({
  id: 'source', company_id: 'tenant-a', direction: 'inbound', message_standard: 'edifact',
  message_family: 'PRODAT', message_code: 'Z04', message_received_at: '2026-09-30T12:00:00Z',
  created_at: '2026-09-30T12:02:00Z', ...extra,
}) as EdielMessageRow
beforeEach(() => { vi.clearAllMocks(); io.upsert.mockResolvedValue({ error: null }) })

describe('inbound ACK timer anchors and replay', () => {
  it('uses receipt time on every replay and retains actual source provenance', () => {
    expect(buildAckTimerPlan(message())).toMatchObject({ receivedAt: '2026-09-30T12:00:00Z',
      contrlDueAt: '2026-09-30T12:30:00.000Z', anchorKind: 'local_ingress_at', anchorCertainty: 'observed' })
  })
  it('labels local-created fallback as uncertain instead of claiming recipient time', () => {
    expect(buildAckTimerPlan(message({ message_received_at: null }))).toMatchObject({
      anchorKind: 'local_record_created_at', anchorCertainty: 'uncertain', receivedAt: '2026-09-30T12:02:00Z',
    })
  })
  it('does not fabricate a fresh clock for invalid or absent source timestamps', () => {
    expect(() => buildAckTimerPlan(message({ message_received_at: 'invalid' }))).toThrow('ack_timer_anchor_invalid')
    expect(() => buildAckTimerPlan(message({ message_received_at: null, created_at: null }))).toThrow('ack_timer_anchor_invalid')
  })
  it('never replaces a persisted due date or reopens terminal timers on replay', async () => {
    await createAckTimersForMessage({ actorUserId: 'actor', message: message() })
    expect(io.upsert).toHaveBeenCalledWith(expect.any(Array), { onConflict: 'ediel_message_id,timer_type', ignoreDuplicates: true })
  })
  it('uses the shared ERR ACK requirement, including its own APERAK watch', async () => {
    await createAckTimersForMessage({ actorUserId: 'actor', message: message({ message_family: 'UTILTS_ERR', message_code: 'ERR' }) })
    expect(io.upsert.mock.calls[0][0].map((row: { timer_type: string }) => row.timer_type)).toEqual(['contrl_due', 'aperak_due'])
  })
  it('does not require a receipt clock for ineligible outbound messages', async () => {
    expect(await createAckTimersForMessage({ actorUserId: 'actor', message: message({ direction: 'outbound', message_received_at: null, created_at: null }) })).toBeNull()
    expect(io.upsert).not.toHaveBeenCalled()
  })
  it('creates no ACK-of-ACK timers for CONTRL even with stale default flags', async () => {
    await createAckTimersForMessage({ actorUserId: 'actor', message: message({ message_family: 'CONTRL', message_code: null, requires_contrl: true }) })
    expect(io.upsert).not.toHaveBeenCalled()
  })
})
