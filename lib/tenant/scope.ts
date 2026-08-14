import { cache } from 'react'
import { cookies } from 'next/headers'
import {
  ADMIN_SELECTED_COMPANY_COOKIE,
} from '@/lib/admin/navigationPreferences'
import { isPlatformAdminRole, normalizeRoleKey, resolveRoleKey } from '@/lib/rbac/roleKeys'
import { supabaseService } from '@/lib/supabase/service'
import { isCompanyVisibleInTenantWorkspace, isCompanyWritableInTenantWorkspace } from '@/lib/tenant/lifecycle'

export type CompanySummary = {
  id: string
  name: string
  slug: string | null
  org_number: string | null
  status: string | null
}

export type CompanyMembershipSummary = {
  companyId: string
  companyName: string
  companySlug: string | null
  orgNumber: string | null
  membershipRole: string
  status: string
  companyStatus: string | null
}

export type OperationalCompanyScope = {
  companyId: string | null
  companyName: string | null
  memberships: CompanyMembershipSummary[]
  requiresCompany: boolean
  message: string | null
  selectedByPlatformAdmin?: boolean
}

type MembershipJoinRow = {
  company_id: string
  membership_role: string | null
  status: string | null
  companies:
    | {
        id: string
        name: string
        slug: string | null
        org_number: string | null
        status: string | null
      }
    | Array<{
        id: string
        name: string
        slug: string | null
        org_number: string | null
        status: string | null
      }>
    | null
}

function unwrapCompany(row: MembershipJoinRow) {
  return Array.isArray(row.companies) ? row.companies[0] : row.companies
}

type UserRoleRpcRow = string | {
  role_id?: string | null
  role_key?: string | null
  key?: string | null
  code?: string | null
  name?: string | null
}

function roleFromRpcRow(row: UserRoleRpcRow): string | null {
  if (typeof row === 'string') return normalizeRoleKey(row)
  if (!row || typeof row !== 'object') return null
  return resolveRoleKey(row)
}

async function isPlatformAdminUser(userId: string): Promise<boolean> {
  const { data, error } = await supabaseService.rpc('gridex_get_user_roles', { p_user_id: userId })
  if (error || !Array.isArray(data)) return false

  return (data as UserRoleRpcRow[])
    .map(roleFromRpcRow)
    .some(isPlatformAdminRole)
}

async function getSelectedMembershipCompany(
  memberships: CompanyMembershipSummary[]
): Promise<CompanyMembershipSummary | null> {
  const cookieStore = await cookies()
  const selectedCompanyId = cookieStore.get(ADMIN_SELECTED_COMPANY_COOKIE)?.value?.trim()
  if (!selectedCompanyId) return null

  return memberships.find((row) => row.companyId === selectedCompanyId) ?? null
}

export function isMissingRelationError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  if (!maybe) return false
  return (
    maybe.code === '42P01' ||
    maybe.code === 'PGRST205' ||
    maybe.code === 'PGRST204' ||
    /does not exist|schema cache|relation .* does not exist|could not find/i.test(maybe.message ?? '')
  )
}

export const listOperationalCompaniesForUser = cache(async function listOperationalCompaniesForUser(
  userId: string
): Promise<CompanyMembershipSummary[]> {
  const { data, error } = await supabaseService
    .from('company_memberships')
    .select('company_id, membership_role, status, companies(id, name, slug, org_number, status)')
    .eq('user_id', userId)
    .eq('status', 'active')

  if (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }

  return ((data ?? []) as unknown as MembershipJoinRow[])
    .map((row) => {
      const company = unwrapCompany(row)
      if (!company?.id) return null

      return {
        companyId: company.id,
        companyName: company.name,
        companySlug: company.slug ?? null,
        orgNumber: company.org_number ?? null,
        membershipRole: row.membership_role ?? 'member',
        status: row.status ?? 'active',
        companyStatus: company.status ?? null,
      } satisfies CompanyMembershipSummary
    })
    .filter((row): row is CompanyMembershipSummary => Boolean(row))
    .filter((row) => isCompanyVisibleInTenantWorkspace(row.companyStatus))
})

export const getOperationalCompanyScope = cache(async function getOperationalCompanyScope(
  userId: string
): Promise<OperationalCompanyScope> {
  const memberships = await listOperationalCompaniesForUser(userId)
  const selectedMembership = await getSelectedMembershipCompany(memberships)

  if (selectedMembership) {
    return {
      companyId: selectedMembership.companyId,
      companyName: selectedMembership.companyName,
      memberships,
      requiresCompany: false,
      message: null,
      selectedByPlatformAdmin: false,
    }
  }

  if (memberships.length === 0) {
    return {
      companyId: null,
      companyName: null,
      memberships,
      requiresCompany: true,
      message:
        'Kontot saknar ett bolag som är aktivt, under onboarding eller tillfälligt pausat. Avstängda, arkiverade och stängda bolag är inte valbara i tenantläget.',
      selectedByPlatformAdmin: false,
    }
  }

  const preferred = memberships.find((row) => row.membershipRole === 'owner') ?? memberships[0]

  return {
    companyId: preferred.companyId,
    companyName: preferred.companyName,
    memberships,
    requiresCompany: false,
    message: null,
    selectedByPlatformAdmin: false,
  }
})

export async function requireOperationalCompanyId(userId: string): Promise<string> {
  const scope = await getOperationalCompanyScope(userId)
  if (!scope.companyId) {
    throw new Error(scope.message ?? 'Aktivt operativt bolag saknas.')
  }
  return scope.companyId
}

export async function assertUserCanOperateCompany(
  userId: string,
  companyId: string | null | undefined
): Promise<string> {
  const normalized = companyId?.trim()
  if (!normalized) {
    const fallbackCompanyId = await requireOperationalCompanyId(userId)
    return assertUserCanOperateCompany(userId, fallbackCompanyId)
  }

  if (await isPlatformAdminUser(userId)) {
    const { data, error } = await supabaseService
      .from('companies')
      .select('id')
      .eq('id', normalized)
      .maybeSingle()

    if (error) {
      if (isMissingRelationError(error)) throw new Error('Bolagstabellen saknas.')
      throw error
    }

    if (data?.id) return normalized
  }

  const memberships = await listOperationalCompaniesForUser(userId)
  const membership = memberships.find((row) => row.companyId === normalized)

  if (!membership) {
    throw new Error('Du saknar en aktiv bolagskoppling för valt elhandelsbolag.')
  }

  if (!isCompanyWritableInTenantWorkspace(membership.companyStatus)) {
    throw new Error('Bolaget är pausat eller inte operativt. Ändringar är blockerade tills bolaget återaktiveras.')
  }

  return normalized
}

export async function listPlatformCompanies(): Promise<CompanySummary[]> {
  const { data, error } = await supabaseService
    .from('companies')
    .select('id, name, slug, org_number, status')
    .order('created_at', { ascending: false })

  if (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }

  return (data ?? []) as CompanySummary[]
}
