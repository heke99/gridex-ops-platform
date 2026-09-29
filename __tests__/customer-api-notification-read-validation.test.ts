import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
vi.mock('@/lib/customer-portal/externalApi', () => ({
  requireCustomerPortalApiContext: async () => ({
    ok: true, startedAt: 1,
    client: { id: 'synthetic-client', company_id: 'synthetic-company' },
    identity: { customer_id: 'synthetic-customer' },
  }),
  customerPortalJson: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  handleCustomerPortalRouteError: ({ error }: { error: { status?: number; code?: string } }) =>
    Response.json({ code: error.code }, { status: error.status ?? 500 }),
  logCustomerPortalSuccess: vi.fn(),
}))
vi.mock('@/lib/api/strictRequest', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api/strictRequest')>(),
  executeIdempotentPortalWrite: vi.fn(async () => ({
    statusCode: 200,
    body: { data: { updated_count: 0, notification_references: [], read_at: '2026-09-29T00:00:00Z' } },
    replayed: false,
  })),
}))

import { executeIdempotentPortalWrite } from '@/lib/api/strictRequest'
import { POST } from '@/app/api/v1/customer/notifications/read/route'

const reference = `notification_${'a'.repeat(32)}`
const request = (body: unknown) => new NextRequest(
  'https://gridex.example.test/api/v1/customer/notifications/read',
  { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'synthetic-key' },
    body: JSON.stringify(body) },
)

describe('notification read request validation before idempotency and database access', () => {
  it('rejects duplicate references instead of silently reducing the requested set', async () => {
    vi.mocked(executeIdempotentPortalWrite).mockClear()
    const response = await POST(request({ notification_references: [reference, reference] }))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'notification_reference_duplicate' })
    expect(executeIdempotentPortalWrite).not.toHaveBeenCalled()
  })

  it('rejects unknown payload fields rather than accepting an undocumented mutation shape', async () => {
    vi.mocked(executeIdempotentPortalWrite).mockClear()
    const response = await POST(request({ notification_references: [reference], customer_id: 'other-customer' }))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'notification_read_unknown_field' })
    expect(executeIdempotentPortalWrite).not.toHaveBeenCalled()
  })

  it('rejects null entries instead of forwarding them to the idempotency claim', async () => {
    vi.mocked(executeIdempotentPortalWrite).mockClear()
    const response = await POST(request({ notification_references: [null] }))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'notification_reference_invalid' })
    expect(executeIdempotentPortalWrite).not.toHaveBeenCalled()
  })

  it('rejects reference shapes that no notification list can produce', async () => {
    vi.mocked(executeIdempotentPortalWrite).mockClear()
    const response = await POST(request({ notification_references: [`notification_${'a'.repeat(20)}`] }))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'notification_reference_invalid' })
    expect(executeIdempotentPortalWrite).not.toHaveBeenCalled()
  })
})
