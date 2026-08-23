// lib/customers/poaReadiness.ts
//
// Shared power-of-attorney (fullmakt) readiness semantics. There are three
// distinct concepts that the rest of the platform MUST NOT conflate:
//
//   * hasLegalPoaAcceptance   - the customer legally accepted a fullmakt
//                               (consent recorded with legal text + acceptance).
//   * hasPoaSnapshot          - a locked legal/POA snapshot or stored document
//                               exists, so a readable PDF can be produced.
//   * hasExternallySendablePoa - the POA is complete enough to send to a grid
//                               owner: customer identity + signer + method +
//                               evidence/snapshot/document. This is the only
//                               concept that may render "Fullmakt klar" for
//                               EXTERNAL network-owner communication.
//
// A legally accepted POA is NOT automatically externally sendable.

type PoaLike = Record<string, unknown>

function clean(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function isNonEmptyObject(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length > 0
}

const ACCEPTED_STATUSES = new Set(['signed', 'active', 'accepted', 'completed'])

export function poaStatusIsAccepted(poa: PoaLike | null | undefined): boolean {
  return ACCEPTED_STATUSES.has((clean(poa?.status) ?? '').toLowerCase())
}

// Legally accepted: an accepted status plus at least one piece of acceptance
// evidence (accepted_at/signed_at, a canonical legal-bundle document, a legacy
// legal text version, or an evidence/snapshot payload). This proves the customer
// agreed, independent of whether the document is ready to be mailed externally.
export function hasLegalPoaAcceptance(poa: PoaLike | null | undefined): boolean {
  if (!poa) return false
  if (!poaStatusIsAccepted(poa)) return false
  return Boolean(
    clean(poa.accepted_at) ||
      clean(poa.signed_at) ||
      clean(poa.legal_bundle_version_document_id) ||
      clean(poa.legal_text_version_id) ||
      isNonEmptyObject(poa.evidence_payload) ||
      isNonEmptyObject(poa.fullmakt_snapshot),
  )
}

// A locked snapshot or stored document exists, so a fullmakt PDF can be
// generated or attached.
export function hasPoaSnapshot(poa: PoaLike | null | undefined): boolean {
  if (!poa) return false
  return Boolean(
    isNonEmptyObject(poa.fullmakt_snapshot) ||
      clean(poa.document_id) ||
      clean(poa.document_path),
  )
}

function websiteApiPoaHasStructuredExternalCapture(poa: PoaLike | null | undefined): boolean {
  if ((clean(poa?.source) ?? '').toLowerCase() !== 'website_api') return true

  const evidence = poa?.evidence_payload as PoaLike | undefined
  const metadata = poa?.metadata as PoaLike | undefined
  const evidenceCaptureType = clean(evidence?.capture_type)
  const metadataCaptureType = clean(metadata?.poa_capture_type)

  return (
    evidenceCaptureType === 'structured_complete' ||
    metadataCaptureType === 'structured_complete' ||
    evidence?.externally_sendable_at_capture === true ||
    metadata?.externally_sendable === true
  )
}

export function poaCustomerIdentity(
  poa: PoaLike | null | undefined,
  context?: { customerIdentity?: string | null },
): string | null {
  const identityFromPoa = clean(poa?.signer_identity_number) ?? clean((poa?.evidence_payload as PoaLike | undefined)?.signer_identity_number)
  if (identityFromPoa) return identityFromPoa

  // Customer identity fallback is intentionally limited to old/admin/migrated
  // complete POA rows. Website API rows must carry signerIdentityNumber on the
  // structured POA itself; legacy consent-only is never externally sendable.
  if ((clean(poa?.source) ?? '').toLowerCase() === 'website_api') return null

  return clean(context?.customerIdentity)
}

// The POA is complete enough to send to a grid owner. Requires:
//   - legal acceptance,
//   - a known customer identity (person-/organisationsnummer),
//   - a signer name,
//   - a capture method,
//   - a snapshot or stored document (so a PDF exists or can be generated).
export function hasExternallySendablePoa(
  poa: PoaLike | null | undefined,
  context?: { customerIdentity?: string | null },
): boolean {
  if (!poa) return false
  if (!hasLegalPoaAcceptance(poa)) return false
  if (!websiteApiPoaHasStructuredExternalCapture(poa)) return false
  if (!poaCustomerIdentity(poa, context)) return false
  if (!clean(poa.signer_name)) return false
  if (!clean(poa.method)) return false
  if (!hasPoaSnapshot(poa)) return false
  return true
}

// ---------------------------------------------------------------------------
// Canonical POA lifecycle status
// ---------------------------------------------------------------------------
//
// The stored powers_of_attorney.status vocabulary grew organically
// (draft/sent/signed/active/accepted/completed/expired/revoked). UI and
// process code need ONE derived lifecycle answer instead of re-implementing
// this mapping. Derivation is fail-closed: an accepted status without any
// acceptance evidence is still "awaiting_signature".

export type PowerOfAttorneyLifecycleStatus =
  | 'missing'
  | 'awaiting_signature'
  | 'signed'
  | 'valid'
  | 'revoked'
  | 'expired'
  | 'replaced'

function toDateOrNull(value: unknown): Date | null {
  const cleaned = clean(value)
  if (!cleaned) return null
  const parsed = new Date(cleaned)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function derivePowerOfAttorneyLifecycleStatus(
  poa: PoaLike | null | undefined,
  options?: { now?: Date },
): PowerOfAttorneyLifecycleStatus {
  if (!poa) return 'missing'
  const now = options?.now ?? new Date()
  const status = (clean(poa.status) ?? '').toLowerCase()

  if (status === 'revoked' || status === 'annulled' || clean(poa.revoked_at)) return 'revoked'
  if (status === 'replaced' || status === 'superseded' || clean(poa.replaced_by_id)) return 'replaced'

  const validTo = toDateOrNull(poa.valid_to) ?? toDateOrNull(poa.valid_until)
  if (status === 'expired' || (validTo && validTo < now)) return 'expired'

  if (poaStatusIsAccepted(poa)) {
    // Accepted status without acceptance evidence is not provable — treat as
    // still awaiting a verifiable signature.
    if (!hasLegalPoaAcceptance(poa)) return 'awaiting_signature'
    const validFrom = toDateOrNull(poa.valid_from)
    if (validFrom && validFrom > now) return 'signed'
    return 'valid'
  }

  return 'awaiting_signature'
}

// Human-readable Swedish list of what is missing for external sendability.
export function poaMissingExternalFields(
  poa: PoaLike | null | undefined,
  context?: { customerIdentity?: string | null },
): string[] {
  const missing: string[] = []
  if (!hasLegalPoaAcceptance(poa)) missing.push('Juridiskt godkännande av fullmakt')
  if (!websiteApiPoaHasStructuredExternalCapture(poa)) missing.push('Komplett strukturerad website-fullmakt')
  if (!poaCustomerIdentity(poa, context)) missing.push('Person-/organisationsnummer')
  if (!clean(poa?.signer_name)) missing.push('Undertecknarens namn')
  if (!clean(poa?.method)) missing.push('Signeringsmetod')
  if (!hasPoaSnapshot(poa)) missing.push('Fullmaktsunderlag/dokument')
  return missing
}
