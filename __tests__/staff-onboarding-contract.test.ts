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
    expect(document.info.version).toBe('2026-10-05.1')
    expect(document.paths['/api/v1/staff-onboarding/invitations/accept'].post.security).toEqual([{ bearerAuth: [], staffAssertion: [], supportAuthToken: [] }])
    expect(document.paths['/api/v1/staff-onboarding/invitations/accept'].post.parameters).toContainEqual(expect.objectContaining({ name: 'x-gridex-expected-project-ref', required: true }))
  })
  it('serves the separate spec with its own version and ETag, while the real POST rejects a Dev backend', async () => {
    const response = await GET(new NextRequest('https://app.gridex.se/api/v1/openapi/staff-onboarding-v1.json'))
    expect(response.status).toBe(200)
    expect(response.headers.get('x-gridex-contract-version')).toBe('2026-10-05.1')
    expect((await response.json()).info.version).toBe(document.info.version)
    const blocked = await POST(new NextRequest('https://app.gridex.se/api/v1/staff-onboarding/invitations/accept', { method: 'POST' }))
    expect(blocked.status).toBe(412)
    expect(validateResponse(document, '/api/v1/staff-onboarding/invitations/accept', await blocked.json(), 'post', '412')).toEqual([])
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
    expect(createHash('sha256').update(current).digest('hex')).toBe(createHash('sha256').update(frozen).digest('hex'))
    const manifest = buildOpenApiReleaseManifest()
    expect(JSON.stringify(manifest)).not.toContain('staff-onboarding')
    expect(JSON.stringify(JSON.parse(frozen.toString()).paths)).not.toContain('staff-onboarding')
  })
})
