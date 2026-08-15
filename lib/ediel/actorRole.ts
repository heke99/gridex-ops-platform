export type CanonicalEdielActorRole = 'supplier' | 'esco'

export function canonicalEdielActorRole(
  value: unknown,
): CanonicalEdielActorRole | null {
  const role = String(value ?? '').trim().toLowerCase()
  if (role === 'supplier' || role === 'electricity_supplier') return 'supplier'
  if (role === 'esco' || role === 'energy_service_company') return 'esco'
  return null
}

export function isSupplierEdielActorRole(value: unknown): boolean {
  return canonicalEdielActorRole(value) === 'supplier'
}
