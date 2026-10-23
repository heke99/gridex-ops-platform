// reality-defects: F108 (supply start in Ediel fixed normal time against Swedish civil midnight)
// The grid owner's Z04 says DTM+92 202609010000 with DTM+ZZZ:1:805: 00:00 in fixed Swedish normal time (UTC+1),
// i.e. 2026-08-31T23:00Z (ENV-08, PRODAT field 206 "alltid 1 för både normaltid och sommartid"). The platform
// stores market_start_at = 2026-08-31T23:00Z and the database's qualified supply basis
// (gridex_received_sources.billing_supply_basis_v1) refuses any value that starts before it. Before the fix the
// TypeScript billing paths read only start_date as a civil Stockholm day (from 22:00Z in summer):
//   * the value matcher sent the four quarter-hours 22:00Z–23:00Z as "eligible", the database refused them, and the
//     matcher recorded them as `supply_source_unqualified` with a period-wide item claiming the (qualified) supply
//     source was unqualified (world run 26: 12 values, 3 open items for 3 qualified periods);
//   * the TypeScript gate reported the value as covered by the period;
//   * the monthly underlay started the September segment at civil midnight, so the hour no supplier of ours can
//     bill became a "Mätvärdeslucka" that blocks the underlay of every summer-time supply start;
//   * invoice readiness measured metering completeness against the whole civil month, not the supplied part.
// Synthetic ids only. Calls the code; nothing reads source text.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  inserts: [] as Array<{ table: string; row: Row }>,
  gate: 'real' as 'real' | 'stub',
}))

vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/billing/invoiceReadiness', async original => ({ ...await original<Record<string, unknown>>(), assertBillingPeriodOpen: async () => undefined, getBillingPeriodLock: async () => null }))
vi.mock('@/lib/billing/historyRequest', () => ({ ensureHistoricalMeteringRequest: async () => 'already_requested' }))
vi.mock('@/lib/billing/consumptionEstimate', async original => ({
  ...await original<Record<string, unknown>>(),
  companyEstimatesMissingConsumption: async () => false,
  estimateMissingConsumption: async () => null,
}))
// The database qualifies each value; here the stored row is its own qualified row.
vi.mock('@/lib/billing/sourceBasis', () => ({
  loadQualifiedBillingValues: async (_company: string, ids: string[]) => {
    const rows = new Map((io.tables.normalized_metering_values ?? []).map(row => [String(row.id), row]))
    return new Map(ids.map(id => [id, rows.get(id) ?? { id, source_message_id: 'msg-1' }]))
  },
}))
vi.mock('@/lib/billing/billingGate', async original => {
  const real = await original<typeof import('@/lib/billing/billingGate')>()
  return {
    ...real,
    // 'stub': every check except the supply period passes, so the matcher's period choice decides the outcome.
    evaluateBillingGate: (input: Parameters<typeof real.evaluateBillingGate>[0]) => io.gate === 'real' ? real.evaluateBillingGate(input)
      : input.supplyPeriod && (input.supplyPeriodCandidateCount ?? 1) === 1
        ? { status: 'eligible', eligible: true, reasons: [], snapshot: { gate_version: 'stub' } }
        : { status: 'pending_match', eligible: false, reasons: [{ code: 'supply_period_missing', message: 'Ingen leveransperiod täcker hela mätvärdet.' }], snapshot: {} },
  }
})
vi.mock('@/lib/supabase/service', () => {
  const from = (table: string) => {
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'lt', 'gt', 'lte', 'gte', 'or', 'not', 'order', 'neq', 'contains', 'in', 'limit', 'range', 'update', 'is', 'filter', 'match']) builder[method] = () => builder
    let ranged = false
    builder.range = (a: number) => { ranged = true; return Object.assign(builder, { __from: a }) }
    const rows = () => {
      const all = io.tables[table] ?? []
      return ranged ? all.slice(Number(builder.__from ?? 0), Number(builder.__from ?? 0) + 1000) : all
    }
    builder.insert = async (row: Row) => { io.inserts.push({ table, row }); return { error: null } }
    builder.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null })
    builder.single = builder.maybeSingle
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject)
    return builder
  }
  const rpc = async (name: string, args: Record<string, unknown>) => {
    io.rpcCalls.push({ name, args })
    if (name === 'gridex_set_metering_billing_gate') {
      // The live gate: an eligible value must lie inside the qualified supply basis, which starts at market_start_at.
      const gate = args.p_gate as Row
      if (gate.billing_gate_status === 'eligible') {
        const period = (io.tables.customer_supply_periods ?? []).find(row => row.id === gate.supply_period_id)
        const value = (io.tables.metering_values ?? [])[0]
        if (period?.market_start_at && Date.parse(String(period.market_start_at)) > Date.parse(String(value?.period_start)))
          return { data: null, error: { code: '23514', message: 'billing_gate_qualified_supply_source_required', details: null, hint: null } }
      }
      return { data: null, error: null }
    }
    if (name === 'gridex_store_billing_underlay_batch') return { data: (args.p_commands as unknown[]).map((_, index) => `stored-${index}`), error: null }
    if (name === 'gridex_store_billing_underlay') return { data: 'stored', error: null }
    if (name === 'gridex_read_billing_underlay_source_basis_v1') return { data: (args.p_underlay_ids as string[]).map(id => ({ id, qualified: true, correctionRequired: false, totalKwh: '719' })), error: null }
    return { data: null, error: { code: '42883', message: `unexpected rpc ${name}` } }
  }
  return { supabaseService: { from, rpc } }
})

import { evaluateBillingGate } from '@/lib/billing/billingGate'
import { updateMeterValueBillingReadiness } from '@/lib/billing/meterValueBillingMatcher'
import { generateBillingUnderlaysForMonth } from '@/lib/billing/underlayEngine'
import { evaluateMeteringCompletenessForMonth } from '@/lib/metering/validation'
import { supplyPeriodStartInstant } from '@/lib/billing/supplyPeriodEnd'
import { evaluateBillingMonthInvoiceReadiness } from '@/lib/billing/invoiceReadiness'

const COMPANY = 'co-f108'
const Q = 15 * 60_000
// A Z04-started period: the grid owner's DTM+92 202609010000 (+0100) = 2026-08-31T23:00Z (summer: 01:00 local).
const summerStart = { id: 'sp-1', company_id: COMPANY, customer_id: 'cu-1', metering_point_id: 'mp-1', contract_id: 'ct-1', status: 'active',
  start_date: '2026-09-01', end_date: null, market_start_at: '2026-08-31T23:00:00+00:00', market_end_at: null }
const contract = { id: 'ct-1', company_id: COMPANY, customer_id: 'cu-1', metering_point_id: 'mp-1', status: 'active', starts_at: '2026-09-01', energy_direction: 'consumption' }
const quarter = (startIso: string) => ({ period_start: startIso, period_end: new Date(Date.parse(startIso) + Q).toISOString() })

function gateValue(startIso: string) {
  return { id: 'nv-1', company_id: COMPANY, metering_point_id: 'mp-1', customer_id: 'cu-1', source_metering_value_id: 'mv-1', source_message_id: 'msg-1',
    quantity_kwh: '0.25', unit: 'kWh', revision_status: 'current', quality_status: 'measured', ...quarter(startIso) }
}
const coverReason = (period: Row, startIso: string) => evaluateBillingGate({ normalizedValue: gateValue(startIso), supplyPeriod: period, contract })
  .reasons.some(reason => reason.code === 'supply_period_does_not_cover_value')

beforeEach(() => { io.tables = {}; io.rpcCalls = []; io.inserts = []; io.gate = 'real' })

describe('F108 the supply period starts at the received market instant (ENV-08 fixed normal time)', () => {
  it('reads market_start_at as the start and keeps civil midnight only for a period without a market instant', () => {
    expect(new Date(supplyPeriodStartInstant(summerStart)!).toISOString()).toBe('2026-08-31T23:00:00.000Z')
    expect(new Date(supplyPeriodStartInstant({ start_date: '2026-09-01' })!).toISOString()).toBe('2026-08-31T22:00:00.000Z')
    // Winter: 00:00 +0100 is local midnight; both readings agree.
    expect(new Date(supplyPeriodStartInstant({ start_date: '2026-12-01', market_start_at: '2026-11-30T23:00:00Z' })!).toISOString()).toBe('2026-11-30T23:00:00.000Z')
    expect(supplyPeriodStartInstant({ start_date: null })).toBeNull()
  })

  it('the TypeScript gate does not let the period cover the first civil hour before the market start', () => {
    expect(coverReason(summerStart, '2026-08-31T22:00:00Z')).toBe(true)
    expect(coverReason(summerStart, '2026-08-31T22:45:00Z')).toBe(true)
    expect(coverReason(summerStart, '2026-08-31T23:00:00Z')).toBe(false)
    // A manual period without a market instant keeps the civil day (unchanged behaviour).
    expect(coverReason({ ...summerStart, market_start_at: null }, '2026-08-31T22:00:00Z')).toBe(false)
  })
})

describe('F108 value matcher: a quarter-hour before the market start is outside the period, not "supply source unqualified"', () => {
  function world(startIso: string) {
    io.gate = 'stub'
    io.tables = {
      normalized_metering_values: [{ id: 'nv-1', company_id: COMPANY, source_metering_value_id: 'mv-1', revision_status: 'current', source_message_id: 'msg-1' }],
      metering_values: [{ id: 'mv-1', ...quarter(startIso) }],
      customer_supply_periods: [summerStart],
      customer_contracts: [contract],
      ediel_unresolved_items: [],
    }
    return { id: 'mv-1', company_id: COMPANY, metering_point_id: 'mp-1', ...quarter(startIso) } as never
  }

  it('22:00Z on 31 August (00:00 local on 1 September) is held as outside every supply period, without asking the database to bill it', async () => {
    await expect(updateMeterValueBillingReadiness({ meterValue: world('2026-08-31T22:00:00Z'), sourceMessageId: 'msg-1' })).resolves.toBe('pending_match')
    const gates = io.rpcCalls.filter(call => call.name === 'gridex_set_metering_billing_gate').map(call => call.args.p_gate as Row)
    expect(gates).toHaveLength(1)
    expect(gates[0]).toMatchObject({ billing_gate_status: 'pending_match', supply_period_id: null })
    expect((gates[0].billing_gate_reasons as Array<{ code: string }>).map(reason => reason.code)).not.toContain('supply_source_unqualified')
    const items = io.inserts.filter(insert => insert.table === 'ediel_unresolved_items').map(insert => insert.row)
    expect(items).toEqual([expect.objectContaining({ issue_type: 'billing_period_missing' })])
    expect((items[0].extracted_identifiers as Row).reasonCodes).not.toContain('supply_source_unqualified')
  })

  it('23:00Z on 31 August is matched to the period and billed', async () => {
    await expect(updateMeterValueBillingReadiness({ meterValue: world('2026-08-31T23:00:00Z'), sourceMessageId: 'msg-1' })).resolves.toBe('billable')
    const gates = io.rpcCalls.filter(call => call.name === 'gridex_set_metering_billing_gate').map(call => call.args.p_gate as Row)
    expect(gates).toEqual([expect.objectContaining({ billing_gate_status: 'eligible', supply_period_id: 'sp-1' })])
  })
})

describe('F108 September underlay and completeness for a summer-time supply start', () => {
  // Every quarter-hour the grid owner's fixed-CET E66 files deliver to the new supplier: 23:00Z 31 Aug – 22:00Z 30 Sep
  // inside civil September (2 876 quarter-hours; civil September has 2 880).
  const starts: string[] = []
  for (let t = Date.parse('2026-08-31T23:00:00Z'); t < Date.parse('2026-09-30T22:00:00Z'); t += Q) starts.push(new Date(t).toISOString())
  const values = starts.map((start, index) => ({ id: `nv-${index}`, company_id: COMPANY, customer_id: 'cu-1', metering_point_id: 'mp-1', supply_period_id: 'sp-1',
    source_metering_value_id: `mv-${index}`, source_message_id: 'msg-1', revision_status: 'current', billing_status: 'billable', billing_gate_status: 'eligible',
    quantity_kwh: '0.25', unit: 'kWh', quality_status: 'measured', direction: 'consumption', ...quarter(start) }))

  it('the September segment starts at the market start: no "Mätvärdeslucka" for the hour no supplier of ours can bill', async () => {
    io.tables = {
      normalized_metering_values: values,
      customer_supply_periods: [summerStart],
      customer_contracts: [contract],
      contract_price_snapshots: [{ id: 'snap-1', contract_id: 'ct-1', valid_from: '2026-09-01', valid_to: null, snapshot_json: { price_area: 'SE3', energy_direction: 'consumption' } }],
      billing_underlays: [],
    }
    const result = await generateBillingUnderlaysForMonth({ companyId: COMPANY, billingMonth: '2026-09', createdBy: 'automation' })
    const warnings = result.results.flatMap(entry => entry.warnings)
    expect(warnings.filter(warning => warning.includes('Mätvärdeslucka'))).toEqual([])
    const stored = io.rpcCalls.filter(call => call.name.startsWith('gridex_store_billing_underlay'))
      .flatMap(call => call.name.endsWith('_batch') ? (call.args.p_commands as Array<{ underlay: Row }>).map(command => command.underlay) : [call.args.p_underlay as Row])
    expect(stored).toEqual([expect.objectContaining({ billing_period_start: '2026-08-31T23:00:00.000Z', billing_period_end: '2026-09-30T22:00:00.000Z', missing_values_count: 0 })])
  }, 60_000)

  it('metering completeness is measured against the supplied window, not the whole civil month', async () => {
    io.tables = { normalized_metering_values: values }
    const month = await evaluateMeteringCompletenessForMonth({ companyId: COMPANY, billingMonth: '2026-09', meteringPoints: [{ meteringPointId: 'mp-1' }] })
    // Without a window the whole civil month is required: the hour before the market start is a gap (unchanged).
    expect(month.issues.map(issue => issue.code)).toContain('metering_gap')
    const supplied = await evaluateMeteringCompletenessForMonth({ companyId: COMPANY, billingMonth: '2026-09',
      meteringPoints: [{ meteringPointId: 'mp-1', windows: [{ start: '2026-08-31T23:00:00.000Z', end: '2026-09-30T22:00:00.000Z' }] }] })
    expect(supplied.issues.filter(issue => issue.severity === 'blocked')).toEqual([])
    // A real gap inside the window (8 hours) still blocks.
    io.tables = { normalized_metering_values: values.filter((_, index) => index < 100 || index >= 132) }
    const gap = await evaluateMeteringCompletenessForMonth({ companyId: COMPANY, billingMonth: '2026-09',
      meteringPoints: [{ meteringPointId: 'mp-1', windows: [{ start: '2026-08-31T23:00:00.000Z', end: '2026-09-30T22:00:00.000Z' }] }] })
    expect(gap.issues.map(issue => issue.code)).toContain('metering_gap')
  })
  it('invoice readiness requires completeness only for the stored underlay segment of the month', async () => {
    io.tables = {
      normalized_metering_values: values,
      billing_underlays: [{ id: 'bu-1', company_id: COMPANY, customer_id: 'cu-1', contract_id: 'ct-1', metering_point_id: 'mp-1', status: 'validated', readiness_status: 'ready',
        total_kwh: 719, missing_values_count: 0, billing_period_start: '2026-09-01', billing_period_end: '2026-10-01',
        payload: { billing_period_start_instant: '2026-08-31T23:00:00+00:00', billing_period_end_instant: '2026-09-30T22:00:00+00:00', billing_period_timezone: 'Europe/Stockholm', billing_period_end_exclusive: true } }],
    }
    const readiness = await evaluateBillingMonthInvoiceReadiness({ companyId: COMPANY, billingMonth: '2026-09' })
    const codes = (readiness as { issues: Array<{ code: string }> }).issues.map(issue => issue.code)
    // Before the fix: "Mätvärden täcker bara 99.9 % av perioden (1 h saknas)" blocked every summer-time supply start.
    expect(codes).not.toContain('metering_gap')
  })
})
