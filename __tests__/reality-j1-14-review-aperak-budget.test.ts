// reality-defects: J1-14
// J1-14 (scenario J1, batch 5d; owner decision 39): a Z06 E/F waits in source-bound review and its APERAK is created
// only after staff approve, so the 30-minute aperak_due deadline expired with no reply and no operator was told in
// time. The review queue is now ordered by the APERAK deadline, an internal budget (20 of the 30 minutes from receipt,
// 10-minute margin for the outbox tick and transport) escalates to a critical operator task, and a passed deadline is
// escalated separately. The watch never creates an APERAK; the deadline is the timer's, anchored to the receipt.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, touched: [] as string[], seq: 0 }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      io.touched.push(table)
      if (!['ediel_inbound_cases', 'ediel_sla_timers', 'ediel_ack_sla_events', 'customer_operation_tasks', 'ediel_message_events'].includes(table)) {
        throw new Error(`unexpected table ${table}`)
      }
      const rows = (io.tables[table] ??= [])
      const filters: Array<(row: Row) => boolean> = []
      let op: 'select' | 'insert' | 'update' = 'select', payload: Row = {}, max = Infinity, order: [string, boolean] | null = null
      const run = () => {
        if (op === 'insert') {
          if (table === 'ediel_ack_sla_events' && rows.some(row => row.status === 'open' && row.ediel_message_id === payload.ediel_message_id && row.ack_family === payload.ack_family)) {
            return { data: null, error: { code: '23505' } }
          }
          rows.push({ id: `${table}-${++io.seq}`, created_at: new Date(Date.UTC(2026, 9, 28, 0, 0, io.seq)).toISOString(), ...payload })
          return { data: null, error: null }
        }
        const hit = rows.filter(row => filters.every(filter => filter(row)))
        if (op === 'update') { for (const row of hit) Object.assign(row, payload); return { data: hit.map(row => ({ id: row.id })), error: null } }
        const sorted = order ? [...hit].sort((a, b) => String(a[order![0]]).localeCompare(String(b[order![0]])) * (order![1] ? 1 : -1)) : hit
        return { data: sorted.slice(0, max), error: null }
      }
      const q: Row = {}
      Object.assign(q, {
        select: () => q,
        insert: (row: Row) => { op = 'insert'; payload = row; return q },
        update: (row: Row) => { op = 'update'; payload = row; return q },
        eq: (c: string, v: unknown) => { filters.push(row => row[c] === v); return q },
        in: (c: string, v: unknown[]) => { filters.push(row => v.includes(row[c])); return q },
        not: (c: string, _op: string, _v: unknown) => { filters.push(row => row[c] !== null && row[c] !== undefined); return q },
        contains: (c: string, v: Row) => { filters.push(row => Object.entries(v).every(([k, x]) => (row[c] as Row | undefined)?.[k] === x)); return q },
        order: (c: string, o?: { ascending?: boolean }) => { order = [c, o?.ascending !== false]; return q },
        limit: (n: number) => { max = n; return q },
        then: (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko),
      })
      return q
    },
  },
}))

import {
  INBOUND_REVIEW_APERAK_BUDGET_MINUTES, INBOUND_REVIEW_APERAK_MARGIN_MINUTES, INBOUND_REVIEW_APERAK_TASK_TYPE,
  listInboundReviewAperakQueue, planInboundReviewAperakBudget, runInboundReviewAperakEscalation,
} from '@/lib/ediel/sla/inboundReviewAperakBudget'
import { buildAckTimerPlan } from '@/lib/ediel/sla/createAckTimers'
import { inboundAckTimerCompletion } from '@/lib/ediel/sla/ackTimerCompletion'
import { compareTaskDueAt } from '@/lib/operations/taskDueOrder'
import type { EdielMessageRow } from '@/lib/ediel/types'

const A = '00000000-0000-4000-8000-0000000000a1', B = '00000000-0000-4000-8000-0000000000b1'
const received = '2026-10-28T09:00:00.000Z' // 10:00 Stockholm
const due = '2026-10-28T09:30:00.000Z'
const at = (minutes: number) => new Date(Date.parse(received) + minutes * 60_000).toISOString()

function reviewCase(id: string, messageId: string, extra: Row = {}): Row {
  return { id, company_id: A, ediel_message_id: messageId, message_family: 'PRODAT', message_code: 'Z06', status: 'pending_review', created_at: at(2), ...extra }
}
function aperakTimer(messageId: string, extra: Row = {}): Row {
  return { id: `timer-${messageId}`, company_id: A, ediel_message_id: messageId, timer_type: 'aperak_due', due_at: due, status: 'open', ...extra }
}
const tasks = () => io.tables.customer_operation_tasks ?? []
const slaEvents = () => io.tables.ediel_ack_sla_events ?? []

beforeEach(() => {
  io.tables = { ediel_inbound_cases: [reviewCase('CASE-1', 'MSG-1')], ediel_sla_timers: [aperakTimer('MSG-1')] }
  io.touched = []
  io.seq = 0
})

describe('budget and anchor', () => {
  it('the budget is 20 of the 30 minutes from the receipt the aperak_due timer is anchored to', () => {
    const plan = buildAckTimerPlan({ id: 'MSG-1', message_received_at: received, created_at: at(4) } as EdielMessageRow)
    expect(plan.aperakDueAt).toBe(due)
    expect(INBOUND_REVIEW_APERAK_BUDGET_MINUTES + INBOUND_REVIEW_APERAK_MARGIN_MINUTES).toBe(30)
    expect(planInboundReviewAperakBudget({ dueAt: plan.aperakDueAt, now: at(19) })).toMatchObject({ stage: 'within_budget', budgetAt: at(20), remainingMinutes: 11 })
    expect(planInboundReviewAperakBudget({ dueAt: plan.aperakDueAt, now: at(20) }).stage).toBe('budget_exceeded')
    expect(planInboundReviewAperakBudget({ dueAt: plan.aperakDueAt, now: at(30) }).stage).toBe('deadline_passed')
  })

  it('a sent CONTRL neither answers the APERAK deadline nor starts a new 30-minute window', async () => {
    const contrl = { id: 'CONTRL-1', company_id: A, environment: 'test', related_message_id: 'MSG-1', direction: 'outbound', status: 'sent',
      message_sent_at: at(18), message_family: 'CONTRL', ack_outcome: 'positive' }
    const source = { id: 'MSG-1', company_id: A, environment: 'test', message_family: 'PRODAT', raw_payload: 'UNA:+.? \'', direction: 'inbound' } as EdielMessageRow
    expect(inboundAckTimerCompletion({ source, timerType: 'aperak_due', acknowledgements: [contrl] })).toBeNull()
    expect(inboundAckTimerCompletion({ source, timerType: 'contrl_due', acknowledgements: [contrl] })).toBe('resolved')
    // The watch reads the persisted deadline: escalation at 10:20 still names 10:30, not 10:18 + 30.
    await runInboundReviewAperakEscalation({ actorUserId: 'auto', now: at(20) })
    expect(tasks()).toHaveLength(1)
    expect(tasks()[0]).toMatchObject({ due_at: due, metadata: expect.objectContaining({ aperakDueAt: due, budgetAt: at(20) }) })
  })
})

describe('priority', () => {
  it('reviews with an APERAK deadline come first, earliest deadline first, then the rest oldest first', async () => {
    io.tables.ediel_inbound_cases = [
      reviewCase('NO-DEADLINE-OLD', 'MSG-OLD', { created_at: '2026-10-20T08:00:00.000Z' }),
      reviewCase('LATER', 'MSG-LATER', { created_at: at(9) }),
      reviewCase('SOONER', 'MSG-SOONER', { created_at: at(12) }),
      reviewCase('NO-DEADLINE-NEW', 'MSG-NEW', { created_at: at(13) }),
    ]
    io.tables.ediel_sla_timers = [
      aperakTimer('MSG-LATER', { due_at: at(38) }),
      aperakTimer('MSG-SOONER', { due_at: at(31) }),
      aperakTimer('MSG-OLD', { status: 'resolved' }), // answered: no deadline left to protect
    ]
    const queue = await listInboundReviewAperakQueue({ companyId: A, now: at(14) })
    expect(queue.map(item => item.caseId)).toEqual(['SOONER', 'LATER', 'NO-DEADLINE-OLD', 'NO-DEADLINE-NEW'])
    expect(queue[0].aperak).toMatchObject({ dueAt: at(31), stage: 'within_budget' })
  })

  it('the operator queue puts the earliest deadline first within the same priority', () => {
    const order = [{ id: 'none', due: null }, { id: 'late', due: at(40) }, { id: 'soon', due: at(30) }]
      .sort((a, b) => compareTaskDueAt(a.due, b.due)).map(task => task.id)
    expect(order).toEqual(['soon', 'late', 'none'])
  })

  it('a timer of another tenant never gives a review a deadline', async () => {
    io.tables.ediel_sla_timers = [aperakTimer('MSG-1', { company_id: B })]
    const queue = await listInboundReviewAperakQueue({ now: at(25) })
    expect(queue[0].aperak).toBeNull()
    expect(await runInboundReviewAperakEscalation({ now: at(25) })).toMatchObject({ escalated: 0, deadlineMissed: 0 })
    expect(tasks()).toHaveLength(0)
  })
})

describe('escalation', () => {
  it('nothing while within budget', async () => {
    expect(await runInboundReviewAperakEscalation({ actorUserId: 'auto', now: at(19) })).toMatchObject({ scanned: 1, escalated: 0 })
    expect(tasks()).toHaveLength(0)
    expect(slaEvents()).toHaveLength(0)
  })

  it('fires once at the budget: a critical task due at the APERAK deadline that says time is running out', async () => {
    expect(await runInboundReviewAperakEscalation({ actorUserId: 'auto', now: at(20) })).toMatchObject({ escalated: 1, deadlineMissed: 0 })
    expect(tasks()).toEqual([expect.objectContaining({ company_id: A, task_type: INBOUND_REVIEW_APERAK_TASK_TYPE, priority: 'critical', status: 'open', due_at: due,
      title: expect.stringContaining('APERAK-frist om 10 min'), description: expect.stringContaining('aldrig för att stoppa timern') })])
    expect(slaEvents()).toEqual([expect.objectContaining({ ediel_message_id: 'MSG-1', ack_family: 'aperak_review_budget', status: 'open', severity: 'critical' })])
    expect(io.tables.ediel_message_events).toEqual([expect.objectContaining({ event_type: 'ack_sla_breached', event_status: 'warning' })])
    // The next cron tick inside the budget stage creates nothing new.
    expect(await runInboundReviewAperakEscalation({ actorUserId: 'auto', now: at(25) })).toMatchObject({ escalated: 0 })
    expect(tasks()).toHaveLength(1)
  })

  it('a review still open at the deadline is escalated as missed, replacing the budget alert', async () => {
    await runInboundReviewAperakEscalation({ actorUserId: 'auto', now: at(20) })
    io.tables.ediel_sla_timers[0].status = 'expired'
    expect(await runInboundReviewAperakEscalation({ actorUserId: 'auto', now: at(31) })).toMatchObject({ deadlineMissed: 1, resolved: 1 })
    const open = tasks().filter(task => task.status === 'open')
    expect(open).toEqual([expect.objectContaining({ title: expect.stringContaining('APERAK-fristen har passerat'),
      description: expect.stringContaining('har inte fått någon APERAK i tid') })])
    expect(slaEvents().find(event => event.ack_family === 'aperak_review_budget')).toMatchObject({ status: 'resolved' })
    expect(slaEvents().find(event => event.ack_family === 'aperak_review_deadline')).toMatchObject({ status: 'open' })
    expect(await runInboundReviewAperakEscalation({ actorUserId: 'auto', now: at(60) })).toMatchObject({ deadlineMissed: 0, resolved: 0 })
  })

  it('a deadline missed more than 24 hours ago (already reported by the timer sweep) is not raised again', async () => {
    io.tables.ediel_sla_timers[0].status = 'expired'
    expect(await runInboundReviewAperakEscalation({ actorUserId: 'auto', now: at(24 * 60 + 31) })).toMatchObject({ escalated: 0, deadlineMissed: 0 })
    expect(tasks()).toHaveLength(0)
    expect(await runInboundReviewAperakEscalation({ actorUserId: 'auto', now: at(24 * 60 + 29) })).toMatchObject({ deadlineMissed: 1 })
  })

  it('never creates, queues or sends an acknowledgement, not even after the deadline', async () => {
    await runInboundReviewAperakEscalation({ actorUserId: 'auto', now: at(20) })
    await runInboundReviewAperakEscalation({ actorUserId: 'auto', now: at(45) })
    expect(new Set(io.touched)).toEqual(new Set(['ediel_inbound_cases', 'ediel_sla_timers', 'ediel_ack_sla_events', 'customer_operation_tasks', 'ediel_message_events']))
    expect(io.tables.ediel_sla_timers[0].status).toBe('open')
  })
})

describe('answered or decided reviews', () => {
  it('no escalation once the APERAK was sent (timer resolved)', async () => {
    io.tables.ediel_sla_timers[0].status = 'resolved'
    expect(await runInboundReviewAperakEscalation({ actorUserId: 'auto', now: at(25) })).toMatchObject({ escalated: 0, deadlineMissed: 0 })
    expect(tasks()).toHaveLength(0)
  })

  it('no escalation once staff approved within the budget, even before the outbox sent the queued APERAK', async () => {
    io.tables.ediel_inbound_cases[0].status = 'applied'
    expect(await runInboundReviewAperakEscalation({ actorUserId: 'auto', now: at(22) })).toMatchObject({ scanned: 0, escalated: 0 })
    expect(tasks()).toHaveLength(0)
  })

  it('a partial approval keeps the remaining objects deadline-bound', async () => {
    // approveEdielInboundCase keeps a partially applied structural case pending_review.
    io.tables.ediel_inbound_cases[0].review_decision = { structuralApplication: { appliedObjectCount: 1, totalObjectCount: 2 } }
    expect(await runInboundReviewAperakEscalation({ actorUserId: 'auto', now: at(21) })).toMatchObject({ escalated: 1 })
  })

  it('an escalation already raised is closed when the APERAK is sent afterwards', async () => {
    await runInboundReviewAperakEscalation({ actorUserId: 'auto', now: at(20) })
    io.tables.ediel_inbound_cases[0].status = 'applied'
    io.tables.ediel_sla_timers[0].status = 'resolved'
    expect(await runInboundReviewAperakEscalation({ actorUserId: 'auto', now: at(24) })).toMatchObject({ escalated: 0, resolved: 1 })
    expect(slaEvents()[0]).toMatchObject({ status: 'resolved', resolved_at: at(24) })
    expect(tasks()[0]).toMatchObject({ status: 'done', resolved_at: at(24) })
  })
})
