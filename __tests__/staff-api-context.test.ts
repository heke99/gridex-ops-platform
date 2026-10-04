import { generateKeyPairSync, sign, constants, randomUUID, type KeyObject } from 'node:crypto'
import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase/tenantQuery', () => ({ tenantSelect: vi.fn(), tenantInsert: vi.fn() }))
vi.mock('@/lib/supabase/tenantDb', () => ({ tenantDb: vi.fn() }))
vi.mock('@/lib/integrations/apiAuth', () => ({ requireIntegrationApiAccess: vi.fn() }))
import { createStaffApiContextResolver, staffPermissions, type StaffContextDependencies } from '@/lib/staff-api/context'
import { ALLOWED_INTEGRATION_API_SCOPE_VALUES, INTEGRATION_API_PERMISSION_GROUPS, recommendedPermissionGroups, scopesForPermissionGroups, STAFF_API_SCOPES } from '@/lib/integrations/apiClientScopes'
import type { CustomerIdentityProvider } from '@/lib/customer-portal/customerAssertion'

const company = '11111111-1111-4111-8111-111111111111'
const actor = '22222222-2222-4222-8222-222222222222'
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const provider: CustomerIdentityProvider = { id: randomUUID(), company_id: company, kind: 'tenant_key', display_name: 'Staff',
  issuer: `gridex-tenant:${company}`, audience: `gridex-staff-api:${company}`, jwks_uri: null, public_jwk: rsa.publicKey.export({ format: 'jwk' }), subject_claim: 'sub', enforcement: 'enforce' }
function token(changes: Record<string, unknown> = {}, alg = 'RS256', key: KeyObject = rsa.privateKey) {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ iss: provider.issuer, aud: provider.audience, sub: actor, iat: now, exp: now + 300, jti: randomUUID(), ...changes })).toString('base64url')
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
  }
  const resolve = createStaffApiContextResolver(ports)
  const call = (proof?: string, permission = 'customers.read') => resolve(new NextRequest('https://app.gridex.se/api/v1/staff/customers', { headers: proof ? { 'x-gridex-staff-assertion': proof } : {} }), { scopes: ['staff_customers.read'], permission })
  return { ports, call }
}

describe('staff API trust boundary', () => {
  it('requires explicit staff scope and never expands wildcard/customer/website grants', async () => {
    for (const scopes of [['*'], ['customer_portal.read'], ['website_contracts.read']]) {
      const { call, ports } = setup(scopes)
      await expect(call(token())).rejects.toMatchObject({ status: 403, code: 'api_scope_missing' })
      expect(ports.loadProvider).not.toHaveBeenCalled()
    }
  })
  it('rejects absent proof/provider without selecting any default actor', async () => {
    const { call, ports } = setup()
    await expect(call()).rejects.toMatchObject({ status: 401, code: 'staff_assertion_missing' })
    expect(ports.loadMembership).not.toHaveBeenCalled()
    vi.mocked(ports.loadProvider).mockResolvedValue(null)
    await expect(call(token())).rejects.toMatchObject({ status: 403, code: 'staff_provider_missing' })
  })
  it.each([
    ['issuer_mismatch', { iss: 'other-company' }], ['audience_mismatch', { aud: 'customer-api' }],
    ['subject_mismatch', { sub: 'not-a-user-id' }], ['malformed', { iat: undefined }],
    ['malformed', { exp: 1e100 }], ['lifetime_too_long', { exp: Math.floor(Date.now()/1000)+901 }],
  ])('rejects signed %s before membership lookup', async (reason, claims) => {
    const { call, ports } = setup()
    await expect(call(token(claims))).rejects.toMatchObject({ status: 401, code: `staff_assertion_${reason}` })
    expect(ports.loadMembership).not.toHaveBeenCalled()
  })
  it.each(['RS256', 'PS256', 'ES256'])('verifies %s and binds signed actor to exact company', async alg => {
    const { call, ports } = setup()
    if (alg === 'ES256') vi.mocked(ports.loadProvider).mockResolvedValue({ ...provider, public_jwk: ec.publicKey.export({ format: 'jwk' }) })
    const context = await call(token({}, alg, alg === 'ES256' ? ec.privateKey : rsa.privateKey))
    expect(context).toMatchObject({ companyId: company, actorUserId: actor })
    expect(ports.loadMembership).toHaveBeenCalledWith(company, actor)
    expect(ports.loadOverrides).toHaveBeenCalledWith(company, actor)
    expect(context.permissions).toContain('customers.read')
  })
  it('consumes signed jti once, including read requests', async () => {
    const { call } = setup(); const proof = token()
    await call(proof)
    await expect(call(proof)).rejects.toMatchObject({ status: 401, code: 'staff_assertion_replayed' })
  })
  it('rejects inactive or other-company membership', async () => {
    const { call, ports } = setup()
    vi.mocked(ports.loadMembership).mockResolvedValue(null)
    await expect(call(token())).rejects.toMatchObject({ status: 403, code: 'staff_membership_inactive' })
    vi.mocked(ports.loadMembership).mockResolvedValue({ user_id: actor, role_key: 'company_admin', membership_role: 'admin', status: 'disabled', is_active: false })
    await expect(call(token())).rejects.toMatchObject({ status: 403, code: 'staff_membership_inactive' })
  })
  it('recomputes current permission on every proof and applies deny overrides', async () => {
    const { call, ports } = setup()
    await expect(call(token(), 'users.write')).rejects.toMatchObject({ status: 403, code: 'staff_permission_denied' })
    vi.mocked(ports.loadOverrides).mockResolvedValue([{ permission_key: 'customers.read', effect: 'deny', status: 'active', is_active: true }])
    await expect(call(token())).rejects.toMatchObject({ status: 403, code: 'staff_permission_denied' })
    vi.mocked(ports.loadOverrides).mockResolvedValue([{ permission_key: 'users.write', effect: 'allow', status: 'active', is_active: true }])
    expect((await call(token(), 'users.write')).permissions).toContain('users.write')
  })
  it('does not import platform/global role authority into staff', () => {
    expect(staffPermissions({ user_id: actor, role_key: 'super_admin', membership_role: 'admin', status: 'active', is_active: true }, [])).toEqual([])
  })
  it.each([null, 'unknown_staff_role', 'customer', 'platform_admin', 'white_label_platform_admin'])('does not grant fallback or override authority to invalid staff role %s', role_key => {
    expect(staffPermissions({ user_id: actor, role_key, membership_role: 'admin', status: 'active', is_active: true }, [
      { permission_key: 'users.write', effect: 'allow', status: 'active', is_active: true },
    ])).toEqual([])
  })
})

it('staff scopes are additive and opt-in only', () => {
  expect(STAFF_API_SCOPES.every(scope => ALLOWED_INTEGRATION_API_SCOPE_VALUES.has(scope))).toBe(true)
  expect(scopesForPermissionGroups(recommendedPermissionGroups()).some(scope => scope.startsWith('staff_'))).toBe(false)
  expect(INTEGRATION_API_PERMISSION_GROUPS.filter(group => group.category !== 'staff').flatMap(group => group.scopes).some(scope => scope.startsWith('staff_'))).toBe(false)
})
