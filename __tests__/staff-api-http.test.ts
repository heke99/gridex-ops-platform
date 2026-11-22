import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/staff-api/context', () => ({ requireStaffApiContext: vi.fn() }))
vi.mock('@/lib/integrations/apiAuth', () => ({ currentIntegrationApiResponseContext: vi.fn(() => null), logIntegrationApiRequest: vi.fn() }))
import { assertStaffResponsePayload, staffApiJson, staffApiError, withStaffApi } from '@/lib/staff-api/http'
import { ApiInputError, IdempotentWriteCompletionUncertainError } from '@/lib/api/strictRequest'
import { logIntegrationApiRequest } from '@/lib/integrations/apiAuth'
import { requireStaffApiContext, type StaffApiContext } from '@/lib/staff-api/context'
describe('staff DTO safety and envelopes', () => {
  it('allows only explicit staff identity fields', async () => {
    const response = staffApiJson({ data: { user_id: '22222222-2222-4222-8222-222222222222', assignee_user_id: null } })
    expect((await response.json()).data.user_id).toBe('22222222-2222-4222-8222-222222222222')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Request-ID')).toBeTruthy()
  })
  it.each(['id', 'customer_id', 'company_id', 'api_client_id', 'storage_path', 'actor_user_id'])('rejects internal %s recursively', key => {
    expect(() => assertStaffResponsePayload({ data: [{ nested: { [key]: '22222222-2222-4222-8222-222222222222' } }] })).toThrow()
  })
  it('preserves explicit error code/status without leaking database diagnostics', async () => {
    const denied = staffApiError(new ApiInputError('Permission denied.', 'staff_permission_denied', 403))
    expect(denied.status).toBe(403)
    expect((await denied.json()).error.code).toBe('staff_permission_denied')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failed = await staffApiError({ code: '23505', message: 'private-db-data' }).json()
    expect(JSON.stringify(failed)).not.toContain('private-db-data')
    spy.mockRestore()
  })

  it('marks uncertain completion retryable with the same-key instruction and server-issued correlation', async () => {
    const context: StaffApiContext = {
      companyId: 'synthetic-company',
      actorUserId: 'synthetic-actor',
      apiClientId: 'synthetic-staff-client',
      permissions: ['customers.write'],
      client: {
        id: 'synthetic-staff-client',
        company_id: 'synthetic-company',
        name: 'Synthetic Staff API client',
        status: 'active',
        key_prefix: 'synthetic',
        secret_hash: 'unused-in-test',
        scopes: ['staff_customers.write'],
        allowed_ips: [],
        rate_limit_per_minute: 60,
        expires_at: null,
      },
      startedAt: Date.now(),
    }
    vi.mocked(requireStaffApiContext).mockResolvedValueOnce(context)
    const request = new NextRequest('https://synthetic.invalid/api/v1/staff/customers/customer_synthetic/contact', {
      method: 'PATCH',
      headers: { 'Idempotency-Key': 'synthetic-staff-write', 'X-Request-ID': 'synthetic-client-request' },
    })
    const requirements = { scopes: ['staff_customers.write'], permission: 'customers.write' }
    const handler = vi.fn(async () => { throw new IdempotentWriteCompletionUncertainError() })

    const response = await withStaffApi(request, requirements, handler)
    const body = await response.json()
    expect(requireStaffApiContext).toHaveBeenCalledWith(request, requirements)
    expect(handler).toHaveBeenCalledWith(context)
    expect(response.status).toBe(503)
    expect(body.error).toMatchObject({ code: 'idempotency_completion_uncertain', retryable: true })
    expect(body.error.message).toContain('samma Idempotency-Key')
    expect(body.request_id).not.toBe('synthetic-client-request')
    expect(body.correlation_id).toBe(body.request_id)
    expect(response.headers.get('X-Request-ID')).toBe(body.request_id)
    expect(logIntegrationApiRequest).toHaveBeenLastCalledWith(expect.objectContaining({
      client: context.client,
      statusCode: 503,
      errorCode: 'idempotency_completion_uncertain',
      requestId: body.request_id,
      metadata: expect.objectContaining({
        actor_user_id: context.actorUserId,
        client_request_id: 'synthetic-client-request',
      }),
    }))
  })

  it.each([
    [503, 'staff_service_unavailable'],
    [503, 'idempotency_completion_uncertain'],
    [409, 'idempotency_reconciliation_required'],
    [401, 'staff_assertion_replayed'],
    [403, 'staff_permission_denied'],
  ])('keeps an ordinary %i %s error non-retryable', async (status, code) => {
    const response = staffApiError(new ApiInputError('Synthetic Staff API error.', code, status))
    expect(response.status).toBe(status)
    expect((await response.json()).error).toMatchObject({ code, retryable: false })
  })
})
