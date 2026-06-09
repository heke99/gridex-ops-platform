import { NextRequest, NextResponse } from 'next/server'
import { logIntegrationApiRequest, requireIntegrationApiAccess } from '@/lib/integrations/apiAuth'
import { externalCustomerIdFromRequest, getPortalInvoice, resolvePortalCustomerContext } from '@/lib/customer-portal/apiData'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, props: Params) {
  const startedAt = Date.now()
  const auth = await requireIntegrationApiAccess(request, ['customer_portal.read'])
  if (!auth.ok) {
    await logIntegrationApiRequest({ request, statusCode: auth.status, startedAt, errorCode: auth.error })
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await props.params
    const context = await resolvePortalCustomerContext({ client: auth.client, externalCustomerId: externalCustomerIdFromRequest(request) })
    const data = await getPortalInvoice(context, id, request.nextUrl.pathname)
    if (!data) return NextResponse.json({ error: 'Fakturan hittades inte för länkat kundkonto.' }, { status: 404 })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 200, startedAt, metadata: { customer_id: context.customerId, invoice_id: id } })
    return NextResponse.json({ data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fakturan kunde inte hämtas.'
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: message.includes('länkat') ? 403 : 500, startedAt, errorCode: message })
    return NextResponse.json({ error: message }, { status: message.includes('länkat') ? 403 : 500 })
  }
}
