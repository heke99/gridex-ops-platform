import { getCanonicalEdielError, type CanonicalEdielErrorKey } from '@/lib/ediel/rulebook/mapEdielError'
import {
  canonicalProdatApplicationReferenceForProcessGroup,
  type ProdatApplicationReference,
} from '@/lib/ediel/rulebook/prodatApplicationReference'
import {
  allowedProdatSubtypes,
  resolveProdatSubtype,
  type ProdatMessageCode,
  type ProdatSubtypeRule,
} from '@/lib/ediel/rulebook/prodatSubtypeRegistry'

export type ProdatRuleProfileKey =
  | 'prodat_z01_customer_identity_request'
  | 'prodat_z02_customer_identity_response'
  | 'prodat_z03_supplier_switch'
  | 'prodat_z04_supplier_switch_confirmation'
  | 'prodat_z05_old_supplier_confirmation'
  | 'prodat_z06_masterdata_grid_to_supplier'
  | 'prodat_z08_contract_end'
  | 'prodat_z09_masterdata_supplier_to_grid'
  | 'prodat_z10_meter_change'
  | 'prodat_z13_permission_request'
  | 'prodat_z14_permission_response'
  | 'prodat_z15_permission_ended'
  | 'prodat_z18_permission_end_request'

export type ProdatProcessGroup =
  | 'supplier_switch'
  | 'customer_masterdata'
  | 'delivery_contract'
  | 'masterdata'
  | 'metering'
  | 'metering_access'

export type ProdatCanonicalProfile = {
  profileKey: ProdatRuleProfileKey
  messageCode: ProdatMessageCode
  meaning: string
  applicationReference: ProdatApplicationReference
  associationAssignedCode: 'E2SE6A'
  edifactDirectory: 'D97A'
  guideVersion: '26.A'
  guideRevision: '3'
  effectiveFrom: '2026-04-01'
  processGroup: ProdatProcessGroup
  /** Compatibility projection only. Canonical validation uses subtypeRules. */
  allowedVariants: string[]
  subtypeRules: readonly ProdatSubtypeRule[]
  direction: 'actor_to_portal' | 'portal_to_actor'
  senderRole: 'supplier' | 'esco' | 'grid_owner'
  receiverRole: 'supplier' | 'esco' | 'grid_owner'
  expectedAckFamily: 'APERAK'
  requiresContrl: true
  z01AperakException?: boolean
  requiredSignals: string[]
  errorKeys: CanonicalEdielErrorKey[]
}

const common = {
  associationAssignedCode: 'E2SE6A',
  edifactDirectory: 'D97A',
  guideVersion: '26.A',
  guideRevision: '3',
  effectiveFrom: '2026-04-01',
  expectedAckFamily: 'APERAK',
  requiresContrl: true,
} as const

function variants(code: ProdatMessageCode): { allowedVariants: string[]; subtypeRules: readonly ProdatSubtypeRule[] } {
  const rules = allowedProdatSubtypes(code)
  return {
    allowedVariants: rules.flatMap((rule) => [rule.subtype, rule.transactionReasonCode]),
    subtypeRules: rules,
  }
}

function profile(input: Omit<ProdatCanonicalProfile,
  | 'applicationReference'
  | 'associationAssignedCode'
  | 'edifactDirectory'
  | 'guideVersion'
  | 'guideRevision'
  | 'effectiveFrom'
  | 'expectedAckFamily'
  | 'requiresContrl'
  | 'allowedVariants'
  | 'subtypeRules'
>): ProdatCanonicalProfile {
  return {
    ...input,
    applicationReference: canonicalProdatApplicationReferenceForProcessGroup(input.processGroup),
    ...common,
    ...variants(input.messageCode),
  }
}

/**
 * Canonical Swedish electricity-market PRODAT 26.A Revision 3 catalog.
 * Message/subtype combinations are derived from field 223 in the current guide;
 * do not add a second hand-maintained combination matrix here.
 */
export const PRODAT_CANONICAL_PROFILES: ProdatCanonicalProfile[] = [
  profile({ profileKey: 'prodat_z01_customer_identity_request', messageCode: 'Z01', meaning: 'Request for customer identity', processGroup: 'customer_masterdata', direction: 'actor_to_portal', senderRole: 'supplier', receiverRole: 'grid_owner', z01AperakException: true, requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD'], errorKeys: ['OBJECT_NOT_IDENTIFIED', 'MANDATORY_FIELD_MISSING'] }),
  profile({ profileKey: 'prodat_z02_customer_identity_response', messageCode: 'Z02', meaning: 'Response to customer identity request', processGroup: 'customer_masterdata', direction: 'portal_to_actor', senderRole: 'grid_owner', receiverRole: 'supplier', requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD'], errorKeys: ['OBJECT_NOT_IDENTIFIED', 'MANDATORY_FIELD_MISSING'] }),
  profile({ profileKey: 'prodat_z03_supplier_switch', messageCode: 'Z03', meaning: 'Supplier switch / move notification', processGroup: 'supplier_switch', direction: 'actor_to_portal', senderRole: 'supplier', receiverRole: 'grid_owner', requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD+FR', 'NAD+DO', 'LIN'], errorKeys: ['OBJECT_NOT_IDENTIFIED', 'INCORRECT_METERING_POINT_ID', 'INCORRECT_GRID_AREA_ID'] }),
  profile({ profileKey: 'prodat_z04_supplier_switch_confirmation', messageCode: 'Z04', meaning: 'Grid-owner confirmation/information about supplier switch or move', processGroup: 'supplier_switch', direction: 'portal_to_actor', senderRole: 'grid_owner', receiverRole: 'supplier', requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD', 'LIN'], errorKeys: ['OBJECT_NOT_IDENTIFIED'] }),
  profile({ profileKey: 'prodat_z05_old_supplier_confirmation', messageCode: 'Z05', meaning: 'Grid-owner confirmation/information to old supplier', processGroup: 'supplier_switch', direction: 'portal_to_actor', senderRole: 'grid_owner', receiverRole: 'supplier', requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD', 'LIN'], errorKeys: ['OBJECT_NOT_IDENTIFIED'] }),
  profile({ profileKey: 'prodat_z06_masterdata_grid_to_supplier', messageCode: 'Z06', meaning: 'Grid-owner masterdata update to supplier', processGroup: 'masterdata', direction: 'portal_to_actor', senderRole: 'grid_owner', receiverRole: 'supplier', requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD', 'LIN'], errorKeys: ['OBJECT_NOT_IDENTIFIED'] }),
  profile({ profileKey: 'prodat_z08_contract_end', messageCode: 'Z08', meaning: 'Supplier information about ended/rescinded contract', processGroup: 'delivery_contract', direction: 'actor_to_portal', senderRole: 'supplier', receiverRole: 'grid_owner', requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD', 'LIN'], errorKeys: ['OBJECT_NOT_IDENTIFIED'] }),
  profile({ profileKey: 'prodat_z09_masterdata_supplier_to_grid', messageCode: 'Z09', meaning: 'Supplier masterdata update to grid owner', processGroup: 'masterdata', direction: 'actor_to_portal', senderRole: 'supplier', receiverRole: 'grid_owner', requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD', 'LIN'], errorKeys: ['OBJECT_NOT_IDENTIFIED'] }),
  profile({ profileKey: 'prodat_z10_meter_change', messageCode: 'Z10', meaning: 'Meter update from grid owner to supplier', processGroup: 'metering', direction: 'portal_to_actor', senderRole: 'grid_owner', receiverRole: 'supplier', requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD', 'LIN'], errorKeys: ['OBJECT_NOT_IDENTIFIED'] }),
  profile({ profileKey: 'prodat_z13_permission_request', messageCode: 'Z13', meaning: 'ESCO request for metering-value access', processGroup: 'metering_access', direction: 'actor_to_portal', senderRole: 'esco', receiverRole: 'grid_owner', requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD+FR', 'NAD+DO', 'NAD+UD', 'LIN', 'RFF+Z05'], errorKeys: ['OBJECT_NOT_IDENTIFIED', 'ACTOR_NOT_CONNECTED'] }),
  profile({ profileKey: 'prodat_z14_permission_response', messageCode: 'Z14', meaning: 'Grid-owner approval/rejection of metering-value access', processGroup: 'metering_access', direction: 'portal_to_actor', senderRole: 'grid_owner', receiverRole: 'esco', requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD+FR', 'NAD+DO', 'NAD+UD', 'LIN', 'RFF+LI'], errorKeys: ['OBJECT_NOT_IDENTIFIED', 'INCORRECT_PERMISSION_STATUS'] }),
  profile({ profileKey: 'prodat_z15_permission_ended', messageCode: 'Z15', meaning: 'Grid-owner termination of active metering-value permission', processGroup: 'metering_access', direction: 'portal_to_actor', senderRole: 'grid_owner', receiverRole: 'esco', requiredSignals: ['NAD+FR', 'NAD+DO', 'NAD+UD', 'LIN', 'DTM+693', 'DTM+164', 'CCI+Z13', 'CCI+Z23', 'CCI+Z25', 'RFF+Z05', 'RFF+LI', 'RFF+Z09'], errorKeys: ['OBJECT_NOT_IDENTIFIED', 'INCORRECT_PERMISSION_STATUS', 'INCORRECT_PERMISSION_END_REASON'] }),
  profile({ profileKey: 'prodat_z18_permission_end_request', messageCode: 'Z18', meaning: 'ESCO request to end metering-value reporting', processGroup: 'metering_access', direction: 'actor_to_portal', senderRole: 'esco', receiverRole: 'grid_owner', requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM+693', 'DTM+164', 'NAD+FR', 'NAD+DO', 'NAD+UD', 'LIN', 'CCI+Z13', 'CCI+Z25', 'RFF+Z05', 'RFF+LI', 'RFF+Z09'], errorKeys: ['INCORRECT_PERMISSION_END_REASON', 'ACTOR_NOT_CONNECTED'] }),
]

export function getCanonicalProdatProfile(messageCode: string | null | undefined): ProdatCanonicalProfile | null {
  const code = String(messageCode ?? '').toUpperCase()
  return PRODAT_CANONICAL_PROFILES.find((entry) => entry.messageCode === code) ?? null
}

export function validateProdatSubtype(input: {
  messageCode?: string | null
  subtypeOrReasonCode?: string | null
  bilateralCapabilityVerified?: boolean
}) {
  return resolveProdatSubtype({
    messageCode: input.messageCode,
    subtypeOrReasonCode: input.subtypeOrReasonCode,
    bilateralCapabilityVerified: input.bilateralCapabilityVerified,
  })
}

export function validateProdatApplicationReference(input: { messageCode?: string | null; applicationReference?: string | null }) {
  const profile = getCanonicalProdatProfile(input.messageCode)
  if (!profile) {
    return {
      ok: false,
      expectedApplicationReference: null,
      ruleKeys: ['APPREF_DDQ_FOR_SUPPLIER'],
      reason: `PRODAT ${String(input.messageCode ?? '').toUpperCase() || 'utan meddelandekod'} ingår inte i den verifierade svenska 26.A-funktionslistan.`,
    }
  }

  const provided = String(input.applicationReference ?? '').trim().toUpperCase()
  const expected = profile.applicationReference
  const ok = !provided || provided === expected
  const ruleKey = profile.processGroup === 'metering_access'
    ? 'APPREF_DGI_FOR_PERMISSION'
    : 'APPREF_DDQ_FOR_SUPPLIER'

  return {
    ok,
    expectedApplicationReference: expected,
    ruleKeys: ok ? [] : [ruleKey],
    reason: ok ? null : `${profile.messageCode} ska använda ${expected}, inte ${input.applicationReference}.`,
  }
}

export function canonicalProdatError(key: CanonicalEdielErrorKey) {
  return getCanonicalEdielError(key)
}
