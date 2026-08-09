import { NextRequest } from 'next/server'
import { executeIdempotentPortalWrite, readJsonObject } from '@/lib/api/strictRequest'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  portalIdentifiersFromPayload,
  requireCustomerPortalApiContextForIdentifiers,
} from '@/lib/customer-portal/externalApi'
import { syncTenantCustomerRecords, type TenantCustomerSyncPayload } from '@/lib/customer-portal/tenantSync'
import { parseTenantCustomerSyncPayload } from '@/lib/customer-portal/customerSyncContract'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  let client: IntegrationApiClient | null = null

  try {
    const body = parseTenantCustomerSyncPayload(
      await readJsonObject(request),
    ) as TenantCustomerSyncPayload
    const context = await requireCustomerPortalApiContextForIdentifiers(request, portalIdentifiersFromPayload(body), ['customer_sync.write'])
    if (!context.ok) return context.response
    client = context.client

    const write = await executeIdempotentPortalWrite<Record<string, unknown>>({
      request,
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: context.identity.customer_id,
      operation: '/api/v1/customer/sync',
      payload: body,
      execute: async () => {
        const result = await syncTenantCustomerRecords({ client: context.client, identity: context.identity, payload: body })
        return {
          statusCode: 200,
          body: {
            data: {
              status: 'synced',
              customer_reference:
                context.identity.external_customer_id ??
                context.identity.customer_number,
              customer_number: context.identity.customer_number,
              external_customer_id: context.identity.external_customer_id,
              summary: result.summary,
            },
          },
        }
      },
    })
    await logCustomerPortalSuccess({
      request,
      client: context.client,
      startedAt: context.startedAt,
      resultCount: 1,
      metadata: { action: 'tenant_customer_sync', idempotency_replay: write.replayed },
    })
    return customerPortalJson(write.body, { status: write.statusCode })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client, startedAt, error })
  }
}
