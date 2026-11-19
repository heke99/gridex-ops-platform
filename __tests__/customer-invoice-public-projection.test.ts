import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as listInvoices } from '@/app/api/v1/customer/invoices/route'
import { GET as invoiceDetails } from '@/app/api/v1/customer/invoices/[id]/route'
import { GET as getBundle } from '@/app/api/v1/customer/portal-bundle/route'
import { getPortalInvoice } from '@/lib/customer-portal/apiData'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  invoiceQueries: [] as URLSearchParams[],
  payloadSizes: [] as number[],
  retention: [] as Row[],
  missingColumns: new Set<string>(),
}))
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const companyId = id(101), customerId = id(102), issuedId = id(103), paidId = id(104), pdfId = id(105)
const createdAt = '2026-11-18T10:00:00.000Z'
const issuedRef = 'invoice_' + '1'.repeat(32)
const paidRef = 'invoice_' + '2'.repeat(32)
const client = { id: id(106), company_id: companyId }
const stored: Row[] = [
  { id: issuedId, company_id: companyId, customer_id: customerId, status: 'issued', created_at: createdAt,
    invoice_reference: issuedRef, invoice_number: 'ISSUED-1', period_start: '2026-10-01', total_kwh: 280,
    amount_inc_vat: 523, pdf_url: 'https://example.invalid/internal-legacy-file', metadata: { synthetic: 'z'.repeat(8192) } },
  { id: paidId, company_id: companyId, customer_id: customerId, status: 'paid', created_at: createdAt,
    invoice_reference: null, partner_invoice_reference: paidRef, invoice_number: 'PAID-2', period_start: '2026-09-01',
    total_kwh: 180, amount_inc_vat: 410, metadata: { synthetic: 'x'.repeat(8192) } },
  { id: id(107), company_id: companyId, customer_id: customerId, status: 'draft', created_at: '2026-11-19T10:00:00Z', invoice_number: 'DRAFT' },
  { id: id(108), company_id: id(801), customer_id: customerId, status: 'paid', created_at: createdAt, invoice_number: 'FOREIGN-COMPANY' },
  { id: id(109), company_id: companyId, customer_id: id(802), status: 'paid', created_at: createdAt, invoice_number: 'FOREIGN-CUSTOMER' },
]
const publicColumns = [
  'id', 'invoice_reference', 'partner_invoice_reference', 'invoice_number', 'period_start', 'period_end', 'total_kwh',
  'amount_ex_vat', 'vat_amount', 'amount_inc_vat', 'currency', 'due_date', 'issued_at', 'paid_at', 'status', 'created_at',
]
const publicLegacyColumns = publicColumns.filter(column => column !== 'partner_invoice_reference' && column !== 'total_kwh')
const base = 'https://ops.example.test/api/v1/customer/'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/env/supabaseServer', () => ({ getSupabaseServiceEnv: () => ({ serviceRoleKey: 'synthetic-cursor-key' }) }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://synthetic.example.test', 'fixture-only', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: syntheticFetch },
  }) }
})
vi.mock('@/lib/integrations/apiAuth', async original => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(), logIntegrationApiRequest: vi.fn(),
  currentIntegrationApiResponseContext: () => null,
}))
vi.mock('@/lib/customer-portal/externalApi', async original => ({
  ...await original<typeof import('@/lib/customer-portal/externalApi')>(),
  requireCustomerPortalApiContext: async () => ({
    ok: true, client, identity: { customer_id: customerId, provider: 'synthetic', customer: { id: customerId, status: 'active' } }, startedAt: 20,
  }),
}))

async function syntheticFetch(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init)
  const url = new URL(request.url)
  expect(url.origin).toBe('https://synthetic.example.test')
  if (url.pathname.endsWith('/rpc/ediel_require_portal_retention_access_v1')) {
    const args = await request.json()
    expect(args).toEqual({ p_company_id: companyId, p_customer_id: customerId })
    io.retention.push(args)
    return Response.json(null)
  }
  if (url.pathname.endsWith('/rpc/ediel_require_invoice_file_copy_available_v1')) {
    const args = await request.json()
    expect(args).toEqual({ p_company_id: companyId, p_retention_class: 'customer_invoice_document_pdf_bytes', p_target_id: pdfId })
    io.retention.push(args)
    return Response.json({ code: '23514', message: 'invoice_file_copy_retention_tombstoned' }, { status: 400 })
  }
  if (url.pathname.endsWith('/customer_portal_api_access_logs') && request.method === 'POST') return new Response(null, { status: 201 })
  if (url.pathname.endsWith('/customer_invoice_lines') || url.pathname.endsWith('/customer_invoice_documents')) {
    expect(url.searchParams.get('company_id')).toBe(`eq.${companyId}`)
    expect(url.searchParams.get('invoice_id')).toBe(`eq.${issuedId}`)
    const rows = url.pathname.endsWith('/customer_invoice_lines')
      ? [{ id: id(111), description: 'Synthetic line', amount_inc_vat: 523, created_at: createdAt }]
      : [{ id: pdfId, title: 'Synthetic invoice document', document_type: 'invoice_pdf', public_url: 'https://example.invalid/retired', created_at: createdAt }]
    return Response.json(rows, { headers: { 'content-range': '0-0/1' } })
  }
  if (!url.pathname.endsWith('/customer_invoices')) return Response.json([])

  const query = url.searchParams
  io.invoiceQueries.push(query)
  const columnNames = query.get('select')!.split(',')
  const missing = columnNames.find(column => io.missingColumns.has(column))
  if (missing) return Response.json({ code: '42703', message: `column customer_invoices.${missing} does not exist` }, { status: 400 })
  const statuses = query.get('status')?.slice(4, -1).split(',') ?? []
  const reference = query.get('invoice_reference')
  const internalId = query.get('id')
  const seek = query.get('or')
  if (seek) expect(seek).toBe(`(created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${paidId}))`)
  const order = query.get('order')?.split('.')[0]
  const selected = stored
    .filter(row => query.get('company_id') === `eq.${row.company_id}` && query.get('customer_id') === `eq.${row.customer_id}`
      && statuses.includes(String(row.status)) && (!reference || reference === `eq.${row.invoice_reference}`)
      && (!internalId || internalId === `eq.${row.id}`) && (!seek || String(row.id) < paidId))
    .sort((a, b) => order ? String(b[order]).localeCompare(String(a[order])) || String(b.id).localeCompare(String(a.id)) : 0)
    .slice(0, Number(query.get('limit') ?? 100))
    .map(row => Object.fromEntries(columnNames.map(column => [column, row[column] ?? null])))
  const response = JSON.stringify(selected)
  io.payloadSizes.push(Buffer.byteLength(response))
  return new Response(response, { headers: { 'content-type': 'application/json' } })
}

function expectProjection(columns: string[] = publicColumns, index = 0) {
  const query = io.invoiceQueries[index]
  expect(query.get('select')!.split(',').sort()).toEqual([...columns].sort())
  expect(query.get('company_id')).toBe(`eq.${companyId}`)
  expect(query.get('customer_id')).toBe(`eq.${customerId}`)
  expect(query.get('status')).toContain('issued')
  expect(query.get('status')).toContain('paid')
}

async function readBundle() {
  const response = await getBundle(new NextRequest(base + 'portal-bundle?include=invoices'))
  expect(response.status).toBe(200)
  const { data } = await response.json()
  return data.invoices
}

beforeEach(() => {
  io.invoiceQueries = []
  io.payloadSizes = []
  io.retention = []
  io.missingColumns.clear()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('public invoice projections', () => {
  it('returns exactly the scoped list page and follows the same timestamp cursor', async () => {
    const first = await listInvoices(new NextRequest(base + 'invoices?limit=1'))
    expect(first.status).toBe(200)
    const { data, page } = await first.json()
    expect(data).toEqual([expect.objectContaining({ invoice_reference: paidRef, total_kwh: 180, amount_inc_vat: 410 })])
    expect(page.next_cursor).toEqual(expect.any(String))
    const next = await listInvoices(new NextRequest(base + `invoices?limit=1&cursor=${encodeURIComponent(page.next_cursor)}`))
    expect(next.status).toBe(200)
    expect(await next.json()).toMatchObject({ data: [{ invoice_reference: issuedRef, total_kwh: 280 }], page: { next_cursor: null } })
    expect(io.invoiceQueries).toHaveLength(2)
    for (const index of [0, 1]) {
      expectProjection(publicColumns, index)
      expect(io.invoiceQueries[index].get('order')).toBe('created_at.desc.nullslast,id.desc')
      expect(io.invoiceQueries[index].get('limit')).toBe('2')
    }
    expect(io.payloadSizes[0]).toBeLessThan(2048)
  })

  it('keeps Bundle invoice period order and avoids fallback for absent private columns', async () => {
    io.missingColumns.add('metadata').add('pdf_url')
    expect(await readBundle()).toEqual([
      expect.objectContaining({ invoice_reference: issuedRef, total_kwh: 280 }),
      expect.objectContaining({ invoice_reference: paidRef, total_kwh: 180 }),
    ])
    expect(io.invoiceQueries).toHaveLength(1)
    expectProjection()
    expect(io.invoiceQueries[0].get('order')).toBe('period_start.desc.nullslast')
  })

  it.each(['dedicated', 'bundle'] as const)('preserves legacy reference and nullable quantity for %s', async (endpoint) => {
    io.missingColumns.add('partner_invoice_reference').add('total_kwh')
    const rows = endpoint === 'bundle' ? await readBundle() : (await (await listInvoices(new NextRequest(base + 'invoices'))).json()).data
    expect(rows).toHaveLength(2)
    expect(rows).toContainEqual(expect.objectContaining({ invoice_reference: 'PAID-2', total_kwh: null, amount_inc_vat: 410 }))
    expect(io.invoiceQueries).toHaveLength(2)
    expectProjection()
    expectProjection(publicLegacyColumns, 1)
  })

  it('keeps canonical detail matching and redacts a retired PDF URL through the existing check', async () => {
    io.missingColumns.add('pdf_url').add('metadata')
    const response = await invoiceDetails(new NextRequest(base + `invoices/${issuedRef}`), { params: Promise.resolve({ id: issuedRef }) })
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.invoice).toMatchObject({ invoice_reference: issuedRef, total_kwh: 280 })
    expect(data.lines).toEqual([expect.objectContaining({ description: 'Synthetic line' })])
    expect(data.documents).toEqual([expect.objectContaining({ document_type: 'invoice_pdf', secure_url: null })])
    expect(io.invoiceQueries).toHaveLength(1)
    expectProjection()
    expect(io.invoiceQueries[0].get('invoice_reference')).toBe(`eq.${issuedRef}`)
    expect(io.retention).toEqual([
      { p_company_id: companyId, p_customer_id: customerId },
      { p_company_id: companyId, p_retention_class: 'customer_invoice_document_pdf_bytes', p_target_id: pdfId },
    ])
  })

  it('preserves the separate internal invoice getter and its full fields', async () => {
    const value = await getPortalInvoice({ companyId, customerId, externalCustomerId: null, customerNumber: null, provider: 'synthetic' }, issuedId)
    expect(value).toMatchObject({ id: issuedId, metadata: { synthetic: 'z'.repeat(8192) }, pdf_url: stored[0].pdf_url })
    expect(io.invoiceQueries).toHaveLength(1)
    expect(io.invoiceQueries[0].get('id')).toBe(`eq.${issuedId}`)
  })
})
