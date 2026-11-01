// simulation: T1/010, MAIN03.04
// Calls the normal underlay entrypoint and the real source reader. Finite DB
// ports stop at the following supply-period read: no store or native DB runs.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  rows: [] as Row[],
  calls: [] as Array<{ company: string; ids: string[] }>,
  pages: [] as Array<[number, number]>,
  queryError: null as unknown,
  stop: new Error('finite supply-period port reached after source qualification'),
}))

vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/billing/invoiceReadiness', () => ({ assertBillingPeriodOpen: async () => undefined, getBillingPeriodLock: async () => null }))
vi.mock('@/lib/billing/consumptionEstimate', () => ({ companyEstimatesMissingConsumption: async () => false }))
vi.mock('@/lib/billing/historyRequest', () => ({ ensureHistoricalMeteringRequest: async () => { throw new Error('unexpected history request') } }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => {
    const predicates: Array<(row: Row) => boolean> = []
    const ordering: string[] = []
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return query },
      in: (key: string, values: unknown[]) => { predicates.push(row => values.includes(row[key])); return query },
      not: (key: string, operator: string, value: unknown) => {
        expect(operator).toBe('is'); expect(value).toBeNull()
        predicates.push(row => row[key] != null); return query
      },
      lt: (key: string, value: string) => { predicates.push(row => String(row[key]) < value); return query },
      gt: (key: string, value: string) => { predicates.push(row => String(row[key]) > value); return query },
      lte: () => query,
      or: () => query,
      order: (key: string) => { ordering.push(key); return query },
      range: async (from: number, to: number) => {
        if (table === 'customer_supply_periods') throw io.stop
        expect(table).toBe('normalized_metering_values')
        io.pages.push([from, to])
        const rows = io.rows.filter(row => predicates.every(predicate => predicate(row)))
          .sort((a, b) => {
            for (const key of ordering) { const cmp = String(a[key]).localeCompare(String(b[key])); if (cmp) return cmp }
            return 0
          })
        return { data: rows.slice(from, to + 1), error: io.queryError }
      },
    }
    return query
  },
  rpc: async (name: string, args: { p_company_id: string; p_value_ids: string[] }) => {
    expect(name).toBe('gridex_read_billing_source_values_v1')
    io.calls.push({ company: args.p_company_id, ids: [...args.p_value_ids] })
    return { data: [...args.p_value_ids].reverse().map(id => {
      const value = io.rows.find(row => row.id === id && row.company_id === args.p_company_id)!
      return { ...value, billing_source_basis: { version: 1, normalizedValueId: id, quantityKwh: value.quantity_kwh } }
    }), error: null }
  },
} }))

import { generateBillingUnderlaysForMonth } from '@/lib/billing/underlayEngine'

function values(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `value-${String(i).padStart(5, '0')}`, company_id: 'tenant-a',
    source_message_id: `source-${i % 4}`, quantity_kwh: '1.25', supply_period_id: 'period-a',
    revision_status: 'current', billing_status: 'billable', billing_gate_status: 'eligible',
    period_start: new Date(Date.parse('2027-02-01T00:00:00Z') + i * 900_000).toISOString(),
    period_end: new Date(Date.parse('2027-02-01T00:15:00Z') + i * 900_000).toISOString(),
  }))
}

async function readThroughEntrypoint() {
  await expect(generateBillingUnderlaysForMonth({ companyId: 'tenant-a', billingMonth: '2027-02' })).rejects.toBe(io.stop)
}

beforeEach(() => { io.rows = values(1001); io.calls = []; io.pages = []; io.queryError = null })

describe('T1/010 the normal underlay path groups qualified source reads', () => {
  it('qualifies a multi-page workload using bounded calls', async () => {
    await readThroughEntrypoint()
    expect(io.pages).toEqual([[0, 999], [1000, 1999]])
    expect(io.calls.map(call => call.ids.length)).toEqual([250, 250, 250, 250, 1])
    expect(io.calls.every(call => call.company === 'tenant-a')).toBe(true)
  })

  it('passes source identity from the normalized rows to the actual reader', async () => {
    await readThroughEntrypoint()
    const expected = [...io.rows].sort((a, b) => String(a.source_message_id).localeCompare(String(b.source_message_id)) || String(a.id).localeCompare(String(b.id)))
    expect(io.calls.flatMap(call => call.ids)).toEqual(expected.map(row => row.id))
    expect(new Set(io.calls.flatMap(call => call.ids)).size).toBe(1001)
  })

  it('keeps tenant, revision, eligibility, supply and period exclusions before qualification', async () => {
    io.rows = values(3)
    const excluded = [
      { company_id: 'tenant-b' }, { revision_status: 'superseded' }, { billing_status: 'blocked' },
      { billing_gate_status: 'blocked' }, { supply_period_id: null },
      { period_start: '2028-02-01T00:00:00Z', period_end: '2028-02-01T00:15:00Z' },
      { period_start: '2026-02-01T00:00:00Z', period_end: '2026-02-01T00:15:00Z' },
    ].map((change, i) => ({ ...io.rows[0], id: `excluded-${i}`, ...change }))
    io.rows.push(...excluded)
    await readThroughEntrypoint()
    expect(io.calls.flatMap(call => call.ids).sort()).toEqual(values(3).map(row => row.id))
  })

  it('does not qualify an empty result set', async () => {
    io.rows = []
    await readThroughEntrypoint()
    expect(io.calls).toEqual([])
  })

  it('preserves the original discovery error without calling qualification', async () => {
    const error = { code: '42501', message: 'discovery denied' }
    io.queryError = error
    await expect(generateBillingUnderlaysForMonth({ companyId: 'tenant-a', billingMonth: '2027-02' })).rejects.toBe(error)
    expect(io.calls).toEqual([])
  })
})
