import { supabaseService } from '@/lib/supabase/service'

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
}

export type OperationalCompanyScope = {
  companyId: string | null
  companyName: string | null
  memberships: CompanyMembershipSummary[]
  requiresCompany: boolean
  message: string | null
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

export function isMissingRelationError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  if (!maybe) return false
  return (
    maybe.code === '42P01' ||
    maybe.code === 'PGRST205' ||
    /does not exist|schema cache|relation .* does not exist/i.test(maybe.message ?? '')
  )
}

export async function listOperationalCompaniesForUser(
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
      } satisfies CompanyMembershipSummary
    })
    .filter((row): row is CompanyMembershipSummary => Boolean(row))
}

export async function getOperationalCompanyScope(
  userId: string
): Promise<OperationalCompanyScope> {
  const memberships = await listOperationalCompaniesForUser(userId)

  if (memberships.length === 0) {
    return {
      companyId: null,
      companyName: null,
      memberships,
      requiresCompany: true,
      message:
        'Kontot saknar aktiv bolagskoppling. Skapa eller koppla ett operativt bolag innan kunddata registreras.',
    }
  }

  const preferred = memberships.find((row) => row.membershipRole === 'owner') ?? memberships[0]

  return {
    companyId: preferred.companyId,
    companyName: preferred.companyName,
    memberships,
    requiresCompany: false,
    message: null,
  }
}

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
  if (!normalized) return requireOperationalCompanyId(userId)

  const memberships = await listOperationalCompaniesForUser(userId)
  const allowed = memberships.some((row) => row.companyId === normalized)

  if (!allowed) {
    throw new Error('Du saknar aktiv bolagskoppling för valt elhandelsbolag.')
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
