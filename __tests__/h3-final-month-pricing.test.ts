// reality-defects: H3 (final invoice after a Z05: pricing and export accept a contract terminated by exactly this supply end)
// Owner decision 2026-10-22 (H2/H3): a supply ended by a Z05 is still billed for its final month, and a contract the
// supply-end follow-up terminated because exactly that supply ended stays billable for it. The value gate and the
// underlay store already apply that rule (20261022150000, 20261023196000); the pricing engine's loadContract and the
// export center's exact contract lookup accepted only 'signed'/'active', so the ready September underlay of a customer
// whose supply a Z05 ended on 1 October failed pricing with "Aktivt kundavtal saknas" and the customer who left was
// never invoiced for the last month (FINDINGS F108 end-side sidofynd 1).
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
// A fixed monthly price: the price sources are not under test (no spot, no provider).
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
import { contractCarriesBilledPeriod } from '@/lib/billing/supplyPeriodEnd'
import { listExactBillableContractsByUnderlayIds } from '@/lib/billing/exportCenter'

const COMPANY = 'co-h3p'
const OTHER = 'co-h3p-other'
const MISSING = 'Aktivt kundavtal saknas för fakturaperioden.'
const SEP_EDIEL = { start: '2026-08-31T23:00:00.000Z', end: '2026-09-30T23:00:00.000Z' }
const OCT_EDIEL = { start: '2026-09-30T23:00:00.000Z', end: '2026-10-31T23:00:00.000Z' }

// Supplied since 1 August (Z04), ended by a Z05 DTM+93 202610010000 +0100: end_date = 1 October (first day no longer
// supplied), market_end_at = 2026-09-30T23:00Z.
const z05Ended = (extra: Row = {}): Row => ({ id: 'sp-1', company_id: COMPANY, customer_id: 'cu-1', metering_point_id: 'mp-1', contract_id: 'ct-1', status: 'ended',
  start_date: '2026-08-01', end_date: '2026-10-01', actual_end_date: null, market_start_at: '2026-07-31T22:00:00+00:00', market_end_at: '2026-09-30T23:00:00+00:00', ...extra })
// The supply-end follow-up terminated the contract with ended_at = the end date (gridex_record_customer_contract_event_v1).
const terminated = (extra: Row = {}): Row => ({ id: 'ct-1', company_id: COMPANY, customer_id: 'cu-1', metering_point_id: 'mp-1', status: 'terminated', termination_reason: 'supply_end',
  ended_at: '2026-10-01T00:00:00+00:00', starts_at: '2026-08-01', ends_at: null, contract_type: 'fixed', energy_direction: 'consumption', ...extra })
const snapshot: Row = { id: 'snap-1', company_id: COMPANY, contract_id: 'ct-1', valid_from: '2026-08-01', valid_to: null, snapshot_json: { price_area: 'SE3', energy_direction: 'consumption' } }
// The grid owner's monthly E66 for the September Ediel month, qualified and gated eligible.
const monthlyValue: Row = { id: 'nv-sep', company_id: COMPANY, customer_id: 'cu-1', metering_point_id: 'mp-1', supply_period_id: 'sp-1', source_metering_value_id: 'mv-sep', source_message_id: 'msg-1',
  revision_status: 'current', billing_status: 'billable', billing_gate_status: 'eligible', quantity_kwh: '719', unit: 'kWh', quality_status: 'measured', direction: 'consumption',
  product_code: null, period_start: SEP_EDIEL.start, period_end: SEP_EDIEL.end, billing_gate_snapshot: { status: 'eligible' },
  billing_source_message: { id: 'msg-1', company_id: COMPANY, message_family: 'UTILTS', status: 'validated' },
  billing_source_basis: { version: 1, qualified: true, normalizedValueId: 'nv-sep', sourceMessageId: 'msg-1', quantityType: '136', quantityKwh: '719', productCode: null, qualityEstablished: true, quality: null } }

// The row gridex_store_billing_underlay(_before_source_v2) stores for a command: civil dates plus the exact instants.
function storedRow(command: Row, id: string, dates: { start: string; end: string }): Row {
  return { ...command, id, company_id: COMPANY, billing_period_start: dates.start, billing_period_end: dates.end,
    payload: { ...(command.payload as Row), billing_period_start_instant: command.billing_period_start, billing_period_end_instant: command.billing_period_end,
      billing_period_timezone: 'Europe/Stockholm', billing_period_end_exclusive: true } }
}
function storedCommands(): Row[] {
  return io.rpcCalls.filter(call => call.name === 'gridex_store_billing_underlay_batch')
    .flatMap(call => (call.args.p_commands as Array<{ underlay: Row }>).map(command => command.underlay))
}

let finalUnderlay: Row
async function generateFinalMonth() {
  io.tables = { normalized_metering_values: [monthlyValue], customer_supply_periods: [z05Ended()], customer_contracts: [terminated()], contract_price_snapshots: [snapshot] }
  const result = await generateBillingUnderlaysForMonth({ companyId: COMPANY, billingMonth: '2026-09', createdBy: 'automation' })
  expect(result.results.map(entry => entry.status)).toEqual(['ready_for_pricing'])
  const [command] = storedCommands()
  expect(command).toMatchObject({ contract_id: 'ct-1', supply_period_id: 'sp-1', readiness_status: 'ready', underlay_year: 2026, underlay_month: 9,
    billing_period_start: SEP_EDIEL.start, billing_period_end: SEP_EDIEL.end, total_kwh: '719' })
  finalUnderlay = storedRow(command, 'bu-sep', { start: '2026-09-01', end: '2026-10-01' })
  io.tables.billing_underlays = [finalUnderlay]
  io.rpcCalls = []
}
const price = (id = 'bu-sep', persist = false) => calculatePricingPreviewForUnderlay({ companyId: COMPANY, billingUnderlayId: id, persist })

beforeEach(async () => { io.tables = {}; io.rpcCalls = []; await generateFinalMonth() })

describe('H3 the final month after a Z05 is priced', () => {
  it('the ready September underlay of a contract terminated by exactly this supply end prices successfully', async () => {
    const result = await price()
    expect(result.errors).not.toContain(MISSING)
    expect(result.errors).toEqual([])
    expect(result.status).toBe('success')
    expect(result.totalExVat).toBeCloseTo(719, 6)
  })

  it('a persisted run is written for the final underlay with the same result', async () => {
    const result = await price('bu-sep', true)
    expect(result.status).toBe('success')
    const persisted = io.rpcCalls.filter(call => call.name === 'gridex_persist_pricing_run')
    expect(persisted).toHaveLength(1)
    expect(persisted[0].args).toMatchObject({ p_company_id: COMPANY, p_billing_underlay_id: 'bu-sep' })
    expect((persisted[0].args.p_result as Row).errors).toEqual([])
  })

  it('an ended_at given as Stockholm midnight (22:00Z the day before) is the same supply end', async () => {
    io.tables.customer_contracts = [terminated({ ended_at: '2026-09-30T22:00:00+00:00' })]
    expect((await price()).errors).not.toContain(MISSING)
  })

  it('the export center finds the exact contract of the final underlay', async () => {
    const map = await listExactBillableContractsByUnderlayIds({ companyId: COMPANY, underlays: [finalUnderlay as never] })
    expect(map.get('bu-sep')).toMatchObject({ id: 'ct-1', status: 'terminated' })
  })
})

describe('H3 refusals stay', () => {
  it('a contract terminated for another reason', async () => {
    io.tables.customer_contracts = [terminated({ termination_reason: 'customer_request' })]
    expect((await price()).errors).toContain(MISSING)
    expect((await listExactBillableContractsByUnderlayIds({ companyId: COMPANY, underlays: [finalUnderlay as never] })).size).toBe(0)
  })

  it('a contract terminated by another (earlier) supply end', async () => {
    io.tables.customer_contracts = [terminated({ ended_at: '2026-09-15T00:00:00+00:00' })]
    expect((await price()).errors).toContain(MISSING)
  })

  it('a cancelled or expired contract', async () => {
    for (const status of ['cancelled', 'expired']) {
      io.tables.customer_contracts = [terminated({ status })]
      expect((await price()).errors).toContain(MISSING)
    }
  })

  it("another tenant's contract or supply period", async () => {
    io.tables.customer_contracts = [terminated({ company_id: OTHER })]
    expect((await price()).errors).toContain(MISSING)
    io.tables.customer_contracts = [terminated()]
    io.tables.customer_supply_periods = [z05Ended({ company_id: OTHER })]
    expect((await price()).errors).toContain(MISSING)
    expect((await listExactBillableContractsByUnderlayIds({ companyId: COMPANY, underlays: [finalUnderlay as never] })).size).toBe(0)
  })

  it('a supply period of another contract, customer or metering point', async () => {
    for (const extra of [{ contract_id: 'ct-2' }, { customer_id: 'cu-2' }, { metering_point_id: 'mp-2' }]) {
      io.tables.customer_supply_periods = [z05Ended(extra)]
      expect((await price()).errors).toContain(MISSING)
    }
  })

  it('a billed period after the supply end (the October Ediel month)', async () => {
    io.tables.billing_underlays = [{ ...finalUnderlay, id: 'bu-oct', underlay_month: 10, billing_period_start: '2026-10-01', billing_period_end: '2026-11-01',
      payload: { ...(finalUnderlay.payload as Row), billing_period_start_instant: OCT_EDIEL.start, billing_period_end_instant: OCT_EDIEL.end } }]
    expect((await price('bu-oct')).errors).toContain(MISSING)
    expect((await listExactBillableContractsByUnderlayIds({ companyId: COMPANY, underlays: io.tables.billing_underlays as never })).size).toBe(0)
  })

  it('a billed period one hour past the market end (civil midnight 1 October 22:00Z is not the end, 23:00Z is)', async () => {
    const past = '2026-10-01T00:00:00.000Z'
    io.tables.billing_underlays = [{ ...finalUnderlay, payload: { ...(finalUnderlay.payload as Row), billing_period_end_instant: past } }]
    expect((await price()).errors).toContain(MISSING)
  })

  it('an ended period without an end date or a cancelled period', async () => {
    io.tables.customer_supply_periods = [z05Ended({ end_date: null, actual_end_date: null })]
    expect((await price()).errors).toContain(MISSING)
    io.tables.customer_supply_periods = [z05Ended({ status: 'cancelled' })]
    expect((await price()).errors).toContain(MISSING)
  })

  it('an underlay without its supply period', async () => {
    io.tables.billing_underlays = [{ ...finalUnderlay, supply_period_id: null }]
    expect((await price()).errors).toContain(MISSING)
  })
})

describe('H3 the underlay engine applies the same rule (no ready segment the store would refuse)', () => {
  async function september(contract: Row) {
    io.tables = { normalized_metering_values: [monthlyValue], customer_supply_periods: [z05Ended()], customer_contracts: [contract], contract_price_snapshots: [snapshot] }
    io.rpcCalls = []
    const result = await generateBillingUnderlaysForMonth({ companyId: COMPANY, billingMonth: '2026-09', createdBy: 'automation' })
    return { result, commands: storedCommands() }
  }

  it('a contract terminated by exactly this supply end gives the ready final underlay (above); another reason is reviewed', async () => {
    // A manual move-out (gridex_end_customer_supply_v1 / gridex_close_customer_lifecycle_v1) terminates with 'move_out':
    // the gate and the store refuse it, so the engine must not hand the store a ready segment (23514 rolls back the batch).
    for (const extra of [{ termination_reason: 'move_out' }, { ended_at: '2026-09-15T00:00:00+00:00' }]) {
      const { result, commands } = await september(terminated(extra))
      expect(commands.filter(command => command.readiness_status === 'ready')).toEqual([])
      expect(result.results.flatMap(entry => entry.warnings)).toContain('Leveransperioden saknar ett aktivt eller signerat avtal.')
    }
  })

  it('an active contract is unchanged', async () => {
    const { commands } = await september(terminated({ status: 'active', termination_reason: null, ended_at: null }))
    expect(commands).toEqual([expect.objectContaining({ readiness_status: 'ready', contract_id: 'ct-1' })])
  })
})

describe('H3 the shared rule (same as the gate and the store)', () => {
  const sep = [Date.parse(SEP_EDIEL.start), Date.parse(SEP_EDIEL.end)] as const
  it('signed/active always; terminated only by exactly this supply end and only inside the supplied window', () => {
    expect(contractCarriesBilledPeriod({ status: 'active' }, null, ...sep)).toBe(true)
    expect(contractCarriesBilledPeriod({ status: 'signed' }, null, ...sep)).toBe(true)
    expect(contractCarriesBilledPeriod(terminated(), z05Ended(), ...sep)).toBe(true)
    expect(contractCarriesBilledPeriod(terminated(), z05Ended({ status: 'ending' }), ...sep)).toBe(true)
    expect(contractCarriesBilledPeriod(terminated(), z05Ended(), Date.parse(OCT_EDIEL.start), Date.parse(OCT_EDIEL.end))).toBe(false)
    // Starts before the supply's civil start date (1 August 00:00 = 2026-07-31T22:00Z).
    expect(contractCarriesBilledPeriod(terminated(), z05Ended(), Date.parse('2026-07-31T21:00:00Z'), sep[1])).toBe(false)
    expect(contractCarriesBilledPeriod(terminated(), z05Ended(), Date.parse('2026-07-31T22:00:00Z'), sep[1])).toBe(true)
    expect(contractCarriesBilledPeriod(terminated({ termination_reason: 'supply_switch' }), z05Ended(), ...sep)).toBe(false)
    expect(contractCarriesBilledPeriod(terminated(), z05Ended({ status: 'pending' }), ...sep)).toBe(false)
    // A manual end date is the last supplied day: the window ends at civil midnight after it.
    const manualEnd = z05Ended({ end_date: '2026-09-30', market_end_at: null })
    expect(contractCarriesBilledPeriod(terminated({ ended_at: '2026-09-30T00:00:00Z' }), manualEnd, Date.parse('2026-08-31T22:00:00Z'), Date.parse('2026-09-30T22:00:00Z'))).toBe(true)
    expect(contractCarriesBilledPeriod(terminated({ ended_at: '2026-09-30T00:00:00Z' }), manualEnd, Date.parse('2026-08-31T22:00:00Z'), Date.parse('2026-09-30T23:00:00Z'))).toBe(false)
  })

  it('contractCarriesUnderlay keeps a signed/active contract unchanged and checks identity for a terminated one', () => {
    expect(contractCarriesUnderlay(COMPANY, finalUnderlay, { id: 'x', status: 'active' }, null)).toBe(true)
    expect(contractCarriesUnderlay(COMPANY, finalUnderlay, terminated(), z05Ended())).toBe(true)
    expect(contractCarriesUnderlay(COMPANY, finalUnderlay, terminated({ id: 'ct-other' }), z05Ended())).toBe(false)
    expect(contractCarriesUnderlay(COMPANY, finalUnderlay, terminated(), z05Ended({ id: 'sp-other' }))).toBe(false)
    expect(contractCarriesUnderlay(COMPANY, finalUnderlay, terminated(), null)).toBe(false)
  })
})
