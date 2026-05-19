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
  /**
   * Operational pages must not let platform admins work inside arbitrary customer tenants.
   * Leave this false for customer intake, customers, contracts and operations.
   * Use true only on explicit platform administration pages where cross-tenant oversight is intended.
   */
  includeAllCompaniesForPlatformAdmin?: boolean
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
    return unique(
      ((data ?? []) as Array<{ company_id?: string | null }>).map((row) =>
        String(row.company_id ?? '')
      )
    )
  } catch {
    return []
  }
}

async function getActiveProfileCompanyId(userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseService
      .from('user_profiles')
      .select('active_company_id')
      .eq('id', userId)
      .maybeSingle()

    if (error) return null
    const value = String(
      (data as { active_company_id?: string | null } | null)?.active_company_id ?? ''
    ).trim()
    return value || null
  } catch {
    return null
  }
}

async function listCompaniesByIds(companyIds: string[]): Promise<TenantScopeCompanyOption[]> {
  if (companyIds.length === 0) return []

  try {
    const { data, error } = await supabaseService
      .from('companies')
      .select('id, name, slug, org_number, status')
      .in('id', companyIds)
      .order('name', { ascending: true })

    if (error) return []
    return (data ?? []) as TenantScopeCompanyOption[]
  } catch {
    return []
  }
}

async function listAllCompanies(): Promise<TenantScopeCompanyOption[]> {
  try {
    const { data, error } = await supabaseService
      .from('companies')
      .select('id, name, slug, org_number, status')
      .order('name', { ascending: true })

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
  const includeAllCompaniesForPlatformAdmin = Boolean(options.includeAllCompaniesForPlatformAdmin)
  const [membershipCompanyIds, activeProfileCompanyId] = await Promise.all([
    listActiveMembershipCompanyIds(options.userId),
    getActiveProfileCompanyId(options.userId),
  ])

  const companyIds =
    isPlatformAdmin && includeAllCompaniesForPlatformAdmin
      ? (await listAllCompanies()).map((company) => company.id)
      : membershipCompanyIds

  const companies =
    isPlatformAdmin && includeAllCompaniesForPlatformAdmin
      ? await listAllCompanies()
      : await listCompaniesByIds(companyIds)

  const allowedCompanyIds = companies.map((company) => company.id)
  const requestedCompanyId = options.requestedCompanyId?.trim() || null
  let companyId: string | null = null

  if (requestedCompanyId && allowedCompanyIds.includes(requestedCompanyId)) {
    companyId = requestedCompanyId
  } else if (activeProfileCompanyId && allowedCompanyIds.includes(activeProfileCompanyId)) {
    companyId = activeProfileCompanyId
  } else if (allowedCompanyIds.length === 1) {
    companyId = allowedCompanyIds[0] ?? null
  } else if (!isPlatformAdmin) {
    companyId = allowedCompanyIds[0] ?? null
  }

  if (options.requireCompany && !companyId) {
    throw new Error(
      isPlatformAdmin
        ? 'Ditt konto saknar en tydlig operativ bolagskoppling. Lägg till dig själv som aktiv användare i rätt elhandelsbolag innan du skapar kunder eller avtal.'
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
  if (!companyId) return 'Inget operativt företag valt'
  return companies.find((company) => company.id === companyId)?.name ?? 'Valt företag'
}
