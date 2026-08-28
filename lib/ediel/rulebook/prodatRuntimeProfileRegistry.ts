import { getCanonicalProdatProfile } from '@/lib/ediel/rulebook/prodatRulebook'
import {
  allowedProdatSubtypes,
  canonicalProdatSubtypeAlias,
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
  subtype: ProdatSubtype | '*'
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
function runtimeRequirements(code: ProdatMessageCode, subtype: ProdatSubtype | '*'): RuntimeRequirementShape {
  switch (code) {
    case 'Z01':
      return { requiredContext: ['customerName'], requiresCustomerIdentity: false, requiresMeterPoint: false, requiresStartDate: false, requiresEndDate: false, businessResponse: 'Z02' }
    case 'Z02':
      return { requiredContext: ['customerName'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: false, requiresEndDate: false }
    case 'Z03':
      return { requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: true, requiresEndDate: false, businessResponse: subtype === 'L' ? 'Z04L' : subtype === 'LK' ? 'Z04LK' : null }
    case 'Z04':
      return { requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: subtype === 'L' || subtype === 'LK' || subtype === 'A', requiresEndDate: subtype === 'D' }
    case 'Z05':
      return { requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: subtype === 'L' || subtype === 'LK', requiresEndDate: false }
    case 'Z06':
      return { requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: false, requiresEndDate: false }
    case 'Z08':
      return { requiredContext: ['contractClosureReason'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: false, requiresEndDate: true, businessResponse: 'Z05L' }
    case 'Z09':
      return { requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: false, requiresMeterPoint: true, requiresStartDate: true, requiresEndDate: false }
    case 'Z10':
      return { requiredContext: [], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: false, requiresEndDate: false }
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

function profileKey(code: ProdatMessageCode, subtype: ProdatSubtype | '*'): string {
  return `prodat_26a_${code.toLowerCase()}${subtype === '*' ? '' : `_${subtype.toLowerCase()}`}`
}

function wildcardSubtype(code: ProdatMessageCode): '*' | null {
  return code === 'Z01' || code === 'Z02' || code === 'Z10' ? '*' : null
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
  if (requestedVersion && requestedVersion !== '26A' && requestedVersion !== canonical.associationAssignedCode) {
    return null
  }

  const wildcard = wildcardSubtype(canonical.messageCode)
  let subtype: ProdatSubtype | '*' | null = wildcard
  if (!wildcard) {
    const resolution = resolveProdatSubtype({
      messageCode: canonical.messageCode,
      subtypeOrReasonCode: input.subtypeOrReasonCode,
      bilateralCapabilityVerified: input.bilateralCapabilityVerified,
    })
    if (!resolution.ok || !resolution.subtype) return null
    subtype = resolution.subtype
  } else if (input.subtypeOrReasonCode) {
    const normalized = canonicalProdatSubtypeAlias(input.subtypeOrReasonCode, canonical.messageCode)
    if (normalized) {
      const resolution = resolveProdatSubtype({
        messageCode: canonical.messageCode,
        subtypeOrReasonCode: normalized,
        bilateralCapabilityVerified: input.bilateralCapabilityVerified,
      })
      if (!resolution.ok) return null
    }
  }

  if (!subtype) return null
  const requirements = runtimeRequirements(canonical.messageCode, subtype)
  return {
    key: profileKey(canonical.messageCode, subtype),
    code: canonical.messageCode,
    subtype,
    version: '26A',
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
  return getCanonicalProdatProfile('Z01')
    ? (['Z01','Z02','Z03','Z04','Z05','Z06','Z08','Z09','Z10','Z13','Z14','Z15','Z18'] as const).flatMap((code) => {
        const canonical = getCanonicalProdatProfile(code)
        if (!canonical) return []
        const wildcard = wildcardSubtype(canonical.messageCode)
        if (wildcard) {
          const resolved = resolveCanonicalProdatRuntimeProfile({ code, subtypeOrReasonCode: null, version: '26A' })
          return resolved ? [resolved] : []
        }
        return allowedProdatSubtypes(canonical.messageCode).flatMap((rule) => {
          // Bilateral-only variants stay visible as canonical profiles but are not
          // silently accepted by runtime unless capability is explicitly verified.
          const resolved = resolveCanonicalProdatRuntimeProfile({
            code,
            subtypeOrReasonCode: rule.subtype,
            version: '26A',
            bilateralCapabilityVerified: true,
          })
          return resolved ? [resolved] : []
        })
      })
    : []
}
