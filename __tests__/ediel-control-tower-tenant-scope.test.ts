// Fynd 026: control tower måste tenant-scopa ediel_message_events som grannfrågorna.
import { describe, expect, it, vi } from 'vitest'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const recent = new Date().toISOString()

type Row = Record<string, unknown>
const tables: Record<string, Row[]> = {
  ediel_message_events: [
    { id: 'ev-a-warn', company_id: A, ediel_message_id: 'm-a', event_type: 'parse', event_status: 'warning', message: 'A warning', created_at: recent },
    { id: 'ev-b-err', company_id: B, ediel_message_id: 'm-b', event_type: 'parse', event_status: 'error', message: 'B error', created_at: recent },
    { id: 'ev-a-failed', company_id: A, ediel_message_id: 'm-a', event_type: 'failed', event_status: 'error', message: 'A failed', created_at: recent },
    { id: 'ev-b-failed', company_id: B, ediel_message_id: 'm-b', event_type: 'failed', event_status: 'error', message: 'B failed', created_at: recent },
  ],
}

vi.mock('@/lib/ediel/db', () => ({
  listCanonicalAckConflictEvents: async () => [],
  listCanonicalDuplicateBlockEvents: async () => [],
}))

vi.mock('@/lib/supabase/service', () => {
  class Query implements PromiseLike<{ data: Row[]; count: number; error: null }> {
    private preds: Array<(row: Row) => boolean> = []
    constructor(private table: string) {}
    select() { return this }
    limit() { return this }
    order() { return this }
    eq(c: string, v: unknown) { this.preds.push((r) => r[c] === v); return this }
    neq(c: string, v: unknown) { this.preds.push((r) => r[c] !== v); return this }
    in(c: string, vs: unknown[]) { this.preds.push((r) => vs.includes(r[c])); return this }
    is(c: string, v: unknown) { this.preds.push((r) => (r[c] ?? null) === v); return this }
    not(c: string, _op: string, v: unknown) { this.preds.push((r) => (r[c] ?? null) !== v); return this }
    gte(c: string, v: unknown) { this.preds.push((r) => String(r[c]) >= String(v)); return this }
    lte(c: string, v: unknown) { this.preds.push((r) => String(r[c]) <= String(v)); return this }
    ilike() { return this }
    then<R1, R2>(ok?: ((v: { data: Row[]; count: number; error: null }) => R1 | PromiseLike<R1>) | null, ko?: ((e: unknown) => R2 | PromiseLike<R2>) | null) {
      const data = (tables[this.table] ?? []).filter((r) => this.preds.every((p) => p(r)))
      return Promise.resolve({ data, count: data.length, error: null }).then(ok, ko)
    }
  }
  return { supabaseService: { from: (table: string) => new Query(table) } }
})

import { buildEdielControlTowerOperationsSummary } from '@/lib/ediel/operations/controlTower'

function eventIncidentIds(summary: Awaited<ReturnType<typeof buildEdielControlTowerOperationsSummary>>) {
  return summary.incidents.filter((i) => i.href?.startsWith('/admin/ediel/messages/m-')).map((i) => i.id).sort()
}
function transportCount(summary: Awaited<ReturnType<typeof buildEdielControlTowerOperationsSummary>>) {
  return summary.monitors.find((m) => m.key === 'failed_transport')?.value
}

describe('control tower tenant scope for ediel_message_events', () => {
  it('narrow tenant scope shows only that tenant warning/error incidents', async () => {
    const summary = await buildEdielControlTowerOperationsSummary({ companyId: A, scope: 'tenant' })
    expect(eventIncidentIds(summary)).toEqual(['ev-a-failed', 'ev-a-warn'])
  })

  it('narrow tenant scope counts only that tenant failed events (variant)', async () => {
    const summary = await buildEdielControlTowerOperationsSummary({ companyId: A, scope: 'tenant' })
    expect(transportCount(summary)).toBe('1')
  })

  it('global scope is unchanged and includes both tenants', async () => {
    const summary = await buildEdielControlTowerOperationsSummary({ companyId: null, scope: 'platform' })
    expect(eventIncidentIds(summary)).toEqual(['ev-a-failed', 'ev-a-warn', 'ev-b-err', 'ev-b-failed'])
    expect(transportCount(summary)).toBe('2')
  })
})
