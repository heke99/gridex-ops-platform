import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ rpc: vi.fn(), separateWrites: 0 }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/customer-portal/externalApi', () => ({
  requireCustomerPortalApiContext: async () => ({
    ok: true, startedAt: 1,
    client: { id: 'synthetic-client', company_id: 'synthetic-company' },
    identity: { customer_id: 'synthetic-customer', customer_portal_user_id: 'verified-subject' },
  }),
  customerPortalJson: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  logCustomerPortalSuccess: vi.fn(),
  handleCustomerPortalRouteError: ({ error }: { error: { status?: number; code?: string } }) =>
    Response.json({ code: error.code ?? 'write_failed' }, { status: error.status ?? 500 }),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { rpc: fixture.rpc, from: () => {
    fixture.separateWrites += 1
    throw new Error('notification adapter crossed the atomic command boundary')
  } },
}))

import { POST } from '@/app/api/v1/customer/notifications/read/route'

const reference = `notification_${'a'.repeat(32)}`
const request = () => new NextRequest('https://gridex.example.test/api/v1/customer/notifications/read', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'synthetic-notification-read-1' },
  body: JSON.stringify({ notification_references: [reference] }),
})

describe('notification write boundary (adapter regression; native suite proves rollback)', () => {
  beforeEach(() => { fixture.rpc.mockReset(); fixture.separateWrites = 0 })

  it('never performs separate mutation, claim or completion when a late SQL error is returned', async () => {
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'synthetic late completion failure' } })
    expect((await POST(request())).status).toBe(500)
    expect(fixture.separateWrites).toBe(0)

    fixture.rpc.mockResolvedValueOnce({ data: {
      statusCode: 200, replayed: false,
      body: { data: { updated_count: 1, notification_references: [reference], read_at: '2026-09-30T12:00:00Z' } },
    }, error: null })
    expect((await POST(request())).status).toBe(200)
    expect(fixture.rpc).toHaveBeenCalledTimes(2)
    expect(fixture.separateWrites).toBe(0)
  })
})
