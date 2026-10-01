import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { NextRequest } from 'next/server'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const f = vi.hoisted(() => ({
  rpc: vi.fn(), resolve: vi.fn(), load: vi.fn(), allowed: true, token: true,
  rows: [] as Row[], sections: {} as Record<string, Row[]>, writes: [] as string[],
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: f.rpc,
  from(table: string) {
    let inserted: Row | null = null, updated = false
    const predicates: Row = {}
    const q = {
      update: () => { updated = true; return q }, eq: (key: string, value: unknown) => { predicates[key] = value; return q },
      insert: (row: Row) => { inserted = structuredClone(row); return q },
      then: (resolve: (value: unknown) => unknown) => {
        if (inserted) { expect(table).toBe('integration_api_requests'); f.rows.push(inserted); f.writes.push(table) }
        else if (updated) { expect(table).toBe('integration_api_clients'); expect(predicates.id).toBe('00000000-0000-4000-8000-000000000084') }
        else throw new Error('unexpected_bundle_database_boundary')
        return Promise.resolve({ data: null, error: null }).then(resolve)
      },
    }
    return q
  },
} }))
vi.mock('@/lib/customer-portal/customerResolver', async original => ({ ...await original<typeof import('@/lib/customer-portal/customerResolver')>(), resolvePortalCustomer: f.resolve }))
vi.mock('@/lib/customer-portal/apiData', async original => {
  const actual = await original<typeof import('@/lib/customer-portal/apiData')>()
  const names = { listPortalContracts: 'contracts', listPortalSites: 'sites', listPortalMeteringPoints: 'metering_points',
    listPortalInvoices: 'invoices', listPortalMeteringValues: 'metering_values', listPortalDocuments: 'documents',
    listPortalLegalAcceptances: 'legal_acceptances', listPortalPowersOfAttorney: 'powers_of_attorney',
    listPortalNotifications: 'notifications', listPortalEvents: 'events', listPortalWebsiteApplications: 'website_applications' }
  return { ...actual, ...Object.fromEntries(Object.entries(names).map(([name, section]) => [name, (context: unknown, ...args: unknown[]) => f.load(section, context, args)])) }
})

import { GET, POST } from '@/app/api/v1/customer/portal-bundle/route'

const companyId = '00000000-0000-4000-8000-000000000083', clientId = '00000000-0000-4000-8000-000000000084'
const customerId = '00000000-0000-4000-8000-000000000085', subject = '00000000-0000-4000-8000-000000000086'
const issuer = 'https://synthetic-issuer.example.invalid', audience = 'synthetic-gridex-portal', path = '/api/v1/customer/portal-bundle'
const scopes = ['customer_profile.read', 'customer_sites.read', 'customer_contracts.read', 'customer_invoices.read', 'customer_metering.read',
  'customer_legal.read', 'customer_events.read', 'customer_documents.read', 'customer_notifications.read', 'customer_power_of_attorney.read']
const incompleteIssues = ['missing_contract', 'missing_metering_point', 'missing_facility_id', 'missing_grid_owner', 'facility_not_verified',
  'missing_power_of_attorney', 'missing_legal_acceptance', 'missing_price_plan']
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'], trust: string
let info: ReturnType<typeof vi.spyOn>, errorLog: ReturnType<typeof vi.spyOn>
beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true }); privateKey = pair.privateKey
  trust = JSON.stringify({ [clientId]: { issuer, audience, bindings: { [issuer]: { [subject]: customerId } },
    jwks: { keys: [{ ...await exportJWK(pair.publicKey), kid: 'synthetic-key', alg: 'RS256', use: 'sig' }] } } })
})
beforeEach(() => {
  vi.clearAllMocks(); f.allowed = true; f.token = true; f.rows = []; f.sections = {}; f.writes = []
  vi.stubEnv('GRIDEX_CUSTOMER_DELEGATION_TRUST_JSON', trust)
  f.rpc.mockImplementation(async (name: string) => {
    expect(name).toBe('authenticate_integration_request_v1')
    return { data: [{ auth_outcome: f.allowed ? 'allowed' : 'denied', error_code: f.allowed ? null : 'api_scope_missing', tenant_status: 'active',
      client_id: clientId, company_id: companyId, client_name: 'Synthetic', client_status: 'active', key_prefix: 'synthetic', secret_hash: 'synthetic',
      scopes, allowed_ips: [], allowed_origins: [], metadata: {}, rate_limit_per_minute: 60, expires_at: null,
      request_count: 1, route_limit: 60, reset_at: new Date(Date.now() + 60000).toISOString() }], error: null }
  })
  f.resolve.mockResolvedValue({ ok: true, customer: { customer_id: customerId, company_id: companyId, customer_portal_user_id: subject,
    provider: 'customer_portal_accounts', external_customer_id: 'synthetic-external', customer_number: 'SYNTHETIC-300', email: 'synthetic@example.invalid',
    match_strength: 'strong', customer: { id: customerId, company_id: companyId, customer_number: 'SYNTHETIC-300', full_name: 'Synthetic Customer', email: 'synthetic@example.invalid' } } })
  f.load.mockImplementation(async (section: string, context: Row) => {
    expect(context).toMatchObject({ companyId, customerId, provider: 'customer_portal_accounts' })
    return structuredClone(f.sections[section] ?? [])
  })
  info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => { vi.unstubAllEnvs(); info.mockRestore(); errorLog.mockRestore() })
async function request(method: 'GET' | 'POST', options: { assertion?: boolean; claims?: Row; foreignSubject?: boolean } = {}) {
  const assertion = await new SignJWT({ company_id: companyId, api_client_id: clientId, customer_id: customerId, action: `${method} ${path}`, ...options.claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'synthetic-key' }).setIssuer(issuer).setAudience(audience)
    .setSubject(subject).setIssuedAt().setExpirationTime('2m').sign(privateKey)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (f.token) headers.Authorization = 'Bearer synthetic-current-bundle-token'
  if (options.assertion !== false) headers['X-Gridex-Customer-Assertion'] = assertion
  if (options.foreignSubject) headers['X-Gridex-Auth-User-ID'] = 'different-synthetic-subject'
  return new NextRequest('http://localhost' + path, { method, headers, ...(method === 'POST' ? { body: JSON.stringify({ customer_number: 'SYNTHETIC-300' }) } : {}) })
}
function completeGraph() {
  f.sections = {
    contracts: [{ id: '00000000-0000-4000-8000-000000000087', status: 'active', price_plan_id: '00000000-0000-4000-8000-000000000088' }],
    sites: [{ id: '00000000-0000-4000-8000-000000000089', facility_id: '735999111000000001', grid_owner_id: 'synthetic-grid-owner', resolution_status: 'facility_verified' }],
    metering_points: [{ id: '00000000-0000-4000-8000-000000000090', meter_point_id: '735999111000000001', grid_owner_id: 'synthetic-grid-owner' }],
    powers_of_attorney: [{ status: 'signed', scope: 'supplier_switch' }],
    legal_acceptances: [{ acceptance_type: 'terms' }, { acceptance_type: 'privacy_policy' }, { acceptance_type: 'withdrawal_info' }],
  }
}
describe.each([{ method: 'GET' as const, invoke: GET, mode: 'headers_or_query' }, { method: 'POST' as const, invoke: POST, mode: 'json_payload' }])('actual $method portal bundle count', ({ method, invoke, mode }) => {
  it('stores the genuine count of nonempty public issues while preserving the original public issue/status graph', async () => {
    const response = await invoke(await request(method)), body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data.customer_status).toMatchObject({ code: 'needs_facility_data', severity: 'blocking', issues: incompleteIssues })
    expect(body.data.data_quality).toEqual({ status: 'needs_action', issues: incompleteIssues, false_blockers_removed: false })
    expect(body.data.bundle_status).toEqual({ status: 'complete', complete: true, unavailable_sections: [], warnings: [] })
    expect(body.data.profile).toMatchObject({ display_name: 'Synthetic Customer', customer_number: 'SYNTHETIC-300', email: 'synthetic@example.invalid' })
    expect(f.rows).toHaveLength(1)
    expect(f.rows[0]).toMatchObject({ company_id: companyId, api_client_id: clientId, status_code: 200,
      metadata: { data_quality_issues: incompleteIssues.length, access_mode: mode, result_count: 1, partial_bundle: false } })
    expect(f.resolve.mock.calls[0][0].identifiers).toMatchObject({ authUserId: subject, customerPortalUserId: subject })
    expect(f.rpc.mock.calls[0][1]).toMatchObject({ p_required_all: scopes, p_required_any: [] })
    expect(f.load).toHaveBeenCalledTimes(11); expect(errorLog).not.toHaveBeenCalled()
  })

  it('persists zero for a genuine complete graph without changing public active status or issuing business writes', async () => {
    completeGraph(); const original = structuredClone(f.sections)
    const response = await invoke(await request(method)), body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data.customer_status).toMatchObject({ code: 'active', severity: 'success', issues: [] })
    expect(body.data.data_quality).toEqual({ status: 'complete', issues: [], false_blockers_removed: true })
    expect(f.rows[0].metadata).toMatchObject({ data_quality_issues: 0, access_mode: mode })
    expect(f.sections).toEqual(original); expect(f.writes).toEqual(['integration_api_requests'])
  })

  it('denies current missing scope before delegation/section loading', async () => {
    f.allowed = false
    const response = await invoke(await request(method)), body = await response.json()
    expect(response.status).toBe(403); expect(body.error.code).toBe('api_scope_missing')
    expect(f.resolve).not.toHaveBeenCalled(); expect(f.load).not.toHaveBeenCalled()
    expect(f.rows.every(row => (row.metadata as Row).data_quality_issues === undefined)).toBe(true)
  })

  it('denies missing API credentials before Auth RPC, ownership lookup or diagnostic persistence', async () => {
    f.token = false
    const response = await invoke(await request(method)), body = await response.json()
    expect(response.status).toBe(401); expect(body.error.code).toBe('missing_api_token')
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.resolve).not.toHaveBeenCalled(); expect(f.load).not.toHaveBeenCalled(); expect(f.rows).toEqual([])
  })

  it.each([{ name: 'missing delegated proof', assertion: false }, { name: 'foreign company proof', claims: { company_id: '00000000-0000-4000-8000-000000000099' } },
    { name: 'different supplied subject', foreignSubject: true }])('denies $name before any ownership/section read', async options => {
    const response = await invoke(await request(method, options)), body = await response.json()
    expect(response.status).toBe(403)
    expect(body.error.code).toBe(options.foreignSubject ? 'customer_delegation_subject_mismatch' : 'customer_delegation_required')
    expect(f.resolve).not.toHaveBeenCalled(); expect(f.load).not.toHaveBeenCalled()
  })
})
