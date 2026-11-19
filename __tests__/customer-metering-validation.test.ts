import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ports = vi.hoisted(() => ({
  queries: [] as URL[],
  audit: vi.fn(),
  allowed: true,
  company: '00000000-0000-4000-8000-000000000001',
  customer: '00000000-0000-4000-8000-000000000002',
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/integrations/apiAuth', async original => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(),
  logIntegrationApiRequest: ports.audit,
  currentIntegrationApiResponseContext: () => null,
}))
vi.mock('@/lib/customer-portal/externalApi', async original => {
  const actual = await original<typeof import('@/lib/customer-portal/externalApi')>()
  return {
    ...actual,
    requireCustomerPortalApiContext: async () => ports.allowed ? {
      ok: true,
      client: { id: 'synthetic-client', company_id: ports.company },
      identity: { customer_id: ports.customer },
      startedAt: 25,
    } : {
      ok: false,
      response: actual.customerPortalJson({ error: 'Synthetic access denied', code: 'scope_denied' }, { status: 403 }),
    },
  }
})
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.test', 'synthetic-key', {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        fetch: async input => {
          const query = new URL(input instanceof Request ? input.url : String(input))
          expect(query.origin).toBe('https://synthetic.example.test')
          expect(query.pathname).toBe('/rest/v1/normalized_metering_values')
          ports.queries.push(query)
          if (query.searchParams.get('period_start') === 'gte.not-a-date') {
            return Response.json({ code: '22007', message: 'synthetic malformed date' }, { status: 400 })
          }
          return Response.json([])
        },
      },
    }),
  }
})

import { GET } from '@/app/api/v1/customer/metering-values/route'
import { buildPortalDatabasePage } from '@/lib/customer-portal/keysetPagination'

beforeEach(() => {
  ports.audit.mockClear()
  ports.queries = []
  ports.allowed = true
})

function read(filters: Record<string, string> = {}) {
  const query = new URLSearchParams(filters)
  return GET(new NextRequest(`https://synthetic.example.test/api/v1/customer/metering-values?${query}`))
}

describe('customer metering filters', () => {
  it.each<{ filters: Record<string, string>; field: string; code: string }>([
    { filters: { facility_id: 'unknown' }, field: 'facility_id', code: 'invalid_facility_id' },
    { filters: { facility_id: '' }, field: 'facility_id', code: 'invalid_facility_id' },
    { filters: { facility_id: '73599900000000123' }, field: 'facility_id', code: 'invalid_facility_id' },
    { filters: { facility_id: 'site-735999000000001234' }, field: 'facility_id', code: 'invalid_facility_id' },
    { filters: { from: 'not-a-date' }, field: 'from', code: 'invalid_date' },
    { filters: { from: '2026-02-30T00:00:00Z' }, field: 'from', code: 'invalid_date' },
    { filters: { from: '2026-02-30' }, field: 'from', code: 'invalid_date' },
    { filters: { to: '2026-10-12T24:01:00Z' }, field: 'to', code: 'invalid_date' },
    { filters: { to: '2026-10-12T24:00:00.000001' }, field: 'to', code: 'invalid_date' },
    { filters: { to: '2026-02-30T01:00:00' }, field: 'to', code: 'invalid_date' },
    { filters: { to: '2026-10-12T01:00:00+16:00' }, field: 'to', code: 'invalid_date' },
    {
      filters: { from: '2026-10-12T02:00:00Z', to: '2026-10-12T01:00:00Z' },
      field: 'to', code: 'invalid_date_range',
    },
    {
      filters: { from: '2026-10-12T02:00:00.000002+02:00', to: '2026-10-12T00:00:00.000001Z' },
      field: 'to', code: 'invalid_date_range',
    },
  ])('rejects $filters as $code without reading metering rows', async ({ filters, field, code }) => {
    const response = await read(filters)
    expect({ status: response.status, reads: ports.queries.length }).toEqual({ status: 422, reads: 0 })
    expect(await response.json()).toMatchObject({ error: { code, field, retryable: false } })
    expect(ports.audit).toHaveBeenCalledOnce()
    expect(ports.audit).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422, errorCode: code, metadata: { field } }))
  })

  it('preserves equivalent explicit offsets, microseconds and formatted facility selection', async () => {
    const from = '2026-10-12T02:00:00.000001+02:00'
    const to = '2026-10-12T00:00:00.000001Z'
    const response = await read({ facility_id: '735 999-000000001234', from, to })
    expect(response.status).toBe(200)
    expect(ports.queries).toHaveLength(1)
    expect(Object.fromEntries(ports.queries[0].searchParams)).toMatchObject({
      company_id: 'eq.' + ports.company, customer_id: 'eq.' + ports.customer,
      facility_id: 'eq.735999000000001234', period_start: 'gte.' + from, period_end: 'lte.' + to,
      revision_status: 'eq.current', order: 'period_start.desc.nullslast,id.desc',
    })
    expect(ports.audit).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 200, metadata: expect.objectContaining({ result_count: 0 }) }))
  })

  it('leaves a valid date-only bound for the database to interpret', async () => {
    expect((await read({ from: '2024-02-29' })).status).toBe(200)
    const filters = ports.queries[0].searchParams
    expect(filters.get('period_start')).toBe('gte.2024-02-29')
    expect(filters.has('period_end')).toBe(false)
    expect(filters.has('facility_id')).toBe(false)
  })

  it.each([
    ['2026-10-25T02:40:00.000001', '2026-10-25T02:55:00'],
    ['2026-10-25T02:40:00', '2026-10-25T01:55:00Z'],
    ['2026-03-29T03:05:00', '2026-03-29T02:45:00'],
    ['2026-10-25T24:00:00', '2026-10-26T00:30:00'],
  ])('sends locally interpreted bounds %s and %s without imposing UTC order', async (from, to) => {
    expect((await read({ from, to })).status).toBe(200)
    expect(ports.queries).toHaveLength(1)
    const filters = ports.queries[0].searchParams
    expect(filters.get('period_start')).toBe(`gte.${from}`)
    expect(filters.get('period_end')).toBe(`lte.${to}`)
  })

  it('compares explicit end-of-day midnight at the start of the next day', async () => {
    const from = '2026-10-25T24:00:00.000000+02:00'
    const to = '2026-10-25T22:00:00Z'
    expect((await read({ from, to })).status).toBe(200)
    expect(ports.queries).toHaveLength(1)
    expect(ports.queries[0].searchParams.get('period_start')).toBe(`gte.${from}`)
    expect(ports.queries[0].searchParams.get('period_end')).toBe(`lte.${to}`)
  })

  it('continues an existing cursor bound to the original filter spelling', async () => {
    const from = '2024-02-29'
    const to = '2024-03-01 01:00:00+01'
    const facility = '735999000000001234'
    const periodStart = '2024-02-29T18:00:00.000001Z'
    const id = '00000000-0000-4000-8000-000000000003'
    const { page } = buildPortalDatabasePage([
      { id, period_start: periodStart },
      { id: '00000000-0000-4000-8000-000000000004', period_start: '2024-02-29T17:00:00Z' },
    ], {
      companyId: ports.company, customerId: ports.customer, orderColumn: 'period_start', limit: 1,
      resource: `metering-values:${from}:${to}:${facility}`,
    })
    expect(page.next_cursor).toEqual(expect.any(String))

    const response = await read({ from, to, facility_id: facility, cursor: page.next_cursor ?? '' })
    expect(response.status).toBe(200)
    expect(ports.queries).toHaveLength(1)
    const filters = ports.queries[0].searchParams
    expect(filters.get('or')).toContain(`period_start.lt.${periodStart}`)
    expect(filters.get('or')).toContain(`id.lt.${id}`)
    expect(filters.get('period_start')).toBe('gte.2024-02-29')
    expect(filters.get('period_end')).toBe(`lte.${to}`)
  })

  it('leaves omitted filters absent on the authorized customer feed', async () => {
    expect((await read({ to: '' })).status).toBe(200)
    expect(ports.queries).toHaveLength(1)
    for (const field of ['period_start', 'period_end', 'facility_id']) {
      expect(ports.queries[0].searchParams.has(field)).toBe(false)
    }
  })

  it('keeps ordinary scope denial before filter handling', async () => {
    ports.allowed = false
    expect((await read({ facility_id: 'invalid' })).status).toBe(403)
    expect(ports.queries).toHaveLength(0)
    expect(ports.audit).not.toHaveBeenCalled()
  })
})
