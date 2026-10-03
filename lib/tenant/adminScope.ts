import { isPlatformAdminContext, type GuardResult } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'

export type AdminTenantReadScope = {
  isPlatformAdmin: boolean
  companyId: string | null
  companyName: string | null
}

export async function resolveAdminTenantReadScope(
  admin: Pick<GuardResult, 'userId' | 'roles' | 'permissions'>
): Promise<AdminTenantReadScope> {
  const isPlatformAdmin = isPlatformAdminContext(admin)
  const operationalScope = await getOperationalCompanyScope(admin.userId)

  return {
    isPlatformAdmin,
    companyId: tenantReadCompanyId(isPlatformAdmin, operationalScope.companyId),
    companyName: operationalScope.companyName,
  }
}

/**
 * Company filter for an admin read. Platform admins read across tenants (null);
 * a tenant user without an operational company must never fall through to an
 * unfiltered read, because callers treat null as "all companies".
 */
export function tenantReadCompanyId(isPlatformAdmin: boolean, companyId: string | null | undefined): string | null {
  if (isPlatformAdmin) return null
  if (!companyId) throw new Error('Kontot saknar ett aktivt bolag. Välj eller aktivera ett bolag för att se uppgifterna.')
  return companyId
}

export function applyTenantFilter<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  companyId: string | null | undefined
): T {
  return companyId ? query.eq('company_id', companyId) : query
}
