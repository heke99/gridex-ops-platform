import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose'

export type VerifiedCustomerDelegation = {
  issuer: string
  subject: string
  customerId: string
}

type TrustEntry = {
  issuer: string
  audience: string
  jwks: JSONWebKeySet
  bindings: Record<string, Record<string, string>>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function trustedEntry(configuration: string | undefined, clientId: string): TrustEntry | null {
  if (!configuration || configuration.length > 65_536) return null
  try {
    const entries = JSON.parse(configuration) as Record<string, unknown>
    const entry = entries && typeof entries === 'object' && !Array.isArray(entries)
      ? entries[clientId] as Record<string, unknown> | undefined
      : undefined
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    const issuer = entry.issuer
    const audience = entry.audience
    const jwks = entry.jwks as JSONWebKeySet | undefined
    const bindings = entry.bindings as Record<string, unknown> | undefined
    if (typeof issuer !== 'string' || !issuer.startsWith('https://') ||
        typeof audience !== 'string' || !audience ||
        !bindings || typeof bindings !== 'object' || Array.isArray(bindings) ||
        !jwks || !Array.isArray(jwks.keys) || jwks.keys.length < 1 || jwks.keys.length > 8 ||
        !jwks.keys.every((key) => key.kty === 'RSA' && key.alg === 'RS256' && key.use === 'sig' &&
          typeof key.n === 'string' && typeof key.e === 'string' && !('d' in key))) return null
    return { issuer, audience, jwks, bindings: bindings as Record<string, Record<string, string>> }
  } catch {
    return null
  }
}

/** The trust root is platform-managed server configuration, never API-client metadata. */
export async function verifyCustomerDelegationAssertion(input: {
  token: string | null
  configuration: string | undefined
  companyId: string
  clientId: string
  action: string
  customerId?: string
}): Promise<VerifiedCustomerDelegation | null> {
  const entry = trustedEntry(input.configuration, input.clientId)
  if (!entry || !input.token || input.token.length > 8_192) return null
  try {
    const { payload } = await jwtVerify(input.token, createLocalJWKSet(entry.jwks), {
      algorithms: ['RS256'],
      issuer: entry.issuer,
      audience: entry.audience,
      maxTokenAge: '5m',
    })
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255 ||
        typeof payload.exp !== 'number' || typeof payload.iat !== 'number' ||
        payload.company_id !== input.companyId || payload.api_client_id !== input.clientId ||
        payload.action !== input.action || typeof payload.customer_id !== 'string' ||
        !UUID.test(payload.customer_id) ||
        !Object.hasOwn(entry.bindings, entry.issuer) ||
        !entry.bindings[entry.issuer] ||
        !Object.hasOwn(entry.bindings[entry.issuer], payload.sub) ||
        entry.bindings[entry.issuer][payload.sub] !== payload.customer_id ||
        (input.customerId && payload.customer_id !== input.customerId)) return null
    return { issuer: entry.issuer, subject: payload.sub, customerId: payload.customer_id }
  } catch {
    return null
  }
}
