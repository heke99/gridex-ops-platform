// ops-api-review: F3
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/staff-api/context', () => ({ requireStaffApiContext: vi.fn() }))
vi.mock('@/lib/integrations/apiAuth', () => ({ currentIntegrationApiResponseContext: vi.fn(() => null), logIntegrationApiRequest: vi.fn() }))

import { ApiInputError } from '@/lib/api/strictRequest'
import { logIntegrationApiRequest } from '@/lib/integrations/apiAuth'
import { requireStaffApiContext } from '@/lib/staff-api/context'
import { staffApiJson, withStaffApi } from '@/lib/staff-api/http'

const context = { companyId: '11111111-1111-4111-8111-111111111111', actorUserId: '22222222-2222-4222-8222-222222222222', apiClientId: '33333333-3333-4333-8333-333333333333', permissions: ['customers.read'], client: { id: 'client' } as never, startedAt: Date.now() }
const options = { scopes: ['staff_customers.read'], permission: 'customers.read' } as never
const request = (headers: Record<string, string> = {}) => new NextRequest('https://app.gridex.se/api/v1/staff/customers', { headers })
const logged = () => vi.mocked(logIntegrationApiRequest).mock.calls[0][0] as { requestId?: string; metadata?: Record<string, unknown> }

beforeEach(() => { vi.clearAllMocks(); vi.mocked(requireStaffApiContext).mockResolvedValue(context as never) })

describe('staff request-id correlation', () => {
  it.each([
    ['missing incoming id', {}],
    ['valid incoming id', { 'x-request-id': 'synthetic-audit-request-123' }],
    ['invalid incoming id', { 'x-request-id': 'bad id with <script>'.repeat(20) }],
  ])('success with %s: body, header and log share one server id', async (_label, headers) => {
    const response = await withStaffApi(request(headers), options, async () => staffApiJson({ data: [] }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(response.headers.get('x-request-id')).toBe(body.request_id)
    expect(logged().requestId).toBe(body.request_id)
  })

  it('keeps a valid client correlation id separate from the server id', async () => {
    const response = await withStaffApi(request({ 'x-request-id': 'synthetic-audit-request-123' }), options, async () => staffApiJson({ data: [] }))
    const body = await response.json()
    expect(body.request_id).not.toBe('synthetic-audit-request-123')
    expect(logged().metadata?.client_request_id).toBe('synthetic-audit-request-123')
  })

  it('drops an invalid client correlation id instead of logging it', async () => {
    await withStaffApi(request({ 'x-request-id': 'bad id <x>' }), options, async () => staffApiJson({ data: [] }))
    expect(logged().metadata).not.toHaveProperty('client_request_id')
  })

  it.each([
    ['handler ApiInputError', async (): Promise<Response> => { throw new ApiInputError('nope', 'invalid_field', 422) }],
    ['unexpected handler error', async (): Promise<Response> => { throw new Error('boom') }],
  ])('error response (%s) carries the same id in body, header and log', async (_label, handler) => {
    const response = await withStaffApi(request(), options, handler)
    const body = await response.json()
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.headers.get('x-request-id')).toBe(body.request_id)
    expect(logged().requestId).toBe(body.request_id)
  })

  it('auth failure response and log share one id', async () => {
    vi.mocked(requireStaffApiContext).mockRejectedValue(new ApiInputError('denied', 'staff_permission_denied', 403))
    const response = await withStaffApi(request(), options, async () => staffApiJson({ data: [] }))
    const body = await response.json()
    expect(response.status).toBe(403)
    expect(logged().requestId).toBe(body.request_id)
    expect(response.headers.get('x-request-id')).toBe(body.request_id)
  })

  it('never passes assertions, tokens or bodies into log metadata', async () => {
    await withStaffApi(request({ authorization: 'Bearer secret-token', 'x-gridex-staff-assertion': 'secret.jwt.value' }), options, async () => staffApiJson({ data: [] }))
    const serialized = JSON.stringify({ requestId: logged().requestId, metadata: logged().metadata })
    expect(serialized).not.toContain('secret')
  })
})
