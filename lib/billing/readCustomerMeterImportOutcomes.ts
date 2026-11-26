import 'server-only'
import { supabaseService } from '@/lib/supabase/service'

export type CustomerMeterImportOutcome = {
  requestId: string
  siteId: string
  meteringPointId: string
  periodStart: string
  periodEnd: string
  billingMonth: string | null
  environment: 'test' | 'production'
  state: 'retry_required' | 'resolved'
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const day = /^\d{4}-\d{2}-\d{2}$/

export async function readCustomerMeterImportOutcomes(input: {
  companyId: string
  customerId: string
  actorUserId: string
  requestIds: string[]
}): Promise<CustomerMeterImportOutcome[] | null> {
  const requestIds = new Set(input.requestIds)
  if (requestIds.size === 0) return []
  if (requestIds.size > 50 || [...requestIds].some(id => !uuid.test(id))) return null
  try {
    const { data, error } = await supabaseService.rpc('gridex_read_customer_import_outcome_v1', {
      p_company: input.companyId,
      p_customer: input.customerId,
      p_actor: input.actorUserId,
      p_requests: [...requestIds],
    })
    if (error?.code === '42501') return []
    if (error || !Array.isArray(data)) return null
    const result: CustomerMeterImportOutcome[] = []
    const returned = new Set<string>()
    for (const value of data as unknown[]) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
      const row = value as Record<string, unknown>
      if (typeof row.requestId !== 'string' || !requestIds.has(row.requestId) || returned.has(row.requestId) ||
        typeof row.siteId !== 'string' || !uuid.test(row.siteId) ||
        typeof row.meteringPointId !== 'string' || !uuid.test(row.meteringPointId) ||
        typeof row.periodStart !== 'string' || !day.test(row.periodStart) ||
        typeof row.periodEnd !== 'string' || !day.test(row.periodEnd) || row.periodStart > row.periodEnd ||
        (row.billingMonth !== null && (typeof row.billingMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(row.billingMonth))) ||
        (row.environment !== 'test' && row.environment !== 'production') ||
        (row.state !== 'retry_required' && row.state !== 'resolved')) return null
      const { requestId, siteId, meteringPointId, periodStart, periodEnd, billingMonth, environment, state } = row
      returned.add(requestId)
      result.push({ requestId, siteId, meteringPointId, periodStart, periodEnd, billingMonth, environment, state })
    }
    return result
  } catch {
    return null
  }
}
