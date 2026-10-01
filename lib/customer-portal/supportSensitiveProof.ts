import 'server-only'
import { createHash } from 'node:crypto'
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose'

export const SUPPORT_CONTACT_PROOF_ACTION = 'customer.support.contact.change.v1'
type ContactBindingRequest = {
  companyId: string; customerId: string; caseId: string; expectedCaseRevision: number; expectedContactRevision: number
  idempotencyKey: string; reason: string; changes: { email?: string | null; phone?: string | null }
}
type StaffSession = { userId: string; sessionId: string }
export type VerifiedSupportSensitiveProof = {
  action: typeof SUPPORT_CONTACT_PROOF_ACTION; issuerHash: string; subjectHash: string; nonceHash: string
  issuedAt: number; expiresAt: number; requestHash: string
}
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .filter(([,entry]) => entry !== undefined).sort(([a],[b]) => a.localeCompare(b))
    .map(([key,entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

/** Issuers sign this exact normalized command, including the current staff
 * session and both saved revisions. Contact values confer no account ownership. */
export function supportContactRequestBinding(request: ContactBindingRequest, actor: StaffSession): string {
  return canonical({ companyId: request.companyId, customerId: request.customerId, caseId: request.caseId,
    expectedCaseRevision: request.expectedCaseRevision, expectedContactRevision: request.expectedContactRevision,
    idempotencyKey: request.idempotencyKey, reason: request.reason, changes: request.changes,
    actorUserId: actor.userId, sessionId: actor.sessionId, action: SUPPORT_CONTACT_PROOF_ACTION, channel: 'phone' })
}

/** Separate server-managed trust root. Ordinary reusable customer assertions
 * and API-client metadata are never treated as sensitive phone verification. */
export async function verifySupportSensitiveContactProof(input: {
  token: string | null; configuration: string | undefined; request: ContactBindingRequest; actor: StaffSession
}): Promise<VerifiedSupportSensitiveProof | null> {
  if (!input.configuration || input.configuration.length > 65_536 || !input.token || input.token.length > 8192) return null
  try {
    const entries = JSON.parse(input.configuration)
    if (!entries || typeof entries !== 'object' || Array.isArray(entries) || !Object.hasOwn(entries, input.request.companyId)) return null
    const entry = entries[input.request.companyId] as Record<string, unknown>
    const jwks = entry.jwks as JSONWebKeySet
    const bindings = entry.bindings as Record<string, Record<string, string>>
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.issuer !== 'string' ||
      !entry.issuer.startsWith('https://') || entry.issuer.length > 512 || typeof entry.audience !== 'string' ||
      !entry.audience || entry.audience.length > 300 || !Array.isArray(entry.actions) ||
      !entry.actions.includes(SUPPORT_CONTACT_PROOF_ACTION) || !bindings || typeof bindings !== 'object' || Array.isArray(bindings) ||
      !jwks || !Array.isArray(jwks.keys) || jwks.keys.length < 1 || jwks.keys.length > 8 ||
      !jwks.keys.every(key => key.kty === 'RSA' && key.alg === 'RS256' && key.use === 'sig' &&
        typeof key.n === 'string' && typeof key.e === 'string' && !('d' in key))) return null
    const { payload, protectedHeader } = await jwtVerify(input.token, createLocalJWKSet(jwks), {
      algorithms: ['RS256'], issuer: entry.issuer, audience: entry.audience, maxTokenAge: '5m',
    })
    const now = Math.floor(Date.now() / 1000)
    const binding = supportContactRequestBinding(input.request, input.actor)
    if (protectedHeader.typ !== 'gridex-support-sensitive+jwt' || payload.purpose !== 'gridex_support_sensitive_contact_v1' ||
      payload.channel !== 'phone' || payload.action !== SUPPORT_CONTACT_PROOF_ACTION ||
      payload.company_id !== input.request.companyId || payload.customer_id !== input.request.customerId ||
      payload.case_id !== input.request.caseId || payload.actor_user_id !== input.actor.userId || payload.session_id !== input.actor.sessionId ||
      payload.request_sha256 !== sha256(binding) || typeof payload.jti !== 'string' || !uuid.test(payload.jti) ||
      typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255 ||
      !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || typeof payload.iat !== 'number' || typeof payload.exp !== 'number' ||
      payload.iat > now || payload.exp <= now || payload.exp <= payload.iat || payload.exp - payload.iat > 300 ||
      !Object.hasOwn(bindings, entry.issuer) || !bindings[entry.issuer] ||
      !Object.hasOwn(bindings[entry.issuer], payload.sub) || bindings[entry.issuer][payload.sub] !== input.request.customerId) return null
    return { action: SUPPORT_CONTACT_PROOF_ACTION, issuerHash: sha256(entry.issuer), subjectHash: sha256(payload.sub),
      nonceHash: sha256(payload.jti.toLowerCase()), issuedAt: payload.iat, expiresAt: payload.exp, requestHash: sha256(binding) }
  } catch { return null }
}
