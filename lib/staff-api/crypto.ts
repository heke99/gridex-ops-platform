import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { StaffApiError } from '@/lib/staff-api/errors'

export type StaffStage = 'authenticated' | 'mfa_required' | 'password_change_required'
export type StaffProof = { sessionId: string; revision: number; clientId: string; companyId: string; userReference: string; stage: StaffStage }
export type VerifiedStaffProof = Omit<StaffProof, 'clientId' | 'companyId'> & { clientReference: string; organizationReference: string }
const issuer = 'gridex-ops-staff-v1'
const audience = 'gridex-staff-api'

export function staffKeys() {
  const read = (name: string) => {
    const input = process.env[name] ?? ''
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input)) throw new StaffApiError(503, 'staff_auth_not_configured', 'Staff authentication is not configured.', true)
    const key = Buffer.from(input, 'base64')
    if (key.toString('base64') !== input || key.length < 32) throw new StaffApiError(503, 'staff_auth_not_configured', 'Staff authentication is not configured.', true)
    return key
  }
  const signing = read('GRIDEX_STAFF_SIGNING_KEY')
  const vault = read('GRIDEX_STAFF_VAULT_KEY')
  if (vault.length !== 32 || (signing.length === vault.length && timingSafeEqual(signing, vault))) throw new StaffApiError(503, 'staff_auth_not_configured', 'Staff authentication keys must be distinct.', true)
  return { signing, vault }
}

export function staffHash(value: string) { return createHmac('sha256', staffKeys().signing).update(value).digest('hex') }
export function staffReference(kind: string, value: string) { return `${kind}_${staffHash(`${kind}:${value}`).slice(0, 32)}` }
export function staffRefreshToken() { return randomBytes(32).toString('base64url') }
export function encryptStaffPayload(value: unknown, binding: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', staffKeys().vault, iv)
  cipher.setAAD(Buffer.from(`staff-v1:${binding}`))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')
}
export function decryptStaffPayload<T = unknown>(value: string, binding: string): T {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error()
    const bytes = Buffer.from(value, 'base64url')
    if (bytes.length < 29) throw new Error()
    const cipher = createDecipheriv('aes-256-gcm', staffKeys().vault, bytes.subarray(0, 12))
    cipher.setAAD(Buffer.from(`staff-v1:${binding}`)); cipher.setAuthTag(bytes.subarray(12, 28))
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')) as T
  } catch (error) {
    if (error instanceof StaffApiError) throw error
    throw new StaffApiError(503, 'staff_session_unavailable', 'Staff session could not be verified.', true)
  }
}
export function signStaffProof(proof: StaffProof, now = Date.now()) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'staff-v1' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ iss: issuer, aud: audience, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 300, sid: proof.sessionId, revision: proof.revision, api_client_reference: staffReference('acl', proof.clientId), organization_reference: staffReference('org', proof.companyId), sub: proof.userReference, stage: proof.stage })).toString('base64url')
  const signature = createHmac('sha256', staffKeys().signing).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}
export function verifyStaffProof(token: string): VerifiedStaffProof {
  const invalid = () => new StaffApiError(401, 'staff_session_invalid', 'Staff authentication is required.')
  if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw invalid()
  const [header, payload, signature] = token.split('.')
  const expected = createHmac('sha256', staffKeys().signing).update(`${header}.${payload}`).digest()
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid()
  try {
    const h = JSON.parse(Buffer.from(header, 'base64url').toString())
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString())
    const now = Math.floor(Date.now() / 1000)
    if (h.alg !== 'HS256' || h.typ !== 'JWT' || h.kid !== 'staff-v1' || p.iss !== issuer || p.aud !== audience || !Number.isInteger(p.exp) || p.exp <= now || p.exp > now + 330 || !Number.isInteger(p.iat) || p.iat > now + 30 || p.exp - p.iat !== 300 || !Number.isSafeInteger(p.revision) || p.revision < 1 || !['authenticated', 'mfa_required', 'password_change_required'].includes(p.stage) || ['sid', 'sub', 'api_client_reference', 'organization_reference'].some((k) => typeof p[k] !== 'string' || !p[k])) throw invalid()
    return { sessionId: p.sid, revision: p.revision, clientReference: p.api_client_reference, organizationReference: p.organization_reference, userReference: p.sub, stage: p.stage }
  } catch { throw invalid() }
}
