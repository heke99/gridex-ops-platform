import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanonicalOnboardingCommand } from '@/lib/customers/canonicalOnboarding'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import type { PublicContractOffer } from '@/lib/website/publicContracts'

type Row = Record<string, unknown>
vi.mock('server-only', () => ({}))
const COMPANY = '00000000-0000-4000-8000-000000000225'
const OWNER = '00000000-0000-4000-8000-000000000226'
const FACILITY = '735999225000000001'
const io = vi.hoisted(() => ({
  commands: [] as CanonicalOnboardingCommand[],
  rows: {} as Record<string, Row[]>,
  reads: [] as Array<{ table: string; filters: Row }>,
  writes: [] as Array<{ table: string; row: Row }>,
  rpcError: null as { code: string; message: string } | null,
}))

// External Data API/RPC boundary only. The normalizer, readiness, resolver,
// onboarding command builder, canonical adapter and audit writer all run.
// This finite port does not prove PostgreSQL persistence, RLS or live switching.
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    rpc: async (name: string, args: { p_command: CanonicalOnboardingCommand }) => {
      if (name !== 'canonical_onboard_customer_graph') throw new Error(`Unexpected RPC: ${name}`)
      const command = args.p_command
      io.commands.push(command)
      if (io.rpcError) return { data: null, error: io.rpcError }
      const customer = { ...command.customer, id: 'customer-225', company_id: command.company_id, customer_number: 'SYNTHETIC-225' }
      io.rows.customers = [customer]
      const site = command.site ? { ...command.site, id: 'site-225', company_id: command.company_id } : null
      const meter = command.metering_point ? { ...command.metering_point, id: 'meter-225', company_id: command.company_id } : null
      io.rows.customer_sites = site ? [site] : []
      io.rows.metering_points = meter ? [meter] : []
      return { error: null, data: {
        ok: true, code: 'customer_onboarding_committed', operation_id: 'operation-225',
        correlation_id: command.correlation_id, customer_id: customer.id, customer_number: customer.customer_number,
        created_new_customer: true, site_id: site?.id ?? null, metering_point_id: meter?.id ?? null,
        contract_id: null, price_snapshot_id: null,
      } }
    },
    from: (table: string) => {
      const filters: Row = {}
      let inserted: Row | null = null
      const result = () => {
        if (inserted) {
          if (!['customer_site_resolution', 'canonical_energy_flow_events'].includes(table)) throw new Error(`Unexpected insert: ${table}`)
          return { data: { id: 'resolution-225' }, error: null }
        }
        if (!['customers', 'customer_sites', 'metering_points'].includes(table)) throw new Error(`Unexpected read: ${table}`)
        io.reads.push({ table, filters: { ...filters } })
        return { data: (io.rows[table] ?? []).find(row => Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null, error: null }
      }
      const query = {
        select: () => query,
        eq: (field: string, value: unknown) => { filters[field] = value; return query },
        insert: (row: Row) => { inserted = row; io.writes.push({ table, row }); return query },
        single: async () => result(),
        maybeSingle: async () => result(),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
      }
      return query
    },
  },
}))

import { assessWebsiteApplicationReadiness } from '@/lib/website/applicationReview'
import { normalizeRawApplication, runEnergyResolution } from '@/lib/website/customerApplicationCore'
import { onboardCanonicalWebsiteCustomerGraph } from '@/lib/website/customerApplicationOnboarding'
import { ApplicationSchema, applicationBusinessKeyHash, validateNestedPayloadFields } from '@/lib/website/customerApplicationSchemas'

const client: IntegrationApiClient = {
  id: 'client-225', company_id: COMPANY, name: 'Synthetic integration', status: 'active',
  key_prefix: 'test', secret_hash: 'test-placeholder', scopes: ['website:applications'],
  allowed_ips: [], rate_limit_per_minute: 10, expires_at: null,
}
const offer: PublicContractOffer = {
  id: 'offer-225', company_id: COMPANY,
  price_plan_id: '00000000-0000-4000-8000-000000000227',
  price_plan_version_id: '00000000-0000-4000-8000-000000000228',
  campaign_version_id: null, product_code: 'spot', public_name: 'Synthetic spot offer',
  public_description: null, contract_type: 'hourly_spot', billing_model: 'hourly_spot',
  energy_direction: 'consumption', customer_type: 'business', monthly_fee_sek: 0,
  invoice_fee_sek: 0, markup_ore_per_kwh: 0, spot_markup_ore_per_kwh: 0,
  variable_fee_ore_per_kwh: 0, fixed_price_ore_per_kwh: null, green_fee_mode: null,
  green_fee_value: null, terms_version: 'synthetic-v1', valid_from: null, valid_to: null,
  sort_order: 1, metadata: {}, canonical_offer_reference: 'synthetic-offer-225',
}

function application(overrides: Row = {}) {
  return {
    customer: { customer_type: 'business', company_name: 'Synthetic applicant', org_number: 'synthetic-identity', email: 'application@example.test' },
    site: {}, metering_point: { site_facility_id: ' 735 999225000000001 ', metering_point_id: ' mp 225 ' },
    grid_area_code: 'ABC', price_area_code: 'SE3', grid_owner_id: OWNER,
    grid_owner_verification_status: 'verified', resolution_status: 'grid_area_master_validated',
    price_plan_id: offer.price_plan_id, consents: { terms: true, power_of_attorney: true },
    requested_start_mode: 'earliest_possible', calculated_earliest_start_date: '2026-10-25',
    settlement: {
      model: 'market_hourly', customer_accepts: 'pricing_model', energy_price_locked_at_signup: false,
      uses_actual_metered_consumption: true, market_data_role: 'indicative_preview_only', settlement_resolution: 'hour',
    },
    ...overrides,
  }
}

async function onboard(raw: Row, normalize = true, existingCustomerId?: string) {
  const body = ApplicationSchema.parse(normalize ? normalizeRawApplication(raw) : raw)
  const readiness = assessWebsiteApplicationReadiness(body)
  const result = await onboardCanonicalWebsiteCustomerGraph({
    client, body, rawBody: raw, externalCustomerId: 'external-225',
    applicationRowId: 'application-225', applicationNumber: 'SYNTHETIC-APPLICATION-225',
    publicOffer: offer, offerReference: 'synthetic-offer-225', websiteQuote: null,
    readiness, legalVersions: [], structuredPoa: null, agreementAcceptedAt: '2026-10-05T00:00:00.000Z',
    idempotencyKey: 'synthetic-225', existingCustomerId,
  })
  return { result, readiness, command: io.commands.at(-1)! }
}

beforeEach(() => {
  io.commands = []; io.rows = {}; io.reads = []; io.writes = []; io.rpcError = null
})

describe('current-main website facility aliases', () => {
  it.each(['site_facility_id', 'siteFacilityId', 'anlage_id', 'anlaggningId'])('recognizes nested %s for readiness without inventing a site address', alias => {
    const raw = application({ site: undefined, metering_point: { [alias]: FACILITY, metering_point_id: 'MP225' } })
    expect(validateNestedPayloadFields(raw)).toBeNull()
    expect(assessWebsiteApplicationReadiness(raw)).toMatchObject({ canCreateSite: true, canCreateMeteringPoint: true, canStartSwitch: true, status: 'ready_for_switch' })
  })

  it.each(['site_facility_id', 'siteFacilityId', 'anlage_id', 'anlaggningId'])('normalizes meter-only %s to a facility-only site and the same business identity', alias => {
    const raw = application({ site: undefined, address: { street: 'Billing only', postal_code: '12345', city: 'Billing city' }, metering_point: { [alias]: FACILITY, metering_point_id: 'MP225' } })
    const body = ApplicationSchema.parse(normalizeRawApplication(raw))
    expect(body.site).toMatchObject({ facility_id: FACILITY })
    expect(body.site?.street).toBeUndefined()
    const canonical = ApplicationSchema.parse(normalizeRawApplication(application({ site: { facility_id: FACILITY }, metering_point: { metering_point_id: 'MP225' } })))
    expect(applicationBusinessKeyHash(body, 'external-225')).toBe(applicationBusinessKeyHash(canonical, 'external-225'))
  })

  it('preserves an explicit canonical facility over conflicting nested aliases', () => {
    const body = ApplicationSchema.parse(normalizeRawApplication(application({ site: { facility_id: FACILITY }, metering_point: { site_facility_id: 'other-facility', anlage_id: 'other-anlage', metering_point_id: 'MP225' } })))
    expect(body.site?.facility_id).toBe(FACILITY)
  })

  it('recognizes the accepted top-level camel-case facility alias', () => {
    const raw = application({ site: undefined, metering_point: { metering_point_id: 'MP225' }, siteFacilityId: FACILITY })
    expect(validateNestedPayloadFields(raw)).toBeNull()
    expect(assessWebsiteApplicationReadiness(raw).canStartSwitch).toBe(true)
  })

  it.each(['site_facility_id', 'anlage_id'])('sends nested %s through the actual resolver input snapshot without granting automation', async alias => {
    const body = ApplicationSchema.parse(application({ site: undefined, grid_area_code: undefined, grid_owner_id: undefined, metering_point: { [alias]: FACILITY, metering_point_id: 'MP225' } }))
    const { resolution } = await runEnergyResolution({ client, companyId: COMPANY, body })
    expect(io.writes.map(write => write.table)).toEqual(['customer_site_resolution', 'canonical_energy_flow_events'])
    expect(io.writes[0].row).toMatchObject({ company_id: COMPANY, input_snapshot: { facilityId: FACILITY, meteringPointId: 'MP225' } })
    expect(resolution.automationAllowed).toBe(false)
    expect(resolution.gridOwnerVerificationStatus).not.toBe('verified')
  })

  it('retains nested facility identity and canonical meter IDs through the real onboarding RPC adapter and tenant-filtered reads', async () => {
    const { result, readiness, command } = await onboard(application({ site: undefined }))
    expect(readiness.canStartSwitch).toBe(true)
    expect(command).toMatchObject({ company_id: COMPANY, channel: 'website', matching_policy: 'link_unique', site: { facility_id: FACILITY }, metering_point: { metering_point_id: 'MP225', meter_point_id: 'MP225', ediel_metering_point_id: 'MP225', site_facility_id: FACILITY, anlage_id: FACILITY, verification_status: 'pending', data_quality_status: 'incomplete' } })
    expect(result.site?.facility_id).toBe(FACILITY)
    expect(result.meteringPoint?.metering_point_id).toBe('MP225')
    expect(io.reads).toEqual([
      { table: 'customers', filters: { company_id: COMPANY, id: 'customer-225' } },
      { table: 'customer_sites', filters: { company_id: COMPANY, id: 'site-225' } },
      { table: 'metering_points', filters: { company_id: COMPANY, id: 'meter-225' } },
    ])
  })

  it.each(['metering_point_id', 'meter_point_id', 'ediel_metering_point_id', 'anlage_id'])('canonicalizes %s at the onboarding boundary even for a schema-parsed caller', async alias => {
    const { command, result } = await onboard(application({ site: { facility_id: FACILITY }, metering_point: { [alias]: ' mp 225 ' } }), false)
    expect(command.metering_point).toMatchObject({ metering_point_id: 'MP225', meter_point_id: 'MP225', ediel_metering_point_id: 'MP225' })
    expect(result.meteringPoint?.metering_point_id).toBe('MP225')
  })

  it.each(['site_facility_id', 'anlage_id'])('onboards nested %s with an existing site object that has no facility_id', async alias => {
    const { command } = await onboard(application({ site: {}, metering_point: { [alias]: FACILITY, metering_point_id: 'MP225' } }), false)
    expect(command.site?.facility_id).toBe(FACILITY)
  })

  it('keeps facility-only input waiting for a meter instead of starting supplier switch', () => {
    const readiness = assessWebsiteApplicationReadiness(application({ metering_point: { site_facility_id: FACILITY } }))
    expect(readiness).toMatchObject({ canCreateSite: true, canCreateMeteringPoint: false, canStartSwitch: false, canRequestGridOwnerInformation: true })
    expect(readiness.missingFields).toContain('metering_point_id')
  })

  it.each([
    { grid_owner_verification_status: 'unknown' },
    { consents: { terms: true, power_of_attorney: false } },
    { consents: { terms: false, power_of_attorney: true } },
    { requested_start_mode: 'specific_date', requested_start_date: undefined },
    { facility_data_status: 'protected_identity' },
  ])('retains supplier-switch guards for %j', override => {
    const readiness = assessWebsiteApplicationReadiness(application({ site: { facility_id: FACILITY }, ...override }))
    expect(readiness.canStartSwitch).toBe(false)
    expect(readiness.canActivateCustomer).toBe(false)
    if (override.facility_data_status) expect(readiness).toMatchObject({ status: 'protected_identity', facilityVerified: false })
    const nestedReadiness = assessWebsiteApplicationReadiness(application({ site: undefined, ...override }))
    expect(nestedReadiness.canStartSwitch).toBe(false)
    expect(nestedReadiness.canActivateCustomer).toBe(false)
  })

  it('does not promote billing-only information into a canonical site', async () => {
    const raw = application({ site: undefined, metering_point: undefined, address: { street: 'Billing only', postal_code: '12345', city: 'Billing city' } })
    expect(normalizeRawApplication(raw).site).toBeUndefined()
    const { command, readiness } = await onboard(raw)
    expect(command.site).toBeNull()
    expect(readiness.canStartSwitch).toBe(false)
  })

  it('keeps existing-customer tenant ownership fail-closed before the canonical RPC', async () => {
    io.rows.customers = [{ id: 'foreign-customer', company_id: 'other-company' }]
    await expect(onboard(application({ site: { facility_id: FACILITY } }), true, 'foreign-customer')).rejects.toMatchObject({ code: 'portal_identity_customer_invalid', status: 409 })
    expect(io.commands).toHaveLength(0)
    expect(io.reads).toEqual([{ table: 'customers', filters: { company_id: COMPANY, id: 'foreign-customer' } }])
  })

  it('preserves the canonical positive onboarding flow', async () => {
    const { command, result, readiness } = await onboard(application({ site: { facility_id: FACILITY }, metering_point: { metering_point_id: 'MP225' } }))
    expect(readiness).toMatchObject({ canStartSwitch: true, canActivateCustomer: false })
    expect(command.site?.facility_id).toBe(FACILITY)
    expect(result.meteringPoint?.metering_point_id).toBe('MP225')
  })

  it('propagates an actual canonical RPC denial and performs no success projection reads', async () => {
    io.rpcError = { code: '42501', message: 'Synthetic permission denied' }
    await expect(onboard(application({ site: { facility_id: FACILITY } }))).rejects.toMatchObject({ code: '42501' })
    expect(io.commands).toHaveLength(1)
    expect(io.reads).toHaveLength(0)
  })
})
