import type {
  EdielActorRole,
  EdielActorSubrole,
  EdielEnvironment,
  EdielEnvironmentType,
  EdielTestRoleCode,
} from '@/lib/ediel/types'

export const EDIEL_ENVIRONMENT_TYPES: readonly EdielEnvironmentType[] = [
  'tgt_test',
  'agt_test',
  'bilateral_test',
  'production',
]

export function normalizeEnvironmentType(
  value?: string | null,
  fallbackEnvironment?: EdielEnvironment | string | null
): EdielEnvironmentType {
  const normalized = String(value ?? '').trim().toLowerCase()
  if ((EDIEL_ENVIRONMENT_TYPES as readonly string[]).includes(normalized)) {
    return normalized as EdielEnvironmentType
  }
  return fallbackEnvironment === 'production' ? 'production' : 'agt_test'
}

export function legacyEnvironmentForEnvironmentType(
  environmentType?: EdielEnvironmentType | string | null
): EdielEnvironment {
  return environmentType === 'production' ? 'production' : 'test'
}

export function normalizeActorRole(value?: string | null): EdielActorRole {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (
    normalized === 'energy_service_company' ||
    normalized === 'esco' ||
    normalized === 'service_provider' ||
    normalized === 'dgi'
  ) {
    return 'energy_service_company'
  }
  if (normalized === 'grid_owner') return 'grid_owner'
  if (normalized === 'balance_responsible' || normalized === 'brp') return 'brp'
  if (normalized === 'system_supplier') return 'system_supplier'
  return 'supplier'
}

export function roleCodeForActorRole(role?: string | null): EdielTestRoleCode {
  const normalized = normalizeActorRole(role)
  if (normalized === 'energy_service_company') return 'esco'
  if (normalized === 'brp') return 'balance_responsible'
  if (normalized === 'grid_owner') return 'grid_owner'
  if (normalized === 'system_supplier') return 'system_supplier'
  return 'supplier'
}

export function normalizeActorSubrole(
  value?: string | null,
  role?: string | null,
  applicationReference?: string | null
): EdielActorSubrole | null {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (normalized === 'DDQ' || normalized === 'DGI') return normalized

  const appRef = String(applicationReference ?? '').toUpperCase()
  if (appRef.includes('DGI')) return 'DGI'
  if (appRef.includes('DDQ')) return 'DDQ'

  const canonicalRole = normalizeActorRole(role)
  if (canonicalRole === 'energy_service_company') return 'DGI'
  if (canonicalRole === 'supplier') return 'DDQ'
  return null
}

export function applicationReferenceForActor(params: {
  actorRole?: string | null
  actorSubrole?: string | null
  messageFamily: 'PRODAT' | 'UTILTS' | string
}): string | null {
  const subrole = normalizeActorSubrole(params.actorSubrole, params.actorRole)
  const family = String(params.messageFamily ?? '').trim().toUpperCase()
  if (!subrole || !family) return null
  if (family === 'PRODAT') return `23-${subrole}-PRODAT`
  if (family === 'UTILTS') return `23-${subrole}-UTILTS`
  return null
}

export function supplierBrpRelevantForRole(role?: string | null): boolean {
  return normalizeActorRole(role) === 'supplier'
}
