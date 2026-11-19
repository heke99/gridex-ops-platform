import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { GET as getVersionedWebsiteOpenApi } from '@/app/api/v1/openapi/2026-11-10.1/website-integration-v1.json/route'
import { GET as getWebsiteOpenApi } from '@/app/api/v1/openapi/website-integration-v1.json/route'
import customerPortalOpenApi from '@/docs/openapi/customer-portal-v1.json'
import websiteIntegrationOpenApi from '@/docs/openapi/website-integration-v1.json'
import { buildOpenApiReleaseManifest } from '@/lib/integrations/openApiReleaseManifest'
import {
  normalizeOpenApiDocument,
  serializeOpenApiDocument,
} from '@/lib/integrations/openApiResponse'

type JsonRecord = {
  info: { version: string }
  paths: Record<
    string,
    {
      post: {
        responses: Record<string, { description: string }>
      }
    }
  >
  [key: string]: unknown
}

function sha256(document: unknown): string {
  return createHash('sha256').update(serializeOpenApiDocument(document)).digest('hex')
}

describe('OpenAPI release metadata parity', () => {
  it('serves the canonical release version on both OpenAPI documents', () => {
    for (const source of [websiteIntegrationOpenApi, customerPortalOpenApi]) {
      const normalized = normalizeOpenApiDocument(source) as JsonRecord
      expect(normalized['x-gridex-release-version']).toBe(normalized.info.version)
    }
  })

  it('describes customer-portal sync as a portal bundle, not an invoice-list response', () => {
    const normalized = normalizeOpenApiDocument(customerPortalOpenApi) as JsonRecord
    const response = normalized.paths['/api/v1/customer-portal/sync'].post.responses['200']

    expect(response.description).toContain('portalsynk')
    expect(response.description.toLowerCase()).not.toContain('fakturalista')
  })

  it('computes release-manifest checksums from the exact normalized documents served at runtime', () => {
    const manifest = buildOpenApiReleaseManifest()

    expect(manifest.specifications.website.sha256).toBe(
      sha256(websiteIntegrationOpenApi),
    )
    expect(manifest.specifications.customer_portal.sha256).toBe(
      sha256(customerPortalOpenApi),
    )
  })

  it('does not mutate imported source JSON while normalizing', () => {
    const before = JSON.stringify(customerPortalOpenApi)
    normalizeOpenApiDocument(customerPortalOpenApi)
    expect(JSON.stringify(customerPortalOpenApi)).toBe(before)
  })
})

describe.each([
  {
    name: 'canonical document',
    path: '/api/v1/openapi/website-integration-v1.json',
    get: getWebsiteOpenApi,
  },
  {
    name: 'versioned document',
    path: '/api/v1/openapi/2026-11-10.1/website-integration-v1.json',
    get: getVersionedWebsiteOpenApi,
  },
])('OpenAPI conditional GET for the $name', ({ path, get }) => {
  it.each([
    { name: 'a strong matching tag', toHeader: (etag: string) => etag },
    { name: 'a weak matching tag', toHeader: (etag: string) => `W/${etag}` },
    { name: 'a matching tag in a list', toHeader: (etag: string) => `"other,older", W/${etag}` },
    { name: 'a matching tag after empty leading elements', toHeader: (etag: string) => `, , ${etag}` },
    { name: 'a weak match after an empty middle element', toHeader: (etag: string) => `"other,older", , W/${etag}` },
    { name: 'the wildcard', toHeader: () => '*' },
  ])('returns 304 with the representation headers for $name', async ({ toHeader }) => {
    const url = `https://gridex.example.invalid${path}`
    const headers = { 'x-request-id': 'openapi-conditional-request' }
    const representation = await get(new NextRequest(url, { headers }))
    const etag = representation.headers.get('etag')
    expect(representation.status).toBe(200)
    expect(etag).toMatch(/^".+"$/)
    const response = await get(new NextRequest(url, {
      headers: { ...headers, 'if-none-match': toHeader(etag!) },
    }))

    expect(response.status).toBe(304)
    expect(await response.text()).toBe('')
    for (const header of ['etag', 'cache-control', 'vary', 'x-gridex-contract-version', 'x-request-id']) {
      expect(response.headers.get(header)).toBe(representation.headers.get(header))
    }
  })

  it('serves the complete document for a nonmatching weak tag', async () => {
    const response = await get(new NextRequest(`https://gridex.example.invalid${path}`, {
      headers: { 'if-none-match': 'W/"different-release"' },
    }))
    expect(response.status).toBe(200)
    expect((await response.json()).openapi).toBe('3.1.0')
  })
})
