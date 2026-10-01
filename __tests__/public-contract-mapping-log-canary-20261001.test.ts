import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { inspect } from 'node:util'

type Row = Record<string, unknown>
const f = vi.hoisted(() => ({
  allowed: true, hasToken: true, authCode: 'api_scope_missing', tenantStatus: 'active',
  apiRows: [] as Row[], context: vi.fn(), diagnose: vi.fn(), list: vi.fn(), rpc: vi.fn(), telemetry: [] as Row[],
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

import fixture from '@/docs/fixtures/public-contracts-response-2026-10-01.1.json'
import { publicContractResponse, type PublicContractOffer } from '@/lib/website/publicContracts'
import { mapContractPublicationToPublicDto } from '@/lib/external-contracts/publicationDto'
import { serializePublicContractPriceOptions } from '@/lib/external-contracts/publicContractModel'
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
const routes = [
  { path: '/api/v1/contracts', get: apiContracts, scope: 'api_contracts.read', channel: 'api' as const },
  { path: '/api/v1/website/public-contracts', get: websiteContracts, scope: 'website_contracts.read', channel: 'website' as const },
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
    if (name === 'gridex_list_external_api_contracts') {
      expect(input).toEqual({ p_company_id: companyId, p_customer_type: null }); return { data: f.apiRows, error: null }
    }
    expect(name).toBe('public_contract_feed_fingerprint_v1')
    expect(input.p_company_id).toBe(companyId)
    return { data: [{ fingerprint: 'a'.repeat(32) }], error: null }
  })
  f.context.mockResolvedValue({ tenant_reference: 'synthetic-mapping-organization' }); f.apiRows = []
  f.diagnose.mockResolvedValue({ offers: [], total: 0 })
  f.list.mockResolvedValue([])
  log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => log.mockRestore())


function validOffer(): PublicContractOffer {
  const source = fixture.data[0]
  return {
    id: '00000000-0000-4000-8000-000000000091', company_id: companyId,
    price_plan_id: null, price_plan_version_id: null, campaign_version_id: null,
    product_code: 'synthetic_variable', public_name: 'Synthetic Variable', public_description: null,
    contract_type: 'variable_monthly', energy_direction: 'consumption', billing_model: null, customer_type: 'private',
    monthly_fee_sek: 49, invoice_fee_sek: 0, markup_ore_per_kwh: 10, spot_markup_ore_per_kwh: 10,
    variable_fee_ore_per_kwh: 0, fixed_price_ore_per_kwh: null, green_fee_mode: null, green_fee_value: null,
    terms_version: '2', valid_from: null, valid_to: null, sort_order: 1, metadata: {},
    canonical_offer_reference: 'offer_synthetic_mapping', price_options: serializePublicContractPriceOptions(source.price_options),
    legal_bundle_version_id: source.legal.legal_bundle_version_id,
    legal_versions: source.legal.module_versions.map(module => ({ ...module, type: module.module_key })),
  }
}
function feed(channel: 'api' | 'website', malformed: boolean) {
  if (channel === 'api') f.apiRows = [{ ...structuredClone(fixture.data[0]), ...(malformed ? { offer_reference: raw, price_options: [] } : {}) }]
  else f.list.mockResolvedValue([{ ...validOffer(), ...(malformed ? { canonical_offer_reference: raw, legal_versions: [] } : {}) }])
}

describe.each(routes)('actual $path inner malformed-publication diagnostic', ({ path, get, scope, channel }) => {
  it('keeps real malformed-row rejection taxonomy while excluding the original customer/credential canary offer from the reachable console sink', async () => {
    feed(channel, true)
    const response = await get(request(path)), body = await response.json()
    expect(response.status).toBe(channel === 'api' ? 409 : 503)
    expect(body.error.code).toBe(channel === 'api' ? 'PUBLICATION_RUNTIME_SCHEMA_MISMATCH' : 'PUBLIC_CONTRACT_FEED_INCONSISTENT')
    const rejected = log.mock.calls.filter((call: unknown[]) => String(call[0]).includes('rejected malformed publication'))
    expect(rejected).toHaveLength(1)
    expect(f.context.mock.calls[0][0]).toMatchObject({ id: clientId, company_id: companyId })
    expect(f.rpc.mock.calls[0][1]).toMatchObject({ p_required_all: [scope], p_required_any: [] })
    expect(f.telemetry).toHaveLength(1); expect(f.telemetry[0]).toMatchObject({ company_id: companyId, api_client_id: clientId, status_code: response.status, error_code: body.error.code })
    expect(f.telemetry[0].request_id).toBe(body.request_id)
    expect(response.headers.get('X-Request-ID')).toBe(body.request_id)
    if (channel === 'api') absent(body)
    else expect(body.error.details.affected_contracts).toEqual([{ canonical_offer_reference: raw, publication_version_id: null, diagnostic_code: 'PUBLICATION_LEGAL_BUNDLE_VERSION_MISSING' }])
    absent(f.telemetry)
    // This is the actual console sink, independent of the already closed metadata writer.
    absent(log.mock.calls)
    expect(rejected[0][1]).toMatchObject({ requestId: body.request_id, companyId, apiClientId: clientId, channel,
      errorCode: channel === 'api' ? 'PUBLICATION_RUNTIME_SCHEMA_MISMATCH' : 'PUBLICATION_LEGAL_BUNDLE_VERSION_MISSING',
      errorName: 'technical_error', databaseCode: null, errorPath: null })
    expect(rejected[0][1]).not.toHaveProperty('offerReference')
  })

  it('keeps the real positive mapper, public graph, revision and current server correlation unchanged', async () => {
    feed(channel, false)
    const response = await get(request(path)), body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data).toHaveLength(1); expect(body.meta).toMatchObject({ count: 1, channel, publication_revision: 2 })
    const publication = channel === 'api' ? fixture.data[0] : publicContractResponse(validOffer())
    expect(body.data[0]).toEqual(mapContractPublicationToPublicDto({ publication: publication as Row, companyId, channel }))
    expect(f.telemetry[0]).toMatchObject({ request_id: body.request_id, status_code: 200, metadata: { result_count: 1 } })
    expect(log).not.toHaveBeenCalled()
    for (const read of f.reads.filter(read => read.table === 'contract_publication_revisions')) expect(read.predicates).toMatchObject({ company_id: companyId, channel })
  })

  it.each([{ code: 'api_scope_missing', status: 403, tenant: 'active' }, { code: 'tenant_paused', status: 423, tenant: 'paused' }])('denies current $code before all publication readers/mappers and logging', async ({ code, status, tenant }) => {
    feed(channel, true); f.allowed = false; f.authCode = code; f.tenantStatus = tenant
    const response = await get(request(path))
    expect(response.status).toBe(status); expect(f.context).not.toHaveBeenCalled(); expect(f.list).not.toHaveBeenCalled()
    expect(f.rpc).toHaveBeenCalledOnce(); expect(log).not.toHaveBeenCalled()
    expect(f.reads.every(read => read.table === 'integration_api_requests')).toBe(true)
  })

  it('rejects missing credentials before Auth RPC or tenant reads/writes', async () => {
    feed(channel, true); f.hasToken = false
    const response = await get(request(path))
    expect(response.status).toBe(401); expect(f.rpc).not.toHaveBeenCalled(); expect(f.context).not.toHaveBeenCalled(); expect(f.list).not.toHaveBeenCalled()
    expect(f.reads).toEqual([]); expect(f.telemetry).toEqual([]); expect(log).not.toHaveBeenCalled()
  })
})
