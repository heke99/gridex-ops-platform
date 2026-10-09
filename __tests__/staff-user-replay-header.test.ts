// ops-api-review: F11
import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ write: vi.fn(), order: [] as string[], ctx: { companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actorUserId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', apiClientId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', permissions: ['users.write', 'users.read'] } }))
// The wrapper mock records that current auth/ownership ran before any idempotent replay lookup.
vi.mock('@/lib/staff-api/http', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/staff-api/http')>(), withStaffApi: async (_r: unknown, _o: unknown, h: (ctx: unknown) => Promise<Response>) => { mocks.order.push('auth'); return h(mocks.ctx) } }))
vi.mock('@/lib/tenant/staffCommands', () => ({ inviteStaff: vi.fn(), changeStaffRole: vi.fn(), disableStaff: vi.fn(), reactivateStaff: vi.fn(), listStaff: vi.fn(), listStaffRoles: vi.fn() }))
vi.mock('@/lib/api/strictRequest', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api/strictRequest')>(), executeIdempotentPortalWrite: mocks.write }))

import { disableStaffUser, enableStaffUser, patchStaffUser, postStaffUser } from '@/lib/staff-api/userHandlers'

const userId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const params = () => ({ params: Promise.resolve({ id: userId }) })
const req = (path: string, body: unknown, method = 'POST') => new NextRequest(`https://example.invalid/api/v1/staff/users${path}`, { method, headers: { 'content-type': 'application/json', 'idempotency-key': 'synthetic-op-one' }, body: JSON.stringify(body) })
const operations: Array<[string, number, () => Promise<Response>]> = [
  ['invite', 201, () => postStaffUser(req('', { email: 'synthetic@example.invalid', role_key: 'customer_service_agent' }))],
  ['change-role', 200, () => patchStaffUser(req(`/${userId}`, { role_key: 'customer_service_agent' }, 'PATCH'), params())],
  ['disable', 200, () => disableStaffUser(req(`/${userId}/disable`, {}), params())],
  ['enable', 200, () => enableStaffUser(req(`/${userId}/enable`, {}), params())],
]

beforeEach(() => { mocks.write.mockReset(); mocks.order.length = 0 })

it.each(operations.flatMap(([name, status, call]) => [false, true].map(replayed => [name, status, replayed, call] as const)))('%s propagates Idempotency-Replayed (status %s, replayed=%s)', async (_name, status, replayed, call) => {
  mocks.write.mockImplementation(async () => { mocks.order.push('replay'); return { statusCode: status, body: { data: { status: 'ok' } }, replayed } })
  const response = await call()
  expect(response.status).toBe(status)
  expect(response.headers.get('Idempotency-Replayed')).toBe(String(replayed))
  expect(response.headers.get('X-Gridex-Contract-Version')).toBeTruthy()
  expect(mocks.order).toEqual(['auth', 'replay'])
})
