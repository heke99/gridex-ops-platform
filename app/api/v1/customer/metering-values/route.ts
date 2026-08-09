import { NextRequest } from 'next/server'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  normalizeFacility,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import { readPortalMeteringValuesPage } from '@/lib/customer-portal/publicReadModel'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function optionalParam(request: NextRequest, key: string): string | null {
  const value = request.nextUrl.searchParams.get(key)?.trim()
  return value || null
}

export async function GET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_metering.read'])
  if (!context.ok) return context.response

  try {
    const from = optionalParam(request, 'from')
    const to = optionalParam(request, 'to')
    const facilityId = optionalParam(request, 'facility_id')
    const normalizedFacilityId = facilityId ? normalizeFacility(facilityId) : null

    const page = await readPortalMeteringValuesPage(
      {
        companyId: context.client.company_id,
        customerId: context.identity.customer_id,
        externalCustomerId: context.identity.external_customer_id,
        customerNumber: context.identity.customer_number,
      },
      request.nextUrl.searchParams,
      {
        from,
        to,
        facilityId: normalizedFacilityId,
      },
    )

    await logCustomerPortalSuccess({
      request,
      client: context.client,
      startedAt: context.startedAt,
      resultCount: page.items.length,
      metadata: {
        source_table: 'normalized_metering_values',
        from,
        to,
        facility_id: normalizedFacilityId,
      },
    })

    return customerPortalJson({ data: page.items, page: page.page })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
