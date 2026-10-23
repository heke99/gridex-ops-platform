// reality-defects: H3 (H3b: the final month after a manual move-out is underlaid, priced and exported like after a Z05)
// Owner decision 2026-10-23 "Fakturera slutmånaden": a contract ended by a manual move-out
// (gridex_end_customer_supply_v1 with p_end_reason 'move_out', gridex_close_customer_lifecycle_v1) is billed for its
// final month up to its end date, under the same rule as after a Z05 supply end. Both writers terminate the contract
// through gridex_record_customer_contract_event_v1 with termination_reason 'move_out' and ended_at = ends_at = the
// move-out date, and end the supply period on that same date as its LAST supplied day (end_date, no market_end_at).
// The gate/store/pricing rule (contractCarriesBilledPeriod, H3) accepted only 'supply_end', so the leaving customer's
// last month was never underlaid ("Leveransperioden saknar ett aktivt eller signerat avtal."), never priced
// ("Aktivt kundavtal saknas") and never exported (FINDINGS H3 sidofynd 1).
// Synthetic ids only. Calls the code; nothing reads source text.
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

import { generateBillingUnderlaysForMonth } from '@/lib/billing/underlayEngine'
import { calculatePricingPreviewForUnderlay, contractCarriesUnderlay } from '@/lib/pricing/engine'
import { contractCarriesBilledPeriod, contractEndedBySupplyPeriod } from '@/lib/billing/supplyPeriodEnd'
import { listExactBillableContractsByUnderlayIds } from '@/lib/billing/exportCenter'
import { evaluateBillingReadinessCore } from '@/lib/billing/billingReadiness'

const COMPANY = 'co-h3b'
const OTHER = 'co-h3b-other'
const MISSING = 'Aktivt kundavtal saknas för fakturaperioden.'
const NO_CONTRACT = 'Leveransperioden saknar ett aktivt eller signerat avtal.'
// September in the Ediel month frame (the supply was received by Z04 at 1 August 00:00 +0200); the customer moved out
// on 15 September (last supplied day), so the final segment ends at civil midnight after it, 2026-09-15T22:00Z.
const SEP_START = '2026-08-31T23:00:00.000Z'
const MOVE_END = '2026-09-15T22:00:00.000Z'

// gridex_end_customer_supply_v1(..., p_end_date 2026-09-15, 'move_out'): end_date = actual_end_date = the last supplied
// day, status 'ended', no market end.
const movedOut = (extra: Row = {}): Row => ({ id: 'sp-1', company_id: COMPANY, customer_id: 'cu-1', metering_point_id: 'mp-1', contract_id: 'ct-1', status: 'ended',
  start_date: '2026-08-01', end_date: '2026-09-15', actual_end_date: '2026-09-15', market_start_at: '2026-07-31T22:00:00+00:00', market_end_at: null,
  metadata: { end_reason: 'move_out' }, ...extra })
// gridex_close_customer_lifecycle_v1(mode 'move_out', 2026-09-15): the planned end on the still active period.
const lifecycleClosed = (extra: Row = {}): Row => movedOut({ status: 'active', actual_end_date: null,
  metadata: { planned_end_source: 'customer_lifecycle_close', planned_end_reason: 'move_out' }, ...extra })
// gridex_record_customer_contract_event_v1('terminated', {ends_at: 2026-09-15, termination_reason: 'move_out'}):
// ended_at = '2026-09-15'::timestamptz (UTC midnight on the local world DB).
const terminated = (extra: Row = {}): Row => ({ id: 'ct-1', company_id: COMPANY, customer_id: 'cu-1', metering_point_id: 'mp-1', status: 'terminated', termination_reason: 'move_out',
  ended_at: '2026-09-15T00:00:00+00:00', starts_at: '2026-08-01', ends_at: null, contract_type: 'fixed', energy_direction: 'consumption', ...extra })
const snapshot: Row = { id: 'snap-1', company_id: COMPANY, contract_id: 'ct-1', valid_from: '2026-08-01', valid_to: null, snapshot_json: { price_area: 'SE3', energy_direction: 'consumption' } }
// The grid owner's E66 for the supplied part of September, qualified and gated eligible.
const finalValue: Row = { id: 'nv-sep', company_id: COMPANY, customer_id: 'cu-1', metering_point_id: 'mp-1', supply_period_id: 'sp-1', source_metering_value_id: 'mv-sep', source_message_id: 'msg-1',
  revision_status: 'current', billing_status: 'billable', billing_gate_status: 'eligible', quantity_kwh: '361', unit: 'kWh', quality_status: 'measured', direction: 'consumption',
  product_code: null, period_start: SEP_START, period_end: MOVE_END, billing_gate_snapshot: { status: 'eligible' },
  billing_source_message: { id: 'msg-1', company_id: COMPANY, message_family: 'UTILTS', status: 'validated' },
  billing_source_basis: { version: 1, qualified: true, normalizedValueId: 'nv-sep', sourceMessageId: 'msg-1', quantityType: '136', quantityKwh: '361', productCode: null, qualityEstablished: true, quality: null } }

function storedRow(command: Row, id: string, dates: { start: string; end: string }): Row {
  return { ...command, id, company_id: COMPANY, billing_period_start: dates.start, billing_period_end: dates.end,
    payload: { ...(command.payload as Row), billing_period_start_instant: command.billing_period_start, billing_period_end_instant: command.billing_period_end,
      billing_period_timezone: 'Europe/Stockholm', billing_period_end_exclusive: true } }
}
function storedCommands(): Row[] {
  return io.rpcCalls.filter(call => call.name === 'gridex_store_billing_underlay_batch')
    .flatMap(call => (call.args.p_commands as Array<{ underlay: Row }>).map(command => command.underlay))
}

async function september(period: Row, contract: Row) {
  io.tables = { normalized_metering_values: [finalValue], customer_supply_periods: [period], customer_contracts: [contract], contract_price_snapshots: [snapshot] }
  io.rpcCalls = []
  const result = await generateBillingUnderlaysForMonth({ companyId: COMPANY, billingMonth: '2026-09', createdBy: 'automation' })
  return { result, commands: storedCommands() }
}

let finalUnderlay: Row
async function generateFinalMonth(period: Row = movedOut()) {
  const { result, commands } = await september(period, terminated())
  expect(result.results.flatMap(entry => entry.warnings)).not.toContain(NO_CONTRACT)
  expect(result.results.map(entry => entry.status)).toEqual(['ready_for_pricing'])
  const [command] = commands
  expect(command).toMatchObject({ contract_id: 'ct-1', supply_period_id: 'sp-1', readiness_status: 'ready', underlay_year: 2026, underlay_month: 9,
    billing_period_start: SEP_START, billing_period_end: MOVE_END, total_kwh: '361' })
  finalUnderlay = storedRow(command, 'bu-sep', { start: '2026-09-01', end: '2026-09-16' })
  io.tables.billing_underlays = [finalUnderlay]
  io.rpcCalls = []
}
const price = (id = 'bu-sep', persist = false) => calculatePricingPreviewForUnderlay({ companyId: COMPANY, billingUnderlayId: id, persist })

describe('H3b the final month after a manual move-out is billed (gridex_end_customer_supply_v1)', () => {
  beforeEach(async () => { io.tables = {}; io.rpcCalls = []; await generateFinalMonth() })

  it('the September segment up to the move-out date is a ready underlay of the move-out contract', () => {
    expect(finalUnderlay).toMatchObject({ contract_id: 'ct-1', readiness_status: 'ready', billing_period_end: '2026-09-16' })
  })

  it('the final underlay prices successfully and the persisted run carries no error', async () => {
    const preview = await price()
    expect(preview.errors).toEqual([])
    expect(preview.status).toBe('success')
    expect(preview.totalExVat).toBeCloseTo(361, 6)
    const persisted = await price('bu-sep', true)
    expect(persisted.status).toBe('success')
    const runs = io.rpcCalls.filter(call => call.name === 'gridex_persist_pricing_run')
    expect(runs).toHaveLength(1)
    expect((runs[0].args.p_result as Row).errors).toEqual([])
  })

  it('an ended_at given as Stockholm midnight (22:00Z the day before) is the same move-out date', async () => {
    io.tables.customer_contracts = [terminated({ ended_at: '2026-09-14T22:00:00+00:00' })]
    expect((await price()).errors).toEqual([])
  })

  it('the export center finds the exact contract of the final underlay', async () => {
    const map = await listExactBillableContractsByUnderlayIds({ companyId: COMPANY, underlays: [finalUnderlay as never] })
    expect(map.get('bu-sep')).toMatchObject({ id: 'ct-1', status: 'terminated', termination_reason: 'move_out' })
  })
})

describe('H3b the planned end of gridex_close_customer_lifecycle_v1 is billed the same way', () => {
  beforeEach(async () => { io.tables = {}; io.rpcCalls = []; await generateFinalMonth(lifecycleClosed()) })

  it('the active period with its planned move-out end prices and exports the final segment', async () => {
    expect((await price()).status).toBe('success')
    expect((await listExactBillableContractsByUnderlayIds({ companyId: COMPANY, underlays: [finalUnderlay as never] })).get('bu-sep')).toMatchObject({ id: 'ct-1' })
  })
})

describe('H3b refusals stay', () => {
  beforeEach(async () => { io.tables = {}; io.rpcCalls = []; await generateFinalMonth() })

  it('a contract terminated for another reason (manual supplier switch, customer request, withdrawal)', async () => {
    for (const reason of ['supplier_switch', 'customer_request', 'withdrawal', 'customer_switched_away', null]) {
      io.tables.customer_contracts = [terminated({ termination_reason: reason })]
      expect((await price()).errors).toContain(MISSING)
      expect((await listExactBillableContractsByUnderlayIds({ companyId: COMPANY, underlays: [finalUnderlay as never] })).size).toBe(0)
    }
  })

  it('a move-out on another date than this period ends', async () => {
    for (const endedAt of ['2026-09-10T00:00:00+00:00', '2026-09-16T00:00:00+00:00', null]) {
      io.tables.customer_contracts = [terminated({ ended_at: endedAt })]
      expect((await price()).errors).toContain(MISSING)
    }
  })

  it('a cancelled or expired contract with the move-out reason', async () => {
    for (const status of ['cancelled', 'expired']) {
      io.tables.customer_contracts = [terminated({ status })]
      expect((await price()).errors).toContain(MISSING)
    }
  })

  it("another tenant's contract or supply period, or another contract's, customer's or metering point's period", async () => {
    io.tables.customer_contracts = [terminated({ company_id: OTHER })]
    expect((await price()).errors).toContain(MISSING)
    io.tables.customer_contracts = [terminated()]
    for (const extra of [{ company_id: OTHER }, { contract_id: 'ct-2' }, { customer_id: 'cu-2' }, { metering_point_id: 'mp-2' }]) {
      io.tables.customer_supply_periods = [movedOut(extra)]
      expect((await price()).errors).toContain(MISSING)
    }
  })

  it('a billed period past the move-out date (one hour past civil midnight after 15 September)', async () => {
    io.tables.billing_underlays = [{ ...finalUnderlay, payload: { ...(finalUnderlay.payload as Row), billing_period_end_instant: '2026-09-15T23:00:00.000Z' } }]
    expect((await price()).errors).toContain(MISSING)
  })

  it('an ended period without its end date or a cancelled period', async () => {
    io.tables.customer_supply_periods = [movedOut({ end_date: null, actual_end_date: null })]
    expect((await price()).errors).toContain(MISSING)
    io.tables.customer_supply_periods = [movedOut({ status: 'cancelled' })]
    expect((await price()).errors).toContain(MISSING)
  })
})

describe('H3b the underlay engine: another reason or date is still reviewed, never a ready segment', () => {
  it('supplier_switch, another termination reason or another end date gives no ready segment', async () => {
    for (const extra of [{ termination_reason: 'supplier_switch' }, { termination_reason: 'customer_request' }, { ended_at: '2026-09-10T00:00:00+00:00' }]) {
      const { result, commands } = await september(movedOut(), terminated(extra))
      expect(commands.filter(command => command.readiness_status === 'ready')).toEqual([])
      expect(result.results.flatMap(entry => entry.warnings)).toContain(NO_CONTRACT)
    }
  })
})

describe('H3b the shared rule (contractEndedBySupplyPeriod / contractCarriesBilledPeriod)', () => {
  const sep = [Date.parse(SEP_START), Date.parse(MOVE_END)] as const
  it('a move_out contract ended on the period end date carries the period up to civil midnight after it', () => {
    expect(contractEndedBySupplyPeriod(terminated(), movedOut())).toBe(true)
    expect(contractEndedBySupplyPeriod(terminated({ termination_reason: 'supply_end' }), movedOut())).toBe(true)
    expect(contractEndedBySupplyPeriod(terminated({ termination_reason: 'supplier_switch' }), movedOut())).toBe(false)
    expect(contractEndedBySupplyPeriod(terminated({ termination_reason: 'MOVE_OUT' }), movedOut())).toBe(false)
    expect(contractEndedBySupplyPeriod(terminated({ status: 'cancelled' }), movedOut())).toBe(false)
    expect(contractCarriesBilledPeriod(terminated(), movedOut(), ...sep)).toBe(true)
    expect(contractCarriesBilledPeriod(terminated(), lifecycleClosed(), ...sep)).toBe(true)
    expect(contractCarriesBilledPeriod(terminated(), movedOut(), sep[0], Date.parse('2026-09-15T23:00:00Z'))).toBe(false)
    expect(contractCarriesBilledPeriod(terminated(), movedOut(), Date.parse('2026-09-30T23:00:00Z'), Date.parse('2026-10-31T23:00:00Z'))).toBe(false)
  })

  it('contractCarriesUnderlay checks identity for the move-out contract', async () => {
    await generateFinalMonth()
    expect(contractCarriesUnderlay(COMPANY, finalUnderlay, terminated(), movedOut())).toBe(true)
    expect(contractCarriesUnderlay(COMPANY, finalUnderlay, terminated({ id: 'ct-other' }), movedOut())).toBe(false)
    expect(contractCarriesUnderlay(OTHER, finalUnderlay, terminated(), movedOut())).toBe(false)
    expect(contractCarriesUnderlay(COMPANY, finalUnderlay, terminated(), null)).toBe(false)
  })

  it('billing readiness does not block the move-out contract as unapproved for its own period', () => {
    const base = { companyId: COMPANY, customerId: 'cu-1', supplyPeriods: [movedOut()] }
    const codes = (contract: Row) => evaluateBillingReadinessCore({ ...base, contract } as never).blockers.map((blocker: { code: string }) => blocker.code)
    expect(codes(terminated())).not.toContain('contract_not_approved')
    expect(codes(terminated({ termination_reason: 'supplier_switch' }))).toContain('contract_not_approved')
  })
})
