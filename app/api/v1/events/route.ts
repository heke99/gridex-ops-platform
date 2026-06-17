import { NextRequest, NextResponse } from 'next/server'
import { listDomainEventsForCompany } from '@/lib/events/domainEvents'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { isSupportEvent, parseCustomerEventPayload, recordWebsiteCustomerEvent } from '@/lib/customer-portal/customerEvents'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
} from '@/lib/integrations/apiAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? '100', 10)
  if (!Number.isFinite(parsed)) return 100
  return Math.min(Math.max(parsed, 1), 100)
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const auth = await requireIntegrationApiAccess(request, ['events.read'])

  if (!auth.ok) {
    await logIntegrationApiRequest({
      client: auth.client ?? null,
      request,
      statusCode: auth.status,
      startedAt,
      errorCode: auth.errorCode,
    })
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const events = await listDomainEventsForCompany({
      companyId: auth.client.company_id,
      eventType: request.nextUrl.searchParams.get('type'),
      customerId: request.nextUrl.searchParams.get('customer_id'),
      cursorOccurredBefore: request.nextUrl.searchParams.get('before'),
      limit: parseLimit(request.nextUrl.searchParams.get('limit')),
    })

    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 200,
      startedAt,
      metadata: { result_count: events.length },
    })

    return NextResponse.json({
      data: events.map((event) => ({
        id: event.id,
        type: event.event_type,
        occurred_at: event.occurred_at,
        aggregate: {
          type: event.aggregate_type,
          id: event.aggregate_id,
        },
        customer_id: event.subject_customer_id,
        payload: event.payload,
      })),
      next_before: events.at(-1)?.occurred_at ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Kunde inte läsa events.'
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 500,
      startedAt,
      errorCode: message,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}


export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  const auth = await requireIntegrationApiAccess(request, ['website_events.write'])

  if (!auth.ok) {
    await logIntegrationApiRequest({
      client: auth.client ?? null,
      request,
      statusCode: auth.status,
      startedAt,
      errorCode: auth.errorCode,
    })
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
    const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : 500
    const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : 'customer_event_failed'
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: status, startedAt, errorCode: message })
    return customerPortalJson({ error: message, code }, { status })
  }
}
