export type CanonicalEdielActorRole = 'supplier' | 'esco'

export function canonicalEdielActorRole(
  value: unknown,
): CanonicalEdielActorRole | null {
  const role = String(value ?? '').trim().toLowerCase()
  if (
    role === 'supplier'
    || role === 'electricity_supplier'
    || role === 'power_supplier'
    || role === 'new_supplier'
    || role === 'potential_supplier'
    || role === 'old_supplier'
  ) return 'supplier'
  if (
    role === 'esco'
    || role === 'energy_service_company'
    || role === 'eligible_party'
    || role === 'entitled_party'
  ) return 'esco'
  return null
}

export function isSupplierEdielActorRole(value: unknown): boolean {
  return canonicalEdielActorRole(value) === 'supplier'
}

export function isEscoEdielActorRole(value: unknown): boolean {
  return canonicalEdielActorRole(value) === 'esco'
}
