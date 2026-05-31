import { getLatestForecastByBiddingZone } from '@/lib/analytics/db'
import { monthStart } from '@/lib/analytics/utils'

export async function buildPurchaseForecastByBiddingZone(companyId: string, periodStart: string, periodEnd?: string) {
  void periodEnd
  return getLatestForecastByBiddingZone(companyId, { month: monthStart(periodStart) })
}
