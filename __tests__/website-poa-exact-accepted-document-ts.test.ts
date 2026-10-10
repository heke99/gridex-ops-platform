// ops-api-review: F28 (Website TS validation)
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

const POA_DOC = '00000000-0000-4000-8000-0000000002a1'
const OTHER_POA_DOC = '00000000-0000-4000-8000-0000000002a2'
const legalVersions = [{ id: POA_DOC, type: 'power_of_attorney', module_key: 'power_of_attorney', version: 'v1', title: 'Fullmakt', body: 'text', published_at: '2026-10-01T00:00:00Z' }]
function poa(textVersionId: string | null) {
  return { accepted: true, scope: ['supplier_switch'], signerName: 'Synthetic Signer', signerIdentityNumber: 'synthetic-identity', method: 'website_acceptance', acceptedAt: '2026-10-05T00:00:00.000Z', textVersionId, ipAddress: null, userAgent: null }
}
async function onboardWithPoa(textVersionId: string | null) {
  const body = ApplicationSchema.parse(normalizeRawApplication(application({ site: undefined })))
  const readiness = assessWebsiteApplicationReadiness(body)
  await onboardCanonicalWebsiteCustomerGraph({
    client, body, rawBody: {}, externalCustomerId: 'external-225',
    applicationRowId: 'application-225', applicationNumber: 'SYNTHETIC-APPLICATION-225',
    publicOffer: offer, offerReference: 'synthetic-offer-225', websiteQuote: null,
    readiness, legalVersions, structuredPoa: poa(textVersionId), agreementAcceptedAt: '2026-10-05T00:00:00.000Z',
    idempotencyKey: 'synthetic-225',
  })
  return io.commands.at(-1) as Row | undefined
}

beforeEach(() => {
  io.commands = []; io.rows = {}; io.reads = []; io.writes = []; io.rpcError = null
})

describe('F28: website onboarding binds the exact accepted POA document', () => {
  it('binds the accepted offer document when textVersionId is omitted', async () => {
    const command = await onboardWithPoa(null)
    expect(command).toMatchObject({ power_of_attorney: { legal_text_version_id: POA_DOC } })
  })
  it('accepts the exact accepted document id', async () => {
    const command = await onboardWithPoa(POA_DOC)
    expect(command).toMatchObject({ power_of_attorney: { legal_text_version_id: POA_DOC } })
  })
  it('rejects another document before any business commit', async () => {
    await expect(onboardWithPoa(OTHER_POA_DOC)).rejects.toMatchObject({ code: 'power_of_attorney_offer_version_mismatch', status: 409 })
    expect(io.commands).toHaveLength(0)
  })
})
