import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('@/lib/supabase/service', () => ({ SUPABASE_SERVICE_URL: 'https://piidsfebjqjmnepdpnas.supabase.co', supabaseService: {} }))
vi.mock('@/lib/integrations/apiAuth', () => ({ requireIntegrationApiAccess: vi.fn(), logIntegrationApiRequest: vi.fn() }))
import document from '@/docs/openapi/staff-onboarding-v1.json'
import { publicRouteContract } from '@/lib/api/publicRouteRegistry'
import { GET } from '@/app/api/v1/openapi/staff-onboarding-v1.json/route'
import { POST } from '@/app/api/v1/staff-onboarding/invitations/accept/route'
import { POST as resolveIdentity } from '@/app/api/v1/staff-onboarding/identity/resolve/route'
import { buildOpenApiReleaseManifest } from '@/lib/integrations/openApiReleaseManifest'
const { validateSchema, validateResponse } = createRequire(import.meta.url)('../scripts/lib/openapi-schema-validator.cjs')

describe('independent onboarding public contract parity', () => {
  it('registers exact separately versioned POST and OpenAPI routes with isolated security requirements', () => {
    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        const route = publicRouteContract(method, path)
        expect(route?.operationId).toBe(operation.operationId)
        expect(route?.scopes).toEqual(operation['x-required-scopes'])
        expect(route?.idempotencyRequired === true).toBe(operation['x-idempotency-required'])
      }
    }
    expect(document.info.version).toBe('2026-10-05.2')
    expect(document.paths['/api/v1/staff-onboarding/invitations/accept'].post.security).toEqual([{ bearerAuth: [], staffAssertion: [], supportAuthToken: [] }])
    expect(document.paths['/api/v1/staff-onboarding/invitations/accept'].post.parameters).toContainEqual(expect.objectContaining({ name: 'x-gridex-expected-project-ref', required: true }))
    expect(document.paths['/api/v1/staff-onboarding/identity/resolve'].post.security).toEqual([{ bearerAuth: [], staffAssertion: [], supportAuthToken: [] }])
    expect(publicRouteContract('POST', '/api/v1/staff-onboarding/identity/resolve')?.publicIdPolicy).toBe('staff-identities-and-opaque-references')
  })
  it('serves the separate spec while both real POST routes require an explicit central project expectation', async () => {
    const response = await GET(new NextRequest('https://app.gridex.se/api/v1/openapi/staff-onboarding-v1.json'))
    expect(response.status).toBe(200)
    expect(response.headers.get('x-gridex-contract-version')).toBe('2026-10-05.2')
    expect((await response.json()).info.version).toBe(document.info.version)
    const blocked = await POST(new NextRequest('https://app.gridex.se/api/v1/staff-onboarding/invitations/accept', { method: 'POST' }))
    expect(blocked.status).toBe(412)
    expect(validateResponse(document, '/api/v1/staff-onboarding/invitations/accept', await blocked.json(), 'post', '412')).toEqual([])
    const unresolved = await resolveIdentity(new NextRequest('https://app.gridex.se/api/v1/staff-onboarding/identity/resolve', { method: 'POST' }))
    expect(unresolved.status).toBe(412)
    expect(validateResponse(document, '/api/v1/staff-onboarding/identity/resolve', await unresolved.json(), 'post', '412')).toEqual([])
  })
  it('closes identity request and binding response schemas without browser-selected authority or credentials', () => {
    const schemas = document.components.schemas
    expect(validateSchema(document, {}, schemas.StaffIdentityResolveRequest)).toEqual([])
    for (const name of ['company_id', 'actor_user_id', 'local_user_id', 'email', 'auth_url', 'role_key']) {
      expect(validateSchema(document, { [name]: 'browser authority' }, schemas.StaffIdentityResolveRequest)).not.toEqual([])
    }
    const data = { actor_user_id: '11111111-1111-4111-8111-111111111111', binding_id: '22222222-2222-4222-8222-222222222222', binding_version: 1 }
    const envelope = { data, request_id: 'synthetic-1', contract_schema_version: document.info.version }
    expect(validateResponse(document, '/api/v1/staff-onboarding/identity/resolve', envelope, 'post')).toEqual([])
    for (const name of ['email', 'access_token', 'secret_hash', 'public_key', 'company_id']) {
      expect(validateResponse(document, '/api/v1/staff-onboarding/identity/resolve', { ...envelope, data: { ...data, [name]: 'private' } }, 'post')).not.toEqual([])
    }
    for (const binding_version of [0, 1.5, '1']) {
      expect(validateResponse(document, '/api/v1/staff-onboarding/identity/resolve', { ...envelope, data: { ...data, binding_version } }, 'post')).not.toEqual([])
    }
  })
  it('preserves the original 5.1 prototype separately without treating its tenant/Auth assumption as current', () => {
    const historical = JSON.parse(readFileSync('docs/openapi/prototypes/2026-10-05.1/staff-onboarding-v1.json', 'utf8'))
    expect(historical.info.version).toBe('2026-10-05.1')
    expect(historical.paths['/api/v1/staff-onboarding/invitations/accept'].post.parameters[0].schema.enum).toEqual(['ayiuxjlfazkjmmtlvhsl'])
    expect(document.paths['/api/v1/staff-onboarding/invitations/accept'].post.parameters[0].schema).toEqual({ type: 'string', pattern: '^[a-z0-9]{20}$' })
  })
  it('uses closed request/response schemas that reject browser role/identity, secrets and internal IDs', () => {
    const schemas = document.components.schemas
    const request = { invitation_token: '11111111-1111-4111-8111-111111111111' }
    expect(validateSchema(document, request, schemas.StaffOnboardingAcceptRequest)).toEqual([])
    for (const field of ['company_id', 'user_id', 'role_key', 'callback_url']) expect(validateSchema(document, { ...request, [field]: 'private' }, schemas.StaffOnboardingAcceptRequest)).not.toEqual([])
    const response = { data: { status: 'accepted' }, request_id: 'request-1', contract_schema_version: document.info.version }
    expect(validateResponse(document, '/api/v1/staff-onboarding/invitations/accept', response, 'post')).toEqual([])
    for (const field of ['company_id', 'user_id', 'access_token', 'invitation_token']) expect(validateResponse(document, '/api/v1/staff-onboarding/invitations/accept', { ...response, data: { ...response.data, [field]: 'private' } }, 'post')).not.toEqual([])
  })
  it('does not alter or include onboarding in the frozen Staff API release or its release manifest', () => {
    const frozen = readFileSync('docs/openapi/releases/2026-10-04.1/staff-v1.json')
    const current = readFileSync('docs/openapi/staff-v1.json')
    // The current Staff document is the frozen bytes of the current release; earlier releases stay frozen.
    const currentRelease = readFileSync(`docs/openapi/releases/${JSON.parse(current.toString()).info.version}/staff-v1.json`)
    expect(createHash('sha256').update(current).digest('hex')).toBe(createHash('sha256').update(currentRelease).digest('hex'))
    expect(JSON.stringify(JSON.parse(current.toString()).paths)).not.toContain('staff-onboarding')
    const manifest = buildOpenApiReleaseManifest()
    expect(JSON.stringify(manifest)).not.toContain('staff-onboarding')
    expect(JSON.stringify(JSON.parse(frozen.toString()).paths)).not.toContain('staff-onboarding')
  })
})
