/**
 * Customer support API handlers (tenant portal → OPS support cases).
 *
 * Mounted at app/api/v1/customer/support/cases/** (contract releases 2026-10-01.1 and 2026-10-02.1).
 */
import { NextRequest } from 'next/server'
import { createHash, randomUUID } from 'node:crypto'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'
import { ApiInputError, executeIdempotentPortalWrite, readJsonObject, requireIdempotencyKey } from '@/lib/api/strictRequest'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import { publicPageInput } from '@/lib/customer-portal/publicDto'
import {
  addCustomerSupportMessage,
  createCustomerSupportCase,
  findCustomerSupportCase,
  isClosedSupportCase,
  listCustomerSupportCases,
  listCustomerSupportMessagesPage,
  publicSupportCase,
} from '@/lib/customer-service/supportConversation'
import { toSupportApiError } from '@/lib/customer-service/supportApi'
import {
  SUPPORT_ATTACHMENT_API_MAX_BYTES,
  SUPPORT_ATTACHMENT_MIME_TYPES,
  addSupportAttachment,
  downloadSupportAttachment,
  listSupportAttachmentsContinuation,
  publicSupportAttachment,
} from '@/lib/customer-service/supportAttachments'

/** Continuation of oldest-first support histories; the V1 body shape stays unchanged. */
export const SUPPORT_NEXT_CURSOR_HEADER = 'X-Gridex-Next-Cursor'
const continuationHeaders = (nextCursor: string | null): Record<string, string> => (nextCursor ? { [SUPPORT_NEXT_CURSOR_HEADER]: nextCursor } : {})

type Params = { params: Promise<{ reference: string }> }
type AttachmentParams = { params: Promise<{ reference: string; attachmentReference: string }> }

export async function getSupportCases(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_support.read'], { enforceBinding: true })
  if (!context.ok) return context.response
  try {
    const page = await listCustomerSupportCases(
      { companyId: context.client.company_id, customerId: context.identity.customer_id },
      publicPageInput(request.nextUrl.searchParams),
    )
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: page.items.length })
    return customerPortalJson({ data: page.items, page: page.page })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error: toSupportApiError(error) })
  }
}

export async function postSupportCase(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_support.write'], { enforceBinding: true })
  if (!context.ok) return context.response
  try {
    const body = await readJsonObject(request)
    const idempotencyKey = requireIdempotencyKey(request)
    const result = await executeIdempotentPortalWrite<Record<string, unknown>>({
      request,
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: context.identity.customer_id,
      operation: '/api/v1/customer/support/cases',
      payload: body,
      execute: async () => {
        const created = await createCustomerSupportCase({
          companyId: context.client.company_id,
          customerId: context.identity.customer_id,
          apiClientId: context.client.id,
          portalIdentityId: context.identity.id,
          title: body.title,
          message: body.message,
          category: body.category,
          idempotencyKey,
        })
        return { statusCode: 201, body: { data: created.case } }
      },
    })
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1, metadata: { action: 'support_case_created', idempotency_replay: result.replayed } })
    return customerPortalJson(result.body, { status: result.statusCode, headers: { 'Idempotency-Replayed': String(result.replayed) } })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error: toSupportApiError(error) })
  }
}

export async function getSupportCase(request: NextRequest, contextInput: { params: Promise<{ reference: string }> }) {
  const context = await requireCustomerPortalApiContext(request, ['customer_support.read'], { enforceBinding: true })
  if (!context.ok) return context.response
  try {
    const { reference } = await contextInput.params
    const scope = { companyId: context.client.company_id, customerId: context.identity.customer_id }
    const supportCase = await findCustomerSupportCase(scope, reference)
    const messages = await listCustomerSupportMessagesPage(scope, supportCase.id)
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1 })
    return customerPortalJson({ data: { ...publicSupportCase(supportCase), messages: messages.items } }, { headers: continuationHeaders(messages.nextCursor) })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error: toSupportApiError(error) })
  }
}

export async function getSupportMessages(request: NextRequest, contextInput: Params) {
  const context = await requireCustomerPortalApiContext(request, ['customer_support.read'], { enforceBinding: true })
  if (!context.ok) return context.response
  try {
    const { reference } = await contextInput.params
    const scope = { companyId: context.client.company_id, customerId: context.identity.customer_id }
    const supportCase = await findCustomerSupportCase(scope, reference)
    const messages = await listCustomerSupportMessagesPage(scope, supportCase.id, { cursor: request.nextUrl.searchParams.get('cursor') })
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: messages.items.length })
    return customerPortalJson({ data: messages.items }, { headers: continuationHeaders(messages.nextCursor) })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error: toSupportApiError(error) })
  }
}

export async function postSupportMessage(request: NextRequest, contextInput: Params) {
  const context = await requireCustomerPortalApiContext(request, ['customer_support.write'], { enforceBinding: true })
  if (!context.ok) return context.response
  try {
    const { reference } = await contextInput.params
    const body = await readJsonObject(request)
    const result = await executeIdempotentPortalWrite<Record<string, unknown>>({
      request,
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: context.identity.customer_id,
      operation: '/api/v1/customer/support/cases/[reference]/messages',
      payload: { reference, ...body },
      execute: async () => {
        const message = await addCustomerSupportMessage({
          companyId: context.client.company_id,
          customerId: context.identity.customer_id,
          caseReference: reference,
          apiClientId: context.client.id,
          portalIdentityId: context.identity.id,
          message: body.message,
        })
        return { statusCode: 201, body: { data: message } }
      },
    })
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1, metadata: { action: 'support_message_created', idempotency_replay: result.replayed } })
    return customerPortalJson(result.body, { status: result.statusCode, headers: { 'Idempotency-Replayed': String(result.replayed) } })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error: toSupportApiError(error) })
  }
}

export async function getSupportAttachments(request: NextRequest, contextInput: Params) {
  const context = await requireCustomerPortalApiContext(request, ['customer_support.read'], { enforceBinding: true })
  if (!context.ok) return context.response
  try {
    const { reference } = await contextInput.params
    const scope = { companyId: context.client.company_id, customerId: context.identity.customer_id }
    const supportCase = await findCustomerSupportCase(scope, reference)
    const page = await listSupportAttachmentsContinuation({ ...scope, caseId: supportCase.id, audience: 'customer' }, { cursor: request.nextUrl.searchParams.get('cursor') })
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: page.items.length })
    return customerPortalJson({ data: page.items.map(publicSupportAttachment) }, { headers: continuationHeaders(page.nextCursor) })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error: toSupportApiError(error) })
  }
}

/** Reads a raw request body, refusing anything over the limit without buffering it all first. */
async function readBoundedBody(request: NextRequest, maxBytes: number): Promise<Buffer> {
  const declared = Number(request.headers.get('content-length') ?? '')
  const tooLarge = () => new ApiInputError('Filen är större än 4 MB.', 'attachment_too_large', 413)
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge()
  if (!request.body) return Buffer.alloc(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw tooLarge()
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/** Header file names are informational only; they are sanitized and the real type comes from the bytes. */
function headerFileName(request: NextRequest): string | null {
  const raw = request.headers.get('x-file-name')
  if (!raw) return null
  try { return decodeURIComponent(raw).slice(0, 200) } catch { return raw.slice(0, 200) }
}

export async function postSupportAttachment(request: NextRequest, contextInput: Params) {
  const context = await requireCustomerPortalApiContext(request, ['customer_support.write'], { enforceBinding: true })
  if (!context.ok) return context.response
  try {
    const { reference } = await contextInput.params
    const contentType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!(SUPPORT_ATTACHMENT_MIME_TYPES as readonly string[]).includes(contentType)) {
      throw new ApiInputError('Content-Type måste vara application/pdf, image/png eller image/jpeg.', 'unsupported_media_type', 415)
    }
    requireIdempotencyKey(request)
    const scope = { companyId: context.client.company_id, customerId: context.identity.customer_id }
    // Current auth/ownership is always checked before any idempotent replay can be returned.
    const supportCase = await findCustomerSupportCase(scope, reference)
    const bytes = await readBoundedBody(request, SUPPORT_ATTACHMENT_API_MAX_BYTES)
    if (bytes.length === 0) throw new ApiInputError('Filen är tom.', 'attachment_empty', 422)
    const fileName = headerFileName(request)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const result = await executeIdempotentPortalWrite<Record<string, unknown>>({
      request,
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: context.identity.customer_id,
      operation: '/api/v1/customer/support/cases/[reference]/attachments',
      payload: { reference, sha256, content_type: contentType, file_name: fileName },
      execute: async () => {
        // F10 policy: a previously completed upload with the same key and bytes replays its stored
        // result even after the case was closed; closure blocks only new writes.
        if (isClosedSupportCase(supportCase)) {
          throw new ApiInputError('Ärendet är avslutat. Skapa ett nytt ärende.', 'support_case_closed', 409)
        }
        const row = await addSupportAttachment({
          ...scope,
          caseId: supportCase.id,
          bytes,
          fileName,
          declaredMime: contentType,
          visibility: 'customer',
          uploadedBy: { kind: 'customer', apiClientId: context.client.id },
        })
        if (row.scan_status !== 'released') {
          throw new ApiInputError('Filen godkändes inte i innehållskontrollen.', 'attachment_rejected', 422)
        }
        return { statusCode: 201, body: { data: publicSupportAttachment(row) } }
      },
    })
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1, metadata: { action: 'support_attachment_created', idempotency_replay: result.replayed } })
    return customerPortalJson(result.body, { status: result.statusCode, headers: { 'Idempotency-Replayed': String(result.replayed) } })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error: toSupportApiError(error) })
  }
}

export async function getSupportAttachmentFile(request: NextRequest, contextInput: AttachmentParams) {
  const context = await requireCustomerPortalApiContext(request, ['customer_support.read'], { enforceBinding: true })
  if (!context.ok) return context.response
  try {
    const { reference, attachmentReference } = await contextInput.params
    const scope = { companyId: context.client.company_id, customerId: context.identity.customer_id }
    const supportCase = await findCustomerSupportCase(scope, reference)
    const { row, bytes } = await downloadSupportAttachment({ ...scope, caseId: supportCase.id, reference: attachmentReference, audience: 'customer' })
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1 })
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': row.detected_mime_type ?? 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
        'Content-Length': String(bytes.length),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cache-Control': 'private, no-store',
        'X-Gridex-Sha256': row.sha256,
        'X-Gridex-Contract-Version': WEBSITE_INTEGRATION_CONTRACT_VERSION,
        'X-Request-ID': request.headers.get('x-request-id')?.trim() || randomUUID(),
      },
    })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error: toSupportApiError(error) })
  }
}
