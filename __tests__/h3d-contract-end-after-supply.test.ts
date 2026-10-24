// reality-defects: H3d (D8: a contract ending AFTER its supply (notice period running on, owner decision B1) carries the
// supplied days of the final month in the TypeScript billing chain, nothing after the supply end; B3/D2: a registered
// termination keeps billing the continuing supply and a contract cannot be ended while its supply is open; D1 notice days)
// Owner decisions 2026-10-23 B1, B3 and 20. The database side is scripts/h3d-contract-end-after-supply-sql-regression.mjs
// and scripts/h3d-contract-end-after-supply-basis-sql-regression.mjs (20261023203000/203500).
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
// A PostgREST stand-in that applies equality filters (eq/in/is) and the contract or-filter, and ignores range filters.
vi.mock('@/lib/supabase/service', () => {
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = []
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'lt', 'gt', 'lte', 'gte', 'not', 'order', 'neq', 'contains', 'limit', 'update', 'filter', 'match', 'range']) builder[method] = () => builder
    builder.eq = (column: string, value: unknown) => { filters.push(row => row[column] === value); return builder }
    builder.in = (column: string, values: unknown[]) => { filters.push(row => values.includes(row[column])); return builder }
    builder.is = (column: string, value: unknown) => { filters.push(row => (row[column] ?? null) === value); return builder }
    builder.or = (expression: string) => {
      const terms = expression.split(',').map(term => term.split('.eq.')).filter(term => term.length === 2)
      if (terms.length) filters.push(row => terms.some(([column, value]) => row[column] === value))
      return builder
    }
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
    if (name === 'gridex_record_customer_contract_event_v1') return { data: { event: { id: 'ev-1' }, contract_status: 'terminated', existing: false }, error: null }
    // H3d B5 (20261024100000): "Uppsägning mottagen" also asks for the fee review inside the binding.
    if (name === 'gridex_termination_break_fee_review_v1') return { data: { review_due: false, reason: 'no_binding' }, error: null }
    return { data: null, error: { code: '42883', message: `unexpected rpc ${name}` } }
  }
  return { supabaseService: { from, rpc } }
})

import { generateBillingUnderlaysForMonth } from '@/lib/billing/underlayEngine'
import { calculatePricingPreviewForUnderlay } from '@/lib/pricing/engine'
import { CONTRACT_END_REASONS_CARRYING_FINAL_PERIOD, contractCarriesBilledPeriod, contractEndedBySupplyPeriod } from '@/lib/billing/supplyPeriodEnd'
import { listExactBillableContractsByUnderlayIds } from '@/lib/billing/exportCenter'
import { contractNoticeEndDate, deriveContractEndsAt, getContractLifecycleSummary } from '@/lib/customer-contracts/lifecycle'
import { addCustomerContractEvent, ContractSupplyStillOpenError, getCustomerContractNoticeDays } from '@/lib/customer-contracts/db'
import { parseNoticeDays } from '@/components/admin/customers/contracts/helpers'

const COMPANY = 'co-h3d'
const NO_CONTRACT = 'Leveransperioden saknar ett aktivt eller signerat avtal.'
const NOT_COVERED = 'Avtalets giltighet täcker inte hela fakturasegmentet.'
// September in the Ediel month frame (supply received by Z04 at 1 August 00:00 +0200); the customer moved out on
// 15 September (last supplied day), so the final segment ends at civil midnight after it.
const SEP_START = '2026-08-31T23:00:00.000Z'
const MOVE_END = '2026-09-15T22:00:00.000Z'
const SEP_END = '2026-09-30T23:00:00.000Z'

const lifecycleClosed = (extra: Row = {}): Row => ({ id: 'sp-1', company_id: COMPANY, customer_id: 'cu-1', metering_point_id: 'mp-1', contract_id: 'ct-1', status: 'active',
  start_date: '2026-08-01', end_date: '2026-09-15', actual_end_date: null, market_start_at: '2026-07-31T22:00:00+00:00', market_end_at: null,
  metadata: { planned_end_source: 'customer_lifecycle_close', planned_end_reason: 'move_out' }, ...extra })
// gridex_close_customer_lifecycle_v2: terminated with ended_at = the notice end, after the last supplied day.
const runningOn = (extra: Row = {}): Row => ({ id: 'ct-1', company_id: COMPANY, customer_id: 'cu-1', metering_point_id: 'mp-1', status: 'terminated', termination_reason: 'move_out',
  ended_at: '2026-10-15T00:00:00+00:00', starts_at: '2026-08-01', ends_at: null, contract_type: 'fixed', energy_direction: 'consumption', ...extra })
const snapshot: Row = { id: 'snap-1', company_id: COMPANY, contract_id: 'ct-1', valid_from: '2026-08-01', valid_to: null, snapshot_json: { price_area: 'SE3', energy_direction: 'consumption' } }
const value = (end: string): Row => ({ id: 'nv-sep', company_id: COMPANY, customer_id: 'cu-1', metering_point_id: 'mp-1', supply_period_id: 'sp-1', source_metering_value_id: 'mv-sep', source_message_id: 'msg-1',
  revision_status: 'current', billing_status: 'billable', billing_gate_status: 'eligible', quantity_kwh: '361', unit: 'kWh', quality_status: 'measured', direction: 'consumption',
  product_code: null, period_start: SEP_START, period_end: end, billing_gate_snapshot: { status: 'eligible' },
  billing_source_message: { id: 'msg-1', company_id: COMPANY, message_family: 'UTILTS', status: 'validated' },
  billing_source_basis: { version: 1, qualified: true, normalizedValueId: 'nv-sep', sourceMessageId: 'msg-1', quantityType: '136', quantityKwh: '361', productCode: null, qualityEstablished: true, quality: null } })

async function september(period: Row, contract: Row, valueEnd = MOVE_END) {
  io.tables = { normalized_metering_values: [value(valueEnd)], customer_supply_periods: [period], customer_contracts: [contract], contract_price_snapshots: [snapshot] }
  io.rpcCalls = []
  const result = await generateBillingUnderlaysForMonth({ companyId: COMPANY, billingMonth: '2026-09', createdBy: 'automation' })
  const commands = io.rpcCalls.filter(call => call.name === 'gridex_store_billing_underlay_batch')
    .flatMap(call => (call.args.p_commands as Array<{ underlay: Row }>).map(command => command.underlay))
  return { result, commands }
}

beforeEach(() => { io.tables = {}; io.rpcCalls = [] })

describe('H3d D8 the final month of a contract that runs on after the supply ended', () => {
  for (const reason of ['move_out', 'grid_contract_ended', 'customer_termination']) {
    it(`${reason}: the segment up to the last supplied day is underlaid, priced and exported`, async () => {
      const { result, commands } = await september(lifecycleClosed(), runningOn({ termination_reason: reason }))
      expect(result.results.flatMap(entry => entry.warnings)).not.toContain(NO_CONTRACT)
      expect(result.results.map(entry => entry.status)).toEqual(['ready_for_pricing'])
      expect(commands).toEqual([expect.objectContaining({ contract_id: 'ct-1', billing_period_start: SEP_START, billing_period_end: MOVE_END })])
      const underlay = { ...commands[0], id: 'bu-sep', company_id: COMPANY, billing_period_start: '2026-09-01', billing_period_end: '2026-09-16',
        payload: { ...(commands[0].payload as Row), billing_period_start_instant: SEP_START, billing_period_end_instant: MOVE_END, billing_period_timezone: 'Europe/Stockholm', billing_period_end_exclusive: true } }
      io.tables.billing_underlays = [underlay]
      const preview = await calculatePricingPreviewForUnderlay({ companyId: COMPANY, billingUnderlayId: 'bu-sep', persist: false })
      expect(preview.errors).toEqual([])
      expect(preview.status).toBe('success')
      const map = await listExactBillableContractsByUnderlayIds({ companyId: COMPANY, underlays: [underlay as never] })
      expect(map.get('bu-sep')).toMatchObject({ id: 'ct-1', termination_reason: reason })
    })
  }

  it('a contract ended before its supply end is still refused (the segment is reviewed as a missing contract)', async () => {
    const { result, commands } = await september(lifecycleClosed(), runningOn({ ended_at: '2026-09-10T00:00:00+00:00' }))
    expect(result.results.flatMap(entry => entry.warnings)).toContain(NO_CONTRACT)
    expect(commands.every(command => command.readiness_status !== 'ready')).toBe(true)
  })

  it('the rule: on or after the period end date, the carrying reasons only, never past the supply end', () => {
    const period = lifecycleClosed()
    expect(CONTRACT_END_REASONS_CARRYING_FINAL_PERIOD).toEqual(['supply_end', 'move_out', 'grid_contract_ended', 'customer_termination'])
    expect(contractEndedBySupplyPeriod(runningOn(), period)).toBe(true)
    expect(contractEndedBySupplyPeriod(runningOn({ ended_at: '2026-09-15' }), period)).toBe(true)
    expect(contractEndedBySupplyPeriod(runningOn({ ended_at: '2026-09-14T22:00:00+00:00' }), period)).toBe(true)
    expect(contractEndedBySupplyPeriod(runningOn({ ended_at: '2026-09-14T00:00:00+00:00' }), period)).toBe(false)
    for (const reason of ['supplier_switch', 'customer_request', null, 'MOVE_OUT']) expect(contractEndedBySupplyPeriod(runningOn({ termination_reason: reason }), period)).toBe(false)
    expect(contractEndedBySupplyPeriod(runningOn({ status: 'cancelled' }), period)).toBe(false)
    expect(contractEndedBySupplyPeriod(runningOn(), lifecycleClosed({ end_date: null }))).toBe(false)
    expect(contractCarriesBilledPeriod(runningOn(), period, Date.parse(SEP_START), Date.parse(MOVE_END))).toBe(true)
    expect(contractCarriesBilledPeriod(runningOn(), period, Date.parse(SEP_START), Date.parse(SEP_END))).toBe(false)
  })
})

describe('H3d B3/D2 a registered termination keeps billing the continuing supply', () => {
  it('an active contract whose notice has expired still carries the supplied month (no "validity" review)', async () => {
    // "Uppsägning mottagen": ended_at = the planned end (10 September); no new supplier yet, so the supply continues.
    const { result } = await september(lifecycleClosed({ end_date: null, metadata: {} }), runningOn({ status: 'active', termination_reason: null, ended_at: '2026-09-10T00:00:00+00:00' }), SEP_END)
    expect(result.results.flatMap(entry => entry.warnings)).not.toContain(NOT_COVERED)
    expect(result.results.flatMap(entry => entry.warnings)).not.toContain(NO_CONTRACT)
    expect(result.results.map(entry => entry.status)).toEqual(['ready_for_pricing'])
  })

  it('the lifecycle summary shows the planned end from the notice months and days', () => {
    expect(contractNoticeEndDate('2026-10-10', 0, 14)).toBe('2026-10-24')
    expect(contractNoticeEndDate('2026-01-31', 1, 0)).toBe('2026-02-28')
    expect(contractNoticeEndDate(null, 1, 14)).toBeNull()
    expect(deriveContractEndsAt({ noticeMonths: 1, noticeDays: 14, terminationNoticeDate: '2026-10-10' })).toBe('2026-11-24')
    expect(deriveContractEndsAt({ noticeMonths: 1, terminationNoticeDate: '2026-10-10' })).toBe('2026-11-10')
    expect(getContractLifecycleSummary({ noticeDays: 14, terminationNoticeDate: '2026-10-10' }, '2026-10-12').noticeEffectiveEndDate).toBe('2026-10-24')
  })

  it("'Avslutat' is refused while the contract's supply is open, allowed once it has ended", async () => {
    io.tables.customer_supply_periods = [lifecycleClosed({ end_date: null, metadata: {}, customer_contract_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', contract_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })]
    const end = (eventType: 'terminated' | 'cancelled') => addCustomerContractEvent({ companyId: COMPANY, customerContractId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', customerId: 'cu-1', eventType, happenedAt: '2026-10-01' })
    await expect(end('terminated')).rejects.toBeInstanceOf(ContractSupplyStillOpenError)
    await expect(end('cancelled')).rejects.toBeInstanceOf(ContractSupplyStillOpenError)
    expect(io.rpcCalls).toEqual([])
    // A planned supply end after the contract's end date is still supplied after it.
    io.tables.customer_supply_periods[0].end_date = '2026-10-15'
    await expect(end('terminated')).rejects.toBeInstanceOf(ContractSupplyStillOpenError)
    io.tables.customer_supply_periods[0].end_date = '2026-09-30'
    await end('terminated')
    expect(io.rpcCalls.map(call => call.name)).toEqual(['gridex_record_customer_contract_event_v1'])
  })

  it("'Uppsägning mottagen' counts the contract's notice days (customer_contract_notice_terms)", async () => {
    const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    io.tables.customer_contracts = [{ id, company_id: COMPANY, customer_id: 'cu-1', status: 'active', starts_at: '2026-08-01', ends_at: null, binding_months: 0, notice_months: 1 }]
    io.tables.customer_contract_notice_terms = [{ customer_contract_id: id, company_id: COMPANY, notice_days: 14 }, { customer_contract_id: id, company_id: 'co-other', notice_days: 99 }]
    expect(await getCustomerContractNoticeDays(COMPANY, id)).toBe(14)
    expect(await getCustomerContractNoticeDays('co-other-tenant', id)).toBe(0)
    await addCustomerContractEvent({ companyId: COMPANY, customerContractId: id, customerId: 'cu-1', eventType: 'termination_notice_received', happenedAt: '2026-10-10' })
    expect(io.rpcCalls.find(call => call.name === 'gridex_record_customer_contract_event_v1')?.args.p_derived_ends_at).toBe('2026-11-24')
  })

  it('the form accepts notice days 0..366 only', () => {
    expect(parseNoticeDays('14')).toBe(14)
    expect(parseNoticeDays('')).toBeNull()
    expect(parseNoticeDays(null)).toBeNull()
    for (const bad of ['-1', '367', '1.5', 'x']) expect(() => parseNoticeDays(bad)).toThrow(/0 och 366/)
  })
})
