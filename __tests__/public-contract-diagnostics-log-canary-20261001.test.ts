import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { redirect } from 'next/navigation'
import { inspect } from 'node:util'

type Row = Record<string, unknown>
const f = vi.hoisted(() => ({
  allowed: true, hasToken: true, authCode: 'api_scope_missing', tenantStatus: 'active',
  context: vi.fn(), diagnose: vi.fn(), list: vi.fn(), rpc: vi.fn(), telemetry: [] as Row[],
  reads: [] as Array<{ table: string; predicates: Record<string, unknown> }>,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: f.rpc,
  from(table: string) {
    const predicates: Record<string, unknown> = {}
    const record = { table, predicates }
    f.reads.push(record)
    let inserted: Row | null = null
    let updated = false
    const q = {
      select: () => q,
      eq: (key: string, value: unknown) => { predicates[key] = value; return q },
      maybeSingle: () => q,
      insert: (row: Row) => { inserted = structuredClone(row); return q },
      update: () => { updated = true; return q },
      then: (resolve: (value: unknown) => unknown) => {
        if (inserted) {
          if (table !== 'integration_api_requests') throw new Error('unexpected_diagnostic_write')
          f.telemetry.push(inserted)
        } else if (updated) {
          expect(table).toBe('integration_api_clients')
          expect(predicates.id).toBe('00000000-0000-4000-8000-000000000084')
        } else if (table !== 'contract_publication_revisions') throw new Error('unexpected_diagnostic_read')
        return Promise.resolve({ data: inserted ?? { revision: 2, revision_token: 'synthetic-current-revision' }, error: null }).then(resolve)
      },
    }
    return q
  },
} }))
vi.mock('@/lib/integrations/tenantContext', async original => ({
  ...await original<typeof import('@/lib/integrations/tenantContext')>(),
  loadExternalTenantContext: f.context,
}))
vi.mock('@/lib/website/publicContracts', async original => ({
  ...await original<typeof import('@/lib/website/publicContracts')>(),
  diagnosePublicContractOffers: f.diagnose, listPublicContractOffers: f.list,
}))
vi.mock('@/lib/audit/actionLogger', () => ({ scheduleUsageEvent: vi.fn() }))

import { GET as integrationContext } from '@/app/api/v1/integration/context/route'
import { GET as apiDiagnostics } from '@/app/api/v1/public-contracts/diagnostics/route'
import { GET as websiteDiagnostics } from '@/app/api/v1/website/public-contracts/diagnostics/route'
import { GET as apiContracts } from '@/app/api/v1/contracts/route'
import { GET as websiteContracts } from '@/app/api/v1/website/public-contracts/route'

const companyId = '00000000-0000-4000-8000-000000000083'
const clientId = '00000000-0000-4000-8000-000000000084'
const token = 'synthetic-current-public-contracts-api-token'
const canaries = [
  'contracts-canary@example.invalid', '+46 70 123 45 67', 'Contracts Canary Fullname',
  'Contracts Canary Street 71', 'capway_api_key_canary_contracts_123456', 'sb_secret_canary_contracts_123456',
]
const raw = canaries.join(' | ')
const fault = (code = '23505') => ({
  code, message: raw, details: raw, hint: raw, name: raw, path: raw,
  response: { authorization: raw, customer: { email: canaries[0], phone: canaries[1] } },
})
const routes = [
  { path: '/api/v1/integration/context', get: integrationContext, scope: 'integration_context.read' },
  { path: '/api/v1/public-contracts/diagnostics', get: apiDiagnostics, scope: 'api_contracts.diagnostics' },
  { path: '/api/v1/website/public-contracts/diagnostics', get: websiteDiagnostics, scope: 'website_contracts.diagnostics' },
  { path: '/api/v1/contracts', get: apiContracts, scope: 'api_contracts.read' },
  { path: '/api/v1/website/public-contracts', get: websiteContracts, scope: 'website_contracts.read' },
]
const request = (path: string) => new NextRequest('http://localhost' + path, {
  headers: f.hasToken ? { Authorization: `Bearer ${token}` } : {},
})
const absent = (value: unknown) => {
  for (const canary of [...canaries, token]) expect(inspect(value, { depth: 14 })).not.toContain(canary)
}
let log: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  f.allowed = true; f.hasToken = true; f.authCode = 'api_scope_missing'; f.tenantStatus = 'active'
  f.reads = []; f.telemetry = []
  f.rpc.mockImplementation(async (name: string, input: Row) => {
    if (name === 'authenticate_integration_request_v1') return { data: [{
      auth_outcome: f.allowed ? 'allowed' : 'denied', error_code: f.allowed ? null : f.authCode,
      tenant_status: f.tenantStatus, client_id: clientId, company_id: companyId,
      client_name: 'Synthetic client', client_status: 'active', key_prefix: token.slice(0, 12), secret_hash: 'synthetic-hash',
      scopes: routes.map(route => route.scope), allowed_ips: [], allowed_origins: [], metadata: {},
      rate_limit_per_minute: 60, request_count: 1, route_limit: 60, expires_at: null,
      reset_at: new Date(Date.now() + 60000).toISOString(),
    }], error: null }
    expect(name).toBe('public_contract_feed_fingerprint_v1')
    expect(input.p_company_id).toBe(companyId)
    return { data: [{ fingerprint: 'a'.repeat(32) }], error: null }
  })
  f.context.mockRejectedValue(fault())
  f.diagnose.mockResolvedValue({ offers: [], total: 0 })
  f.list.mockResolvedValue([])
  log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => log.mockRestore())

describe.each(routes)('actual $path diagnostic boundary', ({ path, get, scope }) => {
  it('executes current real authority and the real classifier without raw error/name/path customer diagnostics', async () => {
    const response = await get(request(path)), body = await response.json()
    expect(f.context).toHaveBeenCalledOnce()
    expect(f.context.mock.calls[0][0]).toMatchObject({ id: clientId, company_id: companyId })
    expect(f.rpc.mock.calls[0][1]).toMatchObject({ p_required_all: [scope], p_required_any: [] })
    expect(response.status).toBe(500); expect(body.error.code).toBe('PUBLIC_CONTRACTS_TEMPORARILY_UNAVAILABLE')
    expect(log).toHaveBeenCalledOnce(); absent(body); absent(log.mock.calls); absent(f.telemetry)
    const trace = body.request_id
    expect(trace).toMatch(/^[a-f0-9-]{36}$/); expect(response.headers.get('X-Request-ID')).toBe(trace)
    expect(inspect(log.mock.calls, { depth: 14 })).toContain(trace)
    expect(inspect(log.mock.calls, { depth: 14 })).toContain('23505')
    expect(f.telemetry).toHaveLength(1); expect(f.telemetry[0].metadata).toMatchObject({ request_id: trace })
    for (const read of f.reads.filter(read => read.table === 'contract_publication_revisions')) {
      expect(read.predicates.company_id).toBe(companyId)
      expect(read.predicates.channel).toBe(path.includes('/website/') ? 'website' : 'api')
    }
  })

  it('keeps a genuine schema SQLSTATE and original classified HTTP taxonomy while dropping free fault text', async () => {
    f.context.mockRejectedValue(fault('42P01'))
    const response = await get(request(path)), body = await response.json()
    expect(response.status).toBe(503); expect(body.error.code).toBe('PUBLIC_CONTRACT_SCHEMA_OUTDATED')
    expect(f.telemetry[0].error_code).toBe('PUBLIC_CONTRACT_SCHEMA_OUTDATED')
    absent(log.mock.calls); absent(f.telemetry); absent(body)
    expect(inspect(log.mock.calls, { depth: 14 })).toContain('42P01')
  })

  it('never promotes arbitrary provider code/name/path text into technical diagnostic fields', async () => {
    f.context.mockRejectedValue(fault(raw))
    const response = await get(request(path)), body = await response.json()
    expect(response.status).toBe(500); expect(body.error.code).toBe('PUBLIC_CONTRACTS_TEMPORARILY_UNAVAILABLE')
    absent(log.mock.calls); absent(f.telemetry); absent(body)
  })

  it.each([
    { code: 'api_scope_missing', tenant: 'active', status: 403, publicCode: 'api_scope_missing' },
    { code: 'tenant_paused', tenant: 'paused', status: 423, publicCode: 'organization_paused' },
    { code: 'invalid_api_token', tenant: 'active', status: 401, publicCode: 'invalid_api_token' },
  ])('denies current $code before context/revision/feed reads and logging', async ({ code, tenant, status, publicCode }) => {
    f.allowed = false; f.authCode = code; f.tenantStatus = tenant
    const response = await get(request(path)), body = await response.json()
    expect(response.status).toBe(status); expect(body.error.code).toBe(publicCode)
    expect(f.rpc).toHaveBeenCalledOnce(); expect(f.context).not.toHaveBeenCalled()
    expect(f.diagnose).not.toHaveBeenCalled(); expect(f.list).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled()
    expect(f.reads.every(read => read.table === 'integration_api_requests')).toBe(true)
  })

  it('denies missing credentials before Auth RPC or any tenant read/write', async () => {
    f.hasToken = false
    const response = await get(request(path)), body = await response.json()
    expect(response.status).toBe(401); expect(body.error.code).toBe('missing_api_token')
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.context).not.toHaveBeenCalled(); expect(f.reads).toEqual([])
    expect(f.telemetry).toEqual([]); expect(log).not.toHaveBeenCalled()
  })

  it('propagates installed Next control flow from real current authorization before diagnostics', async () => {
    let signal: unknown
    try { redirect('/synthetic-public-contracts-control-flow') } catch (error) { signal = error }
    expect(signal).toBeTruthy(); f.rpc.mockRejectedValue(signal)
    await expect(get(request(path))).rejects.toBe(signal)
    expect(f.context).not.toHaveBeenCalled(); expect(f.reads).toEqual([]); expect(log).not.toHaveBeenCalled()
  })
})
