export type LegalMailEvidenceVersion = {
  id: string
}

function hasStoredAcceptance(
  acceptanceIds: Record<string, string>,
  documentId: string,
) {
  return (
    typeof acceptanceIds[documentId] === 'string'
    && acceptanceIds[documentId].trim().length > 0
  )
}

/**
 * Pure canonical predicate used by the post-commit customer communication flow.
 * Legal confirmation mail is eligible only when every immutable legal document
 * in the frozen bundle has a persisted acceptance row.
 */
export function contractLegalMailEvidenceReady(input: {
  acceptanceIds: Record<string, string>
  legalVersions: LegalMailEvidenceVersion[]
}) {
  const requiredDocumentIds = new Set(
    input.legalVersions.map((version) => version.id),
  )

  return (
    requiredDocumentIds.size > 0
    && Array.from(requiredDocumentIds).every((documentId) =>
      hasStoredAcceptance(input.acceptanceIds, documentId),
    )
  )
}
