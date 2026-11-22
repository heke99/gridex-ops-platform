import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PortalInvoicesPage from '@/app/portal/fakturor/page'
import type { CustomerPortalContext } from '@/lib/customer-portal/types'

type StoredInvoice = {
  id: string
  company_id: string
  customer_id: string
  invoice_number: string
  issued_at: string | null
  created_at: string
  status: string
}

const io = vi.hoisted(() => ({
  context: vi.fn(),
  reads: [] as URLSearchParams[],
  invoices: [] as StoredInvoice[],
  countAvailable: true,
  serverRowLimit: 1000,
  failRead: false,
}))

vi.mock('@/lib/customer-portal/db', async original => ({
  ...await original<typeof import('@/lib/customer-portal/db')>(), getCustomerPortalContext: io.context,
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/customer-portal/invoiceFileAvailability', () => ({ readInvoiceFileAvailability: vi.fn() }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.test', 'synthetic-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: invoiceTransport },
    }),
  }
})

const companyId = 'tenant-a'
const customers = ['customer-a', 'linked-customer-b']
const invoiceId = (index: number) => `b8000000-0000-4000-8000-${String(index).padStart(12, '0')}`

function session(overrides: Partial<CustomerPortalContext> = {}) {
  const context: CustomerPortalContext = {
    companyId,
    customerIds: customers,
    customers: [],
    userEmail: null,
    branding: { companyId, brandName: 'Syntetisk elhandlare', portalName: 'Kundportal', supportEmail: null, websiteUrl: null, logoUrl: null, primaryColor: '#047857' },
    ...overrides,
  }
  io.context.mockResolvedValue(context)
}

async function invoiceTransport(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (!url.pathname.endsWith('/customer_invoices') || init?.method !== 'GET') throw new Error('Unexpected synthetic request')
  const query = url.searchParams
  io.reads.push(query)
  if (io.failRead) return Response.json({ code: '08006', message: 'Synthetic private invoice read error' }, { status: 500 })

  const included = (key: string) => (query.get(key) ?? '').slice(4, -1).split(',')
  const rows = io.invoices.filter(invoice =>
    query.get('company_id') === `eq.${invoice.company_id}`
    && included('customer_id').includes(invoice.customer_id)
    && included('status').includes(invoice.status))

  const order = query.get('order') ?? ''
  rows.sort((left, right) => {
    if (left.issued_at !== right.issued_at) {
      if (left.issued_at === null) return 1
      if (right.issued_at === null) return -1
      return right.issued_at.localeCompare(left.issued_at)
    }
    const byCreatedAt = right.created_at.localeCompare(left.created_at)
    return byCreatedAt || (order.endsWith(',id.desc') ? right.id.localeCompare(left.id) : 0)
  })

  const offset = Number(query.get('offset') ?? 0)
  const limit = Number(query.get('limit') ?? rows.length)
  if (rows.length > 0 && offset >= rows.length) {
    return Response.json({ code: 'PGRST103', message: 'Requested range not satisfiable' }, { status: 416 })
  }
  const page = rows.slice(offset, offset + Math.min(limit, io.serverRowLimit))
  const headers = new Headers()
  if (io.countAvailable && new Headers(init.headers).get('prefer')?.includes('count=exact')) {
    const range = page.length > 0 ? `${offset}-${offset + page.length - 1}` : '*'
    headers.set('content-range', `${range}/${rows.length}`)
  }
  return Response.json(page, { headers })
}

async function renderPage(page?: string | string[]) {
  return renderToStaticMarkup(await PortalInvoicesPage({ searchParams: Promise.resolve({ page }) }))
}

beforeEach(() => {
  io.context.mockReset()
  session()
  io.reads = []
  io.countAvailable = true
  io.serverRowLimit = 1000
  io.failRead = false
  io.invoices = Array.from({ length: 101 }, (_, index): StoredInvoice => ({
    id: invoiceId(index + 1),
    company_id: companyId,
    customer_id: customers[index % customers.length],
    invoice_number: `Syntetisk-${String(index + 1).padStart(3, '0')}`,
    issued_at: index === 100 ? null : '2026-11-01T12:00:00Z',
    created_at: '2026-11-01T12:00:00Z',
    status: 'issued',
  }))
  io.invoices[100].customer_id = customers[1]
  io.invoices.push(
    { ...io.invoices[0], id: invoiceId(201), company_id: 'other-tenant', invoice_number: 'Främmande bolag' },
    { ...io.invoices[0], id: invoiceId(202), customer_id: 'unlinked', invoice_number: 'Okopplad kund' },
    { ...io.invoices[0], id: invoiceId(203), status: 'draft', invoice_number: 'Dolt utkast' },
  )
})

describe('portal invoice history', () => {
  it('paginates both linked customers under one tenant before rendering a stable first page', async () => {
    const html = await renderPage()

    expect(html.match(/href="\/portal\/fakturor\/b800/g)).toHaveLength(25)
    expect(html).toContain('Visar 25 av 101 fakturor.')
    expect(html).toContain('Syntetisk-100')
    expect(html.indexOf('Syntetisk-100')).toBeLessThan(html.indexOf('Syntetisk-099'))
    expect(html).not.toContain('Syntetisk-101')
    expect(html).not.toContain('Främmande bolag')
    expect(html).not.toContain('Okopplad kund')
    expect(html).not.toContain('Dolt utkast')
    expect(html).toContain('href="?page=2"')

    expect(io.reads).toHaveLength(1)
    const [query] = io.reads
    expect(query.get('company_id')).toBe(`eq.${companyId}`)
    expect(query.get('customer_id')).toBe(`in.(${customers.join(',')})`)
    expect(query.get('status')).toBe('in.(issued,sent,paid,overdue,cancelled,credited)')
    expect(query.get('order')).toBe('issued_at.desc.nullslast,created_at.desc,id.desc')
    expect(query.get('limit')).toBe('25')
    expect(query.get('select')).not.toContain('*')
    expect(query.get('select')).not.toContain('raw_payload')
  })

  it('shows the older linked invoice after the historical 100-row cap', async () => {
    const html = await renderPage('5')

    expect(html.includes(`href="/portal/fakturor/${invoiceId(101)}"`)).toBe(true)
    expect(html).toContain('Visar 1 av 101 fakturor.')
    expect(html).toContain('Sida 5 av 5')
    expect(html).toContain('href="?page=4"')
    expect(html).not.toContain('Nästa sida')
    expect(io.reads.map(query => query.get('offset'))).toEqual(['100'])
  })

  it('recovers a stale page link within the same scope', async () => {
    const html = await renderPage('6')

    expect(html.includes('Sida 1 av 5')).toBe(true)
    expect(io.reads.map(query => query.get('offset'))).toEqual(['125', '0'])
    expect(io.reads.every(query => query.get('company_id') === `eq.${companyId}`)).toBe(true)
  })

  it.each(['missing count', 'short page', 'dependency error'])('shows a read failure without an empty-state claim for %s', async failure => {
    io.countAvailable = failure !== 'missing count'
    io.serverRowLimit = failure === 'short page' ? 10 : 1000
    io.failRead = failure === 'dependency error'

    const html = await renderPage()

    expect(html.includes('Fakturahistoriken kunde inte läsas.')).toBe(true)
    expect(html).not.toContain('Du har inga fakturor ännu.')
    expect(html).not.toContain('Synthetic private invoice read error')
    expect(html).not.toContain('Nästa sida')
  })

  it('shows an empty history after a successful scoped read', async () => {
    io.invoices = []
    const html = await renderPage()

    expect(html).toContain('Du har inga fakturor ännu.')
    expect(html).not.toContain('Fakturahistoriken kunde inte läsas.')
    expect(io.reads).toHaveLength(1)
  })

  it.each([{ companyId: null }, { customerIds: [] }])('does not query invoices without an authorized tenant and linked customers', async scope => {
    session(scope)
    expect(await renderPage()).toContain('Du har inga fakturor ännu.')
    expect(io.reads).toEqual([])
  })
})
