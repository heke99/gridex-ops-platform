import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { ApiInputError, readJsonObject } from '@/lib/api/strictRequest'
import { canonicalApiError } from '@/lib/api/apiError'
import { listDomainEventsForCompany } from '@/lib/events/domainEvents'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { resolvePortalCustomer } from '@/lib/customer-portal/customerResolver'
import { isSupportEvent, parseCustomerEventPayload, recordWebsiteCustomerEvent } from '@/lib/customer-portal/customerEvents'
import { buildPublicWebhookPayload } from '@/lib/integrations/webhooks'
import { loadExternalTenantReference } from '@/lib/integrations/tenantContext'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
} from '@/lib/integrations/apiAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_QUERY_PARAMETERS = new Set([
  'event_type',
  'external_customer_id',
  'before',
  'limit',
])

function singleQueryValue(request: NextRequest, name: string): string | null {
  const values = request.nextUrl.searchParams.getAll(name)
  if (values.length > 1) {
    throw new ApiInputError(`${name} may only be specified once.`, 'duplicate_query_parameter', 400, name)
  }
  const value = values[0]?.trim() ?? ''
  return value || null
}

function parseLimit(value: string | null): number {
  if (!value) return 100
  if (!/^\d+$/.test(value)) {
    throw new ApiInputError('limit must be an integer between 1 and 100.', 'invalid_limit', 400, 'limit')
  }
  const parsed = Number.parseInt(value, 10)
  if (parsed < 1 || parsed > 100) {
    throw new ApiInputError('limit must be an integer between 1 and 100.', 'invalid_limit', 400, 'limit')
  }
  return parsed
}

function validateQuery(request: NextRequest) {
  for (const key of request.nextUrl.searchParams.keys()) {
    if (!ALLOWED_QUERY_PARAMETERS.has(key)) {
      throw new ApiInputError(`Unknown query parameter: ${key}.`, 'unknown_query_parameter', 400, key)
    }
  }
  const eventType = singleQueryValue(request, 'event_type')
  if (eventType && !/^customer\.[a-z0-9_]+$/.test(eventType)) {
    throw new ApiInputError('event_type has an invalid format.', 'invalid_event_type', 422, 'event_type')
  }
  const before = singleQueryValue(request, 'before')
  if (before && !Number.isFinite(new Date(before).getTime())) {
    throw new ApiInputError('before must be a valid ISO timestamp.', 'invalid_cursor', 400, 'before')
  }
  return {
    eventType,
    externalCustomerId: singleQueryValue(request, 'external_customer_id'),
    before,
    limit: parseLimit(singleQueryValue(request, 'limit')),
  }
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const auth = await requireIntegrationApiAccess(request, ['events.read'])

  if (!auth.ok) {
    await logIntegrationApiRequest({
      client: auth.client ?? null,
      request,
      statusCode: auth.status,
      startedAt,
      errorCode: auth.errorCode,
    })
    return customerPortalJson(canonicalApiError({ code: auth.errorCode, message: auth.error, requestId }), { status: auth.status })
  }

  try {
    const query = validateQuery(request)
    let customerId: string | null = null
    if (query.externalCustomerId) {
      const resolution = await resolvePortalCustomer({
        client: auth.client,
        identifiers: { externalCustomerId: query.externalCustomerId },
      })
      if (!resolution.ok) {
        throw new ApiInputError(resolution.error, resolution.code, resolution.status, 'external_customer_id')
      }
      customerId = resolution.customer.customer_id
    }

    const [events, tenantReference] = await Promise.all([
      listDomainEventsForCompany({
        companyId: auth.context.companyId,
        eventType: query.eventType,
        customerId,
        cursorOccurredBefore: query.before,
        limit: query.limit,
      }),
      loadExternalTenantReference(auth.context.companyId),
    ])

    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 200,
      startedAt,
      metadata: { result_count: events.length, request_id: requestId },
    })

    return customerPortalJson({
      data: events.map((event) => buildPublicWebhookPayload(event, tenantReference)),
      next_before: events.at(-1)?.occurred_at ?? null,
      request_id: requestId,
      correlation_id: requestId,
    })
  } catch (error) {
    const controlled = error instanceof ApiInputError
    const status = controlled ? error.status : 500
    const code = controlled ? error.code : 'events_read_failed'
    const message = controlled ? error.message : 'Events are temporarily unavailable.'
    console.error('[events-read] failed', { requestId, error })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: status, startedAt, errorCode: code, metadata: { request_id: requestId } })
    return customerPortalJson(canonicalApiError({
      code,
      message,
      requestId,
      field: controlled ? error.field : null,
    }), { status })
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const auth = await requireIntegrationApiAccess(request, ['website_events.write'])

  if (!auth.ok) {
    await logIntegrationApiRequest({
      client: auth.client ?? null,
      request,
      statusCode: auth.status,
      startedAt,
      errorCode: auth.errorCode,
    })
    return customerPortalJson(canonicalApiError({ code: auth.errorCode, message: auth.error, requestId }), { status: auth.status })
  }

  try {
    const body = await readJsonObject(request)
    const parsed = parseCustomerEventPayload(body)
    if (!parsed.success) {
      throw new ApiInputError(
        parsed.error.issues[0]?.message ?? 'Invalid customer event.',
        'validation_error',
        422,
        parsed.error.issues[0]?.path.join('.') || null,
      )
    }
    if (isSupportEvent(parsed.data.event_type)) {
      throw new ApiInputError(
        'Support-case management is outside the Gridex public API.',
        'support_out_of_scope',
        422,
        'event_type',
      )
    }

    const data = await recordWebsiteCustomerEvent({
      request,
      client: auth.client,
      payload: parsed.data,
      operation: '/api/v1/events',
      source: 'website',
    })
    const { _internal_customer_id: internalCustomerId, ...responseData } = data
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 200,
      startedAt,
      metadata: {
        event_reference: data.event_reference,
        event_type: data.event_type,
        customer_id: internalCustomerId,
        idempotency_replay: data.replayed,
      },
    })
    return customerPortalJson({ data: responseData, request_id: requestId, correlation_id: requestId })
  } catch (error) {
    const controlled = error instanceof ApiInputError
    const status = controlled ? error.status : 500
    const code = controlled ? error.code : 'customer_event_failed'
    const message = controlled ? error.message : 'The customer event could not be processed at this time.'
    console.error('[events-write] failed', { requestId, error })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: status, startedAt, errorCode: code, metadata: { request_id: requestId } })
    return customerPortalJson(canonicalApiError({
      code,
      message,
      requestId,
      field: controlled ? error.field : null,
    }), { status })
  }
}
