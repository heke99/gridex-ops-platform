import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { loadQualifiedBillingValues, loadQualifiedBillingUnderlaySources } from '@/lib/billing/sourceBasis'
import { evaluateBillingReadinessCore } from '@/lib/billing/billingReadiness'
import { calculatePricingPreviewForUnderlay, contractCarriesUnderlay } from '@/lib/pricing/engine'
import { listExactBillableContractsByUnderlayIds } from '@/lib/billing/exportCenter'
import { evaluateBillingGate } from '@/lib/billing/billingGate'
import { contractCarriesBilledPeriod, contractEndedBySupplyPeriod } from '@/lib/billing/supplyPeriodEnd'
import { manualReceivedEndAuthority, isManualReceivedEndAuthority } from '@/lib/billing/manualReceivedEndAuthority'
const { rpc, tables } = vi.hoisted(() => ({ rpc: vi.fn(), tables: {} as Record<string, Array<Record<string, unknown>>> }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/pricing/priceSourceResolver', () => ({ resolvePricingConfiguration: async () => ({ baseComponents: [{ sourceType: 'fixed', weightPercent: 100, fixedPriceSekPerKwh: 1 }], priceComponents: [], vatRate: 0.25, warnings: [] }), resolveBasePriceSourceValues: async () => ({ fixedSekPerKwh: 1 }) }))
vi.mock('@/lib/pricing/spot/spotImportScheduler', () => ({ ensureSpotPricesForBillingMonth: async () => { throw new Error('unexpected spot import') } }))
vi.mock('@/lib/pricing/spot/spotPriceImporter', () => ({ importSpotPricesForDayArea: async () => { throw new Error('unexpected spot import') } }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc, from: (table: string) => {
  const filters: Array<(row: Record<string, unknown>) => boolean> = []
  const builder: Record<string, unknown> = {}
  for (const method of ['select','lt','gt','lte','gte','or','not','order','neq','contains','limit','update','filter','match','range']) builder[method] = () => builder
  builder.eq = (key: string, value: unknown) => { filters.push(row => row[key] === value); return builder }
  builder.in = (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return builder }
  builder.is = (key: string, value: unknown) => { filters.push(row => (row[key] ?? null) === value); return builder }
  const rows = () => (tables[table] ?? []).filter(row => filters.every(test => test(row)))
  builder.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null }); builder.single = builder.maybeSingle
  builder.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject)
  return builder
} } }))
const actual = JSON.parse(readFileSync(process.env.H3_SQL_RESULT ?? new URL('./fixtures/h3-actual-sql-result.json', import.meta.url), 'utf8'))
type Row = Record<string, unknown>
const clone = <T>(v: T): T => structuredClone(v)
for (const result of actual.results.filter((r: { name: string }) => r.name !== 'normal_source_before_manual')) {
  describe(result.name + ' actual SQL result → existing server loader → TypeScript billing', () => {
    async function fixture() {
      const row = clone(result.outer.serverValueRows[0]) as Row
      const scope = (row.billing_manual_received_end_authorities as Row[])[0]
      const period = clone(result.result.periods[0]) as Row
      const contract: Row = { ...clone(result.contract), id: scope.contractId, company_id: scope.companyId, customer_id: scope.customerId, metering_point_id: scope.meteringPointId, starts_at: '2025-12-01', ends_at: null }
      rpc.mockResolvedValue({ data: [row], error: null })
      const loaded = (await loadQualifiedBillingValues(String(row.company_id), [String(row.id)])).get(String(row.id))!
      const start = Date.parse(String(row.period_start)), end = Date.parse(String(row.period_end))
      const gate = (value: Row = loaded, supply: Row = period, ct: Row = contract) => evaluateBillingGate({ normalizedValue: value, supplyPeriod: supply, contract: ct, sourceMessage: row.billing_source_message as Row })
      return { row, loaded, scope, period, contract, start, end, gate }
    }
    it('holds a plain RPC DTO despite its true source fields; the actual server loader issues an opaque capability', async () => {
      const f = await fixture()
      expect(contractEndedBySupplyPeriod(f.contract, f.period)).toBe(false)
      expect(f.gate(clone(f.loaded)).reasons.map(r => r.code)).toContain('contract_not_active')
      expect(f.gate().eligible).toBe(true)
      const authority = manualReceivedEndAuthority([f.loaded], f.contract, f.period, f.start, f.end)
      expect(contractEndedBySupplyPeriod(f.contract, f.period, authority)).toBe(true)
      expect(contractCarriesBilledPeriod(f.contract, f.period, f.start, f.end, authority)).toBe(true)
      expect(contractCarriesBilledPeriod(f.contract, f.period, f.start, f.end + 1, authority)).toBe(false)
    })
    it('refuses serialized/spread capabilities and caller-invented flags', async () => {
      const f = await fixture(), authority = manualReceivedEndAuthority([f.loaded], f.contract, f.period, f.start, f.end)!
      expect(isManualReceivedEndAuthority(JSON.parse(JSON.stringify(authority)), f.contract, f.period)).toBe(false)
      expect(isManualReceivedEndAuthority({ ...authority }, f.contract, f.period)).toBe(false)
      expect(f.gate({ ...f.loaded, manualReceivedEndReceiptQualified: true, metadata: { qualifiedManualEnd: true } }).eligible).toBe(false)
    })
    it.each(['company_id', 'customer_id', 'metering_point_id', 'source_end_message_id', 'market_state_version', 'market_end_at'])('binds the server capability to exact current period %s', async key => {
      const f = await fixture(), changed = { ...f.period, [key]: key === 'market_state_version' ? 99 : key === 'market_end_at' ? '2026-02-17T23:00:00Z' : '00000000-0000-0000-0000-000000999999' }
      expect(manualReceivedEndAuthority([f.loaded], f.contract, changed, f.start, f.end)).toBeUndefined()
      expect(f.gate(f.loaded, changed).eligible).toBe(false)
    })
    it.each(['id', 'company_id', 'customer_id', 'metering_point_id', 'ended_at', 'termination_reason'])('binds the server capability to exact current contract %s', async key => {
      const f = await fixture(), changed = { ...f.contract, [key]: key === 'ended_at' ? '2026-02-17T00:00:00Z' : key === 'termination_reason' ? 'withdrawal' : '00000000-0000-0000-0000-000000999999' }
      expect(manualReceivedEndAuthority([f.loaded], changed, f.period, f.start, f.end)).toBeUndefined()
      expect(f.gate(f.loaded, f.period, changed).eligible).toBe(false)
    })
    it('refuses mutable value scope changes and any requested interval outside the certified commercial window', async () => {
      const f = await fixture()
      expect(manualReceivedEndAuthority([f.loaded], f.contract, f.period, f.start, f.end + 1)).toBeUndefined()
      f.loaded.period_end = new Date(f.end + 1).toISOString()
      expect(manualReceivedEndAuthority([f.loaded], f.contract, f.period, f.start, f.end)).toBeUndefined()
      expect(f.gate().eligible).toBe(false)
    })
    it('loads the actual underlay projection through the server loader before invoice readiness accepts the ended contract', async () => {
      const f = await fixture(), raw = clone(result.outer.serverUnderlayRows[0])
      const underlay: Row = { id: raw.id, company_id: f.scope.companyId, customer_id: f.scope.customerId, contract_id: f.scope.contractId, metering_point_id: f.scope.meteringPointId, supply_period_id: f.scope.periodId, billing_period_start: '2026-02-01', billing_period_end: '2026-02-15' }
      const plain = clone(underlay)
      rpc.mockResolvedValue({ data: [raw], error: null })
      await loadQualifiedBillingUnderlaySources(String(underlay.company_id), [underlay])
      expect(manualReceivedEndAuthority([plain], f.contract, f.period)).toBeUndefined()
      const authority = manualReceivedEndAuthority([underlay], f.contract, f.period)!
      expect(isManualReceivedEndAuthority(authority, f.contract, f.period)).toBe(true)
      const input = { companyId: String(f.scope.companyId), customerId: String(f.scope.customerId), customer: { id: String(f.scope.customerId) }, contract: f.contract, supplyPeriods: [f.period], billingPeriod: { start: '2026-02-01', end: '2026-02-15' } }
      expect(evaluateBillingReadinessCore(input).blockers.map(b => b.code)).toContain('contract_not_approved')
      expect(evaluateBillingReadinessCore({ ...input, manualReceivedEndAuthorities: [authority] }).blockers.map(b => b.code)).not.toContain('contract_not_approved')
      expect(evaluateBillingReadinessCore({ ...input, manualReceivedEndAuthorities: [JSON.parse(JSON.stringify(authority))] }).blockers.map(b => b.code)).toContain('contract_not_approved')
    })
    it('clears authority when the underlay binding is held or requires a correction', async () => {
      const f = await fixture(), raw = clone(result.outer.serverUnderlayRows[0])
      const underlay: Row = { id: raw.id, company_id: f.scope.companyId, customer_id: f.scope.customerId, contract_id: f.scope.contractId, metering_point_id: f.scope.meteringPointId, supply_period_id: f.scope.periodId }
      rpc.mockResolvedValue({ data: [{ ...raw, correctionRequired: true }], error: null })
      await loadQualifiedBillingUnderlaySources(String(underlay.company_id), [underlay])
      expect(manualReceivedEndAuthority([underlay], f.contract, f.period)).toBeUndefined()
    })
    it('prices and exports the actual persisted received-successor underlay through existing service loaders', async () => {
      const f = await fixture(), underlay = clone(result.outer.persistedUnderlay) as Row
      tables.billing_underlays = [underlay]
      tables.customer_contracts = [clone(result.contractFull)]
      tables.customer_supply_periods = [f.period]
      tables.contract_price_snapshots = [{ id: underlay.contract_price_snapshot_id, company_id: underlay.company_id, contract_id: underlay.contract_id, valid_from: '2026-01-01', valid_to: null, snapshot_json: { price_area: 'SE3', energy_direction: 'consumption' } }]
      rpc.mockImplementation(async (name: string) => {
        if (name === 'gridex_read_billing_underlay_source_basis_v1') return { data: clone(result.outer.serverUnderlayRows), error: null }
        throw new Error('unexpected RPC '+name)
      })
      expect(contractCarriesUnderlay(String(f.scope.companyId), clone(underlay), tables.customer_contracts[0], f.period)).toBe(false)
      const preview = await calculatePricingPreviewForUnderlay({ companyId: String(f.scope.companyId), billingUnderlayId: String(underlay.id), persist: false })
      expect(preview.errors).toEqual([])
      expect(preview.status).toBe('success')
      expect(preview.totalExVat).toBeCloseTo(361, 6)
      const exported = await listExactBillableContractsByUnderlayIds({ companyId: String(f.scope.companyId), underlays: [clone(underlay) as never] })
      expect(exported.get(String(underlay.id))?.id).toBe(f.scope.contractId)
      rpc.mockResolvedValue({ data: [{ ...clone(result.outer.serverUnderlayRows[0]), qualified: false }], error: null })
      expect((await listExactBillableContractsByUnderlayIds({ companyId: String(f.scope.companyId), underlays: [clone(underlay) as never] })).size).toBe(0)
    })
    it('rejects invalid service result scope instead of registering authority', async () => {
      const f = await fixture(), bad = clone(f.row)
      ;(bad.billing_manual_received_end_authorities as Row[])[0].companyId = '00000000-0000-0000-0000-000000999999'
      rpc.mockResolvedValue({ data: [bad], error: null })
      await expect(loadQualifiedBillingValues(String(f.row.company_id), [String(f.row.id)])).rejects.toThrow('billing_manual_end_authority_result_invalid')
    })
  })
}
