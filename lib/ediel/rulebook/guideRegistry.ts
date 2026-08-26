export type EdielGuideFamily = 'PRODAT' | 'UTILTS' | 'APERAK' | 'CONTRL'

export type AuthoritativeEdielGuide = {
  family: EdielGuideFamily
  guideRevision: string
  associationAssignedCode: string | null
  documentName: string
  latestUpdated: string
  effectiveFrom: string
  effectiveTo: string | null
  authority: 'Svenska kraftnät'
  certificationScope: 'production_current' | 'future_effective' | 'technical_rules'
}

/**
 * Effective-dated Swedish Ediel source registry.
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
  },
  {
    family: 'APERAK',
    guideRevision: '16-B',
    associationAssignedCode: null,
    documentName: '260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B',
    latestUpdated: '2026-06-30',
    effectiveFrom: '2016-12-01',
    effectiveTo: null,
    authority: 'Svenska kraftnät',
    certificationScope: 'production_current',
  },
  {
    family: 'CONTRL',
    guideRevision: '24-A-6',
    associationAssignedCode: null,
    documentName: '260220_Ediel-anvisning-generella_tekniska_regler_version_24-A-6',
    latestUpdated: '2026-02-20',
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
    authority: 'Svenska kraftnät',
    certificationScope: 'technical_rules',
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
    if (association && guide.associationAssignedCode && guide.associationAssignedCode.toUpperCase() !== association) return false
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
