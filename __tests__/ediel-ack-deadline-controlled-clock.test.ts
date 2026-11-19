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
      let patch: Row | undefined
      function execute() {
        const rows = port.rows[table].filter(row => filters.every(filter => filter(row)))
        if (patch) rows.forEach(row => Object.assign(row, patch))
        return { data: rows.map(row => ({ ...row })), error: null }
      }
      const query = {
        select: () => query,
        order: () => query,
        limit: () => query,
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

beforeEach(() => {
  port.event.mockReset().mockResolvedValue(null)
  port.rows = {
    ediel_sla_timers: [{
      id: 'timer', company_id: source.company_id, ediel_message_id: source.id, timer_type: 'contrl_due',
      status: 'open', warning_at: plan.warningAt, critical_at: plan.criticalAt, due_at: plan.contrlDueAt,
    }],
    ediel_messages: [source, {
      id: 'ack', company_id: source.company_id, environment: source.environment, related_message_id: source.id,
      direction: 'outbound', message_family: 'CONTRL', status: 'sent', message_sent_at: later,
    }],
  }
})

describe('ACK deadlines use the same evaluation clock for the timer and sent receipts', () => {
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
    expect(timer()).toMatchObject({ status: 'resolved', updated_at: later })
  })

  it('keeps an application timer active until a later syntax rejection is sent', async () => {
    timer().timer_type = 'aperak_due'
    port.rows.ediel_messages[1].ack_outcome = 'negative'

    await expect(settle(plan.aperakDueAt)).resolves.toMatchObject({ expired: 1 })
    expect(timer().status).toBe('expired')
    await expect(settle(later)).resolves.toMatchObject({ updated: 1 })
    expect(timer().status).toBe('cancelled')
  })
})
