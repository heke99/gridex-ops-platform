import { getCanonicalEdielError, type CanonicalEdielErrorKey } from '@/lib/ediel/rulebook/mapEdielError'
import { getUtiltsMarketProfile } from '@/lib/ediel/rulebook/utiltsMarketEngine'
import {
  assertGuideFieldMatrixCertified,
  resolveAuthoritativeEdielGuide,
} from '@/lib/ediel/rulebook/guideRegistry'
import { getUtiltsFieldRequirement } from '@/lib/ediel/rulebook/utiltsFieldMatrix'

export type UtiltsFunctionalResult = 'positive_aperak' | 'negative_aperak' | 'utilts_err' | 'negative_contrl'
export type UtiltsPhase = 'planning' | 'metering' | 'settlement'
export type UtiltsLocation172Requirement = 'required' | 'conditional' | 'forbidden'
export type UtiltsIdentityRequirement =
  | 'metering_point'
  | 'metering_point_or_regulating_object'
  | 'aggregate'
  | 'aggregate_or_regulating_object'
  | 'error_context'
export type UtiltsCanonicalMessageCode =
  | 'S01' | 'S02' | 'S03' | 'S04' | 'S05' | 'S06' | 'S07'
  | 'E30' | 'E31' | 'E66' | 'E72' | 'E73' | 'E74' | 'ERR'

export type UtiltsCanonicalProfile = {
  profileKey: string
  messageCode: UtiltsCanonicalMessageCode
  officialMeaning: string
  businessProcess: string
  guideVersion: string
  guideRevision: string
  guideDocumentName: string
  associationAssignedCode: 'E5SE5A'
  productionReadiness: 'full' | 'inbound' | 'partial' | 'ack_only'
  version: 'E5SE5A'
  effectiveFrom: string
  effectiveTo: string | null
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
  location172Requirement: UtiltsLocation172Requirement
  identityRequirement: UtiltsIdentityRequirement
  requiresTransaction: boolean
  /** Operational compatibility summary. Exact R/D/O/X remains in utiltsFieldMatrix. */
  requiresMeteringPoint: boolean
  /** Operational compatibility summary. Exact conditional area rules remain in utiltsFieldMatrix. */
  requiresGridArea: boolean
  /** Operational compatibility summary for a delivery-period-bearing transaction. */
  requiresPeriod: boolean
  /** Operational compatibility summary for resolution-bearing value messages. */
  requiresResolution: boolean
  /** Operational compatibility summary for unit-bearing value messages. */
  requiresUnit: boolean
  /** True when the business message carries observations/quantities; request families are false. */
  requiresQuantities: boolean
  supportsCorrections: boolean
  validatesDst: boolean
  agtCases: string[]
}

/**
 * Compatibility snapshot for callers that only enumerate stable message
 * profiles. Normative guide selection MUST use resolveCanonicalUtiltsProfile
 * with an explicit business/reference date.
 */
const CURRENT_UTILTS_GUIDE = {
  guideVersion: '25-A-3',
  guideRevision: '3',
  guideDocumentName: '251001_Ediel_UTILTS-APERAK_User_Guide_Version_25-A-3',
  effectiveFrom: '2025-06-01',
  effectiveTo: '2026-09-30',
} as const

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

const UTILTS_OFFICIAL_MEANINGS: Record<UtiltsCanonicalMessageCode, string> = {
  S01: 'Aggregated settlement values from Svenska kraftnät/eSett.',
  S02: 'Consumption prognosis per installation/object from grid owner.',
  S03: 'Preliminary load profile shares / aggregated monthly average power from grid owner.',
  S04: 'Preliminary load profile shares from eSett.',
  S05: 'Aggregated settlement values.',
  S06: 'Request missing aggregated settlement values (S01/S04) from Imbalance Settlement Responsible.',
  S07: 'Time series per object.',
  E30: 'Collected meter values per object.',
  E31: 'Aggregated meter data including final load profile shares.',
  E66: 'Validated meter data per installation/object from grid owner.',
  E72: 'Request missing single collected meter values (E30) from Metered Data Collector.',
  E73: 'Request missing single validated metered values (E66/S02) from network owner / Metered Data Responsible.',
  E74: 'Request missing aggregated time series (E31/S03) from network owner / Metered Data Aggregator.',
  ERR: 'Negative UTILTS functional/processability response.',
}

const IDENTITY_REQUIREMENT: Record<UtiltsCanonicalMessageCode, UtiltsIdentityRequirement> = {
  E30: 'metering_point',
  E31: 'aggregate',
  E66: 'metering_point_or_regulating_object',
  E72: 'metering_point',
  E73: 'metering_point_or_regulating_object',
  E74: 'aggregate',
  S01: 'aggregate',
  S02: 'metering_point',
  S03: 'aggregate',
  S04: 'aggregate',
  S05: 'aggregate',
  S06: 'aggregate_or_regulating_object',
  S07: 'metering_point',
  ERR: 'error_context',
}

const OPERATIONAL_REQUIREMENTS: Record<UtiltsCanonicalMessageCode, {
  meteringPoint: boolean
  gridArea: boolean
  period: boolean
  resolution: boolean
  unit: boolean
  quantities: boolean
}> = {
  E30: { meteringPoint: true,  gridArea: true,  period: true,  resolution: true,  unit: false, quantities: true },
  E31: { meteringPoint: false, gridArea: true,  period: true,  resolution: true,  unit: true,  quantities: true },
  E66: { meteringPoint: true,  gridArea: true,  period: true,  resolution: true,  unit: true,  quantities: true },
  E72: { meteringPoint: true,  gridArea: false, period: true,  resolution: false, unit: false, quantities: false },
  E73: { meteringPoint: true,  gridArea: false, period: true,  resolution: false, unit: false, quantities: false },
  E74: { meteringPoint: false, gridArea: true,  period: true,  resolution: false, unit: false, quantities: false },
  S01: { meteringPoint: false, gridArea: true,  period: true,  resolution: true,  unit: true,  quantities: true },
  S02: { meteringPoint: true,  gridArea: true,  period: true,  resolution: true,  unit: true,  quantities: true },
  S03: { meteringPoint: false, gridArea: true,  period: true,  resolution: true,  unit: true,  quantities: true },
  S04: { meteringPoint: false, gridArea: true,  period: true,  resolution: true,  unit: true,  quantities: true },
  S05: { meteringPoint: false, gridArea: true,  period: true,  resolution: true,  unit: true,  quantities: true },
  S06: { meteringPoint: false, gridArea: true,  period: true,  resolution: false, unit: false, quantities: false },
  S07: { meteringPoint: true,  gridArea: false, period: true,  resolution: true,  unit: true,  quantities: true },
  ERR: { meteringPoint: false, gridArea: false, period: false, resolution: false, unit: false, quantities: false },
}

function location172Requirement(code: UtiltsCanonicalMessageCode): UtiltsLocation172Requirement {
  if (code === 'ERR') return 'conditional'
  const requirement = getUtiltsFieldRequirement(code, '209', 'metering_point_id')
  if (requirement === 'R') return 'required'
  if (requirement === 'D' || requirement === 'O') return 'conditional'
  if (requirement === 'X') return 'forbidden'
  throw new Error(`utilts_location_172_rule_missing:${code}`)
}

function readiness(code: UtiltsCanonicalMessageCode): UtiltsCanonicalProfile['productionReadiness'] {
  if (code === 'E73') return 'full'
  if (code === 'ERR') return 'ack_only'
  if (['S02', 'S03', 'S05', 'E31', 'E66'].includes(code)) return 'inbound'
  return 'partial'
}

type ProfileInput = Omit<
  UtiltsCanonicalProfile,
  | 'officialMeaning'
  | 'businessProcess'
  | 'guideVersion'
  | 'guideRevision'
  | 'guideDocumentName'
  | 'associationAssignedCode'
  | 'productionReadiness'
  | 'version'
  | 'effectiveFrom'
  | 'effectiveTo'
  | 'requiresContrl'
  | 'correctResult'
  | 'applicationErrorResult'
  | 'functionalErrorResult'
  | 'allowedSenderRoles'
  | 'allowedReceiverRoles'
  | 'bilateralCapabilityRequired'
  | 'location172Requirement'
  | 'identityRequirement'
  | 'requiresMeteringPoint'
  | 'requiresGridArea'
  | 'requiresPeriod'
  | 'requiresResolution'
  | 'requiresUnit'
  | 'requiresQuantities'
>

function profile(input: ProfileInput): UtiltsCanonicalProfile {
  const market = getUtiltsMarketProfile(input.messageCode)
  if (!market) throw new Error(`utilts_market_profile_missing:${input.messageCode}`)
  const operational = OPERATIONAL_REQUIREMENTS[input.messageCode]
  return {
    ...input,
    officialMeaning: UTILTS_OFFICIAL_MEANINGS[input.messageCode],
    businessProcess: UTILTS_BUSINESS_PROCESSES[input.messageCode],
    ...CURRENT_UTILTS_GUIDE,
    associationAssignedCode: 'E5SE5A',
    productionReadiness: readiness(input.messageCode),
    version: 'E5SE5A',
    allowedSenderRoles: market.senderRoles,
    allowedReceiverRoles: market.receiverRoles,
    bilateralCapabilityRequired: market.bilateralRequired,
    requiresContrl: true,
    correctResult: 'positive_aperak',
    applicationErrorResult: 'negative_aperak',
    functionalErrorResult: 'utilts_err',
    location172Requirement: location172Requirement(input.messageCode),
    identityRequirement: IDENTITY_REQUIREMENT[input.messageCode],
    requiresMeteringPoint: operational.meteringPoint,
    requiresGridArea: operational.gridArea,
    requiresPeriod: operational.period,
    requiresResolution: operational.resolution,
    requiresUnit: operational.unit,
    requiresQuantities: operational.quantities,
  }
}

const common = ['UNB', 'UNH', 'BGM', 'DTM', 'NAD']
export const UTILTS_CANONICAL_PROFILES: readonly UtiltsCanonicalProfile[] = [
  profile({ profileKey: 'utilts_e66', messageCode: 'E66', phase: 'metering', scope: 'metering_point', requiredSignals: [...common, 'IDE'], requiresTransaction: true, supportsCorrections: true, validatesDst: true, agtCases: ['UL2', 'UL3', 'UE1', 'UE2'] }),
  profile({ profileKey: 'utilts_e31', messageCode: 'E31', phase: 'settlement', scope: 'grid_area', requiredSignals: [...common, 'IDE'], requiresTransaction: true, supportsCorrections: true, validatesDst: true, agtCases: ['UL6'] }),
  profile({ profileKey: 'utilts_e30', messageCode: 'E30', phase: 'metering', scope: 'metering_point', requiredSignals: [...common, 'IDE', 'LOC+172'], requiresTransaction: true, supportsCorrections: true, validatesDst: true, agtCases: [] }),
  profile({ profileKey: 'utilts_e72', messageCode: 'E72', phase: 'metering', scope: 'request', requiredSignals: [...common, 'IDE', 'LOC+172'], requiresTransaction: true, supportsCorrections: false, validatesDst: false, agtCases: [] }),
  profile({ profileKey: 'utilts_e73', messageCode: 'E73', phase: 'metering', scope: 'request', requiredSignals: [...common, 'IDE'], requiresTransaction: true, supportsCorrections: false, validatesDst: false, agtCases: [] }),
  profile({ profileKey: 'utilts_e74', messageCode: 'E74', phase: 'settlement', scope: 'request', requiredSignals: [...common, 'IDE'], requiresTransaction: true, supportsCorrections: false, validatesDst: false, agtCases: [] }),
  profile({ profileKey: 'utilts_s01', messageCode: 'S01', phase: 'settlement', scope: 'grid_area', requiredSignals: [...common, 'IDE'], requiresTransaction: true, supportsCorrections: true, validatesDst: false, agtCases: [] }),
  profile({ profileKey: 'utilts_s02', messageCode: 'S02', phase: 'planning', scope: 'metering_point', requiredSignals: [...common, 'IDE', 'LOC+172'], requiresTransaction: true, supportsCorrections: true, validatesDst: false, agtCases: ['UL4'] }),
  profile({ profileKey: 'utilts_s03', messageCode: 'S03', phase: 'planning', scope: 'grid_area', requiredSignals: [...common, 'IDE', 'LOC+239'], requiresTransaction: true, supportsCorrections: true, validatesDst: true, agtCases: ['UL1'] }),
  profile({ profileKey: 'utilts_s04', messageCode: 'S04', phase: 'planning', scope: 'grid_area', requiredSignals: [...common, 'IDE', 'LOC+239'], requiresTransaction: true, supportsCorrections: true, validatesDst: true, agtCases: [] }),
  profile({ profileKey: 'utilts_s05', messageCode: 'S05', phase: 'settlement', scope: 'grid_area', requiredSignals: [...common, 'IDE'], requiresTransaction: true, supportsCorrections: true, validatesDst: false, agtCases: [] }),
  profile({ profileKey: 'utilts_s06', messageCode: 'S06', phase: 'settlement', scope: 'request', requiredSignals: [...common, 'IDE'], requiresTransaction: true, supportsCorrections: false, validatesDst: false, agtCases: [] }),
  profile({ profileKey: 'utilts_s07', messageCode: 'S07', phase: 'settlement', scope: 'metering_point', requiredSignals: [...common, 'IDE', 'LOC+172'], requiresTransaction: true, supportsCorrections: true, validatesDst: true, agtCases: [] }),
  profile({ profileKey: 'utilts_err', messageCode: 'ERR', phase: 'metering', scope: 'error', requiredSignals: ['UNB', 'UNH', 'BGM', 'ERC'], requiresTransaction: false, supportsCorrections: false, validatesDst: false, agtCases: ['UE1', 'UE2'] }),
] as const

export function getCanonicalUtiltsProfile(messageCode: string | null | undefined): UtiltsCanonicalProfile | null {
  const code = String(messageCode ?? '').toUpperCase()
  return UTILTS_CANONICAL_PROFILES.find((entry) => entry.messageCode === code) ?? null
}

function guideImplementationRevision(guideRevision: string): string {
  const match = String(guideRevision).match(/-(\d+)$/)
  if (!match) throw new Error(`utilts_guide_revision_unparseable:${guideRevision}`)
  return match[1]
}

/**
 * Resolve the profile and all guide metadata from one effective-dated source.
 * Never select 25-A-3/25-A-4 from the shared E5SE5A association code alone.
 */
export function resolveCanonicalUtiltsProfile(input: {
  messageCode: string | null | undefined
  businessDate: string
  version: string
}): UtiltsCanonicalProfile {
  const base = getCanonicalUtiltsProfile(input.messageCode)
  if (!base) throw new Error(`utilts_profile_not_found:${String(input.messageCode ?? '')}`)

  const version = String(input.version ?? '').trim().toUpperCase()
  if (version !== base.version) throw new Error(`utilts_profile_version_not_supported:${version || 'missing'}`)

  const businessDate = String(input.businessDate ?? '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) throw new Error('utilts_profile_business_date_invalid')

  const guide = resolveAuthoritativeEdielGuide({
    family: 'UTILTS',
    referenceDate: businessDate,
    associationAssignedCode: version,
  })
  assertGuideFieldMatrixCertified(guide)

  return {
    ...base,
    guideVersion: guide.guideRevision,
    guideRevision: guideImplementationRevision(guide.guideRevision),
    guideDocumentName: guide.documentName,
    effectiveFrom: guide.effectiveFrom,
    effectiveTo: guide.effectiveTo,
  }
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
