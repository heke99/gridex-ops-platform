import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as listNotifications } from '@/app/api/v1/customer/notifications/route'
import { GET as getBundle, POST as postBundle } from '@/app/api/v1/customer/portal-bundle/route'
import { publicReference } from '@/lib/integrations/publicReferences'

type Endpoint = 'dedicated' | 'bundle GET' | 'bundle POST'
const io = vi.hoisted(() => ({
  reads: [] as URLSearchParams[],
  missingColumns: new Set<string>(),
}))
const company = '00000000-0000-4000-8000-000000000101'
const customer = '00000000-0000-4000-8000-000000000201'
const readId = '00000000-0000-4000-8000-000000000301'
const unreadId = '00000000-0000-4000-8000-000000000302'
const readAt = '2026-11-18T12:00:00.000Z'
const createdAt = '2026-11-18T10:00:00.000Z'
const storedRead = {
  id: readId, company_id: company, customer_id: customer,
  type: 'billing', title: 'Synthetic invoice notification', message: 'Synthetic billing notice',
  status: 'read', read_at: readAt, created_at: createdAt,
  action_url: 'https://synthetic.invalid/unused', metadata: { detail: 'x'.repeat(4096) },
}
const rows = [
  storedRead,
  { ...storedRead, id: unreadId, type: 'metering', title: 'Synthetic metering notification', status: 'unread', read_at: null },
  { ...storedRead, id: 'other-company-notice', company_id: 'other-company', title: 'Foreign company notice' },
  { ...storedRead, id: 'other-customer-notice', customer_id: 'other-customer', title: 'Foreign customer notice' },
]

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ediel/retention/customerRecordClasses', () => ({ requirePortalRetentionAccess: vi.fn() }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://synthetic.example.test', 'fixture-key', {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: readFixture },
  }) }
})
vi.mock('@/lib/customer-portal/externalApi', async (original) => {
  const context = async () => ({
    ok: true, client: { id: 'fixture-client', company_id: company }, startedAt: Date.now(),
    identity: {
      customer_id: customer, customer_number: '1', external_customer_id: 'fixture',
      provider: 'synthetic', match_strength: 'strong', customer: { id: customer, customer_type: 'private', status: 'active' },
    },
  })
  return {
    ...await original<typeof import('@/lib/customer-portal/externalApi')>(),
    requireCustomerPortalApiContext: context,
    requireCustomerPortalApiContextForIdentifiers: context,
    logCustomerPortalSuccess: vi.fn(),
  }
})

async function readFixture(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  expect(url.origin).toBe('https://synthetic.example.test')
  if (url.pathname.endsWith('/customer_portal_api_access_logs') && init?.method === 'POST') {
    return new Response(null, { status: 201 })
  }
  expect(init?.method).toBe('GET')
  if (!url.pathname.endsWith('/customer_notifications')) return Response.json([])

  const query = url.searchParams
  io.reads.push(query)
  const columns = query.get('select')!.split(',')
  const missing = columns.find((column) => io.missingColumns.has(column))
  if (missing) return Response.json({ code: '42703', message: `column customer_notifications.${missing} does not exist` }, { status: 400 })
  return Response.json(rows.filter((row) =>
    query.get('company_id') === `eq.${row.company_id}` && query.get('customer_id') === `eq.${row.customer_id}`,
  ).map((row) => Object.fromEntries(columns.map((column) => [column, row[column as keyof typeof row]]))))
}

async function request(endpoint: Endpoint) {
  const url = 'https://gridex.test/api/v1/customer/portal-bundle?include=notifications'
  const response = await (endpoint === 'dedicated'
    ? listNotifications(new NextRequest('https://gridex.test/api/v1/customer/notifications?limit=2'))
    : endpoint === 'bundle GET'
      ? getBundle(new NextRequest(url))
      : postBundle(new NextRequest(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ external_customer_id: 'fixture' }),
      })))
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toContain('no-store')
  const { data } = await response.json()
  return endpoint === 'dedicated' ? data : data.notifications
}

const projections = {
  current: ['id', 'type', 'title', 'message', 'status', 'read_at', 'created_at'],
  legacy: ['id', 'type', 'title', 'message', 'status', 'created_at'],
}

beforeEach(() => {
  io.reads = []
  io.missingColumns.clear()
})

describe.each(['dedicated', 'bundle GET', 'bundle POST'] as const)('portal notification projection via %s', (endpoint) => {
  it('reads only public source columns and preserves category and read status for the authorized customer', async () => {
    const notifications = await request(endpoint)
    expect(notifications).toEqual([
      { notification_reference: publicReference('notification', company, readId), type: 'billing', title: storedRead.title,
        message: storedRead.message, status: 'read', read_at: readAt, created_at: createdAt },
      { notification_reference: publicReference('notification', company, unreadId), type: 'metering', title: 'Synthetic metering notification',
        message: storedRead.message, status: 'unread', read_at: null, created_at: createdAt },
    ])
    expect(io.reads).toHaveLength(1)
    expect(io.reads[0].get('select')?.split(',')).toEqual(projections.current)
    expect(io.reads[0].get('company_id')).toBe(`eq.${company}`)
    expect(io.reads[0].get('customer_id')).toBe(`eq.${customer}`)
    expect(io.reads[0].get('limit')).toBe(endpoint === 'dedicated' ? '3' : '100')
  })

  it('keeps the public read timestamp even if the unused stored columns are unavailable', async () => {
    io.missingColumns.add('action_url').add('metadata')
    const notifications = await request(endpoint)
    expect(notifications[0].read_at).toBe(readAt)
    expect(io.reads).toHaveLength(1)
  })

  it('retains the established projection on an older schema without read_at', async () => {
    io.missingColumns.add('read_at')
    const notifications = await request(endpoint)
    expect(notifications).toHaveLength(2)
    expect(notifications[0]).toMatchObject({ type: 'billing', status: 'read' })
    expect(notifications[0]).not.toHaveProperty('read_at')
    expect(io.reads.map((query) => query.get('select')?.split(','))).toEqual([projections.current, projections.legacy])
  })
})
