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
    companyId: isPlatformAdmin ? null : operationalScope.companyId,
    companyName: operationalScope.companyName,
  }
}

export function applyTenantFilter<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  companyId: string | null | undefined
): T {
  return companyId ? query.eq('company_id', companyId) : query
}
