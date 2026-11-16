import { NextRequest } from 'next/server'
import staffOpenApi from '@/docs/openapi/releases/2026-10-09.1/staff-v1.json'
import { openApiDocumentResponse } from '@/lib/integrations/openApiResponse'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return openApiDocumentResponse(
    request,
    staffOpenApi,
    'gridex-staff-v1-2026-10-09.1.json',
    { cacheControl: 'public, max-age=31536000, immutable' },
  )
}
