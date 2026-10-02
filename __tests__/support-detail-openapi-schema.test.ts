import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import portal from '@/docs/openapi/customer-portal-v1.json'
import website from '@/docs/openapi/website-integration-v1.json'
import { buildOpenApiReleaseManifest } from '@/lib/integrations/openApiReleaseManifest'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'
import { openApiDocumentResponse, serializeOpenApiDocument } from '@/lib/integrations/openApiResponse'

const { validateResponse, validateSchema } = createRequire(import.meta.url)('../scripts/lib/openapi-schema-validator.cjs') as {
  validateResponse: (document: unknown, path: string, value: unknown) => string[]
  validateSchema: (document: unknown, value: unknown, schema: unknown) => string[]
}

const detailPath = '/api/v1/customer/support/cases/{reference}'
const detail = {
  case_reference: `support_case_${'a'.repeat(32)}`,
  title: 'Fakturan',
  description: 'En fråga om fakturan.',
  status: 'received',
  channel: 'api',
  created_at: '2026-10-02T12:00:00.000Z',
  updated_at: '2026-10-02T12:00:00.000Z',
  resolved_at: null,
  messages: [{
    message_reference: `support_message_${'b'.repeat(32)}`,
    author_type: 'customer',
    kind: 'message',
    body: 'En fråga om fakturan.',
    created_at: '2026-10-02T12:00:00.000Z',
  }],
}

const response = (data: unknown) => ({
  data,
  request_id: '00000000-0000-4000-8000-000000000001',
  contract_schema_version: WEBSITE_INTEGRATION_CONTRACT_VERSION,
})

describe('closed customer support detail OpenAPI contract', () => {
  it('accepts both customer-visible messages and an empty conversation in current and immutable release responses', () => {
    const released = JSON.parse(readFileSync(`docs/openapi/releases/${WEBSITE_INTEGRATION_CONTRACT_VERSION}/customer-portal-v1.json`, 'utf8'))
    for (const spec of [portal, released]) {
      expect(validateResponse(spec, detailPath, response(detail))).toEqual([])
      expect(validateResponse(spec, detailPath, response({ ...detail, messages: [] }))).toEqual([])
    }
  })

  it.each(['messages', 'case_reference', 'status'])('rejects a detail missing required field %s', (field) => {
    const invalid: Record<string, unknown> = structuredClone(detail)
    delete invalid[field]
    expect(validateResponse(portal, detailPath, response(invalid))).not.toEqual([])
  })

  it('rejects unknown case fields, unknown message fields and unknown envelope fields', () => {
    expect(validateResponse(portal, detailPath, response({ ...detail, internal_note: 'private' }))).not.toEqual([])
    expect(validateResponse(portal, detailPath, response({ ...detail, messages: [{ ...detail.messages[0], employee_id: 'private' }] }))).not.toEqual([])
    expect(validateResponse(portal, detailPath, { ...response(detail), internal_trace: 'private' })).not.toEqual([])
  })

  it('keeps the list/create case schema closed and rejects malformed messages', () => {
    expect(validateSchema(portal, detail, { $ref: '#/components/schemas/CustomerSupportCase' })).not.toEqual([])
    expect(validateResponse(portal, detailPath, response({ ...detail, messages: 'invalid' }))).not.toEqual([])
    expect(validateResponse(portal, detailPath, response({ ...detail, messages: [{ ...detail.messages[0], author_type: 'internal' }] }))).not.toEqual([])
    const message: Record<string, unknown> = { ...detail.messages[0] }
    delete message.body
    expect(validateResponse(portal, detailPath, response({ ...detail, messages: [message] }))).not.toEqual([])
  })
})

describe('schema correction release metadata', () => {
  it('serves the immutable preceding document with its own version in both 200 and 304 responses', async () => {
    const preceding = JSON.parse(readFileSync('docs/openapi/releases/2026-10-02.2/customer-portal-v1.json', 'utf8'))
    const request = new NextRequest('https://app.gridex.se/api/v1/openapi/2026-10-02.2/customer-portal-v1.json')
    const served = openApiDocumentResponse(request, preceding, 'customer-portal-v1.json')
    expect(served.headers.get('x-gridex-contract-version')).toBe('2026-10-02.2')
    expect(await served.text()).toBe(serializeOpenApiDocument(preceding))
    const cached = openApiDocumentResponse(new NextRequest(request.url, { headers: { 'if-none-match': served.headers.get('etag')! } }), preceding, 'customer-portal-v1.json')
    expect(cached.status).toBe(304)
    expect(cached.headers.get('x-gridex-contract-version')).toBe('2026-10-02.2')
  })

  it('validates the actual manifest response and remains closed', () => {
    const manifest = buildOpenApiReleaseManifest()
    expect(validateResponse(website, '/api/v1/openapi/release-manifest.json', manifest)).toEqual([])
    for (const spec of [website, portal]) {
      const validate = (value: unknown) => validateSchema(spec, value, { $ref: '#/components/schemas/OpenApiReleaseManifest' })
      expect(validate(manifest)).toEqual([])
      expect(validate({ ...manifest, private_config: 'invalid' })).not.toEqual([])
      expect(validate({ ...manifest, specifications: { ...manifest.specifications, website: { ...manifest.specifications.website, internal_id: 'invalid' } } })).not.toEqual([])
      expect(validate({ ...manifest, deprecated_features: [{ ...manifest.deprecated_features[0], internal_note: 'invalid' }] })).not.toEqual([])
    }
    const served = openApiDocumentResponse(new NextRequest('https://app.gridex.se/api/v1/openapi/release-manifest.json'), manifest, 'release-manifest.json')
    expect(served.headers.get('x-gridex-contract-version')).toBe(WEBSITE_INTEGRATION_CONTRACT_VERSION)
  })

  it('does not require a client migration from the preceding published contract', () => {
    const manifest = buildOpenApiReleaseManifest()
    expect(manifest.compatibility_classification).toBe('backward-compatible')
    expect(manifest.specifications.website.compatibility).toBe('backward-compatible')
    expect(manifest.specifications.customer_portal.compatibility).toBe('backward-compatible')
    expect(manifest.minimum_tenant_integration_version).toBe('2026-10-02.2')
  })
})
