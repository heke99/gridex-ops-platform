import { NextRequest } from 'next/server'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import { readPortalDocumentsPage } from '@/lib/customer-portal/documentReadModel'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_documents.read'])
  if (!context.ok) return context.response

  try {
    const page = await readPortalDocumentsPage({
      companyId: context.client.company_id,
      customerId: context.identity.customer_id,
      searchParams: request.nextUrl.searchParams,
    })
    await logCustomerPortalSuccess({
      request,
      client: context.client,
      startedAt: context.startedAt,
      resultCount: page.items.length,
    })
    return customerPortalJson({ data: page.items, page: page.page })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
