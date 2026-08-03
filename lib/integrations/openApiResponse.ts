import { createHash, randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

export type OpenApiDocumentResponseOptions = {
  cacheControl?: string
}

export function serializeOpenApiDocument(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`
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
