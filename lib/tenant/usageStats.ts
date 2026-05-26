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
  authorizationScopes: number
  powerOfAttorneys: number
  customerBlockers: number
  openCustomerCases: number
  waitingInfoRequests: number
  openSupplierSwitches: number
  blockedBillingRows: number
  users: number
  activeUsers: number
  lastActivityAt: string | null
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


async function safeLatestTimestamp(
  table: string,
  companyId: string,
  column = 'updated_at'
): Promise<string | null> {
  try {
    const { data, error } = await supabaseService
      .from(table)
      .select(column)
      .eq('company_id', companyId)
      .order(column, { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      if (isMissingRelationError(error)) return null
      throw error
    }

    const value = (data as Record<string, unknown> | null)?.[column]
    return typeof value === 'string' && value.trim().length > 0 ? value : null
  } catch (error) {
    if (isMissingRelationError(error)) return null
    return null
  }
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  const dates = values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((item) => !Number.isNaN(item.time))
    .sort((a, b) => b.time - a.time)

  return dates[0]?.value ?? null
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
        authorizationScopes,
        powerOfAttorneys,
        customerBlockers,
        openCustomerCases,
        waitingInfoRequests,
        openSupplierSwitches,
        blockedBillingRows,
        users,
        activeUsers,
        latestCustomerAt,
        latestContractAt,
        latestEdielAt,
        latestExportAt,
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
        safeCount('authorization_scopes', [{ column: 'company_id', value: companyId }]),
        safeCount('powers_of_attorney', [{ column: 'company_id', value: companyId }]),
        safeCount('customer_blockers', [{ column: 'company_id', value: companyId }, { column: 'status', value: 'open' }]),
        safeCount('customer_cases', [{ column: 'company_id', value: companyId }, { column: 'status', value: 'open' }]),
        safeCount('customer_info_requests', [{ column: 'company_id', value: companyId }, { column: 'status', value: 'waiting_response' }]),
        safeCount('supplier_switch_requests', [{ column: 'company_id', value: companyId }, { column: 'status', value: 'waiting_response' }]),
        safeCount('billing_export_run_items', [{ column: 'company_id', value: companyId }, { column: 'status', value: 'blocked' }]),
        safeCount('company_memberships', [{ column: 'company_id', value: companyId }]),
        safeCount('company_memberships', [{ column: 'company_id', value: companyId }, { column: 'status', value: 'active' }]),
        safeLatestTimestamp('customers', companyId),
        safeLatestTimestamp('customer_contracts', companyId),
        safeLatestTimestamp('ediel_messages', companyId),
        safeLatestTimestamp('billing_export_runs', companyId),
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
        authorizationScopes,
        powerOfAttorneys,
        customerBlockers,
        openCustomerCases,
        waitingInfoRequests,
        openSupplierSwitches,
        blockedBillingRows,
        users,
        activeUsers,
        lastActivityAt: latestTimestamp([latestCustomerAt, latestContractAt, latestEdielAt, latestExportAt]),
      }
    })
  )
}
