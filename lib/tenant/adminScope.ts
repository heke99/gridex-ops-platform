import { isPlatformAdminContext, type GuardResult } from '@/lib/admin/guards'
import { getOperationalCompanyScope, TenantCompanyRequiredError } from '@/lib/tenant/scope'

export type AdminTenantReadScope = {
  isPlatformAdmin: boolean
  companyId: string | null
  companyName: string | null
}

export async function resolveAdminTenantReadScope(
  admin: Pick<GuardResult, 'userId' | 'roles' | 'permissions'> & Partial<Pick<GuardResult, 'companyId' | 'isPlatformAdmin'>>
): Promise<AdminTenantReadScope> {
  const isPlatformAdmin = isPlatformAdminContext(admin)
  if (admin.companyId !== undefined) {
    return { isPlatformAdmin, companyId: tenantReadCompanyId(isPlatformAdmin, admin.companyId), companyName: null }
  }
  const operationalScope = await getOperationalCompanyScope(admin.userId)
  // Permissions were resolved for the canonical guard's company. A second
  // membership selection must not redirect those permissions to another tenant.
  const companyId = tenantReadCompanyId(isPlatformAdmin,
    admin.companyId !== undefined ? admin.companyId : operationalScope.companyId)

  return {
    isPlatformAdmin,
    companyId,
    companyName: companyId === operationalScope.companyId ? operationalScope.companyName : null,
  }
}

/**
 * Reads that require one chosen company, including platform analytics, retain
 * the canonical selection. Tenant callers fail closed by default. A caller
 * with its own explicit empty-state/HTTP refusal may opt into a missing company;
 * it must handle null before issuing a tenant read. Older contexts without the
 * canonical field retain their operational membership fallback.
 */
export async function resolveAdminSelectedCompanyReadScope(
  admin: Pick<GuardResult, 'userId' | 'roles' | 'permissions'> & Partial<Pick<GuardResult, 'companyId' | 'isPlatformAdmin'>>,
  options: { allowMissing?: boolean } = {},
): Promise<AdminTenantReadScope> {
  const isPlatformAdmin = isPlatformAdminContext(admin)
  if (admin.companyId !== undefined) {
    if (!isPlatformAdmin && !admin.companyId && !options.allowMissing) throw new TenantCompanyRequiredError()
    return { isPlatformAdmin, companyId: admin.companyId, companyName: null }
  }
  const scope = await getOperationalCompanyScope(admin.userId)
  if (!isPlatformAdmin && !scope.companyId && !options.allowMissing) throw new TenantCompanyRequiredError()
  return { isPlatformAdmin, companyId: scope.companyId, companyName: scope.companyName }
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
