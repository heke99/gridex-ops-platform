// FINDINGS F43: a transient PostgREST/gateway failure reached the website as
// 500 website_application_failed with retryable:false, and a gateway 502 on public-contracts as a 500,
// although nothing was decided and a retry with the same Idempotency-Key is safe.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ readinessError: null as unknown }))
vi.mock('@/lib/integrations/apiResponseProfile', () => ({ withApiContractRepresentation: (_surface: unknown, handler: unknown) => handler }))
vi.mock('@/lib/integrations/apiAuth', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/integrations/apiAuth')>()),
  requireIntegrationApiAccess: async () => ({ ok: true, client: { id: 'client-1', company_id: 'company-1', scopes: [] }, context: { companyId: 'company-1', correlationId: 'corr-1' } }),
  logIntegrationApiRequest: async () => undefined,
}))
vi.mock('@/lib/integrations/tenantWebsiteReadiness', () => ({ loadTenantWebsiteFlowReadiness: async () => { throw state.readinessError } }))
vi.mock('@/lib/website/customerApplications', () => ({ processWebsiteCustomerApplication: async () => { throw Error('not reached') } }))
vi.mock('@/lib/audit/actionLogger', () => ({ scheduleUsageEvent: async () => undefined }))

import { isTransientSupabaseError } from '@/lib/supabase/transientErrors'
import { classifyPublicContractsError } from '@/lib/integrations/publicApiErrors'
import { POST } from '@/app/api/v1/website/customer-applications/route'

// The three shapes supabase-js produces for a failed transport (postgrest-js 2.x).
const gateway502 = { message: 'An invalid response was received from the upstream server' }
const socketClosed = { message: 'TypeError: fetch failed', details: 'TypeError: fetch failed\n\nCaused by: SocketError: other side closed (UND_ERR_SOCKET)', hint: '', code: '' }
const adminShutdown = { code: '57P01', message: 'terminating connection due to administrator command' }

describe('isTransientSupabaseError', () => {
  it.each([['gateway 502 body', gateway502], ['socket closed', socketClosed], ['admin shutdown', adminShutdown],
    ['connection failure', { code: '08006', message: 'connection failure' }], ['PostgREST pool', { code: 'PGRST003', message: 'Timed out acquiring connection from connection pool.' }],
    ['status 504', { status: 504, message: 'Gateway Timeout' }]])('%s is transient', (_case, error) => {
    expect(isTransientSupabaseError(error)).toBe(true)
  })

  it.each([['check violation', { code: '23514', message: 'violates check constraint' }], ['permission', { code: '42501', message: 'permission denied' }],
    ['not found', { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }], ['business error', new Error('website_offer_unavailable')],
    ['statement timeout', { code: '57014', message: 'canceling statement due to statement timeout' }], ['nothing', null]])('%s is not transient', (_case, error) => {
    expect(isTransientSupabaseError(error)).toBe(false)
  })
})

describe('public-contracts classification', () => {
  it('a gateway 502 is a retryable 503, not a 500', () => {
    expect(classifyPublicContractsError(gateway502)).toMatchObject({ status: 503, code: 'PUBLIC_CONTRACTS_TEMPORARILY_UNAVAILABLE' })
  })
  it('an unknown error stays a 500', () => {
    expect(classifyPublicContractsError(new Error('unexpected'))).toMatchObject({ status: 500 })
  })
})

describe('POST /api/v1/website/customer-applications', () => {
  const request = () => new Request('http://local/api/v1/website/customer-applications', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'reality-retry-1', authorization: 'Bearer test' }, body: '{}',
  }) as never
  beforeEach(() => { state.readinessError = null })

  it('answers 503 retryable with Retry-After when the database does not answer reliably', async () => {
    state.readinessError = gateway502
    const response = await POST(request())
    const body = await response.json()
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('2')
    expect(body.error).toMatchObject({ code: 'website_application_failed', retryable: true, stage: 'dependency_unavailable' })
  })

  it('still answers 500 non-retryable for an unknown failure', async () => {
    state.readinessError = new Error('unexpected')
    const response = await POST(request())
    expect(response.status).toBe(500)
    expect((await response.json()).error).toMatchObject({ code: 'website_application_failed', retryable: false, stage: 'internal_error' })
  })
})
