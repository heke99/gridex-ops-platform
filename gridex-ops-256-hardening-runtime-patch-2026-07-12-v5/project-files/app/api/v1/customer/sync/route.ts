import { NextRequest } from 'next/server'
import { readJsonObject } from '@/lib/api/strictRequest'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  portalIdentifiersFromPayload,
  requireCustomerPortalApiContextForIdentifiers,
} from '@/lib/customer-portal/externalApi'
import { syncTenantCustomerRecords, type TenantCustomerSyncPayload } from '@/lib/customer-portal/tenantSync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const body = await readJsonObject(request) as TenantCustomerSyncPayload
  const context = await requireCustomerPortalApiContextForIdentifiers(request, portalIdentifiersFromPayload(body), ['customer_sync.write'])
  if (!context.ok) return context.response

  try {
    const result = await syncTenantCustomerRecords({ client: context.client, identity: context.identity, payload: body })
    await logCustomerPortalSuccess({
      request,
      client: context.client,
      startedAt: context.startedAt,
      resultCount: 1,
      metadata: {
        action: 'tenant_customer_sync',
        customer_id: result.customer_id,
        customer_number: result.customer_number,
        external_customer_id: result.external_customer_id,
        summary: result.summary,
      },
    })
    return customerPortalJson({ data: { status: 'synced', ...result } })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
