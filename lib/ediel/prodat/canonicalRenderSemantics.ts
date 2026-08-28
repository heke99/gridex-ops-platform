import type { CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'

export type CanonicalProdatRenderSemantics = {
  suppressAgreementReference: boolean
  suppressEndUserParty: boolean
  suppressInstallationParty: boolean
  requiredMeteringMethod: string | null
  validityDateQualifier: string | null
  source: {
    document: string
    section: string
  }
}

/**
 * Rendering-specific projection of an already resolved canonical policy.
 * Builders may consume these hints but must not independently reinterpret raw
 * subtype aliases/reason codes. The universal policy remains the authority for
 * code/subtype/business meaning.
 */
export function resolveCanonicalProdatRenderSemantics(policy: CanonicalEdielPolicy): CanonicalProdatRenderSemantics {
  if (policy.family !== 'PRODAT') {
    throw new Error(`canonical_prodat_render_semantics_family_invalid:${policy.family}`)
  }

  const base: CanonicalProdatRenderSemantics = {
    suppressAgreementReference: false,
    suppressEndUserParty: false,
    suppressInstallationParty: false,
    requiredMeteringMethod: null,
    validityDateQualifier: null,
    source: {
      document: policy.guide.documentName,
      section: `${policy.code}${policy.subtype ?? ''} canonical render projection`,
    },
  }

  // Z09F/G are the only current legacy builder exceptions. They are projected
  // from canonical subtype, never from raw reason aliases or portal free text.
  if (policy.code === 'Z09' && (policy.subtype === 'F' || policy.subtype === 'G')) {
    return {
      ...base,
      suppressAgreementReference: true,
      suppressEndUserParty: true,
      suppressInstallationParty: true,
      requiredMeteringMethod: policy.subtype === 'F' ? 'Z04' : 'Z03',
      validityDateQualifier: '157',
    }
  }

  return base
}
