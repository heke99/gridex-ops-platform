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
let originalItems: Row[] | undefined
let expectedOldItem: Row
let persistedNeighbor: Row
let existingReconciliations: Row[]
let historicalEstimates: Row[]
let companyWide: boolean
let allowNewEstimates: boolean

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
  if (url.pathname.endsWith('/rpc/gridex_read_billing_source_values_compact_v1')) {
    expect(body.p_company_id).toBe(company)
    return Response.json(values.filter(row => body.p_value_ids.includes(row.id)))
  }
  if (url.pathname.endsWith('/rpc/gridex_store_billing_underlay_batch')) {
    expect(body).toMatchObject({ p_company_id: company, p_actor_user_id: actor })
    batches.push(body.p_commands)
    return Response.json(body.p_commands.map((_: unknown, index: number) => id(100 + index)))
  }
  expect(init?.method ?? 'GET').toBe('GET')
  const table = url.pathname.split('/').at(-1)
  if (table === 'companies') {
    expect(url.searchParams.get('id')).toBe(`eq.${company}`)
    expect(url.searchParams.get('select')).toBe('metadata')
    return Response.json([{ metadata: { billing: { estimate_missing_consumption: allowNewEstimates } } }])
  }
  expect(url.searchParams.get('company_id')).toBe(`eq.${company}`)
  let rows: Row[]
  if (table === 'customer_supply_periods') rows = []
  else if (table === 'billing_underlays') {
    if (url.searchParams.has('payload->>reconciliation_of')) {
      const originals = url.searchParams.get('payload->>reconciliation_of')?.slice(4, -1).split(',')
      rows = existingReconciliations.filter(row => originals?.includes((row.payload as Row).reconciliation_of as string))
    } else {
      expect(url.searchParams.get('customer_id')).toBe(companyWide ? null : `eq.${customer}`)
      expect(url.searchParams.get('metering_point_id')).toBe(companyWide ? null : `eq.${meter}`)
      expect(url.searchParams.get('source_system')).toBe('in.(consumption_estimate,normalized_metering_values+consumption_estimate)')
      rows = [...historicalEstimates, persistedOld, persistedNeighbor]
        .filter(row => row.source_system !== 'normalized_metering_values'
          && (companyWide || (row.customer_id === customer && row.metering_point_id === meter)))
    }
  } else if (table === 'billing_underlay_items') {
    expect(url.searchParams.get('billing_underlay_id')).toBe(`eq.${oldId}`)
    rows = originalItems ?? [persistedOldItem]
    if (url.searchParams.get('order') === 'source_normalized_metering_value_id.asc.nullsfirst') {
      rows = [...rows].sort((left, right) =>
        Number(left.source_normalized_metering_value_id !== null) - Number(right.source_normalized_metering_value_id !== null),
      )
    }
    rows = rows.slice(0, Number(url.searchParams.get('limit') ?? 1000))
  } else if (table === 'normalized_metering_values') {
    const after = Date.parse(url.searchParams.get('period_end')?.slice(3) ?? '')
    const before = Date.parse(url.searchParams.get('period_start')?.slice(3) ?? '')
    const pointFilter = url.searchParams.get('metering_point_id')?.slice(3)
    rows = values.filter(row => row.company_id === company && (!pointFilter || row.metering_point_id === pointFilter)
      && Date.parse(String(row.period_start)) < before && Date.parse(String(row.period_end)) > after)
  } else throw Error(`Unexpected fixture read ${url.pathname}`)
  if (table === 'billing_underlays') {
    const afterId = url.searchParams.get('id')?.slice(3)
    if (afterId) rows = rows.filter(row => String(row.id) > afterId)
    if (url.searchParams.get('order') === 'id.asc') {
      rows = [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id)))
    }
    rows = rows.slice(0, Number(url.searchParams.get('limit') ?? 1000))
  }
  return Response.json(rows)
}

beforeEach(() => {
  values = []
  existingReconciliations = []
  historicalEstimates = []
  companyWide = false
  allowNewEstimates = true
  batches.length = 0
  persistedOld = structuredClone(oldBasis)
  persistedOldItem = structuredClone(oldItem)
  originalItems = undefined
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
    ...scope, id: id(role === 'charge_final' ? 201 : 202),
    source_system: 'consumption_estimate_reconciliation', underlay_year: 2026, underlay_month: 12,
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

it('returns the locked original reviewed after more than 500 other estimates', async () => {
  historicalEstimates = Array.from({ length: 501 }, (_, index) => ({
    ...oldBasis,
    id: id(600 - index).replace('b6808000', 'a6808000'),
    underlay_month: 10,
  }))
  port.getLock.mockImplementation(async (input: Row) => ({ status: input.billingMonth === '2026-11' ? 'locked' : 'open' }))
  values = [value(1, start, end, '30')]

  expect(await run()).toMatchObject({ readyForPricing: 0, needsReview: 1, results: [
    expect.objectContaining({ warnings: [expect.stringContaining('reconciliation_credit_origin_unavailable')] }),
  ] })
  expect(batches).toEqual([])
  unchanged()
})

it('checks every page of stored legs before treating an original as a complete pair', async () => {
  const otherOriginal = { ...oldBasis, id: id(700), underlay_month: 10 }
  historicalEstimates = [otherOriginal]
  port.getLock.mockImplementation(async (input: Row) => ({ status: input.billingMonth === '2026-11' ? 'locked' : 'open' }))
  existingReconciliations = [
    storedLeg('charge_final'),
    storedLeg('credit_preliminary'),
    ...Array.from({ length: 998 }, (_, index) => ({
      ...storedLeg('charge_final'),
      id: id(2000 + index),
      payload: { ...storedLeg('charge_final').payload as Row, reconciliation_of: otherOriginal.id },
    })),
    { ...storedLeg('charge_final'), id: id(3000) },
  ]

  expect(await run()).toMatchObject({ readyForPricing: 0, needsReview: 1, results: [
    expect.objectContaining({ warnings: [expect.stringContaining('reconciliation_pair_incomplete')] }),
  ] })
  expect(batches).toEqual([])
  unchanged()
})

it('qualifies historical readings only for the original meter across the company batch', async () => {
  companyWide = true
  historicalEstimates = Array.from({ length: 501 }, (_, index) => ({
    ...oldBasis,
    id: id(1000 + index),
    metering_point_id: id(2000 + index),
  }))
  const target = value(1, start, end, '30')
  const unrelated = value(2, start, end, '31', { metering_point_id: id(3000) })
  values = [target, unrelated]

  expect(await generateBillingUnderlaysForMonth({
    companyId: company, billingMonth: '2026-12', createdBy: actor,
  })).toMatchObject({ readyForPricing: 0, needsReview: 1, results: [
    expect.objectContaining({ warnings: [expect.stringContaining('reconciliation_credit_origin_unavailable')] }),
  ] })
  expect(batches).toEqual([])
  unchanged()

  const calls = port.db.mock.calls.map(([input, init]) => ({ url: new URL(String(input)), init }))
  const sourceRequests = calls.filter(({ url }) => url.pathname.endsWith('/rpc/gridex_read_billing_source_values_compact_v1'))
  expect(sourceRequests).toHaveLength(1)
  expect(JSON.parse(String(sourceRequests[0].init?.body)).p_value_ids).toEqual([target.id])
  const reads = calls.filter(({ url }) => url.pathname.endsWith('/normalized_metering_values'))
  expect(reads[0].url.searchParams.has('metering_point_id')).toBe(false)
  expect(reads.slice(1).map(({ url }) => url.searchParams.get('metering_point_id'))).toEqual([
    `eq.${meter}`, ...historicalEstimates.map(row => `eq.${row.metering_point_id}`),
  ])
})

it.each([
  { label: 'an estimated item beyond the first 1000 rows', sourceRows: 1000, estimatedTail: true, missingSource: true },
  { label: 'no stored original items', sourceRows: 0, estimatedTail: false, missingSource: true },
  { label: 'only original items with source IDs', sourceRows: 1001, estimatedTail: false, missingSource: false },
])('selects the correct review cause with $label', async ({ sourceRows, estimatedTail, missingSource }) => {
  values = [value(1, start, end, '30')]
  originalItems = Array.from({ length: sourceRows }, (_, index) => ({
    ...oldItem, id: id(4000 + index), source_normalized_metering_value_id: id(6000 + index),
  }))
  if (estimatedTail) originalItems.push({ ...oldItem })

  const reason = missingSource ? 'reconciliation_credit_origin_unavailable' : 'reconciliation_credit_issued_basis_required'
  expect(await run()).toMatchObject({ readyForPricing: 0, needsReview: 1, results: [
    expect.objectContaining({ warnings: [expect.stringContaining(reason)] }),
  ] })
  expect(batches).toEqual([])
  unchanged()
})


it.each([
  { allow: true, sourceId: null, reason: 'reconciliation_credit_origin_unavailable' },
  { allow: false, sourceId: null, reason: 'reconciliation_credit_origin_unavailable' },
  { allow: false, sourceId: id(22), reason: 'reconciliation_credit_issued_basis_required' },
])('reviews final 5 kWh for a locked 4 kWh original with new estimates $allow and source $sourceId', async ({
  allow, sourceId, reason,
}) => {
  allowNewEstimates = allow
  persistedOld.total_kwh = '4'
  persistedOldItem.quantity = '4'
  persistedOldItem.quantity_kwh = '4'
  persistedOldItem.source_normalized_metering_value_id = sourceId
  const frozenOriginal = structuredClone(persistedOld)
  const frozenItem = structuredClone(persistedOldItem)
  values = [value(1, start, end, '5')]
  expect(await run()).toMatchObject({
    readyForPricing: 0,
    needsReview: 1,
    results: [expect.objectContaining({
      status: 'needs_review',
      sourceRows: 1,
      warnings: [expect.stringContaining(reason)],
    })],
  })
  expect(port.getLock).toHaveBeenCalledExactlyOnceWith({ companyId: company, billingMonth: '2026-11' })
  expect(persistedOld).toEqual(frozenOriginal)
  expect(persistedOldItem).toEqual(frozenItem)
  expect(port.history).not.toHaveBeenCalled()
  expect(batches).toEqual([])
})
