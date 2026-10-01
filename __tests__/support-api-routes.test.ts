import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { publicReference } from '@/lib/integrations/publicReferences'

const io = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn(), log: vi.fn(), upload: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc, storage: { from: () => ({ upload: io.upload }) } } }))
vi.mock('@/lib/customer-portal/externalApi', () => ({
  requireCustomerPortalApiContext: io.guard, logCustomerPortalSuccess: io.log,
  customerPortalJson: (value: unknown, init?: ResponseInit) => NextResponse.json(value, init),
  handleCustomerPortalRouteError: ({ error }: { error: { code?: string; status?: number } }) => NextResponse.json({ error: { code: error.code ?? 'unexpected_error' } }, { status: error.status ?? 500 }),
}))

const company = '10000000-0000-4000-8000-000000000001'
const customer = '20000000-0000-4000-8000-000000000001'
const subject = '30000000-0000-4000-8000-000000000001'
const client = '40000000-0000-4000-8000-000000000001'
const caseId = '50000000-0000-4000-8000-000000000001'
const messageId = '60000000-0000-4000-8000-000000000001'
const reference = publicReference('case', company, caseId)!
beforeEach(() => {
  io.guard.mockReset().mockResolvedValue({ ok: true, client: { id: client, company_id: company }, identity: { customer_id: customer, customer_portal_user_id: subject }, startedAt: 1 })
  io.rpc.mockReset()
  io.log.mockReset().mockResolvedValue(undefined)
  io.upload.mockReset().mockResolvedValue({ data: {}, error: null })
})

it('accepts actual multipart bytes into quarantine and exposes only the bounded public attachment projection', async () => {
  const route = await import('@/app/api/v1/customer/cases/[reference]/attachments/route')
  const attachmentId = '70000000-0000-4000-8000-000000000001'
  const stored = { companyId: company, customerId: customer, caseId, attachmentId,
    objectKey: `${company}/${customer}/${caseId}/${attachmentId}`, phase: 'stored', revision: 2, scanStatus: 'quarantined', replayed: false }
  io.rpc.mockResolvedValueOnce({ data: { ...stored, phase: 'reserved', revision: 1 }, error: null }).mockResolvedValueOnce({ data: stored, error: null })
  const form = new FormData()
  form.set('file', new File(['%PDF-1.7\nSynthetic file\n'], 'statement.pdf', { type: 'application/pdf' }))
  form.set('expected_revision', '1')
  const response = await route.POST(new NextRequest(`https://tenant.example.invalid/api/v1/customer/cases/${reference}/attachments`, {
    method: 'POST', headers: { 'Idempotency-Key': 'support-api-attachment' }, body: form,
  }), { params: Promise.resolve({ reference }) })
  expect(response.status).toBe(201)
  expect((await response.json()).data).toEqual({ attachment_reference: publicReference('case_attachment', company, attachmentId), revision: 2, scan_status: 'quarantined', replayed: false })
  expect(io.upload).toHaveBeenCalledOnce()
  expect(io.guard).toHaveBeenCalledWith(expect.any(NextRequest), ['customer_cases.write'])
  io.rpc.mockResolvedValue({ data: { items: [{ id: attachmentId, file_name: 'statement.pdf', media_type: 'application/pdf', byte_size: 25,
    scan_status: 'quarantined', visibility: 'customer', created_at: '2026-09-30T12:00:00.000001Z' }] }, error: null })
  const read = await route.GET(new NextRequest(`https://tenant.example.invalid/api/v1/customer/cases/${reference}/attachments`), { params: Promise.resolve({ reference }) })
  expect(read.status).toBe(200)
  const body = await read.json()
  expect(Object.keys(body.data[0]).sort()).toEqual(['attachment_reference','file_name','media_type','byte_size','scan_status','created_at'].sort())
  expect(JSON.stringify(body)).not.toMatch(/objectKey|storage_bucket|company_id|customer_id|visibility|https:\/\//)
})

it('rejects client scanner flags and duplicate multipart parts before storage, with safe storage failure details', async () => {
  const { POST } = await import('@/app/api/v1/customer/cases/[reference]/attachments/route')
  for (const extra of ['scan_status', 'object_key', 'duplicate']) {
    const form = new FormData()
    form.set('file', new File(['%PDF-1.7\nSynthetic file\n'], 'statement.pdf', { type: 'application/pdf' }))
    form.set('expected_revision', '1')
    if (extra === 'duplicate') form.append('expected_revision', '1')
    else form.set(extra, 'clean')
    const response = await POST(new NextRequest(`https://tenant.example.invalid/api/v1/customer/cases/${reference}/attachments`, { method: 'POST', headers: { 'Idempotency-Key': 'support-api-attachment' }, body: form }), { params: Promise.resolve({ reference }) })
    expect(response.status).toBe(422)
    expect((await response.json()).error.code).toBe('invalid_support_attachment')
  }
  expect(io.rpc).not.toHaveBeenCalled()
  expect(io.upload).not.toHaveBeenCalled()
})

it('GET own cases uses verified context and omits internal IDs from persisted projection', async () => {
  const { GET } = await import('@/app/api/v1/customer/cases/route')
  io.rpc.mockResolvedValue({ data: { items: [{ id: caseId, case_reference: reference, title: 'Customer title', status: 'open', revision: 1, created_at: '2026-09-30T12:00:00.000001Z', updated_at: '2026-09-30T12:00:00.000001Z' }] }, error: null })
  const response = await GET(new NextRequest('https://tenant.example.invalid/api/v1/customer/cases'))
  const body = await response.json()
  expect(response.status).toBe(200)
  expect(body.data[0]).not.toHaveProperty('id')
  expect(body.data[0]).not.toHaveProperty('company_id')
  expect(io.guard).toHaveBeenCalledWith(expect.any(NextRequest), ['customer_cases.read'])
  expect(io.rpc).toHaveBeenCalledWith('gridex_support_case_read_v1', { p_context: expect.objectContaining({ companyId: company, customerId: customer, clientId: client, subject }), p_query: { limit: 26 } })
})

it('POST case uses one current actor command and canonical public response', async () => {
  const { POST } = await import('@/app/api/v1/customer/cases/route')
  io.rpc.mockResolvedValue({ data: { companyId: company, customerId: customer, caseId, revision: 1, status: 'open', customerStatus: 'open', replayed: false }, error: null })
  const response = await POST(new NextRequest('https://tenant.example.invalid/api/v1/customer/cases', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'support-api-create' }, body: JSON.stringify({ title: 'Invoice question', body: 'Please explain.' }) }))
  expect(response.status).toBe(201)
  expect((await response.json()).data).toEqual({ case_reference: reference, revision: 1, status: 'open', replayed: false })
  expect(io.guard).toHaveBeenCalledWith(expect.any(NextRequest), ['customer_cases.write'])
  expect(io.rpc).toHaveBeenCalledTimes(1)
  expect(io.rpc.mock.calls[0][1].p_command).toMatchObject({ companyId: company, customerId: customer, clientId: client, subject, mode: 'api', channel: 'api', operation: 'create', expectedRevision: 0 })
})

it('unknown actor/tenant fields and missing key fail before any RPC', async () => {
  const { POST } = await import('@/app/api/v1/customer/cases/route')
  for (const payload of [{ title: 'Question', body: 'Help', verified: true }, { title: 'Question', body: 'Help', companyId: company }]) {
    const response = await POST(new NextRequest('https://tenant.example.invalid/api/v1/customer/cases', { method: 'POST', headers: { 'Idempotency-Key': 'support-api-create' }, body: JSON.stringify(payload) }))
    expect(response.status).toBe(422)
  }
  const noKey = await POST(new NextRequest('https://tenant.example.invalid/api/v1/customer/cases', { method: 'POST', body: JSON.stringify({ title: 'Question', body: 'Help' }) }))
  expect(noKey.status).toBe(400)
  expect(io.rpc).not.toHaveBeenCalled()
})

it('POST reply resolves the opaque reference in the same write command and protects revision', async () => {
  const { POST } = await import('@/app/api/v1/customer/cases/[reference]/messages/route')
  io.rpc.mockResolvedValue({ data: { companyId: company, customerId: customer, caseId, messageId, revision: 3, status: 'open', customerStatus: 'open', replayed: true }, error: null })
  const response = await POST(new NextRequest(`https://tenant.example.invalid/api/v1/customer/cases/${reference}/messages`, { method: 'POST', headers: { 'Idempotency-Key': 'support-api-reply' }, body: JSON.stringify({ body: 'Another question', expected_revision: 2 }) }), { params: Promise.resolve({ reference }) })
  expect(response.status).toBe(201)
  expect((await response.json()).data).toEqual({ case_reference: reference, message_reference: publicReference('case_message', company, messageId), revision: 3, status: 'open', replayed: true })
  expect(io.rpc).toHaveBeenCalledTimes(1)
  expect(io.rpc.mock.calls[0][1].p_command).toMatchObject({ caseReference: reference, expectedRevision: 2, operation: 'customer_message', mode: 'api' })
})

it('returns the explicit customer status instead of leaking the internal workflow status in a reply', async () => {
  const { POST } = await import('@/app/api/v1/customer/cases/[reference]/messages/route')
  io.rpc.mockResolvedValue({ data: { companyId: company, customerId: customer, caseId, messageId,
    revision: 3, status: 'manual_follow_up', customerStatus: 'waiting_for_customer', replayed: false }, error: null })
  const response = await POST(new NextRequest(`https://tenant.example.invalid/api/v1/customer/cases/${reference}/messages`, {
    method: 'POST', headers: { 'Idempotency-Key': 'support-public-status' },
    body: JSON.stringify({ body: 'Customer continuation', expected_revision: 2 }),
  }), { params: Promise.resolve({ reference }) })
  expect(response.status).toBe(201)
  const body = await response.json()
  expect(body.data.status).toBe('waiting_for_customer')
  expect(JSON.stringify(body)).not.toContain('manual_follow_up')
})

it('denied auth never reaches the database and missing schema gives safe 503', async () => {
  const { GET } = await import('@/app/api/v1/customer/cases/route')
  io.guard.mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: { code: 'customer_delegation_required' } }, { status: 403 }) })
  expect((await GET(new NextRequest('https://tenant.example.invalid/api/v1/customer/cases'))).status).toBe(403)
  expect(io.rpc).not.toHaveBeenCalled()
  io.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'private missing function details' } })
  const response = await GET(new NextRequest('https://tenant.example.invalid/api/v1/customer/cases'))
  expect(response.status).toBe(503)
  const body = await response.json()
  expect(body.error.code).toBe('support_unavailable')
  expect(JSON.stringify(body)).not.toContain('private missing')
})
