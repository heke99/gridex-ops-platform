// reality-defects: J2 (reality scenario J2 "inbound UTILTS", J2-01 a correction after a finalized underlay fails the whole tenant month; J2-11 estimate settlement candidates are capped and their lookup URL overflows)
// The monthly underlay engine (lib/billing/underlayEngine.ts generateBillingUnderlaysForMonth, run by the 6-hourly
// monthly billing cron) against a fake PostgREST that keeps PostgREST's limits: at most 1 000 rows per request and
// at most ~250 uuids in one GET filter (FINDINGS F34; measured locally: 250 ids = 9.3 kB → 414 URI too long).
// The database's own refusal for a corrected finalized underlay is reproduced verbatim (gridex_store_billing_underlay:
// RAISE 'billing_source_finalized_underlay_requires_correction' USING ERRCODE='55000'); inside
// gridex_store_billing_underlay_batch that refusal rolls back every underlay of the run. Synthetic ids only.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  inFilters: [] as Array<{ table: string; column: string; size: number }>,
  ranges: [] as Array<{ table: string; from: number; to: number }>,
  refuseFor: new Set<string>(),
  estimation: false,
}))

vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/billing/invoiceReadiness', () => ({ assertBillingPeriodOpen: async () => undefined, getBillingPeriodLock: async () => null }))
vi.mock('@/lib/billing/historyRequest', () => ({ ensureHistoricalMeteringRequest: async () => 'already_requested' }))
vi.mock('@/lib/billing/consumptionEstimate', async original => ({
  ...await original<Record<string, unknown>>(),
  companyEstimatesMissingConsumption: async () => io.estimation,
  estimateMissingConsumption: async () => null,
}))
vi.mock('@/lib/supabase/service', () => {
  const MAX_ROWS = 1000, MAX_IN_IDS = 249
  const from = (table: string) => {
    let range: [number, number] | null = null, limit: number | null = null, select = '*', tooLong = false
    const builder: Record<string, unknown> = {}
    for (const method of ['eq', 'lt', 'gt', 'lte', 'gte', 'or', 'not', 'order', 'neq', 'contains']) builder[method] = () => builder
    builder.select = (fields: string) => { select = fields; return builder }
    builder.in = (column: string, values: unknown[]) => {
      io.inFilters.push({ table, column, size: values.length })
      if (values.length > MAX_IN_IDS && column !== 'status' && column !== 'source_system') tooLong = true
      return builder
    }
    builder.limit = (n: number) => { limit = n; return builder }
    builder.range = (a: number, b: number) => { range = [a, b]; io.ranges.push({ table, from: a, to: b }); return builder }
    const rows = () => {
      if (table === 'billing_underlays' && select.includes('reconciliation_of')) return []
      const all = io.tables[table] ?? []
      const start = range ? range[0] : 0
      const end = Math.min(range ? range[1] + 1 : all.length, limit === null ? all.length : start + limit, start + MAX_ROWS)
      return all.slice(start, end)
    }
    const result = () => tooLong ? { data: null, error: { code: '414', message: 'URI too long' } } : { data: rows(), error: null }
    builder.maybeSingle = async () => { const r = result(); return { data: (r.data ?? [])[0] ?? null, error: r.error } }
    builder.single = builder.maybeSingle
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject)
    return builder
  }
  const rpc = async (name: string, args: Record<string, unknown>) => {
    io.rpcCalls.push({ name, args })
    const refused = { data: null, error: { code: '55000', message: 'billing_source_finalized_underlay_requires_correction', details: null, hint: null } }
    if (name === 'gridex_store_billing_underlay_batch') {
      const commands = args.p_commands as Array<{ underlay: Row }>
      // One transaction: one refused underlay rolls back the whole batch.
      if (commands.some(command => io.refuseFor.has(String(command.underlay.metering_point_id)))) return refused
      return { data: commands.map((command, index) => `stored-${index}-${String(command.underlay.metering_point_id)}`), error: null }
    }
    if (name === 'gridex_store_billing_underlay') {
      const underlay = args.p_underlay as Row
      if (io.refuseFor.has(String(underlay.metering_point_id))) return refused
      return { data: `stored-${String(underlay.metering_point_id)}`, error: null }
    }
    if (name === 'gridex_read_billing_source_values_v1') return { data: [], error: null }
    return { data: null, error: { code: '42883', message: `unexpected rpc ${name}` } }
  }
  return { supabaseService: { from, rpc } }
})

import { generateBillingUnderlaysForMonth } from '@/lib/billing/underlayEngine'

const COMPANY = 'company-j2'
function facility(n: number) {
  const mp = `mp-${n}`
  return {
    period: { id: `sp-${n}`, company_id: COMPANY, customer_id: `cu-${n}`, customer_site_id: `site-${n}`, metering_point_id: mp, contract_id: `ct-${n}`, status: 'active', start_date: '2026-09-01', end_date: null },
    contract: { id: `ct-${n}`, company_id: COMPANY, customer_id: `cu-${n}`, metering_point_id: mp, status: 'signed', starts_at: '2026-08-12', energy_direction: 'consumption' },
  }
}

beforeEach(() => {
  io.rpcCalls = []; io.inFilters = []; io.ranges = []; io.refuseFor = new Set(); io.estimation = false
  const a = facility(1), b = facility(2)
  io.tables = {
    normalized_metering_values: [],
    customer_supply_periods: [a.period, b.period],
    // loadContract reads by id; the fake answers the first row, which is the same shape for both facilities.
    customer_contracts: [a.contract],
    contract_price_snapshots: [{ id: 'snap-1', contract_id: 'ct-1', valid_from: '2026-08-12', valid_to: null, snapshot_json: { price_area: 'SE3', energy_direction: 'consumption' } }],
    billing_underlays: [],
  }
})

describe('J2-01 a correction after a finalized underlay', () => {
  it('stores every other customer of the tenant month and reports the corrected one for credit or re-invoicing', async () => {
    // mp-1's September underlay was finalized (bound) before the grid owner corrected one of its values.
    io.refuseFor.add('mp-1')
    const result = await generateBillingUnderlaysForMonth({ companyId: COMPANY, billingMonth: '2026-09', createdBy: 'automation' })
    // Before the fix the batch refusal was thrown: no underlay for any customer of the tenant, every 6 hours.
    const stored = result.results.filter(entry => entry.underlayId)
    expect(stored.map(entry => entry.underlayId)).toEqual(['stored-mp-2'])
    const corrected = result.results.find(entry => entry.warnings.some(warning => warning.startsWith('finalized_underlay_requires_correction')))
    expect(corrected).toMatchObject({ underlayId: null, status: 'needs_review' })
    // The finalized underlay itself is never rewritten here: only the database's single-underlay store is called for it.
    expect(io.rpcCalls.filter(call => call.name === 'gridex_store_billing_underlay').map(call => (call.args.p_underlay as Row).metering_point_id)).toEqual(['mp-1', 'mp-2'])
  })

  it('keeps the single batch when nothing was corrected', async () => {
    const result = await generateBillingUnderlaysForMonth({ companyId: COMPANY, billingMonth: '2026-09', createdBy: 'automation' })
    expect(io.rpcCalls.map(call => call.name).filter(name => name.startsWith('gridex_store'))).toEqual(['gridex_store_billing_underlay_batch'])
    expect(result.results.map(entry => entry.underlayId)).toEqual(['stored-0-mp-1', 'stored-1-mp-2'])
  })

  it('any other database refusal still fails the run', async () => {
    io.refuseFor.add('mp-1')
    const { supabaseService } = await import('@/lib/supabase/service')
    const original = supabaseService.rpc
    supabaseService.rpc = (async (name: string, args: Record<string, unknown>) => name === 'gridex_store_billing_underlay_batch'
      ? { data: null, error: { code: '23514', message: 'billing_underlay_qualified_source_mismatch' } }
      : original(name as never, args as never)) as unknown as typeof supabaseService.rpc
    try {
      await expect(generateBillingUnderlaysForMonth({ companyId: COMPANY, billingMonth: '2026-09', createdBy: 'automation' })).rejects.toMatchObject({ code: '23514' })
    } finally { supabaseService.rpc = original }
  })
})

describe('J2-11 settlement of preliminary (estimated) months', () => {
  it('reads every earlier preliminary underlay and looks up their settlements in URL-safe chunks', async () => {
    io.estimation = true
    io.tables.billing_underlays = Array.from({ length: 1300 }, (_, i) => ({ id: `est-${String(i).padStart(4, '0')}`, company_id: COMPANY, energy_direction: 'consumption',
      source_system: 'consumption_estimate', underlay_year: 2025, underlay_month: 1 + (i % 12), metering_point_id: `mp-${i}`, payload: {} }))
    await generateBillingUnderlaysForMonth({ companyId: COMPANY, billingMonth: '2026-09', createdBy: 'automation' })
    const lookups = io.inFilters.filter(entry => entry.table === 'billing_underlays' && entry.column === 'payload->>reconciliation_of')
    // Before the fix: one .limit(500) read (an arbitrary 500, reconciled ones included) and one lookup with all of them (414).
    expect(lookups.reduce((sum, entry) => sum + entry.size, 0)).toBe(1300)
    expect(Math.max(...lookups.map(entry => entry.size))).toBeLessThanOrEqual(100)
    expect(io.ranges.filter(entry => entry.table === 'billing_underlays').length).toBeGreaterThanOrEqual(2)
  })
})
