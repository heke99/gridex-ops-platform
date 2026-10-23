// reality-defects: F108 (billing month = Ediel month for Ediel-qualified supply; M5, M6, M7; owner decision 2026-10-23)
// Owner decision 2026-10-23: a supply that rests on received Ediel market messages (market_start_at/market_end_at) is
// billed per Ediel month, 00:00 fixed Swedish normal time (UTC+1, ENV-08) on the 1st to 00:00 +0100 on the next 1st:
// September 2026 = [2026-08-31T23:00Z, 2026-09-30T23:00Z). A manual/legacy period without an Ediel instant is billed per
// Swedish civil month. The invoice prints the exact covered period and is labelled by its month.
// Before the fix every billing path used the civil month (22:00Z in summer):
//   * the September underlay of an Ediel supply ended at 22:00Z on 30 September;
//   * M5: after a summer-time Z05 end on 1 October (market_end_at 23:00Z) the hour 22:00Z-23:00Z was refused by the
//     gate and the matcher and never billed;
//   * M6: a monthly E66 value in +0100 was a partial interval of the civil month (source_interval_requires_finer_data);
//   * completeness clipped the supplied window to the civil month, so a missing last hour was not seen.
// Synthetic ids only. Calls the code; nothing reads source text.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  inserts: [] as Array<{ table: string; row: Row }>,
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
// The tenant's metering autopilot side effects (grid-owner requests, tasks) are recorded, never sent.
vi.mock('@/lib/cis/db', () => ({ createGridOwnerDataRequest: async () => { io.inserts.push({ table: 'grid_owner_data_requests', row: {} }); return { id: 'req-1' } } }))
vi.mock('@/lib/cis/edielAutomation', () => ({ ensureAndPrepareUtiltsFromDataRequest: async () => ({}) }))
vi.mock('@/lib/customers/dataTasks', () => ({ createCustomerDataTask: async (row: Row) => { io.inserts.push({ table: 'customer_data_tasks', row }) } }))
vi.mock('@/lib/metering/contractMeteringResolution', async original => ({
  ...await original<Record<string, unknown>>(),
  loadMeteringResolutionRequirements: async () => new Map(),
}))
// A PostgREST stand-in that applies equality filters (eq/in/is) and ignores range filters: the code under test
// does its own instant filtering, which is what these tests prove.
vi.mock('@/lib/supabase/service', () => {
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = []
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'lt', 'gt', 'lte', 'gte', 'or', 'not', 'order', 'neq', 'contains', 'limit', 'update', 'filter', 'match']) builder[method] = () => builder
    builder.eq = (column: string, value: unknown) => { filters.push(row => row[column] === value); return builder }
    builder.in = (column: string, values: unknown[]) => { filters.push(row => values.includes(row[column])); return builder }
    builder.is = (column: string, value: unknown) => { filters.push(row => (row[column] ?? null) === value); return builder }
    let from_ = 0, ranged = false
    builder.range = (a: number) => { ranged = true; from_ = a; return builder }
    const rows = () => {
      const all = (io.tables[table] ?? []).filter(row => filters.every(test => test(row)))
      return ranged ? all.slice(from_, from_ + 1000) : all
    }
    builder.insert = async (row: Row) => { io.inserts.push({ table, row }); return { error: null } }
    builder.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null })
    builder.single = builder.maybeSingle
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject)
    return builder
  }
  const rpc = async (name: string, args: Record<string, unknown>) => {
    io.rpcCalls.push({ name, args })
    if (name === 'gridex_set_metering_billing_gate') return { data: null, error: null }
    if (name === 'gridex_store_billing_underlay_batch') return { data: (args.p_commands as unknown[]).map((_, index) => `stored-${index}`), error: null }
    return { data: null, error: { code: '42883', message: `unexpected rpc ${name}` } }
  }
  return { supabaseService: { from, rpc } }
})

import { evaluateBillingGate } from '@/lib/billing/billingGate'
import { updateMeterValueBillingReadiness } from '@/lib/billing/meterValueBillingMatcher'
import { generateBillingUnderlaysForMonth } from '@/lib/billing/underlayEngine'
import { evaluateMeteringCompletenessForMonth } from '@/lib/metering/validation'
import { runMeteringMarketDataAutopilot } from '@/lib/metering/monthlyAutopilot'
import { supplyPeriodEndInstant } from '@/lib/billing/supplyPeriodEnd'
import { billingMonthLoadWindow, businessDateEndInstant, edielMonthBounds, invoiceBillingPeriod, supplyPeriodBillingSegment } from '@/lib/billing/billingMonth'
import { civilDeliveryDaysOutsideMonth } from '@/lib/pricing/engine'
import { buildInvoiceFileRow, renderInvoiceFile } from '@/lib/billing/invoiceFileExport'
import { renderNordfinInvoiceXml } from '@/lib/billing/nordfinInvoiceXml'
import { formatInvoicePeriod } from '@/lib/customer-portal/format'

const COMPANY = 'co-f108m'
const Q = 15 * 60_000
const iso = (ms: number) => new Date(ms).toISOString()
const SEP_EDIEL = { start: '2026-08-31T23:00:00.000Z', end: '2026-09-30T23:00:00.000Z' }
const SEP_CIVIL = { start: '2026-08-31T22:00:00.000Z', end: '2026-09-30T22:00:00.000Z' }

// A Z04 start on 1 September (DTM+92 202609010000 +0100 = 2026-08-31T23:00Z).
const z04 = (id: string, mp: string, extra: Row = {}) => ({ id, company_id: COMPANY, customer_id: 'cu-1', metering_point_id: mp, contract_id: `ct-${mp}`, status: 'active',
  start_date: '2026-09-01', end_date: null, market_start_at: '2026-08-31T23:00:00+00:00', market_end_at: null, ...extra })
// A Z05 end on 1 October (DTM+93 202610010000 +0100): end_date = first day no longer supplied, market_end_at 23:00Z.
const z05Ended = (id: string, mp: string) => z04(id, mp, { status: 'ended', start_date: '2026-08-01', market_start_at: '2026-07-31T22:00:00+00:00', end_date: '2026-10-01', market_end_at: '2026-09-30T23:00:00+00:00' })
// A manual/legacy period: dates only.
const manual = (id: string, mp: string, extra: Row = {}) => ({ id, company_id: COMPANY, customer_id: 'cu-1', metering_point_id: mp, contract_id: `ct-${mp}`, status: 'active',
  start_date: '2026-09-01', end_date: null, market_start_at: null, market_end_at: null, ...extra })
const contractFor = (mp: string, extra: Row = {}) => ({ id: `ct-${mp}`, company_id: COMPANY, customer_id: 'cu-1', metering_point_id: mp, status: 'active', starts_at: '2026-07-01', energy_direction: 'consumption', ...extra })
const snapshotFor = (mp: string) => ({ id: `snap-${mp}`, company_id: COMPANY, contract_id: `ct-${mp}`, valid_from: '2026-07-01', valid_to: null, snapshot_json: { price_area: 'SE3', energy_direction: 'consumption' } })

// A value as the database returns it qualified (billing_source_basis, source message) and gated eligible.
function value(id: string, mp: string, period: string, start: number, end: number, quantity = '0.25'): Row {
  return { id, company_id: COMPANY, customer_id: 'cu-1', metering_point_id: mp, supply_period_id: period, source_metering_value_id: `mv-${id}`, source_message_id: 'msg-1',
    revision_status: 'current', billing_status: 'billable', billing_gate_status: 'eligible', quantity_kwh: quantity, unit: 'kWh', quality_status: 'measured', direction: 'consumption',
    product_code: null, period_start: iso(start), period_end: iso(end), billing_gate_snapshot: { status: 'eligible' },
    billing_source_message: { id: 'msg-1', company_id: COMPANY, message_family: 'UTILTS', status: 'validated' },
    billing_source_basis: { version: 1, qualified: true, normalizedValueId: id, sourceMessageId: 'msg-1', quantityType: '136', quantityKwh: quantity, productCode: null, qualityEstablished: true, quality: null } }
}
function quarters(mp: string, period: string, from: string, to: string): Row[] {
  const rows: Row[] = []
  for (let t = Date.parse(from); t < Date.parse(to); t += Q) rows.push(value(`${mp}-${t}`, mp, period, t, t + Q))
  return rows
}

function storedUnderlays(): Row[] {
  return io.rpcCalls.filter(call => call.name === 'gridex_store_billing_underlay_batch')
    .flatMap(call => (call.args.p_commands as Array<{ underlay: Row; items: Row[] }>).map(command => ({ ...command.underlay, items: command.items })))
}

beforeEach(() => { io.tables = {}; io.rpcCalls = []; io.inserts = [] })

describe('F108 the billing month of a supply period', () => {
  it('an Ediel month runs from 00:00 +0100 on the 1st; the load window is the union with the civil month', () => {
    expect(edielMonthBounds('2026-09')).toEqual(SEP_EDIEL)
    expect(edielMonthBounds('2026-12')).toEqual({ start: '2026-11-30T23:00:00.000Z', end: '2026-12-31T23:00:00.000Z' })
    expect(billingMonthLoadWindow('2026-09')).toEqual({ start: SEP_CIVIL.start, end: SEP_EDIEL.end })
    // Winter: the Ediel month equals the civil month.
    expect(billingMonthLoadWindow('2026-12')).toEqual(edielMonthBounds('2026-12'))
  })

  it('September for a summer-time Z04 start is exactly [23:00Z 31 Aug, 23:00Z 30 Sep); August has no segment', () => {
    expect(supplyPeriodBillingSegment(z04('sp', 'mp'), '2026-09')).toEqual({ ...SEP_EDIEL, frame: 'ediel_fixed_normal_time' })
    expect(supplyPeriodBillingSegment(z04('sp', 'mp'), '2026-08')).toBeNull()
    // A continuing Ediel supply tiles the months: October and the DST months follow the Ediel frame.
    expect(supplyPeriodBillingSegment(z04('sp', 'mp'), '2026-10')).toMatchObject({ start: '2026-09-30T23:00:00.000Z', end: '2026-10-31T23:00:00.000Z' })
    expect(supplyPeriodBillingSegment(z04('sp', 'mp', { start_date: '2026-01-01', market_start_at: '2025-12-31T23:00:00Z' }), '2026-03'))
      .toMatchObject({ start: '2026-02-28T23:00:00.000Z', end: '2026-03-31T23:00:00.000Z' })
  })

  it('M5: a Z05 end on 1 October ends September at the market instant 23:00Z; October has no one-hour segment', () => {
    expect(new Date(supplyPeriodEndInstant(z05Ended('sp', 'mp'))!).toISOString()).toBe('2026-09-30T23:00:00.000Z')
    expect(supplyPeriodBillingSegment(z05Ended('sp', 'mp'), '2026-09')).toMatchObject({ start: SEP_EDIEL.start, end: SEP_EDIEL.end })
    expect(supplyPeriodBillingSegment(z05Ended('sp', 'mp'), '2026-10')).toBeNull()
  })

  it('a manual period uses Swedish civil midnight for its start, its end and its months', () => {
    expect(supplyPeriodBillingSegment(manual('sp', 'mp'), '2026-09')).toEqual({ ...SEP_CIVIL, frame: 'stockholm_civil' })
    // A manual end date is the last supplied day; the supply ends at civil midnight after it.
    const ended = manual('sp', 'mp', { status: 'ended', end_date: '2026-09-15' })
    expect(new Date(supplyPeriodEndInstant(ended)!).toISOString()).toBe('2026-09-15T22:00:00.000Z')
    expect(supplyPeriodBillingSegment(ended, '2026-09')).toMatchObject({ start: SEP_CIVIL.start, end: '2026-09-15T22:00:00.000Z' })
    // A contract/price end date on a manual period stays civil; on an Ediel period it reaches the Ediel month end.
    expect(iso(businessDateEndInstant('2026-09-30', manual('sp', 'mp')))).toBe(SEP_CIVIL.end)
    expect(iso(businessDateEndInstant('2026-09-30', z04('sp', 'mp')))).toBe(SEP_EDIEL.end)
    expect(iso(businessDateEndInstant('2026-12-31', z04('sp', 'mp')))).toBe('2026-12-31T23:00:00.000Z')
  })

  it('a mid-month switch from a manual to an Ediel period on one meter: each part keeps its own instants', () => {
    const before = manual('sp-a', 'mp', { status: 'ended', end_date: '2026-09-15' })
    const after = z04('sp-b', 'mp', { start_date: '2026-09-16', market_start_at: '2026-09-15T23:00:00Z' })
    expect(supplyPeriodBillingSegment(before, '2026-09')).toMatchObject({ start: SEP_CIVIL.start, end: '2026-09-15T22:00:00.000Z', frame: 'stockholm_civil' })
    expect(supplyPeriodBillingSegment(after, '2026-09')).toMatchObject({ start: '2026-09-15T23:00:00.000Z', end: SEP_EDIEL.end, frame: 'ediel_fixed_normal_time' })
    // A legacy period with a manual start and a received Z05 end: its first month starts at its own civil start,
    // so no hour of it is cut off into August; its last month ends at the market end.
    const legacy = manual('sp-c', 'mp', { status: 'ended', end_date: '2026-10-01', market_end_at: '2026-09-30T23:00:00Z' })
    expect(supplyPeriodBillingSegment(legacy, '2026-09')).toMatchObject({ start: SEP_CIVIL.start, end: SEP_EDIEL.end })
    expect(supplyPeriodBillingSegment(legacy, '2026-08')).toBeNull()
  })
})

describe('F108 M5: the hour before a summer-time Z05 end is billed in September', () => {
  const contract = { ...contractFor('mp-1'), status: 'terminated', termination_reason: 'supply_end', ended_at: '2026-10-01T00:00:00Z' }
  const lastHour = (startIso: string) => ({ ...value('nv-x', 'mp-1', 'sp-1', Date.parse(startIso), Date.parse(startIso) + Q) })
  const covers = (startIso: string) => !evaluateBillingGate({ normalizedValue: lastHour(startIso), supplyPeriod: z05Ended('sp-1', 'mp-1'), contract })
    .reasons.some(reason => reason.code === 'supply_period_does_not_cover_value')

  it('the TypeScript gate covers 22:00Z-23:00Z on 30 September and nothing after the market end', () => {
    expect(covers('2026-09-30T22:00:00Z')).toBe(true)
    expect(covers('2026-09-30T22:45:00Z')).toBe(true)
    expect(covers('2026-09-30T23:00:00Z')).toBe(false)
  })

  it('the value matcher matches the ending period instead of holding the value as outside every period', async () => {
    io.tables = {
      normalized_metering_values: [{ id: 'nv-x', company_id: COMPANY, source_metering_value_id: 'mv-x', revision_status: 'current', source_message_id: 'msg-1' }],
      customer_supply_periods: [z05Ended('sp-1', 'mp-1')],
      customer_contracts: [contract],
      ediel_unresolved_items: [],
    }
    await updateMeterValueBillingReadiness({ meterValue: { id: 'mv-x', company_id: COMPANY, metering_point_id: 'mp-1', period_start: '2026-09-30T22:00:00.000Z', period_end: '2026-09-30T22:15:00.000Z' } as never, sourceMessageId: 'msg-1' })
    const gates = io.rpcCalls.filter(call => call.name === 'gridex_set_metering_billing_gate').map(call => call.args.p_gate as Row)
    expect(gates).toHaveLength(1)
    expect(gates[0]).toMatchObject({ supply_period_id: 'sp-1' })
    expect((gates[0].billing_gate_reasons as Array<{ code: string }>).map(reason => reason.code)).not.toContain('supply_period_missing')
    expect((gates[0].billing_gate_reasons as Array<{ code: string }>).map(reason => reason.code)).not.toContain('supply_period_does_not_cover_value')
  })

  it('the September underlay ends at 23:00Z with those four quarter-hours; the October run has nothing for the period', async () => {
    io.tables = {
      normalized_metering_values: quarters('mp-1', 'sp-1', SEP_EDIEL.start, SEP_EDIEL.end),
      customer_supply_periods: [z05Ended('sp-1', 'mp-1')],
      customer_contracts: [contract],
      contract_price_snapshots: [snapshotFor('mp-1')],
    }
    const september = await generateBillingUnderlaysForMonth({ companyId: COMPANY, billingMonth: '2026-09', createdBy: 'automation' })
    expect(september.results.flatMap(entry => entry.warnings)).toEqual([])
    const [underlay] = storedUnderlays()
    expect(underlay).toMatchObject({ billing_period_start: SEP_EDIEL.start, billing_period_end: SEP_EDIEL.end, readiness_status: 'ready', underlay_year: 2026, underlay_month: 9,
      source_meter_value_count: 2880, payload: expect.objectContaining({ billing_month_frame: 'ediel_fixed_normal_time' }) })
    expect((underlay.items as Row[]).filter(item => Date.parse(String(item.period_start)) >= Date.parse('2026-09-30T22:00:00Z'))).toHaveLength(4)
    io.rpcCalls = []
    const october = await generateBillingUnderlaysForMonth({ companyId: COMPANY, billingMonth: '2026-10', createdBy: 'automation' })
    expect(storedUnderlays()).toEqual([])
    expect(october.results).toEqual([])
  }, 60_000)
})

describe('F108 M6 and the September underlay of an Ediel supply', () => {
  it('a monthly E66 value in +0100 is billed in September without needs_review', async () => {
    io.tables = {
      normalized_metering_values: [value('nv-m', 'mp-1', 'sp-1', Date.parse(SEP_EDIEL.start), Date.parse(SEP_EDIEL.end), '719')],
      customer_supply_periods: [z04('sp-1', 'mp-1', { start_date: '2026-08-01', market_start_at: '2026-07-31T22:00:00Z' })],
      customer_contracts: [contractFor('mp-1')],
      contract_price_snapshots: [snapshotFor('mp-1')],
    }
    const result = await generateBillingUnderlaysForMonth({ companyId: COMPANY, billingMonth: '2026-09', createdBy: 'automation' })
    expect(result.results.map(entry => entry.status)).toEqual(['ready_for_pricing'])
    expect(result.results.flatMap(entry => entry.warnings).filter(warning => warning.startsWith('source_interval_requires_finer_data'))).toEqual([])
    expect(storedUnderlays()).toEqual([expect.objectContaining({ billing_period_start: SEP_EDIEL.start, billing_period_end: SEP_EDIEL.end, total_kwh: '719', readiness_status: 'ready' })])
  })

  it('a continuing Ediel supply: the civil hour before the Ediel month is August\'s, neither billed nor orphaned in September', async () => {
    io.tables = {
      normalized_metering_values: quarters('mp-1', 'sp-1', SEP_CIVIL.start, SEP_EDIEL.end),
      customer_supply_periods: [z04('sp-1', 'mp-1', { start_date: '2026-08-01', market_start_at: '2026-07-31T22:00:00Z' })],
      customer_contracts: [contractFor('mp-1')],
      contract_price_snapshots: [snapshotFor('mp-1')],
    }
    const result = await generateBillingUnderlaysForMonth({ companyId: COMPANY, billingMonth: '2026-09', createdBy: 'automation' })
    expect(result.results.flatMap(entry => entry.warnings)).toEqual([])
    expect(storedUnderlays()).toEqual([expect.objectContaining({ billing_period_start: SEP_EDIEL.start, billing_period_end: SEP_EDIEL.end, source_meter_value_count: 2880 })])
    // August's run bills that hour.
    io.rpcCalls = []
    await generateBillingUnderlaysForMonth({ companyId: COMPANY, billingMonth: '2026-08', createdBy: 'automation' })
    const [august] = storedUnderlays()
    expect(august).toMatchObject({ billing_period_start: '2026-07-31T22:00:00.000Z', billing_period_end: SEP_EDIEL.start })
    expect((august.items as Row[]).map(item => item.period_start)).toEqual(['2026-08-31T22:00:00.000Z', '2026-08-31T22:15:00.000Z', '2026-08-31T22:30:00.000Z', '2026-08-31T22:45:00.000Z'])
  }, 60_000)

  it('a manual period keeps the civil month: its September ends at 22:00Z and a +0100 monthly value stays a partial interval', async () => {
    io.tables = {
      normalized_metering_values: quarters('mp-1', 'sp-1', SEP_CIVIL.start, SEP_CIVIL.end),
      customer_supply_periods: [manual('sp-1', 'mp-1', { start_date: '2026-08-01' })],
      customer_contracts: [contractFor('mp-1')],
      contract_price_snapshots: [snapshotFor('mp-1')],
    }
    const result = await generateBillingUnderlaysForMonth({ companyId: COMPANY, billingMonth: '2026-09', createdBy: 'automation' })
    expect(result.results.flatMap(entry => entry.warnings)).toEqual([])
    expect(storedUnderlays()).toEqual([expect.objectContaining({ billing_period_start: SEP_CIVIL.start, billing_period_end: SEP_CIVIL.end, source_meter_value_count: 2880,
      payload: expect.objectContaining({ billing_month_frame: 'stockholm_civil' }) })])
    io.rpcCalls = []
    io.tables.normalized_metering_values = [value('nv-m', 'mp-1', 'sp-1', Date.parse(SEP_EDIEL.start), Date.parse(SEP_EDIEL.end), '719')]
    const monthly = await generateBillingUnderlaysForMonth({ companyId: COMPANY, billingMonth: '2026-09', createdBy: 'automation' })
    expect(monthly.results.flatMap(entry => entry.warnings)).toContain('source_interval_requires_finer_data: Källkvantiteten får inte fördelas proportionellt över ett delintervall.')
  }, 60_000)

  it('a mixed customer: an Ediel facility and a manual facility in one run, plus a mid-month switch, each with its exact period', async () => {
    const switchBefore = manual('sp-3a', 'mp-3', { status: 'ended', start_date: '2026-08-01', end_date: '2026-09-15' })
    const switchAfter = z04('sp-3b', 'mp-3', { start_date: '2026-09-16', market_start_at: '2026-09-15T23:00:00Z', contract_id: 'ct-mp-3' })
    io.tables = {
      normalized_metering_values: [
        ...quarters('mp-1', 'sp-1', SEP_EDIEL.start, SEP_EDIEL.end),
        ...quarters('mp-2', 'sp-2', SEP_CIVIL.start, SEP_CIVIL.end),
        ...quarters('mp-3', 'sp-3a', SEP_CIVIL.start, '2026-09-15T22:00:00Z'),
        ...quarters('mp-3', 'sp-3b', '2026-09-15T23:00:00Z', SEP_EDIEL.end),
      ],
      customer_supply_periods: [z04('sp-1', 'mp-1'), manual('sp-2', 'mp-2', { start_date: '2026-08-01' }), switchBefore, switchAfter],
      customer_contracts: [contractFor('mp-1'), contractFor('mp-2'), contractFor('mp-3')],
      contract_price_snapshots: [snapshotFor('mp-1'), snapshotFor('mp-2'), snapshotFor('mp-3')],
    }
    const result = await generateBillingUnderlaysForMonth({ companyId: COMPANY, billingMonth: '2026-09', createdBy: 'automation' })
    expect(result.results.flatMap(entry => entry.warnings)).toEqual([])
    const periods = storedUnderlays().map(underlay => [underlay.metering_point_id, underlay.supply_period_id, underlay.billing_period_start, underlay.billing_period_end, (underlay.payload as Row).billing_month_frame, underlay.underlay_month])
    expect(periods.sort((a, b) => String(a[1]).localeCompare(String(b[1])))).toEqual([
      ['mp-1', 'sp-1', SEP_EDIEL.start, SEP_EDIEL.end, 'ediel_fixed_normal_time', 9],
      ['mp-2', 'sp-2', SEP_CIVIL.start, SEP_CIVIL.end, 'stockholm_civil', 9],
      ['mp-3', 'sp-3a', SEP_CIVIL.start, '2026-09-15T22:00:00.000Z', 'stockholm_civil', 9],
      ['mp-3', 'sp-3b', '2026-09-15T23:00:00.000Z', SEP_EDIEL.end, 'ediel_fixed_normal_time', 9],
    ])
    expect(storedUnderlays().every(underlay => underlay.readiness_status === 'ready')).toBe(true)
  }, 120_000)
})

describe('F108 completeness of an Ediel month', () => {
  it('a supplied window reaching 23:00Z requires the last hour: a missing last hour is a gap', async () => {
    io.tables = { normalized_metering_values: quarters('mp-1', 'sp-1', SEP_EDIEL.start, SEP_EDIEL.end) }
    const complete = await evaluateMeteringCompletenessForMonth({ companyId: COMPANY, billingMonth: '2026-09', meteringPoints: [{ meteringPointId: 'mp-1', windows: [SEP_EDIEL] }] })
    expect(complete.issues).toEqual([])
    io.tables = { normalized_metering_values: quarters('mp-1', 'sp-1', SEP_EDIEL.start, '2026-09-30T22:00:00Z') }
    const missingLastHour = await evaluateMeteringCompletenessForMonth({ companyId: COMPANY, billingMonth: '2026-09', meteringPoints: [{ meteringPointId: 'mp-1', windows: [SEP_EDIEL] }] })
    expect(missingLastHour.issues.map(issue => issue.code)).toContain('metering_gap')
  })

  it('the metering autopilot checks each point against its supplied Ediel month instead of asking the grid owner for the previous supplier\'s hour', async () => {
    io.tables = {
      metering_points: [{ id: 'mp-1', company_id: COMPANY, customer_id: 'cu-1', site_id: 'site-1', customer_site_id: 'site-1', grid_owner_id: 'go-1', status: 'active' }],
      customer_supply_periods: [z04('sp-1', 'mp-1')],
      normalized_metering_values: quarters('mp-1', 'sp-1', SEP_EDIEL.start, SEP_EDIEL.end),
    }
    const result = await runMeteringMarketDataAutopilot({ companyId: COMPANY, billingMonth: '2026-09', actorUserId: 'automation' })
    expect(result.decisions).toEqual([expect.objectContaining({ meteringPointId: 'mp-1', decision: 'AUTO' })])
    expect(io.inserts.filter(insert => insert.table === 'grid_owner_data_requests')).toEqual([])
  })
})

describe('F108 the invoice prints the exact covered period and is labelled by its month', () => {
  it('Ediel September in summer, civil September and Ediel October across the DST change', () => {
    expect(invoiceBillingPeriod({ billingMonth: '2026-09', ...SEP_EDIEL, frame: 'ediel_fixed_normal_time' })).toEqual({
      billing_month: '2026-09', label: 'September 2026', start: SEP_EDIEL.start, end: SEP_EDIEL.end, end_exclusive: true, frame: 'ediel_fixed_normal_time',
      text: '2026-09-01 01:00 – 2026-10-01 01:00 (svensk tid)',
    })
    expect(invoiceBillingPeriod({ billingMonth: '2026-09', ...SEP_CIVIL, frame: 'stockholm_civil' })?.text).toBe('2026-09-01 00:00 – 2026-10-01 00:00 (svensk tid)')
    expect(invoiceBillingPeriod({ billingMonth: '2026-10', start: '2026-09-30T23:00:00Z', end: '2026-10-31T23:00:00Z' })?.text).toBe('2026-10-01 01:00 – 2026-11-01 00:00 (svensk tid)')
    expect(invoiceBillingPeriod({ billingMonth: '2026-09', start: null, end: SEP_EDIEL.end })).toBeNull()
  })

  const fileInput = (payload: Row) => ({
    item: { id: '11111111-1111-4111-8111-111111111111', total_kwh: 719, amount_ex_vat: 800, vat_amount: 200, amount_inc_vat: 1000, period_start: '2026-09-01', period_end: '2026-10-01' },
    invoice: { invoice_number: 'GX-1', price_area_code: 'SE3' }, customer: { name: 'Synthetic Kund', customer_number: 'K1' },
    underlay: { price_area: 'SE3', billing_period_start: '2026-09-01', billing_period_end: '2026-10-01', payload }, lines: [{ description: 'Spotpris', quantity: 719, unit: 'kWh', amount_ex_vat: 800 }],
    legacyItem: null, billingMonth: '2026-09', now: new Date('2026-10-05T10:00:00Z'),
  })

  it('the invoice file row, CSV and Nordfin XML carry the exact period; a row without stored instants renders as before', () => {
    const row = buildInvoiceFileRow(fileInput({ billing_period_start_instant: '2026-08-31T23:00:00+00:00', billing_period_end_instant: '2026-09-30T23:00:00+00:00', billing_month_frame: 'ediel_fixed_normal_time' }))
    expect(row.billing_period).toMatchObject({ label: 'September 2026', text: '2026-09-01 01:00 – 2026-10-01 01:00 (svensk tid)', start: SEP_EDIEL.start, end: SEP_EDIEL.end })
    const xml = renderNordfinInvoiceXml([row])
    expect(xml).toContain('<PeriodLabel>September 2026</PeriodLabel>')
    expect(xml).toContain('<PeriodText>2026-09-01 01:00 – 2026-10-01 01:00 (svensk tid)</PeriodText>')
    expect(xml).toContain(`<PeriodStart>${SEP_EDIEL.start}</PeriodStart>`)
    const csv = renderInvoiceFile({ id: 'abcdef12-0000', billing_month: '2026-09', rows: [row], rows_sha256: 'x', created_at: '2026-10-05T10:00:00Z' }, 'csv').body
    expect(csv.split('\r\n')[0]).toContain('Fakturaperiod;Leveransperiod (exakt)')
    expect(csv.split('\r\n')[1]).toContain('September 2026;2026-09-01 01:00 – 2026-10-01 01:00 (svensk tid)')

    const legacy = buildInvoiceFileRow(fileInput({}))
    expect(legacy).not.toHaveProperty('billing_period')
    expect(renderNordfinInvoiceXml([legacy])).not.toContain('PeriodText')
    expect(renderInvoiceFile({ id: 'abcdef12-0000', billing_month: '2026-09', rows: [legacy], rows_sha256: 'x', created_at: '2026-10-05T10:00:00Z' }, 'csv').body).not.toContain('Leveransperiod (exakt)')
  })

  it('the customer portal shows the exact period stored with the invoice, and the dates for older invoices', () => {
    const period = invoiceBillingPeriod({ billingMonth: '2026-09', ...SEP_EDIEL, frame: 'ediel_fixed_normal_time' })
    expect(formatInvoicePeriod({ period_start: '2026-09-01', period_end: '2026-10-01', metadata: { billing_period: period } }))
      .toBe('September 2026 · 2026-09-01 01:00 – 2026-10-01 01:00 (svensk tid)')
    expect(formatInvoicePeriod({ period_start: '2026-09-01', period_end: '2026-10-01', metadata: {} })).toBe('2026-09-01 – 2026-10-01')
  })

  it('interval pricing of an Ediel month needs the next civil delivery day only for its last hour', () => {
    expect(civilDeliveryDaysOutsideMonth(SEP_EDIEL.start, SEP_EDIEL.end, '2026-09')).toEqual(['2026-10-01'])
    expect(civilDeliveryDaysOutsideMonth(SEP_CIVIL.start, SEP_CIVIL.end, '2026-09')).toEqual([])
    expect(civilDeliveryDaysOutsideMonth('2026-09-30T23:00:00Z', '2026-10-31T23:00:00Z', '2026-10')).toEqual([])
  })
})
