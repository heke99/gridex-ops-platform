import { NextRequest, NextResponse } from 'next/server'
import { logIntegrationApiRequest, requireIntegrationApiAccess } from '@/lib/integrations/apiAuth'
import { externalCustomerIdFromRequest, resolvePortalCustomerContext, listPortalDocuments } from '@/lib/customer-portal/apiData'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const auth = await requireIntegrationApiAccess(request, ['customer_portal.read'])
  if (!auth.ok) {
    await logIntegrationApiRequest({ request, statusCode: auth.status, startedAt, errorCode: auth.error })
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const context = await resolvePortalCustomerContext({ client: auth.client, externalCustomerId: externalCustomerIdFromRequest(request) })
    const data = await listPortalDocuments(context, request.nextUrl.pathname)
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 200, startedAt, metadata: { customer_id: context.customerId } })
    return NextResponse.json({ data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Mina sidor-data kunde inte hämtas.'
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: message.includes('länkat') ? 403 : 500, startedAt, errorCode: message })
    return NextResponse.json({ error: message }, { status: message.includes('länkat') ? 403 : 500 })
  }
}
