import { createHash, randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { ApiInputError, executeIdempotentPortalWrite, readJsonObject, requireIdempotencyKey } from '@/lib/api/strictRequest'
import { withStaffApi, staffApiJson } from '@/lib/staff-api/http'
import { applyStaffQueryPolicy } from '@/lib/staff-api/queryPolicy'
import type { StaffApiContext } from '@/lib/staff-api/context'
import { findStaffCustomer } from '@/lib/staff-api/customers'
import { STAFF_CASE_PRIORITIES, STAFF_CASE_STATUSES, assignStaffCase, createStaffCase, findStaffCase, listStaffCaseEvents, listStaffCases, staffAttachmentDto, staffCaseDto, staffCaseEventDto } from '@/lib/staff-api/cases'
import { updateCustomerCaseStatus } from '@/lib/customer-cases/db'
import { PHONE_VERIFICATION_METHODS, addInternalNote, recordPhoneInteraction, replyToCustomer, type PhoneVerificationMethod } from '@/lib/customer-service/supportConversation'
import { SUPPORT_ATTACHMENT_API_MAX_BYTES, SUPPORT_ATTACHMENT_MIME_TYPES, addSupportAttachment, downloadSupportAttachment, listSupportAttachmentsPage } from '@/lib/customer-service/supportAttachments'
import { toSupportApiError } from '@/lib/customer-service/supportApi'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'
import { PortalCursorError } from '@/lib/customer-portal/keysetPagination'

export type CaseParams = { params: Promise<{ reference: string }> }
export type CaseAttachmentParams = { params: Promise<{ reference: string; attachmentReference: string }> }
const READ_ACCESS = { scopes: ['staff_cases.read'], permission: 'cases.read' } as const
const WRITE_ACCESS = { scopes: ['staff_cases.write'], permission: 'cases.write' } as const

function fail(message: string, field: string, code = 'invalid_request'): never { throw new ApiInputError(message, code, 422, field) }
function exact(body: Record<string, unknown>, fields: readonly string[]) {
  for (const key of Object.keys(body)) if (!fields.includes(key)) fail('Fältet stöds inte.', key)
}
function text(value: unknown, field: string, max: number, required = true): string | null {
  if (value === undefined || value === null) {
    if (required) fail('Fältet krävs.', field)
    return null
  }
  if (typeof value !== 'string') fail('Fältet måste vara text.', field)
  const normalized = value.replace(/\u0000/g, '').trim()
  if (!normalized && required) fail('Fältet krävs.', field)
  if (normalized.length > max) fail(`Fältet får vara högst ${max} tecken.`, field)
  return normalized || null
}
function choice<T extends string>(value: unknown, field: string, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) fail('Ogiltigt värde.', field)
  return value as T
}
function mutationError(error: unknown): unknown {
  if (error instanceof PortalCursorError) return new ApiInputError(error.message, error.code, error.status, error.field)
  const mapped = toSupportApiError(error)
  if (mapped !== error) return mapped
  const database = error as { code?: string; message?: string } | null
  if (database?.code === 'P0002') return new ApiInputError('Ärendet hittades inte.', 'support_case_not_found', 404)
  if (database?.message?.includes('assignee_not_active_in_company')) return new ApiInputError('Tilldelning kräver aktiv personal i samma bolag.', 'staff_assignee_invalid', 422, 'assignee_user_id')
  if (database?.code === '42501') return new ApiInputError('Behörighet saknas för åtgärden.', 'staff_permission_denied', 403)
  if (database?.code === '22023') return new ApiInputError('Ogiltig ärendeåtgärd.', 'invalid_request', 422)
  if (database?.code === '23505' && database.message === 'staff_support_idempotency_conflict') return new ApiInputError('Idempotency-Key har redan använts med annan payload.', 'idempotency_conflict', 409)
  return error
}
function route(request: NextRequest, access: typeof READ_ACCESS | typeof WRITE_ACCESS, handler: (context: StaffApiContext) => Promise<Response>) {
  return withStaffApi(request, access, async (context) => {
    try { return await handler(context) } catch (error) { throw mutationError(error) }
  })
}
async function write(request: NextRequest, context: StaffApiContext, customerId: string, operation: string, payload: Record<string, unknown>, execute: () => Promise<{ statusCode: number; body: { data: unknown } }>) {
  const result = await executeIdempotentPortalWrite({
    request, companyId: context.companyId, clientId: context.apiClientId, customerId, operation,
    payload: { ...payload, actorUserId: context.actorUserId, apiClientId: context.apiClientId }, execute,
  })
  return staffApiJson(result.body, { status: result.statusCode, headers: { 'Idempotency-Replayed': String(result.replayed) } })
}
function scope(context: StaffApiContext, supportCase: { id: string; customer_id: string }) {
  return { companyId: context.companyId, customerId: supportCase.customer_id, caseId: supportCase.id, actorUserId: context.actorUserId, apiClientId: context.apiClientId, channel: 'staff_api' as const }
}
function pageInput(request: NextRequest) {
  for (const key of request.nextUrl.searchParams.keys()) if (!['limit', 'cursor'].includes(key)) fail('Parametern stöds inte.', key)
  applyStaffQueryPolicy(request, ['limit'])
  const rawLimit = request.nextUrl.searchParams.get('limit')
  const limit = rawLimit === null ? null : Number(rawLimit)
  if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 100)) fail('limit måste vara mellan 1 och 100.', 'limit')
  return { limit, cursor: request.nextUrl.searchParams.get('cursor') }
}

export function getStaffCases(request: NextRequest) {
  return route(request, READ_ACCESS, async (context) => {
    const params = request.nextUrl.searchParams
    for (const key of params.keys()) if (!['limit', 'cursor', 'status', 'customer_reference', 'query'].includes(key)) fail('Parametern stöds inte.', key)
    applyStaffQueryPolicy(request, ['limit'])
    const rawLimit = params.get('limit')
    const limit = rawLimit === null ? null : Number(rawLimit)
    if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 100)) fail('limit måste vara mellan 1 och 100.', 'limit')
    const status = params.get('status')
    if (status && !['open', 'action_required', 'awaiting_external_response', 'billing_blocked', 'manual_follow_up', 'resolved', 'cancelled', 'closed'].includes(status)) fail('Ogiltig status.', 'status')
    const customerReference = params.get('customer_reference')
    const customer = customerReference ? await findStaffCustomer(context.companyId, customerReference) : null
    const page = await listStaffCases({ companyId: context.companyId, customerId: customer?.id, limit, cursor: params.get('cursor'), status, query: text(params.get('query'), 'query', 180, false) })
    return staffApiJson({ data: page.items, page: page.page })
  })
}
export function postStaffCase(request: NextRequest) {
  return route(request, WRITE_ACCESS, async (context) => {
    const body = await readJsonObject(request)
    exact(body, ['customer_reference', 'title', 'description', 'category', 'priority'])
    const title = text(body.title, 'title', 180) as string
    const description = text(body.description, 'description', 8000, false)
    const category = text(body.category, 'category', 120, false)
    const priority = body.priority === undefined ? 'normal' : choice(body.priority, 'priority', STAFF_CASE_PRIORITIES)
    const customer = await findStaffCustomer(context.companyId, text(body.customer_reference, 'customer_reference', 100) as string)
    const idempotencyKey = requireIdempotencyKey(request)
    return write(request, context, customer.id, '/api/v1/staff/cases', body, async () => ({
      statusCode: 201, body: { data: await createStaffCase({ ...context, customerId: customer.id, title, description, category, priority, idempotencyKey }) },
    }))
  })
}
export function getStaffCase(request: NextRequest, params: CaseParams) {
  return route(request, READ_ACCESS, async (context) => {
    const supportCase = await findStaffCase(context.companyId, (await params.params).reference)
    const [events, attachments] = await Promise.all([
      listStaffCaseEvents(context.companyId, supportCase.customer_id, supportCase.id),
      listSupportAttachmentsPage({ ...scope(context, supportCase), audience: 'staff' }),
    ])
    return staffApiJson({ data: { ...staffCaseDto(supportCase), events: events.items, events_page: events.page,
      attachments: attachments.items.map(staffAttachmentDto), attachments_page: attachments.page } })
  })
}
export function getStaffCaseEvents(request: NextRequest, params: CaseParams) {
  return route(request, READ_ACCESS, async (context) => {
    const input = pageInput(request)
    const supportCase = await findStaffCase(context.companyId, (await params.params).reference)
    const page = await listStaffCaseEvents(context.companyId, supportCase.customer_id, supportCase.id, input)
    return staffApiJson({ data: page.items, page: page.page })
  })
}
function postEntry(request: NextRequest, params: CaseParams, kind: 'message' | 'note' | 'phone') {
  return route(request, WRITE_ACCESS, async (context) => {
    const { reference } = await params.params
    const body = await readJsonObject(request)
    const supportCase = await findStaffCase(context.companyId, reference)
    const staffScope = scope(context, supportCase)
    let execute: () => ReturnType<typeof replyToCustomer>
    if (kind === 'message') {
      exact(body, ['message', 'kind'])
      const message = text(body.message, 'message', 8000)
      const replyKind = body.kind === undefined ? 'message' : choice(body.kind, 'kind', ['message', 'phone_summary'] as const)
      execute = () => replyToCustomer({ ...staffScope, message, kind: replyKind })
    } else if (kind === 'note') {
      exact(body, ['message'])
      const message = text(body.message, 'message', 8000)
      execute = () => addInternalNote({ ...staffScope, message })
    } else {
      exact(body, ['direction', 'summary', 'verification_method', 'verification_reference', 'representative'])
      const direction = choice(body.direction, 'direction', ['inbound', 'outbound'] as const)
      const summary = text(body.summary, 'summary', 8000)
      const verificationMethod = choice(body.verification_method, 'verification_method', Object.keys(PHONE_VERIFICATION_METHODS) as PhoneVerificationMethod[])
      const verificationReference = text(body.verification_reference, 'verification_reference', 120, false)
      let representative: { name: string | null; mandateReference: string | null } | null = null
      if (body.representative !== undefined && body.representative !== null) {
        if (typeof body.representative !== 'object' || Array.isArray(body.representative)) fail('Ogiltig företrädare.', 'representative')
        const raw = body.representative as Record<string, unknown>
        exact(raw, ['name', 'mandate_reference'])
        representative = { name: text(raw.name, 'name', 160, false), mandateReference: text(raw.mandate_reference, 'mandate_reference', 120, false) }
      }
      execute = () => recordPhoneInteraction({ ...staffScope, direction, summary, verificationMethod, verificationReference, representative })
    }
    const path = kind === 'message' ? 'messages' : kind === 'note' ? 'notes' : 'phone-interactions'
    return write(request, context, supportCase.customer_id, `/api/v1/staff/cases/[reference]/${path}`, { reference, ...body }, async () => ({ statusCode: 201, body: { data: staffCaseEventDto(context.companyId, await execute()) } }))
  })
}
export const postStaffCaseMessage = (request: NextRequest, params: CaseParams) => postEntry(request, params, 'message')
export const postStaffCaseNote = (request: NextRequest, params: CaseParams) => postEntry(request, params, 'note')
export const postStaffCasePhoneInteraction = (request: NextRequest, params: CaseParams) => postEntry(request, params, 'phone')
export function patchStaffCaseStatus(request: NextRequest, params: CaseParams) {
  return route(request, WRITE_ACCESS, async (context) => {
    const { reference } = await params.params
    const body = await readJsonObject(request)
    exact(body, ['status', 'message'])
    const status = choice(body.status, 'status', STAFF_CASE_STATUSES)
    const message = text(body.message, 'message', 8000, false)
    const supportCase = await findStaffCase(context.companyId, reference)
    return write(request, context, supportCase.customer_id, '/api/v1/staff/cases/[reference]/status', { reference, ...body }, async () => ({ statusCode: 200, body: { data: staffCaseDto(await updateCustomerCaseStatus({ ...context, channel: 'staff_api', caseId: supportCase.id, expectedSource: supportCase.source ?? undefined, status, message })) } }))
  })
}
export function patchStaffCaseAssignee(request: NextRequest, params: CaseParams) {
  return route(request, WRITE_ACCESS, async (context) => {
    const { reference } = await params.params
    const body = await readJsonObject(request)
    exact(body, ['assignee_user_id'])
    if (body.assignee_user_id !== null && (typeof body.assignee_user_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.assignee_user_id))) fail('Ange personalens användar-id eller null.', 'assignee_user_id')
    const assigneeUserId = body.assignee_user_id as string | null
    const supportCase = await findStaffCase(context.companyId, reference)
    return write(request, context, supportCase.customer_id, '/api/v1/staff/cases/[reference]/assignee', { reference, ...body }, async () => ({ statusCode: 200, body: { data: await assignStaffCase({ ...context, caseId: supportCase.id, expectedSource: supportCase.source, assigneeUserId }) } }))
  })
}
export function getStaffCaseAttachments(request: NextRequest, params: CaseParams) {
  return route(request, READ_ACCESS, async (context) => {
    const supportCase = await findStaffCase(context.companyId, (await params.params).reference)
    const page = await listSupportAttachmentsPage({ ...scope(context, supportCase), audience: 'staff' }, pageInput(request))
    return staffApiJson({ data: page.items.map(staffAttachmentDto), page: page.page })
  })
}
async function readFile(request: NextRequest) {
  const declared = Number(request.headers.get('content-length') ?? '0')
  const tooLarge = () => new ApiInputError('Filen är större än 4 MB.', 'attachment_too_large', 413)
  if (Number.isFinite(declared) && declared > SUPPORT_ATTACHMENT_API_MAX_BYTES) throw tooLarge()
  if (!request.body) throw new ApiInputError('Filen är tom.', 'attachment_empty', 422)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > SUPPORT_ATTACHMENT_API_MAX_BYTES) { await reader.cancel().catch(() => undefined); throw tooLarge() }
    chunks.push(value)
  }
  if (!total) throw new ApiInputError('Filen är tom.', 'attachment_empty', 422)
  return Buffer.concat(chunks)
}
export function postStaffCaseAttachment(request: NextRequest, params: CaseParams) {
  return route(request, WRITE_ACCESS, async (context) => {
    const { reference } = await params.params
    requireIdempotencyKey(request)
    const contentType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!(SUPPORT_ATTACHMENT_MIME_TYPES as readonly string[]).includes(contentType)) throw new ApiInputError('Content-Type måste vara application/pdf, image/png eller image/jpeg.', 'unsupported_media_type', 415)
    const visibility = choice(request.headers.get('x-attachment-visibility') ?? 'internal', 'x-attachment-visibility', ['internal', 'customer'] as const)
    const supportCase = await findStaffCase(context.companyId, reference)
    const bytes = await readFile(request)
    const rawName = request.headers.get('x-file-name')
    let fileName = rawName?.slice(0, 200) ?? null
    if (rawName) { try { fileName = decodeURIComponent(rawName).slice(0, 200) } catch { /* Treat malformed encoding as informational text. */ } }
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    return write(request, context, supportCase.customer_id, '/api/v1/staff/cases/[reference]/attachments', { reference, sha256, content_type: contentType, file_name: fileName, visibility }, async () => {
      const row = await addSupportAttachment({ ...scope(context, supportCase), bytes, fileName, declaredMime: contentType, visibility, uploadedBy: { kind: 'staff', userId: context.actorUserId, apiClientId: context.apiClientId } })
      if (row.scan_status !== 'released') throw new ApiInputError('Filen godkändes inte i innehållskontrollen.', 'attachment_rejected', 422)
      return { statusCode: 201, body: { data: staffAttachmentDto(row) } }
    })
  })
}
export function getStaffCaseAttachmentFile(request: NextRequest, params: CaseAttachmentParams) {
  return route(request, READ_ACCESS, async (context) => {
    const { reference, attachmentReference } = await params.params
    const supportCase = await findStaffCase(context.companyId, reference)
    const { row, bytes } = await downloadSupportAttachment({ ...scope(context, supportCase), reference: attachmentReference, audience: 'staff' })
    return new Response(new Uint8Array(bytes), { headers: {
      'Content-Type': row.detected_mime_type ?? 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      'Content-Length': String(bytes.length), 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, no-store',
      'X-Gridex-Sha256': row.sha256, 'X-Gridex-Contract-Version': WEBSITE_INTEGRATION_CONTRACT_VERSION,
      'X-Request-ID': request.headers.get('x-request-id')?.trim() || randomUUID(),
    } })
  })
}
