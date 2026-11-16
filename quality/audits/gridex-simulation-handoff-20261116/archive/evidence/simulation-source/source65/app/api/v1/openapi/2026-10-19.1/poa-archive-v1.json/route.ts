import type { NextRequest } from 'next/server'
import document from '@/docs/openapi/releases/2026-10-19.1/poa-archive-v1.json'
import { openApiDocumentResponse } from '@/lib/integrations/openApiResponse'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<Response> {
  return openApiDocumentResponse(request, document, 'gridex-poa-archive-v1-2026-10-19.1.json', {
    cacheControl: 'public, max-age=31536000, immutable',
  })
}
