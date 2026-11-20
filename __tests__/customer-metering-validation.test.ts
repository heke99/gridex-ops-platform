import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ports = vi.hoisted(() => ({
  queries: [] as URL[],
  rows: [] as Array<{ id: string; period_start: string; period_end: string; facility_id: string; quantity_kwh: number }>,
  backendFailure: null as { status: number; code: string; message: string } | null,
  audit: vi.fn(),
  auditWrites: [] as Array<Record<string, unknown>>,
  persistAudit: false,
  useActualAuthorization: false,
  allowed: true,
  company: '00000000-0000-4000-8000-000000000001',
  customer: '00000000-0000-4000-8000-000000000002',
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/integrations/apiAuth', async original => {
  const actual = await original<typeof import('@/lib/integrations/apiAuth')>()
  return {
    ...actual,
    logIntegrationApiRequest: async (input: Parameters<typeof actual.logIntegrationApiRequest>[0]) => {
      ports.audit(input)
      if (ports.persistAudit) await actual.logIntegrationApiRequest(input)
    },
    currentIntegrationApiResponseContext: () => null,
  }
})
vi.mock('@/lib/customer-portal/externalApi', async original => {
  const actual = await original<typeof import('@/lib/customer-portal/externalApi')>()
  return {
    ...actual,
    requireCustomerPortalApiContext: async (...args: Parameters<typeof actual.requireCustomerPortalApiContext>) => {
      if (ports.useActualAuthorization) return actual.requireCustomerPortalApiContext(...args)
      return ports.allowed ? {
        ok: true,
        client: { id: 'synthetic-client', company_id: ports.company },
        identity: { customer_id: ports.customer },
        startedAt: 25,
      } : {
        ok: false,
        response: actual.customerPortalJson({ error: 'Synthetic access denied', code: 'scope_denied' }, { status: 403 }),
      }
    },
  }
})
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.test', 'synthetic-key', {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        fetch: async (input, init) => {
          const request = input instanceof Request ? input : new Request(input, init)
          const query = new URL(request.url)
          expect(query.origin).toBe('https://synthetic.example.test')
          if (query.pathname === '/rest/v1/integration_api_requests') {
            expect(request.method).toBe('POST')
            ports.auditWrites.push(await request.json())
            return new Response(null, { status: 201 })
          }
          expect(query.pathname).toBe('/rest/v1/normalized_metering_values')
          ports.queries.push(query)
          if (query.searchParams.get('period_start') === 'gte.not-a-date') {
            return Response.json({ code: '22007', message: 'synthetic malformed date' }, { status: 400 })
          }
          if (ports.backendFailure) {
            const { status, ...error } = ports.backendFailure
            return Response.json({ ...error, details: 'synthetic-backend-detail', hint: 'synthetic-backend-hint' }, { status })
          }
          return Response.json(query.searchParams.has('or') ? ports.rows.slice(1) : ports.rows)
        },
      },
    }),
  }
})

import { GET } from '@/app/api/v1/customer/metering-values/route'
import { buildPortalDatabasePage } from '@/lib/customer-portal/keysetPagination'

beforeEach(() => {
  ports.audit.mockClear()
  ports.auditWrites = []
  ports.persistAudit = false
  ports.useActualAuthorization = false
  ports.queries = []
  ports.rows = []
  ports.backendFailure = null
  ports.allowed = true
})

function read(filters: Record<string, string> = {}, headers?: HeadersInit) {
  const query = new URLSearchParams(filters)
  return GET(new NextRequest(`https://synthetic.example.test/api/v1/customer/metering-values?${query}`, { headers }))
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
    expect(filters.getAll('period_start')).toEqual(['gte.2024-02-29', `lte.${periodStart}`])
    expect(filters.get('period_end')).toBe(`lte.${to}`)
  })

  it('preserves a continuation without a facility filter', async () => {
    const periodStart = '2026-11-19T01:00:00.000001Z'
    const id = '00000000-0000-4000-8000-000000000009'
    const { page } = buildPortalDatabasePage([
      { id, period_start: periodStart },
      { id: '00000000-0000-4000-8000-000000000008', period_start: periodStart },
    ], {
      companyId: ports.company, customerId: ports.customer, orderColumn: 'period_start', limit: 1,
      resource: 'metering-values:::',
    })
    expect(page.next_cursor).toEqual(expect.any(String))

    expect((await read({ cursor: page.next_cursor ?? '' })).status).toBe(200)
    expect(ports.queries).toHaveLength(1)
    const filters = ports.queries[0].searchParams
    expect(filters.has('facility_id')).toBe(false)
    expect(filters.has('period_start')).toBe(false)
    expect(filters.get('or')).toBe(`(period_start.lt.${periodStart},and(period_start.eq.${periodStart},id.lt.${id}))`)
  })

  it('leaves omitted filters absent on the authorized customer feed', async () => {
    expect((await read({ to: '' })).status).toBe(200)
    expect(ports.queries).toHaveLength(1)
    for (const field of ['period_start', 'period_end', 'facility_id']) {
      expect(ports.queries[0].searchParams.has(field)).toBe(false)
    }
  })

  it('continues an issued metering cursor only with the same facility and filters', async () => {
    const facilityId = '735999000000001234'
    const from = '2026-11-19T00:00:00Z'
    const to = '2026-11-20T00:00:00Z'
    const first = {
      id: '00000000-0000-4000-8000-000000000009',
      period_start: '2026-11-19T01:00:00.000001Z',
      period_end: '2026-11-19T01:15:00Z',
      facility_id: facilityId,
      quantity_kwh: 12,
    }
    const next = {
      ...first,
      id: '00000000-0000-4000-8000-000000000008',
      quantity_kwh: 9,
    }
    ports.rows = [first, next]
    const filters = { facility_id: facilityId, from, to, limit: '1' }
    const firstResponse = await read(filters)
    expect(firstResponse.status).toBe(200)
    const firstPage = await firstResponse.json()
    expect(firstPage.data).toHaveLength(1)
    expect(firstPage.page.next_cursor).toEqual(expect.any(String))
    expect(ports.queries[0].searchParams.getAll('period_start')).toEqual([`gte.${from}`])
    const cursor = firstPage.page.next_cursor

    const continued = await read({ ...filters, cursor })
    expect(continued.status).toBe(200)
    expect(await continued.json()).toMatchObject({
      data: [{ quantity_kwh: 9 }], page: { returned: 1, has_more: false, next_cursor: null },
    })
    expect(ports.queries).toHaveLength(2)
    const continuedFilters = ports.queries[1].searchParams
    expect(continuedFilters.getAll('period_start')).toEqual([`gte.${from}`, `lte.${first.period_start}`])
    expect(Object.fromEntries(continuedFilters)).toMatchObject({
      company_id: `eq.${ports.company}`, customer_id: `eq.${ports.customer}`, facility_id: `eq.${facilityId}`,
      period_end: `lte.${to}`, revision_status: 'eq.current', limit: '2',
      or: `(period_start.lt.${first.period_start},and(period_start.eq.${first.period_start},id.lt.${first.id}))`,
    })

    ports.queries = []
    ports.audit.mockClear()
    const wrongFacility = await read({ ...filters, facility_id: '735999000000004321', cursor })
    expect({ status: wrongFacility.status, reads: ports.queries.length }).toEqual({ status: 400, reads: 0 })
    expect(await wrongFacility.json()).toMatchObject({
      request_id: wrongFacility.headers.get('X-Request-ID'),
      error: { code: 'invalid_cursor', field: 'cursor', retryable: false },
    })
    expect(ports.audit).toHaveBeenCalledOnce()
    expect(ports.audit).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 400, errorCode: 'invalid_cursor', metadata: { field: 'cursor' },
    }))
  })

  it('rejects an invalid cursor before any metering or event read', async () => {
    const response = await read({ cursor: 'synthetic-invalid-cursor' })
    expect({ status: response.status, reads: ports.queries.length }).toEqual({ status: 400, reads: 0 })
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_cursor', field: 'cursor', retryable: false } })
    expect(ports.audit).toHaveBeenCalledOnce()
  })

  it.each([
    { status: 404, code: 'PGRST205', message: "Could not find the table 'public.normalized_metering_values' in the schema cache" },
    { status: 404, code: '42P01', message: 'relation "public.normalized_metering_values" does not exist' },
    { status: 400, code: '42703', message: 'column normalized_metering_values.revision_status does not exist' },
  ])('returns sanitized retryable 503 for the actual missing projection signal $code', async failure => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      ports.backendFailure = failure
      ports.persistAudit = true
      const response = await read({}, { 'x-request-id': 'synthetic-inbound-request-id' })
      expect({ status: response.status, reads: ports.queries.length }).toEqual({ status: 503, reads: 1 })
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      const requestId = response.headers.get('X-Request-ID')
      expect(requestId).toMatch(/^[0-9a-f-]{36}$/)
      const body = await response.json()
      expect(body).toMatchObject({
        request_id: requestId, correlation_id: requestId,
        error: { code: 'platform_schema_not_ready', message: 'Databasschemat är inte verifierat.', retryable: true, field: null, blockers: [] },
      })
      expect(JSON.stringify(body)).not.toContain('synthetic-backend-')
      expect(JSON.stringify(body)).not.toContain('normalized_metering_values')
      expect(report).not.toHaveBeenCalled()
      expect(ports.audit).toHaveBeenCalledOnce()
      expect(ports.audit).toHaveBeenCalledWith(expect.objectContaining({
        statusCode: 503, errorCode: 'platform_schema_not_ready', requestId,
      }))
      expect(ports.audit.mock.calls[0][0].metadata).toBeUndefined()
      await vi.waitFor(() => expect(ports.auditWrites).toHaveLength(1))
      expect(ports.auditWrites[0]).toMatchObject({
        company_id: ports.company, api_client_id: 'synthetic-client', request_id: requestId,
        status_code: 503, error_code: 'platform_schema_not_ready', metadata: {},
      })
      expect(JSON.stringify(ports.auditWrites)).not.toContain('synthetic-backend-')
      expect(JSON.stringify(ports.auditWrites)).not.toContain('normalized_metering_values')
    } finally {
      report.mockRestore()
    }
  })

  it.each([
    { status: 500, code: 'XX000', message: 'Synthetic backend failure' },
    { status: 400, code: '42P10', message: 'there is no unique or exclusion constraint matching this query' },
    { status: 404, code: 'PGRST205', message: "Could not find the table 'public.unrelated' in the schema cache" },
    { status: 400, code: '42703', message: 'column normalized_metering_values.unused_field does not exist' },
    { status: 400, code: '22007', message: 'synthetic date input does not exist in this representation' },
  ])('keeps unrelated backend failure $code on the existing 500 path', async failure => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      ports.backendFailure = failure
      const response = await read()
      expect({ status: response.status, reads: ports.queries.length }).toEqual({ status: 500, reads: 1 })
      const body = await response.json()
      expect(body).toMatchObject({ error: { code: 'customer_portal_internal_error', retryable: false } })
      expect(JSON.stringify(body)).not.toContain('synthetic-backend-')
      expect(ports.audit).toHaveBeenCalledOnce()
      expect(ports.audit).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500, errorCode: 'customer_portal_internal_error' }))
    } finally {
      report.mockRestore()
    }
  })

  it('keeps ordinary scope denial before filter handling', async () => {
    ports.allowed = false
    ports.backendFailure = { status: 404, code: 'PGRST205', message: "Could not find the table 'public.normalized_metering_values' in the schema cache" }
    expect((await read({ facility_id: 'invalid' })).status).toBe(403)
    expect(ports.queries).toHaveLength(0)
    expect(ports.audit).not.toHaveBeenCalled()
  })

  it('rejects an actual credential-free request before checking metering readiness', async () => {
    ports.useActualAuthorization = true
    ports.persistAudit = true
    ports.backendFailure = { status: 404, code: 'PGRST205', message: "Could not find the table 'public.normalized_metering_values' in the schema cache" }
    const response = await read({ facility_id: '735999000000001234' })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: { code: 'missing_api_token' } })
    expect(ports.queries).toEqual([])
    expect(ports.auditWrites).toEqual([])
  })
})
