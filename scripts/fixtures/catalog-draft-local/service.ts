import 'server-only'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute } from 'node:path'
import { createClient } from '@supabase/supabase-js'

export const SUPABASE_SERVICE_URL = 'http://127.0.0.1:1'

function receiptPath() {
  const path = process.env.GRIDEX_CATALOG_DRAFT_RECEIPT
  assert(path && isAbsolute(path))
  assert.equal(basename(path), 'write-receipt.json')
  assert.match(basename(dirname(path)), /^gridex-catalog-draft-[A-Za-z0-9]+$/)
  return path
}

const company = 'e1000000-0000-4000-8000-000000000001'
const series = 'e9000000-0000-4000-8000-000000000003'
const actor = 'e2000000-0000-4000-8000-000000000001'
const active = 'e3000000-0000-4000-8000-000000000001'
const draft = 'e3000000-0000-4000-8000-000000000002'
const paused = 'e3000000-0000-4000-8000-000000000003'
const companyBasics = { id: company, name: 'Lokalt provbolag', status: 'active' }
const readiness = { ready: true, blockers: [] }

function offer(id: string, state: string, version: number, name:string, scope = company) {
  return {
    id, contract_offer_id: id, company_id: scope, name, slug: 'proof-' + version, slug_base: 'proof', is_active: state === 'published',
    status: 'active', offer_status: 'active', lifecycle_status: state, assignment_id: null, assignment_status: 'active',
    internal_channel_status: 'paused', website_channel_status: 'ended', api_channel_status: 'ended',
    internal_channel_valid_from: null, internal_channel_valid_to: null,
    website_channel_valid_from: null, website_channel_valid_to: null, api_channel_valid_from: null, api_channel_valid_to: null,
    internal_sales_allowed: state === 'published', website_publication_allowed: false, api_publication_allowed: false,
    currently_sellable: state === 'published', internally_sellable_now: state === 'published', website_available_now: false, api_available_now: false,
    active_publication_version_count: 0, internal_readiness: readiness, website_readiness: readiness, api_readiness: readiness,
    version_series_id: series, version_number:version, contract_type:'fixed', fixed_price_ore_per_kwh: 75+version*5,
    commercial_snapshot: {
      schema_version: 'gridex_contract_pricing_v6_selection',
      price_options: [{
        price_option_reference: 'price-option-fixed', option_code: 'standard',
        customer_name: 'Standardpris', contract_type: 'fixed', binding_months: 12,
        notice_months: 1, auto_renew_enabled: false, renewal_term_months: null,
        default: true, sort_order: 1, status: 'active',
        area_prices: ['SE1', 'SE2', 'SE3', 'SE4'].map(area => ({
          price_row_reference: 'price-row-' + area.toLowerCase(), price_area: area,
          amount: 75 + version * 5, unit: 'ore_per_kwh',
        })),
      }],
      commercial_components: [],
      invoice_delivery_methods: ['email', 'e_invoice', 'paper'],
    },
    monthly_fee_sek: version*10, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z',
  }
}
const offers = [
  offer(active,'published',1,'Aktiv föregångare'),
  offer(draft,'draft',2,'Utkast två'),
  offer(paused,'paused',3,'Pausad tre'),
  offer('e3000000-0000-4000-8000-000000000008','archived',4,'Arkiverat fyra'),
]

function configure() {
  return {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.origin !== 'http://127.0.0.1:1' || !url.pathname.startsWith('/rest/v1/')) throw new Error('Stopped nonlocal fixture address')
      const table = url.pathname.slice('/rest/v1/'.length)
      const body = typeof options?.body === 'string' ? JSON.parse(options.body) : {}
      const q = url.searchParams
      if (table === 'rpc/canonical_authenticated_tenant_context') {
        assert.equal(body.p_selected_company_id, company)
        return Response.json({
          authorized: true, user_id: actor, selected_company_id: company, is_platform_admin: true,
          permissions: ['contracts.read','contracts.edit_draft','pricing.write'],
          roles: ['super_admin'],
        })
      }
      if (table === 'rpc/gridex_get_user_roles') {
        assert.equal(body.p_user_id, actor)
        return Response.json(['super_admin'])
      }
      if (table === 'rpc/gridex_upsert_internal_contract_offer_v3') {
        assert.equal(options?.method, 'POST')
        const { p_company_id: companyId, p_offer_id: offerId, p_actor_user_id: actorId } = body
        assert.deepEqual({ companyId, offerId, actorId }, { companyId: company, offerId: draft, actorId: actor })
        const { name, lifecycle_status: lifecycleStatus, channels } = body.p_payload
        assert.equal(name, 'Utkast två, redigerat')
        assert.equal(lifecycleStatus, 'draft')
        const { internal, website, api } = channels
        assert.deepEqual({ internal, website, api }, { internal: 'paused', website: 'paused', api: 'paused' })
        writeFileSync(receiptPath(), JSON.stringify({
          name, companyId, offerId, actorId, lifecycleStatus,
          priceOptions: body.p_pricing_snapshot.price_options.length,
        }) + '\n', { flag: 'wx', mode: 0o600 })
        return Response.json({
          ok: true, company_id: company, offer: { id: draft, company_id: company },
          pricing: { price_plan_id: 'fixture-plan', price_plan_version_id: 'fixture-version', price_book_id: 'fixture-book', version_label: 'v2' },
          contract_product_id: 'fixture-product', contract_product_version_id: 'fixture-product-version',
          tenant_contract_assignment_id: 'fixture-assignment',
          price_option_references: body.p_pricing_snapshot.price_options.map(() => 'fixture-price-option'),
          component_references: body.p_pricing_snapshot.commercial_components.map(() => 'fixture-component'),
        })
      }
      const saved = existsSync(receiptPath()) ? JSON.parse(readFileSync(receiptPath(), 'utf8')) as { name: string } : null
      const currentOffers = offers.map(item => saved && item.id === draft ? { ...item, name: saved.name } : item)
      if (table === 'companies') {
        const id = q.get('id')
        return Response.json((id ? id === 'eq.' + company : true) ? [companyBasics] : [])
      }
      if (table === 'contract_offers') {
        assert.equal(q.get('id'), 'eq.' + draft)
        assert.equal(q.get('company_id'), 'eq.' + company)
        return Response.json([currentOffers.find(item => item.id === draft)])
      }
      if (table === 'company_memberships') {
        return Response.json([{ user_id: actor, company_id: company, membership_role: 'member', status:'active', companies:companyBasics }])
      }
      if (table === 'portfolios' || table === 'customer_contracts') return Response.json([])
      if (table !== 'canonical_internal_contract_offers_v') {
        return Response.json({ code: 'fixture_unknown_rpc', message: table }, { status: 400 })
      }
      assert.equal(q.get('company_id'), 'eq.' + company)
      let filtered = currentOffers.filter(item => item.company_id === company)
      const state = q.get('lifecycle_status')
      if (state?.startsWith('in.(')) filtered = filtered.filter(item => state.slice(4,-1).split(',').includes(item.lifecycle_status))
      const id = q.get('id')
      if (id) filtered = filtered.filter(item => id === 'eq.' + item.id)
      const version = q.get('version_number')
      if (version) {
        assert.equal(q.get('version_series_id'), 'eq.' + series)
        filtered = filtered.filter(item => item.version_number < Number(version.slice(3))).sort((a,b) => b.version_number-a.version_number)
      }
      return Response.json(filtered.slice(0, Number(q.get('limit') ?? 25)))
    } },
  }
}


export function fixtureClient() {
  const client = createClient(SUPABASE_SERVICE_URL, 'synthetic-local-only', configure())
  client.auth.getUser = (async () => ({
    data: { user: { id: actor, email: 'staff@example.invalid', user_metadata: {}, app_metadata: {}, aud: 'authenticated', created_at: '' } },
    error: null,
  })) as typeof client.auth.getUser
  return client
}

export const supabaseService = fixtureClient()
export const createSupabaseServiceRequestClient = () => fixtureClient()
