import { getCanonicalEdielError, type CanonicalEdielErrorKey } from '@/lib/ediel/rulebook/mapEdielError'

export type UtiltsFunctionalResult = 'positive_aperak' | 'negative_aperak' | 'utilts_err' | 'negative_contrl'
export type UtiltsPhase = 'planning' | 'metering' | 'settlement'
export type UtiltsCanonicalMessageCode =
  | 'S01' | 'S02' | 'S03' | 'S04' | 'S05' | 'S06' | 'S07'
  | 'E30' | 'E31' | 'E66' | 'E72' | 'E73' | 'E74' | 'ERR'

export type UtiltsCanonicalProfile = {
  profileKey: string
  messageCode: UtiltsCanonicalMessageCode
  businessProcess: string
  guideVersion: '25-A-3'
  guideRevision: '3'
  associationAssignedCode: 'E5SE5A'
  productionReadiness: 'partial'
  version: 'E5SE5A'
  effectiveFrom: '2025-06-01'
  scope: 'metering_point' | 'grid_area' | 'register' | 'meter_change' | 'product' | 'request' | 'error'
  phase: UtiltsPhase
  allowedSenderRoles: readonly string[]
  allowedReceiverRoles: readonly string[]
  bilateralCapabilityRequired: boolean
  requiresContrl: true
  correctResult: 'positive_aperak'
  applicationErrorResult: 'negative_aperak'
  functionalErrorResult: 'utilts_err'
  requiredSignals: string[]
  requiresTransaction: boolean
  requiresMeteringPoint: boolean
  requiresGridArea: boolean
  requiresPeriod: boolean
  requiresResolution: boolean
  requiresUnit: boolean
  requiresQuantities: boolean
  supportsCorrections: boolean
  validatesDst: boolean
  agtCases: string[]
}

const UTILTS_BUSINESS_PROCESSES: Record<UtiltsCanonicalMessageCode, string> = {
  S01: 'aggregated_settlement',
  S02: 'object_consumption_forecast',
  S03: 'preliminary_shares',
  S04: 'summed_plan_values',
  S05: 'aggregated_settlement',
  S06: 'bilateral_aggregate_request',
  S07: 'object_time_series',
  E30: 'collected_metering',
  E31: 'final_aggregated_metering',
  E66: 'validated_metering',
  E72: 'missing_e30_request',
  E73: 'missing_s02_e66_request',
  E74: 'missing_s03_e31_request',
  ERR: 'functional_rejection',
}

function profile(input: Omit<UtiltsCanonicalProfile, 'businessProcess' | 'guideVersion' | 'guideRevision' | 'associationAssignedCode' | 'productionReadiness' | 'version' | 'effectiveFrom' | 'requiresContrl' | 'correctResult' | 'applicationErrorResult' | 'functionalErrorResult'>): UtiltsCanonicalProfile {
  return {
    ...input,
    businessProcess: UTILTS_BUSINESS_PROCESSES[input.messageCode],
    guideVersion: '25-A-3',
    guideRevision: '3',
    associationAssignedCode: 'E5SE5A',
    productionReadiness: 'partial',
    version: 'E5SE5A',
    effectiveFrom: '2025-06-01',
    requiresContrl: true,
    correctResult: 'positive_aperak',
    applicationErrorResult: 'negative_aperak',
    functionalErrorResult: 'utilts_err',
  }
}

const UTILTS_MARKET_ROLES = [
  'supplier',
  'electricity_supplier',
  'grid_owner',
  'balance_responsible',
  'esco',
  'energy_service_company',
  'service_provider',
] as const

const common = ['UNB', 'UNH', 'BGM', 'DTM', 'NAD']
export const UTILTS_CANONICAL_PROFILES: readonly UtiltsCanonicalProfile[] = [
  profile({ profileKey: 'utilts_e66', messageCode: 'E66', phase: 'metering', allowedSenderRoles: UTILTS_MARKET_ROLES, allowedReceiverRoles: UTILTS_MARKET_ROLES, bilateralCapabilityRequired: false, scope: 'metering_point', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: true, requiresGridArea: true, requiresPeriod: true, requiresResolution: true, requiresUnit: true, requiresQuantities: true, supportsCorrections: true, validatesDst: true, agtCases: ['UL2', 'UL3', 'UE1', 'UE2'] }),
  profile({ profileKey: 'utilts_e31', messageCode: 'E31', phase: 'settlement', allowedSenderRoles: UTILTS_MARKET_ROLES, allowedReceiverRoles: UTILTS_MARKET_ROLES, bilateralCapabilityRequired: false, scope: 'grid_area', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: false, requiresGridArea: true, requiresPeriod: true, requiresResolution: true, requiresUnit: true, requiresQuantities: true, supportsCorrections: true, validatesDst: true, agtCases: ['UL6'] }),
  profile({ profileKey: 'utilts_e30', messageCode: 'E30', phase: 'metering', allowedSenderRoles: UTILTS_MARKET_ROLES, allowedReceiverRoles: UTILTS_MARKET_ROLES, bilateralCapabilityRequired: false, scope: 'metering_point', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: true, requiresGridArea: true, requiresPeriod: true, requiresResolution: true, requiresUnit: true, requiresQuantities: true, supportsCorrections: true, validatesDst: true, agtCases: [] }),
  profile({ profileKey: 'utilts_e72', messageCode: 'E72', phase: 'metering', allowedSenderRoles: UTILTS_MARKET_ROLES, allowedReceiverRoles: UTILTS_MARKET_ROLES, bilateralCapabilityRequired: false, scope: 'request', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: true, requiresGridArea: false, requiresPeriod: true, requiresResolution: false, requiresUnit: false, requiresQuantities: false, supportsCorrections: false, validatesDst: false, agtCases: [] }),
  profile({ profileKey: 'utilts_e73', messageCode: 'E73', phase: 'metering', allowedSenderRoles: UTILTS_MARKET_ROLES, allowedReceiverRoles: UTILTS_MARKET_ROLES, bilateralCapabilityRequired: false, scope: 'request', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: true, requiresGridArea: false, requiresPeriod: true, requiresResolution: false, requiresUnit: false, requiresQuantities: false, supportsCorrections: false, validatesDst: false, agtCases: [] }),
  profile({ profileKey: 'utilts_e74', messageCode: 'E74', phase: 'settlement', allowedSenderRoles: UTILTS_MARKET_ROLES, allowedReceiverRoles: UTILTS_MARKET_ROLES, bilateralCapabilityRequired: false, scope: 'request', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: false, requiresGridArea: true, requiresPeriod: true, requiresResolution: false, requiresUnit: false, requiresQuantities: false, supportsCorrections: false, validatesDst: false, agtCases: [] }),
  profile({ profileKey: 'utilts_s01', messageCode: 'S01', phase: 'settlement', allowedSenderRoles: UTILTS_MARKET_ROLES, allowedReceiverRoles: UTILTS_MARKET_ROLES, bilateralCapabilityRequired: false, scope: 'grid_area', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: false, requiresGridArea: true, requiresPeriod: true, requiresResolution: false, requiresUnit: true, requiresQuantities: true, supportsCorrections: true, validatesDst: false, agtCases: [] }),
  profile({ profileKey: 'utilts_s02', messageCode: 'S02', phase: 'planning', allowedSenderRoles: UTILTS_MARKET_ROLES, allowedReceiverRoles: UTILTS_MARKET_ROLES, bilateralCapabilityRequired: false, scope: 'metering_point', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: true, requiresGridArea: true, requiresPeriod: true, requiresResolution: true, requiresUnit: true, requiresQuantities: true, supportsCorrections: true, validatesDst: false, agtCases: ['UL4'] }),
  profile({ profileKey: 'utilts_s03', messageCode: 'S03', phase: 'planning', allowedSenderRoles: UTILTS_MARKET_ROLES, allowedReceiverRoles: UTILTS_MARKET_ROLES, bilateralCapabilityRequired: false, scope: 'grid_area', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: false, requiresGridArea: true, requiresPeriod: true, requiresResolution: true, requiresUnit: true, requiresQuantities: true, supportsCorrections: true, validatesDst: true, agtCases: ['UL1'] }),
  profile({ profileKey: 'utilts_s04', messageCode: 'S04', phase: 'planning', allowedSenderRoles: UTILTS_MARKET_ROLES, allowedReceiverRoles: UTILTS_MARKET_ROLES, bilateralCapabilityRequired: false, scope: 'grid_area', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: false, requiresGridArea: true, requiresPeriod: true, requiresResolution: true, requiresUnit: true, requiresQuantities: true, supportsCorrections: true, validatesDst: true, agtCases: [] }),
  profile({ profileKey: 'utilts_s05', messageCode: 'S05', phase: 'settlement', allowedSenderRoles: UTILTS_MARKET_ROLES, allowedReceiverRoles: UTILTS_MARKET_ROLES, bilateralCapabilityRequired: false, scope: 'grid_area', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: false, requiresGridArea: true, requiresPeriod: true, requiresResolution: false, requiresUnit: true, requiresQuantities: true, supportsCorrections: true, validatesDst: false, agtCases: [] }),
  profile({ profileKey: 'utilts_s06', messageCode: 'S06', phase: 'settlement', allowedSenderRoles: UTILTS_MARKET_ROLES, allowedReceiverRoles: UTILTS_MARKET_ROLES, bilateralCapabilityRequired: true, scope: 'request', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: false, requiresGridArea: true, requiresPeriod: true, requiresResolution: false, requiresUnit: false, requiresQuantities: false, supportsCorrections: false, validatesDst: false, agtCases: [] }),
  profile({ profileKey: 'utilts_s07', messageCode: 'S07', phase: 'metering', allowedSenderRoles: UTILTS_MARKET_ROLES, allowedReceiverRoles: UTILTS_MARKET_ROLES, bilateralCapabilityRequired: false, scope: 'metering_point', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: true, requiresGridArea: false, requiresPeriod: true, requiresResolution: true, requiresUnit: true, requiresQuantities: true, supportsCorrections: true, validatesDst: true, agtCases: [] }),
  profile({ profileKey: 'utilts_err', messageCode: 'ERR', phase: 'metering', allowedSenderRoles: UTILTS_MARKET_ROLES, allowedReceiverRoles: UTILTS_MARKET_ROLES, bilateralCapabilityRequired: false, scope: 'error', requiredSignals: ['UNB', 'UNH', 'BGM', 'ERC'], requiresTransaction: false, requiresMeteringPoint: false, requiresGridArea: false, requiresPeriod: false, requiresResolution: false, requiresUnit: false, requiresQuantities: false, supportsCorrections: false, validatesDst: false, agtCases: ['UE1', 'UE2'] }),
] as const

export function getCanonicalUtiltsProfile(messageCode: string | null | undefined): UtiltsCanonicalProfile | null {
  const code = String(messageCode ?? '').toUpperCase()
  return UTILTS_CANONICAL_PROFILES.find((entry) => entry.messageCode === code) ?? null
}

export function resolveCanonicalUtiltsProfile(input: {
  messageCode: string | null | undefined
  businessDate: string
  version: string
}): UtiltsCanonicalProfile {
  const resolved = getCanonicalUtiltsProfile(input.messageCode)
  if (!resolved) throw new Error(`utilts_profile_not_found:${String(input.messageCode ?? '')}`)

  const version = String(input.version ?? '').trim().toUpperCase()
  if (version !== resolved.version) {
    throw new Error(`utilts_profile_version_not_supported:${version || 'missing'}`)
  }

  const businessDate = String(input.businessDate ?? '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    throw new Error('utilts_profile_business_date_invalid')
  }
  if (businessDate < resolved.effectiveFrom) {
    throw new Error(`utilts_profile_not_effective:${businessDate}`)
  }

  return resolved
}

export function decideUtiltsAckFamily(input: { syntaxOk: boolean; hasApplicationError?: boolean; hasFunctionalError?: boolean }): UtiltsFunctionalResult {
  if (!input.syntaxOk) return 'negative_contrl'
  if (input.hasFunctionalError) return 'utilts_err'
  if (input.hasApplicationError) return 'negative_aperak'
  return 'positive_aperak'
}

export function canonicalUtiltsError(key: CanonicalEdielErrorKey) {
  return getCanonicalEdielError(key)
}
