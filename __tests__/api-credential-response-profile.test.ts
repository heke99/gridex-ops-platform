import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requireStaffApiContext } from '@/lib/staff-api/context'
import { staffApiJson, withStaffApi } from '@/lib/staff-api/http'
import { bindAuthenticatedApiResponseProfile, withApiContractRepresentation } from '@/lib/integrations/apiResponseProfile'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'

vi.mock('@/lib/staff-api/context', () => ({ requireStaffApiContext: vi.fn() }))
vi.mock('@/lib/integrations/apiAuth', () => ({ currentIntegrationApiResponseContext: () => null, logIntegrationApiRequest: vi.fn() }))

const access = { scopes: ['staff_users.read'], permission: 'users.read' } as const
const uuid = '11111111-1111-4111-8111-111111111111'
function context(revision?: string) {
  return { companyId: uuid, actorUserId: uuid, apiClientId: uuid, permissions: ['users.read'], startedAt: Date.now(),
    client: { id: uuid, company_id: uuid, metadata: revision ? { api_contract_profiles: { staff: revision } } : {} } }
}
const request = (headers: Record<string, string> = {}) => new NextRequest('https://app.gridex.se/api/v1/staff/roles', { headers })
const response = async () => staffApiJson({ data: [] })

beforeEach(() => { vi.clearAllMocks() })

describe('server-owned credential response profile', () => {
  it('rewrites declared wire markers while preserving arbitrary business evidence', async () => {
    const handler = withApiContractRepresentation('customer', async () => {
      bindAuthenticatedApiResponseProfile({ ...context().client, metadata: { api_contract_profiles: { customer: '2026-10-04.1' } } } as never)
      return customerPortalJson({ data: [{ event_id: `event_${'a'.repeat(32)}`, event_type: 'synthetic.event', created_at: '2026-10-12T12:00:00Z', organization_reference: 'organization_0123456789abcdefghijkl', environment: 'production', aggregate: { type: 'system', reference: 'event_synthetic' }, data: { contract_schema_version: 'gridex_legal_evidence_v1' }, contract_schema_version: '2026-10-09.1' }] })
    })
    const result = await handler(new NextRequest('https://app.gridex.se/api/v1/events'))
    const body = await result.json()
    expect(body.contract_schema_version).toBe('2026-10-04.1')
    expect(body.data[0].contract_schema_version).toBe('2026-10-04.1')
    expect(body.data[0].data.contract_schema_version).toBe('gridex_legal_evidence_v1')
  })

  it.each(['2026-10-04.1', '2099-01-01.1'])('preserves an identified credential denial while formatting usable pins (%s)', async revision => {
    const handler = withApiContractRepresentation('staff', async () => {
      bindAuthenticatedApiResponseProfile(context(revision).client as never, { strict: false })
      return staffApiJson({ error: { code: 'api_scope_missing', message: 'Denied.' } }, 403)
    })
    const result = await handler(request())
    expect(result.status).toBe(403)
    expect((await result.json()).contract_schema_version).toBe(revision === '2026-10-04.1' ? revision : '2026-10-09.1')
  })
  it('returns the supported older Staff representation without requiring a tenant version header', async () => {
    vi.mocked(requireStaffApiContext).mockResolvedValue(context('2026-10-04.1') as never)
    const result = await withStaffApi(request(), access, response)
    expect(result.status).toBe(200)
    expect(result.headers.get('x-gridex-contract-version')).toBe('2026-10-04.1')
    expect((await result.json()).contract_schema_version).toBe('2026-10-04.1')
  })

  it('keeps the stable current wire revision when only a browser/request hint is supplied', async () => {
    vi.mocked(requireStaffApiContext).mockResolvedValue(context() as never)
    const result = await withStaffApi(request({ 'x-gridex-contract-version': '2099-01-01.1', 'x-gridex-client-revision': '2026-10-04.1' }), access, response)
    expect(result.status).toBe(200)
    expect((await result.json()).contract_schema_version).toBe('2026-10-09.1')
  })

  it('isolates profiles between simultaneous credentials', async () => {
    vi.mocked(requireStaffApiContext).mockImplementation(async req => context(req.headers.get('x-test-credential') === 'old' ? '2026-10-04.1' : undefined) as never)
    const [old, current] = await Promise.all([
      withStaffApi(request({ 'x-test-credential': 'old' }), access, async () => { await Promise.resolve(); return response() }),
      withStaffApi(request(), access, response),
    ])
    expect((await old.json()).contract_schema_version).toBe('2026-10-04.1')
    expect((await current.json()).contract_schema_version).toBe('2026-10-09.1')
  })

  it('does not execute a handler for an unsupported operator-configured profile', async () => {
    vi.mocked(requireStaffApiContext).mockResolvedValue(context('2099-01-01.1') as never)
    const handler = vi.fn(response)
    const result = await withStaffApi(request(), access, handler)
    expect(result.status).toBe(503)
    expect(handler).not.toHaveBeenCalled()
  })

  it.each([null, [], '2026-10-04.1'])('rejects a malformed operator profile map %j before business execution', async malformed => {
    const identity = context()
    identity.client.metadata = { api_contract_profiles: malformed } as never
    vi.mocked(requireStaffApiContext).mockResolvedValue(identity as never)
    const handler = vi.fn(response)
    const result = await withStaffApi(request(), access, handler)
    expect(result.status).toBe(503)
    expect(handler).not.toHaveBeenCalled()
  })
})
