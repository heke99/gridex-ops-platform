import { NextRequest } from 'next/server'
import { buildOpenApiReleaseManifest } from '@/lib/integrations/openApiReleaseManifest'
import { openApiDocumentResponse } from '@/lib/integrations/openApiResponse'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return openApiDocumentResponse(
    request,
    buildOpenApiReleaseManifest(),
    'gridex-openapi-release-manifest.json',
  )
}
