import { publicReference } from '@/lib/integrations/publicReferences'
import { strictIsoDate, stockholmLocalToUtc } from '@/lib/time/stockholm'

export const CONSUMPTION_VERSION = '2026-11-13.1'
export type ConsumptionRow = Record<string, unknown>
export type ConsumptionScope = { companyId: string; customerId: string }
export type ConsumptionWindow = { facility_reference: string; metering_point_reference: string; from: string; to: string | null }

function midnight(value: unknown, nextDay = false): string {
  const date = strictIsoDate(value)
  const day = new Date(`${date}T12:00:00Z`)
  if (nextDay) day.setUTCDate(day.getUTCDate() + 1)
  return stockholmLocalToUtc({ year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate() }).toISOString()
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Invalid canonical supply instant')
  strictIsoDate(value.slice(0, 10))
  const time = value.slice(11, 19).split(':').map(Number)
  if (time[0] > 23 || time[1] > 59 || time[2] > 59) throw new Error('Invalid canonical supply instant')
  return new Date(value).toISOString()
}

/** No planned start, move-in or contract date can grant meter access. Ends are
 * inclusive Swedish calendar dates; the wire interval is half-open UTC. Market
 * instants, when present, can only narrow the independently confirmed dates. */
export function consumptionWindows(scope: ConsumptionScope, sites: ConsumptionRow[], points: ConsumptionRow[], periods: ConsumptionRow[]): ConsumptionWindow[] {
  const siteMap = new Map(sites.map(site => [site.id, site]))
  const pointMap = new Map(points.map(point => [point.id, point]))
  const result: ConsumptionWindow[] = []
  for (const period of periods) {
    if (period.company_id !== scope.companyId || period.customer_id !== scope.customerId) throw new Error('Foreign supply period')
    if (!['active', 'confirmed_by_grid_owner', 'ending', 'ended'].includes(String(period.status))) continue
    if (!period.actual_start_date || !period.market_start_at) throw new Error('Confirmed supply authority unavailable')
    const point = pointMap.get(period.metering_point_id)
    const site = point && siteMap.get(point.customer_site_id ?? point.site_id)
    if (!point || !site || point.company_id !== scope.companyId || site.company_id !== scope.companyId || site.customer_id !== scope.customerId) throw new Error('Unverified supply ownership')
    if (period.status === 'ended' && !period.actual_end_date) throw new Error('Unverified supply end')
    let from = midnight(period.actual_start_date)
    let to = period.actual_end_date ? midnight(period.actual_end_date, true) : null
    // A planned end may restrict visibility, but never extend actual rights.
    if (period.end_date) { const planned = midnight(period.end_date, true); if (!to || planned < to) to = planned }
    if (period.market_start_at) { const start = timestamp(period.market_start_at); if (start > from) from = start }
    if (period.market_end_at) { const end = timestamp(period.market_end_at); if (!to || end < to) to = end }
    if (to && from >= to) throw new Error('Invalid confirmed supply range')
    const facilityReference = typeof site.facility_reference === 'string' && site.facility_reference ? site.facility_reference : publicReference('facility', scope.companyId, site.id)
    const pointReference = publicReference('metering_point', scope.companyId, point.id)
    if (!facilityReference || !pointReference) throw new Error('Invalid supply reference')
    result.push({ facility_reference: facilityReference, metering_point_reference: pointReference, from, to })
  }
  return result
}

export function meterValueWithinSupply(scope: ConsumptionScope, row: ConsumptionRow, windows: ConsumptionWindow[]): boolean {
  if (row.company_id !== scope.companyId || row.customer_id !== scope.customerId) throw new Error('Foreign meter value')
  const from = timestamp(row.period_start), to = timestamp(row.period_end)
  if (from >= to) throw new Error('Invalid meter interval')
  const point = publicReference('metering_point', scope.companyId, row.metering_point_id)
  return windows.some(window => window.metering_point_reference === point && from >= window.from && (window.to === null || to <= window.to))
}
