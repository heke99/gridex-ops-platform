// reality-defects: H3d
// H3d D11 / owner decision 28, slice 2: lib/pricing/engine.ts prices a break-fee underlay through the same entry
// point and persistence as every underlay, with one line from the approved charge. Harness of h3b-move-out-final-month.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/billing/invoiceReadiness', async original => ({ ...await original<Record<string, unknown>>(), assertBillingPeriodOpen: async () => undefined, getBillingPeriodLock: async () => null }))
vi.mock('@/lib/billing/historyRequest', () => ({ ensureHistoricalMeteringRequest: async () => 'already_requested' }))
vi.mock('@/lib/billing/consumptionEstimate', async original => ({
  ...await original<Record<string, unknown>>(),
  companyEstimatesMissingConsumption: async () => false,
  estimateMissingConsumption: async () => null,
}))
vi.mock('@/lib/billing/sourceBasis', () => ({
  loadQualifiedBillingValues: async (_company: string, ids: string[]) => {
    const rows = new Map((io.tables.normalized_metering_values ?? []).map(row => [String(row.id), row]))
    return new Map(ids.map(id => [id, rows.get(id)!]))
  },
}))
vi.mock('@/lib/metering/contractMeteringResolution', async original => ({
  ...await original<Record<string, unknown>>(),
  loadMeteringResolutionRequirements: async () => new Map(),
}))
// A fixed price: the price sources are not under test (no spot, no provider).
vi.mock('@/lib/pricing/priceSourceResolver', () => ({
  resolvePricingConfiguration: async () => ({ baseComponents: [{ sourceType: 'fixed', weightPercent: 100, fixedPriceSekPerKwh: 1 }], priceComponents: [], vatRate: 0.25, warnings: [] }),
  resolveBasePriceSourceValues: async () => ({ fixedSekPerKwh: 1 }),
}))
vi.mock('@/lib/pricing/spot/spotImportScheduler', () => ({ ensureSpotPricesForBillingMonth: async () => { throw new Error('spot import not expected') } }))
vi.mock('@/lib/pricing/spot/spotPriceImporter', () => ({ importSpotPricesForDayArea: async () => { throw new Error('spot import not expected') } }))
// A PostgREST stand-in that applies equality filters (eq/in/is) and ignores range filters.
vi.mock('@/lib/supabase/service', () => {
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = []
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'lt', 'gt', 'lte', 'gte', 'or', 'not', 'order', 'neq', 'contains', 'limit', 'update', 'filter', 'match', 'range']) builder[method] = () => builder
    builder.eq = (column: string, value: unknown) => { filters.push(row => row[column] === value); return builder }
    builder.in = (column: string, values: unknown[]) => { filters.push(row => values.includes(row[column])); return builder }
    builder.is = (column: string, value: unknown) => { filters.push(row => (row[column] ?? null) === value); return builder }
    const rows = () => (io.tables[table] ?? []).filter(row => filters.every(test => test(row)))
    builder.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null })
    builder.single = builder.maybeSingle
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject)
    return builder
  }
  const rpc = async (name: string, args: Record<string, unknown>) => {
    io.rpcCalls.push({ name, args })
    if (name === 'gridex_set_metering_billing_gate') return { data: null, error: null }
    if (name === 'gridex_store_billing_underlay_batch') return { data: (args.p_commands as unknown[]).map((_, index) => `stored-${index}`), error: null }
    if (name === 'gridex_persist_pricing_run') return { data: 'run-1', error: null }
    return { data: null, error: { code: '42883', message: `unexpected rpc ${name}` } }
  }
  return { supabaseService: { from, rpc } }
})

import { calculatePricingPreviewForUnderlay } from '@/lib/pricing/engine'

const CO = 'co-d11'
const contract: Row = { id: 'ct-1', company_id: CO, customer_id: 'cu-1', metering_point_id: 'mp-1', status: 'terminated', termination_reason: 'supply_end',
  ended_at: '2026-10-23T00:00:00+00:00', starts_at: '2026-09-01', contract_type: 'fixed', energy_direction: 'consumption', fixed_price_ore_per_kwh: 120 }
const snapshot: Row = { id: 'snap-1', company_id: CO, contract_id: 'ct-1', valid_from: '2026-09-01', valid_to: null, snapshot_json: { price_area: 'SE3', energy_direction: 'consumption' } }
const underlay: Row = { id: 'bu-fee', company_id: CO, customer_id: 'cu-1', metering_point_id: 'mp-1', contract_id: 'ct-1', customer_contract_id: 'ct-1',
  contract_price_snapshot_id: 'snap-1', pricing_snapshot_id: 'snap-1', underlay_year: 2026, underlay_month: 10, billing_period_start: '2026-10-23', billing_period_end: '2026-10-24',
  status: 'validated', readiness_status: 'blocked', total_kwh: 0, price_area: 'SE3', energy_direction: 'consumption', settlement_type: 'invoice',
  payload: { charge_kind: 'break_fee', break_fee_charge_id: 'ch-1', billing_period_start_instant: '2026-10-22T22:00:00Z', billing_period_end_instant: '2026-10-23T22:00:00Z',
    billing_period_timezone: 'Europe/Stockholm', billing_period_end_exclusive: true } }
const charge = (status = 'underlaid'): Row => ({ id: 'ch-1', company_id: CO, customer_contract_id: 'ct-1', billing_underlay_id: 'bu-fee', status, amount_ex_vat: '300.00',
  currency: 'SEK', contract_basis: 'consumer_fixed_term_fixed_price', contract_rule_reference: null,
  vat_classification: { code: 'early_termination_compensation', vat_rate: 0.25, account: '3990', verified_by: 'acc', verified_at: '2026-10-25', source: 'advice' } })

describe('D11 the pricing engine prices a break-fee underlay from its charge only', () => {
  beforeEach(() => {
    io.tables = { billing_underlays: [underlay], customer_contracts: [contract], contract_price_snapshots: [snapshot], break_fee_charges: [charge()] }
    io.rpcCalls = []
  })

  it('one break-fee line, no energy, and a persisted run with no error', async () => {
    const preview = await calculatePricingPreviewForUnderlay({ companyId: CO, billingUnderlayId: 'bu-fee', persist: true })
    expect(preview.errors).toEqual([])
    expect(preview.status).toBe('success')
    expect(preview.lines).toHaveLength(1)
    expect(preview.lines[0]).toMatchObject({ lineType: 'break_fee', amountExVat: 300, vatAmount: 75, metadata: { lifecycle: 'event_only', billing_event_id: 'ch-1' } })
    expect(preview.totalIncVat).toBe(375)
    expect(io.rpcCalls.filter(call => call.name === 'gridex_persist_pricing_run')).toHaveLength(1)
  })

  it('an invoiced charge is never priced again', async () => {
    io.tables.break_fee_charges = [charge('invoiced')]
    const preview = await calculatePricingPreviewForUnderlay({ companyId: CO, billingUnderlayId: 'bu-fee', persist: false })
    expect(preview.lines).toEqual([])
    expect(preview.errors.join()).toMatch(/status invoiced/)
  })
})
