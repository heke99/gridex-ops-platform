import { NextRequest, NextResponse } from 'next/server'
import { logIntegrationApiRequest, requireIntegrationApiAccess } from '@/lib/integrations/apiAuth'
import { syncExternalCustomerPortalIdentity } from '@/lib/customer-portal/externalSync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  const auth = await requireIntegrationApiAccess(request, ['customer_portal.write'])

  if (!auth.ok) {
    await logIntegrationApiRequest({ request, statusCode: auth.status, startedAt, errorCode: auth.error })
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await request.json()
    const result = await syncExternalCustomerPortalIdentity({
      client: auth.client,
      body,
      requestId: request.headers.get('x-request-id'),
      idempotencyKey: request.headers.get('idempotency-key'),
    })

    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 200,
      startedAt,
      metadata: { status: result.status, customer_id: result.customerId, match_method: result.matchMethod },
    })

    return NextResponse.json({ data: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Kundsynk kunde inte hanteras.'
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 500, startedAt, errorCode: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
