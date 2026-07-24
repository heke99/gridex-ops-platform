import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

export function openApiDocumentResponse(
  request: NextRequest,
  document: unknown,
  filename: string,
): Response {
  const body = `${JSON.stringify(document, null, 2)}\n`
  const etag = `"${createHash('sha256').update(body).digest('base64url')}"`
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
    'Content-Disposition': `inline; filename="${filename}"`,
    'Content-Type': 'application/json; charset=utf-8',
    ETag: etag,
    'X-Gridex-Contract-Version': WEBSITE_INTEGRATION_CONTRACT_VERSION,
  }

  const ifNoneMatch = request.headers.get('if-none-match')
  if (ifNoneMatch?.split(',').map((value) => value.trim()).includes(etag)) {
    return new Response(null, { status: 304, headers })
  }

  return new Response(body, { status: 200, headers })
}
