import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { buildOpenApiReleaseManifest } from '@/lib/integrations/openApiReleaseManifest'
import { openApiDocumentResponse, serializeOpenApiDocument } from '@/lib/integrations/openApiResponse'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

const releaseRoot = resolve('docs/openapi/releases')
const artifacts = readdirSync(releaseRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory()).flatMap(entry =>
    ['website-integration-v1', 'customer-portal-v1'].map(contract => ({
      version: entry.name, contract, path: resolve(releaseRoot, entry.name, `${contract}.json`),
    })))
const hash = (bytes: string | Buffer, encoding: 'hex' | 'base64url' = 'hex') =>
  createHash('sha256').update(bytes).digest(encoding)

describe('immutable OpenAPI serialization through the actual response boundary', () => {
  it('preserves the exact bytes of every materialized release, including original historical metadata and descriptions', async () => {
    expect(artifacts.length).toBeGreaterThanOrEqual(50)
    const mismatches: string[] = []
    for (const artifact of artifacts) {
      const bytes = readFileSync(artifact.path, 'utf8')
      const document = JSON.parse(bytes)
      const original = JSON.stringify(document)
      const serialized = serializeOpenApiDocument(document)
      const response = openApiDocumentResponse(new NextRequest(`https://example.invalid/api/v1/openapi/${artifact.version}/${artifact.contract}.json`),
        document, `${artifact.contract}.json`, { cacheControl: 'public, max-age=31536000, immutable' })
      const body = await response.text()
      if (serialized !== bytes || body !== bytes || hash(body) !== hash(bytes)) mismatches.push(`${artifact.version}/${artifact.contract}`)
      expect(JSON.stringify(document)).toBe(original)
      expect(response.status).toBe(200)
      expect(response.headers.get('etag')).toBe(`"${hash(body, 'base64url')}"`)
      expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
      // This header describes current runtime compatibility; preserving an
      // historical specification does not promise historical server behavior.
      expect(response.headers.get('x-gridex-contract-version')).toBe(WEBSITE_INTEGRATION_CONTRACT_VERSION)
    }
    expect(mismatches, 'Serializer/HTTP response must retain all frozen artifact bytes.').toEqual([])
  })

  it('retains original release extensions and response descriptions even when they differ from the current generation policy', async () => {
    const document = { info: { version: 'historical-version' }, 'x-gridex-release-version': 'original-extension',
      paths: { '/api/v1/customer-portal/sync': { post: { responses: { '200': { description: 'Original historical description.' } } } } } }
    const response = openApiDocumentResponse(new NextRequest('https://example.invalid/api/v1/openapi/historical.json'), document, 'historical.json')
    expect(await response.json()).toEqual(document)
    expect(serializeOpenApiDocument(document)).toBe(`${JSON.stringify(document, null, 2)}\n`)
  })

  it('preserves supplied request IDs, ETag-list matching, empty304 bodies and existing public headers', async () => {
    const document = { info: { version: 'synthetic-historical-version' }, description: 'Synthetic original bytes' }
    const initial = openApiDocumentResponse(new NextRequest('https://example.invalid/api/v1/openapi/synthetic.json',
      { headers: { 'x-request-id': ' synthetic-request-id ' } }), document, 'synthetic.json')
    const body = await initial.text(), tag = `"${hash(body, 'base64url')}"`
    expect(initial.headers.get('x-request-id')).toBe('synthetic-request-id')
    expect(initial.headers.get('vary')).toBe('If-None-Match')
    expect(initial.headers.get('content-disposition')).toBe('inline; filename="synthetic.json"')
    const cached = openApiDocumentResponse(new NextRequest('https://example.invalid/api/v1/openapi/synthetic.json',
      { headers: { 'x-request-id': 'synthetic-cache-request', 'if-none-match': `"another-etag", ${tag}` } }), document, 'synthetic.json')
    expect(cached.status).toBe(304)
    expect(await cached.text()).toBe('')
    expect(cached.headers.get('etag')).toBe(tag)
    expect(cached.headers.get('x-request-id')).toBe('synthetic-cache-request')
    expect(cached.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('hashes actual active artifact bytes in the release manifest, independently of its serializer implementation', () => {
    const manifest = buildOpenApiReleaseManifest()
    for (const [key, contract] of [['website', 'website-integration-v1'], ['customer_portal', 'customer-portal-v1']] as const) {
      expect(manifest.specifications[key].sha256).toBe(hash(readFileSync(resolve('docs/openapi', `${contract}.json`))))
    }
  })
})
