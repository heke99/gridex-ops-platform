import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, queries: [] as URL[] }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/integrations/apiAuth', async (original) => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(),
  logIntegrationApiRequest: vi.fn().mockResolvedValue(undefined),
  requireIntegrationApiAccess: vi.fn().mockResolvedValue({ ok: true, client: { company_id: 'company' } }),
  currentIntegrationApiResponseContext: () => null,
}))
vi.mock('@/lib/supabase/service', async () => ({
  supabaseService: createClient('http://127.0.0.1:54321', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input))
        expect(url.origin).toBe('http://127.0.0.1:54321')
        io.queries.push(url)
        const table = url.pathname.split('/').at(-1)!
        if (!(table in io.rows)) throw new Error(`Unexpected fixture query ${table}`)
        const filters = [...url.searchParams].filter(([key]) => !['select', 'order', 'limit'].includes(key))
        const rows = io.rows[table].filter(row => filters.every(([key, filter]) => {
          const [operator, value] = filter.split('.', 2)
          switch (operator) {
            case 'eq': return String(row[key]) === value
            case 'in': return value.slice(1, -1).split(',').includes(String(row[key]))
            case 'gt': return row[key] != null && Number(row[key]) > Number(value)
            default: throw new Error(`Unexpected fixture query operator ${operator}`)
          }
        }))
        const ordering = url.searchParams.get('order')?.split(',') ?? []
        rows.sort((first, second) => {
          for (const field of ordering) {
            const [key, direction] = field.split('.')
            const order = String(first[key]).localeCompare(String(second[key]))
            if (order) return direction === 'desc' ? -order : order
          }
          return 0
        })
        const limit = Number(url.searchParams.get('limit') ?? rows.length)
        return Response.json(rows.slice(0, limit))
      },
    },
  }),
}))

import { GET } from '@/app/api/v1/website/portfolio-prices/route'

const NOW = '2026-10-12T12:00:00Z'
const reference = 'offer_synthetic_portfolio'
const request = (query = '') => new NextRequest(`https://example.invalid/api/v1/website/portfolio-prices?offer_reference=${reference}${query}`)
const settlement = (month: string, area: string, amount: number | null = 40) => ({
  company_id: 'company', portfolio_id: 'portfolio', price_plan_version_id: 'version', delivery_month: month,
  price_area_code: area, portfolio_price_ore_per_kwh: amount, status: 'locked', is_current: true,
})
const monthAt = (offset: number) => new Date(Date.UTC(2021, offset, 1)).toISOString().slice(0, 10)
const queriesFor = (table: string) => io.queries.filter(url => url.pathname.endsWith(`/${table}`))

beforeEach(() => {
  io.queries = []
  const snapshot = {
    portfolio_method: { portfolio_id: 'portfolio', pricing_model: 'portfolio_monthly_settlement', display_rules: { show_historical_final: true } },
    price_components: [{ component_code: 'invoice_fee', amount: 0, calculation_type: 'per_invoice', unit: 'sek_invoice' }],
  }
  const graph = Object.fromEntries([
    'canonical_graph_consistent', 'forward_publication_link_valid', 'reverse_legacy_link_valid', 'company_chain_valid',
    'tenant_assignment_valid', 'channel_graph_valid', 'product_version_valid', 'source_offer_consistent', 'snapshot_hash_valid',
    'energy_direction_valid', 'contract_type_valid', 'successor_chain_valid', 'visible',
  ].map(key => [key, true]))
  const offer = {
    id: 'offer', company_id: 'company', canonical_offer_reference: reference, price_plan_version_id: 'version',
    contract_publication_version_id: 'publication', contract_product_version_id: 'product', legal_bundle_version_id: 'bundle',
    public_name: 'Portfolio', publication_status: 'published', is_archived: false, website_enabled: true,
    contract_type: 'portfolio', customer_type: 'private', canonical_pricing_snapshot: snapshot, invoice_fee_sek: 0,
  }
  io.rows = {
    companies: [{ id: 'company', slug: 'synthetic' }],
    canonical_visible_public_contracts_v: [offer],
    canonical_public_contract_delivery_readiness_v: [{ ...graph, company_id: 'company', channel: 'website', public_offer_id: 'offer', offer_reference: reference, publication_version_id: 'publication', customer_type: 'private' }],
    contract_publication_readiness_v: [{ company_id: 'company', contract_publication_version_id: 'publication', status: 'published', locked_at: NOW, blockers: [] }],
    legal_bundle_versions: [{ id: 'bundle', company_id: 'company', status: 'published', locked_at: NOW, published_at: NOW }],
    legal_bundle_version_documents: ['general_consumer_terms', 'price_terms'].map((module_key, sort_order) => ({ id: `legal-${sort_order}`, legal_bundle_version_id: 'bundle', module_key, title: 'Terms', content_sha256: 'a'.repeat(64), created_at: NOW, sort_order, unresolved_variables: [] })),
    contract_price_options: [{ id: 'option', company_id: 'company', contract_publication_version_id: 'publication', contract_product_version_id: 'product', price_plan_version_id: 'version', option_reference: 'standard', option_code: 'standard', customer_name: 'Portfolio', customer_type: 'private', contract_type: 'portfolio', status: 'active', is_default: true }],
    contract_price_option_area_prices: [{ company_id: 'company', contract_price_option_id: 'option', price_row_reference: 'standard_se3', price_area: 'SE3', amount: 40, unit: 'ore_per_kwh', status: 'active' }],
    portfolio_monthly_settlements: [],
  }
})

describe('mounted portfolio price history', () => {
  it('selects the canonical offer and filters its area and current priced rows before the database limit', async () => {
    const unrelated = { ...io.rows.canonical_visible_public_contracts_v[0], id: 'other', canonical_offer_reference: 'offer_unrelated' }
    io.rows.canonical_visible_public_contracts_v.push(unrelated)
    io.rows.portfolio_monthly_settlements = [
      ...Array.from({ length: 49 }, (_, index) => settlement(monthAt(index + 1), 'SE4')),
      ...Array.from({ length: 49 }, (_, index) => settlement(monthAt(index + 2), 'SE3', null)),
      { ...settlement(monthAt(51), 'SE3'), company_id: 'foreign' },
      { ...settlement(monthAt(51), 'SE3'), price_plan_version_id: 'wrong-version' },
      { ...settlement(monthAt(51), 'SE3'), portfolio_id: 'wrong-portfolio' },
      { ...settlement(monthAt(51), 'SE3'), is_current: false },
      { ...settlement(monthAt(51), 'SE3'), status: 'draft' },
      settlement(monthAt(0), 'SE3', 32),
    ]

    const response = await GET(request('&price_area=%20se3%20'))
    expect(response.status).toBe(200)
    expect((await response.json()).data.historical_final_prices).toEqual([
      { period_month: monthAt(0), price_area_code: 'SE3', amount: 32, unit: 'ore_per_kwh', vat_included: false, status: 'locked' },
    ])
    expect(queriesFor('canonical_visible_public_contracts_v').map(url => url.searchParams.get('canonical_offer_reference'))).toEqual([`eq.${reference}`])
    expect(queriesFor('canonical_public_contract_delivery_readiness_v').map(url => url.searchParams.get('offer_reference'))).toEqual([`eq.${reference}`])
    expect(queriesFor('portfolio_monthly_settlements').map(url => Object.fromEntries(url.searchParams))).toEqual([
      expect.objectContaining({ company_id: 'eq.company', price_area_code: 'eq.SE3', portfolio_id: 'in.(portfolio)', price_plan_version_id: 'in.(version)', limit: '48' }),
    ])
  })

  it('returns the latest 48 rows across areas in chronological order when the area is omitted', async () => {
    io.rows.portfolio_monthly_settlements = Array.from({ length: 49 }, (_, index) => settlement(monthAt(index), index % 2 ? 'SE3' : 'SE4'))
    const response = await GET(request())
    expect(response.status).toBe(200)
    const history = (await response.json()).data.historical_final_prices
    expect(history.map((row: { period_month: string }) => row.period_month)).toEqual(Array.from({ length: 48 }, (_, index) => monthAt(index + 1)))
    const [query] = queriesFor('portfolio_monthly_settlements')
    expect(query.searchParams.has('price_area_code')).toBe(false)
    expect(query.searchParams.get('limit')).toBe('48')
  })

  it('returns no data for a reference present only in another company and does no catalogue fallback', async () => {
    io.rows.canonical_visible_public_contracts_v[0].company_id = 'foreign'
    io.rows.canonical_public_contract_delivery_readiness_v[0].company_id = 'foreign'
    const response = await GET(request())
    expect(response.status).toBe(404)
    expect(queriesFor('canonical_visible_public_contracts_v')).toHaveLength(1)
    expect(queriesFor('canonical_public_contract_delivery_readiness_v')).toHaveLength(1)
    expect(queriesFor('portfolio_monthly_settlements')).toHaveLength(0)
  })

  it('checks the requested publication and retains its opt-out of public price history', async () => {
    const snapshot = io.rows.canonical_visible_public_contracts_v[0].canonical_pricing_snapshot as {
      portfolio_method: { display_rules: { show_historical_final: boolean } }
    }
    snapshot.portfolio_method.display_rules.show_historical_final = false
    io.rows.portfolio_monthly_settlements = [settlement(monthAt(0), 'SE3')]
    const response = await GET(request('&price_area=SE3'))
    expect(response.status).toBe(200)
    expect((await response.json()).data.historical_final_prices).toEqual([])

    io.rows.canonical_public_contract_delivery_readiness_v[0].canonical_graph_consistent = false
    const blocked = await GET(request('&price_area=SE3'))
    expect(blocked.status).toBe(500)
    expect((await blocked.json()).error.code).toBe('portfolio_prices_unavailable')
    expect(queriesFor('portfolio_monthly_settlements')).toHaveLength(1)
  })
})
