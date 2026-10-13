import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from '@/docs/fixtures/public-contracts-response-2026-10-09.1.json'
const ports = vi.hoisted(() => ({ rpc: vi.fn(), diagnose: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: ports.rpc } }))
vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: vi.fn().mockResolvedValue({ ok: true, client: { id: 'client-test', company_id: 'company-test' }, context: { companyId: 'company-test' }, rateLimit: { limit: 100, remaining: 99, resetAt: null } }),
  logIntegrationApiRequest: vi.fn().mockResolvedValue(undefined), currentIntegrationApiResponseContext: () => null,
}))
vi.mock('@/lib/integrations/tenantContext', async original => ({ ...await original<typeof import('@/lib/integrations/tenantContext')>(), loadExternalTenantContext: vi.fn().mockResolvedValue({ tenant_reference: 'tenant-test' }) }))
vi.mock('@/lib/integrations/publicReferences', async original => ({ ...await original<typeof import('@/lib/integrations/publicReferences')>(), publicOrganizationReference: () => 'organization_abcdefghijklmnopqrstuv' }))
vi.mock('@/lib/website/publicContractApi', async original => ({ ...await original<typeof import('@/lib/website/publicContractApi')>(), loadPublicationRevision: vi.fn().mockResolvedValue({ revision: 7, token: 'unit', updatedAt: '2026-10-12T00:00:00Z', etag: '"test"' }) }))
vi.mock('@/lib/website/publicContracts', async original => ({ ...await original<typeof import('@/lib/website/publicContracts')>(), diagnosePublicContractOffers: ports.diagnose }))
import { GET } from '@/app/api/v1/contracts/route'
import { GET as canonicalGET } from '@/app/api/v1/public-contracts/route'
const document = JSON.parse(readFileSync('docs/openapi/website-integration-v1.json', 'utf8'))
const schema = document.paths['/api/v1/public-contracts'].get.responses['200'].content['application/json'].schema
const request = () => new NextRequest('https://app.gridex.se/api/v1/public-contracts?customer_type=private')
beforeEach(() => {
  vi.clearAllMocks()
  ports.rpc.mockResolvedValue({ data: [fixture.data[0]], error: null })
  ports.diagnose.mockResolvedValue({ total: 0, visible: 0, hidden: 0, offers: [] })
})
type JsonObject = Record<string, unknown>

function resolveSchema(document: JsonObject, schema: JsonObject): JsonObject {
  const reference = schema.$ref
  if (typeof reference !== 'string' || !reference.startsWith('#/')) return schema
  return reference
    .slice(2)
    .split('/')
    .reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object') return undefined
      return (current as JsonObject)[segment]
    }, document) as JsonObject
}

function validate(
  document: JsonObject,
  value: unknown,
  unresolvedSchema: JsonObject,
  path = '$',
): string[] {
  const schema = resolveSchema(document, unresolvedSchema)
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.flatMap((branch) =>
      validate(document, value, branch as JsonObject, path),
    )
  }
  const allowedTypes = Array.isArray(schema.type)
    ? schema.type
    : typeof schema.type === 'string'
      ? [schema.type]
      : []
  const type =
    value === null
      ? 'null'
      : Array.isArray(value)
        ? 'array'
        : typeof value
  if (
    allowedTypes.length > 0 &&
    !allowedTypes.includes(type) &&
    !(
      allowedTypes.includes('integer') &&
      type === 'number' &&
      Number.isInteger(value)
    )
  ) {
    return [`${path}: expected ${allowedTypes.join('|')}, got ${type}`]
  }
  const errors: string[] = []
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: const mismatch`)
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path}: enum mismatch`)
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      errors.push(
        ...validate(document, item, schema.items as JsonObject, `${path}[${index}]`),
      )
    })
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    const properties = (schema.properties ?? {}) as JsonObject
    for (const field of (schema.required ?? []) as string[]) {
      if (!Object.prototype.hasOwnProperty.call(object, field)) {
        errors.push(`${path}: missing ${field}`)
      }
    }
    if (schema.additionalProperties === false) {
      for (const field of Object.keys(object)) {
        if (!Object.prototype.hasOwnProperty.call(properties, field)) {
          errors.push(`${path}: additional property ${field}`)
        }
      }
    }
    for (const [field, item] of Object.entries(object)) {
      const childSchema = properties[field]
      if (childSchema && typeof childSchema === 'object') {
        errors.push(
          ...validate(
            document,
            item,
            childSchema as JsonObject,
            `${path}.${field}`,
          ),
        )
      }
    }
  }
  return errors
}


describe('mounted API contract feed business/schema integrity', () => {
  it('returns the same handler through its compatibility alias', () => { expect(canonicalGET).toBe(GET) })
  it('validates a populated actual handler DTO against the published response', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(validate(document, body, schema)).toEqual([])
    expect(body.meta.feed_state).toBe('contracts_present')
    expect(body.meta.empty_feed_authorization).toBeNull()
  })
  it('rejects the entire feed when a visible publication cannot be mapped', async () => {
    ports.rpc.mockResolvedValue({ data: [fixture.data[0], { offer_reference: null }], error: null })
    const response = await GET(request())
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.error.code).toBe('PUBLIC_CONTRACT_FEED_INCONSISTENT')
    expect(body.data).toBeUndefined()
  })
  it('authorizes canonical empty only from API-channel scoped diagnostics', async () => {
    ports.rpc.mockResolvedValue({ data: [], error: null })
    const response = await GET(request())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(validate(document, body, schema)).toEqual([])
    expect(body.meta.feed_state).toBe('canonical_empty')
    expect(body.meta.empty_feed_authorization).toMatchObject({ authorized: true, reason: 'no_canonical_publications', publication_revision: 7 })
    expect(ports.diagnose).toHaveBeenCalledWith({ client: expect.objectContaining({ company_id: 'company-test' }), customerType: 'private', channel: 'api' })
  })
  it('rejects an empty RPC feed if canonical diagnostics still report a visible offer', async () => {
    ports.rpc.mockResolvedValue({ data: [], error: null })
    ports.diagnose.mockResolvedValue({ total: 1, visible: 1, hidden: 0, offers: [] })
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('PUBLIC_CONTRACT_FEED_INCONSISTENT')
  })
})
