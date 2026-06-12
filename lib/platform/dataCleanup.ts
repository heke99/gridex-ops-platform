import { supabaseService } from '@/lib/supabase/service'

export type CleanupCustomerCandidate = {
  customerId: string
  companyId: string | null
  customerNumber: string | null
  customerName: string
  email: string | null
  source: string | null
  status: string | null
  isTestData: boolean
  archivedAt: string | null
  createdAt: string | null
  cleanupReason: string
  siteCount: number
  contractCount: number
  protectedContractCount: number
  switchCount: number
  billingUnderlayCount: number
  invoiceCount: number
  edielMessageCount: number
  canHardDelete: boolean
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
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

function normalize(row: Record<string, unknown>): CleanupCustomerCandidate {
  return {
    customerId: String(row.customer_id),
    companyId: stringOrNull(row.company_id),
    customerNumber: stringOrNull(row.customer_number),
    customerName: stringOrNull(row.customer_name) ?? 'Kund utan namn',
    email: stringOrNull(row.email),
    source: stringOrNull(row.source),
    status: stringOrNull(row.status),
    isTestData: row.is_test_data === true,
    archivedAt: stringOrNull(row.archived_at),
    createdAt: stringOrNull(row.created_at),
    cleanupReason: stringOrNull(row.cleanup_reason) ?? 'manuell_granskning',
    siteCount: numberValue(row.site_count),
    contractCount: numberValue(row.contract_count),
    protectedContractCount: numberValue(row.protected_contract_count),
    switchCount: numberValue(row.switch_count),
    billingUnderlayCount: numberValue(row.billing_underlay_count),
    invoiceCount: numberValue(row.invoice_count),
    edielMessageCount: numberValue(row.ediel_message_count),
    canHardDelete: row.can_hard_delete === true,
  }
}

export async function listCleanupCustomerCandidates(): Promise<CleanupCustomerCandidate[]> {
  try {
    const { data, error } = await supabaseService
      .from('gridex_data_cleanup_customer_candidates_v')
      .select('*')
      .or('is_test_data.eq.true,cleanup_reason.neq.manuell_granskning,archived_at.not.is.null')
      .order('created_at', { ascending: false })
      .limit(250)

    if (error) throw error
    return ((data ?? []) as Record<string, unknown>[]).map(normalize)
  } catch (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }
}
