import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import portal from '@/docs/openapi/customer-portal-v1.json'
import website from '@/docs/openapi/website-integration-v1.json'
import { buildOpenApiReleaseManifest } from '@/lib/integrations/openApiReleaseManifest'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'
import { openApiDocumentResponse, serializeOpenApiDocument } from '@/lib/integrations/openApiResponse'
import { publicSupportCase } from '@/lib/customer-service/supportConversation'
import { staffCaseDto } from '@/lib/staff-api/cases'

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

describe('actual support case channel projection follows the frozen customer contract', () => {
  const staffRow = (channel: unknown): Parameters<typeof staffCaseDto>[0] => ({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    company_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    customer_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    status: 'open',
    priority: 'normal',
    title: 'Fråga från kundsamtal',
    description: 'Intern arbetsanteckning från medarbetaren.',
    reason_category: 'support',
    assigned_to: null,
    source: 'tenant_support_staff_api',
    metadata: { support_case: true, opened_by: 'staff', description_visibility: 'internal', support_channel: channel },
    created_at: '2026-10-05T12:00:00.000Z',
    updated_at: '2026-10-05T12:00:00.000Z',
    resolved_at: null,
    closed_at: null,
  })
  const assertCustomerSchemas = (data: ReturnType<typeof publicSupportCase>) => {
    const released = JSON.parse(readFileSync(`docs/openapi/releases/${WEBSITE_INTEGRATION_CONTRACT_VERSION}/customer-portal-v1.json`, 'utf8'))
    for (const spec of [portal, released]) {
      const errors = validateSchema(spec, data, { $ref: '#/components/schemas/CustomerSupportCase' })
      expect(errors, errors.join('\n')).toEqual([])
      expect(validateResponse(spec, '/api/v1/customer/support/cases', {
        ...response([data]),
        page: { limit: 1, offset: 0, returned: 1, has_more: false, next_cursor: null },
      })).toEqual([])
      expect(validateResponse(spec, detailPath, response({ ...data, messages: [] }))).toEqual([])
    }
  }

  it('returns admin for a real staff_api row in customer single/list/detail responses while preserving the internal channel and hiding staff notes', () => {
    const row = staffRow('staff_api')
    const before = structuredClone(row)
    const data = publicSupportCase(row)
    assertCustomerSchemas(data)
    expect(data.channel).toBe('admin')
    expect(data.description).toBeNull()
    expect(staffCaseDto(row).channel).toBe('staff_api')
    expect(row).toEqual(before)
  })

  it.each(['api', 'customer_portal', 'admin', 'phone', 'operations_automation'])('preserves documented channel %s without exposing internal descriptions', channel => {
    const data = publicSupportCase(staffRow(channel))
    expect(data.channel).toBe(channel)
    expect(data.description).toBeNull()
    assertCustomerSchemas(data)
  })

  it.each([undefined, null, 7, {}, 'ops', 'internal', 'unknown'])('closes undocumented or malformed channel %j to null', channel => {
    const data = publicSupportCase(staffRow(channel))
    expect(data.channel).toBeNull()
    expect(data.description).toBeNull()
    assertCustomerSchemas(data)
  })

  it('still exposes the customer original description only through its explicit customer visibility', () => {
    const row = staffRow('customer_portal')
    row.description = 'Kundens egen fråga.'
    row.metadata = { ...row.metadata, opened_by: 'customer', description_visibility: 'customer' }
    const data = publicSupportCase(row)
    expect(data.description).toBe('Kundens egen fråga.')
    assertCustomerSchemas(data)
  })
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
  it('preserves both preceding immutable archives, including the independently prepared attachment release', () => {
    const hashes = {
      '2026-10-02.2/customer-portal-v1': '161559a56cc5e3bed2ebc94b9a11301ca3a6437cb180957ac4510a40ce4fc001',
      '2026-10-02.2/website-integration-v1': '96bd47c98b828849d8ca7456de654866a3adcea213a6ee92850e99c4d315bd36',
      '2026-10-02.3/customer-portal-v1': '0a73e04c0c775b5b41e8eb14e26f8893acb9474f178ed8cb46965d30af4d28d0',
      '2026-10-02.3/website-integration-v1': 'c6a13c2426f16bec0d630b3c912cec02b01336368196a7b9596b11b30332e948',
    }
    for (const [name, hash] of Object.entries(hashes)) {
      expect(createHash('sha256').update(readFileSync(`docs/openapi/releases/${name}.json`)).digest('hex')).toBe(hash)
    }
  })

  it('documents each immutable OpenAPI route with its own response version', () => {
    for (const spec of [website, portal]) {
      for (const [path, item] of Object.entries(spec.paths)) {
        const version = /^\/api\/v1\/openapi\/(\d{4}-\d{2}-\d{2}\.\d+)\//.exec(path)?.[1]
        if (!version) continue
        const operation = item as { get: { responses: Record<string, { headers: Record<string, { schema: unknown }> }> } }
        for (const status of ['200', '304']) {
          const schema = operation.get.responses[status].headers['X-Gridex-Contract-Version'].schema
          expect(validateSchema(spec, version, schema)).toEqual([])
          expect(validateSchema(spec, 'unexpected-version', schema)).not.toEqual([])
        }
      }
    }
  })

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
    expect(manifest.minimum_tenant_integration_version).toBe('2026-10-02.3')
  })
})
