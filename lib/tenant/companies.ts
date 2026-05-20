import { supabaseService } from '@/lib/supabase/service'

type SupabaseClientLike = typeof supabaseService

type CountFilter = {
  column: string
  value: string | number | boolean | string[]
  op?: 'eq' | 'in'
}

export type TenantCompany = {
  id: string
  name: string
  slug: string | null
  org_number: string | null
  status: string | null
  primary_contact_email: string | null
  primary_contact_name: string | null
  phone: string | null
  website: string | null
  created_at: string | null
}

export type TenantMembership = {
  id: string
  company_id: string
  user_id: string
  membership_role: string
  status: string
  invited_email: string | null
  invited_at: string | null
  accepted_at: string | null
}

export type TenantInvitation = {
  id: string
  company_id: string
  email: string
  full_name: string | null
  membership_role: string
  role_key: string | null
  status: string
  created_at: string | null
}

export type TenantCompanyWithStats = TenantCompany & {
  active_memberships: number
  pending_invitations: number
}

export type TenantCompanyPageData = {
  companies: TenantCompanyWithStats[]
  memberships: TenantMembership[]
  recentInvitations: TenantInvitation[]
  isPlatformAdmin: boolean
}

export const COMPANY_USER_ROLE_OPTIONS = [
  { value: 'company_admin', label: 'Bolagsansvarig' },
  { value: 'operations_manager', label: 'Operationsansvarig' },
  { value: 'operations_agent', label: 'Operationshandläggare' },
  { value: 'customer_service_manager', label: 'Kundtjänstansvarig' },
  { value: 'customer_service_agent', label: 'Kundtjänst' },
  { value: 'sales_manager', label: 'Säljansvarig' },
  { value: 'pricing_manager', label: 'Prisansvarig' },
  { value: 'finance_readonly', label: 'Ekonomi läsbehörighet' },
  { value: 'executive_readonly', label: 'Ledning läsbehörighet' },
]

export function userIsPlatformAdmin(roles: string[], _permissions: string[]) {
  // Platform context must come from explicit platform roles, not broad tenant permissions.
  return roles.some((role) => role === 'super_admin' || role === 'superadmin' || role === 'platform_admin')
}

async function safeCount(
  supabase: SupabaseClientLike,
  table: string,
  filters: CountFilter[] = []
): Promise<number> {
  try {
    let query = supabase.from(table).select('id', { count: 'exact', head: true })

    for (const filter of filters) {
      if (filter.op === 'in' && Array.isArray(filter.value)) {
        query = query.in(filter.column, filter.value)
      } else {
        query = query.eq(filter.column, filter.value as string | number | boolean)
      }
    }

    const { count, error } = await query
    if (error) return 0
    return count ?? 0
  } catch {
    return 0
  }
}

async function loadMembershipsForUser(userId: string): Promise<TenantMembership[]> {
  try {
    const { data, error } = await supabaseService
      .from('company_memberships')
      .select('id, company_id, user_id, membership_role, status, invited_email, invited_at, accepted_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('invited_at', { ascending: false })

    if (error) return []
    return (data ?? []) as TenantMembership[]
  } catch {
    return []
  }
}

async function loadCompanies(companyIds?: string[]): Promise<TenantCompany[]> {
  try {
    let query = supabaseService
      .from('companies')
      .select('id, name, slug, org_number, status, primary_contact_email, primary_contact_name, phone, website, created_at')
      .order('created_at', { ascending: false })

    if (companyIds && companyIds.length > 0) {
      query = query.in('id', companyIds)
    }

    const { data, error } = await query
    if (error) return []
    return (data ?? []) as TenantCompany[]
  } catch {
    return []
  }
}

async function withCompanyStats(companies: TenantCompany[]): Promise<TenantCompanyWithStats[]> {
  return Promise.all(
    companies.map(async (company) => ({
      ...company,
      active_memberships: await safeCount(supabaseService, 'company_memberships', [
        { column: 'company_id', value: company.id },
        { column: 'status', value: 'active' },
      ]),
      pending_invitations: await safeCount(supabaseService, 'company_invitations', [
        { column: 'company_id', value: company.id },
        { column: 'status', value: 'pending' },
      ]),
    }))
  )
}

async function loadRecentInvitations(companyIds?: string[]): Promise<TenantInvitation[]> {
  try {
    let query = supabaseService
      .from('company_invitations')
      .select('id, company_id, email, full_name, membership_role, role_key, status, created_at')
      .order('created_at', { ascending: false })
      .limit(12)

    if (companyIds && companyIds.length > 0) {
      query = query.in('company_id', companyIds)
    }

    const { data, error } = await query
    if (error) return []
    return (data ?? []) as TenantInvitation[]
  } catch {
    return []
  }
}

export async function getTenantCompanyPageData(input: {
  userId: string
  roles: string[]
  permissions: string[]
}): Promise<TenantCompanyPageData> {
  const isPlatformAdmin = userIsPlatformAdmin(input.roles, input.permissions)
  const memberships = await loadMembershipsForUser(input.userId)

  if (isPlatformAdmin) {
    const companies = await loadCompanies()
    return {
      companies: await withCompanyStats(companies),
      memberships,
      recentInvitations: await loadRecentInvitations(),
      isPlatformAdmin,
    }
  }

  const companyIds = memberships.map((membership) => membership.company_id)
  const companies = companyIds.length > 0 ? await loadCompanies(companyIds) : []

  return {
    companies: await withCompanyStats(companies),
    memberships,
    recentInvitations: companyIds.length > 0 ? await loadRecentInvitations(companyIds) : [],
    isPlatformAdmin,
  }
}

export async function canInviteIntoCompany(input: {
  userId: string
  roles: string[]
  permissions: string[]
  companyId: string
}) {
  if (userIsPlatformAdmin(input.roles, input.permissions)) return true
  if (!input.permissions.includes('tenants.invite')) return false

  const { data, error } = await supabaseService
    .from('company_memberships')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('user_id', input.userId)
    .in('membership_role', ['owner', 'company_admin'])
    .eq('status', 'active')
    .maybeSingle()

  if (error) return false
  return Boolean(data?.id)
}
