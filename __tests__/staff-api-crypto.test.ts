import { beforeEach, describe, expect, it } from 'vitest'
import { decryptStaffPayload, encryptStaffPayload, signStaffProof, verifyStaffProof } from '@/lib/staff-api/crypto'

beforeEach(() => {
  process.env.GRIDEX_STAFF_SIGNING_KEY = Buffer.alloc(32, 1).toString('base64')
  process.env.GRIDEX_STAFF_VAULT_KEY = Buffer.alloc(32, 2).toString('base64')
})

describe('staff proof and encrypted credential vault', () => {
  it('binds proof revision, client, tenant, stage and expiry and rejects signature substitution', () => {
    const proof = signStaffProof({ sessionId: 's', revision: 2, clientId: 'c', companyId: 't', userReference: 'u', stage: 'authenticated' })
    expect(verifyStaffProof(proof).revision).toBe(2)
    const [header, body, signature] = proof.split('.')
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString())
    claims.company = 'other'
    expect(() => verifyStaffProof(`${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`)).toThrow()
    expect(() => verifyStaffProof(signStaffProof({ sessionId: 's', revision: 2, clientId: 'c', companyId: 't', userReference: 'u', stage: 'authenticated' }, Date.now() - 301_000))).toThrow()
  })
  it('authenticates ciphertext and associated session identity; native credentials are unreadable', () => {
    const encrypted = encryptStaffPayload({ access_token: 'secret-native-token' }, 'session-a')
    expect(encrypted).not.toContain('secret-native-token')
    expect(decryptStaffPayload(encrypted, 'session-a')).toEqual({ access_token: 'secret-native-token' })
    expect(() => decryptStaffPayload(encrypted, 'session-b')).toThrow()
    expect(() => decryptStaffPayload(encrypted.slice(0, -2) + 'aa', 'session-a')).toThrow()
  })
  it('rejects missing, weak or shared keys without fallback', () => {
    delete process.env.GRIDEX_STAFF_SIGNING_KEY
    expect(() => signStaffProof({ sessionId: 's', revision: 1, clientId: 'c', companyId: 't', userReference: 'u', stage: 'authenticated' })).toThrow()
    process.env.GRIDEX_STAFF_SIGNING_KEY = process.env.GRIDEX_STAFF_VAULT_KEY
    expect(() => encryptStaffPayload({}, 's')).toThrow()
  })
})
