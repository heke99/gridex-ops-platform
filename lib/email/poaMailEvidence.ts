import { isIP } from 'node:net'
import { createHash } from 'node:crypto'
import { hasOnlineSignaturePoaArchive, poaCaptureSource } from '@/lib/customers/poaReadiness'
type Row = Record<string, unknown>
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const clean = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null

export function poaMailEvidence(poa: Row) {
  const evidence = record(poa.evidence_payload)
  const snapshot = record(poa.fullmakt_snapshot)
  const legal = record(snapshot.legal_text)
  // Only the server's provider-verification record can attest BankID. The
  // client-supplied method string and arbitrary metadata cannot attest it.
  const signature = record(evidence.verified_signature)
  const bankidReference = clean(signature.reference)
  const bankidVerified = signature.provider === 'bankid' && signature.status === 'completed'
    && signature.verification_source === 'server_callback' && Boolean(bankidReference)
  const scopes = poa.signed_scope_snapshot ?? snapshot.scopes ?? record(poa.scope_summary).scopes
  return {
    reference: clean(poa.reference) ?? clean(poa.id),
    verificationReference: clean(evidence.verification_reference),
    signerIpAddress: evidence.ip_address_source === 'signer_reported' && isIP(clean(evidence.ip_address) ?? '') ? clean(evidence.ip_address) : null,
    bankidReference, bankidVerified,
    legalText: clean(legal.body) ?? clean(snapshot.rendered_body) ?? clean(snapshot.body),
    legalTextTitle: clean(legal.title) ?? clean(snapshot.title),
    legalTextVersion: clean(legal.version) ?? clean(snapshot.version),
    signedScopes: Array.isArray(scopes) ? scopes.filter((scope): scope is string => typeof scope === 'string')
      : clean(poa.scope) ? [String(poa.scope)] : [],
  }
}

export function poaMailEvidenceFingerprint(poa: Row): string {
  return createHash('sha256').update(JSON.stringify({ ...poaMailEvidence(poa), accepted_at: poa.accepted_at,
    signed_at: poa.signed_at, signer_name: poa.signer_name, signer_identity_number: poa.signer_identity_number, method: poa.method })).digest('hex')
}

// Electronic consent exported through the API needs an auditable verification
// number and the signer IP. BankID is an optional alternative backed by a
// server-verified callback, never a condition inferred from an email domain.
export function poaMailEvidenceIssues(poa: Row): Array<{ code: string; message: string }> {
  const source = poaCaptureSource(poa)
  if (!['website_api', 'customer_portal_api', 'ops_online_signature'].includes(source ?? '')) return []
  const evidence = poaMailEvidence(poa)
  const archive = record(record(poa.metadata).document_archive)
  const archiveIssues = source === 'ops_online_signature' && (!hasOnlineSignaturePoaArchive(poa)
    || archive.evidence_sha256 !== poaMailEvidenceFingerprint(poa))
    ? [{ code: 'poa_private_archive_pending', message: 'Fullmaktens privata PDF och originalbevis måste verifieras innan utskick.' }] : []
  if (evidence.bankidVerified) return archiveIssues
  return [
    ...archiveIssues,
    ...(!evidence.verificationReference ? [{ code: 'poa_verification_number_missing', message: 'Fullmakten saknar verifikatsnummer för kundens godkännande. Komplettera godkännandeverifikatet före utskick.' }] : []),
    ...(!evidence.signerIpAddress ? [{ code: 'poa_signer_ip_missing', message: 'Kundens IP-adress vid godkännandet saknas. Tenantens formulärserver måste skicka kundens registrerade IP-adress i fullmaktsunderlaget; API-serverns IP räknas inte som kundens.' }] : []),
  ]
}
