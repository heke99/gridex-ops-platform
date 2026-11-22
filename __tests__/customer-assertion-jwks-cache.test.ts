import { generateKeyPairSync, sign } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetJwksCacheForTests, verifyCustomerAssertion, type CustomerIdentityProvider } from '@/lib/customer-portal/customerAssertion'

vi.mock('@/lib/supabase/tenantQuery', () => ({ tenantInsert: vi.fn(), tenantSelect: vi.fn() }))

const time = new Date('2026-11-19T12:00:00Z')
const subject = 'synthetic-staff-actor'
const provider: CustomerIdentityProvider = {
  id: 'synthetic-oidc-provider',
  company_id: 'synthetic-company',
  kind: 'oidc',
  display_name: 'Synthetic OIDC',
  issuer: 'https://issuer.example.test',
  audience: 'gridex-staff-test',
  jwks_uri: 'https://issuer.example.test/keys',
  public_jwk: null,
  subject_claim: 'sub',
  enforcement: 'enforce',
}

function signingKey(kid: string) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  return { kid, onlineJwk: { ...publicKey.export({ format: 'jwk' }), kid }, privateKey }
}

const oldKey = signingKey('existing-key')
const rotatedKey = signingKey('rotated-key')
const nextKey = signingKey('next-key')
const consumeJti = vi.fn(async () => true)
let requestNumber = 0
let elapsed = 0

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function verify(key: ReturnType<typeof signingKey>, fetchImpl: typeof fetch, configured = provider) {
  const issuedAt = Math.floor(time.getTime() / 1000)
  const header = encode({ alg: 'ES256', kid: key.kid })
  const claims = encode({
    iss: configured.issuer, aud: configured.audience, sub: subject,
    iat: issuedAt, exp: issuedAt + 60, jti: `synthetic-assertion-${++requestNumber}`,
  })
  const message = `${header}.${claims}`
  const signature = sign('sha256', Buffer.from(message), { key: key.privateKey, dsaEncoding: 'ieee-p1363' })
  return verifyCustomerAssertion({
    token: `${message}.${signature.toString('base64url')}`,
    provider: configured,
    expectedSubject: subject,
    now: time,
    requireIssuedAt: true,
    fetchImpl,
    consumeJti,
  })
}

function publisher(key = oldKey) {
  let current = key.onlineJwk
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ keys: [current] }))
  return { fetchImpl, rotate(next: ReturnType<typeof signingKey>) { current = next.onlineJwk } }
}

beforeEach(() => {
  resetJwksCacheForTests()
  consumeJti.mockClear()
  elapsed = 0
  vi.spyOn(Date, 'now').mockImplementation(() => time.getTime() + elapsed)
})
afterEach(() => vi.restoreAllMocks())

describe('OIDC JWKS fetching for valid tenant staff assertions', () => {
  it('refreshes a warm set when the configured issuer rotates to a new key', async () => {
    const source = publisher()
    await expect(verify(oldKey, source.fetchImpl)).resolves.toMatchObject({ ok: true, subject })
    source.rotate(rotatedKey)
    await expect(verify(rotatedKey, source.fetchImpl)).resolves.toMatchObject({ ok: true, subject })
    await expect(verify(rotatedKey, source.fetchImpl)).resolves.toMatchObject({ ok: true, subject })
    expect(source.fetchImpl).toHaveBeenCalledTimes(2)
    expect(consumeJti).toHaveBeenCalledTimes(3)
  })

  it.each(['cold', 'expired'] as const)('shares one configured fetch for simultaneous %s verification', async state => {
    const source = publisher()
    if (state === 'expired') {
      await expect(verify(oldKey, source.fetchImpl)).resolves.toMatchObject({ ok: true })
      elapsed = 10 * 60 * 1000 + 1
    }
    source.fetchImpl.mockClear()
    consumeJti.mockClear()
    const results = await Promise.all(Array.from({ length: 4 }, () => verify(oldKey, source.fetchImpl)))
    expect(results.every(result => result.ok)).toBe(true)
    expect(source.fetchImpl).toHaveBeenCalledExactlyOnceWith(provider.jwks_uri, expect.objectContaining({ redirect: 'error' }))
    expect(consumeJti).toHaveBeenCalledTimes(4)
  })

  it('shares simultaneous rotation refreshes for the same provider', async () => {
    const source = publisher()
    await expect(verify(oldKey, source.fetchImpl)).resolves.toMatchObject({ ok: true })
    source.rotate(rotatedKey)
    const results = await Promise.all(Array.from({ length: 4 }, () => verify(rotatedKey, source.fetchImpl)))
    expect(results.every(result => result.ok)).toBe(true)
    expect(source.fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('bounds rotation refresh frequency independently for each configured URL', async () => {
    const source = publisher()
    const separate = publisher()
    const otherProvider = { ...provider, jwks_uri: 'https://alternate.example.test/keys' }
    await expect(verify(oldKey, source.fetchImpl)).resolves.toMatchObject({ ok: true })
    await expect(verify(oldKey, separate.fetchImpl, otherProvider)).resolves.toMatchObject({ ok: true })
    source.rotate(rotatedKey)
    separate.rotate(rotatedKey)
    await expect(verify(rotatedKey, source.fetchImpl)).resolves.toMatchObject({ ok: true })
    await expect(verify(rotatedKey, separate.fetchImpl, otherProvider)).resolves.toMatchObject({ ok: true })
    expect(separate.fetchImpl).toHaveBeenCalledTimes(2)
    source.rotate(nextKey)
    await expect(verify(nextKey, source.fetchImpl)).resolves.toEqual({ ok: false, reason: 'key_not_found' })
    expect(source.fetchImpl).toHaveBeenCalledTimes(2)
    elapsed = 30_001
    await expect(verify(nextKey, source.fetchImpl)).resolves.toMatchObject({ ok: true })
    expect(source.fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('keeps the cooldown until it expires even if a refresh did not publish the expected key', async () => {
    const source = publisher()
    await expect(verify(oldKey, source.fetchImpl)).resolves.toMatchObject({ ok: true })
    await expect(verify(rotatedKey, source.fetchImpl)).resolves.toEqual({ ok: false, reason: 'key_not_found' })
    expect(source.fetchImpl).toHaveBeenCalledTimes(2)
    source.rotate(nextKey)
    await expect(verify(nextKey, source.fetchImpl)).resolves.toEqual({ ok: false, reason: 'key_not_found' })
    expect(source.fetchImpl).toHaveBeenCalledTimes(2)
    elapsed = 30_001
    await expect(verify(nextKey, source.fetchImpl)).resolves.toMatchObject({ ok: true })
    expect(source.fetchImpl).toHaveBeenCalledTimes(3)
  })

  it.each(['HTTP error', 'invalid key set'] as const)('retains still-fresh keys after a refresh %s and later retries', async failure => {
    const source = publisher()
    await expect(verify(oldKey, source.fetchImpl)).resolves.toMatchObject({ ok: true })
    source.fetchImpl.mockResolvedValueOnce(failure === 'HTTP error'
      ? new Response(null, { status: 503 })
      : Response.json({ status: 'unavailable' }))
    await expect(verify(rotatedKey, source.fetchImpl)).resolves.toEqual({ ok: false, reason: 'key_not_found' })
    expect(consumeJti).toHaveBeenCalledTimes(1)
    expect(source.fetchImpl).toHaveBeenCalledTimes(2)
    await expect(verify(oldKey, source.fetchImpl)).resolves.toMatchObject({ ok: true })
    expect(source.fetchImpl).toHaveBeenCalledTimes(2)
    elapsed = 30_001
    source.rotate(rotatedKey)
    await expect(verify(rotatedKey, source.fetchImpl)).resolves.toMatchObject({ ok: true })
    expect(consumeJti).toHaveBeenCalledTimes(3)
  })

  it('does not refresh a known key ID when the cached key cannot verify the signature', async () => {
    const source = publisher()
    await expect(verify(oldKey, source.fetchImpl)).resolves.toMatchObject({ ok: true })
    const reusedKeyId = { ...rotatedKey, kid: oldKey.kid }
    await expect(verify(reusedKeyId, source.fetchImpl)).resolves.toEqual({ ok: false, reason: 'signature_invalid' })
    expect(source.fetchImpl).toHaveBeenCalledTimes(1)
    expect(consumeJti).toHaveBeenCalledTimes(1)
  })

  it('honours an explicit empty key set after a successful refresh', async () => {
    const source = publisher()
    await expect(verify(oldKey, source.fetchImpl)).resolves.toMatchObject({ ok: true })
    source.fetchImpl.mockResolvedValueOnce(Response.json({ keys: [] }))
    await expect(verify(rotatedKey, source.fetchImpl)).resolves.toEqual({ ok: false, reason: 'key_not_found' })
    await expect(verify(oldKey, source.fetchImpl)).resolves.toEqual({ ok: false, reason: 'key_not_found' })
    expect(source.fetchImpl).toHaveBeenCalledTimes(2)
    expect(consumeJti).toHaveBeenCalledTimes(1)
  })

  it('keeps the documented missing-key refusal for a cold response without a key set', async () => {
    const source = publisher()
    source.fetchImpl.mockResolvedValueOnce(Response.json({ status: 'unavailable' }))
    await expect(verify(oldKey, source.fetchImpl)).resolves.toEqual({ ok: false, reason: 'key_not_found' })
    expect(consumeJti).not.toHaveBeenCalled()
  })

  it('leaves a failed shared cold load retryable', async () => {
    const source = publisher()
    source.fetchImpl.mockResolvedValueOnce(new Response(null, { status: 503 }))
    const results = await Promise.all([verify(oldKey, source.fetchImpl), verify(oldKey, source.fetchImpl)])
    expect(results).toEqual(Array.from({ length: 2 }, () => ({ ok: false, reason: 'jwks_unavailable' })))
    expect(source.fetchImpl).toHaveBeenCalledTimes(1)
    expect(consumeJti).not.toHaveBeenCalled()
    await expect(verify(oldKey, source.fetchImpl)).resolves.toMatchObject({ ok: true })
    expect(source.fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not authorize with an expired cache after a failed regular reload', async () => {
    const source = publisher()
    await expect(verify(oldKey, source.fetchImpl)).resolves.toMatchObject({ ok: true })
    elapsed = 10 * 60 * 1000 + 1
    source.fetchImpl.mockResolvedValueOnce(new Response(null, { status: 503 }))
    await expect(verify(oldKey, source.fetchImpl)).resolves.toEqual({ ok: false, reason: 'jwks_unavailable' })
    expect(consumeJti).toHaveBeenCalledTimes(1)
    await expect(verify(oldKey, source.fetchImpl)).resolves.toMatchObject({ ok: true })
    expect(source.fetchImpl).toHaveBeenCalledTimes(3)
  })
})
