import 'server-only'

import { contractCalendarDate } from '@/lib/customer-contracts/operationalDates'
import { supabaseService } from '@/lib/supabase/service'
import type { CustomerPortalContext, CustomerPortalContractRow } from '@/lib/customer-portal/types'

type ContractDeliveryEnd = {
  contract_id: string
  period_id: string
  last_delivery_date: string
  market_end_at: string
  supply_status: 'ending' | 'ended'
}

function isContractDeliveryEnd(row: unknown): row is ContractDeliveryEnd {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false
  const delivery = row as Record<string, unknown>
  return typeof delivery.contract_id === 'string' && typeof delivery.period_id === 'string'
    && typeof delivery.last_delivery_date === 'string'
    && contractCalendarDate(delivery.last_delivery_date) === delivery.last_delivery_date
    && typeof delivery.market_end_at === 'string' && /(Z|[+-]\d{2}:\d{2})$/.test(delivery.market_end_at)
    && Number.isFinite(Date.parse(delivery.market_end_at))
    && (delivery.supply_status === 'ending' || delivery.supply_status === 'ended')
}

export async function listPortalContractDeliveryEnds(
  context: CustomerPortalContext,
  contracts: Pick<CustomerPortalContractRow, 'id' | 'company_id' | 'customer_id'>[],
) {
  const result = new Map<string, ContractDeliveryEnd[]>()
  if (!context.companyId || !context.customerIds.length || !contracts.length) return result
  const permitted = new Set(context.customerIds)
  const scoped = contracts.filter(contract =>
    contract.company_id === context.companyId && permitted.has(contract.customer_id))
  if (!scoped.length) return result
  const contractIds = new Set(scoped.map(contract => contract.id))
  const customerIds = new Set(scoped.map(contract => contract.customer_id))
  const { data, error, count } = await supabaseService.rpc('gridex_list_portal_contract_delivery_ends_v1', {
    p_company_id: context.companyId,
    p_customer_ids: [...customerIds],
    p_contract_ids: [...contractIds],
  }, { count: 'exact' })
  if (error) throw error
  if (!Array.isArray(data) || count !== data.length) throw new Error('contract_delivery_read_invalid')
  const periods = new Set<string>()
  for (const delivery of data) {
    if (!isContractDeliveryEnd(delivery) || !contractIds.has(delivery.contract_id) || periods.has(delivery.period_id)) {
      throw new Error('contract_delivery_read_invalid')
    }
    periods.add(delivery.period_id)
    const existing = result.get(delivery.contract_id) ?? []
    existing.push(delivery)
    result.set(delivery.contract_id, existing)
  }
  return result
}
