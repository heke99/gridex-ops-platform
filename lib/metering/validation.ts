import { supabaseService } from '@/lib/supabase/service'
import { stockholmMonthBounds } from '@/lib/time/stockholm'
import { billingMonthLoadWindow, supplyPeriodBillingSegment } from '@/lib/billing/billingMonth'
import { BILLED_SUPPLY_PERIOD_STATUSES } from '@/lib/billing/supplyPeriodEnd'
import { resolutionMinutes, type MeteringResolution } from '@/lib/metering/contractMeteringResolution'

export type MeteringCompletenessIssue = {
  code:
    | 'metering_values_missing'
    | 'metering_gap'
    | 'metering_overlap'
    | 'metering_estimated'
    | 'metering_total_mismatch'
    | 'metering_resolution_insufficient'
    | 'metering_point_resolution_mismatch'
  message: string
  severity: 'blocked' | 'warning'
  meteringPointId?: string | null
  details?: Record<string, unknown>
}

export type MeteringCompletenessResult = {
  billingMonth: string
  status: 'complete' | 'incomplete' | 'estimated_only' | 'no_data'
  meteringPointCount: number
  valueCount: number
  estimatedValueCount: number
  issues: MeteringCompletenessIssue[]
}

const RESOLUTION_LABEL: Record<MeteringResolution, string> = { month: 'månadsvärden', day: 'dygnsvärden', hour: 'timvärden', quarter_hour: 'kvartsvärden' }
const ESTIMATED_QUALITY_STATUSES = new Set(['estimated', 'preliminary', 'temp', 'temporary', 'calculated'])
const COVERAGE_BLOCK_THRESHOLD = 0.999
const TOTAL_MISMATCH_TOLERANCE = 0.01

function schemaMissing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /does not exist|schema cache/i.test(message)
}

type NormalizedValueRow = {
  metering_point_id: string
  period_start: string
  period_end: string
  quantity_kwh: number | string | null
  quality_status: string | null
}

function toMs(value: string): number { return new Date(value).getTime() }
function chunk<T>(items: T[], size: number): T[][] {
  const output: T[][] = []
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size))
  return output
}

// PostgREST returns at most its configured max_rows (1 000 in supabase/config.toml) per request whatever
// .limit() asks for, and one quarter-hour month is 2 880–2 980 values per point. Read in ordered pages.
const PAGE_SIZE = 1_000
const MAX_ROWS = 500_000

async function loadNormalizedValues(input: { companyId: string; meteringPointIds: string[]; startIso: string; endIso: string }): Promise<NormalizedValueRow[] | null> {
  const rows: NormalizedValueRow[] = []
  for (const ids of chunk(input.meteringPointIds, 100)) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabaseService
        .from('normalized_metering_values')
        .select('metering_point_id,period_start,period_end,quantity_kwh,quality_status')
        .eq('company_id', input.companyId)
        .in('metering_point_id', ids)
        .lt('period_start', input.endIso)
        .gt('period_end', input.startIso)
        .order('period_start', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)
      if (error) {
        if (schemaMissing(error)) return null
        throw error
      }
      const page = (data ?? []) as NormalizedValueRow[]
      rows.push(...page)
      if (page.length < PAGE_SIZE) break
      if (rows.length >= MAX_ROWS) throw new Error('Mätvärdeskontrollen överskred maximalt antal rader för en period.')
    }
  }
  return rows
}

/**
 * The supplied part of the billing month per metering point: the same segments the underlays bill
 * (supplyPeriodBillingSegment). An Ediel-qualified supply is framed by the Ediel month (00:00 +0100 on the 1st,
 * FINDINGS F108 / ENV-08), a manual/legacy supply by the Swedish civil month (owner decision M7). A point without a
 * billed supply period in the month has no entry (its whole civil month stays required).
 */
export async function loadSuppliedBillingWindows(companyId: string, billingMonth: string, meteringPointIds?: readonly string[] | null): Promise<Map<string, Array<{ start: string; end: string }>>> {
  const bounds = stockholmMonthBounds(billingMonth)
  const lastDay = new Date(Date.parse(`${bounds.endDateExclusive}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  const windows = new Map<string, Array<{ start: string; end: string }>>()
  const scopes: Array<string[] | null> = meteringPointIds ? chunk([...new Set(meteringPointIds)], 200) : [null]
  for (const scope of scopes) {
    for (let from = 0; ; from += 500) {
      let query = supabaseService
        .from('customer_supply_periods')
        .select('id,metering_point_id,status,start_date,end_date,actual_start_date,actual_end_date,market_start_at,market_end_at')
        .eq('company_id', companyId)
        .in('status', [...BILLED_SUPPLY_PERIOD_STATUSES])
      if (scope) query = query.in('metering_point_id', scope)
      const result = await query
        .lte('start_date', lastDay)
        .or(`end_date.is.null,end_date.gte.${bounds.startDate}`)
        .order('id', { ascending: true })
        .range(from, from + 499)
      if (result.error) {
        if (schemaMissing(result.error)) return windows
        throw result.error
      }
      const page = (result.data ?? []) as Array<Record<string, unknown>>
      for (const period of page) {
        const pointId = typeof period.metering_point_id === 'string' && period.metering_point_id.trim() ? period.metering_point_id.trim() : null
        const segment = pointId ? supplyPeriodBillingSegment(period, billingMonth) : null
        if (pointId && segment) windows.set(pointId, [...(windows.get(pointId) ?? []), { start: segment.start, end: segment.end }])
      }
      if (page.length < 500) break
    }
  }
  return windows
}

/** The given supplied windows clipped to the month, sorted and merged; null when none were given. */
function suppliedWindows(windows: Array<{ start: string; end: string }> | null | undefined, month: { startMs: number; endMs: number }) {
  if (!windows || windows.length === 0) return null
  const spans = windows
    .map((span) => ({ start: Math.max(toMs(span.start), month.startMs), end: Math.min(toMs(span.end), month.endMs) }))
    .filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end) && span.end > span.start)
    .sort((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number }> = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end)
    else merged.push({ ...span })
  }
  return merged
}

export async function evaluateMeteringCompletenessForMonth(input: {
  companyId: string
  billingMonth: string
  meteringPoints: Array<{
    meteringPointId: string
    expectedKwh?: number | null
    /** Resolution the customer's contract needs; values coarser than this cannot be billed. */
    requiredResolution?: MeteringResolution | null
    /** The meter cannot deliver the contract's resolution (e.g. hourly contract on a monthly-read meter). */
    meterCannotDeliver?: boolean
    /**
     * The supplied parts of the month (ISO instants, end exclusive), e.g. the billed underlay segments. Without it
     * the whole Stockholm civil month must be covered. With it only the supplied time is required: a supply that
     * starts at 00:00 Ediel fixed normal time (01:00 local in summer, ENV-08) or mid-month has no values before
     * its start, and those are not a gap (FINDINGS F108). Windows may reach past the civil month: an Ediel-qualified
     * supply is billed per Ediel month (00:00 +0100 on the 1st, owner decision 2026-10-23), so its window ends at
     * 23:00Z on the last civil day in summer, and that last hour is required too.
     */
    windows?: Array<{ start: string; end: string }> | null
  }>
  allowEstimatedValues?: boolean
}): Promise<MeteringCompletenessResult> {
  const bounds = stockholmMonthBounds(input.billingMonth)
  // A point given without windows is measured against its billed supply segments, like the underlay engine: an
  // Ediel supply per Ediel month (October 2026 = 744 h, not the civil 745 h), a manual one per civil month. Only a
  // point without a billed supply period in the month keeps the whole civil month (FINDINGS F108, reality G-4).
  const unwindowed = input.meteringPoints.filter((entry) => entry.meteringPointId && !(entry.windows && entry.windows.length > 0)).map((entry) => entry.meteringPointId)
  const resolvedWindows = unwindowed.length > 0 ? await loadSuppliedBillingWindows(input.companyId, input.billingMonth, unwindowed) : new Map<string, Array<{ start: string; end: string }>>()
  const meteringPoints = input.meteringPoints.map((entry) => (entry.windows && entry.windows.length > 0) ? entry : { ...entry, windows: resolvedWindows.get(entry.meteringPointId) ?? null })
  const civilWindow = { startMs: toMs(bounds.start), endMs: toMs(bounds.end), startIso: bounds.start, endIso: bounds.end }
  // With supplied windows the month is the union of the civil and the Ediel month; the windows decide what is required.
  const union = billingMonthLoadWindow(input.billingMonth)
  const windowedMonth = { startMs: toMs(union.start), endMs: toMs(union.end), startIso: union.start, endIso: union.end }
  const anyWindows = meteringPoints.some((entry) => Boolean(entry.windows && entry.windows.length > 0))
  const loadWindow = anyWindows ? windowedMonth : civilWindow
  const issues: MeteringCompletenessIssue[] = []
  const meteringPointIds = Array.from(new Set(meteringPoints.map((entry) => entry.meteringPointId).filter(Boolean)))
  if (meteringPointIds.length === 0) return { billingMonth: input.billingMonth, status: 'no_data', meteringPointCount: 0, valueCount: 0, estimatedValueCount: 0, issues: [] }

  const rows = await loadNormalizedValues({ companyId: input.companyId, meteringPointIds, startIso: loadWindow.startIso, endIso: loadWindow.endIso })
  if (rows === null) {
    return { billingMonth: input.billingMonth, status: 'no_data', meteringPointCount: meteringPointIds.length, valueCount: 0, estimatedValueCount: 0, issues: [{ code: 'metering_values_missing', message: 'Normaliserade mätvärden kan inte läsas (tabell saknas). Kör senaste migrationen.', severity: 'warning' }] }
  }

  const byMeteringPoint = new Map<string, NormalizedValueRow[]>()
  for (const row of rows) {
    const list = byMeteringPoint.get(row.metering_point_id) ?? []
    list.push(row)
    byMeteringPoint.set(row.metering_point_id, list)
  }

  let estimatedValueCount = 0
  for (const entry of meteringPoints) {
    if (entry.meterCannotDeliver && entry.requiredResolution) {
      issues.push({ code: 'metering_point_resolution_mismatch', message: `Avtalet kräver ${RESOLUTION_LABEL[entry.requiredResolution]} men mätpunkten rapporteras bara per månad. Kontrollera avtalet eller be nätägaren byta till intervallavläsning.`, severity: 'blocked', meteringPointId: entry.meteringPointId, details: { required_resolution: entry.requiredResolution } })
    }
    const window = entry.windows && entry.windows.length > 0 ? windowedMonth : civilWindow
    const pointRows = (byMeteringPoint.get(entry.meteringPointId) ?? []).filter((row) => toMs(row.period_start) < window.endMs && toMs(row.period_end) > window.startMs)
    if (pointRows.length === 0) {
      issues.push({ code: 'metering_values_missing', message: 'Inga normaliserade mätvärden finns för mätpunkten i fakturaperioden.', severity: 'blocked', meteringPointId: entry.meteringPointId })
      continue
    }
    const supplied = suppliedWindows(entry.windows, window)
    const intervals = pointRows.map((row) => ({
      start: Math.max(toMs(row.period_start), window.startMs),
      end: Math.min(toMs(row.period_end), window.endMs),
      estimated: ESTIMATED_QUALITY_STATUSES.has(String(row.quality_status ?? '').toLowerCase()),
      quantity: typeof row.quantity_kwh === 'string' ? Number(row.quantity_kwh) : row.quantity_kwh,
    })).filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start)
      // Values wholly outside the supplied windows belong to a neighbouring billing month or another supply.
      .filter((interval) => !supplied || supplied.some((span) => interval.start < span.end && interval.end > span.start))
      .sort((a, b) => a.start - b.start)

    let coveredMs = 0
    let overlapMs = 0
    let cursor = window.startMs
    for (const interval of intervals) {
      if (interval.estimated) estimatedValueCount += 1
      if (interval.start < cursor) overlapMs += Math.min(cursor, interval.end) - interval.start
      const effectiveStart = Math.max(interval.start, cursor)
      if (interval.end > effectiveStart) {
        coveredMs += supplied ? supplied.reduce((sum, span) => sum + Math.max(0, Math.min(interval.end, span.end) - Math.max(effectiveStart, span.start)), 0) : interval.end - effectiveStart
        cursor = interval.end
      }
    }
    const windowMs = supplied ? supplied.reduce((sum, span) => sum + span.end - span.start, 0) : window.endMs - window.startMs
    const coverage = windowMs > 0 ? coveredMs / windowMs : 1
    if (overlapMs > 0) issues.push({ code: 'metering_overlap', message: `Mätvärden överlappar varandra (${Math.round(overlapMs / 3_600_000)} h dubbeltäckning) och riskerar dubbelfakturering.`, severity: 'blocked', meteringPointId: entry.meteringPointId, details: { overlap_hours: overlapMs / 3_600_000 } })
    if (coverage < COVERAGE_BLOCK_THRESHOLD) issues.push({ code: 'metering_gap', message: `Mätvärden täcker bara ${(coverage * 100).toFixed(1)} % av perioden (${Math.round((windowMs - coveredMs) / 3_600_000)} h saknas).`, severity: 'blocked', meteringPointId: entry.meteringPointId, details: { coverage_percent: coverage * 100, missing_hours: (windowMs - coveredMs) / 3_600_000, time_zone: bounds.timeZone } })
    if (entry.requiredResolution && !entry.meterCannotDeliver && intervals.length > 0) {
      // Values must be at least as fine as the contract needs: a monthly total
      // covers the period but cannot price an hourly or quarter-hour contract.
      const requiredMs = resolutionMinutes(entry.requiredResolution) * 60_000
      const coarsest = intervals.reduce((max, interval) => Math.max(max, interval.end - interval.start), 0)
      // An hour can be 60 min only; allow DST/rounding slack, and treat any month as month.
      if (entry.requiredResolution !== 'month' && coarsest > requiredMs * 1.05) {
        issues.push({ code: 'metering_resolution_insufficient', message: `Avtalet kräver ${RESOLUTION_LABEL[entry.requiredResolution]} men mätvärdena är grövre (${Math.round(coarsest / 60_000)} min per värde). Begär mätvärden med rätt upplösning.`, severity: 'blocked', meteringPointId: entry.meteringPointId, details: { required_resolution: entry.requiredResolution, coarsest_interval_minutes: coarsest / 60_000 } })
      }
    }
    const estimatedForPoint = intervals.filter((interval) => interval.estimated).length
    if (estimatedForPoint > 0) issues.push({ code: 'metering_estimated', message: `${estimatedForPoint} mätvärde(n) är preliminära/estimerade. Slutfaktura kräver slutliga värden.`, severity: input.allowEstimatedValues ? 'warning' : 'blocked', meteringPointId: entry.meteringPointId, details: { estimated_count: estimatedForPoint } })
    const expectedKwh = typeof entry.expectedKwh === 'number' && Number.isFinite(entry.expectedKwh) ? entry.expectedKwh : null
    if (expectedKwh !== null && expectedKwh > 0) {
      const actualKwh = intervals
        .filter((interval) => !supplied || supplied.some((span) => interval.start >= span.start && interval.start < span.end))
        .reduce((sum, interval) => sum + (typeof interval.quantity === 'number' && Number.isFinite(interval.quantity) ? interval.quantity : 0), 0)
      const difference = Math.abs(actualKwh - expectedKwh)
      if (difference > Math.max(expectedKwh * TOTAL_MISMATCH_TOLERANCE, 1)) issues.push({ code: 'metering_total_mismatch', message: `Summan av mätvärden (${actualKwh.toFixed(1)} kWh) avviker från underlagets kWh (${expectedKwh.toFixed(1)} kWh).`, severity: 'warning', meteringPointId: entry.meteringPointId, details: { actual_kwh: actualKwh, expected_kwh: expectedKwh } })
    }
  }

  const hasBlockingIssues = issues.some((issue) => issue.severity === 'blocked')
  const status: MeteringCompletenessResult['status'] = rows.length === 0 ? 'no_data' : hasBlockingIssues ? (issues.every((issue) => issue.code === 'metering_estimated') ? 'estimated_only' : 'incomplete') : 'complete'
  return { billingMonth: input.billingMonth, status, meteringPointCount: meteringPointIds.length, valueCount: rows.length, estimatedValueCount, issues }
}

export async function companyAllowsEstimatedMeteringValues(companyId: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseService.from('companies').select('metadata').eq('id', companyId).maybeSingle()
    if (error || !data) return false
    const metadata = (data as { metadata?: Record<string, unknown> | null }).metadata
    if (!metadata || typeof metadata !== 'object') return false
    const billing = (metadata as Record<string, unknown>).billing
    if (billing && typeof billing === 'object' && !Array.isArray(billing)) return (billing as Record<string, unknown>).allow_estimated_metering_values === true
    return (metadata as Record<string, unknown>).allow_estimated_metering_values === true
  } catch { return false }
}
