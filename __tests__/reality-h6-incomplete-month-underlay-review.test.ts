// reality-defects: H6
// H6 (owner decision 2026-10-25, "gör båda"): an incomplete billing month (values missing) is kept as a stored billing
// underlay in review (needs_review), so the operator sees it, instead of being dropped when a history estimate exists.
// The estimate is never a billing source and a review underlay is blocked from invoicing. Synthetic ids only; calls the code.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  estimate: null as unknown,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/billing/invoiceReadiness', async original => ({ ...await original<Record<string, unknown>>(), assertBillingPeriodOpen: async () => undefined, getBillingPeriodLock: async () => null }))
vi.mock('@/lib/billing/historyRequest', () => ({ ensureHistoricalMeteringRequest: async () => 'already_requested' }))
vi.mock('@/lib/billing/consumptionEstimate', async original => ({
  ...await original<Record<string, unknown>>(),
  companyEstimatesMissingConsumption: async () => true,
  estimateMissingConsumption: async () => io.estimate,
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

import { generateBillingUnderlaysForMonth } from '@/lib/billing/underlayEngine'
import { calculatePricingPreviewForUnderlay } from '@/lib/pricing/engine'

const COMPANY = 'co-h6'
const SEP_START = '2026-08-31T23:00:00.000Z'
const HALF = '2026-09-15T22:00:00.000Z'
const active: Row = { id: 'sp-1', company_id: COMPANY, customer_id: 'cu-1', metering_point_id: 'mp-1', contract_id: 'ct-1', status: 'active',
  start_date: '2026-08-01', end_date: null, actual_end_date: null, market_start_at: '2026-07-31T22:00:00+00:00', market_end_at: null, metadata: {} }
const contract: Row = { id: 'ct-1', company_id: COMPANY, customer_id: 'cu-1', metering_point_id: 'mp-1', status: 'active', starts_at: '2026-08-01', ends_at: null,
  contract_type: 'fixed', energy_direction: 'consumption' }
const snapshot: Row = { id: 'snap-1', company_id: COMPANY, contract_id: 'ct-1', valid_from: '2026-08-01', valid_to: null, snapshot_json: { price_area: 'SE3', energy_direction: 'consumption' } }
// Only the first half of September is metered: the month is incomplete.
const halfValue: Row = { id: 'nv-sep', company_id: COMPANY, customer_id: 'cu-1', metering_point_id: 'mp-1', supply_period_id: 'sp-1', source_metering_value_id: 'mv-sep', source_message_id: 'msg-1',
  revision_status: 'current', billing_status: 'billable', billing_gate_status: 'eligible', quantity_kwh: '180', unit: 'kWh', quality_status: 'measured', direction: 'consumption',
  product_code: null, period_start: SEP_START, period_end: HALF, billing_gate_snapshot: { status: 'eligible' },
  billing_source_message: { id: 'msg-1', company_id: COMPANY, message_family: 'UTILTS', status: 'validated' },
  billing_source_basis: { version: 1, qualified: true, normalizedValueId: 'nv-sep', sourceMessageId: 'msg-1', quantityType: '136', quantityKwh: '180', productCode: null, qualityEstablished: true, quality: null } }
const stored = () => io.rpcCalls.filter(call => call.name === 'gridex_store_billing_underlay_batch')
  .flatMap(call => (call.args.p_commands as Array<{ underlay: Row }>).map(command => command.underlay))

async function september(estimate: unknown) {
  io.tables = { normalized_metering_values: [halfValue], customer_supply_periods: [active], customer_contracts: [contract], contract_price_snapshots: [snapshot] }
  io.rpcCalls = []
  io.estimate = estimate
  return generateBillingUnderlaysForMonth({ companyId: COMPANY, billingMonth: '2026-09', createdBy: 'automation' })
}

describe('H6 an incomplete month is kept as an underlay in review, never invoiced', () => {
  beforeEach(() => { io.tables = {}; io.rpcCalls = []; io.estimate = null })

  it('with a history estimate the incomplete month is stored as needs_review with the reason', async () => {
    const result = await september({ method: 'history', referenceStart: null, referenceEnd: null, intervals: [], estimatedKwh: 170 })
    expect(result.results.map(entry => entry.status)).toEqual(['needs_review'])
    expect(result.results[0].underlayId).not.toBeNull()
    expect(result.results[0].warnings.some(w => w.startsWith('estimated_source_missing'))).toBe(true)
    const [underlay] = stored()
    expect(underlay).toMatchObject({ contract_id: 'ct-1', supply_period_id: 'sp-1', total_kwh: '180' })
    expect(underlay.readiness_status).not.toBe('ready')
  })

  it('the estimate is never the billed quantity: only the measured values are in the underlay', async () => {
    await september({ method: 'history', referenceStart: null, referenceEnd: null, intervals: [], estimatedKwh: 170 })
    const [underlay] = stored()
    expect(underlay.total_kwh).toBe('180')
  })

  it('without an estimate it is stored in review as before', async () => {
    const result = await september(null)
    expect(result.results.map(entry => entry.status)).toEqual(['needs_review'])
    expect(stored()).toHaveLength(1)
  })

  it('a stored review underlay is blocked from invoicing (invoiceReadiness requires validated + ready)', async () => {
    await september({ method: 'history', referenceStart: null, referenceEnd: null, intervals: [], estimatedKwh: 170 })
    const [underlay] = stored()
    expect(underlay.readiness_status).toBe('blocked')
    expect(underlay.status).not.toBe('validated')
  })
})
