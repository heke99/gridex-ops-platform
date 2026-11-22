import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/v1/customer/support/cases/[reference]/attachments/route'
import { addSupportAttachment } from '@/lib/customer-service/supportAttachments'

type Row = Record<string, unknown>

const io = vi.hoisted(() => ({
  origin: 'https://fixture.invalid',
  quotaRows: [] as Row[],
  quotaReads: [] as URL[],
  uploads: [] as string[],
  insertedAttachment: null as Row | null,
}))

const origin = io.origin
const companyId = '00000000-0000-4000-8000-000000000001'
const customerId = '00000000-0000-4000-8000-000000000002'
const caseId = '00000000-0000-4000-8000-000000000003'
const attachmentId = '00000000-0000-4000-8000-000000000004'
const ledgerId = '00000000-0000-4000-8000-000000000005'
const caseReference = 'support_case_synthetic_fixture'
const cutoff = '2026-11-18T12:00:00.000Z'
const bytes = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n', 'latin1')

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: createClient(io.origin, 'synthetic-client-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fixtureFetch },
  }),
}))
vi.mock('@/lib/customer-portal/externalApi', async original => ({
  ...await original<typeof import('@/lib/customer-portal/externalApi')>(),
  requireCustomerPortalApiContext: async (_request: NextRequest, scopes: string[], options: unknown) => {
    expect(scopes).toEqual(['customer_support.write'])
    expect(options).toEqual({ enforceBinding: true })
    return { ok: true, client: { id: 'fixture-client', company_id: companyId }, identity: { customer_id: customerId }, startedAt: Date.now() }
  },
}))
vi.mock('@/lib/integrations/apiAuth', async original => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(),
  logIntegrationApiRequest: vi.fn(),
}))

async function fixtureFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input))
  expect(url.origin).toBe(origin)
  const method = init?.method ?? 'GET'
  const search = url.searchParams

  if (url.pathname.startsWith('/storage/v1/object/') && method === 'POST') {
    const key = url.pathname.slice('/storage/v1/object/'.length)
    io.uploads.push(key)
    return Response.json({ Key: key, Id: attachmentId })
  }

  const table = url.pathname.split('/').at(-1)
  if (table === 'customer_cases' && method === 'GET') {
    expect(search.get('company_id')).toBe(`eq.${companyId}`)
    expect(search.get('customer_id')).toBe(`eq.${customerId}`)
    expect(search.get('metadata->>support_case')).toBe('eq.true')
    expect(search.get('metadata->>support_public_reference')).toBe(`eq.${caseReference}`)
    return Response.json([{ id: caseId, company_id: companyId, customer_id: customerId, status: 'open' }])
  }
  if (table === 'customer_portal_write_idempotency' && method === 'POST') {
    return Response.json([{ id: ledgerId, status: 'processing' }])
  }
  if (table === 'customer_portal_write_idempotency' && method === 'PATCH') {
    if (search.has('select')) return Response.json([{ id: ledgerId }])
    return new Response(null, { status: 204 })
  }
  if (table === 'customer_case_attachments' && method === 'HEAD') {
    io.quotaReads.push(url)
    expect(new Headers(init?.headers).get('Prefer')).toContain('count=exact')
    const predicates = [...search].filter(([field]) => field !== 'select')
    const count = io.quotaRows.filter(row => predicates.every(([field, filter]) => {
      if (filter.startsWith('eq.')) return row[field] === filter.slice(3)
      if (filter.startsWith('gte.')) return String(row[field]) >= filter.slice(4)
      throw new Error('Unexpected synthetic quota predicate')
    })).length
    return new Response(null, { headers: { 'Content-Range': `*/${count}` } })
  }
  if (table === 'customer_case_attachments' && method === 'POST' && typeof init?.body === 'string') {
    io.insertedAttachment = { ...JSON.parse(init.body), id: attachmentId }
    return Response.json(io.insertedAttachment)
  }
  if (table === 'customer_case_attachments' && method === 'PATCH' && typeof init?.body === 'string') {
    expect(search.get('company_id')).toBe(`eq.${companyId}`)
    expect(search.get('id')).toBe(`eq.${attachmentId}`)
    expect(search.get('customer_case_id')).toBe(`eq.${caseId}`)
    return Response.json({ ...io.insertedAttachment, ...JSON.parse(init.body) })
  }
  throw new Error(`Unexpected synthetic operation ${method} ${table}`)
}

function seed(count: number, overrides: Row = {}) {
  io.quotaRows.push(...Array.from({ length: count }, () => ({
    company_id: companyId,
    customer_id: customerId,
    customer_case_id: caseId,
    uploaded_by_kind: 'customer',
    visibility: 'customer',
    scan_status: 'released',
    created_at: cutoff,
    ...overrides,
  })))
}

function customerUpload() {
  const request = new NextRequest(`${origin}/api/v1/customer/support/cases/${caseReference}/attachments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf', 'Idempotency-Key': 'synthetic-attachment-attempt' },
    body: new Uint8Array(bytes),
  })
  return POST(request, { params: Promise.resolve({ reference: caseReference }) })
}

function staffUpload() {
  return addSupportAttachment({
    companyId, customerId, caseId, bytes, fileName: 'fixture.pdf', declaredMime: 'application/pdf', visibility: 'internal',
    uploadedBy: { kind: 'staff', userId: 'fixture-staff' },
  })
}

function expectQuotaQuery(actor: 'customer' | null) {
  expect(io.quotaReads).toHaveLength(1)
  const query = io.quotaReads[0].searchParams
  expect(query.get('company_id')).toBe(`eq.${companyId}`)
  expect(query.get('customer_id')).toBe(`eq.${customerId}`)
  expect(query.get('created_at')).toBe(`gte.${cutoff}`)
  expect(query.get('uploaded_by_kind')).toBe(actor ? `eq.${actor}` : null)
  for (const field of ['customer_case_id', 'visibility', 'scan_status']) expect(query.has(field)).toBe(false)
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-19T12:00:00.000Z'))
  Object.assign(io, { quotaRows: [], quotaReads: [], uploads: [], insertedAttachment: null })
})
afterEach(() => vi.restoreAllMocks())

describe('support attachment quota ownership', () => {
  it('lets a customer upload their first attachment after 20 internal staff uploads', async () => {
    seed(20, { uploaded_by_kind: 'staff', visibility: 'internal' })

    const response = await customerUpload()
    expect(response.status).toBe(201)
    expect((await response.json()).data).toMatchObject({ uploaded_by: 'customer', mime_type: 'application/pdf' })
    expectQuotaQuery('customer')
    expect(io.uploads).toHaveLength(1)
    expect(io.insertedAttachment).toMatchObject({ company_id: companyId, customer_id: customerId, uploaded_by_kind: 'customer' })
  })

  it('counts by uploader, within the original company, customer and rolling day', async () => {
    seed(19)
    seed(1, { uploaded_by_kind: 'staff' })
    seed(20, { company_id: 'other-company' })
    seed(20, { customer_id: 'other-customer' })
    seed(20, { created_at: '2026-11-18T11:59:59.999Z' })

    expect((await customerUpload()).status).toBe(201)
    expectQuotaQuery('customer')
    expect(io.uploads).toHaveLength(1)
  })

  it('keeps the customer limit across cases and all scan states', async () => {
    seed(18)
    seed(1, { scan_status: 'quarantined' })
    seed(1, { customer_case_id: 'other-case', scan_status: 'rejected' })

    const response = await customerUpload()
    expect(response.status).toBe(429)
    expect((await response.json()).error.code).toBe('attachment_quota_exceeded')
    expectQuotaQuery('customer')
    expect(io.uploads).toEqual([])
  })

  it('retains the previous staff limit over current attachments of both uploader kinds', async () => {
    seed(19)
    seed(1, { uploaded_by_kind: 'staff', visibility: 'internal' })

    await expect(staffUpload()).rejects.toMatchObject({ status: 429, code: 'attachment_quota_exceeded' })
    expectQuotaQuery(null)
    expect(io.uploads).toEqual([])
  })

  it('still accepts a staff attachment below the existing limit', async () => {
    seed(19)

    await expect(staffUpload()).resolves.toMatchObject({ uploaded_by_kind: 'staff', scan_status: 'released' })
    expectQuotaQuery(null)
    expect(io.uploads).toHaveLength(1)
  })
})
