import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import staff from '@/docs/openapi/staff-v1.json'
import website from '@/docs/openapi/website-integration-v1.json'
import customer from '@/docs/openapi/customer-portal-v1.json'
import { PUBLIC_API_ROUTES, publicRouteContract } from '@/lib/api/publicRouteRegistry'
import { buildOpenApiReleaseManifest } from '@/lib/integrations/openApiReleaseManifest'
import { serializeOpenApiDocument } from '@/lib/integrations/openApiResponse'
import { GET as currentStaffDocument } from '@/app/api/v1/openapi/staff-v1.json/route'
import { GET as immutableStaffDocument } from '@/app/api/v1/openapi/2026-10-09.1/staff-v1.json/route'
import { GET as firstStaffReleaseDocument } from '@/app/api/v1/openapi/2026-10-04.1/staff-v1.json/route'
import { STAFF_API_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

const { validateSchema, validateResponse } = createRequire(import.meta.url)('../scripts/lib/openapi-schema-validator.cjs') as {
  validateSchema: (document: unknown, value: unknown, schema: unknown) => string[]
  validateResponse: (document: unknown, path: string, value: unknown, method?: string, status?: string) => string[]
}
type Operation = {
  operationId: string; security: Array<Record<string, unknown>>
  parameters: Array<{ name?: string; required?: boolean; $ref?: string }>
  'x-required-scopes': string[]; 'x-required-permission': string; 'x-idempotency-required': boolean
}
const envelope = (data: unknown) => ({ data, request_id: 'request-staff', contract_schema_version: STAFF_API_CONTRACT_VERSION })
const reference = (kind: string) => `${kind}_${'a'.repeat(32)}`
const uuid = '00000000-0000-4000-8000-000000000001'
function stripVersionMetadata(value: unknown): unknown {
  if (typeof value === 'string') return value.replaceAll('2026-10-02.4', '<version>').replaceAll('2026-10-04.1', '<version>')
  if (Array.isArray(value)) return value.map(stripVersionMetadata)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripVersionMetadata(item)]))
  return value
}

describe('Staff API public contract', () => {
  it('registers every staff operation including PATCH with isolated scopes and dual identity', () => {
    let count = 0
    for (const [path, item] of Object.entries(staff.paths)) {
      if (!path.startsWith('/api/v1/staff/')) continue
      for (const [method, raw] of Object.entries(item)) {
        const op = raw as unknown as Operation
        const route = publicRouteContract(method, path.replaceAll('{', '').replaceAll('}', ''))
        expect(route).not.toBeNull()
        expect(route?.operationId).toBe(op.operationId)
        expect(route?.scopes).toEqual(op['x-required-scopes'])
        expect(route?.idempotencyRequired === true).toBe(op['x-idempotency-required'])
        expect(route?.publicIdPolicy).toBe('staff-identities-and-opaque-references')
        expect(op.security).toEqual([{ bearerAuth: [], staffAssertion: [] }])
        expect(op.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'x-gridex-staff-assertion', required: true })]))
        expect(op['x-required-scopes']).toHaveLength(1)
        expect(op['x-required-scopes'][0]).toMatch(/^staff_(users|customers|cases)\.(read|write)$/)
        expect(op['x-required-permission']).toMatch(/^(users|customers|masterdata|cases)\.(read|write)$/)
        if (method !== 'get') expect(op.parameters).toContainEqual({ $ref: '#/components/parameters/IdempotencyKey' })
        count++
      }
    }
    expect(count).toBe(22)
    expect(PUBLIC_API_ROUTES.filter(route => route.path.startsWith('/api/v1/staff/'))).toHaveLength(count)
  })

  it('validates masked customer projections and rejects internal customer and storage fields', () => {
    const summary = Object.fromEntries(Object.keys(staff.components.schemas.StaffCustomerSummary.properties).map(key => [key, key === 'customer_reference' ? reference('customer') : null]))
    const data = { customers: [summary], pagination: { page: 1, page_size: 25, total: 1, total_pages: 1 } }
    expect(validateResponse(staff, '/api/v1/staff/customers', envelope(data))).toEqual([])
    for (const field of ['personal_number', 'org_number', 'company_id', 'customer_id', 'storage_path']) expect(validateResponse(staff, '/api/v1/staff/customers', envelope({ ...data, customers: [{ ...summary, [field]: 'private' }] }))).not.toEqual([])
    expect(validateResponse(staff, '/api/v1/staff/customers', { ...envelope(data), internal_context: true })).not.toEqual([])
  })

  it('validates staff identities without returning invitation tokens', () => {
    const invite = { email: 'staff@example.com', role_key: 'customer_service_agent', membership_role: 'staff', status: 'pending' }
    expect(validateResponse(staff, '/api/v1/staff/users', envelope(invite), 'post', '201')).toEqual([])
    expect(validateResponse(staff, '/api/v1/staff/users', envelope({ ...invite, token: 'private' }), 'post', '201')).not.toEqual([])
    const state = { user_id: uuid, role_key: 'customer_service_agent', membership_role: 'staff', status: 'active' }
    expect(validateResponse(staff, '/api/v1/staff/users/{id}', envelope(state), 'patch')).toEqual([])
    expect(validateResponse(staff, '/api/v1/staff/users/{id}', envelope({ ...state, user_id: 'invalid' }), 'patch')).not.toEqual([])
  })

  it('keeps versioned contact edits separate from identity approval and uses actual OPS permissions', () => {
    expect(staff.paths['/api/v1/staff/customers/{ref}/contact'].patch['x-required-permission']).toBe('masterdata.write')
    expect(staff.paths['/api/v1/staff/customers/{ref}/identity-change'].post['x-required-permission']).toBe('customers.write')
    const patch = staff.components.schemas.StaffContactChangeRequest
    expect(patch.required).toContain('expectedUpdatedAt')
    expect(patch.anyOf).toEqual(['email', 'phone', 'invoice_email', 'preferred_language', 'apartment_number'].map(key => ({ required: [key] })))
    expect(patch.properties).not.toHaveProperty('personal_number')
    expect(validateSchema(staff, { field: 'personal_number', new_value: 'example', reason: 'Correct record', actor_user_id: uuid }, { $ref: '#/components/schemas/StaffIdentityChangeRequest' })).not.toEqual([])
  })

  it('validates case pagination and assignment and rejects arbitrary event payloads', () => {
    const page = { limit: 50, offset: 0, returned: 0, has_more: false, next_cursor: null }
    expect(validateResponse(staff, '/api/v1/staff/cases', { ...envelope([]), page })).toEqual([])
    expect(validateResponse(staff, '/api/v1/staff/cases', { ...envelope([]), page: { ...page, private_cursor_data: 'secret' } })).not.toEqual([])
    const schema = { $ref: '#/components/schemas/StaffAssigneeRequest' }
    expect(validateSchema(staff, { assignee_user_id: uuid }, schema)).toEqual([])
    expect(validateSchema(staff, { assignee_user_id: null }, schema)).toEqual([])
    expect(validateSchema(staff, { assignee_user_id: uuid, company_id: uuid }, schema)).not.toEqual([])
    const event = { event_reference: reference('support_message'), event_type: 'support_internal_note', message: 'Internal note', visibility: 'internal', author_type: 'staff', author_user_id: uuid, channel: 'staff_api', kind: null, direction: null, verification_method: null, verification_reference: null, representative: null, created_at: '2026-10-04T08:30:00Z' }
    expect(validateResponse(staff, '/api/v1/staff/cases/{reference}/notes', envelope(event), 'post', '201')).toEqual([])
    expect(validateResponse(staff, '/api/v1/staff/cases/{reference}/notes', envelope({ ...event, payload: { private: true } }), 'post', '201')).not.toEqual([])
  })

  it('makes case history continuation and bounded customer child collections explicit', () => {
    const page = { limit: 50, offset: 0, returned: 0, has_more: true, next_cursor: 'opaque-cursor' }
    for (const path of ['/api/v1/staff/cases/{reference}/events', '/api/v1/staff/cases/{reference}/attachments']) {
      expect(validateResponse(staff, path, { ...envelope([]), page })).toEqual([])
      expect(validateResponse(staff, path, envelope([]))).not.toEqual([])
      const op = (staff.paths as unknown as Record<string, { get: Operation }>)[path].get
      expect(op.parameters.filter(parameter => ['limit', 'cursor'].includes(parameter.name ?? ''))).toHaveLength(2)
    }
    expect(staff.components.schemas.StaffCaseDetail.required).toEqual(expect.arrayContaining(['events_page', 'attachments_page']))
    expect(staff.components.schemas.StaffCustomer.required).toEqual(expect.arrayContaining(['contacts_page', 'addresses_page', 'sites_page']))
    const schema = { $ref: '#/components/schemas/StaffEmbeddedCollectionPage' }
    expect(validateSchema(staff, { limit: 100, returned: 100, has_more: true }, schema)).toEqual([])
    expect(validateSchema(staff, { limit: 100, returned: 101, has_more: true }, schema)).not.toEqual([])
  })

  it('publishes exact checksums in a closed third manifest family', () => {
    const manifest = buildOpenApiReleaseManifest()
    expect(manifest.specifications.staff.contract_version).toBe(STAFF_API_CONTRACT_VERSION)
    expect(manifest.specifications.staff.sha256).toBe(createHash('sha256').update(serializeOpenApiDocument(staff)).digest('hex'))
    for (const spec of [staff, website, customer]) {
      const schema = { $ref: '#/components/schemas/OpenApiReleaseManifest' }
      expect(validateSchema(spec, manifest, schema)).toEqual([])
      const { staff: removed, ...specifications } = manifest.specifications
      expect(removed).toBeDefined()
      expect(validateSchema(spec, { ...manifest, specifications }, schema)).not.toEqual([])
      expect(validateSchema(spec, { ...manifest, specifications: { ...manifest.specifications, private_key: 'secret' } }, schema)).not.toEqual([])
    }
  })

  it('serves identical current and immutable staff documents with correct cache and version headers', async () => {
    const request = new NextRequest('https://app.gridex.se/api/v1/openapi/staff-v1.json')
    const current = await currentStaffDocument(request)
    const immutable = await immutableStaffDocument(request)
    expect(await current.text()).toBe(serializeOpenApiDocument(staff))
    expect(await immutable.text()).toBe(serializeOpenApiDocument(staff))
    expect(current.headers.get('x-gridex-contract-version')).toBe(STAFF_API_CONTRACT_VERSION)
    expect(immutable.headers.get('cache-control')).toContain('immutable')
    const cached = await immutableStaffDocument(new NextRequest(request.url, { headers: { 'if-none-match': immutable.headers.get('etag')! } }))
    expect(cached.status).toBe(304)
    expect(cached.headers.get('x-gridex-contract-version')).toBe(STAFF_API_CONTRACT_VERSION)
    const first = await firstStaffReleaseDocument(request)
    expect(await first.text()).toBe(serializeOpenApiDocument(JSON.parse(readFileSync('docs/openapi/releases/2026-10-04.1/staff-v1.json', 'utf8'))))
    expect(first.headers.get('cache-control')).toContain('immutable')
  })

  it('preserves existing business paths and schemas except release metadata and the additive manifest', () => {
    // Invariant of the Staff release 2026-10-04.1 against 2026-10-02.4, checked on the frozen bytes.
    // Later documentation releases are checked additively in api-supported-client-release-matrix.test.ts.
    const frozenStaffRelease = (name: string) => JSON.parse(readFileSync(`docs/openapi/releases/2026-10-04.1/${name}.json`, 'utf8'))
    for (const [name, current] of [['website-integration-v1', frozenStaffRelease('website-integration-v1')], ['customer-portal-v1', frozenStaffRelease('customer-portal-v1')]] as const) {
      const previous = JSON.parse(readFileSync(`docs/openapi/releases/2026-10-02.4/${name}.json`, 'utf8'))
      for (const [path, value] of Object.entries(previous.paths)) {
        if (path.startsWith('/api/v1/openapi/')) continue
        expect(stripVersionMetadata(current.paths[path as keyof typeof current.paths])).toEqual(stripVersionMetadata(value))
      }
      for (const [schema, value] of Object.entries(previous.components.schemas)) {
        if (['OpenApiReleaseManifest', 'OpenApiReleaseSpecification'].includes(schema)) continue
        expect(stripVersionMetadata(current.components.schemas[schema as keyof typeof current.components.schemas])).toEqual(stripVersionMetadata(value))
      }
    }
    for (const [name, hash] of [['customer-portal-v1', '442ee521e2286a3364de082cce50b68be3085db7855caf151a8999005b790503'], ['website-integration-v1', '10fb2f3051f112990fe4ef63ffa18b24ee5d9b5203b1f4429a2a3d88675c43be']]) expect(createHash('sha256').update(readFileSync(`docs/openapi/releases/2026-10-02.4/${name}.json`)).digest('hex')).toBe(hash)
  })

  it('rejects attempted immutable staff release mutation during materialization', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'gridex-staff-contract-'))
    try {
      mkdirSync(resolve(dir, 'docs/openapi'), { recursive: true })
      // CI's inherited relative preload must keep restricting this child after
      // its cwd changes to the disposable materializer fixture.
      mkdirSync(resolve(dir, 'scripts/lib'), { recursive: true })
      copyFileSync(resolve('scripts/lib/unit-loopback-network-boundary.cjs'), resolve(dir, 'scripts/lib/unit-loopback-network-boundary.cjs'))
      copyFileSync(resolve('scripts/lib/refactor-safe-static-read.cjs'), resolve(dir, 'scripts/lib/refactor-safe-static-read.cjs'))
      for (const name of ['website-integration-v1', 'customer-portal-v1', 'staff-v1']) writeFileSync(resolve(dir, `docs/openapi/${name}.json`), JSON.stringify({ info: { version: STAFF_API_CONTRACT_VERSION }, 'x-contract-schema-version': STAFF_API_CONTRACT_VERSION }))
      const script = resolve('scripts/materialize-openapi-release.cjs')
      execFileSync(process.execPath, [script], { cwd: dir })
      const release = resolve(dir, `docs/openapi/releases/${STAFF_API_CONTRACT_VERSION}/staff-v1.json`)
      const before = readFileSync(release, 'utf8')
      writeFileSync(resolve(dir, 'docs/openapi/staff-v1.json'), JSON.stringify({ info: { version: STAFF_API_CONTRACT_VERSION, title: 'Mutation' }, 'x-contract-schema-version': STAFF_API_CONTRACT_VERSION }))
      expect(() => execFileSync(process.execPath, [script], { cwd: dir, stdio: 'pipe' })).toThrow('Refusing to mutate immutable OpenAPI release artifact')
      expect(readFileSync(release, 'utf8')).toBe(before)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('resolves every reference and documents single-use assertions and retries without internal terminology', () => {
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return
      const record = value as Record<string, unknown>
      if (typeof record.$ref === 'string') expect(record.$ref.slice(2).split('/').reduce<unknown>((v, key) => (v as Record<string, unknown>)?.[key], staff), record.$ref).toBeDefined()
      Object.values(record).forEach(visit)
    }
    visit(staff)
    for (const file of ['docs/gridex-staff-api.md', 'app/developers/staff-api/page.tsx']) {
      const guide = readFileSync(file, 'utf8')
      expect(guide).not.toMatch(/\btenant\b/i)
      expect(guide).toContain('jti')
      expect(guide).toContain('Idempotency-Key')
      expect(guide).toContain('masterdata.write')
    }
  })
})
