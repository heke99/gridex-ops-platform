import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import DeviationsPage from '@/app/admin/analytics/deviations/page'
import { GET } from '@/app/admin/analytics/export/route'

type Issue = {
  id: string
  company_id: string
  entity_type: string
  entity_id: string
  issue_type: string
  severity: string
  message: string
  status: string
  detected_at: string
  period_month: string | null
  source_exists: boolean
}

const io = vi.hoisted(() => ({
  a: '00000000-0000-4000-8000-000000000001',
  b: '00000000-0000-4000-8000-000000000002',
  actor: '00000000-0000-4000-8000-000000000003',
  signedIn: true,
  platform: false,
  company: null as string | null,
  permissions: [] as string[],
  rows: [] as Issue[],
  viewUnavailable: false,
  filterCalls: [] as Array<{ table: string; query: URLSearchParams }>,
}))

vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: io.company }) }) }))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error('REDIRECT ' + path) },
}))
vi.mock('@/lib/tenant/scope', () => ({
  listOperationalCompaniesForUser: async () => [io.a, io.b].map(companyId => ({ companyId, companyStatus: 'active' })),
  getOperationalCompanyScope: async () => { throw new Error('Unexpected legacy company fallback') },
  TenantCompanyRequiredError: class extends Error {},
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: io.signedIn ? { id: io.actor, email: 'ops@example.invalid' } : null }, error: null }) },
    rpc: async (name: string) => {
      expect(name).toBe('canonical_authenticated_tenant_context')
      return { data: {
        authorized: true, user_id: io.actor, selected_company_id: io.company, permissions: io.permissions,
        roles: [io.platform ? 'platform_admin' : 'contract_manager'], is_platform_admin: io.platform,
      }, error: null }
    },
  }),
}))

function simulatedDataApi(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input.toString())
  expect(url.origin).toBe('http://127.0.0.1:54321')
  expect(init?.method).toBe('GET')
  const table = url.pathname.slice('/rest/v1/'.length)
  const query = url.searchParams
  io.filterCalls.push({ table, query })
  expect(query.get('company_id')).toBe('eq.' + io.company)
  if (table === 'customers') {
    expect(query.get('id')).toBe('in.(SYNTHETIC-CUSTOMER-ID)')
    return Promise.resolve(Response.json([{ id: 'SYNTHETIC-CUSTOMER-ID', source: 'staff' }], {
      headers: { 'Content-Range': '0-0/1' },
    }))
  }
  let rows = io.rows.filter(row => row.company_id === io.company)
  if (table === 'gridex_actionable_data_quality_issues_v') {
    expect(query.get('status')).toBe('eq.open')
    expect(query.get('order')).toBe('detected_at.desc,id.asc')
    if (io.viewUnavailable) return Promise.resolve(Response.json({ message: 'Internal fixture diagnostic' }, { status: 500 }))
    rows = rows.filter(row => row.status === 'open' && row.source_exists && (row.period_month === null || row.period_month === '2026-11-01'))
    rows.sort((left, right) => right.detected_at.localeCompare(left.detected_at) || left.id.localeCompare(right.id))
  } else {
    expect(table).toBe('data_quality_issues')
    expect(query.has('status')).toBe(false)
    rows.sort((left, right) => left.id.localeCompare(right.id))
  }
  const columns = query.get('select')?.split(',').filter(Boolean) ?? []
  const from = Number(query.get('offset') ?? '0')
  const limit = Number(query.get('limit') ?? rows.length)
  const page = rows.slice(from, from + limit).map((row) => columns[0] === '*'
    ? row
    : Object.fromEntries(columns.map((column) => [column, row[column as keyof Issue]])))
  const contentRange = page.length ? `${from}-${from + page.length - 1}/${rows.length}` : '*/' + rows.length
  return Promise.resolve(Response.json(page, { headers: { 'Content-Range': contentRange } }))
}

vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('http://127.0.0.1:54321', 'synthetic-service', {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: simulatedDataApi },
  }) }
})

const pageHtml = async (page?: string | string[]) => renderToStaticMarkup(await DeviationsPage({ searchParams: Promise.resolve({ page }) }))
const origin = 'http://127.0.0.1:54321'
const exportRoute = (url: URL | string) => GET(new NextRequest(new URL(url, origin)))
const csvHeading = 'Typ;Beskrivning;Påverkar;Allvar;Status'

function exportLink(html: string): URL {
  const href = html.match(/href="([^"]*\/admin\/analytics\/export\?[^"]*)"/)?.[1]
  if (!href) throw new Error('Missing deviations download')
  return new URL(href.replaceAll('&amp;', '&'), origin)
}

function issue(n: number, extra: Partial<Issue> = {}): Issue {
  return {
    id: String(n).padStart(4, '0'),
    company_id: io.a, entity_type: 'customer', entity_id: 'SYNTHETIC-CUSTOMER-ID',
    issue_type: 'missing_grid_owner', status: 'open', source_exists: true, period_month: '2026-11-01',
    severity: n % 2 ? 'critical' : 'warning',
    message: 'VISIBLE ISSUE ' + String(n).padStart(4, '0'), detected_at: '2026-11-18T09:00:00.000Z',
    ...extra,
  }
}

beforeEach(() => {
  io.company = io.a
  io.platform = false
  io.signedIn = true
  io.permissions = ['reports.read']
  io.viewUnavailable = false
  io.filterCalls = []
  io.rows = [
    issue(1),
    issue(101, { message: 'CLOSED ROW', status: 'resolved' }),
    issue(102, { message: 'OLDER MONTH ROW', period_month: '2026-10-01' }),
    issue(103, { message: 'INELIGIBLE SOURCE ROW', source_exists: false }),
    issue(104, { message: 'FOREIGN ROW', company_id: io.b }),
  ]
  vi.stubGlobal('fetch', () => { throw new Error('Unexpected external fixture transport') })
})
afterEach(() => vi.unstubAllGlobals())

it('follows Avvikelser to a CSV with the same actionable rows and visible business fields', async () => {
  const html = await pageHtml()
  expect(html).toContain('VISIBLE ISSUE 0001')
  const url = exportLink(html)
  const response = await exportRoute(url)
  expect(response.status).toBe(200)
  const body = await response.text()
  expect(body).toBe(csvHeading + '\nSaknad nätägare;VISIBLE ISSUE 0001;1 kund;Kritisk;Öppen')
  for (const excluded of ['CLOSED ROW', 'OLDER MONTH ROW', 'INELIGIBLE SOURCE ROW', 'FOREIGN ROW', 'SYNTHETIC-CUSTOMER-ID', '/admin/customers/']) {
    expect(html).not.toContain(excluded)
    expect(body).not.toContain(excluded)
  }
  expect(html).toContain('Exportera sidan som CSV')
  expect(url.searchParams.get('expected_company_id')).toBe(io.a)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('content-type')).toMatch(/^text\/csv/)
  expect(io.filterCalls.filter(call => call.table !== 'customers').map(call => call.table)).toEqual([
    'gridex_actionable_data_quality_issues_v', 'gridex_actionable_data_quality_issues_v',
  ])
})

it('exports only the selected UI page with the same order at equal timestamps', async () => {
  io.rows = Array.from({ length: 52 }, (_, index) => issue(index + 1))
  io.rows[51].detected_at = '2026-11-19T09:00:00.000Z'
  for (const requested of ['1', '2', '999', '-7', ['2', '1']]) {
    const html = await pageHtml(requested)
    const shown = [...html.matchAll(/VISIBLE ISSUE \d+/g)].map(match => match[0])
    const url = exportLink(html)
    const response = await exportRoute(url)
    const downloaded = [...(await response.text()).matchAll(/VISIBLE ISSUE \d+/g)].map(match => match[0])
    expect(downloaded).toEqual(shown)
    const secondPage = ['2', '999'].includes(String(Array.isArray(requested) ? requested[0] : requested))
    expect(shown).toHaveLength(secondPage ? 2 : 50)
    expect(response.headers.get('content-disposition')).toContain(`analytics-open-deviations-page-${secondPage ? 2 : 1}.csv`)
  }
})

it('rejects an old download link after company switch without any data read', async () => {
  const url = exportLink(await pageHtml())
  io.company = io.b
  io.filterCalls = []
  const response = await exportRoute(url)
  expect(response.status).toBe(409)
  expect(await response.text()).toContain('Ladda om Avvikelser')
  expect(io.filterCalls).toEqual([])
})

it('requires one matching page company and keeps the ordinary admin guard', async () => {
  const url = exportLink(await pageHtml())
  io.filterCalls = []
  url.searchParams.append('expected_company_id', io.a)
  expect((await exportRoute(url)).status).toBe(409)
  url.searchParams.delete('expected_company_id')
  expect((await exportRoute(url)).status).toBe(409)
  url.searchParams.set('expected_company_id', io.a)
  io.company = null
  expect((await exportRoute(url)).status).toBe(403)
  io.company = io.a
  io.permissions = ['billing.read']
  await expect(exportRoute(url)).rejects.toThrow('REDIRECT /admin')
  io.signedIn = false
  await expect(exportRoute(url)).rejects.toThrow('REDIRECT /login')
  expect(io.filterCalls).toEqual([])
})

it('keeps the separate historical report and its filename available', async () => {
  const response = await exportRoute('/admin/analytics/export?report=data_quality_issues&month=2026-10')
  expect(response.status).toBe(200)
  expect(response.headers.get('content-disposition')).toContain('analytics-data_quality_issues-2026-10.csv')
  const csv = await response.text()
  for (const expected of ['VISIBLE ISSUE 0001', 'CLOSED ROW', 'OLDER MONTH ROW', 'INELIGIBLE SOURCE ROW']) expect(csv).toContain(expected)
  expect(csv).not.toContain('FOREIGN ROW')
  expect(io.filterCalls.map(call => call.table)).toEqual(['data_quality_issues'])
})

it('distinguishes empty current results from an unavailable current view', async () => {
  io.rows = []
  const html = await pageHtml()
  expect(html).toContain('Inga öppna avvikelser')
  const url = exportLink(html)
  const empty = await exportRoute(url)
  expect(empty.status).toBe(200)
  expect(await empty.text()).toBe(csvHeading)
  io.viewUnavailable = true
  const failure = await exportRoute(url)
  expect(failure.status).toBe(503)
  expect(failure.headers.get('content-disposition')).toBeNull()
  expect(await failure.text()).not.toContain('Internal fixture diagnostic')
  expect(await pageHtml()).toContain('Analysunderlaget kunde inte läsas')
})

it('serializes displayed text as plain spreadsheet cells with line breaks and delimiters', async () => {
  io.rows = [issue(1, { message: '- granskningsnotering; "se underlag"\r\nFölj upp' })]
  const response = await exportRoute(exportLink(await pageHtml()))
  expect(response.status).toBe(200)
  expect(await response.text()).toBe(csvHeading + '\nSaknad nätägare;"\'- granskningsnotering; ""se underlag""\nFölj upp";1 kund;Kritisk;Öppen')
})

it('keeps ordinary notes as text in the general quality export', async () => {
  io.rows = [issue(1, { message: '  - granskningsnotering\rFölj upp' })]
  const response = await exportRoute('/admin/analytics/export?report=data_quality_issues')
  expect(response.status).toBe(200)
  expect(await response.text()).toContain(`"'  - granskningsnotering\rFölj upp"`)
})

it('retains signed numeric amounts as numbers in analytics CSV', async () => {
  const { buildCsv } = await import('@/lib/analytics/utils')
  const csv = buildCsv(['amount', 'note'], [{ amount: -12, note: '- korrigerad prognos' }])
  expect(csv).toBe(`amount;note\n-12;'- korrigerad prognos`)
})

it('preserves the deliberate selected-company platform read and exports no action link', async () => {
  io.platform = true
  io.permissions = []
  const html = await pageHtml()
  expect(html).toContain('/admin/customers/SYNTHETIC-CUSTOMER-ID')
  const response = await exportRoute(exportLink(html))
  expect(response.status).toBe(200)
  expect(await response.text()).not.toMatch(/SYNTHETIC-CUSTOMER-ID|\/admin\/customers\//)
})
