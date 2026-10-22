// reality-defects: J2 (reality scenario J2 "inbound UTILTS", J2-02 a correction after invoicing is never surfaced; J2-12 the duplicate-billing check reads 1 000 rows and flags settlements)
// lib/ops/reconciliation.ts runProductionConsistencyChecks (the daily reconciliation cron and /admin/system-health)
// against a fake PostgREST with PostgREST's 1 000-row cap (supabase/config.toml max_rows). The correction journal
// is read through the database's own gridex_read_billing_underlay_source_basis_v1 (correctionRequired), exactly as
// invoice export readiness reads it. Synthetic ids only.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, corrected: new Set<string>(), rpc: [] as Array<{ name: string; args: Row }> }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => {
    let range: [number, number] | null = null, limit: number | null = null
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'neq', 'not', 'order', 'is', 'lte']) builder[method] = () => builder
    builder.limit = (n: number) => { limit = n; return builder }
    builder.range = (a: number, b: number) => { range = [a, b]; return builder }
    builder.then = (resolve: (value: unknown) => unknown) => {
      const all = io.tables[table] ?? [], start = range ? range[0] : 0
      const end = Math.min(range ? range[1] + 1 : all.length, limit === null ? Infinity : start + limit, start + 1000)
      return Promise.resolve({ data: all.slice(start, end), error: null }).then(resolve)
    }
    return builder
  },
  rpc: async (name: string, args: Row) => {
    io.rpc.push({ name, args })
    if (name !== 'gridex_read_billing_underlay_source_basis_v1') return { data: null, error: { message: 'unexpected' } }
    return { data: (args.p_underlay_ids as string[]).map(id => ({ id, qualified: !io.corrected.has(id), correctionRequired: io.corrected.has(id) })), error: null }
  },
} }))

import { runProductionConsistencyChecks } from '@/lib/ops/reconciliation'

const underlay = (id: string, extra: Row = {}): Row => ({ id, contract_id: `ct-${id}`, metering_point_id: `mp-${id}`, underlay_year: 2026, underlay_month: 9,
  energy_direction: 'consumption', billing_period_start: '2026-09-01', billing_period_end: '2026-10-01', source_system: 'normalized_metering_values', ...extra })
const check = async (key: string) => (await runProductionConsistencyChecks({ companyId: 'co-1' })).checks.find(entry => entry.key === key)!

beforeEach(() => { io.tables = {}; io.corrected = new Set(); io.rpc = [] })

describe('duplicate billing per contract and period', () => {
  it('finds a duplicate among more than 1 000 newer underlays', async () => {
    const newer = Array.from({ length: 1500 }, (_, i) => underlay(`u${i}`))
    io.tables.billing_underlays = [...newer, underlay('dup-a', { contract_id: 'ct-dup' }), underlay('dup-b', { contract_id: 'ct-dup' })]
    expect(await check('duplicate_billing_per_contract_period')).toMatchObject({ count: 1, sampleIds: ['dup-a'] })
  })

  it('a settlement of a preliminary month, production next to consumption and two supply segments are not duplicates', async () => {
    io.tables.billing_underlays = [
      underlay('regular', { contract_id: 'ct-1' }),
      underlay('credit', { contract_id: 'ct-1', energy_direction: 'consumption_correction', source_system: 'consumption_estimate_reconciliation', billing_period_start: '2026-08-01', billing_period_end: '2026-09-01' }),
      underlay('charge', { contract_id: 'ct-1', source_system: 'consumption_estimate_reconciliation', billing_period_start: '2026-08-01', billing_period_end: '2026-09-01' }),
      underlay('production', { contract_id: 'ct-1', energy_direction: 'production' }),
      underlay('first-half', { contract_id: 'ct-2', billing_period_end: '2026-09-15' }),
      underlay('second-half', { contract_id: 'ct-2', billing_period_start: '2026-09-15' }),
    ]
    expect(await check('duplicate_billing_per_contract_period')).toMatchObject({ count: 0 })
  })
})

describe('metering corrections after invoicing', () => {
  it('reports every invoiced underlay whose values the grid owner corrected afterwards', async () => {
    io.tables.invoice_export_items = [
      { company_id: 'co-1', billing_underlay_id: 'u-invoiced-ok' },
      { company_id: 'co-1', billing_underlay_id: 'u-invoiced-corrected' },
    ]
    io.corrected.add('u-invoiced-corrected')
    const result = await check('metering_corrections_after_billing')
    expect(result).toMatchObject({ severity: 'critical', count: 1, sampleIds: ['u-invoiced-corrected'] })
    expect(result.error).toBeUndefined()
    expect(io.rpc).toEqual([{ name: 'gridex_read_billing_underlay_source_basis_v1', args: { p_company_id: 'co-1', p_underlay_ids: ['u-invoiced-ok', 'u-invoiced-corrected'] } }])
  })
})
