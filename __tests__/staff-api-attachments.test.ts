import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { deflateSync } from 'node:zlib'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import document from '@/docs/openapi/staff-support-v1.json'

const { validateResponse } = createRequire(import.meta.url)('../scripts/lib/openapi-schema-validator.cjs') as { validateResponse(document: unknown, path: string, value: unknown, method?: string, status?: string): string[] }
const attachmentPath = '/api/v1/staff/support/cases/{caseReference}/attachments'

type Row = Record<string, unknown>
type Receipt = { hash: string; row: Row; lease: string; complete: boolean; busy: boolean }
const state = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: Row }>, objects: new Map<string, Buffer>(),
  receipts: new Map<string, Receipt>(), rows: [] as Row[], auth: true,
  commandDenied: false, closed: false, failUpload: false, loseUploadResponse: false,
  failFinalize: false, corruptReadback: false, uploads: 0, count: 0,
  nativeQuotaError: false,
  rateLimited: false,
  missOneDownload: false, duplicateStatus: '409',
}))
const context = {
  companyId: '00000001-0000-4000-8000-000000000001', userId: '00000001-0000-4000-8000-000000000002',
  client: { id: '00000001-0000-4000-8000-000000000003' }, sessionId: '00000001-0000-4000-8000-000000000004',
  nativeSessionId: '00000001-0000-4000-8000-000000000005', sessionRevision: 7,
  requestId: 'request-test', correlationId: 'correlation-test',
}
const caseId = '00000001-0000-4000-8000-000000000006'
const customerId = '00000001-0000-4000-8000-000000000007'
const caseReference = 'support_case_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const pdf = (body = '1 0 obj << /Type /Catalog >> endobj') => Buffer.from(`%PDF-1.7\n${body}\n%%EOF\n`, 'latin1')
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
function encodedPdf() {
  const compressed = deflateSync(Buffer.from('1 0 << /S /JavaScript /JS (app.alert(1)) >>', 'latin1'))
  return Buffer.concat([Buffer.from(`%PDF-1.7\n1 0 obj << /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`, 'latin1'), compressed, Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1')])
}

async function rpc(name: string, args: Row) {
  state.calls.push({ name, args })
  if (name === 'staff_api_read_resources') return { data: { rows: args.p_operation === 'case' ? [{ id: caseId, customer_id: customerId }] : state.rows }, error: null }
  if (state.commandDenied) return { data: null, error: { code: '42501', message: 'staff_api_command_actor_denied' } }
  if (state.rateLimited && name === 'staff_api_attachment_reserve') return { data: null, error: { code: 'P0001', message: 'staff_rate_limited' } }
  if (state.nativeQuotaError && name === 'staff_api_attachment_reserve') return { data: null, error: { code: 'P0001', message: 'attachment_quota_exceeded' } }
  const key = [args.p_company_id, args.p_client_id, args.p_user_id, args.p_case_reference, args.p_idempotency_key].join(':')
  if (name === 'staff_api_attachment_reserve') {
    const existing = state.receipts.get(key)
    if (existing) {
      if (existing.hash !== args.p_request_hash) return { data: null, error: { code: '23505', message: 'idempotency_conflict' } }
      if (existing.complete) return { data: { state: 'replay', row: existing.row }, error: null }
      if (existing.busy) return { data: null, error: { code: '55000', message: 'idempotency_in_progress' } }
      if (state.closed) return { data: null, error: { code: '23514', message: 'support_case_closed' } }
      existing.busy = true
      existing.lease = `lease-${++state.count}`
      return { data: { state: 'acquired', lease_id: existing.lease, row: existing.row }, error: null }
    }
    if (state.closed) return { data: null, error: { code: '23514', message: 'support_case_closed' } }
    const reference = `support_attachment_${String(++state.count).padStart(32, 'a')}`
    const row: Row = { id: `00000001-0000-4000-8000-${String(state.count).padStart(12, '0')}`, company_id: context.companyId, customer_id: customerId, customer_case_id: caseId, public_reference: reference, storage_path: `${context.companyId}/${caseId}/${reference}`, file_name: args.p_file_name, declared_mime_type: args.p_declared_mime, byte_size: args.p_byte_size, sha256: args.p_sha256, visibility: args.p_visibility, uploaded_by_kind: 'staff', uploaded_by_user_id: args.p_user_id, scan_status: 'quarantined', scan_reason: null, detected_mime_type: null, created_at: '2026-10-03T12:00:00Z' }
    const receipt = { hash: String(args.p_request_hash), row, lease: `lease-${state.count}`, complete: false, busy: true }
    state.receipts.set(key, receipt); state.rows.push(row)
    return { data: { state: 'acquired', lease_id: receipt.lease, row }, error: null }
  }
  const receipt = [...state.receipts.values()].find(value => value.row.public_reference === args.p_attachment_reference)
  if (!receipt) return { data: null, error: { code: 'P0002', message: 'attachment_not_found' } }
  if (name === 'staff_api_attachment_release') { receipt.busy = false; return { data: null, error: null } }
  if (state.failFinalize) return { data: null, error: { code: 'XX000', message: 'audit unavailable' } }
  if (state.closed) return { data: null, error: { code: '23514', message: 'support_case_closed' } }
  Object.assign(receipt.row, { scan_status: args.p_scan_status, scan_reason: args.p_scan_reason, detected_mime_type: args.p_detected_mime, file_name: args.p_file_name })
  receipt.complete = true; receipt.busy = false
  return { data: { row: receipt.row, replayed: false }, error: null }
}

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { rpc, storage: { from: () => ({
    upload: async (path: string, bytes: Buffer, options: { contentType: string; upsert: boolean }) => {
      state.calls.push({ name: 'storage.upload', args: { path, ...options } })
      if (state.failUpload) return { data: null, error: { statusCode: '503' } }
      if (state.objects.has(path)) return { data: null, error: { statusCode: state.duplicateStatus, code: 'ResourceAlreadyExists' } }
      state.objects.set(path, Buffer.from(bytes)); state.uploads += 1
      if (state.loseUploadResponse) return { data: null, error: { statusCode: '503' } }
      return { data: { path }, error: null }
    },
    download: async (path: string) => {
      if (state.missOneDownload) { state.missOneDownload = false; return { data: null, error: { statusCode: '404' } } }
      const bytes = state.objects.get(path)
      return bytes ? { data: new Blob([new Uint8Array(state.corruptReadback ? Buffer.from('tampered') : bytes)]), error: null } : { data: null, error: { statusCode: '404' } }
    },
    remove: async (paths: string[]) => { paths.forEach(path => state.objects.delete(path)); return { error: null } },
  }) } },
  createSupabaseServiceRequestClient: () => ({ rpc }),
}))
vi.mock('@/lib/supabase/tenantQuery', () => ({
  tenantSelect: (companyId: string) => {
    const filters: Array<(row: Row) => boolean> = [row => row.company_id === companyId]
    const query = { eq: (field: string, value: unknown) => { filters.push(row => row[field] === value); return query }, gte: () => query, maybeSingle: async () => ({ data: state.rows.find(row => filters.every(filter => filter(row))) ?? null, error: null }), then: (resolve: (value: unknown) => unknown) => resolve({ count: 0, error: null }) }
    return query
  },
  tenantInsert: () => ({ select: () => ({ single: async () => ({ data: null, error: state.nativeQuotaError ? { code: 'P0001', message: 'attachment_quota_exceeded' } : { code: 'XX000', message: 'insert unavailable' } }) }) }),
}))
vi.mock('@/lib/staff-api/auth', () => ({ requireStaffApi: async (_request: NextRequest, input: Row) => {
  state.calls.push({ name: 'auth', args: input })
  return state.auth ? { ok: true, context } : { ok: false, response: new Response('denied', { status: 403 }) }
} }))

function upload(bytes = pdf(), options: { key?: string; visibility?: string; mime?: string; extra?: string; duplicate?: boolean } = {}) {
  const form = new FormData()
  form.append('file', new File([new Uint8Array(bytes)], '../avtal.exe', { type: options.mime ?? 'application/pdf' }))
  if (options.visibility !== undefined) form.append('visibility', options.visibility)
  if (options.extra) form.append(options.extra, 'forged')
  if (options.duplicate) form.append('file', new File([new Uint8Array(bytes)], 'again.pdf', { type: 'application/pdf' }))
  return new NextRequest(`https://ops.invalid/api/v1/staff/support/cases/${caseReference}/attachments`, { method: 'POST', headers: { 'idempotency-key': options.key ?? 'staff-attachment-1' }, body: form })
}
const params = () => ({ params: Promise.resolve({ caseReference }) })
beforeEach(() => {
  state.calls = []; state.objects.clear(); state.receipts.clear(); state.rows = []
  state.auth = true; state.commandDenied = false; state.closed = false; state.failUpload = false
  state.loseUploadResponse = false; state.failFinalize = false; state.corruptReadback = false; state.uploads = 0; state.count = 0
  state.nativeQuotaError = false
  state.rateLimited = false
  state.missOneDownload = false; state.duplicateStatus = '409'
})

describe('mounted staff attachment routes', () => {
  it('preserves native/customer 429 semantics when the shared atomic quota trigger refuses an insert', async () => {
    const { addSupportAttachment } = await import('@/lib/customer-service/supportAttachments')
    state.nativeQuotaError = true
    await expect(addSupportAttachment({ companyId: context.companyId, customerId, caseId, bytes: pdf(), fileName: 'a.pdf', declaredMime: 'application/pdf', visibility: 'internal', uploadedBy: { kind: 'staff', userId: context.userId } })).rejects.toMatchObject({ code: 'attachment_quota_exceeded', status: 429 })
    expect(state.objects.size).toBe(0)
  })
  it('stores verified bytes with bucket-compatible MIME, a bound command and a safe staff DTO', async () => {
    const route = await import('@/app/api/v1/staff/support/cases/[caseReference]/attachments/route')
    const response = await route.POST(upload(pdf(), { visibility: 'customer' }), params())
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(validateResponse(document, attachmentPath, body, 'post', '201')).toEqual([])
    expect(body.data).toMatchObject({ case_reference: caseReference, visibility: 'customer', file_name: 'avtal.pdf', mime_type: 'application/pdf', scan_status: 'released', uploaded_by: 'staff', sha256: digest(pdf()) })
    expect(JSON.stringify(body.data)).not.toMatch(/storage_path|uploaded_by_user_id|customer_id|company_id|00000001-/)
    expect(state.calls.find(call => call.name === 'staff_api_attachment_reserve')?.args).toMatchObject({ p_company_id: context.companyId, p_client_id: context.client.id, p_user_id: context.userId, p_session_id: context.sessionId, p_revision: 7, p_native_session_id: context.nativeSessionId, p_case_reference: caseReference })
    expect(state.calls.find(call => call.name === 'storage.upload')?.args).toMatchObject({ contentType: 'application/pdf', upsert: false })
  })

  it('retains a rejected record and refuses plain, hex-escaped, compressed and object-stream active PDF content', async () => {
    const route = await import('@/app/api/v1/staff/support/cases/[caseReference]/attachments/route')
    for (const [index, value] of ['/JS (x)', '/#4A#53 (x)', '/Filter /FlateDecode stream compressed endstream', '/#46ilter /FlateDecode', '/Type /ObjStm', '/Encrypt 4 0 R'].entries()) {
      const response = await route.POST(upload(pdf(value), { key: `staff-rejected-${index}` }), params())
      expect(response.status).toBe(201)
      const body = await response.json()
      expect(body.data.scan_status).toBe('rejected')
      expect(body.data.mime_type).toBeNull()
      expect(body.data.scan_reason).toBe(index < 2 ? 'pdf_active_content' : 'pdf_encoded_content')
    }
  })

  it('rejects real deflated active PDF objects whose JavaScript names are absent from the visible bytes', async () => {
    const route = await import('@/app/api/v1/staff/support/cases/[caseReference]/attachments/route')
    const bytes = encodedPdf()
    expect(bytes.includes(Buffer.from('/JavaScript'))).toBe(false)
    expect(bytes.includes(Buffer.from('/JS'))).toBe(false)
    const response = await route.POST(upload(bytes), params())
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(validateResponse(document, attachmentPath, body, 'post', '201')).toEqual([])
    expect(body.data).toMatchObject({ scan_status: 'rejected', scan_reason: 'pdf_encoded_content', mime_type: null })
  })

  it('recovers a matching existing object when Storage reports duplicate as HTTP 400, without an overwrite', async () => {
    const route = await import('@/app/api/v1/staff/support/cases/[caseReference]/attachments/route')
    state.failFinalize = true
    expect((await route.POST(upload(), params())).status).toBe(503)
    state.failFinalize = false; state.missOneDownload = true; state.duplicateStatus = '400'
    expect((await route.POST(upload(), params())).status).toBe(201)
    expect(state.uploads).toBe(1)
    expect(state.calls.filter(call => call.name === 'storage.upload').every(call => call.args.upsert === false)).toBe(true)
  })

  it('rejects duplicate/unknown multipart fields, invalid visibility, empty/large files and unsupported MIME before any write', async () => {
    const route = await import('@/app/api/v1/staff/support/cases/[caseReference]/attachments/route')
    for (const request of [upload(pdf(), { duplicate: true }), upload(pdf(), { extra: 'actor_user_id' }), upload(pdf(), { visibility: 'public' }), upload(Buffer.alloc(0)), upload(Buffer.alloc(4 * 1024 * 1024 + 1)), upload(pdf(), { mime: 'text/html' })]) {
      expect((await route.POST(request, params())).status).toBeGreaterThanOrEqual(400)
    }
    expect(state.rows).toHaveLength(0); expect(state.uploads).toBe(0)
  })

  it('bounds the transport stream with a missing or forged Content-Length', async () => {
    const route = await import('@/app/api/v1/staff/support/cases/[caseReference]/attachments/route')
    for (const length of [null, '1']) {
      const request = upload()
      const headers = new Headers(request.headers)
      if (length !== null) headers.set('content-length', length)
      const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 32 * 1024 + 1)); controller.close() } })
      const oversized = new NextRequest(request.url, { method: 'POST', headers, body, duplex: 'half' } as ConstructorParameters<typeof NextRequest>[1])
      expect((await route.POST(oversized, params())).status).toBe(413)
    }
    expect(state.rows).toHaveLength(0)
  })

  it('replays one reference and object and conflicts on changed bytes or visibility', async () => {
    const route = await import('@/app/api/v1/staff/support/cases/[caseReference]/attachments/route')
    const first = await (await route.POST(upload(), params())).json()
    const second = await route.POST(upload(), params())
    expect(second.status).toBe(201); expect(second.headers.get('idempotency-replayed')).toBe('true')
    expect((await second.json()).data).toEqual(first.data)
    expect((await route.POST(upload(pdf('different')), params())).status).toBe(409)
    expect((await route.POST(upload(pdf(), { visibility: 'customer' }), params())).status).toBe(409)
    expect(state.rows).toHaveLength(1); expect(state.uploads).toBe(1)
  })

  it('recovers the original object after an upload response loss and an audit/finalization failure', async () => {
    const route = await import('@/app/api/v1/staff/support/cases/[caseReference]/attachments/route')
    state.failUpload = true
    expect((await route.POST(upload(), params())).status).toBe(503)
    const original = state.rows[0].public_reference
    state.failUpload = false; state.loseUploadResponse = true; state.failFinalize = true
    expect((await route.POST(upload(), params())).status).toBe(503)
    expect(state.rows[0].scan_status).toBe('quarantined')
    state.loseUploadResponse = false; state.failFinalize = false
    const restored = await route.POST(upload(), params())
    expect(restored.status).toBe(201)
    expect((await restored.json()).data.attachment_reference).toBe(original)
    expect(state.rows).toHaveLength(1); expect(state.uploads).toBe(1)
  })

  it('never releases a corrupt readback and does not overwrite it on retry', async () => {
    const route = await import('@/app/api/v1/staff/support/cases/[caseReference]/attachments/route')
    state.corruptReadback = true
    expect((await route.POST(upload(), params())).status).toBe(409)
    expect(state.rows[0].scan_status).toBe('quarantined')
    expect(state.calls.some(call => call.name === 'staff_api_attachment_finalize')).toBe(false)
    expect((await route.POST(upload(), params())).status).toBe(409)
    expect(state.uploads).toBe(1)
  })

  it('fails closed at the fresh command gate and the case closure gate, before storage', async () => {
    const route = await import('@/app/api/v1/staff/support/cases/[caseReference]/attachments/route')
    state.commandDenied = true
    expect((await route.POST(upload(), params())).status).toBe(403)
    state.commandDenied = false; state.closed = true
    expect((await route.POST(upload(), params())).status).toBe(409)
    expect(state.uploads).toBe(0)
  })

  it('returns retryable 429 with a bounded Retry-After when the shared actor mutation budget refuses the reservation', async () => {
    const route = await import('@/app/api/v1/staff/support/cases/[caseReference]/attachments/route')
    state.rateLimited = true
    const response = await route.POST(upload(), params())
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(await response.json()).toMatchObject({ error: { code: 'staff_rate_limited', retryable: true } })
    expect(state.rows).toHaveLength(0); expect(state.uploads).toBe(0)
  })

  it('returns retryable 429 and a rolling-day Retry-After when the atomic customer attachment quota is full', async () => {
    const route = await import('@/app/api/v1/staff/support/cases/[caseReference]/attachments/route')
    state.nativeQuotaError = true
    const response = await route.POST(upload(), params())
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('86400')
    const body = await response.json()
    expect(validateResponse(document, attachmentPath, body, 'post', '429')).toEqual([])
    expect(body).toMatchObject({ error: { code: 'attachment_quota_exceeded', retryable: true } })
    expect(state.rows).toHaveLength(0); expect(state.uploads).toBe(0)
  })

  it('does no resource read or storage activity when staff authentication is denied', async () => {
    const route = await import('@/app/api/v1/staff/support/cases/[caseReference]/attachments/route')
    state.auth = false
    expect((await route.POST(upload(), params())).status).toBe(403)
    expect((await route.GET(new NextRequest('https://ops.invalid/x'), params())).status).toBe(403)
    expect(state.calls.every(call => call.name === 'auth')).toBe(true)
  })

  it('lists scan/visibility states in paged DTOs and binds the cursor to its case', async () => {
    const route = await import('@/app/api/v1/staff/support/cases/[caseReference]/attachments/route')
    await route.POST(upload(), params())
    await route.POST(upload(pdf('/JS (x)'), { key: 'staff-attachment-2' }), params())
    const response = await route.GET(new NextRequest('https://ops.invalid/x?limit=1'), params())
    const body = await response.json()
    expect(response.status).toBe(200); expect(body.page).toMatchObject({ returned: 1, has_more: true })
    expect(validateResponse(document, attachmentPath, body)).toEqual([])
    expect(body.data[0]).toHaveProperty('scan_status')
    const changed = await route.GET(new NextRequest(`https://ops.invalid/x?cursor=${body.page.next_cursor}`), { params: Promise.resolve({ caseReference: 'support_case_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' }) })
    expect(changed.status).toBe(400)
    expect(JSON.stringify(body.data)).not.toMatch(/storage_path|00000001-/)
  })

  it('serves verified released bytes as a download, with private cache and correlation headers', async () => {
    const route = await import('@/app/api/v1/staff/support/cases/[caseReference]/attachments/route')
    const fileRoute = await import('@/app/api/v1/staff/support/cases/[caseReference]/attachments/[attachmentReference]/route')
    const created = await (await route.POST(upload(), params())).json()
    const fileParams = { params: Promise.resolve({ caseReference, attachmentReference: created.data.attachment_reference }) }
    const response = await fileRoute.GET(new NextRequest('https://ops.invalid/x'), fileParams)
    expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(pdf())
    expect(response.headers.get('content-disposition')).toMatch(/^attachment;/)
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
    expect(response.headers.get('content-length')).toBe(String(pdf().length))
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-gridex-sha256')).toBe(created.data.sha256)
    expect(response.headers.get('x-correlation-id')).toBe(context.correlationId)
    state.objects.set(String(state.rows[0].storage_path), pdf('tampered'))
    const tampered = await fileRoute.GET(new NextRequest('https://ops.invalid/x'), fileParams)
    expect(await tampered.json()).toMatchObject({ error: { code: 'attachment_unavailable' } })
    expect(tampered.status).toBe(409)
  })

  it('refuses encoded active PDFs from older released rows even when the stored hash is valid', async () => {
    const route = await import('@/app/api/v1/staff/support/cases/[caseReference]/attachments/route')
    const fileRoute = await import('@/app/api/v1/staff/support/cases/[caseReference]/attachments/[attachmentReference]/route')
    const created = await (await route.POST(upload(), params())).json()
    const bytes = encodedPdf(); const row = state.rows[0]
    Object.assign(row, { sha256: digest(bytes), byte_size: bytes.length, scan_status: 'released', detected_mime_type: 'application/pdf' })
    state.objects.set(String(row.storage_path), bytes)
    const response = await fileRoute.GET(new NextRequest('https://ops.invalid/x'), { params: Promise.resolve({ caseReference, attachmentReference: created.data.attachment_reference }) })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'attachment_unavailable' } })
  })

  it('refuses a historical MIME label that disagrees with the verified bytes', async () => {
    const route = await import('@/app/api/v1/staff/support/cases/[caseReference]/attachments/route')
    const fileRoute = await import('@/app/api/v1/staff/support/cases/[caseReference]/attachments/[attachmentReference]/route')
    const created = await (await route.POST(upload(), params())).json()
    state.rows[0].detected_mime_type = 'image/png'
    const response = await fileRoute.GET(new NextRequest('https://ops.invalid/x'), { params: Promise.resolve({ caseReference, attachmentReference: created.data.attachment_reference }) })
    expect(response.status).toBe(409)
  })
})
