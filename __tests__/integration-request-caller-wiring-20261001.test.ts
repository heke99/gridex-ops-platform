import { randomUUID } from 'node:crypto'
import { inspect } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { WEBSITE_CHECKOUT_REQUIRED_SCOPES, CUSTOMER_PORTAL_REQUIRED_SCOPES, TENANT_WEBSITE_RECOMMENDED_SCOPES,
  WEBSITE_INTEGRATION_CONTRACT_VERSION, WEBSITE_TENANT_REQUIRED_ENVIRONMENT_VARIABLES, WEBSITE_INTEGRATION_BASE_URL,
  WEBSITE_INTEGRATION_OPENAPI_URL, CUSTOMER_PORTAL_OPENAPI_URL, WEBSITE_APPLICATION_REFERENCE_LOCATION } from '@/lib/integrations/websiteIntegrationContract'

type Row = Record<string, unknown>
const f = vi.hoisted(() => ({
  allowed: true, hasToken: true, context: vi.fn(), diagnose: vi.fn(), list: vi.fn(),
  quote: vi.fn(), validate: vi.fn(), offer: vi.fn(), process: vi.fn(), automation: vi.fn(), operation: vi.fn(),
  rpc: vi.fn(), tables: {} as Record<string, Row[]>, telemetry: [] as Row[], queries: [] as string[],
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: f.rpc,
  from(table: string) {
    f.queries.push(table)
    const predicates: Array<(row: Row) => boolean> = []
    let inserted: Row | null = null, updated: Row | null = null, single = false, head = false
    const q = {
      select: (_fields?: string, options?: { head?: boolean }) => { head = options?.head === true; return q },
      eq: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return q },
      order: () => q, limit: () => q,
      maybeSingle: () => { single = true; return q }, single: () => { single = true; return q },
      insert: (row: Row) => { inserted = { id: randomUUID(), ...structuredClone(row) }; return q },
      update: (row: Row) => { updated = structuredClone(row); return q },
      then: (resolve: (value: unknown) => unknown) => {
        const all = f.tables[table] ?? []
        if (inserted) {
          if (!['integration_api_requests', 'integration_api_write_idempotency'].includes(table)) throw new Error('unexpected_correlation_write')
          all.push(inserted); f.tables[table] = all
          if (table === 'integration_api_requests') f.telemetry.push(inserted)
        }
        const rows = inserted ? [inserted] : all.filter(row => predicates.every(p => p(row)))
        if (updated) rows.forEach(row => Object.assign(row, updated))
        return Promise.resolve({ data: head ? null : structuredClone(single ? rows[0] ?? null : rows), count: rows.length, error: null }).then(resolve)
      },
    }
    return q
  },
} }))
vi.mock('@/lib/integrations/tenantContext', async original => ({ ...await original<typeof import('@/lib/integrations/tenantContext')>(), loadExternalTenantContext: f.context }))
vi.mock('@/lib/website/publicContracts', async original => ({ ...await original<typeof import('@/lib/website/publicContracts')>(), diagnosePublicContractOffers: f.diagnose, listPublicContractOffers: f.list, resolvePublicContractOffer: f.offer }))
vi.mock('@/lib/pricing/offerQuote', async original => ({ ...await original<typeof import('@/lib/pricing/offerQuote')>(), calculateOfferQuote: f.quote }))
vi.mock('@/lib/pricing/websiteQuotes', async original => ({ ...await original<typeof import('@/lib/pricing/websiteQuotes')>(), validateWebsiteQuote: f.validate }))
vi.mock('@/lib/website/customerApplications', async original => ({ ...await original<typeof import('@/lib/website/customerApplications')>(), processWebsiteCustomerApplication: f.process }))
vi.mock('@/lib/website/customerApplicationAutomationReadiness', () => ({ evaluateCustomerApplicationAutomationReadiness: f.automation }))
vi.mock('@/lib/tenant/operationPolicy', async original => ({ ...await original<typeof import('@/lib/tenant/operationPolicy')>(), getTenantOperationDecision: f.operation }))
vi.mock('@/lib/audit/actionLogger', () => ({ scheduleUsageEvent: vi.fn(), logAction: vi.fn() }))

import { GET as integrationContext } from '@/app/api/v1/integration/context/route'
import { GET as apiDiagnostics } from '@/app/api/v1/public-contracts/diagnostics/route'
import { GET as websiteDiagnostics } from '@/app/api/v1/website/public-contracts/diagnostics/route'
import { GET as apiContracts } from '@/app/api/v1/contracts/route'
import { GET as websiteContracts } from '@/app/api/v1/website/public-contracts/route'
import { POST as quote } from '@/app/api/v1/website/quote/route'
import { POST as validate } from '@/app/api/v1/website/quote/validate/route'
import { POST as application } from '@/app/api/v1/website/customer-applications/route'

const companyId = '00000000-0000-4000-8000-000000000083', clientId = '00000000-0000-4000-8000-000000000084'
const raw = 'caller-correlation-canary@example.invalid | +46 70 123 45 67 | Canary Caller Fullname | capway_api_key_caller_canary_123456'
const commercial = {
  offer_reference: 'SYNTHETIC-OFFER', customer_type: 'private', resolution_id: '00000000-0000-4000-8000-000000000081',
  annual_consumption_kwh: 1000, start_date: '2026-10-15', price_option_reference: 'canonical_variable_monthly',
  invoice_delivery_method: 'email', selected_component_references: [], site_count: 1,
}
const appBody = {
  ...commercial, customer_type: undefined, quote_reference: 'SYNTHETIC-QUOTE', external_customer_id: 'synthetic-customer',
  customer: { customer_type: 'private', email: 'synthetic@example.invalid', first_name: 'Synthetic', last_name: 'Customer', phone: '+46701234567' },
  site: { facility_id: '123456789012345678', street: 'Synthetic Street 1', postal_code: '12345', city: 'Synthetic City', country: 'SE' },
  legal_bundle_version: 'synthetic-legal-version', legal_acceptances: [{ requirement_code: 'terms', document_reference: 'synthetic-document-reference-0001',
    document_version: '1', document_hash: 'a'.repeat(64), accepted: true, accepted_at: '2026-10-01T00:00:00Z' }],
  settlement: { model: 'market_hourly', customer_accepts: 'pricing_model', energy_price_locked_at_signup: false,
    uses_actual_metered_consumption: true, market_data_role: 'indicative_preview_only', settlement_resolution: 'hour' },
}
const routes = [
  { path: '/api/v1/integration/context', invoke: integrationContext, scope: 'integration_context.read', loader: f.context, code: 'PUBLIC_CONTRACTS_TEMPORARILY_UNAVAILABLE' },
  { path: '/api/v1/public-contracts/diagnostics', invoke: apiDiagnostics, scope: 'api_contracts.diagnostics', loader: f.context, code: 'PUBLIC_CONTRACTS_TEMPORARILY_UNAVAILABLE' },
  { path: '/api/v1/website/public-contracts/diagnostics', invoke: websiteDiagnostics, scope: 'website_contracts.diagnostics', loader: f.context, code: 'PUBLIC_CONTRACTS_TEMPORARILY_UNAVAILABLE' },
  { path: '/api/v1/contracts', invoke: apiContracts, scope: 'api_contracts.read', loader: f.context, code: 'PUBLIC_CONTRACTS_TEMPORARILY_UNAVAILABLE' },
  { path: '/api/v1/website/public-contracts', invoke: websiteContracts, scope: 'website_contracts.read', loader: f.context, code: 'PUBLIC_CONTRACTS_TEMPORARILY_UNAVAILABLE' },
  { path: '/api/v1/website/quote', invoke: quote, scope: 'website_quotes.write', loader: f.quote, body: commercial, code: 'website_quote_failed' },
  { path: '/api/v1/website/quote/validate', invoke: validate, scope: 'website_quotes.validate', loader: f.validate, body: { ...commercial, quote_reference: 'SYNTHETIC-QUOTE' }, code: 'website_quote_validation_failed' },
  { path: '/api/v1/website/customer-applications', invoke: application, scope: 'website_applications.write', loader: f.process, body: appBody, code: 'website_application_failed' },
]
function request(route: typeof routes[number], incoming = raw) {
  return new NextRequest('http://localhost' + route.path, {
    method: route.body ? 'POST' : 'GET',
    headers: { ...(f.hasToken ? { Authorization: 'Bearer synthetic-correlation-current-token' } : {}),
      'X-Request-ID': incoming, 'Content-Type': 'application/json', 'Origin': 'https://synthetic.invalid', 'Idempotency-Key': 'synthetic-correlation-write-key' },
    ...(route.body ? { body: JSON.stringify(route.body) } : {}),
  })
}
let errorLog: ReturnType<typeof vi.spyOn>, warnLog: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks(); f.allowed = true; f.hasToken = true; f.telemetry = []; f.queries = []
  f.rpc.mockImplementation(async (name: string, input: Row) => {
    if (name === 'public_contract_feed_fingerprint_v1') { expect(input.p_company_id).toBe(companyId); return { data: [{ fingerprint: 'a'.repeat(32) }], error: null } }
    if (name === 'gridex_list_external_api_contracts') { expect(input.p_company_id).toBe(companyId); return { data: [], error: null } }
    expect(name).toBe('authenticate_integration_request_v1')
    return { data: [{ auth_outcome: f.allowed ? 'allowed' : 'denied', error_code: f.allowed ? null : 'api_scope_missing', tenant_status: 'active',
      client_id: clientId, company_id: companyId, client_name: 'Synthetic client', client_status: 'active', key_prefix: 'synthetic', secret_hash: 'synthetic',
      scopes: [...new Set([...WEBSITE_CHECKOUT_REQUIRED_SCOPES, ...CUSTOMER_PORTAL_REQUIRED_SCOPES, ...TENANT_WEBSITE_RECOMMENDED_SCOPES, ...routes.map(r => r.scope)])],
      allowed_ips: [], allowed_origins: ['https://synthetic.invalid'], metadata: {}, rate_limit_per_minute: 60, expires_at: null,
      request_count: 1, route_limit: 60, reset_at: new Date(Date.now() + 60000).toISOString() }], error: null }
  })
  f.tables = {
    companies: [{ id: companyId, status: 'active', external_tenant_reference: 'synthetic-company', customer_portal_url: 'https://synthetic.invalid/portal', branding: {}, metadata: { website_portal_identity_mode: 'post_auth_allowed' } }],
    tenant_website_readiness_v: [{ company_id: companyId, has_public_contracts: true, has_terms: true, has_privacy_policy: true, has_withdrawal: true,
      has_power_of_attorney_text: true, has_price_terms: true, has_verified_sender: true, has_mail_templates: true }],
    contract_publication_revisions: [{ company_id: companyId, channel: 'api', revision: 2, revision_token: 'synthetic-api-revision' },
      { company_id: companyId, channel: 'website', revision: 3, revision_token: 'synthetic-website-revision' }],
    webhook_subscriptions: [], integration_api_write_idempotency: [{ id: 'foreign-original', company_id: 'foreign', status: 'completed', request_hash: 'original', response_body: { original: 'immutable' } }],
  }
  for (const loader of [f.context, f.quote, f.validate, f.process]) loader.mockRejectedValue({ code: '23505', message: raw, details: raw })
  f.diagnose.mockResolvedValue({ offers: [], total: 0, visible: 0 }); f.list.mockResolvedValue([])
  f.offer.mockResolvedValue({ offer_reference: commercial.offer_reference, company_id: companyId, customer_type: 'private' })
  f.automation.mockResolvedValue({ checks: { verified_customer_email_sender: true, required_email_templates_active: true, required_email_rules_active: true,
    automation_user_configured: true, automation_user_verified: true, cron_secret_configured: true, manual_operations_mailbox_ready: true }, warnings: [] })
  f.operation.mockResolvedValue({ allowed: true, reason_code: 'synthetic_allowed', company_status: 'active', capability_status: 'enabled', production_status: 'active', state_version: 1 })
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  warnLog = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => { errorLog.mockRestore(); warnLog.mockRestore() })

describe.each(routes)('actual server correlation $path', route => {
  it('uses its own generated response ID at the real persistence boundary despite UUID-shaped incoming text', async () => {
    const incoming = randomUUID(), foreign = structuredClone(f.tables.integration_api_write_idempotency[0])
    const response = await route.invoke(request(route, incoming)), body = await response.json()
    expect(route.loader).toHaveBeenCalledOnce(); expect(f.rpc.mock.calls[0][1]).toMatchObject({ p_required_all: [route.scope] })
    expect(response.status).toBe(500); expect(body.error.code).toBe(route.code)
    expect(body.request_id).toMatch(/^[a-f0-9-]{36}$/); expect(body.request_id).not.toBe(incoming)
    expect(response.headers.get('X-Request-ID')).toBe(body.request_id)
    expect(f.telemetry).toHaveLength(1)
    expect(f.telemetry[0]).toMatchObject({ company_id: companyId, api_client_id: clientId, request_id: body.request_id,
      status_code: response.status, error_code: route.code, metadata: { request_id: body.request_id, request_id_source: 'server_explicit' } })
    expect(inspect(errorLog.mock.calls)).toContain(body.request_id)
    expect(inspect([body, f.telemetry, errorLog.mock.calls])).not.toContain(raw)
    expect(f.tables.integration_api_write_idempotency[0]).toEqual(foreign)
  })

  it('keeps current scope denial ahead of all business loaders and effects', async () => {
    f.allowed = false
    const response = await route.invoke(request(route)), body = await response.json()
    expect(response.status).toBe(403); expect(body.error.code).toBe('api_scope_missing'); expect(f.rpc).toHaveBeenCalledOnce()
    for (const loader of [f.context, f.quote, f.validate, f.process, f.offer, f.diagnose, f.list, f.automation, f.operation]) expect(loader).not.toHaveBeenCalled()
    expect(f.queries.every(table => table === 'integration_api_requests')).toBe(true)
    expect(errorLog).not.toHaveBeenCalled(); expect(warnLog).not.toHaveBeenCalled()
    expect(f.tables.integration_api_write_idempotency).toHaveLength(1)
  })
})

it.each(routes.slice(0, 5))('preserves generated success correlation for actual $path', async route => {
  f.context.mockResolvedValue({ tenant_reference: 'synthetic-public-tenant', api_client_reference: 'synthetic-client', api_version: 'v1',
    contract_version: WEBSITE_INTEGRATION_CONTRACT_VERSION, authoritative_identity: 'api_key', configuration: {
      required_environment_variables: WEBSITE_TENANT_REQUIRED_ENVIRONMENT_VARIABLES, api_base_url: WEBSITE_INTEGRATION_BASE_URL,
      authentication: { header: 'Authorization', scheme: 'Bearer', server_side_only: true },
      openapi_url: WEBSITE_INTEGRATION_OPENAPI_URL, customer_portal_openapi_url: CUSTOMER_PORTAL_OPENAPI_URL,
      application_reference_location: WEBSITE_APPLICATION_REFERENCE_LOCATION, tenant_id_environment_required: false, company_id_environment_required: false,
    }, capabilities: { website_checkout_ready: true, customer_portal_ready: true, complete_tenant_website_ready: true,
      required_website_scopes: [], missing_website_scopes: [], required_customer_portal_scopes: [], missing_customer_portal_scopes: [],
      recommended_scopes: [], missing_recommended_scopes: [] } })
  const incoming = randomUUID(), response = await route.invoke(request(route, incoming)), body = await response.json()
  expect(response.status).toBe(200); expect(body.request_id).not.toBe(incoming)
  expect(response.headers.get('X-Request-ID')).toBe(body.request_id)
  expect(f.telemetry).toHaveLength(1)
  expect(f.telemetry[0]).toMatchObject({ company_id: companyId, api_client_id: clientId, request_id: body.request_id, status_code: 200,
    metadata: { request_id: body.request_id, request_id_source: 'server_explicit' } })
  expect(errorLog).not.toHaveBeenCalled()
})

it('creates a fresh current server correlation for each real request even when the inbound UUID repeats', async () => {
  const route = routes[0], incoming = randomUUID()
  const first = await (await route.invoke(request(route, incoming))).json()
  const second = await (await route.invoke(request(route, incoming))).json()
  expect(first.request_id).not.toBe(second.request_id)
  expect(first.request_id).not.toBe(incoming); expect(second.request_id).not.toBe(incoming)
  expect(f.telemetry.map(row => row.request_id)).toEqual([first.request_id, second.request_id])
})
