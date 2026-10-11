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

describe('staff API trust boundary', () => {
  it.each(['staff_identity_resolution', 'staff_invitation_acceptance', 'unrecognized_purpose'])('refuses signed %s proof on ordinary Staff routes before membership', async token_use => {
    const { call, ports } = setup()
    await expect(call(token({ token_use }))).rejects.toMatchObject({ status: 401, code: 'staff_assertion_purpose_invalid' })
    expect(ports.loadMembership).not.toHaveBeenCalled()
  })
  it('requires an explicit current local-to-central binding for independent registered clients and preserves the central actor sub', async () => {
    const { call, ports } = setup()
    const initial = await ports.apiAccess(new NextRequest('https://app.gridex.se/api/v1/staff/customers'), [])
    if (!initial.ok) throw new Error('Missing synthetic API fixture')
    const local = '33333333-3333-4333-8333-333333333333', binding = '44444444-4444-4444-8444-444444444444'
    const client = { ...initial.client, name: 'Synthetic tenant', key_prefix: 'synthetic', secret_hash: '', rate_limit_per_minute: 60, allowed_ips: [], status: 'active', expires_at: null,
      allowed_origins: ['https://support123.gridex.se'], metadata: { staff_onboarding_origin: 'https://support123.gridex.se', staff_tenant_auth: { url: 'https://ayiuxjlfazkjmmtlvhsl.supabase.co', public_key: 'sb_publishable_synthetic_public_key_1234567890' } } }
    vi.mocked(ports.apiAccess).mockResolvedValue({ ...initial, client })
    await expect(call(token())).rejects.toMatchObject({ status: 401, code: 'staff_identity_binding_invalid' })
    expect(ports.loadMembership).not.toHaveBeenCalled()
    vi.mocked(ports.validateBinding).mockResolvedValue({ actor_user_id: actor, binding_id: binding, binding_version: 1 })
    const claims = { token_use: 'staff_access', company_id: company, staff_binding_id: binding, staff_binding_version: 1, local_auth_subject: local, local_auth_issuer: 'https://ayiuxjlfazkjmmtlvhsl.supabase.co/auth/v1' }
    expect(await call(token(claims))).toMatchObject({ actorUserId: actor, companyId: company })
    expect(ports.validateBinding).toHaveBeenCalledWith(expect.objectContaining({ company_id: company, actor_user_id: actor, local_user_id: local, binding_id: binding, binding_version: 1,
      local_auth_issuer: claims.local_auth_issuer, verified_client: expect.objectContaining({ staff_tenant_auth: client.metadata.staff_tenant_auth }) }))
    vi.mocked(ports.loadMembership).mockClear()
    vi.mocked(ports.validateBinding).mockResolvedValue(null)
    await expect(call(token(claims))).rejects.toMatchObject({ status: 403, code: 'staff_identity_binding_invalid' })
    expect(ports.loadMembership).not.toHaveBeenCalled()
  })
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
    ['malformed', { exp: 1e100 }], ['lifetime_too_long', (issuedAt: number) => ({ exp: issuedAt + 901 })],
  ])('rejects signed %s before membership lookup', async (reason, claims) => {
    const { call, ports } = setup()
    await expect(call(token(claims))).rejects.toMatchObject({ status: 401, code: `staff_assertion_${reason}` })
    expect(ports.loadMembership).not.toHaveBeenCalled()
  })
  it.each([1, 120])('keeps the signed 900/901-second lifetime boundary after a %s-second minting delay, cold and warm', async delay => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const collectedAt = new Date('2026-10-04T12:00:00.999Z').getTime()
      vi.setSystemTime(collectedAt)
      // Define the fixture before minting is delayed, as a full suite does.
      const overlong: AssertionClaims = issuedAt => ({ exp: issuedAt + 901 })
      const allowed: AssertionClaims = issuedAt => ({ exp: issuedAt + 900 })
      const { call, ports } = setup()
      vi.setSystemTime(collectedAt + delay * 1000)

      await expect(call(token(overlong))).rejects.toMatchObject({ status: 401, code: 'staff_assertion_lifetime_too_long' })
      expect(ports.loadMembership).not.toHaveBeenCalled()
      expect(ports.consumeJti).not.toHaveBeenCalled()

      await expect(call(token(allowed))).resolves.toMatchObject({ companyId: company, actorUserId: actor })
      expect(ports.loadMembership).toHaveBeenCalledWith(company, actor)
      expect(ports.consumeJti).toHaveBeenCalledOnce()
      vi.mocked(ports.loadMembership).mockClear()
      vi.mocked(ports.consumeJti).mockClear()

      await expect(call(token(overlong))).rejects.toMatchObject({ status: 401, code: 'staff_assertion_lifetime_too_long' })
      expect(ports.loadMembership).not.toHaveBeenCalled()
      expect(ports.consumeJti).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
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

describe('staff API signed assertion time boundary', () => {
  const nowSeconds = Date.parse('2026-10-04T12:00:00Z') / 1000
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(nowSeconds * 1000)
  })
  afterEach(() => vi.useRealTimers())

  it.each([0, -60])('rejects future iat even when nbf is %s seconds from now', async nbfOffset => {
    const { call, ports } = setup()
    await expect(call(token({ iat: nowSeconds + 86400, nbf: nowSeconds + nbfOffset, exp: nowSeconds + 87300 })))
      .rejects.toMatchObject({ status: 401, code: 'staff_assertion_not_yet_valid' })
    expect(ports.consumeJti).not.toHaveBeenCalled()
    expect(ports.loadMembership).not.toHaveBeenCalled()
  })

  it.each([
    { iat: 61, nbf: 0, exp: 961 },
    { iat: 61, nbf: undefined, exp: 961 },
    { iat: 0, nbf: 61, exp: 900 },
  ])('rejects iat/nbf beyond the 60-second skew: %j', async offsets => {
    const { call, ports } = setup()
    await expect(call(token({ iat: nowSeconds + offsets.iat, nbf: offsets.nbf === undefined ? undefined : nowSeconds + offsets.nbf, exp: nowSeconds + offsets.exp })))
      .rejects.toMatchObject({ status: 401, code: 'staff_assertion_not_yet_valid' })
    expect(ports.consumeJti).not.toHaveBeenCalled()
    expect(ports.loadMembership).not.toHaveBeenCalled()
  })

  it.each([
    { iat: 60, nbf: 0, exp: 960 },
    { iat: 0, nbf: -1, exp: 900 },
    { iat: 0, nbf: -86400, exp: 900 },
    { iat: 0, nbf: undefined, exp: 901 },
  ])('rejects more than 900 seconds from the earliest iat/nbf: %j', async offsets => {
    const { call, ports } = setup()
    await expect(call(token({ iat: nowSeconds + offsets.iat, nbf: offsets.nbf === undefined ? undefined : nowSeconds + offsets.nbf, exp: nowSeconds + offsets.exp })))
      .rejects.toMatchObject({ status: 401, code: 'staff_assertion_lifetime_too_long' })
    expect(ports.consumeJti).not.toHaveBeenCalled()
    expect(ports.loadMembership).not.toHaveBeenCalled()
  })

  it.each([
    { iat: 0, nbf: undefined, exp: 900 },
    { iat: 0, nbf: 0, exp: 900 },
    { iat: 60, nbf: undefined, exp: 960 },
    { iat: 60, nbf: 60, exp: 960 },
    { iat: 60, nbf: 0, exp: 900 },
    { iat: 0, nbf: 60, exp: 900 },
    { iat: -959, nbf: undefined, exp: -59 },
  ])('accepts a 900-second validity window within skew and retains jti through expiry skew: %j', async offsets => {
    const { call, ports } = setup()
    const jti = randomUUID()
    const proof = token({ iat: nowSeconds + offsets.iat, nbf: offsets.nbf === undefined ? undefined : nowSeconds + offsets.nbf, exp: nowSeconds + offsets.exp, jti })
    expect(await call(proof)).toMatchObject({ companyId: company, actorUserId: actor })
    expect(ports.consumeJti).toHaveBeenCalledWith(company, jti, new Date((nowSeconds + offsets.exp + 60) * 1000))
    await expect(call(proof)).rejects.toMatchObject({ status: 401, code: 'staff_assertion_replayed' })
  })

  it('rejects expiry at the 60-second skew boundary before consuming jti', async () => {
    const { call, ports } = setup()
    await expect(call(token({ iat: nowSeconds - 960, exp: nowSeconds - 60 })))
      .rejects.toMatchObject({ status: 401, code: 'staff_assertion_expired' })
    expect(ports.consumeJti).not.toHaveBeenCalled()
    expect(ports.loadMembership).not.toHaveBeenCalled()
  })
})

it('staff scopes are additive and opt-in only', () => {
  expect(STAFF_API_SCOPES.every(scope => ALLOWED_INTEGRATION_API_SCOPE_VALUES.has(scope))).toBe(true)
  expect(scopesForPermissionGroups(recommendedPermissionGroups()).some(scope => scope.startsWith('staff_'))).toBe(false)
  expect(INTEGRATION_API_PERMISSION_GROUPS.filter(group => group.category !== 'staff').flatMap(group => group.scopes).some(scope => scope.startsWith('staff_'))).toBe(false)
})
