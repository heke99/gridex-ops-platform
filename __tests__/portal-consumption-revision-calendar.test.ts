import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PortalConsumptionPage from '@/app/portal/forbrukning/page'
import { listPortalMeteringValues } from '@/lib/customer-portal/db'
import type { CustomerPortalContext } from '@/lib/customer-portal/types'

type Row = Record<string, unknown>

const io = vi.hoisted(() => ({
  detailReads: [] as URLSearchParams[],
  includeRevisions: false,
  monthReads: 0,
}))

const company = '00000000-0000-4000-8000-000000000001'
const customer = '00000000-0000-4000-8000-000000000002'
const user = '00000000-0000-4000-8000-000000000003'
const foreignCompany = '00000000-0000-4000-8000-000000000004'
const foreignCustomer = '00000000-0000-4000-8000-000000000005'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: user, email: 'reader@example.test' } } }) },
  }),
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.test', 'fixture-only', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: readFixture },
    }),
  }
})

function value(n: number, start: string, end: string, overrides: Row = {}): Row {
  return {
    id: String(n), company_id: company, customer_id: customer, reading_type: 'consumption',
    value_kwh: n, quality_code: 'measured', period_start: start, period_end: end,
    read_at: start, created_at: start, is_current: true, revision_status: 'current', ...overrides,
  }
}

const before = '2025-12-31T22:59:59Z'
const midnight = '2025-12-31T23:00:00Z'
const after = '2025-12-31T23:00:01Z'
const later = '2025-12-31T23:15:00Z'

const rows: Record<string, Row[]> = {
  customer_portal_accounts: [{ user_id: user, company_id: company, customer_id: customer, is_active: true }],
  customers: [{ id: customer, company_id: company }],
  companies: [{ id: company, name: 'Test El' }],
  metering_values: [
    value(7, before, midnight),
    value(13, midnight, after),
    value(19, after, later),
    value(81, later, later, { revision_status: 'replaced', is_current: false }),
    value(82, later, later, { revision_status: 'superseded', is_current: true }),
    value(83, later, later, { revision_status: 'current', is_current: false }),
    value(91, later, later, { company_id: foreignCompany }),
    value(92, later, later, { customer_id: foreignCustomer }),
  ],
}

async function readFixture(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init)
  const url = new URL(request.url)
  expect(url.origin).toBe('https://synthetic.example.test')
  const table = url.pathname.split('/').at(-1)!
  if (table === 'gridex_portal_monthly_consumption_v1') {
    expect(await request.json()).toMatchObject({ p_company_id: company, p_customer_ids: [customer] })
    io.monthReads += 1
    return Response.json([
      { month_key: '2026-01', total_kwh: 32, value_count: 2, is_complete: false },
      { month_key: '2025-12', total_kwh: 7, value_count: 1, is_complete: false },
    ])
  }

  expect(request.method).toBe('GET')
  const query = url.searchParams
  let result = rows[table]
  if (!result) throw new Error(`Unexpected synthetic table ${table}`)
  if (table === 'metering_values') {
    io.detailReads.push(query)
    if (!io.includeRevisions) result = result.filter(row => ![81, 82, 83].includes(Number(row.id)))
  }
  const filter = Array.from(query.entries()).filter(([key]) => !['select', 'limit', 'order'].includes(key))
  result = result.filter(row => filter.every(([key, condition]) =>
    condition.startsWith('eq.')
      ? String(row[key]) === condition.slice(3)
      : condition.startsWith('in.(') && condition.slice(4, -1).split(',').includes(String(row[key])),
  ))
  if (table === 'metering_values') {
    result = [...result].sort((a, b) => String(b.period_start).localeCompare(String(a.period_start)))
    result = result.slice(0, Math.min(Number(query.get('limit')), 3))
  }
  const columns = query.get('select')!.split(',')
  return Response.json(result.map(row => Object.fromEntries(columns.map(key => [key, row[key] ?? null]))))
}

beforeEach(() => {
  vi.stubGlobal('React', React)
  io.detailReads = []
  io.includeRevisions = false
  io.monthReads = 0
})
afterEach(() => vi.unstubAllGlobals())

async function view() {
  return renderToStaticMarkup(await PortalConsumptionPage())
}

it('requests only current customer values before the result limit', async () => {
  io.includeRevisions = true
  const html = await view()
  expect(io.monthReads).toBe(1)
  expect(html).toContain('32 kWh')
  expect(io.detailReads).toHaveLength(1)
  const query = io.detailReads[0]
  expect(query.get('company_id')).toBe(`eq.${company}`)
  expect(query.get('customer_id')).toBe(`in.(${customer})`)
  const visible = [...html.matchAll(/>(\d+) kWh<\/div>/g)].map((match) => Number(match[1]))
  expect(visible).toEqual([19, 13, 7])
  expect(query.get('is_current')).toBe('eq.true')
  expect(query.get('revision_status')).toBe('eq.current')
  expect(query.get('limit')).toBe('500')
  expect(html).toContain('Endast aktuella mätvärden visas')
})

it('preserves the legacy read model for other callers', async () => {
  io.includeRevisions = true
  await expect(listPortalMeteringValues({
    companyId: company, customerIds: [customer],
  } as CustomerPortalContext, { limit: 2 })).resolves.toMatchObject([{ id: '81' }, { id: '82' }])
  expect(io.detailReads[0].has('is_current')).toBe(false)
  expect(io.detailReads[0].has('revision_status')).toBe(false)
})
