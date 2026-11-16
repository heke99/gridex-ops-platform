import { X509Certificate, createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { supabaseService } from '@/lib/supabase/service'
import {currentPreviousCrlException} from '@/lib/ediel/transport/exception/source'
import {verifyPreviousSignedCrlCryptography} from '@/lib/ediel/transport/exception/previousCrl'
const execute = promisify(execFile)
export type EdielCertificateTrustScope = { companyId: string; environment: 'test' | 'production'; receiverEdielId: string }
export type EdielCertificateTrustAuthority = EdielCertificateTrustScope & {
  registrationId: string; registerVersion: string; originalReference: string; originalSha256: string; authorizationReference: string;
  /** Immutable source-owner required recipient set, not an optional allowlist. */
  validFrom: string; validTo: string; recipientFingerprints: string[]; anchors: string[]; intermediates: string[]; crls: string[];
}
export type EdielCertificateTrustResult = { verified: false; code: string } | { verified: true; registrationId: string; registerVersion: string; leafFingerprint: string; chainFingerprints: string[]; crlSha256: string[]; verifiedAt: string }
const fingerprint = (certificate: X509Certificate) => certificate.fingerprint256.replaceAll(':', '').toLowerCase()
function certificateTimeValid(c: X509Certificate, now: Date) { return Date.parse(c.validFrom) <= now.getTime() && Date.parse(c.validTo) > now.getTime() }
function bounded(values: unknown): values is string[] { return Array.isArray(values) && values.length <= 16 && values.every(value => typeof value === 'string' && value.length > 0 && value.length <= 1_048_576) }

/** PKIX verification of supplied public originals. This proves cryptography,
 * never authorization of an arbitrary supplied CA. Live callers obtain the
 * authority only through the protected versioned source-owner RPC below.
 * OpenSSL already serves the server's S/MIME crypto adapter. Missing/unsupported
 * runtime support fails closed, without a national protocol diagnostic. */
export async function verifyEdielCertificateTrust(input: {
  scope: EdielCertificateTrustScope; leafPem: string; authority: EdielCertificateTrustAuthority; now?: Date
}): Promise<EdielCertificateTrustResult> {
  const { scope, authority } = input, now = input.now ?? new Date()
  const held = (code: string): EdielCertificateTrustResult => ({ verified: false, code })
  if (!authority || authority.companyId !== scope.companyId || authority.environment !== scope.environment || authority.receiverEdielId !== scope.receiverEdielId) return held('certificate_trust_scope_mismatch')
  if (!authority.registrationId || !authority.registerVersion || !authority.originalReference || !/^[a-f0-9]{64}$/.test(authority.originalSha256) || !authority.authorizationReference
    || !Number.isFinite(now.getTime()) || !(Date.parse(authority.validFrom) <= now.getTime() && Date.parse(authority.validTo) > now.getTime())) return held('certificate_trust_authority_missing_or_expired')
  if (!bounded(authority.anchors) || !authority.anchors.length || !bounded(authority.intermediates) || !bounded(authority.crls) || !authority.crls.length || typeof input.leafPem !== 'string' || input.leafPem.length > 1_048_576) return held('certificate_trust_originals_missing_or_unbounded')
  const previous = currentPreviousCrlException(scope,authority.crls)
  if(previous){
    if(previous.certificateAuthorityId!==authority.registrationId)return held('certificate_trust_previous_crl_owner_changed')
    return verifyPreviousSignedCrlCryptography({...input,priorCrlSha256:previous.priorCrlSha256,cdpLocations:previous.cdpLocations})
  }
  let leaf: X509Certificate, certificates: X509Certificate[]
  try {
    leaf = new X509Certificate(input.leafPem)
    certificates = [...authority.intermediates, ...authority.anchors].map(pem => new X509Certificate(pem))
    if (!certificateTimeValid(leaf, now)) return held('certificate_trust_certificate_time_or_ca_invalid')
  } catch { return held('certificate_trust_certificate_invalid') }
  // An authorized CA alone does not bind its every subscriber to this legal
  // Ediel recipient. The immutable owner register must identify the leaf too.
  if (!Array.isArray(authority.recipientFingerprints) || authority.recipientFingerprints.length < 1 || authority.recipientFingerprints.length > 16
    || !authority.recipientFingerprints.every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))
    || !authority.recipientFingerprints.includes(fingerprint(leaf))) return held('certificate_trust_recipient_not_registered')
  const trusted = new Set(authority.anchors.flatMap(pem => { const c = new X509Certificate(pem); return c.ca && certificateTimeValid(c, now) ? [fingerprint(c)] : [] }))
  const chain = [leaf], seen = new Set([fingerprint(leaf)])
  while (!trusted.has(fingerprint(chain.at(-1)!))) {
    const child = chain.at(-1)!
    const parents = certificates.filter(c => c.ca && certificateTimeValid(c, now) && child.checkIssued(c) && child.verify(c.publicKey) && !seen.has(fingerprint(c)))
    if (parents.length !== 1 || chain.length >= 16) return held('certificate_trust_chain_missing_or_ambiguous')
    const parent = parents[0]; chain.push(parent); seen.add(fingerprint(parent))
  }
  if (chain.length === 1) return held('certificate_trust_leaf_is_ca_anchor')
  let directory: string | null = null
  try {
    directory = await mkdtemp(join(tmpdir(), 'ediel-public-trust-'))
    const leafPath = join(directory, 'leaf.pem'), caPath = join(directory, 'anchors.pem'), intermediatePath = join(directory, 'intermediates.pem'), crlPath = join(directory, 'revocations.pem')
    await Promise.all([writeFile(leafPath, input.leafPem, { mode: 0o600 }), writeFile(caPath, authority.anchors.join('\n'), { mode: 0o600 }), writeFile(intermediatePath, authority.intermediates.join('\n'), { mode: 0o600 }), writeFile(crlPath, authority.crls.join('\n'), { mode: 0o600 })])
    // -crl_check_all checks actual issuer signatures and freshness for the full
    // chain. Default host CA stores are explicitly excluded. No historical
    // replay time may substitute for the live transport verification instant.
    await execute('openssl', ['verify', '-no-CApath', '-no-CAstore', '-CAfile', caPath, ...(authority.intermediates.length ? ['-untrusted', intermediatePath] : []),
      '-CRLfile', crlPath, '-crl_check_all', '-purpose', 'smimeencrypt', '-attime', String(Math.floor(now.getTime() / 1000)), leafPath], { timeout: 10_000, maxBuffer: 65_536 })
    return { verified: true, registrationId: authority.registrationId, registerVersion: authority.registerVersion, leafFingerprint: fingerprint(leaf),
      chainFingerprints: chain.map(fingerprint), crlSha256: authority.crls.map(crl => createHash('sha256').update(crl, 'utf8').digest('hex')), verifiedAt: now.toISOString() }
  } catch { return held('certificate_trust_pkix_or_fresh_authenticated_crl_failed') }
  finally { if (directory) await rm(directory, { recursive: true, force: true }) }
}

/** This read-only authority port excludes caller/row metadata from trust. The
 * source publisher has a separate NOLOGIN owner role with no seeded members. */
export async function resolveEdielCertificateTrustAuthority(scope: EdielCertificateTrustScope): Promise<EdielCertificateTrustAuthority | null> {
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as (name: 'gridex_ediel_certificate_trust_read_v1', args: { p_company_id: string; p_environment: string; p_receiver_ediel_id: string }) => PromiseLike<{ data: unknown; error: unknown }>
  const { data, error } = await rpc('gridex_ediel_certificate_trust_read_v1', { p_company_id: scope.companyId, p_environment: scope.environment, p_receiver_ediel_id: scope.receiverEdielId })
  if (error) throw error
  if (data === null) return null
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('certificate_trust_authority_result_invalid')
  return data as EdielCertificateTrustAuthority
}
