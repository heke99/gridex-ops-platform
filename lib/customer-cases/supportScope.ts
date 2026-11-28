import { getCustomerCaseById } from '@/lib/customer-cases/db'
import type { CustomerCaseRow } from '@/lib/customer-cases/types'

import { isTenantSupportCase } from './supportPolicy'

export { EDIEL_OPERATIONAL_CASE_SOURCE, isTenantSupportCase } from './supportPolicy'

export async function readTenantSupportCase(caseId: string, companyId: string): Promise<CustomerCaseRow | null> {
  const row = await getCustomerCaseById(caseId, companyId)
  return row?.id === caseId && row.company_id === companyId && isTenantSupportCase(row) ? row : null
}
