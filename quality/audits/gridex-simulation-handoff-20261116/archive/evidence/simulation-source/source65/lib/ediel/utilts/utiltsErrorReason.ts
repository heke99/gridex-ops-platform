// lib/ediel/utilts/utiltsErrorReason.ts
//
// Batch 7: UTILTS_ERR reason engine. The error code must reflect the ACTUAL
// reason, never a generic fallback that blindly changes codes. Identity/object
// errors are evaluated before period/quantity errors (PART 4, ERC rules).

import { getCanonicalEdielError, type CanonicalEdielError, type CanonicalEdielErrorKey } from '@/lib/ediel/rulebook/mapEdielError'

export type UtiltsErrorReason =
  | 'unknown_facility_or_metering_point'
  | 'wrong_grid_area'
  | 'wrong_time_series_product'
  | 'wrong_period'
  | 'wrong_resolution'
  | 'wrong_observation_count'
  | 'wrong_meter_or_register'
  | 'missing_structural_information'

// Evaluation order matters: object identity first, then grid area, then the
// period/quantity/structural reasons.
const REASON_PRIORITY: UtiltsErrorReason[] = [
  'unknown_facility_or_metering_point',
  'wrong_grid_area',
  'missing_structural_information',
  'wrong_time_series_product',
  'wrong_meter_or_register',
  'wrong_period',
  'wrong_resolution',
  'wrong_observation_count',
]

const REASON_TO_ERROR_KEY: Record<UtiltsErrorReason, CanonicalEdielErrorKey> = {
  unknown_facility_or_metering_point: 'INCORRECT_METERING_POINT_ID',
  wrong_grid_area: 'INCORRECT_GRID_AREA_ID',
  missing_structural_information: 'MANDATORY_FIELD_MISSING',
  wrong_time_series_product: 'UTILTS_E31_INCORRECT_DATA',
  wrong_meter_or_register: 'UTILTS_E31_INCORRECT_DATA',
  wrong_period: 'UTILTS_E31_INCORRECT_DATA',
  wrong_resolution: 'UTILTS_E31_INCORRECT_DATA',
  wrong_observation_count: 'UTILTS_E31_INCORRECT_DATA',
}

export type UtiltsErrorResolution = {
  reason: UtiltsErrorReason
  errorKey: CanonicalEdielErrorKey
  error: CanonicalEdielError
}

// Given the set of detected reasons, pick the single authoritative reason by
// priority (identity/object before period/quantity) and map it to a canonical
// error — never a generic fallback that overrides the real cause.
export function resolveUtiltsError(reasons: UtiltsErrorReason[]): UtiltsErrorResolution | null {
  if (!reasons || reasons.length === 0) return null
  const set = new Set(reasons)
  for (const candidate of REASON_PRIORITY) {
    if (set.has(candidate)) {
      const errorKey = REASON_TO_ERROR_KEY[candidate]
      return { reason: candidate, errorKey, error: getCanonicalEdielError(errorKey) }
    }
  }
  // A detected-but-unmapped reason must not silently become a generic code.
  return null
}

export function mapUtiltsErrorReason(reason: UtiltsErrorReason): UtiltsErrorResolution {
  const errorKey = REASON_TO_ERROR_KEY[reason]
  return { reason, errorKey, error: getCanonicalEdielError(errorKey) }
}
