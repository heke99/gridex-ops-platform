// ops-api-review: F16, F17
// Real public-contracts GET route: the cheap fingerprint ETag must be bound to
// tenant, customer type, channel, selected profile and representation revision
// (F16), and If-None-Match must follow RFC 9110 GET semantics after auth (F17).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import publicContractsFixture from '@/docs/fixtures/public-contracts-response-2026-08-04.3.json'

const TENANT_A = '00000000-0000-4000-8000-000000000021'
const TENANT_B = '00000000-0000-4000-8000-000000000031'

const mocks = vi.hoisted(() => ({
  schemaVersion: '2026-10-04.1',
  representationRevision: '2026-10-09.1',
  profileRevision: '2026-10-04.1',
  companyId: '00000000-0000-4000-8000-000000000021',
  authOk: true,
  logIntegrationApiRequest: vi.fn(async () => undefined),
  scheduleUsageEvent: vi.fn(async () => undefined),
  listPublicContractOffers: vi.fn(),
  diagnosePublicContractOffers: vi.fn(),
  publicContractResponse: vi.fn(),
  loadPublicationRevision: vi.fn(),
  loadExternalTenantContext: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: mocks.rpc } }))

vi.mock('@/lib/integrations/apiAuth', () => ({
  currentIntegrationApiResponseContext: () => null,
  logIntegrationApiRequest: mocks.logIntegrationApiRequest,
  requireIntegrationApiAccess: vi.fn(async () => mocks.authOk
    ? {
        ok: true,
        client: { id: '00000000-0000-4000-8000-000000000020', company_id: mocks.companyId, scopes: ['website_contracts.read'] },
        context: {
          companyId: mocks.companyId,
          actorType: 'integration',
          actorId: '00000000-0000-4000-8000-000000000020',
          permissions: [],
          scopes: ['website_contracts.read'],
          correlationId: '00000000-0000-4000-8000-000000000022',
          sourceChannel: 'partner_api',
        },
        rateLimit: { limit: 100, remaining: 99, resetAt: null },
      }
    : { ok: false, status: 401, errorCode: 'unauthorized', error: 'Unauthorized', client: null }),
}))

vi.mock('@/lib/integrations/tenantContext', () => ({
  loadExternalTenantContext: mocks.loadExternalTenantContext,
  ExternalTenantContextError: class ExternalTenantContextError extends Error {},
}))

vi.mock('@/lib/audit/actionLogger', () => ({ scheduleUsageEvent: mocks.scheduleUsageEvent }))

vi.mock('@/lib/website/publicContracts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/website/publicContracts')>()
  return {
    ...actual,
    listPublicContractOffers: mocks.listPublicContractOffers,
    diagnosePublicContractOffers: mocks.diagnosePublicContractOffers,
    publicContractResponse: mocks.publicContractResponse,
  }
})

vi.mock('@/lib/website/publicContractApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/website/publicContractApi')>()
  return {
    ...actual,
    get PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION() { return mocks.schemaVersion },
    get PUBLIC_CONTRACT_REPRESENTATION_REVISION() { return mocks.representationRevision },
    selectPublicContractProfile: () => ({
      surface: 'website', major: 'v1', revision: mocks.profileRevision, status: 'supported', capabilities: ['contracts.read'],
    }),
    loadPublicationRevision: mocks.loadPublicationRevision,
    requestId: () => publicContractsFixture.request_id,
  }
})

import { GET } from '@/app/api/v1/website/public-contracts/route'
import { parseIfNoneMatch } from '@/lib/website/publicContractApi'

const SAME_DB_FINGERPRINT = 'a'.repeat(32)

function get(headers: Record<string, string> = {}, customerType = 'private') {
  return GET(new NextRequest(
    `https://app.gridex.se/api/v1/website/public-contracts?customer_type=${customerType}`,
    { headers: { Authorization: 'Bearer test-only-token', ...headers } },
  ))
}

async function currentEtag(customerType = 'private'): Promise<string> {
  const response = await get({}, customerType)
  expect(response.status).toBe(200)
  const etag = response.headers.get('etag')
  expect(etag).toMatch(/^"pcf-[a-f0-9]{32}"$/)
  return etag!
}

function loadersCalled() {
  return mocks.loadPublicationRevision.mock.calls.length
    + mocks.loadExternalTenantContext.mock.calls.length
    + mocks.listPublicContractOffers.mock.calls.length
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.schemaVersion = '2026-10-04.1'
  mocks.representationRevision = '2026-10-09.1'
  mocks.profileRevision = '2026-10-04.1'
  mocks.companyId = TENANT_A
  mocks.authOk = true
  // The database fingerprint is identical for every scope on purpose: the
  // route itself must separate tenant/customer type/profile/representation.
  mocks.rpc.mockResolvedValue({ data: [{ fingerprint: SAME_DB_FINGERPRINT }], error: null })
  mocks.listPublicContractOffers.mockResolvedValue([{}])
  mocks.diagnosePublicContractOffers.mockResolvedValue(null)
  mocks.publicContractResponse.mockReturnValue(publicContractsFixture.data[0])
  mocks.loadPublicationRevision.mockResolvedValue({
    etag: '"contracts-test"',
    revision: publicContractsFixture.meta.publication_revision,
    token: 't',
    updatedAt: publicContractsFixture.meta.publication_updated_at,
  })
  mocks.loadExternalTenantContext.mockResolvedValue({ tenant_reference: publicContractsFixture.meta.tenant_reference })
})

describe('F17: RFC 9110 If-None-Match on GET', () => {
  it('strong match returns 304 without loading the feed', async () => {
    const etag = await currentEtag()
    vi.clearAllMocks()
    const response = await get({ 'if-none-match': etag })
    expect(response.status).toBe(304)
    expect(response.headers.get('etag')).toBe(etag)
    expect(loadersCalled()).toBe(0)
  })

  it('weak comparison: W/ prefix of the same opaque tag returns 304', async () => {
    const etag = await currentEtag()
    vi.clearAllMocks()
    const response = await get({ 'if-none-match': `W/${etag}` })
    expect(response.status).toBe(304)
    expect(loadersCalled()).toBe(0)
  })

  it('wildcard matches an existing representation', async () => {
    const response = await get({ 'if-none-match': '*' })
    expect(response.status).toBe(304)
    expect(loadersCalled()).toBe(0)
  })

  it('comma-separated list matches any member and misses when none match', async () => {
    const etag = await currentEtag()
    expect((await get({ 'if-none-match': `"other" ,W/"x",  ${etag}` })).status).toBe(304)
    expect((await get({ 'if-none-match': '"other", W/"pcf-unknown"' })).status).toBe(200)
  })

  it('is evaluated only after authentication', async () => {
    mocks.authOk = false
    const response = await get({ 'if-none-match': '*' })
    expect(response.status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('parser ignores malformed members and recognises the wildcard', () => {
    expect(parseIfNoneMatch(null)).toEqual([])
    expect(parseIfNoneMatch(' * ')).toBe('*')
    expect(parseIfNoneMatch('W/"a", "b"')).toEqual(['W/"a"', '"b"'])
    expect(parseIfNoneMatch('unquoted')).toEqual([])
  })

  it('marks the representation as credential-specific and non-storable', async () => {
    const response = await get()
    expect(response.headers.get('vary')).toMatch(/Authorization/)
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0')
  })
})

describe('F16: representation-safe cheap ETag', () => {
  it('another tenant with the same DB fingerprint never gets 304', async () => {
    const tenantAEtag = await currentEtag()
    mocks.companyId = TENANT_B
    const response = await get({ 'if-none-match': tenantAEtag })
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).not.toBe(tenantAEtag)
  })

  it('another customer type never shares the ETag', async () => {
    const privateEtag = await currentEtag('private')
    expect((await get({ 'if-none-match': privateEtag }, 'business')).status).toBe(200)
  })

  it('schema version change with the same DB publication does not replay an old body', async () => {
    const before = await currentEtag()
    mocks.schemaVersion = '2026-11-01.1'
    const response = await get({ 'if-none-match': before })
    expect(response.status).toBe(200)
    expect((await response.json()).meta.contract_schema_version).toBe('2026-11-01.1')
  })

  it('representation revision change invalidates the cheap ETag', async () => {
    const before = await currentEtag()
    mocks.representationRevision = '2026-10-10.1'
    expect((await get({ 'if-none-match': before })).status).toBe(200)
  })

  it('selected profile change invalidates the cheap ETag', async () => {
    const before = await currentEtag()
    mocks.profileRevision = '2026-10-02.3'
    expect((await get({ 'if-none-match': before })).status).toBe(200)
  })

  it('unchanged scope and representation keeps a valid 304', async () => {
    const before = await currentEtag()
    expect(await currentEtag()).toBe(before)
    expect((await get({ 'if-none-match': before })).status).toBe(304)
  })
})
