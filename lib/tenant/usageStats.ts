import { supabaseService } from '@/lib/supabase/service'

export type TenantUsageStatsRow = {
  companyId: string
  companyName: string
  companyStatus: string | null
  customers: number
  activeCustomers: number
  contracts: number
  sites: number
  meteringPoints: number
  authorizations: number
  infoRequests: number
  meteringPermissions: number
  meteringValues: number
  supplierSwitches: number
  edielMessages: number
  prodat: number
  utilts: number
  contrl: number
  aperak: number
  billingUnderlays: number
  billingExportRuns: number
  partnerExports: number
  users: number
}

function isMissingRelationError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return Boolean(
    maybe &&
      (maybe.code === '42P01' ||
        maybe.code === '42703' ||
        maybe.code === 'PGRST205' ||
        /does not exist|schema cache|relation .* does not exist/i.test(maybe.message ?? ''))
  )
}

async function safeCount(table: string, filters: Array<{ column: string; value: string | number | boolean | null }> = []): Promise<number> {
  try {
    let query = supabaseService.from(table).select('id', { count: 'exact', head: true })
    for (const filter of filters) {
      query = filter.value === null ? query.is(filter.column, null) : query.eq(filter.column, filter.value)
    }
    const { count, error } = await query
    if (error) {
      if (isMissingRelationError(error)) return 0
      throw error
    }
    return count ?? 0
  } catch (error) {
    if (isMissingRelationError(error)) return 0
    throw error
  }
}

async function listCompanies(): Promise<Array<{ id: string; name: string | null; status: string | null }>> {
  const { data, error } = await supabaseService
    .from('companies')
    .select('id, name, status')
    .order('created_at', { ascending: false })
    .limit(250)

  if (error) throw error
  return (data ?? []) as Array<{ id: string; name: string | null; status: string | null }>
}

export async function listTenantUsageStats(): Promise<TenantUsageStatsRow[]> {
  const companies = await listCompanies()

  return Promise.all(
    companies.map(async (company) => {
      const companyId = company.id
      const [
        customers,
        activeCustomers,
        contracts,
        sites,
        meteringPoints,
        authorizations,
        infoRequests,
        meteringPermissions,
        meteringValues,
        supplierSwitches,
        edielMessages,
        prodat,
        utilts,
        contrl,
        aperak,
        billingUnderlays,
        billingExportRuns,
        partnerExports,
        users,
      ] = await Promise.all([
        safeCount('customers', [{ column: 'company_id', value: companyId }]),
        safeCount('customers', [{ column: 'company_id', value: companyId }, { column: 'status', value: 'active' }]),
        safeCount('customer_contracts', [{ column: 'company_id', value: companyId }]),
        safeCount('customer_sites', [{ column: 'company_id', value: companyId }]),
        safeCount('metering_points', [{ column: 'company_id', value: companyId }]),
        safeCount('authorization_scopes', [{ column: 'company_id', value: companyId }]),
        safeCount('customer_info_requests', [{ column: 'company_id', value: companyId }]),
        safeCount('metering_permissions', [{ column: 'company_id', value: companyId }]),
        safeCount('metering_values', [{ column: 'company_id', value: companyId }]),
        safeCount('supplier_switch_requests', [{ column: 'company_id', value: companyId }]),
        safeCount('ediel_messages', [{ column: 'company_id', value: companyId }]),
        safeCount('ediel_messages', [{ column: 'company_id', value: companyId }, { column: 'message_family', value: 'PRODAT' }]),
        safeCount('ediel_messages', [{ column: 'company_id', value: companyId }, { column: 'message_family', value: 'UTILTS' }]),
        safeCount('ediel_messages', [{ column: 'company_id', value: companyId }, { column: 'message_family', value: 'CONTRL' }]),
        safeCount('ediel_messages', [{ column: 'company_id', value: companyId }, { column: 'message_family', value: 'APERAK' }]),
        safeCount('billing_underlays', [{ column: 'company_id', value: companyId }]),
        safeCount('billing_export_runs', [{ column: 'company_id', value: companyId }]),
        safeCount('partner_exports', [{ column: 'company_id', value: companyId }]),
        safeCount('company_memberships', [{ column: 'company_id', value: companyId }]),
      ])

      return {
        companyId,
        companyName: company.name ?? 'Bolag utan namn',
        companyStatus: company.status,
        customers,
        activeCustomers,
        contracts,
        sites,
        meteringPoints,
        authorizations,
        infoRequests,
        meteringPermissions,
        meteringValues,
        supplierSwitches,
        edielMessages,
        prodat,
        utilts,
        contrl,
        aperak,
        billingUnderlays,
        billingExportRuns,
        partnerExports,
        users,
      }
    })
  )
}
