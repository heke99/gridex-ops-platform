// reality-defects: J2-02
// FINDINGS J2-02 / owner decision 40: a metering correction of an invoiced period is priced through the same pricing
// engine entry point as every underlay, over its ORIGINAL period (the original month's price, not the run month's),
// with energy components only (no monthly or invoice fee again), every line bound to the correction and the original
// invoice; a negative correction is a credit (negative lines). The run reads the database result strictly, a database
// refusal never fails the month, and the reconciliation check stops flagging a correction once it is covered.
// Harness of reality-d11-break-fee-engine. Synthetic ids only; calls the code.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PriceComponent } from '@/lib/pricing/types'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  priceMonths: [] as string[],
  rpcResult: null as null | { data: unknown; error: unknown },
  basis: [] as Row[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/billing/invoiceReadiness', async original => ({ ...await original<Record<string, unknown>>(), assertBillingPeriodOpen: async () => undefined, getBillingPeriodLock: async () => null }))
const monthlyFee: PriceComponent = { componentType: 'fixed_monthly_fee', name: 'Månadsavgift', calculationType: 'fixed_monthly', amount: 49, unit: 'sek_month', vatApplicable: true }
const invoiceFee: PriceComponent = { componentType: 'invoice_fee', name: 'Fakturaavgift', calculationType: 'fixed_once', amount: 29, unit: 'sek_invoice', vatApplicable: true }
const markup: PriceComponent = { componentType: 'markup_ore_per_kwh', name: 'Påslag', calculationType: 'per_kwh', amount: 5, unit: 'ore_per_kwh', vatApplicable: true }
// A fixed energy price of 1 SEK/kWh; the base price month is recorded to prove the original period is priced.
vi.mock('@/lib/pricing/priceSourceResolver', () => ({
  resolvePricingConfiguration: async () => ({ baseComponents: [{ sourceType: 'fixed', weightPercent: 100, fixedPriceSekPerKwh: 1 }],
    priceComponents: [monthlyFee, invoiceFee, markup], vatRate: 0.25, warnings: [] }),
  resolveBasePriceSourceValues: async (input: { billingMonth: string }) => { io.priceMonths.push(input.billingMonth); return { fixedSekPerKwh: 1 } },
}))
vi.mock('@/lib/pricing/spot/spotImportScheduler', () => ({ ensureSpotPricesForBillingMonth: async () => { throw new Error('spot import not expected') } }))
vi.mock('@/lib/pricing/spot/spotPriceImporter', () => ({ importSpotPricesForDayArea: async () => { throw new Error('spot import not expected') } }))
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
    if (name === 'gridex_persist_pricing_run') return { data: 'run-1', error: null }
    if (name === 'gridex_record_metering_billing_corrections_v1') return io.rpcResult ?? { data: null, error: { code: '42883', message: 'missing' } }
    if (name === 'gridex_read_billing_underlay_source_basis_v1') return { data: (args.p_underlay_ids as string[]).map(id => io.basis.find(b => b.id === id) ?? { id, qualified: true, correctionRequired: false }), error: null }
    return { data: null, error: { code: '42883', message: `unexpected rpc ${name}` } }
  }
  return { supabaseService: { from, rpc } }
})

import { calculatePricingPreviewForUnderlay } from '@/lib/pricing/engine'
import { meteringCorrectionResults, parseMeteringCorrectionRun, recordMeteringCorrectionsAfterBilling } from '@/lib/billing/meteringCorrection'
import { correctionBlockerCount } from '@/lib/billing/monthlyAutomation'
import { runProductionConsistencyChecks } from '@/lib/ops/reconciliation'

const CO = 'co-j202'
const contract: Row = { id: 'ct-1', company_id: CO, customer_id: 'cu-1', metering_point_id: 'mp-1', status: 'active', starts_at: '2026-09-01',
  contract_type: 'fixed', energy_direction: 'consumption', fixed_price_ore_per_kwh: 100 }
const snapshot: Row = { id: 'snap-1', company_id: CO, contract_id: 'ct-1', valid_from: '2026-09-01', valid_to: null, snapshot_json: { price_area: 'SE3', energy_direction: 'consumption' } }
// The correction document as gridex_metering_correction_underlay_v1 creates it: run month October, original period 10 September.
const correctionUnderlay = (direction: 'charge' | 'credit'): Row => ({ id: 'bu-corr', company_id: CO, customer_id: 'cu-1', metering_point_id: 'mp-1', contract_id: 'ct-1',
  customer_contract_id: 'ct-1', supply_period_id: 'sp-1', contract_price_snapshot_id: 'snap-1', pricing_snapshot_id: 'snap-1', underlay_year: 2026, underlay_month: 10,
  billing_period_start: '2026-09-10', billing_period_end: '2026-09-11', status: 'validated', readiness_status: 'ready', total_kwh: '0.288', price_area: 'SE3',
  energy_direction: direction === 'credit' ? 'consumption_correction' : 'consumption', settlement_type: direction === 'credit' ? 'credit_invoice' : 'invoice',
  source_system: 'metering_correction_after_billing',
  payload: { charge_kind: 'metering_correction', metering_correction_id: 'mc-1', correction_direction: direction, original_billing_underlay_id: 'bu-orig',
    original_invoice_id: 'inv-orig', original_billing_month: '2026-09', billing_period_start_instant: '2026-09-09T23:00:00Z', billing_period_end_instant: '2026-09-10T23:00:00Z',
    billing_period_timezone: 'Europe/Stockholm', billing_period_end_exclusive: true } })
// The same underlay as a regular September underlay: the fees are charged there (contrast for the negative case).
const regularUnderlay: Row = { ...correctionUnderlay('charge'), id: 'bu-reg', underlay_month: 9, billing_period_start: '2026-09-01', billing_period_end: '2026-10-01',
  source_system: 'normalized_metering_values', total_kwh: '100', payload: { billing_period_start_instant: '2026-08-31T23:00:00Z', billing_period_end_instant: '2026-09-30T23:00:00Z',
    billing_period_timezone: 'Europe/Stockholm', billing_period_end_exclusive: true } }

beforeEach(() => {
  io.tables = { billing_underlays: [correctionUnderlay('charge'), regularUnderlay], customer_contracts: [contract], contract_price_snapshots: [snapshot] }
  io.rpcCalls = []; io.priceMonths = []; io.rpcResult = null; io.basis = []
})

describe('J2-02 pricing of a metering correction of an invoiced period', () => {
  it('a positive correction is charged once over the original period: energy and per-kWh components only, bound to the original invoice', async () => {
    const preview = await calculatePricingPreviewForUnderlay({ companyId: CO, billingUnderlayId: 'bu-corr', persist: true })
    expect(preview.errors).toEqual([])
    expect(preview.status).toBe('success')
    // The original month's prices (September), not the run month (October).
    expect(io.priceMonths).toEqual(['2026-09'])
    expect(preview.lines.map(line => line.lineType).sort()).not.toContain('fixed_monthly_fee')
    expect(preview.lines.some(line => /Månadsavgift|Fakturaavgift/.test(line.description))).toBe(false)
    // 0.288 kWh × (1 SEK + 0.05 SEK) = 0.3024 SEK ex VAT.
    expect(preview.totalExVat).toBeCloseTo(0.3, 2)
    expect(preview.totalExVat).toBeGreaterThan(0)
    for (const line of preview.lines) {
      expect(line.description).toMatch(/^Rättelse av mätvärden 2026-09 \(tilläggsdebitering/)
      expect(line.metadata).toMatchObject({ metering_correction_id: 'mc-1', correction_of_invoice_id: 'inv-orig', correction_of_billing_underlay_id: 'bu-orig' })
    }
    expect(io.rpcCalls.filter(call => call.name === 'gridex_persist_pricing_run')).toHaveLength(1)
  })

  it('a negative correction is a credit: every line negative, no fee credited', async () => {
    io.tables.billing_underlays = [correctionUnderlay('credit')]
    const preview = await calculatePricingPreviewForUnderlay({ companyId: CO, billingUnderlayId: 'bu-corr', persist: false })
    expect(preview.errors).toEqual([])
    expect(preview.totalExVat).toBeLessThan(0)
    expect(preview.lines.length).toBeGreaterThan(0)
    expect(preview.lines.every(line => line.amountExVat < 0)).toBe(true)
    expect(preview.lines.some(line => /Månadsavgift|Fakturaavgift/.test(line.description))).toBe(false)
    expect(preview.lines.every(line => (line.metadata as Row).correction_of_invoice_id === 'inv-orig')).toBe(true)
  })

  it('negative control: the regular month underlay of the same contract does carry the monthly fee', async () => {
    const preview = await calculatePricingPreviewForUnderlay({ companyId: CO, billingUnderlayId: 'bu-reg', persist: false })
    expect(preview.lines.some(line => line.lineType === 'fixed_monthly_fee')).toBe(true)
    expect(preview.lines.some(line => /^Rättelse/.test(line.description))).toBe(false)
  })
})

const run = (corrections: Row[], outcome = 'recorded', pending = 0) => ({ billingMonth: '2026-10', originals: 1, truncated: false,
  results: [{ originalUnderlayId: 'bu-orig', originalInvoiceId: 'inv-orig', outcome, pending, corrections }] })

describe('J2-02 the billing run reads the database result', () => {
  it('a recorded correction document is ready for pricing; nothing else blocks the run', async () => {
    io.rpcResult = { data: run([{ correctionId: 'mc-1', underlayId: 'bu-corr', status: 'underlaid', direction: 'charge', deltaKwh: 0.288, revisions: 24, flow: 'next_invoice' }]), error: null }
    const result = await recordMeteringCorrectionsAfterBilling({ companyId: CO, billingMonth: '2026-10', actorUserId: 'actor' })
    expect(io.rpcCalls.at(-1)).toEqual({ name: 'gridex_record_metering_billing_corrections_v1', args: { p_company_id: CO, p_billing_month: '2026-10', p_scope: {}, p_actor_user_id: 'actor' } })
    expect(result.error).toBeNull()
    expect(meteringCorrectionResults(result)).toEqual([expect.objectContaining({ underlayId: 'bu-corr', status: 'ready_for_pricing' })])
    expect(correctionBlockerCount(result)).toBe(0)
  })

  it('a correction over the approval limit is not dropped: it is a blocker of the run and a review row', async () => {
    io.rpcResult = { data: run([{ correctionId: 'mc-2', underlayId: null, status: 'pending_approval', direction: 'credit', deltaKwh: 900, revisions: 96, approvalRequired: true }]), error: null }
    const result = await recordMeteringCorrectionsAfterBilling({ companyId: CO, billingMonth: '2026-10' })
    expect(correctionBlockerCount(result)).toBe(1)
    expect(meteringCorrectionResults(result)).toEqual([expect.objectContaining({ underlayId: null, status: 'needs_review',
      warnings: [expect.stringMatching(/^metering_correction_pending_approval: .*kreditering 900 kWh.*manuellt godkännande/)] })])
  })

  it('a database refusal never fails the month; it is reported and counted', async () => {
    io.rpcResult = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
    const result = await recordMeteringCorrectionsAfterBilling({ companyId: CO, billingMonth: '2026-10' })
    expect(result.error).toMatch(/^canceling statement due to statement timeout/)
    expect(correctionBlockerCount(result)).toBe(1)
    expect(meteringCorrectionResults(result)[0].warnings[0]).toMatch(/^metering_correction_failed/)
  })

  it('an unexpected result shape is an error, never an empty success', () => {
    expect(() => parseMeteringCorrectionRun({ billingMonth: '2026-09', results: [] }, '2026-10')).toThrow('metering_correction_result_invalid')
    expect(() => parseMeteringCorrectionRun(run([{ correctionId: 'mc-1', status: 'deleted' }]), '2026-10')).toThrow('metering_correction_result_invalid')
  })
})

describe('J2-02 reconciliation', () => {
  const check = async (key: string) => (await runProductionConsistencyChecks({ companyId: CO })).checks.find(entry => entry.key === key)!
  it('a corrected invoiced underlay is flagged until its correction covers every revision', async () => {
    io.tables = { invoice_export_items: [{ company_id: CO, billing_underlay_id: 'bu-open' }, { company_id: CO, billing_underlay_id: 'bu-handled' }] }
    io.basis = [{ id: 'bu-open', qualified: false, correctionRequired: true, correctionPending: true },
      { id: 'bu-handled', qualified: false, correctionRequired: true, correctionPending: false }]
    expect(await check('metering_corrections_after_billing')).toMatchObject({ count: 1, sampleIds: ['bu-open'] })
  })

  it('pending approvals are shown; a correction document never counts as duplicate billing of the original', async () => {
    io.tables = {
      metering_billing_corrections: [{ id: 'mc-2', company_id: CO, status: 'pending_approval' }, { id: 'mc-1', company_id: CO, status: 'invoiced' }],
      billing_underlays: [
        { id: 'bu-orig', company_id: CO, contract_id: 'ct-1', underlay_year: 2026, underlay_month: 9, energy_direction: 'consumption', billing_period_start: '2026-09-01', billing_period_end: '2026-10-01', source_system: 'normalized_metering_values' },
        { id: 'bu-corr', company_id: CO, contract_id: 'ct-1', underlay_year: 2026, underlay_month: 9, energy_direction: 'consumption', billing_period_start: '2026-09-10', billing_period_end: '2026-09-11', source_system: 'metering_correction_after_billing' },
      ],
    }
    expect(await check('metering_corrections_awaiting_approval')).toMatchObject({ count: 1, sampleIds: ['mc-2'] })
    expect(await check('duplicate_billing_per_contract_period')).toMatchObject({ count: 0 })
    // Negative control: a second regular underlay over the same days still is a duplicate.
    io.tables.billing_underlays.push({ ...io.tables.billing_underlays[1], id: 'bu-dup', source_system: 'normalized_metering_values' })
    expect(await check('duplicate_billing_per_contract_period')).toMatchObject({ count: 1 })
  })
})
