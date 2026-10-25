// reality-defects: F8-B1
// F8-B1: a ready billing underlay is stored through gridex_store_billing_underlay, which refuses it with
// billing_underlay_supply_contract_price_basis_required unless pricing_snapshot equals the contract price snapshot's
// snapshot_json exactly (proved for the SQL by scripts/ediel-billing-source-sql-regression.mjs). The engine sent the
// enriched pricing payload (snapshot id, model, component arrays added), so every ready underlay was refused and the
// whole company's monthly run failed in one batch. The engine must store the snapshot's own exact JSON.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const tables: Record<string, Row[]> = {}
const rpcCalls: Array<{ fn: string; args: Row }> = []

function builder(table: string) {
  const result = () => Promise.resolve({ data: tables[table] ?? [], error: null })
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'not', 'lt', 'lte', 'gt', 'gte', 'or', 'order', 'limit', 'is', 'neq'])
    chain[method] = () => chain
  chain.range = result
  chain.maybeSingle = () => Promise.resolve({ data: (tables[table] ?? [])[0] ?? null, error: null })
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => result().then(resolve, reject)
  return chain
}

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => builder(table),
    rpc: (fn: string, args: Row) => {
      rpcCalls.push({ fn, args })
      const commands = (args.p_commands as unknown[]) ?? []
      return Promise.resolve({ data: commands.map((_, i) => `underlay-${i}`), error: null })
    },
  },
}))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/billing/invoiceReadiness', () => ({ assertBillingPeriodOpen: async () => undefined, getBillingPeriodLock: async () => null }))
vi.mock('@/lib/billing/sourceBasis', () => ({
  loadQualifiedBillingValues: async (_c: string, ids: string[]) => new Map(ids.map(id => [id, (tables.normalized_metering_values ?? []).find(r => r.id === id)])),
}))
vi.mock('@/lib/billing/billingGate', () => ({ evaluateBillingGate: () => ({ eligible: true, reasons: [] }) }))
vi.mock('@/lib/billing/consumptionEstimate', () => ({
  companyEstimatesMissingConsumption: async () => false, estimateMissingConsumption: async () => null, missingWindows: () => [],
}))
vi.mock('@/lib/billing/historyRequest', () => ({ ensureHistoricalMeteringRequest: async () => 'requested' }))

const C = 'co-1', CU = 'cu-1', MP = 'mp-1', SP = 'sp-1', CT = 'ct-1', SNAP = 'snap-1', PV = 'pv-1'
// Shape of a production v7 signed-receipt snapshot (world, company 1b8b8c72…): snapshot_json carries none of the
// keys the engine's pricing payload adds.
const snapshotJson = { snapshot_schema: 'gridex_contract_pricing_v7_signed_receipt', pricing_model: 'spot', price_area: 'SE3', energy_direction: 'consumption', markup_ore_per_kwh: 4.9 }

beforeEach(() => {
  rpcCalls.length = 0
  tables.normalized_metering_values = [{
    id: 'nmv-1', company_id: C, customer_id: CU, metering_point_id: MP, supply_period_id: SP, site_id: 'site-1', customer_site_id: 'site-1',
    period_start: '2026-08-31T22:00:00.000Z', period_end: '2026-09-30T22:00:00.000Z', quantity_kwh: '612.5', unit: 'kWh', direction: 'consumption',
    revision_status: 'current', billing_status: 'billable', billing_gate_status: 'eligible', billing_gate_snapshot: { status: 'eligible' },
    price_area: 'SE3', metadata: {},
  }]
  tables.customer_supply_periods = [{
    id: SP, company_id: C, customer_id: CU, metering_point_id: MP, contract_id: CT, site_id: 'site-1', customer_site_id: 'site-1',
    status: 'active', start_date: '2026-09-01', end_date: null,
  }]
  tables.customer_contracts = [{ id: CT, company_id: C, customer_id: CU, metering_point_id: MP, status: 'active', starts_at: '2026-09-01', energy_direction: 'consumption', price_plan_id: 'pp-1' }]
  tables.contract_price_snapshots = [{
    id: SNAP, company_id: C, contract_id: CT, price_plan_version_id: PV, valid_from: '2026-09-01', valid_to: null, pricing_model: 'spot',
    snapshot_schema_version: 'gridex_contract_pricing_v7_signed_receipt', snapshot_json: snapshotJson,
    base_price_components_snapshot: [{ key: 'energy' }], price_components_snapshot: [{ key: 'markup' }],
  }]
  tables.billing_underlays = []
  tables.billing_underlay_items = []
})

describe('F8-B1 a ready underlay carries the contract price snapshot exactly as the store requires', () => {
  it('stores the ready September underlay with pricing_snapshot equal to snapshot_json', async () => {
    const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
    const result = await generateBillingUnderlaysForMonth({ companyId: C, billingMonth: '2026-09' })
    const store = rpcCalls.find(c => c.fn === 'gridex_store_billing_underlay_batch')
    const commands = (store?.args.p_commands ?? []) as Array<{ underlay: Row }>
    const ready = commands.filter(c => c.underlay.readiness_status === 'ready')
    expect(ready, JSON.stringify(result.results ?? result)).toHaveLength(1)
    expect(ready[0].underlay.pricing_snapshot).toEqual(snapshotJson)
    expect(ready[0].underlay.contract_price_snapshot_id).toBe(SNAP)
    expect(ready[0].underlay.price_plan_version_id).toBe(PV)
  })
})
