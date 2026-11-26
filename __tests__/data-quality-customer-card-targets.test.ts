import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  admin: { userId: 'operator', permissions: [] as string[], roles: [] as string[], isPlatformAdmin: false },
  company: '10000100-0000-4000-8000-000000000001',
  foreignCompany: '10000100-0000-4000-8000-000000000002',
  ordinary: '10000100-0000-4000-8000-000000000003',
  control: '10000100-0000-4000-8000-000000000004',
  foreign: '10000100-0000-4000-8000-000000000005',
  missing: '10000100-0000-4000-8000-000000000006',
  checked: [] as Array<{ columns: string; ids: string[]; companyId: string | null }>,
  lookupFailed: false,
  extendedIssues: false,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageKeyAccess: (page: string) => {
    expect(page).toBe('operations.integrity')
    return io.admin
  },
  isPlatformAdminContext: () => io.admin.isPlatformAdmin,
}))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminTenantReadScope: () => ({
  companyId: io.admin.isPlatformAdmin ? null : io.company,
  isPlatformAdmin: io.admin.isPlatformAdmin,
}) }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { from(table: string) {
    const affected = [
      [io.company, io.ordinary, 'normal'], [io.company, io.control, 'control'],
      [io.company, io.missing, 'missing'], [io.company, io.foreign, 'misbound'],
      [io.foreignCompany, io.foreign, 'foreign'],
    ] as const
    const scoped = affected.map(([company_id, customer_id, label]) => ({
      company_id, customer_id, entity_id: String(label), entity_type: 'customer', issue_key: 'missing_signed_power_of_attorney',
      severity: 'warning', message: 'Fullmakt behöver granskas ' + label,
    }))
    if (io.extendedIssues) {
      for (const [severity, count] of [['critical', 102], ['warning', 31]] as const) {
        for (let i = 0; i < count; i++) {
          scoped.push({ ...scoped[0], severity, entity_id: severity + '-' + i })
        }
      }
      scoped.push({ ...scoped[0], severity: 'critical', company_id: io.foreignCompany })
    }
    let companyId: string | null = null
    let severity: string | null = null
    let head = false
    let from = 0
    let to = scoped.length
    const query = {
      select: (_columns: string, options?: { head?: boolean }) => { head = options?.head === true; return query },
      order: () => query,
      range: (start: number, end: number) => { from = start; to = end + 1; return query },
      in: () => query,
      neq: () => query,
      match: (filter: { company_id?: string }) => { companyId = filter.company_id ?? null; return query },
      eq: (column: string, value: string) => { expect(column).toBe('severity'); severity = value; return query },
      then: (resolve: (outcome: unknown) => void) => {
        const matching = table === 'customer_data_quality_open_issues'
          ? scoped.filter(row => (!companyId || row.company_id === companyId) && (!severity || row.severity === severity))
          : []
        return Promise.resolve({ data: head ? null : matching.slice(from, to), count: head ? matching.length : null, error: null }).then(resolve)
      },
    }
    return query
  } },
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ from(table: string) {
    expect(table).toBe('customers')
    const scope = { columns: '', ids: [] as string[], companyId: null as string | null }
    const query = {
      select: (columns: string) => { scope.columns = columns; return query },
      in: (key: string, ids: string[]) => { expect(key).toBe('id'); scope.ids = ids; return query },
      eq: (key: string, companyId: string) => { expect(key).toBe('company_id'); scope.companyId = companyId; return query },
      then: (resolve: (outcome: unknown) => void) => {
        io.checked.push(scope)
        const data = [
          { id: io.ordinary, company_id: io.company, source: null },
          { id: io.control, company_id: io.company, source: 'ediel_portal_test' },
          { id: io.foreign, company_id: io.foreignCompany, source: null },
        ].filter(row => scope.ids.includes(row.id) && (!scope.companyId || scope.companyId === row.company_id))
        return Promise.resolve(io.lookupFailed ? { error: { code: 'DB_UNAVAILABLE' }, data: null } : { error: null, data }).then(resolve)
      },
    }
    return query
  } }),
}))

import Page from '@/app/admin/data-quality/page'

const href = (id: string) => '/admin/customers/' + id
async function render() {
  return renderToStaticMarkup(await Page())
}

beforeEach(() => {
  io.admin.permissions = ['metering.read', 'customers.read']
  io.admin.isPlatformAdmin = false
  io.lookupFailed = false
  io.extendedIssues = false
  io.checked = []
})

it('links only the ordinary existing customer belonging to the issue company through the authenticated scope', async () => {
  const html = await render()
  expect(html).toContain(href(io.ordinary))
  expect(html).not.toContain(href(io.control))
  expect(html).not.toContain(href(io.missing))
  expect(html).not.toContain(href(io.foreign))
  expect(html).toContain('Fullmakt behöver granskas control')
  expect(io.checked).toEqual([{ columns: 'id,company_id,source', ids: [io.ordinary, io.control, io.missing, io.foreign], companyId: io.company }])
})

it('keeps all qualified platform customers and only links matching issue and customer companies', async () => {
  io.admin.isPlatformAdmin = true
  const html = await render()
  expect(html.match(new RegExp(href(io.foreign), 'g'))).toHaveLength(1)
  expect(html).toContain(href(io.ordinary))
  expect(html).not.toContain(href(io.control))
  expect(io.checked).toHaveLength(1)
})

it('preserves the plain review action for a reader without both page rights', async () => {
  io.admin.permissions = ['metering.read', 'masterdata.read']
  const html = await render()
  expect(html).toContain('Fullmakt behöver granskas normal')
  expect(html).toContain('Manuell kontroll')
  expect(html).not.toContain(href(io.ordinary))
  expect(io.checked).toHaveLength(0)
})

it('keeps the issue visible without an unverified link if the authenticated lookup fails', async () => {
  io.lookupFailed = true
  const html = await render()
  expect(html).toContain('Fullmakt behöver granskas normal')
  expect(html).toContain('Manuell kontroll')
  expect(html).not.toContain(href(io.ordinary))
})

it('counts the selected company across all customer issue pages', async () => {
  io.extendedIssues = true
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ customerPage: '2' }) }))
  expect(html).toMatch(/Kritiska kundfel<\/p><p[^>]*>102<\/p>/)
  expect(html).toMatch(/Varningar<\/p><p[^>]*>35<\/p>/)
  expect(html).toContain('Sida 2 av 3 · 137 rader')
  expect(html).toContain('/admin/data-quality?customerPage=3#kunddata')
})
