import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Legacy quote validation was removed together with external OPS quotes. */
export async function POST(_request: NextRequest) {
  const requestId = randomUUID()
  return customerPortalJson(
    {
      error: {
        code: 'quote_validation_removed',
        message:
          'quote_reference används inte längre i nya kundansökningar. Skicka offer_reference, kundtyp, tenantens lösta prisområde och juridiska godkännanden.',
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
