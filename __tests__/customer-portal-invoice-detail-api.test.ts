import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/v1/customer/invoices/[id]/route'
import type { LinkedPortalIdentity } from '@/lib/customer-portal/externalApi'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'

type Row = Record<string, unknown>

const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  requestLog: [] as Row[],
  retentionChecks: [] as Row[],
  unavailableCopies: new Set<string>(),
  retiredCopies: new Set<string>(),
  readFailure: null as { table: string; offset: number; code: string } | null,
  rowLimit: 1000,
  contentRangeOverride: undefined as string | null | undefined,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/customer-portal/externalApi', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/customer-portal/externalApi')>(),
  requireCustomerPortalApiContext: async () => ({
    ok: true, client, identity, startedAt: Date.now(),
  }),
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.test', 'synthetic-unit-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: invoiceTestTransport },
    }),
  }
})

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = uuid(1), customer = uuid(2), invoiceId = uuid(3)
const invoiceReference = 'invoice-test-reference'
const timestamp = '2026-11-01T12:00:00.000Z'
const client: IntegrationApiClient = {
  id: uuid(4), company_id: company, name: 'Synthetic client', status: 'active',
  key_prefix: 'synthetic', secret_hash: 'synthetic-not-a-secret', scopes: ['customer_invoices.read'],
  allowed_ips: [], rate_limit_per_minute: 30, expires_at: null,
}
const identity: LinkedPortalIdentity = {
  id: null, company_id: company, customer_id: customer, external_customer_id: null,
  email: 'synthetic@example.test', customer_number: 'TEST-1', auth_user_id: null,
  customer_portal_user_id: null, match_strength: 'exact', match_method: 'resolved-account', provider: null,
  customer: { id: customer, company_id: company, status: 'active' },
}

function response(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } })
}

async function invoiceTestTransport(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const resource = url.pathname.split('/').at(-1)!
  if (resource === 'ediel_require_portal_retention_access_v1') return response(null)
  if (resource === 'ediel_require_invoice_file_copy_available_v1') {
    const args = JSON.parse(String(init?.body)) as Row
    io.retentionChecks.push(args)
    if (io.unavailableCopies.has(String(args.p_target_id))) {
      return response({ code: '08006', message: 'Synthetic retention read unavailable' }, 500)
    }
    if (io.retiredCopies.has(String(args.p_target_id))) {
      return response({ code: '23514', message: 'invoice_file_copy_retention_tombstoned' }, 400)
    }
    return response(null)
  }
  if (init?.method === 'POST') {
    if (resource === 'integration_api_requests') io.requestLog.push(JSON.parse(String(init.body)) as Row)
    else if (resource !== 'customer_portal_api_access_logs') throw new Error(`Unexpected write: ${resource}`)
    return response([], 201)
  }
  if (init?.method !== 'GET' || !Object.hasOwn(io.tables, resource)) throw new Error(`Unexpected read: ${resource}`)

  const offset = Number(url.searchParams.get('offset') ?? 0)
  if (io.readFailure?.table === resource && io.readFailure.offset === offset) {
    return response({ code: io.readFailure.code, message: 'Synthetic child read failure' }, 500)
  }
  const rows = io.tables[resource].filter(row => {
    for (const [column, expression] of url.searchParams) {
      if (['select', 'order', 'offset', 'limit'].includes(column)) continue
      if (expression.startsWith('eq.') && String(row[column]) === expression.slice(3)) continue
      if (expression.startsWith('in.(') && expression.slice(4, -1).split(',').includes(String(row[column]))) continue
      return false
    }
    return true
  })
  const order = url.searchParams.get('order')?.split(',') ?? []
  rows.sort((a, b) => {
    for (const term of order) {
      const [key, dir] = term.split('.')
      const left = a[key], right = b[key]
      const result = typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right))
      if (result) return dir === 'desc' ? -result : result
    }
    return 0
  })
  const limit = Math.min(io.rowLimit, Number(url.searchParams.get('limit') ?? io.rowLimit))
  const fields = url.searchParams.get('select')?.split(',')
  const page = rows.slice(offset, offset + limit).map(row =>
    fields && !fields.includes('*')
      ? Object.fromEntries(fields.map(field => [field, row[field] ?? null]))
      : row,
  )
  const countRequested = new Headers(init?.headers).get('prefer')?.includes('count=exact')
  const contentRange = io.contentRangeOverride === undefined || resource !== 'customer_invoice_lines'
    ? `${page.length ? `${offset}-${offset + page.length - 1}` : '*'}/${rows.length}`
    : io.contentRangeOverride
  return response(page, 200, countRequested && contentRange ? { 'content-range': contentRange } : {})
}

function invoiceLine(id: string, options: Row = {}): Row {
  return {
    id, company_id: company, invoice_id: invoiceId, description: `Line ${id.slice(-4)}`,
    sort_order: 0, created_at: timestamp, ...options,
  }
}

function invoiceDocument(id: string, options: Row = {}): Row {
  return {
    id, company_id: company, invoice_id: invoiceId, title: `Document ${id.slice(-4)}`, document_type: 'invoice_pdf',
    public_url: null, created_at: timestamp, ...options,
  }
}

async function readInvoice(reference = invoiceReference) {
  return GET(new NextRequest(`https://synthetic.example.test/api/v1/customer/invoices/${reference}`), {
    params: Promise.resolve({ id: reference }),
  })
}

beforeEach(() => {
  io.tables = {
    customer_invoices: [{
      id: invoiceId, company_id: company, customer_id: customer, invoice_reference: invoiceReference,
      status: 'paid', amount_inc_vat: 950, currency: 'SEK', created_at: timestamp,
    }],
    customer_invoice_lines: [],
    customer_invoice_documents: [],
  }
  io.requestLog = []
  io.retentionChecks = []
  io.unavailableCopies.clear()
  io.retiredCopies.clear()
  io.readFailure = null
  io.rowLimit = 1000
  io.contentRangeOverride = undefined
})

describe('customer portal invoice detail API', () => {
  it('audits the same 404 and error code that the route returns', async () => {
    const result = await readInvoice('missing-invoice')

    expect(result.status).toBe(404)
    expect(io.requestLog).toMatchObject([{ status_code: 404, error_code: 'invoice_not_found' }])
  })

  it.each(['customer_invoice_lines', 'customer_invoice_documents'])('reports an unavailable read model for %s', async table => {
    io.readFailure = { table, offset: 0, code: '42P01' }

    const result = await readInvoice()

    expect(result.status).toBe(503)
    expect(await result.json()).toMatchObject({ error: expect.objectContaining({ code: 'invoice_read_model_unavailable' }) })
  })

  it('returns empty arrays after both successful empty reads', async () => {
    const result = await readInvoice()

    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({
      data: { invoice: { amount_inc_vat: 950 }, lines: [], documents: [] },
    })
  })

  it('returns all owned rows across the deployment cap in deterministic order', async () => {
    io.rowLimit = 300
    io.tables.customer_invoice_lines = Array.from({ length: 1001 }, (_, i) => invoiceLine(uuid(2000 - i), { sort_order: 10 }))
    io.tables.customer_invoice_lines.push(invoiceLine(uuid(6000), { description: 'First line', sort_order: 1, created_at: '2026-11-02T00:00:00.000Z' }))
    io.tables.customer_invoice_documents = Array.from({ length: 1001 }, (_, i) => invoiceDocument(uuid(4000 - i)))

    const result = await readInvoice()
    const { data } = await result.json()

    expect(result.status).toBe(200)
    expect(data.lines).toHaveLength(1002)
    expect(data.lines.slice(0, 2).map((line: { description: string }) => line.description)).toEqual(['First line', 'Line 1000'])
    expect(data.documents).toHaveLength(1001)
    expect(data.documents.map((document: { title: string }) => document.title)).toEqual(
      Array.from({ length: 1001 }, (_, index) => `Document ${3000 + index}`),
    )
  })

  it('reports a later page read failure without returning partial invoice data', async () => {
    io.rowLimit = 300
    io.tables.customer_invoice_lines = Array.from({ length: 301 }, (_, i) => invoiceLine(uuid(9000 + i)))
    io.readFailure = { table: 'customer_invoice_lines', offset: 300, code: '08006' }

    const result = await readInvoice()

    expect(result.status).toBe(500)
    expect(await result.json()).not.toHaveProperty('data')
  })

  it.each([null, '0-0/*', '0-0/-1', '0-0/2'])('rejects an incomplete or unverified exact count of %s', async contentRange => {
    io.contentRangeOverride = contentRange
    io.tables.customer_invoice_lines = [invoiceLine(uuid(20))]

    const result = await readInvoice()

    expect(result.status).toBe(503)
    expect(await result.json()).toMatchObject({ error: expect.objectContaining({ code: 'invoice_read_incomplete' }) })
  })

  it('includes stored metadata and checks retention only for URLs the API can return', async () => {
    const noLink = uuid(10), visible = uuid(11), retired = uuid(12)
    io.unavailableCopies.add(noLink)
    io.retiredCopies.add(retired)
    const publicUrl = 'https://files.example.test/synthetic.pdf'
    io.tables.customer_invoice_documents = [
      invoiceDocument(retired, { public_url: publicUrl, title: 'Retired' }),
      invoiceDocument(visible, { public_url: publicUrl, title: 'Visible', file_name: 'synthetic.pdf', mime_type: 'application/pdf' }),
      invoiceDocument(noLink, { title: 'Linkless' }),
    ]

    const result = await readInvoice()
    const { data } = await result.json()

    expect(result.status).toBe(200)
    expect(data.documents).toEqual([
      expect.objectContaining({ title: 'Linkless', secure_url: null }),
      expect.objectContaining({ title: 'Visible', secure_url: publicUrl, file_name: 'synthetic.pdf', mime_type: 'application/pdf' }),
      expect.objectContaining({ title: 'Retired', secure_url: null }),
    ])
    expect(io.retentionChecks.map(check => check.p_target_id)).toEqual([visible, retired])
    expect(io.retentionChecks.every(check => check.p_company_id === company)).toBe(true)
  })
})
