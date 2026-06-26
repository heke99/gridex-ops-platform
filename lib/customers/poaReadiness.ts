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
// evidence (accepted_at/signed_at, a legal text version, or an evidence/
// snapshot payload). This proves the customer agreed, independent of whether
// the document is ready to be mailed externally.
export function hasLegalPoaAcceptance(poa: PoaLike | null | undefined): boolean {
  if (!poa) return false
  if (!poaStatusIsAccepted(poa)) return false
  return Boolean(
    clean(poa.accepted_at) ||
      clean(poa.signed_at) ||
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

export function poaCustomerIdentity(
  poa: PoaLike | null | undefined,
  context?: { customerIdentity?: string | null },
): string | null {
  return (
    clean(poa?.signer_identity_number) ??
    clean(context?.customerIdentity) ??
    clean((poa?.evidence_payload as PoaLike | undefined)?.signer_identity_number) ??
    null
  )
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
  if (!poaCustomerIdentity(poa, context)) return false
  if (!clean(poa.signer_name)) return false
  if (!clean(poa.method)) return false
  if (!hasPoaSnapshot(poa)) return false
  return true
}

// Human-readable Swedish list of what is missing for external sendability.
export function poaMissingExternalFields(
  poa: PoaLike | null | undefined,
  context?: { customerIdentity?: string | null },
): string[] {
  const missing: string[] = []
  if (!hasLegalPoaAcceptance(poa)) missing.push('Juridiskt godkännande av fullmakt')
  if (!poaCustomerIdentity(poa, context)) missing.push('Person-/organisationsnummer')
  if (!clean(poa?.signer_name)) missing.push('Undertecknarens namn')
  if (!clean(poa?.method)) missing.push('Signeringsmetod')
  if (!hasPoaSnapshot(poa)) missing.push('Fullmaktsunderlag/dokument')
  return missing
}
