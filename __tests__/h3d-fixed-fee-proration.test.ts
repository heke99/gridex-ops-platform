// reality-defects: H3d (B4 + owner decision 20: the fixed retail monthly fee is prorated per supplied calendar day and
// stops at the actual supply end; a break fee never enters the regular monthly run)
// Owner decisions 2026-10-23 (OWNER-DECISIONS.md rows 19 and 20): in a month in which supply starts or ends, the fixed
// monthly fee (månadsavgift / fast avgift) is charged for the supplied calendar days only:
//   quantity = supplied calendar days of the segment / days of its calendar month.
// The supplied days are the whole Stockholm dates of the billed segment the billing engine computes from the supply
// period (lib/billing/underlayEngine.ts -> supplyPeriodBillingSegment, built on lib/billing/supplyPeriodEnd.ts), as the
// underlay store records them (billing_period_start .. billing_period_end, the first date no longer supplied). A DST day
// is one day. Before the fix the fee was always charged in full (D10: the factor compared the segment with itself).
// A break fee (component 'break_fee', event 'early_termination') and other event-only charges never enter the monthly run.
// Synthetic ids only. Calls the code (underlay engine + pricing engine); nothing reads source text.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PriceComponent } from '@/lib/pricing/types'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  components: [] as unknown[],
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
// A fixed energy price; the price components under test come from io.components.
vi.mock('@/lib/pricing/priceSourceResolver', () => ({
  resolvePricingConfiguration: async () => ({ baseComponents: [{ sourceType: 'fixed', weightPercent: 100, fixedPriceSekPerKwh: 1 }], priceComponents: io.components, vatRate: 0.25, warnings: [] }),
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
import { calculatePriceComponents, isOutsideRegularMonthlyBilling, suppliedCalendarDays } from '@/lib/pricing/priceComponentCalculator'
import { stockholmDateForInstant } from '@/lib/time/stockholm'

const COMPANY = 'co-h3d'
const MONTHLY_FEE = 62
const monthlyFee: PriceComponent = { componentType: 'fixed_monthly_fee', name: 'Månadsavgift', calculationType: 'fixed_monthly', amount: MONTHLY_FEE, unit: 'sek_month', vatApplicable: true }
// The break fee as the price source resolver builds it from customer_contracts.break_fee_sek (metadata lifecycle only).
const breakFee: PriceComponent = { componentType: 'break_fee', name: 'Brytavgift', calculationType: 'fixed_once', amount: 500, unit: 'sek_event', vatApplicable: true,
  periodizationMode: 'none', priority: 415, metadata: { lifecycle: 'event_only', event: 'early_termination', component_key: 'break_fee' } }

const contract = (extra: Row = {}): Row => ({ id: 'ct-1', company_id: COMPANY, customer_id: 'cu-1', metering_point_id: 'mp-1', status: 'active', starts_at: '2026-01-01',
  ends_at: null, contract_type: 'fixed', energy_direction: 'consumption', ...extra })
const snapshot: Row = { id: 'snap-1', company_id: COMPANY, contract_id: 'ct-1', valid_from: '2026-01-01', valid_to: null, snapshot_json: { price_area: 'SE3', energy_direction: 'consumption' } }
const period = (extra: Row): Row => ({ id: 'sp-1', company_id: COMPANY, customer_id: 'cu-1', metering_point_id: 'mp-1', contract_id: 'ct-1', status: 'active',
  start_date: '2026-01-01', end_date: null, actual_end_date: null, market_start_at: null, market_end_at: null, metadata: {}, ...extra })
// One qualified value covering exactly the billed segment.
const value = (start: string, end: string): Row => ({ id: 'nv-1', company_id: COMPANY, customer_id: 'cu-1', metering_point_id: 'mp-1', supply_period_id: 'sp-1',
  source_metering_value_id: 'mv-1', source_message_id: 'msg-1', revision_status: 'current', billing_status: 'billable', billing_gate_status: 'eligible', quantity_kwh: '100',
  unit: 'kWh', quality_status: 'measured', direction: 'consumption', product_code: null, period_start: start, period_end: end, billing_gate_snapshot: { status: 'eligible' },
  billing_source_message: { id: 'msg-1', company_id: COMPANY, message_family: 'UTILTS', status: 'validated' },
  billing_source_basis: { version: 1, qualified: true, normalizedValueId: 'nv-1', sourceMessageId: 'msg-1', quantityType: '136', quantityKwh: '100', productCode: null, qualityEstablished: true, quality: null } })

/** Generates the month's underlay through the real engine and stores it as gridex_store_billing_underlay does. */
async function underlayFor(input: { month: string; supply: Row; contract?: Row; segment: [string, string]; payload?: Row }) {
  io.tables = { normalized_metering_values: [value(...input.segment)], customer_supply_periods: [input.supply], customer_contracts: [input.contract ?? contract()], contract_price_snapshots: [snapshot] }
  io.rpcCalls = []
  const result = await generateBillingUnderlaysForMonth({ companyId: COMPANY, billingMonth: input.month, createdBy: 'automation' })
  expect(result.results.map(entry => entry.status), JSON.stringify(result.results)).toEqual(['ready_for_pricing'])
  const commands = io.rpcCalls.filter(call => call.name === 'gridex_store_billing_underlay_batch')
    .flatMap(call => (call.args.p_commands as Array<{ underlay: Row }>).map(command => command.underlay))
  expect(commands).toHaveLength(1)
  const command = commands[0]
  expect([command.billing_period_start, command.billing_period_end].map(v => new Date(String(v)).toISOString())).toEqual(input.segment.map(v => new Date(v).toISOString()))
  // gridex_store_billing_underlay: the civil dates are the Stockholm dates of the segment instants.
  io.tables.billing_underlays = [{ ...command, id: 'bu-1', company_id: COMPANY,
    billing_period_start: stockholmDateForInstant(String(command.billing_period_start)), billing_period_end: stockholmDateForInstant(String(command.billing_period_end)),
    payload: { ...(command.payload as Row), ...(input.payload ?? {}), billing_period_start_instant: command.billing_period_start, billing_period_end_instant: command.billing_period_end,
      billing_period_timezone: 'Europe/Stockholm', billing_period_end_exclusive: true } }]
  io.rpcCalls = []
  return io.tables.billing_underlays[0]
}

async function monthlyLine(input: Parameters<typeof underlayFor>[0]) {
  const underlay = await underlayFor(input)
  const preview = await calculatePricingPreviewForUnderlay({ companyId: COMPANY, billingUnderlayId: 'bu-1', persist: false })
  expect(preview.errors).toEqual([])
  const lines = preview.lines.filter(line => line.lineType === 'fixed_monthly_fee')
  expect(lines).toHaveLength(1)
  return { line: lines[0], preview, underlay }
}

beforeEach(() => { io.tables = {}; io.rpcCalls = []; io.components = [monthlyFee] })

describe('H3d B4 the fixed monthly fee is prorated per supplied calendar day (segment from the supply window)', () => {
  it('Ediel start, manual move-out on 15 September (last supplied day): 15 of 30 days', async () => {
    const { line, underlay } = await monthlyLine({ month: '2026-09',
      supply: period({ status: 'ended', start_date: '2026-08-01', end_date: '2026-09-15', actual_end_date: '2026-09-15', market_start_at: '2026-07-31T23:00:00Z', metadata: { end_reason: 'move_out' } }),
      contract: contract({ status: 'terminated', termination_reason: 'move_out', ended_at: '2026-09-15T00:00:00+00:00', ends_at: '2026-09-15' }),
      // Ediel month from 00:00 +0100 on 1 September; civil midnight after the move-out day (CEST).
      segment: ['2026-08-31T23:00:00Z', '2026-09-15T22:00:00Z'] })
    expect(underlay).toMatchObject({ billing_period_start: '2026-09-01', billing_period_end: '2026-09-16' })
    expect(line.quantity).toBeCloseTo(15 / 30, 12)
    expect(line.amountExVat).toBe(31)
    expect(line.metadata).toMatchObject({ fixed_fee_proration: { rule: 'supplied_calendar_days_of_month', supplied_days: 15, month_days: 30, billing_month: '2026-09' } })
  })

  it('a manual supply starting on 15 October: 17 of 31 days', async () => {
    const { line } = await monthlyLine({ month: '2026-10', supply: period({ start_date: '2026-10-15' }), contract: contract({ starts_at: '2026-10-15' }),
      segment: ['2026-10-14T22:00:00Z', '2026-10-31T23:00:00Z'] })
    expect(line.quantity).toBeCloseTo(17 / 31, 12)
    expect(line.amountExVat).toBe(34)
  })

  it('start and end in the same month (10 to 20 November): 11 of 30 days', async () => {
    const { line } = await monthlyLine({ month: '2026-11',
      supply: period({ status: 'ended', start_date: '2026-11-10', end_date: '2026-11-20', actual_end_date: '2026-11-20', metadata: { end_reason: 'move_out' } }),
      contract: contract({ status: 'terminated', termination_reason: 'move_out', ended_at: '2026-11-20T00:00:00+00:00', starts_at: '2026-11-10' }),
      segment: ['2026-11-09T23:00:00Z', '2026-11-20T23:00:00Z'] })
    expect(line.quantity).toBeCloseTo(11 / 30, 12)
    expect(line.amountExVat).toBe(22.73)
  })

  it('a Z05 end at 16 October 00:00 +0100 (exclusive; 15 October is the last supplied day): 15 of 31 days', async () => {
    const { line, underlay } = await monthlyLine({ month: '2026-10',
      supply: period({ status: 'ended', start_date: '2026-08-01', end_date: '2026-10-16', actual_end_date: '2026-10-16', market_start_at: '2026-07-31T23:00:00Z', market_end_at: '2026-10-15T23:00:00Z' }),
      contract: contract({ status: 'terminated', termination_reason: 'supply_end', ended_at: '2026-10-16T00:00:00+00:00', ends_at: '2026-10-16' }),
      segment: ['2026-09-30T23:00:00Z', '2026-10-15T23:00:00Z'] })
    expect(underlay).toMatchObject({ billing_period_start: '2026-10-01', billing_period_end: '2026-10-16' })
    expect(line.quantity).toBeCloseTo(15 / 31, 12)
    expect(line.amountExVat).toBe(30)
  })

  it('a 28-day February, move-out on 14 February: 14 of 28 days', async () => {
    const { line } = await monthlyLine({ month: '2027-02',
      supply: period({ status: 'ended', start_date: '2026-12-01', end_date: '2027-02-14', actual_end_date: '2027-02-14', metadata: { end_reason: 'move_out' } }),
      contract: contract({ status: 'terminated', termination_reason: 'move_out', ended_at: '2027-02-14T00:00:00+00:00' }),
      segment: ['2027-01-31T23:00:00Z', '2027-02-14T23:00:00Z'] })
    expect(line.quantity).toBeCloseTo(0.5, 12)
    expect(line.amountExVat).toBe(31)
  })

  it('DST months count dates, not hours: move-out on 25 October (25 h) is 25 of 31, on 28 March (23 h) 28 of 31', async () => {
    const autumn = await monthlyLine({ month: '2026-10',
      supply: period({ status: 'ended', start_date: '2026-08-01', end_date: '2026-10-25', actual_end_date: '2026-10-25', metadata: { end_reason: 'move_out' } }),
      contract: contract({ status: 'terminated', termination_reason: 'move_out', ended_at: '2026-10-25T00:00:00+00:00' }),
      segment: ['2026-09-30T22:00:00Z', '2026-10-25T23:00:00Z'] })
    expect(autumn.line.quantity).toBeCloseTo(25 / 31, 12)
    expect(autumn.line.amountExVat).toBe(50)
    const spring = await monthlyLine({ month: '2027-03',
      supply: period({ status: 'ended', start_date: '2027-01-01', end_date: '2027-03-28', actual_end_date: '2027-03-28', metadata: { end_reason: 'move_out' } }),
      contract: contract({ status: 'terminated', termination_reason: 'move_out', ended_at: '2027-03-28T00:00:00+00:00' }),
      segment: ['2027-02-28T23:00:00Z', '2027-03-28T22:00:00Z'] })
    expect(spring.line.quantity).toBeCloseTo(28 / 31, 12)
    expect(spring.line.amountExVat).toBe(56)
  })

  it('a fully supplied month (31-day October in the Ediel frame) keeps the whole fee and no proration marker', async () => {
    const { line } = await monthlyLine({ month: '2026-10', supply: period({ start_date: '2026-08-01', market_start_at: '2026-07-31T23:00:00Z' }),
      segment: ['2026-09-30T23:00:00Z', '2026-10-31T23:00:00Z'] })
    expect(line.quantity).toBe(1)
    expect(line.amountExVat).toBe(MONTHLY_FEE)
    expect(line.metadata).not.toHaveProperty('fixed_fee_proration')
  })

  it('nothing is charged for a notice period after the supply end: the month after a move-out has no underlay', async () => {
    io.tables = { normalized_metering_values: [], customer_contracts: [contract({ status: 'terminated', termination_reason: 'move_out', ended_at: '2026-09-15T00:00:00+00:00' })],
      customer_supply_periods: [period({ status: 'ended', start_date: '2026-08-01', end_date: '2026-09-15', actual_end_date: '2026-09-15', metadata: { end_reason: 'move_out' } })],
      contract_price_snapshots: [snapshot] }
    const result = await generateBillingUnderlaysForMonth({ companyId: COMPANY, billingMonth: '2026-10', createdBy: 'automation' })
    expect(result.results).toEqual([])
    expect(io.rpcCalls.filter(call => call.name === 'gridex_store_billing_underlay_batch')).toEqual([])
  })
})

describe('H3d the supplied-days rule itself', () => {
  it('counts whole dates of the calendar month and is null without a billing month', () => {
    expect(suppliedCalendarDays({ periodStart: '2026-09-01', periodEnd: '2026-09-16', billingMonth: '2026-09' })).toEqual({ suppliedDays: 15, monthDays: 30 })
    expect(suppliedCalendarDays({ periodStart: '2028-02-01', periodEnd: '2028-03-01', billingMonth: '2028-02' })).toEqual({ suppliedDays: 29, monthDays: 29 })
    expect(suppliedCalendarDays({ periodStart: '2026-10-01', periodEnd: '2026-11-01', billingMonth: '2026-10' })).toEqual({ suppliedDays: 31, monthDays: 31 })
    // Dates outside the calendar month never count.
    expect(suppliedCalendarDays({ periodStart: '2026-09-25', periodEnd: '2026-10-05', billingMonth: '2026-10' })).toEqual({ suppliedDays: 4, monthDays: 31 })
    expect(suppliedCalendarDays({ periodStart: '2026-09-01', periodEnd: '2026-10-01' })).toBeNull()
  })

  it('a per-site monthly fee is prorated the same way per site', () => {
    const { lines } = calculatePriceComponents({
      underlay: { companyId: COMPANY, customerId: 'cu-1', meteringPointId: 'mp-1', priceArea: 'SE3', quantityKwh: 100, periodStart: '2026-09-01', periodEnd: '2026-09-16', billingMonth: '2026-09', siteCount: 2 },
      components: [{ ...monthlyFee, unit: 'sek_site_month' }], baseAmountExVat: 0, vatRate: 0.25,
    })
    expect(lines[0].quantity).toBeCloseTo(1, 12)
    expect(lines[0].amountExVat).toBe(62)
  })
})

describe('H3d owner decision 20: a break fee never enters the regular monthly run', () => {
  it('a break fee component is not billed even when the underlay carries early_termination', async () => {
    io.components = [monthlyFee, breakFee]
    await underlayFor({ month: '2026-09',
      supply: period({ status: 'ended', start_date: '2026-08-01', end_date: '2026-09-15', actual_end_date: '2026-09-15', market_start_at: '2026-07-31T23:00:00Z', metadata: { end_reason: 'move_out' } }),
      contract: contract({ status: 'terminated', termination_reason: 'move_out', ended_at: '2026-09-15T00:00:00+00:00', break_fee_sek: 500 }),
      segment: ['2026-08-31T23:00:00Z', '2026-09-15T22:00:00Z'], payload: { contract_event: 'early_termination' } })
    const preview = await calculatePricingPreviewForUnderlay({ companyId: COMPANY, billingUnderlayId: 'bu-1', persist: false })
    expect(preview.errors).toEqual([])
    expect(preview.lines.map(line => line.lineType)).not.toContain('break_fee')
    expect(preview.lines.filter(line => line.lineType === 'fixed_monthly_fee').map(line => line.amountExVat)).toEqual([31])
  })

  it('classifies break-fee and event-only components as outside the monthly run, and regular fees as inside', () => {
    expect(isOutsideRegularMonthlyBilling(breakFee)).toBe(true)
    expect(isOutsideRegularMonthlyBilling({ ...breakFee, componentType: 'custom_addon', metadata: { event: 'early_termination' } })).toBe(true)
    expect(isOutsideRegularMonthlyBilling({ ...breakFee, componentType: 'custom_addon', metadata: {}, lifecycle: 'event_only', unit: 'sek_once' })).toBe(true)
    expect(isOutsideRegularMonthlyBilling(monthlyFee)).toBe(false)
    expect(isOutsideRegularMonthlyBilling({ componentType: 'invoice_fee', name: 'Fakturaavgift', calculationType: 'fixed_once', amount: 29, unit: 'sek_invoice' })).toBe(false)
  })
})
