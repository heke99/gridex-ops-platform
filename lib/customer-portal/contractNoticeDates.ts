import 'server-only'

import { supabaseService } from '@/lib/supabase/service'
import type { CustomerPortalContext, CustomerPortalContractRow } from '@/lib/customer-portal/types'

export type ContractNoticeDates = {
  receivedOn: string
  plannedEndOn: string | null
}

const calendarDate = /^\d{4}-\d{2}-\d{2}$/

export async function listPortalContractNoticeDates(
  context: CustomerPortalContext,
  contracts: Pick<CustomerPortalContractRow, 'id' | 'company_id' | 'customer_id'>[],
): Promise<Map<string, ContractNoticeDates>> {
  const result = new Map<string, ContractNoticeDates>()
  if (!context.companyId || !context.customerIds.length || !contracts.length) return result

  const authorizedCustomers = new Set(context.customerIds)
  const scopedContracts = contracts.filter(contract =>
    contract.company_id === context.companyId && authorizedCustomers.has(contract.customer_id))
  if (!scopedContracts.length) return result
  const contractIds = new Set(scopedContracts.map(contract => contract.id))
  const customerIds = new Set(scopedContracts.map(contract => contract.customer_id))

  const { data, error } = await supabaseService.rpc('gridex_list_portal_contract_notice_dates_v1', {
    p_company_id: context.companyId,
    p_customer_ids: [...customerIds],
    p_contract_ids: [...contractIds],
  })
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('contract_notice_read_invalid')

  for (const row of data) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const { contract_id: id, notice_received_on: receivedOn, planned_contract_end_on: plannedEndOn } = row as Record<string, unknown>
    if (typeof id !== 'string' || !contractIds.has(id) || typeof receivedOn !== 'string' || !calendarDate.test(receivedOn)) continue
    if (plannedEndOn !== null && (typeof plannedEndOn !== 'string' || !calendarDate.test(plannedEndOn))) continue
    result.set(id, { receivedOn, plannedEndOn })
  }
  return result
}
