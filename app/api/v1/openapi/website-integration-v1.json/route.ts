import { NextRequest } from 'next/server'
import websiteIntegrationOpenApi from '@/docs/openapi/website-integration-v1.json'
import { openApiDocumentResponse } from '@/lib/integrations/openApiResponse'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return openApiDocumentResponse(request, websiteIntegrationOpenApi, 'gridex-website-integration-v1.json')
}
