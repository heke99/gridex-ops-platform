import { NextRequest } from 'next/server'
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
    const body = await request.json().catch(() => ({}))
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
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 200,
      startedAt,
      metadata: { event_id: data.event_id, customer_event_id: data.customer_event_id, event_type: data.event_type, customer_id: data.customer_id },
    })

    return customerPortalJson({ data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Kundevent kunde inte behandlas.'
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 500, startedAt, errorCode: message })
    return customerPortalJson({ error: message, code: 'customer_event_failed' }, { status: 500 })
  }
}
