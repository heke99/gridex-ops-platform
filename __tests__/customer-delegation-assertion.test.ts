import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { beforeEach, describe, expect, it } from 'vitest'
import { verifyCustomerDelegationAssertion } from '@/lib/customer-portal/delegationAssertion'

const tenant = '10e4435f-7785-4cb5-9092-ea3c280ed32e'
const customer = '9879f55f-1337-457b-8065-b117813d6195'
const otherCustomer = '4c7e2fc7-c7b0-4784-8026-5c722c5a655c'
const client = '97a0c92e-0683-4997-9a80-41213c511e9e'
const subject = 'user-1'
const issuer = 'https://identity.example.test/tenant-a'
const audience = 'gridex-customer-portal'
const action = 'GET /api/v1/customer/me'

describe('independently signed customer delegation', () => {
  let privateKey: CryptoKey
  let config: string

  beforeEach(async () => {
    const pair = await generateKeyPair('RS256', { extractable: true })
    privateKey = pair.privateKey as CryptoKey
    const jwk = await exportJWK(pair.publicKey)
    config = JSON.stringify({ [client]: { issuer, audience, bindings: { [issuer]: { [subject]: customer } }, jwks: { keys: [{ ...jwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] } } })
  })

  async function signed(overrides: Record<string, unknown> = {}, options: { issuer?: string; audience?: string; expired?: boolean } = {}) {
    const now = Math.floor(Date.now() / 1000)
    return new SignJWT({ company_id: tenant, api_client_id: client, customer_id: customer, action, ...overrides })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(options.issuer ?? issuer)
      .setAudience(options.audience ?? audience)
      .setSubject(subject)
      .setIssuedAt(options.expired ? now - 1000 : now)
      .setExpirationTime(options.expired ? now - 900 : now + 120)
      .sign(privateKey)
  }

  it('accepts a pinned signature and a specific tenant/customer/action', async () => {
    const assertion = await verifyCustomerDelegationAssertion({
      token: await signed(), configuration: config, companyId: tenant, clientId: client, action,
    })
    expect(assertion).toEqual({ subject, customerId: customer, issuer })
  })

  it.each([
    { name: 'missing configuration', change: { configuration: undefined } },
    { name: 'wrong issuer', token: { issuer: 'https://other.example.test' } },
    { name: 'wrong audience', token: { audience: 'other-audience' } },
    { name: 'wrong tenant', claim: { company_id: '4ef5da85-e3c1-4235-a7b0-e9b67fecbb73' } },
    { name: 'wrong API client', claim: { api_client_id: 'f23500a5-43e5-4f7c-ab23-c4b2eea7af86' } },
    { name: 'wrong customer', claim: { customer_id: otherCustomer }, customerId: customer },
    { name: 'wrong action', claim: { action: 'POST /api/v1/customer/profile-update' } },
    { name: 'expired', token: { expired: true } },
  ])('rejects $name', async ({ change, token, claim, customerId }) => {
    const result = await verifyCustomerDelegationAssertion({
      token: await signed(claim, token), configuration: change?.configuration ?? (change ? undefined : config),
      companyId: tenant, clientId: client, action, customerId,
    })
    expect(result).toBeNull()
  })

  it('rejects a valid token when the platform binding has been revoked or moved', async () => {
    const token = await signed()
    for (const bindings of [{}, { [issuer]: { [subject]: otherCustomer } }]) {
      const changedConfig = JSON.stringify({ ...JSON.parse(config), [client]: { ...JSON.parse(config)[client], bindings } })
      expect(await verifyCustomerDelegationAssertion({ token, configuration: changedConfig, companyId: tenant, clientId: client, action })).toBeNull()
    }
  })

  it('does not reuse the same subject binding after a trusted issuer changes', async () => {
    const otherIssuer = 'https://identity.example.test/tenant-b'
    const changed = JSON.parse(config)
    changed[client].issuer = otherIssuer
    expect(await verifyCustomerDelegationAssertion({
      token: await signed({}, { issuer: otherIssuer }), configuration: JSON.stringify(changed),
      companyId: tenant, clientId: client, action,
    })).toBeNull()
  })

  it('rejects an unsigned, oversized, or differently signed assertion', async () => {
    const inputs = ['abc.def.ghi', 'a'.repeat(8193), await signed()]
    const differentKey = await generateKeyPair('RS256')
    const differentConfig = JSON.stringify({ [client]: { issuer, audience, bindings: { [issuer]: { [subject]: customer } }, jwks: { keys: [{ ...(await exportJWK(differentKey.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' }] } } })
    for (const token of inputs) {
      const result = await verifyCustomerDelegationAssertion({
        token, configuration: token === inputs[2] ? differentConfig : config,
        companyId: tenant, clientId: client, action,
      })
      expect(result).toBeNull()
    }
  })
})
