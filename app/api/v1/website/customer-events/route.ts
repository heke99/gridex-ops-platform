import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { readJsonObject } from '@/lib/api/strictRequest'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
} from '@/lib/integrations/apiAuth'
import { isSupportEvent, parseCustomerEventPayload, recordWebsiteCustomerEvent } from '@/lib/customer-portal/customerEvents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  const auth = await requireIntegrationApiAccess(request, ['website_events.write'])

  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson({ error: auth.error, code: auth.errorCode }, { status: auth.status })
  }

  try {
    const body = await readJsonObject(request)
    const parsed = parseCustomerEventPayload(body)
    if (!parsed.success) {
      await logIntegrationApiRequest({ client: auth.client, request, statusCode: 422, startedAt, errorCode: 'validation_error' })
      return customerPortalJson({ error: 'Ogiltigt kundevent.', code: 'validation_error', details: parsed.error.issues }, { status: 422 })
    }

    if (isSupportEvent(parsed.data.event_type)) {
      await logIntegrationApiRequest({ client: auth.client, request, statusCode: 422, startedAt, errorCode: 'support_out_of_scope' })
      return customerPortalJson({
        error: 'Supporthantering ligger utanför Gridex Ops API.',
        code: 'support_out_of_scope',
        hint: 'Elbolaget hanterar support i sina egna kanaler. Skicka inte support- eller case-events till Ops.',
      }, { status: 422 })
    }

    const data = await recordWebsiteCustomerEvent({ request, client: auth.client, payload: parsed.data, source: 'website' })
    const { _internal_customer_id: internalCustomerId, ...responseData } = data
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 200,
      startedAt,
      metadata: { event_id: data.event_id, customer_event_id: data.customer_event_id, event_type: data.event_type, customer_id: internalCustomerId },
    })

    return customerPortalJson({ data: responseData })
  } catch (error) {
    const controlled = typeof (error as { status?: unknown })?.status === 'number' && typeof (error as { code?: unknown })?.code === 'string'
    const status = controlled ? (error as { status: number }).status : 500
    const code = controlled ? (error as { code: string }).code : 'customer_event_failed'
    const traceId = randomUUID()
    console.error('[website-customer-events] failed', { traceId, error })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: status, startedAt, errorCode: code, metadata: { trace_id: traceId } })
    return customerPortalJson({ error: controlled ? 'Kundeventet kunde inte behandlas.' : 'Kundeventet kunde inte behandlas just nu.', code, trace_id: traceId }, { status })
  }
}
