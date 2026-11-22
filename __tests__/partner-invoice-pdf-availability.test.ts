import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/partner/v1/[[...path]]/route'
import { minimalPdf } from './helpers/minimalPdf'

type Row = Record<string, unknown>
type StorageReply = 'timeout' | 'pdf' | 'oversized' | { status: number; code: string }
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  storage: {} as Record<string, StorageReply>,
  reads: [] as URL[],
  retention: [] as Row[],
  access: vi.fn(),
  requestLog: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/integrations/apiAuth', async original => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(),
  requireIntegrationApiAccess: io.access,
  logIntegrationApiRequest: io.requestLog,
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.test', 'synthetic-unit-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: invoiceTransport },
    }),
  }
})

const companyId = '10000000-0000-4000-8000-000000000001'
const invoiceId = '10000000-0000-4000-8000-000000000002'
const documentId = '10000000-0000-4000-8000-000000000003'
const invoiceReference = 'inv_synthetic'
const pdfBytes = Uint8Array.from(minimalPdf('Synthetic invoice'))
const buckets = ['customer-documents', 'customer-contract-documents', 'contract-pdfs', 'billing-exports']

async function invoiceTransport(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const method = init?.method ?? 'GET'
  if (url.pathname.startsWith('/storage/v1/object/') && method === 'GET') {
    io.reads.push(url)
    const bucket = url.pathname.split('/')[4]
    const reply = io.storage[bucket] ?? { status: 404, code: '404' }
    if (reply === 'timeout') throw new TypeError('Synthetic Storage transport timeout')
    if (reply === 'pdf') return new Response(pdfBytes, { headers: { 'content-type': 'application/pdf' } })
    if (reply === 'oversized') return new Response(new Uint8Array(15 * 1024 * 1024 + 1))
    return Response.json({ statusCode: reply.code, message: 'Synthetic private Storage diagnostic' }, { status: reply.status })
  }
  if (url.pathname === '/rest/v1/rpc/ediel_require_invoice_file_copy_available_v1' && method === 'POST') {
    io.retention.push(JSON.parse(String(init?.body)))
    return Response.json(null)
  }

  const table = url.pathname.split('/').at(-1)!
  if (method !== 'GET' || !Object.hasOwn(io.tables, table)) throw new Error(`Unexpected synthetic request: ${url.pathname}`)
  const rows = io.tables[table].filter(row => {
    for (const [column, expression] of url.searchParams) {
      if (['select', 'order', 'limit'].includes(column)) continue
      if (expression.startsWith('eq.') && String(row[column]) === expression.slice(3)) continue
      if (expression.startsWith('in.(') && expression.slice(4, -1).split(',').includes(String(row[column]))) continue
      return false
    }
    return true
  })
  return Response.json(rows.slice(0, Number(url.searchParams.get('limit') ?? rows.length)))
}

function get(path = ['invoice', invoiceReference, 'pdf']) {
  return GET(new NextRequest(`https://synthetic.example.test/api/partner/v1/${path.join('/')}`), { params: Promise.resolve({ path }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  io.access.mockResolvedValue({ ok: true, client: { id: 'synthetic-client', company_id: companyId } })
  io.requestLog.mockResolvedValue(undefined)
  io.tables = {
    customer_invoices: [{ id: invoiceId, company_id: companyId, invoice_reference: invoiceReference, status: 'issued' }],
    customer_invoice_documents: [{ id: documentId, company_id: companyId, invoice_id: invoiceId,
      document_type: 'invoice_pdf', file_path: 'invoice-fixture.pdf', metadata: {}, created_at: '2026-11-05T12:00:00.000Z' }],
  }
  io.storage = {}
  io.reads = []
  io.retention = []
})
afterEach(() => vi.restoreAllMocks())

describe('Partner invoice PDF availability', () => {
  it.each([
    ['transport timeout', 'timeout'],
    ['upstream 500', { status: 500, code: '500' }],
    ['gateway failure with a misleading body code', { status: 503, code: '404' }],
  ] as const)('keeps %s visible after subsequent definite misses', async (_label, failure) => {
    io.storage['customer-documents'] = failure

    const response = await get()

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body).toMatchObject({ error: { code: 'invoice_pdf_storage_unavailable' } })
    expect(JSON.stringify(body)).not.toMatch(/Synthetic private|transport timeout|invoice-fixture\.pdf/)
    expect(io.access).toHaveBeenCalledExactlyOnceWith(expect.any(NextRequest), ['customer_invoices.read'])
    expect(io.retention).toEqual([{ p_company_id: companyId, p_retention_class: 'customer_invoice_document_pdf_bytes', p_target_id: documentId }])
    expect(io.reads).toHaveLength(4)
    expect(io.requestLog).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 503, errorCode: 'invoice_pdf_storage_unavailable' }))
  })

  it('keeps 404 for definite misses, including the legacy HTTP 400 with Storage code 404', async () => {
    io.storage['customer-documents'] = { status: 400, code: '404' }

    const response = await get()

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'invoice_pdf_not_available' } })
    expect(io.reads).toHaveLength(buckets.length)
  })

  it('returns valid bytes from a later recognized location after an earlier outage', async () => {
    io.storage['customer-documents'] = 'timeout'
    io.storage['customer-contract-documents'] = 'pdf'

    const response = await get()

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ entity_id: invoiceReference, file_base64: Buffer.from(pdfBytes).toString('base64'), file_extension: 'pdf' })
    expect(io.reads).toHaveLength(2)
  })

  it('retains the document size outcome when later locations are missing', async () => {
    io.storage['customer-documents'] = 'oversized'

    const response = await get()

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ error: { code: 'document_too_large' } })
  })

  it('does not resolve retention or Storage for another tenant’s invoice', async () => {
    io.tables.customer_invoices[0].company_id = '10000000-0000-4000-8000-000000000004'

    expect((await get()).status).toBe(404)
    expect(io.retention).toEqual([])
    expect(io.reads).toEqual([])
  })

  it('declares the temporary storage failure in the served Partner OpenAPI', async () => {
    const response = await get(['openapi.json'])
    const spec = await response.json()
    expect(spec.paths['/invoice/{invoice_id}/pdf'].get.responses['503']).toEqual(expect.objectContaining({
      description: expect.stringContaining('invoice_pdf_storage_unavailable'),
    }))
  })
})
