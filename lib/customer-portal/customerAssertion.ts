import { constants, createPublicKey, verify as verifySignature, type JsonWebKey, type KeyObject } from 'node:crypto'
import { tenantInsert, tenantSelect } from '@/lib/supabase/tenantQuery'

/**
 * Tenantservice P1c: independent end-customer proof.
 *
 * The tenant's own login (BankID/Freja broker, any OIDC provider, or its own password/OTP login)
 * issues a short-lived signed assertion for the logged-in customer. The tenant server forwards
 * it in `x-gridex-customer-assertion`; Gridex verifies it here instead of trusting the tenant
 * server's word alone. Only public key material is used (OIDC JWKS or the tenant's public JWK).
 *
 * Accepted: compact JWS with RS256, PS256 or ES256. `none` and shared-secret (HS*) algorithms
 * are always rejected: a shared secret would have to be stored at Gridex.
 */

export const CUSTOMER_ASSERTION_HEADER = 'x-gridex-customer-assertion'
const CLOCK_SKEW_SECONDS = 60
const MAX_LIFETIME_SECONDS = 15 * 60
const JWKS_CACHE_MS = 10 * 60 * 1000
const JWKS_KID_REFRESH_COOLDOWN_MS = 30 * 1000
const JWKS_TIMEOUT_MS = 3000
const JWKS_MAX_BYTES = 64 * 1024
const ALGORITHMS = {
  RS256: { hash: 'sha256', kty: 'RSA' },
  PS256: { hash: 'sha256', kty: 'RSA', pss: true },
  ES256: { hash: 'sha256', kty: 'EC', dsa: 'ieee-p1363' as const },
} as const
type Algorithm = keyof typeof ALGORITHMS

export type CustomerIdentityProvider = {
  id: string
  company_id: string
  kind: 'oidc' | 'tenant_key'
  display_name: string
  issuer: string
  audience: string
  jwks_uri: string | null
  public_jwk: JsonWebKey | null
  subject_claim: string
  enforcement: 'report' | 'enforce'
}

export type AssertionFailure =
  | 'missing'
  | 'malformed'
  | 'algorithm_not_allowed'
  | 'key_not_found'
  | 'signature_invalid'
  | 'issuer_mismatch'
  | 'audience_mismatch'
  | 'expired'
  | 'not_yet_valid'
  | 'lifetime_too_long'
  | 'subject_missing'
  | 'subject_mismatch'
  | 'jti_missing'
  | 'replayed'
  | 'jwks_unavailable'

export type AssertionResult =
  | { ok: true; subject: string; method: string | null; expiresAt: string }
  | { ok: false; reason: AssertionFailure }

function base64urlJson(part: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

type PublishedJwk = JsonWebKey & { kid?: string }
type JwksSnapshot = { at: number; keys: PublishedJwk[] }
type JwksFailure = 'key_not_found' | null
type JwksEntry = {
  snapshot?: JwksSnapshot
  pending?: Promise<JwksSnapshot | JwksFailure>
  nextKidRefreshAt?: number
}

const jwksCache = new Map<string, JwksEntry>()

/** Test seam and cache reset. */
export function resetJwksCacheForTests() {
  jwksCache.clear()
}

async function downloadJwks(uri: string, fetchImpl: typeof fetch): Promise<PublishedJwk[] | JwksFailure> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), JWKS_TIMEOUT_MS)
  try {
    const response = await fetchImpl(uri, { signal: controller.signal, redirect: 'error', headers: { accept: 'application/json' } })
    if (!response.ok) return null
    const text = await response.text()
    if (text.length > JWKS_MAX_BYTES) return null
    const body = JSON.parse(text) as { keys?: unknown }
    // Preserve the existing refusal code without caching a response that omits the key set.
    if (!Array.isArray(body.keys)) return 'key_not_found'
    return (body.keys as PublishedJwk[]).filter((key) => key && typeof key === 'object' && !('d' in key))
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function loadJwks(uri: string, entry: JwksEntry, fetchImpl: typeof fetch): Promise<JwksSnapshot | JwksFailure> {
  if (entry.pending) return entry.pending
  entry.pending = downloadJwks(uri, fetchImpl).then((keys) => {
    if (keys === null || keys === 'key_not_found') return keys
    const snapshot = { at: Date.now(), keys }
    entry.snapshot = snapshot
    return snapshot
  }).finally(() => {
    entry.pending = undefined
    if (!entry.snapshot && jwksCache.get(uri) === entry) jwksCache.delete(uri)
  })
  return entry.pending
}

async function refreshJwksForUnknownKid(uri: string, entry: JwksEntry, fetchImpl: typeof fetch) {
  if (entry.pending) return entry.pending
  const now = Date.now()
  // Concurrent callers share a refresh. Different unknown keys cannot each start a fetch.
  if (now < (entry.nextKidRefreshAt ?? 0)) return null
  entry.nextKidRefreshAt = now + JWKS_KID_REFRESH_COOLDOWN_MS
  return loadJwks(uri, entry, fetchImpl)
}

function publicKeyFor(jwk: JsonWebKey, algorithm: Algorithm): KeyObject | null {
  if (jwk.kty !== ALGORITHMS[algorithm].kty) return null
  if ('d' in jwk) return null
  try {
    return createPublicKey({ key: jwk, format: 'jwk' })
  } catch {
    return null
  }
}

type SignatureFailure = 'key_not_found' | 'signature_invalid'

function checkSignature(
  candidates: PublishedJwk[], kid: string | null, alg: Algorithm, signed: Buffer, signature: Buffer,
): SignatureFailure | null {
  const keys = candidates
    .filter((jwk) => !kid || !jwk.kid || jwk.kid === kid)
    .map((jwk) => publicKeyFor(jwk, alg))
    .filter((key): key is KeyObject => key !== null)
  if (keys.length === 0) return 'key_not_found'
  const spec = ALGORITHMS[alg]
  const valid = keys.some((key) => {
    try {
      if ('pss' in spec) return verifySignature(spec.hash, signed, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, signature)
      if ('dsa' in spec) return verifySignature(spec.hash, signed, { key, dsaEncoding: spec.dsa }, signature)
      return verifySignature(spec.hash, signed, key, signature)
    } catch {
      return false
    }
  })
  return valid ? null : 'signature_invalid'
}

function claimString(payload: Record<string, unknown>, claim: string): string | null {
  const value = payload[claim]
  return typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : null
}

/**
 * Verifies one compact JWS against the tenant's provider. Pure apart from JWKS fetching and the
 * replay check, which the caller supplies (so verification is testable without a database).
 */
export async function verifyCustomerAssertion(input: {
  token: string | null | undefined
  provider: CustomerIdentityProvider
  expectedSubject: string | null
  now?: Date
  fetchImpl?: typeof fetch
  /** Staff proofs always require finite, ordered iat/exp; existing customer behaviour is retained. */
  requireIssuedAt?: boolean
  consumeJti: (jti: string, expiresAt: Date) => Promise<boolean>
}): Promise<AssertionResult> {
  const token = input.token?.trim()
  if (!token) return { ok: false, reason: 'missing' }
  const parts = token.split('.')
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]*$/.test(parts[2])) {
    return { ok: false, reason: 'malformed' }
  }
  const header = base64urlJson(parts[0])
  const payload = base64urlJson(parts[1])
  if (!header || !payload) return { ok: false, reason: 'malformed' }
  const algorithm = header.alg
  if (typeof algorithm !== 'string' || !(algorithm in ALGORITHMS)) return { ok: false, reason: 'algorithm_not_allowed' }
  const alg = algorithm as Algorithm
  if (!parts[2]) return { ok: false, reason: 'signature_invalid' }

  const kid = typeof header.kid === 'string' ? header.kid : null
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`)
  const signature = Buffer.from(parts[2], 'base64url')
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  let signatureFailure: SignatureFailure | null
  if (input.provider.kind === 'tenant_key') {
    signatureFailure = checkSignature(input.provider.public_jwk ? [input.provider.public_jwk] : [], kid, alg, signed, signature)
  } else {
    const uri = input.provider.jwks_uri ?? ''
    if (!/^https:\/\//.test(uri)) return { ok: false, reason: 'jwks_unavailable' }
    const fetchImpl = input.fetchImpl ?? fetch
    const entry = jwksCache.get(uri) ?? {}
    jwksCache.set(uri, entry)
    const snapshot = entry.snapshot
    const cached = snapshot && Date.now() - snapshot.at < JWKS_CACHE_MS ? snapshot : null
    const current = cached ?? await loadJwks(uri, entry, fetchImpl)
    if (current === null) return { ok: false, reason: 'jwks_unavailable' }
    if (current === 'key_not_found') return { ok: false, reason: current }
    signatureFailure = checkSignature(current.keys, kid, alg, signed, signature)
    // Unverified claims can only suppress a refresh, never authorize the assertion.
    if (signatureFailure && cached && kid && !cached.keys.some((key) => key.kid === kid)
      && payload.iss === input.provider.issuer && audiences.includes(input.provider.audience)) {
      const refreshed = await refreshJwksForUnknownKid(uri, entry, fetchImpl)
      if (refreshed && refreshed !== 'key_not_found') {
        signatureFailure = checkSignature(refreshed.keys, kid, alg, signed, signature)
      }
    }
  }
  if (signatureFailure) return { ok: false, reason: signatureFailure }

  if (payload.iss !== input.provider.issuer) return { ok: false, reason: 'issuer_mismatch' }
  if (!audiences.includes(input.provider.audience)) return { ok: false, reason: 'audience_mismatch' }

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000)
  const exp = typeof payload.exp === 'number' ? payload.exp : null
  const iat = typeof payload.iat === 'number' ? payload.iat : null
  const nbf = typeof payload.nbf === 'number' ? payload.nbf : null
  if (input.requireIssuedAt && (
    iat === null || exp === null || !Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)
    || exp <= iat || (nbf !== null && !Number.isSafeInteger(nbf))
  )) return { ok: false, reason: 'malformed' }
  if (exp === null || exp <= nowSeconds - CLOCK_SKEW_SECONDS) return { ok: false, reason: 'expired' }
  if (input.requireIssuedAt && iat !== null && iat > nowSeconds + CLOCK_SKEW_SECONDS) return { ok: false, reason: 'not_yet_valid' }
  if ((nbf ?? iat ?? nowSeconds) > nowSeconds + CLOCK_SKEW_SECONDS) return { ok: false, reason: 'not_yet_valid' }
  // A staff proof's nbf cannot hide future issuance or extend its short validity window.
  const lifetimeStart = input.requireIssuedAt && iat !== null ? Math.min(iat, nbf ?? iat) : (iat ?? nbf ?? nowSeconds)
  if (exp - lifetimeStart > MAX_LIFETIME_SECONDS) return { ok: false, reason: 'lifetime_too_long' }

  const subject = claimString(payload, input.provider.subject_claim)
  if (!subject) return { ok: false, reason: 'subject_missing' }
  if (!input.expectedSubject || subject !== input.expectedSubject) return { ok: false, reason: 'subject_mismatch' }

  const jti = claimString(payload, 'jti')
  if (!jti || jti.length < 8 || jti.length > 200) return { ok: false, reason: 'jti_missing' }
  const expiresAt = new Date((exp + (input.requireIssuedAt ? CLOCK_SKEW_SECONDS : 0)) * 1000)
  if (!(await input.consumeJti(jti, expiresAt))) return { ok: false, reason: 'replayed' }

  const amr = Array.isArray(payload.amr) ? payload.amr.filter((v) => typeof v === 'string').join(',') : null
  const method = amr || (typeof payload.acr === 'string' ? payload.acr : null)
  return { ok: true, subject, method, expiresAt: expiresAt.toISOString() }
}

const PROVIDER_COLUMNS = 'id,company_id,kind,display_name,issuer,audience,jwks_uri,public_jwk,subject_claim,enforcement'

const providerCache = new Map<string, { at: number; provider: CustomerIdentityProvider | null }>()
const PROVIDER_CACHE_MS = 30 * 1000

export function resetCustomerIdentityProviderCache(companyId?: string) {
  if (companyId) providerCache.delete(companyId)
  else providerCache.clear()
}

export async function loadActiveCustomerIdentityProvider(companyId: string): Promise<CustomerIdentityProvider | null> {
  const cached = providerCache.get(companyId)
  if (cached && Date.now() - cached.at < PROVIDER_CACHE_MS) return cached.provider
  let { data, error } = await tenantSelect(companyId, 'tenant_customer_identity_providers', PROVIDER_COLUMNS)
    .eq('purpose', 'customer')
    .eq('is_active', true)
    .maybeSingle()
  // During app-first additive rollout an old schema has customer providers only.
  // Once purpose exists, never fall back from its company/customer predicate.
  if (error && ['42703', 'PGRST204'].includes((error as { code?: string }).code ?? '')
    && /purpose/.test((error as { message?: string }).message ?? '')) {
    const legacy = await tenantSelect(companyId, 'tenant_customer_identity_providers', PROVIDER_COLUMNS)
      .eq('is_active', true).maybeSingle()
    data = legacy.data
    error = legacy.error
  }
  if (error) {
    // Before migration 20261002080000 is applied no tenant can have a provider: unchanged behaviour.
    const code = (error as { code?: string }).code
    if (code === '42P01' || code === 'PGRST205') return null
    throw error
  }
  const provider = (data as CustomerIdentityProvider | null) ?? null
  providerCache.set(companyId, { at: Date.now(), provider })
  return provider
}

/** Records a jti once per tenant; a unique violation means the assertion was already used. */
export async function consumeAssertionJti(companyId: string, jti: string, expiresAt: Date): Promise<boolean> {
  const { error } = await tenantInsert(companyId, 'tenant_customer_assertion_replays', { jti, expires_at: expiresAt.toISOString() })
  if (!error) return true
  if ((error as { code?: string }).code === '23505') return false
  throw error
}

export type CustomerAssertionGate =
  | { allowed: true; verified: boolean; reason: AssertionFailure | null; enforcement: 'none' | 'report' | 'enforce' }
  | { allowed: false; reason: AssertionFailure }

/**
 * Applies the tenant's own setting. No provider configured: unchanged behaviour. 'report': the
 * call proceeds and a would-reject is logged without personal data. 'enforce': refused.
 */
export async function gateCustomerAssertion(input: {
  companyId: string
  clientId: string | null
  token: string | null
  expectedSubject: string | null
  provider?: CustomerIdentityProvider | null
}): Promise<CustomerAssertionGate> {
  const provider = input.provider === undefined ? await loadActiveCustomerIdentityProvider(input.companyId) : input.provider
  if (!provider) return { allowed: true, verified: false, reason: null, enforcement: 'none' }
  const result = await verifyCustomerAssertion({
    token: input.token,
    provider,
    expectedSubject: input.expectedSubject,
    requireIssuedAt: true,
    consumeJti: (jti, expiresAt) => consumeAssertionJti(input.companyId, jti, expiresAt),
  })
  if (result.ok) return { allowed: true, verified: true, reason: null, enforcement: provider.enforcement }
  if (provider.enforcement === 'enforce') return { allowed: false, reason: result.reason }
  console.warn('[customer-portal] customer_assertion_would_reject', {
    company_id: input.companyId,
    api_client_id: input.clientId,
    reason: result.reason,
  })
  return { allowed: true, verified: false, reason: result.reason, enforcement: 'report' }
}
