import { createHash } from 'node:crypto'
import { Resolver } from 'node:dns/promises'
import { dkimVerify } from 'mailauth/lib/dkim/verify'

export type ManualSenderVerification = {
  version: 1
  status: 'verified' | 'unverified'
  method: 'dkim'
  raw_sha256: string
  from_email?: string
  signing_domain?: string
  signed_headers: string[]
  reason?: string
  verified_at: string
}

export type ManualSenderVerificationDependencies = {
  resolver?: (name: string, type: string) => Promise<string[][]>
}

// Six MiB of decoded attachments needs up to eight MiB in base64, with room
// for MIME headers/body. Authentication always covers the whole original RFC.
const MAX_RAW_BYTES = 12 * 1024 * 1024
const MAX_HEADER_BYTES = 64 * 1024
const MAX_SIGNATURES = 4
const MAX_DNS_QUERIES = 4
const DNS_TIMEOUT_MS = 1000
const VERIFICATION_TIMEOUT_MS = 4000
const PROTECTED_HEADERS = ['from', 'subject', 'in-reply-to', 'references', 'content-type', 'content-transfer-encoding', 'mime-version']
const REQUIRED_SIGNED_HEADERS = ['from', 'content-type', 'content-transfer-encoding', 'mime-version']

function deadline<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('verification_timeout')), milliseconds)
    operation.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

// Only ordinary RFC field syntax is eligible for automatic application. Do not
// let permissive parsers disagree over a duplicate or malformed identity field.
function readHeaders(raw: Buffer): Map<string, string[]> | null {
  const prefix = raw.subarray(0, MAX_HEADER_BYTES + 4).toString('latin1')
  const separator = /\r?\n\r?\n/.exec(prefix)
  if (!separator || separator.index > MAX_HEADER_BYTES) return null
  const fields = prefix.slice(0, separator.index).split(/\r?\n/)
  const headers = new Map<string, string[]>()
  let previous: string | null = null
  let count = 0
  for (const line of fields) {
    if (/^[ \t]/.test(line)) {
      if (!previous || /[\r\n\0]/.test(line)) return null
      const values = headers.get(previous)!
      values[values.length - 1] += ` ${line.trim()}`
      continue
    }
    const match = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+):(.*)$/.exec(line)
    if (!match || /[\r\n\0]/.test(line) || ++count > 200) return null
    previous = match[1].toLowerCase()
    const values = headers.get(previous) ?? []
    values.push(match[2].trim())
    headers.set(previous, values)
  }
  return headers
}

function signatureValue(value: string): string | null {
  const matches = value.split(';').map((tag) => /^\s*b\s*=\s*([\s\S]*)$/.exec(tag)).filter(Boolean)
  return matches.length === 1 ? matches[0]![1].replace(/\s/g, '') : null
}

/**
 * Verifies the original RFC bytes, never a supplied Authentication-Results
 * claim. This is sender evidence only; callers must still match the verified
 * author, tenant, request and customer before allowing any business updates.
 */
export async function verifyManualMailSender(
  raw: unknown,
  dependencies: ManualSenderVerificationDependencies = {},
): Promise<ManualSenderVerification> {
  const evidence: ManualSenderVerification = {
    version: 1,
    status: 'unverified',
    method: 'dkim',
    raw_sha256: '',
    signed_headers: [],
    verified_at: new Date().toISOString(),
  }
  const unverified = (reason: string): ManualSenderVerification => ({ ...evidence, reason })
  if (!(typeof raw === 'string' || Buffer.isBuffer(raw) || raw instanceof Uint8Array)) return unverified('raw_source_missing')
  if (raw.length > MAX_RAW_BYTES) return unverified('raw_source_too_large')
  const source = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : Buffer.from(raw)
  if (!source.length) return unverified('raw_source_missing')
  if (source.length > MAX_RAW_BYTES) return unverified('raw_source_too_large')
  evidence.raw_sha256 = createHash('sha256').update(source).digest('hex')
  const headers = readHeaders(source)
  if (!headers) return unverified('invalid_header_structure')
  if (headers.get('from')?.length !== 1) return unverified('single_author_required')
  if (PROTECTED_HEADERS.some((name) => (headers.get(name)?.length ?? 0) > 1)) return unverified('duplicate_protected_header')
  const signatures = headers.get('dkim-signature') ?? []
  if (!signatures.length) return unverified('dkim_signature_missing')
  if (signatures.length + (headers.get('arc-message-signature')?.length ?? 0) > MAX_SIGNATURES) return unverified('signature_limit_exceeded')
  const dkimSignatures = new Set(signatures.map(signatureValue).filter((value): value is string => Boolean(value)))
  const systemResolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 })
  let queries = 0
  const resolver = async (name: string, type: string): Promise<string[][]> => {
    if (type !== 'TXT' || ++queries > MAX_DNS_QUERIES) throw new Error('dns_query_limit')
    // A bounded DNS TXT lookup is the only network operation the verifier can
    // perform. Neither the mail body nor headers can supply an HTTP endpoint.
    if (name.length > 253 || !/^[a-z0-9_.-]+$/i.test(name)) throw new Error('invalid_dns_name')
    const records = await deadline(dependencies.resolver ? dependencies.resolver(name, type) : systemResolver.resolveTxt(name), DNS_TIMEOUT_MS)
    if (!Array.isArray(records) || records.length > 16) throw new Error('dns_response_limit')
    let bytes = 0
    for (const record of records) {
      if (!Array.isArray(record) || record.length > 64) throw new Error('invalid_dns_response')
      for (const part of record) {
        if (typeof part !== 'string' || (bytes += Buffer.byteLength(part)) > 16384) throw new Error('dns_response_limit')
      }
    }
    return records
  }

  try {
    const verified = await deadline(dkimVerify(source, { strict: true, minBitLength: 2048, rejectRsaSha1: true, resolver }), VERIFICATION_TIMEOUT_MS)
    if (verified.fromFields !== 1 || verified.fromSyntax !== 'valid' || verified.headerFrom.length !== 1) return unverified('single_author_required')
    const fromEmail = verified.headerFrom[0].toLowerCase()
    const fromDomain = fromEmail.slice(fromEmail.lastIndexOf('@') + 1)
    evidence.from_email = fromEmail
    for (const result of verified.results) {
      if (result.status.result !== 'pass' || result.status.testing || result.signatureTimeValid === false) continue
      if (!result.signature || !dkimSignatures.has(result.signature.replace(/\s/g, ''))) continue
      if (!['rsa-sha256', 'ed25519-sha256'].includes(result.algo ?? '') || result.canonBodyLengthLimited !== false) continue
      if (result.algo === 'rsa-sha256' && (result.modulusLength ?? 0) < 2048) continue
      if (result.signingDomain?.toLowerCase() !== fromDomain) continue
      const signedHeaders = [...new Set((result.signingHeaders?.keys ?? '').toLowerCase().split(':').map((name) => name.trim()).filter(Boolean))]
      // Unsigned subject/reply headers remain available for display, but are
      // absent from this evidence and MUST be excluded by correlation callers.
      // MIME fields must be signed because they determine how the signed body
      // bytes become the text used for business parsing.
      if (REQUIRED_SIGNED_HEADERS.some((name) => headers.has(name) && !signedHeaders.includes(name))) continue
      return { ...evidence, status: 'verified', signing_domain: fromDomain, signed_headers: signedHeaders }
    }
    return unverified('no_eligible_aligned_dkim_signature')
  } catch {
    return unverified('dkim_verification_failed')
  } finally {
    systemResolver.cancel()
  }
}
