import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Actual guard, page, form, table and canonical agreement list. Auth/context and
// query transport alone are controlled; no Next request/browser/native Auth.
type Row = Record<string, unknown>
type Query = { table: string; projection: string; predicates: Array<[string, unknown]>; order: string | null; limit: number | null }
const f = vi.hoisted(() => ({ actor: '33333333-3333-4333-8333-333333333333', company: '11111111-1111-4111-8111-111111111111',
  owner: '44444444-4444-4444-8444-444444444444', selected: '11111111-1111-4111-8111-111111111111', navigation: undefined as string | undefined,
  platform: true, userError: null as Row | null, contextError: null as Row | null, serviceError: null as { table: string; error: Row } | null,
  rows: {} as Record<string, Row[]>, queries: [] as Query[], rpcCalls: [] as Array<{ name: string; args: unknown }>, authReads: 0,
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => {
  const value = name === 'gridex_admin_selected_company_id' ? f.selected : name === 'gridex_admin_navigation_mode' ? f.navigation : undefined
  return value ? { value } : undefined
} }) }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => { f.authReads += 1; return { data: { user: { id: f.actor, email: null } }, error: f.userError } } },
  rpc: async (name: string, args: unknown) => {
    f.rpcCalls.push({ name, args })
    return { data: { authorized: true, user_id: f.actor, is_platform_admin: f.platform, selected_company_id: f.selected,
      roles: ['platform_admin'], permissions: [] }, error: f.contextError }
  },
}) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from(table: string) {
  const state: Query = { table, projection: '', predicates: [], order: null, limit: null }
  const query = {
    select: (projection: string) => { state.projection = projection; return query },
    eq: (key: string, value: unknown) => { state.predicates.push([key, value]); return query },
    is: (key: string, value: unknown) => { state.predicates.push([key, value]); return query },
    order: (key: string) => { state.order = key; return query },
    limit: (value: number) => { state.limit = value; return query },
    then: (done: (result: unknown) => unknown) => {
      f.queries.push(structuredClone(state))
      const error = f.serviceError?.table === table ? f.serviceError.error : null
      let data = (f.rows[table] ?? []).filter(row => state.predicates.every(([key, value]) => row[key] === value))
      if (state.limit !== null) data = data.slice(0, state.limit)
      return Promise.resolve({ data: error ? null : data, error }).then(done)
    },
  }
  return query
} } }))

import Page from '@/app/admin/agreements/grid-owners/page'
import Layout from '@/app/admin/layout'
import GridOwnerAgreementForm from '@/components/admin/agreements/GridOwnerAgreementForm'
import GridOwnerAgreementTable from '@/components/admin/agreements/GridOwnerAgreementTable'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'

const require = createRequire(import.meta.url)
const { fixture } = require('../scripts/grid-owner-agreement-runtime-company-projection-20261001.postgres.test.cjs') as {
  fixture: (options?: { omitProjection: boolean }) => Promise<{ rows: Row[]; options: Row[]; children: Row; triggerCount: number }>
}
let canonicalRows: Row[]
beforeAll(async () => { canonicalRows = (await fixture()).rows }, 15_000)
beforeEach(() => {
  f.selected = f.company; f.navigation = undefined; f.platform = true; f.userError = null; f.contextError = null; f.serviceError = null
  f.queries = []; f.rpcCalls = []; f.authReads = 0
  f.rows = { companies: structuredClone(canonicalRows), grid_owners: [{ id: f.owner, name: 'Synthetic agreement runtime owner A', ediel_id: null, owner_code: null }],
    communication_routes: [], grid_owner_access_agreements: [], company_memberships: [{ company_id: f.company, user_id: f.actor,
      membership_role: 'owner', status: 'active', companies: { id: f.company, name: 'Synthetic agreement runtime A', slug: null, org_number: null, status: 'active' } }] }
})
function descendants(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(descendants)
  if (!isValidElement(node)) return []
  const element = node as ReactElement<Record<string, unknown>>
  return [element, ...descendants(element.props.children as ReactNode)]
}
async function markup() { return renderToStaticMarkup(await Page()) }
it('actual current selected-company guard and whole Page/Form render the seeded company option and exact failing controls', async () => {
  const html = await markup()
  expect(f.authReads).toBe(1)
  expect(f.rpcCalls).toEqual([{ name: 'canonical_authenticated_tenant_context', args: { p_selected_company_id: f.company } }])
  expect(html).toContain('<h1')
  expect(html).toContain('Nätägaravtal')
  expect(html.match(/<select name="company_id"/g)).toHaveLength(1)
  expect(html).toContain(`<option value="${f.company}">Synthetic agreement runtime A</option>`)
  expect(html).not.toContain('type="hidden" name="company_id"')
  expect(html.match(/Spara nätägaravtal<\/button>/g)).toHaveLength(1)
  expect(html).toContain('<select name="grid_owner_id"')
  expect(html).toContain(`<option value="${f.owner}">Synthetic agreement runtime owner A</option>`)
  for (const control of ['agreement_reference', 'document_file']) expect(html).toContain(`name="${control}"`)
  expect(f.queries.find(query => query.table === 'companies')).toEqual({ table: 'companies', projection: 'id,name',
    predicates: [['status', 'active'], ['lifecycle_status', 'active'], ['is_active', true], ['archived_at', null]], order: 'name', limit: null })
  expect(f.queries.find(query => query.table === 'grid_owner_access_agreements')).toEqual({ table: 'grid_owner_access_agreements',
    projection: '*', predicates: [], order: 'updated_at', limit: 250 })
})
it.each([undefined, 'platform_view', 'company_view'])('actual layout navigation mode %s does not replace the Page form with a hidden company', async navigation => {
  f.navigation = navigation
  const page = await Page()
  const layout = await Layout({ children: page })
  const elements = descendants(layout)
  const form = elements.find(element => element.type === GridOwnerAgreementForm)
  expect(form).toBeDefined()
  expect((form?.props.companies as Row[]).some(row => row.id === f.company)).toBe(true)
  const sidebar = elements.filter(element => element.props.preferredMode !== undefined)
  expect(sidebar).toHaveLength(2)
  const companyMode = navigation === 'company_view'
  expect(sidebar.every(element => element.props.preferredMode === (companyMode ? 'company_view' : 'platform_view') &&
    element.props.selectedCompanyId === (companyMode ? f.company : null))).toBe(true)
  expect(renderToStaticMarkup(form!)).toContain('<select name="company_id"')
})
it('actual guard rejects a noncanonical platform flag before any page service read', async () => {
  f.platform = false
  await expect(Page()).rejects.toMatchObject({ digest: expect.stringContaining('/admin/company-settings') })
  expect(f.queries.map(query => query.table)).toEqual(['company_memberships'])
})
it('actual failed Auth read redirects before canonical context or page queries', async () => {
  f.userError = { code: 'synthetic_auth_unavailable' }
  await expect(Page()).rejects.toMatchObject({ digest: expect.stringContaining('/login') })
  expect(f.rpcCalls).toEqual([]); expect(f.queries).toEqual([])
})
it.each([{ lifecycle_status: 'creating' }, { is_active: false }, { status: 'paused' }, { archived_at: '2026-10-01T00:00:00Z' }])(
  'actual page preserves company eligibility predicate %j without hiding the form or choosing a different company', async changed => {
    f.rows.companies = f.rows.companies.map(row => row.id === f.company ? { ...row, ...changed } : row)
    const html = await markup()
    expect(html).toContain('<select name="company_id"')
    expect(html).toContain('Spara nätägaravtal</button>')
    expect(html).not.toContain(`<option value="${f.company}">`)
    expect(html).not.toContain('type="hidden" name="company_id"')
  },
)
it.each(['companies', 'grid_owners', 'communication_routes', 'grid_owner_access_agreements'])('actual page/list error from %s prevents a successful form render', async table => {
  const error = { code: '42703', message: 'synthetic controlled projection failure' }
  f.serviceError = { table, error }
  await expect(Page()).rejects.toBe(error)
  expect(f.queries.some(query => query.table === table)).toBe(true)
})
it('actual mounted row preserves remaining tag, protected-document and archive locator identities', () => {
  const html = renderToStaticMarkup(GridOwnerAgreementTable({ agreements: [{ id: f.owner, company_id: f.company, grid_owner_id: f.owner,
    agreement_scope: 'metering_access', agreement_type: 'metering_access', status: 'archived', agreement_reference: 'synthetic-owned-tag',
    document_path: 'grid-owner-agreements:owned/document.pdf', preferred_receiver_ediel_id: null, preferred_application_reference: '23-DGI-PRODAT',
    preferred_route_id: null, valid_from: null, valid_to: null } as never], companyById: {}, gridOwnerById: {}, routeById: {} }))
  expect(html).toContain('synthetic-owned-tag'); expect(html).toContain('archived')
  expect(html).toContain('Öppna dokument</a>')
  expect(html).toContain('/admin/agreements/grid-owners/documents?path=grid-owner-agreements%3Aowned%2Fdocument.pdf')
  expect(html).toContain('Arkivera</button>'); expect(html).toContain(`type="hidden" name="id" value="${f.owner}"`)
})
it('literal loader projections reference current canonical base-table columns', () => {
  const schema = readFileSync(resolve('supabase/schema.sql'), 'utf8')
  for (const [table, columns] of [ ['companies', ['id', 'name', 'status', 'lifecycle_status', 'is_active', 'archived_at']],
    ['grid_owners', ['id', 'name', 'ediel_id', 'owner_code']],
    ['communication_routes', ['id', 'route_name', 'route_scope', 'route_type', 'grid_owner_id', 'updated_at']] ] as const) {
    const body = schema.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0]
    expect(body).toBeDefined()
    for (const column of columns) expect(body).toMatch(new RegExp(`\\n    ${column} `))
  }
})
it('actual explicit canonical guard receipt remains platform-authoritative with selected company', async () => {
  expect(await requirePlatformAdminAccess()).toMatchObject({ userId: f.actor, companyId: f.company, isPlatformAdmin: true })
})
