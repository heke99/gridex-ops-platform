import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiInputError } from '@/lib/api/strictRequest'
import { encodePortalCursor, PortalCursorError } from '@/lib/customer-portal/keysetPagination'

const fixture = vi.hoisted(() => ({
  scopes: [] as string[][],
  queries: [] as Array<Array<[string, ...unknown[]]>>,
  rows: [] as Array<Record<string, unknown>>,
  denied: false,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/env/supabaseServer', () => ({
  getSupabaseServiceEnv: () => ({ serviceRoleKey: 'isolated-synthetic-metering-cursor-key' }),
}))
vi.mock('@/lib/customer-portal/externalApi', () => ({
  requireCustomerPortalApiContext: async (_request: unknown, scopes: string[]) => {
    fixture.scopes.push(scopes)
    if (fixture.denied) return { ok: false, response: Response.json({ error: { code: 'forbidden' } }, { status: 403 }) }
    return {
      ok: true, startedAt: 1,
      client: { id: 'synthetic-client', company_id: 'synthetic-company' },
      identity: { customer_id: 'synthetic-customer', external_customer_id: null },
    }
  },
  customerPortalJson: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  logCustomerPortalSuccess: vi.fn(),
  normalizeFacility: (value: string) => value.replace(/\D/g, ''),
  handleCustomerPortalRouteError: ({ error }: { error: unknown }) => {
    if (error instanceof ApiInputError || error instanceof PortalCursorError) {
      return Response.json({ error: { code: error.code, field: error.field } }, { status: error.status })
    }
    throw error
  },
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      const calls: Array<[string, ...unknown[]]> = [['from', table]]
      fixture.queries.push(calls)
      const query = {
        select: (...args: unknown[]) => { calls.push(['select', ...args]); return query },
        eq: (...args: unknown[]) => { calls.push(['eq', ...args]); return query },
        gte: (...args: unknown[]) => { calls.push(['gte', ...args]); return query },
        lte: (...args: unknown[]) => { calls.push(['lte', ...args]); return query },
        order: (...args: unknown[]) => { calls.push(['order', ...args]); return query },
        limit: (...args: unknown[]) => { calls.push(['limit', ...args]); return query },
        or: (...args: unknown[]) => { calls.push(['or', ...args]); return query },
        then: (resolve: (value: unknown) => unknown) => resolve({ data: fixture.rows, error: null }),
      }
      return query
    },
  },
}))

import { GET } from '@/app/api/v1/customer/metering-values/route'

const path = '/api/v1/customer/metering-values'
const period = '2026-09-29T00:00:00Z'
const first = {
  id: '11111111-1111-4111-8111-111111111111',
  metering_point_id: '22222222-2222-4222-8222-222222222222',
  period_start: period, period_end: '2026-09-29T01:00:00Z',
  quantity_kwh: '1.25', raw_payload: { secret: 'internal' }, customer_id: 'private-customer',
}
const second = { ...first, id: '33333333-3333-4333-8333-333333333333', period_start: '2026-09-28T23:00:00Z' }
const request = (query: string) => new NextRequest(`https://gridex.example.test${path}${query}`)

describe('actual delegated metering read against synthetic service rows', () => {
  beforeEach(() => {
    fixture.scopes.length = 0
    fixture.queries.length = 0
    fixture.rows = [first, second]
    fixture.denied = false
  })

  it('scopes and filters before limit, projects public DTO and binds a second page cursor', async () => {
    const filters = '?from=2026-09-01T00%3A00%3A00Z&to=2026-09-30T00%3A00%3A00Z&facility_id=735999000000000001&limit=1'
    const response = await GET(request(filters))
    expect(response.status).toBe(200)
    expect(fixture.scopes).toEqual([['customer_metering.read']])
    const calls = fixture.queries[0]
    expect(calls).toContainEqual(['from', 'normalized_metering_values'])
    expect(calls).toContainEqual(['eq', 'company_id', 'synthetic-company'])
    expect(calls).toContainEqual(['eq', 'customer_id', 'synthetic-customer'])
    expect(calls).toContainEqual(['eq', 'facility_id', '735999000000000001'])
    expect(calls).toContainEqual(['gte', 'period_start', '2026-09-01T00:00:00Z'])
    expect(calls).toContainEqual(['lte', 'period_end', '2026-09-30T00:00:00Z'])
    expect(calls).toContainEqual(['limit', 2])
    const body = await response.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({ quantity_kwh: 1.25, period_start: period })
    expect(body.data[0].metering_value_reference).toMatch(/^metering_value_[A-Za-z0-9_-]{32}$/)
    expect(JSON.stringify(body)).not.toMatch(/secret|private-customer|raw_payload/)
    expect(body.page).toMatchObject({ limit: 1, returned: 1, has_more: true })

    fixture.rows = [second]
    const next = await GET(request(`${filters}&cursor=${encodeURIComponent(body.page.next_cursor)}`))
    expect(next.status).toBe(200)
    expect(fixture.queries[1]).toContainEqual([
      'or', `period_start.lt.${period},and(period_start.eq.${period},id.lt.${first.id})`,
    ])
    expect((await next.json()).page).toMatchObject({ returned: 1, has_more: false, next_cursor: null })
  })

  it('rejects another customer or another filter cursor before querying the table', async () => {
    const foreign = encodePortalCursor({
      companyId: 'synthetic-company', customerId: 'other-customer',
      resource: 'metering-values:::', tuple: { orderValue: period, id: first.id },
    })
    const otherFilter = encodePortalCursor({
      companyId: 'synthetic-company', customerId: 'synthetic-customer',
      resource: 'metering-values:::', tuple: { orderValue: period, id: first.id },
    })
    const otherCompany = encodePortalCursor({
      companyId: 'other-company', customerId: 'synthetic-customer',
      resource: 'metering-values:::', tuple: { orderValue: period, id: first.id },
    })
    for (const url of [`?cursor=${foreign}`, `?cursor=${otherCompany}`, `?from=2026-09-01T00%3A00%3A00Z&cursor=${otherFilter}`, '?cursor=invalid']) {
      const response = await GET(request(url))
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'invalid_cursor', field: 'cursor' } })
    }
    expect(fixture.queries).toHaveLength(0)
  })

  it('does not query metering rows when customer delegation is denied', async () => {
    fixture.denied = true
    const response = await GET(request('?limit=1'))
    expect(response.status).toBe(403)
    expect(fixture.scopes).toEqual([['customer_metering.read']])
    expect(fixture.queries).toHaveLength(0)
  })

  it('rejects malformed timestamps before a service query', async () => {
    for (const url of ['?from=not-a-date', '?to=2026-02-30T00%3A00%3A00Z']) {
      const response = await GET(request(url))
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'invalid_time_filter' } })
    }
    expect(fixture.queries).toHaveLength(0)
  })

  it('interprets date-only bounds at UTC midnight', async () => {
    const response = await GET(request('?from=2026-09-01&to=2026-09-30&limit=1'))
    expect(response.status).toBe(200)
    expect(fixture.queries[0]).toContainEqual(['gte', 'period_start', '2026-09-01T00:00:00Z'])
    expect(fixture.queries[0]).toContainEqual(['lte', 'period_end', '2026-09-30T00:00:00Z'])
  })

  it('does not turn a supplied invalid facility filter into an unfiltered customer read', async () => {
    const response = await GET(request('?facility_id=not-a-facility'))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_facility_id', field: 'facility_id' } })
    expect(fixture.queries).toHaveLength(0)
  })
})
