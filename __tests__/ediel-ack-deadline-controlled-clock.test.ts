import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAckTimerPlan } from '@/lib/ediel/sla/createAckTimers'
import { checkAckDeadlines } from '@/lib/ediel/sla/checkAckDeadlines'
import type { EdielMessageRow } from '@/lib/ediel/types'

type Row = Record<string, unknown>
const port = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>,
  event: vi.fn(),
}))

vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: port.event }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = []
      const orderBy: string[] = []
      let limit = Infinity
      let patch: Row | undefined
      function execute() {
        const rows = port.rows[table].filter(row => filters.every(filter => filter(row)))
          .sort((a, b) => {
            for (const field of orderBy) {
              const left = a[field]
              const right = b[field]
              if (left == null && right != null) return 1
              if (right == null && left != null) return -1
              const order = String(left).localeCompare(String(right))
              if (order) return order
            }
            return 0
          }).slice(0, limit)
        if (patch) rows.forEach(row => Object.assign(row, patch))
        return { data: rows.map(row => ({ ...row })), error: null }
      }
      const query = {
        select: () => query,
        order: (field: string) => { orderBy.push(field); return query },
        limit: (count: number) => { limit = count; return query },
        eq: (field: string, value: unknown) => {
          filters.push(row => row[field] === value)
          return query
        },
        in: (field: string, values: unknown[]) => {
          filters.push(row => values.includes(row[field]))
          return query
        },
        update: (value: Row) => { patch = value; return query },
        maybeSingle: async () => ({ data: execute().data[0] ?? null, error: null }),
        then: (resolve: (value: ReturnType<typeof execute>) => unknown) => resolve(execute()),
      }
      return query
    },
  },
}))

const source = {
  id: 'source', company_id: 'tenant', environment: 'test',
  direction: 'inbound', message_family: 'PRODAT', message_received_at: '2026-11-18T12:00:00Z',
} as EdielMessageRow
const plan = buildAckTimerPlan(source)
const later = new Date(Date.parse(plan.contrlDueAt) + 60_000).toISOString()
const beforeDue = new Date(Date.parse(plan.contrlDueAt) - 1).toISOString()
const settle = (now: string) => checkAckDeadlines({ actorUserId: 'actor', companyId: 'tenant', now })
const timer = () => port.rows.ediel_sla_timers[0]
const anchor = { receivedAt: source.message_received_at, anchorKind: 'local_ingress_at' }
const lateContrl = { dueAt: plan.contrlDueAt, sentAt: later, acknowledgementId: 'ack' }

beforeEach(() => {
  port.event.mockReset().mockResolvedValue(null)
  port.rows = {
    ediel_sla_timers: [{
      id: 'timer', company_id: source.company_id, ediel_message_id: source.id, timer_type: 'contrl_due',
      status: 'open', warning_at: plan.warningAt, critical_at: plan.criticalAt, due_at: plan.contrlDueAt, payload: anchor,
    }],
    ediel_messages: [source, {
      id: 'ack', company_id: source.company_id, environment: source.environment, related_message_id: source.id,
      direction: 'outbound', message_family: 'CONTRL', status: 'sent', message_sent_at: later,
    }],
  }
})

describe('ACK deadlines use the same evaluation clock for the timer and sent receipts', () => {
  it('records a late CONTRL found by the first post-deadline sweep (OPS-1811-19)', async () => {
    await expect(settle(later)).resolves.toMatchObject({ updated: 1, expired: 1 })
    expect(timer()).toMatchObject({ status: 'resolved', payload: { ...anchor, lateContrl } })
    expect(port.event).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      eventStatus: 'error',
      message: expect.stringContaining('CONTRL was sent after its deadline'),
      payload: expect.objectContaining({ status: 'resolved', lateContrl }),
    }))
  })

  it.each([beforeDue, plan.contrlDueAt])('treats an acknowledged send at %s as timely', async (sentAt) => {
    port.rows.ediel_messages[1].message_sent_at = sentAt
    await expect(settle(later)).resolves.toMatchObject({ updated: 1, expired: 0 })
    expect(timer()).toMatchObject({ status: 'resolved', payload: anchor })
    expect(timer().payload).not.toHaveProperty('lateContrl')
    expect(port.event).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ eventStatus: 'success' }))
  })

  it('uses the earliest qualified send even when late, foreign and unsent rows precede it', async () => {
    const ack = port.rows.ediel_messages[1]
    port.rows.ediel_messages.push(
      { ...ack, id: 'foreign', environment: 'production', message_sent_at: beforeDue },
      { ...ack, id: 'queued', status: 'queued', message_sent_at: beforeDue },
      { ...ack, id: 'timely', message_sent_at: plan.contrlDueAt },
    )
    await expect(settle(later)).resolves.toMatchObject({ updated: 1, expired: 0 })
    expect(timer()).toMatchObject({ status: 'resolved', payload: anchor })
    expect(timer().payload).not.toHaveProperty('lateContrl')
  })

  it('preserves the actual send fraction when CONTRL and due time share a millisecond', async () => {
    const sentAt = plan.contrlDueAt.replace('.000Z', '.000001+00:00')
    port.rows.ediel_messages[1].message_sent_at = sentAt
    await expect(settle(plan.contrlDueAt)).resolves.toMatchObject({ updated: 1, expired: 1 })
    expect(timer()).toMatchObject({ status: 'expired', payload: anchor })
    expect(timer().payload).not.toHaveProperty('lateContrl')

    await expect(settle(later)).resolves.toMatchObject({ updated: 1, expired: 0 })
    expect(timer()).toMatchObject({ status: 'resolved', payload: { lateContrl: { ...lateContrl, sentAt } } })
  })

  it('does not expire a technical deadline before its stored sub-millisecond instant', async () => {
    timer().due_at = plan.contrlDueAt.replace('.000Z', '.000002Z')
    port.rows.ediel_messages[1].message_sent_at = timer().due_at
    await expect(settle(plan.contrlDueAt)).resolves.toMatchObject({ critical: 1, expired: 0 })
    await expect(settle(later)).resolves.toMatchObject({ updated: 1, expired: 0 })
    expect(timer()).toMatchObject({ status: 'resolved', payload: anchor })
    expect(timer().payload).not.toHaveProperty('lateContrl')
  })

  it('records the breach once when concurrent sweeps find the same accepted CONTRL', async () => {
    const results = await Promise.all([settle(later), settle(later)])
    expect(results.map(({ expired }) => expired).sort()).toEqual([0, 1])
    expect(results.map(({ updated }) => updated).sort()).toEqual([0, 1])
    expect(timer()).toMatchObject({ status: 'resolved', payload: { ...anchor, lateContrl } })
    expect(port.event).toHaveBeenCalledTimes(1)
  })

  it('retains late evidence when the existing history write fails', async () => {
    port.event.mockRejectedValueOnce(new Error('synthetic history write failure'))
    await expect(settle(later)).resolves.toMatchObject({ updated: 1, expired: 1 })
    expect(timer()).toMatchObject({ status: 'resolved', payload: { ...anchor, lateContrl } })
    await expect(settle(later)).resolves.toMatchObject({ updated: 0, expired: 0 })
    expect(port.event).toHaveBeenCalledTimes(1)
  })

  it('records the overdue state before a later ACK, then resolves at the receipt time', async () => {
    await expect(settle(beforeDue)).resolves.toMatchObject({ critical: 1, expired: 0 })
    expect(timer()).toMatchObject({ status: 'critical', updated_at: beforeDue })

    await expect(settle(plan.contrlDueAt)).resolves.toMatchObject({ expired: 1 })
    expect(timer()).toMatchObject({ status: 'expired', updated_at: plan.contrlDueAt })
    expect(port.event).toHaveBeenCalledWith(expect.objectContaining({
      eventStatus: 'error',
      payload: expect.objectContaining({ status: 'expired', dueAt: plan.contrlDueAt }),
    }))

    await expect(settle(later)).resolves.toMatchObject({ updated: 1, expired: 0 })
    expect(timer()).toMatchObject({ status: 'resolved', updated_at: later, payload: { ...anchor, lateContrl } })
  })

  it('keeps an application timer active until a later syntax rejection is sent', async () => {
    timer().timer_type = 'aperak_due'
    port.rows.ediel_messages[1].ack_outcome = 'negative'

    await expect(settle(plan.aperakDueAt)).resolves.toMatchObject({ expired: 1 })
    expect(timer().status).toBe('expired')
    await expect(settle(later)).resolves.toMatchObject({ updated: 1 })
    expect(timer().status).toBe('cancelled')
    expect(timer().payload).not.toHaveProperty('lateContrl')
  })
})
