import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Public website area resolution belongs to each tenant. OPS still performs
 * operational verification internally during onboarding and supplier switch.
 */
export async function POST(_request: NextRequest) {
  const requestId = randomUUID()
  return customerPortalJson(
    {
      error: {
        code: 'tenant_managed_energy_area_required',
        message:
          'Tenantens publika webbplats ska lösa prisområdet själv. Skicka det lösta price_area_code till kundansökan; OPS verifierar att området är giltigt och tillåtet för avtalet.',
        replacement: '/api/v1/website/customer-applications',
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
