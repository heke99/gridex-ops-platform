import { NextRequest } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
} from '@/lib/integrations/apiAuth'
import { listPublicContractOffers, publicContractResponse } from '@/lib/website/publicContracts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const auth = await requireIntegrationApiAccess(request, ['website_contracts.read'])

  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson({ error: auth.error }, { status: auth.status })
  }

  try {
    const customerType = request.nextUrl.searchParams.get('customer_type')
    const offers = await listPublicContractOffers({ client: auth.client, customerType })
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 200,
      startedAt,
      metadata: { result_count: offers.length, customer_type: customerType },
    })

    return customerPortalJson({
      data: offers.map(publicContractResponse),
      tenant: {
        company_id: auth.client.company_id,
        api_client_id: auth.client.id,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Publicerade avtal kunde inte hämtas.'
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 500, startedAt, errorCode: message })
    return customerPortalJson({ error: message }, { status: 500 })
  }
}
