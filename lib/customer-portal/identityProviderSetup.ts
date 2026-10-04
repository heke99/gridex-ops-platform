import type { JsonWebKey } from 'node:crypto'

/**
 * Tenantservice P1c: setup helpers for OPS "Kundinloggning". Only public material is accepted.
 */

/**
 * Audience a tenant-key assertion must carry. Per tenant, so an assertion minted for one tenant is
 * refused by every other tenant even before key matching. OIDC providers use the tenant's client id.
 */
export type IdentityProviderPurpose = 'customer' | 'staff'

export function identityProviderPurpose(value: string): IdentityProviderPurpose {
  if (value === 'customer' || value === '') return 'customer'
  if (value === 'staff') return 'staff'
  throw new IdentityProviderSetupError('Välj Kund eller Personal som syfte.')
}

export function tenantKeyAudience(companyId: string, purpose: IdentityProviderPurpose = 'customer'): string {
  return purpose === 'staff' ? `gridex-staff-api:${companyId}` : `gridex-customer-api:${companyId}`
}

export function tenantKeyIssuer(companyId: string): string {
  return `gridex-tenant:${companyId}`
}

export class IdentityProviderSetupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdentityProviderSetupError'
  }
}

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|.*\.localdomain)$/i
const IP_LITERAL = /^\[?[0-9a-f:.]+\]?$/i

/**
 * Only public https hosts by name: no IP literals, no internal names, no credentials, no custom
 * ports. Gridex fetches this URL server-side, so it must never reach internal infrastructure.
 */
export function assertPublicHttpsUrl(value: string, label: string): URL {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new IdentityProviderSetupError(`${label} är ingen giltig adress.`)
  }
  if (url.protocol !== 'https:') throw new IdentityProviderSetupError(`${label} måste börja med https://.`)
  if (url.username || url.password) throw new IdentityProviderSetupError(`${label} får inte innehålla inloggningsuppgifter.`)
  if (url.port && url.port !== '443') throw new IdentityProviderSetupError(`${label} får inte använda en egen port.`)
  const host = url.hostname
  if (IP_LITERAL.test(host) || PRIVATE_HOST.test(host) || !host.includes('.')) {
    throw new IdentityProviderSetupError(`${label} måste vara ett publikt domännamn.`)
  }
  return url
}

async function fetchJson(url: URL, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error', headers: { accept: 'application/json' } })
    if (!response.ok) throw new IdentityProviderSetupError(`Leverantören svarade ${response.status} på ${url.host}.`)
    const text = await response.text()
    if (text.length > 64 * 1024) throw new IdentityProviderSetupError('Leverantörens svar är för stort.')
    const body = JSON.parse(text)
    if (!body || typeof body !== 'object') throw new IdentityProviderSetupError('Leverantörens svar är inte JSON.')
    return body as Record<string, unknown>
  } catch (error) {
    if (error instanceof IdentityProviderSetupError) throw error
    throw new IdentityProviderSetupError(`Kunde inte nå ${url.host}. Kontrollera adressen.`)
  } finally {
    clearTimeout(timer)
  }
}

export type OidcDiscovery = { issuer: string; jwksUri: string; keyCount: number }

/** Reads the provider's standard OIDC discovery document and confirms it publishes signing keys. */
export async function discoverOidcProvider(issuerInput: string, fetchImpl: typeof fetch = fetch): Promise<OidcDiscovery> {
  const issuerUrl = assertPublicHttpsUrl(issuerInput, 'Leverantörens adress')
  const issuer = issuerUrl.toString().replace(/\/$/, '')
  const config = await fetchJson(new URL(`${issuer}/.well-known/openid-configuration`), fetchImpl)
  if (typeof config.issuer !== 'string' || config.issuer.replace(/\/$/, '') !== issuer) {
    throw new IdentityProviderSetupError('Leverantörens issuer stämmer inte med adressen du angav.')
  }
  if (typeof config.jwks_uri !== 'string') throw new IdentityProviderSetupError('Leverantören publicerar inga nycklar (jwks_uri saknas).')
  const jwksUrl = assertPublicHttpsUrl(config.jwks_uri, 'Leverantörens nyckeladress')
  const jwks = await fetchJson(jwksUrl, fetchImpl)
  const keys = Array.isArray(jwks.keys) ? jwks.keys.filter((key) => key && typeof key === 'object' && !('d' in key)) : []
  if (keys.length === 0) throw new IdentityProviderSetupError('Leverantören publicerar inga publika signeringsnycklar.')
  return { issuer: config.issuer, jwksUri: jwksUrl.toString(), keyCount: keys.length }
}

/** Accepts a public RSA/EC JWK only; anything containing private material is refused. */
export function parsePublicJwk(raw: string): JsonWebKey {
  let jwk: unknown
  try {
    jwk = JSON.parse(raw)
  } catch {
    throw new IdentityProviderSetupError('Nyckeln kunde inte läsas.')
  }
  if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk)) throw new IdentityProviderSetupError('Nyckeln kunde inte läsas.')
  const key = jwk as Record<string, unknown>
  if ('d' in key || 'p' in key || 'q' in key) {
    throw new IdentityProviderSetupError('Det här är en privat nyckel. Skicka aldrig den privata nyckeln till Gridex.')
  }
  if (key.kty === 'RSA' && typeof key.n === 'string' && typeof key.e === 'string') return { kty: 'RSA', n: key.n, e: key.e, kid: typeof key.kid === 'string' ? key.kid : undefined } as JsonWebKey
  if (key.kty === 'EC' && key.crv === 'P-256' && typeof key.x === 'string' && typeof key.y === 'string') {
    return { kty: 'EC', crv: 'P-256', x: key.x, y: key.y, kid: typeof key.kid === 'string' ? key.kid : undefined } as JsonWebKey
  }
  throw new IdentityProviderSetupError('Nyckeln måste vara en publik RSA- eller EC P-256-nyckel.')
}
