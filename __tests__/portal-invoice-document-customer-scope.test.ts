import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PortalInvoiceDetail from '@/app/(invoice-detail)/portal/fakturor/[id]/page'

type Row = Record<string, unknown>

const io = vi.hoisted(() => ({
  signedIn: true,
  tables: {} as Record<string, Row[]>,
  reads: [] as Array<{ table: string; selectedIds: unknown[] }>,
  checks: [] as Array<{ p_company_id: string; p_retention_class: string; p_target_id: string }>,
  retired: new Set<string>(),
}))

const uuid = (n: number) => '20000000-0000-4000-8000-' + String(n).padStart(12, '0')
const company = uuid(1)
const foreignCompany = uuid(2)
const customer = uuid(3)
const linkedSibling = uuid(4)
const unrelatedCustomer = uuid(5)
const user = uuid(6)
const invoiceId = uuid(7)
const documentId = uuid(8)
const syntheticUrl = 'https://files.example.invalid/invoice.pdf'
const copyClass = 'customer_invoice_document_pdf_bytes'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({
      data: { user: io.signedIn ? { id: user, email: 'customer@example.invalid' } : null },
    }) },
  }),
}))

vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.invalid', 'synthetic-only-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: readInvoiceFixture },
    }),
  }
})

function matches(row: Row, key: string, expression: string): boolean {
  if (expression.startsWith('eq.')) return String(row[key]) === expression.slice(3)
  if (expression === 'is.null') return row[key] == null
  if (expression.startsWith('in.(') && expression.endsWith(')')) {
    return expression.slice(4, -1).split(',').includes(String(row[key]))
  }
  throw new Error('Unsupported synthetic query condition: ' + key + '.' + expression)
}

function matchesFilter(row: Row, key: string, expression: string): boolean {
  if (key !== 'or') return matches(row, key, expression)
  expect(expression).toMatch(/^\(.+\)$/)
  return expression.slice(1, -1).split(/,(?![^()]*\))/).some(term => {
    const separator = term.indexOf('.')
    return matches(row, term.slice(0, separator), term.slice(separator + 1))
  })
}

async function readInvoiceFixture(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init)
  const url = new URL(request.url)
  expect(url.origin).toBe('https://synthetic.example.invalid')
  if (url.pathname === '/rest/v1/rpc/ediel_require_invoice_file_copy_available_v1') {
    expect(request.method).toBe('POST')
    const args = await request.json()
    expect(args.p_company_id).toBe(company)
    io.checks.push(args)
    return io.retired.has(args.p_target_id)
      ? Response.json({ code: '23514', message: 'invoice_file_copy_retention_tombstoned' }, { status: 400 })
      : Response.json(null)
  }

  expect(request.method).toBe('GET')
  const table = url.pathname.split('/').at(-1) ?? ''
  const rows = io.tables[table]
  if (!rows) throw new Error('Unexpected synthetic table: ' + table)
  const q = url.searchParams
  const filters = [...q].filter(([key]) => !['select', 'order', 'limit'].includes(key))
  let result = rows.filter(row => filters.every(([key, expression]) => matchesFilter(row, key, expression)))
  if (q.get('order')?.startsWith('created_at.desc')) {
    result = result.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  }
  if (q.has('limit')) result = result.slice(0, Number(q.get('limit')))
  io.reads.push({ table, selectedIds: result.map(row => row.id) })
  return Response.json(result)
}

function document(overrides: Row = {}): Row {
  return {
    id: documentId,
    company_id: company,
    customer_id: customer,
    invoice_id: invoiceId,
    document_type: 'invoice_pdf',
    public_url: syntheticUrl,
    file_path: 'synthetic-invoice.pdf',
    created_at: '2026-10-01T00:00:00Z',
    ...overrides,
  }
}

async function view() {
  return renderToStaticMarkup(await PortalInvoiceDetail({ params: Promise.resolve({ id: invoiceId }) }))
}

function selectedDocuments() {
  return io.reads.filter(read => read.table === 'customer_invoice_documents').flatMap(read => read.selectedIds)
}

function documentChecks() {
  return io.checks.filter(check => check.p_retention_class === copyClass).map(check => check.p_target_id)
}

beforeEach(() => {
  vi.stubGlobal('React', React)
  io.signedIn = true
  io.reads = []
  io.checks = []
  io.retired.clear()
  io.tables = {
    customer_portal_accounts: [
      { customer_id: customer, company_id: company, user_id: user, is_active: true, activated_at: '2026-11-01T00:00:00Z' },
      { customer_id: linkedSibling, company_id: company, user_id: user, is_active: true, activated_at: '2026-10-01T00:00:00Z' },
    ],
    customers: [{ id: customer, company_id: company }, { id: linkedSibling, company_id: company }],
    companies: [{ id: company, name: 'Syntetiskt bolag' }],
    customer_invoices: [{
      id: invoiceId, company_id: company, customer_id: customer, status: 'paid',
      invoice_number: 'TEST-001', amount_inc_vat: 100, pdf_url: null, pdf_path: null,
    }],
    customer_invoice_lines: [{
      id: uuid(9), company_id: company, invoice_id: invoiceId,
      description: 'Ägd fakturarad', line_type: 'consumption', sort_order: 1,
    }],
    customer_invoice_documents: [],
  }
})

afterEach(() => vi.unstubAllGlobals())

describe('document read scope on the actual portal invoice detail', () => {
  it.each([customer, null])('opens a qualified invoice PDF for its owner with document customer %s', async documentCustomer => {
    io.tables.customer_invoice_documents = [document({ customer_id: documentCustomer })]

    const html = await view()

    expect(selectedDocuments()).toEqual([documentId])
    expect(documentChecks()).toEqual([documentId])
    expect(html).toContain('href="' + syntheticUrl + '"')
    expect(html).toContain('Ägd fakturarad')
  })

  it.each([
    ['another linked customer in the same company', { customer_id: linkedSibling }],
    ['an unrelated customer in the same company', { customer_id: unrelatedCustomer }],
    ['a legacy document with another invoice ID', { customer_id: null, invoice_id: uuid(10) }],
    ['a legacy document with another company', { customer_id: null, company_id: foreignCompany }],
    ['a legacy document without company scope', { customer_id: null, company_id: null }],
    ['another document type with a PDF name and URL', { document_type: 'credit_attachment', file_name: 'attachment.pdf' }],
  ])('omits %s before reading the copy status', async (_description, row) => {
    io.tables.customer_invoice_documents = [document(row)]

    const html = await view()

    expect(selectedDocuments()).toEqual([])
    expect(documentChecks()).toEqual([])
    expect(html).not.toContain(syntheticUrl)
    expect(html).toContain('Ägd fakturarad')
  })

  it('selects the older qualified invoice PDF before limiting newer documents of other types', async () => {
    io.tables.customer_invoice_documents = [
      ...Array.from({ length: 101 }, (_, index) => document({
        id: uuid(100 + index),
        document_type: 'other_attachment_' + index,
        public_url: 'https://files.example.invalid/other-' + index + '.pdf',
        created_at: '2026-11-01T00:00:00Z',
      })),
      document(),
    ]

    const html = await view()

    expect(selectedDocuments()).toEqual([documentId])
    expect(documentChecks()).toEqual([documentId])
    expect(html).toContain('href="' + syntheticUrl + '"')
  })

  it('retains the invoice and rows when its qualified PDF was retired', async () => {
    io.tables.customer_invoice_documents = [document({ customer_id: null })]
    io.retired.add(documentId)

    const html = await view()

    expect(documentChecks()).toEqual([documentId])
    expect(html).toContain('En PDF-kopia är inte längre tillgänglig.')
    expect(html).not.toContain(syntheticUrl)
    expect(html).toContain('Ägd fakturarad')
  })

  it.each([
    ['another company', { company_id: foreignCompany }],
    ['an unlinked customer', { customer_id: unrelatedCustomer }],
    ['an unpublished invoice', { status: 'draft' }],
  ])('does not query any invoice children for %s', async (_description, row) => {
    Object.assign(io.tables.customer_invoices[0], row)

    await expect(view()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/)

    expect(io.reads.map(read => read.table)).not.toContain('customer_invoice_documents')
    expect(io.reads.map(read => read.table)).not.toContain('customer_invoice_lines')
    expect(io.checks).toEqual([])
  })

  it('redirects an anonymous request before reading any invoice data', async () => {
    io.signedIn = false

    await expect(view()).rejects.toThrow(/NEXT_REDIRECT/)

    expect(io.reads).toEqual([])
    expect(io.checks).toEqual([])
  })
})
