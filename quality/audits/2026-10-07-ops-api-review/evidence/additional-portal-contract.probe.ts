import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

/**
 * Support attachments step B: the mounted customer attachment routes end
 * to end through the real handlers, the quarantine domain and customerPortalJson, with an
 * in-memory database and storage. Authentication and identity resolution are stubbed.
 */

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
let idCounter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`

function readPath(row: Row, field: string): unknown {
  const json = /^(\w+)->>(\w+)$/.exec(field)
  if (json) {
    const value = (row[json[1]] as Row | null)?.[json[2]]
    return value === undefined || value === null ? null : String(value)
  }
  return row[field]
}

function builder(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let mode: 'select' | 'insert' | 'update' = 'select'
  let pending: Row[] = []
  let patch: Row = {}
  let limit: number | null = null
  let ascending = true
  let head = false
  let conflict = false
  const api: Record<string, unknown> = {
    select: (_columns?: string, options?: { head?: boolean }) => { head = Boolean(options?.head); return api },
    gte: (field: string, value: string) => { filters.push((row) => String(readPath(row, field)) >= value); return api },
    eq: (field: string, value: unknown) => { filters.push((row) => readPath(row, field) === value); return api },
    in: (field: string, values: unknown[]) => { filters.push((row) => values.includes(readPath(row, field))); return api },
    contains: (field: string, value: Row) => {
      filters.push((row) => Object.entries(value).every(([key, v]) => (row[field] as Row | null)?.[key] === v))
      return api
    },
    or: () => api,
    order: (_field: string, options?: { ascending?: boolean }) => { ascending = options?.ascending ?? true; return api },
    limit: (value: number) => { limit = value; return api },
    insert: (value: Row | Row[]) => {
      mode = 'insert'
      // Same unique key as the real customer_portal_write_idempotency table.
      const key = (row: Row) => [row.company_id, row.api_client_id, row.route, row.idempotency_key].join('|')
      if (table === 'customer_portal_write_idempotency' && !Array.isArray(value)
        && (db[table] ?? []).some((row) => key(row) === key(value))) {
        conflict = true
        pending = []
        return api
      }
      pending = (Array.isArray(value) ? value : [value]).map((row) => ({
        id: nextId(), ...(table === 'customer_cases' ? { status: 'open', resolved_at: null } : {}), created_at: new Date(Date.now() + idCounter).toISOString(), updated_at: new Date().toISOString(), metadata: {}, ...row,
      }))
      db[table] = [...(db[table] ?? []), ...pending]
      return api
    },
    update: (value: Row) => { mode = 'update'; patch = value; return api },
    rows(): Row[] {
      if (mode === 'insert') return pending
      const matched = (db[table] ?? []).filter((row) => filters.every((filter) => filter(row)))
      if (mode === 'update') { matched.forEach((row) => Object.assign(row, patch)); return matched }
      const sorted = [...matched].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) * (ascending ? 1 : -1))
      return limit === null ? sorted : sorted.slice(0, limit)
    },
    single: async () => (conflict ? { data: null, error: { code: '23505' } } : { data: (api.rows as () => Row[])()[0] ?? null, error: null }),
    maybeSingle: async () => (conflict ? { data: null, error: { code: '23505' } } : { data: (api.rows as () => Row[])()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => {
      const rows = (api.rows as () => Row[])()
      return resolve({ data: head ? null : rows, count: rows.length, error: null })
    },
  }
  return api
}

const objects = new Map<string, Buffer>()
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => builder(table),
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Buffer) => { objects.set(path, Buffer.from(bytes)); return { error: null } },
        remove: async (paths: string[]) => { paths.forEach((path) => objects.delete(path)); return { error: null } },
        download: async (path: string) => {
          const bytes = objects.get(path)
          return bytes ? { data: new Blob([new Uint8Array(bytes)]), error: null } : { data: null, error: { message: 'missing' } }
        },
      }),
    },
  },
}))
vi.mock('@/lib/customer-portal/keysetPagination', () => ({
  portalPageLimit: (value?: number | null) => Math.min(Math.max(Math.trunc(value ?? 50), 1), 100),
  decodePortalCursor: () => null,
  buildPortalDatabasePage: (rows: Row[], input: { limit: number }) => ({
    items: rows.slice(0, input.limit),
    page: { limit: input.limit, offset: 0, returned: Math.min(rows.length, input.limit), has_more: rows.length > input.limit, next_cursor: null },
  }),
}))


const auth = vi.hoisted(() => ({ scopes: ['customer_support.read', 'customer_support.write'] as string[], binding: 'portal_account' as 'portal_account' | 'identifier_match', customerId: '' }))

vi.mock('@/lib/integrations/apiAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/integrations/apiAuth')>()
  return {
    ...original,
    requireIntegrationApiAccess: async (_request: unknown, required: unknown) => {
      const missing = original.missingIntegrationApiScopes(auth.scopes, Array.isArray(required) ? required as string[] : [])
      if (missing.length) return { ok: false, status: 403, error: 'scope saknas', errorCode: 'api_scope_missing', client: null }
      return { ok: true, client: { id: 'client-a', company_id: TENANT_A, scopes: auth.scopes }, context: {}, rateLimit: null }
    },
    logIntegrationApiRequest: async () => undefined,
    currentIntegrationApiResponseContext: () => null,
  }
})

vi.mock('@/lib/customer-portal/customerResolver', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/customer-portal/customerResolver')>()
  return {
    ...original,
    resolvePortalCustomer: async () => ({
      ok: true,
      binding: auth.binding,
      customer: { id: 'ident-a1', company_id: TENANT_A, customer_id: auth.customerId, external_customer_id: null, customer_number: 'A-1', email: null, auth_user_id: null, customer_portal_user_id: null, match_strength: 'strong', match_method: 'test', provider: 'test' },
    }),
  }
})

const TENANT_A = '0000000a-0000-4000-8000-000000000000'
const CUSTOMER_A1 = '000000a1-0000-4000-8000-000000000000'
const CUSTOMER_A2 = '000000a2-0000-4000-8000-000000000000'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i

function request(method: string, path: string, body?: unknown, key?: string) {
  return new NextRequest(`https://app.gridex.se${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  objects.clear()
  for (const key of Object.keys(db)) delete db[key]
  db.customers = [{ id: CUSTOMER_A1, company_id: TENANT_A }, { id: CUSTOMER_A2, company_id: TENANT_A }]
  db.customer_cases = []
  db.customer_case_events = []
  db.customer_case_attachments = []
  db.customer_portal_write_idempotency = []
  db.audit_logs = []
  auth.scopes = ['customer_support.read', 'customer_support.write']
  auth.binding = 'portal_account'
  auth.customerId = CUSTOMER_A1
})


const pdf = (body = '1 0 obj << /Type /Catalog >> endobj') => Buffer.from(`%PDF-1.7\n${body}\n%%EOF\n`, 'latin1')

function upload(reference: string, bytes: Buffer, options: { type?: string; key?: string; name?: string; length?: number } = {}) {
  const headers: Record<string, string> = { 'content-type': options.type ?? 'application/pdf' }
  if (options.key !== '') headers['idempotency-key'] = options.key ?? 'key-att-0001-abcdefgh'
  if (options.name) headers['x-file-name'] = encodeURIComponent(options.name)
  if (options.length !== undefined) headers['content-length'] = String(options.length)
  return new NextRequest(`https://app.gridex.se/api/v1/customer/support/cases/${reference}/attachments`, {
    method: 'POST', headers, body: new Uint8Array(bytes),
  })
}

async function openCase(): Promise<string> {
  const cases = await import('@/app/api/v1/customer/support/cases/route')
  const created = await cases.POST(request('POST', '/api/v1/customer/support/cases', { title: 'Faktura', message: 'Se bilaga.' }, 'key-case-0001-abcdefgh'))
  expect(created.status).toBe(201)
  return (await created.json()).data.case_reference
}

const params = (reference: string) => ({ params: Promise.resolve({ reference }) })
const fileParams = (reference: string, attachmentReference: string) => ({ params: Promise.resolve({ reference, attachmentReference }) })

describe('mounted customer support attachment routes', () => {
  it('uploads into quarantine, releases a clean file, lists and downloads it without internal identifiers', async () => {
    const reference = await openCase()
    const route = await import('@/app/api/v1/customer/support/cases/[reference]/attachments/route')
    const fileRoute = await import('@/app/api/v1/customer/support/cases/[reference]/attachments/[attachmentReference]/route')

    const created = await route.POST(upload(reference, pdf(), { name: '../faktura maj.exe' }), params(reference))
    expect(created.status).toBe(201)
    const body = await created.json()
    expect(body.contract_schema_version).toBe(WEBSITE_INTEGRATION_CONTRACT_VERSION)
    expect(body.data).toMatchObject({ file_name: 'faktura maj.pdf', mime_type: 'application/pdf', uploaded_by: 'customer', byte_size: pdf().length })
    expect(body.data.attachment_reference).toMatch(/^support_attachment_/)
    expect(JSON.stringify(body.data)).not.toMatch(UUID)
    expect(db.customer_case_attachments[0]).toMatchObject({ scan_status: 'released', visibility: 'customer', uploaded_by_kind: 'customer', api_client_id: 'client-a' })

    const spec = JSON.parse(readFileSync('docs/openapi/customer-portal-v1.json', 'utf8'))
    expect(Object.keys(body.data).sort()).toEqual(Object.keys(spec.components.schemas.CustomerSupportAttachment.properties).sort())

    const list = await route.GET(request('GET', `/api/v1/customer/support/cases/${reference}/attachments`), params(reference))
    expect(list.status).toBe(200)
    expect((await list.json()).data).toEqual([body.data])

    const download = await fileRoute.GET(request('GET', `/api/v1/customer/support/cases/${reference}/attachments/${body.data.attachment_reference}`), fileParams(reference, body.data.attachment_reference))
    expect(download.status).toBe(200)
    expect(Buffer.from(await download.arrayBuffer()).equals(pdf())).toBe(true)
    expect(download.headers.get('content-disposition')).toMatch(/^attachment;/)
    expect(download.headers.get('x-content-type-options')).toBe('nosniff')
    expect(download.headers.get('content-security-policy')).toContain('sandbox')
    expect(download.headers.get('x-gridex-sha256')).toBe(body.data.sha256)
    expect(download.headers.get('x-gridex-contract-version')).toBe(WEBSITE_INTEGRATION_CONTRACT_VERSION)
    expect(download.headers.get('x-request-id')).toMatch(UUID)
    expect(download.headers.get('cache-control')).toBe('private, no-store')
    const fileUrl = `https://app.gridex.se/api/v1/customer/support/cases/${reference}/attachments/${body.data.attachment_reference}`
    const echoed = await fileRoute.GET(new NextRequest(fileUrl, { headers: { 'x-request-id': 'request-from-tenant' } }), fileParams(reference, body.data.attachment_reference))
    expect(echoed.headers.get('x-request-id')).toBe('request-from-tenant')
    const blank = await fileRoute.GET(new NextRequest(fileUrl, { headers: { 'x-request-id': ' ' } }), fileParams(reference, body.data.attachment_reference))
    expect(blank.headers.get('x-request-id')).toMatch(UUID)
  })

  it('rejects active PDF content with 422 and never lists or serves it', async () => {
    const reference = await openCase()
    const route = await import('@/app/api/v1/customer/support/cases/[reference]/attachments/route')
    const response = await route.POST(upload(reference, pdf('/OpenAction << /S /JavaScript /JS (app.alert(1)) >>')), params(reference))
    expect(response.status).toBe(422)
    expect((await response.json()).error.code).toBe('attachment_rejected')
    expect(db.customer_case_attachments[0]).toMatchObject({ scan_status: 'rejected', scan_reason: 'pdf_active_content' })
    const list = await route.GET(request('GET', `/api/v1/customer/support/cases/${reference}/attachments`), params(reference))
    expect((await list.json()).data).toEqual([])
  })

  it('validates type, size, empty body, idempotency key and scope before storing anything', async () => {
    const reference = await openCase()
    const route = await import('@/app/api/v1/customer/support/cases/[reference]/attachments/route')
    const html = await route.POST(upload(reference, Buffer.from('<html>'), { type: 'text/html' }), params(reference))
    expect(html.status).toBe(415)
    const big = await route.POST(upload(reference, Buffer.alloc(16), { length: 4 * 1024 * 1024 + 1 }), params(reference))
    expect(big.status).toBe(413)
    const oversizedBody = await route.POST(upload(reference, Buffer.alloc(4 * 1024 * 1024 + 1)), params(reference))
    expect(oversizedBody.status).toBe(413)
    const empty = await route.POST(upload(reference, Buffer.alloc(0)), params(reference))
    expect(empty.status).toBe(422)
    const noKey = await route.POST(upload(reference, pdf(), { key: '' }), params(reference))
    expect(noKey.status).toBe(400)
    auth.scopes = ['customer_support.read']
    const readOnly = await route.POST(upload(reference, pdf()), params(reference))
    expect(readOnly.status).toBe(403)
    expect(db.customer_case_attachments).toHaveLength(0)
    expect(objects.size).toBe(0)
  })

  it('replays the same Idempotency-Key and bytes without a second file, and rejects a different file under the same key', async () => {
    const reference = await openCase()
    const route = await import('@/app/api/v1/customer/support/cases/[reference]/attachments/route')
    const first = await route.POST(upload(reference, pdf(), { key: 'key-att-replay-abcdefgh' }), params(reference))
    const second = await route.POST(upload(reference, pdf(), { key: 'key-att-replay-abcdefgh' }), params(reference))
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(second.headers.get('idempotency-replayed')).toBe('true')
    expect((await second.json()).data.attachment_reference).toBe((await first.json()).data.attachment_reference)
    expect(db.customer_case_attachments).toHaveLength(1)
    const conflict = await route.POST(upload(reference, pdf('2 0 obj << >> endobj'), { key: 'key-att-replay-abcdefgh' }), params(reference))
    expect(conflict.status).toBe(409)
    expect(db.customer_case_attachments).toHaveLength(1)
  })

  it('another customer of the same tenant gets 404 for the case and the file', async () => {
    const reference = await openCase()
    const route = await import('@/app/api/v1/customer/support/cases/[reference]/attachments/route')
    const fileRoute = await import('@/app/api/v1/customer/support/cases/[reference]/attachments/[attachmentReference]/route')
    const created = await (await route.POST(upload(reference, pdf()), params(reference))).json()
    auth.customerId = CUSTOMER_A2
    expect((await route.GET(request('GET', `/x`), params(reference))).status).toBe(404)
    expect((await fileRoute.GET(request('GET', `/x`), fileParams(reference, created.data.attachment_reference))).status).toBe(404)
    expect((await route.POST(upload(reference, pdf(), { key: 'key-att-other-abcdefgh' }), params(reference))).status).toBe(404)
  })

  it('internal staff files are never listed or served to the customer', async () => {
    const reference = await openCase()
    const route = await import('@/app/api/v1/customer/support/cases/[reference]/attachments/route')
    const fileRoute = await import('@/app/api/v1/customer/support/cases/[reference]/attachments/[attachmentReference]/route')
    const { addSupportAttachment } = await import('@/lib/customer-service/supportAttachments')
    const caseRow = db.customer_cases[0]
    const internal = await addSupportAttachment({ companyId: TENANT_A, customerId: CUSTOMER_A1, caseId: String(caseRow.id), bytes: pdf(), fileName: 'intern.pdf', declaredMime: null, visibility: 'internal', uploadedBy: { kind: 'staff', userId: 'staff-1' } })
    expect(internal.scan_status).toBe('released')
    expect((await (await route.GET(request('GET', '/x'), params(reference))).json()).data).toEqual([])
    expect((await fileRoute.GET(request('GET', '/x'), fileParams(reference, internal.public_reference))).status).toBe(404)
  })

  it('a closed case rejects new attachments with 409', async () => {
    const reference = await openCase()
    db.customer_cases[0].status = 'closed'
    const route = await import('@/app/api/v1/customer/support/cases/[reference]/attachments/route')
    const response = await route.POST(upload(reference, pdf()), params(reference))
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('support_case_closed')
    expect(db.customer_case_attachments).toHaveLength(0)
  })
})

describe('additional public contract review proof',()=>{
 it('completed upload cannot replay after staff closes the case',async()=>{
  const reference=await openCase();const route=await import('@/app/api/v1/customer/support/cases/[reference]/attachments/route');
  const first=await route.POST(upload(reference,pdf()),params(reference));expect(first.status).toBe(201);
  const before=db.customer_case_attachments.length;db.customer_cases[0].status='closed';
  const replay=await route.POST(upload(reference,pdf()),params(reference));expect(replay.status).toBe(409);expect((await replay.json()).error.code).toBe('support_case_closed');expect(db.customer_case_attachments).toHaveLength(before);
 })
 it('attachment list hides the newest released attachment after its100 row cap',async()=>{
  const reference=await openCase();const route=await import('@/app/api/v1/customer/support/cases/[reference]/attachments/route');
  expect((await route.POST(upload(reference,pdf()),params(reference))).status).toBe(201);
  const template=db.customer_case_attachments[0];db.customer_case_attachments=Array.from({length:101},(_,i)=>({...template,id:nextId(),public_reference:'support_attachment_'+String(i).padStart(24,'a'),created_at:new Date(Date.UTC(2024,0,1)+i*86400000).toISOString()}));
  const result=await route.GET(request('GET','/api/v1/customer/support/cases/'+reference+'/attachments?cursor=anything&limit=100'),params(reference));expect(result.status).toBe(200);const body=await result.json();expect(body.data).toHaveLength(100);expect(body).not.toHaveProperty('page');expect(body.data.some((r:{attachment_reference:string})=>r.attachment_reference===db.customer_case_attachments[100].public_reference)).toBe(false);
 })
 it('message list hides newest customer-visible messages after500 without continuation',async()=>{
  const reference=await openCase();const template=db.customer_case_events.find(r=>r.event_type==='support_customer_message')??db.customer_case_events[0];
  db.customer_case_events=Array.from({length:501},(_,i)=>({...template,id:nextId(),message:'Customer message '+i,created_at:new Date(Date.UTC(2024,0,1)+i*86400000).toISOString()}));
  const route=await import('@/app/api/v1/customer/support/cases/[reference]/messages/route');const result=await route.GET(request('GET','/api/v1/customer/support/cases/'+reference+'/messages?cursor=anything&limit=100'),params(reference));expect(result.status).toBe(200);const body=await result.json();expect(body.data).toHaveLength(500);expect(body).not.toHaveProperty('page');expect(body.data.some((r:{body:string})=>r.body==='Customer message 500')).toBe(false);
 })
})
