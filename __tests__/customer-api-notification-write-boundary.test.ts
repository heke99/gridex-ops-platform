import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const notificationId = '11111111-1111-4111-8111-111111111111'
const fixture = vi.hoisted(() => ({
  readAt: null as string | null,
  readWrites: 0,
  claim: null as null | Record<string, unknown>,
  completionAttempts: 0,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/customer-portal/externalApi', () => ({
  requireCustomerPortalApiContext: async () => ({
    ok: true, startedAt: 1,
    client: { id: 'synthetic-client', company_id: 'synthetic-company' },
    identity: { customer_id: 'synthetic-customer' },
  }),
  customerPortalJson: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  logCustomerPortalSuccess: vi.fn(),
  handleCustomerPortalRouteError: ({ error }: { error: { status?: number; code?: string } }) =>
    Response.json({ code: error.code ?? 'write_failed' }, { status: error.status ?? 500 }),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      if (table === 'customer_portal_write_idempotency') {
        let action = 'select'
        let payload: Record<string, unknown> = {}
        const filters = new Map<string, unknown>()
        const query = {
          insert: (value: Record<string, unknown>) => {
            action = 'insert'
            payload = value
            return query
          },
          update: (value: Record<string, unknown>) => {
            action = 'update'
            payload = value
            return query
          },
          select: () => query,
          eq: (field: string, value: unknown) => {
            filters.set(field, value)
            return query
          },
          maybeSingle: async () => {
            if (action === 'insert') {
              if (fixture.claim) return { data: null, error: { code: '23505' } }
              fixture.claim = { ...payload, id: 'synthetic-claim' }
              return { data: { id: 'synthetic-claim' }, error: null }
            }
            if (action === 'update' && payload.status === 'completed') {
              fixture.completionAttempts += 1
              return { data: null, error: { code: 'synthetic_completion_failure' } }
            }
            return { data: fixture.claim && filters.get('company_id') === fixture.claim.company_id
              ? fixture.claim : null, error: null }
          },
          then: (resolve: (value: unknown) => unknown) => {
            if (action === 'update' && payload.status === 'failed') {
              fixture.claim = { ...fixture.claim, ...payload }
            }
            return Promise.resolve({ error: null }).then(resolve)
          },
        }
        return query
      }
      if (table === 'customer_notifications') {
        let action = 'select'
        const filters = new Map<string, string>()
        const query = {
          select: () => query,
          update: (value: { read_at: string }) => {
            action = 'update'
            fixture.readAt = value.read_at
            return query
          },
          eq: (field: string, value: string) => {
            filters.set(field, value)
            return query
          },
          in: () => query,
          order: () => query,
          range: () => query,
          then: (resolve: (value: unknown) => unknown) => {
            const owned = filters.get('company_id') === 'synthetic-company' &&
              filters.get('customer_id') === 'synthetic-customer'
            if (action === 'update' && owned) fixture.readWrites += 1
            return Promise.resolve({ data: owned ? [{ id: notificationId }] : [], error: null }).then(resolve)
          },
        }
        return query
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  },
}))

import { publicReference } from '@/lib/integrations/publicReferences'
import { POST } from '@/app/api/v1/customer/notifications/read/route'

const reference = publicReference('notification', 'synthetic-company', notificationId)
const request = () => new NextRequest(
  'https://gridex.example.test/api/v1/customer/notifications/read',
  { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'synthetic-notification-read-1' },
    body: JSON.stringify({ notification_references: [reference] }) },
)

describe('remaining mark-read atomicity gap with a synthetic completion failure', () => {
  beforeEach(() => {
    fixture.readAt = null
    fixture.readWrites = 0
    fixture.claim = null
    fixture.completionAttempts = 0
  })

  it('persists the notification change before a failed completion and refuses same-key replay', async () => {
    const first = await POST(request())
    expect(first.status).toBe(500)
    expect(fixture.readWrites).toBe(1)
    expect(fixture.readAt).not.toBeNull()
    expect(fixture.completionAttempts).toBe(1)
    expect(fixture.claim?.status).toBe('failed')

    const replay = await POST(request())
    expect(replay.status).toBe(409)
    expect(await replay.json()).toMatchObject({ code: 'idempotency_previous_attempt_failed' })
    expect(fixture.readWrites).toBe(1)
  })
})
