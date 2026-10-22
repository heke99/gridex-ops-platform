// reality-defects: J2 (reality scenario J2 "inbound UTILTS", J2-08 one open operator item per quarter-hour for values outside our supply)
// lib/billing/meterValueBillingMatcher.ts updateMeterValueBillingReadiness, as the UTILTS sink calls it for every stored
// value. Observed in the reality world (scenario E, ALATE): one E66 day for a facility before its supply start left
// 96 open ediel_unresolved_items 'billing_period_missing' (one per quarter-hour); a month is ≈ 2 976 per facility.
// The fake keeps the open items and answers the matcher's own `contains` lookup. Synthetic ids only.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ items: [] as Array<Row & { extracted_identifiers: Row }>, gateReason: 'supply_period_missing', periods: [] as Row[] }))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/billing/sourceBasis', () => ({ loadQualifiedBillingValues: async (_company: string, ids: string[]) => new Map(ids.map(id => [id, { id, source_message_id: 'msg-day-1' }])) }))
vi.mock('@/lib/billing/billingGate', () => ({ evaluateBillingGate: () => ({ status: io.gateReason === 'quality_not_final' ? 'blocked' : 'pending_match', eligible: false,
  reasons: [{ code: io.gateReason, message: 'held' }], snapshot: { gate_version: 'test' } }) }))
function contains(haystack: unknown, needle: unknown): boolean {
  if (needle === null || typeof needle !== 'object') return haystack === needle
  if (Array.isArray(needle)) return Array.isArray(haystack) && needle.every(n => haystack.some(h => contains(h, n)))
  return Boolean(haystack) && typeof haystack === 'object' && Object.entries(needle as Row).every(([k, v]) => contains((haystack as Row)[k], v))
}
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: async () => ({ data: null, error: null }),
  from: (table: string) => {
    let needle: Row | null = null
    const query: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'lte', 'or', 'limit']) query[method] = () => query
    query.contains = (_column: string, value: Row) => { needle = value; return query }
    query.insert = async (row: Row & { extracted_identifiers: Row }) => { io.items.push(row); return { error: null } }
    query.then = (resolve: (value: unknown) => unknown) => {
      const data = table === 'normalized_metering_values' ? [{ id: 'nv' }]
        : table === 'customer_supply_periods' ? io.periods
          : table === 'ediel_unresolved_items' ? io.items.filter(item => item.status === 'open' && contains(item.extracted_identifiers, needle)) : []
      return Promise.resolve({ data, error: null }).then(resolve)
    }
    return query
  },
} }))

import { updateMeterValueBillingReadiness } from '@/lib/billing/meterValueBillingMatcher'

/** One E66 day: 96 quarter-hour values of one facility from one received file. */
async function receiveDay(sourceMessageId: string) {
  const start = Date.parse('2026-09-14T22:00:00Z')
  for (let q = 0; q < 96; q += 1) {
    const meterValue = { id: `mv-${sourceMessageId}-${q}`, company_id: 'co-1', metering_point_id: 'mp-not-supplied',
      period_start: new Date(start + q * 900_000).toISOString(), period_end: new Date(start + (q + 1) * 900_000).toISOString() }
    await updateMeterValueBillingReadiness({ meterValue: meterValue as never, sourceMessageId })
  }
}

beforeEach(() => { io.items = []; io.gateReason = 'supply_period_missing'; io.periods = [] })

describe('values for a facility we do not supply on that date', () => {
  it('stay held with one open operator item per received file, not one per quarter-hour', async () => {
    await receiveDay('msg-day-1')
    expect(io.items).toHaveLength(1)
    expect(io.items[0]).toMatchObject({ issue_type: 'billing_period_missing', source_message_id: 'msg-day-1', status: 'open',
      extracted_identifiers: { meteringPointId: 'mp-not-supplied', sourceMessageId: 'msg-day-1', supplyPeriodIds: [], reasonCodes: ['supply_period_missing'] } })
    // The next day's file gets its own item.
    await receiveDay('msg-day-2')
    expect(io.items).toHaveLength(2)
  })

  it('a value-specific block keeps its own item per value', async () => {
    io.gateReason = 'quality_not_final'
    io.periods = [{ id: 'sp-1', contract_id: null, customer_id: 'cu-1', status: 'active', start_date: '2026-09-01', end_date: null }]
    await updateMeterValueBillingReadiness({ meterValue: { id: 'mv-a', company_id: 'co-1', metering_point_id: 'mp-1', period_start: '2026-09-14T22:00:00Z', period_end: '2026-09-14T22:15:00Z' } as never, sourceMessageId: 'msg-day-1' })
    await updateMeterValueBillingReadiness({ meterValue: { id: 'mv-b', company_id: 'co-1', metering_point_id: 'mp-1', period_start: '2026-09-14T22:15:00Z', period_end: '2026-09-14T22:30:00Z' } as never, sourceMessageId: 'msg-day-1' })
    expect(io.items.map(item => item.issue_type)).toEqual(['billing_gate_blocked', 'billing_gate_blocked'])
  })
})
