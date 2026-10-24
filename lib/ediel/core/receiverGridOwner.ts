import { selectTenantUsableGridOwners } from '@/lib/grid-owners/platformGridOwnerResolver'

/** The active grid owner usable by the tenant for the exact legal receiver: its own row, else a shared
 * registry row, never another tenant's (FINDINGS F101); ambiguity or absence selects none. Passed to the
 * route lookup so a grid-owner-specific route is found before the tenant's generic one (FINDINGS H-10). */
export async function receiverGridOwner(companyId: string, legalReceiverId: string) {
  const data = await selectTenantUsableGridOwners<{ id: string; name: string | null; ediel_id: string | null }>({ companyId, select: 'id,name,ediel_id', match: { ediel_id: legalReceiverId, is_active: true } })
  return data.length === 1 ? { id: data[0].id, name: data[0].name, ediel_id: data[0].ediel_id } : null
}
