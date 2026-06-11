import { NextRequest, NextResponse } from 'next/server'
import { listDomainEventsForCompany } from '@/lib/events/domainEvents'
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
