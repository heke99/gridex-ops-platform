// reality-defects: I-B7
// I-B7 (scenario I, batch 5c): runEdielAckSlaMonitor read one unordered page of 100 rows from
// ediel_overdue_message_acks_v. Messages that already had an open SLA event filled the page (each insert a 23505 that
// was skipped), so a newly overdue message beyond it, a Z03 the grid owner never answered, never got its event
// (world: 149 overdue, 43 escalated; GOR-05 failed in I6). The monitor now reads in a stable order, skips messages
// whose open event exists, and creates up to `limit` new events.
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ view: [] as Array<Record<string, unknown>>, events: [] as Array<Record<string, unknown>>, messageEvents: 0, viewReads: 0 }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      const eqs: [string, unknown][] = []
      let ins: string[] | null = null, range: [number, number] | null = null, order: string[] = [], insertRow: Record<string, unknown> | null = null
      const run = () => {
        if (table === 'ediel_overdue_message_acks_v') {
          io.viewReads++
          let rows = io.view.filter(r => eqs.every(([c, v]) => r[c] === v))
          if (order.length) rows = [...rows].sort((a, b) => String(a.ack_due_at).localeCompare(String(b.ack_due_at)) || String(a.id).localeCompare(String(b.id)))
          return { data: range ? rows.slice(range[0], range[1] + 1) : rows, error: null }
        }
        if (table === 'ediel_ack_sla_events') {
          if (insertRow) {
            if (io.events.some(e => e.status === 'open' && e.ediel_message_id === insertRow!.ediel_message_id)) return { data: null, error: { code: '23505' } }
            io.events.push(insertRow); return { data: null, error: null }
          }
          return { data: io.events.filter(e => eqs.every(([c, v]) => e[c] === v) && (!ins || ins.includes(String(e.ediel_message_id)))), error: null }
        }
        if (table === 'ediel_message_events') { io.messageEvents++; return { data: null, error: null } }
        throw Error(`unexpected ${table}`)
      }
      const q: Record<string, unknown> = {}
      Object.assign(q, {
        select: () => q, limit: (n: number) => { range = [0, n - 1]; return q },
        eq: (c: string, v: unknown) => { eqs.push([c, v]); return q },
        in: (c: string, v: string[]) => { ins = v; return q },
        order: (c: string) => { order.push(c); return q },
        range: (a: number, b: number) => { range = [a, b]; return q },
        insert: (row: Record<string, unknown>) => { insertRow = row; return q },
        then: (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko),
      })
      return q
    },
  },
}))
import { runEdielAckSlaMonitor } from '@/lib/ediel/operations/ackSlaMonitor'

const row = (n: number) => ({ id: `m-${String(n).padStart(4, '0')}`, company_id: 'c', message_family: 'PRODAT', message_code: 'Z03', ack_due_at: `2026-10-${String(1 + (n % 25)).padStart(2, '0')}T00:00:00Z` })
beforeEach(() => { io.view = []; io.events = []; io.messageEvents = 0; io.viewReads = 0 })

it('a newly overdue message behind already-escalated ones gets its event', async () => {
  io.view = Array.from({ length: 150 }, (_, n) => row(n))
  // 149 are already escalated; the silent Z03 is not, and it sorts last.
  io.events = io.view.slice(0, 149).map(r => ({ ediel_message_id: r.id, status: 'open' }))
  io.view[149] = { ...io.view[149], ack_due_at: '2026-10-27T01:45:41Z' }
  const result = await runEdielAckSlaMonitor({ actorUserId: 'automation', limit: 100, pageSize: 100 })
  expect(result).toMatchObject({ created: 1 })
  expect(io.events.filter(e => e.ediel_message_id === 'm-0149' && e.status === 'open')).toHaveLength(1)
  expect(io.messageEvents).toBe(1)
})

it('creates at most `limit` events and never a second open event for the same message', async () => {
  io.view = Array.from({ length: 30 }, (_, n) => row(n))
  expect(await runEdielAckSlaMonitor({ limit: 10, pageSize: 7 })).toMatchObject({ created: 10 })
  expect(await runEdielAckSlaMonitor({ limit: 100, pageSize: 7 })).toMatchObject({ created: 20 })
  expect(await runEdielAckSlaMonitor({ limit: 100, pageSize: 7 })).toMatchObject({ created: 0 })
  expect(io.events).toHaveLength(30)
})

it('stops at maxScan rows', async () => {
  io.view = Array.from({ length: 500 }, (_, n) => row(n))
  io.events = io.view.map(r => ({ ediel_message_id: r.id, status: 'open' }))
  await runEdielAckSlaMonitor({ pageSize: 50, maxScan: 200 })
  expect(io.viewReads).toBe(4)
})
