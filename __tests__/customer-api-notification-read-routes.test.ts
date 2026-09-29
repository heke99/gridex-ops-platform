import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ownId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const fixture = vi.hoisted(() => ({
  scopes: [] as string[][],
  filters: [] as Array<{ phase: string; field: string; value: string }>,
  rows: [
    { id: '11111111-1111-4111-8111-111111111111', company: 'synthetic-company',
      customer: 'synthetic-customer', status: 'unread', readAt: null as string | null },
    { id: '22222222-2222-4222-8222-222222222222', company: 'synthetic-company',
      customer: 'different-customer', status: 'unread', readAt: null as string | null },
  ],
  updates: 0,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/customer-portal/externalApi', () => ({
  requireCustomerPortalApiContext: async (_request: unknown, scopes: string[]) => {
    fixture.scopes.push(scopes)
    return {
      ok: true, startedAt: 1,
      client: { id: 'synthetic-client', company_id: 'synthetic-company' },
      identity: { customer_id: 'synthetic-customer' },
    }
  },
  customerPortalJson: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  logCustomerPortalSuccess: vi.fn(),
  handleCustomerPortalRouteError: ({ error }: { error: { status?: number; code?: string } }) =>
    Response.json({ code: error.code }, { status: error.status ?? 500 }),
}))
vi.mock('@/lib/api/strictRequest', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api/strictRequest')>(),
  executeIdempotentPortalWrite: async ({ execute }: { execute: () => Promise<{ statusCode: number; body: unknown }> }) =>
    ({ ...await execute(), replayed: false }),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      if (table !== 'customer_notifications') throw new Error(`Unexpected table: ${table}`)
      const filters = new Map<string, string>()
      let phase = 'resolve'
      let ids: string[] | null = null
      let update: { status: string; read_at: string } | null = null
      const query = {
        select: () => query,
        update: (value: { status: string; read_at: string }) => {
          phase = 'update'
          update = value
          return query
        },
        eq: (field: string, value: string) => {
          fixture.filters.push({ phase, field, value })
          filters.set(field, value)
          return query
        },
        in: (_field: string, value: string[]) => {
          ids = value
          return query
        },
        order: () => query,
        range: () => query,
        then: (resolve: (value: unknown) => unknown) => {
          const matching = fixture.rows.filter((row) =>
            row.company === filters.get('company_id') &&
            row.customer === filters.get('customer_id') &&
            (ids === null || ids.includes(row.id)) &&
            (!filters.has('status') || row.status === filters.get('status')))
          if (update) {
            for (const row of matching) {
              row.status = update.status
              row.readAt = update.read_at
              fixture.updates += 1
            }
          }
          return Promise.resolve({ data: matching.map((row) => ({ id: row.id })), error: null }).then(resolve)
        },
      }
      return query
    },
  },
}))

import { publicReference } from '@/lib/integrations/publicReferences'
import { POST } from '@/app/api/v1/customer/notifications/read/route'

const ownReference = publicReference('notification', 'synthetic-company', ownId)
const otherReference = publicReference('notification', 'synthetic-company', otherId)
const request = (reference: string) => new NextRequest(
  'https://gridex.example.test/api/v1/customer/notifications/read',
  { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'synthetic-notification-read-1' },
    body: JSON.stringify({ notification_references: [reference] }) },
)

describe('actual mark-read route with synthetic tenant rows', () => {
  beforeEach(() => {
    fixture.scopes.length = 0
    fixture.filters.length = 0
    fixture.updates = 0
    fixture.rows[0].status = 'unread'
    fixture.rows[0].readAt = null
  })

  it('resolves and updates only the verified customer in the authenticated organization', async () => {
    const response = await POST(request(ownReference!))
    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({
      updated_count: 1, notification_references: [ownReference],
    })
    expect(fixture.scopes).toEqual([['customer_notifications.write']])
    expect(fixture.filters).toEqual(expect.arrayContaining([
      { phase: 'resolve', field: 'company_id', value: 'synthetic-company' },
      { phase: 'resolve', field: 'customer_id', value: 'synthetic-customer' },
      { phase: 'update', field: 'company_id', value: 'synthetic-company' },
      { phase: 'update', field: 'customer_id', value: 'synthetic-customer' },
    ]))
    expect(fixture.updates).toBe(1)
    expect(fixture.rows[1].status).toBe('unread')
  })

  it('returns a neutral 404 without updating another customer’s notification', async () => {
    const response = await POST(request(otherReference!))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'notification_reference_not_found' })
    expect(fixture.updates).toBe(0)
  })

  it('does not overwrite the first read timestamp under a new valid request', async () => {
    fixture.rows[0].status = 'read'
    fixture.rows[0].readAt = '2026-09-28T10:00:00Z'
    const response = await POST(request(ownReference!))
    expect(response.status).toBe(200)
    expect((await response.json()).data.updated_count).toBe(0)
    expect(fixture.rows[0].readAt).toBe('2026-09-28T10:00:00Z')
    expect(fixture.updates).toBe(0)
  })
})
