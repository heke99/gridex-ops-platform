// OPS-only synthetic transport probes: mounted handlers, validators, calculators and DTOs are real.
// These tests do not prove production PostgreSQL transactions, RLS, provider delivery or customer E2E.
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type Receipt = { table: string; mode: string; filters: Array<[string, string, unknown]>; row?: Row }
const io = vi.hoisted(() => ({ rows: {} as Record<string, Row[]>, queries: [] as Receipt[], rpcs: [] as Array<{ name: string; args: Row }>, scopes: [] as unknown[], serial: 500, client: {} as Row }))
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
        if (op === 'or') {
          // Actual alternatives used here are nullable global provider rows or tenant rows.
          return String(value).split(',').some(term => { const [field, comparison, ...raw] = term.split('.'); return comparison === 'is' ? row[field] == null : String(row[field]) === raw.join('.') })
        }
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
        // Finite transactional RPC receipt. This records the real command and
        // supplies resources for subsequent real rereads; PostgreSQL itself is
        // not executed or claimed by this transport fixture.
        const command = asRecord(args.p_command), customer = asRecord(command.customer), site = asRecord(command.site), contract = asRecord(command.contract)
        const { computeCustomerSiteAddressHash } = await import('@/lib/customer-sites/addressIntake')
        io.rows.customers = [{ ...customer, id: CUSTOMER, company_id: command.company_id, customer_number: 'SYNTHETIC-CUSTOMER' }]
        io.rows.customer_sites = [{ ...site, id: SITE, company_id: command.company_id, customer_id: CUSTOMER, address_hash: computeCustomerSiteAddressHash({ street: site.street, postalCode: site.postal_code, city: site.city, country: site.country }).hash }]
        io.rows.customer_contracts = [{ ...contract, id: CONTRACT, company_id: command.company_id, customer_id: CUSTOMER, contract_number: 'SYNTHETIC-CONTRACT', status: 'pending_signature', price_plan_id: PLAN, price_plan_version_id: PLAN_VERSION }]
        return { data: { ok: true, code: 'customer_onboarding_committed', operation_id: id(91), correlation_id: command.correlation_id, customer_id: CUSTOMER, customer_number: 'SYNTHETIC-CUSTOMER', created_new_customer: true, site_id: SITE, metering_point_id: null, contract_id: CONTRACT, price_snapshot_id: id(92), power_of_attorney_id: null }, error: null }
      }
      if (name === 'gridex_retry_website_contract_signature') return { data: null, error: null }
      if (name === 'gridex_finalize_website_contract_signature') {
        const versions = args.p_legal_versions as Row[]
        const acceptanceIds = Object.fromEntries(versions.map((version, index) => [String(version.id), id(120 + index)]))
        return { data: { signed_at: args.p_accepted_at, signature_snapshot_sha256: args.p_signature_snapshot_sha256, acceptance_ids: acceptanceIds }, error: null }
      }
      if (name === 'gridex_commit_customer_application_provisioning') return { data: { operation_id: args.p_operation_id, workflow_id: WORKFLOW, continuation_job_id: id(93), state: args.p_state }, error: null }
      if (name === 'gridex_transition_customer_application_workflow') return { data: { workflow_id: WORKFLOW, operation_id: id(91), state: args.p_to_state, workflow_version: 1 }, error: null }
      throw new Error(`Undeclared RPC transport: ${name}`)
    },
  } }
})
vi.mock('@/lib/integrations/apiAuth', async original => {
  const actual = await original<typeof import('@/lib/integrations/apiAuth')>()
  return { ...actual, logIntegrationApiRequest: vi.fn().mockResolvedValue(undefined), currentIntegrationApiResponseContext: () => null,
    requireIntegrationApiAccess: async (_request: NextRequest, required: unknown) => {
      io.scopes.push(required)
      const clientScopes = io.client.scopes as string[], requirement = asRecord(required)
      const allOf = Array.isArray(required) ? required as string[] : requirement.allOf as string[] ?? []
      const anyOf = requirement.anyOf as string[] ?? []
      if (actual.missingIntegrationApiScopes(clientScopes, allOf).length || (anyOf.length > 0 && anyOf.every(scope => !actual.expandIntegrationApiScopes(clientScopes).has(scope)))) {
        return { ok: false, status: 403, error: 'Synthetic credential lacks required scope', errorCode: 'api_scope_missing', client: null }
      }
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
import { assertPublicResponsePayload } from '@/lib/api/publicPayloadSafety'
import { GET as contextGET } from '@/app/api/v1/integration/context/route'
import { GET as publicContractsGET } from '@/app/api/v1/website/public-contracts/route'
import { GET as diagnosticsGET } from '@/app/api/v1/website/public-contracts/diagnostics/route'
import { GET as apiDiagnosticsGET } from '@/app/api/v1/public-contracts/diagnostics/route'
import { POST as quotePOST } from '@/app/api/v1/website/quote/route'
import { POST as validatePOST } from '@/app/api/v1/website/quote/validate/route'
import { POST as marketPOST } from '@/app/api/v1/website/market-price/current/route'
import { GET as portfolioGET } from '@/app/api/v1/website/portfolio-prices/route'
import { GET as legalGET } from '@/app/api/v1/website/legal-bundle/route'
import { GET as switchGET } from '@/app/api/v1/website/switch-status/route'
import { GET as applicationStatusGET } from '@/app/api/v1/website/customer-applications/[applicationId]/route'
import { POST as applicationPOST } from '@/app/api/v1/website/customer-applications/route'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const COMPANY = id(1), FOREIGN = id(2), CLIENT = id(3), OFFER = id(4), PUBLICATION = id(5), PRODUCT = id(6), PRODUCT_VERSION = id(7), PLAN = id(8), PLAN_VERSION = id(9), BUNDLE = id(10), RESOLUTION = id(11), OPTION = id(12), CUSTOMER = id(13), SITE = id(14), METER = id(15), CONTRACT = id(16), APPLICATION = id(17), WORKFLOW = id(18), SWITCH = id(19)
const NOW = '2026-10-12T12:00:00.000Z', START = '2026-11-01', OFFER_REFERENCE = 'offer_synthetic_fixed'
const document: Row = JSON.parse(readFileSync('docs/openapi/website-integration-v1.json', 'utf8'))
function asRecord(value: unknown): Row { return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {} }
function resolve(raw: unknown): Row {
  let schema = asRecord(raw)
  for (let depth = 0; typeof schema.$ref === 'string'; depth++) {
    if (depth > 32) throw Error('Reference recursion')
    const target = schema.$ref.slice(2).split('/').reduce<unknown>((item, key) => asRecord(item)[key], document)
    if (!target || typeof target !== 'object') throw Error('Missing published schema reference')
    schema = asRecord(target)
  }
  return schema
}
function validate(value: unknown, raw: unknown, path = '$'): string[] {
  const s = resolve(raw); const errors: string[] = []
  for (const branch of (s.allOf as unknown[] ?? [])) errors.push(...validate(value, branch, path))
  if (Array.isArray(s.anyOf) && !s.anyOf.some(branch => validate(value, branch, path).length === 0)) errors.push(`${path}: anyOf mismatch`)
  if (Array.isArray(s.oneOf) && s.oneOf.filter(branch => validate(value, branch, path).length === 0).length !== 1) errors.push(`${path}: oneOf mismatch`)
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  const types = Array.isArray(s.type) ? s.type : typeof s.type === 'string' ? [s.type] : []
  if (types.length && !types.includes(type) && !(types.includes('integer') && typeof value === 'number' && Number.isInteger(value))) return [`${path}: expected ${types.join('|')}, got ${type}`]
  if (s.const !== undefined && value !== s.const) errors.push(`${path}: expected const ${s.const}, got ${value}`)
  if (Array.isArray(s.enum) && !s.enum.includes(value)) errors.push(`${path}: enum mismatch`)
  if (typeof value === 'string') {
    if (typeof s.minLength === 'number' && value.length < s.minLength) errors.push(`${path}: too short`)
    if (typeof s.maxLength === 'number' && value.length > s.maxLength) errors.push(`${path}: too long`)
    if (typeof s.pattern === 'string' && !new RegExp(s.pattern).test(value)) errors.push(`${path}: pattern mismatch`)
    if (s.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) errors.push(`${path}: UUID format mismatch`)
    if (s.format === 'date-time' && (!Number.isFinite(Date.parse(value)) || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value))) errors.push(`${path}: date-time format mismatch`)
    if (s.format === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)))) errors.push(`${path}: date format mismatch`)
    if (s.format === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errors.push(`${path}: email format mismatch`)
    if (s.format === 'uri') { try { new URL(value) } catch { errors.push(`${path}: URI format mismatch`) } }
  }
  if (typeof value === 'number') {
    if (typeof s.minimum === 'number' && value < s.minimum) errors.push(`${path}: below minimum`)
    if (typeof s.maximum === 'number' && value > s.maximum) errors.push(`${path}: above maximum`)
    if (typeof s.exclusiveMinimum === 'number' && value <= s.exclusiveMinimum) errors.push(`${path}: below exclusive minimum`)
  }
  if (Array.isArray(value)) {
    if (typeof s.minItems === 'number' && value.length < s.minItems) errors.push(`${path}: too few items`)
    if (typeof s.maxItems === 'number' && value.length > s.maxItems) errors.push(`${path}: too many items`)
    if (s.uniqueItems === true && new Set(value.map(item => JSON.stringify(item))).size !== value.length) errors.push(`${path}: duplicate items`)
    value.forEach((item, index) => errors.push(...validate(item, s.items, `${path}[${index}]`)))
  }
  else if (value && typeof value === 'object') {
    const row = asRecord(value), properties = asRecord(s.properties)
    for (const key of s.required as string[] ?? []) if (!(key in row)) errors.push(`${path}: missing ${key}`)
    for (const [key, dependencies] of Object.entries(asRecord(s.dependentRequired))) {
      if (key in row) for (const dependency of dependencies as string[]) if (!(dependency in row)) errors.push(`${path}: missing dependent ${dependency}`)
    }
    for (const [key, child] of Object.entries(row)) {
      if (s.additionalProperties === false && !(key in properties)) errors.push(`${path}: unknown ${key}`)
      if (key in properties) errors.push(...validate(child, properties[key], `${path}.${key}`))
      else if (s.additionalProperties && typeof s.additionalProperties === 'object') errors.push(...validate(child, s.additionalProperties, `${path}.${key}`))
    }
  }
  return errors
}
function operation(path: string, method: string): Row { return asRecord(asRecord(asRecord(document.paths)[path])[method.toLowerCase()]) }
function request(path: string, method = 'GET', body?: Row, key?: string) {
  return new NextRequest(`https://app.gridex.se${path}`, { method, headers: { Authorization: 'Bearer synthetic-transport-key', ...(body ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined })
}
async function bodyContract(response: Response, path: string, method = 'GET', status = 200) {
  const body: Row = await response.json()
  expect(response.status, JSON.stringify(body)).toBe(status)
  const responseSchema = resolve(asRecord(operation(path, method).responses)[String(status)])
  const raw = asRecord(asRecord(responseSchema.content)['application/json']).schema
  expect(raw, `Published response schema ${method} ${path} ${status}`).toBeDefined()
  expect(validate(body, raw)).toEqual([])
  expect(response.headers.get('x-request-id')).toBe(body.request_id)
  return body
}
function requestContract(path: string, body: Row) {
  const raw = asRecord(asRecord(asRecord(operation(path, 'POST').requestBody).content)['application/json']).schema
  expect(raw, `Published request schema POST ${path}`).toBeDefined()
  expect(validate(body, raw)).toEqual([])
}
function assertScope(value: unknown) { expect(io.scopes.at(-1)).toEqual(value) }
function assertCompanyQuery(table: string) { expect(io.queries.some(q => q.table === table && q.filters.some(([op, key, value]) => op === 'eq' && (key === 'company_id' || key === 'id') && value === COMPANY))).toBe(true) }
function commercialSnapshot() {
  const model = commercialModelSchema.parse({ schema_version: 'gridex_contract_pricing_v6_selection', price_options: [{ price_option_reference: 'fixed_standard', option_code: 'fixed_standard', customer_name: 'Synthetic fixed', customer_type: 'private', default: true, selection_required: false, internal_description: null, contract_type: 'fixed', binding_months: 12, notice_months: 1, auto_renew_enabled: false, renewal_term_months: null, valid_from: null, valid_to: null, earliest_start_date: null, latest_start_date: null, status: 'active', sort_order: 1, version_number: 1, area_prices: [{ price_row_reference: 'fixed_standard_se3', price_area: 'SE3', amount: 125, unit: 'ore_per_kwh', vat_treatment: 'standard', valid_from: null, valid_to: null, metadata: {} }], metadata: {} }], components: [], invoice_delivery_methods: ['email', 'paper'] })
  return { schema_version: model.schema_version, snapshot_schema: model.schema_version, energy_direction: 'consumption', vat_rate: .25, commercial_components: model.components, price_options: model.price_options, invoice_delivery_methods: model.invoice_delivery_methods, base_components: [{ source_type: 'fixed', weight_percent: 100, fixed_price_sek_per_kwh: 1.25, price_area: 'SE3', label: 'Synthetic fixed' }], price_components: [{ component_code: 'invoice_fee', component_type: 'invoice_fee', name: 'Invoice fee', amount: 0, calculation_type: 'per_invoice', unit: 'sek_invoice', status: 'active', website_card_visible: false }] }
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW)); vi.stubEnv('GRIDEX_AUTOMATION_USER_ID', id(99)); vi.stubEnv('CUSTOMER_OPERATION_CRON_SECRET', 'synthetic-test-only');
  io.serial = 500; io.queries = []; io.rpcs = []; io.scopes = []
  io.client = { id: CLIENT, company_id: COMPANY, name: 'Synthetic Website', status: 'active', key_prefix: 'unit', secret_hash: 'synthetic-unit', scopes: [...TENANT_WEBSITE_RECOMMENDED_SCOPES, 'website_contracts.diagnostics', 'api_contracts.diagnostics'], allowed_ips: [], allowed_origins: ['https://synthetic.example.invalid'], rate_limit_per_minute: 100, expires_at: null, metadata: { api_contract_profiles: { website: '2026-10-09.1' } } }
  const empty = ['company_capabilities','webhook_subscriptions','customer_portal_identities','customer_portal_accounts','customers','customer_sites','metering_points','website_contract_quotes','integration_api_write_idempotency','canonical_energy_flow_events','canonical_energy_remediation_queue','website_customer_applications','customer_application_workflows','customer_operation_jobs','customer_supply_periods','supplier_switch_events','communication_logs','tenant_email_outbox','domain_events','webhook_deliveries','event_outbox','external_contract_intakes','audit_logs','portfolio_monthly_settlements','contract_charge_ledger','price_components','pricing_component_rules','price_plan_versions','portfolio_price_estimates','spot_price_monthly_summaries','market_price_previews','customer_legal_acceptances']
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
  io.rows.customer_contracts = [{ id: CONTRACT, company_id: COMPANY, customer_id: CUSTOMER, status: 'signed', contract_number: 'SYNTHETIC-CONTRACT', signed_at: NOW, signature_snapshot_sha256: 'a'.repeat(64), updated_at: NOW }]
  io.rows.supplier_switch_requests = [{ id: SWITCH, company_id: COMPANY, customer_id: CUSTOMER, site_id: SITE, customer_site_id: SITE, metering_point_id: METER, contract_id: CONTRACT, status: 'requested', requested_start_date: START, created_at: NOW, updated_at: NOW }]
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
const quoteRequest = () => ({ offer_reference: OFFER_REFERENCE, resolution_id: RESOLUTION, customer_type: 'private', annual_consumption_kwh: 12000, start_date: START, price_option_reference: 'fixed_standard', invoice_delivery_method: 'email', selected_component_references: [], site_count: 1 })
function addApplication() {
  io.rows.website_customer_applications = [{ id: APPLICATION, company_id: COMPANY, application_number: 'SYNTHETIC-APPLICATION', customer_number: 'SYNTHETIC-CUSTOMER', customer_id: CUSTOMER, customer_site_id: SITE, metering_point_id: METER, contract_id: CONTRACT, status: 'accepted', response_payload: { supplier_switch_request_id: SWITCH, next_step: 'automatic_processing', requested_start_date: START }, updated_at: NOW }]
}

describe('Website operations: mounted routes against published contracts', () => {
  it('integration context projects credential organization, ready checkout and polling without tenant input', async () => {
    const path = '/api/v1/integration/context'
    const body = await bodyContract(await contextGET(request(path)), path)
    assertScope(['integration_context.read']); assertCompanyQuery('companies'); assertCompanyQuery('tenant_website_readiness_v')
    expect(asRecord(body.data)).toMatchObject({ api_version: 'v1', authoritative_identity: 'api_key', capabilities: { website_checkout_ready: true, complete_integration_ready: true } })
    expect(JSON.stringify(body)).not.toContain(COMPANY)
  })
  it.each([[], [{ id: id(99), user_status: 'disabled' }]])('integration context blocks checkout for an unqualified automation profile', async profiles => {
    io.rows.user_profiles = profiles
    const path = '/api/v1/integration/context'
    const body = await bodyContract(await contextGET(request(path)), path)
    expect(asRecord(asRecord(body.data).capabilities).website_checkout_ready).toBe(false)
    expect(io.queries.every(query => query.mode === 'select')).toBe(true)
  })
  it('Website diagnostics executes canonical graph and pricing checks within the credential company', async () => {
    const path = '/api/v1/website/public-contracts/diagnostics'
    const body = await bodyContract(await diagnosticsGET(request(path + '?customer_type=private')), path)
    assertScope(['website_contracts.diagnostics']); assertCompanyQuery('canonical_public_contract_delivery_readiness_v')
    expect(asRecord(asRecord(body.diagnostics).publication)).toMatchObject({ total: 1, visible: 1, hidden: 0 })
    expect(asRecord(asRecord(body.diagnostics).graph).canonical_graph_consistent).toBe(true)
    expect((asRecord(asRecord(body.diagnostics).publication).offers as Row[])[0].offer_reference).toBe(OFFER_REFERENCE)
    expect((asRecord(asRecord(body.diagnostics).publication).offers as Row[])[0]).not.toHaveProperty('id')
  })

  it('the supported legacy diagnostics query returns the public diagnostic fields', async () => {
    const response = await publicContractsGET(request('/api/v1/website/public-contracts?diagnostics=1&customer_type=private'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Deprecation')).toBe('true')
    const body = await response.json()
    const offer = body.diagnostics.publication.offers[0]
    expect(offer.offer_reference).toBe(OFFER_REFERENCE)
    expect(offer).not.toHaveProperty('id')
  })
  it('API diagnostics isolates the API publication channel', async () => {
    const path = '/api/v1/public-contracts/diagnostics'
    const body = await bodyContract(await apiDiagnosticsGET(request(path)), path)
    assertScope(['api_contracts.diagnostics']); assertCompanyQuery('canonical_public_contract_delivery_readiness_v')
    expect(asRecord(body.meta).channel).toBe('api')
    expect(io.queries.find(q => q.table === 'canonical_public_contract_delivery_readiness_v')?.filters).toContainEqual(['eq','channel','api'])
    expect(asRecord(asRecord(body.diagnostics).publication).total).toBe(1)
    expect((body.data as Row[])[0]).not.toHaveProperty('id')
  })
  it('quote computes and persists the exact selected SE3 fixed price and legal/publication identity', async () => {
    const path = '/api/v1/website/quote', payload = quoteRequest(); requestContract(path, payload)
    const body = await bodyContract(await quotePOST(request(path, 'POST', payload, 'synthetic-quote-key')), path, 'POST', 201)
    assertScope(['website_quotes.write']); assertCompanyQuery('canonical_visible_public_contracts_v')
    expect(io.rows.website_contract_quotes).toHaveLength(1)
    expect(io.rows.website_contract_quotes[0]).toMatchObject({ company_id: COMPANY, legal_bundle_version_id: BUNDLE, contract_publication_version_id: PUBLICATION, price_area: 'SE3', energy_resolution_id: RESOLUTION, price_option_reference: 'fixed_standard', site_count: 1, status: 'active' })
    expect(asRecord(body.data)).toMatchObject({ selected_area_price: { energy_price_ore_per_kwh: 125 }, settlement: { model: 'fixed_price', energy_price_locked_at_signup: true } })
    expect(asRecord(asRecord(body.data).estimate)).toMatchObject({ monthly_ex_vat: 1250, annual_ex_vat: 15000 })
  })
  it('quote validation executes the persisted hash and exact commercial selection guards', async () => {
    const created = await quotePOST(request('/api/v1/website/quote', 'POST', quoteRequest(), 'synthetic-quote-key'))
    expect(created.status).toBe(201)
    const data = asRecord((await created.json()).data), path = '/api/v1/website/quote/validate'
    const payload = { ...quoteRequest(), quote_reference: data.quote_reference }
    requestContract(path, payload)
    const body = await bodyContract(await validatePOST(request(path, 'POST', payload)), path, 'POST')
    assertScope(['website_quotes.validate']); assertCompanyQuery('website_contract_quotes')
    expect(asRecord(body.data)).toMatchObject({ valid: true, quote_reference: data.quote_reference, price_option_reference: 'fixed_standard', site_count: 1 })
    expect(io.rows.canonical_energy_flow_events.some(row => row.event_type === 'quote.validated' && row.company_id === COMPANY)).toBe(true)
  })
  it('current market price selects verified quarter-hour provider evidence and converts SEK to ore', async () => {
    const path = '/api/v1/website/market-price/current', payload = { resolution_id: RESOLUTION }; requestContract(path, payload)
    const body = await bodyContract(await marketPOST(request(path, 'POST', payload)), path, 'POST')
    assertScope(['website_market_prices.read']); assertCompanyQuery('company_market_price_sources')
    expect(asRecord(body.data)).toMatchObject({ resolution_id: RESOLUTION, provider: 'synthetic-provider', price_area: 'SE3', price_sek_per_kwh: .5, price_ore_per_kwh: 50, selected_resolution: 'quarterly', is_stale: false })
  })
  it('legal bundle materializes the same locked offer bundle and required hashed customer document', async () => {
    const path = '/api/v1/website/legal-bundle'
    const body = await bodyContract(await legalGET(request(path + '?offer_reference=' + OFFER_REFERENCE)), path)
    assertScope({ anyOf: ['website_legal.read','website_contracts.read'] }); assertCompanyQuery('legal_bundle_versions')
    expect(asRecord(body.data)).toMatchObject({ offer_reference: OFFER_REFERENCE, complete: true, missing_types: [] })
    const requirements = asRecord(body.data).requirements as Row[]
    expect(requirements).toHaveLength(1)
    expect(requirements[0]).toMatchObject({ requirement_code: 'agreement', legal_bundle_version_id: BUNDLE, source_document_ids: [id(30),id(31)], required: true })
    expect(requirements[0].document_hash).toMatch(/^[a-f0-9]{64}$/)
  })
  it.each([
    { data: { id: BUNDLE } },
    { data: { company_id: COMPANY } },
    { data: { requirements: [{ id: BUNDLE }] } },
    { data: { requirements: [{ company_id: COMPANY }] } },
    { data: { requirements: [{ nested: { legal_bundle_version_id: BUNDLE } }] } },
    { data: { legal: { module_versions: [{ customer_id: CUSTOMER }] } } },
  ])('keeps unrelated internal identifiers forbidden outside exact documented legal evidence paths', body => {
    expect(() => assertPublicResponsePayload(body)).toThrow('Public response contains a forbidden internal field')
  })
  it('portfolio prices shows only locked/final prices for the requested area', async () => {
    const offer = io.rows.canonical_visible_public_contracts_v[0], option = io.rows.contract_price_options[0]
    offer.contract_type = 'portfolio'; option.contract_type = 'portfolio'
    asRecord(offer.canonical_pricing_snapshot).portfolio_method = { portfolio_id: id(70), pricing_model: 'portfolio_monthly_settlement', display_rules: { show_historical_final: true } }
    io.rows.portfolio_monthly_settlements = [
      { company_id: COMPANY, portfolio_id: id(70), price_plan_version_id: PLAN_VERSION, delivery_month: '2026-09-01', price_area_code: 'SE3', portfolio_price_ore_per_kwh: 82, status: 'locked', is_current: true },
      { company_id: COMPANY, portfolio_id: id(70), price_plan_version_id: PLAN_VERSION, delivery_month: '2026-09-01', price_area_code: 'SE4', portfolio_price_ore_per_kwh: 99, status: 'final', is_current: true },
      { company_id: COMPANY, portfolio_id: id(70), price_plan_version_id: PLAN_VERSION, delivery_month: '2026-10-01', price_area_code: 'SE3', portfolio_price_ore_per_kwh: 1, status: 'estimated', is_current: true },
    ]
    const path = '/api/v1/website/portfolio-prices'
    const body = await bodyContract(await portfolioGET(request(path + '?offer_reference=' + OFFER_REFERENCE + '&price_area=SE3')), path)
    assertScope(['website_contracts.read']); assertCompanyQuery('portfolio_monthly_settlements')
    expect(asRecord(body.data).method).toBe('portfolio_monthly_settlement')
    expect(asRecord(body.data).historical_final_prices).toEqual([expect.objectContaining({ period_month: '2026-09-01', price_area_code: 'SE3', amount: 82, status: 'locked' })])
  })
  it('switch status selects its own application switch and emits an opaque reference and ordered events', async () => {
    addApplication(); io.rows.supplier_switch_events = [
      { company_id: COMPANY, switch_request_id: SWITCH, event_type: 'requested', event_status: 'accepted', message: 'Synthetic request accepted', created_at: NOW },
      { company_id: FOREIGN, switch_request_id: SWITCH, event_type: 'foreign', created_at: NOW },
    ]
    const path = '/api/v1/website/switch-status'
    const body = await bodyContract(await switchGET(request(path + '?application_number=SYNTHETIC-APPLICATION')), path)
    assertScope(['website_switch_status.read']); assertCompanyQuery('website_customer_applications'); assertCompanyQuery('supplier_switch_events')
    expect(asRecord(asRecord(body.data).switch)).toMatchObject({ status: 'requested', switch_reference: expect.stringMatching(/^switch_/), events: [expect.objectContaining({ event_type: 'requested' })] })
  })
  it('application status preserves a signed agreement while queued confirmation and automation remain pending', async () => {
    addApplication(); io.rows.customer_application_workflows = [{ id: WORKFLOW, company_id: COMPANY, customer_application_id: APPLICATION, state: 'canonical_data_committed', next_action: 'automatic_processing', updated_at: NOW }]
    io.rows.customer_operation_jobs = [{ company_id: COMPANY, workflow_id: WORKFLOW, job_type: 'customer_application_continuation', status: 'queued', attempts: 0, max_attempts: 5, run_after: NOW, created_at: NOW }]
    io.rows.communication_logs = [{ id: id(90), company_id: COMPANY, event_key: 'contract.confirmation_sent', status: 'queued', metadata: { application_id: APPLICATION }, created_at: NOW }]
    io.rows.tenant_email_outbox = [{ company_id: COMPANY, communication_log_id: id(90), status: 'queued', attempts: 0, updated_at: NOW }]
    const path = '/api/v1/website/customer-applications/{application_number}'
    const body = await bodyContract(await applicationStatusGET(request('/api/v1/website/customer-applications/SYNTHETIC-APPLICATION'), { params: Promise.resolve({ applicationId: 'SYNTHETIC-APPLICATION' }) }), path)
    assertScope(['website_switch_status.read']); assertCompanyQuery('customer_contracts'); assertCompanyQuery('tenant_email_outbox')
    expect(asRecord(body.data)).toMatchObject({ contract_status: 'signed', contract_number: 'SYNTHETIC-CONTRACT', automation: { status: 'queued' }, communication: { pending: true, queued: [expect.objectContaining({ status: 'queued' })] } })
  })
  it('application submission validates canonical input before replaying a committed own-company result without creating another customer', async () => {
    const legal = asRecord((await (await legalGET(request('/api/v1/website/legal-bundle?offer_reference=' + OFFER_REFERENCE))).json()).data)
    const quote = asRecord((await (await quotePOST(request('/api/v1/website/quote', 'POST', quoteRequest(), 'synthetic-replay-preparation'))).json()).data)
    const payload = { external_customer_id: 'synthetic-customer', ...quoteRequest(), customer: { customer_type: 'private', first_name: 'Synthetic', last_name: 'Applicant', personal_number: '198112189876', email: 'synthetic@example.invalid' }, site: { street: 'Synthetic street 1', postal_code: '58220', city: 'Linkoping', country: 'SE', annual_consumption_kwh: 12000 }, contract: { requested_start_date: START, requested_start_mode: 'specific_date' }, quote_reference: quote.quote_reference, legal_bundle_version: legal.bundle_version, legal_acceptances: (legal.requirements as Row[]).map(row => ({ requirement_code: row.requirement_code, document_reference: row.document_reference, document_version: row.document_version, document_hash: row.document_hash, accepted: true, accepted_at: NOW })), settlement: { model: 'fixed_price', customer_accepts: 'fixed_energy_price', energy_price_locked_at_signup: true, uses_actual_metered_consumption: true, market_data_role: 'not_applicable', settlement_resolution: 'fixed' } }
    delete (payload as Row).customer_type; delete (payload as Row).start_date
    const normalized = ApplicationSchema.parse(normalizeRawApplication(payload))
    addApplication(); const existing = io.rows.website_customer_applications[0]
    Object.assign(existing, { status: 'ready_for_switch', idempotency_key: 'synthetic-application-key', payload_hash: applicationPayloadHash({ ...normalized, requested_start_mode: 'specific_date' }), payload: normalized, response_payload: { ...existing.response_payload as Row, customer_id: CUSTOMER, customer_number: 'SYNTHETIC-CUSTOMER', application_number: 'SYNTHETIC-APPLICATION', customer_site_id: SITE, metering_point_id: METER, contract_id: CONTRACT, contract_number: 'SYNTHETIC-CONTRACT', offer_reference: OFFER_REFERENCE, quote_reference: quote.quote_reference, price_option_reference: 'fixed_standard', invoice_delivery_method: 'email', selected_component_references: [], mandatory_component_references: [], conditional_component_references: [], site_count: 1, energy_direction: 'consumption', status: 'ready_for_switch', quote_bound: true, quote_valid_until: '9999-12-31T23:59:59.999Z', can_send_agreement_confirmation: true, next_step: 'automatic_processing' } })
    const path = '/api/v1/website/customer-applications'; requestContract(path, payload)
    const body = await bodyContract(await applicationPOST(request(path, 'POST', payload, 'synthetic-application-key')), path, 'POST')
    assertScope(['website_applications.write']); assertCompanyQuery('website_customer_applications')
    expect(asRecord(body.data)).toMatchObject({ application_number: 'SYNTHETIC-APPLICATION', customer_number: 'SYNTHETIC-CUSTOMER' })
    expect(io.queries.filter(query => query.table === 'website_customer_applications').every(query => query.mode === 'select')).toBe(true)
    expect(io.rpcs.some(call => call.name === 'canonical_onboard_customer_graph')).toBe(false)
    expect(io.queries.some(query => query.table === 'customers' && query.mode !== 'select')).toBe(false)
  })
  it('fresh application runs exact offer/quote/legal validation and attributes canonical intake and queued continuation to the credential company', async () => {
    const legalResponse = await legalGET(request('/api/v1/website/legal-bundle?offer_reference=' + OFFER_REFERENCE))
    expect(legalResponse.status).toBe(200)
    const legal = asRecord((await legalResponse.json()).data)
    const quoteResponse = await quotePOST(request('/api/v1/website/quote', 'POST', quoteRequest(), 'synthetic-fresh-quote-key'))
    expect(quoteResponse.status).toBe(201)
    const quote = asRecord((await quoteResponse.json()).data)
    const payload = {
      external_customer_id: 'synthetic-customer', offer_reference: OFFER_REFERENCE, quote_reference: quote.quote_reference, resolution_id: RESOLUTION,
      annual_consumption_kwh: 12000, price_option_reference: 'fixed_standard', invoice_delivery_method: 'email', selected_component_references: [], site_count: 1,
      customer: { customer_type: 'private', first_name: 'Synthetic', last_name: 'Applicant', personal_number: '198112189876', email: 'synthetic@example.invalid' },
      site: { street: 'Synthetic street 1', postal_code: '58220', city: 'Linkoping', country: 'SE' },
      contract: { requested_start_date: START, requested_start_mode: 'specific_date' },
      legal_bundle_version: legal.bundle_version, legal_acceptances: (legal.requirements as Row[]).map(row => ({ requirement_code: row.requirement_code, document_reference: row.document_reference, document_version: row.document_version, document_hash: row.document_hash, accepted: true, accepted_at: NOW })), settlement: quote.settlement,
    }
    const path = '/api/v1/website/customer-applications'; requestContract(path, payload)
    const body = await bodyContract(await applicationPOST(request(path, 'POST', payload, 'synthetic-fresh-application-key')), path, 'POST')
    assertScope(['website_applications.write'])
    const command = asRecord(io.rpcs.find(call => call.name === 'canonical_onboard_customer_graph')?.args.p_command)
    expect(command).toMatchObject({ company_id: COMPANY, channel: 'website', quote: { quote_reference: quote.quote_reference }, customer: { personal_number: '198112189876' } })
    expect(asRecord(command.customer)).toMatchObject({ external_customer_id: 'synthetic-customer', metadata: { source: 'website_customer_applications', api_client_id: CLIENT, application_id: io.rows.website_customer_applications[0].id } })
    expect(asRecord(command.contract)).toMatchObject({ offer_reference: OFFER_REFERENCE, public_contract_offer_id: OFFER, price_option_reference: 'fixed_standard', area_price_reference: 'fixed_standard_se3', legal_bundle_version_id: BUNDLE })
    expect(asRecord(body.data)).toMatchObject({ application_number: 'SYNTHETIC-APPLICATION', customer_number: 'SYNTHETIC-CUSTOMER', status: 'accepted', next_step: 'automatic_processing', quote_bound: true })
    expect(io.rows.external_contract_intakes).toHaveLength(1)
    expect(io.rows.external_contract_intakes[0]).toMatchObject({ company_id: COMPANY, source_channel: 'external_website_api', created_customer_id: CUSTOMER, created_site_id: SITE, created_contract_id: CONTRACT, payload: { external_customer_id: 'synthetic-customer' } })
    expect(io.rpcs.find(call => call.name === 'gridex_commit_customer_application_provisioning')?.args).toMatchObject({ p_company_id: COMPANY, p_customer_id: CUSTOMER, p_contract_id: CONTRACT })
  })
  it('quote idempotency replays the accepted commercial selection and rejects a different count without another quote', async () => {
    const path = '/api/v1/website/quote', payload = quoteRequest(), key = 'synthetic-idempotency-quote'
    const first = await bodyContract(await quotePOST(request(path, 'POST', payload, key)), path, 'POST', 201)
    const replayResponse = await quotePOST(request(path, 'POST', payload, key))
    const replay = await bodyContract(replayResponse, path, 'POST', 201)
    expect(replayResponse.headers.get('idempotency-replayed')).toBe('true')
    expect(asRecord(replay.data).quote_reference).toBe(asRecord(first.data).quote_reference)
    expect(io.rows.website_contract_quotes).toHaveLength(1)
    const conflict = await bodyContract(await quotePOST(request(path, 'POST', { ...payload, site_count: 2 }, key)), path, 'POST', 409)
    expect(asRecord(conflict.error).code).toBe('idempotency_conflict')
    expect(io.rows.website_contract_quotes).toHaveLength(1)
  })
  it.each([
    ['tampered immutable snapshot', 'quote_reference_mismatch'],
    ['revoked quote', 'quote_revoked'],
    ['consumed by another application', 'quote_consumed'],
  ])('quote validation rejects %s using the real persisted guards', async (scenario, code) => {
    const created = await quotePOST(request('/api/v1/website/quote', 'POST', quoteRequest(), 'synthetic-validation-guard'))
    expect(created.status).toBe(201)
    const data = asRecord((await created.json()).data), stored = io.rows.website_contract_quotes[0]
    if (scenario.startsWith('tampered')) asRecord(stored.quote_snapshot).estimate = { monthly_ex_vat: 1 }
    else if (scenario.startsWith('revoked')) stored.status = 'revoked'
    else { stored.status = 'consumed'; stored.consumed_application_id = id(999) }
    const path = '/api/v1/website/quote/validate'
    const response = await bodyContract(await validatePOST(request(path, 'POST', { ...quoteRequest(), quote_reference: data.quote_reference })), path, 'POST', 409)
    expect(asRecord(response.error).code).toBe(code)
    expect(io.rows.canonical_energy_flow_events.filter(row => row.event_type === 'quote.validated')).toEqual([])
  })
  it('validation reactivates a legacy expired quote and accepts elapsed resolution freshness for the issued immutable quote', async () => {
    const created = await quotePOST(request('/api/v1/website/quote', 'POST', quoteRequest(), 'synthetic-expired-quote'))
    expect(created.status).toBe(201)
    const data = asRecord((await created.json()).data)
    io.rows.website_contract_quotes[0].status = 'expired'
    vi.setSystemTime(new Date('2027-01-01T12:00:00.000Z'))
    const path = '/api/v1/website/quote/validate'
    const response = await bodyContract(await validatePOST(request(path, 'POST', { ...quoteRequest(), quote_reference: data.quote_reference })), path, 'POST')
    expect(asRecord(response.data)).toMatchObject({ valid: true, status: 'active', quote_reference: data.quote_reference })
    expect(io.rows.website_contract_quotes[0].status).toBe('active')
    expect(io.queries.filter(query => query.table === 'website_contract_quotes' && query.mode === 'update')).toHaveLength(1)
  })
  it('current-market resolution from another company returns404 without revealing its price or using price sources', async () => {
    io.rows.customer_site_resolution[0].company_id = FOREIGN
    const path = '/api/v1/website/market-price/current'
    const response = await bodyContract(await marketPOST(request(path, 'POST', { resolution_id: RESOLUTION })), path, 'POST', 404)
    expect(asRecord(response.error).code).toBe('resolution_not_found')
    expect(io.queries.some(query => query.table === 'company_market_price_sources')).toBe(false)
  })
  it('application status returns404 for an application owned by another company', async () => {
    addApplication(); io.rows.website_customer_applications[0].company_id = FOREIGN
    const path = '/api/v1/website/customer-applications/{application_number}'
    const response = await bodyContract(await applicationStatusGET(request('/api/v1/website/customer-applications/SYNTHETIC-APPLICATION'), { params: Promise.resolve({ applicationId: 'SYNTHETIC-APPLICATION' }) }), path, 'GET', 404)
    expect(asRecord(response.error).code).toBe('application_not_found')
    expect(io.queries.some(query => query.table === 'customer_contracts')).toBe(false)
  })
})
