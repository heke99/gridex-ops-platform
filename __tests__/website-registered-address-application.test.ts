// FINDINGS F51: the website customer application carries the customer's own registered address
// (folkbokföringsadress). The mounted route, validators, process and the shared writer are real; only the
// database transport and the credential are synthetic. No PostgreSQL transaction or RLS is claimed here.
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type Receipt = { table: string; mode: string; filters: Array<[string, string, unknown]>; row?: Row }
const io = vi.hoisted(() => ({ rows: {} as Record<string, Row[]>, queries: [] as Receipt[], rpcs: [] as Array<{ name: string; args: Row }>, serial: 500, client: {} as Row, registeredAtCommit: [] as number[] }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => {
  class Query {
    filters: Array<[string, string, unknown]> = []; orders: Array<[string, boolean]> = []
    maximum = Infinity; mode = 'select'; pending: Row[] = []; patch: Row = {}; head = false
    constructor(readonly table: string) {}
    select(_fields?: string, options?: { head?: boolean }) { this.head = Boolean(options?.head); return this }
    eq(key: string, value: unknown) { this.filters.push(['eq', key, value]); return this }
    neq(key: string, value: unknown) { this.filters.push(['neq', key, value]); return this }
    is(key: string, value: unknown) { this.filters.push(['is', key, value]); return this }
    in(key: string, value: unknown[]) { this.filters.push(['in', key, value]); return this }
    contains(key: string, value: Row) { this.filters.push(['contains', key, value]); return this }
    gt(key: string, value: unknown) { this.filters.push(['gt', key, value]); return this }
    gte(key: string, value: unknown) { this.filters.push(['gte', key, value]); return this }
    lt(key: string, value: unknown) { this.filters.push(['lt', key, value]); return this }
    lte(key: string, value: unknown) { this.filters.push(['lte', key, value]); return this }
    or(value: string) { this.filters.push(['or', '', value]); return this }
    order(key: string, options: { ascending?: boolean } = {}) { this.orders.push([key, options.ascending ?? true]); return this }
    limit(value: number) { this.maximum = value; return this }
    insert(value: Row | Row[]) { this.mode = 'insert'; this.pending = (Array.isArray(value) ? value : [value]); return this }
    upsert(value: Row | Row[]) { this.mode = 'upsert'; this.pending = (Array.isArray(value) ? value : [value]); return this }
    update(value: Row) { this.mode = 'update'; this.patch = value; return this }
    delete() { this.mode = 'delete'; return this }
    match(row: Row) {
      return this.filters.every(([op, key, value]) => {
        const actual = row[key]
        if (op === 'or') return String(value).split(',').some(term => { const [field, comparison, ...raw] = term.split('.'); return comparison === 'is' ? row[field] == null : String(row[field]) === raw.join('.') })
        if (op === 'contains') return Object.entries(value as Row).every(([k, v]) => (actual as Row | null)?.[k] === v)
        if (op === 'in') return (value as unknown[]).includes(actual)
        if (op === 'eq') return actual === value
        if (op === 'neq') return actual !== value
        if (op === 'is') return (actual ?? null) === value
        if (actual == null) return false
        if (op === 'gt') return String(actual) > String(value)
        if (op === 'gte') return String(actual) >= String(value)
        if (op === 'lt') return String(actual) < String(value)
        if (op === 'lte') return String(actual) <= String(value)
        throw new Error(`Undeclared filter ${op}`)
      })
    }
    async run(single = false) {
      if (!(this.table in io.rows)) throw new Error(`Undeclared database transport table: ${this.table}`)
      io.queries.push({ table: this.table, mode: this.mode, filters: structuredClone(this.filters), ...(this.mode !== 'select' ? { row: structuredClone(this.pending[0] ?? this.patch) } : {}) })
      let rows = io.rows[this.table].filter(row => this.match(row))
      if (this.mode === 'insert' || this.mode === 'upsert') {
        if (this.mode === 'insert' && this.table === 'integration_api_write_idempotency' && this.pending.some(candidate => io.rows[this.table].some(existing => ['company_id','api_client_id','route','idempotency_key'].every(key => candidate[key] === existing[key])))) {
          return { data: null, error: { code: '23505', message: 'Synthetic exact idempotency unique boundary' }, count: 0 }
        }
        rows = this.pending.map(row => ({ id: `00000000-0000-4000-8000-${String(++io.serial).padStart(12, '0')}`, created_at: '2026-10-12T12:00:00Z', updated_at: '2026-10-12T12:00:00Z', ...structuredClone(row) }))
        io.rows[this.table].push(...rows)
      } else if (this.mode === 'update') rows.forEach(row => Object.assign(row, structuredClone(this.patch)))
      else if (this.mode === 'delete') io.rows[this.table] = io.rows[this.table].filter(row => !this.match(row))
      rows = [...rows].sort((a, b) => { for (const [key, ascending] of this.orders) { if (a[key] !== b[key]) return (String(a[key]) < String(b[key]) ? -1 : 1) * (ascending ? 1 : -1) } return 0 }).slice(0, this.maximum)
      return { data: this.head ? null : single ? rows[0] ?? null : rows, error: null, count: rows.length }
    }
    single() { return this.run(true) }
    maybeSingle() { return this.run(true) }
    then(resolve: (result: unknown) => unknown, reject?: (error: unknown) => unknown) { return this.run().then(resolve, reject) }
  }
  return { supabaseService: {
    from: (table: string) => new Query(table),
    auth: { admin: { getUserById: async (userId: string) => ({ data: { user: { id: userId, email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null }) } },
    rpc: async (name: string, args: Row = {}) => {
      io.rpcs.push({ name, args: structuredClone(args) })
      if (name === 'public_contract_feed_fingerprint_v1') return { data: [{ fingerprint: 'a'.repeat(32) }], error: null }
      if (name === 'canonical_tenant_operation_decision') return { data: { allowed: true, reason_code: 'synthetic-ready', company_status: 'active', capability_status: 'active', production_status: 'active', state_version: 1 }, error: null }
      if (name === 'gridex_customer_application_runtime_contract_v1') return { data: { ready: true, checks: {} }, error: null }
      if (name === 'canonical_next_application_number') return { data: 'SYNTHETIC-APPLICATION', error: null }
      if (name === 'canonical_onboard_customer_graph') {
        // Receipt of the transactional RPC command; supplies resources for the real rereads that follow.
        const command = asRecord(args.p_command), customer = asRecord(command.customer), site = asRecord(command.site), contract = asRecord(command.contract)
        const { computeCustomerSiteAddressHash } = await import('@/lib/customer-sites/addressIntake')
        io.rows.customers = [{ ...customer, id: CUSTOMER, company_id: command.company_id, customer_number: 'SYNTHETIC-CUSTOMER' }]
        io.rows.customer_sites = [{ ...site, id: SITE, company_id: command.company_id, customer_id: CUSTOMER, address_hash: computeCustomerSiteAddressHash({ street: site.street, postalCode: site.postal_code, city: site.city, country: site.country }).hash }]
        io.rows.customer_contracts = [{ ...contract, id: CONTRACT, company_id: command.company_id, customer_id: CUSTOMER, contract_number: 'SYNTHETIC-CONTRACT', status: 'pending_signature', price_plan_id: PLAN, price_plan_version_id: PLAN_VERSION }]
        return { data: { ok: true, code: 'customer_onboarding_committed', operation_id: id(91), correlation_id: command.correlation_id, customer_id: CUSTOMER, customer_number: 'SYNTHETIC-CUSTOMER', created_new_customer: true, site_id: SITE, metering_point_id: null, contract_id: CONTRACT, price_snapshot_id: id(92), power_of_attorney_id: null }, error: null }
      }
      if (name === 'gridex_retry_website_contract_signature') return { data: null, error: null }
      if (name === 'gridex_fail_website_contract_signature') return { data: null, error: null }
      // The signed contract's masterdata section (F51 declaration); none here, so the v2 snapshot is unchanged.
      if (name === 'gridex_contract_customer_masterdata_section_v1') return { data: null, error: null }
      if (name === 'gridex_finalize_website_contract_signature') {
        const versions = args.p_legal_versions as Row[]
        return { data: { signed_at: args.p_accepted_at, signature_snapshot_sha256: args.p_signature_snapshot_sha256, acceptance_ids: Object.fromEntries(versions.map((version, index) => [String(version.id), id(120 + index)])) }, error: null }
      }
      if (name === 'gridex_commit_customer_application_provisioning') io.registeredAtCommit.push(io.rows.customer_addresses.filter(row => row.type === 'registered').length)
      if (name === 'gridex_commit_customer_application_provisioning') return { data: { operation_id: args.p_operation_id, workflow_id: WORKFLOW, continuation_job_id: id(93), state: args.p_state }, error: null }
      if (name === 'gridex_transition_customer_application_workflow') return { data: { workflow_id: WORKFLOW, operation_id: id(91), state: args.p_to_state, workflow_version: 1 }, error: null }
      throw new Error(`Undeclared RPC transport: ${name}`)
    },
  } }
})
vi.mock('@/lib/integrations/apiAuth', async original => {
  const actual = await original<typeof import('@/lib/integrations/apiAuth')>()
  return { ...actual, logIntegrationApiRequest: vi.fn().mockResolvedValue(undefined), currentIntegrationApiResponseContext: () => null,
    requireIntegrationApiAccess: async () => {
      const { bindAuthenticatedApiResponseProfile } = await import('@/lib/integrations/apiResponseProfile')
      bindAuthenticatedApiResponseProfile(io.client as unknown as import('@/lib/integrations/apiAuth').IntegrationApiClient)
      return { ok: true, client: io.client, context: { companyId: io.client.company_id, actorId: io.client.id, actorType: 'integration' }, rateLimit: { limit: 100, count: 1, remaining: 99, resetAt: null } }
    },
  }
})
vi.mock('@/lib/audit/actionLogger', () => ({ scheduleUsageEvent: vi.fn().mockResolvedValue(undefined), logUsageEvent: vi.fn().mockResolvedValue(undefined), logAction: vi.fn().mockResolvedValue(undefined) }))

import { DEFAULT_EMAIL_TEMPLATES } from '@/lib/email/emailTemplates'
import { DEFAULT_EMAIL_EVENT_RULES } from '@/lib/email/emailEvents'
import { commercialModelSchema } from '@/lib/pricing/commercialModel'
import { TENANT_WEBSITE_RECOMMENDED_SCOPES } from '@/lib/integrations/websiteIntegrationContract'
import { ApplicationSchema, applicationPayloadHash } from '@/lib/website/customerApplicationSchemas'
import { normalizeRawApplication } from '@/lib/website/customerApplicationCore'
import { GET as legalGET } from '@/app/api/v1/website/legal-bundle/route'
import { POST as quotePOST } from '@/app/api/v1/website/quote/route'
import { POST as applicationPOST } from '@/app/api/v1/website/customer-applications/route'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const COMPANY = id(1), FOREIGN = id(2), CLIENT = id(3), OFFER = id(4), PUBLICATION = id(5), PRODUCT = id(6), PRODUCT_VERSION = id(7), PLAN = id(8), PLAN_VERSION = id(9), BUNDLE = id(10), RESOLUTION = id(11), OPTION = id(12), CUSTOMER = id(13), SITE = id(14), CONTRACT = id(16), WORKFLOW = id(18)
const NOW = '2026-10-12T12:00:00.000Z', START = '2026-11-01', OFFER_REFERENCE = 'offer_synthetic_fixed', PATH = '/api/v1/website/customer-applications'
// Three deliberately different synthetic addresses: home (registered), invoice and facility.
const HOME = { street: 'Hemvägen 4', street2: 'lgh 1102', postal_code: '41301', city: 'Göteborg', country: 'SE' }
const BILLING = { billing_street: 'Box 77', billing_postal_code: '10005', billing_city: 'Stockholm', billing_country: 'SE' }
const FACILITY = { street: 'Sommarstugevägen 9', postal_code: '58220', city: 'Linkoping', country: 'SE' }

function asRecord(value: unknown): Row { return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {} }
function request(path: string, method = 'GET', body?: Row, key?: string) {
  return new NextRequest(`https://app.gridex.se${path}`, { method, headers: { Authorization: 'Bearer synthetic-transport-key', ...(body ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined })
}
function commercialSnapshot() {
  const model = commercialModelSchema.parse({ schema_version: 'gridex_contract_pricing_v6_selection', price_options: [{ price_option_reference: 'fixed_standard', option_code: 'fixed_standard', customer_name: 'Synthetic fixed', customer_type: 'private', default: true, selection_required: false, internal_description: null, contract_type: 'fixed', binding_months: 12, notice_months: 1, auto_renew_enabled: false, renewal_term_months: null, valid_from: null, valid_to: null, earliest_start_date: null, latest_start_date: null, status: 'active', sort_order: 1, version_number: 1, area_prices: [{ price_row_reference: 'fixed_standard_se3', price_area: 'SE3', amount: 125, unit: 'ore_per_kwh', vat_treatment: 'standard', valid_from: null, valid_to: null, metadata: {} }], metadata: {} }], components: [], invoice_delivery_methods: ['email', 'paper'] })
  return { schema_version: model.schema_version, snapshot_schema: model.schema_version, energy_direction: 'consumption', vat_rate: .25, commercial_components: model.components, price_options: model.price_options, invoice_delivery_methods: model.invoice_delivery_methods, base_components: [{ source_type: 'fixed', weight_percent: 100, fixed_price_sek_per_kwh: 1.25, price_area: 'SE3', label: 'Synthetic fixed' }], price_components: [{ component_code: 'invoice_fee', component_type: 'invoice_fee', name: 'Invoice fee', amount: 0, calculation_type: 'per_invoice', unit: 'sek_invoice', status: 'active', website_card_visible: false }] }
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW)); vi.stubEnv('GRIDEX_AUTOMATION_USER_ID', id(99)); vi.stubEnv('CUSTOMER_OPERATION_CRON_SECRET', 'synthetic-test-only')
  io.serial = 500; io.queries = []; io.rpcs = []; io.registeredAtCommit = []
  io.client = { id: CLIENT, company_id: COMPANY, name: 'Synthetic Website', status: 'active', key_prefix: 'unit', secret_hash: 'synthetic-unit', scopes: [...TENANT_WEBSITE_RECOMMENDED_SCOPES], allowed_ips: [], allowed_origins: ['https://synthetic.example.invalid'], rate_limit_per_minute: 100, expires_at: null, metadata: { api_contract_profiles: { website: '2026-10-09.1' } } }
  const empty = ['company_capabilities','webhook_subscriptions','customer_portal_identities','customer_portal_accounts','customers','customer_sites','metering_points','website_contract_quotes','integration_api_write_idempotency','canonical_energy_flow_events','canonical_energy_remediation_queue','website_customer_applications','customer_application_workflows','customer_operation_jobs','customer_supply_periods','supplier_switch_events','communication_logs','tenant_email_outbox','domain_events','webhook_deliveries','event_outbox','external_contract_intakes','audit_logs','portfolio_monthly_settlements','contract_charge_ledger','price_components','pricing_component_rules','price_plan_versions','portfolio_price_estimates','spot_price_monthly_summaries','market_price_previews','customer_legal_acceptances','customer_addresses']
  io.rows = Object.fromEntries(empty.map(table => [table, []]))
  io.rows.user_profiles = [{ id: id(99), user_status: 'active' }]
  io.rows.companies = [{ id: COMPANY, status: 'active', name: 'Synthetic electricity', org_number: '5560160680', slug: 'synthetic', external_tenant_reference: 'tenant_synthetic_0123456789abcdef0123456789', customer_portal_url: 'https://synthetic.example.invalid/portal', branding: {}, metadata: { website_portal_identity_mode: 'post_auth_allowed' } }]
  io.rows.tenant_website_readiness_v = [{ company_id: COMPANY, has_public_contracts: true, has_terms: true, has_privacy_policy: true, has_withdrawal: true, has_power_of_attorney_text: true, has_price_terms: true, has_verified_sender: true, has_mail_templates: true }]
  io.rows.company_email_settings = [{ id: id(60), company_id: COMPANY, verification_status: 'verified' }]
  io.rows.company_email_templates = DEFAULT_EMAIL_TEMPLATES.map((row, index) => ({ id: id(100 + index), company_id: COMPANY, language: 'sv', is_active: true, ...row }))
  io.rows.email_event_rules = DEFAULT_EMAIL_EVENT_RULES.map(row => ({ company_id: COMPANY, enabled: true, is_active: true, ...row }))
  io.rows.manual_communication_mailboxes = [{ id: id(61), company_id: COMPANY, environment: 'production', is_active: true, is_verified: true }]
  io.rows.grid_owner_contact_channels = [{ id: id(62), company_id: COMPANY, channel_type: 'email', is_enabled: true }]
  const snapshot = commercialSnapshot()
  io.rows.canonical_visible_public_contracts_v = [{ id: OFFER, company_id: COMPANY, price_plan_id: PLAN, price_plan_version_id: PLAN_VERSION, contract_product_id: PRODUCT, contract_product_version_id: PRODUCT_VERSION, contract_publication_version_id: PUBLICATION, legal_bundle_version_id: BUNDLE, canonical_offer_reference: OFFER_REFERENCE, public_name: 'Synthetic fixed', contract_type: 'fixed', customer_type: 'private', publication_status: 'published', website_enabled: true, is_archived: false, is_public: true, invoice_fee_sek: 0, price_areas: ['SE3'], canonical_pricing_snapshot: snapshot }]
  const graph: Row = Object.fromEntries(['canonical_graph_consistent','forward_publication_link_valid','reverse_legacy_link_valid','company_chain_valid','tenant_assignment_valid','channel_graph_valid','product_version_valid','source_offer_consistent','snapshot_hash_valid','energy_direction_valid','contract_type_valid','successor_chain_valid','legal_ready','visible','website_enabled'].map(key => [key, true]))
  io.rows.canonical_public_contract_delivery_readiness_v = ['website','api'].map(channel => ({ ...graph, company_id: COMPANY, channel, public_offer_id: OFFER, offer_reference: OFFER_REFERENCE, publication_version_id: PUBLICATION, customer_type: 'private', name: 'Synthetic fixed', contract_type: 'fixed', product_code: 'synthetic', invoice_fee_sek: 0, pricing_snapshot: snapshot, company_status: 'active', publication_status: 'published', publication_version_status: 'published', locked_at: NOW, blockers: [], price_option_count: 1, assignment_id: id(80), assignment_status: 'active', channel_id: id(81), channel_status: 'active' }))
  io.rows.contract_publication_readiness_v = [{ company_id: COMPANY, contract_publication_version_id: PUBLICATION, status: 'published', locked_at: NOW, blockers: [] }]
  io.rows.contract_publication_revisions = ['website','api'].map(channel => ({ company_id: COMPANY, channel, revision: 7, revision_token: 'synthetic', updated_at: NOW }))
  io.rows.legal_bundle_versions = [{ id: BUNDLE, company_id: COMPANY, status: 'published', locked_at: NOW, published_at: NOW }]
  io.rows.legal_bundle_version_documents = ['general_consumer_terms','price_terms'].map((module_key, index) => ({ id: id(30 + index), legal_bundle_version_id: BUNDLE, module_key, title: module_key, rendered_body: 'Synthetic immutable legal text', template_version: 'v1', content_sha256: String(index + 1).repeat(64), origin: 'canonical_bundle_document', created_at: NOW, sort_order: index, unresolved_variables: [] }))
  io.rows.contract_product_versions = [{ id: PRODUCT_VERSION, company_id: COMPANY, required_legal_modules: ['general_consumer_terms','price_terms'] }]
  io.rows.contract_price_options = [{ id: OPTION, company_id: COMPANY, contract_product_version_id: PRODUCT_VERSION, price_plan_version_id: PLAN_VERSION, contract_publication_version_id: PUBLICATION, option_reference: 'fixed_standard', option_code: 'fixed_standard', customer_name: 'Synthetic fixed', contract_type: 'fixed', customer_type: 'private', binding_months: 12, notice_months: 1, auto_renew_enabled: false, renewal_term_months: null, is_default: true, selection_required: false, valid_from: null, valid_to: null, status: 'active', sort_order: 1, metadata: {} }]
  io.rows.contract_price_option_area_prices = [{ company_id: COMPANY, contract_price_option_id: OPTION, price_row_reference: 'fixed_standard_se3', price_area: 'SE3', amount: 125, unit: 'ore_per_kwh', status: 'active', valid_from: null, valid_to: null }]
  io.rows.customer_site_resolution = [{ id: RESOLUTION, company_id: COMPANY, price_area: 'SE3', grid_area_code: null, grid_owner_id: null, resolution_status: 'price_area_only', confidence: 1, price_area_assurance_status: 'verified', price_area_assurance_source: 'postal_consensus', price_area_assurance_confidence: 1, price_area_assurance_source_version: 'synthetic-v1', price_area_candidate_count: 1, price_area_unique_count: 1, price_area_evidence: { method: 'single_area_consensus' }, resolved_at: NOW, expires_at: '2026-12-01T00:00:00Z', resolver_version: 'synthetic-v1', geodata_version: 'synthetic-geodata', source_chain: ['synthetic-provider'] }]
  io.rows.company_market_price_sources = [{ company_id: COMPANY, enabled: true, source_key: 'synthetic-provider', priority: 1, max_age_minutes: 180, supported_resolutions: ['hourly','quarterly'], price_areas: ['SE3'] }]
  io.rows.spot_price_intervals = [{ source: 'synthetic-provider', price_area: 'SE3', time_start: NOW, time_end: '2026-10-12T12:15:00.000Z', sek_per_kwh: .5, resolution: 'quarter_hour' }]
  io.rows.spot_price_daily_summaries = [{ source: 'synthetic-provider', price_area: 'SE3', price_date: '2026-10-12', provider_fetched_at: NOW, status: 'verified' }]
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

const quoteRequest = () => ({ offer_reference: OFFER_REFERENCE, resolution_id: RESOLUTION, customer_type: 'private', annual_consumption_kwh: 12000, start_date: START, price_option_reference: 'fixed_standard', invoice_delivery_method: 'email', selected_component_references: [], site_count: 1 })
async function applicationPayload(customer: Row): Promise<Row> {
  const legal = asRecord((await (await legalGET(request('/api/v1/website/legal-bundle?offer_reference=' + OFFER_REFERENCE))).json()).data)
  const quoteResponse = await quotePOST(request('/api/v1/website/quote', 'POST', quoteRequest(), 'synthetic-registered-quote'))
  expect(quoteResponse.status).toBe(201)
  const quote = asRecord((await quoteResponse.json()).data)
  return {
    external_customer_id: 'synthetic-customer', offer_reference: OFFER_REFERENCE, quote_reference: quote.quote_reference, resolution_id: RESOLUTION,
    annual_consumption_kwh: 12000, price_option_reference: 'fixed_standard', invoice_delivery_method: 'email', selected_component_references: [], site_count: 1,
    customer: { customer_type: 'private', first_name: 'Synthetic', last_name: 'Applicant', personal_number: '198112189876', email: 'synthetic@example.invalid', ...BILLING, ...customer },
    site: FACILITY,
    contract: { requested_start_date: START, requested_start_mode: 'specific_date' },
    legal_bundle_version: legal.bundle_version,
    legal_acceptances: (legal.requirements as Row[]).map(row => ({ requirement_code: row.requirement_code, document_reference: row.document_reference, document_version: row.document_version, document_hash: row.document_hash, accepted: true, accepted_at: NOW })),
    settlement: quote.settlement,
  }
}
async function submit(payload: Row, key = 'synthetic-registered-application') {
  const response = await applicationPOST(request(PATH, 'POST', payload, key))
  return { status: response.status, body: await response.json() as Row }
}
const registeredRows = () => io.rows.customer_addresses.filter(row => row.type === 'registered')
const wrote = (table: string) => io.queries.some(query => query.table === table && query.mode !== 'select')

describe('website application: registered address is required and validated (F51)', () => {
  it('a new application without customer.registered_address gets 422 naming the field, even when billing and facility addresses are present', async () => {
    const { status, body } = await submit(await applicationPayload({}))
    expect(status).toBe(422)
    expect(asRecord(body.error)).toMatchObject({ code: 'registered_address_required', field: 'customer.registered_address' })
    expect(io.rpcs.some(call => call.name === 'canonical_onboard_customer_graph')).toBe(false)
    expect(wrote('customer_addresses')).toBe(false)
    expect(wrote('website_customer_applications')).toBe(false)
  })

  it('a business customer must declare the organisation\'s registered address too (Z01 uses it with the SE1 identity)', async () => {
    const payload = await applicationPayload({ customer_type: 'business', company_name: 'Synthetic AB', org_number: '556036-0793', personal_number: undefined, first_name: undefined, last_name: undefined })
    const { status, body } = await submit(payload)
    expect(status).toBe(422)
    expect(asRecord(body.error)).toMatchObject({ code: 'registered_address_required', field: 'customer.registered_address' })
  })

  it.each([
    ['a non-object value', 'Hemvägen 4, 41301 Göteborg', 'registered_address_invalid', 'customer.registered_address'],
    ['a five-digit postal code missing', { street: 'Hemvägen 4', postal_code: '4130', city: 'Göteborg' }, 'registered_address_invalid', 'customer.registered_address.postal_code'],
    ['an empty street', { street: ' ', postal_code: '41301', city: 'Göteborg' }, 'registered_address_invalid', 'customer.registered_address.street'],
    ['a street longer than the Ediel 35-character limit', { street: 'x'.repeat(36), postal_code: '41301', city: 'Göteborg' }, 'registered_address_invalid', 'customer.registered_address.street'],
    ['a foreign address', { ...HOME, country: 'NO' }, 'registered_address_invalid', 'customer.registered_address.country'],
    ['a misplaced camelCase key', { street: 'Hemvägen 4', postalCode: '41301', city: 'Göteborg' }, 'unknown_field', 'customer.registered_address.postalCode'],
    ['a non-text value', { street: 'Hemvägen 4', postal_code: 41301, city: 'Göteborg' }, 'registered_address_invalid', 'customer.registered_address.postal_code'],
  ])('rejects %s with 422 before any database access', async (_case, registered_address, code, field) => {
    const { status, body } = await submit({ external_customer_id: 'synthetic-customer', customer: { customer_type: 'private', email: 'synthetic@example.invalid', registered_address } })
    expect(status).toBe(422)
    expect(asRecord(body.error)).toMatchObject({ code, field })
    expect(io.queries.filter(query => query.mode !== 'select')).toEqual([])
    expect(io.queries.some(query => ['website_customer_applications', 'customer_addresses', 'customers'].includes(query.table))).toBe(false)
  })
})

describe('website application: the declared registered address is stored once with provenance (F51)', () => {
  it('stores exactly one current registered address for the created customer, with website provenance, never the billing or facility address', async () => {
    const { status, body } = await submit(await applicationPayload({ registered_address: HOME }))
    expect(status, JSON.stringify(body)).toBe(200)
    expect(asRecord(body.data)).toMatchObject({ application_number: 'SYNTHETIC-APPLICATION', customer_number: 'SYNTHETIC-CUSTOMER', status: 'accepted' })
    expect(registeredRows()).toEqual([expect.objectContaining({
      company_id: COMPANY, customer_id: CUSTOMER, type: 'registered', is_active: true, moved_in_at: null,
      street_1: 'Hemvägen 4', street_2: 'lgh 1102', postal_code: '413 01', city: 'Göteborg', country: 'SE',
      metadata: { registered_address_source: 'website_declaration', declared_at: NOW, declared_by: null, source_reference: 'SYNTHETIC-APPLICATION' },
    })])
    // The billing address still travels as type 'billing' in the onboarding command; no address is reused as 'registered'.
    const command = asRecord(io.rpcs.find(call => call.name === 'canonical_onboard_customer_graph')?.args.p_command)
    expect(asRecord(command.address)).toMatchObject({ type: 'billing', street_1: BILLING.billing_street })
    const stored = registeredRows()[0]
    expect([BILLING.billing_street, FACILITY.street]).not.toContain(stored.street_1)
    // The address exists before the provisioning commit that starts Ediel automation.
    expect(io.registeredAtCommit).toEqual([1])
    // Tenant and customer scoping of the writer's own read.
    const read = io.queries.find(query => query.table === 'customer_addresses' && query.mode === 'select')
    expect(read?.filters).toEqual(expect.arrayContaining([['eq', 'company_id', COMPANY], ['eq', 'customer_id', CUSTOMER], ['eq', 'type', 'registered']]))
  })

  it('an idempotent replay of the same application returns the original outcome without a second address or customer graph', async () => {
    const payload = await applicationPayload({ registered_address: HOME })
    const first = await submit(payload)
    expect(first.status).toBe(200)
    const replay = await submit(payload)
    expect(replay.status, JSON.stringify(replay.body)).toBe(200)
    expect(asRecord(replay.body.data)).toMatchObject({ application_number: 'SYNTHETIC-APPLICATION', customer_number: 'SYNTHETIC-CUSTOMER' })
    expect(registeredRows()).toHaveLength(1)
    expect(io.rpcs.filter(call => call.name === 'canonical_onboard_customer_graph')).toHaveLength(1)
    expect(io.queries.filter(query => query.table === 'customer_addresses' && query.mode === 'insert')).toHaveLength(1)
  })

  it('the same key with a different registered address is an idempotency conflict, not a silent address change', async () => {
    const payload = await applicationPayload({ registered_address: HOME })
    expect((await submit(payload)).status).toBe(200)
    const changed = { ...payload, customer: { ...asRecord(payload.customer), registered_address: { ...HOME, street: 'Annan gata 1' } } }
    const conflict = await submit(changed)
    expect(conflict.status).toBe(409)
    expect(asRecord(conflict.body.error).code).toBe('idempotency_key_payload_mismatch')
    expect(registeredRows().map(row => row.street_1)).toEqual(['Hemvägen 4'])
  })

  it('never touches another tenant\'s or another customer\'s registered address', async () => {
    io.rows.customer_addresses = [
      { id: id(201), company_id: FOREIGN, customer_id: CUSTOMER, type: 'registered', street_1: 'Främmande 1', postal_code: '111 11', city: 'Stockholm', country: 'SE', is_active: true, moved_in_at: null, moved_out_at: null },
      { id: id(202), company_id: COMPANY, customer_id: id(203), type: 'registered', street_1: 'Granne 2', postal_code: '222 22', city: 'Lund', country: 'SE', is_active: true, moved_in_at: null, moved_out_at: null },
    ]
    const before = structuredClone(io.rows.customer_addresses)
    expect((await submit(await applicationPayload({ registered_address: HOME }))).status).toBe(200)
    expect(io.rows.customer_addresses.slice(0, 2)).toEqual(before)
    expect(io.rows.customer_addresses.slice(2)).toEqual([expect.objectContaining({ company_id: COMPANY, customer_id: CUSTOMER, street_1: 'Hemvägen 4' })])
  })

  it('a legacy committed application without the field still replays its original outcome (no new customer, no address)', async () => {
    const payload = await applicationPayload({})
    const normalized = ApplicationSchema.parse(normalizeRawApplication(payload))
    io.rows.website_customer_applications = [{ id: id(17), company_id: COMPANY, application_number: 'SYNTHETIC-APPLICATION', customer_number: 'SYNTHETIC-CUSTOMER', customer_id: CUSTOMER,
      customer_site_id: SITE, metering_point_id: id(15), contract_id: CONTRACT, status: 'ready_for_switch', idempotency_key: 'synthetic-legacy-key',
      payload_hash: applicationPayloadHash({ ...normalized, requested_start_mode: 'specific_date' }), payload: normalized,
      response_payload: { customer_id: CUSTOMER, customer_number: 'SYNTHETIC-CUSTOMER', application_number: 'SYNTHETIC-APPLICATION', customer_site_id: SITE, metering_point_id: id(15), contract_id: CONTRACT, status: 'ready_for_switch', next_step: 'automatic_processing' }, updated_at: NOW }]
    const replay = await submit(payload, 'synthetic-legacy-key')
    expect(replay.status, JSON.stringify(replay.body)).toBe(200)
    expect(asRecord(replay.body.data)).toMatchObject({ customer_number: 'SYNTHETIC-CUSTOMER' })
    expect(io.rpcs.some(call => call.name === 'canonical_onboard_customer_graph')).toBe(false)
    expect(io.rows.customer_addresses).toEqual([])
  })
})
