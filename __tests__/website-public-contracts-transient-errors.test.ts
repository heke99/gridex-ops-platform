import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ExternalTenantContextError } from '@/lib/integrations/tenantContext'
import { PUBLIC_CONTRACT_ERROR_CODES, PublicContractSerializationError } from '@/lib/external-contracts/publicContractModel'
import { buildPublicContractFeedEtag, PUBLIC_CONTRACT_REPRESENTATION_REVISION, PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION, selectPublicContractProfile } from '@/lib/website/publicContractApi'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: null as unknown, error: null as unknown })),
  auth: vi.fn(),
  log: vi.fn(async () => undefined),
  usage: vi.fn(async () => undefined),
  offers: vi.fn(),
  diagnostics: vi.fn(),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: mocks.rpc } }))
vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: mocks.auth,
  logIntegrationApiRequest: mocks.log,
  currentIntegrationApiResponseContext: () => null,
}))
vi.mock('@/lib/audit/actionLogger', () => ({ scheduleUsageEvent: mocks.usage }))
vi.mock('@/lib/website/publicContracts', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/website/publicContracts')>(),
  listPublicContractOffers: mocks.offers,
  diagnosePublicContractOffers: mocks.diagnostics,
}))

import { GET } from '@/app/api/v1/website/public-contracts/route'

const client = { id: '00000000-0000-4000-8000-000000000020', company_id: '00000000-0000-4000-8000-000000000021', scopes: ['website_contracts.read'] }
const transientCases: [string, unknown][] = [
  ['lost Kong 502', { message: 'An invalid response was received from the upstream server' }],
  ['Kong timeout', { message: 'upstream server is timing out' }],
  ['socket details', { message: 'TypeError: fetch failed', details: 'other side closed (UND_ERR_SOCKET)' }],
  ['nested transport cause', { cause: { code: 'UND_ERR_SOCKET', message: 'other side closed' } }],
  ...['57P01', '57P03', '53300', '08006', 'PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'].map(code => [code, { code }] as [string, unknown]),
  ...[502, 503, 504].map(status => [`upstream ${status}`, { status }] as [string, unknown]),
  ['statement timeout', { code: '57014', message: 'canceling statement due to statement timeout' }],
  ['lock unavailable', { code: '55P03', message: 'lock not available' }],
]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rpc.mockResolvedValue({ data: null, error: null })
  mocks.auth.mockResolvedValue({
    ok: true, client,
    context: { companyId: client.company_id, correlationId: '00000000-0000-4000-8000-000000000022' },
    rateLimit: { limit: 100, remaining: 99, resetAt: null },
  })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => vi.restoreAllMocks())

async function rejectCatalogue(error: unknown, status: number, code: string, retryable: boolean) {
  mocks.rpc.mockResolvedValueOnce({ data: null, error })
  const response = await GET(new NextRequest('https://unit.test/api/v1/website/public-contracts'))
  const body = await response.json()
  expect(response.status).toBe(status)
  expect(body.error.code).toBe(code)
  expect(body.error.retryable).toBe(retryable)
  expect(response.headers.get('Retry-After')).toBe(retryable ? '2' : null)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('X-Request-ID')).toBeTruthy()
  expect(response.headers.get('X-Gridex-Contract-Version')).toBe(PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION)
  expect(body.contract_schema_version).toBe(PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION)
  expect(mocks.rpc).toHaveBeenCalledTimes(1)
  expect(mocks.offers).not.toHaveBeenCalled()
  expect(mocks.usage).not.toHaveBeenCalled()
  expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ statusCode: status }))
  return body
}

describe('catalogue transient upstream failures through the real GET response', () => {
  it.each(transientCases)('%s returns documented retryable 503 without retrying or returning partial offers', async (_label, error) => {
    const body = await rejectCatalogue(error, 503, 'PUBLIC_CONTRACTS_TEMPORARILY_UNAVAILABLE', true)
    expect(JSON.stringify(body)).not.toContain('invalid response was received')
  })

  it('keeps unknown exceptions as nonretryable 500', async () => {
    await rejectCatalogue(new Error('synthetic unknown failure'), 500, 'PUBLIC_CONTRACTS_TEMPORARILY_UNAVAILABLE', false)
  })

  it.each(['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'])('preserves schema failure %s', async code => {
    await rejectCatalogue({ code, message: 'schema mismatch' }, 503, 'PUBLIC_CONTRACT_SCHEMA_OUTDATED', false)
  })

  it('preserves publication constraints instead of treating them as transport failures', async () => {
    await rejectCatalogue({ code: '23514', message: 'publication graph incomplete' }, 409, 'PUBLICATION_GRAPH_INCOMPLETE', false)
  })

  it.each(Object.values(PUBLIC_CONTRACT_ERROR_CODES))('preserves legal/serialization failure %s', async code => {
    const status = code === PUBLIC_CONTRACT_ERROR_CODES.contractVersionMismatch || code === PUBLIC_CONTRACT_ERROR_CODES.openApiChecksumMismatch ? 503 : 409
    await rejectCatalogue(new PublicContractSerializationError(code, 'synthetic.path'), status, code, false)
  })

  it('preserves typed tenant authorization failure', async () => {
    await rejectCatalogue(new ExternalTenantContextError({ status: 403, code: 'ORGANIZATION_NOT_OPERATIONALLY_READY', message: 'synthetic denial' }), 403, 'ORGANIZATION_NOT_OPERATIONALLY_READY', false)
  })

  it.each([401, 403])('rejects auth %s before reading catalogue data', async status => {
    mocks.auth.mockResolvedValueOnce({ ok: false, status, errorCode: 'authorization_denied', error: 'Synthetic denial', client: null })
    const response = await GET(new NextRequest('https://unit.test/api/v1/website/public-contracts'))
    expect(response.status).toBe(status)
    expect(response.headers.get('Retry-After')).toBeNull()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.offers).not.toHaveBeenCalled()
  })

  it('rejects unknown query parameters before auth or database work', async () => {
    const response = await GET(new NextRequest('https://unit.test/api/v1/website/public-contracts?unsupported=true'))
    expect(response.status).toBe(400)
    expect(mocks.auth).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('preserves successful bodyless conditional 304 without loading offers', async () => {
    const fingerprint = 'a'.repeat(32)
    mocks.rpc.mockResolvedValueOnce({ data: [{ fingerprint }], error: null })
    const etag = buildPublicContractFeedEtag({ companyId: client.company_id, customerType: null, channel: 'website', dbFingerprint: fingerprint, profile: selectPublicContractProfile(), contractSchemaVersion: PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION, representationRevision: PUBLIC_CONTRACT_REPRESENTATION_REVISION })
    const response = await GET(new NextRequest('https://unit.test/api/v1/website/public-contracts', { headers: { 'If-None-Match': etag } }))
    expect(response.status).toBe(304)
    expect(await response.text()).toBe('')
    expect(response.headers.get('ETag')).toBe(etag)
    expect(response.headers.get('Retry-After')).toBeNull()
    expect(mocks.offers).not.toHaveBeenCalled()
    expect(mocks.usage).not.toHaveBeenCalled()
  })
})
