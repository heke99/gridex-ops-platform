import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as getEvents } from '@/app/api/v1/customer/events/route'
import { GET as getContracts } from '@/app/api/v1/customer/contracts/route'
import { GET as getInvoices } from '@/app/api/v1/customer/invoices/route'
import { GET as getLegalAcceptances } from '@/app/api/v1/customer/legal-acceptances/route'
import { GET as getPowersOfAttorney } from '@/app/api/v1/customer/powers-of-attorney/route'
import { GET as getNotifications } from '@/app/api/v1/customer/notifications/route'
import { GET as getSites } from '@/app/api/v1/customer/sites/route'
import { encodePortalCursor } from '@/lib/customer-portal/keysetPagination'
import { publicReference } from '@/lib/integrations/publicReferences'
import { postgrestOr, sortRows } from './helpers/postgrestOrFilter'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  key: 'cursor-test-current-key',
  auth: vi.fn(),
  resolveCustomer: vi.fn(),
  log: vi.fn(),
  readFailure: false,
  reads: [] as URL[],
  eventReads: [] as Row[],
  events: [] as Row[],
  rows: [] as Row[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/env/supabaseServer', async original => ({
  ...await original<typeof import('@/lib/env/supabaseServer')>(),
  getSupabaseServiceEnv: () => ({ url: 'http://127.0.0.1:1', serviceRoleKey: io.key }),
}))
vi.mock('@/lib/integrations/apiAuth', async original => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(),
  requireIntegrationApiAccess: io.auth,
  logIntegrationApiRequest: io.log,
}))
vi.mock('@/lib/customer-portal/customerResolver', async original => ({
  ...await original<typeof import('@/lib/customer-portal/customerResolver')>(),
  resolvePortalCustomer: io.resolveCustomer,
}))
vi.mock('@/lib/customer-portal/customerAssertion', async original => ({
  ...await original<typeof import('@/lib/customer-portal/customerAssertion')>(),
  gateCustomerAssertion: async () => ({ allowed: true }),
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('http://127.0.0.1:1', 'synthetic-unit-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: portalTransport },
    }),
  }
})

const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const companyId = uuid(1)
const customerId = uuid(2)
const timestamp = '2026-11-01T12:00:00.000Z'
const client = { id: uuid(5), company_id: companyId }
const resources = [
  { name: 'notifications', endpoint: getNotifications, table: 'customer_notifications', scope: 'customer_notifications.read' },
  { name: 'sites', endpoint: getSites, table: 'customer_sites', scope: 'customer_sites.read' },
] as const

function portalTransport(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const table = url.pathname.split('/').at(-1)
  if (url.origin !== 'http://127.0.0.1:1') throw Error('Unexpected transport origin')
  if (init?.method === 'POST' && table === 'ediel_require_portal_retention_access_v1') return Promise.resolve(Response.json(null))
  if (init?.method === 'POST' && table === 'customer_portal_api_access_logs') return Promise.resolve(Response.json([], { status: 201 }))
  if (init?.method === 'POST' && table === 'portal_customer_events_page_v1') {
    io.eventReads.push(JSON.parse(String(init.body)))
    return Promise.resolve(io.readFailure
      ? Response.json({ code: '08006', message: 'Synthetic private database detail' }, { status: 500 })
      : Response.json(io.events))
  }
  if (init?.method !== 'GET') throw Error('Unexpected synthetic method')
  io.reads.push(url)
  if (table === 'metering_points') return Promise.resolve(Response.json([]))
  if (!resources.some(resource => resource.table === table)) throw Error('Unexpected synthetic table')
  if (io.readFailure) return Promise.resolve(Response.json({ code: '08006', message: 'Synthetic private database detail' }, { status: 500 }))

  const filters = url.searchParams
  const cursorFilter = filters.get('or')
  const matchesCursor = cursorFilter ? postgrestOr(cursorFilter.slice(1, -1)) : () => true
  const rows = io.rows.filter(row => filters.get('company_id') === `eq.${row.company_id}`
    && filters.get('customer_id') === `eq.${row.customer_id}` && matchesCursor(row))
  const orders = (filters.get('order') ?? '').split(',').filter(Boolean).map(order => {
    const [column, direction] = order.split('.')
    return { column, ascending: direction === 'asc' }
  })
  return Promise.resolve(Response.json(sortRows(rows, orders).slice(0, Number(filters.get('limit') ?? rows.length))))
}

function request(resource: string, cursor?: string) {
  const url = new URL(`http://127.0.0.1:1/api/v1/customer/${resource}`)
  url.searchParams.set('limit', '1')
  if (cursor !== undefined) url.searchParams.set('cursor', cursor)
  return new NextRequest(url)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  io.key = 'cursor-test-current-key'
  io.readFailure = false
  io.reads.length = 0
  io.eventReads.length = 0
  io.events = []
  io.rows = [
    { id: uuid(10), company_id: companyId, customer_id: customerId, created_at: timestamp },
    { id: uuid(11), company_id: companyId, customer_id: customerId, created_at: timestamp },
    { id: uuid(12), company_id: uuid(3), customer_id: customerId, created_at: timestamp },
    { id: uuid(13), company_id: companyId, customer_id: uuid(4), created_at: timestamp },
  ]
  io.auth.mockResolvedValue({ ok: true, client })
  io.resolveCustomer.mockResolvedValue({ ok: true, customer: { customer_id: customerId }, binding: 'portal_account' })
  io.log.mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())

describe.each(resources)('mounted customer $name cursor errors', resource => {
  it.each(['malformed', 'obsolete key', 'foreign company', 'foreign customer', 'another list'] as const)(
    'returns 400 for an invalid cursor (%s) without reading product rows', async kind => {
      if (kind === 'obsolete key') io.key = 'cursor-test-old-key'
      const cursor = kind === 'malformed' ? 'invalid-cursor' : encodePortalCursor({
        companyId: kind === 'foreign company' ? uuid(3) : companyId,
        customerId: kind === 'foreign customer' ? uuid(4) : customerId,
        resource: kind === 'another list' ? 'contracts' : resource.name,
        tuple: { orderValue: timestamp, id: uuid(11) },
      })
      io.key = 'cursor-test-current-key'

      const response = await resource.endpoint(request(resource.name, cursor))

      expect(response.status).toBe(400)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toMatchObject({
        error: { code: 'invalid_cursor', message: 'Ogiltig sidmarkör.', field: 'cursor', retryable: false, blockers: [] },
        request_id: expect.any(String),
      })
      expect(io.auth).toHaveBeenCalledExactlyOnceWith(expect.any(NextRequest), [resource.scope])
      expect(io.log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ statusCode: 400, errorCode: 'invalid_cursor' }))
      expect(io.reads).toEqual([])
    },
  )

  it('resumes scoped rows using the stable timestamp and row-id tie break', async () => {
    const sites = resource.name === 'sites'
    const first = await resource.endpoint(request(resource.name))
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    const firstPage = sites ? firstBody.page.sites : firstBody.page
    expect(firstPage).toMatchObject({ has_more: true, next_cursor: expect.any(String) })

    const second = await resource.endpoint(request(resource.name, firstPage.next_cursor))
    expect(second.status).toBe(200)
    const secondBody = await second.json()
    const rows = sites ? secondBody.data.sites : secondBody.data
    const field = sites ? 'facility_reference' : 'notification_reference'
    const kind = sites ? 'facility' : 'notification'
    expect(rows).toEqual([expect.objectContaining({ [field]: publicReference(kind, companyId, uuid(10)) })])
    expect(sites ? secondBody.page.sites : secondBody.page).toMatchObject({ has_more: false, next_cursor: null })
    const pageReads = io.reads.filter(url => url.pathname.endsWith('/' + resource.table))
    expect(pageReads).toHaveLength(2)
    expect(pageReads[1].searchParams.get('or')).toContain(`id.lt.${uuid(11)}`)
    expect(pageReads.every(({ searchParams }) => searchParams.get('company_id') === `eq.${companyId}`
      && searchParams.get('customer_id') === `eq.${customerId}`)).toBe(true)
  })

  it.each([{ status: 401, code: 'invalid_api_key' }, { status: 403, code: 'missing_scope' }])(
    'preserves authorization denial $status even when a cursor is malformed', async denial => {
      io.auth.mockResolvedValue({ ok: false, status: denial.status, errorCode: denial.code, error: 'Synthetic denied' })
      const response = await resource.endpoint(request(resource.name, 'invalid-cursor'))
      expect(response.status).toBe(denial.status)
      expect(await response.json()).toMatchObject({ error: { code: denial.code } })
      expect(io.resolveCustomer).not.toHaveBeenCalled()
      expect(io.reads).toEqual([])
    },
  )

  it('keeps real read failures generic and logged as 500', async () => {
    io.readFailure = true
    const cursor = encodePortalCursor({ companyId, customerId, resource: resource.name, tuple: { orderValue: timestamp, id: uuid(11) } })
    const response = await resource.endpoint(request(resource.name, cursor))

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toMatchObject({ error: { code: 'customer_portal_internal_error' } })
    expect(JSON.stringify(body)).not.toContain('Synthetic private database detail')
    expect(io.reads).toHaveLength(1)
    expect(io.log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ statusCode: 500 }))
  })
})

it.each([
  { name: 'contracts', endpoint: getContracts },
  { name: 'invoices', endpoint: getInvoices },
  { name: 'legal-acceptances', endpoint: getLegalAcceptances },
  { name: 'powers-of-attorney', endpoint: getPowersOfAttorney },
])('uses the same 400 envelope for the shared $name list picker', async ({ name, endpoint }) => {
  const response = await endpoint(request(name, 'invalid-cursor'))
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ error: { code: 'invalid_cursor', field: 'cursor' } })
  expect(io.reads).toEqual([])
})


describe('mounted customer event cursor errors', () => {
  it.each([
    { name: 'malformed' },
    { name: 'foreign company', company: uuid(3) },
    { name: 'foreign customer', customer: uuid(4) },
    { name: 'another resource', resource: 'notifications' },
  ])('returns the public 400 for a $name cursor before the event RPC', async input => {
    const cursor = input.name === 'malformed' ? 'invalid-cursor' : encodePortalCursor({
      companyId: input.company ?? companyId,
      customerId: input.customer ?? customerId,
      resource: input.resource ?? 'events',
      tuple: { orderValue: timestamp, sourceRank: 2, id: uuid(11) },
    })
    const response = await getEvents(request('events', cursor))
    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.json()
    expect(body).toMatchObject({
      error: { code: 'invalid_cursor', message: 'Ogiltig sidmarkör.', field: 'cursor', retryable: false, blockers: [] },
      request_id: expect.any(String),
    })
    expect(JSON.stringify(body)).not.toContain(cursor)
    expect(io.auth).toHaveBeenCalledExactlyOnceWith(expect.any(NextRequest), ['customer_events.read'])
    expect(io.log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ statusCode: 400, errorCode: 'invalid_cursor' }))
    expect(io.eventReads).toEqual([])
  })

  it.each([401, 403])('preserves authorization denial %s with a malformed cursor', async status => {
    io.auth.mockResolvedValue({ ok: false, status, errorCode: 'synthetic_denied', error: 'Synthetic denied' })
    const response = await getEvents(request('events', 'invalid-cursor'))
    expect(response.status).toBe(status)
    expect(io.resolveCustomer).not.toHaveBeenCalled()
    expect(io.eventReads).toEqual([])
  })

  it('resumes an issued cursor with the same event scope and source rank', async () => {
    const first = { id: uuid(11), occurred_at: timestamp, source_rank: 2 }
    const next = { id: uuid(10), occurred_at: timestamp, source_rank: 1 }
    io.events = [first, next]
    const response = await getEvents(request('events'))
    expect(response.status).toBe(200)
    const page = (await response.json()).page
    expect(page).toMatchObject({ has_more: true, next_cursor: expect.any(String) })
    io.events = [next]
    const continued = await getEvents(request('events', page.next_cursor))
    expect(continued.status).toBe(200)
    expect(await continued.json()).toMatchObject({
      data: [{ event_reference: publicReference('event', companyId, next.id) }],
      page: { has_more: false, next_cursor: null },
    })
    expect(io.eventReads).toHaveLength(2)
    expect(io.eventReads[1]).toEqual({
      p_company_id: companyId, p_customer_id: customerId, p_cursor_occurred_at: timestamp,
      p_cursor_source_rank: first.source_rank, p_cursor_id: first.id, p_limit: 2,
    })
  })

  it('keeps an unrelated database failure generic and logged as 500', async () => {
    io.readFailure = true
    const response = await getEvents(request('events'))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toMatchObject({ error: { code: 'customer_portal_internal_error' } })
    expect(JSON.stringify(body)).not.toContain('Synthetic private database detail')
    expect(io.eventReads).toHaveLength(1)
    expect(io.log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ statusCode: 500 }))
  })
})
