import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ ctx: { companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actorUserId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', apiClientId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', permissions: ['users.write', 'users.read'] }, write: vi.fn(), invite: vi.fn(), disable: vi.fn(), enable: vi.fn(), list: vi.fn(), change: vi.fn() }))
vi.mock('@/lib/staff-api/http', () => ({ withStaffApi: async (_request: unknown, _options: unknown, handler: (ctx: unknown) => Promise<Response>) => handler(mocks.ctx), staffApiJson: (body: unknown, init: number | ResponseInit = 200) => Response.json(body, typeof init === 'number' ? { status: init } : init) }))
vi.mock('@/lib/tenant/staffCommands', () => ({ inviteStaff: mocks.invite, disableStaff: mocks.disable, reactivateStaff: mocks.enable, listStaff: mocks.list, changeStaffRole: mocks.change, listStaffRoles: vi.fn() }))
vi.mock('@/lib/api/strictRequest', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api/strictRequest')>()
  return { ...actual, executeIdempotentPortalWrite: mocks.write }
})
import { disableStaffUser, enableStaffUser, postStaffUser, getStaffUsers } from '@/lib/staff-api/userHandlers'

function request(path: string, body: unknown, method = 'POST') {
  return new NextRequest(`https://example.invalid/api/v1/staff/${path}`, { method, headers: { 'content-type': 'application/json', 'idempotency-key': 'client-key-one' }, body: JSON.stringify(body) })
}
const target = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.write.mockImplementation(async input => ({ ...(await input.execute()), replayed: false }))
  mocks.invite.mockResolvedValue({ email: 'staff@example.invalid', role_key: 'customer_service_agent', membership_role: 'support', status: 'pending' })
  mocks.disable.mockResolvedValue({ user_id: target, role_key: 'customer_service_agent', membership_role: 'support', status: 'disabled' })
  mocks.enable.mockResolvedValue({ user_id: target, role_key: 'customer_service_agent', membership_role: 'support', status: 'active' })
})

describe('staff user route request boundaries', () => {
  it('binds idempotency payload and durable command namespace to the verified actor', async () => {
    const response = await postStaffUser(request('users', { email: 'staff@example.invalid', role_key: 'customer_service_agent' }))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ data: { email: 'staff@example.invalid', role_key: 'customer_service_agent', membership_role: 'support', status: 'pending' } })
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ companyId: mocks.ctx.companyId, clientId: mocks.ctx.apiClientId, customerId: null, payload: { actor_user_id: mocks.ctx.actorUserId, data: { email: 'staff@example.invalid', role_key: 'customer_service_agent' } } }))
    const firstKey = mocks.invite.mock.calls[0][1].idempotencyKey
    const oldActor = mocks.ctx.actorUserId
    mocks.ctx.actorUserId = target
    await postStaffUser(request('users', { email: 'staff@example.invalid', role_key: 'customer_service_agent' }))
    expect(mocks.invite.mock.calls[1][1].idempotencyKey).not.toEqual(firstKey)
    mocks.ctx.actorUserId = oldActor
  })
  it('rejects client-supplied actor identity instead of letting it override authenticated staff', async () => {
    await expect(postStaffUser(request('users', { email: 'staff@example.invalid', role_key: 'customer_service_agent', actor_user_id: target }))).rejects.toMatchObject({ code: 'invalid_request', status: 422 })
    expect(mocks.invite).not.toHaveBeenCalled()
  })
  it('uses native enable restore instead of accepting a role in the enable body', async () => {
    await expect(enableStaffUser(request(`users/${target}/enable`, { role_key: 'company_admin' }), { params: Promise.resolve({ id: target }) })).rejects.toMatchObject({ code: 'invalid_request' })
    const response = await enableStaffUser(request(`users/${target}/enable`, {}), { params: Promise.resolve({ id: target }) })
    expect((await response.json()).data.status).toBe('active')
    expect(mocks.enable.mock.calls[0][1]).not.toHaveProperty('roleKey')
  })
  it('requires idempotency before attempting a disable write', async () => {
    const noKey = request(`users/${target}/disable`, {})
    noKey.headers.delete('idempotency-key')
    await expect(disableStaffUser(noKey, { params: Promise.resolve({ id: target }) })).rejects.toMatchObject({ code: 'idempotency_key_required', status: 400 })
    expect(mocks.disable).not.toHaveBeenCalled()
  })
  it('bounds list pagination and rejects unknown company query filters', async () => {
    await expect(getStaffUsers(new NextRequest('https://example.invalid/api/v1/staff/users?page_size=101'))).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(getStaffUsers(new NextRequest('https://example.invalid/api/v1/staff/users?company_id=foreign'))).rejects.toMatchObject({ code: 'invalid_request' })
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
