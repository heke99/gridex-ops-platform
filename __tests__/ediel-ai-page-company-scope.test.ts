import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Page from '@/app/admin/ediel/ai-list/page'

const ids = {
  company: '10000000-0000-4000-8000-000000000001',
  outsider: '10000000-0000-4000-8000-000000000002',
  customer: '10000000-0000-4000-8000-000000000003',
  site: '10000000-0000-4000-8000-000000000004',
  outsiderSite: '10000000-0000-4000-8000-000000000005',
  otherCustomer: '10000000-0000-4000-8000-000000000006',
  legacyPoint: '10000000-0000-4000-8000-000000000007',
  canonicalPoint: '10000000-0000-4000-8000-000000000008',
  wrongPoint: '10000000-0000-4000-8000-000000000009',
}
const rowId = (n: number) => '20000000-0000-4000-8000-' + String(n).padStart(12, '0')
type Row = Record<string, string | null>
const customers: Row[] = [
  ...Array.from({ length: 102 }, (_, i) => ({
    id: rowId(i + 1), company_id: ids.company, full_name: 'Övrig kund ' + (i + 1),
    created_at: '2026-11-18',
  })),
  { id: ids.customer, company_id: ids.company, full_name: 'E2E Äldre kund', customer_number: 'EL123', created_at: '2026-10-01' },
  { id: ids.outsider, company_id: ids.outsider, full_name: 'Främmande bolagskund', created_at: '2026-10-01' },
]
const sites: Row[] = [
  ...Array.from({ length: 205 }, (_, i) => ({
    id: rowId(200 + i), company_id: ids.company, customer_id: ids.otherCustomer, site_name: 'Annat kundobjekt ' + (i + 1),
    created_at: '2026-11-18',
  })),
  { id: ids.site, company_id: ids.company, customer_id: ids.customer, site_name: 'E2E Äldre anläggning', created_at: '2026-10-01' },
  { id: ids.outsiderSite, company_id: ids.outsider, customer_id: ids.outsider, site_name: 'Främmande bolagsanläggning', created_at: '2026-10-01' },
  ...Array.from({ length: 27 }, (_, i) => ({
    id: rowId(710 + i), company_id: ids.company, customer_id: ids.customer, site_name: 'Egen övrig anläggning ' + (i + 1),
    created_at: '2026-10-01',
  })),
]
const points: Row[] = [
  { id: ids.legacyPoint, company_id: ids.company, customer_id: ids.customer, site_id: ids.site, customer_site_id: null, meter_point_id: 'E2E Legacy point' },
  { id: ids.canonicalPoint, company_id: ids.company, customer_id: ids.customer, site_id: null, customer_site_id: ids.site, meter_point_id: 'E2E Canonical point' },
  { id: ids.wrongPoint, company_id: ids.company, customer_id: ids.customer, site_id: ids.site, customer_site_id: ids.outsiderSite, meter_point_id: 'E2E Conflicting point' },
  { id: rowId(601), company_id: ids.company, customer_id: ids.otherCustomer, site_id: ids.site, customer_site_id: ids.site, meter_point_id: 'E2E Other customer point' },
]
const fixture = vi.hoisted(() => ({
  companyId: null as string | null,
  permissions: [] as string[],
  queries: [] as { table: string; filters: URLSearchParams }[],
}))
vi.mock('@/lib/admin/guards', () => ({ requireAdminPageAccess: async () => ({
  companyId: fixture.companyId, permissions: fixture.permissions,
  email: 'reader@example.invalid', roles: ['platform_admin'], isPlatformAdmin: true,
}) }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/app/admin/ediel/actions', () => ({
  prepareAiListAction: vi.fn(() => { throw Error('Unexpected write in read-only proof') }),
  sendEdielMessageAction: vi.fn(() => { throw Error('Unexpected send in read-only proof') }),
}))
vi.mock('@/lib/supabase/server', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient('http://127.0.0.1:32175', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      expect(url.origin).toBe('http://127.0.0.1:32175')
      expect(request.method).toBe('GET')
      const table = url.pathname.split('/').at(-1) ?? ''
      const q = url.searchParams
      fixture.queries.push({ table, filters: q })
      let rows: Row[]
      if (table === 'ediel_messages') {
        expect(q.get('message_family')).toBe('eq.AI_LIST')
        rows = []
      } else if (table === 'customers') rows = customers
      else if (table === 'customer_sites') rows = sites
      else if (table === 'metering_points') rows = points
      else throw Error('Unexpected synthetic table')
      expect(q.get('company_id')).toBe('eq.' + fixture.companyId)
      rows = rows.filter(row => row.company_id === fixture.companyId)
      const customerFilter = q.get('customer_id')
      if (customerFilter) rows = rows.filter(row => 'eq.' + row.customer_id === customerFilter)
      const idFilter = q.get('id')
      if (idFilter?.startsWith('eq.')) rows = rows.filter(row => row.id === idFilter.slice(3))
      if (idFilter?.startsWith('gt.')) rows = rows.filter(row => (row.id ?? '') > idFilter.slice(3))
      const or = q.get('or')
      if (or && table === 'customers') {
        expect(or).toContain('customer_number.ilike.')
        const term = /customer_number\.ilike\."%([^"]+)%"/.exec(or)?.[1]
        rows = rows.filter(row => [row.full_name, row.company_name, row.customer_number].some(value => value?.includes(term ?? 'NEVER')))
      }
      if (or && table === 'metering_points') {
        expect(or).toBe('(customer_site_id.eq.' + ids.site + ',and(customer_site_id.is.null,site_id.eq.' + ids.site + '))')
        rows = rows.filter(row => (row.customer_site_id ?? row.site_id) === ids.site)
      }
      if (q.get('order') === 'id.asc') rows = rows.slice().sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''))
      if (q.get('order')?.startsWith('created_at.desc')) rows = rows.slice().sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
      const limit = q.get('limit')
      return Response.json(limit ? rows.slice(0, Number(limit)) : rows)
    } },
  })
  return { createSupabaseServerClient: async () => supabase }
})

async function render(query: Record<string, string | string[]> = {}): Promise<string> {
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(query) }))
}

beforeEach(() => {
  fixture.companyId = ids.company
  fixture.permissions = ['communication.read', 'customers.read']
  fixture.queries = []
})

describe('selected-company AI list history and scoped preparation', () => {
  it('does not load preparation records for a read-only actor', async () => {
    const html = await render({ customerId: ids.customer, siteId: ids.site })

    expect(html).toContain('Din aktuella behörighet medger läsning')
    expect(html).not.toContain('<form')
    expect(fixture.queries.map(query => query.table)).toEqual(['ediel_messages'])
  })

  it.each([null, ids.outsider])('does not read private records without selected company scope (%s)', async company => {
    fixture.companyId = company
    fixture.permissions = []

    expect(await render()).toContain('Välj ett bolag')
    expect(fixture.queries).toEqual([])
  })

  it('finds an older customer by name or number before applying the page limit', async () => {
    fixture.permissions.push('communication.write')
    const html = await render({ q: 'EL123' })

    expect(html).toContain('E2E Äldre kund')
    expect(html).not.toContain('Övrig kund')
    expect(fixture.queries.some(query => query.table === 'customer_sites' || query.table === 'metering_points')).toBe(false)
  })

  it('preselects an older owned facility and scopes its canonical and legacy meter points', async () => {
    fixture.permissions.push('communication.write')
    const html = await render({ customerId: ids.customer, siteId: ids.site, meteringPointId: ids.canonicalPoint })

    expect(html).toContain('E2E Äldre anläggning')
    expect(html).toContain('E2E Legacy point')
    expect(html).toContain('E2E Canonical point')
    expect(html).not.toContain('E2E Conflicting point')
    expect(html).not.toContain('E2E Other customer point')
    expect(html).not.toContain('Annat kundobjekt')
    expect(html).toContain('AI-listan gäller <strong>E2E Äldre kund</strong> · <strong>E2E Äldre anläggning</strong>')
    expect(html).toContain('name="customerId" value="' + ids.customer + '"')
    expect(html).toContain('name="siteId" value="' + ids.site + '"')
    expect(html).toContain('value="' + ids.canonicalPoint + '" selected=""')
    expect(html).toContain('Generera och köa AI-lista')
    const meter = fixture.queries.find(query => query.table === 'metering_points')
    expect(meter?.filters.get('customer_id')).toBe('eq.' + ids.customer)
  })

  it('cannot choose a foreign facility or read meter points for it', async () => {
    fixture.permissions.push('communication.write')
    const html = await render({ customerId: ids.customer, siteId: ids.outsiderSite, meteringPointId: ids.canonicalPoint })

    expect(html).not.toContain('Främmande bolagsanläggning')
    expect(html).not.toContain('Generera och köa AI-lista')
    expect(fixture.queries.some(query => query.table === 'metering_points')).toBe(false)
  })

  it('does not read facilities for unknown, ambiguous or foreign customer ID', async () => {
    fixture.permissions.push('communication.write')
    await render({ customerId: [ids.customer, ids.outsider], siteId: ids.site })
    await render({ customerId: ids.outsider, siteId: ids.site })
    await render({ customerId: 'bad-uuid', siteId: ids.site })

    expect(fixture.queries.some(query => query.table === 'customer_sites')).toBe(false)
  })

  it('uses fresh company scope after the actor switches company for the same URL', async () => {
    fixture.permissions.push('communication.write')
    const query = { customerId: ids.customer, siteId: ids.site }
    expect(await render(query)).toContain('E2E Äldre anläggning')

    fixture.companyId = ids.outsider
    fixture.queries = []
    const html = await render(query)

    expect(html).toContain('Kunden kunde inte väljas')
    expect(html).not.toContain('E2E Äldre anläggning')
    expect(fixture.queries.some(row => row.table === 'customer_sites' || row.table === 'metering_points')).toBe(false)
  })

  it('preserves a verified selected facility outside the current facilities page', async () => {
    fixture.permissions.push('communication.write')
    const html = await render({ customerId: ids.customer, siteId: ids.site, siteAfter: rowId(731) })
    const siteList = fixture.queries.find(row => row.table === 'customer_sites' && !!row.filters.get('limit'))

    expect(siteList?.filters.get('id')).toBe('gt.' + rowId(731))
    expect(siteList?.filters.get('customer_id')).toBe('eq.' + ids.customer)
    expect(html).toContain('value="' + ids.site + '" selected=""')
    expect(html).toContain('Generera och köa AI-lista')
  })

  it('does not preselect the legacy site of a conflicted meter point', async () => {
    fixture.permissions.push('communication.write')
    const html = await render({ customerId: ids.customer, siteId: ids.site, meteringPointId: ids.wrongPoint })

    expect(html).toContain('Mätpunkten kunde inte väljas')
    expect(html).not.toContain('E2E Conflicting point')
    expect(html).toContain('value="" selected="">Valfri')
  })

  it('uses a scoped customer cursor for continuation', async () => {
    fixture.permissions.push('communication.write')
    await render({ customerAfter: rowId(35) })
    const cursor = fixture.queries.find(query => query.table === 'customers')

    expect(cursor?.filters.get('id')).toBe('gt.' + rowId(35))
    expect(cursor?.filters.get('order')).toBe('id.asc')
    expect(cursor?.filters.get('limit')).toBe('26')
  })
})
