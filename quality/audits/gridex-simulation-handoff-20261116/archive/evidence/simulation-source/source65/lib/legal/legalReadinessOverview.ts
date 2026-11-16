import { supabaseService } from '@/lib/supabase/service'

export type TenantLegalReadinessRow = {
  companyId: string
  companyName: string | null
  orgNumber: string | null
  supportEmail: string | null
  slug: string | null
  hasTerms: boolean
  hasPrivacyPolicy: boolean
  hasWithdrawal: boolean
  hasPowerOfAttorney: boolean
  hasPriceTerms: boolean
  hasApiClient: boolean
  hasPublicContracts: boolean
  missingItems: string[]
  warnings: string[]
  isReady: boolean
}

export type FailedApplicationGroup = {
  key: string
  count: number
}

export type FailedApplicationsSummary = {
  total: number
  byErrorCode: FailedApplicationGroup[]
  byErrorStage: FailedApplicationGroup[]
  recent: Array<{
    id: string
    companyId: string | null
    errorCode: string | null
    errorStage: string | null
    status: string | null
    createdAt: string | null
  }>
}

// Lightweight per-tenant legal readiness for the superadmin overview. Uses the
// tenant_website_readiness_v view (single query) joined in-memory with a narrow
// companies query. Paginated to keep the admin list light.
export async function listTenantLegalReadiness(limit = 200): Promise<TenantLegalReadinessRow[]> {
  const [readiness, companies] = await Promise.all([
    supabaseService
      .from('tenant_website_readiness_v')
      .select('company_id,company_name,has_api_client,has_public_contracts,has_terms,has_privacy_policy,has_withdrawal,has_power_of_attorney_text,has_price_terms,missing_items')
      .limit(limit),
    supabaseService
      .from('companies')
      .select('id,name,org_number,support_email,slug,company_slug,status')
      .limit(limit),
  ])

  if (readiness.error) throw readiness.error

  const companyById = new Map<string, Record<string, unknown>>()
  for (const row of (companies.data ?? []) as Array<Record<string, unknown>>) {
    companyById.set(String(row.id), row)
  }

  const rows = (readiness.data ?? []) as Array<Record<string, unknown>>
  return rows.map((row) => {
    const companyId = String(row.company_id)
    const company = companyById.get(companyId) ?? {}
    const name = (row.company_name as string | null) ?? (company.name as string | null) ?? null
    const orgNumber = (company.org_number as string | null) ?? null
    const supportEmail = (company.support_email as string | null) ?? null
    const slug = ((company.slug as string | null) ?? (company.company_slug as string | null)) ?? null
    const hasTerms = row.has_terms === true
    const hasPrivacyPolicy = row.has_privacy_policy === true
    const hasWithdrawal = row.has_withdrawal === true
    const hasPowerOfAttorney = row.has_power_of_attorney_text === true
    const hasPriceTerms = row.has_price_terms === true
    const hasApiClient = row.has_api_client === true
    const hasPublicContracts = row.has_public_contracts === true
    const missingItems = Array.isArray(row.missing_items) ? (row.missing_items as string[]) : []
    const legalComplete = hasTerms && hasPrivacyPolicy && hasWithdrawal && hasPowerOfAttorney && hasPriceTerms

    const warnings: string[] = []
    if (!name || !name.trim()) warnings.push('Saknar bolagsnamn')
    if (!orgNumber) warnings.push('Saknar organisationsnummer')
    if (!supportEmail) warnings.push('Saknar support-email')
    if (!hasPowerOfAttorney) warnings.push('Saknar publicerad fullmakt')
    if (hasPublicContracts && !legalComplete) warnings.push('Har publicerade avtal men ofullständig juridik')
    if (hasApiClient && hasPublicContracts && !legalComplete) warnings.push('Hemsidesignering aktiverad men juridiken är inte komplett')

    return {
      companyId,
      companyName: name,
      orgNumber,
      supportEmail,
      slug,
      hasTerms,
      hasPrivacyPolicy,
      hasWithdrawal,
      hasPowerOfAttorney,
      hasPriceTerms,
      hasApiClient,
      hasPublicContracts,
      missingItems,
      warnings,
      isReady: legalComplete && missingItems.length === 0,
    }
  })
}

// Lightweight failed-application overview grouped by error_code and error_stage.
// Reads recent failed/pending rows (narrow select, indexed by error_stage and
// failed/review) and aggregates in memory.
export async function listFailedWebsiteApplications(limit = 300): Promise<FailedApplicationsSummary> {
  const { data, error } = await supabaseService
    .from('website_customer_applications')
    .select('id,company_id,error_code,error_stage,status,created_at')
    .or('status.in.(failed,pending_review,manual_review),error_code.not.is.null')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    // The overview must not crash the page if the column set is older.
    return { total: 0, byErrorCode: [], byErrorStage: [], recent: [] }
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>
  const byCode = new Map<string, number>()
  const byStage = new Map<string, number>()
  for (const row of rows) {
    const code = (row.error_code as string | null) ?? 'unknown'
    const stage = (row.error_stage as string | null) ?? 'unknown'
    byCode.set(code, (byCode.get(code) ?? 0) + 1)
    byStage.set(stage, (byStage.get(stage) ?? 0) + 1)
  }

  const toSortedGroups = (map: Map<string, number>): FailedApplicationGroup[] =>
    Array.from(map.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)

  return {
    total: rows.length,
    byErrorCode: toSortedGroups(byCode),
    byErrorStage: toSortedGroups(byStage),
    recent: rows.slice(0, 50).map((row) => ({
      id: String(row.id),
      companyId: (row.company_id as string | null) ?? null,
      errorCode: (row.error_code as string | null) ?? null,
      errorStage: (row.error_stage as string | null) ?? null,
      status: (row.status as string | null) ?? null,
      createdAt: (row.created_at as string | null) ?? null,
    })),
  }
}
