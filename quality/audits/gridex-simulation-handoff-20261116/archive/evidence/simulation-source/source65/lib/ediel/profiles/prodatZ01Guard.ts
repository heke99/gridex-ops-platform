// lib/ediel/profiles/prodatZ01Guard.ts
//
// Swedish PRODAT field requirement guard for PRODAT Z01.
//
// Per the Swedish PRODAT field requirements now used by Gridex, a PRODAT Z01
// MUST NOT be rendered or sent when anläggnings-id/facility_id is missing. When
// the identifier is missing the caller must:
//   * NOT render PRODAT Z01
//   * NOT create an ediel_outbox row
//   * NOT create a render_failed state
//   * NOT use UNKNOWN/MISSING/dummy IDs or dummy LIN rows
//   * NOT surface technical EDIFACT errors (LIN_MISSING /
//     PROFILE_REQUIRED_SEGMENT_MISSING) to the tenant
//   * block Ediel BEFORE render with a Swedish business blocker and use the
//     manual information request pipeline instead.

import {
  makeCustomerOperationBlocker,
  customerBlockerSuperadminDiagnostic,
  type CustomerOperationBlocker,
} from '@/lib/customer-operations/blockers'

export const PRODAT_Z01_FACILITY_BLOCKER_CODE =
  'facility_identifier_required_for_prodat_z01' as const

export type ProdatZ01RenderabilityResult =
  | { renderable: true }
  | {
      renderable: false
      blocker: CustomerOperationBlocker
      // Superadmin-only technical diagnostic; never surfaced to tenants.
      superadminDiagnostic: string
    }

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// Returns whether a PRODAT Z01 may be rendered for the given identifiers.
// `facility_id` (anläggnings-id) is mandatory. A bare metering_point_id does
// NOT satisfy the Z01 requirement on its own.
export function assertProdatZ01Renderable(input: {
  facilityId?: unknown
  normalizedFacilityId?: unknown
}): ProdatZ01RenderabilityResult {
  const facilityId = clean(input.facilityId) ?? clean(input.normalizedFacilityId)
  if (facilityId) {
    return { renderable: true }
  }

  return {
    renderable: false,
    blocker: makeCustomerOperationBlocker(PRODAT_Z01_FACILITY_BLOCKER_CODE),
    superadminDiagnostic:
      customerBlockerSuperadminDiagnostic(PRODAT_Z01_FACILITY_BLOCKER_CODE) ??
      'PRODAT Z01 blocked before render because Swedish PRODAT requirements require anläggnings-id/facility_id. Manual information request should be used.',
  }
}
