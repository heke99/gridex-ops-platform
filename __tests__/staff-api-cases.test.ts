import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiInputError } from '@/lib/api/strictRequest'
import { publicReference } from '@/lib/integrations/publicReferences'

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({ db: {} as Record<string, Row[]>, serial: 0, permissions: ['cases.read', 'cases.write'], calls: [] as unknown[], receipts: new Map<string, { fingerprint: string; value: unknown }>() }))
const A = '0000000a-0000-4000-8000-000000000000'
const B = '0000000b-0000-4000-8000-000000000000'
const C = '000000a1-0000-4000-8000-000000000000'
const D = '000000b1-0000-4000-8000-000000000000'
const ACTOR = '0000057a-0000-4000-8000-000000000000'
const CLIENT = '00000ca1-0000-4000-8000-000000000000'
const nextId = () => `00000000-0000-4000-8000-${String(++state.serial).padStart(12, '0')}`
function value(row: Row, key: string): unknown {
  const path = /^(\w+)->>(\w+)$/.exec(key)
  if (!path) return row[key]
  const nested = (row[path[1]] as Row | null)?.[path[2]]
  return nested === undefined || nested === null ? null : String(nested)
}
function builder(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  const order: Array<{ key: string; ascending: boolean }> = []
  let limit = Infinity
  let patch: Row | null = null
  let inserted: Row[] | null = null
  const rows = () => {
    if (inserted) return inserted
    const matches = (state.db[table] ?? []).filter(row => filters.every(filter => filter(row)))
    if (patch) matches.forEach(row => Object.assign(row, patch))
    return matches.sort((left, right) => {
      for (const field of order) { const result = String(left[field.key]).localeCompare(String(right[field.key])) * (field.ascending ? 1 : -1); if (result) return result }
      return 0
    }).slice(0, limit)
  }
  const api = {
    select: () => api,
    eq: (key: string, expected: unknown) => { filters.push(row => value(row, key) === expected); return api },
    in: (key: string, expected: unknown[]) => { filters.push(row => expected.includes(value(row, key))); return api },
    contains: (key: string, expected: Row) => { filters.push(row => Object.entries(expected).every(([k, v]) => (row[key] as Row)?.[k] === v)); return api },
    ilike: (key: string, expected: string) => { const needle = expected.slice(1, -1).replace(/\\([\\%_])/g, '$1').toLowerCase(); filters.push(row => String(row[key]).toLowerCase().includes(needle)); return api },
    like: (key: string, expected: string) => { filters.push(row => String(row[key]).startsWith(expected.slice(0, -1).replace(/\\([_])/g, '$1'))); return api },
    or: () => api,
    order: (key: string, options: { ascending: boolean }) => { order.push({ key, ascending: options.ascending }); return api },
    limit: (count: number) => { limit = count; return api },
    insert: (input: Row | Row[]) => {
      inserted = (Array.isArray(input) ? input : [input]).map(row => ({ id: nextId(), created_at: '2026-10-04T08:00:00Z', updated_at: '2026-10-04T08:00:00Z', metadata: {}, ...row }))
      state.db[table] = [...(state.db[table] ?? []), ...inserted]; return api
    },
    update: (input: Row) => { patch = input; return api },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (result: { data: Row[]; error: null }) => unknown) => resolve({ data: rows(), error: null }),
  }
  return api
}
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => builder(table),
  rpc: async (name: string, args: Row) => {
    state.calls.push({ name, args })
    if (name === 'gridex_create_staff_support_case_v1') {
      const id = nextId()
      const row = { id, company_id: args.p_company_id, customer_id: args.p_customer_id,
        title: args.p_title, description: args.p_description, reason_category: args.p_category,
        priority: args.p_priority, status: 'open', source: 'tenant_support_staff_api',
        case_type: 'other', billing_blocked: false, billing_manual_review: false, cancellation_required: false,
        created_by: args.p_actor_user_id, assigned_to: null, created_at: '2026-10-04T08:00:00Z', updated_at: '2026-10-04T08:00:00Z',
        metadata: { ...(args.p_metadata as Row), support_case: true, support_channel: 'staff_api', support_public_reference: publicReference('support_case', String(args.p_company_id), id) },
      }
      state.db.customer_cases.push(row)
      state.db.audit_logs.push({ metadata: { actor_user_id: args.p_actor_user_id, api_client_id: args.p_api_client_id, channel: 'staff_api' } })
      return { data: { case: row, reused: false }, error: null }
    }
    if (name === 'gridex_staff_support_event') {
      const supportCase = state.db.customer_cases.find(row => row.company_id === args.p_company_id && row.id === args.p_case_id && row.customer_id === args.p_customer_id)
      if (!supportCase) return { data: null, error: { code: 'P0002' } }
      const event = { id: nextId(), company_id: args.p_company_id, customer_id: args.p_customer_id, customer_case_id: args.p_case_id, event_type: args.p_event_type, message: args.p_message, payload: args.p_payload, created_by: args.p_actor_user_id, created_at: '2026-10-04T08:30:00Z' }
      state.db.customer_case_events.push(event)
      state.db.audit_logs.push({ actor_user_id: args.p_actor_user_id, channel: 'staff_api', api_client_id: args.p_api_client_id })
      return { data: event, error: null }
    }
    const row = state.db.customer_cases.find(row => row.company_id === args.p_company_id && row.id === args.p_case_id && row.source === args.p_expected_source)
    if (!row) return { data: null, error: { code: 'P0002' } }
    if (name === 'gridex_assign_customer_case') {
      const assignee = args.p_assignee_user_id
      if (assignee !== null && !state.db.company_memberships.some(member => member.company_id === args.p_company_id && member.user_id === assignee && member.is_active && member.status === 'active')) return { data: null, error: { code: '22023', message: 'assignee_not_active_in_company' } }
      row.assigned_to = assignee
    } else row.status = args.p_status
    return { data: row, error: null }
  },
} }))
vi.mock('@/lib/staff-api/http', () => ({
  staffApiJson: (body: unknown, init: ResponseInit = {}) => Response.json(body, init),
  withStaffApi: async (_request: NextRequest, options: { scopes: string[]; permission: string }, handler: (context: Row) => Promise<Response>) => {
    state.calls.push(options)
    if (!state.permissions.includes(options.permission)) return Response.json({ error: { code: 'staff_permission_denied' } }, { status: 403 })
    try { return await handler({ companyId: A, actorUserId: ACTOR, apiClientId: CLIENT, permissions: state.permissions, startedAt: Date.now() }) }
    catch (error) { if (error instanceof ApiInputError) return Response.json({ error: { code: error.code, field: error.field } }, { status: error.status }); throw error }
  },
}))
vi.mock('@/lib/staff-api/customers', () => ({ findStaffCustomer: async (companyId: string, reference: string) => {
  const row = state.db.customers.find(customer => customer.company_id === companyId && publicReference('customer', companyId, customer.id) === reference)
  if (!row) throw new ApiInputError('Kunden hittades inte.', 'customer_not_found', 404)
  return row
} }))
vi.mock('@/lib/api/strictRequest', async (original) => {
  const source = await original<typeof import('@/lib/api/strictRequest')>()
  return { ...source, executeIdempotentPortalWrite: async (input: { request: NextRequest; operation: string; payload: unknown; execute: () => Promise<unknown> }) => {
    const key = `${input.operation}:${source.requireIdempotencyKey(input.request)}`
    const fingerprint = JSON.stringify(input.payload)
    const existing = state.receipts.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new source.ApiInputError('Konflikt.', 'idempotency_conflict', 409)
      return { ...(existing.value as Row), replayed: true }
    }
    const result = await input.execute()
    state.receipts.set(key, { fingerprint, value: result })
    return { ...(result as Row), replayed: false }
  } }
})
vi.mock('@/lib/customer-portal/keysetPagination', () => {
  class PortalCursorError extends Error { readonly code = 'invalid_cursor'; readonly status = 400; readonly field = 'cursor' }
  return {
  PortalCursorError,
  decodePortalCursor: (input: { cursor?: string | null }) => { if (input.cursor) throw new PortalCursorError('Invalid cursor'); return null },
  portalPageLimit: (limit: number | null) => limit ?? 50,
  buildPortalDatabasePage: (rows: Row[], input: { limit: number }) => ({ items: rows.slice(0, input.limit), page: { limit: input.limit, offset: 0, returned: Math.min(rows.length, input.limit), has_more: rows.length > input.limit, next_cursor: null } }),
} })
vi.mock('@/lib/customer-service/supportAttachments', () => ({
  SUPPORT_ATTACHMENT_API_MAX_BYTES: 4 * 1024 * 1024,
  SUPPORT_ATTACHMENT_MIME_TYPES: ['application/pdf', 'image/png', 'image/jpeg'],
  listSupportAttachmentsPage: async (scope: Row) => { state.calls.push({ attachmentList: scope }); return { items: [], page: { limit: 50, offset: 0, returned: 0, has_more: false, next_cursor: null } } },
  downloadSupportAttachment: async (scope: Row) => { state.calls.push({ attachmentDownload: scope }); return { row: { file_name: 'invoice.pdf', detected_mime_type: 'application/pdf', sha256: 'a'.repeat(64) }, bytes: Buffer.from('%PDF-1.7\n%%EOF') } },
  addSupportAttachment: async (input: Row) => { state.calls.push({ attachmentUpload: input }); return { public_reference: 'support_attachment_safe', file_name: 'invoice.pdf', detected_mime_type: 'application/pdf', byte_size: 15, sha256: 'a'.repeat(64), scan_status: 'released', visibility: input.visibility, uploaded_by_kind: 'staff', created_at: '2026-10-04T08:00:00Z' } },
  SupportAttachmentError: class extends Error {},
}))
import * as handlers from '@/lib/staff-api/caseHandlers'
import { findStaffCase, staffCaseEventDto } from '@/lib/staff-api/cases'
import { listCustomerSupportMessages } from '@/lib/customer-service/supportConversation'
function params(reference: string) { return { params: Promise.resolve({ reference }) } }
function request(path: string, method = 'GET', body?: unknown, key = 'staff-test-key-1') {
  return new NextRequest(`https://app.gridex.se/api/v1/staff/cases${path}`, { method, headers: { 'content-type': 'application/json', 'idempotency-key': key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
function seed(companyId = A, customerId = C) {
  const id = nextId()
  const reference = publicReference('support_case', companyId, id) as string
  const row = { id, company_id: companyId, customer_id: customerId, title: 'Invoice enquiry', description: 'staff text', status: 'open', priority: 'normal', reason_category: 'support', assigned_to: null, source: 'tenant_support_admin', case_type: 'other', billing_blocked: false, billing_manual_review: false, cancellation_required: false, metadata: { support_case: true, support_public_reference: reference, support_channel: 'admin' }, created_at: '2026-10-04T08:00:00Z', updated_at: '2026-10-04T08:00:00Z', resolved_at: null, closed_at: null }
  state.db.customer_cases.push(row)
  return { row, reference }
}
beforeEach(() => {
  state.db = { customers: [{ id: C, company_id: A }, { id: D, company_id: B }], customer_cases: [], customer_case_events: [], audit_logs: [], company_memberships: [{ user_id: ACTOR, company_id: A, status: 'active', is_active: true }] }
  state.serial = 0; state.calls = []; state.permissions = ['cases.read', 'cases.write']; state.receipts.clear()
})

describe('staff support case API', () => {
  it('lists only support cases in the company, with explicit projections and search', async () => {
    const own = seed(); seed(B, D)
    state.db.customer_cases.push({ ...own.row, id: nextId(), metadata: { support_case: false } })
    const response = await handlers.getStaffCases(request('?query=Invoice&limit=1'))
    const body = await response.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].case_reference).toBe(own.reference)
    expect(body.data[0]).not.toHaveProperty('company_id')
    expect(body.data[0]).not.toHaveProperty('metadata')
    expect(body.page).toMatchObject({ returned: 1, has_more: false })
    expect(state.calls[0]).toEqual({ scopes: ['staff_cases.read'], permission: 'cases.read' })
  })
  it('refuses another company case before writing any event', async () => {
    const foreign = seed(B, D)
    await expect(findStaffCase(A, foreign.reference)).rejects.toMatchObject({ status: 404 })
    const response = await handlers.postStaffCaseNote(request(`/${foreign.reference}/notes`, 'POST', { message: 'should not be stored' }), params(foreign.reference))
    expect(response.status).toBe(404)
    expect(state.db.customer_case_events).toHaveLength(0)
  })
  it.each(['source', 'case_type', 'billing_blocked', 'billing_manual_review', 'cancellation_required'])('rejects operational %s even if its support marker is set', async (field) => {
    const { row, reference } = seed()
    Object.assign(row, { [field]: field === 'source' ? 'ediel_inbound_state_machine' : field === 'case_type' ? 'withdrawal' : true })
    await expect(findStaffCase(A, reference)).rejects.toMatchObject({ status: 404 })
    const response = await handlers.postStaffCaseMessage(request('', 'POST', { message: 'reply' }), params(reference))
    expect(response.status).toBe(404)
    expect(state.db.customer_case_events).toHaveLength(0)
    const listed = await (await handlers.getStaffCases(request(''))).json()
    expect(listed.data).toHaveLength(0)
  })
  it.each(['malformed-cursor', 'cursor-for-another-case'])('returns declared 400 for %s on the paged event route', async (cursor) => {
    const { reference } = seed()
    const response = await handlers.getStaffCaseEvents(request(`/${reference}/events?cursor=${cursor}`), params(reference))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatchObject({ code: 'invalid_cursor', field: 'cursor' })
  })
  it('requires cases.write and the staff-specific write scope on every mutation adapter', async () => {
    const { reference } = seed()
    state.permissions = ['cases.read']
    const adapters = [handlers.postStaffCaseMessage, handlers.postStaffCaseNote, handlers.postStaffCasePhoneInteraction, handlers.patchStaffCaseStatus, handlers.patchStaffCaseAssignee, handlers.postStaffCaseAttachment]
    for (const adapter of adapters) {
      const response = await adapter(request(`/${reference}`, 'POST', {}), params(reference))
      expect(response.status).toBe(403)
    }
    const create = await handlers.postStaffCase(request('', 'POST', {})); expect(create.status).toBe(403)
    expect(state.calls).toHaveLength(7)
    expect(state.calls.every(call => JSON.stringify(call) === JSON.stringify({ scopes: ['staff_cases.write'], permission: 'cases.write' }))).toBe(true)
    expect(state.db.customer_case_events).toHaveLength(0)
  })
  it('records a named staff reply once, attributes actor/client/channel, and hides notes from customers', async () => {
    const { row, reference } = seed()
    const reply = () => handlers.postStaffCaseMessage(request(`/${reference}/messages`, 'POST', { message: 'Your invoice was corrected.' }), params(reference))
    expect((await reply()).status).toBe(201)
    const replay = await reply(); expect(replay.headers.get('Idempotency-Replayed')).toBe('true')
    await handlers.postStaffCaseNote(request(`/${reference}/notes`, 'POST', { message: 'Private staff note.' }), params(reference))
    await handlers.postStaffCasePhoneInteraction(request(`/${reference}/phone-interactions`, 'POST', { direction: 'outbound', summary: 'Call log.', verification_method: 'unverified' }), params(reference))
    expect(state.db.customer_case_events).toHaveLength(3)
    expect(state.db.customer_case_events.every(event => event.created_by === ACTOR && (event.payload as Row).channel === 'staff_api' && (event.payload as Row).api_client_id === CLIENT)).toBe(true)
    const publicMessages = await listCustomerSupportMessages({ companyId: A, customerId: C }, row.id)
    expect(publicMessages.map(message => message.body)).toEqual(['Your invoice was corrected.'])
    const detail = await (await handlers.getStaffCase(request(`/${reference}`), params(reference))).json()
    expect(detail.data.events).toHaveLength(3)
    expect(detail.data.events.map((event: Row) => event.visibility).sort()).toEqual(['customer', 'internal', 'internal'])
    expect(detail.data.events_page.returned).toBe(3)
    expect(detail.data.attachments_page.returned).toBe(0)
    expect(JSON.stringify(detail)).not.toContain('api_client_id')
    expect(state.db.audit_logs).toHaveLength(3)
  })
  it('rejects forged actor fields and requires idempotency before domain mutation', async () => {
    const { reference } = seed()
    const forged = await handlers.postStaffCaseNote(request('', 'POST', { message: 'note', actorUserId: 'forged' }), params(reference))
    expect(forged.status).toBe(422)
    const missingKey = new NextRequest('https://app.gridex.se/api/v1/staff/cases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'note' }) })
    expect((await handlers.postStaffCaseNote(missingKey, params(reference))).status).toBe(400)
    expect(state.db.customer_case_events).toHaveLength(0)
  })
  it('sends both actor and client into the idempotency fingerprint', async () => {
    const { reference } = seed()
    await handlers.postStaffCaseNote(request('', 'POST', { message: 'note' }), params(reference))
    const stored = [...state.receipts.values()][0].fingerprint
    expect(stored).toContain(ACTOR); expect(stored).toContain(CLIENT)
  })
  it('creates support through the existing command and derives a retrievable company-bound reference', async () => {
    const response = await handlers.postStaffCase(request('', 'POST', { customer_reference: publicReference('customer', A, C), title: 'Help', priority: 'normal' }))
    expect(response.status).toBe(201)
    const body = await response.json()
    const stored = await findStaffCase(A, body.data.case_reference)
    expect(stored.metadata).toMatchObject({ support_case: true, support_channel: 'staff_api', actor_user_id: ACTOR, api_client_id: CLIENT })
    expect(stored).toMatchObject({ created_by: ACTOR, billing_blocked: false, cancellation_required: false })
    expect(state.db.audit_logs[0].metadata).toMatchObject({ actor_user_id: ACTOR, api_client_id: CLIENT, channel: 'staff_api' })
  })
  it('refuses cross-company or inactive assignees and preserves assignment on rejection', async () => {
    const { row, reference } = seed()
    const otherStaff = '0000057b-0000-4000-8000-000000000000'
    state.db.company_memberships.push({ user_id: otherStaff, company_id: B, status: 'active', is_active: true })
    const rejected = await handlers.patchStaffCaseAssignee(request('', 'PATCH', { assignee_user_id: otherStaff }), params(reference))
    expect(rejected.status).toBe(422); expect(row.assigned_to).toBeNull()
    const accepted = await handlers.patchStaffCaseAssignee(request('', 'PATCH', { assignee_user_id: ACTOR }, 'staff-assign-2'), params(reference))
    expect(accepted.status).toBe(200); expect(row.assigned_to).toBe(ACTOR)
    const call = state.calls.find(call => (call as Row).name === 'gridex_assign_customer_case') as { args: Row }
    expect(call.args).toMatchObject({ p_company_id: A, p_actor_user_id: ACTOR, p_api_client_id: CLIENT, p_expected_source: 'tenant_support_admin' })
  })
  it('uses the atomic status domain RPC, and cannot set operational billing_blocked from support', async () => {
    const { reference } = seed()
    const invalid = await handlers.patchStaffCaseStatus(request('', 'PATCH', { status: 'billing_blocked' }), params(reference))
    expect(invalid.status).toBe(422)
    const response = await handlers.patchStaffCaseStatus(request('', 'PATCH', { status: 'resolved', message: 'Completed' }), params(reference))
    expect(response.status).toBe(200)
    expect((await response.json()).data.status).toBe('resolved')
    expect(state.calls).toContainEqual({ name: 'gridex_staff_update_customer_case_status', args: expect.objectContaining({ p_company_id: A, p_actor_user_id: ACTOR, p_api_client_id: CLIENT }) })
  })
  it('uses staff audience for private attachments and streams verified files safely', async () => {
    const { reference } = seed()
    const upload = new NextRequest('https://app.gridex.se/api/v1/staff/cases', { method: 'POST', headers: { 'content-type': 'application/pdf', 'idempotency-key': 'staff-attachment-1' }, body: '%PDF-1.7\n%%EOF' })
    const result = await handlers.postStaffCaseAttachment(upload, params(reference)); expect(result.status).toBe(201)
    const write = state.calls.find(call => (call as Row).attachmentUpload) as { attachmentUpload: Row }
    expect(write.attachmentUpload).toMatchObject({ companyId: A, customerId: C, visibility: 'internal', uploadedBy: { kind: 'staff', userId: ACTOR, apiClientId: CLIENT } })
    await handlers.getStaffCaseAttachments(request(''), params(reference))
    const file = await handlers.getStaffCaseAttachmentFile(request(''), { params: Promise.resolve({ reference, attachmentReference: 'support_attachment_safe' }) })
    expect(file.headers.get('Cache-Control')).toBe('private, no-store')
    expect(file.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(file.headers.get('X-Gridex-Sha256')).toHaveLength(64)
    expect(state.calls).toContainEqual({ attachmentDownload: expect.objectContaining({ companyId: A, customerId: C, audience: 'staff' }) })
  })
  it('refuses oversized attachment before storage', async () => {
    const { reference } = seed()
    const upload = new NextRequest('https://app.gridex.se/api/v1/staff/cases', { method: 'POST', headers: { 'content-type': 'application/pdf', 'idempotency-key': 'staff-large-1', 'content-length': String(5 * 1024 * 1024) }, body: 'bytes' })
    expect((await handlers.postStaffCaseAttachment(upload, params(reference))).status).toBe(413)
    expect(state.calls.some(call => (call as Row).attachmentUpload)).toBe(false)
  })
  it('never projects arbitrary payload fields from event rows', () => {
    const dto = staffCaseEventDto(A, { id: nextId(), event_type: 'support_phone_interaction', message: 'call', created_at: 'now', created_by: ACTOR, payload: { visibility: 'internal', service_role: 'secret', verification: { method: 'unverified', secret: 'do-not-show' }, storage_path: 'bucket/private' } })
    const body = JSON.stringify(dto)
    expect(body).not.toContain('secret'); expect(body).not.toContain('storage_path'); expect(body).not.toContain('bucket')
  })
})
