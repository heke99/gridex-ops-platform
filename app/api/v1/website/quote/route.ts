import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Removed from the external tenant contract in API 2026-07-22.2.
 * OPS keeps its internal pricing engine for settlement and billing, but tenant
 * websites must resolve market prices and calculate non-binding previews.
 */
export async function POST(_request: NextRequest) {
  const requestId = randomUUID()
  return customerPortalJson(
    {
      error: {
        code: 'tenant_managed_pricing_required',
        message:
          'OPS beräknar inte längre tenantens publika Nord Pool- eller spotpris. Hämta hela avtalsunderlaget via public-contracts och gör den indikativa kalkylen i tenantens egen backend.',
        replacement: '/api/v1/website/public-contracts',
        request_id: requestId,
      },
    },
    {
      status: 410,
      headers: {
        'Cache-Control': 'no-store',
        Deprecation: 'true',
        Sunset: 'Wed, 22 Jul 2026 23:59:59 GMT',
      },
    },
  )
}
