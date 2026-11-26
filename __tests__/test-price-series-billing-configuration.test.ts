import { beforeEach, expect, it, vi } from 'vitest'
import { captureTestPriceSeriesBillingConfiguration } from '@/lib/billing/invoiceReadiness'

type Row = Record<string, unknown>
const store = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  updates: [] as Array<{ ids: unknown[]; patch: Row }>,
  qualified: [] as string[],
}))

vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/metering/validation', () => ({
  companyAllowsEstimatedMeteringValues: () => { throw new Error('Unexpected monthly metering read') },
  evaluateMeteringCompletenessForMonth: () => { throw new Error('Unexpected monthly metering evaluation') },
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = []
      let patch: Row | undefined
      const rows = () => (store.tables[table] ?? []).filter(row => filters.every(matches => matches(row)))
      const result = () => {
        const matched = rows()
        if (patch) {
          if (table !== 'billing_underlays') throw new Error('Unexpected table write')
          store.updates.push({ ids: matched.map(row => row.id), patch })
          for (const row of matched) Object.assign(row, patch)
        }
        return Promise.resolve({ data: matched, error: null })
      }
      const query = {
        select: () => query, order: () => query, limit: () => query, lte: () => query, or: () => query,
        range: result,
        eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query },
        in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return query },
        is(key: string, value: unknown) { filters.push(row => row[key] === value); return query },
        update(value: Row) { patch = value; return query },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) => result().then(resolve),
      }
      return query
    },
    rpc: async (name: string, args: { p_company_id: string; p_underlay_ids: string[] }) => {
      expect(name).toBe('gridex_read_billing_underlay_source_basis_v1')
      expect(args.p_company_id).toBe('company')
      return { data: args.p_underlay_ids.map(id => ({
        id, totalKwh: '24', qualified: store.qualified.includes(id), correctionRequired: false,
        plannedMoveOutContractId: 'contract', plannedMoveOutSupplyPeriodId: 'delivery',
      })), error: null }
    },
  },
}))

const companyId = 'company'
const billingMonth = '2026-09'
const members = ['first', 'second']
const capture = (underlayIds: readonly string[] = members) =>
  captureTestPriceSeriesBillingConfiguration({ companyId, billingMonth, underlayIds })

beforeEach(() => {
  store.updates.length = 0
  store.qualified = members
  const member = {
    company_id: companyId, underlay_year: 2026, underlay_month: 9, status: 'validated', readiness_status: 'ready',
    customer_id: 'customer', contract_id: 'contract', supply_period_id: 'delivery', metering_point_id: 'point',
    contract_price_snapshot_id: 'snapshot', price_area: 'SE3', missing_values_count: 0, calculated_total_sek_inc_vat: 60,
    billing_period_start: '2026-09-01', billing_period_end: '2026-09-02',
    billing_configuration_snapshot: null, billing_configuration_snapshot_sha256: null,
    invoice_export_locked_at: null, invoice_readiness_status: 'blocked',
    billing_block_reason: 'price_timeline_invoice_review_required',
  }
  store.tables = {
    billing_underlays: [...members, 'unrelated'].map(id => ({ ...member, id })),
    companies: [{
      id: companyId, name: 'Test AB', org_number: '556000-0000', is_active: true, status: 'active',
      operating_environment: 'production', invoice_export_enabled: true,
      invoice_export_target_system: 'file_export', billing_provider_environment: 'test',
      billing_settings: { invoice_profile: {
        id: 'invoicing', status: 'active', distribution_method: 'email', ocr_policy: 'invoice_number',
        payment_reference_policy: 'invoice_number', payment_terms: { due_days: 30 },
      } },
    }],
    billing_provider_connections: [{ id: 'provider', company_id: companyId, status: 'active', provider: 'file_export', environment: 'test' }],
    customer_contracts: [{
      id: 'contract', company_id: companyId, customer_id: 'customer', status: 'terminated', customer_site_id: 'site',
      contract_price_snapshot_id: 'snapshot', price_area_used: 'SE3', vat_rate: 25,
      invoice_recipient: 'Testkund', invoice_email: 'invoice@example.invalid',
    }],
    contract_price_snapshots: [{ id: 'snapshot', company_id: companyId, contract_id: 'contract', snapshot_json: { price_area: 'SE3' } }],
    customers: [{ id: 'customer', company_id: companyId, full_name: 'Testkund' }],
    customer_sites: [{ id: 'site', company_id: companyId, customer_id: 'customer', price_area_code: 'SE3' }],
    metering_points: [{ id: 'point', company_id: companyId, customer_id: 'customer', customer_site_id: 'site',
      meter_point_id: '735999000000000001', price_area_code: 'SE3' }],
    customer_supply_periods: [{ id: 'delivery', company_id: companyId, customer_id: 'customer', contract_id: 'contract',
      metering_point_id: 'point', status: 'active', start_date: '2026-09-01', end_date: '2026-09-02' }],
  }
})

it('captures the complete TEST cohort once without touching readiness or the other underlay', async () => {
  await expect(capture()).resolves.toBe(true)
  expect(store.updates).toHaveLength(1)
  const update = store.updates[0]
  expect(update.ids).toEqual(members)
  expect(update.patch).toMatchObject({ billing_configuration_snapshot: {
    provider: { provider: 'file_export', environment: 'test' },
    payment_terms: { dueDays: 30, defaulted: false },
  } })
  expect(update.patch).not.toHaveProperty('invoice_readiness_status')
  expect(store.tables.billing_underlays[2].billing_configuration_snapshot).toBeNull()

  for (const row of store.tables.billing_underlays.slice(0, 2)) row.invoice_readiness_status = 'invoiced'
  store.tables.companies[0].billing_settings = {}
  await expect(capture()).resolves.toBe(true)
  expect(store.updates).toHaveLength(1)
  expect(store.tables.billing_underlays[0].invoice_readiness_status).toBe('invoiced')
})

it.each(['unqualified', 'locked', 'invoiced', 'unscoped', 'wrong provider', 'missing terms', 'fractional terms'])('does not write the cohort when %s', async reason => {
  if (reason === 'unqualified') store.qualified = ['first']
  if (reason === 'locked') store.tables.billing_period_locks = [{ company_id: companyId, billing_year: 2026, billing_month: 9, status: 'locked' }]
  if (reason === 'invoiced') store.tables.billing_underlays[0].invoice_readiness_status = 'invoiced'
  if (reason === 'unscoped') store.tables.billing_underlays[1].company_id = 'another'
  if (reason === 'wrong provider') store.tables.companies[0].billing_provider_environment = 'production'
  if (reason === 'missing terms') store.tables.companies[0].billing_settings = {}
  if (reason === 'fractional terms') {
    const billing = store.tables.companies[0].billing_settings as { invoice_profile: { payment_terms: { due_days: number } } }
    billing.invoice_profile.payment_terms.due_days = 30.5
  }
  await expect(capture()).resolves.toBe(false)
  expect(store.updates).toEqual([])
})
