import { createHash, randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

export type OpenApiDocumentResponseOptions = {
  cacheControl?: string
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Normalizes release metadata at the final serialization boundary.
 *
 * OpenAPI source files are also materialized by the release tooling, but every
 * canonical and immutable route passes through this function. Keeping the
 * final boundary strict prevents a stale top-level release extension or a
 * copied response description from being served even if a generated JSON file
 * was produced by an older finalizer.
 */
export function normalizeOpenApiDocument(document: unknown): unknown {
  const normalized = JSON.parse(JSON.stringify(document)) as unknown
  if (!isRecord(normalized)) return normalized

  const info = normalized.info
  if (isRecord(info) && typeof info.version === 'string' && info.version.trim()) {
    normalized['x-gridex-release-version'] = info.version.trim()
  }

  const paths = normalized.paths
  if (isRecord(paths)) {
    const syncPath = paths['/api/v1/customer-portal/sync']
    if (isRecord(syncPath)) {
      for (const method of ['post', 'get']) {
        const operation = syncPath[method]
        if (!isRecord(operation)) continue
        const responses = operation.responses
        if (!isRecord(responses)) continue
        const ok = responses['200']
        if (!isRecord(ok)) continue
        ok.description =
          'Tenant- och kundfiltrerad portalsynk med profil, anläggningar, avtal, fakturor, mätvärden, juridik, händelser, dokument, fullmakter och notiser.'
      }
    }
  }

  return normalized
}

export function serializeOpenApiDocument(document: unknown): string {
  return `${JSON.stringify(normalizeOpenApiDocument(document), null, 2)}\n`
}

export function openApiDocumentResponse(
  request: NextRequest,
  document: unknown,
  filename: string,
  options: OpenApiDocumentResponseOptions = {},
): Response {
  const body = serializeOpenApiDocument(document)
  const etag = `"${createHash('sha256').update(body).digest('base64url')}"`
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID()
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control':
      options.cacheControl ??
      'public, max-age=300, stale-while-revalidate=86400',
    'Content-Disposition': `inline; filename="${filename}"`,
    'Content-Type': 'application/json; charset=utf-8',
    ETag: etag,
    Vary: 'If-None-Match',
    'X-Gridex-Contract-Version': WEBSITE_INTEGRATION_CONTRACT_VERSION,
    'X-Request-ID': requestId,
  }

  const ifNoneMatch = request.headers.get('if-none-match')
  if (ifNoneMatch?.split(',').map((value) => value.trim()).includes(etag)) {
    return new Response(null, { status: 304, headers })
  }

  return new Response(body, { status: 200, headers })
}
