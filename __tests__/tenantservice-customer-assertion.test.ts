import { generateKeyPairSync, randomUUID, sign, constants, type KeyObject } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/tenantQuery', () => ({ tenantSelect: vi.fn(), tenantInsert: vi.fn() }))

const COMPANY = '00000000-0000-4000-8000-0000000000a1'
const PORTAL_USER = 'portal-user-123'

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const other = generateKeyPairSync('rsa', { modulusLength: 2048 })

function jwk(key: KeyObject, kid: string) {
  return { ...(key.export({ format: 'jwk' }) as Record<string, unknown>), kid }
}

function token(alg: 'RS256' | 'PS256' | 'ES256' | 'HS256' | 'none', claims: Record<string, unknown>, privateKey: KeyObject = rsa.privateKey, kid = 'k1') {
  const header = Buffer.from(JSON.stringify({ alg, typ: 'JWT', kid })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const input = Buffer.from(`${header}.${payload}`)
  let signature = Buffer.alloc(0)
  if (alg === 'RS256') signature = sign('sha256', input, privateKey)
  if (alg === 'PS256') signature = sign('sha256', input, { key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 })
  if (alg === 'ES256') signature = sign('sha256', input, { key: privateKey, dsaEncoding: 'ieee-p1363' })
  if (alg === 'HS256') signature = Buffer.from('secret')
  return `${header}.${payload}.${signature.toString('base64url')}`
}

const now = () => Math.floor(Date.now() / 1000)
const claims = (overrides: Record<string, unknown> = {}) => ({
  iss: 'https://login.tenant.example', aud: 'gridex-customer-api', sub: PORTAL_USER, iat: now(), exp: now() + 300, jti: randomUUID(), amr: ['bankid'], ...overrides,
})

const tenantKeyProvider = {
  id: 'p1', company_id: COMPANY, kind: 'tenant_key' as const, display_name: 'Egen inloggning', issuer: 'https://login.tenant.example',
  audience: 'gridex-customer-api', jwks_uri: null, public_jwk: jwk(rsa.publicKey, 'k1'), subject_claim: 'sub', enforcement: 'enforce' as const,
}

let seen: Set<string>
const consumeJti = async (jti: string) => { if (seen.has(jti)) return false; seen.add(jti); return true }

beforeEach(async () => {
  seen = new Set()
  const mod = await import('@/lib/customer-portal/customerAssertion')
  mod.resetJwksCacheForTests()
  mod.resetCustomerIdentityProviderCache()
})

async function verify(tokenValue: string | null, provider: Parameters<typeof import('@/lib/customer-portal/customerAssertion')['verifyCustomerAssertion']>[0]['provider'] = tenantKeyProvider, fetchImpl?: typeof fetch) {
  const { verifyCustomerAssertion } = await import('@/lib/customer-portal/customerAssertion')
  return verifyCustomerAssertion({ token: tokenValue, provider, expectedSubject: PORTAL_USER, consumeJti, fetchImpl })
}

describe('verifyCustomerAssertion (P1c)', () => {
  it('accepts RS256, PS256 and ES256 from the registered public key and reports the login method', async () => {
    expect(await verify(token('RS256', claims()))).toMatchObject({ ok: true, subject: PORTAL_USER, method: 'bankid' })
    expect(await verify(token('PS256', claims()))).toMatchObject({ ok: true })
    const ecProvider = { ...tenantKeyProvider, public_jwk: jwk(ec.publicKey, 'k1') }
    expect(await verify(token('ES256', claims(), ec.privateKey), ecProvider)).toMatchObject({ ok: true })
  })

  it.each([
    ['missing', null],
    ['malformed', 'not-a-jwt'],
    ['algorithm_not_allowed', token('HS256', claims())],
    ['algorithm_not_allowed', token('none', claims())],
  ])('rejects %s', async (reason, value) => {
    expect(await verify(value)).toEqual({ ok: false, reason })
  })

  it('rejects a signature from another key and a tampered payload', async () => {
    expect(await verify(token('RS256', claims(), other.privateKey))).toEqual({ ok: false, reason: 'signature_invalid' })
    const [h, , s] = token('RS256', claims()).split('.')
    const forged = Buffer.from(JSON.stringify(claims({ sub: 'someone-else' }))).toString('base64url')
    expect(await verify(`${h}.${forged}.${s}`)).toEqual({ ok: false, reason: 'signature_invalid' })
  })

  it.each([
    ['issuer_mismatch', { iss: 'https://evil.example' }],
    ['audience_mismatch', { aud: 'another-api' }],
    ['expired', { iat: now() - 900, exp: now() - 120 }],
    ['not_yet_valid', { iat: now() + 600, exp: now() + 700 }],
    ['lifetime_too_long', { exp: now() + 3600 }],
    ['subject_mismatch', { sub: 'another-portal-user' }],
    ['jti_missing', { jti: undefined }],
  ])('rejects %s', async (reason, override) => {
    expect(await verify(token('RS256', claims(override)))).toEqual({ ok: false, reason })
  })

  it('accepts each assertion once (replay protection)', async () => {
    const value = token('RS256', claims())
    expect(await verify(value)).toMatchObject({ ok: true })
    expect(await verify(value)).toEqual({ ok: false, reason: 'replayed' })
  })

  it('OIDC: picks the key by kid from the provider JWKS, never a private key', async () => {
    const jwks = { keys: [{ ...jwk(other.publicKey, 'old') }, { ...jwk(rsa.publicKey, 'k1') }] }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(jwks), { status: 200 })) as unknown as typeof fetch
    const oidc = { ...tenantKeyProvider, kind: 'oidc' as const, public_jwk: null, jwks_uri: 'https://login.tenant.example/.well-known/jwks.json' }
    expect(await verify(token('RS256', claims()), oidc, fetchImpl)).toMatchObject({ ok: true })
    const privateOnly = { keys: [{ ...(rsa.privateKey.export({ format: 'jwk' }) as object), kid: 'k1' }] }
    const { resetJwksCacheForTests } = await import('@/lib/customer-portal/customerAssertion')
    resetJwksCacheForTests()
    const leaky = vi.fn(async () => new Response(JSON.stringify(privateOnly), { status: 200 })) as unknown as typeof fetch
    expect(await verify(token('RS256', claims()), oidc, leaky)).toEqual({ ok: false, reason: 'key_not_found' })
  })

  it('OIDC: an unreachable JWKS fails closed', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch
    const oidc = { ...tenantKeyProvider, kind: 'oidc' as const, public_jwk: null, jwks_uri: 'https://login.tenant.example/jwks' }
    expect(await verify(token('RS256', claims()), oidc, fetchImpl)).toEqual({ ok: false, reason: 'jwks_unavailable' })
  })
})

describe('gateCustomerAssertion: the tenant decides', () => {
  it('no provider configured: unchanged behaviour', async () => {
    const { gateCustomerAssertion } = await import('@/lib/customer-portal/customerAssertion')
    expect(await gateCustomerAssertion({ companyId: COMPANY, clientId: 'c', token: null, expectedSubject: PORTAL_USER, provider: null }))
      .toEqual({ allowed: true, verified: false, reason: null, enforcement: 'none' })
  })

  it('report: a missing assertion is allowed and logged without personal data', async () => {
    const { gateCustomerAssertion } = await import('@/lib/customer-portal/customerAssertion')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = await gateCustomerAssertion({ companyId: COMPANY, clientId: 'c', token: null, expectedSubject: PORTAL_USER, provider: { ...tenantKeyProvider, enforcement: 'report' } })
    expect(result).toMatchObject({ allowed: true, verified: false, reason: 'missing' })
    expect(JSON.stringify(warn.mock.calls)).not.toContain(PORTAL_USER)
    warn.mockRestore()
  })

  it('enforce: a missing or invalid assertion is refused', async () => {
    const { gateCustomerAssertion } = await import('@/lib/customer-portal/customerAssertion')
    expect(await gateCustomerAssertion({ companyId: COMPANY, clientId: 'c', token: null, expectedSubject: PORTAL_USER, provider: tenantKeyProvider }))
      .toEqual({ allowed: false, reason: 'missing' })
  })

  it('a database without the migration behaves as "no provider"', async () => {
    const tq = await import('@/lib/supabase/tenantQuery')
    const chain = { eq: () => chain, maybeSingle: async () => ({ data: null, error: { code: 'PGRST205' } }) }
    vi.mocked(tq.tenantSelect).mockReturnValue(chain as never)
    const { loadActiveCustomerIdentityProvider } = await import('@/lib/customer-portal/customerAssertion')
    expect(await loadActiveCustomerIdentityProvider(COMPANY)).toBeNull()
  })
})
