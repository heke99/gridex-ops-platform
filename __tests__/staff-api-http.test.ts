import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/staff-api/context', () => ({ requireStaffApiContext: vi.fn() }))
vi.mock('@/lib/integrations/apiAuth', () => ({ currentIntegrationApiResponseContext: vi.fn(() => null), logIntegrationApiRequest: vi.fn() }))
import { assertStaffResponsePayload, staffApiJson, staffApiError } from '@/lib/staff-api/http'
import { ApiInputError } from '@/lib/api/strictRequest'
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
})
