// simulation: TERM03.04, TERM03.05
// COMPONENT only: actual lifecycle and underlay code, finite persistence ports.
// This does not prove normal supply termination, source qualification, Auth/RLS,
// persisted invoices or whole-scenario acceptance. Supply end_date is inclusive;
// notice-derived lifecycle boundaries must not silently redefine that convention.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type Command = { underlay: Row; items: Row[] }
const io = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, commands: [] as Command[] }))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => {
    const predicates: Array<(row: Row) => boolean> = []
    let limit = Infinity
    const rows = () => (io.tables[table] ?? []).filter(row => predicates.every(p => p(row))).slice(0, limit)
    const result = () => ({ data: rows(), error: null })
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return query },
      in: (key: string, values: unknown[]) => { predicates.push(row => values.includes(row[key])); return query },
      not: (key: string, operator: string, value: unknown) => {
        expect([operator, value]).toEqual(['is', null])
        predicates.push(row => row[key] != null); return query
      },
      lt: (key: string, value: string) => { predicates.push(row => String(row[key]) < value); return query },
      gt: (key: string, value: string) => { predicates.push(row => String(row[key]) > value); return query },
      lte: (key: string, value: string) => { predicates.push(row => String(row[key]) <= value); return query },
      or: (expression: string) => {
        const [nullable, comparison] = expression.split(',')
        const [key, operator, value] = comparison.split('.')
        expect(nullable).toBe(`${key}.is.null`)
        expect(operator).toBe('gte')
        predicates.push(row => row[key] == null || String(row[key]) >= value); return query
      },
      order: () => query,
      limit: (n: number) => { limit = n; return query },
      range: async (from: number, to: number) => ({ data: rows().slice(from, to + 1), error: null }),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: <T,>(resolve: (response: ReturnType<typeof result>) => T) => Promise.resolve(result()).then(resolve),
    }
    return query
  },
  rpc: async (name: string, args: Row) => {
    expect(name).toBe('gridex_store_billing_underlay_batch')
    expect(args.p_company_id).toBe('tenant-a')
    const commands = args.p_commands as Command[]
    io.commands.push(...commands)
    return { data: commands.map((_, i) => `component-underlay-${i}`), error: null }
  },
} }))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/billing/invoiceReadiness', () => ({ assertBillingPeriodOpen: async () => undefined, getBillingPeriodLock: async () => null }))
vi.mock('@/lib/billing/sourceBasis', () => ({
  // Explicitly ported qualification: no received E66/source authority is asserted.
  loadQualifiedBillingValues: async (company: string, ids: string[]) => new Map(
    (io.tables.normalized_metering_values ?? []).filter(row => row.company_id === company && ids.includes(String(row.id)))
      .map(row => [String(row.id), row]),
  ),
}))
vi.mock('@/lib/billing/billingGate', () => ({ evaluateBillingGate: () => ({ eligible: true, reasons: [] }) }))
vi.mock('@/lib/billing/consumptionEstimate', () => ({
  companyEstimatesMissingConsumption: async () => false,
  estimateMissingConsumption: async () => { throw new Error('unexpected estimation') },
  missingWindows: () => [],
}))
vi.mock('@/lib/billing/historyRequest', () => ({
  ensureHistoricalMeteringRequest: async () => { throw new Error('unexpected history request') },
}))

import { generateBillingUnderlaysForMonth } from '@/lib/billing/underlayEngine'
import { deriveContractEndsAt, getContractLifecycleSummary } from '@/lib/customer-contracts/lifecycle'

const validityWarning = 'Avtalets giltighet täcker inte hela fakturasegmentet.'
const hour = 3_600_000
// Winter Stockholm midnight, independent literal UTC boundary.
const firstMidnight = Date.parse('2026-12-31T23:00:00.000Z')
function values(hours: number): Row[] {
  return Array.from({ length: hours }, (_, i) => ({
    id: `value-${i}`, company_id: 'tenant-a', customer_id: 'customer-a', metering_point_id: 'meter-a',
    supply_period_id: 'supply-a', site_id: 'site-a',
    period_start: new Date(firstMidnight + i * hour).toISOString(),
    period_end: new Date(firstMidnight + (i + 1) * hour).toISOString(),
    quantity_kwh: '1', unit: 'kWh', direction: 'consumption', price_area: 'SE3',
    revision_status: 'current', billing_status: 'billable', billing_gate_status: 'eligible',
    billing_gate_snapshot: { status: 'eligible' }, metadata: {},
  }))
}

beforeEach(() => {
  io.commands = []
  io.tables = {
    normalized_metering_values: values(24),
    customer_supply_periods: [{ id: 'supply-a', company_id: 'tenant-a', customer_id: 'customer-a',
      metering_point_id: 'meter-a', contract_id: 'contract-a', site_id: 'site-a',
      status: 'ended', start_date: '2027-01-01', end_date: '2027-01-01' }],
    customer_contracts: [{ id: 'contract-a', company_id: 'tenant-a', customer_id: 'customer-a',
      metering_point_id: 'meter-a', starts_at: '2026-01-01', status: 'terminated',
      ended_at: '2027-01-01', termination_reason: 'supply_end', energy_direction: 'consumption' }],
    contract_price_snapshots: [{ id: 'snapshot-a', company_id: 'tenant-a', contract_id: 'contract-a',
      valid_from: '2026-01-01', valid_to: null, snapshot_schema_version: 'gridex_contract_pricing_v7_signed_receipt',
      snapshot_json: { pricing_model: 'spot', price_area: 'SE3', energy_direction: 'consumption' } }],
  }
})

async function generate() {
  return generateBillingUnderlaysForMonth({ companyId: 'tenant-a', billingMonth: '2027-01' })
}

describe('TERM03 component supply-end boundaries through the real underlay entrypoint', () => {
  it('retains the final inclusive supply day of a terminated contract', async () => {
    const result = await generate()
    expect(result.results).toHaveLength(1)
    expect(result.results[0]).toMatchObject({ status: 'ready_for_pricing', warnings: [] })
    expect(io.commands).toHaveLength(1)
    expect(io.commands[0].underlay).toMatchObject({ total_kwh: '24',
      billing_period_start: '2026-12-31T23:00:00.000Z', billing_period_end: '2027-01-01T23:00:00.000Z' })
    expect(io.commands[0].items).toHaveLength(24)
  })

  it('excludes the next day from store commands and holds its orphaned values', async () => {
    io.tables.normalized_metering_values = values(48)
    const result = await generate()
    expect(io.commands).toHaveLength(1)
    expect(io.commands[0].underlay.total_kwh).toBe('24')
    expect(io.commands[0].items.map(row => row.source_normalized_metering_value_id))
      .toEqual(Array.from({ length: 24 }, (_, i) => `value-${i}`))
    expect(result.results).toContainEqual(expect.objectContaining({
      underlayId: null, status: 'needs_review', sourceRows: 24,
      warnings: [expect.stringContaining('saknar en entydig leveransperiod')],
    }))
  })

  it('holds a supply segment extending past the completed contract end', async () => {
    io.tables.customer_supply_periods[0].end_date = '2027-01-02'
    io.tables.normalized_metering_values = values(48)
    const result = await generate()
    expect(result.readyForPricing).toBe(0)
    expect(result.results[0]).toMatchObject({ status: 'needs_review', warnings: [validityWarning] })
    expect(io.commands[0].underlay.readiness_status).toBe('blocked')
    expect(io.commands[0].items.every(row => row.status === 'needs_review')).toBe(true)
  })

  it('preserves an earlier explicit signed end when the terminal supply date is later', async () => {
    io.tables.customer_contracts[0].ends_at = '2026-12-31'
    const result = await generate()
    expect(result.readyForPricing).toBe(0)
    expect(result.results[0].warnings).toContain(validityWarning)
    expect(io.commands[0].underlay.readiness_status).toBe('blocked')
  })

  it('does not bill the notice boundary day when supply ends on the preceding civil day', async () => {
    const notice = { actualStartDate: '2026-01-02', startsAt: null, bindingMonths: 12,
      noticeMonths: 1, terminationNoticeDate: '2026-12-02', status: 'active' as const }
    const end = deriveContractEndsAt(notice)
    expect(end).toBe('2027-01-02')
    expect(getContractLifecycleSummary(notice, '2027-01-02').bindingActive).toBe(false)
    Object.assign(io.tables.customer_contracts[0], { status: 'active', ended_at: end,
      termination_reason: null, termination_notice_date: '2026-12-02' })
    io.tables.normalized_metering_values = values(48)
    const result = await generate()
    expect(io.commands).toHaveLength(1)
    expect(io.commands[0].underlay.total_kwh).toBe('24')
    expect(io.commands[0].items.at(-1)?.period_end).toBe('2027-01-01T23:00:00.000Z')
    expect(result.needsReview).toBe(1)
  })
})
