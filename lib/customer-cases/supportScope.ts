import { getCustomerCaseById } from '@/lib/customer-cases/db'
import type { CustomerCaseRow } from '@/lib/customer-cases/types'

export const EDIEL_OPERATIONAL_CASE_SOURCE = 'ediel_inbound_state_machine'

export function isTenantSupportCase(row: Pick<CustomerCaseRow, 'source' | 'metadata'>): boolean {
  // Older support rows can have either marker. The Ediel case producer owns
  // its own operational scope even if a historical row carries support metadata.
  return row.source !== EDIEL_OPERATIONAL_CASE_SOURCE
    && (row.metadata?.support_case === true || row.source?.startsWith('tenant_support_') === true)
}

export async function readTenantSupportCase(caseId: string, companyId: string): Promise<CustomerCaseRow | null> {
  const row = await getCustomerCaseById(caseId, companyId)
  return row?.id === caseId && row.company_id === companyId && isTenantSupportCase(row) ? row : null
}
