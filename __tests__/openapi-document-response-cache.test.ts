import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as latest } from '@/app/api/v1/openapi/customer-portal-v1.json/route'
import { GET as archived } from '@/app/api/v1/openapi/2026-11-10.1/customer-portal-v1.json/route'
import { GET as releaseManifest } from '@/app/api/v1/openapi/release-manifest.json/route'
import latestDocument from '@/docs/openapi/customer-portal-v1.json'
import archivedDocument from '@/docs/openapi/releases/2026-11-10.1/customer-portal-v1.json'
import { openApiDocumentResponse, serializeOpenApiDocument } from '@/lib/integrations/openApiResponse'

vi.mock('node:crypto', async original => {
  const native = await original<typeof import('node:crypto')>()
  return { ...native, createHash: vi.fn(native.createHash) }
})

beforeEach(() => { vi.mocked(createHash).mockClear() })
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('serialized OpenAPI response artifacts', () => {
  it.each([
    ['current alias', latest, latestDocument, '/api/v1/openapi/customer-portal-v1.json', 'no-store, max-age=0, must-revalidate'],
    ['versioned archive', archived, archivedDocument, '/api/v1/openapi/2026-11-10.1/customer-portal-v1.json', 'public, max-age=31536000, immutable'],
  ] as const)('serializes and hashes the real %s once while preserving its wire representation', async (_scope, route, document, path, policy) => {
    const expectedBody = serializeOpenApiDocument(document)
    const native = await vi.importActual<typeof import('node:crypto')>('node:crypto')
    const expectedEtag = `"${native.createHash('sha256').update(expectedBody).digest('base64url')}"`
    const stringify = vi.spyOn(JSON, 'stringify')
    const url = `https://gridex.test${path}`

    const first = await route(new NextRequest(url, { headers: { 'x-request-id': 'fixture-1' } }))
    const matching = await route(new NextRequest(url, { headers: {
      'if-none-match': `"another-tag", ${expectedEtag}`, 'x-request-id': 'fixture-2',
    } }))
    const another = await route(new NextRequest(url, { headers: { 'if-none-match': '"different-tag"', 'x-request-id': 'fixture-3' } }))

    expect(first.status).toBe(200)
    expect(matching.status).toBe(304)
    expect(another.status).toBe(200)
    expect(await first.text()).toBe(expectedBody)
    expect(await matching.text()).toBe('')
    expect(await another.text()).toBe(expectedBody)
    const responses = [first, matching, another]
    expect(responses.map((response) => response.headers.get('x-request-id'))).toEqual(['fixture-1','fixture-2','fixture-3'])
    for (const response of responses) {
      expect(response.headers.get('etag')).toBe(expectedEtag)
      expect(response.headers.get('vary')).toBe('If-None-Match')
      expect(response.headers.get('cache-control')).toBe(policy)
      expect(response.headers.get('x-gridex-contract-version')).toBe(document.info.version)
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    }
    expect(stringify.mock.calls.filter(([object]) => object === document)).toHaveLength(1)
    expect(createHash).toHaveBeenCalledTimes(1)
  })

  it('reuses bytes across per-request policy and filename changes', async () => {
    const document = { openapi: '3.1.0', info: { version: ' fixture-version ' }, paths: {} }
    const normal = openApiDocumentResponse(new NextRequest('https://gridex.test/spec', {
      headers: { 'x-request-id': 'first' },
    }), document, 'spec.json', { cacheControl: 'no-store' })
    const tag = normal.headers.get('etag')!
    const conditional = openApiDocumentResponse(new NextRequest('https://gridex.test/spec', {
      headers: { 'x-request-id': 'second', 'if-none-match': tag },
    }), document, 'named-spec.json', { cacheControl: 'public, max-age=60' })

    expect(await normal.json()).toMatchObject({ 'x-gridex-release-version': 'fixture-version' })
    expect(document).not.toHaveProperty('x-gridex-release-version')
    expect(conditional.status).toBe(304)
    expect(conditional.headers.get('etag')).toBe(tag)
    expect(conditional.headers.get('cache-control')).toBe('public, max-age=60')
    expect(conditional.headers.get('content-disposition')).toBe('inline; filename="named-spec.json"')
    expect(conditional.headers.get('x-request-id')).toBe('second')
    expect(conditional.headers.get('x-gridex-contract-version')).toBe('fixture-version')
    expect(createHash).toHaveBeenCalledTimes(1)
  })

  it('builds a fresh release manifest when the build commit changes', async () => {
    const url = 'https://gridex.test/api/v1/openapi/release-manifest.json'
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'synthetic-first')
    const first = await releaseManifest(new NextRequest(url))
    const data = await first.json()
    expect(data.build_commit).toBe('synthetic-first')
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'synthetic-second')
    const fresh = await releaseManifest(new NextRequest(url, { headers: { 'if-none-match': first.headers.get('etag')! } }))
    expect(fresh.status).toBe(200)
    expect(fresh.headers.get('etag')).not.toBe(first.headers.get('etag'))
    const freshData = await fresh.json()
    expect(freshData.build_commit).toBe('synthetic-second')
    expect(freshData.specifications).toEqual(data.specifications)
  })
})
