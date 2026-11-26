import { randomUUID } from 'node:crypto'
import { withApiContractRepresentation } from '@/lib/integrations/apiResponseProfile'
import { NextRequest } from 'next/server'
import { ApiInputError, customerPortalWriteError, readJsonObject } from '@/lib/api/strictRequest'
import { canonicalApiError } from '@/lib/api/apiError'
import { listDomainEventsForCompany } from '@/lib/events/domainEvents'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { decodePortalCursor, encodePortalCursor, PortalCursorError } from '@/lib/customer-portal/keysetPagination'
import { resolvePortalCustomer } from '@/lib/customer-portal/customerResolver'
import { isSupportEvent, parseCustomerEventPayload, recordWebsiteCustomerEvent } from '@/lib/customer-portal/customerEvents'
import { createSupportCaseFromCustomerEvent } from '@/lib/customer-cases/support'
import { buildPublicWebhookPayload, WEBHOOK_EVENT_REGISTRY } from '@/lib/integrations/webhooks'
import { loadExternalTenantReference } from '@/lib/integrations/tenantContext'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
} from '@/lib/integrations/apiAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_QUERY_PARAMETERS = new Set(['event_type', 'external_customer_id', 'before', 'cursor', 'limit'])
const CURSOR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
const PUBLIC_EVENT_TYPES = Object.keys(WEBHOOK_EVENT_REGISTRY)

function singleQueryValue(request: NextRequest, name: string): string | null {
  const values = request.nextUrl.searchParams.getAll(name)
  if (values.length > 1) throw new ApiInputError(`${name} may only be specified once.`, 'duplicate_query_parameter', 400, name)
  const value = values[0]?.trim() ?? ''
  return value || null
}
function parseLimit(value: string | null): number {
  if (!value) return 100
  if (!/^\d+$/.test(value)) throw new ApiInputError('limit must be an integer between 1 and 100.', 'invalid_limit', 400, 'limit')
  const parsed = Number.parseInt(value, 10)
  if (parsed < 1 || parsed > 100) throw new ApiInputError('limit must be an integer between 1 and 100.', 'invalid_limit', 400, 'limit')
  return parsed
}
function validateQuery(request: NextRequest) {
  for (const key of request.nextUrl.searchParams.keys()) {
    if (!ALLOWED_QUERY_PARAMETERS.has(key)) throw new ApiInputError(`Unknown query parameter: ${key}.`, 'unknown_query_parameter', 400, key)
  }
  const eventType = singleQueryValue(request, 'event_type')
  if (eventType && !/^customer\.[a-z0-9_]+$/.test(eventType)) throw new ApiInputError('event_type has an invalid format.', 'invalid_event_type', 422, 'event_type')
  const before = singleQueryValue(request, 'before')
  if (before && !Number.isFinite(new Date(before).getTime())) throw new ApiInputError('before must be a valid ISO timestamp.', 'invalid_cursor', 400, 'before')
  const cursor = singleQueryValue(request, 'cursor')
  if (request.nextUrl.searchParams.has('cursor') && (!cursor || cursor.length > 2048 || request.nextUrl.searchParams.has('before'))) {
    throw new ApiInputError('cursor must be used without before and contain a valid continuation.', 'invalid_cursor', 400, 'cursor')
  }
  return { eventType, externalCustomerId: singleQueryValue(request, 'external_customer_id'), before, cursor, limit: parseLimit(singleQueryValue(request, 'limit')) }
}

function decodeEventCursor(scope: Parameters<typeof decodePortalCursor>[0], cursor: string | null) {
  try {
    const position = decodePortalCursor({ ...scope, cursor })
    if (position && !CURSOR_TIMESTAMP.test(position.orderValue)) throw new PortalCursorError()
    return position
  } catch (error) {
    if (error instanceof PortalCursorError) throw new ApiInputError(error.message, error.code, error.status, error.field)
    throw error
  }
}

function nextEventsLink(query: ReturnType<typeof validateQuery>, continuation: string) {
  const params = new URLSearchParams({ cursor: continuation, limit: String(query.limit) })
  if (query.eventType) params.set('event_type', query.eventType)
  if (query.externalCustomerId) params.set('external_customer_id', query.externalCustomerId)
  return `</api/v1/events?${params}>; rel="next"`
}

export const GET = withApiContractRepresentation(['website', 'customer'], getEvents)

async function getEvents(request: NextRequest) {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const auth = await requireIntegrationApiAccess(request, ['events.read'])
  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson(canonicalApiError({ code: auth.errorCode, message: auth.error, requestId }), { status: auth.status })
  }
  try {
    const query = validateQuery(request)
    let customerId: string | null = null
    if (query.externalCustomerId) {
      const resolution = await resolvePortalCustomer({ client: auth.client, identifiers: { externalCustomerId: query.externalCustomerId } })
      if (!resolution.ok) throw new ApiInputError(resolution.error, resolution.code, resolution.status, 'external_customer_id')
      customerId = resolution.customer.customer_id
    }
    const cursorScope = {
      companyId: auth.context.companyId,
      customerId: customerId ?? 'company',
      resource: JSON.stringify(['public-domain-events', auth.client.id, query.eventType]),
    }
    const cursorPosition = decodeEventCursor(cursorScope, query.cursor)
    const [events, tenantReference] = await Promise.all([
      listDomainEventsForCompany({
        companyId: auth.context.companyId,
        eventType: query.eventType,
        allowedEventTypes: PUBLIC_EVENT_TYPES,
        customerId,
        cursorOccurredBefore: query.before,
        cursorPosition: cursorPosition ? { occurredAt: cursorPosition.orderValue, id: cursorPosition.id } : null,
        limit: query.limit,
        includeLookahead: true,
      }),
      loadExternalTenantReference(auth.context.companyId),
    ])
    const page = events.slice(0, query.limit)
    const last = page.at(-1)
    const data = page.map((event) => buildPublicWebhookPayload(event, tenantReference, 'events'))
    const headers = new Headers()
    if (last && events.length > query.limit) {
      const continuation = encodePortalCursor({ ...cursorScope, tuple: { orderValue: last.occurred_at, id: last.id } })
      headers.set('Link', nextEventsLink(query, continuation))
    }
    const response = customerPortalJson({ data, next_before: last?.occurred_at ?? null, request_id: requestId, correlation_id: requestId }, { headers })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 200, startedAt, metadata: { result_count: data.length, request_id: requestId } })
    return response
  } catch (error) {
    const controlled = error instanceof ApiInputError
    const status = controlled ? error.status : 500
    const code = controlled ? error.code : 'events_read_failed'
    const message = controlled ? error.message : 'Events are temporarily unavailable.'
    console.error('[events-read] failed', { requestId, error })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: status, startedAt, errorCode: code, metadata: { request_id: requestId } })
    return customerPortalJson(canonicalApiError({ code, message, requestId, field: controlled ? error.field : null }), { status })
  }
}

export const POST = withApiContractRepresentation(['website', 'customer'], publishEvent)

async function publishEvent(request: NextRequest) {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const auth = await requireIntegrationApiAccess(request, ['website_events.write'])
  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson(canonicalApiError({ code: auth.errorCode, message: auth.error, requestId }), { status: auth.status })
  }
  try {
    const body = await readJsonObject(request)
    const parsed = parseCustomerEventPayload(body)
    if (!parsed.success) throw new ApiInputError(parsed.error.issues[0]?.message ?? 'Invalid customer event.', 'validation_error', 422, parsed.error.issues[0]?.path.join('.') || null)

    const data = await recordWebsiteCustomerEvent({ request, client: auth.client, payload: parsed.data, operation: '/api/v1/events', source: 'website' })
    const { _internal_customer_id: internalCustomerId, ...responseData } = data
    let supportCaseReused: boolean | null = null
    if (isSupportEvent(parsed.data.event_type)) {
      const idempotencyKey = request.headers.get('idempotency-key')?.trim()
      if (!idempotencyKey) throw new ApiInputError('Idempotency-Key is required.', 'idempotency_key_required', 400, 'Idempotency-Key')
      const supportCase = await createSupportCaseFromCustomerEvent({
        companyId: auth.context.companyId,
        customerId: internalCustomerId,
        eventType: parsed.data.event_type,
        eventReference: parsed.data.event_reference,
        data: parsed.data.data,
        idempotencyKey,
        channel: 'api',
        apiClientId: auth.client.id,
      })
      supportCaseReused = supportCase.reused
    }

    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 200, startedAt, metadata: { event_reference: data.event_reference, event_type: data.event_type, customer_id: internalCustomerId, idempotency_replay: data.replayed, support_case_reused: supportCaseReused } })
    return customerPortalJson({ data: responseData, request_id: requestId, correlation_id: requestId })
  } catch (error) {
    const writeError = customerPortalWriteError(error)
    const controlled = writeError instanceof ApiInputError
    const status = controlled ? writeError.status : 500
    const code = controlled ? writeError.code : 'customer_event_failed'
    const message = controlled ? writeError.message : 'The customer event could not be processed at this time.'
    console.error('[events-write] failed', { requestId, error })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: status, startedAt, errorCode: code, metadata: { request_id: requestId } })
    return customerPortalJson(canonicalApiError({ code, message, requestId, field: controlled ? writeError.field : null }), { status })
  }
}
