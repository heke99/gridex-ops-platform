import 'server-only'

import { supabaseService } from '@/lib/supabase/service'
import { previousStockholmBillingMonth } from '@/lib/time/stockholm'

type BillingReviewRPC = {
  rpc(name: 'gridex_read_billing_ediel_blocker_sources_v1', args: {
    p_actor_user_id: string
    p_company_id: string
    p_underlay_ids: string[]
  }): PromiseLike<{ data: unknown; error: unknown }>
  rpc(name: 'gridex_list_portal_billing_review_months_v1', args: {
    p_company_id: string
    p_customer_ids: string[]
    p_last_year: number
    p_last_month: number
  }): PromiseLike<{ data: unknown; error: unknown }>
}

const service = supabaseService as unknown as BillingReviewRPC
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export async function readInvoiceEdielReviewSources(companyId: string, actorUserId: string, underlayIds: string[]) {
  const sources = new Map<string, string | null>()
  const scopedIds = [...new Set(underlayIds.filter(id => UUID.test(id)))]
  for (let offset = 0; offset < scopedIds.length; offset += 100) {
    const ids = scopedIds.slice(offset, offset + 100)
    const allowed = new Set(ids)
    const { data, error } = await service.rpc('gridex_read_billing_ediel_blocker_sources_v1', {
      p_actor_user_id: actorUserId, p_company_id: companyId, p_underlay_ids: ids,
    })
    if (error || !Array.isArray(data)) continue
    for (const row of data) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue
      const { underlay_id: id, source_message_id: source } = row as Record<string, unknown>
      if (typeof id === 'string' && allowed.has(id) && (source === null || (typeof source === 'string' && UUID.test(source)))) {
        sources.set(id, source)
      }
    }
  }
  return sources
}

export async function readPortalInvoiceReviewMonths(companyId: string | null, customerIds: string[], now = new Date()) {
  if (!companyId || !customerIds.length) return []
  const scopedIds = [...new Set(customerIds.filter(id => UUID.test(id)))]
  const [lastYear, lastMonth] = previousStockholmBillingMonth(now).split('-').map(Number)
  const last = new Date(Date.UTC(lastYear, lastMonth - 1, 1))
  const displayMonths = new Map<number, Date>()
  for (let offset = 0; offset < scopedIds.length; offset += 100) {
    const { data, error } = await service.rpc('gridex_list_portal_billing_review_months_v1', {
      p_company_id: companyId, p_customer_ids: scopedIds.slice(offset, offset + 100),
      p_last_year: lastYear, p_last_month: lastMonth,
    })
    if (error || !Array.isArray(data) || data.length > 3) return []
    for (const row of data) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue
      const { year, month } = row as Record<string, unknown>
      if (typeof year !== 'number' || !Number.isInteger(year) || typeof month !== 'number' || !Number.isInteger(month)) continue
      if (month < 1 || month > 12 || year < 2000 || year > lastYear) continue
      const display = new Date(Date.UTC(year, month - 1, 1))
      if (display <= last) displayMonths.set(display.getTime(), display)
    }
  }
  return [...displayMonths.values()].sort((a, b) => b.getTime() - a.getTime()).slice(0, 3)
}
