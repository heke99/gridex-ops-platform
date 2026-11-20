import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const io = vi.hoisted(() => ({
  notifications: [] as Row[],
  claims: [] as Row[],
  beforeMark: null as (() => void) | null,
  afterLookup: null as (() => void) | null,
  lookups: [] as Array<{ offset: number; after: string | null; returned: number }>,
  lookupCap: Number.POSITIVE_INFINITY,
  lookupFailuresRemaining: 0,
  failMarkAcknowledgment: false,
  notificationWrites: 0,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/integrations/apiAuth', async (original) => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(),
  currentIntegrationApiResponseContext: () => null,
  logIntegrationApiRequest: vi.fn(),
}))
vi.mock('@/lib/customer-portal/externalApi', async (original) => ({
  ...await original<typeof import('@/lib/customer-portal/externalApi')>(),
  requireCustomerPortalApiContext: async () => ({
    ok: true, client: { id: 'client', company_id: 'company' }, identity: { customer_id: 'customer' }, startedAt: Date.now(),
  }),
  logCustomerPortalSuccess: vi.fn(),
}))
vi.mock('@/lib/supabase/service', async () => ({
  supabaseService: createClient('http://127.0.0.1:54321', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input))
        expect(url.origin).toBe('http://127.0.0.1:54321')
        const isNotification = url.pathname === '/rest/v1/customer_notifications'
        if (!isNotification && url.pathname !== '/rest/v1/customer_portal_write_idempotency') throw new Error(`Unexpected fixture endpoint ${url.pathname}`)
        const method = init?.method ?? 'GET'
        if (method === 'POST' && !isNotification) {
          const body = JSON.parse(String(init?.body)) as Row
          if (io.claims.some(row => ['company_id', 'api_client_id', 'customer_id', 'route', 'idempotency_key'].every(key => row[key] === body[key]))) {
            return Response.json({ code: '23505', message: 'Synthetic existing claim' }, { status: 409 })
          }
          const row = { ...body, id: `claim-${io.claims.length}` }
          io.claims.push(row)
          return Response.json(row, { status: 201 })
        }
        if (method === 'PATCH' && isNotification) {
          expect(url.searchParams.get('company_id')).toBe('eq.company')
          expect(url.searchParams.get('customer_id')).toBe('eq.customer')
          io.notificationWrites += 1
          const concurrentMark = io.beforeMark
          io.beforeMark = null
          concurrentMark?.()
        }
        const filters = [...url.searchParams].filter(([key]) => !['select', 'order', 'offset', 'limit'].includes(key))
        const rows = (isNotification ? io.notifications : io.claims).filter(row => filters.every(([key, filter]) => {
          if (filter === 'is.null') return row[key] === null
          if (filter.startsWith('eq.')) return String(row[key]) === filter.slice(3)
          if (filter.startsWith('in.(')) return filter.slice(4, -1).split(',').includes(String(row[key]))
          if (filter.startsWith('gt.')) return String(row[key]) > filter.slice(3)
          throw new Error(`Unexpected fixture filter ${filter}`)
        }))
        if (method === 'DELETE' && !isNotification) {
          io.claims = io.claims.filter(row => !rows.includes(row))
          return new Response(null, { status: 204 })
        }
        if (method === 'GET' && isNotification) {
          expect(url.searchParams.get('company_id')).toBe('eq.company')
          expect(url.searchParams.get('customer_id')).toBe('eq.customer')
          expect(url.searchParams.get('order')).toBe('id.asc')
          if (io.lookupFailuresRemaining > 0) {
            io.lookupFailuresRemaining -= 1
            return Response.json({ code: '57P03', message: 'Synthetic lookup unavailable' }, {
              status: 503, headers: { 'Retry-After': '0' },
            })
          }
          const offset = Number(url.searchParams.get('offset') ?? 0)
          const limit = Math.min(Number(url.searchParams.get('limit') ?? rows.length), io.lookupCap)
          const page = rows.sort((left, right) => String(left.id).localeCompare(String(right.id))).slice(offset, offset + limit)
          io.lookups.push({ offset, after: url.searchParams.get('id'), returned: page.length })
          const response = Response.json(page.map(row => ({ id: row.id })))
          const afterLookup = io.afterLookup
          io.afterLookup = null
          afterLookup?.()
          return response
        }
        if (method === 'PATCH') {
          const patch = JSON.parse(String(init?.body)) as Row
          rows.forEach(row => Object.assign(row, patch))
          if (isNotification && io.failMarkAcknowledgment) {
            return Response.json({ code: '57P03', message: 'Synthetic acknowledgment unavailable' }, { status: 503 })
          }
        } else if (method !== 'GET') {
          throw new Error(`Unexpected fixture method ${method}`)
        }
        const single = new Headers(init?.headers).get('accept')?.includes('pgrst.object')
        return Response.json(single ? rows[0] ?? null : rows)
      },
    },
  }),
}))

import { POST } from '@/app/api/v1/customer/notifications/read/route'
import { publicReference } from '@/lib/integrations/publicReferences'

const first = '2026-11-18T09:00:00.000Z'
const now = '2026-11-19T09:00:00.000Z'
const row = (id: number, readAt: string | null, customerId = 'customer') => ({
  id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  company_id: 'company', customer_id: customerId, status: readAt ? 'read' : 'unread', read_at: readAt, updated_at: readAt,
})
const reference = (notification: Row) => publicReference('notification', String(notification.company_id), notification.id)
const post = (key: string, rows: Row[]) => POST(new NextRequest('https://synthetic.example/api/v1/customer/notifications/read', {
  method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key },
  body: JSON.stringify({ notification_references: rows.map(reference) }),
}))

function legacyClaim(key: string, refs: Array<string | null>, responseRefs = refs, status = 'completed') {
  const requestHash = createHash('sha256').update(JSON.stringify({ notification_references: refs })).digest('hex')
  const body = { data: { updated_count: 2, notification_references: responseRefs, read_at: first } }
  io.claims.push({
    id: 'legacy-claim', company_id: 'company', api_client_id: 'client', customer_id: 'customer',
    route: '/api/v1/customer/notifications/read', idempotency_key: key, request_hash: requestHash,
    status, started_at: now, response_status: 200, response_body: status === 'completed' ? body : null,
  })
  return body
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  io.notifications = [row(1, first), row(2, null), row(3, null, 'other-customer')]
  io.claims = []
  io.beforeMark = null
  io.afterLookup = null
  io.lookups = []
  io.lookupCap = Number.POSITIVE_INFINITY
  io.lookupFailuresRemaining = 0
  io.failMarkAcknowledgment = false
  io.notificationWrites = 0
})
afterEach(() => vi.useRealTimers())

describe('customer notification read timestamps', () => {
  it('preserves earlier timestamps and counts only new reads in a mixed batch', async () => {
    const selected = io.notifications.slice(0, 2)
    const response = await post('synthetic-read-mixed-001', selected)
    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual({ updated_count: 1, notification_references: selected.map(reference), read_at: now })
    expect(io.notifications[0]).toMatchObject({ status: 'read', read_at: first, updated_at: first })
    expect(io.notifications[1]).toMatchObject({ status: 'read', read_at: now, updated_at: now })
    expect(io.notifications[2]).toMatchObject({ status: 'unread', read_at: null })
  })

  it('preserves a read committed after reference lookup and reports no new read', async () => {
    io.beforeMark = () => Object.assign(io.notifications[1], { status: 'read', read_at: first, updated_at: first })
    const response = await post('synthetic-read-race-001', [io.notifications[1]])
    expect(response.status).toBe(200)
    expect((await response.json()).data.updated_count).toBe(0)
    expect(io.notifications[1]).toMatchObject({ status: 'read', read_at: first, updated_at: first })
  })

  it('replays the initial receipt for the same key and does not rewrite after a new key', async () => {
    const selected = [io.notifications[1]]
    const initial = await post('synthetic-read-replay-001', selected)
    expect(initial.status).toBe(200)
    const receipt = (await initial.json()).data
    expect(receipt.updated_count).toBe(1)

    vi.setSystemTime('2026-11-19T10:00:00.000Z')
    const replay = await post('synthetic-read-replay-001', selected)
    expect(replay.status).toBe(200)
    expect((await replay.json()).data).toEqual(receipt)
    expect(io.notificationWrites).toBe(1)

    const repeated = await post('synthetic-read-new-key-001', selected)
    expect(repeated.status).toBe(200)
    expect((await repeated.json()).data.updated_count).toBe(0)
    expect(io.notifications[1]).toMatchObject({ read_at: now, updated_at: now })
  })

  it('does not update a reference belonging to another customer', async () => {
    const response = await post('synthetic-read-foreign-001', [io.notifications[2]])
    expect(response.status).toBe(404)
    expect(io.notificationWrites).toBe(0)
  })

  it('still finds the first item of the next page after a row on the first page is deleted', async () => {
    io.notifications = Array.from({ length: 1002 }, (_, index) => row(index + 1, null))
    const selected = io.notifications[1000]
    io.afterLookup = () => { io.notifications.shift() }

    const response = await post('synthetic-read-deleted-earlier', [selected])
    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual({ updated_count: 1, notification_references: [reference(selected)], read_at: now })
    expect(io.lookups).toEqual([
      { offset: 0, after: null, returned: 1000 },
      { offset: 0, after: `gt.${row(1000, null).id}`, returned: 2 },
    ])
    expect(io.notificationWrites).toBe(1)
  })

  it('continues after a nonempty page when the server caps it below the requested size', async () => {
    io.notifications = Array.from({ length: 4 }, (_, index) => row(index + 1, null))
    io.lookupCap = 2
    const response = await post('synthetic-read-short-page', [io.notifications[2]])
    expect(response.status).toBe(200)
    expect(io.lookups).toEqual([
      { offset: 0, after: null, returned: 2 },
      { offset: 0, after: `gt.${row(2, null).id}`, returned: 2 },
    ])
    expect(io.notifications[2].read_at).toBe(now)
  })

  it('releases the reservation after a failed lookup so a recovered same-key request can succeed', async () => {
    vi.spyOn(console, 'error').mockImplementationOnce(() => undefined)
    // Exhaust the SDK's initial GET and its three retries only after the first lookup page.
    io.notifications = Array.from({ length: 1002 }, (_, index) => row(index + 1, null))
    io.afterLookup = () => { io.lookupFailuresRemaining = 4 }
    const selected = io.notifications[1000]
    const key = 'synthetic-read-resume-key'
    const failed = await post(key, [selected])
    expect(failed.status).toBe(500)
    expect(await failed.json()).toMatchObject({ error: { code: 'customer_portal_internal_error' } })
    expect(io.claims).toEqual([])
    expect(io.notificationWrites).toBe(0)
    expect(io.lookupFailuresRemaining).toBe(0)
    expect(selected.read_at).toBeNull()

    const fixed = await post(key, [selected])
    expect(fixed.status).toBe(200)
    const receipt = (await fixed.json()).data
    expect(receipt).toEqual({ updated_count: 1, notification_references: [reference(selected)], read_at: now })
    expect(io.notificationWrites).toBe(1)
    const replay = await post(key, [selected])
    expect(replay.status).toBe(200)
    expect((await replay.json()).data).toEqual(receipt)
    expect(io.notificationWrites).toBe(1)
  })

  it('retains the same-key protection if acknowledgment fails after a read mark was written', async () => {
    vi.spyOn(console, 'error').mockImplementationOnce(() => undefined)
    io.failMarkAcknowledgment = true
    const key = 'synthetic-read-write-ack'
    const selected = io.notifications[1]
    const failed = await post(key, [selected])
    expect(failed.status).toBe(500)
    expect(selected.read_at).toBe(now)
    expect(io.claims[0].status).toBe('failed')
    const retry = await post(key, [selected])
    expect(retry.status).toBe(409)
    expect(await retry.json()).toMatchObject({ error: { code: 'idempotency_previous_attempt_failed' } })
    expect(io.notificationWrites).toBe(1)
  })

  it('replays the initial receipt when the same set arrives in a different order with duplicates', async () => {
    const [firstRow, secondRow] = io.notifications
    const key = 'synthetic-read-order-001'
    const initial = await post(key, [firstRow, secondRow])
    expect(initial.status).toBe(200)
    const receipt = (await initial.json()).data

    const replay = await post(key, [secondRow, secondRow, firstRow])
    expect(replay.status).toBe(200)
    expect((await replay.json()).data).toEqual(receipt)
    expect(io.notificationWrites).toBe(1)

    const conflict = await post(key, [secondRow])
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ error: { code: 'idempotency_conflict' } })
    expect(io.notificationWrites).toBe(1)
  })

  it('replays an older true receipt in its stored order without writing any notification', async () => {
    const selected = io.notifications.slice(0, 2).sort((left, right) => String(reference(left)) < String(reference(right)) ? 1 : -1)
    const key = 'synthetic-read-legacy-001'
    const receipt = legacyClaim(key, selected.map(reference))
    const replay = await post(key, [...selected].reverse())
    expect(replay.status).toBe(200)
    expect((await replay.json()).data).toEqual(receipt.data)
    expect(io.notificationWrites).toBe(0)
  })

  it('rejects an older corrupted receipt whose original order fails the stored hash check', async () => {
    const selected = io.notifications.slice(0, 2).sort((left, right) => String(reference(left)) < String(reference(right)) ? 1 : -1)
    const key = 'synthetic-read-legacy-002'
    const reversed = [...selected].reverse()
    legacyClaim(key, selected.map(reference), reversed.map(reference))
    const response = await post(key, reversed)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'idempotency_conflict' } })
    expect(io.notificationWrites).toBe(0)
  })

  it.each([
    ['processing', 'idempotency_in_progress'],
    ['failed', 'idempotency_previous_attempt_failed'],
  ])('keeps the older %s attempt protected for the original input order', async (status, code) => {
    const selected = io.notifications.slice(0, 2).sort((left, right) => String(reference(left)) < String(reference(right)) ? 1 : -1)
    const key = `synthetic-read-legacy-${status}`
    legacyClaim(key, selected.map(reference), undefined, status)
    const response = await post(key, selected)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code } })
    expect(io.notificationWrites).toBe(0)
  })
})
