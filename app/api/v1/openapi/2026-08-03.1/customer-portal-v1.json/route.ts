import { NextRequest } from 'next/server'
import customerPortalOpenApi from '@/docs/openapi/customer-portal-v1.json'
import { openApiDocumentResponse } from '@/lib/integrations/openApiResponse'

export const runtime = 'nodejs'
export const dynamic = 'force-static'

export async function GET(request: NextRequest) {
  return openApiDocumentResponse(
    request,
    customerPortalOpenApi,
    'gridex-customer-portal-v1-2026-08-03.1.json',
    { cacheControl: 'public, max-age=31536000, immutable' },
  )
}
