import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { canonicalApiError } from '@/lib/api/apiError'
import { assertPublicResponsePayload } from '@/lib/api/publicPayloadSafety'
import { ApiInputError } from '@/lib/api/strictRequest'
import { currentIntegrationApiResponseContext, logIntegrationApiRequest } from '@/lib/integrations/apiAuth'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'
import { requireStaffApiContext, type StaffApiContext, type StaffApiRequirements } from '@/lib/staff-api/context'
import { assertStaffStorageTarget, staffStorageProjectRef } from '@/lib/staff-api/storageTarget'

/** One server-issued request id per Staff call, shared by body, header, error and request log. */
const staffRequestId = new AsyncLocalStorage<string>()
const CLIENT_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/
function currentStaffRequestId(): string { return staffRequestId.getStore() ?? randomUUID() }
/** Client-supplied x-request-id is kept as a separate, validated correlation value only. */
function clientRequestId(request: NextRequest): Record<string, string> {
  const value = request.headers.get('x-request-id')
  return value !== null && CLIENT_REQUEST_ID.test(value) ? { client_request_id: value } : {}
}

const STAFF_USER_FIELDS = new Set(['user_id', 'assignee_user_id', 'author_user_id'])
/** Reuse the existing internal-data guard with only explicit staff account IDs excepted. */
export function assertStaffResponsePayload(body: unknown): void {
  function project(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(project)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (STAFF_USER_FIELDS.has(key)) {
        if (child !== null && (typeof child !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(child))) {
          throw new Error('Invalid staff user identifier in response.')
        }
        return [`staff_${key.replace(/_id$/, '_reference')}`, 'staff-account']
      }
      return [key, project(child)]
    }))
  }
  assertPublicResponsePayload(project(body))
}

/** Staff DTOs intentionally contain Gridex staff user IDs, but no company/customer internals. */
export function staffApiJson(body: unknown, init: number | ResponseInit = {}): Response {
  const options = typeof init === 'number' ? { status: init } : init
  const headers = new Headers(options.headers)
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : { data: body }
  if (record.error === undefined) assertStaffResponsePayload(record)
  const requestId = typeof record.request_id === 'string' && record.request_id.trim() ? record.request_id : currentStaffRequestId()
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Request-ID', requestId)
  headers.set('X-Gridex-Contract-Version', WEBSITE_INTEGRATION_CONTRACT_VERSION)
  const rate = currentIntegrationApiResponseContext()
  if (rate?.rateLimit) {
    headers.set('X-RateLimit-Limit', String(rate.rateLimit.limit))
    headers.set('X-RateLimit-Remaining', String(rate.rateLimit.remaining))
    if (rate.rateLimit.resetAt) headers.set('X-RateLimit-Reset', rate.rateLimit.resetAt)
  }
  if (rate?.retryAfterSeconds) headers.set('Retry-After', String(rate.retryAfterSeconds))
  return Response.json({ ...record, request_id: requestId, contract_schema_version: WEBSITE_INTEGRATION_CONTRACT_VERSION }, { ...options, headers })
}

export function staffApiError(error: unknown): Response {
  const known = error instanceof ApiInputError
  if (!known) console.error('[staff-api] request_failed', { code: (error as { code?: string } | null)?.code ?? 'internal_error' })
  return staffApiJson(canonicalApiError({
    code: known ? error.code : 'internal_error', message: known ? error.message : 'The request could not be completed.',
    requestId: currentStaffRequestId(), field: known ? error.field ?? undefined : undefined,
  }), { status: known ? error.status : 500 })
}

export async function withStaffApi(
  request: NextRequest, options: StaffApiRequirements, handler: (context: StaffApiContext) => Promise<Response>,
): Promise<Response> {
  return staffRequestId.run(randomUUID(), () => runStaffApi(request, options, handler))
}

function responseRequestId(response: Response): string {
  const requestId = response.headers.get('x-request-id') ?? currentStaffRequestId()
  if (!response.headers.has('x-request-id')) response.headers.set('X-Request-ID', requestId)
  return requestId
}

async function runStaffApi(
  request: NextRequest, options: StaffApiRequirements, handler: (context: StaffApiContext) => Promise<Response>,
): Promise<Response> {
  // Refuse a mismatched database before authentication rate-limit, audit or handler writes.
  try { assertStaffStorageTarget(request.headers) } catch (error) { return staffApiError(error) }
  let context: StaffApiContext | undefined
  try {
    context = await requireStaffApiContext(request, options)
    const response = await handler(context)
    const projectRef = staffStorageProjectRef()
    if (projectRef) response.headers.set('X-Gridex-Project-Ref', projectRef)
    await logIntegrationApiRequest({ request, client: context.client, startedAt: context.startedAt, statusCode: response.status,
      requestId: responseRequestId(response), metadata: { channel: 'staff_api', actor_user_id: context.actorUserId, ...clientRequestId(request) } })
    return response
  } catch (error) {
    const response = staffApiError(error)
    await logIntegrationApiRequest({ request, client: context?.client, startedAt: context?.startedAt ?? Date.now(),
      statusCode: response.status, errorCode: error instanceof ApiInputError ? error.code : 'internal_error', requestId: responseRequestId(response),
      metadata: { channel: 'staff_api', ...(context ? { actor_user_id: context.actorUserId } : {}), ...clientRequestId(request) } })
    return response
  }
}
