import type { MeteringPointRow } from '@/lib/masterdata/types'

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isVerifiedReference(point: MeteringPointRow): boolean {
  const status = clean(point.verification_status)?.toLowerCase() ?? ''
  const verifiedAt = clean(point.facility_data_verified_at)
  return Boolean(verifiedAt) || ['verified', 'confirmed', 'validated'].includes(status)
}

/**
 * Returns an identity that is safe to use in a customer operation. A database
 * row id is deliberately never treated as a meter point identifier.
 */
export function getMeteringPointIdentity(point: MeteringPointRow | null | undefined): string | null {
  if (!point) return null

  const meterPointId = clean(point.meter_point_id)
  if (meterPointId) return meterPointId

  const edielReference = clean(point.ediel_reference)
  return edielReference && isVerifiedReference(point) ? edielReference : null
}

export function hasMeteringPointIdentity(point: MeteringPointRow | null | undefined): boolean {
  return Boolean(getMeteringPointIdentity(point))
}

export function meteringPointIdentityLabel(point: MeteringPointRow | null | undefined): string | null {
  const identity = getMeteringPointIdentity(point)
  if (!identity) return null
  return clean(point?.meter_point_id) ? identity : `Verifierad Ediel-referens: ${identity}`
}
