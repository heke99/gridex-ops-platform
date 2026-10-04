import { createHash, randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import staffOpenApi from '@/docs/openapi/staff-support-v1.json'
import { serializeOpenApiDocument } from '@/lib/integrations/openApiResponse'
import {
  MINIMUM_STAFF_INTEGRATION_VERSION,
  STAFF_API_CONTRACT_NAME,
  STAFF_API_CONTRACT_VERSION,
  STAFF_OPENAPI_ORIGIN,
  STAFF_OPENAPI_PATH,
  STAFF_OPENAPI_PREPARED_AT,
  STAFF_VERSIONED_OPENAPI_PATH,
} from './openApiContract'

/** Public protocol metadata. Actor grants are evaluated separately by /staff/me. */
export function buildStaffOpenApiReleaseManifest() {
  return {
    schema_version: 1,
    contract_name: STAFF_API_CONTRACT_NAME,
    contract_version: STAFF_API_CONTRACT_VERSION,
    minimum_staff_integration_version: MINIMUM_STAFF_INTEGRATION_VERSION,
    guide_version: STAFF_API_CONTRACT_VERSION,
    released_at: STAFF_OPENAPI_PREPARED_AT,
    build_commit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? 'unknown',
    capabilities: staffOpenApi['x-staff-protocol-capabilities'],
    specification: {
      url: `${STAFF_OPENAPI_ORIGIN}${STAFF_OPENAPI_PATH}`,
      immutable_url: `${STAFF_OPENAPI_ORIGIN}${STAFF_VERSIONED_OPENAPI_PATH}`,
      sha256: createHash('sha256').update(serializeOpenApiDocument(staffOpenApi)).digest('hex'),
    },
  } as const
}

/** Explicit staff version avoids the legacy manifest serializer's .4 fallback. */
export function staffReleaseManifestResponse(request: NextRequest): Response {
  const body = `${JSON.stringify(buildStaffOpenApiReleaseManifest(), null, 2)}\n`
  const etag = `"${createHash('sha256').update(body).digest('base64url')}"`
  const requestId = request.headers.get('x-request-id')
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0, must-revalidate',
    ETag: etag,
    Vary: 'If-None-Match',
    'X-Gridex-Contract-Version': STAFF_API_CONTRACT_VERSION,
    'X-Request-ID': requestId && /^[A-Za-z0-9._:-]{1,128}$/.test(requestId) ? requestId : randomUUID(),
  }
  if (request.headers.get('if-none-match')?.split(',').map(value => value.trim()).includes(etag)) return new Response(null, { status: 304, headers })
  return new Response(body, { status: 200, headers })
}
