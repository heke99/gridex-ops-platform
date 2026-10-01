import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { isValidElement, type ReactNode } from 'react'
import { publicReference } from '@/lib/integrations/publicReferences'

type Row = { id: string; company_id: string; customer_id: string; title: string; description: string; reason_category: string;
  status: string; source: string; metadata: Record<string, unknown>; created_at: string; updated_at: string; visible: boolean;
  published: boolean; case_reference: string; support_revision: number; customers: null }
const io = vi.hoisted(() => ({ rows: [] as Row[], requests: [] as URL[], rpcQueries: [] as Record<string, unknown>[], fail: false, failTable: '' }))
const company = 'fb530000-0000-4000-8000-000000000001', customer = 'fb530000-0000-4000-8000-000000000002'
const actor = { kind: 'portal' as const, userId: 'fb530000-0000-4000-8000-000000000003', sessionId: 'fb530000-0000-4000-8000-000000000004' }
const id = (n: number) => `fb530000-0000-4000-8000-${String(n).padStart(12, '0')}`
const context = { companyId: company, customerIds: [customer], customers: [{ id: customer, company_id: company, customer_number: 'SYNTHETIC-PAGINATION' }] }
const ordered = (rows: Row[]) => [...rows].sort((a, b) => a.created_at === b.created_at ? b.id.localeCompare(a.id) : b.created_at.localeCompare(a.created_at))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/env/supabaseServer', () => ({ getSupabaseServiceEnv: () => ({ serviceRoleKey: 'nonworking-functional-cursor-fixture-only' }) }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('http://pagination-control.invalid', 'nonworking-outer-db-placeholder', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
      const url = new URL(String(input)); io.requests.push(url)
      if (io.fail || url.pathname.endsWith('/' + io.failTable) && io.failTable) return Response.json({ code: 'PGRST205', message: 'controlled list unavailable' }, { status: 404 })
      if (url.pathname.endsWith('/rpc/gridex_support_attachment_read_v1')) return Response.json({ items: [] })
      if (url.pathname.endsWith('/rpc/gridex_support_case_read_v1')) {
        const { p_query: query } = JSON.parse(String(init?.body)); io.rpcQueries.push(query)
        let rows = ordered(io.rows.filter(row => row.visible))
        if (query.before) rows = rows.filter(row => row.created_at < query.before || (row.created_at === query.before && row.id < query.beforeId))
        const projection = (row: Row) => ({ id: row.id, case_reference: row.case_reference, title: row.title, status: row.status, revision: row.support_revision, created_at: row.created_at, updated_at: row.updated_at })
        if (query.reference) {
          const row = io.rows.find(row => row.case_reference === query.reference && row.visible)!
          return Response.json({ caseId: row.id, case: projection(row), items: [] })
        }
        return Response.json({ items: rows.slice(0, query.limit).map(projection) })
      }
      const table = url.pathname.split('/').at(-1)
      if (table === 'customer_portal_accounts') return Response.json([{ role: 'reader' }])
      if (table === 'customers') return Response.json([])
      let rows = ordered(io.rows)
      const customerFilter = url.searchParams.get('customer_id')
      const caseFilter = url.searchParams.get('id') ?? url.searchParams.get('customer_case_id')
      if (customerFilter?.startsWith('eq.')) rows = rows.filter(row => row.customer_id === customerFilter.slice(3))
      if (caseFilter?.startsWith('eq.')) rows = rows.filter(row => row.id === caseFilter.slice(3))
      if (caseFilter?.startsWith('in.')) rows = rows.filter(row => caseFilter.slice(4, -1).replaceAll('"', '').split(',').includes(row.id))
      const status = url.searchParams.get('status')
      if (status?.startsWith('eq.')) rows = rows.filter(row => row.status === status.slice(3))
      for (const filter of url.searchParams.getAll('or')) {
        if (filter.includes('metadata->support_case.eq.true')) rows = rows.filter(row => row.metadata.support_case === true || row.source.startsWith('tenant_support_'))
        else {
          const word = filter.match(/title\.ilike\.%([^%]+)%/)?.[1]
          if (word) rows = rows.filter(row => [row.title, row.description, row.reason_category].some(value => value.toLowerCase().includes(word.toLowerCase())))
        }
      }
      if (table === 'customer_case_publications') rows = rows.filter(row => row.published)
      if (table === 'customer_support_threads') {
        const references = url.searchParams.get('public_reference')
        if (references?.startsWith('in.')) rows = rows.filter(row => references.slice(4, -1).replaceAll('"', '').split(',').includes(row.case_reference))
      }
      const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 1000)
      rows = rows.slice(offset, offset + limit)
      if (table === 'customer_case_publications') return Response.json(rows.map(row => ({ id: row.id, customer_case_id: row.id,
        company_id: row.company_id, customer_id: row.customer_id, revision: 1, public_status: row.status, public_title: row.title,
        public_body: 'Saved summary for ' + row.title, published_at: row.created_at, channel: 'ops', author_user_id: actor.userId })))
      if (table === 'customer_support_threads') return Response.json(rows.map(row => ({ id: row.id, public_reference: row.case_reference })))
      return Response.json(rows)
    } },
  }) }
})
// Fixed functional outer context only. These tests do not exercise Auth,
// authorization, credentials, privileges, transport or any security denial.
vi.mock('@/lib/customer-portal/db', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/customer-portal/db')>(), getCustomerPortalContext: async () => context,
}))
vi.mock('@/lib/customer-operations/supportSession', () => ({ currentSupportSession: async () => actor }))
vi.mock('@/app/portal/arenden/actions', () => ({ createPortalSupportCaseAction: vi.fn(), createPortalSupportCaseFallbackAction: vi.fn(),
  replyPortalSupportCaseAction: vi.fn(), replyPortalSupportCaseFallbackAction: vi.fn(), uploadPortalSupportAttachmentAction: vi.fn(), uploadPortalSupportAttachmentFallbackAction: vi.fn() }))
vi.mock('@/lib/customer-portal/externalApi', () => ({
  requireCustomerPortalApiContext: async () => ({ ok: true, client: { id: id(5), company_id: company }, identity: { customer_id: customer, customer_portal_user_id: actor.userId }, startedAt: 1 }),
  customerPortalJson: (value: unknown, init?: ResponseInit) => Response.json(value, init), logCustomerPortalSuccess: async () => undefined,
  handleCustomerPortalRouteError: ({ error }: { error: { code?: string; status?: number } }) => Response.json({ error: { code: error.code ?? 'list_unavailable' } }, { status: error.status ?? 500 }),
}))

beforeEach(() => {
  io.requests = []; io.rpcQueries = []; io.fail = false; io.failTable = ''
  io.rows = Array.from({ length: 530 }, (_, n) => {
    const support = n >= 351, published = support && n < 488, caseId = id(1000 + n)
    const created = new Date(Date.UTC(2026, 8, 1, 0, 0, Math.floor((530 - n) / 3))).toISOString()
    return { id: caseId, company_id: company, customer_id: customer, title: support ? `Support ${n}` : `Ordinary ${n}`,
      description: n % 2 ? 'Needle description' : 'Other description', reason_category: n % 5 ? 'general' : 'Needle category',
      status: n % 3 ? 'open' : 'resolved', source: support && n % 2 ? 'tenant_support_ops' : 'ordinary', metadata: support && !(n % 2) ? { support_case: true } : {},
      created_at: created, updated_at: created, visible: support, published, case_reference: publicReference('case', company, caseId)!,
      support_revision: 2, customers: null }
  })
})

function nodes(node: ReactNode, type: string): Array<Record<string, unknown>> {
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, type))
  if (!isValidElement(node)) return []
  const props = node.props as Record<string, unknown>
  return [...(node.type === type ? [props] : []), ...nodes(props.children as ReactNode, type)]
}
function cardTitles(node: ReactNode) { return nodes(node, 'h2').map(props => props.children).filter(value => typeof value === 'string' && value.startsWith('Support ')) }

function links(node: ReactNode): Array<Record<string, unknown>> {
  if (Array.isArray(node)) return node.flatMap(links)
  if (!isValidElement(node)) return []
  const props = node.props as Record<string, unknown>
  return [...(props.href ? [props] : []), ...links(props.children as ReactNode)]
}
function textContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textContent).join(' ')
  return isValidElement(node) ? textContent((node.props as { children?: ReactNode }).children) : ''
}

it('OPS actual export filters before range and reaches every179 support row among351 newer ordinary cases', async () => {
  const { listTenantSupportCases } = await import('@/lib/customer-cases/support')
  const actual: string[] = []
  for (let offset = 0; offset < 250; offset += 40) {
    const rows = await listTenantSupportCases({ companyId: company, limit: 40, offset })
    actual.push(...rows.map(row => row.id)); if (rows.length < 40) break
  }
  expect(actual).toEqual(ordered(io.rows.filter(row => row.visible)).map(row => row.id))
  expect(new Set(actual).size).toBe(179)
  for (const request of io.requests) {
    expect(request.searchParams.getAll('or')).toContain('(metadata->support_case.eq.true,source.match.^tenant_support_)')
    expect(request.searchParams.get('order')).toBe('created_at.desc,id.desc')
  }
})

it('OPS actual export combines search/status with support selection before every page and has exact empty/error boundaries', async () => {
  const { listTenantSupportCases } = await import('@/lib/customer-cases/support')
  const expected = ordered(io.rows.filter(row => row.visible && row.status === 'open' && [row.title, row.description, row.reason_category].some(value => value.includes('Needle'))))
  const actual = []
  for (let offset = 0; offset < 200; offset += 11) {
    const rows = await listTenantSupportCases({ companyId: company, status: 'open', query: 'Needle', limit: 11, offset })
    actual.push(...rows.map(row => row.id)); if (rows.length < 11) break
  }
  expect(actual).toEqual(expected.map(row => row.id))
  expect(await listTenantSupportCases({ companyId: company, query: 'NoMatch', limit: 20 })).toEqual([])
  io.fail = true
  await expect(listTenantSupportCases({ companyId: company, limit: 20 })).rejects.toMatchObject({ code: 'PGRST205' })
})

it('actual API caller and keyset encoder reach all179 records once, including equal timestamps and terminal empty page', async () => {
  const { GET } = await import('@/app/api/v1/customer/cases/route')
  const expected = ordered(io.rows.filter(row => row.visible)), references: string[] = []
  let cursor: string | null = null
  do {
    const response = await GET(new NextRequest('http://pagination-control.invalid/api/v1/customer/cases?' + new URLSearchParams({ limit: '23', ...(cursor ? { cursor } : {}) })))
    expect(response.status).toBe(200)
    const body = await response.json(); expect(body.page.returned).toBe(body.data.length)
    references.push(...body.data.map((row: { case_reference: string }) => row.case_reference))
    cursor = body.page.next_cursor
    expect(body.page.has_more).toBe(Boolean(cursor))
  } while (cursor)
  expect(references).toEqual(expected.map(row => row.case_reference)); expect(new Set(references).size).toBe(179)
  io.rows = io.rows.filter(row => !row.visible)
  const exhausted = await GET(new NextRequest('http://pagination-control.invalid/api/v1/customer/cases?limit=23'))
  expect(await exhausted.json()).toMatchObject({ data: [], page: { returned: 0, has_more: false, next_cursor: null } })
})

it('actual API caller returns explicit functional list unavailability rather than a false empty page', async () => {
  const { GET } = await import('@/app/api/v1/customer/cases/route')
  io.fail = true
  const response = await GET(new NextRequest('http://pagination-control.invalid/api/v1/customer/cases'))
  expect(response.status).toBe(503); expect((await response.json()).error.code).toBe('support_unavailable')
})

it('actual portal page follows canonical25-row business page instead of repeating100 saved publications', async () => {
  const { default: Page } = await import('@/app/portal/arenden/page')
  const expected = ordered(io.rows.filter(row => row.visible)), seen: string[] = []
  let cursor: string | undefined
  do {
    const tree = await Page({ searchParams: Promise.resolve({ ...(cursor ? { cursor } : {}) }) })
    const titles = cardTitles(tree)
    expect(titles.length).toBeLessThanOrEqual(25)
    seen.push(...titles as string[])
    const href = links(tree).find(props => props.children === 'Fler ärenden')?.href
    cursor = typeof href === 'string' ? new URL(href, 'http://pagination-control.invalid').searchParams.get('cursor') ?? undefined : undefined
  } while (cursor)
  expect(seen).toEqual(expected.map(row => row.title)); expect(new Set(seen).size).toBe(179)
})


it('portal rendered next/back links retain customer and preserve canonical mixed publication order', async () => {
  const { default: Page } = await import('@/app/portal/arenden/page')
  io.rows.forEach(row => { row.published = row.published && Number(row.id.slice(-12)) % 2 === 0 })
  const expected = ordered(io.rows.filter(row => row.visible))
  const first = await Page({ searchParams: Promise.resolve({ customer }) })
  expect(cardTitles(first)).toEqual(expected.slice(0, 25).map(row => row.title))
  const next = String(links(first).find(props => props.children === 'Fler ärenden')!.href)
  const nextParams = new URL(next, 'http://pagination-control.invalid').searchParams
  expect(nextParams.get('customer')).toBe(customer)
  const second = await Page({ searchParams: Promise.resolve({ customer, cursor: nextParams.get('cursor')! }) })
  expect(cardTitles(second)).toEqual(expected.slice(25, 50).map(row => row.title))
  const reset = String(links(second).find(props => props.children === 'Senaste ärenden')!.href)
  const resetParams = new URL(reset, 'http://pagination-control.invalid').searchParams
  expect(resetParams.get('customer')).toBe(customer); expect(resetParams.has('cursor')).toBe(false)
  const back = await Page({ searchParams: Promise.resolve({ customer: resetParams.get('customer')! }) })
  expect(cardTitles(back)).toEqual(cardTitles(first))
  for (const query of io.requests.filter(url => url.pathname.endsWith('/customer_case_publications'))) {
    expect(query.searchParams.get('company_id')).toBe('eq.' + company)
    expect(query.searchParams.get('customer_id')).toBe('eq.' + customer)
    expect(query.searchParams.get('revoked_at')).toBe('is.null')
    expect(query.searchParams.get('customer_case_id')).toMatch(/^in\./)
    expect(Number(query.searchParams.get('limit'))).toBe(25)
  }
})

it('portal selected off-page published conversation retains exact summary and independent guarded reference', async () => {
  const { default: Page } = await import('@/app/portal/arenden/page')
  const expected = ordered(io.rows.filter(row => row.visible)), selected = expected[110]!
  const tree = await Page({ searchParams: Promise.resolve({ case_reference: selected.case_reference }) })
  expect(cardTitles(tree)).toEqual([selected.title, ...expected.slice(0, 25).map(row => row.title)])
  expect(textContent(tree)).toContain('Aktuell kundsynlig sammanfattning:')
  expect(io.rpcQueries.filter(query => query.reference)).toEqual([{ reference: selected.case_reference, limit: 26 }])
  const publication = io.requests.find(url => url.pathname.endsWith('/customer_case_publications'))!
  expect(publication.searchParams.get('customer_case_id')).toContain(selected.id)
  expect(Number(publication.searchParams.get('limit'))).toBe(26)
})

it('portal renders customer-origin rows with no published summaries, and has an exact private-only empty boundary', async () => {
  const { default: Page } = await import('@/app/portal/arenden/page')
  io.rows.forEach(row => { row.published = false })
  const expected = ordered(io.rows.filter(row => row.visible))
  const unpublished = await Page({ searchParams: Promise.resolve({}) })
  expect(cardTitles(unpublished)).toEqual(expected.slice(0, 25).map(row => row.title))
  expect(textContent(unpublished)).not.toContain('Saved summary')
  io.rows = io.rows.filter(row => !row.visible); io.requests = []
  const empty = await Page({ searchParams: Promise.resolve({}) })
  expect(cardTitles(empty)).toEqual([])
  expect(textContent(empty)).toContain('Du har inga ärenden på denna sida.')
  expect(links(empty).some(props => props.children === 'Fler ärenden')).toBe(false)
  expect(io.requests.some(url => url.pathname.endsWith('/customer_case_publications'))).toBe(false)
})

it('portal publication unavailability rejects instead of rendering a false empty or unpublished page', async () => {
  const { default: Page } = await import('@/app/portal/arenden/page')
  io.failTable = 'customer_case_publications'
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ code: 'PGRST205' })
})


it('API canonical continuation at limit1 and limit100 has exact boundaries despite later newer and older inserts', async () => {
  const { GET } = await import('@/app/api/v1/customer/cases/route')
  for (const limit of [1, 100]) {
    const baseline = ordered(io.rows.filter(row => row.visible))
    const first = await GET(new NextRequest('http://pagination-control.invalid/api/v1/customer/cases?limit=' + limit))
    const firstBody = await first.json()
    expect(firstBody.data).toHaveLength(limit); expect(firstBody.page.has_more).toBe(true)
    const newer = { ...baseline[0]!, id: id(5000 + limit), created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', title: 'Support newer ' + limit, published: false }
    newer.case_reference = publicReference('case', company, newer.id)!
    const older = { ...baseline.at(-1)!, id: id(6000 + limit), created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z', title: 'Support older ' + limit, published: false }
    older.case_reference = publicReference('case', company, older.id)!
    io.rows.push(newer, older)
    const references = firstBody.data.map((row: { case_reference: string }) => row.case_reference)
    let cursor = firstBody.page.next_cursor
    while (cursor) {
      const response = await GET(new NextRequest('http://pagination-control.invalid/api/v1/customer/cases?' + new URLSearchParams({ limit: String(limit), cursor })))
      const body = await response.json(); expect(body.page.returned).toBe(body.data.length)
      references.push(...body.data.map((row: { case_reference: string }) => row.case_reference)); cursor = body.page.next_cursor
    }
    expect(references).toEqual([...baseline.map(row => row.case_reference), older.case_reference])
    expect(new Set(references).size).toBe(references.length)
    const refreshed = await GET(new NextRequest('http://pagination-control.invalid/api/v1/customer/cases?limit=' + limit))
    expect((await refreshed.json()).data[0].case_reference).toBe(newer.case_reference)
    io.rows = io.rows.filter(row => ![newer.id, older.id].includes(row.id))
  }
})
