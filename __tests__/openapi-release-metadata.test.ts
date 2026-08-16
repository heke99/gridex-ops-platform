import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
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
