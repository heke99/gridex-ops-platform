export type EdielGuideFamily = 'PRODAT' | 'UTILTS' | 'APERAK' | 'CONTRL'

export type AuthoritativeEdielGuide = {
  family: EdielGuideFamily
  guideRevision: string
  associationAssignedCode: string | null
  documentName: string
  latestUpdated: string
  effectiveFrom: string
  effectiveTo: string | null
  semanticEffectiveFrom?: string
  activationDates?: readonly string[]
  authority: 'Svenska kraftnät'
  certificationScope: 'production_current' | 'future_effective' | 'technical_rules'
  fieldMatrixStatus: 'certified' | 'pending' | 'not_applicable'
}

/**
 * Effective-dated Swedish Ediel source registry.
 *
 * Rules in this file are deliberately limited to dates and identifiers that are
 * explicitly stated in the authoritative Swedish Ediel guides. Never infer a
 * validity date from a file name, Git timestamp or association-assigned code.
 *
 * Important: UNH/S009/0057 is not by itself a guide-revision identifier. The
 * Swedish UTILTS guides 25-A-3 and 25-A-4 both use E5SE5A, while 25-A-4 does
 * not become effective until 2026-10-01. Runtime rule selection therefore has
 * to use both the association-assigned code and the business/reference date.
 */
export const AUTHORITATIVE_EDIEL_GUIDES: readonly AuthoritativeEdielGuide[] = [
  {
    family: 'UTILTS',
    guideRevision: '25-A-3',
    associationAssignedCode: 'E5SE5A',
    documentName: '251001_Ediel_UTILTS-APERAK_User_Guide_Version_25-A-3',
    latestUpdated: '2025-10-01',
    effectiveFrom: '2025-06-01',
    effectiveTo: '2026-09-30',
    authority: 'Svenska kraftnät',
    certificationScope: 'production_current',
    fieldMatrixStatus: 'certified',
  },
  {
    family: 'UTILTS',
    guideRevision: '25-A-4',
    associationAssignedCode: 'E5SE5A',
    documentName: '260331_Ediel_UTILTS-APERAK_User_Guide_Version_25-A-4',
    latestUpdated: '2026-08-05',
    effectiveFrom: '2026-10-01',
    effectiveTo: null,
    authority: 'Svenska kraftnät',
    certificationScope: 'future_effective',
    // The active-message field matrix is the certified 25-A-3 base plus the
    // explicit 25-A-4 overlay in utilts25A4.ts. Removed S08-only fields and
    // processability/code-list changes are versioned there; no duplicated
    // independent matrix is allowed.
    fieldMatrixStatus: 'certified',
  },
  {
    family: 'PRODAT',
    guideRevision: '26-A',
    associationAssignedCode: 'E2SE6A',
    documentName: '260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B',
    latestUpdated: '2026-06-30',
    effectiveFrom: '2026-04-01',
    effectiveTo: null,
    authority: 'Svenska kraftnät',
    certificationScope: 'production_current',
    // 77 fields x 13 message functions are materialized immutably in
    // lib/ediel/prodat/prodat26AFieldMatrix.ts. DB rows are projections only.
    fieldMatrixStatus: 'certified',
  },
  {
    family: 'APERAK',
    guideRevision: '16-B',
    associationAssignedCode: 'E2SE6A',
    documentName: '260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B',
    latestUpdated: '2026-06-30',
    semanticEffectiveFrom: '2016-12-01',
    effectiveFrom: '2026-04-01',
    effectiveTo: null,
    authority: 'Svenska kraftnät',
    certificationScope: 'production_current',
    // PRODAT APERAK BGM/function + ERC/FTX semantics are code-owned by the
    // family-specific APERAK classifier/rulebook, not by mutable DB rows.
    fieldMatrixStatus: 'certified',
  },
  {
    family: 'CONTRL',
    guideRevision: '24-A-6',
    associationAssignedCode: null,
    documentName: '260220_Ediel-anvisning-generella_tekniska_regler_version_24-A-6',
    latestUpdated: '2026-02-20',
    effectiveFrom: '2024-04-01',
    activationDates: ['2024-04-01', '2024-10-01'],
    effectiveTo: null,
    authority: 'Svenska kraftnät',
    certificationScope: 'technical_rules',
    fieldMatrixStatus: 'not_applicable',
  },
] as const

function normalizeDate(value: string): string {
  const normalized = String(value ?? '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error('ediel_guide_reference_date_invalid')
  return normalized
}

export function resolveAuthoritativeEdielGuide(input: {
  family: EdielGuideFamily
  referenceDate: string
  associationAssignedCode?: string | null
}): AuthoritativeEdielGuide {
  const date = normalizeDate(input.referenceDate)
  const association = String(input.associationAssignedCode ?? '').trim().toUpperCase()
  const candidates = AUTHORITATIVE_EDIEL_GUIDES.filter((guide) => {
    if (guide.family !== input.family) return false
    if (guide.effectiveFrom > date) return false
    if (guide.effectiveTo && guide.effectiveTo < date) return false
    if (association && guide.associationAssignedCode?.toUpperCase() !== association) return false
    return true
  })

  if (candidates.length !== 1) {
    throw new Error(`ediel_guide_resolution_${candidates.length === 0 ? 'missing' : 'ambiguous'}:${input.family}:${date}:${association || 'none'}`)
  }
  return candidates[0]
}

export function getCurrentUtiltsGuide(referenceDate: string): AuthoritativeEdielGuide {
  return resolveAuthoritativeEdielGuide({
    family: 'UTILTS',
    referenceDate,
    associationAssignedCode: 'E5SE5A',
  })
}

export function assertGuideFieldMatrixCertified(guide: AuthoritativeEdielGuide): void {
  if (guide.fieldMatrixStatus !== 'certified') {
    throw new Error(`ediel_guide_field_matrix_not_certified:${guide.family}:${guide.guideRevision}`)
  }
}
