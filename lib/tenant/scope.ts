import { supabaseService } from '@/lib/supabase/service'
import { userIsPlatformAdmin, type TenantCompany } from '@/lib/tenant/companies'

export type TenantScopeCompanyOption = Pick<
  TenantCompany,
  'id' | 'name' | 'slug' | 'org_number' | 'status'
>

export type TenantScope = {
  userId: string
  roles: string[]
  permissions: string[]
  isPlatformAdmin: boolean
  companyId: string | null
  companyIds: string[]
  companies: TenantScopeCompanyOption[]
}

export type ResolveTenantScopeOptions = {
  userId: string
  roles: string[]
  permissions: string[]
  requestedCompanyId?: string | null
  requireCompany?: boolean
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

async function listActiveMembershipCompanyIds(userId: string): Promise<string[]> {
  try {
    const { data, error } = await supabaseService
      .from('company_memberships')
      .select('company_id')
      .eq('user_id', userId)
      .eq('status', 'active')

    if (error) return []
    return unique((data ?? []).map((row) => String(row.company_id ?? '')))
  } catch {
    return []
  }
}

async function listCompaniesByScope(params: {
  isPlatformAdmin: boolean
  companyIds: string[]
}): Promise<TenantScopeCompanyOption[]> {
  try {
    let query = supabaseService
      .from('companies')
      .select('id, name, slug, org_number, status')
      .order('name', { ascending: true })

    if (!params.isPlatformAdmin) {
      if (params.companyIds.length === 0) return []
      query = query.in('id', params.companyIds)
    }

    const { data, error } = await query
    if (error) return []
    return (data ?? []) as TenantScopeCompanyOption[]
  } catch {
    return []
  }
}

export async function resolveTenantScope(
  options: ResolveTenantScopeOptions
): Promise<TenantScope> {
  const isPlatformAdmin = userIsPlatformAdmin(options.roles, options.permissions)
  const membershipCompanyIds = await listActiveMembershipCompanyIds(options.userId)
  const companies = await listCompaniesByScope({
    isPlatformAdmin,
    companyIds: membershipCompanyIds,
  })
  const allowedCompanyIds = isPlatformAdmin
    ? companies.map((company) => company.id)
    : membershipCompanyIds

  const requestedCompanyId = options.requestedCompanyId?.trim() || null
  let companyId: string | null = null

  if (requestedCompanyId) {
    if (isPlatformAdmin || allowedCompanyIds.includes(requestedCompanyId)) {
      companyId = requestedCompanyId
    }
  } else if (!isPlatformAdmin) {
    companyId = allowedCompanyIds[0] ?? null
  }

  if (options.requireCompany && !companyId) {
    throw new Error(
      isPlatformAdmin
        ? 'Välj vilket företag som posten ska tillhöra.'
        : 'Ditt konto saknar aktiv bolagskoppling.'
    )
  }

  return {
    userId: options.userId,
    roles: options.roles,
    permissions: options.permissions,
    isPlatformAdmin,
    companyId,
    companyIds: allowedCompanyIds,
    companies,
  }
}

export function companyFilterValue(scope: Pick<TenantScope, 'companyId' | 'isPlatformAdmin'>) {
  if (scope.isPlatformAdmin && !scope.companyId) return null
  return scope.companyId
}

export function findCompanyName(
  companies: TenantScopeCompanyOption[],
  companyId: string | null | undefined
): string {
  if (!companyId) return 'Alla företag'
  return companies.find((company) => company.id === companyId)?.name ?? 'Valt företag'
}
