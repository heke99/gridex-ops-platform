import { getCanonicalEdielError, type CanonicalEdielErrorKey } from '@/lib/ediel/rulebook/mapEdielError'

export type UtiltsFunctionalResult = 'positive_aperak' | 'negative_aperak' | 'utilts_err' | 'negative_contrl'
export type UtiltsCanonicalMessageCode =
  | 'S01' | 'S02' | 'S03' | 'S04' | 'S05' | 'S06' | 'S07'
  | 'E30' | 'E31' | 'E66' | 'E72' | 'E73' | 'E74' | 'ERR'

export type UtiltsCanonicalProfile = {
  profileKey: string
  messageCode: UtiltsCanonicalMessageCode
  version: 'E5SE5A'
  effectiveFrom: '2026-04-01'
  scope: 'metering_point' | 'grid_area' | 'register' | 'meter_change' | 'product' | 'request' | 'error'
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

function profile(input: Omit<UtiltsCanonicalProfile, 'version' | 'effectiveFrom' | 'requiresContrl' | 'correctResult' | 'applicationErrorResult' | 'functionalErrorResult'>): UtiltsCanonicalProfile {
  return {
    ...input,
    version: 'E5SE5A',
    effectiveFrom: '2026-04-01',
    requiresContrl: true,
    correctResult: 'positive_aperak',
    applicationErrorResult: 'negative_aperak',
    functionalErrorResult: 'utilts_err',
  }
}

const common = ['UNB', 'UNH', 'BGM', 'DTM', 'NAD']
export const UTILTS_CANONICAL_PROFILES: readonly UtiltsCanonicalProfile[] = [
  profile({ profileKey: 'utilts_e66', messageCode: 'E66', scope: 'metering_point', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: true, requiresGridArea: true, requiresPeriod: true, requiresResolution: true, requiresUnit: true, requiresQuantities: true, supportsCorrections: true, validatesDst: true, agtCases: ['UL2', 'UL3', 'UE1', 'UE2'] }),
  profile({ profileKey: 'utilts_e31', messageCode: 'E31', scope: 'grid_area', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: false, requiresGridArea: true, requiresPeriod: true, requiresResolution: true, requiresUnit: true, requiresQuantities: true, supportsCorrections: true, validatesDst: true, agtCases: ['UL6'] }),
  profile({ profileKey: 'utilts_e30', messageCode: 'E30', scope: 'metering_point', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: true, requiresGridArea: true, requiresPeriod: true, requiresResolution: true, requiresUnit: true, requiresQuantities: true, supportsCorrections: true, validatesDst: true, agtCases: [] }),
  profile({ profileKey: 'utilts_e72', messageCode: 'E72', scope: 'register', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: true, requiresGridArea: false, requiresPeriod: true, requiresResolution: false, requiresUnit: true, requiresQuantities: true, supportsCorrections: true, validatesDst: false, agtCases: [] }),
  profile({ profileKey: 'utilts_e73', messageCode: 'E73', scope: 'request', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: true, requiresGridArea: false, requiresPeriod: true, requiresResolution: false, requiresUnit: false, requiresQuantities: false, supportsCorrections: false, validatesDst: false, agtCases: [] }),
  profile({ profileKey: 'utilts_e74', messageCode: 'E74', scope: 'product', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: true, requiresGridArea: false, requiresPeriod: true, requiresResolution: true, requiresUnit: true, requiresQuantities: true, supportsCorrections: true, validatesDst: true, agtCases: [] }),
  profile({ profileKey: 'utilts_s01', messageCode: 'S01', scope: 'metering_point', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: true, requiresGridArea: false, requiresPeriod: true, requiresResolution: false, requiresUnit: true, requiresQuantities: true, supportsCorrections: true, validatesDst: false, agtCases: [] }),
  profile({ profileKey: 'utilts_s02', messageCode: 'S02', scope: 'metering_point', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: true, requiresGridArea: true, requiresPeriod: true, requiresResolution: true, requiresUnit: true, requiresQuantities: true, supportsCorrections: true, validatesDst: false, agtCases: ['UL4'] }),
  profile({ profileKey: 'utilts_s03', messageCode: 'S03', scope: 'grid_area', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: false, requiresGridArea: true, requiresPeriod: true, requiresResolution: true, requiresUnit: true, requiresQuantities: true, supportsCorrections: true, validatesDst: true, agtCases: ['UL1'] }),
  profile({ profileKey: 'utilts_s04', messageCode: 'S04', scope: 'metering_point', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: true, requiresGridArea: false, requiresPeriod: true, requiresResolution: true, requiresUnit: true, requiresQuantities: true, supportsCorrections: true, validatesDst: true, agtCases: [] }),
  profile({ profileKey: 'utilts_s05', messageCode: 'S05', scope: 'register', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: true, requiresGridArea: false, requiresPeriod: true, requiresResolution: false, requiresUnit: true, requiresQuantities: true, supportsCorrections: true, validatesDst: false, agtCases: [] }),
  profile({ profileKey: 'utilts_s06', messageCode: 'S06', scope: 'meter_change', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: true, requiresGridArea: false, requiresPeriod: true, requiresResolution: false, requiresUnit: true, requiresQuantities: true, supportsCorrections: true, validatesDst: false, agtCases: [] }),
  profile({ profileKey: 'utilts_s07', messageCode: 'S07', scope: 'product', requiredSignals: [...common, 'IDE', 'LOC'], requiresTransaction: true, requiresMeteringPoint: true, requiresGridArea: false, requiresPeriod: true, requiresResolution: true, requiresUnit: true, requiresQuantities: true, supportsCorrections: true, validatesDst: true, agtCases: [] }),
  profile({ profileKey: 'utilts_err', messageCode: 'ERR', scope: 'error', requiredSignals: ['UNB', 'UNH', 'BGM', 'ERC'], requiresTransaction: false, requiresMeteringPoint: false, requiresGridArea: false, requiresPeriod: false, requiresResolution: false, requiresUnit: false, requiresQuantities: false, supportsCorrections: false, validatesDst: false, agtCases: ['UE1', 'UE2'] }),
] as const

export function getCanonicalUtiltsProfile(messageCode: string | null | undefined): UtiltsCanonicalProfile | null {
  const code = String(messageCode ?? '').toUpperCase()
  return UTILTS_CANONICAL_PROFILES.find((entry) => entry.messageCode === code) ?? null
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
