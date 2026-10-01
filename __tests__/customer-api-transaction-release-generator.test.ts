import * as crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import portalInput from '@/docs/openapi/customer-portal-v1.json'
import websiteInput from '@/docs/openapi/website-integration-v1.json'

const require = createRequire(import.meta.url)
const finalize = require('../scripts/finalize-openapi-release.portal.cjs') as (input: Record<string, unknown>) => void
type Schema = {
  required: string[]; properties: Record<string, Schema>; oneOf: Schema[];
  maxProperties: number; additionalProperties: boolean;
}
type Operation = {
  requestBody: { content: Record<string, { schema: unknown }> };
  responses: Record<string, { description: string; content: Record<string, { schema: unknown }> }>;
  description: string; 'x-scope-requirement': Record<string, string[]>;
}
type Document = { components: { schemas: Record<string, Schema> }; info: { version: string }; paths: Record<string, Record<string, Operation>> }
function generatedPortal() {
  const portal = structuredClone(portalInput) as unknown as Document
  const website = structuredClone(websiteInput) as unknown as Document
  for (const path of ['/api/v1/customer/cases', '/api/v1/customer/cases/{reference}/messages', '/api/v1/customer/cases/{reference}/attachments']) {
    portal.paths[path] = { get: structuredClone(portal.paths['/api/v1/customer/legal-acceptances'].get),
      post: structuredClone(portal.paths['/api/v1/customer/notifications/read'].post) }
    Object.assign(portal.paths[path].get, { 'x-required-scopes': ['customer_cases.read'] })
    Object.assign(portal.paths[path].post, { 'x-required-scopes': ['customer_cases.write'] })
  }
  const string = { type: 'string' }, version = 'synthetic-next-contract'
  const envelope = (data: unknown, extra: string[] = []) => ({ type: 'object', additionalProperties: false,
    required: ['data', 'request_id', 'contract_schema_version', ...extra], properties: { data, request_id: string,
      contract_schema_version: { type: 'string', const: version } } })
  const set = (input: unknown, path: string, schema: unknown, method: string, kind: string, status = '200') => {
    const spec = input as Document
    if (kind === 'request') spec.paths[path][method].requestBody.content['application/json'].schema = schema
    else {
      spec.paths[path][method].responses[status] ??= { description: 'Synthetic response scaffold', content: { 'application/json': { schema: {} } } }
      spec.paths[path][method].responses[status].content['application/json'].schema = schema
    }
  }
  finalize({ application: website.components.schemas.CustomerApplicationRequest,
    canonicalErrorEnvelope: portal.components.schemas.ErrorEnvelope, contractVersion: { type: 'string', const: version }, crypto,
    dateTime: { type: 'string', format: 'date-time' }, envelope,
    fs: { writeFileSync: () => undefined }, normalizeContractVersionMetadata: () => undefined,
    nullableString: { type: ['string', 'null'] }, portal, portalPath: 'synthetic-portal', priorVersion: portal.info.version,
    publicContractsExample: { data: [], meta: { contract_schema_version: version } }, publishedVersions: [portal.info.version],
    setRequest: (s: unknown, p: string, schema: unknown, method = 'post') => set(s, p, schema, method, 'request'),
    setResponse: (s: unknown, p: string, schema: unknown, method = 'get', status = '200') => set(s, p, schema, method, 'response', status),
    string, uuid: { type: 'string', format: 'uuid' }, version, website, websitePath: 'synthetic-website' })
  return portal
}
describe('next release generator without rewriting immutable or current artifacts', () => {
  it('runs the actual generator when new routes have no created-response scaffold', () => {
    const directory = fs.mkdtempSync(join(tmpdir(), 'gridex-contract-generator-'))
    const root = fileURLToPath(new URL('../', import.meta.url))
    try {
      fs.mkdirSync(join(directory, 'docs/openapi'), { recursive: true })
      fs.mkdirSync(join(directory, 'docs/fixtures'), { recursive: true })
      const portal = structuredClone(portalInput) as unknown as Document
      const paths = ['/api/v1/customer/cases', '/api/v1/customer/cases/{reference}/messages', '/api/v1/customer/cases/{reference}/attachments']
      for (const path of paths) {
        portal.paths[path] = { get: structuredClone(portal.paths['/api/v1/customer/legal-acceptances'].get),
          post: structuredClone(portal.paths['/api/v1/customer/notifications/read'].post) }
        portal.paths[path].post.responses = { '200': structuredClone(portal.paths[path].post.responses['200']) }
      }
      Reflect.deleteProperty(portal.paths[paths[1]].post, 'responses')
      portal.paths[paths[2]].post.responses = { '201': { description: 'Existing attachment creation response.', content: {} } }
      fs.writeFileSync(join(directory, 'docs/openapi/customer-portal-v1.json'), JSON.stringify(portal))
      fs.writeFileSync(join(directory, 'docs/openapi/website-integration-v1.json'), JSON.stringify(websiteInput))
      fs.copyFileSync(join(root, 'docs/fixtures/public-contracts-response-2026-08-19.2.json'),
        join(directory, 'docs/fixtures/public-contracts-response-2026-08-19.2.json'))

      execFileSync(process.execPath, [join(root, 'scripts/finalize-openapi-release.cjs')], { cwd: directory, encoding: 'utf8' })

      const generated = JSON.parse(fs.readFileSync(join(directory, 'docs/openapi/customer-portal-v1.json'), 'utf8')) as Document
      for (const path of paths) {
        const operation = generated.paths[path].post
        expect(operation.responses['200']).toBeUndefined()
        expect(operation.responses['201'].description.trim()).not.toBe('')
        expect(operation.responses['201'].content['application/json'].schema).toMatchObject({
          required: expect.arrayContaining(['data', 'request_id', 'contract_schema_version']),
        })
      }
      expect(generated.paths[paths[2]].post.responses['201'].description).toBe('Existing attachment creation response.')
      expect(generated.paths[paths[2]].post.requestBody.content['multipart/form-data'].schema).toMatchObject({
        additionalProperties: false, required: ['file', 'expected_revision'],
      })
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
  it.each(['/api/v1/customer/legal-acceptances', '/api/v1/customer/metering-values'])('documents safe retryable 503 on %s', path => {
    const operation = generatedPortal().paths[path].get
    expect(operation.responses['503']).toMatchObject({ content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } })
    expect(operation.responses['503'].description).toMatch(/platform_schema_not_ready/)
    expect(operation.responses['503'].description).toMatch(/retryable true/)
  })
  it('states atomic notification completion and exact authorized legacy replay', () => {
    const operation = generatedPortal().paths['/api/v1/customer/notifications/read'].post
    expect(operation.description).toMatch(/atomically/)
    expect(operation.description).toMatch(/completed legacy/)
    expect(operation.description).toMatch(/failed.*processing.*409/)
    expect(operation.description).toMatch(/current.*authority/)
  })
  it('separates revision-bound contact, billing, preferences and facility commands', () => {
    const portal = generatedPortal()
    expect(portal.components.schemas.CustomerContactChangeRequest.required).toEqual(['profile'])
    expect(portal.components.schemas.CustomerContactChangeRequest.properties.expected_contact_revision).toMatchObject({ description: expect.stringContaining('Required on fresh commands') })
    expect(portal.components.schemas.CustomerBillingChangeRequest.required).toEqual(['profile'])
    expect(portal.components.schemas.CustomerBillingChangeRequest.properties.expected_billing_revision).toMatchObject({ description: expect.stringContaining('Required on fresh commands') })
    expect(portal.components.schemas.CustomerBillingChangeRequest.properties.profile.additionalProperties).toBe(false)
    expect(portal.components.schemas.CustomerProfileUpdateRequest.oneOf).toContainEqual({ $ref: '#/components/schemas/CustomerBillingChangeRequest' })
    expect(portal.components.schemas.CustomerProfileUpdateData.properties.billing_revision).toEqual({ type: 'integer', minimum: 0 })
    expect(portal.paths['/api/v1/customer/profile-update'].post['x-scope-requirement'].billing).toEqual(['customer_billing.write'])
    expect(portal.components.schemas.CustomerPreferencesChangeRequest.properties.expected_profile_revision).toMatchObject({ type: 'integer', minimum: 0 })
    expect(portal.components.schemas.CustomerFacilityUpdate.properties.expected_address_revision).toMatchObject({ type: 'integer', minimum: 0 })
    expect(Object.keys(portal.components.schemas.CustomerPreferencesFields.properties).sort()).toEqual(['language_code', 'timezone'])
    expect(portal.paths['/api/v1/customer/profile-update'].post.description).toMatch(/atomically/)
    expect(portal.paths['/api/v1/customer/profile-update'].post.responses['503'].description).toMatch(/platform_schema_not_ready/)
    expect(portal.paths['/api/v1/customer/profile-update'].post.description).not.toMatch(/command_unavailable/)
    expect(portal.components.schemas.CustomerMeData.required).toEqual(expect.arrayContaining(['contact_revision', 'billing_revision', 'profile_revision', 'language_code', 'timezone']))
    expect(portal.components.schemas.CustomerSite.required).toContain('address_revision')
    expect(portal.components.schemas.CustomerSite.properties.address_revision).toEqual({ type: ['integer', 'null'], minimum: 0 })
    expect(portal.components.schemas.CustomerSiteAddress.required).toContain('apartment_number')
    expect(portal.components.schemas.CustomerSyncRequest.properties.profile.maxProperties).toBe(0)
    expect(portal.components.schemas.CustomerSyncRequest.properties.facility_data).toMatchObject({ items: { additionalProperties: false } })
    expect(portal.components.schemas.CustomerSyncRequest.properties.facility_data).not.toHaveProperty('items.properties.address')
  })
  it('generates closed support projections and distinct 201 writes with page metadata', () => {
    const portal = generatedPortal()
    expect(Object.keys(portal.components.schemas.CustomerSupportCase.properties).sort())
      .toEqual(['case_reference', 'title', 'status', 'revision', 'created_at', 'updated_at'].sort())
    expect(Object.keys(portal.components.schemas.CustomerSupportMessage.properties).sort())
      .toEqual(['message_reference', 'body', 'author_kind', 'author_reference', 'channel', 'revision', 'created_at'].sort())
    expect(portal.components.schemas.CustomerSupportMessage.required.sort())
      .toEqual(['message_reference', 'body', 'author_kind', 'author_reference', 'channel', 'revision', 'created_at'].sort())
    expect(portal.components.schemas.CustomerSupportMessage.properties.author_reference)
      .toMatchObject({ type: ['string', 'null'], pattern: '^support_staff_[A-Za-z0-9_-]{32}$' })
    for (const path of ['/api/v1/customer/cases', '/api/v1/customer/cases/{reference}/messages']) {
      expect(portal.paths[path].post.responses['201']).toBeDefined()
      expect(portal.paths[path].post.responses['200']).toBeUndefined()
      expect(portal.paths[path].get.responses['200'].content['application/json'].schema).toMatchObject({ required: expect.arrayContaining(['page']) })
    }
  })
  it('documents support read authority, cursor errors and message revisions separately from writes', () => {
    const portal = generatedPortal()
    const cases = portal.paths['/api/v1/customer/cases']
    const messages = portal.paths['/api/v1/customer/cases/{reference}/messages']
    expect(cases.get.description).toMatch(/customer_cases\.read/)
    expect(cases.get.description).toMatch(/filtering occurs before/)
    expect(messages.get.description).toMatch(/revisions can have gaps/)
    expect(messages.get.description).toMatch(/Internal notes.*never projected/)
    expect(messages.get.responses['400'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/ErrorEnvelope' })
    expect(messages.get.responses['409']).toBeUndefined()
    expect(messages.post.description).toMatch(/expected_revision/)
    expect(messages.post.description).toMatch(/replayed=true/)
    expect(messages.post.description).toMatch(/atomically/)
    expect(messages.post.responses['409'].description).toMatch(/requires_review/)
    expect(portal.components.schemas.CustomerSupportMessageRequest.properties.expected_revision).toMatchObject({ maximum: Number.MAX_SAFE_INTEGER })
  })
  it('describes private multipart support intake with no client-controlled scan or public download', () => {
    const portal = generatedPortal()
    const operations = portal.paths['/api/v1/customer/cases/{reference}/attachments']
    expect(Object.keys(portal.components.schemas.CustomerSupportAttachment.properties).sort())
      .toEqual(['attachment_reference', 'file_name', 'media_type', 'byte_size', 'scan_status', 'created_at'].sort())
    expect(operations.post.requestBody.content['multipart/form-data'].schema).toMatchObject({ additionalProperties: false,
      required: ['file', 'expected_revision'], properties: { file: { type: 'string', format: 'binary' }, expected_revision: { type: 'string' } } })
    expect(operations.post.requestBody.content['application/json']).toBeUndefined()
    expect(operations.post.responses['201']).toBeDefined()
    expect(operations.post.responses['413'].description).toMatch(/support_attachment_too_large/)
    expect(operations.post.description).toMatch(/quarantined/)
    expect(operations.get.description).toMatch(/No.*download/)
  })
})
