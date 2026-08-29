import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { readJsonObject } from '@/lib/api/strictRequest'
import { canonicalApiError } from '@/lib/api/apiError'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
} from '@/lib/integrations/apiAuth'
import { isSupportEvent, parseCustomerEventPayload, recordWebsiteCustomerEvent } from '@/lib/customer-portal/customerEvents'
import { createSupportCaseFromCustomerEvent } from '@/lib/customer-cases/support'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
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
    if (!parsed.success) {
      return customerPortalJson(canonicalApiError({
        code: 'validation_error',
        message: 'Ogiltigt kundevent.',
        requestId,
        details: parsed.error.issues,
      }), { status: 422 })
    }

    const data = await recordWebsiteCustomerEvent({
      request,
      client: auth.client,
      payload: parsed.data,
      operation: '/api/v1/website/customer-events',
      source: 'website',
    })
    const { _internal_customer_id: internalCustomerId, ...responseData } = data
    let supportCaseReused: boolean | null = null
    if (isSupportEvent(parsed.data.event_type)) {
      const idempotencyKey = request.headers.get('idempotency-key')?.trim()
      if (!idempotencyKey) {
        return customerPortalJson(canonicalApiError({ code: 'idempotency_key_required', message: 'Idempotency-Key krävs för supportevent.', requestId }), { status: 400 })
      }
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
        support_case_reused: supportCaseReused,
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
    console.error('[website-customer-events] failed', { requestId, error })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: status, startedAt, errorCode: code, metadata: { request_id: requestId } })
    return customerPortalJson(canonicalApiError({ code, message, requestId }), { status })
  }
}
