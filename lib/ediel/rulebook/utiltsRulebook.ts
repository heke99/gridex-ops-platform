import { getCanonicalEdielError, type CanonicalEdielErrorKey } from '@/lib/ediel/rulebook/mapEdielError'

export type UtiltsFunctionalResult = 'positive_aperak' | 'negative_aperak' | 'utilts_err' | 'negative_contrl'

export type UtiltsCanonicalProfile = {
  profileKey: string
  messageCode: 'E66' | 'E31' | 'S01' | 'S02' | 'S03' | 'S04'
  requiresContrl: true
  correctResult: 'positive_aperak'
  applicationErrorResult: 'negative_aperak'
  functionalErrorResult: 'utilts_err'
  requiredSignals: string[]
  agtCases: string[]
}

export const UTILTS_CANONICAL_PROFILES: UtiltsCanonicalProfile[] = [
  { profileKey: 'utilts_e66', messageCode: 'E66', requiresContrl: true, correctResult: 'positive_aperak', applicationErrorResult: 'negative_aperak', functionalErrorResult: 'utilts_err', requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD', 'IDE'], agtCases: ['UL2', 'UL3', 'UE1', 'UE2'] },
  { profileKey: 'utilts_e31', messageCode: 'E31', requiresContrl: true, correctResult: 'positive_aperak', applicationErrorResult: 'negative_aperak', functionalErrorResult: 'utilts_err', requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD', 'IDE'], agtCases: ['UL6'] },
  { profileKey: 'utilts_s01', messageCode: 'S01', requiresContrl: true, correctResult: 'positive_aperak', applicationErrorResult: 'negative_aperak', functionalErrorResult: 'utilts_err', requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD'], agtCases: [] },
  { profileKey: 'utilts_s02', messageCode: 'S02', requiresContrl: true, correctResult: 'positive_aperak', applicationErrorResult: 'negative_aperak', functionalErrorResult: 'utilts_err', requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD'], agtCases: ['UL4'] },
  { profileKey: 'utilts_s03', messageCode: 'S03', requiresContrl: true, correctResult: 'positive_aperak', applicationErrorResult: 'negative_aperak', functionalErrorResult: 'utilts_err', requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD'], agtCases: ['UL1'] },
  { profileKey: 'utilts_s04', messageCode: 'S04', requiresContrl: true, correctResult: 'positive_aperak', applicationErrorResult: 'negative_aperak', functionalErrorResult: 'utilts_err', requiredSignals: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD'], agtCases: [] },
]

export function getCanonicalUtiltsProfile(messageCode: string | null | undefined): UtiltsCanonicalProfile | null {
  const code = String(messageCode ?? '').toUpperCase()
  return UTILTS_CANONICAL_PROFILES.find((profile) => profile.messageCode === code) ?? null
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
