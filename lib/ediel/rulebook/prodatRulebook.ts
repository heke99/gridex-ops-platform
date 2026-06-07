import { evaluateApplicationReferenceGuard } from '@/lib/ediel/rulebook/canonicalRules'
import { getCanonicalEdielError, type CanonicalEdielErrorKey } from '@/lib/ediel/rulebook/mapEdielError'

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

export type ProdatCanonicalProfile = {
  profileKey: ProdatRuleProfileKey
  messageCode: string
  applicationReference: '23-DDQ-PRODAT' | '23-DGI-PRODAT'
  processGroup: 'supplier_switch' | 'customer_masterdata' | 'metering_access'
  allowedVariants: string[]
  direction: 'actor_to_portal' | 'portal_to_actor' | 'both'
  expectedAckFamily: 'APERAK'
  requiresContrl: true
  z01AperakException?: boolean
  requiredSignals: string[]
  errorKeys: CanonicalEdielErrorKey[]
}

export const PRODAT_CANONICAL_PROFILES: ProdatCanonicalProfile[] = [
  { profileKey: 'prodat_z01_customer_identity_request', messageCode: 'Z01', applicationReference: '23-DDQ-PRODAT', processGroup: 'customer_masterdata', allowedVariants: ['L', 'LK', 'Z22', 'Z23'], direction: 'both', expectedAckFamily: 'APERAK', requiresContrl: true, z01AperakException: true, requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD'], errorKeys: ['OBJECT_NOT_IDENTIFIED', 'MANDATORY_FIELD_MISSING'] },
  { profileKey: 'prodat_z02_customer_identity_response', messageCode: 'Z02', applicationReference: '23-DDQ-PRODAT', processGroup: 'customer_masterdata', allowedVariants: ['L', 'LK', 'Z22', 'Z23'], direction: 'both', expectedAckFamily: 'APERAK', requiresContrl: true, requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD'], errorKeys: ['OBJECT_NOT_IDENTIFIED', 'MANDATORY_FIELD_MISSING'] },
  { profileKey: 'prodat_z03_supplier_switch', messageCode: 'Z03', applicationReference: '23-DDQ-PRODAT', processGroup: 'supplier_switch', allowedVariants: ['L', 'LK', 'C', 'Z22', 'Z23', 'Z24'], direction: 'actor_to_portal', expectedAckFamily: 'APERAK', requiresContrl: true, requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD+FR', 'NAD+DO', 'LIN'], errorKeys: ['OBJECT_NOT_IDENTIFIED', 'INCORRECT_METERING_POINT_ID', 'INCORRECT_GRID_AREA_ID'] },
  { profileKey: 'prodat_z04_supplier_switch_confirmation', messageCode: 'Z04', applicationReference: '23-DDQ-PRODAT', processGroup: 'supplier_switch', allowedVariants: ['L', 'LK', 'C', 'A', 'D', 'Z22', 'Z23', 'Z24', 'Z26', 'Z70'], direction: 'portal_to_actor', expectedAckFamily: 'APERAK', requiresContrl: true, requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD', 'LIN'], errorKeys: ['OBJECT_NOT_IDENTIFIED'] },
  { profileKey: 'prodat_z05_old_supplier_confirmation', messageCode: 'Z05', applicationReference: '23-DDQ-PRODAT', processGroup: 'supplier_switch', allowedVariants: ['L', 'LK', 'C', 'Z22', 'Z23', 'Z24'], direction: 'portal_to_actor', expectedAckFamily: 'APERAK', requiresContrl: true, requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD', 'LIN'], errorKeys: ['OBJECT_NOT_IDENTIFIED'] },
  { profileKey: 'prodat_z06_masterdata_grid_to_supplier', messageCode: 'Z06', applicationReference: '23-DDQ-PRODAT', processGroup: 'supplier_switch', allowedVariants: ['E', 'F', 'G', 'Z34', 'E64', 'E32'], direction: 'portal_to_actor', expectedAckFamily: 'APERAK', requiresContrl: true, requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD', 'LIN'], errorKeys: ['OBJECT_NOT_IDENTIFIED'] },
  { profileKey: 'prodat_z08_contract_end', messageCode: 'Z08', applicationReference: '23-DDQ-PRODAT', processGroup: 'supplier_switch', allowedVariants: ['H', 'Z25'], direction: 'both', expectedAckFamily: 'APERAK', requiresContrl: true, requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD', 'LIN'], errorKeys: ['OBJECT_NOT_IDENTIFIED'] },
  { profileKey: 'prodat_z09_masterdata_supplier_to_grid', messageCode: 'Z09', applicationReference: '23-DDQ-PRODAT', processGroup: 'supplier_switch', allowedVariants: ['B', 'D', 'E', 'F', 'G', 'Z27', 'Z70', 'Z34', 'E64', 'E32'], direction: 'actor_to_portal', expectedAckFamily: 'APERAK', requiresContrl: true, requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD', 'LIN'], errorKeys: ['OBJECT_NOT_IDENTIFIED'] },
  { profileKey: 'prodat_z10_meter_change', messageCode: 'Z10', applicationReference: '23-DDQ-PRODAT', processGroup: 'supplier_switch', allowedVariants: ['M', 'E58'], direction: 'portal_to_actor', expectedAckFamily: 'APERAK', requiresContrl: true, requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD', 'LIN'], errorKeys: ['OBJECT_NOT_IDENTIFIED'] },
  { profileKey: 'prodat_z13_permission_request', messageCode: 'Z13', applicationReference: '23-DGI-PRODAT', processGroup: 'metering_access', allowedVariants: ['V', 'VH', 'S17', 'S18'], direction: 'actor_to_portal', expectedAckFamily: 'APERAK', requiresContrl: true, requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD+FR', 'NAD+DO', 'NAD+UD', 'LIN', 'RFF+Z05'], errorKeys: ['OBJECT_NOT_IDENTIFIED', 'ACTOR_NOT_CONNECTED'] },
  { profileKey: 'prodat_z14_permission_response', messageCode: 'Z14', applicationReference: '23-DGI-PRODAT', processGroup: 'metering_access', allowedVariants: ['V', 'VH', 'N', 'S17', 'S18', 'Z96'], direction: 'portal_to_actor', expectedAckFamily: 'APERAK', requiresContrl: true, requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD+FR', 'NAD+DO', 'NAD+UD', 'LIN', 'RFF+LI'], errorKeys: ['OBJECT_NOT_IDENTIFIED', 'INCORRECT_PERMISSION_STATUS'] },
  { profileKey: 'prodat_z15_permission_ended', messageCode: 'Z15', applicationReference: '23-DGI-PRODAT', processGroup: 'metering_access', allowedVariants: ['V', 'VH', 'C', 'S17', 'S18', 'Z24'], direction: 'portal_to_actor', expectedAckFamily: 'APERAK', requiresContrl: true, requiredSignals: ['NAD+FR', 'NAD+DO', 'NAD+UD', 'LIN', 'DTM+693', 'DTM+164', 'CCI+Z13', 'CCI+Z23', 'CCI+Z25', 'RFF+Z05', 'RFF+LI', 'RFF+Z09'], errorKeys: ['OBJECT_NOT_IDENTIFIED', 'INCORRECT_PERMISSION_STATUS', 'INCORRECT_PERMISSION_END_REASON'] },
  { profileKey: 'prodat_z18_permission_end_request', messageCode: 'Z18', applicationReference: '23-DGI-PRODAT', processGroup: 'metering_access', allowedVariants: ['V', 'S17'], direction: 'actor_to_portal', expectedAckFamily: 'APERAK', requiresContrl: true, requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM+693', 'DTM+164', 'NAD+FR', 'NAD+DO', 'NAD+UD', 'LIN', 'CCI+Z13', 'CCI+Z25', 'RFF+Z05', 'RFF+LI', 'RFF+Z09'], errorKeys: ['INCORRECT_PERMISSION_END_REASON', 'ACTOR_NOT_CONNECTED'] },
]

export function getCanonicalProdatProfile(messageCode: string | null | undefined): ProdatCanonicalProfile | null {
  const code = String(messageCode ?? '').toUpperCase()
  return PRODAT_CANONICAL_PROFILES.find((profile) => profile.messageCode === code) ?? null
}

export function validateProdatApplicationReference(input: { messageCode?: string | null; applicationReference?: string | null }) {
  const profile = getCanonicalProdatProfile(input.messageCode)
  const guard = evaluateApplicationReferenceGuard({ family: 'PRODAT', messageCode: input.messageCode, applicationReference: input.applicationReference })
  return {
    ok: guard.ok,
    expectedApplicationReference: guard.expectedApplicationReference ?? profile?.applicationReference ?? null,
    ruleKeys: guard.ruleKeys,
    reason: guard.reason,
  }
}

export function canonicalProdatError(key: CanonicalEdielErrorKey) {
  return getCanonicalEdielError(key)
}
