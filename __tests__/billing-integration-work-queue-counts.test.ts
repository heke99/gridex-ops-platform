import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BillingIntegrationsPage from '@/app/admin/billing/integrations/page'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  admin: vi.fn(),
  reads: [] as Array<{ url: URL; method: string; exact: boolean }>,
  tables: {} as Record<string, Row[]>,
  failingTable: null as string | null,
  missingCountTable: null as string | null,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/components/admin/ui/AdminDisclosurePanel', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/lib/admin/guards', async original => ({
  ...await original<typeof import('@/lib/admin/guards')>(), requireAdminPageKeyAccess: io.admin,
}))
vi.mock('@/app/admin/billing/integrations/actions', () => ({
  reprocessInvoiceProviderEventsAction: async () => undefined,
  saveNordfinClientIdAction: async () => undefined,
  selectInvoiceProviderAction: async () => undefined,
  setInvoiceDispatchEnabledAction: async () => undefined,
  testCapwayConnectionAction: async () => undefined,
}))
vi.mock('@/lib/billing/providers/registry', () => ({
  listInvoiceProviderCatalog: async () => [], loadTenantInvoiceProviderSelection: async () => null,
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.test', 'synthetic-unit-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: billingTransport },
    }),
  }
})

const id = (num: number) => `11000000-0000-4000-8000-${String(num).padStart(12, '0')}`
const company = id(1), otherCompany = id(2)
const timestamp = '2026-11-18T12:00:00.000Z'

async function billingTransport(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const table = url.pathname.split('/').at(-1)!
  const method = init?.method ?? 'GET'
  if ((method !== 'GET' && method !== 'HEAD') || !Object.hasOwn(io.tables, table)) throw new Error(`Unexpected synthetic request: ${table}`)
  const exact = new Headers(init?.headers).get('prefer')?.includes('count=exact') === true
  io.reads.push({ url, method, exact })
  if (table === io.failingTable) return method === 'HEAD'
    ? new Response(null, { status: 500 })
    : Response.json({ code: '08006', message: 'Synthetic private billing dependency failed' }, { status: 500 })

  const run = url.searchParams
  const rows = io.tables[table].filter(row =>
    (!run.has('company_id') || run.get('company_id') === `eq.${row.company_id}`)
    && (!run.has('status') || run.get('status') === `eq.${row.status}`))
  const order = (run.get('order') ?? '').split(',').filter(Boolean)
  rows.sort((a, b) => {
    for (const term of order) {
      const [column, direction] = term.split('.')
      const compared = String(a[column]).localeCompare(String(b[column]))
      if (compared) return direction === 'desc' ? -compared : compared
    }
    return 0
  })
  const page = rows.slice(0, Number(run.get('limit') ?? rows.length))
  const headers = new Headers()
  if (exact && io.missingCountTable !== table) {
    headers.set('content-range', method === 'HEAD' || !page.length ? `*/${rows.length}` : `0-${page.length - 1}/${rows.length}`)
  }
  return method === 'HEAD' ? new Response(null, { headers }) : Response.json(page, { headers })
}

function operator(platformAdmin = false, companyId: string | null = company) {
  io.admin.mockResolvedValue({ isPlatformAdmin: platformAdmin, companyId, userId: id(3), email: 'synthetic@example.test', roles: [], permissions: [] })
}

async function renderPage() {
  return renderToStaticMarkup(await BillingIntegrationsPage({ searchParams: Promise.resolve({}) }))
}

function readsFor(table: string) {
  return io.reads.filter(read => read.url.pathname.endsWith(`/${table}`))
}

beforeEach(() => {
  io.admin.mockReset()
  operator()
  io.reads = []
  io.failingTable = null
  io.missingCountTable = null
  io.tables = {
    billing_provider_connections: [], invoice_export_runs: [],
    invoice_dead_letters: [
      ...Array.from({ length: 23 }, (_, index) => ({ id: id(300 + index), company_id: company, status: 'resolved' })),
      ...Array.from({ length: 3 }, (_, index) => ({ id: id(400 + index), company_id: company, status: 'open' })),
      { id: id(450), company_id: otherCompany, status: 'open' },
    ],
    invoice_provider_events: [
      ...Array.from({ length: 210 }, (_, index) => ({ id: id(1000 + index), company_id: company, status: 'processed', received_at: timestamp })),
      ...Array.from({ length: 31 }, (_, index) => ({ id: id(2000 + index), company_id: company, status: 'needs_review', received_at: timestamp, event_type: `invoice.synthetic-${index}` })),
      { id: id(3000), company_id: otherCompany, status: 'needs_review', received_at: timestamp, event_type: 'invoice.other-company' },
    ],
  }
})

describe('billing integrations work queue totals', () => {
  it('counts all tenant open failures and pending review events without reading rows in the business view', async () => {
    const html = await renderPage()

    expect(html).toContain('Misslyckade fakturaposter: 3.')
    expect(html).toContain('Fakturahändelser att granska: 31.')
    for (const [table, status] of [['invoice_dead_letters', 'open'], ['invoice_provider_events', 'needs_review']]) {
      const reads = readsFor(table)
      expect(reads).toHaveLength(1)
      expect(reads[0]).toMatchObject({ method: 'HEAD', exact: true })
      expect(reads[0].url.searchParams.get('company_id')).toBe(`eq.${company}`)
      expect(reads[0].url.searchParams.get('status')).toBe(`eq.${status}`)
    }
  })

  it('shows the newest 25 review entries out of the full total and retains explicit platform scope', async () => {
    operator(true, null)
    const html = await renderPage()

    expect(html).toContain('Visar 25 av 32 händelser.')
    expect(html).toContain('invoice.other-company')
    expect(html.indexOf('invoice.synthetic-30')).toBeLessThan(html.indexOf('invoice.synthetic-29'))
    expect(html).not.toContain('invoice.synthetic-0')
    const [review] = readsFor('invoice_provider_events')
    expect(review).toMatchObject({ method: 'GET', exact: true })
    expect(review.url.searchParams.get('order')).toBe('received_at.desc,id.desc')
    expect(review.url.searchParams.get('limit')).toBe('25')
    expect(review.url.searchParams.has('company_id')).toBe(false)
  })

  it('reports an unavailable queue without hiding a separately confirmed count', async () => {
    io.failingTable = 'invoice_provider_events'
    const html = await renderPage()

    expect(html).toContain('Fakturakön kunde inte läsas fullständigt.')
    expect(html).toContain('Misslyckade fakturaposter: 3.')
    expect(html).not.toContain('Synthetic private billing dependency failed')
    expect(html).not.toContain('Fakturainställningarna kunde inte läsas')
  })

  it('shows an unavailable platform review when exact count metadata is absent', async () => {
    operator(true)
    io.missingCountTable = 'invoice_provider_events'
    const html = await renderPage()

    expect(html).toContain('Granskningskön kunde inte läsas.')
    expect(html).not.toContain('Inga händelser väntar på granskning.')
  })

  it('renders a genuine empty review queue after successful scoped reads', async () => {
    operator(true)
    io.tables.invoice_provider_events = io.tables.invoice_provider_events.filter(row => row.status === 'processed')

    expect(await renderPage()).toContain('Inga händelser väntar på granskning.')
  })

  it('does not issue a global read for a tenant operator without a selected company', async () => {
    operator(false, null)

    await expect(renderPage()).rejects.toThrow()
    expect(io.reads).toEqual([])
  })
})
