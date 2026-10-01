import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { inspect } from 'node:util'

vi.mock('server-only', () => ({}))
const f = vi.hoisted(() => ({ allowed: true, switchStatus: vi.fn(), legalBundle: vi.fn(), portfolio: vi.fn(),
  marketPrice: vi.fn(), energyArea: vi.fn(), telemetry: vi.fn(), authRpc: vi.fn(), authCode: 'api_scope_missing', authStatus: 'active', hasToken: true }))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: f.authRpc,
  from: () => {
    const query = { update: () => query, eq: () => query,
      insert: (payload: unknown) => { f.telemetry(payload); return query },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve) }
    return query
  },
} }))
vi.mock('@/lib/integrations/tenantContext', () => ({ loadExternalTenantContext: async () => ({ tenant_reference: 'synthetic-public-company' }) }))
vi.mock('@/lib/website/switchStatus', async original => ({
  ...await original<typeof import('@/lib/website/switchStatus')>(), loadWebsiteSwitchStatus: f.switchStatus,
}))
vi.mock('@/lib/website/publicContracts', async original => ({
  ...await original<typeof import('@/lib/website/publicContracts')>(), buildWebsiteLegalBundle: f.legalBundle,
  listPublicContractOffers: f.portfolio,
}))
vi.mock('@/lib/pricing/spot/currentMarketPrice', async original => ({
  ...await original<typeof import('@/lib/pricing/spot/currentMarketPrice')>(), loadCurrentMarketPrice: f.marketPrice,
}))
vi.mock('@/lib/energy/websiteResolutionCache', () => ({ resolveWebsiteEnergyContext: f.energyArea }))
vi.mock('@/lib/audit/actionLogger', () => ({ scheduleUsageEvent: vi.fn() }))

import { GET as switchStatus } from '@/app/api/v1/website/switch-status/route'
import { GET as legalBundle } from '@/app/api/v1/website/legal-bundle/route'
import { GET as portfolio } from '@/app/api/v1/website/portfolio-prices/route'
import { POST as marketPrice } from '@/app/api/v1/website/market-price/current/route'
import { POST as energyArea } from '@/app/api/v1/website/energy-area/resolve/route'

const canaries = ['website-canary@example.invalid', '+46 70 123 45 67', 'Website Canary Fullname',
  'Website Canary Street 19', 'capway_api_key_canary_987654321', 'sb_secret_canary_987654321']
const raw = canaries.join(' | '), clientToken = 'synthetic-website-current-client-token'
const companyId = '00000000-0000-4000-8000-000000000083', clientId = '00000000-0000-4000-8000-000000000084'
const authHeaders = (): Record<string, string> => f.hasToken ? { Authorization: `Bearer ${clientToken}` } : {}
const get = (path: string) => new NextRequest('http://localhost' + path, { headers: authHeaders() })
const post = (path: string, body: Record<string, unknown>) => new NextRequest('http://localhost' + path,
  { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) })
const routes = [
  { name: 'switch-status', call: () => switchStatus(get('/api/v1/website/switch-status?application_number=SYNTHETIC-APPLICATION')),
    loader: f.switchStatus, status: 500, code: 'switch_status_unavailable', scopes: ['website_switch_status.read'] },
  { name: 'legal-bundle', call: () => legalBundle(get('/api/v1/website/legal-bundle?offer_reference=SYNTHETIC-OFFER')),
    loader: f.legalBundle, status: 503, code: 'legal_bundle_unavailable', anyScopes: ['website_legal.read', 'website_contracts.read'] },
  { name: 'portfolio-prices', call: () => portfolio(get('/api/v1/website/portfolio-prices?offer_reference=SYNTHETIC-OFFER&price_area=SE3')),
    loader: f.portfolio, status: 500, code: 'portfolio_prices_unavailable', scopes: ['website_contracts.read'] },
  { name: 'market-price/current', call: () => marketPrice(post('/api/v1/website/market-price/current',
    { resolution_id: '00000000-0000-4000-8000-000000000081', price_area: 'SE3' })),
    loader: f.marketPrice, status: 500, code: 'market_price_provider_unavailable', scopes: ['website_market_prices.read'] },
  { name: 'energy-area/resolve', call: () => energyArea(post('/api/v1/website/energy-area/resolve', { postal_code: '12345', country: 'SE' })),
    loader: f.energyArea, status: 500, code: 'energy_area_resolution_failed', scopes: ['website_energy_area.resolve'] },
]
let log: ReturnType<typeof vi.spyOn>
const absent = (value: unknown) => { const output = inspect(value, { depth: 12 }); for (const canary of [...canaries, clientToken]) expect(output).not.toContain(canary) }
beforeEach(() => {
  vi.clearAllMocks(); f.allowed = true
  f.authCode = 'api_scope_missing'; f.authStatus = 'active'; f.hasToken = true
  f.authRpc.mockImplementation(async (name: string) => {
    expect(name).toBe('authenticate_integration_request_v1')
    return { data: [{ auth_outcome: f.allowed ? 'allowed' : 'denied', error_code: f.allowed ? null : f.authCode,
      tenant_status: f.authStatus, client_id: clientId, company_id: companyId, client_name: 'Synthetic client', client_status: 'active',
      key_prefix: clientToken.slice(0, 12), secret_hash: 'synthetic-hash', scopes: ['website_switch_status.read', 'website_legal.read', 'website_contracts.read', 'website_market_prices.read', 'website_energy_area.resolve'],
      allowed_ips: [], allowed_origins: [], metadata: {}, rate_limit_per_minute: 60, expires_at: null, request_count: 1, route_limit: 60, reset_at: new Date(Date.now() + 60000).toISOString() }], error: null }
  })
  for (const route of routes) route.loader.mockRejectedValue({ code: '23505', message: raw, details: raw, hint: raw,
    response: { authorization: raw, customer: { email: canaries[0], phone: canaries[1], address: canaries[3] } } })
  f.telemetry.mockResolvedValue(undefined)
  log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => log.mockRestore())

describe.each(routes)('actual website $name unknown-failure diagnostic', ({ call, loader, status, code, scopes, anyScopes }) => {
  it('executes the actual loader boundary and keeps its safe HTTP/code/trace without raw database/provider/customer diagnostics', async () => {
    const response = await call()
    expect(loader).toHaveBeenCalledOnce()
    expect(f.authRpc).toHaveBeenCalledOnce()
    expect(f.authRpc.mock.calls[0][1]).toMatchObject({ p_required_all: scopes ?? [], p_required_any: anyScopes ?? [] })
    const target = loader.mock.calls[0][0]
    expect(target.client?.company_id ?? target.companyId ?? target.company_id).toBe(companyId)
    expect(response.status).toBe(status)
    const body = await response.json()
    expect(body.error.code).toBe(code)
    const trace = body.error.trace_id ?? body.request_id ?? body.correlation_id ?? body.error.request_id
    expect(trace).toMatch(/^[a-f0-9-]{36}$/)
    expect(log).toHaveBeenCalledOnce()
    absent(body); absent(log.mock.calls); absent(f.telemetry.mock.calls)
    expect(inspect(log.mock.calls, { depth: 12 })).toContain(trace)
    expect(inspect(log.mock.calls, { depth: 12 })).toContain('23505')
  })
  it('retains the actual denied caller outcome before any loader effect or error logging', async () => {
    f.allowed = false
    const response = await call()
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('api_scope_missing')
    expect(f.authRpc).toHaveBeenCalledOnce()
    expect(loader).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled()
  })
  it('retains an actual current tenant-policy denial before any loader effect', async () => {
    f.allowed = false; f.authCode = 'tenant_paused'; f.authStatus = 'paused'
    const response = await call()
    expect(response.status).toBe(423)
    expect((await response.json()).error.code).toBe('organization_paused')
    expect(loader).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled()
  })
  it('rejects missing current client credentials before the authentication RPC, telemetry or loader', async () => {
    f.hasToken = false
    const response = await call()
    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('missing_api_token')
    expect(f.authRpc).not.toHaveBeenCalled(); expect(f.telemetry).not.toHaveBeenCalled()
    expect(loader).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled()
  })
  it('retains current revoked-token denial from the real authentication adapter before any loader effect', async () => {
    f.allowed = false; f.authCode = 'invalid_api_token'
    const response = await call()
    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('invalid_api_token')
    expect(f.authRpc).toHaveBeenCalledOnce()
    expect(loader).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled(); absent(f.telemetry.mock.calls)
  })
})

it('actual portfolio unavailable response retains the same canonical request correlation as its source log and request telemetry', async () => {
  const response = await routes[2].call()
  expect(response.status).toBe(500)
  const body = await response.json()
  const diagnostic = log.mock.calls[0][1] as { traceId: string }
  expect(body.request_id).toBe(diagnostic.traceId)
  expect(body.correlation_id).toBe(diagnostic.traceId)
  expect(f.telemetry.mock.calls[0][0].metadata.trace_id).toBe(diagnostic.traceId)
  expect(response.headers.get('X-Request-ID')).toBe(diagnostic.traceId)
})
