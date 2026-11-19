import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, string | number>
const io = vi.hoisted(() => ({ queries: [] as URL[], rows: [] as Row[], remainingSchemaFallbacks: 0 }))

const companyId = '00000000-0000-4000-8000-000000000001'
const customerId = '00000000-0000-4000-8000-000000000002'
const facility = '735999000000001234'
const from = '2026-10-12T01:00:00.000Z'
const latest = '2026-10-12T02:00:00.000Z'
const to = '2026-10-12T03:00:00.000Z'
const emptyBundleTables = new Set([
  'customer_contracts',
  'customer_sites',
  'metering_points',
  'customer_legal_acceptances',
  'powers_of_attorney',
  'website_customer_applications',
])

function cursorMatches(row: Row, filter: string | null) {
  if (!filter) return true
  const cursor = /^\(period_start\.lt\.([^,]+),and\(period_start\.eq\.([^,]+),id\.lt\.([^)]+)\)\)$/.exec(filter)
  if (!cursor) throw new Error('Unexpected synthetic cursor filter')
  return String(row.period_start) < cursor[1] || (row.period_start === cursor[2] && String(row.id) < cursor[3])
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ediel/retention/customerRecordClasses', () => ({ requirePortalRetentionAccess: vi.fn() }))
vi.mock('@/lib/integrations/apiAuth', async original => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(),
  logIntegrationApiRequest: vi.fn(),
  currentIntegrationApiResponseContext: () => null,
}))
vi.mock('@/lib/customer-portal/externalApi', async original => ({
  ...await original<typeof import('@/lib/customer-portal/externalApi')>(),
  logCustomerPortalSuccess: vi.fn(),
  requireCustomerPortalApiContext: async () => ({
    ok: true,
    client: { id: 'synthetic-client', company_id: companyId },
    identity: {
      id: 'synthetic-identity',
      customer_id: customerId,
      external_customer_id: 'synthetic-subject',
      customer_number: 'synthetic-number',
      provider: 'synthetic-provider',
      customer: { id: customerId, status: 'active', customer_type: 'private', full_name: 'Testkund' },
    },
  }),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: createClient('http://127.0.0.1:54321', 'synthetic-fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async input => {
        const url = new URL(String(input))
        expect(url.origin).toBe('http://127.0.0.1:54321')
        const table = url.pathname.split('/').at(-1)
        if (table && emptyBundleTables.has(table)) return Response.json([])
        if (table !== 'normalized_metering_values') throw new Error(`Unsupported synthetic table ${table}`)
        io.queries.push(url)
        if (io.remainingSchemaFallbacks > 0) {
          io.remainingSchemaFallbacks -= 1
          return Response.json({ code: '42703', message: 'Optional projection column does not exist' }, { status: 400 })
        }
        const filterFields = new Set(['select', 'order', 'limit', 'or'])
        const filters = [...url.searchParams].filter(([field]) => !filterFields.has(field))
        const rows = io.rows.filter(row => filters.every(([field, filter]) => {
          const dot = filter.indexOf('.')
          const operator = filter.slice(0, dot)
          const value = filter.slice(dot + 1)
          if (operator === 'eq') return String(row[field]) === value
          if (operator === 'gte') return String(row[field]) >= value
          if (operator === 'lte') return String(row[field]) <= value
          throw new Error(`Unsupported synthetic filter ${operator}`)
        }) && cursorMatches(row, url.searchParams.get('or')))
        const ordering = url.searchParams.get('order')?.split(',') ?? []
        rows.sort((left, right) => {
          for (const field of ordering) {
            const [column, direction] = field.split('.')
            const order = String(left[column]).localeCompare(String(right[column]))
            if (order !== 0) return direction === 'desc' ? -order : order
          }
          return 0
        })
        const columns = url.searchParams.get('select')?.split(',') ?? []
        const limit = Number(url.searchParams.get('limit') ?? rows.length)
        return Response.json(rows.slice(0, limit).map(row =>
          Object.fromEntries(columns.filter(column => column in row).map(column => [column, row[column]])),
        ))
      },
    },
  }),
}))

import { GET as getMeteringValues } from '@/app/api/v1/customer/metering-values/route'
import { GET as getPortalBundle } from '@/app/api/v1/customer/portal-bundle/route'
import { logCustomerPortalSuccess } from '@/lib/customer-portal/externalApi'

function reading(id: number, quantity: number, start: string, end: string): Row {
  return {
    id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    company_id: companyId, customer_id: customerId, facility_id: facility,
    period_start: start, period_end: end, quantity_kwh: quantity, resolution: 'PT60M',
    status: 'stored', revision_status: 'current', created_at: latest,
  }
}

beforeEach(() => {
  vi.mocked(logCustomerPortalSuccess).mockClear()
  io.queries = []
  io.remainingSchemaFallbacks = 0
  io.rows = [
    { ...reading(12, 90, latest, to), status: 'replaced', revision_status: 'replaced' },
    reading(11, 2.25, latest, to),
    reading(10, 1.75, from, latest),
  ]
})

describe('latest revisions in Customer metering responses', () => {
  it('filters revision and scope before lookahead and advances the actual keyset cursor', async () => {
    io.rows.push(
      reading(18, 40, to, '2026-10-12T04:00:00.000Z'),
      { ...reading(17, 50, latest, to), company_id: 'foreign-company' },
      { ...reading(16, 60, latest, to), customer_id: 'foreign-customer' },
      { ...reading(15, 70, latest, to), facility_id: '735999000000004321' },
    )
    const params = new URLSearchParams({ from, to, facility_id: facility, limit: '1' })
    const path = 'https://ops.example.test/api/v1/customer/metering-values'
    const first = await getMeteringValues(new NextRequest(`${path}?${params}`))
    expect(first.status).toBe(200)
    const page1 = await first.json()
    expect(page1.data).toMatchObject([{ quantity_kwh: 2.25, period_start: latest }])
    expect(page1.page).toMatchObject({ returned: 1, has_more: true })
    expect(typeof page1.page.next_cursor).toBe('string')

    params.set('cursor', page1.page.next_cursor)
    const second = await getMeteringValues(new NextRequest(`${path}?${params}`))
    expect(second.status).toBe(200)
    const page2 = await second.json()
    expect(page2.data).toMatchObject([{ quantity_kwh: 1.75, period_start: from }])
    expect(page2.page).toMatchObject({ returned: 1, has_more: false, next_cursor: null })
    expect(io.queries).toHaveLength(2)
    for (const query of io.queries) {
      expect(query.searchParams.get('revision_status')).toBe('eq.current')
      expect(query.searchParams.get('company_id')).toBe(`eq.${companyId}`)
      expect(query.searchParams.get('customer_id')).toBe(`eq.${customerId}`)
      expect(query.searchParams.get('facility_id')).toBe(`eq.${facility}`)
      expect(query.searchParams.get('period_start')).toBe(`gte.${from}`)
      expect(query.searchParams.get('period_end')).toBe(`lte.${to}`)
      expect(query.searchParams.get('limit')).toBe('2')
    }
    expect(io.queries[1].searchParams.get('or')).toContain(`id.lt.${io.rows[1].id}`)
    expect(logCustomerPortalSuccess).toHaveBeenCalledTimes(2)
    expect(logCustomerPortalSuccess).toHaveBeenNthCalledWith(1, expect.objectContaining({
      resultCount: page1.data.length,
      metadata: expect.objectContaining({ source_table: 'normalized_metering_values', customer_id: customerId, facility_id: facility }),
    }))
    expect(logCustomerPortalSuccess).toHaveBeenNthCalledWith(2, expect.objectContaining({ resultCount: page2.data.length }))
  })

  it('records zero delivered rows when the page is empty', async () => {
    io.rows = []
    const response = await getMeteringValues(new NextRequest(
      'https://ops.example.test/api/v1/customer/metering-values?limit=1',
    ))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: [], page: { returned: 0, has_more: false } })
    expect(logCustomerPortalSuccess).toHaveBeenCalledOnce()
    expect(logCustomerPortalSuccess).toHaveBeenCalledWith(expect.objectContaining({ resultCount: 0 }))
  })

  it('does not record a successful page when canonical metering is unavailable', async () => {
    io.remainingSchemaFallbacks = 1
    const response = await getMeteringValues(new NextRequest(
      'https://ops.example.test/api/v1/customer/metering-values?limit=1',
    ))
    expect(response.ok).toBe(false)
    expect(logCustomerPortalSuccess).not.toHaveBeenCalled()
  })

  it.each([0, 1, 2])('filters before the Portal Bundle limit through %i schema fallbacks', async fallbacks => {
    io.remainingSchemaFallbacks = fallbacks
    const response = await getPortalBundle(new NextRequest(
      'https://ops.example.test/api/v1/customer/portal-bundle?include=metering_values&metering_values_limit=1',
    ))
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.metering_values).toMatchObject([{ quantity_kwh: 2.25, period_start: latest }])
    expect(data.bundle_status.status).toBe('complete')
    expect(io.queries).toHaveLength(fallbacks + 1)
    for (const query of io.queries) {
      expect(query.searchParams.get('revision_status')).toBe('eq.current')
      expect(query.searchParams.get('company_id')).toBe(`eq.${companyId}`)
      expect(query.searchParams.get('customer_id')).toBe(`eq.${customerId}`)
      expect(query.searchParams.get('limit')).toBe('1')
    }
  })
})
