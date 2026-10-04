/** Operational market role of the tenant's own actor profile for one process.
 * The role comes from the business process (its application reference), never
 * from a global default field: 23-DDQ-* is the supplier role, 23-DGI-* the
 * energy service company (ESCO) role. */
export type EdielActorRole = 'supplier' | 'energy_service_company'

export function processActorRole(applicationReference: string | null | undefined): EdielActorRole | null {
  const match = /^23-(DDQ|DGI)-[A-Z0-9]+$/.exec(String(applicationReference ?? '').trim().toUpperCase())
  if (!match) return null
  return match[1] === 'DDQ' ? 'supplier' : 'energy_service_company'
}

/** Verified tenant market-role code that must back an actor profile role. */
export function tenantMarketRoleFor(role: EdielActorRole): 'electricity_supplier' | 'energy_service_company' {
  return role === 'supplier' ? 'electricity_supplier' : 'energy_service_company'
}
