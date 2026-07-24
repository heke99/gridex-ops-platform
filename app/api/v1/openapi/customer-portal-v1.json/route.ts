import { NextRequest } from 'next/server'
import customerPortalOpenApi from '@/docs/openapi/customer-portal-v1.json'
import { openApiDocumentResponse } from '@/lib/integrations/openApiResponse'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return openApiDocumentResponse(request, customerPortalOpenApi, 'gridex-customer-portal-v1.json')
}
