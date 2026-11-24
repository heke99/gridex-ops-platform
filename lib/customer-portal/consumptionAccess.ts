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

function preciseTimestamp(value: unknown): string {
  const normalized = timestamp(value)
  const fraction = (value as string).slice(19).match(/^\.(\d+)/)?.[1] ?? ''
  if (fraction.length > 6) throw new Error('Invalid precision for supply or meter instant')
  const microseconds = fraction.slice(3).padEnd(3, '0')
  return microseconds === '000' ? normalized : normalized.slice(0, -1) + microseconds + 'Z'
}

function precedes(left: string, right: string): boolean {
  // PostgreSQL preserves microseconds. Pad UTC fractions for ordered comparison.
  return left.slice(0, -1).padEnd(26, '0') < right.slice(0, -1).padEnd(26, '0')
}

export function needsVerifiedSupplyEnd(period: ConsumptionRow): boolean {
  if (period.actual_end_date !== null) return false
  if (period.status === 'ended') return true
  if (period.status !== 'ending' || !period.end_date || !period.market_end_at) return false
  return precedes(midnight(period.end_date, true), preciseTimestamp(period.market_end_at))
}

function verifiedEnds(periods: ConsumptionRow[], projection: ConsumptionRow[]) {
  const expected = new Map(periods.filter(needsVerifiedSupplyEnd).map(period => [period.id, period]))
  const ends = new Map<unknown, string>()
  for (const row of projection) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid verified supply end')
    const period = expected.get(row.period_id)
    if (!period || ends.has(row.period_id) || typeof period.market_state_version !== 'number'
      || !Number.isSafeInteger(period.market_state_version) || period.market_state_version < 0
      || row.market_state_version !== period.market_state_version) throw new Error('Mismatched verified supply end')
    const end = preciseTimestamp(row.effective_end_at)
    if (end !== preciseTimestamp(period.market_end_at)) throw new Error('Mismatched verified supply end')
    ends.set(row.period_id, end)
  }
  return ends
}

/** Access starts with a confirmed delivery. Legacy end dates include the Swedish
 * calendar day. A verified market closure uses its exact exclusive instant.
 * A separately recorded actual end keeps its ceiling. Without source proof,
 * planned and market bounds can only narrow the half-open UTC window. */
export function consumptionWindows(scope: ConsumptionScope, sites: ConsumptionRow[], points: ConsumptionRow[], periods: ConsumptionRow[], projection: ConsumptionRow[] = []): ConsumptionWindow[] {
  const effectiveEnds = verifiedEnds(periods, projection)
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
    const effectiveEnd = effectiveEnds.get(period.id)
    if (period.status === 'ended' && !period.actual_end_date && !effectiveEnd) throw new Error('Unverified supply end')
    let from = midnight(period.actual_start_date)
    let to = effectiveEnd ?? (period.actual_end_date ? midnight(period.actual_end_date, true) : null)
    // The verified date and instant describe one source end. The date is not
    // a second ceiling when that precise exclusive instant has been proved.
    if (!effectiveEnd && period.end_date) {
      const planned = midnight(period.end_date, true)
      if (!to || precedes(planned, to)) to = planned
    }
    if (period.market_start_at) { const start = preciseTimestamp(period.market_start_at); if (precedes(from, start)) from = start }
    if (period.market_end_at) { const end = preciseTimestamp(period.market_end_at); if (!to || precedes(end, to)) to = end }
    if (to && !precedes(from, to)) throw new Error('Invalid confirmed supply range')
    const facilityReference = typeof site.facility_reference === 'string' && site.facility_reference ? site.facility_reference : publicReference('facility', scope.companyId, site.id)
    const pointReference = publicReference('metering_point', scope.companyId, point.id)
    if (!facilityReference || !pointReference) throw new Error('Invalid supply reference')
    result.push({ facility_reference: facilityReference, metering_point_reference: pointReference, from, to })
  }
  return result
}

export function meterValueWithinSupply(scope: ConsumptionScope, row: ConsumptionRow, windows: ConsumptionWindow[]): boolean {
  if (row.company_id !== scope.companyId || row.customer_id !== scope.customerId) throw new Error('Foreign meter value')
  const from = preciseTimestamp(row.period_start), to = preciseTimestamp(row.period_end)
  if (!precedes(from, to)) throw new Error('Invalid meter interval')
  const point = publicReference('metering_point', scope.companyId, row.metering_point_id)
  return windows.some(window => window.metering_point_reference === point && !precedes(from, window.from)
    && (window.to === null || !precedes(window.to, to)))
}
