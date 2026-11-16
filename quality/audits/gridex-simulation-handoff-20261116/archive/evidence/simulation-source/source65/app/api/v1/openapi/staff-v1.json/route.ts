import { NextRequest } from 'next/server'
import staffOpenApi from '@/docs/openapi/staff-v1.json'
import { openApiDocumentResponse } from '@/lib/integrations/openApiResponse'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return openApiDocumentResponse(request, staffOpenApi, 'gridex-staff-v1.json')
}
