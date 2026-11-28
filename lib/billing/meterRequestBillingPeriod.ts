import type { GridOwnerDataRequestRow } from '@/lib/cis/types'
import { parseBillingMonth, strictIsoDate } from '@/lib/time/stockholm'

export type MeterRequestBillingPeriod = Pick<GridOwnerDataRequestRow,
  'request_scope' | 'status' | 'requested_period_start' | 'requested_period_end'>

/** Only a stored request whose entire civil date range belongs to one invoice month. */
export function meterRequestBillingMonth(request: MeterRequestBillingPeriod): string | null {
  if (request.request_scope !== 'meter_values' || request.status === 'cancelled') return null
  try {
    const start = strictIsoDate(request.requested_period_start)
    const end = strictIsoDate(request.requested_period_end)
    const month = parseBillingMonth(start.slice(0, 7)).value
    return end >= start && end.startsWith(`${month}-`) ? month : null
  } catch {
    return null
  }
}
