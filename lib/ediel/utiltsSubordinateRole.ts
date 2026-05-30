export type UtiltsSubordinateRole = 'DDQ' | 'DGI' | 'PQ' | 'DDK'

const CODE_ONLY_SUPPORTED_ROLES: readonly UtiltsSubordinateRole[] = ['DDQ', 'DGI', 'PQ']
const FUTURE_ROLE_CODES: readonly UtiltsSubordinateRole[] = ['DDK']

function normalizeRole(value: string | null | undefined): UtiltsSubordinateRole | null {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (
    normalized === 'DDQ' ||
    normalized === 'DGI' ||
    normalized === 'PQ' ||
    normalized === 'DDK'
  ) {
    return normalized
  }
  return null
}

function segmentTag(segment: string): string {
  return segment.split('+')[0]?.trim().toUpperCase() ?? ''
}

function nadQualifier(segment: string): UtiltsSubordinateRole | null {
  const parts = segment.split('+')
  if (segmentTag(segment) !== 'NAD') return null
  return normalizeRole(parts[1])
}

function hasElement(segment: string, index: number): boolean {
  return Boolean(segment.split('+')[index]?.trim())
}

export function deriveUtiltsSubordinateRole(input: {
  applicationReference?: string | null
  segments?: readonly string[] | null
  enabledFutureRoles?: readonly string[] | null
}): UtiltsSubordinateRole | null {
  const enabledFutureRoles = new Set(
    (input.enabledFutureRoles ?? []).map((role) => role.toUpperCase())
  )

  for (const segment of input.segments ?? []) {
    const role = nadQualifier(segment)
    if (!role) continue
    if (CODE_ONLY_SUPPORTED_ROLES.includes(role)) return role
    if (FUTURE_ROLE_CODES.includes(role) && enabledFutureRoles.has(role)) return role
  }

  const applicationRole = normalizeRole(
    String(input.applicationReference ?? '').match(/^23-([A-Z0-9]{2,3})-/i)?.[1]
  )
  if (!applicationRole) return null
  if (CODE_ONLY_SUPPORTED_ROLES.includes(applicationRole)) return applicationRole
  if (FUTURE_ROLE_CODES.includes(applicationRole) && enabledFutureRoles.has(applicationRole)) {
    return applicationRole
  }
  return null
}

export function resolveUtiltsSubordinateNadSegment(input: {
  segments: readonly string[]
  applicationReference?: string | null
  enabledFutureRoles?: readonly string[] | null
}): string | null {
  const enabledFutureRoles = new Set(
    (input.enabledFutureRoles ?? []).map((role) => role.toUpperCase())
  )
  const derivedRole = deriveUtiltsSubordinateRole(input)
  const candidates: Array<{ role: UtiltsSubordinateRole; segment: string }> = []

  for (const segment of input.segments) {
    const upper = segment.toUpperCase()
    if (upper.startsWith('IDE+24') || upper.startsWith('LIN+')) break

    const role = nadQualifier(segment)
    if (!role) continue
    if (!CODE_ONLY_SUPPORTED_ROLES.includes(role) && !enabledFutureRoles.has(role)) continue
    if (!hasElement(segment, 2) && !CODE_ONLY_SUPPORTED_ROLES.includes(role)) continue

    candidates.push({ role, segment })
  }

  const selected =
    candidates.find((candidate) => candidate.role === derivedRole) ??
    candidates[0] ??
    null

  if (selected) return selected.segment
  if (derivedRole) return `NAD+${derivedRole}`
  return null
}
