import { describe, expect, it, vi } from 'vitest'
import { resolveEffectiveBillingProfile } from '@/lib/billing/effectiveBillingProfile'
import { billingConfigurationSnapshotSha256, readQualifiedLockedBillingProfile, serializeBillingConfigurationSnapshot } from '@/lib/billing/billingConfigurationSnapshot'

const service = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
const metering = vi.hoisted(() => ({
  companyAllowsEstimatedMeteringValues: vi.fn().mockResolvedValue(false),
  evaluateMeteringCompletenessForMonth: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: service }))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: async () => undefined }))
vi.mock('@/lib/metering/validation', () => metering)
vi.mock('@/lib/pricing/underlayPricingAdapter', () => ({
  loadLockedUnderlayPricingWithCore: async () => { throw new Error('blocked_underlay_reached_pricing') },
  calculateUnderlayPricingWithCore: async () => { throw new Error('blocked_underlay_reached_pricing') },
}))
import { BillingProfileCommandError, changeCustomerBillingProfileFromApi, lockBillingConfiguration } from '@/lib/billing/billingProfileCommand'
import { evaluateBillingMonthInvoiceReadiness } from '@/lib/billing/invoiceReadiness'
import { prepareInvoiceDraftsForReview } from '@/lib/billing/invoiceReviewPrepare'

const expected = { companyId: 'tenant-a', customerId: 'customer-a', contractId: 'contract-a' }
const effective = resolveEffectiveBillingProfile({ ...expected,
  customer: { id: expected.customerId, company_id: expected.companyId, billing_profile_revision: 4,
    billing_profile: { recipient: 'Saved Customer', distributionMethod: 'email', email: 'saved@example.invalid', country: 'SE' } },
  contract: { id: expected.contractId, company_id: expected.companyId, customer_id: expected.customerId,
    billing_profile_override: {}, billing_profile_override_revision: 0 },
})

function monthlyFixture() {
  const underlay: Record<string, unknown> = { id: 'underlay-a', company_id: expected.companyId, customer_id: expected.customerId,
    contract_id: expected.contractId, customer_contract_id: expected.contractId, underlay_year: 2026, underlay_month: 9,
    metering_point_id: 'meter-a', status: 'validated', readiness_status: 'ready', total_kwh: 1,
    contract_price_snapshot_id: 'price-a', price_area: 'SE3', calculated_total_sek_inc_vat: 125,
    missing_values_count: 0, billing_configuration_snapshot: null, billing_configuration_snapshot_sha256: null }
  const tables: Record<string, Array<Record<string, unknown>>> = {
    billing_period_locks: [], invoice_export_items: [], billing_underlays: [underlay],
    companies: [{ id: expected.companyId, name: 'Synthetic Issuer', org_number: '556000-0000', operating_environment: 'test',
      billing_settings: { provider: 'capway_aptic', payment_terms: { due_days: 30 }, invoice_profile: {
        id: 'profile-a', status: 'active', distribution_method: 'email', ocr_policy: 'provider_generated', payment_reference_policy: 'invoice_number' } } }],
    billing_provider_connections: [{ id: 'provider-a', company_id: expected.companyId, provider: 'capway_aptic', environment: 'test', status: 'active', settings: {} }],
    customers: [{ id: expected.customerId, company_id: expected.companyId, billing_profile_revision: 4,
      billing_profile: { recipient: 'Saved Customer', distributionMethod: 'email', email: 'saved@example.invalid', country: 'SE' } }],
    customer_contracts: [{ id: expected.contractId, company_id: expected.companyId, customer_id: expected.customerId, status: 'active',
      customer_site_id: 'site-a', contract_price_snapshot_id: 'price-a', price_area_used: 'SE3', vat_rate: 25,
      billing_profile_override: {}, billing_profile_override_revision: 0 }],
    contract_price_snapshots: [{ id: 'price-a', company_id: expected.companyId, contract_id: expected.contractId, snapshot_json: { price_area: 'SE3' } }],
    customer_sites: [{ id: 'site-a', company_id: expected.companyId, customer_id: expected.customerId, price_area_code: 'SE3' }],
    metering_points: [{ id: 'meter-a', company_id: expected.companyId, customer_id: expected.customerId, site_id: 'site-a', meter_point_id: '735999000000000001', price_area_code: 'SE3' }],
    customer_supply_periods: [{ id: 'supply-a', company_id: expected.companyId, customer_id: expected.customerId,
      contract_id: expected.contractId, metering_point_id: 'meter-a', status: 'active', start_date: '2026-01-01', end_date: null }],
  }
  service.from.mockImplementation((table: string) => {
    if (!tables[table]) throw new Error(`unexpected_fixture_table:${table}`)
    const filters: Array<(row: Record<string, unknown>) => boolean> = []
    let single = false, updates: Record<string, unknown> | null = null
    const chain = {
      select: () => chain, order: () => chain, range: () => chain, or: () => chain, lte: () => chain, limit: () => chain,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return chain },
      neq: (key: string, value: unknown) => { filters.push(row => row[key] !== value); return chain },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return chain },
      maybeSingle: () => { single = true; return chain },
      update: (value: Record<string, unknown>) => { updates = value; return chain },
      then: (resolve: (value: unknown) => unknown) => {
        const rows = tables[table].filter(row => filters.every(predicate => predicate(row)))
        if (updates) rows.forEach(row => Object.assign(row, updates))
        return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve)
      },
    }
    return chain
  })
  service.rpc.mockReset().mockImplementation(async (_name: string, args: { p_snapshot: Record<string, unknown>; p_snapshot_sha256: string }) => {
    underlay.billing_configuration_snapshot = args.p_snapshot
    underlay.billing_configuration_snapshot_sha256 = args.p_snapshot_sha256
    return { data: args.p_snapshot, error: null }
  })
  metering.evaluateMeteringCompletenessForMonth.mockResolvedValue({ status: 'blocked', issues: [
    { code: 'metering_coverage_gap', message: 'Synthetic metering gap', severity: 'blocked', meteringPointId: 'meter-a' },
  ] })
  return underlay
}

describe('billing preparation respects complete readiness', () => {
  it('leaves the billing profile unlocked when later metering validation blocks the invoice', async () => {
    const underlay = monthlyFixture()
    const result = await evaluateBillingMonthInvoiceReadiness({ companyId: expected.companyId, billingMonth: '2026-09' })
    expect(result.readyUnderlayIds).toEqual([])
    expect(result.issues.map(issue => issue.code)).toContain('metering_coverage_gap')
    expect(underlay.billing_configuration_snapshot).toBeNull()
  })
  it('does not prepare a previously locked invoice when current metering readiness blocks it', async () => {
    const underlay = monthlyFixture()
    metering.evaluateMeteringCompletenessForMonth.mockResolvedValueOnce({ status: 'ready', issues: [] })
    await evaluateBillingMonthInvoiceReadiness({ companyId: expected.companyId, billingMonth: '2026-09' })
    const result = await prepareInvoiceDraftsForReview({ companyId: expected.companyId, billingMonth: '2026-09' })
    expect(result.candidates).toBe(0)
    expect(result.created).toBe(0)
    expect(result.failed).toBe(0)
    expect(underlay.invoice_readiness_status).toBe('blocked')
  })
})
const snapshot = { schema: 'billing_configuration_v2', company_id: expected.companyId,
  customer_id: expected.customerId, contract_id: expected.contractId, effective_billing_profile: effective }

describe('shared-route billing command adapter', () => {
  const input = { companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', customerId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    actor: { kind: 'api' as const, clientId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', subject: 'verified-owner-subject' },
    idempotencyKey: 'billing-historical-route-key', payload: { profile: { invoice_email: 'Historic@Example.invalid' } } }

  it('preserves historical compact request bytes and the stored status/body without requiring a fresh revision', async () => {
    const originalBody = { data: { completion_reference: 'historical-reference', status: 'accepted',
      profile_updated: true, facility_updated: false, address_result: null } }
    service.rpc.mockReset().mockResolvedValueOnce({ data: { statusCode: 201, body: originalBody, replayed: true }, error: null })
    await expect(changeCustomerBillingProfileFromApi(input)).resolves.toEqual({ statusCode: 201, body: originalBody, replayed: true })
    expect(service.rpc).toHaveBeenCalledWith('gridex_change_customer_billing_profile_api_v1', {
      p_command: { companyId: input.companyId, customerId: input.customerId, mode: 'api', actorUserId: null,
        sessionId: null, clientId: input.actor.clientId, subject: input.actor.subject, reason: null,
        idempotencyKey: input.idempotencyKey, requestJson: '{"profile":{"invoice_email":"Historic@Example.invalid"}}' },
    })
  })

  it.each(['idempotency_previous_attempt_failed', 'idempotency_in_progress', 'idempotency_conflict'])
    ('keeps %s as a conflict instead of issuing a second billing write', async code => {
      service.rpc.mockReset().mockResolvedValueOnce({ data: null, error: { message: code } })
      await expect(changeCustomerBillingProfileFromApi(input)).rejects.toMatchObject({ code, status: 409 })
      expect(service.rpc).toHaveBeenCalledTimes(1)
    })

  it('exposes the fresh revision requirement only when the database rejects a fresh claim', async () => {
    service.rpc.mockReset().mockResolvedValueOnce({ data: null, error: { message: 'billing_profile_revision_required' } })
    await expect(changeCustomerBillingProfileFromApi(input)).rejects.toMatchObject({ code: 'billing_profile_revision_required', status: 422 })
  })

  it('rejects a malformed stored result instead of claiming an accepted profile update', async () => {
    service.rpc.mockReset().mockResolvedValueOnce({ data: { statusCode: '201', body: [], replayed: true }, error: null })
    await expect(changeCustomerBillingProfileFromApi(input)).rejects.toMatchObject({ code: 'billing_profile_result_invalid', status: 503 })
  })
})

describe('billing snapshot qualification', () => {
  it('preserves compact sorted-key UTF-8 serialization and its existing SHA256 bytes', () => {
    const input = { b: 1, list: [false, null], a: 'Å x' }
    expect(serializeBillingConfigurationSnapshot(input)).toBe('{"a":"Å x","b":1,"list":[false,null]}')
    expect(billingConfigurationSnapshotSha256(input)).toBe('99bb1586c6fadb2dda68a11fe016833b5d7988e77fb6a11bea30b6844de32656')
  })
  it('qualifies a full stored DTO and rejects changed bytes or foreign identifiers', () => {
    const snapshotSha256 = billingConfigurationSnapshotSha256(snapshot)
    expect(readQualifiedLockedBillingProfile(snapshot, { ...expected, snapshotSha256 })).toEqual(effective)
    expect(readQualifiedLockedBillingProfile({ ...snapshot, effective_billing_profile: { ...effective, email: 'changed@example.invalid' } },
      { ...expected, snapshotSha256 })).toBeNull()
    expect(readQualifiedLockedBillingProfile(snapshot, { ...expected, companyId: 'tenant-b', snapshotSha256 })).toBeNull()
  })
  it('rejects incomplete, unknown-field, invalid-source and negative-revision effective profiles even with matching hashes', () => {
    const variants = [
      { ...effective, address: undefined },
      { ...effective, internal_note: 'private' },
      { ...effective, sources: { ...effective.sources, email: 'verified-by-client' } },
      { ...effective, sources: { ...effective.sources, email: ['customer_default'] } },
      { ...effective, distributionMethod: ['email'] },
      { ...effective, profileRevision: -1 },
      { ...effective, recipient: 'x'.repeat(321) },
    ]
    for (const profile of variants) {
      const value = { ...snapshot, effective_billing_profile: profile }
      expect(readQualifiedLockedBillingProfile(value, { ...expected, snapshotSha256: billingConfigurationSnapshotSha256(value) })).toBeNull()
    }
  })
  it('rejects an incorrect fingerprint before any service RPC can mutate a lock', async () => {
    service.rpc.mockClear()
    await expect(lockBillingConfiguration({ companyId: expected.companyId, underlayId: 'underlay-a',
      effectiveProfile: effective, snapshot, snapshotSha256: 'a'.repeat(64) })).rejects.toMatchObject({
      code: 'invalid_billing_configuration_snapshot', status: 422,
    } satisfies Partial<BillingProfileCommandError>)
    expect(service.rpc).not.toHaveBeenCalled()
  })
  it('reports an earlier committed lock as a conflict instead of claiming the requested revision was locked', async () => {
    const earlier = { ...snapshot, effective_billing_profile: { ...effective, profileRevision: 3, email: 'prior@example.invalid' } }
    service.rpc.mockResolvedValueOnce({ data: earlier, error: null })
    await expect(lockBillingConfiguration({ companyId: expected.companyId, underlayId: 'underlay-a',
      effectiveProfile: effective, snapshot, snapshotSha256: billingConfigurationSnapshotSha256(snapshot) })).rejects.toMatchObject({
      code: 'billing_configuration_already_locked', status: 409,
    })
  })
  it('accepts an identical committed lock for the same snapshot bytes and revision', async () => {
    service.rpc.mockResolvedValueOnce({ data: snapshot, error: null })
    await expect(lockBillingConfiguration({ companyId: expected.companyId, underlayId: 'underlay-a',
      effectiveProfile: effective, snapshot, snapshotSha256: billingConfigurationSnapshotSha256(snapshot) })).resolves.toEqual(snapshot)
  })
  it('leaves v1 history readable as original JSON without treating it as a new qualified delivery decision', () => {
    const legacy = { schema: 'billing_configuration_v1', invoice_email: 'historical@example.invalid' }
    const before = JSON.stringify(legacy)
    expect(readQualifiedLockedBillingProfile(legacy, { ...expected, snapshotSha256: billingConfigurationSnapshotSha256(legacy) })).toBeNull()
    expect(JSON.stringify(legacy)).toBe(before)
  })
})
