// ops-api-review: F1 (permanent regression from evidence/staff-lifecycle.probe.ts)
import { generateKeyPairSync, sign, constants, randomUUID, type KeyObject } from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase/tenantQuery', () => ({ tenantSelect: vi.fn(), tenantInsert: vi.fn() }))
vi.mock('@/lib/supabase/tenantDb', () => ({ tenantDb: vi.fn() }))
vi.mock('@/lib/integrations/apiAuth', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), requireIntegrationApiAccess: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ SUPABASE_SERVICE_URL: 'https://piidsfebjqjmnepdpnas.supabase.co', supabaseService: {} }))
import { createStaffApiContextResolver, staffPermissions, type StaffContextDependencies } from '@/lib/staff-api/context'
import { ALLOWED_INTEGRATION_API_SCOPE_VALUES, INTEGRATION_API_PERMISSION_GROUPS, recommendedPermissionGroups, scopesForPermissionGroups, STAFF_API_SCOPES } from '@/lib/integrations/apiClientScopes'
import type { CustomerIdentityProvider } from '@/lib/customer-portal/customerAssertion'

const company = '11111111-1111-4111-8111-111111111111'
const actor = '22222222-2222-4222-8222-222222222222'
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const provider: CustomerIdentityProvider = { id: randomUUID(), company_id: company, kind: 'tenant_key', display_name: 'Staff',
  issuer: `gridex-tenant:${company}`, audience: `gridex-staff-api:${company}`, jwks_uri: null, public_jwk: rsa.publicKey.export({ format: 'jwk' }), subject_claim: 'sub', enforcement: 'enforce' }
type AssertionClaims = Record<string, unknown> | ((issuedAt: number) => Record<string, unknown>)
function token(changes: AssertionClaims = {}, alg = 'RS256', key: KeyObject = rsa.privateKey) {
  const now = Math.floor(Date.now() / 1000)
  const claims = typeof changes === 'function' ? changes(now) : changes
  const header = Buffer.from(JSON.stringify({ alg })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ iss: provider.issuer, aud: provider.audience, sub: actor, iat: now, exp: now + 300, jti: randomUUID(), ...claims })).toString('base64url')
  const signed = Buffer.from(`${header}.${payload}`)
  const signature = sign('sha256', signed, alg === 'PS256' ? { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 } : alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key)
  return `${header}.${payload}.${signature.toString('base64url')}`
}
function setup(scopes = ['staff_customers.read']) {
  const seen = new Set<string>()
  const ports: StaffContextDependencies = {
    apiAccess: vi.fn(async () => ({ ok: true, client: { id: randomUUID(), company_id: company, scopes }, context: {}, rateLimit: {} })) as unknown as StaffContextDependencies['apiAccess'],
    loadProvider: vi.fn(async () => provider),
    loadMembership: vi.fn(async () => ({ user_id: actor, role_key: 'customer_service_agent', membership_role: 'support', status: 'active', is_active: true })),
    loadOverrides: vi.fn(async () => []),
    consumeJti: vi.fn(async (_company, jti) => { if (seen.has(jti)) return false; seen.add(jti); return true }),
    validateBinding: vi.fn(async () => null),
    isHistoricallyExternal: vi.fn(async () => false),
  }
  const resolve = createStaffApiContextResolver(ports)
  const call = (proof?: string, permission = 'customers.read') => resolve(new NextRequest('https://app.gridex.se/api/v1/staff/customers', { headers: proof ? { 'x-gridex-staff-assertion': proof, authorization: 'Bearer synthetic-api-key' } : {} }), { scopes: ['staff_customers.read'], permission })
  return { ports, call }
}

describe('F1: removed external registration never falls back to legacy reads', () => {
  it('denies an actor with a durable external anchor/binding when client metadata no longer has staff_tenant_auth', async () => {
    const { call, ports } = setup()
    vi.mocked(ports.isHistoricallyExternal).mockResolvedValue(true)
    await expect(call(token())).rejects.toMatchObject({ code: 'staff_identity_registration_removed', status: 403 })
    expect(ports.isHistoricallyExternal).toHaveBeenCalledWith(company, expect.any(String), actor)
    expect(ports.loadMembership).not.toHaveBeenCalled()
  })
  it('keeps genuine legacy central identities working', async () => {
    const { call, ports } = setup()
    await expect(call(token())).resolves.toMatchObject({ companyId: company, actorUserId: actor })
    expect(ports.isHistoricallyExternal).toHaveBeenCalledTimes(1)
  })
})
