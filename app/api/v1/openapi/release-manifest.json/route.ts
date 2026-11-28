//api/v1/openapi/release-manifest.json/route
import { NextRequest } from 'next/server'
import { LEGACY_COMPATIBILITY_PATH } from '@/lib/integrations/legacyCompatibilityStatus'
import { buildOpenApiReleaseManifest } from '@/lib/integrations/openApiReleaseManifest'
import { openApiDocumentResponse } from '@/lib/integrations/openApiResponse'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const response = openApiDocumentResponse(
    request,
    buildOpenApiReleaseManifest(),
    'gridex-openapi-release-manifest.json',
    { cacheControl: 'no-store, max-age=0, must-revalidate' },
  )
  response.headers.append('Link', `<${LEGACY_COMPATIBILITY_PATH}>; rel="related"; type="application/json"`)
  response.headers.append('Access-Control-Expose-Headers', 'Link')
  return response
}
