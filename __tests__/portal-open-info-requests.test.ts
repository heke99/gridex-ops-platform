import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PortalCompletionPage from '@/app/portal/komplettera/page'
import PortalStatusPage from '@/app/portal/status/page'
import type { CustomerPortalContext, CustomerPortalCustomerRow } from '@/lib/customer-portal/types'

type StoredRequest = ReturnType<typeof request>

const io = vi.hoisted(() => ({
  context: vi.fn(),
  requests: [] as StoredRequest[],
  reads: [] as URLSearchParams[],
  countAvailable: true,
  rangeErrorHasCode: true,
}))

vi.mock('@/lib/customer-portal/db', async original => ({
  ...await original<typeof import('@/lib/customer-portal/db')>(), getCustomerPortalContext: io.context,
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/customer-portal/invoiceFileAvailability', () => ({ readInvoiceFileAvailability: vi.fn() }))
vi.mock('@/app/portal/komplettera/actions', () => ({ submitPortalCompletionAction: vi.fn() }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.test', 'synthetic-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: requestTransport },
    }),
  }
})

const companyId = 'tenant-a'
const customerId = 'customer-a'

function request(index: number, status: string, overrides = {}) {
  return {
    id: `e8700000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    company_id: companyId,
    customer_id: customerId,
    request_type: 'z01_customer_masterdata',
    status,
    notes: `Syntetiskt underlag ${index}`,
    updated_at: new Date(Date.UTC(2026, 9, index + 1)).toISOString(),
    ...overrides,
  }
}

function customer(id: string, name: string): CustomerPortalCustomerRow {
  return {
    id, full_name: name, customer_number: null, customer_type: null, status: null,
    first_name: null, last_name: null, company_name: null, email: null, phone: null,
  }
}

function session(overrides: Partial<CustomerPortalContext> = {}) {
  io.context.mockResolvedValue({
    companyId,
    customerIds: [customerId, 'linked-customer'],
    customers: [],
    userEmail: null,
    branding: { companyId, brandName: 'Syntetisk elhandlare', portalName: 'Kundportal', supportEmail: null, websiteUrl: null, logoUrl: null, primaryColor: '#047857' },
    ...overrides,
  } satisfies CustomerPortalContext)
}

async function requestTransport(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (init?.method !== 'GET') throw new Error('Unexpected synthetic method')
  if (!url.pathname.endsWith('/customer_info_requests')) return Response.json([])
  const query = url.searchParams
  io.reads.push(query)

  const [operator, values] = (query.get('status') ?? '').split('(')
  const statuses = values?.slice(0, -1).split(',') ?? []
  const included = (query.get('customer_id') ?? '').slice(4, -1).split(',')
  const rows = io.requests.filter(row =>
    query.get('company_id') === `eq.${row.company_id}`
    && included.includes(row.customer_id)
    && (!query.has('id') || query.get('id') === `eq.${row.id}`)
    && (!operator || statuses.includes(row.status) === (operator === 'in.'))
  )
  const order = query.get('order') ?? ''
  rows.sort((left, right) => right.updated_at.localeCompare(left.updated_at)
    || (order.endsWith(',id.desc') ? right.id.localeCompare(left.id) : 0))
  const offset = Number(query.get('offset') ?? 0)
  const limit = Number(query.get('limit') ?? rows.length)
  if (offset > 0 && offset >= rows.length) {
    if (io.rangeErrorHasCode) return Response.json({ code: 'PGRST103', message: 'Requested range not satisfiable' }, { status: 416 })
    return new Response(null, { status: 416, headers: { 'content-range': `*/${rows.length}` } })
  }
  const page = rows.slice(offset, offset + limit)
  const headers = new Headers()
  if (io.countAvailable && new Headers(init.headers).get('prefer')?.includes('count=exact')) {
    const range = page.length > 0 ? `${offset}-${offset + page.length - 1}` : '*'
    headers.set('content-range', `${range}/${rows.length}`)
  }
  return Response.json(page, { headers })
}

beforeEach(() => {
  io.context.mockReset()
  session()
  io.reads = []
  io.countAvailable = true
  io.rangeErrorHasCode = true
  io.requests = [
    request(1, 'missing_binding_info', { notes: 'Öppet originalunderlag' }),
    ...Array.from({ length: 102 }, (_, index) => request(index + 2, 'completed', { notes: 'Avslutad intern historik' })),
    request(200, 'draft', { company_id: 'other-tenant', notes: 'Annat bolag' }),
    request(201, 'draft', { customer_id: 'other-customer', notes: 'Annan kund' }),
  ]
})

describe('portalens öppna uppgiftsbegäran', () => {
  it('hittar öppet arbete bakom 102 nyare historiska rader i båda ordinarie vyer', async () => {
    const status = renderToStaticMarkup(await PortalStatusPage())
    const completion = renderToStaticMarkup(await PortalCompletionPage({}))
    for (const html of [status, completion]) {
      expect(html).toContain('Öppet originalunderlag')
      expect(html).not.toContain('Annat bolag')
      expect(html).not.toContain('Annan kund')
    }
    expect(status).not.toContain('Avslutad intern historik')
    expect(completion).toContain('Avslutade uppgiftsbegäranden')
    expect(completion).not.toContain('Avslutad intern historik')
  })

  it('visar exakt antal öppna resultat när mer än en visningssida finns', async () => {
    io.requests = Array.from({ length: 111 }, (_, index) => request(index + 1, 'draft'))
    const status = renderToStaticMarkup(await PortalStatusPage())
    expect(status).toMatch(/Öppna uppgiftsbegäran<\/p><p[^>]*>111<\/p>/)
  })

  it('visar nästa sida i stabil ordning även när tiderna är lika', async () => {
    io.requests = Array.from({ length: 17 }, (_, index) => request(index + 1, 'draft', { updated_at: '2026-11-19T12:00:00.000Z' }))
    const status = renderToStaticMarkup(await PortalStatusPage())
    expect(status).toContain(`/portal/komplettera?request=${request(17, 'draft').id}#uppgiftsbegaran-${request(17, 'draft').id}`)

    const pageTwo = renderToStaticMarkup(await PortalCompletionPage({ searchParams: Promise.resolve({ page: '2' }) }))
    expect(pageTwo).toContain(`id="uppgiftsbegaran-${request(9, 'draft').id}"`)
    expect(pageTwo).not.toContain(`id="uppgiftsbegaran-${request(10, 'draft').id}"`)
    expect(pageTwo).toContain('/portal/komplettera?page=3')
    expect(io.reads.find(read => read.get('offset') === '8')?.get('order')).toBe('updated_at.desc,id.desc')
  })

  it('kan visa ett länkat arbetsunderlag utanför sidan utan att visa en annan kunds rad', async () => {
    session({ customers: [customer(customerId, 'Första kunden'), customer('linked-customer', 'Länkad kund')] })
    const selected = request(1, 'draft', { customer_id: 'linked-customer', notes: 'Länkat äldre underlag' })
    const foreign = request(2, 'draft', { customer_id: 'other-customer', notes: 'Annan kunds anteckning' })
    io.requests = [selected, foreign, ...Array.from({ length: 10 }, (_, index) => request(index + 3, 'draft'))]
    const renderSelection = async (id: string) => renderToStaticMarkup(await PortalCompletionPage({
      searchParams: Promise.resolve({ request: id }),
    }))
    const found = await renderSelection(selected.id)
    expect(found).toContain('Länkat äldre underlag')
    expect(found).toContain(`id="uppgiftsbegaran-${selected.id}"`)
    expect(found).toMatch(/name="customer_id" value="linked-customer"/)
    expect(found).toContain('Länkad kund')
    const foreignPage = await renderSelection(foreign.id)
    expect(foreignPage).not.toContain('Annan kunds anteckning')
    expect(foreignPage).toMatch(/name="customer_id" value="customer-a"/)
    const lookup = io.reads.find(read => read.get('id') === `eq.${selected.id}`)
    expect(lookup?.get('company_id')).toBe('eq.tenant-a')
    expect(lookup?.get('customer_id')).toBe('in.(customer-a,linked-customer)')
    expect(lookup?.get('status')).toBe('not.in.(completed,closed,cancelled,rejected)')
  })

  it('väljer formulärets kund även för ett underlag som redan finns på första sidan', async () => {
    session({ customers: [customer(customerId, 'Första kunden'), customer('linked-customer', 'Länkad kund')] })
    const selected = request(190, 'draft', { customer_id: 'linked-customer' })
    const rejected = request(191, 'rejected', { customer_id: 'linked-customer' })
    io.requests.push(selected, rejected)
    const renderSelection = async (id: string) => renderToStaticMarkup(await PortalCompletionPage({
      searchParams: Promise.resolve({ request: id.toUpperCase() }),
    }))
    expect(await renderSelection(selected.id)).toMatch(/name="customer_id" value="linked-customer"/)
    expect(io.reads.some(read => read.has('id'))).toBe(false)
    expect(await renderSelection(rejected.id)).toMatch(/name="customer_id" value="customer-a"/)
  })

  it.each([true, false])('återgår från en tidigare giltig sida med eller utan JSON-felkod (%s)', async (hasCode) => {
    io.rangeErrorHasCode = hasCode
    const html = renderToStaticMarkup(await PortalCompletionPage({ searchParams: Promise.resolve({ page: '5' }) }))
    expect(html).toContain('Öppet originalunderlag')
    expect(html).not.toContain('Föregående')
    expect(io.reads.filter(read => read.get('status')?.startsWith('not')).map(read => read.get('offset'))).toEqual(['32', '0'])
  })

  it('visar inte ett obekräftat antal som noll', async () => {
    io.requests = []
    io.countAvailable = false
    await expect(PortalStatusPage()).rejects.toThrow('Portal information request count unavailable')
  })

  it('läser inga uppgiftsbegäranden utan verifierat bolag och kund', async () => {
    session({ companyId: null, customerIds: [] })
    await PortalStatusPage()
    await PortalCompletionPage({})
    expect(io.reads).toHaveLength(0)
  })
})
