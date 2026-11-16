import type { NextRequest } from 'next/server'
import document from '@/docs/openapi/staff-onboarding-v1.json'
import { openApiDocumentResponse } from '@/lib/integrations/openApiResponse'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<Response> {
  return openApiDocumentResponse(request, document, 'gridex-staff-onboarding-v1.json', { cacheControl: 'public, max-age=300' })
}
