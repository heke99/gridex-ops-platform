import {
  PRODAT_CANONICAL_PROFILES,
  getCanonicalProdatProfile,
} from '@/lib/ediel/rulebook/prodatRulebook'
import {
  allowedProdatSubtypes,
  resolveProdatSubtype,
  type ProdatMessageCode,
  type ProdatSubtype,
} from '@/lib/ediel/rulebook/prodatSubtypeRegistry'

export type CanonicalProdatRuntimeContextKey =
  | 'customerName'
  | 'reasonForTransaction'
  | 'contractClosureReason'
  | 'installationDirection'
  | 'permissionPurpose'
  | 'reportingFrequency'
  | 'energyProductId'
  | 'permissionEndDate'
  | 'permissionStatus'
  | 'permissionEndReason'
  | 'permissionId'
  | 'permissionTimestamp'

export type CanonicalProdatRuntimeProfile = {
  key: string
  code: ProdatMessageCode
  subtype: ProdatSubtype
  version: '26A'
  associationAssignedCode: 'E2SE6A'
  requiredContext: readonly CanonicalProdatRuntimeContextKey[]
  requiresCustomerIdentity: boolean
  requiresMeterPoint: boolean
  requiresStartDate: boolean
  requiresEndDate: boolean
  businessResponse: string | null
}

type RuntimeRequirementShape = Omit<
  CanonicalProdatRuntimeProfile,
  'key' | 'code' | 'subtype' | 'version' | 'associationAssignedCode' | 'businessResponse'
> & {
  businessResponse?: string | null
}

/**
 * Builder-input requirements belong to the canonical rulebook subsystem, not
 * to renderers or legacy adapters. They translate the verified PRODAT profile
 * into Gridex runtime context fields; they do not redefine field 223, field 311
 * or the immutable 26.A R/D/O/X matrix.
 */
function runtimeRequirements(code: ProdatMessageCode, subtype: ProdatSubtype): RuntimeRequirementShape {
  switch (code) {
    case 'Z01':
      return { requiredContext: ['customerName'], requiresCustomerIdentity: false, requiresMeterPoint: false, requiresStartDate: false, requiresEndDate: false, businessResponse: subtype === 'L' ? 'Z02L' : subtype === 'LK' ? 'Z02LK' : null }
    case 'Z02':
      return { requiredContext: ['customerName'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: false, requiresEndDate: false }
    case 'Z03':
      return { requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: true, requiresEndDate: false, businessResponse: subtype === 'L' ? 'Z04L' : subtype === 'LK' ? 'Z04LK' : subtype === 'C' ? 'Z04C' : null }
    case 'Z04':
      return { requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: subtype === 'L' || subtype === 'LK' || subtype === 'A', requiresEndDate: subtype === 'D' }
    case 'Z05':
      return { requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: subtype === 'L' || subtype === 'LK', requiresEndDate: false }
    case 'Z06':
      return { requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: false, requiresEndDate: false }
    case 'Z08':
      return { requiredContext: ['contractClosureReason'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: false, requiresEndDate: true, businessResponse: subtype === 'H' ? 'Z05L' : null }
    case 'Z09':
      return { requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: false, requiresMeterPoint: true, requiresStartDate: true, requiresEndDate: false }
    case 'Z10':
      return { requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: false, requiresEndDate: false }
    case 'Z13':
      return { requiredContext: ['reasonForTransaction', 'installationDirection', 'permissionPurpose', 'reportingFrequency', 'energyProductId', ...(subtype === 'VH' ? ['permissionEndDate' as const] : [])], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: true, requiresEndDate: subtype === 'VH' }
    case 'Z14':
      return { requiredContext: ['permissionStatus', ...(subtype === 'VH' ? ['permissionEndDate' as const] : [])], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: subtype === 'V' || subtype === 'VH', requiresEndDate: subtype === 'VH' }
    case 'Z15':
      return { requiredContext: subtype === 'C' ? ['permissionStatus'] : ['permissionStatus', 'permissionEndReason', 'permissionEndDate'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: false, requiresEndDate: subtype !== 'C' }
    case 'Z18':
      return { requiredContext: ['permissionId', 'permissionTimestamp', 'permissionEndReason', 'permissionEndDate'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: false, requiresEndDate: true }
  }
}

function profileKey(code: ProdatMessageCode, subtype: ProdatSubtype): string {
  return `prodat_26a_${code.toLowerCase()}_${subtype.toLowerCase()}`
}

export function resolveCanonicalProdatRuntimeProfile(input: {
  code: string | null | undefined
  subtypeOrReasonCode?: string | null
  version?: string | null
  bilateralCapabilityVerified?: boolean
}): CanonicalProdatRuntimeProfile | null {
  const canonical = getCanonicalProdatProfile(input.code)
  if (!canonical) return null

  const requestedVersion = String(input.version ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  const canonicalVersion = canonical.guideVersion.replace(/[^A-Z0-9]/gi, '').toUpperCase()
  if (requestedVersion && requestedVersion !== canonicalVersion && requestedVersion !== canonical.associationAssignedCode) {
    return null
  }

  // Every supported PRODAT 26.A function has an explicit transaction subtype.
  // Never collapse Z01/Z02/Z10 to a wildcard: Z01L != Z01LK, Z02L != Z02LK,
  // and Z10M is the defined meter-replacement process.
  const resolution = resolveProdatSubtype({
    messageCode: canonical.messageCode,
    subtypeOrReasonCode: input.subtypeOrReasonCode,
    bilateralCapabilityVerified: input.bilateralCapabilityVerified,
  })
  if (!resolution.ok || !resolution.subtype) return null

  const subtype = resolution.subtype
  const requirements = runtimeRequirements(canonical.messageCode, subtype)
  return {
    key: profileKey(canonical.messageCode, subtype),
    code: canonical.messageCode,
    subtype,
    version: canonicalVersion as '26A',
    associationAssignedCode: canonical.associationAssignedCode,
    requiredContext: requirements.requiredContext,
    requiresCustomerIdentity: requirements.requiresCustomerIdentity,
    requiresMeterPoint: requirements.requiresMeterPoint,
    requiresStartDate: requirements.requiresStartDate,
    requiresEndDate: requirements.requiresEndDate,
    businessResponse: requirements.businessResponse ?? null,
  }
}

export function listCanonicalProdatRuntimeProfiles(): readonly CanonicalProdatRuntimeProfile[] {
  return PRODAT_CANONICAL_PROFILES.flatMap((canonical) =>
    allowedProdatSubtypes(canonical.messageCode).flatMap((rule) => {
      const resolved = resolveCanonicalProdatRuntimeProfile({
        code: canonical.messageCode,
        subtypeOrReasonCode: rule.subtype,
        version: canonical.guideVersion,
        bilateralCapabilityVerified: true,
      })
      return resolved ? [resolved] : []
    }),
  )
}
