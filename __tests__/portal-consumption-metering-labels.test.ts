import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PortalConsumptionPage from '@/app/portal/forbrukning/page'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  reads: [] as Readonly<{ table: string; query: URLSearchParams }>[],
  legacySchema: false,
  failPoints: false,
}))
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = uuid(1), otherCompany = uuid(2), customer = uuid(3), sameCompanyOtherCustomer = uuid(4), otherCompanyCustomer = uuid(5)
const user = uuid(6), ownSite = uuid(7), wrongSite = uuid(8), foreignSite = uuid(9)
const modern = uuid(11), old = uuid(12), stale = uuid(13), foreign = uuid(14), conflictingCustomer = uuid(15), untrustedNumber = '00000000-0000-7000-8000-000000000016'
const modernNumber = '735999000000000111', legacyNumber = '735999000000000222'
const invalidNumbers = ['735999000000000333', '735999000000000444', '735999000000000555']
const at = '2026-10-14T12:00:00Z'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: user, email: 'reader@example.test' } } }) } }),
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://synthetic.example.test', 'fixture-only', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: readFixture },
  }) }
})

function value(n: number, point: string, readingType: string, quality: string | null, overrides: Row = {}): Row {
  return { id: uuid(n), company_id: company, customer_id: customer, site_id: ownSite,
    metering_point_id: point, value_kwh: 5.25, reading_type: readingType, quality_code: quality, is_current: true, revision_status: 'current',
    created_at: at, period_start: at, period_end: at, read_at: at, ...overrides }
}

const tables: Record<string, Row[]> = {
  customer_portal_accounts: [
    { user_id: user, customer_id: customer, company_id: company, is_active: true, activated_at: '2026-10-13T00:00:00Z' },
    { user_id: user, customer_id: otherCompanyCustomer, company_id: otherCompany, is_active: true, activated_at: '2026-10-01T00:00:00Z' },
  ],
  customers: [{ id: customer, company_id: company }, { id: otherCompanyCustomer, company_id: otherCompany }],
  companies: [{ id: company, name: 'Test El' }, { id: otherCompany, name: 'Annat elbolag' }],
  metering_values: [
    value(101, modern, 'consumption', 'measured'), value(102, old, 'production', 'estimated'),
    value(103, stale, 'provider_unknown_reading', 'provider_unknown_quality'), value(104, foreign, 'consumption', null),
    value(105, conflictingCustomer, 'consumption', 'preliminary'),
    value(107, untrustedNumber, 'consumption', null),
    value(106, modern, 'consumption', null, { company_id: otherCompany, customer_id: otherCompanyCustomer, value_kwh: 692 }),
  ],
  metering_points: [
    { id: modern, company_id: company, customer_id: customer, customer_site_id: ownSite, site_id: null, meter_point_id: modernNumber },
    { id: old, company_id: company, customer_id: null, customer_site_id: null, site_id: ownSite, meter_point_id: legacyNumber },
    { id: stale, company_id: company, customer_id: null, customer_site_id: wrongSite, site_id: ownSite, meter_point_id: invalidNumbers[0] },
    { id: foreign, company_id: otherCompany, customer_id: otherCompanyCustomer, customer_site_id: foreignSite, site_id: foreignSite, meter_point_id: invalidNumbers[1] },
    { id: conflictingCustomer, company_id: company, customer_id: sameCompanyOtherCustomer, customer_site_id: ownSite, site_id: null, meter_point_id: invalidNumbers[2] },
    { id: untrustedNumber, company_id: company, customer_id: customer, customer_site_id: ownSite, site_id: ownSite, meter_point_id: untrustedNumber },
  ],
  customer_sites: [
    { id: ownSite, company_id: company, customer_id: customer },
    { id: wrongSite, company_id: company, customer_id: sameCompanyOtherCustomer },
    { id: foreignSite, company_id: otherCompany, customer_id: otherCompanyCustomer },
  ],
}

async function readFixture(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init)
  const url = new URL(request.url)
  expect(url.origin).toBe('https://synthetic.example.test')
  const table = url.pathname.split('/').at(-1)!
  const query = url.searchParams
  if (table === 'gridex_portal_monthly_consumption_v1') {
    expect(await request.json()).toMatchObject({ p_company_id: company, p_customer_ids: [customer] })
    return Response.json([])
  }
  expect(request.method).toBe('GET')
  io.reads.push({ table, query })
  const columns = query.get('select')!.split(',')
  if (table === 'metering_points') {
    if (io.failPoints) return Response.json({ code: '58000', message: 'Synthetic metering read error' }, { status: 500 })
    if (io.legacySchema && columns.includes('customer_site_id')) return Response.json({ code: '42703', message: 'column metering_points.customer_site_id does not exist' }, { status: 400 })
  }
  const rows = tables[table]
  if (!rows) throw new Error(`Unexpected synthetic table ${table}`)
  return Response.json(rows.filter(row => {
    for (const [key, condition] of query) {
      if (['select', 'limit', 'order'].includes(key)) continue
      if (key === 'or') {
        const allowed = /^\(customer_id\.is\.null,customer_id\.in\.\(([^)]+)\)\)$/.exec(condition)
        expect(allowed).not.toBeNull()
        if (row.customer_id == null || allowed![1].split(',').includes(String(row.customer_id))) continue
      } else if (condition.startsWith('eq.') && String(row[key]) === condition.slice(3)) continue
      else if (condition.startsWith('in.(') && condition.slice(4, -1).split(',').includes(String(row[key]))) continue
      return false
    }
    return true
  }).map(row => Object.fromEntries(columns.map(key => [key, row[key] ?? null]))))
}

beforeEach(() => {
  vi.stubGlobal('React', React)
  io.reads = []
  io.legacySchema = false
  io.failPoints = false
})
afterEach(() => vi.unstubAllGlobals())

async function page() {
  return renderToStaticMarkup(await PortalConsumptionPage())
}

it('renders only verified public meter numbers and controlled Swedish labels', async () => {
  const html = await page()
  expect(html).toContain(`Mätpunkt ${modernNumber}`)
  expect(html).toContain(`Mätpunkt ${legacyNumber}`)
  expect(html).toContain('Förbrukning')
  expect(html).toContain('Uppmätt värde')
  expect(html).toContain('Produktion')
  expect(html).toContain('Uppskattat värde')
  expect(html).toContain('Okänd mättyp')
  expect(html).toContain('Okänd kvalitet')
  expect(html).toContain('Kvalitet ej angiven')
  expect(html.match(/Mätpunktsnummer saknas/g)).toHaveLength(4)
  for (const absent of [modern, old, stale, foreign, conflictingCustomer, untrustedNumber, ...invalidNumbers, 'provider_unknown_reading', 'provider_unknown_quality', '692 kWh']) {
    expect(html).not.toContain(absent)
  }
  const meterQuery = io.reads.find(row => row.table === 'metering_points')?.query
  expect(meterQuery?.get('company_id')).toBe(`eq.${company}`)
  expect(meterQuery?.get('id')).toBe(`in.(${[modern, old, stale, foreign, conflictingCustomer, untrustedNumber].join(',')})`)
  const siteQuery = io.reads.find(row => row.table === 'customer_sites')?.query
  expect(siteQuery?.get('company_id')).toBe(`eq.${company}`)
  expect(siteQuery?.get('customer_id')).toBe(`in.(${customer})`)
})

it('retains the legacy meter number when the older schema has no canonical site link column', async () => {
  io.legacySchema = true
  const html = await page()
  expect(html).toContain(`Mätpunkt ${legacyNumber}`)
  expect(html).not.toContain(foreign)
  expect(html).not.toContain(invalidNumbers[1])
  expect(io.reads.filter(row => row.table === 'metering_points').map(row => row.query.get('select')?.includes('customer_site_id'))).toEqual([true, false])
})

it('preserves available consumption when meter-number lookup fails', async () => {
  io.failPoints = true
  const html = await page()
  expect(html).toContain('5,25 kWh')
  expect(html).toContain('Mätpunktsnumret kunde inte hämtas')
  expect(html).not.toContain(modern)
  expect(html).not.toContain('Synthetic metering read error')
  expect(io.reads.filter(row => row.table === 'metering_points')).toHaveLength(1)
})
