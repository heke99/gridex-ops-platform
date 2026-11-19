import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/v1/website/quote/route'
import type { BoundEnergyResolution } from '@/lib/energy/resolutionBinding'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { commercialModelSchema, type CanonicalContractType } from '@/lib/pricing/commercialModel'
import type { PublicContractOffer } from '@/lib/website/publicContracts'

const io = vi.hoisted(() => ({
  failTable: '',
  queries: [] as string[],
  offer: vi.fn(),
  persist: vi.fn(),
  complete: vi.fn(),
  failIdempotency: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.test', 'synthetic-unit-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: pricingTransport },
    }),
  }
})
vi.mock('@/lib/integrations/apiAuth', async original => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(),
  requireIntegrationApiAccess: async () => ({ ok: true, client, context: { companyId: client.company_id } }),
  logIntegrationApiRequest: async () => undefined,
}))
vi.mock('@/lib/integrations/writeIdempotency', async original => ({
  ...await original<typeof import('@/lib/integrations/writeIdempotency')>(),
  claimIntegrationWriteIdempotency: async () => ({ outcome: 'claimed', recordId: 'synthetic-idempotency-record' }),
  completeIntegrationWriteIdempotency: io.complete,
  failIntegrationWriteIdempotency: io.failIdempotency,
}))
vi.mock('@/lib/audit/actionLogger', async original => ({
  ...await original<typeof import('@/lib/audit/actionLogger')>(),
  scheduleUsageEvent: async () => undefined,
}))
vi.mock('@/lib/energy/resolutionBinding', async original => ({
  ...await original<typeof import('@/lib/energy/resolutionBinding')>(),
  loadQuoteEnergyResolution: async () => resolution,
}))
vi.mock('@/lib/website/publicContracts', async original => ({
  ...await original<typeof import('@/lib/website/publicContracts')>(),
  resolvePublicContractOffer: io.offer,
}))
vi.mock('@/lib/pricing/websiteQuotes', async original => ({
  ...await original<typeof import('@/lib/pricing/websiteQuotes')>(),
  persistWebsiteQuote: io.persist,
}))

const resolutionId = '11111111-1111-4111-8111-111111111111'
const client: IntegrationApiClient = {
  id: 'synthetic-client', company_id: 'synthetic-company', name: 'Synthetic quote caller', status: 'active',
  key_prefix: 'synthetic', secret_hash: 'synthetic-not-a-secret', scopes: ['website_quotes.write'],
  allowed_ips: [], rate_limit_per_minute: 30, expires_at: null,
}
const resolution: BoundEnergyResolution = {
  id: resolutionId, companyId: client.company_id, priceArea: 'SE3', gridAreaCode: null,
  gridAreaName: null, gridOwnerId: null, gridOwnerName: null, resolutionStatus: 'grid_area_resolved',
  confidence: 1, automationAllowed: false, resolvedAt: '2026-10-05T07:00:00.000Z',
  expiresAt: '2026-10-05T08:00:00.000Z', resolverVersion: 'synthetic', geodataVersion: null,
  sourceChain: [], conflictCode: null,
  priceAreaAssurance: { status: 'verified', priceArea: 'SE3', confidence: 1, source: 'grid_area_master', candidateCount: 1, uniquePriceAreaCount: 1, sourceVersion: null, evidence: {} },
  capabilities: { pricing_ready: true, quote_ready: true, facility_lookup_ready: false, switch_request_creatable: false, switch_dispatch_ready: false },
  blockers: { pricing: [], quote: [], facility_lookup: [], switch_creation: [], switch_dispatch: [] },
}

async function pricingTransport(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const table = url.pathname.split('/').at(-1)!
  if (init?.method !== 'GET') throw new Error(`Unexpected synthetic write: ${table}`)
  io.queries.push(table)
  if (table === io.failTable) {
    return Response.json({ code: '08006', message: 'Synthetic pricing dependency unavailable' }, { status: 500 })
  }
  if (table === 'company_market_price_sources') {
    return Response.json([{
      source_key: 'synthetic-provider', priority: 1, max_age_minutes: 60,
      supported_resolutions: ['monthly'], price_areas: ['SE3'], allow_indicative_latest: false,
    }])
  }
  if (table === 'market_price_previews' || table === 'price_plan_versions') return Response.json([])
  throw new Error(`Unexpected synthetic read: ${table}`)
}

function publishedOffer(type: CanonicalContractType, baseComponents: Array<Record<string, unknown>>): PublicContractOffer {
  const model = commercialModelSchema.parse({
    schema_version: 'gridex_contract_pricing_v6_selection',
    price_options: [{
      price_option_reference: 'standard', option_code: 'standard', customer_name: 'Synthetic standard',
      customer_type: 'private', default: true, selection_required: false, internal_description: null,
      contract_type: type, binding_months: 12, notice_months: 1, auto_renew_enabled: false,
      renewal_term_months: null, valid_from: null, valid_to: null, earliest_start_date: null,
      latest_start_date: null, status: 'active', sort_order: 1, version_number: 1,
      area_prices: type === 'fixed' ? [{
        price_row_reference: 'standard_se3', price_area: 'SE3', amount: 125, unit: 'ore_per_kwh',
        vat_treatment: 'standard', valid_from: null, valid_to: null, metadata: {},
      }] : [], metadata: {},
    }],
    components: [], invoice_delivery_methods: ['email'],
  })
  return {
    id: 'synthetic-offer-row', company_id: client.company_id, price_plan_id: 'synthetic-plan',
    price_plan_version_id: 'synthetic-version', campaign_version_id: null, product_code: 'synthetic-product',
    public_name: 'Synthetic offer', public_description: null, contract_type: type, energy_direction: 'consumption',
    billing_model: type, customer_type: 'private', monthly_fee_sek: null, invoice_fee_sek: 0,
    markup_ore_per_kwh: null, spot_markup_ore_per_kwh: null, variable_fee_ore_per_kwh: null,
    fixed_price_ore_per_kwh: type === 'fixed' ? 125 : null, green_fee_mode: null, green_fee_value: null,
    spot_weight_percent: type === 'mixed' ? 50 : null, portfolio_weight_percent: type === 'mixed' ? 50 : null,
    terms_version: null, valid_from: null, valid_to: null, sort_order: 1, metadata: {}, price_areas: ['SE3'],
    pricing_snapshot: {
      schema_version: model.schema_version, snapshot_schema: model.schema_version, vat_rate: 0.25,
      price_options: model.price_options, commercial_components: model.components,
      invoice_delivery_methods: model.invoice_delivery_methods, base_components: baseComponents,
      price_components: [{ component_code: 'invoice_fee', component_type: 'invoice_fee', name: 'Invoice fee',
        amount: 0, calculation_type: 'per_invoice', unit: 'sek_invoice', status: 'active', website_card_visible: false }],
    },
  }
}

function quoteRequest() {
  return new NextRequest('https://synthetic.example.test/api/v1/website/quote', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'synthetic-quote-key' },
    body: JSON.stringify({
      offer_reference: 'offer_synthetic', resolution_id: resolutionId, customer_type: 'private',
      annual_consumption_kwh: 12000, start_date: '2026-11-01', price_option_reference: 'standard',
      invoice_delivery_method: 'email', selected_component_references: [], site_count: 1,
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  io.queries = []
  io.persist.mockResolvedValue({ quoteReference: 'quote_synthetic', validUntil: '2026-11-01T00:15:00.000Z' })
})
afterEach(() => vi.restoreAllMocks())

describe('mounted website quote pricing dependencies', () => {
  it.each(['company_market_price_sources', 'price_plan_versions'])('creates a fixed quote while %s is unavailable', async table => {
    io.failTable = table
    io.offer.mockResolvedValue(publishedOffer('fixed', [
      { source_type: 'fixed', weight_percent: 100, fixed_price_sek_per_kwh: 1.25, price_area: 'SE3' },
      { source_type: 'spot', weight_percent: 100, price_area: 'SE4' },
    ]))

    const response = await POST(quoteRequest())

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ data: {
      quote_reference: 'quote_synthetic', estimate: { monthly_ex_vat: 1250, annual_ex_vat: 15000 },
      selected_area_price: { price_area: 'SE3', energy_price_ore_per_kwh: 125 },
      settlement: { model: 'fixed_price', energy_price_locked_at_signup: true }, market_sources: [],
      assumptions: expect.arrayContaining(['Förhandskalkylen utgår från prisbasen i den publicerade avtalsversionen.']),
    } })
    expect(io.queries).toEqual([])
    expect(io.persist).toHaveBeenCalledWith(expect.objectContaining({ marketSources: [], marketDataTimestamp: null, marketReference: {} }))
    expect(io.complete).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 201 }))
    expect(io.failIdempotency).not.toHaveBeenCalled()
  })

  it('uses a fixed-only effective price when a published mix retains zero-weight dynamic components', async () => {
    io.failTable = 'company_market_price_sources'
    const offer = publishedOffer('mixed', [
      { source_type: 'fixed', weight_percent: 100, fixed_price_sek_per_kwh: 1.25, price_area: 'SE3' },
      { source_type: 'spot', weight_percent: 0, price_area: 'SE3' },
      { source_type: 'portfolio', weight_percent: 0, price_area: 'SE3' },
    ])
    io.offer.mockResolvedValue({
      ...offer, fixed_price_ore_per_kwh: 125, fixed_weight_percent: 100,
      spot_weight_percent: 0, portfolio_weight_percent: 0,
    })

    const response = await POST(quoteRequest())

    expect(response.status).toBe(201)
    const { data } = await response.json()
    expect(data).toMatchObject({
      estimate: { monthly_ex_vat: 1250, annual_ex_vat: 15000 }, market_sources: [],
      assumptions: expect.arrayContaining(['Förhandskalkylen utgår från prisbasen i den publicerade avtalsversionen.']),
    })
    expect(data.assumptions.join(' ')).not.toMatch(/spotpris|portföljpris/i)
    expect(io.queries).toEqual([])
    expect(io.persist).toHaveBeenCalledWith(expect.objectContaining({
      resolvedBaseComponents: expect.arrayContaining([
        expect.objectContaining({ source_type: 'spot', weight_percent: 0 }),
        expect.objectContaining({ source_type: 'portfolio', weight_percent: 0 }),
      ]),
      marketSources: [],
    }))
  })

  it.each([
    { type: 'variable_monthly', sources: ['spot'], table: 'market_price_previews' },
    { type: 'portfolio', sources: ['portfolio'], table: 'price_plan_versions' },
    { type: 'mixed', sources: ['spot', 'portfolio'], table: 'price_plan_versions' },
  ] as const)('keeps $type quotes dependent on their source data', async ({ type, sources, table }) => {
    io.failTable = table
    io.offer.mockResolvedValue(publishedOffer(type, sources.map(source => ({ source_type: source, weight_percent: 100 / sources.length }))))

    const response = await POST(quoteRequest())

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: { code: 'website_quote_failed' } })
    expect(io.queries).toContain(table)
    expect(io.persist).not.toHaveBeenCalled()
    expect(io.failIdempotency).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'website_quote_failed' }))
  })
})
