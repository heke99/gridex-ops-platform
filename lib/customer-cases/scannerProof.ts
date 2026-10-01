import 'server-only'
import { createHash } from 'node:crypto'
import { calculateJwkThumbprint, createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose'
import { z } from 'zod'

export const SUPPORT_SCAN_PURPOSE = 'gridex_support_attachment_scan_v1'
const hash = z.string().regex(/^[0-9a-f]{64}$/)
export const supportScanLineageSchema = z.object({
  companyId: z.string().uuid(),customerId: z.string().uuid(),caseId: z.string().uuid(),attachmentId: z.string().uuid(),
  scanIntentId: z.string().uuid(),reservationHash: hash,revision: z.number().int().positive().safe(),
  bucket: z.literal('customer-support-quarantine'),objectKey: z.string().max(512),sha256: hash,
  byteSize: z.number().int().positive().max(5 * 1024 * 1024),objectId: z.string().uuid(),
  objectVersion: z.string().max(255).nullable(),objectUpdatedAt: z.string().max(100).nullable(),
}).strict()
export const supportScanChallengeSchema = supportScanLineageSchema.extend({
  nonceId: z.string().uuid(),issuedAt: z.number().int().nonnegative().safe(),expiresAt: z.number().int().positive().safe(),
  issuerHash: hash,subjectHash: hash,keyHash: hash,
}).strict()
export type SupportScanChallenge = z.infer<typeof supportScanChallengeSchema>
export type ScannerTrust = { issuerHash: string; subjectHash: string; keyHash: string }
type Entry = { issuer: string; audience: string; subject: string; kid: string; jwks: JSONWebKeySet; trust: ScannerTrust }
export const scannerSha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
export function scanBinding(challenge: SupportScanChallenge): string {
  return JSON.stringify(Object.fromEntries(Object.entries(challenge).sort(([a],[b]) => a.localeCompare(b))))
}

/** Server-managed keys plus the separately locked private DB root must both
 * match. No remote JWKS lookup, client metadata or public assertion is trusted. */
export async function scannerTrustEntry(companyId: string, configuration: string | undefined): Promise<Entry | null> {
  if (!configuration || configuration.length > 65_536 || !z.string().uuid().safeParse(companyId).success) return null
  try {
    const entries: unknown = JSON.parse(configuration)
    if (!entries || typeof entries !== 'object' || Array.isArray(entries) || !Object.hasOwn(entries,companyId)) return null
    const entry = z.object({ issuer: z.string().url().startsWith('https://').max(512),audience: z.string().min(1).max(300),
      subject: z.string().min(1).max(255),kid: z.string().min(1).max(200),purpose: z.literal(SUPPORT_SCAN_PURPOSE),
      jwks: z.object({ keys: z.array(z.record(z.string(),z.unknown())).min(1).max(8) }).strict(),
    }).strict().parse((entries as Record<string,unknown>)[companyId])
    const keys = entry.jwks.keys
    if (!keys.every(key => key.kty === 'RSA' && key.alg === 'RS256' && key.use === 'sig' &&
      typeof key.kid === 'string' && typeof key.n === 'string' && typeof key.e === 'string' &&
      !['d','p','q','dp','dq','qi','oth'].some(field => field in key)) || new Set(keys.map(key => key.kid)).size !== keys.length) return null
    const selected = keys.find(key => key.kid === entry.kid)
    if (!selected) return null
    const jwks = { keys: [selected] } as JSONWebKeySet
    const thumbprint = await calculateJwkThumbprint(selected)
    return { issuer: entry.issuer,audience: entry.audience,subject: entry.subject,kid: entry.kid,jwks,
      trust: { issuerHash: scannerSha256(entry.issuer),subjectHash: scannerSha256(entry.subject),
        keyHash: Buffer.from(thumbprint,'base64url').toString('hex') } }
  } catch { return null }
}

export async function verifySupportAttachmentScannerProof(input: {
  token: string | null; challenge: SupportScanChallenge; configuration: string | undefined
}) {
  const parsed = supportScanChallengeSchema.safeParse(input.challenge)
  if (!parsed.success || !input.token || input.token.length > 8192) return null
  const challenge = parsed.data,entry = await scannerTrustEntry(challenge.companyId,input.configuration)
  if (!entry || Object.entries(entry.trust).some(([key,value]) => challenge[key as keyof ScannerTrust] !== value)) return null
  try {
    const { payload,protectedHeader } = await jwtVerify(input.token,createLocalJWKSet(entry.jwks), {
      algorithms: ['RS256'],issuer: entry.issuer,audience: entry.audience,maxTokenAge: '5m',
    })
    const allowed = ['iss','sub','aud','iat','exp','jti','purpose','binding_sha256','verdict']
    const now = Math.floor(Date.now()/1000),bindingJson = scanBinding(challenge)
    if (Object.keys(payload).some(key => !allowed.includes(key)) || protectedHeader.typ !== 'gridex-support-attachment-scan+jwt'
      || protectedHeader.kid !== entry.kid || payload.sub !== entry.subject || payload.jti !== challenge.nonceId
      || payload.purpose !== SUPPORT_SCAN_PURPOSE || payload.binding_sha256 !== scannerSha256(bindingJson)
      || !['clean','malicious','unknown'].includes(String(payload.verdict)) || typeof payload.verdict !== 'string'
      || typeof payload.iat !== 'number' || !Number.isSafeInteger(payload.iat)
      || typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp)
      || payload.iat < challenge.issuedAt || payload.iat > now || payload.exp <= now || payload.exp <= payload.iat
      || payload.exp > challenge.expiresAt || payload.exp-payload.iat > 300
      || challenge.expiresAt <= now || challenge.expiresAt-challenge.issuedAt > 300) return null
    return { ...entry.trust,nonceHash: scannerSha256(challenge.nonceId),issuedAt: payload.iat,expiresAt: payload.exp,
      bindingJson,requestHash: scannerSha256(bindingJson),verdict: payload.verdict as 'clean' | 'malicious' | 'unknown' }
  } catch { return null }
}
