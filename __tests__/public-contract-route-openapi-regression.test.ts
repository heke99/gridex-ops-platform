import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import publicContractsFixture from '@/docs/fixtures/public-contracts-response-2026-08-04.3.json'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

const mocks = vi.hoisted(() => ({
  logIntegrationApiRequest: vi.fn(async () => undefined),
  currentIntegrationApiResponseContext: vi.fn(() => ({
    rateLimit: { limit: 100, count: 1, remaining: 99, resetAt: null },
  })),
  scheduleUsageEvent: vi.fn(async () => undefined),
  listPublicContractOffers: vi.fn(),
  diagnosePublicContractOffers: vi.fn(),
  publicContractResponse: vi.fn(),
  publicContractFingerprint: vi.fn(async () => ({
    data: [{ fingerprint: 'a'.repeat(32) }],
    error: null,
  })),
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { rpc: mocks.publicContractFingerprint },
}))

vi.mock('@/lib/integrations/apiAuth', () => ({
  currentIntegrationApiResponseContext:
    mocks.currentIntegrationApiResponseContext,
  logIntegrationApiRequest: mocks.logIntegrationApiRequest,
  requireIntegrationApiAccess: vi.fn(async () => ({
    ok: true,
    client: {
      id: '00000000-0000-4000-8000-000000000020',
      company_id: '00000000-0000-4000-8000-000000000021',
      scopes: ['website_contracts.read'],
    },
    context: {
      companyId: '00000000-0000-4000-8000-000000000021',
      actorType: 'integration',
      actorId: '00000000-0000-4000-8000-000000000020',
      permissions: [],
      scopes: ['website_contracts.read'],
      correlationId: '00000000-0000-4000-8000-000000000022',
      sourceChannel: 'partner_api',
    },
    rateLimit: { limit: 100, remaining: 99, resetAt: null },
  })),
}))

vi.mock('@/lib/integrations/tenantContext', () => ({
  loadExternalTenantContext: vi.fn(async () => ({
    tenant_reference: publicContractsFixture.meta.tenant_reference,
  })),
  ExternalTenantContextError: class ExternalTenantContextError extends Error {},
}))

vi.mock('@/lib/audit/actionLogger', () => ({
  scheduleUsageEvent: mocks.scheduleUsageEvent,
}))

vi.mock('@/lib/website/publicContracts', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/lib/website/publicContracts')
  >()
  return {
    ...actual,
    listPublicContractOffers: mocks.listPublicContractOffers,
    diagnosePublicContractOffers: mocks.diagnosePublicContractOffers,
    publicContractResponse: mocks.publicContractResponse,
  }
})

vi.mock('@/lib/website/publicContractApi', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/lib/website/publicContractApi')
  >()
  return {
    ...actual,
    loadPublicationRevision: vi.fn(async () => ({
      etag: '"contracts-test"',
      revision: publicContractsFixture.meta.publication_revision,
      updatedAt: publicContractsFixture.meta.publication_updated_at,
    })),
    requestId: vi.fn(() => publicContractsFixture.request_id),
  }
})

import { GET as getPublicContracts } from '@/app/api/v1/website/public-contracts/route'
import { GET as getPublishedOpenApi } from '@/app/api/v1/openapi/website-integration-v1.json/route'

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

describe('real public contracts route against published OpenAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listPublicContractOffers.mockResolvedValue([{}])
    mocks.diagnosePublicContractOffers.mockResolvedValue(null)
    mocks.publicContractResponse.mockReturnValue(publicContractsFixture.data[0])
  })

  it('validates the actual route response and headers against the actual OpenAPI route', async () => {
    const request = new NextRequest(
      'https://app.gridex.se/api/v1/website/public-contracts?customer_type=private',
      { headers: { Authorization: 'Bearer test-only-token' } },
    )
    const runtimeResponse = await getPublicContracts(request)
    expect(runtimeResponse.status).toBe(200)
    expect(runtimeResponse.headers.get('x-gridex-contract-version')).toBe(
      WEBSITE_INTEGRATION_CONTRACT_VERSION,
    )
    expect(runtimeResponse.headers.get('etag')).toBe(`"pcf-${'a'.repeat(32)}"`)
    expect(runtimeResponse.headers.get('cache-control')).toBe(
      'private, no-store, max-age=0',
    )
    expect(runtimeResponse.headers.get('pragma')).toBe('no-cache')
    expect(runtimeResponse.headers.get('expires')).toBe('0')
    expect(runtimeResponse.headers.get('x-request-id')).toBe(
      publicContractsFixture.request_id,
    )
    const runtimeBody = (await runtimeResponse.json()) as JsonObject

    const openApiResponse = await getPublishedOpenApi(
      new NextRequest(
        'https://app.gridex.se/api/v1/openapi/website-integration-v1.json',
      ),
    )
    expect(openApiResponse.status).toBe(200)
    expect(openApiResponse.headers.get('x-gridex-contract-version')).toBe(
      WEBSITE_INTEGRATION_CONTRACT_VERSION,
    )
    const openApi = (await openApiResponse.json()) as JsonObject
    const schema = (
      (((openApi.paths as JsonObject)[
        '/api/v1/website/public-contracts'
      ] as JsonObject).get as JsonObject).responses as JsonObject
    )['200'] as JsonObject
    const responseSchema = (((schema.content as JsonObject)[
      'application/json'
    ] as JsonObject).schema ?? {}) as JsonObject

    expect(validate(openApi, runtimeBody, responseSchema)).toEqual([])
    const contracts = runtimeBody.data as Array<JsonObject>
    expect(contracts).toHaveLength(1)
    const option = (contracts[0]?.price_options as Array<JsonObject>)[0]
    expect(option?.is_default).toBe(true)
    expect(option?.default).toBe(option?.is_default)
    expect(option?.area_prices).toEqual([])
    const legal = contracts[0]?.legal as JsonObject
    const bundleId = legal.legal_bundle_version_id
    expect(bundleId).toBeTruthy()
    expect(
      (legal.module_versions as Array<JsonObject>).every(
        (legalModule) => legalModule.legal_bundle_version_id === bundleId,
      ),
    ).toBe(true)
  })

  it('fails the entire feed when one visible contract cannot be serialized', async () => {
    mocks.listPublicContractOffers.mockResolvedValue([{ id: 'valid' }, { id: 'invalid' }])
    mocks.publicContractResponse.mockImplementation((offer: { id?: string }) =>
      offer.id === 'valid'
        ? publicContractsFixture.data[0]
        : { ...publicContractsFixture.data[0], offer_reference: null, id: null },
    )

    const response = await getPublicContracts(
      new NextRequest(
        'https://app.gridex.se/api/v1/website/public-contracts?customer_type=private',
        { headers: { Authorization: 'Bearer test-only-token' } },
      ),
    )
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.error.code).toBe('PUBLIC_CONTRACT_FEED_INCONSISTENT')
    expect(body.error.details ?? body.error.affected_contracts).not.toEqual([])
    expect(body.data).toBeUndefined()
  })
})
