/* eslint-disable @typescript-eslint/no-explicit-any -- loose test doubles for Supabase/PostgREST ports */
// ops-api-review: F23
// From quality/audits/2026-10-07-ops-api-review/evidence/current-pricing.probe.ts.
// Partner POST /price selects an API-only default offer and must quote it through
// the API publication channel; Website-only offers must never resolve for the API.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  queries: [] as Array<{ table: string; filters: Record<string, unknown> }>,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      const q: any = { table, filters: {} as Record<string, unknown> }
      m.queries.push(q)
      const rows = () => (m.tables[table] ?? []).filter((row) => Object.entries(q.filters).every(([k, v]) => row[k] === v))
      for (const k of ['select', 'order', 'limit', 'in']) q[k] = () => q
      q.eq = (k: string, v: unknown) => { q.filters[k] = v; return q }
      q.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null })
      q.then = (a: any, b: any) => Promise.resolve({ data: rows(), error: null }).then(a, b)
      return q
    },
  },
}))
vi.mock('@/lib/legal/publicLegalDocuments', async (orig) => ({ ...await orig<any>(), loadCompanySlugById: async () => 'tenant' }))
vi.mock('@/lib/website/publicContracts.part-2', async (orig) => ({
  ...await orig<any>(),
  loadPublicationReadinessByVersion: async (_c: string, offers: any[]) => new Map(offers.map((o) => [o.contract_publication_version_id, { isReady: true, blockers: [] }])),
  loadLegalVersionsByBundle: async (_c: string, offers: any[]) => new Map(offers.map((o) => [o.legal_bundle_version_id, [{ id: 'doc', type: 'terms', version: 'v1', title: 'Terms', published_at: null, content_sha256: null, legal_bundle_version_id: o.legal_bundle_version_id, origin: 'canonical_bundle_document' }]])),
}))
vi.mock('@/lib/website/publicContracts.part-3', async (orig) => ({
  ...await orig<any>(),
  loadPublishedPriceOptions: async (_c: string, offers: any[]) => new Map(offers.map((o) => [o.contract_publication_version_id, { options: [{ price_option_reference: 'opt' }], diagnostics: [] }])),
  loadPortfolioPricingByOffer: async () => new Map(),
}))

// Handler-level: real Partner handler and real calculateOfferQuote; the facade
// resolver used by offerQuote is replaced by a channel-aware fake whose API
// catalogue only contains the API-only offer (the real resolver is proven above
// via the direct module import).
const facade = vi.hoisted(() => ({ calls: [] as any[] }))
vi.mock('@/lib/website/publicContracts', async (orig) => ({
  ...await orig<any>(),
  resolvePublicContractOffer: vi.fn(async (input: any) => {
    facade.calls.push(input)
    return input.channel === 'api' && input.offerReference === 'api-only' ? apiOffer() : null
  }),
}))
vi.mock('@/lib/integrations/apiAuth', () => ({ requireIntegrationApiAccess: async () => ({ ok: true, client: { id: 'client', company_id: 'company', scopes: ['website_quotes.write'], metadata: {} }, rateLimit: { limit: 100, remaining: 99, resetAt: null } }), logIntegrationApiRequest: vi.fn(async () => undefined), currentIntegrationApiResponseContext: () => null, integrationCredential: () => null }))
vi.mock('@/lib/energy/resolver', () => ({ resolveEnergyContext: async () => ({ resolutionId: '11111111-1111-4111-8111-111111111111', priceArea: 'SE3', gridAreaCode: 'SYN', gridAreaName: 'Syn', gridOwnerId: 'owner', gridOwnerName: 'Owner', resolutionStatus: 'grid_area_master_validated', priceAreaAssurance: { status: 'verified', confidence: 1 }, warnings: [], sourceChain: [], confidence: 1 }) }))
vi.mock('@/lib/energy/resolutionBinding', async (orig) => ({ ...await orig<any>(), loadQuoteEnergyResolution: async () => ({ id: '11111111-1111-4111-8111-111111111111', companyId: 'company', priceArea: 'SE3', gridAreaCode: null, gridAreaName: null, gridOwnerId: null, gridOwnerName: null, resolutionStatus: 'grid_area_master_validated', confidence: 1, priceAreaAssurance: { status: 'verified', priceArea: 'SE3', confidence: 1, source: 'address_polygon', candidateCount: 1, uniquePriceAreaCount: 1, sourceVersion: 'v', evidence: {} }, automationAllowed: true, resolvedAt: '2026-10-09T00:00:00Z', expiresAt: '2026-10-10T00:00:00Z', resolverVersion: 'r', geodataVersion: 'g', sourceChain: [], conflictCode: null, capabilities: {}, blockers: {} }) }))
vi.mock('@/lib/partner-api/simple', () => ({ handleSimplePartnerApi: vi.fn() }))
vi.mock('@/lib/pricing/priceSourceResolver', () => ({ resolvePricingConfiguration: vi.fn(async () => ({ vatRate: 0.25, baseComponents: [], priceComponents: [], warnings: [] })), resolveBasePriceSourceValues: vi.fn(async () => ({})) }))
vi.mock('@/lib/pricing/basePriceCalculator', () => ({ calculateBasePrice: vi.fn(() => ({ status: 'success', baseSekPerKwh: 0, lines: [], warnings: [], errors: [] })) }))
vi.mock('@/lib/pricing/websiteQuotes', () => ({ persistWebsiteQuote: vi.fn(async () => ({ quoteReference: 'quote_api', validUntil: '2026-10-10T00:00:00.000Z' })) }))

function apiOffer() {
  return {
    id: 'pv-api', company_id: 'company', price_plan_id: 'plan', price_plan_version_id: 'ppv', campaign_version_id: null, product_code: 'electricity', public_name: 'API Spot',
    public_description: null, contract_type: 'variable_monthly', energy_direction: 'consumption', billing_model: 'spot', customer_type: 'both', monthly_fee_sek: null, invoice_fee_sek: 0,
    markup_ore_per_kwh: null, spot_markup_ore_per_kwh: null, variable_fee_ore_per_kwh: null, fixed_price_ore_per_kwh: null, green_fee_mode: null, green_fee_value: null, terms_version: 'v1',
    valid_from: null, valid_to: null, sort_order: 1, metadata: {}, canonical_offer_reference: 'api-only', contract_publication_version_id: 'pv-api', pricing_snapshot: { pricing_model: 'spot', vat_rate: 0.25, base_components: [], price_components: [{ component_code: 'invoice_fee', component_type: 'invoice_fee', name: 'Fakturaavgift', amount: 0, calculation_type: 'per_invoice', unit: 'sek_invoice', status: 'active', website_card_visible: false }] },
  }
}

import { resolvePublicContractOffer } from '@/lib/website/publicContractResolver'
import { handleBusinessPartnerApi } from '@/lib/partner-api/business'

const client = (company = 'company') => ({ id: 'client', company_id: company } as any)
const readiness = (extra: Record<string, unknown> = {}) => ({
  company_id: 'company', channel: 'api', offer_reference: 'api-only', publication_version_id: 'pv-api', source_contract_offer_id: 'src', customer_type: 'both', visible: true,
  canonical_graph_consistent: true, forward_publication_link_valid: true, reverse_legacy_link_valid: true, company_chain_valid: true, tenant_assignment_valid: true,
  channel_graph_valid: true, product_version_valid: true, source_offer_consistent: true, snapshot_hash_valid: true, energy_direction_valid: true, contract_type_valid: true, successor_chain_valid: true,
  ...extra,
})

beforeEach(() => {
  m.queries = []
  m.tables = {
    canonical_public_contract_delivery_readiness_v: [
      readiness(),
      readiness({ channel: 'website', offer_reference: 'web-only', publication_version_id: 'pv-web', public_offer_id: 'po-web' }),
    ],
    contract_publication_versions: [
      { id: 'pv-api', channel: 'api', status: 'published', locked_at: '2026-10-01T00:00:00Z', offer_reference: 'api-only', customer_type: 'both', valid_from: null, valid_to: null, price_plan_id: 'plan', price_plan_version_id: 'ppv', price_book_id: 'book', legal_bundle_version_id: 'lbv', contract_product_version_id: 'cpv', energy_direction: 'consumption' },
    ],
    contract_offers: [
      { id: 'src', company_id: 'company', name: 'API Spot', description: null, contract_type: 'variable_monthly', customer_type: 'both', monthly_fee_sek: 39, invoice_fee_sek: 0, spot_markup_ore_per_kwh: 4.5, contract_product_id: 'cp', default_binding_months: 0, default_notice_months: 1, admin_fee_sek: null },
    ],
    price_plan_versions: [{ id: 'ppv', snapshot_json: { pricing_model: 'spot', price_components: [{ component_code: 'invoice_fee', component_type: 'invoice_fee', name: 'Fakturaavgift', amount: 0, calculation_type: 'per_invoice', unit: 'sek_invoice', status: 'active', website_card_visible: false }] }, locked_at: '2026-10-01T00:00:00Z' }],
    contract_product_versions: [{ id: 'cpv', contract_type: 'variable_monthly', price_areas: ['SE3'] }],
  }
})

describe('F23 API-channel offer resolution', () => {
  it('resolves an API-only offer from the API publication graph', async () => {
    const offer = await resolvePublicContractOffer({ client: client(), offerReference: 'api-only', customerType: 'private', channel: 'api' })
    expect(offer).toMatchObject({
      public_name: 'API Spot', contract_type: 'variable_monthly', contract_publication_version_id: 'pv-api', canonical_offer_reference: 'api-only',
      price_plan_version_id: 'ppv', legal_bundle_version_id: 'lbv', contract_product_id: 'cp', contract_product_version_id: 'cpv', price_book_id: 'book',
      monthly_fee_sek: 39, spot_markup_ore_per_kwh: 4.5, price_areas: ['SE3'], price_options: [{ price_option_reference: 'opt' }],
    })
    expect(m.queries.find((q) => q.table === 'canonical_public_contract_delivery_readiness_v')!.filters).toMatchObject({ channel: 'api', company_id: 'company', offer_reference: 'api-only' })
    expect(m.queries.some((q) => q.table === 'canonical_visible_public_contracts_v')).toBe(false)
  })

  it('Website-only offer is not resolvable through the API channel', async () => {
    expect(await resolvePublicContractOffer({ client: client(), offerReference: 'web-only', customerType: 'private', channel: 'api' })).toBeNull()
  })

  it('other-tenant credential cannot resolve the offer', async () => {
    expect(await resolvePublicContractOffer({ client: client('other-company'), offerReference: 'api-only', customerType: 'private', channel: 'api' })).toBeNull()
  })

  it('readiness guards stay: not visible or wrong customer type resolves nothing', async () => {
    m.tables.canonical_public_contract_delivery_readiness_v[0].visible = false
    expect(await resolvePublicContractOffer({ client: client(), offerReference: 'api-only', channel: 'api' })).toBeNull()
    m.tables.canonical_public_contract_delivery_readiness_v[0].visible = true
    m.tables.canonical_public_contract_delivery_readiness_v[0].customer_type = 'business'
    expect(await resolvePublicContractOffer({ client: client(), offerReference: 'api-only', customerType: 'private', channel: 'api' })).toBeNull()
  })

  it('fails closed when the publication version is not a locked API publication', async () => {
    m.tables.contract_publication_versions[0].channel = 'website'
    await expect(resolvePublicContractOffer({ client: client(), offerReference: 'api-only', channel: 'api' })).rejects.toThrow()
    m.tables.contract_publication_versions[0].channel = 'api'
    m.tables.canonical_public_contract_delivery_readiness_v[0].snapshot_hash_valid = false
    await expect(resolvePublicContractOffer({ client: client(), offerReference: 'api-only', channel: 'api' })).rejects.toThrow()
  })

  it('website default is unchanged: the website path never reads API readiness', async () => {
    await resolvePublicContractOffer({ client: client(), offerReference: 'api-only', customerType: 'private' }).catch(() => null)
    const readinessQuery = m.queries.find((q) => q.table === 'canonical_public_contract_delivery_readiness_v')!
    expect(readinessQuery.filters.channel).toBe('website')
  })
})

describe('F23 Partner POST /price quotes the API-only default offer', () => {
  const price = () => handleBusinessPartnerApi(new NextRequest('https://example.test/api/partner/v1/price', { method: 'POST', body: JSON.stringify({ postal_code: '12345', annual_consumption_kwh: 12000, customer_type: 'private' }) }), 'POST', ['price'])
  beforeEach(() => {
    facade.calls = []
    m.tables.canonical_public_contract_diagnostics_v = [{ company_id: 'company', channel: 'api', visible: true, offer_reference: 'api-only', customer_type: 'private' }]
  })

  it('selects the API default and returns a real quote through the API channel', async () => {
    const response = await price()
    expect(response!.status).toBe(200)
    const body = await response!.json()
    expect(body).toMatchObject({ quote_reference: 'quote_api', offer: { name: 'API Spot', contract_type: 'variable_monthly' }, is_binding: false })
    expect(facade.calls).toEqual([expect.objectContaining({ offerReference: 'api-only', channel: 'api' })])
    expect(m.queries.find((q) => q.table === 'canonical_public_contract_diagnostics_v')!.filters).toMatchObject({ channel: 'api', company_id: 'company' })
  })

  it('a Website-only offer bound as credential default is not quoted through the API', async () => {
    const auth = await import('@/lib/integrations/apiAuth')
    const original = auth.requireIntegrationApiAccess
    ;(auth as any).requireIntegrationApiAccess = async () => ({ ok: true, client: { id: 'client', company_id: 'company', scopes: ['website_quotes.write'], metadata: { partner_default_offer_reference: 'web-only' } }, rateLimit: { limit: 100, remaining: 99, resetAt: null } })
    try {
      const response = await price()
      expect(response!.status).toBe(404)
      expect((await response!.json()).error.code).toBe('offer_not_found')
      expect(facade.calls).toEqual([expect.objectContaining({ offerReference: 'web-only', channel: 'api' })])
    } finally {
      ;(auth as any).requireIntegrationApiAccess = original
    }
  })

  it('no API offer for the tenant returns offer_not_found before quoting', async () => {
    m.tables.canonical_public_contract_diagnostics_v = []
    const response = await price()
    expect(response!.status).toBe(404)
    expect(facade.calls).toHaveLength(0)
  })
})
