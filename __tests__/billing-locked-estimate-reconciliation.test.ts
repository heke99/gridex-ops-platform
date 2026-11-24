import { beforeEach, expect, it, vi } from 'vitest'
import { generateBillingUnderlaysForMonth } from '@/lib/billing/underlayEngine'
import { buildConsumptionCorrectionLines } from '@/lib/pricing/consumptionCorrectionSettlement'
import type { PricingPreviewLine } from '@/lib/pricing/types'

type Row = Record<string, unknown>
type Command = { underlay: Row; items: Row[] }
const port = vi.hoisted(() => ({ db: vi.fn<typeof fetch>(), getLock: vi.fn(), history: vi.fn() }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://hel08.example.invalid', 'synthetic-fixture', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: port.db },
  }) }
})
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/billing/invoiceReadiness', () => ({
  assertBillingPeriodOpen: async (input: Row) => expect(input.billingMonth).toBe('2026-12'),
  getBillingPeriodLock: port.getLock,
}))
vi.mock('@/lib/billing/consumptionEstimate', () => ({ companyEstimatesMissingConsumption: async () => true }))
vi.mock('@/lib/billing/historyRequest', () => ({ ensureHistoricalMeteringRequest: port.history }))

const id = (n: number) => `b6808000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [company, actor, customer, meter, supply, contract, site, oldId, oldItemId, neighborId] = Array.from({ length: 10 }, (_, i) => id(i + 1))
const start = '2026-10-31T23:00:00.000Z', end = '2026-10-31T23:15:00.000Z'
const scope = { company_id: company, customer_id: customer, metering_point_id: meter, supply_period_id: supply, contract_id: contract, customer_site_id: site }
const oldBasis = { ...scope, id: oldId, underlay_year: 2026, underlay_month: 11, total_kwh: '20', energy_direction: 'consumption',
  source_system: 'consumption_estimate', payload: { billing_period_start_instant: start, billing_period_end_instant: end }, price_area: 'SE3',
  pricing_snapshot_id: id(11), contract_price_snapshot_id: id(11), price_plan_version_id: id(12), pricing_snapshot: { price_area: 'SE3' } }
const oldItem = { ...scope, id: oldItemId, billing_underlay_id: oldId, source_normalized_metering_value_id: null,
  period_start: start, period_end: end, quantity: '20', quantity_kwh: '20', unit: 'kWh', source_table: 'consumption_estimate',
  metadata: { estimate_basis: 'synthetic.locked-origin' } }
const neighbor = { ...oldBasis, id: neighborId, source_system: 'normalized_metering_values', total_kwh: '80' }
const batches: Command[][] = []
let values: Row[]
let persistedOld: Row
let persistedOldItem: Row
let expectedOldItem: Row
let persistedNeighbor: Row
let existingReconciliations: Row[]

function value(n: number, period_start: string, period_end: string, quantity_kwh: string, override: Row = {}): Row {
  const rowId = id(n + 30), source = id(n + 60)
  return { ...scope, id: rowId, source_message_id: source, period_start, period_end, quantity_kwh, unit: 'kWh', direction: 'consumption',
    revision_status: 'current', billing_status: 'billable', billing_gate_status: 'eligible', product_code: '8716867000030', register_code: 'active-energy',
    billing_source_basis: { version: 1, normalizedValueId: rowId, sourceMessageId: source, quantityKwh: quantity_kwh,
      qualified: true, quantityType: '136', quality: null, qualityEstablished: true, productCode: '8716867000030', registerCode: 'active-energy' },
    ...override,
  }
}

async function db(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input))
  expect(url.origin).toBe('https://hel08.example.invalid')
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
  if (url.pathname.endsWith('/rpc/gridex_read_billing_source_values_v1')) {
    expect(body.p_company_id).toBe(company)
    return Response.json(values.filter(row => body.p_value_ids.includes(row.id)))
  }
  if (url.pathname.endsWith('/rpc/gridex_store_billing_underlay_batch')) {
    expect(body).toMatchObject({ p_company_id: company, p_actor_user_id: actor })
    batches.push(body.p_commands)
    return Response.json(body.p_commands.map((_: unknown, index: number) => id(100 + index)))
  }
  expect(init?.method ?? 'GET').toBe('GET')
  expect(url.searchParams.get('company_id')).toBe(`eq.${company}`)
  let rows: Row[]
  const table = url.pathname.split('/').at(-1)
  if (table === 'customer_supply_periods') rows = []
  else if (table === 'billing_underlays') {
    if (url.searchParams.has('payload->>reconciliation_of')) {
      rows = existingReconciliations
    } else {
      expect(url.searchParams.get('customer_id')).toBe(`eq.${customer}`)
      expect(url.searchParams.get('metering_point_id')).toBe(`eq.${meter}`)
      expect(url.searchParams.get('source_system')).toBe('in.(consumption_estimate,normalized_metering_values+consumption_estimate)')
      rows = [persistedOld, persistedNeighbor].filter(row => row.source_system !== 'normalized_metering_values')
    }
  } else if (table === 'billing_underlay_items') {
    expect(url.searchParams.get('billing_underlay_id')).toBe(`eq.${oldId}`)
    rows = [persistedOldItem]
  } else if (table === 'normalized_metering_values') {
    const after = Date.parse(url.searchParams.get('period_end')?.slice(3) ?? '')
    const before = Date.parse(url.searchParams.get('period_start')?.slice(3) ?? '')
    rows = values.filter(row => row.company_id === company && Date.parse(String(row.period_start)) < before && Date.parse(String(row.period_end)) > after)
  } else throw Error(`Unexpected fixture read ${url.pathname}`)
  return Response.json(rows)
}

beforeEach(() => {
  values = []
  existingReconciliations = []
  batches.length = 0
  persistedOld = structuredClone(oldBasis)
  persistedOldItem = structuredClone(oldItem)
  expectedOldItem = structuredClone(oldItem)
  persistedNeighbor = structuredClone(neighbor)
  port.db.mockReset().mockImplementation(db)
  port.getLock.mockReset().mockResolvedValue({ status: 'locked' })
  port.history.mockReset()
})

function run() {
  return generateBillingUnderlaysForMonth({ companyId: company, billingMonth: '2026-12', createdBy: actor, customerId: customer, meteringPointId: meter })
}

function unchanged() {
  expect(persistedOld).toStrictEqual(oldBasis)
  expect(persistedOldItem).toStrictEqual(expectedOldItem)
  expect(persistedNeighbor).toStrictEqual(neighbor)
  expect(port.history).not.toHaveBeenCalled()
}

it.each([
  { name: 'covers both ends', from: '2026-10-31T22:45:00.000Z', to: '2026-10-31T23:30:00.000Z' },
  { name: 'covers both ends unequally', from: '2026-10-31T22:55:00.000Z', to: '2026-10-31T23:40:00.000Z' },
  { name: 'extends past only the end', from: start, to: '2026-10-31T23:20:00.000Z' },
  { name: 'starts before only the beginning', from: '2026-10-31T22:50:00.000Z', to: end },
])('returns review without a debit or credit when one reading $name', async ({ from, to }) => {
  values = [value(1, from, to, '90')]
  const result = await run()
  expect(batches).toEqual([])
  expect(result).toMatchObject({ readyForPricing: 0, needsReview: 1,
    results: [expect.objectContaining({ status: 'needs_review', warnings: [expect.stringContaining('source_interval_requires_finer_data')] })] })
  unchanged()
})

it.each([
  { name: 'higher actual quantity', a: '4', b: '26' },
  { name: 'lower actual quantity', a: '3', b: '9' },
  { name: 'same actual quantity', a: '4', b: '16' },
])('holds both legs for $name pending verified issued-invoice authority', async ({ a, b }) => {
  persistedOldItem.source_normalized_metering_value_id = id(22)
  expectedOldItem = structuredClone(persistedOldItem)
  const middle = '2026-10-31T23:05:00.000Z'
  values = [value(1, start, middle, a), value(2, middle, end, b)]
  expect(await run()).toMatchObject({ readyForPricing: 0, needsReview: 1,
    results: [expect.objectContaining({ sourceRows: 2,
      warnings: [expect.stringContaining('reconciliation_credit_issued_basis_required')] })] })
  expect(port.getLock).toHaveBeenCalledWith({ companyId: company, billingMonth: '2026-11' })
  expect(batches).toEqual([])
  unchanged()
})

it('preserves the sign of a separately authorized consumption correction', () => {
  const [sign] = buildConsumptionCorrectionLines([{ quantity: 20, amountExVat: 20, amountIncVat: 25, vatAmount: 5, unitPriceExVat: 1,
    description: 'Synthetic already-priced line' } as PricingPreviewLine])
  expect(sign).toMatchObject({ quantity: 20, amountExVat: -20, vatAmount: -5, amountIncVat: -25 })
})

it('declines same-meter values belonging to a different customer and supply', async () => {
  values = [value(1, start, end, '30', { customer_id: id(96), supply_period_id: id(97) })]
  expect(await run()).toMatchObject({ readyForPricing: 0, needsReview: 1 })
  expect(batches).toEqual([])
  unchanged()
})

it('holds overlapping complete coverage and never uses a signed negative observation as final positive energy', async () => {
  values = [value(1, start, '2026-10-31T23:10:00.000Z', '14'), value(2, '2026-10-31T23:05:00.000Z', end, '16')]
  expect(await run()).toMatchObject({ readyForPricing: 0, needsReview: 1 })
  expect(batches).toEqual([])
  values = [value(1, start, end, '-30')]
  expect(await run()).toMatchObject({ readyForPricing: 0 })
  expect(batches).toEqual([])
  unchanged()
})


it('holds a qualified but incomplete series without inventing missing quantity', async () => {
  values = [value(1, start, '2026-10-31T23:05:00.000Z', '4')]
  expect(await run()).toMatchObject({ readyForPricing: 0, needsReview: 1,
    results: [expect.objectContaining({ warnings: [expect.stringContaining('Mätvärdeslucka')] })] })
  expect(batches).toEqual([])
  unchanged()
})

it('requires the authoritative quality even when the cached row is marked billable', async () => {
  const otherwiseExact = value(1, start, end, '30')
  const basis = otherwiseExact.billing_source_basis as Row
  values = [{ ...otherwiseExact, billing_source_basis: { ...basis, qualityEstablished: false } }]
  expect(await run()).toMatchObject({ readyForPricing: 0, needsReview: 1,
    results: [expect.objectContaining({ warnings: [expect.stringContaining('reconciliation_quality_not_final')] })] })
  expect(batches).toEqual([])
  unchanged()
})

it('holds complete replacement values when the locked original cannot authorize a credit', async () => {
  values = [value(1, start, end, '30')]
  const result = await run()
  expect(result).toMatchObject({ readyForPricing: 0, needsReview: 1, results: [
    expect.objectContaining({ warnings: [expect.stringContaining('reconciliation_credit_origin_unavailable')] }),
  ] })
  expect(batches).toEqual([])
  unchanged()
})

it('keeps qualified decimal slices under review when credit provenance is absent', async () => {
  persistedOldItem.source_normalized_metering_value_id = id(22)
  expectedOldItem = structuredClone(persistedOldItem)
  const middle = '2026-10-31T23:05:00.000Z'
  values = [value(1, start, middle, '0.1'), value(2, middle, end, '0.2')]
  expect(await run()).toMatchObject({ readyForPricing: 0, needsReview: 1,
    results: [expect.objectContaining({ sourceRows: 2,
      warnings: [expect.stringContaining('reconciliation_credit_issued_basis_required')] })] })
  expect(batches).toEqual([])
  unchanged()
})

function storedLeg(role: 'credit_preliminary' | 'charge_final'): Row {
  return {
    ...scope, source_system: 'consumption_estimate_reconciliation', underlay_year: 2026, underlay_month: 12,
    energy_direction: role === 'charge_final' ? 'consumption' : 'consumption_correction',
    settlement_type: role === 'charge_final' ? 'invoice' : 'credit_invoice',
    payload: { reconciliation_of: oldId, reconciliation_role: role, billing_period_start_instant: start, billing_period_end_instant: end },
  }
}

it('reports a previously stored final row without the matching credit', async () => {
  existingReconciliations = [storedLeg('charge_final')]
  expect(await run()).toMatchObject({ readyForPricing: 0, needsReview: 1,
    results: [expect.objectContaining({ warnings: [expect.stringContaining('reconciliation_pair_incomplete')] })] })
  expect(batches).toEqual([])
  unchanged()
})

it('does not reopen a previously stored complete pair', async () => {
  existingReconciliations = [storedLeg('charge_final'), storedLeg('credit_preliminary')]
  expect(await run()).toMatchObject({ readyForPricing: 0, needsReview: 0 })
  expect(batches).toEqual([])
  unchanged()
})
