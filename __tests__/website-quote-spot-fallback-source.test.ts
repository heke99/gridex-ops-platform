import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/v1/website/quote/route'
import type { BoundEnergyResolution } from '@/lib/energy/resolutionBinding'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { commercialModelSchema } from '@/lib/pricing/commercialModel'
import { resolveBasePriceSourceValues } from '@/lib/pricing/priceSourceResolver'
import type { PublicContractOffer } from '@/lib/website/publicContracts'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>,
  reads: [] as URL[],
  persist: vi.fn(),
  resolutionType: 'variable_monthly' as 'variable_monthly' | 'variable_quarterly',
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
  completeIntegrationWriteIdempotency: async () => undefined,
  failIntegrationWriteIdempotency: async () => undefined,
}))
vi.mock('@/lib/audit/actionLogger', async original => ({
  ...await original<typeof import('@/lib/audit/actionLogger')>(), scheduleUsageEvent: async () => undefined,
}))
vi.mock('@/lib/energy/resolutionBinding', async original => ({
  ...await original<typeof import('@/lib/energy/resolutionBinding')>(), loadQuoteEnergyResolution: async () => resolution,
}))
vi.mock('@/lib/website/publicContracts', async original => ({
  ...await original<typeof import('@/lib/website/publicContracts')>(), resolvePublicContractOffer: async () => publishedOffer(),
}))
vi.mock('@/lib/pricing/websiteQuotes', async original => ({
  ...await original<typeof import('@/lib/pricing/websiteQuotes')>(), persistWebsiteQuote: io.persist,
}))

const now = '2026-11-07T12:00:00.000Z'
const fresh = '2026-11-07T11:55:00.000Z'
const stale = '2026-11-07T08:00:00.000Z'
const resolutionId = '11111111-1111-4111-8111-111111111111'
const client: IntegrationApiClient = {
  id: 'synthetic-client', company_id: 'synthetic-company', name: 'Synthetic quote caller', status: 'active',
  key_prefix: 'synthetic', secret_hash: 'synthetic-not-a-secret', scopes: ['website_quotes.write'],
  allowed_ips: [], rate_limit_per_minute: 30, expires_at: null,
}
const resolution: BoundEnergyResolution = {
  id: resolutionId, companyId: client.company_id, priceArea: 'SE3', gridAreaCode: null, gridAreaName: null,
  gridOwnerId: null, gridOwnerName: null, resolutionStatus: 'grid_area_resolved', confidence: 1,
  automationAllowed: false, resolvedAt: fresh, expiresAt: now, resolverVersion: 'synthetic', geodataVersion: null,
  sourceChain: [], conflictCode: null,
  priceAreaAssurance: { status: 'verified', priceArea: 'SE3', confidence: 1, source: 'grid_area_master', candidateCount: 1, uniquePriceAreaCount: 1, sourceVersion: null, evidence: {} },
  capabilities: { pricing_ready: true, quote_ready: true, facility_lookup_ready: false, switch_request_creatable: false, switch_dispatch_ready: false },
  blockers: { pricing: [], quote: [], facility_lookup: [], switch_creation: [], switch_dispatch: [] },
}

async function pricingTransport(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const table = url.pathname.split('/').at(-1)!
  if (init?.method !== 'GET' || !Object.hasOwn(io.rows, table)) throw new Error(`Unexpected query: ${table}`)
  io.reads.push(url)
  const rows = io.rows[table].filter(row => {
    for (const [column, expression] of url.searchParams) {
      if (['select', 'order', 'limit'].includes(column)) continue
      if (expression.startsWith('eq.') && String(row[column]) === expression.slice(3)) continue
      if (expression.startsWith('in.(') && expression.slice(4, -1).split(',').includes(String(row[column]))) continue
      if (expression === 'not.is.null' && row[column] != null) continue
      return false
    }
    return true
  })
  rows.sort((left, right) => {
    for (const term of url.searchParams.get('order')?.split(',') ?? []) {
      const [column, direction] = term.split('.')
      const a = left[column], b = right[column]
      const order = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
      if (order) return direction === 'desc' ? -order : order
    }
    return 0
  })
  return Response.json(rows.slice(0, Number(url.searchParams.get('limit') ?? rows.length)))
}

function policy(source: string, priority: number, allowsFallback: boolean): Row {
  return {
    source_key: source, company_id: client.company_id, enabled: true, priority, max_age_minutes: 60,
    allow_indicative_latest: allowsFallback, supported_resolutions: ['monthly', 'quarterly'], price_areas: ['SE3'],
  }
}

function day(source: string, date: string, price: number, fields: Row = {}): Row {
  return {
    id: `${source}-${date}`, source, price_area: 'SE3', price_date: date, status: 'verified', resolution: 'hourly',
    average_sek_per_kwh: price, covered_duration_minutes: 1440, expected_duration_minutes: 1440,
    provider_fetched_at: fresh, verified_at: fresh, source_checksum: `${source}-${date}-checksum`, ...fields,
  }
}

function moreRecentDays(source: string) {
  return Array.from({ length: 31 }, (_, offset) => {
    const date = new Date(Date.UTC(2026, 10, 6 - offset)).toISOString().slice(0, 10)
    return day(source, date, 0.8)
  })
}

function publishedOffer(): PublicContractOffer {
  const type = io.resolutionType
  const model = commercialModelSchema.parse({
    schema_version: 'gridex_contract_pricing_v6_selection',
    price_options: [{
      price_option_reference: 'standard', option_code: 'standard', customer_name: 'Synthetic spot',
      customer_type: 'private', default: true, selection_required: false, internal_description: null,
      contract_type: type, binding_months: 0, notice_months: 1, auto_renew_enabled: false,
      renewal_term_months: null, valid_from: null, valid_to: null, earliest_start_date: null,
      latest_start_date: null, status: 'active', sort_order: 1, version_number: 1, area_prices: [], metadata: {},
    }],
    components: [], invoice_delivery_methods: ['email'],
  })
  return {
    id: 'synthetic-offer-row', company_id: client.company_id, price_plan_id: 'synthetic-plan',
    price_plan_version_id: 'synthetic-version', campaign_version_id: null, product_code: 'synthetic-product',
    public_name: 'Synthetic spot', public_description: null, contract_type: type, energy_direction: 'consumption',
    billing_model: 'spot', customer_type: 'private', monthly_fee_sek: null, invoice_fee_sek: 0,
    markup_ore_per_kwh: null, spot_markup_ore_per_kwh: null, variable_fee_ore_per_kwh: null,
    fixed_price_ore_per_kwh: null, green_fee_mode: null, green_fee_value: null,
    terms_version: null, valid_from: null, valid_to: null, sort_order: 1, metadata: {}, price_areas: ['SE3'],
    pricing_snapshot: {
      schema_version: model.schema_version, snapshot_schema: model.schema_version, vat_rate: 0.25,
      price_options: model.price_options, commercial_components: model.components, invoice_delivery_methods: model.invoice_delivery_methods,
      base_components: [{ source_type: 'spot', weight_percent: 100 }],
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
      annual_consumption_kwh: 12000, start_date: '2026-12-01', price_option_reference: 'standard',
      invoice_delivery_method: 'email', selected_component_references: [], site_count: 1,
    }),
  })
}

function dailyReads() {
  return io.reads.filter(url => url.pathname.endsWith('/spot_price_daily_summaries'))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(now))
  vi.clearAllMocks()
  io.resolutionType = 'variable_monthly'
  io.rows = { company_market_price_sources: [], market_price_previews: [], price_plan_versions: [],
    spot_price_daily_summaries: [], spot_price_monthly_summaries: [] }
  io.reads = []
  io.persist.mockResolvedValue({ quoteReference: 'quote_synthetic', validUntil: '2026-11-07T12:15:00.000Z' })
})
afterEach(() => vi.useRealTimers())

describe('mounted spot quote daily fallback', () => {
  it('uses one allowed provider for price, distinct days, period and checksum', async () => {
    io.rows.company_market_price_sources = [policy('excluded', 0, false), policy('preferred', 1, true), policy('other', 2, true)]
    io.rows.spot_price_daily_summaries = [
      day('excluded', '2026-11-02', 9), day('preferred', '2026-11-01', 0.4),
      day('other', '2026-11-01', 0.8), day('preferred', '2026-10-31', 0.2), day('other', '2026-10-31', 0.8),
    ]

    const response = await POST(quoteRequest())

    expect(response.status).toBe(201)
    const { data } = await response.json()
    expect(data.market_reference).toMatchObject({
      provider: 'preferred', source: 'preferred', price_sek_per_kwh: expect.closeTo(0.3),
      requested_days: 30, included_days: 2, period_start: '2026-10-31', period_end: '2026-11-01',
      source_checksum: 'preferred-2026-11-01-checksum:preferred-2026-10-31-checksum',
      is_indicative: true, is_stale: false, fallback_used: true,
    })
    expect(data.estimate.monthly_ex_vat).toBe(300)
    expect(io.persist).toHaveBeenCalledWith(expect.objectContaining({ marketSources: [expect.objectContaining({ provider: 'preferred', included_days: 2 })] }))
    expect(dailyReads().map(url => url.searchParams.get('source')).sort()).toEqual(['eq.other', 'eq.preferred'])
    expect(dailyReads().every(({ searchParams }) => searchParams.get('price_area') === 'eq.SE3' && searchParams.get('limit') === '30')).toBe(true)
  })

  it('keeps the preferred evidence outside the previous global 30-row limit', async () => {
    io.rows.company_market_price_sources = [policy('preferred', 1, true), policy('other', 2, true)]
    io.rows.spot_price_daily_summaries = [day('preferred', '2026-10-01', 0.2), ...moreRecentDays('other')]

    const response = await POST(quoteRequest())

    expect(response.status).toBe(201)
    expect((await response.json()).data.market_reference).toMatchObject({ provider: 'preferred', price_sek_per_kwh: 0.2, included_days: 1 })
  })

  it('filters interval resolution in the daily query before limiting evidence', async () => {
    io.resolutionType = 'variable_quarterly'
    io.rows.company_market_price_sources = [policy('preferred', 1, true)]
    io.rows.spot_price_daily_summaries = [
      day('preferred', '2026-10-01', 0.25, { resolution: 'quarter_hour' }), ...moreRecentDays('preferred'),
    ]

    const response = await POST(quoteRequest())

    expect(response.status).toBe(201)
    expect((await response.json()).data.market_reference).toMatchObject({ provider: 'preferred', source_resolution: 'quarter_hour', included_days: 1 })
    expect(dailyReads()[0].searchParams.get('resolution')).toBe('eq.quarter_hour')
  })

  it.each([fresh, stale])('keeps source freshness bounds when the highest-priority evidence is stale', async backupTime => {
    io.rows.company_market_price_sources = [policy('preferred', 1, true), policy('backup', 2, true)]
    io.rows.spot_price_daily_summaries = [
      day('preferred', '2026-11-02', 0.2, { provider_fetched_at: stale }),
      day('backup', '2026-11-01', 0.8, { provider_fetched_at: backupTime }),
    ]

    const response = await POST(quoteRequest())

    if (backupTime === stale) {
      expect(response.status).toBe(409)
      expect((await response.json()).error.code).toBe('market_price_stale')
      expect(io.persist).not.toHaveBeenCalled()
    } else {
      expect(response.status).toBe(201)
      expect((await response.json()).data.market_reference).toMatchObject({ provider: 'backup', price_sek_per_kwh: 0.8, source_as_of: fresh })
    }
  })

  it('keeps the settlement entry point isolated from unlocked quote evidence', async () => {
    io.rows.company_market_price_sources = [policy('preferred', 1, true)]
    io.rows.spot_price_daily_summaries = [day('preferred', '2026-11-01', 0.2)]

    await expect(resolveBasePriceSourceValues({ companyId: client.company_id, priceArea: 'SE3', billingMonth: '2026-11' }))
      .resolves.toMatchObject({ spotSource: null, spotSekPerKwh: null })
    expect(io.reads.some(url => url.pathname.endsWith('/spot_price_monthly_summaries'))).toBe(true)
    expect(dailyReads()).toHaveLength(0)
  })
})
