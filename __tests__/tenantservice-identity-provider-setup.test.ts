import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  assertPublicHttpsUrl,
  discoverOidcProvider,
  parsePublicJwk,
  tenantKeyAudience,
  tenantKeyIssuer,
} from '@/lib/customer-portal/identityProviderSetup'

describe('Kundinloggning setup (P1c)', () => {
  it.each([
    'http://login.example.se',
    'https://127.0.0.1',
    'https://[::1]',
    'https://localhost',
    'https://metadata.internal',
    'https://user:pass@login.example.se',
    'https://login.example.se:8443',
    'https://intranet',
  ])('refuses a non-public or unsafe address: %s', (value) => {
    expect(() => assertPublicHttpsUrl(value, 'Adress')).toThrow()
  })

  it('accepts a public https provider address', () => {
    expect(assertPublicHttpsUrl('https://gridex.criipto.id', 'Adress').hostname).toBe('gridex.criipto.id')
  })

  it('discovers the JWKS from the provider and refuses an issuer mismatch', async () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const fetchImpl = vi.fn(async (url: URL | string) => {
      const href = String(url)
      if (href.endsWith('/.well-known/openid-configuration')) {
        return new Response(JSON.stringify({ issuer: 'https://login.tenant.se', jwks_uri: 'https://login.tenant.se/jwks' }))
      }
      return new Response(JSON.stringify({ keys: [rsa.publicKey.export({ format: 'jwk' })] }))
    }) as unknown as typeof fetch
    await expect(discoverOidcProvider('https://login.tenant.se', fetchImpl)).resolves.toEqual({
      issuer: 'https://login.tenant.se', jwksUri: 'https://login.tenant.se/jwks', keyCount: 1,
    })
    await expect(discoverOidcProvider('https://other.tenant.se', fetchImpl)).rejects.toThrow(/issuer/)
  })

  it('refuses a JWKS address that points at internal infrastructure', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ issuer: 'https://login.tenant.se', jwks_uri: 'https://169.254.169.254/keys' }))) as unknown as typeof fetch
    await expect(discoverOidcProvider('https://login.tenant.se', fetchImpl)).rejects.toThrow(/publikt/)
  })

  it('stores only the public half of a key and refuses private keys', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const publicJwk = rsa.publicKey.export({ format: 'jwk' })
    expect(parsePublicJwk(JSON.stringify({ ...publicJwk, kid: 'k1', extra: 'x' }))).toEqual({ kty: 'RSA', n: publicJwk.n, e: publicJwk.e, kid: 'k1' })
    expect(() => parsePublicJwk(JSON.stringify(rsa.privateKey.export({ format: 'jwk' })))).toThrow(/privat nyckel/)
    expect(() => parsePublicJwk('{"kty":"oct","k":"c2VjcmV0"}')).toThrow()
  })
})

describe('multitenant isolation of own-login keys', () => {
  it('issuer and audience are specific to each tenant', () => {
    const a = '00000000-0000-4000-8000-00000000000a', b = '00000000-0000-4000-8000-00000000000b'
    expect(tenantKeyIssuer(a)).not.toBe(tenantKeyIssuer(b))
    expect(tenantKeyAudience(a)).not.toBe(tenantKeyAudience(b))
    expect(tenantKeyAudience(a)).toBe(`gridex-customer-api:${a}`)
  })
})

describe('migration 20261002080000', () => {
  it('rejects private keys and keeps tables service-role only', async () => {
    const { readFileSync } = await import('node:fs')
    const sql = readFileSync('supabase/migrations/20261002080000_tenant_customer_identity_providers.sql', 'utf8')
    expect(sql).toContain("NOT public_jwk ? 'd'")
    expect(sql).toContain('REVOKE ALL ON TABLE public.tenant_customer_identity_providers FROM PUBLIC, anon, authenticated')
    expect(sql).toContain("enforcement text NOT NULL DEFAULT 'report'")
    expect(sql).not.toMatch(/\b(DROP|DELETE FROM|TRUNCATE)\b/)
  })
})
