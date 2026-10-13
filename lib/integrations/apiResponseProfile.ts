import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { ApiInputError } from '@/lib/api/strictRequest'
import { canonicalApiError } from '@/lib/api/apiError'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { API_CONTRACT_PROFILE_REGISTRY, assessApiContractCompatibility, type ApiContractProfile, type ApiSurface } from '@/lib/integrations/apiContractCompatibility'
import { API_DOCUMENTATION_VERSION, WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'
import { STAFF_ONBOARDING_CONTRACT_VERSION } from '@/lib/staff-api/onboardingContract'
import websiteMinimum from '@/docs/openapi/releases/2026-10-02.3/website-integration-v1.json'
import customerMinimum from '@/docs/openapi/releases/2026-10-02.3/customer-portal-v1.json'
import websiteStaffRelease from '@/docs/openapi/releases/2026-10-04.1/website-integration-v1.json'
import customerStaffRelease from '@/docs/openapi/releases/2026-10-04.1/customer-portal-v1.json'
import staffFirst from '@/docs/openapi/releases/2026-10-04.1/staff-v1.json'

type RecordValue = Record<string, unknown>
type ProfileContext = { surface: ApiSurface; surfaces: readonly ApiSurface[]; profile: ApiContractProfile | null }
const profiles = new AsyncLocalStorage<ProfileContext>()
const historicalSpecifications: Record<string, unknown> = {
  'website:2026-10-02.3': websiteMinimum,
  'customer:2026-10-02.3': customerMinimum,
  'website:2026-10-04.1': websiteStaffRelease,
  'customer:2026-10-04.1': customerStaffRelease,
  'staff:2026-10-04.1': staffFirst,
}
function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null
}

/** Only an authenticated credential's operator-owned metadata selects a representation. */
export function bindAuthenticatedApiResponseProfile(client: IntegrationApiClient, options: { strict?: boolean } = {}): void {
  const context = profiles.getStore()
  if (!context) return
  const rawConfiguration = client.metadata?.api_contract_profiles
  const configured = record(rawConfiguration)
  if (rawConfiguration !== undefined && !configured) {
    if (options.strict === false) return
    throw new ApiInputError('The configured API representation is unavailable.', 'api_contract_profile_unavailable', 503)
  }
  context.surface = context.surfaces.find(surface => configured?.[surface] !== undefined) ?? context.surfaces[0]
  const revision = configured?.[context.surface]
  if (revision !== undefined && typeof revision !== 'string') {
    if (options.strict === false) return
    throw new ApiInputError('The configured API representation is unavailable.', 'api_contract_profile_unavailable', 503)
  }
  const result = assessApiContractCompatibility({ surface: context.surface, major: 'v1', clientProfile: revision ?? null,
    requiredCapabilities: [], registry: API_CONTRACT_PROFILE_REGISTRY })
  if (!result.ok) {
    if (options.strict === false) return
    throw new ApiInputError('The configured API representation is unavailable.', 'api_contract_profile_unavailable', 503)
  }
  context.profile = result.profile
}

export function currentApiResponseProfile(surface: ApiSurface): ApiContractProfile | null {
  const context = profiles.getStore()
  return context?.surface === surface ? context.profile : null
}

function resolveSchema(value: unknown, document: RecordValue): RecordValue {
  let schema = record(value) ?? {}
  for (let depth = 0; typeof schema.$ref === 'string'; depth += 1) {
    if (depth >= 32 || !schema.$ref.startsWith('#/')) throw new Error('api_profile_schema_reference_invalid')
    const resolved = schema.$ref.slice(2).split('/').reduce<unknown>((node, key) => record(node)?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], document)
    if (!record(resolved)) throw new Error('api_profile_schema_reference_missing')
    schema = { ...record(resolved), ...Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$ref')) }
  }
  return schema
}

/** Project only fields the qualified closed response schema accepts; never alter business validation. */
function projectResponse(value: unknown, rawSchema: unknown, document: RecordValue, revision: string, envelope = false): unknown {
  const schema = resolveSchema(rawSchema, document)
  if (Array.isArray(value)) return value.map(item => projectResponse(item, schema.items, document, revision))
  const source = record(value)
  if (!source) return value
  const properties = record(schema.properties) ?? {}
  const result: RecordValue = {}
  for (const [key, child] of Object.entries(source)) {
    if (schema.additionalProperties === false && !(key in properties)) continue
    const wireMarker = key === 'contract_schema_version' && (envelope || resolveSchema(properties[key], document).const === revision)
    result[key] = wireMarker ? revision : projectResponse(child, properties[key], document, revision)
  }
  return result
}

function operationSchema(document: RecordValue, request: NextRequest, status: number): unknown {
  for (const [path, item] of Object.entries(record(document.paths) ?? {})) {
    const parts = path.split('/')
    const actual = request.nextUrl.pathname.split('/')
    if (parts.length !== actual.length || !parts.every((part, index) => /^\{[^}]+\}$/.test(part) || part === actual[index])) continue
    const operation = record(record(item)?.[request.method.toLowerCase()])
    const response = resolveSchema(record(operation?.responses)?.[String(status)], document)
    const content = record(record(response.content)?.['application/json'])
    return content?.schema
  }
  return undefined
}

async function represent(response: Response, request: NextRequest, context: ProfileContext): Promise<Response> {
  const revision = context.profile?.revision ?? (context.surface === 'staff_onboarding' ? STAFF_ONBOARDING_CONTRACT_VERSION : WEBSITE_INTEGRATION_CONTRACT_VERSION)
  const headers = new Headers(response.headers)
  headers.set('X-Gridex-Contract-Version', revision)
  headers.set('X-Gridex-Documentation-Version', API_DOCUMENTATION_VERSION)
  const document = record(historicalSpecifications[`${context.surface}:${revision}`])
  if (!document || !headers.get('content-type')?.includes('application/json') || response.status === 204 || response.status === 304) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  }
  const body: unknown = await response.json()
  const schema = operationSchema(document, request, response.status)
  const projected = projectResponse(body, schema, document, revision, true)
  headers.delete('content-length')
  return Response.json(projected, { status: response.status, headers })
}

/** Request-local formatting context; a profile never grants authentication, scope or tenant access. */
export function withApiContractRepresentation<Args extends unknown[]>(surface: ApiSurface | readonly [ApiSurface, ...ApiSurface[]], handler: (request: NextRequest, ...args: Args) => Response | Promise<Response>) {
  const surfaces = typeof surface === 'string' ? [surface] : surface
  return (request: NextRequest, ...args: Args): Promise<Response> => profiles.run({ surface: surfaces[0], surfaces, profile: null }, async () => {
    const context = profiles.getStore()!
    try {
      return await represent(await handler(request, ...args), request, context)
    } catch (error) {
      if (!(error instanceof ApiInputError)) throw error
      const requestId = randomUUID()
      const response = Response.json({ ...canonicalApiError({ code: error.code, message: error.message, requestId }),
        contract_schema_version: WEBSITE_INTEGRATION_CONTRACT_VERSION }, { status: error.status, headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } })
      return represent(response, request, context)
    }
  })
}
