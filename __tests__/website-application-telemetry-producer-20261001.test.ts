import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WEBSITE_CHECKOUT_REQUIRED_SCOPES, CUSTOMER_PORTAL_REQUIRED_SCOPES, TENANT_WEBSITE_RECOMMENDED_SCOPES } from '@/lib/integrations/websiteIntegrationContract'

type Row = Record<string, unknown>
const f = vi.hoisted(() => ({
  rpc: vi.fn(), process: vi.fn(), automation: vi.fn(), operation: vi.fn(), after: vi.fn(), deny: null as string | null,
  tables: {} as Record<string, Row[]>, queries: [] as string[],
}))
vi.mock('server-only', () => ({}))
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: f.after }))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: f.rpc,
  from(table: string) {
    f.queries.push(table)
    const predicates: Row = {}
    let inserted: Row | null = null, updated: Row | null = null, single = false, head = false
    const q = {
      select: (_fields?: string, options?: { head?: boolean }) => { head = options?.head === true; return q },
      eq: (field: string, value: unknown) => { predicates[field] = value; return q }, order: () => q, limit: () => q,
      insert: (value: Row) => { inserted = structuredClone(value); return q }, update: (value: Row) => { updated = value; return q },
      maybeSingle: () => { single = true; return q }, single: () => { single = true; return q },
      then: (resolve: (value: unknown) => unknown) => {
        const all = f.tables[table] ?? []
        if (inserted) {
          expect(['integration_api_requests', 'platform_usage_events']).toContain(table)
          all.push(inserted); f.tables[table] = all
        }
        const rows = inserted ? [inserted] : all.filter(row => Object.entries(predicates).every(([key, value]) => row[key] === value))
        if (updated) {
          expect(table).toBe('integration_api_clients'); expect(predicates.id).toBe('00000000-0000-4000-8000-000000000084')
        }
        if (!inserted && !updated) expect(['companies', 'tenant_website_readiness_v', 'webhook_subscriptions']).toContain(table)
        return Promise.resolve({ data: head ? null : structuredClone(single ? rows[0] ?? null : rows), count: rows.length, error: null }).then(resolve)
      },
    }
    return q
  },
} }))
vi.mock('@/lib/website/customerApplications', async original => ({ ...await original<typeof import('@/lib/website/customerApplications')>(), processWebsiteCustomerApplication: f.process }))
vi.mock('@/lib/website/customerApplicationAutomationReadiness', () => ({ evaluateCustomerApplicationAutomationReadiness: f.automation }))
vi.mock('@/lib/tenant/operationPolicy', async original => ({ ...await original<typeof import('@/lib/tenant/operationPolicy')>(), getTenantOperationDecision: f.operation }))

import { POST } from '@/app/api/v1/website/customer-applications/route'
import { publicWebsiteCustomerApplicationData } from '@/lib/website/publicCustomerApplication'

const companyId = '00000000-0000-4000-8000-000000000083', clientId = '00000000-0000-4000-8000-000000000084'
const customerId = '00000000-0000-4000-8000-000000000085', applicationId = '00000000-0000-4000-8000-000000000086'
const externalCustomerId = 'synthetic-private-external-customer', customerNumber = 'SYNTHETIC-CUSTOMER-301'
const payload = {
  offer_reference: 'SYNTHETIC-OFFER', quote_reference: 'SYNTHETIC-QUOTE', external_customer_id: externalCustomerId,
  resolution_id: '00000000-0000-4000-8000-000000000081', annual_consumption_kwh: 1000,
  start_date: '2026-10-15', price_option_reference: 'canonical_variable_monthly', invoice_delivery_method: 'email', selected_component_references: [], site_count: 1,
  customer: { customer_type: 'private', email: 'synthetic@example.invalid', first_name: 'Synthetic', last_name: 'Customer', phone: '+46 70 000 00 00' },
  site: { facility_id: '123456789012345678', street: 'Synthetic Street 1', postal_code: '12345', city: 'Synthetic City', country: 'SE' },
  legal_bundle_version: 'synthetic-legal-version', legal_acceptances: [{ requirement_code: 'terms', document_reference: 'synthetic-document-reference-0001',
    document_version: '1', document_hash: 'a'.repeat(64), accepted: true, accepted_at: '2026-10-01T00:00:00Z' }],
  settlement: { model: 'market_hourly', customer_accepts: 'pricing_model', energy_price_locked_at_signup: false,
    uses_actual_metered_consumption: true, market_data_role: 'indicative_preview_only', settlement_resolution: 'hour' },
}
function request(options: { token?: boolean; body?: Row } = {}) {
  return new NextRequest('http://localhost/api/v1/website/customer-applications', { method: 'POST', headers: {
    'Content-Type': 'application/json', 'Idempotency-Key': 'synthetic-application-producer-20261001', 'Origin': 'https://synthetic.invalid',
    ...(options.token === false ? {} : { Authorization: 'Bearer synthetic-current-application-token' }),
  }, body: JSON.stringify(options.body ?? payload) })
}
let info: ReturnType<typeof vi.spyOn>, errorLog: ReturnType<typeof vi.spyOn>, warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks(); f.deny = null; f.tables = {
    companies: [{ id: companyId, status: 'active', external_tenant_reference: 'synthetic-company', customer_portal_url: 'https://synthetic.invalid/portal',
      branding: {}, metadata: { website_portal_identity_mode: 'post_auth_allowed' } }],
    tenant_website_readiness_v: [{ company_id: companyId, has_public_contracts: true, has_terms: true, has_privacy_policy: true, has_withdrawal: true,
      has_power_of_attorney_text: true, has_price_terms: true, has_verified_sender: true, has_mail_templates: true }], webhook_subscriptions: [],
  }; f.queries = []
  f.after.mockImplementation(() => { throw new Error('outside_request_scope') })
  const scopes = [...new Set([...WEBSITE_CHECKOUT_REQUIRED_SCOPES, ...CUSTOMER_PORTAL_REQUIRED_SCOPES, ...TENANT_WEBSITE_RECOMMENDED_SCOPES])]
  f.rpc.mockImplementation(async (name: string, args: Row) => {
    expect(name).toBe('authenticate_integration_request_v1'); expect(args).toMatchObject({ p_required_all: ['website_applications.write'], p_required_any: [] })
    return { data: [{ auth_outcome: f.deny ? 'denied' : 'allowed', error_code: f.deny, tenant_status: f.deny === 'tenant_paused' ? 'paused' : 'active',
      client_id: clientId, company_id: companyId, client_name: 'Synthetic', client_status: 'active', key_prefix: 'synthetic', secret_hash: 'synthetic',
      scopes, allowed_ips: [], allowed_origins: ['https://synthetic.invalid'], metadata: {}, rate_limit_per_minute: 60, expires_at: null,
      request_count: 1, route_limit: 60, reset_at: new Date(Date.now() + 60000).toISOString() }], error: null }
  })
  f.automation.mockResolvedValue({ checks: { verified_customer_email_sender: true, required_email_templates_active: true, required_email_rules_active: true,
    automation_user_configured: true, automation_user_verified: true, cron_secret_configured: true, manual_operations_mailbox_ready: true }, warnings: [] })
  f.operation.mockResolvedValue({ allowed: true, reason_code: 'synthetic_allowed', company_status: 'active', capability_status: 'enabled', production_status: 'active', state_version: 1 })
  f.process.mockResolvedValue({ ok: true, status: 201, body: { data: { customer_id: customerId, application_id: applicationId,
    customer_number: customerNumber, external_customer_id: externalCustomerId, status: 'received' } } })
  info = vi.spyOn(console, 'info').mockImplementation(() => undefined); errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => { info.mockRestore(); errorLog.mockRestore(); warn.mockRestore() })

describe('actual application producer; separate request and usage telemetry sinks', () => {
  it('omits unnecessary customer labels from both diagnostic sinks while preserving original intake/public customer references and authoritative IDs', async () => {
    const response = await POST(request()), body = await response.json()
    expect(response.status).toBe(201)
    const intake = await f.process.mock.results[0].value
    expect(body.data).toEqual(publicWebsiteCustomerApplicationData(intake.body.data, companyId))
    expect(body.data).toMatchObject({ customer_number: customerNumber, external_customer_id: externalCustomerId })
    expect(f.process.mock.calls[0][0]).toMatchObject({ rawBody: payload, client: { id: clientId, company_id: companyId }, idempotencyKey: 'synthetic-application-producer-20261001' })
    expect(f.tables.integration_api_requests).toHaveLength(1); expect(f.tables.platform_usage_events).toHaveLength(1)
    expect(f.tables.integration_api_requests[0]).toMatchObject({ request_id: body.request_id, company_id: companyId, api_client_id: clientId,
      status_code: 201, metadata: { result_count: 1, application_id: applicationId } })
    expect(f.tables.platform_usage_events[0]).toMatchObject({ company_id: companyId, api_client_id: clientId, customer_id: customerId, entity_id: applicationId,
      event_key: 'api.website_application.created', is_billable: true, billing_unit: 'customer_application', metadata: { result_count: 1, application_id: applicationId } })
    for (const row of [f.tables.integration_api_requests[0], f.tables.platform_usage_events[0]]) {
      expect(row.metadata).not.toHaveProperty('external_customer_id'); expect(row.metadata).not.toHaveProperty('customer_number')
    }
  })

  it('retains controlled failed-intake status/code/technical fields without copying customer labels into nonbillable usage metadata', async () => {
    f.process.mockResolvedValue({ ok: false, status: 422, body: { code: 'validation_error', error: 'Synthetic validation failure', error_stage: 'validation', field: 'customer_type' } })
    const response = await POST(request()), body = await response.json()
    expect(response.status).toBe(422); expect(body.error.code).toBe('validation_error')
    expect(f.tables.platform_usage_events[0]).toMatchObject({ company_id: companyId, api_client_id: clientId, customer_id: null, entity_id: null,
      event_key: 'api.website_application.failed', is_billable: false, metadata: { result_count: 0, error_code: 'validation_error', error_stage: 'validation', field: 'customer_type' } })
    expect(f.tables.platform_usage_events[0].metadata).not.toHaveProperty('external_customer_id')
    expect(f.tables.platform_usage_events[0].metadata).not.toHaveProperty('customer_number')
  })

  it.each(['api_scope_missing', 'tenant_paused'])('denies current %s before readiness/intake/usage persistence', async code => {
    f.deny = code; const response = await POST(request())
    expect(response.status).toBe(code === 'tenant_paused' ? 423 : 403)
    expect(f.process).not.toHaveBeenCalled(); expect(f.automation).not.toHaveBeenCalled(); expect(f.operation).not.toHaveBeenCalled()
    expect(f.tables.platform_usage_events).toBeUndefined(); expect(f.queries.every(table => table === 'integration_api_requests')).toBe(true)
  })

  it('rejects missing API credentials before Auth RPC or any diagnostic/usage/tenant write', async () => {
    const response = await POST(request({ token: false }))
    expect(response.status).toBe(401); expect(f.rpc).not.toHaveBeenCalled(); expect(f.process).not.toHaveBeenCalled(); expect(f.queries).toEqual([])
  })

  it('denies a caller-supplied foreign tenant before intake after current-company readiness; original diagnostic tenant stays current', async () => {
    const response = await POST(request({ body: { ...payload, company_id: '00000000-0000-4000-8000-000000000099' } })), body = await response.json()
    expect(response.status).toBe(403); expect(body.error.code).toBe('organization_context_mismatch')
    expect(f.process).not.toHaveBeenCalled(); expect(f.automation).toHaveBeenCalledWith(companyId); expect(f.tables.platform_usage_events).toBeUndefined()
    expect(f.tables.integration_api_requests[0]).toMatchObject({ company_id: companyId, api_client_id: clientId, request_id: body.request_id })
  })
})
