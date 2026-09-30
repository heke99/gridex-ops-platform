import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  rpc: vi.fn(), scopes: [] as string[][], subject: 'verified-subject' as string | null,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/customer-portal/externalApi', () => ({
  requireCustomerPortalApiContext: async (_request: unknown, scopes: string[]) => {
    fixture.scopes.push(scopes)
    return { ok: true, startedAt: 1,
      client: { id: 'synthetic-client', company_id: 'synthetic-company' },
      identity: { customer_id: 'synthetic-customer', customer_portal_user_id: fixture.subject },
    }
  },
  customerPortalJson: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  logCustomerPortalSuccess: vi.fn(),
  handleCustomerPortalRouteError: ({ error }: { error: { status?: number; code?: string; field?: string } }) =>
    Response.json({ code: error.code, field: error.field }, { status: error.status ?? 500 }),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { rpc: fixture.rpc,
    from: () => { throw new Error('notification adapter attempted a separate table operation') },
  },
}))

import { POST } from '@/app/api/v1/customer/notifications/read/route'

const reference = `notification_${'a'.repeat(32)}`
const request = (key: string | null = 'synthetic-notification-read-1') => new NextRequest(
  'https://gridex.example.test/api/v1/customer/notifications/read',
  { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key === null ? {} : { 'Idempotency-Key': key }) },
    body: JSON.stringify({ notification_references: [reference] }) },
)

describe('mark-read API adapter to the atomic service command', () => {
  beforeEach(() => {
    fixture.rpc.mockReset()
    fixture.scopes.length = 0
    fixture.subject = 'verified-subject'
    fixture.rpc.mockResolvedValue({ data: {
      statusCode: 200, replayed: false,
      body: { data: { updated_count: 1, notification_references: [reference], read_at: '2026-09-30T12:00:00Z' } },
    }, error: null })
  })

  it('uses only the verified tenant, customer, client and delegated subject', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual({
      updated_count: 1, notification_references: [reference], read_at: '2026-09-30T12:00:00Z',
    })
    expect(fixture.scopes).toEqual([['customer_notifications.write']])
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('gridex_mark_customer_notifications_read_v1', {
      p_command: {
        companyId: 'synthetic-company', customerId: 'synthetic-customer', clientId: 'synthetic-client',
        subject: 'verified-subject', idempotencyKey: 'synthetic-notification-read-1', notificationReferences: [reference],
      },
    })
  })

  it('maps missing or foreign references to the same neutral 404', async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message: 'notification_reference_not_found', code: 'P0002' } })
    const response = await POST(request())
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ code: 'notification_reference_not_found', field: 'notification_references' })
  })

  it.each(['notification_delegation_forbidden', 'notification_customer_unavailable', 'notification_tenant_unavailable'])
    ('blocks execution and replay when current authorization reports %s', async (code) => {
      fixture.rpc.mockResolvedValue({ data: null, error: { message: code, code: '42501' } })
      const response = await POST(request())
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code })
    })

  it('returns the legacy completed response exactly without independently claiming or completing', async () => {
    const historicalBody = { data: { updated_count: 0, notification_references: [reference], read_at: '2026-08-01T01:02:03.123Z' } }
    fixture.rpc.mockResolvedValue({ data: { statusCode: 200, body: historicalBody, replayed: true }, error: null })
    expect(await (await POST(request())).json()).toEqual(historicalBody)
  })

  it('requires a currently verified account link and a valid key before database execution', async () => {
    fixture.subject = null
    expect((await POST(request())).status).toBe(403)
    fixture.subject = 'verified-subject'
    expect((await POST(request(null))).status).toBe(400)
    expect((await POST(request(' bad key '))).status).toBe(400)
    expect(fixture.rpc).not.toHaveBeenCalled()
  })

  it.each(['idempotency_conflict', 'idempotency_previous_attempt_failed', 'idempotency_in_progress'])
    ('preserves %s as a safe 409 without bypassing the command', async (code) => {
      fixture.rpc.mockResolvedValue({ data: null, error: { message: code, code: 'P0001' } })
      const response = await POST(request())
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ code })
    })

  it('does not turn an invalid command result into a success', async () => {
    fixture.rpc.mockResolvedValue({ data: { statusCode: 200, body: null, replayed: false }, error: null })
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'notification_result_invalid' })
  })

  it.each([
    { code: 'PGRST202', message: 'Could not find the function public.gridex_mark_customer_notifications_read_v1(p_command) in the schema cache' },
    { code: '42883', message: 'function public.gridex_mark_customer_notifications_read_v1(jsonb) does not exist' },
    { code: '42703', message: 'column n.notification_reference does not exist' },
  ])('maps a genuinely missing notification command capability to safe 503', async (error) => {
    fixture.rpc.mockResolvedValue({ data: null, error })
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'platform_schema_not_ready' })
  })
})
