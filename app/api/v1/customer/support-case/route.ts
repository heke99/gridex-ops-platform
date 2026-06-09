import { NextRequest, NextResponse } from 'next/server'
import { logIntegrationApiRequest, requireIntegrationApiAccess } from '@/lib/integrations/apiAuth'
import { createPortalRequest, externalCustomerIdFromRequest, resolvePortalCustomerContext } from '@/lib/customer-portal/apiData'

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
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const context = await resolvePortalCustomerContext({ client: auth.client, externalCustomerId: externalCustomerIdFromRequest(request) ?? (typeof body.externalCustomerId === 'string' ? body.externalCustomerId : null) })
    const data = await createPortalRequest(context, { type: 'support_case', payload: body, route: request.nextUrl.pathname })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 200, startedAt, metadata: { customer_id: context.customerId, request_type: 'support_case' } })
    return NextResponse.json({ data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Mina sidor-ärendet kunde inte skapas.'
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: message.includes('länkat') ? 403 : 500, startedAt, errorCode: message })
    return NextResponse.json({ error: message }, { status: message.includes('länkat') ? 403 : 500 })
  }
}
