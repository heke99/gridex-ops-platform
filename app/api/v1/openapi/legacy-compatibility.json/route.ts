import type { NextRequest } from 'next/server'
import { LEGACY_COMPATIBILITY } from '@/lib/integrations/legacyCompatibilityStatus'
import { buildOpenApiReleaseManifest } from '@/lib/integrations/openApiReleaseManifest'
import { openApiDocumentResponse } from '@/lib/integrations/openApiResponse'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const manifest = buildOpenApiReleaseManifest()
  return openApiDocumentResponse(
    request,
    {
      build_commit: manifest.build_commit,
      release_version: manifest.release_version,
      runtime_contract_version: manifest.runtime_contract_version,
      legacy_compatibility: Object.values(LEGACY_COMPATIBILITY),
    },
    'gridex-openapi-legacy-compatibility.json',
    { cacheControl: 'no-store, max-age=0, must-revalidate' },
  )
}
