import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import type { LinkedPortalIdentity } from '@/lib/customer-portal/externalApi'
import type { CustomerPortalContext } from '@/lib/customer-portal/types'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  reads: [] as string[],
  fileChecks: [] as Row[],
  retired: new Set<string>(),
  fileError: null as { code: string; message: string } | null,
  sourceErrors: {} as Record<string, { code: string; message: string }>,
  webSignedIn: true,
  apiAllowed: true,
  requestedScopes: [] as unknown[],
}))

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`) },
  notFound: () => { throw new Error('notFound') },
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...props }, children),
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: io.webSignedIn ? { id: user, email: 'synthetic@example.test' } : null }, error: null }) },
  }),
}))
vi.mock('@/lib/customer-portal/externalApi', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/customer-portal/externalApi')>()
  return {
    ...actual,
    // Only the external credential/resolved-identity port is supplied. The
    // actual route, response formatter, error handler and audit adapters execute.
    requireCustomerPortalApiContext: async (_request: NextRequest, scopes: unknown) => {
      io.requestedScopes.push(scopes)
      return io.apiAllowed
        ? { ok: true, client, identity, requestId: 'synthetic-request', startedAt: Date.now() }
        : { ok: false, response: actual.customerPortalJson({ error: 'Synthetic access denied', code: 'scope_denied' }, { status: 403 }) }
    },
  }
})
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('http://127.0.0.1:54321', 'synthetic-unit-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        // Actual retained copy helper and SDK serialize exact company/class/id.
        // This finite transport has no bytes, Storage or business write port.
        fetch: async (input, init) => {
          const url = new URL(input instanceof Request ? input.url : String(input))
          const resource = url.pathname.split('/').at(-1)!
          const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
            status, headers: { 'content-type': 'application/json' },
          })
          if (url.pathname.includes('/rpc/')) {
            if (resource === 'ediel_require_portal_retention_access_v1') return reply(null)
            if (resource !== 'ediel_require_invoice_file_copy_available_v1') throw new Error(`Unexpected RPC: ${resource}`)
            const args = JSON.parse(String(init?.body)) as Row
            io.fileChecks.push(args)
            if (io.fileError) return reply(io.fileError, 500)
            const key = JSON.stringify([args.p_company_id, args.p_retention_class, args.p_target_id])
            return io.retired.has(key)
              ? reply({ code: '23514', message: 'invoice_file_copy_retention_tombstoned' }, 400)
              : reply(null)
          }
          if (init?.method === 'POST') {
            if (!['customer_portal_api_access_logs', 'integration_api_requests'].includes(resource)) throw new Error(`Unexpected write: ${resource}`)
            return reply([], 201)
          }
          if (init?.method && init.method !== 'GET') throw new Error(`Unexpected mutation: ${resource}`)
          io.reads.push(resource)
          if (io.sourceErrors[resource]) return reply(io.sourceErrors[resource], 500)
          if (!Object.hasOwn(io.tables, resource)) throw new Error(`Unexpected data/Storage read: ${resource}`)
          let rows = [...io.tables[resource]]
          for (const [field, expression] of url.searchParams) {
            if (['select', 'order', 'limit'].includes(field)) continue
            const dot = expression.indexOf('.')
            const operator = expression.slice(0, dot), value = expression.slice(dot + 1)
            rows = rows.filter(row => {
              if (row[field] == null) return false
              if (operator === 'eq') return String(row[field]) === value
              if (operator === 'in') return value.slice(1, -1).split(',').includes(String(row[field]))
              throw new Error(`Unexpected filter: ${operator}`)
            })
          }
          const order = url.searchParams.get('order')?.split(',') ?? []
          rows.sort((a, b) => {
            for (const term of order) {
              const [field, direction, nullOrder] = term.split('.')
              const left = a[field], right = b[field]
              if (left == null && right == null) continue
              if (left == null) return nullOrder === 'nullslast' ? 1 : -1
              if (right == null) return nullOrder === 'nullslast' ? -1 : 1
              const difference = String(left).localeCompare(String(right)) * (direction === 'desc' ? -1 : 1)
              if (difference) return difference
            }
            return 0
          })
          const limit = url.searchParams.get('limit')
          if (limit) rows = rows.slice(0, Number(limit))
          const select = url.searchParams.get('select')
          if (select && select !== '*') rows = rows.map(row => Object.fromEntries(select.split(',').map(field => [field, row[field] ?? null])))
          return reply(rows)
        },
      },
    }),
  }
})

import { getPortalInvoiceDetail } from '@/lib/customer-portal/db'
import InvoicePage from '@/app/portal/fakturor/[id]/page'
import { GET } from '@/app/api/v1/customer/invoices/[id]/route'
import { requireInvoiceFileCopyAvailable } from '@/lib/ediel/retention/invoiceFileRetention'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = uuid(1), customer = uuid(2), user = uuid(3), invoiceId = uuid(4), documentId = uuid(5)
const timestamp = '2026-10-01T12:00:00.000Z'
const primaryUrl = 'https://files.example.test/primary.pdf'
const retiredUrl = 'https://files.example.test/retired.pdf'
const alternateUrl = 'https://files.example.test/alternate.pdf'
const client: IntegrationApiClient = {
  id: uuid(6), company_id: company, name: 'Synthetic API client', status: 'active',
  key_prefix: 'synthetic', secret_hash: 'synthetic-not-a-credential', scopes: ['customer_invoices.read'],
  allowed_ips: [], rate_limit_per_minute: 30, expires_at: null,
}
const identity: LinkedPortalIdentity = {
  id: null, company_id: company, customer_id: customer, external_customer_id: null,
  email: 'synthetic@example.test', customer_number: 'TEST-1', auth_user_id: null,
  customer_portal_user_id: null, match_strength: 'exact', match_method: 'resolved-account', provider: null,
  customer: { id: customer, company_id: company, status: 'active' },
}
const context: CustomerPortalContext = {
  companyId: company, customerIds: [customer], customers: [], userEmail: identity.email,
  branding: { companyId: company, brandName: 'Testbolag', portalName: 'Kundportal', supportEmail: null, websiteUrl: null, logoUrl: null, primaryColor: '#047857' },
}
function retire(retentionClass: string, targetId: string) {
  io.retired.add(JSON.stringify([company, retentionClass, targetId]))
}
function document(id = documentId, overrides: Row = {}): Row {
  return {
    id, company_id: company, invoice_id: invoiceId, document_type: 'invoice_pdf', title: 'Historisk fakturakopia',
    public_url: retiredUrl, file_path: `companies/${company}/invoices/document.pdf`,
    source_system: 'synthetic-provider', status: 'retained', created_at: timestamp, ...overrides,
  }
}
async function web() { return getPortalInvoiceDetail(context, invoiceId) }
async function page() { return renderToStaticMarkup(await InvoicePage({ params: Promise.resolve({ id: invoiceId }) })) }
async function api() {
  return GET(new NextRequest('http://127.0.0.1:54321/api/v1/customer/invoices/synthetic-invoice-reference'), {
    params: Promise.resolve({ id: 'synthetic-invoice-reference' }),
  })
}

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  io.reads = []; io.fileChecks = []; io.retired = new Set(); io.fileError = null; io.sourceErrors = {}
  io.webSignedIn = true; io.apiAllowed = true; io.requestedScopes = []
  io.tables = {
    customer_portal_accounts: [{ user_id: user, company_id: company, customer_id: customer, is_active: true, activated_at: timestamp }],
    customers: [{ id: customer, company_id: company, full_name: 'Anna Test', status: 'active', created_at: timestamp }],
    companies: [{ id: company, name: 'Testbolag', branding: {} }],
    customer_invoices: [{
      id: invoiceId, company_id: company, customer_id: customer, invoice_reference: 'synthetic-invoice-reference',
      invoice_number: 'TEST-1', status: 'paid', total_kwh: 120, amount_ex_vat: 800, vat_amount: 200,
      amount_inc_vat: 1000, currency: 'SEK', issued_at: timestamp, paid_at: timestamp,
      period_start: '2026-09-01', period_end: '2026-10-01', pdf_url: primaryUrl,
      pdf_path: `companies/${company}/invoices/primary.pdf`, created_at: timestamp,
    }],
    customer_invoice_lines: [{ id: uuid(7), company_id: company, invoice_id: invoiceId, line_type: 'consumption', description: 'Elförbrukning', quantity: 120, unit: 'kWh', unit_price: 1, amount_ex_vat: 800, vat_amount: 200, amount_inc_vat: 1000, sort_order: 1, created_at: timestamp }],
    customer_invoice_documents: [],
  }
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('actual invoice scalar reads retain history while exact copies retire', () => {
  it('keeps the ordinary published amount/status/lines control and current link', async () => {
    const data = await web()
    expect(data.invoice).toMatchObject({ status: 'paid', amount_inc_vat: 1000, pdf_url: primaryUrl })
    expect(data.lines).toMatchObject([{ description: 'Elförbrukning', quantity: 120 }])
    expect(await page()).toContain(primaryUrl)
  })

  it('masks retired primary URL/path while retaining the invoice and its lines without changing stored history', async () => {
    retire('customer_invoice_pdf_bytes', invoiceId)
    const stored = structuredClone(io.tables.customer_invoices[0])
    const data = await web()
    expect(data.invoice).toMatchObject({ status: 'paid', amount_inc_vat: 1000, total_kwh: 120, pdf_url: null, pdf_path: null })
    expect(data.lines).toMatchObject([{ description: 'Elförbrukning', amount_ex_vat: 800 }])
    expect(io.tables.customer_invoices[0]).toEqual(stored)
    const html = await page()
    expect(html).toContain('Elförbrukning')
    expect(html).toContain('Betald')
    expect(html).not.toContain(primaryUrl)
    expect(html).not.toContain(String(stored.pdf_path))
    expect(html).not.toContain('Öppna faktura-PDF')
    expect(html).not.toContain('blir tillgänglig inom kort')
  })

  it('masks a retired document independently and retains its historical scalar attributes', async () => {
    io.tables.customer_invoice_documents = [document()]
    retire('customer_invoice_document_pdf_bytes', documentId)
    const data = await web()
    expect(data.invoice).toMatchObject({ status: 'paid', amount_inc_vat: 1000, pdf_url: primaryUrl })
    expect(data.documents).toMatchObject([{ id: documentId, title: 'Historisk fakturakopia', source_system: 'synthetic-provider', public_url: null, file_path: null }])
    const html = await page()
    expect(html).toContain(primaryUrl)
    expect(html).not.toContain(retiredUrl)
  })

  it('preserves a separately permitted document copy even when it shares the retired primary target UUID', async () => {
    retire('customer_invoice_pdf_bytes', invoiceId)
    io.tables.customer_invoice_documents = [document(invoiceId, { public_url: alternateUrl })]
    const html = await page()
    expect(html).not.toContain(primaryUrl)
    expect(html).toContain(alternateUrl)
    expect(io.fileChecks).toEqual(expect.arrayContaining([
      { p_company_id: company, p_retention_class: 'customer_invoice_pdf_bytes', p_target_id: invoiceId },
      { p_company_id: company, p_retention_class: 'customer_invoice_document_pdf_bytes', p_target_id: invoiceId },
    ]))
  })

  it('prefers a permitted link over a newer pending path or retired document', async () => {
    io.tables.customer_invoices[0].pdf_url = null; io.tables.customer_invoices[0].pdf_path = null
    io.tables.customer_invoice_documents = [
      document(documentId, { created_at: '2026-10-03T00:00:00Z' }),
      document(uuid(8), { public_url: null, file_path: 'pending-document.pdf', created_at: '2026-10-02T00:00:00Z' }),
      document(uuid(9), { public_url: alternateUrl }),
    ]
    retire('customer_invoice_document_pdf_bytes', documentId)
    const html = await page()
    expect(html).toContain(alternateUrl)
    expect(html).not.toContain(retiredUrl)
    expect(html).not.toContain('href="pending-document.pdf"')
  })

  it('does not turn a successful negative predicate into a bytes or download claim when no file reference exists', async () => {
    io.tables.customer_invoices[0].pdf_url = null; io.tables.customer_invoices[0].pdf_path = null
    const html = await page()
    expect(html).not.toContain('Öppna faktura-PDF')
    expect(html).toContain('Ingen PDF-kopia kan visas här just nu')
    expect(html).not.toContain('Ingen PDF finns')
  })

  it.each(['web', 'API'])('keeps only explicitly owned children of the authorized invoice on %s', async channel => {
    io.tables.customer_invoices[0].pdf_url = null; io.tables.customer_invoices[0].pdf_path = null
    // The document FK permits a different/null company for this invoice.
    // The foreign line is an SDK-boundary control; the native composite FK
    // rejects it, so this fixture does not claim that such a line is installed.
    io.tables.customer_invoice_lines.push({
      ...io.tables.customer_invoice_lines[0], id: uuid(20), company_id: uuid(100), description: 'Foreign line',
    })
    io.tables.customer_invoice_documents = [
      document(documentId, { public_url: alternateUrl }),
      document(uuid(21), { company_id: uuid(100), title: 'Foreign document', public_url: 'https://files.example.test/foreign.pdf' }),
      document(uuid(22), { company_id: null, title: 'Unqualified document', public_url: 'https://files.example.test/unqualified.pdf' }),
      document(uuid(23), { invoice_id: uuid(101), title: 'Another invoice document', public_url: 'https://files.example.test/another-invoice.pdf' }),
    ]
    const stored = structuredClone(io.tables)
    if (channel === 'web') {
      const data = await web()
      expect(data.documents).toMatchObject([{ id: documentId, title: 'Historisk fakturakopia', public_url: alternateUrl }])
      expect(data.lines).toMatchObject([{ description: 'Elförbrukning' }])
      const html = await page()
      expect(html).toContain(alternateUrl)
      expect(html).not.toContain('Foreign line')
      expect(html).not.toContain('foreign.pdf')
      expect(html).not.toContain('unqualified.pdf')
      expect(html).not.toContain('another-invoice.pdf')
    } else {
      const response = await api()
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.data.lines).toMatchObject([{ description: 'Elförbrukning' }])
      expect(body.data.documents).toMatchObject([{ title: 'Historisk fakturakopia', secure_url: alternateUrl }])
    }
    expect(new Set(io.fileChecks
      .filter(check => check.p_retention_class === 'customer_invoice_document_pdf_bytes')
      .map(check => check.p_target_id))).toEqual(new Set([documentId]))
    expect(io.fileChecks.every(check => check.p_company_id === company)).toBe(true)
    expect(io.tables).toEqual(stored)
  })

  it.each(['web', 'API'])('does not let out-of-company children consume the owned invoice selection on %s', async channel => {
    const ownLine = io.tables.customer_invoice_lines[0]
    io.tables.customer_invoice_lines = [
      ...Array.from({ length: 500 }, (_, index) => ({
        ...ownLine, id: uuid(1000 + index), company_id: uuid(100), sort_order: 0, description: 'Foreign line',
      })), ownLine,
    ]
    io.tables.customer_invoice_documents = [
      ...Array.from({ length: 100 }, (_, index) => document(uuid(2000 + index), {
        company_id: uuid(100), created_at: '2026-10-02T00:00:00.000Z', title: 'Foreign document',
      })),
      document(uuid(3000), { company_id: null, created_at: '2026-10-02T00:00:00.000Z' }),
      document(documentId, { public_url: alternateUrl }),
    ]
    const data = channel === 'web' ? await web() : (await (await api()).json()).data
    expect(data.invoice).toMatchObject({ status: 'paid', amount_inc_vat: 1000 })
    expect(data.documents).toHaveLength(1)
    expect(data.documents[0]).toMatchObject({ title: 'Historisk fakturakopia' })
    expect(data.lines).toMatchObject([{ description: 'Elförbrukning', amount_ex_vat: 800 }])
    expect(io.fileChecks.filter(check => check.p_retention_class === 'customer_invoice_document_pdf_bytes'))
      .toEqual([{ p_company_id: company, p_retention_class: 'customer_invoice_document_pdf_bytes', p_target_id: documentId }])
  })

  it('does not claim PDF absence when only foreign or unqualified document references exist', async () => {
    io.tables.customer_invoices[0].pdf_url = null; io.tables.customer_invoices[0].pdf_path = null
    io.tables.customer_invoice_documents = [
      document(documentId, { company_id: null }),
      document(uuid(21), { company_id: uuid(100) }),
    ]
    const html = await page()
    expect(html).toContain('Ingen PDF-kopia kan visas här just nu')
    expect(html).not.toContain('Ingen PDF finns')
    expect(html).not.toContain('Öppna faktura-PDF')
    expect(html).not.toContain(retiredUrl)
    expect(io.fileChecks.filter(check => check.p_retention_class === 'customer_invoice_document_pdf_bytes')).toEqual([])
  })

  it.each(['customer_invoice_lines', 'customer_invoice_documents'])('keeps child read failures visible for %s', async resource => {
    const error = { code: '08006', message: 'Synthetic child read failure' }
    io.sourceErrors[resource] = error
    await expect(web()).rejects.toMatchObject(error)
    expect((await api()).status).toBe(500)
  })

  it.each([
    { code: '23514', message: 'another_check_violation' },
    { code: '08006', message: 'invoice_file_copy_retention_tombstoned' },
    { code: '42501', message: 'Synthetic copy access denied' },
    { code: '42P01', message: 'Synthetic missing retention dependency' },
  ])('propagates every non-exact retirement failure on web: %j', async error => {
    io.fileError = error
    await expect(web()).rejects.toMatchObject(error)
  })

  it('keeps the original exact-copy helper rejecting retired bytes outside the scalar adapter', async () => {
    retire('customer_invoice_pdf_bytes', invoiceId)
    await expect(requireInvoiceFileCopyAvailable({ companyId: company, retentionClass: 'customer_invoice_pdf_bytes', targetId: invoiceId }))
      .rejects.toMatchObject({ code: '23514', message: 'invoice_file_copy_retention_tombstoned' })
  })

  it('returns an ordinary API scalar DTO without PDF pointer or new wire fields', async () => {
    const response = await api()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Object.keys(body.data).sort()).toEqual(['documents', 'invoice', 'lines'])
    expect(body.data.invoice).toMatchObject({ status: 'paid', amount_inc_vat: 1000, total_kwh: 120 })
    expect(body.data.invoice).not.toHaveProperty('pdf_url')
    expect(body.data.invoice).not.toHaveProperty('pdf_path')
    expect(body.data.lines).toMatchObject([{ description: 'Elförbrukning', amount_ex_vat: 800 }])
  })

  it('keeps API invoice/lines/document scalars and masks only the retired document secure_url', async () => {
    io.tables.customer_invoice_documents = [document()]
    retire('customer_invoice_document_pdf_bytes', documentId)
    const response = await api()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.invoice).toMatchObject({ status: 'paid', amount_inc_vat: 1000 })
    expect(body.data.lines).toMatchObject([{ description: 'Elförbrukning' }])
    expect(body.data.documents).toMatchObject([{ title: 'Historisk fakturakopia', document_type: 'invoice_pdf', status: null, secure_url: null }])
    expect(JSON.stringify(body)).not.toContain(retiredUrl)
    expect(body.data.documents[0]).not.toHaveProperty('fileAvailability')
  })

  it('keeps an API permitted alternate URL while suppressing the separate retired copy', async () => {
    io.tables.customer_invoice_documents = [document(), document(uuid(8), { public_url: alternateUrl })]
    retire('customer_invoice_document_pdf_bytes', documentId)
    const response = await api()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.documents.map((row: Row) => row.secure_url)).toEqual([null, alternateUrl])
  })

  it.each([
    { code: '23514', message: 'another_check_violation' },
    { code: '08006', message: 'invoice_file_copy_retention_tombstoned' },
    { code: '42501', message: 'Synthetic copy access denied' },
    { code: '42P01', message: 'Synthetic missing retention dependency' },
  ])('retains API error status for non-exact copy failures: %j', async error => {
    io.tables.customer_invoice_documents = [document()]
    io.fileError = error
    const response = await api()
    expect(response.status).toBe(500)
    expect((await response.json()).data).toBeUndefined()
  })

  it.each(['draft', 'failed', 'foreign company', 'foreign customer'])('refuses unpublished or foreign parents before copy/child reads: %s', async mode => {
    if (mode === 'draft' || mode === 'failed') io.tables.customer_invoices[0].status = mode
    if (mode === 'foreign company') io.tables.customer_invoices[0].company_id = uuid(100)
    if (mode === 'foreign customer') io.tables.customer_invoices[0].customer_id = uuid(101)
    expect((await web()).invoice).toBeNull()
    expect((await api()).status).toBe(404)
    expect(io.fileChecks).toEqual([])
    expect(io.reads.some(read => ['customer_invoice_lines', 'customer_invoice_documents'].includes(read))).toBe(false)
  })

  it('preserves anonymous web redirect and API permission refusal before any invoice read', async () => {
    io.webSignedIn = false
    await expect(page()).rejects.toThrow('redirect:/login')
    io.apiAllowed = false
    expect((await api()).status).toBe(403)
    expect(io.requestedScopes).toEqual([['customer_invoices.read']])
    expect(io.reads).toEqual([])
    expect(io.fileChecks).toEqual([])
  })
})
