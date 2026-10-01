import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { ApiInputError, readJsonObject } from '@/lib/api/strictRequest'
import { canonicalApiError } from '@/lib/api/apiError'
import { customerPortalJson, logPortalRequestTelemetry } from '@/lib/customer-portal/externalApi'
import {
  requireIntegrationApiAccess,
} from '@/lib/integrations/apiAuth'
import { isSupportEvent, parseCustomerEventPayload, recordWebsiteCustomerEvent } from '@/lib/customer-portal/customerEvents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const auth = await requireIntegrationApiAccess(request, ['website_events.write'])

  if (!auth.ok) {
    await logPortalRequestTelemetry({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson(canonicalApiError({ code: auth.errorCode, message: auth.error, requestId }), { status: auth.status })
  }

  try {
    const body = await readJsonObject(request)
    const parsed = parseCustomerEventPayload(body)
    if (!parsed.success) {
      return customerPortalJson(canonicalApiError({
        code: 'validation_error',
        message: 'Ogiltigt kundevent.',
        requestId,
        details: parsed.error.issues,
      }), { status: 422 })
    }

    if (isSupportEvent(parsed.data.event_type)) {
      throw new ApiInputError(
        'Supportärenden kräver delegerat kundmandat och den gemensamma ärendevägen /api/v1/customer/cases.',
        'support_event_delegation_required', 403,
      )
    }

    const data = await recordWebsiteCustomerEvent({
      request,
      client: auth.client,
      payload: parsed.data,
      operation: '/api/v1/website/customer-events',
      source: 'website',
    })
    const responseData = {
      event_reference: data.event_reference,
      event_resource_reference: data.event_resource_reference,
      event_type: data.event_type,
      customer_reference: data.customer_reference,
      status: data.status,
      occurred_at: data.occurred_at,
      replayed: data.replayed,
    }
    await logPortalRequestTelemetry({
      client: auth.client,
      request,
      statusCode: 200,
      startedAt,
      metadata: {
        event_type: data.event_type,
        idempotency_replay: data.replayed,
      },
    })
    return customerPortalJson({ data: responseData, request_id: requestId, correlation_id: requestId })
  } catch (error) {
    const controlled = typeof (error as { status?: unknown })?.status === 'number' && typeof (error as { code?: unknown })?.code === 'string'
    const status = controlled ? (error as { status: number }).status : 500
    const code = controlled ? (error as { code: string }).code : 'customer_event_failed'
    const message = controlled
      ? String((error as { message?: unknown }).message ?? 'Kundeventet kunde inte behandlas.')
      : 'Kundeventet kunde inte behandlas just nu.'
    console.error('[website-customer-events] failed', { requestId, code: controlled ? code : 'customer_event_failed' })
    await logPortalRequestTelemetry({ client: auth.client, request, statusCode: status, startedAt, errorCode: code, metadata: { request_id: requestId } })
    return customerPortalJson(canonicalApiError({ code, message, requestId }), { status })
  }
}
